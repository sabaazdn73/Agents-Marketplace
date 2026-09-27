"""
GET /api/vaults and GET /api/vaults/{platform}/{address}.

Thin: validation, then core/vaults/service.py. Public like every /api/*
route. Serves only what the worker's collector stored; no chain read happens
in a request. There is no deposit route: deposits happen on each venue,
signed in the user's own wallet, and this service never holds funds.
"""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from core.json_encoding import json_default
from core.vaults import service
from core.vaults.store import get_store

router = APIRouter()
_ADDR = re.compile(r"^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$")
MAX_LIMIT = 100


def _json(body: dict, max_age: int = 300) -> Response:
    return Response(json.dumps(body, default=json_default, separators=(",", ":")),
                    media_type="application/json",
                    headers={"Cache-Control": f"public, max-age={max_age}"})


@router.get("/api/vaults")
async def vaults_list(platform: str | None = Query(None), limit: int = Query(24, ge=1, le=MAX_LIMIT),
                      offset: int = Query(0, ge=0, le=10_000)):
    if platform is not None and platform not in service.PLATFORM_KEYS:
        raise HTTPException(status_code=400, detail=f"platform must be one of {', '.join(service.PLATFORM_KEYS)}")
    body = await service.list_vaults(get_store(), platform, limit, offset)
    if body is None:
        raise HTTPException(status_code=503, detail="Vault reads have not been collected yet; the collector runs hourly.")
    return _json(body)


@router.get("/api/vaults/{platform}/{address}")
async def vault_detail(platform: str, address: str):
    if platform not in service.PLATFORM_KEYS or not _ADDR.match(address):
        raise HTTPException(status_code=400, detail="unknown platform or malformed address")
    body = await service.vault_detail(get_store(), platform, address)
    if body is None:
        raise HTTPException(status_code=404, detail="No listed vault at that address on that platform.")
    return _json(body)
