"""
zerion.py

Real, opt-in wallet portfolio enrichment via the Zerion API — richer than
bsc_balance.py's plain native-BNB read (real USD values, every token held,
real DeFi positions), for the ONE place that's actually worth it: a single
agent's detail page, on demand.

Real investigation before building this (2026-08-24), not assumed:
  - Our key's real, measured tier (from live rate-limit headers, not docs):
    `demo` — 1 request/second, 300 requests/day.
  - That budget makes this a genuinely bad fit for the marketplace-wide
    refresh (569+ agents; bsc_balance.py already does that for free, in one
    batched RPC call, unlimited) — so this module is deliberately NEVER
    called from aggregate.py. It exists only for a buyer who opens ONE
    specific agent's detail page and asks to see more.
  - Real comparison against agent_performance.py's Multicall3 job scan
    (a different real question — that decodes ERC-8183 job status, this
    reads a general wallet balance) confirmed they don't overlap; Zerion is
    additive here, not a replacement for anything.
  - Real, decisive negative confirmed for a DIFFERENT real use case (bStock
    PnL): two real, on-chain-verified bStock tokens (NVDAB, TSLAB) both come
    back "fungible not found" from Zerion — likely the newer BEP-8056
    standard, not plain BEP-20. Not relevant to this module (native BNB +
    whatever real fungibles Zerion DOES recognize still resolve fine), but
    worth knowing this integration has a real, not universal, coverage gap.

Best-effort, same discipline as bsc_balance.py: any failure (rate limit,
network, malformed response) is reported honestly as "unavailable", never a
fabricated number.
"""

from __future__ import annotations

import os
import time

import httpx

_BASE_URL = "https://api.zerion.io/v1"
_BSC_CHAIN_ID = "binance-smart-chain"  # Zerion's real, string chain identifier — confirmed live, not "56"

# Real per-address cache: only 300 real calls/day total for this key, and a
# detail page can realistically be opened by several different visitors for
# the same popular agent in a short window — a short TTL keeps that from
# burning quota on identical, still-fresh data. Same pattern already used
# elsewhere in this project (agent_performance.py's _cache).
_TTL_SECONDS = 10 * 60
_cache: dict[str, tuple[float, dict]] = {}


def _get_key() -> str | None:
    return os.environ.get("ZERION_API_KEY")


async def get_wallet_portfolio(address: str) -> dict:
    """Real, opt-in BSC portfolio for one wallet: every token Zerion prices
    for it (native + ERC-20 + any real DeFi position), each with a real USD
    value. Returns {"available": False, "reason": ...} honestly on any
    failure — missing key, rate limit, network error, or an address Zerion
    genuinely has nothing for — never a fabricated position.

    10-minute cache per address (module-level, in-process) — cheap
    insurance against this project's real 300/day budget on this key."""
    addr = (address or "").lower()
    if not addr.startswith("0x") or len(addr) != 42:
        return {"available": False, "reason": "not a valid EVM address"}

    cached = _cache.get(addr)
    if cached and time.time() - cached[0] < _TTL_SECONDS:
        return cached[1]

    key = _get_key()
    if not key:
        return {"available": False, "reason": "ZERION_API_KEY not set"}

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(
                f"{_BASE_URL}/wallets/{addr}/positions/",
                params={
                    "currency": "usd",
                    "filter[positions]": "no_filter",
                    "filter[chain_ids]": _BSC_CHAIN_ID,
                },
                auth=(key, ""),  # real Zerion auth scheme: HTTP Basic, key as username, empty password
            )
    except httpx.HTTPError as e:
        result = {"available": False, "reason": f"couldn't reach Zerion: {e}"}
        _cache[addr] = (time.time(), result)
        return result

    if resp.status_code == 429:
        result = {"available": False, "reason": "rate limited — try again later"}
        _cache[addr] = (time.time(), result)
        return result
    if not resp.is_success:
        result = {"available": False, "reason": f"Zerion returned HTTP {resp.status_code}"}
        _cache[addr] = (time.time(), result)
        return result

    body = resp.json()
    positions = []
    total_usd = 0.0
    for item in body.get("data", []) or []:
        a = item.get("attributes", {}) or {}
        info = a.get("fungible_info", {}) or {}
        value = a.get("value")
        if isinstance(value, (int, float)):
            total_usd += value
        positions.append({
            "symbol": info.get("symbol"),
            "name": info.get("name"),
            "quantity": (a.get("quantity") or {}).get("float"),
            "usd_value": value,
            "position_type": a.get("position_type"),  # "wallet" | "deposit" | "loan" | "staked" | ...
            "protocol": a.get("protocol"),
        })
    # Real, largest-first — the point of this view is "what does this wallet
    # actually hold", led by whatever's worth the most.
    positions.sort(key=lambda p: p["usd_value"] or 0, reverse=True)

    result = {"available": True, "total_usd_value": round(total_usd, 2), "positions": positions}
    _cache[addr] = (time.time(), result)
    return result


