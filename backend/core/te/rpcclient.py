"""
rpcclient.py

A small synchronous JSON-RPC client for the cost worker: one instance per
chain, paced, counted, and with failover. It runs inside a worker thread
(asyncio.to_thread), never in a request.

Why not core/rpc.py's chain_rpc_post: that one is async, built for the web
process's short reads, and has no pacing. The cost refresh makes about 150
calls in a row on Robinhood Chain, whose public RPC answers sustained
sequential traffic with 429, so it needs a floor on the interval between
calls and a retry that waits.

What counts as a transient failure (retried, then failed over):
- any transport error or timeout;
- HTTP 429 and HTTP 5xx;
- a JSON-RPC error inside an HTTP 200 whose code is -32005 (limit exceeded),
  -32603 (internal error) or 429, or whose message says rate limit,
  timed out or temporarily. A keyed provider answered -32603 intermittently
  in T0, and a rate limit can arrive as -32005 inside a 429.
Anything else (an execution revert, a malformed request, "historical state
not available") is returned to the caller as an RpcError at once: another
node would say the same thing.

Keys: an endpoint is only ever logged or returned by its label (the host),
and every error string is passed through redact(). The engine uses public
endpoints only; the redaction stays as a guard.

Deadline: a client made with `deadline` (a time.monotonic() value) checks it
before every attempt and caps each request's timeout at the time left, and
raises RpcError(kind="deadline") once it has passed. A job running in a
thread therefore stops at its deadline, rather than running on after the
caller's asyncio timeout has given up on it.

public_reason() turns an error into a short category for anything served
publicly; an upstream error body is never served.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field

import httpx

log = logging.getLogger("te.rpc")

_TRANSIENT_CODES = {-32005, -32603, 429}

# An endpoint that answered HTTP 402 (a spent quota) is
# skipped by every client in this process for this long.
_QUOTA_SKIP_SECONDS = 1800
_quota_spent: dict[str, float] = {}
_TRANSIENT_WORDS = ("rate limit", "rate-limit", "too many", "timed out", "timeout", "temporar", "try again")


def _secret_values() -> list[str]:
    out = []
    for k, v in os.environ.items():
        if v and len(v) >= 12 and any(s in k for s in ("KEY", "SECRET", "TOKEN", "URL", "URI")):
            out.append(v)
    m = re.match(r"https://lb\.drpc\.live/[a-z0-9-]+/(.+)$", os.environ.get("FORK_RPC_URL", ""))
    if m:
        out.append(m.group(1))
    return out


def redact(s: str) -> str:
    s = str(s)
    for v in _secret_values():
        if v in s:
            s = s.replace(v, "<redacted>")
    # Anything that still looks like a URL path segment of 24+ hex/alnum chars.
    return re.sub(r"(/v3/|/v2/)[A-Za-z0-9]{16,}", r"\1<redacted>", s)


def public_reason(e: "RpcError | Exception") -> str:
    """A short, fixed-vocabulary account of a failure, safe to serve."""
    kind = getattr(e, "kind", None)
    code = getattr(e, "code", None)
    msg = str(getattr(e, "message", e)).lower()
    if kind == "deadline":
        return "stopped at the run's deadline"
    if code == 402 or "payment required" in msg or "quota" in msg:
        return "the provider's quota is spent"
    if code == 429 or "rate" in msg or "too many" in msg:
        return "rate limited by the provider"
    if "range" in msg or "exceeds" in msg or "limit" in msg:
        return "the provider refused the block range"
    if "timeout" in msg or "timed out" in msg:
        return "the provider timed out"
    if "not available" in msg or "missing trie" in msg or "pruned" in msg or "archive" in msg or "unknown state" in msg:
        return "the provider no longer holds that block's state"
    return "RPC error"


class RpcError(Exception):
    def __init__(self, kind: str, message: str, endpoint: str | None = None, code: int | None = None):
        super().__init__(f"{kind}: {message}")
        self.kind = kind            # "transient" | "rpc" | "decode"
        self.message = redact(message)
        self.endpoint = endpoint
        self.code = code


@dataclass
class Endpoint:
    label: str   # safe to log: host only, never the key
    url: str


@dataclass
class CallStats:
    calls: int = 0
    by_endpoint: dict = field(default_factory=dict)
    by_method: dict = field(default_factory=dict)
    retries: int = 0
    failovers: int = 0
    errors: int = 0
    seconds: float = 0.0

    def as_dict(self) -> dict:
        return {"calls": self.calls, "by_endpoint": dict(self.by_endpoint), "by_method": dict(self.by_method),
                "retries": self.retries, "failovers": self.failovers, "errors": self.errors,
                "seconds": round(self.seconds, 2)}


def _is_transient_error(err: dict) -> bool:
    code = err.get("code")
    msg = str(err.get("message", "")).lower()
    return code in _TRANSIENT_CODES or any(w in msg for w in _TRANSIENT_WORDS)


class ChainRpc:
    """Paced JSON-RPC for one chain. `endpoints` in failover order."""

    def __init__(self, chain_id: int, endpoints: list[Endpoint], *, min_interval: float = 0.0,
                 retries_per_endpoint: int = 3, timeout: float = 30.0, deadline: float | None = None):
        if not endpoints:
            raise ValueError(f"no endpoint configured for chain {chain_id}")
        self.chain_id = chain_id
        self.endpoints = endpoints
        self.min_interval = min_interval
        self.retries = retries_per_endpoint
        self.timeout = timeout
        self.deadline = deadline
        self.stats = CallStats()
        self._last = 0.0
        self._lock = threading.Lock()
        self._client = httpx.Client(timeout=timeout, headers={"content-type": "application/json"})

    def close(self) -> None:
        self._client.close()

    def _pace(self) -> None:
        with self._lock:
            wait = self._last + self.min_interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()

    def call(self, method: str, params: list, *, timeout: float | None = None):
        t0 = time.monotonic()
        last: RpcError | None = None
        try:
            for i, ep in enumerate(self.endpoints):
                if time.monotonic() < _quota_spent.get(ep.label, 0) and i < len(self.endpoints) - 1:
                    continue
                if i > 0:
                    self.stats.failovers += 1
                for attempt in range(self.retries):
                    if attempt:
                        self.stats.retries += 1
                        time.sleep(min(10.0, 1.5 * (2 ** (attempt - 1))))
                    self._pace()
                    left = None if self.deadline is None else self.deadline - time.monotonic()
                    if left is not None and left <= 0.5:
                        raise RpcError("deadline", "the job's deadline passed", ep.label)
                    self.stats.calls += 1
                    self.stats.by_endpoint[ep.label] = self.stats.by_endpoint.get(ep.label, 0) + 1
                    self.stats.by_method[method] = self.stats.by_method.get(method, 0) + 1
                    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
                    try:
                        t = timeout or self.timeout
                        r = self._client.post(ep.url, content=json.dumps(body), timeout=min(t, left) if left else t)
                    except httpx.HTTPError as e:
                        last = RpcError("transient", f"{type(e).__name__}", ep.label)
                        continue
                    if r.status_code == 402:
                        # Quota spent: no retry will help today.
                        last = RpcError("transient", f"HTTP 402 {r.text[:200]}", ep.label, 402)
                        _quota_spent[ep.label] = time.monotonic() + _QUOTA_SKIP_SECONDS
                        break
                    if r.status_code == 429 or r.status_code >= 500:
                        last = RpcError("transient", f"HTTP {r.status_code} {r.text[:200]}", ep.label, r.status_code)
                        continue
                    try:
                        j = r.json()
                    except ValueError:
                        last = RpcError("transient", f"HTTP {r.status_code} non-JSON body", ep.label, r.status_code)
                        continue
                    if isinstance(j, dict) and "error" in j and j["error"] is not None:
                        err = j["error"] if isinstance(j["error"], dict) else {"message": str(j["error"])}
                        if _is_transient_error(err):
                            last = RpcError("transient", json.dumps(err)[:300], ep.label, err.get("code"))
                            continue
                        self.stats.errors += 1
                        raise RpcError("rpc", json.dumps(err)[:400], ep.label, err.get("code"))
                    if r.status_code >= 400:
                        # A 4xx without a JSON-RPC error: deterministic for this node,
                        # but another provider may accept it (dRPC's plan limits).
                        last = RpcError("rpc", f"HTTP {r.status_code} {r.text[:200]}", ep.label, r.status_code)
                        break
                    if not isinstance(j, dict) or "result" not in j:
                        last = RpcError("decode", f"no result field: {str(j)[:200]}", ep.label)
                        break
                    return j["result"]
            self.stats.errors += 1
            raise last or RpcError("transient", "no endpoint answered")
        finally:
            self.stats.seconds += time.monotonic() - t0

    # -- helpers ---------------------------------------------------------
    def block_number(self) -> int:
        return int(self.call("eth_blockNumber", []), 16)

    def eth_call(self, to: str, data: str, block: int | str = "latest", *, overrides: dict | None = None,
                 gas: int | None = None, sender: str | None = None, timeout: float | None = None) -> str:
        tx = {"to": to, "data": data}
        if gas:
            tx["gas"] = hex(gas)
        if sender:
            tx["from"] = sender
        tag = hex(block) if isinstance(block, int) else block
        params = [tx, tag] + ([overrides] if overrides else [])
        return self.call("eth_call", params, timeout=timeout)
