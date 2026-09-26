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
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Request, Response
from starlette.requests import ClientDisconnect

from core.env_caps import cap_from_env  # telegram_bot imports it from here too
from mcp_server import envelope, protocol, registry


@dataclass(frozen=True)
class Providers:
    """What the adapter cannot import for itself.

    Today, three things about the agents index, which lives in server.py's
    cache because server.py owns its refresh:

      agents_index         the index, or None if this process has not built it
      agents_index_as_of   when its data was last refreshed from the registry,
                           computed once when the index is built; agents.index
                           as_of. Unset, that as_of is null, never the call time
      ensure_agents_index  builds the index into the same cache if it is not
                           there yet, so an MCP caller on a fresh process does
                           not depend on a site visit having come first
    """
    agents_index: Callable[[], Any]
    agents_index_as_of: Callable[[], Any] | None = None
    ensure_agents_index: Callable[[], Awaitable[Any]] | None = None


# The body a client that speaks only the stateless revision needs to see
# before it falls back. The spec's rule for a dual-era client: on HTTP 400,
# fall back to initialize if the body is empty or is not a recognised modern
# JSON-RPC error. A JSON-RPC -32601 inside an HTTP 200, which is what this
# server answered server/discover with, is neither a 400 nor a fallback
# signal, so such a client might never connect. This is deliberately not a
# JSON-RPC object at all.
_INITIALIZE_FIRST = {"error": "First request must be an initialize request"}


def _bad_request(body: dict) -> Response:
    return Response(content=json.dumps(body), media_type="application/json",
                    status_code=400)


def _meta_version(msg: Any) -> str | None:
    if not isinstance(msg, dict):
        return None
    params = msg.get("params")
    meta = params.get("_meta") if isinstance(params, dict) else None
    v = meta.get("io.modelcontextprotocol/protocolVersion") if isinstance(meta, dict) else None
    return v if isinstance(v, str) else None


def _version_refusal(headers, messages: list) -> Response | None:
    """The protocol version checks, before anything is dispatched.

    Three cases and one exemption.

    server/discover is refused with a 400 whatever else the request says. It
    exists only in the stateless revision, so a client sending it is probing
    for that revision, and the 400 is what tells it to use initialize.

    A request that declares 2026-07-28, in the header or in _meta, and is not
    itself an initialize, gets the same 400 for the same reason. This server
    never negotiates that version, so a request carrying it has not been
    through initialize with this server.

    A header naming any other version this server does not accept gets a 400
    that says which versions it does. An absent header is allowed and read as
    2025-03-26, as the spec permits; some clients send tools/call with no
    session and no header, and depend on it being answered without state.

    There are no sessions, so there is no negotiated version to compare a
    header with. Any version in protocol.HEADER_VERSIONS is accepted, which is
    the spec's rule where there is no session to hold a request to.

    Every refusal is logged, with the method, the header and the User-Agent,
    on the same doubling schedule as Origin.

    The exemption: initialize itself. It negotiates the version in its body,
    and a client falling back from the stateless revision may still carry
    that revision's header on the initialize it falls back with. Refusing it
    there would refuse the fallback this exists to allow.
    """
    methods = [m.get("method") for m in messages if isinstance(m, dict)]
    method = methods[0] if methods else None
    header = (headers.get("mcp-protocol-version") or "").strip()

    def refuse(why: str, body: dict) -> Response:
        protocol.note_version_refusal(method, header or None,
                                      headers.get("user-agent"), why)
        return _bad_request(body)

    if "server/discover" in methods:
        return refuse("server/discover", _INITIALIZE_FIRST)
    if "initialize" in methods:
        return None

    declared = [header] if header else []
    declared += [v for v in (_meta_version(m) for m in messages) if v]
    if protocol.MODERN_VERSION in declared:
        return refuse("modern version without initialize", _INITIALIZE_FIRST)
    if header and header not in protocol.HEADER_VERSIONS:
        return refuse("unsupported header", {
            "error": f"Unsupported MCP-Protocol-Version: {header[:40]}",
            "supported": sorted(protocol.HEADER_VERSIONS, reverse=True)})
    return None


_UNPARSEABLE = object()


