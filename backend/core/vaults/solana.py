"""
Solana primitives for the vault reader: base58, program-derived addresses,
the on-curve test, and a small paced JSON-RPC client.

Endpoint: Helius when HELIUS_API_KEY is set, otherwise the public
api.mainnet-beta.solana.com, used sparingly (one call at a time, paced).
publicnode is never used: it refuses getProgramAccounts, which the vault
discovery depends on.

The endpoint URL can carry a key, so it never appears in an error, a log
line or a stored document. Only `endpoint_name` does.

Synchronous on purpose: the collector runs it inside asyncio.to_thread in
the worker, never in the web request path.
"""

from __future__ import annotations

import base64
import hashlib
import os
import struct
import threading
import time

import httpx

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
SYSTEM_PROGRAM = "11111111111111111111111111111111"
TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
BPF_UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111"


def b58encode(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s


def b58decode(s: str) -> bytes:
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    body = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\0" * (len(s) - len(s.lstrip("1"))) + body


def pubkey(b: bytes, off: int = 0) -> str:
    return b58encode(b[off:off + 32])


def pk32(s: str) -> bytes:
    raw = b58decode(s)
    if len(raw) != 32:
        raise ValueError(f"not a 32-byte key: {s}")
    return raw


def u8(b, o): return b[o]
def u16(b, o): return struct.unpack_from("<H", b, o)[0]
def u32(b, o): return struct.unpack_from("<I", b, o)[0]
def u64(b, o): return struct.unpack_from("<Q", b, o)[0]
def i64(b, o): return struct.unpack_from("<q", b, o)[0]
def u128(b, o): return int.from_bytes(b[o:o + 16], "little")


# ed25519: an address is "on the curve" when it decompresses to a point. A
# program-derived address is by construction off the curve, so an on-curve
# authority is a key someone holds (a single key, inferred), and an
# off-curve one is owned by a program (for example a Squads vault).
_P = 2 ** 255 - 19
_D = (-121665 * pow(121666, _P - 2, _P)) % _P


def on_curve(key: bytes | str) -> bool:
    b = pk32(key) if isinstance(key, str) else key
    y = int.from_bytes(b, "little") & ((1 << 255) - 1)
    if y >= _P:
        return False
    u = (y * y - 1) % _P
    v = (_D * y * y + 1) % _P
    x2 = u * pow(v, _P - 2, _P) % _P
    if x2 == 0:
        return True
    return pow(x2, (_P - 1) // 2, _P) == 1


def find_pda(seeds: list[bytes], program: str) -> tuple[str, int]:
    prog = pk32(program)
    for bump in range(255, -1, -1):
        h = hashlib.sha256(b"".join(seeds) + bytes([bump]) + prog + b"ProgramDerivedAddress").digest()
        if not on_curve(h):
            return b58encode(h), bump
    raise ValueError("no PDA")


def anchor_disc(account_name: str) -> bytes:
    return hashlib.sha256(f"account:{account_name}".encode()).digest()[:8]


# Helius credit weights (https://www.helius.dev/docs/billing/credits.md, read
# 2026-09-26): standard calls 1 credit, getProgramAccounts 10. The public
# endpoint has no credits; the same weights are counted so a run's cost is
# known before a key is used.
CREDIT_WEIGHTS = {"getProgramAccounts": 10}


class RpcError(Exception):
    """A failed call. The message never contains the endpoint URL."""


class SolanaRpc:
    """One call at a time, at least `min_interval` seconds apart.

    Counts calls and response bytes so a run can report what it cost."""

    def __init__(self, url: str | None = None, min_interval: float | None = None, timeout: float = 45.0,
                 deadline_s: float | None = None):
        key = os.environ.get("HELIUS_API_KEY", "").strip()
        if url:
            self._url, self.endpoint_name = url, "custom"
        elif key:
            self._url, self.endpoint_name = f"https://mainnet.helius-rpc.com/?api-key={key}", "helius"
        else:
            self._url, self.endpoint_name = "https://api.mainnet-beta.solana.com", "api.mainnet-beta.solana.com"
        if min_interval is None:
            min_interval = 0.15 if self.endpoint_name == "helius" else 0.6
        self.min_interval = min_interval
        self.timeout = timeout
        self.calls = 0
        self.bytes = 0
        self.credits = 0
        # An overall deadline: past it every call fails at once, so a run ends
        # rather than merely stops being awaited.
        self.deadline = (time.monotonic() + deadline_s) if deadline_s else None
        self._last = 0.0
        self._lock = threading.Lock()
        self._client = httpx.Client(timeout=timeout, headers={"content-type": "application/json"})

    def close(self):
        self._client.close()

    def call(self, method: str, params: list):
        body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        last_err = "no attempt"
        for attempt in range(4):
            if self.deadline is not None and time.monotonic() >= self.deadline:
                raise RpcError(f"{method}: run deadline reached")
            with self._lock:
                wait = self._last + self.min_interval - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                self._last = time.monotonic()
                self.calls += 1
                self.credits += CREDIT_WEIGHTS.get(method, 1)
            timeout = self.timeout
            if self.deadline is not None:
                timeout = max(1.0, min(timeout, self.deadline - time.monotonic()))
            try:
                r = self._client.post(self._url, json=body, timeout=timeout)
            except httpx.HTTPError as e:
                last_err = f"{type(e).__name__} from {self.endpoint_name}"
                time.sleep(1.5 * (attempt + 1))
                continue
            self.bytes += len(r.content)
            if r.status_code == 429 or r.status_code >= 500:
                last_err = f"HTTP {r.status_code} from {self.endpoint_name}"
                time.sleep(3.0 * (attempt + 1))
                continue
            if r.status_code != 200:
                raise RpcError(f"HTTP {r.status_code} from {self.endpoint_name} on {method}")
            d = r.json()
            if "error" in d:
                msg = str(d["error"].get("message", ""))[:160] if isinstance(d["error"], dict) else "error"
                raise RpcError(f"{method} refused by {self.endpoint_name}: {msg}")
            return d["result"]
        raise RpcError(f"{method}: {last_err}")

    # ── helpers ──
    def slot(self) -> int:
        return int(self.call("getSlot", [{"commitment": "confirmed"}]))

    def multiple(self, keys: list[str], data_slice: tuple[int, int] | None = None,
                 batch: int = 100) -> tuple[int, dict[str, dict | None]]:
        """{key: {"owner", "data" (bytes), "lamports"} or None}; returns the
        lowest context slot across batches."""
        out: dict[str, dict | None] = {}
        slot = None
        keys = list(dict.fromkeys(keys))
        for i in range(0, len(keys), batch):
            chunk = keys[i:i + batch]
            cfg: dict = {"encoding": "base64", "commitment": "confirmed"}
            if data_slice:
                cfg["dataSlice"] = {"offset": data_slice[0], "length": data_slice[1]}
            res = self.call("getMultipleAccounts", [chunk, cfg])
            s = int(res["context"]["slot"])
            slot = s if slot is None else min(slot, s)
            for k, v in zip(chunk, res["value"]):
                out[k] = None if v is None else {
                    "owner": v["owner"], "lamports": v["lamports"],
                    "data": base64.b64decode(v["data"][0]),
                }
        return (slot or 0), out

    def program_accounts(self, program: str, filters: list, data_slice: tuple[int, int] | None = None
                         ) -> tuple[int, list[tuple[str, bytes]]]:
        cfg: dict = {"encoding": "base64", "withContext": True, "commitment": "confirmed", "filters": filters}
        if data_slice:
            cfg["dataSlice"] = {"offset": data_slice[0], "length": data_slice[1]}
        res = self.call("getProgramAccounts", [program, cfg])
        return int(res["context"]["slot"]), [
            (a["pubkey"], base64.b64decode(a["account"]["data"][0])) for a in res["value"]
        ]

    def token_accounts_by_owner(self, owner: str, program: str | None = None, mint: str | None = None
                                ) -> tuple[int, list[dict]]:
        flt = {"mint": mint} if mint else {"programId": program}
        res = self.call("getTokenAccountsByOwner", [owner, flt,
                                                    {"encoding": "jsonParsed", "commitment": "confirmed"}])
        rows = []
        for a in res["value"]:
            info = a["account"]["data"]["parsed"]["info"]
            ta = info["tokenAmount"]
            rows.append({"account": a["pubkey"], "mint": info["mint"], "raw": int(ta["amount"]),
                         "decimals": int(ta["decimals"])})
        return int(res["context"]["slot"]), rows


def memcmp(offset: int, raw: bytes) -> dict:
    return {"memcmp": {"offset": offset, "bytes": b58encode(raw)}}
