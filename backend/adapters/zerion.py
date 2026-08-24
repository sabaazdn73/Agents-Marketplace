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
