"""
te/baskets_router.py

GET /api/baskets/curated, /api/baskets/evaluate (legs= or SPEC C.3's b=) and
/api/baskets/{code}.
Thin: each route checks its query and hands over to core/te/baskets.py,
which prices baskets from what the cost worker stored. No chain call and no
third-party call in a request. Public, like every /api/* route.

A basket someone builds is never stored: the link carries it and the browser
decodes it; /evaluate prices the legs it is given and forgets them.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from core.te import baskets as core
from core.te.cost import SIZES
from core.te.cost_store import get_store

router = APIRouter()

_CACHE = {"Cache-Control": "public, max-age=60"}


def _bad(reason: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": "bad_request", "reason": reason, **extra})


def _size(raw: str) -> tuple[int | None, JSONResponse | None]:
    try:
        return core.parse_size(raw), None
    except core.BasketError as e:
        return None, _bad(str(e), allowed_size=SIZES)


async def _run(coro) -> JSONResponse:
    try:
        body = await coro
    except core.BasketError as e:
        return _bad(str(e))
    except core.NotMeasured as e:
        return JSONResponse(status_code=503, content={"error": "not_measured", "reason": str(e),
                                                      "about": "this server's cost store, not any basket"})
    except Exception as e:  # noqa: BLE001  the store is unreachable: a fact about this call
        return JSONResponse(status_code=503, content={"error": "store_unavailable",
                                                      "reason": f"cost store read failed ({type(e).__name__})",
                                                      "about": "this server's cost store, not any basket"})
    if body is None:
        return JSONResponse(status_code=404, content={"error": "not_found", "reason": "no curated basket has this code"})
    return JSONResponse(body, headers=_CACHE)


@router.get("/api/baskets/curated")
async def baskets_curated(size: str = "1000"):
    n, err = _size(size)
    return err or await _run(core.curated_list(get_store(), n))


@router.get("/api/baskets/evaluate")
async def baskets_evaluate(legs: str | None = None, b: str | None = None, size: str = "1000"):
    n, err = _size(size)
    if err:
        return err
    rule = (f"either legs=TICKER:weight_bps,... or b=<base64url JSON {{v:1, legs:[{{t, k?, w}}]}}>; "
            f"1 to {core.MAX_LEGS} legs, whole-number weights summing to {core.BPS}")
    if (legs is None) == (b is None):
        return _bad("give exactly one of legs and b", rule=rule)
    try:
        parsed = core.parse_legs(legs) if legs is not None else core.parse_b(b)
    except core.BasketError as e:
        return _bad(str(e), rule=rule)
    return await _run(core.evaluate(get_store(), parsed, n))


@router.get("/api/baskets/{code}")
async def baskets_detail(code: str, size: str = "1000"):
    n, err = _size(size)
    if err:
        return err
    if not core.CODE.fullmatch(code):
        return JSONResponse(status_code=404, content={"error": "not_found", "reason": "no curated basket has this code"})
    return await _run(core.curated_detail(get_store(), code, n))
