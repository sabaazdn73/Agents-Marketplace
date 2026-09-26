"""The per-address request limit: who a request is from, and whether it may pass.

Transport free. The ASGI middleware in server.py is the only caller; it hands
this module the raw header list and the socket peer and gets back a key and a
decision, so nothing here imports a web framework.

WHO A REQUEST IS FROM, ON RENDER (checked 2026-09-26)

Render's documentation does not describe the forwarding headers at all. What it
does say: every web service sits behind Cloudflare, Render's DDoS protection
provider (render.com/docs/ddos-protection), and its Python runtime sets
FORWARDED_ALLOW_IPS=* (render.com/docs/environment-variables), which only
makes sense if the only peer a service ever sees is Render's own proxy.

What the proxy actually sends was observed on a Render-hosted echo service
(httpbin.onrender.com/headers), with forged values sent from the client:

  sent                                  arrived at the app
  nothing                               true-client-ip: <client>
                                        cf-connecting-ip: <client>
                                        x-forwarded-for: <client>, <cloudflare edge>, <render 10.x>
  True-Client-IP: 9.9.9.9               true-client-ip: <client>  (overwritten)
  X-Forwarded-For: 1.1.1.1, 2.2.2.2     x-forwarded-for: 1.1.1.1, 2.2.2.2,<client>, <edge>, <render>
  CF-Connecting-IP: 7.7.7.7             refused at Cloudflare, 403 "error code: 1000"

So True-Client-IP is written by Cloudflare on every request and a client value
is replaced, not kept; that is the default. X-Forwarded-For is appended to, so
its leftmost entries are whatever the client sent and the client's real
address is the third from the right. RATE_LIMIT_IP_HEADER changes the choice
without a code change:

  true-client-ip        the whole header value, which must be one address
  x-forwarded-for:3     the third entry from the right (any header, any N)
  peer                  the ASGI client address, for running without a proxy;
                        not safe on Render (see WHY NOT THE PEER below)

When the chosen header is absent or unreadable, the request is keyed to one
shared bucket, UNKNOWN_KEY, and never to the peer. On Render that should only
happen for traffic that does not come through the public proxy (the private
network); locally, with no proxy, it is every request, which is one machine
anyway. The middleware logs, at most once a minute, that the shared bucket is
in use, so a header that has stopped arriving shows up in the log rather than
as a limit that quietly stopped working.

WHY NOT THE PEER. uvicorn rewrites the ASGI client address from
X-Forwarded-For when the connection comes from a host in FORWARDED_ALLOW_IPS,
and Render sets that to `*`. With `*` uvicorn (0.52.1,
middleware/proxy_headers.py) takes the LEFTMOST entry, the one the client
wrote. Falling back to it let a client with no usable header send a new
leftmost entry each time and be admitted every time (400 of 400 in the
supervisor's test). The shared bucket gives that client 120 and no more. The
peer is used only when the rule is `peer`, which is for running without a
proxy and is not safe on Render.

IPv6. One household or phone gets a whole /64, so an IPv6 address is keyed by
its /64: keyed by full address, one client could take 2^64 separate buckets.

HOW THE LIMIT IS COUNTED. A generic cell rate algorithm, which is a token
bucket held as one number per address: the time at which that address's bucket
would be full again. N a minute means a burst of N from rest, then one every
60/N seconds. One float per address is what keeps the table small (measured in
scripts/rate_limit_selfcheck.py).

THE TABLE IS BOUNDED. At most max_keys addresses, least recently seen evicted
first. Evicting an address forgets its history, which errs toward letting it
through: the table can never refuse someone because it is full.

Not thread safe, and it does not need to be: the middleware calls take() on the
event loop and take() never awaits, so two calls cannot interleave.
"""

from __future__ import annotations

import ipaddress
import math
import os
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Callable, Iterable