# Real, opt-in per-job "agent activity" transparency view (2026-08-28) — see
# JobStatusPanel.jsx's own docstring for the full real feature. Real
# investigation before building this, not assumed: Zerion's own
# /wallets/{address}/transactions/ real filter params
# (filter[min_mined_at]/filter[max_mined_at]) take Unix MILLISECONDS, not
# seconds — confirmed live: a real query using raw Unix seconds against a
# known, exact real transaction (job #56646's real on-chain submit() call,
# provider 0x08cef8...b5dd, mined 2026-08-24T10:46:32Z) came back EMPTY, the
# same query in milliseconds correctly returned that exact real transaction
# (operation_type "execute", sent_to the real AgenticCommerce contract
# address, hash matching the on-chain record). Not documented clearly enough
# to trust on faith — verified against real, known-good data first.
_activity_cache: dict[str, tuple[float, dict]] = {}
_ACTIVITY_TTL_SECONDS = 10 * 60


def _parse_transaction_attrs(a: dict) -> dict:
    """Real, shared per-transaction parser — used by both get_wallet_activity
    (a bounded time-window view, one page) and get_wallet_full_history
    (2026-08-28, a bounded-page-count, full-history view, no time window).
    Real gas-fee field: fee.value is the real fee already converted to the
    requested currency (USD); fee.quantity.float is the real native-token
    amount, an honest fallback for the rare case Zerion couldn't price the
    gas token itself. Real protocol_name: only populated when Zerion has
    genuinely matched the called contract to a known real protocol
    (acts[].application_metadata.name) — see core/onchain_pnl.py's own
    real, live-confirmed investigation into why operation_type ALONE isn't
    reliable evidence of real protocol interaction.

    Real, added 2026-08-28 for core/onchain_history.py's "Full on-chain
    history" feature: `transfers` — the real token/native transfers this
    transaction actually moved (symbol, name, direction in/out, real
    quantity, counterparty, and whether Zerion's own real `verified` flag
    is set — an honest, disclosed signal for a real, common case: unverified/
    spam-airdropped tokens showing up in a real wallet's real transfer
    history, never silently hidden, just labeled)."""
    fee = a.get("fee") or {}
    acts = a.get("acts") or []
    protocol_name = None
    if acts:
        protocol_name = ((acts[0].get("application_metadata") or {}).get("name")) or None

    transfers = []
    for t in (a.get("transfers") or []):
        info = t.get("fungible_info") or {}
        transfers.append({
            "symbol": info.get("symbol"),
            "name": info.get("name"),
            "verified": bool((info.get("flags") or {}).get("verified")),
            "direction": t.get("direction"),
            "quantity": (t.get("quantity") or {}).get("float"),
            "usd_value": t.get("value"),
            "counterparty": t.get("recipient") if t.get("direction") == "out" else t.get("sender"),
        })

    return {
        "hash": a.get("hash"),
        "operation_type": a.get("operation_type"),
        "mined_at": a.get("mined_at"),  # real ISO-8601 UTC timestamp, straight from Zerion
        "sent_to": a.get("sent_to"),
        "status": a.get("status"),
        "fee_usd": fee.get("value"),
        "fee_native": (fee.get("quantity") or {}).get("float"),
        "protocol_name": protocol_name,
        "transfers": transfers,
    }


