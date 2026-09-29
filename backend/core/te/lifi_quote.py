"""One LI.FI quote, asked for by the server, checked, and labelled as LI.FI's.

WHY THE SERVER ASKS AT ALL
--------------------------
The site asks LI.FI from the visitor's browser (frontend/src/trade/lifi.js)
and never from here. An order prepared for a client that has no browser
(tnega_prepare_buy and tnega_prepare_sell) has no other way to say what the
route would pay and which contract the approval is for, so the server asks,
once or twice per order. The owner's decision of 2026-09-25: a LI.FI quote may
be served, labelled as LI.FI's quote with the time it was taken. The signing
page asks LI.FI again from the browser right before anything is signed; the
figures here are what LI.FI said at quoted_at and nothing more.

THE RULES THIS FILE KEEPS, the same as lifi.js
  - every request carries denyExchanges=jupiter, and a route whose steps name
    Jupiter is refused anyway;
  - the answer is checked against the question (chains, tokens, amount,
    wallet, transaction) before it is used;
  - no integrator and no fee of Tnega's: LI.FI's own published fee only.

THE BUDGET. Without a key LI.FI allows about 75 quotes per 2 hours per IP,
and every caller of this server shares the server's one IP. So this process
counts its own keyless quotes and stops at KEYLESS_BUDGET, and a 429 stops
it until LI.FI's reset. The count is per process and lost on restart; it is a
guard, not an accounting. LIFI_API_KEY, when the owner sets it, is sent as
x-lifi-api-key and never logged or served.
"""

from __future__ import annotations

import collections
import datetime as dt
import os
import threading
import time
from urllib.parse import urlencode

import httpx

QUOTE_URL = "https://li.quest/v1/quote"
TIMEOUT_S = 8.0
KEYLESS_BUDGET = 60
WINDOW_S = 2 * 3600
# On top of the two-hour budget: one caller in a loop could otherwise spend
# the whole of it in a minute and leave every other caller with nothing.
KEYLESS_PER_MINUTE = 6

# LI.FI's contract on each chain: the only address an approval may name and
# the only address its transaction may call. From LI.FI's own chain list,
# GET https://li.quest/v1/chains, field diamondAddress, read 2026-09-29; the
# Base address was also the approvalAddress and transactionRequest.to of a
# real quote on 2026-09-28, and the Robinhood Chain address of one on
# 2026-09-29. Robinhood Chain and HyperEVM do not use the address the other
# four share.
DIAMONDS = {
    1: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae",
    8453: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae",
    42161: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae",
    56: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae",
    4663: "0xb477751b76cf82d00a686a1232f5fcd772414af3",
    999: "0x0a0758d937d1059c356d4714e57f5df0239bce1a",
}

_lock = threading.Lock()
_times: collections.deque = collections.deque()
_blocked_until = 0.0


def _key() -> str:
    return os.environ.get("LIFI_API_KEY", "").strip()


def budget_left(now: float | None = None) -> int | None:
    """Keyless quotes this process may still ask for in the window; None with a key."""
    if _key():
        return None
    now = now or time.time()
    with _lock:
        while _times and now - _times[0] > WINDOW_S:
            _times.popleft()
        return max(0, KEYLESS_BUDGET - len(_times))


def _take() -> str | None:
    """None if a quote may be asked for now, else why not."""
    now = time.time()
    if now < _blocked_until:
        return f"LI.FI refused this server's quotes (HTTP 429) until {_iso(_blocked_until)}"
    if _key():
        return None
    with _lock:
        while _times and now - _times[0] > WINDOW_S:
            _times.popleft()
        if len(_times) >= KEYLESS_BUDGET:
            return (f"this server has asked LI.FI for {KEYLESS_BUDGET} quotes in the last 2 hours without a key, "
                    f"its share of LI.FI's keyless limit; the next is allowed at {_iso(_times[0] + WINDOW_S)}")
        recent = [t for t in _times if now - t < 60]
        if len(recent) >= KEYLESS_PER_MINUTE:
            return (f"this server has asked LI.FI for {KEYLESS_PER_MINUTE} quotes in the last minute, the most it "
                    f"asks without a key so that no one caller spends the shared budget; the next is allowed at "
                    f"{_iso(recent[0] + 60)}")
        _times.append(now)
    return None


