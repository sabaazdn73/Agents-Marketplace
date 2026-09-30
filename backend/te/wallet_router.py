"""
te/wallet_router.py

POST /api/wallet/holdings: the tokenized stocks and ETFs one wallet holds on
the six buy chains, for the Dashboard. Thin: the body is read and checked
here, and core/te/wallet_view.py does the rest (the read is
core/te/holdings.py's, the one behind the MCP tool tnega_wallet_holdings).

The wallet is in the POST body, as for /api/wallet/habits, because a URL,
query string included, is written to access logs. The body is read by hand
with a byte cap and every malformed body gets one fixed 400 that repeats
nothing. The address is not echoed in any answer. Public, rate limited and
CORS-wrapped by the same middleware as every /api/* route; the route's own
gate (wallet_view.py) answers 429 with Retry-After when it cannot admit a
new read.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from core.safe_errors import describe
from core.te import wallet_view

router = APIRouter()

_NO_STORE = {"Cache-Control": "no-store"}
_BAD_BODY = (
    'Expected a JSON body of exactly {"address": "0x..."}, where the value is '
    "a 0x-prefixed 40 character hex address."
)


def _err(status: int, error: str, detail: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, headers=_NO_STORE,
                        content={"error": error, "detail": detail, **extra})


def _price_store():
    """The cost store, or None when it cannot even be opened (values are then
    withheld, the balances still served)."""
    try:
        from core.te.cost_store import get_store
        return get_store()
    except Exception:  # noqa: BLE001
        return None


@router.post("/api/wallet/holdings")
async def wallet_holdings(request: Request):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > wallet_view.MAX_BODY_BYTES:
            return _err(400, "bad_request", _BAD_BODY)
    address = wallet_view.parse_body(bytes(raw))
    if address is None:
        return _err(400, "bad_request", _BAD_BODY)
    try:
        body = await wallet_view.wallet_holdings(address, _price_store())
    except wallet_view.Busy as b:
        return JSONResponse(status_code=429,
                            headers={"Retry-After": str(b.retry_after), **_NO_STORE},
                            content={"error": "busy", "detail": b.detail, "reason": b.reason,
                                     "retry_after_seconds": b.retry_after})
    except asyncio.TimeoutError:
        return _err(504, "timeout", "The chain reads did not finish in time. That is about the call, not the address.")
    except Exception as e:  # noqa: BLE001  describe(): the class name only
        return _err(500, "unavailable", f"Couldn't read holdings right now: {describe(e)}")
    return JSONResponse(content=body, headers=_NO_STORE)