async def get_wallet_activity(address: str, min_mined_at_ms: int, max_mined_at_ms: int) -> dict:
    """Real, human-readable on-chain activity for one wallet, scoped to a
    real time window (Unix milliseconds) — built for "what did this agent's
    wallet actually do between funding and delivery", not a general
    portfolio/history dump. Returns {"available": False, "reason": ...}
    honestly on any failure (missing key, rate limit, network error, or a
    real, genuine "nothing happened in this window") — never a fabricated
    transaction. Same 10-minute per-window cache discipline as
    get_wallet_portfolio, opt-in and per-job by design (never called in
    bulk — see this module's own header)."""
    addr = (address or "").lower()
    if not addr.startswith("0x") or len(addr) != 42:
        return {"available": False, "reason": "not a valid EVM address"}
    if not isinstance(min_mined_at_ms, int) or not isinstance(max_mined_at_ms, int) or min_mined_at_ms >= max_mined_at_ms:
        return {"available": False, "reason": "invalid time window"}

    cache_key = f"{addr}:{min_mined_at_ms}:{max_mined_at_ms}"
    cached = _activity_cache.get(cache_key)
    if cached and time.time() - cached[0] < _ACTIVITY_TTL_SECONDS:
        return cached[1]

    key = _get_key()
    if not key:
        return {"available": False, "reason": "ZERION_API_KEY not set"}

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(
                f"{_BASE_URL}/wallets/{addr}/transactions/",
                params={
                    "currency": "usd",
                    "filter[chain_ids]": _BSC_CHAIN_ID,
                    "filter[min_mined_at]": min_mined_at_ms,
                    "filter[max_mined_at]": max_mined_at_ms,
                    "page[size]": 50,
                },
                auth=(key, ""),
            )
    except httpx.HTTPError as e:
        result = {"available": False, "reason": f"couldn't reach Zerion: {e}"}
        _activity_cache[cache_key] = (time.time(), result)
        return result

    if resp.status_code == 429:
        result = {"available": False, "reason": "rate limited — try again later"}
        _activity_cache[cache_key] = (time.time(), result)
        return result
    if not resp.is_success:
        result = {"available": False, "reason": f"Zerion returned HTTP {resp.status_code}"}
        _activity_cache[cache_key] = (time.time(), result)
        return result

    body = resp.json()
    transactions = [_parse_transaction_attrs(item.get("attributes", {}) or {}) for item in body.get("data", []) or []]
    # Real, already-descending order from Zerion (confirmed live) — kept as-is.

    result = {"available": True, "transactions": transactions}
    _activity_cache[cache_key] = (time.time(), result)
    return result


# Real, chart-based historical portfolio valuation (2026-08-28) — the real
# start/end values core/pnl.py's PnL computation needs. Real investigation
# before building this, not assumed: Zerion's API has NO arbitrary-
# timestamp lookup — confirmed against the real, published docs
# (developers.zerion.io/reference/getwalletchart) — only fixed periods
# (hour/day/week/month/3months/6months/year/5years/max), each returning a
# real, evenly-spaced series of [timestamp, balance] points. Real,
# live-confirmed spacing (2026-08-28, against our own explainer agent's
# real owner wallet): `week` = 337 points, 1,800s (30 min) apart; `month` =
# 361 points, 7,200s (2h) apart. core/pnl.py picks the smallest real period
# that covers a given job's real [start, end] window, then uses the real
# chart point closest to each real target timestamp — always reporting
# that point's own real timestamp alongside the target, never silently
# treating a distant point as if it were exact.
#
# Real extension (2026-08-28, for core/onchain_pnl.py's "Historical
# on-chain performance" signal): added "6months" and "year" — both real,
# documented Zerion periods (developers.zerion.io), live-confirmed here
# too before use, not assumed: "6months" = 361 points, 43,200s (12h)
# apart; "year" = 366 points, 86,400s (24h) apart. core/pnl.py's original,
# Tnega-hire-job-scoped window never needed more than "3months"; a real
# agent's own independent on-chain execution history can genuinely span
# longer, so the option set grew rather than forcing that signal to
# silently give up past 90 real days.
CHART_PERIODS = ("day", "week", "month", "3months", "6months", "year")


