"""
te/router.py

GET /api/te/list, /api/te/underlying/{ticker} and /api/te/curve/{ticker}.
Thin: each route checks its parameters and hands over to
core/te/cost_views.py, which reads what the cost worker stored. Nothing is
computed from the chain in a request; a figure is at most 15 minutes old
and carries its block and time. Public, like every /api/* route.

Mounted from server.py with a single include line, so other tokenized-equity
routers (universe and controls, vaults) can be added beside it without
touching each other.
"""

from __future__ import annotations

import re

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from core.te.cost import SIZES
from core.te.cost_store import get_store
from core.te.cost_views import GROUPS, LIST_SIZES, curve_view, list_view, underlying_view

router = APIRouter()

_TICKER = re.compile(r"^[A-Z0-9.\-]{1,12}$")
_CACHE = {"Cache-Control": "public, max-age=60"}


def _bad(msg: str, **allowed) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": "bad_request", "reason": msg, **allowed})


def _answer(status: int, body: dict) -> JSONResponse:
    return JSONResponse(status_code=status, content=body, headers=_CACHE if status == 200 else None)


@router.get("/api/te/list")
async def te_list(type: str = "", group: str = "all", limit: int = 50, sort: str = "popular", offset: int = 0):
    if type not in ("", "stock", "etf"):
        return _bad("type must be stock or etf", allowed_type=["stock", "etf"])
    if group not in GROUPS:
        return _bad("unknown group", allowed_group=list(GROUPS))
    if sort not in LIST_SIZES:
        return _bad("unknown sort", allowed_sort={k: {"size": v} for k, v in LIST_SIZES.items()})
    if not 1 <= limit <= 100:
        return _bad("limit must be between 1 and 100")
    if not 0 <= offset <= 100_000:
        return _bad("offset must be between 0 and 100000")
    return _answer(*await list_view(get_store(), type_=type, group=group, limit=limit, sort=sort, offset=offset))


@router.get("/api/te/underlying/{ticker}")
async def te_underlying(ticker: str, size: int = 1000):
    t = ticker.upper()
    if not _TICKER.match(t):
        return _bad("not a ticker")
    if size not in SIZES:
        return _bad("size must be one of the measured stops", allowed_size=SIZES)
    return _answer(*await underlying_view(get_store(), t, size))


@router.get("/api/te/curve/{ticker}")
async def te_curve(ticker: str):
    t = ticker.upper()
    if not _TICKER.match(t):
        return _bad("not a ticker")
    return _answer(*await curve_view(get_store(), t))
