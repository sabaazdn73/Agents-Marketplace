"""
deliverable_proxy.py

Real, server-side proxy for fetching an ERC-8183 job's deliverable content.

Real, confirmed reason this exists (2026-08-24): job #56646's deliverable
showed "Couldn't load it automatically here (Failed to fetch)" in the UI even
though the content genuinely exists and is fetchable directly. Root cause,
confirmed live (not assumed): the explainer agent's endpoint has no CORS
support — a real OPTIONS preflight against it returns 405 with no
Access-Control-Allow-Origin header, and a plain GET with an Origin header
returns 200 with no Access-Control-Allow-Origin header either. That's the
same real gap erc8183_negotiate.py was built around (see that module's own
docstring) — no marketplace agent built on this SDK advertises CORS headers,
a reasonable default for a server meant to be called server-to-server. A
browser's own fetch() to such a URL is blocked by the browser itself before
the response body is ever readable, surfacing as the generic "Failed to
fetch" TypeError — nothing to do with the content actually being missing.

Fix: fetch the deliverable server-side (this module) and hand the real bytes
+ real content-type back to the browser from OUR OWN origin, which already
sends permissive CORS headers (server.py's CORSMiddleware, allow_origins=
["*"]). General on purpose — this proxies WHATEVER deliverable_url a job's
real on-chain record points to, not just this one agent's, so it fixes the
same failure mode for any ERC-8183 seller without CORS support.

Real security note: unlike erc8183_negotiate.py's proxy (which only ever
POSTs to a service_endpoint this backend itself resolved from agent_store),
the URL here is the on-chain deliverable_url a job's PROVIDER published —
i.e., attacker-influenced input from whoever held that provider wallet's key
at submit() time. A malicious provider could publish a deliverable_url
pointing at internal infrastructure and get this backend to fetch it on a
buyer's behalf (SSRF) if unguarded. Real mitigations below: only http(s),
resolve the hostname and reject private/loopback/link-local/reserved IPs,
no redirect-following (a redirect target isn't re-validated, so don't trust
it), a byte cap enforced while streaming (not just checked after download),
and a real timeout. This is a best-effort DNS-resolve-time check, not a
pinned-IP connection (a TOCTOU DNS-rebind is theoretically possible) — an
acceptable residual risk for a read-only proxy this bounded, not worth a
stricter implementation for what's fundamentally fetching PUBLIC deliverable
content, not executing anything.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

_TIMEOUT = 15.0
_MAX_BYTES = 5 * 1024 * 1024  # 5MB — comfortably covers a real deliverable (JSON/text/small image)


def _is_safe_public_host(hostname: str) -> bool:
    """Resolve `hostname` and reject it if ANY of its addresses are
    private/loopback/link-local/reserved/multicast/unspecified. Best-effort
    (see module docstring) — good enough for a bounded, read-only proxy."""
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False
    if not infos:
        return False
    for family, _type, _proto, _canon, sockaddr in infos:
        try:
            ip = ipaddress.ip_address(sockaddr[0])
        except ValueError:
            return False
        if (
            ip.is_private or ip.is_loopback or ip.is_link_local
            or ip.is_multicast or ip.is_reserved or ip.is_unspecified
        ):
            return False
    return True


class DeliverableProxyError(Exception):
    """Carries a real, user-facing reason + the HTTP status to answer with."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def fetch_deliverable(url: str) -> tuple[bytes, str, int]:
    """Real, guarded server-side fetch of a deliverable URL.

    Returns (content_bytes, content_type, status_code) on success. Raises
    DeliverableProxyError with a real, specific reason on any failure —
    the caller (server.py's route) turns that straight into an HTTPException.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise DeliverableProxyError(400, "url must be an absolute http(s) URL")
    if not _is_safe_public_host(parsed.hostname):
        raise DeliverableProxyError(400, "that host can't be reached through this proxy")

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
            async with client.stream("GET", url) as resp:
                if 300 <= resp.status_code < 400:
                    # A redirect target is UNVALIDATED input — don't follow it
                    # blindly (that would reopen the exact SSRF gap the host
                    # check above closes). A real deliverable URL is never
                    # expected to redirect; treat it as a real failure.
                    raise DeliverableProxyError(502, "that URL redirected — not supported through this proxy")
                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes():
                    total += len(chunk)
                    if total > _MAX_BYTES:
                        raise DeliverableProxyError(502, "response too large")
                    chunks.append(chunk)
                content = b"".join(chunks)
                content_type = resp.headers.get("content-type", "application/octet-stream")
                return content, content_type, resp.status_code
    except DeliverableProxyError:
        raise
    except httpx.HTTPError as e:
        raise DeliverableProxyError(502, f"couldn't reach that URL: {e}")