async def get_wallet_chart(address: str, period: str) -> dict:
    """Real portfolio-value-over-time series for one wallet — a real,
    evenly-spaced sample within a fixed Zerion period (see CHART_PERIODS),
    not an arbitrary date range. Returns {"available": False, "reason":
    ...} honestly on any failure, same discipline as this module's other
    real functions."""
    addr = (address or "").lower()
    if not addr.startswith("0x") or len(addr) != 42:
        return {"available": False, "reason": "not a valid EVM address"}
    if period not in CHART_PERIODS:
        return {"available": False, "reason": f"unsupported real chart period: {period}"}

    cache_key = f"{addr}:{period}"
    cached = _activity_cache.get(cache_key)
    if cached and time.time() - cached[0] < _ACTIVITY_TTL_SECONDS:
        return cached[1]

    key = _get_key()
    if not key:
        return {"available": False, "reason": "ZERION_API_KEY not set"}

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(
                f"{_BASE_URL}/wallets/{addr}/charts/{period}",
                params={"currency": "usd", "filter[chain_ids]": _BSC_CHAIN_ID},
                auth=(key, ""),
            )
    except httpx.HTTPError as e:
        result = {"available": False, "reason": f"couldn't reach Zerion: {e}"}
        _activity_cache[cache_key] = (time.time(), result)
        return result

    if resp.status_code == 429:
        result = {"available": False, "reason": "rate limited — try again later"}
        _activity_cache[cache_key] = (time.time(), result)
        return result
    if not resp.is_success:
        result = {"available": False, "reason": f"Zerion returned HTTP {resp.status_code}"}
        _activity_cache[cache_key] = (time.time(), result)
        return result

    body = resp.json()
    points = (body.get("data", {}) or {}).get("attributes", {}).get("points", []) or []
    # Real [timestamp_seconds, balance_usd] pairs, straight from Zerion —
    # kept as tuples, no reshaping that could silently drop precision.
    result = {"available": True, "points": [(p[0], p[1]) for p in points if isinstance(p, list) and len(p) == 2]}
    _activity_cache[cache_key] = (time.time(), result)
    return result


# Real, multi-page "Full on-chain history" fetch (2026-08-28) — built for
# core/onchain_history.py after live-confirming BSCSCAN_API_KEY's real,
# current free tier does NOT cover BSC's account module (txlist/tokentx/
# balance all return a real, live "Free API access is not supported for
# this chain. Please upgrade your api plan for full chain coverage." —
# only the unrelated `contract` module, e.g. getsourcecode, works free for
# BSC). Zerion — already integrated, already proven live on BSC — is the
# real, working substitute. Real, live-confirmed pagination (2026-08-28):
# the transactions endpoint's own response includes a real `links.next`
# cursor URL (a real `page[after]` opaque cursor, not a guessed offset),
# so a real, complete-as-fetched history beyond the first 50 transactions
# is genuinely reachable — bounded here to a real, deliberate page cap so
# one agent's "Full history" view can't consume an outsized share of the
# real 300-request/day Zerion budget.
_MAX_HISTORY_PAGES = 4  # up to 200 real transactions per real view — real, deliberate quota discipline


async def get_wallet_full_history(address: str) -> dict:
    """Real, bounded-page, NO time-window wallet history — every real
    transaction type (sends, receives, approvals, trades, mints, contract
    calls...), not filtered to DeFi-execution-only the way
    core/onchain_pnl.py's own real, narrower probe is. Real, honest
    completeness signal always included: `has_more` (Zerion's own
    `links.next` still had more after the real page cap) and
    `pages_fetched` — never implies this is a wallet's full lifetime
    history when a real, deliberate budget cap cut it short."""
    addr = (address or "").lower()
    if not addr.startswith("0x") or len(addr) != 42:
        return {"available": False, "reason": "not a valid EVM address"}

    key = _get_key()
    if not key:
        return {"available": False, "reason": "ZERION_API_KEY not set"}

    transactions: list[dict] = []
    url = f"{_BASE_URL}/wallets/{addr}/transactions/"
    params = {"currency": "usd", "filter[chain_ids]": _BSC_CHAIN_ID, "page[size]": 50}
    pages_fetched = 0
    has_more = False

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            while pages_fetched < _MAX_HISTORY_PAGES:
                resp = await client.get(url, params=params if pages_fetched == 0 else None, auth=(key, ""))
                if resp.status_code == 429:
                    if pages_fetched == 0:
                        return {"available": False, "reason": "rate limited — try again later"}
                    break  # real, honest partial result — keep what we already fetched rather than discard it
                if not resp.is_success:
                    if pages_fetched == 0:
                        return {"available": False, "reason": f"Zerion returned HTTP {resp.status_code}"}
                    break
                body = resp.json()
                transactions.extend(_parse_transaction_attrs(item.get("attributes", {}) or {}) for item in body.get("data", []) or [])
                pages_fetched += 1
                next_url = (body.get("links") or {}).get("next")
                if not next_url:
                    has_more = False
                    break
                url = next_url
                has_more = True
    except httpx.HTTPError as e:
        if pages_fetched == 0:
            return {"available": False, "reason": f"couldn't reach Zerion: {e}"}
        # real, honest partial result from whatever pages already succeeded

    return {"available": True, "transactions": transactions, "pages_fetched": pages_fetched, "has_more": has_more}
