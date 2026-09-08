# agents/search.py
#
# Turns product URLs into priced candidates, by reading the merchant's own
# structured data.
#
# WHAT THIS STAGE IS NOT
# It is not a discovery engine. It cannot be asked "find me a wool coat" and
# come back with shops. Three routes to that were tried and measured on
# 2026-09-08, and all three are closed:
#
#   Gemini search grounding   HTTP 429 RESOURCE_EXHAUSTED. Grounding bills
#                             against a separate quota that this key does
#                             not have. Plain generation on the same key and
#                             the same model works, so this is a quota
#                             boundary, not an outage.
#   Fetching retail pages     403 from Etsy, Waterstones, Tesla, Uniqlo and
#                             Gymshark. Allbirds answered 200 with 600KB of
#                             HTML and no product data in it, because the
#                             page renders client side.
#   Shopify product JSON      404 or 403 on every store tried.
#
# So discovery needs either a paid search quota, a merchant feed, or a
# browser that executes JavaScript and is not blocked. Crossmint's Agent
# Checkouts is that browser, which is why its input is a direct product URL
# rather than a query. This stage is shaped to feed that: it takes URLs and
# turns them into candidates we can price and check.
#
# WHERE URLS COME FROM
# state.context["product_urls"], or the request itself if it contains links.
# A buyer pasting a link is the case this serves today.
#
# WHAT IT WILL NOT DO
# Invent a candidate. If a URL cannot be fetched or carries no price, it is
# reported with the reason and excluded. Downstream stages would otherwise
# price and potentially buy against a guess.

from __future__ import annotations

import asyncio
import json
import re
import time
from decimal import Decimal, InvalidOperation

import httpx

from ..state import Money, MoneyError, StageResult, TaskState

FETCH_TIMEOUT_SECONDS = 20.0
FETCH_CONCURRENCY = 4
MAX_BYTES = 600_000

# Retail blocks obvious automation. A browser UA gets through some sites and
# not others, which the module docstring records. It is set to be fetched at
# all, not to disguise anything: the request is still one page read.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
}

URL_RE = re.compile(r'https?://[^\s<>"\')]+')


def extract_urls(text: str) -> list[str]:
    seen, out = set(), []
    for u in URL_RE.findall(text or ""):
        u = u.rstrip('.,;')
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _meta(html: str, prop: str) -> str | None:
    for pattern in (
        r'<meta[^>]+(?:property|name)=["\']' + re.escape(prop) + r'["\'][^>]*content=["\']([^"\']+)',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']' + re.escape(prop) + r'["\']',
    ):
        m = re.search(pattern, html, re.I)
        if m:
            return m.group(1)
    return None


def _jsonld_products(html: str) -> list[dict]:
    """Every schema.org Product in the page, including inside @graph."""
    found = []
    for m in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html, re.S | re.I,
    ):
        try:
            data = json.loads(m.group(1).strip())
        except (json.JSONDecodeError, ValueError):
            continue
        stack = [data]
        while stack:
            d = stack.pop()
            if isinstance(d, list):
                stack.extend(d)
                continue
            if not isinstance(d, dict):
                continue
            graph = d.get("@graph")
            if graph:
                stack.extend(graph if isinstance(graph, list) else [graph])
            t = d.get("@type")
            types = [t] if isinstance(t, str) else (t or [])
            if any(str(x).lower() == "product" for x in types):
                found.append(d)
    return found


def _first_offer(product: dict) -> dict:
    offers = product.get("offers") or {}
    if isinstance(offers, list):
        return offers[0] if offers and isinstance(offers[0], dict) else {}
    return offers if isinstance(offers, dict) else {}


