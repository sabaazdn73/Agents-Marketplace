#!/usr/bin/env python3
"""
gateway.py — the container's public edge for the Practice Layer's Anvil fork.

Anvil binds ONLY to 127.0.0.1:8545 inside the container. This gateway is the
only thing listening on the container's PUBLIC port ($PORT). It has three doors:

  POST /  (or /rpc)  PUBLIC, no auth. Forwards a JSON-RPC call to Anvil ONLY if
                     its method is in SAFE_METHODS. Admin cheat methods
                     (anvil_*, hardhat_*, evm_*) are refused with 403, so the
                     public internet can never fund/impersonate on the fork.

  POST /admin/rpc    AUTHENTICATED. Requires header X-Admin-Key == the env
                     PRACTICE_ADMIN_KEY (constant-time compare). Forwards ANY
                     method to Anvil unfiltered. Only our backend knows the key;
                     this is how funding (anvil_setBalance + whale impersonation)
                     actually reaches Anvil.

  GET  /health       200, for Render's health check.

Stdlib only (no pip deps) so the image stays tiny and the edge is easy to audit.
"""
import hmac
import json
import os
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ANVIL_URL = "http://127.0.0.1:8545"
ADMIN_KEY = os.environ.get("PRACTICE_ADMIN_KEY", "")
PORT = int(os.environ.get("PORT", "10000"))

# Exactly the methods the browser's practice wallet (viem) needs: reads, fee/gas
# estimation, and submitting an already-SIGNED tx. No unsigned sends, no cheats.
SAFE_METHODS = {
    "eth_chainId", "eth_blockNumber", "eth_gasPrice", "eth_maxPriorityFeePerGas",
    "eth_feeHistory", "eth_estimateGas", "eth_call", "eth_getBalance",
    "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount",
    "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs",
    "eth_getBlockByNumber", "eth_getBlockByHash", "eth_sendRawTransaction",
    "net_version", "web3_clientVersion",
}


def _forward(body_bytes):
    """Forward a raw JSON-RPC body to the internal Anvil and return (status, bytes)."""
    req = urllib.request.Request(
        ANVIL_URL, data=body_bytes,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.rstrip("/") in ("", "/health", "/healthz"):
            return self._send(200, {"ok": True, "service": "anvil-practice-gateway"})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b""

        # ── Authenticated admin door: unfiltered passthrough ──
        if self.path.rstrip("/") == "/admin/rpc":
            key = self.headers.get("X-Admin-Key", "")
            if not ADMIN_KEY or not hmac.compare_digest(key, ADMIN_KEY):
                return self._send(401, {"error": "unauthorized"})
            try:
                status, out = _forward(raw)
            except Exception as e:
                return self._send(502, {"error": f"anvil unreachable: {e}"})
            return self._send(status, out)

        # ── Public door: method allow-list ──
        try:
            parsed = json.loads(raw or b"{}")
        except Exception:
            return self._send(400, {"error": "invalid json"})
        calls = parsed if isinstance(parsed, list) else [parsed]
        for c in calls:
            method = c.get("method") if isinstance(c, dict) else None
            if method not in SAFE_METHODS:
                return self._send(403, {"error": f"method not allowed on the public edge: {method}"})
        try:
            status, out = _forward(raw)
        except Exception as e:
            return self._send(502, {"error": f"anvil unreachable: {e}"})
        return self._send(status, out)

    def log_message(self, *args):  # keep container logs quiet
        pass


if __name__ == "__main__":
    print(f"[gateway] listening on 0.0.0.0:{PORT} -> {ANVIL_URL} "
          f"(admin key configured: {'yes' if ADMIN_KEY else 'NO — /admin/rpc will 401'})",
          flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
