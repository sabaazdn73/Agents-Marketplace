"""
status_checks.py

Backs the public /api/status endpoint (and the frontend /status page):
real, live, right-now reachability checks against every external
integration this project actually depends on, 8004scan, Zerion, CoinGecko,
the BSC RPC (primary AND, separately, the Infura backup added
2026-09-04, see core/rpc.py), the explainer-agent service, MongoDB, and
TermiX's AACP registry (added 2026-08-28, see adapters/termix.py for what
it's used for).

Honesty rules, matching this project's standing discipline elsewhere:
  - Every check is a network/DB call made at request time (through the
    short TTL cache below), never a hardcoded "ok: true".
  - No fabricated uptime percentage or history, this is a snapshot, not a
    monitor. Each result reports THIS check's own response time, not an
    average or a claim about the past.
  - A check that fails is reported as a failure (ok: False + the real
    error), never silently hidden or downgraded.

CoinGecko note (honest, not swept under the rug): this project doesn't yet
have a live data-consuming CoinGecko integration anywhere in the codebase,
checked before writing this (2026-08-25), confirmed absent. It's included
here as a real, live reachability check against CoinGecko's own public ping
endpoint anyway, both because a credit commitment was made in their grant
application (see the "Data Sources" attribution page) and because a status
page is a reasonable place to track a provider before code depends on it.
Reported honestly as "reachable", not as "in active use".

Short TTL cache (30s, process-local): a status page is exactly the kind
of endpoint hackathon judges/visitors might hit repeatedly, and two of these
checks (8004scan, Zerion) run against keys with daily budgets, this
keeps a page full of visitors from burning that budget on checks that would
report the same answer a few seconds apart anyway.
"""

from __future__ import annotations

import asyncio
import os
import time

import httpx

from adapters.bsc_balance import _rpc_url as _bsc_rpc_url
from core.db import get_db
from core.ingest_status import get_discovery_status

_EXPLAINER_AGENT_PING_URL = "https://explainer-agent.onrender.com/ping"
_TIMEOUT = 10.0

_cache: dict = {"data": None, "checked_at": 0.0}
_CACHE_TTL_SECONDS = 30


async def _timed(name: str, coro) -> dict:
    t0 = time.monotonic()
    try:
        detail = await coro
        return {
            "name": name,
            "ok": True,
            "response_ms": round((time.monotonic() - t0) * 1000),
            "detail": detail,
        }
    except Exception as e:
        # bug, found live during an actual 8004scan outage (2026-09-06):
        # this reported `"detail": ""` for the one service that was actually
        # down. httpx's timeout exceptions stringify to the empty string, so
        # `str(e)` erased the reason at exactly the moment the status page
        # existed to explain it -- the page said "not ok" and nothing else.
        # Falling back to the exception's class name means a timeout reads as
        # "ReadTimeout" rather than blank.
        detail = str(e) or type(e).__name__
        return {
            "name": name,
            "ok": False,
            "response_ms": round((time.monotonic() - t0) * 1000),
            "detail": detail,
        }


async def _check_8004scan() -> str:
    key = os.environ.get("SCAN_8004_API_KEY")
    if not key:
        raise RuntimeError("SCAN_8004_API_KEY not set")
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            # host migration 2026-08-27, see adapters/bsc.py's module
            # docstring for the live verification.
            "https://api.8004scan.io/api/v1/agents",
            params={"chainId": 56, "offset": 0, "limit": 1},
            headers={"X-API-Key": key},
        )
        resp.raise_for_status()
        return f"HTTP {resp.status_code}"


async def _check_zerion() -> str:
    key = os.environ.get("ZERION_API_KEY")
    if not key:
        raise RuntimeError("ZERION_API_KEY not set")
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            "https://api.zerion.io/v1/chains/binance-smart-chain",
            auth=(key, ""),
        )
        resp.raise_for_status()
        return f"HTTP {resp.status_code}"


async def _check_coingecko() -> str:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get("https://api.coingecko.com/api/v3/ping")
        resp.raise_for_status()
        return f"HTTP {resp.status_code}"


