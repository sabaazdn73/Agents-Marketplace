"""
server.py

The real backend the frontend talks to. One endpoint for now:
GET /api/agents — real, cross-referenced, honestly-incomplete-where-
it-should-be agent data, no mock arrays.

Run locally: uvicorn server:app --reload --port 8000
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from core.aggregate import get_marketplace_agents_as_dicts

load_dotenv()

app = FastAPI(title="Agents Marketplace API")

# Wide open for local dev, tighten this (specific origins only) before
# any real deployment, per this project's security rules.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


import time

_cache: dict = {"data": None, "fetched_at": 0}
_CACHE_TTL_SECONDS = 30 * 60  # 30 minutes: a full refresh (~20-40 real API
# calls across both networks) stays well inside the free_api 1000/day
# budget even refreshed every 30 min (48 refreshes/day max), while
# keeping the marketplace reasonably fresh, not stale for hours.


@app.get("/api/agents")
async def agents(force_refresh: bool = False):
    now = time.time()
    is_stale = (now - _cache["fetched_at"]) > _CACHE_TTL_SECONDS
    if _cache["data"] is None or is_stale or force_refresh:
        api_key = os.environ.get("SCAN_8004_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="SCAN_8004_API_KEY is not set. The /api/v1/agents endpoint "
                       "requires a real key, get one at 8004scan.io/developers.",
            )
        try:
            fresh_data = await get_marketplace_agents_as_dicts(api_key=api_key)
            # FIXED 8 Aug 2026, confirmed live: a successful-but-empty
            # refresh (transient network hiccup, cold-start timing, a
            # single failed page mid-pagination) was overwriting a
            # perfectly good previous cache with an empty list, then
            # serving that empty list for a full 30 minutes with no
            # visible error, exactly what happened in production. An
            # empty result now only replaces the cache if there was no
            # real previous cache to protect, otherwise it's treated
            # as suspect and the old, real data keeps serving while
            # this gets logged for investigation.
            if not fresh_data and _cache["data"]:
                print(f"[server] Refresh returned 0 agents despite {len(_cache['data'])} "
                      f"cached previously, treating as a transient failure, keeping the old cache.")
            else:
                _cache["data"] = fresh_data
                _cache["fetched_at"] = now
        except Exception as e:
            if _cache["data"] is not None:
                print(f"[server] Refresh failed, serving stale cache: {e}")
            else:
                raise HTTPException(status_code=502, detail=f"Failed to fetch real agent data: {e}")
    return {
        "agents": _cache["data"] or [],
        "cached_at": _cache["fetched_at"],
        "cache_age_seconds": int(now - _cache["fetched_at"]),
    }


@app.get("/api/health")
async def health():
    return {"ok": True}
