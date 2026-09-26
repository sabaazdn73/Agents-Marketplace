"""The per-address request limit, checked against the real app.

    ./venv/bin/python scripts/rate_limit_selfcheck.py

What it proves, against server.app as deployed (every middleware and route in
their real order) and without running server.py's startup:

  - 120 requests from one address pass and the 121st is a 429 with
    Retry-After, the JSON body, and the CORS header for the site
  - a different address is unaffected, and one second later the first
    address has earned back two requests and no more
  - the exempt paths are not limited, and a path merely starting with an
    exempt one is
  - OPTIONS is not counted
  - RATE_LIMIT_PER_IP_PER_MINUTE=0 turns it off, in a fresh process
  - a forged leftmost X-Forwarded-For entry cannot evade the limit or charge
    another address, under the default rule and under x-forwarded-for:3 with
    the header laid out as Render delivers it
  - a request with no usable header goes to one shared bucket, not to the
    peer: with the peer AND the leftmost X-Forwarded-For entry rotated on
    every request (what uvicorn with FORWARDED_ALLOW_IPS=* turns into the
    peer), the 121st is refused, in-process and over the wire, and the shared
    bucket is logged once
  - the 429 exposes Retry-After to the site's scripts
  - concurrent /api/status callers at cache expiry share one refresh
  - the table stays at its bound when more addresses arrive, oldest dropped
  - the memory the table holds at 20,000 addresses
  - the same over the wire, on a real uvicorn with lifespan off

NOTHING HERE REACHES A REAL SERVICE. The database variables point at a closed
local port before server.py is imported, lifespan never runs, and the requests
sent are to a path that does not exist (a 404 still passes through the limit)
or to /api/canary/record with an empty body, which its handler refuses before
any I/O.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import socket
import subprocess
import sys
import threading
import time
import tracemalloc
from contextlib import redirect_stdout
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

_DEAD = "127.0.0.1:9"
os.environ["MONGODB_URI"] = f"mongodb://{_DEAD}/?serverSelectionTimeoutMS=200"
os.environ["COCKROACH_DATABASE_URL"] = f"postgresql://x@{_DEAD}/x?connect_timeout=1"
os.environ["HL_COLLECTOR_ENABLED"] = "0"
os.environ["TELEGRAM_WEBHOOK_SECRET"] = ""
for k in ("RATE_LIMIT_PER_IP_PER_MINUTE", "RATE_LIMIT_IP_HEADER", "RATE_LIMIT_EXEMPT_PATHS",
          "RATE_LIMIT_MAX_IPS", "RATE_LIMIT_IP_DEBUG", "MCP_RATE_LIMIT_PER_MINUTE"):
    os.environ.pop(k, None)

import server  # noqa: E402
from core import rate_limit as rl  # noqa: E402

APP = server.app
LIMITER = server.RATE_LIMITER
FAILS: list[str] = []
MISSING = "/api/rate-limit-selfcheck-missing"
SITE = b"https://www.tnega.app"


def check(ok: bool, what: str) -> None:
    print(("  ok    " if ok else "  FAIL  ") + what, flush=True)
    if not ok:
        FAILS.append(what)


class Clock:
    """A clock that moves only when told to, so a count cannot drift with the
    speed of the machine running it."""

    def __init__(self):
        self.t = 1_000.0

    def __call__(self):
        return self.t


CLOCK = Clock()
LIMITER.clock = CLOCK


async def _drive(path, headers, method="GET", body=b"", peer="10.0.0.1"):
    sent = []
    done = {"body": False}

    async def receive():
        if not done["body"]:
            done["body"] = True
            return {"type": "http.request", "body": body, "more_body": False}
        await asyncio.sleep(3600)

    async def send(m):
        sent.append(m)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
             "query_string": b"", "root_path": "", "headers": headers,
             "client": (peer, 50000), "server": ("127.0.0.1", 80)}
    await asyncio.wait_for(APP(scope, receive, send), timeout=20)
    start = next(m for m in sent if m["type"] == "http.response.start")
    raw = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], dict(start["headers"]), raw


def req(path=MISSING, ip=None, xff=None, method="GET", origin=None, body=b"",
        extra=(), peer="10.0.0.1"):
    h = []
    if ip:
        h.append((b"true-client-ip", ip.encode()))
    if xff:
        h.append((b"x-forwarded-for", xff.encode()))
    if origin:
        h.append((b"origin", origin))
    if body:
        h += [(b"content-type", b"application/json"),
              (b"content-length", str(len(body)).encode())]
    h += list(extra)
    return asyncio.run(_drive(path, h, method, body, peer))


def burst(n, **kw):
    return [req(**kw)[0] for _ in range(n)]


def fresh():
    LIMITER.clear()
    CLOCK.t += 3600


def main() -> int:
    print(f"limit {LIMITER.per_minute}/min, rule {server.RATE_LIMIT_IP_RULE.describe()}, "
          f"bound {LIMITER.max_keys}, exempt {server.RATE_LIMIT_EXEMPT.describe()}")

    print("\n1. 120 pass, the 121st is a 429 with Retry-After")
    fresh()
    codes = burst(120, ip="198.51.100.1")
    check(codes == [404] * 120, f"120 requests: {sorted(set(codes))} (the route's own 404)")
    status, headers, raw = req(ip="198.51.100.1", origin=SITE)
    body = json.loads(raw or b"{}")
    check(status == 429 and headers.get(b"retry-after") == b"1"
          and body.get("error") == "rate_limited" and body.get("retry_after_seconds") == 1
          and set(body) == {"detail", "error", "retry_after_seconds"}
          and body.get("detail") == "Too many requests from this address: bursts of "
                                    "120, then 2 a second. Retry in 1 s.",
          f"121st: {status}, Retry-After {headers.get(b'retry-after')}, {body}")
    check(headers.get(b"access-control-allow-origin") == SITE,
          f"the 429 carries the CORS header: {headers.get(b'access-control-allow-origin')}")
    exposed = (headers.get(b"access-control-expose-headers") or b"").lower()
    check(b"retry-after" in exposed, f"and exposes Retry-After to the page: {exposed!r}")
    check(b"connection" not in headers, "no body sent, so the connection is kept")
    status, headers, _ = req("/api/canary/record", ip="198.51.100.1", method="POST", body=b"{}")
    check(status == 429 and headers.get(b"connection") == b"close",
          f"a POST with a body is refused unread and the connection closed: {status}")
    CLOCK.t += 1.0
    codes = burst(3, ip="198.51.100.1")
    check(codes == [404, 404, 429], f"one second later two more are earned: {codes}")
    CLOCK.t += 60.0
    codes = burst(121, ip="198.51.100.1")
    check(codes.count(404) == 120 and codes[-1] == 429,
          f"a minute of rest refills the whole allowance: {codes.count(404)} passed")

    print("\n2. a different address is unaffected")
    codes = burst(120, ip="198.51.100.2")
    check(codes == [404] * 120, f"198.51.100.2 while .1 is refused: {sorted(set(codes))}")
    status, _, raw = req("/api/canary/record", ip="198.51.100.3", method="POST", body=b"{}")
    check(status == 400 and b"owner_address and job_id" in raw,
          f"a real route for a third address reaches its handler: {status}")

    print("\n3. exempt paths are not limited")
    fresh()
    burst(120, ip="198.51.100.9")
    check(req(ip="198.51.100.9")[0] == 429, "the address is at its limit")
    for path, method in (("/api/health", "GET"), ("/api/admin/full-registry-batch", "POST"),
                         ("/api/admin/job-index-batch", "POST"),
                         ("/api/telegram/webhook", "POST"), ("/mcp", "GET")):
        codes = [req(path, ip="198.51.100.9", method=method)[0] for _ in range(5)]
        check(429 not in codes, f"{method} {path} x5: {sorted(set(codes))}")
    check("/api/status" not in server.RATE_LIMIT_EXEMPT,
          "/api/status is NOT exempt (uncached Mongo and live checks per call)")
    check("/api/healthz" not in server.RATE_LIMIT_EXEMPT
          and "/mcpx" not in server.RATE_LIMIT_EXEMPT
          and "/api/administrator" not in server.RATE_LIMIT_EXEMPT,
          "a path that only starts like an exempt one is not exempt")
    ex = rl.ExemptPaths(" /a , /b/* ,,".split(","))
    check("/a" in ex and "/b/x" in ex and "/b" not in ex and "/c" not in ex,
          f"RATE_LIMIT_EXEMPT_PATHS parsing: {ex.describe()}")
    os.environ["RATE_LIMIT_EXEMPT_PATHS"] = ""
    check(rl.exempt_from_env().describe() == "none", "set but empty means no exemptions")
    os.environ.pop("RATE_LIMIT_EXEMPT_PATHS")

    print("\n4. OPTIONS is not counted")
    fresh()
    pre = [(b"access-control-request-method", b"POST")]
    codes = [req(ip="198.51.100.4", method="OPTIONS", origin=SITE, extra=pre)[0]
             for _ in range(300)]
    check(429 not in codes, f"300 preflights: {sorted(set(codes))}")
    codes = [req(ip="198.51.100.4", method="OPTIONS")[0] for _ in range(300)]
    check(429 not in codes, f"300 bare OPTIONS: {sorted(set(codes))}")
    codes = burst(121, ip="198.51.100.4")
    check(codes.count(404) == 120 and codes[-1] == 429,
          f"then a full 120 GETs still pass: {codes.count(404)}")

    print("\n5. RATE_LIMIT_PER_IP_PER_MINUTE=0 turns it off")
    for raw_env, want in (("", 120), ("0", 0), ("-5", 120), ("abc", 120), ("300", 300)):
        os.environ["RATE_LIMIT_PER_IP_PER_MINUTE"] = raw_env
        got = rl.per_minute_from_env()
        check(got == want, f"RATE_LIMIT_PER_IP_PER_MINUTE={raw_env!r} -> {got}")
    os.environ.pop("RATE_LIMIT_PER_IP_PER_MINUTE")
    off = off_in_fresh_process()
    check(off.get("limiter") is None and off.get("codes") == [404]
          and "[ratelimit] off" in off.get("log", ""),
          f"a fresh import with 0: limiter {off.get('limiter')}, 300 requests -> "
          f"{off.get('codes')}, logged {off.get('log', '').strip()!r}")

    print("\n6. a forged X-Forwarded-For cannot evade or frame")
    # The default rule: True-Client-IP, which Cloudflare overwrites.
    fresh()
    codes = [req(ip="203.0.113.50", xff=f"192.0.2.{i % 250}, 203.0.113.50")[0]
             for i in range(121)]
    check(codes.count(404) == 120 and codes[-1] == 429,
          f"rotating the leftmost XFF entry does not buy more: {codes.count(404)} passed")
    burst(120, ip="203.0.113.60", xff="203.0.113.61")
    codes = burst(120, ip="203.0.113.61")
    check(codes == [404] * 120, "naming a victim in XFF charges the sender, not the victim")
    # x-forwarded-for:3, as Render delivers it: client entries, then the
    # client, then Cloudflare's edge, then Render's own proxy.
    rule = rl.parse_ip_rule("x-forwarded-for:3")
    tail = ", 172.68.103.183, 10.26.125.146"
    k1, s1 = rl.client_key([(b"x-forwarded-for", f"203.0.113.70{tail}".encode())], "10.0.0.1", rule)
    k2, _ = rl.client_key([(b"x-forwarded-for", f"198.51.100.200, 203.0.113.70{tail}".encode())],
                          "10.0.0.1", rule)
    k3, _ = rl.client_key([(b"x-forwarded-for", f"1.1.1.1, 2.2.2.2,203.0.113.70{tail}".encode())],
                          "10.0.0.1", rule)
    check(k1 == k2 == k3 == "203.0.113.70" and s1 == "header",
          f"x-forwarded-for:3 keys the real client whatever is prepended: {k1} {k2} {k3}")
    lim = rl.PerKeyLimiter(120, clock=Clock())
    for i in range(120):
        lim.take(rl.client_key([(b"x-forwarded-for",
                                 f"192.0.2.{i}, 203.0.113.71{tail}".encode())], None, rule)[0])
    check(lim.take(rl.client_key([(b"x-forwarded-for", f"9.9.9.9, 203.0.113.71{tail}".encode())],
                                 None, rule)[0]) > 0 and len(lim) == 1,
          "x-forwarded-for:3: 120 forged prefixes are still one bucket, the 121st refused")
    U = rl.UNKNOWN_KEY
    k, s = rl.client_key([(b"x-forwarded-for", b"203.0.113.72")], "10.9.9.9", rule)
    check(k == U and s == "shared bucket, header unreadable",
          f"too few entries: the shared bucket, never the peer or a client entry: {k} ({s})")
    # The single-value rule refuses a list rather than picking from it.
    d = rl.parse_ip_rule("true-client-ip")
    k, s = rl.client_key([(b"true-client-ip", b"1.2.3.4, 5.6.7.8")], "10.0.0.2", d)
    check(k == U and s == "shared bucket, header unreadable",
          f"a True-Client-IP carrying a list is not used: {k} ({s})")
    k, s = rl.client_key([(b"true-client-ip", b"not-an-ip")], "10.0.0.3", d)
    check(k == U, f"a True-Client-IP that is not an address is not used: {k} ({s})")
    k, s = rl.client_key([], "10.0.0.4", d)
    check(k == U and s == "shared bucket, header absent", f"header absent: {k} ({s})")
    k, s = rl.client_key([(b"true-client-ip", b"1.2.3.4")], "10.0.0.5", rl.parse_ip_rule("peer"))
    check(k == "10.0.0.5" and s == "peer", f"the peer is used only under rule=peer: {k} ({s})")

    print("\n6b. no usable header: one shared bucket, whatever the peer and XFF say")
    # The supervisor's case. With FORWARDED_ALLOW_IPS=* uvicorn makes the
    # leftmost XFF entry the peer, so both are rotated together here.
    fresh()
    out = io.StringIO()
    with redirect_stdout(out):
        codes = [req(xff=f"192.0.{i // 250}.{i % 250 + 1}, 172.68.103.183",
                     peer=f"192.0.{i // 250}.{i % 250 + 1}")[0] for i in range(400)]
    first = codes.index(429) + 1 if 429 in codes else None
    check(first == 121 and codes.count(404) == 120,
          f"400 requests, peer and leftmost XFF rotated, no True-Client-IP: "
          f"{codes.count(404)} admitted, first 429 at {first}")
    lines = [ln for ln in out.getvalue().splitlines() if "shared the 'unknown' bucket" in ln]
    check(len(lines) == 1, f"the shared bucket is logged once, not per request: {lines!r}")
    check(len(LIMITER) == 1, f"and it is one entry in the table ({len(LIMITER)})")
    a, _ = rl.client_key([(b"true-client-ip", b"2001:db8:1:2::1")], None, d)
    b, _ = rl.client_key([(b"true-client-ip", b"2001:db8:1:2:ffff::9")], None, d)
    c, _ = rl.client_key([(b"true-client-ip", b"::ffff:198.51.100.7")], None, d)
    check(a == b == "2001:db8:1:2::/64" and c == "198.51.100.7",
          f"IPv6 keyed by /64 ({a}), IPv4-mapped as IPv4 ({c})")
    for raw_rule, want in (("peer", "peer"), ("X-Forwarded-For:2", "x-forwarded-for:2"),
                           ("cf-connecting-ip", "cf-connecting-ip")):
        check(rl.parse_ip_rule(raw_rule).describe() == want, f"rule {raw_rule!r} -> {want}")
    os.environ["RATE_LIMIT_IP_HEADER"] = "x-forwarded-for:zero"
    r, warn = rl.ip_rule_from_env()
    check(r.describe() == "true-client-ip" and warn and "not usable" in warn,
          f"an unreadable rule falls back to the default and says so: {warn}")
    os.environ.pop("RATE_LIMIT_IP_HEADER")

    print("\n7. the table stays bounded")
    lim = rl.PerKeyLimiter(120, max_keys=20_000, clock=Clock())
    for i in range(50_000):
        lim.take(f"10.{i >> 16 & 255}.{i >> 8 & 255}.{i & 255}")
    check(len(lim) == 20_000 and lim.evicted == 30_000,
          f"50,000 addresses -> {len(lim)} held, {lim.evicted} evicted")
    check("10.0.0.0" not in lim._tat and "10.0.195.79" in lim._tat,
          "the oldest were dropped, the newest kept")
    lim2 = rl.PerKeyLimiter(120, max_keys=3, clock=Clock())
    for key in ("a", "b", "c"):
        lim2.take(key)
    lim2.take("a")          # a is recent again
    lim2.take("d")
    check(set(lim2._tat) == {"a", "c", "d"}, f"least recently seen goes first: {sorted(lim2._tat)}")

    print("\n8. memory at 20,000 addresses")
    memory()

    print("\n8b. /api/status: callers at expiry share one refresh")
    status_lock()

    print("\n9. over the wire, on a real uvicorn with lifespan off")
    wire()

    print()
    if FAILS:
        print(f"{len(FAILS)} FAILED")
        for f in FAILS:
            print("  " + f)
        return 1
    print("all passed")
    return 0


def status_lock() -> None:
    from core import status_checks as sc
    calls = {"n": 0}

    async def stub():
        calls["n"] += 1
        await asyncio.sleep(0.2)
        return "stub"

    async def disc():
        await asyncio.sleep(0.2)
        return {"ok": True}

    names = ("_check_8004scan", "_check_zerion", "_check_bsc_rpc", "_check_bsc_rpc_backup",
             "_check_explainer_agent", "_check_mongodb", "_check_termix")
    saved = {n: getattr(sc, n) for n in names}
    saved_disc, saved_cache = sc.get_discovery_status, dict(sc._cache)
    try:
        for n in names:
            setattr(sc, n, stub)
        sc.get_discovery_status = disc
        sc._cache.update({"data": None, "checked_at": 0.0})

        async def many(k):
            return await asyncio.gather(*[sc.get_status() for _ in range(k)])

        res = asyncio.run(many(20))
        check(calls["n"] == 7 and all(r["services"] == res[0]["services"] for r in res),
              f"20 concurrent callers on a cold cache: {calls['n']} checks run (7 = one refresh)")
        sc._cache["checked_at"] -= sc._CACHE_TTL_SECONDS + 1     # expire it
        calls["n"] = 0
        asyncio.run(many(20))
        check(calls["n"] == 7, f"20 at expiry: {calls['n']} checks run (one refresh)")
        calls["n"] = 0
        asyncio.run(many(5))
        check(calls["n"] == 0, f"5 more within the TTL: {calls['n']} checks run")
    finally:
        for n, f in saved.items():
            setattr(sc, n, f)
        sc.get_discovery_status = saved_disc
        sc._cache.clear()
        sc._cache.update(saved_cache)


def memory() -> None:
    for label, gen in (
            ("IPv4", lambda i: f"{100 + (i >> 16 & 127)}.{i >> 8 & 255}.{i & 255}.{i % 7}"),
            ("IPv6 /64", lambda i: f"2001:db8:{i >> 16 & 0xffff:x}:{i & 0xffff:x}::/64")):
        tracemalloc.start()
        lim = rl.PerKeyLimiter(120, max_keys=20_000, clock=Clock())
        # Each key is made inside the measurement, as the middleware makes it,
        # so the strings the table keeps are counted with it.
        for i in range(20_000):
            lim.take(gen(i))
        cur, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        check(len(lim) == 20_000 and peak < 8e6,
              f"{label}: 20,000 addresses held in {cur / 1e6:.2f} MB (peak {peak / 1e6:.2f} MB), "
              f"{cur / 20_000:.0f} bytes each")


def off_in_fresh_process() -> dict:
    code = r"""