async def _check_bsc_rpc() -> str:
    # Deliberately tests the PRIMARY specifically, never through
    # core/rpc.py's own rpc_post() fallback (added 2026-09-04), a status
    # page exists to report each provider's own health;
    # silently succeeding through a hidden backup would defeat the entire
    # point. See _check_bsc_rpc_backup below for the Infura row.
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            _bsc_rpc_url(),
            json={"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []},
        )
        resp.raise_for_status()
        body = resp.json()
        if "result" not in body:
            raise RuntimeError(f"unexpected RPC response: {body}")
        block = int(body["result"], 16)
        return f"block {block:,}"


async def _check_bsc_rpc_backup() -> str:
    # The Infura BSC endpoint, added 2026-09-04 as an automatic
    # backup transport (see core/rpc.py's own module docstring), reported
    # here as its OWN real, separate row for the same reason
    # _check_bsc_rpc above tests the primary in isolation: an honest
    # status page shows each provider's own health, not a
    # merged result that could hide one of them quietly failing.
    from core.rpc import get_bsc_fallback_rpc_url
    url = get_bsc_fallback_rpc_url()
    if not url:
        raise RuntimeError("INFURA_API_KEY not configured, no backup exists yet")
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            url,
            json={"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []},
        )
        resp.raise_for_status()
        body = resp.json()
        if "result" not in body:
            raise RuntimeError(f"unexpected RPC response: {body}")
        block = int(body["result"], 16)
        return f"block {block:,}"


async def _check_explainer_agent() -> str:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(_EXPLAINER_AGENT_PING_URL)
        resp.raise_for_status()
        return f"HTTP {resp.status_code}"


async def _check_mongodb() -> str:
    db = get_db()
    await db.command("ping")
    return "ping ok"


async def _check_termix() -> str:
    # Real, unauthenticated public API, no key needed. See
    # adapters/termix.py's own docstring for the full investigation
    # behind why this integration exists.
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            "https://platform-backend.prod.termix.live/api/v1/explorer/agents",
            params={"pageSize": 1},
        )
        resp.raise_for_status()
        return f"HTTP {resp.status_code}"


async def get_status(force_refresh: bool = False) -> dict:
    """Returns {checked_at, cache_age_seconds, services: [...]}. Cached for
    _CACHE_TTL_SECONDS so repeated visitors don't each burn a fresh
    hit against rate-limited keys (8004scan, Zerion)."""
    now = time.time()
    if not force_refresh and _cache["data"] and (now - _cache["checked_at"]) < _CACHE_TTL_SECONDS:
        return {
            "checked_at": _cache["checked_at"],
            "cache_age_seconds": round(now - _cache["checked_at"], 1),
            "services": _cache["data"],
            "discovery": _cache.get("discovery"),
        }

    results = await asyncio.gather(
        _timed("8004scan", _check_8004scan()),
        _timed("Zerion", _check_zerion()),
        _timed("CoinGecko", _check_coingecko()),
        _timed("BSC RPC", _check_bsc_rpc()),
        _timed("BSC RPC (Infura backup)", _check_bsc_rpc_backup()),
        _timed("explainer-agent", _check_explainer_agent()),
        _timed("MongoDB", _check_mongodb()),
        _timed("TermiX AACP", _check_termix()),
    )

    # Read separately from the reachability probes above, and never allowed
    # to fail the endpoint: this block exists to EXPLAIN a degraded state,
    # so it must not become a new way for the status page to break.
    try:
        discovery = await get_discovery_status()
    except Exception as e:  # pragma: no cover - defensive by intent
        discovery = {"ok": None, "stalled": None,
                     "detail": f"discovery status unavailable: {type(e).__name__}",
                     "sources": [], "unaffected": []}

    _cache["data"] = list(results)
    _cache["discovery"] = discovery
    _cache["checked_at"] = now
    return {"checked_at": now, "cache_age_seconds": 0, "services": results,
            "discovery": discovery}
