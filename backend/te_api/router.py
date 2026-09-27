"""The tokenized-equity routes: GET /api/te/summary, /api/te/search and
/api/te/controls (SPEC B.7). Public, like every /api/* route.

Thin by rule: each route validates its query, gets the universe from
core/te/universe.py (loaded once, off the event loop, with a timeout) and
returns what core/te computed. The answers are static between rebuilds of the
data file, so they carry a five-minute public cache header and are memoised
in the Universe object.

A missing or unreadable data file answers 503 with the reason: that is a fact
about this process, not about any token, and the response says so.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from core.te import controls as te_controls
from core.te import cost_store as te_cost_store
from core.te import cost_views as te_cost_views
from core.te import search as te_search
from core.te.universe import CHAINS, ISSUER_NAMES, UniverseUnavailable, load_universe

LOAD_TIMEOUT_S = 20.0
CACHE = "public, max-age=300"


async def _universe():
    return await asyncio.wait_for(asyncio.to_thread(load_universe), timeout=LOAD_TIMEOUT_S)



def _ok(body: dict) -> JSONResponse:
    return JSONResponse(body, headers={"Cache-Control": CACHE})


def _unavailable(e: Exception) -> JSONResponse:
    reason = str(e) if isinstance(e, UniverseUnavailable) else f"universe load did not finish ({type(e).__name__})"
    return JSONResponse(status_code=503, content={
        "error": "universe_unavailable",
        "reason": reason,
        "about": "this server's copy of the data file, not any token",
    })


def build_router() -> APIRouter:
    router = APIRouter()

    @router.on_event("startup")
    async def _preload() -> None:
        # Warm the universe in the background so the first visitor does not
        # wait for the parse. Never awaited here: a startup that blocks on
        # it would hold the port closed.
        async def warm():
            try:
                await _universe()
            except Exception as e:  # noqa: BLE001
                print(f"[te] universe not preloaded ({type(e).__name__}: {e})", flush=True)
        asyncio.get_running_loop().create_task(warm())

    @router.get("/api/te/summary")
    async def te_summary():
        try:
            u = await _universe()
        except Exception as e:  # noqa: BLE001
            return _unavailable(e)
        body = dict(u.summary())
        # The cost engine's count beside the universe's pool count:
        # versions_with_pool means a pool was found; cost.versions_with_cost
        # means a $1,000 buy was measured on a pool that passed the venue checks.
        try:
            body["cost"] = await te_cost_views.measured_counts(te_cost_store.get_store()) or {
                "versions_with_cost": None, "reason": "the cost worker has not written a count yet"}
        except Exception as e:  # noqa: BLE001  the store, not any token
            body["cost"] = {"versions_with_cost": None, "reason": f"cost store unavailable ({type(e).__name__})"}
        return _ok(body)

    @router.get("/api/te/search")
    async def te_search_route(q: str = Query("", max_length=te_search.MAX_Q * 2),
                              limit: int = Query(te_search.DEFAULT_LIMIT, ge=1, le=te_search.MAX_LIMIT)):
        try:
            u = await _universe()
        except Exception as e:  # noqa: BLE001
            return _unavailable(e)
        return _ok(await asyncio.to_thread(te_search.search, u, q, limit))

    @router.get("/api/te/controls")
    async def te_controls_route(by: str = Query("issuer"), issuer: str | None = None,
                                chain: str | None = None, key: str | None = None):
        if by not in ("issuer", "chain", "key"):
            return JSONResponse(status_code=400, content={"error": "bad_request", "reason": "by must be issuer, chain or key"})
        if issuer is not None and issuer not in ISSUER_NAMES:
            return JSONResponse(status_code=400, content={"error": "bad_request",
                                                          "reason": f"issuer must be one of {sorted(ISSUER_NAMES)}"})
        if chain is not None and chain not in CHAINS:
            return JSONResponse(status_code=400, content={"error": "bad_request",
                                                          "reason": f"chain must be one of {sorted(CHAINS)}"})
        if by == "key" and not key:
            return JSONResponse(status_code=400, content={"error": "bad_request",
                                                          "reason": "by=key needs key=<chainId>/<address> or solana/<mint>"})
        try:
            u = await _universe()
        except Exception as e:  # noqa: BLE001
            return _unavailable(e)
        if by == "key":
            body = te_controls.by_key(u, key)
            if body is None:
                return JSONResponse(status_code=404, content={"error": "not_found",
                                                              "reason": "no token in the universe has this key"})
            return _ok(body)
        # The first build of a view walks every listed token (about 0.1 s);
        # it runs off the event loop and is memoised after.
        # Filters apply within the view asked for; the view never changes.
        if by == "chain":
            return _ok(await asyncio.to_thread(te_controls.by_chain, u, issuer, chain))
        return _ok(await asyncio.to_thread(te_controls.by_issuer, u, issuer, chain))

    return router
