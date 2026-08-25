"""
coingecko.py

Real, first actual data-consuming CoinGecko integration in this project.
Honest history: CoinGecko was previously only used for a live reachability
check on /api/status (see core/status_checks.py's own docstring note about
this) — no feature actually consumed its data. Found during a real
data-gap audit (2026-08-27): every agent's detail page shows the owner
wallet's real BNB balance (adapters/bsc_balance.py) with no USD context,
purely because nothing supplied a live BNB/USD price — CoinGecko is
exactly the real, free, public source for that.

Public endpoint, no API key needed (confirmed live, 200 in ~50ms):
    GET https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd

Real, honest failure mode: any error (network, malformed response, rate
limit) returns None — the frontend already shows plain BNB with no USD
suffix in that case, never a fabricated/stale-looking number.
"""

from __future__ import annotations

import time

import httpx

_TTL_SECONDS = 5 * 60  # generous relative to a free public anonymous endpoint
_cache: dict = {"price": None, "checked_at": 0.0}


async def get_bnb_usd_price() -> float | None:
    now = time.time()
    if _cache["price"] is not None and (now - _cache["checked_at"]) < _TTL_SECONDS:
        return _cache["price"]

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": "binancecoin", "vs_currencies": "usd"},
            )
            resp.raise_for_status()
            price = resp.json().get("binancecoin", {}).get("usd")
    except Exception as e:
        print(f"[coingecko] BNB/USD price fetch failed, real value withheld (not fabricated): {e}")
        return _cache["price"]  # serve the last real known price if we have one, else None

    if isinstance(price, (int, float)):
        _cache["price"] = float(price)
        _cache["checked_at"] = now
        return _cache["price"]
    return _cache["price"]