import asyncio, json, sys
sys.path.insert(0, %r)
import server
codes = set()
async def one():
    sent = []
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}
    async def send(m):
        sent.append(m)
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": "GET", "scheme": "http", "path": %r, "raw_path": b"/x",
             "query_string": b"", "root_path": "", "headers": [(b"true-client-ip", b"198.51.100.99")],
             "client": ("10.0.0.1", 1), "server": ("127.0.0.1", 80)}
    await server.app(scope, receive, send)
    codes.add(sent[0]["status"])
for _ in range(300):
    asyncio.run(one())
print(json.dumps({"limiter": server.RATE_LIMITER, "codes": sorted(codes)}))
""" % (str(BACKEND), MISSING)
    env = dict(os.environ, RATE_LIMIT_PER_IP_PER_MINUTE="0")
    p = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True,
                       text=True, timeout=180, cwd=str(BACKEND))
    try:
        out = json.loads(p.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {"error": p.stderr[-800:]}
    out["log"] = "\n".join(ln for ln in p.stdout.splitlines() if ln.startswith("[ratelimit]"))
    return out


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(port, path, headers=b"", method=b"GET"):
    s = socket.create_connection(("127.0.0.1", port), timeout=10)
    try:
        s.sendall(method + b" " + path.encode() + b" HTTP/1.1\r\nHost: x\r\n"
                  b"Connection: close\r\n" + headers + b"\r\n")
        buf = b""
        while True:
            d = s.recv(65536)
            if not d:
                break
            buf += d
        return buf
    finally:
        s.close()


def wire() -> None:
    import uvicorn
    fresh()
    LIMITER.clock = time.monotonic      # real time over the wire
    port = _free_port()
    srv = uvicorn.Server(uvicorn.Config(APP, host="127.0.0.1", port=port, lifespan="off",
                                        log_level="warning", access_log=False))
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    h = (b"True-Client-IP: 198.51.100.77\r\nX-Forwarded-For: 192.0.2.1\r\n"
         b"Origin: https://www.tnega.app\r\n")
    started = time.monotonic()
    first_refusal, last = None, b""
    for n in range(1, 201):
        last = _get(port, MISSING, h)
        if last.startswith(b"HTTP/1.1 429"):
            first_refusal = n
            break
        if not last.startswith(b"HTTP/1.1 404"):
            break
    took = time.monotonic() - started
    head, _, body = last.partition(b"\r\n\r\n")
    hl = head.lower()
    # Real time passes while the requests are sent: one more is earned every
    # half second, so the first refusal is at 121 plus what was earned.
    earned = int(took / 0.5)
    ok_body = False
    try:
        ok_body = json.loads(body).get("error") == "rate_limited"
    except ValueError:
        pass
    check(first_refusal is not None and 121 <= first_refusal <= 121 + earned
          and b"retry-after: 1" in hl
          and b"access-control-allow-origin: https://www.tnega.app" in hl and ok_body,
          f"first refusal at request {first_refusal} ({took:.2f}s, {earned} earned "
          f"meanwhile): {head.split(b'\r\n')[0]!r} {body!r}")
    exposed = b"access-control-expose-headers: retry-after" in hl
    check(exposed, "over the wire the 429 exposes Retry-After")
    other = _get(port, MISSING, b"True-Client-IP: 198.51.100.78\r\n").split(b"\r\n")[0]
    check(other.startswith(b"HTTP/1.1 404"), f"another address over the wire: {other!r}")
    health = _get(port, "/api/health", h).split(b"\r\n")[0]
    check(health.startswith(b"HTTP/1.1 200"), f"/api/health for the limited address: {health!r}")
    srv.should_exit = True
    t.join(timeout=10)

    # As on Render: uvicorn trusting forwarded headers from anyone, so the
    # peer the app sees is the leftmost X-Forwarded-For entry, rotated here on
    # every request, and no True-Client-IP.
    fresh()
    port = _free_port()
    srv = uvicorn.Server(uvicorn.Config(APP, host="127.0.0.1", port=port, lifespan="off",
                                        log_level="warning", access_log=False,
                                        forwarded_allow_ips="*", proxy_headers=True))
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    started = time.monotonic()
    first = None
    for n in range(1, 401):
        h = f"X-Forwarded-For: 192.0.{n // 250}.{n % 250 + 1}, 172.68.103.183\r\n".encode()
        line = _get(port, MISSING, h).split(b"\r\n")[0]
        if line.startswith(b"HTTP/1.1 429"):
            first = n
            break
    took = time.monotonic() - started
    earned = int(took / 0.5)
    check(first is not None and 121 <= first <= 121 + earned,
          f"FORWARDED_ALLOW_IPS=*, leftmost XFF rotated, no True-Client-IP: first 429 at "
          f"{first} ({took:.2f}s, {earned} earned meanwhile)")
    srv.should_exit = True
    t.join(timeout=10)


if __name__ == "__main__":
    sys.exit(main())