def _iso(t: float) -> str:
    return dt.datetime.fromtimestamp(t, dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def request_params(*, chain_id: int, from_token: str, to_token: str, from_amount_raw: int,
                   wallet: str, slippage_bps: int) -> dict:
    return {
        "fromChain": str(chain_id), "toChain": str(chain_id),
        "fromToken": from_token, "toToken": to_token, "fromAmount": str(from_amount_raw),
        "fromAddress": wallet, "toAddress": wallet,
        "slippage": str(slippage_bps / 10000), "order": "CHEAPEST",
        "denyExchanges": "jupiter",
    }


def jupiter_in(quote) -> list[str]:
    """Every place a route names Jupiter, at any depth. Non-empty refuses it."""
    hits: list[str] = []

    def walk(x, path):
        if isinstance(x, list):
            for i, y in enumerate(x):
                walk(y, f"{path}[{i}]")
            return
        if not isinstance(x, dict):
            return
        for k in ("tool", "exchange", "bridge"):
            if isinstance(x.get(k), str) and "jupiter" in x[k].lower():
                hits.append(f"{path}.{k}")
        td = x.get("toolDetails")
        if isinstance(td, dict) and "jupiter" in f"{td.get('key') or ''} {td.get('name') or ''}".lower():
            hits.append(f"{path}.toolDetails")
        for k, v in x.items():
            if k != "toolDetails" and isinstance(v, (dict, list)):
                walk(v, f"{path}.{k}")
    walk(quote, "quote")
    return hits


def mismatch(quote: dict, p: dict) -> list[str]:
    """Where the answer differs from the question. Non-empty refuses it."""
    a = quote.get("action") or {}
    tr = quote.get("transactionRequest") or {}
    lc = lambda x: str(x or "").lower()  # noqa: E731
    bad = []
    if str(a.get("fromChainId")) != p["fromChain"]:
        bad.append("the paying chain")
    if str(a.get("toChainId")) != p["toChain"]:
        bad.append("the receiving chain")
    if lc((a.get("fromToken") or {}).get("address")) != lc(p["fromToken"]):
        bad.append("the token sent")
    if lc((a.get("toToken") or {}).get("address")) != lc(p["toToken"]):
        bad.append("the token received")
    if str(a.get("fromAmount")) != p["fromAmount"]:
        bad.append("the amount")
    if lc(a.get("fromAddress")) != lc(p["fromAddress"]):
        bad.append("the wallet")
    if not tr.get("to") or not tr.get("data"):
        bad.append("the transaction")
    if tr.get("from") and lc(tr["from"]) != lc(p["fromAddress"]):
        bad.append("the transaction's sender")
    if tr.get("chainId") is not None and str(int(str(tr["chainId"]), 0)) != p["fromChain"]:
        bad.append("the transaction's chain")
    # The recipient. The quote itself must deliver to the wallet; a step
    # inside it may deliver to LI.FI's own contract, which forwards (a real
    # quote on Robinhood Chain, 2026-09-29, had both included steps deliver
    # to the diamond), and to nothing else.
    diamond = DIAMONDS.get(int(p["fromChain"]))
    if lc(a.get("toAddress")) != lc(p["toAddress"]):
        bad.append("the recipient")
    for s in quote.get("includedSteps") or []:
        to = lc(((s or {}).get("action") or {}).get("toAddress"))
        if to and to not in (lc(p["toAddress"]), diamond):
            bad.append("a step's recipient")
            break
    # The contracts. Only LI.FI's own contract on this chain may be approved
    # or called.
    e = quote.get("estimate") or {}
    if diamond is None:
        bad.append("the chain (no LI.FI contract known for it)")
    else:
        if lc(e.get("approvalAddress")) != diamond:
            bad.append("the approval's spender")
        if tr.get("to") and lc(tr["to"]) != diamond:
            bad.append("the contract called")
    return bad


def refusal(quote: dict, params: dict) -> str | None:
    """Why a quote cannot be used, or None. Applied to every quote before it
    is used, wherever it came from."""
    bad = mismatch(quote, params)
    if bad:
        return "the quote does not match the request: " + ", ".join(bad)
    if jupiter_in(quote):
        return "the route names Jupiter, which is never used"
    return None


def _tools(quote: dict) -> list[str]:
    out: list[str] = []
    for s in [quote] + list(quote.get("includedSteps") or []):
        if not isinstance(s, dict):
            continue
        name = "LI.FI's fee step" if s.get("tool") == "feeCollection" else ((s.get("toolDetails") or {}).get("name") or s.get("tool"))
        if name and name not in out:
            out.append(name)
    return out


def _f(x) -> float | None:
    try:
        return round(float(x), 4)
    except (TypeError, ValueError):
        return None


def facts(quote: dict, quoted_at: str) -> dict:
    """The figures an order shows, read off the quote as LI.FI sent it."""
    e = quote.get("estimate") or {}
    a = quote.get("action") or {}
    return {
        "source": "LI.FI quote",
        "quoted_at": quoted_at,
        "from_amount_raw": str(a.get("fromAmount")),
        "to_amount_expected_raw": str(e.get("toAmount")),
        "to_amount_min_raw": str(e.get("toAmountMin")),
        "to_decimals": (a.get("toToken") or {}).get("decimals"),
        "fees": [{"name": "LI.FI's fee step" if f.get("name") == "Integrator Fee" else f.get("name"),
                  "usd": _f(f.get("amountUSD")), "percentage": _f(f.get("percentage")),
                  "included": f.get("included")} for f in e.get("feeCosts") or []],
        "gas_usd": round(sum(v for v in (_f(g.get("amountUSD")) for g in e.get("gasCosts") or []) if v), 4)
        if e.get("gasCosts") else None,
        "route": _tools(quote),
        "seconds_estimated": e.get("executionDuration"),
        "approval_address": (e.get("approvalAddress") or "").lower() or None,
        "transaction_to": ((quote.get("transactionRequest") or {}).get("to") or "").lower() or None,
    }


async def quote(params: dict) -> dict:
    """{"ok": True, "quote", "quoted_at"} or {"ok": False, "kind", "reason"}.

    kind, and what the caller does with it:
      no_route, refused    LI.FI answered and there is no usable route for
                           this version (a 404, any other 4xx but 429, or a
                           quote that fails refusal()): try another version
      budget, rate,        LI.FI was not asked, or did not answer: a fact
      network, http        about this call (http is a 5xx), not about the
                           route; no order can be stood behind"""
    global _blocked_until
    why = _take()
    if why:
        return {"ok": False, "kind": "budget", "reason": why}
    headers = {"accept": "application/json"}
    if _key():
        headers["x-lifi-api-key"] = _key()
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
            r = await c.get(f"{QUOTE_URL}?{urlencode(params)}", headers=headers)
    except httpx.HTTPError as e:
        return {"ok": False, "kind": "network", "reason": f"LI.FI did not answer ({type(e).__name__})"}
    quoted_at = _iso(time.time())
    if r.status_code == 429:
        try:
            wait = float(r.headers.get("ratelimit-reset") or r.headers.get("retry-after") or 600)
        except ValueError:
            wait = 600.0
        _blocked_until = time.time() + min(max(wait, 30.0), WINDOW_S)
        return {"ok": False, "kind": "rate", "reason": "LI.FI's limit for this server is used up (HTTP 429)"}
    try:
        body = r.json()
    except ValueError:
        body = None
    if r.status_code != 200 or not isinstance(body, dict):
        msg = str((body or {}).get("message") or f"HTTP {r.status_code}")[:200] if isinstance(body, dict) else f"HTTP {r.status_code}"
        if r.status_code == 404:
            return {"ok": False, "kind": "no_route", "reason": f"LI.FI found no route: {msg}"}
        if 400 <= r.status_code < 500:
            return {"ok": False, "kind": "refused", "reason": f"LI.FI refused the request (HTTP {r.status_code}): {msg}"}
        return {"ok": False, "kind": "http", "reason": f"LI.FI answered HTTP {r.status_code}"}
    why = refusal(body, params)
    if why:
        return {"ok": False, "kind": "refused", "quoted_at": quoted_at, "reason": why}
    return {"ok": True, "quote": body, "quoted_at": quoted_at}


# The kinds that mean LI.FI was not asked or did not answer.
UNAVAILABLE = ("budget", "rate", "network", "http")