DEFAULT_PER_MINUTE = 120
DEFAULT_MAX_KEYS = 20_000
DEFAULT_IP_HEADER = "true-client-ip"
DEFAULT_EXEMPT_PATHS = (
    "/api/telegram/webhook",   # Telegram's servers, a few shared addresses
    "/api/admin/*",            # GitHub Actions, gated by BATCH_TRIGGER_SECRET
    "/api/health",             # uptime monitors; answers a constant
    # Not /api/status: it runs an uncached Mongo query and live external checks
    # on each call, so it is the route that most needs the limit.
    "/mcp",                    # vendors' shared ranges; its own global cap applies
)
WINDOW_SECONDS = 60.0
# The one bucket every request without a usable address shares.
UNKNOWN_KEY = "unknown"


def per_minute_from_env(name: str = "RATE_LIMIT_PER_IP_PER_MINUTE",
                        default: int = DEFAULT_PER_MINUTE) -> int:
    """Exactly 0 means off. Unset, unreadable or negative means the default,
    the same reading as MCP_RATE_LIMIT_PER_MINUTE: a mistake leaves the limit
    in place rather than removing it."""
    raw = (os.environ.get(name) or "").strip()
    try:
        n = int(raw) if raw else default
    except ValueError:
        return default
    if n == 0:
        return 0
    return n if n > 0 else default


# ── who a request is from ────────────────────────────────────────────────────
@dataclass(frozen=True)
class IpRule:
    kind: str                       # "header" or "peer"
    header: bytes = b""             # lower case, as ASGI delivers it
    from_right: int | None = None   # None: the value must be one address

    def describe(self) -> str:
        if self.kind == "peer":
            return "peer"
        name = self.header.decode()
        return f"{name}:{self.from_right}" if self.from_right else name


def parse_ip_rule(raw: str) -> IpRule:
    """`peer`, `<header>` or `<header>:<n>`. Raises ValueError on anything else."""
    text = (raw or "").strip().lower()
    if not text:
        raise ValueError("empty")
    if text == "peer":
        return IpRule("peer")
    name, _, n = text.partition(":")
    name = name.strip()
    if not name or not all(c.isalnum() or c == "-" for c in name):
        raise ValueError(f"not a header name: {name!r}")
    if not n:
        return IpRule("header", name.encode())
    if not n.strip().isdigit() or int(n) < 1:
        raise ValueError(f"not a position from the right: {n!r}")
    return IpRule("header", name.encode(), int(n))


def ip_rule_from_env(name: str = "RATE_LIMIT_IP_HEADER") -> tuple[IpRule, str | None]:
    """The rule, and a warning when the setting could not be read and the
    default was used instead."""
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return parse_ip_rule(DEFAULT_IP_HEADER), None
    try:
        return parse_ip_rule(raw), None
    except ValueError as e:
        return (parse_ip_rule(DEFAULT_IP_HEADER),
                f"{name}={raw!r} is not usable ({e}); using {DEFAULT_IP_HEADER}")


def normalise_ip(value: str | None) -> str | None:
    """One address as a key, or None when the text is not an address."""
    text = (value or "").strip()
    if not text:
        return None
    try:
        ip = ipaddress.ip_address(text)
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return str(ip.ipv4_mapped)
        return str(ipaddress.IPv6Network((ip, 64), strict=False))
    return str(ip)


def _header_value(headers: Iterable[tuple[bytes, bytes]], name: bytes) -> str | None:
    """Every occurrence of the header, joined in order, as one list would be."""
    parts = [v.decode("latin-1") for k, v in headers if k.lower() == name]
    return ",".join(parts) if parts else None


def client_key(headers: Iterable[tuple[bytes, bytes]], peer: str | None,
               rule: IpRule) -> tuple[str, str]:
    """(key, where it came from). The key is never empty.

    A header rule that finds no usable value gives UNKNOWN_KEY, never the
    peer: see the note at the top of this module."""
    headers = list(headers or [])
    if rule.kind == "peer":
        key = normalise_ip(peer)
        return (key, "peer") if key else (UNKNOWN_KEY, "peer, no address")
    raw = _header_value(headers, rule.header)
    if raw is None:
        return UNKNOWN_KEY, "shared bucket, header absent"
    entries = [e.strip() for e in raw.split(",")]
    if rule.from_right is None:
        pick = entries[0] if len(entries) == 1 else None
    else:
        pick = entries[-rule.from_right] if len(entries) >= rule.from_right else None
    key = normalise_ip(pick)
    if key:
        return key, "header"
    return UNKNOWN_KEY, "shared bucket, header unreadable"


