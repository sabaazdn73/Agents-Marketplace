"""MCP over JSON-RPC, and the gate in front of it.

WHY THE PROTOCOL IS HAND WRITTEN
--------------------------------
This server answers five methods: initialize, notifications/initialized, ping,
tools/list and tools/call. server/discover, from the stateless 2026-07-28
revision, is answered by router.py with the HTTP 400 that tells a client to
fall back to initialize. An SDK for that is a dependency in a container that
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
import os
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

from mcp_server import envelope, tools

PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_VERSIONS = {"2025-06-18", "2025-03-26", "2024-11-05"}
SERVER_INFO = {"name": "tnega", "version": "0.1.0"}

# What the MCP-Protocol-Version header may say on a request after initialize.
#
# There are no sessions here, so there is no negotiated version to hold a
# request to. The rule is therefore the one the spec gives for that case: any
# version this server supports is accepted, anything else is a 400.
#
# 2025-11-25 is also accepted in the header, by the owner's decision. A client
# that asks for it at initialize is still answered 2025-06-18, which the spec
# permits, because that revision's transport requires a 403 on a present and
# invalid Origin and this server only counts such requests (see note_origin).
# Accepting the header keeps a client working if it sends its own revision
# after that answer; enforcing Origin is the change that would let 2025-11-25
# be negotiated outright.
HEADER_VERSIONS = frozenset(SUPPORTED_VERSIONS | {"2025-11-25"})

# The stateless revision, which this server does not speak. A client that
# declares it opens with server/discover or sends requests with no
# initialize, and falls back to initialize only on an HTTP 400 whose body is
# not a modern JSON-RPC error. router.py answers it that way.
MODERN_VERSION = "2026-07-28"

# JSON-RPC reserved range ends at -32000. This is ours. It covers both ways
# this server turns a caller away, the one-call gate and the per-minute cap,
# and data.reason says which.
BUSY_CODE = -32029

INSTRUCTIONS = (
    "Measurements from Tnega, read only. agents.index is ERC-8004 agents on "
    "BNB Chain; chains.agents is agents on Ethereum, Arbitrum, Robinhood "
    "Chain, Solana and Monad; jobs.erc8183 is ERC-8183 jobs on BNB Chain; "
    "budgets.escrow is spending budgets; hyperliquid.post_only is post-only "
    "rejection on Hyperliquid; chains.views is chain coverage. Start with "
    "tnega_catalogue. Every response carries its coverage, and a measurement "
    "with nothing behind it returns a withheld_reason rather than a zero. "
    "as_of is when the data was measured, or null where there is no such "
    "time; served_at is when you asked. Cite as_of. One call at a time: a "
    "second concurrent call is refused, not queued. Requests are capped per "
    "minute across all callers; on HTTP 429 wait the seconds given in the "
    "Retry-After header, also in error.data.retry_after_seconds, then retry.")


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


class RateCap:
    """Requests per minute across the whole process, refused past the cap.

    The gate bounds how many calls run at once. It does not bound how many
    arrive: a client that waits for each answer and asks again at once holds
    the gate for as long as it likes, and every request costs a body parse
    and a coverage read even when it is refused. This bounds the rate.

    A token bucket rather than a window of timestamps, so it holds two
    numbers whatever the traffic: nothing here grows with load, in a
    container whose ceiling is memory.

    GLOBAL, NOT PER CALLER, AND DELIBERATELY. The only per-caller key
    available here is the connecting address, and it is the wrong one: behind
    Render every request arrives from the proxy, X-Forwarded-For is whatever
    the caller wrote when it reaches Render directly, and a chat client's
    connector calls from its vendor's cloud, so one address is every user of
    that client. Per-address limiting belongs at the edge, in Vercel, where
    the address is the platform's own reading and not a header, and it is not
    built here. Nothing in this class reads an address.
    """

    def __init__(self, per_minute: int) -> None:
        self.per_minute = max(1, int(per_minute))
        self.tokens = float(self.per_minute)
        self.stamp = time.monotonic()
        self.refused = 0
        self._lock = threading.Lock()

    def take(self) -> bool:
        with self._lock:
            now = time.monotonic()
            self.tokens = min(float(self.per_minute),
                              self.tokens + (now - self.stamp) * self.per_minute / 60.0)
            self.stamp = now
            if self.tokens >= 1.0:
                self.tokens -= 1.0
                return True
            self.refused += 1
            return False

    def retry_after(self) -> int:
        """Whole seconds until one request would be admitted."""
        need = max(0.0, 1.0 - self.tokens)
        return max(1, int(need * 60.0 / self.per_minute + 0.999))


RATE_DEFAULT_PER_MINUTE = 600


def _rate_from_env() -> "RateCap | None":
    """The cap from MCP_RATE_LIMIT_PER_MINUTE, or None when it is off.

    Exactly 0 means off. Unset, unreadable or negative means the default: a
    negative number is a mistake, and a mistake should leave the backstop in
    place rather than remove it.
    """
    raw = os.environ.get("MCP_RATE_LIMIT_PER_MINUTE", "").strip()
    try:
        n = int(raw) if raw else RATE_DEFAULT_PER_MINUTE
    except ValueError:
        n = RATE_DEFAULT_PER_MINUTE
    if n == 0:
        return None
    return RateCap(n if n > 0 else RATE_DEFAULT_PER_MINUTE)


# 600 a minute, a backstop and not a share.
#
# This cap is global, so it is not what keeps one client from starving the
# others; the gate is. Every tool call holds the one slot while it runs, and
# measured locally against the real stores on 2026-09-25 a call took under
# 0.1s (resolve, get, summary) to 0.8s (list, series), and about 5s for the
# catalogue. So tool calls cannot run faster than roughly 10 a second in
# total whatever this says, and a client looping on them is refused by the
# gate, not by this. What this
# bounds is the traffic the gate never sees: pings, tools/list, malformed
# bodies and refused calls, each of which costs a parse. At 120 a minute a
# single client at 2 requests a second used the whole budget and every other
# caller got 429s; at 600, ten a second, one client at that pace uses a fifth.
RATE = _rate_from_env()


def rate_limited(req_id, cap: RateCap) -> dict:
    return _error(
        req_id, BUSY_CODE,
        "Tnega answers a limited number of requests a minute across all "
        "callers, and that limit is reached. Retry after the time given.",
        {"limit": f"{cap.per_minute} requests per minute, all callers",
         "reason": "rate_limited",
         "retry_after_seconds": cap.retry_after(),
         "refused_so_far": cap.refused})


# ── Origin, observed and not yet enforced ────────────────────────────────────
#
# The transport spec says a server should reject a request whose Origin is
# present and not its own, which protects a local server from a web page the
# user happens to have open. Enforcing it here is held back until it is known
# what the chat clients that connect send, because refusing one of them would
# end its connection and a count would not. So this only counts, and logs at
# the 1st, 2nd, 4th, 8th... occurrence so a flood cannot fill the log.
ALLOWED_ORIGIN_HOSTS = {"tnega.app", "www.tnega.app", "localhost", "127.0.0.1", "::1"}
ORIGIN_OUTSIDE = {"count": 0}


def origin_allowed(origin: str) -> bool:
    try:
        host = (urlsplit(origin).hostname or "").lower()
    except ValueError:
        return False
    return host in ALLOWED_ORIGIN_HOSTS


# Every refused version, counted and logged on the same schedule as Origin,
# so the first time a real client is turned away it is visible rather than
# inferred from a connection that never appears.
VERSION_REFUSED = {"count": 0}


def note_version_refusal(method: str | None, header: str | None,
                         user_agent: str | None, why: str) -> None:
    VERSION_REFUSED["count"] += 1
    n = VERSION_REFUSED["count"]
    if n & (n - 1) == 0:
        print(f"[mcp] version refusal ({why}): method={str(method)[:40]!r} "
              f"header={str(header)[:40]!r} user_agent={str(user_agent)[:80]!r} "
              f"({n} so far)", flush=True)


def note_origin(origin: str | None) -> bool:
    """Count an Origin outside the allowlist. Returns True if it was outside."""
    if not origin or origin_allowed(origin):
        return False
    ORIGIN_OUTSIDE["count"] += 1
    n = ORIGIN_OUTSIDE["count"]
    if n & (n - 1) == 0:
        print(f"[mcp] Origin outside the allowlist, not refused: "
              f"{origin[:80]!r} ({n} so far)", flush=True)
    return True


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
            "instructions": INSTRUCTIONS,
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