# ── the body, read under a cap before anything parses it ─────────────────────
#
# request.json() reads the whole body and then parses it, whatever its size.
# Measured 2026-09-25 with tracemalloc: parsing a 10 MB body of `[{},{},...]`
# peaked at 250.8 MB, so two of them at once could take the 512 MiB container
# down before any limit in this module saw a message. Every real MCP message
# here is a few hundred bytes; a full batch of ten is a few kilobytes. So the
# body is read by hand with a running count and abandoned past the cap, and
# only a body under the cap is parsed. At the 64 KB cap the worst shape
# measured, the same `[{},{},...]`, peaks at 1.66 MB; scripts/mcp_selfcheck.py
# measures it on every run.
#
# The whole app also sits behind server.py's BodyCap middleware at 256 KB. This
# cap is the tighter one for this route and still applies inside it: a body
# between 64 KB and 256 KB is refused here, in JSON-RPC's shape.
MAX_BODY_BYTES = cap_from_env("MCP_MAX_BODY_BYTES", 65_536)


class BodyTooLarge(Exception):
    pass


class ClientGone(ClientDisconnect):
    """The client disconnected before its body was complete.

    A subclass of Starlette's ClientDisconnect so that a caller which does not
    catch it (the Telegram webhook) still hands the app-wide middleware an
    exception it recognises and ends quietly, rather than reaching uvicorn as
    "Exception in ASGI application" with a traceback. It has already been
    logged once here, and the scope says so, so the middleware does not log
    it again.
    """


async def read_body_capped(request: Request, cap: int) -> bytes:
    """The request body, or BodyTooLarge before more than `cap` bytes are held.

    A declared Content-Length over the cap is refused without reading
    anything. A body with no length, or a chunked one, is read chunk by chunk
    and abandoned the moment the running count passes the cap, so what is
    held never exceeds the cap plus one chunk. The count is kept even when a
    length was declared, since the header is the caller's claim.
    """
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > cap:
                raise BodyTooLarge
        except ValueError:
            raise BodyTooLarge from None
    buf = bytearray()
    try:
        async for chunk in request.stream():
            buf += chunk
            if len(buf) > cap:
                raise BodyTooLarge
    except ClientDisconnect:
        # Nobody is left to answer. One line, with the path and the count and
        # nothing from the body, and no traceback.
        print(f"[body] client disconnected mid-body: {request.method} "
              f"{request.url.path} after {len(buf)} bytes", flush=True)
        request.scope["body_cap.disconnect_logged"] = True
        raise ClientGone() from None
    return bytes(buf)


def too_large(cap: int) -> Response:
    return Response(
        content=json.dumps({"jsonrpc": "2.0", "id": None, "error": {
            "code": -32600,
            "message": f"The request body is over {cap} bytes, which is more "
                       f"than any message this server answers needs."}}),
        media_type="application/json", status_code=413)


def _is_response(msg: Any) -> bool:
    """A JSON-RPC response: an id and a result or error, and no method."""
    return (isinstance(msg, dict) and "method" not in msg and "id" in msg
            and ("result" in msg or "error" in msg))

# The largest batch answered. Each message in it is charged and gated like a
# request of its own, so the size bounds the length of one HTTP exchange, not
# the load, which the per-message charge already bounds.
MAX_BATCH = 10

# Revisions whose transport allows a batch. 2025-03-26 says an implementation
# MUST support receiving them; 2025-06-18 removed batching. An absent header
# is read as 2025-03-26, as the spec permits.
_BATCH_VERSIONS = {"2025-03-26", "2024-11-05"}


def _rate_refusal(req_id) -> Response | None:
    """One token, or the 429 that says when to retry. None when admitted,
    and always None when MCP_RATE_LIMIT_PER_MINUTE is 0 and RATE is off."""
    cap = protocol.RATE
    if cap is None or cap.take():
        return None
    return Response(
        content=envelope.encode_any(protocol.rate_limited(req_id, cap)),
        media_type="application/json", status_code=429,
        headers={"Retry-After": str(cap.retry_after())})


def _invalid(message: str) -> Response:
    return Response(
        content=json.dumps({"jsonrpc": "2.0", "id": None,
                            "error": {"code": -32600, "message": message}}),
        media_type="application/json", status_code=400)