def explain(headers: Iterable[tuple[bytes, bytes]], peer: str | None,
            rule: IpRule) -> dict:
    """What the debug route shows: this request's own addresses, as each
    candidate source reports them, and which one the rule picked."""
    headers = list(headers or [])
    key, source = client_key(headers, peer, rule)
    return {
        "rule": rule.describe(),
        "key": key,
        "source": source,
        "seen": {
            "true-client-ip": _header_value(headers, b"true-client-ip"),
            "cf-connecting-ip": _header_value(headers, b"cf-connecting-ip"),
            "x-forwarded-for": _header_value(headers, b"x-forwarded-for"),
            "peer": peer,
        },
        "note": "This request's own addresses only. The route exists only "
                "while RATE_LIMIT_IP_DEBUG is set.",
    }


# ── which paths are not counted ─────────────────────────────────────────────
class ExemptPaths:
    """Exact paths, and prefixes written as `/prefix/*`."""

    def __init__(self, entries: Iterable[str]):
        exact, prefixes = set(), []
        for e in entries:
            e = e.strip()
            if not e:
                continue
            if e.endswith("/*"):
                prefixes.append(e[:-1])      # keeps the trailing slash
            else:
                exact.add(e)
        self.exact = frozenset(exact)
        self.prefixes = tuple(prefixes)

    def __contains__(self, path: str) -> bool:
        # startswith(()) is False, so no prefixes means exact matches only.
        return path in self.exact or path.startswith(self.prefixes)

    def describe(self) -> str:
        return ", ".join(sorted(self.exact) + [p + "*" for p in self.prefixes]) or "none"


def exempt_from_env(name: str = "RATE_LIMIT_EXEMPT_PATHS") -> ExemptPaths:
    """Unset means the defaults. Set means exactly what it says, so a value
    that adds a path has to repeat the defaults it wants to keep."""
    raw = os.environ.get(name)
    if raw is None:
        return ExemptPaths(DEFAULT_EXEMPT_PATHS)
    return ExemptPaths(raw.split(","))


# ── the limit ───────────────────────────────────────────────────────────────
class PerKeyLimiter:
    def __init__(self, per_minute: int, max_keys: int = DEFAULT_MAX_KEYS,
                 clock: Callable[[], float] = time.monotonic):
        self.per_minute = max(1, int(per_minute))
        self.max_keys = max(1, int(max_keys))
        self.clock = clock
        self.interval = WINDOW_SECONDS / self.per_minute
        # key -> the time its bucket is full again (the "theoretical arrival
        # time"). An entry at or before now is the same as no entry.
        self._tat: OrderedDict[str, float] = OrderedDict()
        self.evicted = 0
        self.refused = 0

    def __len__(self) -> int:
        return len(self._tat)

    def take(self, key: str) -> float:
        """0.0 when admitted. Otherwise the seconds until one request from
        this key would be, and nothing is charged."""
        now = self.clock()
        tat = self._tat.get(key)
        start = now if tat is None or tat < now else tat
        new = start + self.interval
        wait = new - now - WINDOW_SECONDS
        if wait > 1e-9:
            self.refused += 1
            self._tat.move_to_end(key)
            return wait
        self._tat[key] = new
        self._tat.move_to_end(key)
        while len(self._tat) > self.max_keys:
            self._tat.popitem(last=False)
            self.evicted += 1
        return 0.0

    @staticmethod
    def retry_after(wait: float) -> int:
        """Whole seconds for a Retry-After header, never below one."""
        return max(1, math.ceil(wait - 1e-9))

    def clear(self) -> None:
        self._tat.clear()
        self.evicted = 0
        self.refused = 0