def parse_product(html: str, url: str, decimals: int, symbol: str) -> tuple[dict | None, str]:
    """Return (candidate, reason). candidate is None when the page carries no
    price we can trust."""
    title = price_text = currency = None

    for product in _jsonld_products(html):
        offer = _first_offer(product)
        if offer.get("price") is not None:
            title = product.get("name")
            price_text = str(offer["price"])
            currency = offer.get("priceCurrency")
            break

    if price_text is None:
        price_text = _meta(html, "product:price:amount") or _meta(html, "og:price:amount")
        currency = currency or _meta(html, "product:price:currency") or _meta(html, "og:price:currency")
        title = title or _meta(html, "og:title")

    if not title:
        m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
        title = m.group(1).strip()[:140] if m else None

    if price_text is None:
        return None, "page carries no structured price (no schema.org Product offer, no price meta tag)"

    # The listed price is in the merchant's currency. The cart settles in a
    # different one, and no conversion happens here: inventing an exchange
    # rate on a spend path is exactly the kind of guess this pipeline avoids.
    # The number is carried through with its own currency and QA compares
    # like for like, or refuses.
    try:
        amount = Decimal(str(price_text).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return None, f"price {price_text!r} is not a number"

    listed_currency = (currency or "").upper() or None
    try:
        money = Money(int(amount * (Decimal(10) ** decimals)), decimals, listed_currency or symbol)
    except (MoneyError, ArithmeticError, ValueError) as e:
        return None, f"price {price_text!r} could not be represented exactly ({type(e).__name__})"

    return {
        "title": (title or url)[:140],
        "url": url,
        "price": money,
        "listed_currency": listed_currency,
        "merchant": re.sub(r"^www\.", "", (re.match(r"https?://([^/]+)", url) or [None, ""])[1]),
    }, "ok"


async def _resolve(client: httpx.AsyncClient, url: str, decimals: int, symbol: str) -> tuple[dict | None, dict]:
    try:
        r = await client.get(url, follow_redirects=True)
    except (httpx.HTTPError, OSError) as e:
        return None, {"url": url, "reason": f"could not fetch ({type(e).__name__})"}
    if r.status_code >= 400:
        hint = " (the merchant blocks automated requests)" if r.status_code in (401, 403, 429) else ""
        return None, {"url": url, "reason": f"HTTP {r.status_code}{hint}"}
    candidate, reason = parse_product(r.text[:MAX_BYTES], url, decimals, symbol)
    if candidate is None:
        return None, {"url": url, "reason": reason}
    return candidate, {}


async def run(state: TaskState) -> StageResult:
    started = time.time()

    budget = state.profile.get("budget")
    symbol = budget.symbol if isinstance(budget, Money) else "USDT"
    decimals = budget.decimals if isinstance(budget, Money) else 18

    urls = list(state.context.get("product_urls") or []) or extract_urls(state.request)
    if not urls:
        return StageResult(
            stage="search", status="error", data={},
            note=(
                "No product URLs to resolve, and no discovery source is configured. "
                "This stage reads a merchant's own page; it cannot search the web. "
                "Supply product links, or configure a source. See the module docstring "
                "for the three routes that were measured and why each is closed."
            ),
            started_at=started, ended_at=time.time(),
        )

    sem = asyncio.Semaphore(FETCH_CONCURRENCY)

    async def one(u):
        async with sem:
            return await _resolve(client, u, decimals, symbol)

    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT_SECONDS, headers=HEADERS) as client:
        results = await asyncio.gather(*(one(u) for u in urls))

    candidates = [c for c, _ in results if c]
    rejected = [r for c, r in results if not c]
    state.candidates = candidates

    if not candidates:
        return StageResult(
            stage="search", status="error",
            data={"rejected": rejected, "tried": len(urls)},
            note=(
                f"None of the {len(urls)} URL(s) produced a usable candidate. "
                "Nothing was invented to fill the gap."
            ),
            started_at=started, ended_at=time.time(),
        )

    return StageResult(
        stage="search", status="ok",
        data={
            "candidates": [
                {**c, "price": c["price"].to_dict()} for c in candidates
            ],
            "rejected": rejected,
            "tried": len(urls),
        },
        note=(
            f"Resolved {len(candidates)} of {len(urls)} URL(s)."
            + (f" {len(rejected)} could not be used." if rejected else "")
        ),
        started_at=started, ended_at=time.time(),
    )
