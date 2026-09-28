"""
GET /api/vaults and GET /api/vaults/{platform}/{address}.

Thin: validation, then core/vaults/service.py. Public like every /api/*
route. Serves only what the worker's collector stored; no chain read happens
in a request. There is no deposit route: deposits happen on each venue,
signed in the user's own wallet, and this service never holds funds.
"""

from __future__ import annotations

import json
import logging
import re

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response

from core.json_encoding import json_default
from core.vaults import service
from core.vaults.store import get_store

router = APIRouter()
log = logging.getLogger("vaults.router")
_ADDR = re.compile(r"^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$")
MAX_LIMIT = 100


def _err(status: int, error: str, reason: str) -> JSONResponse:
    """The te routes' error shape, {error, reason}; `detail` kept for older callers."""
    return JSONResponse(status_code=status, content={"error": error, "reason": reason, "detail": reason})


def _json(body: dict, max_age: int = 300) -> Response:
    return Response(json.dumps(body, default=json_default, separators=(",", ":")),
                    media_type="application/json",
                    headers={"Cache-Control": f"public, max-age={max_age}"})


def _store_down(e: Exception) -> JSONResponse | None:
    """A 503 with a reason when the vault store could not be reached (any
    driver error: server selection, connection, a network timeout), found
    within the store's short read timeout. Anything else is not the store and
    is left to raise."""
    try:
        from pymongo.errors import PyMongoError
    except Exception:  # noqa: BLE001  no driver installed: a file store
        return None
    if not isinstance(e, PyMongoError):
        return None
    log.warning("[vaults] store unreachable: %s", type(e).__name__)
    return _err(503, "store_unavailable",
                "The vault store could not be reached within 3 seconds; nothing is served rather than an "
                "old or partial answer. Try again in a minute.")


@router.get("/api/vaults")
async def vaults_list(platform: str | None = Query(None), limit: int = Query(24), offset: int = Query(0)):
    if platform is not None and platform not in service.PLATFORM_KEYS:
        return _err(400, "bad_request", f"platform must be one of {', '.join(service.PLATFORM_KEYS)}")
    if not 1 <= limit <= MAX_LIMIT or not 0 <= offset <= 10_000:
        return _err(400, "bad_request", f"limit must be 1 to {MAX_LIMIT} and offset 0 to 10000")
    try:
        body = await service.list_vaults(get_store(fast=True), platform, limit, offset)
    except Exception as e:  # noqa: BLE001  the store, see _store_down
        down = _store_down(e)
        if down is None:
            raise
        return down
    if body is None:
        # Nothing stored yet. Whether the collector runs is decided by the
        # WORKER's settings, which this web process cannot see (its own
        # HELIUS_API_KEY may be unset while the worker's is set), so the
        # answer says what is known: no pass has been stored.
        return _err(503, "not_collected_yet",
                    "No vault read has been stored yet: the collector runs on the worker, at most hourly, "
                    "once reads are switched on there.")
    return _json(body)


@router.get("/api/vaults/{platform}/{address}")
async def vault_detail(platform: str, address: str):
    if platform not in service.PLATFORM_KEYS or not _ADDR.match(address):
        return _err(400, "bad_request", "unknown platform or malformed address")
    try:
        body = await service.vault_detail(get_store(fast=True), platform, address)
    except Exception as e:  # noqa: BLE001  the store, see _store_down
        down = _store_down(e)
        if down is None:
            raise
        return down
    if body is None:
        return _err(404, "not_listed", "No listed vault at that address on that platform.")
    return _json(body)
