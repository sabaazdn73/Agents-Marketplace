"""MCP over JSON-RPC, and the gate in front of it.

WHY THE PROTOCOL IS HAND WRITTEN
--------------------------------
This server answers five methods: initialize, notifications/initialized, ping,
tools/list and tools/call. An SDK for that is a dependency in a container that
is OOM killed roughly every two hours, to save writing a switch statement. The
project already made this call once for routing on the frontend and the
reasoning is the same: no library for a single small case.

THE GATE
--------
One call in flight at a time, process wide, and the second caller is refused
rather than queued.

Refused, not queued, because a queue lies. A model that waits does not learn it
is being throttled; it learns that Tnega is slow, and the usual response to
slow is to try again, which is how a queue becomes the load it was meant to
prevent. A refusal with a reason is information the caller can act on.

Process wide rather than per connection, because the thing being protected is
one container with a 512MiB cap that is already dying every two hours. A limit
that lets ten connections each run one call protects nothing that matters.

The seam for keys is `caller()`. It returns anonymous today, because there is
no key system on the REST API to inherit: every /api/* route is public by
design, the one exception being the admin batch secret. If keys ever arrive
they arrive in that function, and no tool signature changes.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass

from mcp_server import envelope, tools

PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_VERSIONS = {"2025-06-18", "2025-03-26", "2024-11-05"}
SERVER_INFO = {"name": "tnega", "version": "0.1.0"}

# JSON-RPC reserved range ends at -32000. This is ours.
BUSY_CODE = -32029


@dataclass(frozen=True)
class Caller:
    """Who is calling. Anonymous, always, today.

    This exists so that the day a key system is added, it is added here and the
    six tools do not change shape.
    """
    id: str = "anonymous"
    tier: str = "public"


def caller(headers) -> Caller:
    return Caller()


class InFlight:
    """One at a time, refused on contention, with the wait time reported."""

    def __init__(self) -> None:
        self.busy = False
        self.started_at = 0.0
        self.refused = 0

    def acquire(self) -> bool:
        if self.busy:
            self.refused += 1
            return False
        self.busy = True
        self.started_at = time.time()
        return True

    def release(self) -> None:
        self.busy = False
        self.started_at = 0.0

    def held_for(self) -> float:
        return time.time() - self.started_at if self.busy else 0.0


GATE = InFlight()


def _result(req_id, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _error(req_id, code: int, message: str, data: dict | None = None) -> dict:
    err = {"code": code, "message": message}
    if data:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": req_id, "error": err}


def _tool_result(text: str, is_error: bool = False) -> dict:
    """A tool result carries the same answer twice, on purpose.

    `content` is what every client can read. `structuredContent` is the same
    payload as an object for clients that support it, so a model does not have
    to parse a string to get at a field it was going to use as data.

    Both halves are decoded from the one encoded body rather than assembled
    separately. The first version passed the raw payload as the structured
    half, and the raw payload holds what the services return: a Decimal out of
    Cockroach took the whole response to a 500, because the envelope's encoder
    knows how to write one and the transport's json.dumps does not. Encoding
    once and reading it back means the two halves cannot disagree and cannot
    carry a type the wire has no room for.
    """
    out = {"content": [{"type": "text", "text": text}],
           "structuredContent": json.loads(text)}
    if is_error:
        out["isError"] = True
    return out


async def handle(message: dict, datasets: dict, headers=None) -> dict | None:
    """One JSON-RPC message. Returns None for notifications, which take no reply."""
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return _error(None, -32600, "Not a JSON-RPC 2.0 message")

    method = message.get("method")
    req_id = message.get("id")
    params = message.get("params") or {}

    if method is None:
        return _error(req_id, -32600, "No method")

    # Notifications carry no id and get no response, including the
    # initialized handshake and cancellation notices.
    if req_id is None:
        return None

    if method == "initialize":
        asked = params.get("protocolVersion")
        version = asked if asked in SUPPORTED_VERSIONS else PROTOCOL_VERSION
        return _result(req_id, {
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions":
                "Measurements from Tnega: agents across five chains, ERC-8183 "
                "jobs, Hyperliquid post-only rejection, budget escrow, and the "
                "chain views. Start with tnega_catalogue. Every response carries "
                "its coverage, and a measurement with nothing behind it returns "
                "a withheld_reason rather than a zero. One call at a time: a "
                "second concurrent call is refused, not queued.",
        })

    if method == "ping":
        return _result(req_id, {})

    if method == "tools/list":
        return _result(req_id, {"tools": tools.manifest()})

    if method == "tools/call":
        name = params.get("name")
        spec = tools.BY_NAME.get(name)
        if spec is None:
            return _error(req_id, -32602, f"No tool called {name!r}",
                          {"tools": sorted(tools.BY_NAME)})

        if not GATE.acquire():
            # Loudly. A refusal names the limit, says how long the call ahead
            # has been running, and says to retry rather than to wait.
            return _error(
                req_id, BUSY_CODE,
                "Tnega handles one call at a time and is busy. This is a "
                "refusal, not a queue: retry in a moment rather than waiting.",
                {"limit": "1 concurrent call", "reason": "server_busy",
                 "in_flight_for_seconds": round(GATE.held_for(), 2),
                 "refused_so_far": GATE.refused})
        try:
            payload = await spec["handler"](datasets, params.get("arguments") or {})
            text, _ = envelope.enforce_ceiling(name, payload)
            return _result(req_id, _tool_result(text))
        except Exception as e:  # noqa: BLE001
            # A failure is a tool result rather than a protocol error, so the
            # model reads it as an answer it can act on. The envelope is the
            # same one every other answer uses, with the reason in the field
            # that exists for reasons.
            failed = envelope.withheld(
                measured=f"{name} did not complete",
                coverage={"partial": True},
                reason="tool_failed",
                explanation=f"{type(e).__name__}: {str(e)[:160]}")
            text, _ = envelope.enforce_ceiling(name, failed)
            return _result(req_id, _tool_result(text, is_error=True))
        finally:
            GATE.release()

    return _error(req_id, -32601, f"Method not supported: {method}",
                  {"supported": ["initialize", "ping", "tools/list", "tools/call"]})
