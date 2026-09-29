"""
te/sign_router.py

GET /api/sign/{id} and POST /api/sign/{id}/done: what the signing page
(tnega.app/sign/<id>) reads about an order prepared through MCP, and how it
says the order was sent.
Thin: the id is decoded and checked in core/te/sign_link.py, and the order is
enriched in core/te/prepare.py (order_view, mark_done). No quote is served
here: the page asks LI.FI from the browser, as the site's buy panel does.
Nothing is stored; "used" lives in this process's memory (sign_link.py says
what that means after a restart). Public, like every /api/* route, and rate
limited and CORS-wrapped by the same middleware.

WHAT /done CAN DO. It marks a link used, meaning a transaction hash was
reported for it (unverified), so the page does not offer the same order
twice. An expired link answers 410 and is not marked. That is all: it takes no signature and no key, moves no funds,
and the transaction hash it is given is checked only for its shape. Anyone
holding a link can mark it used, which at worst makes that page say "used"
and the user asks for a new order.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from core.te import sign_link
from core.te.prepare import mark_done, order_view

router = APIRouter()


_said = {"key": False}


@router.on_event("startup")
async def _say_key_source() -> None:
    # Where the link-signing key comes from, once, so a deploy shows whether
    # links survive a restart. The source's name only, never the key. Once:
    # an included router's startup handler can run twice in one process.
    if not _said["key"]:
        _said["key"] = True
        print(f"[sign] link key: {sign_link.key_source()}", flush=True)

_NO_STORE = {"Cache-Control": "no-store"}
DONE_MAX_BYTES = 512


@router.get("/api/sign/{link_id}")
async def sign_order(link_id: str):
    try:
        status, body = await order_view(link_id)
    except Exception as e:  # noqa: BLE001  the universe or the store, not the order
        return JSONResponse(status_code=503, headers=_NO_STORE, content={
            "reason": "unavailable", "detail": f"the order could not be read just now ({type(e).__name__})",
            "about": "this server, not the order"})
    return JSONResponse(status_code=status, content=body, headers=_NO_STORE)


@router.post("/api/sign/{link_id}/done")
async def sign_done(link_id: str, request: Request):
    raw = await request.body()
    if len(raw) > DONE_MAX_BYTES:
        return JSONResponse(status_code=413, content={"reason": "too_large", "limit_bytes": DONE_MAX_BYTES})
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        body = None
    if not isinstance(body, dict):
        return JSONResponse(status_code=400, content={"reason": "bad_body", "explanation": 'send {"tx": "0x..."}'})
    status, out = mark_done(link_id, body.get("tx"))
    if status == 204:
        return Response(status_code=204, headers=_NO_STORE)
    return JSONResponse(status_code=status, content=out, headers=_NO_STORE)
