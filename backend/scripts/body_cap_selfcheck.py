"""The app-wide request-body cap, checked against the real app.

    ./venv/bin/python scripts/body_cap_selfcheck.py

What it proves, each against server.app as deployed (every middleware and
route, in their real order), and without running server.py's startup:

  - a declared Content-Length over the cap is a 413 before one byte is read,
    on each of the eight public POST routes that read request.json()
  - a chunked body over the cap is a 413, the read stops one chunk past the
    cap, and that holds for a handler that swallows the stop in a broad
    `except Exception` as much as one that lets it propagate
  - a small body, and a legitimate body just under the cap, still reach the
    handler intact
  - valid JSON that is not an object is a 400 "expected a JSON object", and
    malformed JSON a 400 "body is not valid JSON" (both as detail and error), on
    every route that parses one, not a 500
  - /mcp's own 64 KB cap still applies inside, in JSON-RPC's shape
  - a client that disconnects mid-body ends with one log line, not a traceback
  - a response that has already started is never followed by a second start
  - the same over the wire, on a real uvicorn on a free local port
  - peak memory for a cap-sized worst-case body

NOTHING HERE REACHES A REAL SERVICE. The database variables are pointed at a
closed local port before server.py is imported (load_dotenv never overrides a
variable already set), lifespan is never run, so the keep-alive pingers, the
collector and the index build never start, and every request sent is one the
handler refuses on its own validation before any I/O.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import socket
import sys
import threading
import time
import tracemalloc
from contextlib import redirect_stdout
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

# Before server.py is imported, so its load_dotenv() cannot fill them in.
_DEAD = "127.0.0.1:9"
os.environ["MONGODB_URI"] = f"mongodb://{_DEAD}/?serverSelectionTimeoutMS=200"
os.environ["COCKROACH_DATABASE_URL"] = f"postgresql://x@{_DEAD}/x?connect_timeout=1"
os.environ["HL_COLLECTOR_ENABLED"] = "0"
os.environ["TELEGRAM_WEBHOOK_SECRET"] = ""
for k in ("API_MAX_BODY_BYTES", "MCP_MAX_BODY_BYTES", "TELEGRAM_MAX_BODY_BYTES",
          "MCP_RATE_LIMIT_PER_MINUTE"):
    os.environ.pop(k, None)

import server  # noqa: E402
from core.env_caps import cap_from_env  # noqa: E402

APP = server.app
CAP = server.API_MAX_BODY_BYTES

FAILS: list[str] = []


def check(ok: bool, what: str) -> None:
    print(("  ok    " if ok else "  FAIL  ") + what, flush=True)
    if not ok:
        FAILS.append(what)


EIGHT = [
    "/api/canary/record",
    "/api/agents/negotiate",
    "/api/agents/notify-funded",
    "/api/paybox/sessions",
    "/api/paybox/sessions/selfcheck-session/pay",
    "/api/studio/runs",
    "/api/studio/runs/selfcheck-run/answers",
    "/api/commerce/run",
]


# ── a bare ASGI driver, so every receive() call can be counted ──────────────
async def drive(path: str, chunks: list[bytes], headers: list[tuple[bytes, bytes]],
                disconnect_after: bool = False, app=None) -> dict:
    """Run one request through the app. Returns status, body, how many
    receive() calls the app made, how many body bytes it pulled, every
    message sent, and anything the app raised."""
    app = app or APP
    pulled = {"calls": 0, "bytes": 0}
    queue = list(chunks)

    async def receive():
        pulled["calls"] += 1
        if queue:
            c = queue.pop(0)
            pulled["bytes"] += len(c)
            return {"type": "http.request", "body": c,
                    "more_body": bool(queue) or disconnect_after}
        if disconnect_after:
            return {"type": "http.disconnect"}
        # Nothing more will come; a real server would block here.
        await asyncio.sleep(3600)

    sent: list[dict] = []

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": "POST", "scheme": "http", "path": path, "raw_path": path.encode(),
             "query_string": b"", "root_path": "", "headers": headers,
             "client": ("127.0.0.1", 50000), "server": ("127.0.0.1", 80)}
    raised = None
    try:
        await asyncio.wait_for(app(scope, receive, send), timeout=20)
    except BaseException as e:  # noqa: BLE001
        raised = e
    starts = [m for m in sent if m["type"] == "http.response.start"]
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return {"status": starts[0]["status"] if starts else None, "starts": len(starts),
            "body": body, "calls": pulled["calls"], "bytes": pulled["bytes"],
            "raised": raised, "headers": dict(starts[0]["headers"]) if starts else {}}


JSON_CT = (b"content-type", b"application/json")


def _cl(n: int) -> tuple[bytes, bytes]:
    return (b"content-length", str(n).encode())


def _json(r) -> dict:
    try:
        return json.loads(r["body"])
    except ValueError:
        return {}


def run(coro):
    return asyncio.run(coro)


def main() -> int:
    print(f"cap {CAP} bytes (API_MAX_BODY_BYTES default); per-path "
          f"{server.BODY_CAP_PER_PATH}")
    expected = {"detail": f"Request body is larger than {CAP} bytes.", "error": "too_large", "limit_bytes": CAP}

    print("\n1. declared Content-Length over the cap: 413, nothing read")
    for path in EIGHT:
        r = run(drive(path, [b"x" * 10], [JSON_CT, _cl(10 * 1024 * 1024)]))
        check(r["status"] == 413 and _json(r) == expected and r["calls"] == 0
              and r["raised"] is None,
              f"{path}: {r['status']} {_json(r)} receive() calls {r['calls']}")
    r = run(drive("/api/canary/record", [], [JSON_CT, _cl(CAP)]))
    check(r["status"] != 413, f"Content-Length exactly at the cap is not refused "
                              f"up front ({r['status']})")
    r = run(drive("/api/canary/record", [], [JSON_CT, (b"content-length", b"12abc")]))
    check(r["status"] == 400 and r["calls"] == 0, f"malformed Content-Length: "
          f"{r['status']} {_json(r)}, not read")
    # CORS is outside the cap, so a browser on the site can read the 413.
    r = run(drive("/api/canary/record", [], [JSON_CT, _cl(CAP + 1),
                                              (b"origin", b"https://www.tnega.app")]))
    check(r["status"] == 413 and r["headers"].get(b"access-control-allow-origin")
          == b"https://www.tnega.app", "the 413 carries the CORS header for the site")

    print("\n2. chunked, no Content-Length, over the cap: 413, read stops one chunk past it")
    chunk = 16 * 1024
    big = [b" " * chunk for _ in range(64)]          # 1 MiB offered
    most = CAP // chunk + 1
    for path in EIGHT:
        r = run(drive(path, list(big), [JSON_CT]))
        check(r["status"] == 413 and _json(r) == expected and r["starts"] == 1
              and r["bytes"] <= CAP + chunk and r["calls"] <= most
              and r["raised"] is None,
              f"{path}: {r['status']}, pulled {r['bytes']} of {chunk * 64} bytes "
              f"in {r['calls']} receive() calls")

    print("\n3. small and near-cap bodies still reach the handler")
    body = b"{}"
    r = run(drive("/api/canary/record", [body], [JSON_CT, _cl(len(body))]))
    check(r["status"] == 400 and "owner_address and job_id are required"
          in r["body"].decode(), f"/api/canary/record {{}}: {r['status']} "
          f"{r['body'][:80]!r} (the handler's own validation)")
    body = json.dumps({"flow": "not-a-flow", "request": "x"}).encode()
    r = run(drive("/api/studio/runs", [body], [JSON_CT, _cl(len(body))]))
    check(r["status"] == 400 and "flow" in r["body"].decode(),
          f"/api/studio/runs bad flow: {r['status']} {r['body'][:80]!r}")
    # A body just under the cap, in 16 KB chunks, parsed whole by the handler.
    from core.commerce import coordinator
    flow = next(iter(coordinator.FLOWS))
    pad = CAP - len(json.dumps({"flow": flow, "request": ""}).encode()) - 16
    body = json.dumps({"flow": flow, "request": "y" * pad}).encode()
    parts = [body[i:i + chunk] for i in range(0, len(body), chunk)]
    r = run(drive("/api/studio/runs", parts, [JSON_CT]))
    check(r["status"] == 400 and "too long" in r["body"].decode()
          and r["bytes"] == len(body),
          f"/api/studio/runs {len(body)}-byte body (cap {CAP}), chunked, no "
          f"length: {r['status']} {r['body'][:70]!r}, all {r['bytes']} bytes delivered")

    print("\n3b. a body that is not a JSON object: 400, not a 500")
    want = {"detail": "expected a JSON object", "error": "expected a JSON object"}
    for path in EIGHT:
        for raw in (b"[1,2,3]", b"[]", b'"x"', b"7", b"null"):
            r = run(drive(path, [raw], [JSON_CT, _cl(len(raw))]))
            ok = r["status"] == 400 and _json(r) == want and r["raised"] is None
            if not ok or raw == b"[1,2,3]":
                check(ok, f"{path} {raw.decode()}: {r['status']} {_json(r)}")

    for path in EIGHT:
        r = run(drive(path, [b"{bad"], [JSON_CT, _cl(4)]))
        check(r["status"] == 400 and _json(r) == {"detail": "body is not valid JSON", "error": "body is not valid JSON"}
              and r["raised"] is None, f"{path} {{bad: {r['status']} {_json(r)}")
    deep = b"[" * 100_000 + b"]" * 100_000
    r = run(drive("/api/canary/record", [deep], [JSON_CT, _cl(len(deep))]))
    check(r["status"] == 400 and _json(r) == {"detail": "body is not valid JSON", "error": "body is not valid JSON"},
          f"/api/canary/record 100,000-deep array: {r['status']} {_json(r)}")

    print("\n3c. a handler that swallows the stop in `except Exception`")
    # No route here does now; one could, and the middleware must still answer
    # 413 for it, and still log a disconnect it swallowed.
    from starlette.requests import Request as _Req
    from starlette.responses import JSONResponse as _JR

    async def swallows(scope, receive, send):
        try:
            await _Req(scope, receive).body()
        except Exception:  # noqa: BLE001
            await _JR({"detail": "Body must be JSON."}, status_code=400)(scope, receive, send)
            return
        await _JR({"ok": True})(scope, receive, send)

    wrapped = server.BodyCap(swallows, default_cap=1024)
    r = run(drive("/swallow", [b"z" * 512] * 8, [], app=wrapped))
    check(r["status"] == 413 and r["starts"] == 1
          and _json(r) == {"detail": "Request body is larger than 1024 bytes.", "error": "too_large", "limit_bytes": 1024},
          f"over the cap, handler's own 400 replaced: {r['status']} {_json(r)}")

    async def swallows_then_rereads(scope, receive, send):
        req = _Req(scope, receive)
        try:
            await req.body()
        except Exception:  # noqa: BLE001
            try:
                await _Req(scope, receive).body()
            except Exception:  # noqa: BLE001
                pass
            await _JR({"detail": "Body must be JSON."}, status_code=400)(scope, receive, send)
            return
        await _JR({"ok": True})(scope, receive, send)

    out = io.StringIO()
    with redirect_stdout(out):
        r = run(drive("/reread", [b"z" * 512] * 8, [],
                      app=server.BodyCap(swallows_then_rereads, default_cap=1024)))
    check(r["status"] == 413 and r["starts"] == 1
          and "disconnected mid-body" not in out.getvalue(),
          f"swallow then re-read still gets the 413, no false disconnect: {r['status']}")
    out = io.StringIO()
    with redirect_stdout(out):
        r = run(drive("/swallow", [b"z" * 10], [], app=wrapped, disconnect_after=True))
    lines = [ln for ln in out.getvalue().splitlines() if "disconnected mid-body" in ln]
    check(r["raised"] is None and len(lines) == 1,
          f"a swallowed disconnect is still logged once: {lines!r}")

    print("\n4. /mcp keeps its own 64 KB cap inside")
    from mcp_server import router as mcp_router
    inner = mcp_router.MAX_BODY_BYTES
    body = b" " * (100 * 1024)
    r = run(drive("/mcp", [body], [JSON_CT, _cl(len(body))]))
    err = _json(r).get("error") or {}
    check(r["status"] == 413 and isinstance(err, dict) and err.get("code") == -32600
          and str(inner) in err.get("message", ""),
          f"/mcp 100 KB declared: {r['status']}, JSON-RPC error {err.get('code')} "
          f"naming {inner} bytes")
    r = run(drive("/mcp", [body[i:i + chunk] for i in range(0, len(body), chunk)],
                  [JSON_CT]))
    err = _json(r).get("error") or {}
    check(r["status"] == 413 and isinstance(err, dict) and err.get("code") == -32600,
          f"/mcp 100 KB chunked: {r['status']}, the inner cap's shape")
    r = run(drive("/mcp", [], [JSON_CT, _cl(CAP + 1)]))
    check(r["status"] == 413 and _json(r) == expected and r["calls"] == 0,
          f"/mcp over the app-wide cap: {r['status']} {_json(r)}, not read")
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}).encode()
    r = run(drive("/mcp", [body], [JSON_CT, _cl(len(body))]))
    check(r["status"] == 200 and _json(r).get("id") == 1,
          f"/mcp ping still answers: {r['status']} {r['body'][:60]!r}")

    print("\n5. a client that disconnects mid-body: one line, no traceback")
    for path in ("/api/canary/record", "/api/paybox/sessions", "/mcp"):
        out = io.StringIO()
        with redirect_stdout(out):
            r = run(drive(path, [b'{"owner_address": "0x'], [JSON_CT],
                          disconnect_after=True))
        lines = [ln for ln in out.getvalue().splitlines() if "disconnected mid-body" in ln]
        check(r["raised"] is None and len(lines) == 1 and "Traceback" not in out.getvalue(),
              f"{path}: nothing raised out of the app, log {lines!r}")

    # The Telegram webhook reads through the same capped reader and does not
    # catch the disconnect, so this is the path where it propagates as
    # ClientGone to the middleware. The secret is set on the module for this
    # check only and never leaves the process.
    from telegram_bot import router as tg_router
    tg_router.WEBHOOK_SECRET = "selfcheck-secret"
    out = io.StringIO()
    with redirect_stdout(out):
        r = run(drive("/api/telegram/webhook", [b'{"update_id": 1'],
                      [JSON_CT, (b"x-telegram-bot-api-secret-token", b"selfcheck-secret")],
                      disconnect_after=True))
    lines = [ln for ln in out.getvalue().splitlines() if "disconnected mid-body" in ln]
    check(r["raised"] is None and len(lines) == 1,
          f"/api/telegram/webhook: nothing raised out of the app, log {lines!r}")
    tg_router.WEBHOOK_SECRET = ""

    print("\n6. a response that has already started is not followed by a 413")

    async def streams_then_reads(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        while True:
            m = await receive()
            if not m.get("more_body"):
                break
        await send({"type": "http.response.body", "body": b"done"})

    wrapped = server.BodyCap(streams_then_reads, default_cap=1024)
    out = io.StringIO()
    with redirect_stdout(out):
        r = run(drive("/stream", [b"z" * 512] * 8, [], app=wrapped))
    check(r["starts"] == 1 and r["status"] == 200 and r["raised"] is None
          and "after its response had started" in out.getvalue(),
          f"one start only ({r['starts']}, status {r['status']}), pulled {r['bytes']} "
          f"bytes, logged: {out.getvalue().strip()!r}")

    print("\n7. cap_from_env semantics for API_MAX_BODY_BYTES")
    for raw, want in (("", 262_144), ("0", 262_144), ("-5", 262_144), ("abc", 262_144),
                      ("131072", 131_072)):
        os.environ["API_MAX_BODY_BYTES"] = raw
        got = cap_from_env("API_MAX_BODY_BYTES", 262_144)
        check(got == want, f"API_MAX_BODY_BYTES={raw!r} -> {got}")
    os.environ.pop("API_MAX_BODY_BYTES", None)

    print("\n8. over the wire, on a real uvicorn with lifespan off")
    wire()

    print("\n9. peak memory for a cap-sized worst-case body")
    memory()

    print()
    if FAILS:
        print(f"{len(FAILS)} FAILED")
        for f in FAILS:
            print("  " + f)
        return 1
    print("all passed")
    return 0


# ── over the wire ───────────────────────────────────────────────────────────
class _Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record):
        self.lines.append(record.getMessage())


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _raw(port: int, head: bytes, body_parts=(), close_early=False, pause=0.0) -> bytes:
    s = socket.create_connection(("127.0.0.1", port), timeout=10)
    try:
        s.sendall(head)
        for p in body_parts:
            try:
                s.sendall(p)
            except OSError:
                break
            if pause:
                time.sleep(pause)
        if close_early:
            return b""
        buf = b""
        while True:
            try:
                d = s.recv(65536)
            except (ConnectionResetError, socket.timeout):
                break
            if not d:
                break
            buf += d
        return buf
    finally:
        s.close()


def wire() -> None:
    import uvicorn
    cap = _Capture()
    for name in ("uvicorn.error", "uvicorn"):
        logging.getLogger(name).addHandler(cap)
    port = _free_port()
    config = uvicorn.Config(APP, host="127.0.0.1", port=port, lifespan="off",
                            log_level="warning", access_log=False)
    srv = uvicorn.Server(config)
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)

    head = (b"POST /api/paybox/sessions HTTP/1.1\r\nHost: x\r\n"
            b"Content-Type: application/json\r\nContent-Length: 10485760\r\n\r\n")
    resp = _raw(port, head)
    check(resp.startswith(b"HTTP/1.1 413") and b'"limit_bytes": ' + str(CAP).encode() in resp,
          f"declared 10 MB, headers only, no body sent: {resp.split(b'\r\n')[0]!r}")

    head = (b"POST /api/commerce/run HTTP/1.1\r\nHost: x\r\n"
            b"Content-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n")
    piece = b" " * 8192
    parts = [b"%x\r\n" % len(piece) + piece + b"\r\n" for _ in range(128)] + [b"0\r\n\r\n"]
    resp = _raw(port, head, parts)
    check(resp.startswith(b"HTTP/1.1 413") and b"too_large" in resp,
          f"chunked 1 MiB offered: {resp.split(b'\r\n')[0]!r}")

    body = b"{}"
    head = (b"POST /api/canary/record HTTP/1.1\r\nHost: x\r\nConnection: close\r\n"
            b"Content-Type: application/json\r\nContent-Length: 2\r\n\r\n")
    resp = _raw(port, head, [body])
    check(resp.startswith(b"HTTP/1.1 400") and b"owner_address and job_id" in resp,
          f"small body: {resp.split(b'\r\n')[0]!r}, the handler's own 400")

    head = (b"POST /api/canary/record HTTP/1.1\r\nHost: x\r\n"
            b"Content-Type: application/json\r\nContent-Length: 5000\r\n\r\n")
    out = io.StringIO()
    with redirect_stdout(out):
        _raw(port, head, [b'{"owner_address": "0x'], close_early=True)
        time.sleep(0.8)
    tb = [ln for ln in cap.lines if "Exception in ASGI application" in ln]
    check(not tb and "disconnected mid-body" in out.getvalue(),
          f"disconnect mid-body: no ASGI traceback ({len(tb)}), logged "
          f"{out.getvalue().strip()!r}")

    srv.should_exit = True
    t.join(timeout=10)


# ── memory ──────────────────────────────────────────────────────────────────
def memory() -> None:
    # The worst shape measured for the parse, as in mcp_router's note: many
    # tiny containers. Wrapped in an object so each handler gets as far as its
    # own validation instead of failing on a list.
    def worst(n: int) -> bytes:
        head, tail = b'{"flow":"none","x":[', b"]}"
        k = (n - len(head) - len(tail) + 1) // 3
        return head + b",".join([b"{}"] * k) + tail

    body = worst(CAP)
    assert len(body) <= CAP, len(body)
    chunk = 16 * 1024
    parts = [body[i:i + chunk] for i in range(0, len(body), chunk)]

    tracemalloc.start()
    json.loads(body)
    _, parse_peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    tracemalloc.start()
    r = run(drive("/api/studio/runs", parts, [JSON_CT]))
    _, path_peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    check(r["status"] == 400, f"worst-case {len(body)}-byte body reached the "
                              f"handler ({r['status']})")
    print(f"        json.loads alone: peak {parse_peak / 1e6:.2f} MB")
    print(f"        whole request path, middleware to handler: peak "
          f"{path_peak / 1e6:.2f} MB")

    over = worst(10 * 1024 * 1024)
    parts = [over[i:i + chunk] for i in range(0, len(over), chunk)]
    del over
    tracemalloc.start()
    r = run(drive("/api/studio/runs", parts, [JSON_CT]))
    _, over_peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    del parts
    check(r["status"] == 413 and over_peak < 2 * path_peak + 1e6,
          f"10 MB worst-case body offered chunked: {r['status']}, peak "
          f"{over_peak / 1e6:.2f} MB (the parse is never reached)")


if __name__ == "__main__":
    sys.exit(main())