async def answer_batch(body: list, datasets: dict, headers) -> Response:
    """A JSON-RPC batch, bounded.

    WHY BATCHES ARE ANSWERED AT ALL. This server still negotiates 2025-03-26,
    which says an implementation MUST support receiving batches, and a
    request with no version header is read as 2025-03-26. So a batch is
    answered when the request's version is 2025-03-26 or earlier, and refused
    under 2025-06-18 and later, which removed batching.

    WHAT A BATCH COSTS, stated as it is:

      one rate token per message, so ten calls cost ten tokens and not one
      the messages run one after another inside this one request, each
        taking and releasing the one-call gate through protocol.handle. In
        practice that means a batch holds the gate for all its calls: another
        caller's request cannot reach the gate between two of them, because
        nothing here waits for it, and there is no queue to wait in. That is
        why the size is bounded: a batch can hold the gate for at most
        MAX_BATCH calls in a row, and no longer
      at most MAX_BATCH messages, and initialize never among them: 2025-03-26
        says initialize MUST NOT be part of a batch

    Notifications and responses take no entry, and a batch with nothing that
    needs an answer is a 202.
    """
    def refuse(message: str) -> Response:
        # A refused batch still costs one token, so refusals cannot be sent
        # for free.
        return _rate_refusal(None) or _invalid(message)

    header = (headers.get("mcp-protocol-version") or "").strip()
    if header and header not in _BATCH_VERSIONS:
        return refuse(
            f"Batches are not accepted under MCP-Protocol-Version {header[:40]}. "
            f"Batching was removed in 2025-06-18: send one JSON-RPC message "
            f"per POST.")
    if not body:
        return refuse("An empty batch is not a request.")
    if len(body) > MAX_BATCH:
        return refuse(f"A batch holds at most {MAX_BATCH} messages; this "
                        f"one holds {len(body)}. Split it, or send one "
                        f"message per POST.")
    if any(isinstance(m, dict) and m.get("method") == "initialize" for m in body):
        # Refused before the version check below, which exempts a request
        # holding an initialize; inside a batch that exemption would have
        # waved the other members through unchecked.
        return refuse("initialize must be sent on its own, not in a batch "
                      "(MCP 2025-03-26, lifecycle).")
    refusal = _version_refusal(headers, body)
    if refusal is not None:
        return _rate_refusal(None) or refusal

    out = []
    retry_after = None
    for msg in body:
        cap = protocol.RATE
        if cap is not None and not cap.take():
            retry_after = cap.retry_after()
            if (isinstance(msg, dict) and msg.get("id") is not None
                    and not _is_response(msg)):
                out.append(protocol.rate_limited(msg.get("id"), cap))
            continue
        if _is_response(msg):
            # Charged, answered with nothing.
            continue
        reply = await protocol.handle(msg, datasets, headers)
        if reply is not None:
            out.append(reply)
    extra = {"Retry-After": str(retry_after)} if retry_after else None
    if not out:
        return Response(status_code=202, headers=extra)
    return Response(content=envelope.encode_any(out), media_type="application/json",
                    headers=extra)


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
        # Counted, never refused, and read for nothing else. See
        # protocol.note_origin for why it is not enforced yet.
        protocol.note_origin(request.headers.get("origin"))

        try:
            raw = await read_body_capped(request, MAX_BODY_BYTES)
        except BodyTooLarge:
            # Charged, so an oversized flood is not free, and refused before
            # a single byte past the cap is held.
            return _rate_refusal(None) or too_large(MAX_BODY_BYTES)
        except ClientGone:
            # Already logged. The client is gone, so this reply goes nowhere;
            # it exists so the route returns rather than raises.
            return Response(status_code=400)
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeDecodeError, RecursionError):
            # RecursionError as well: a deeply nested array is valid JSON that
            # the parser cannot finish, and it was a 500.
            body = _UNPARSEABLE
        del raw

        if body is _UNPARSEABLE:
            # Charged like any other message: a malformed body costs a read
            # and a parse as surely as a good one.
            limited = _rate_refusal(None)
            if limited is not None:
                return limited
            return Response(
                content=json.dumps({"jsonrpc": "2.0", "id": None,
                                    "error": {"code": -32700, "message": "Parse error"}}),
                media_type="application/json", status_code=400)

        if isinstance(body, list):
            return await answer_batch(body, datasets, request.headers)

        # The per-minute cap, one token per message. Global: see
        # protocol.RateCap for why no address is read here.
        limited = _rate_refusal(body.get("id") if isinstance(body, dict) else None)
        if limited is not None:
            return limited

        # A response from the client, to a request this server never sends.
        # 2025-03-26 transport, step 4: accepted, 202, no body.
        if _is_response(body):
            return Response(status_code=202)

        refusal = _version_refusal(request.headers, [body])
        if refusal is not None:
            return refusal

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
