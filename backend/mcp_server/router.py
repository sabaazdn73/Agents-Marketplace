"""The mount point. One POST route, and the wiring that keeps this an adapter.

server.py calls build_router(providers) and includes the result. Nothing here
imports server.py, so the dependency runs one way: the transport composes the
adapter, the adapter never reaches back for the transport.

Mounted into the existing process rather than given a service of its own. The
expensive thing is not the protocol, it is the agents index at 21.53MB
resident, held as one cache. A second service means a second copy of that cache
in a second 512MiB container, and the first one is already being killed every
two hours. The cost of that choice is that an MCP caller can now contribute to
an OOM that takes the site down with it, which is what the gate in protocol.py
and the ceilings in envelope.py exist to bound. mcp/DESIGN.md section 8.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import APIRouter, Request, Response

from mcp_server import envelope, protocol, registry


@dataclass(frozen=True)
class Providers:
    """What the adapter cannot import for itself.

    Today: a reader for the agents index, which lives in server.py's cache
    because server.py owns its refresh.
    """
    agents_index: Callable[[], Any]


def build_router(providers: Providers) -> APIRouter:
    router = APIRouter()
    datasets = registry.build(providers)

    @router.post("/mcp")
    async def mcp_endpoint(request: Request) -> Response:
        """Streamable HTTP, the JSON half of it.

        No SSE stream and no session id. This server has no long-running work
        to report on and nothing to push: every call is one request and one
        answer, so a stream would be an open connection carrying nothing on a
        container that cannot afford connections carrying nothing.
        """
        try:
            body = await request.json()
        except (ValueError, UnicodeDecodeError):
            return Response(
                content=json.dumps({"jsonrpc": "2.0", "id": None,
                                    "error": {"code": -32700, "message": "Parse error"}}),
                media_type="application/json", status_code=400)

        # A batch is a list. Notifications inside it produce no reply, and a
        # batch of nothing but notifications produces no body at all.
        if isinstance(body, list):
            out = []
            for msg in body:
                reply = await protocol.handle(msg, datasets, request.headers)
                if reply is not None:
                    out.append(reply)
            if not out:
                return Response(status_code=202)
            return Response(content=envelope.encode_any(out), media_type="application/json")

        reply = await protocol.handle(body, datasets, request.headers)
        if reply is None:
            return Response(status_code=202)
        return Response(content=envelope.encode_any(reply), media_type="application/json")

    @router.get("/mcp")
    async def mcp_no_stream() -> Response:
        """The spec allows a client to open a GET for a server-initiated
        stream. This server has nothing to initiate, and saying so is better
        than holding a connection open to prove it."""
        return Response(
            content=json.dumps({
                "jsonrpc": "2.0", "id": None,
                "error": {"code": -32601,
                          "message": "No server-initiated stream. POST JSON-RPC to /mcp."}}),
            media_type="application/json", status_code=405)

    return router
