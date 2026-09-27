"""Re-reads, on public RPCs, the control claims the universe pass took from an
earlier pass without a block, so every served claim carries its own.

Run: ./venv/bin/python scripts/te_reread_controls.py --src <universe pass dir>

Writes <src>/reads/controls_reread.json, which scripts/te_build_universe.py
reads. Public endpoints only: no Infura key is used (it is shared with
production). One call at a time, paced.

What it reads:

  squads      the two Squads v4 multisigs behind the xStocks Solana freeze
              authority and permanent delegate: threshold, member count,
              time lock, and that vault 0 derived from each is the authority
              the mints name (PDA derivation checked here, not assumed).
  transfers   eth_call transfer(fresh address, 1 unit) from a pool that holds
              the token, for one token per programme where "is there an
              allowlist" was open or taken from an earlier pass: success means
              a never-used address can receive, so there is no allowlist on
              receipt. The fresh address is checked to have no transactions
              and no balance at the block.
  beacons     the Ondo beacons' implementation(), so the verified-source claims
              can name the contract they rest on.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import httpx
from nacl.bindings import crypto_core_ed25519_is_valid_point

PAUSE_S = 0.4
RPC = {
    "ethereum": ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
    "bsc": ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"],
    "base": ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    "robinhood": ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood-rpc.publicnode.com"],
    "solana": ["https://api.mainnet-beta.solana.com"],
}
SQUADS_PROGRAM = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"
MULTISIGS = {
    "8gep9m2BmCqz4qCQMcqZoqnaGedXgRWehFYhKaPuiu8X": "JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs",
    "Dsm8Dmh6ip3pc19G3oB3FBc2Kx7A9sQBSA2akD2Jraot": "5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq",
}
FRESH = "0x000000000000000000000000000000000000fff2"
POOL_MANAGER_V4 = {"ethereum": "0x000000000004444c5dc75cb358380d2e3de08a90"}
# One token per programme whose allowlist answer was open or earlier-pass.
TRANSFER_TOKENS = {
    "robinhood": ("robinhood", "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec"),
    "bstocks": ("bsc", "0x02fca66c1d1afb4e2a7884261eb00f63598a7436"),
    "ondo-ethereum": ("ethereum", "0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee"),
    "ondo-bsc": ("bsc", "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4"),
    "coinbase": ("base", "0xb20000000000000000000078ee7ce2fe4908108c"),
}
ONDO_BEACONS = {"ethereum": "0x985462c9aa4d6c3ad59ae6e1e9c0c11347ed1598", "bsc": "0xc046b05a920e4b412815934dd8e58904dda73315"}

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58d(s: str) -> bytes:
    n = 0
    for ch in s:
        n = n * 58 + B58.index(ch)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return b"\0" * (len(s) - len(s.lstrip("1"))) + raw


def b58e(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + out


def find_pda(seeds: list[bytes], program: str) -> str:
    prog = b58d(program)
    for bump in range(255, -1, -1):
        h = hashlib.sha256(b"".join(seeds) + bytes([bump]) + prog + b"ProgramDerivedAddress").digest()
        if not crypto_core_ed25519_is_valid_point(h):
            return b58e(h)
    raise ValueError("no PDA")


class Rpc:
    def __init__(self):
        self.c = httpx.Client(timeout=20)
        self.calls = 0

    def call(self, chain, method, params):
        last = None
        for url in RPC[chain]:
            time.sleep(PAUSE_S)
            self.calls += 1
            try:
                r = self.c.post(url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
                body = r.json()
                if "error" in body:
                    return {"error": body["error"], "rpc": url}
                return {"result": body["result"], "rpc": url}
            except Exception as e:  # noqa: BLE001
                last = f"{type(e).__name__} from {url}"
        return {"error": last}


def squads(rpc: Rpc) -> dict:
    out = {}
    for ms, authority in MULTISIGS.items():
        r = rpc.call("solana", "getAccountInfo", [ms, {"encoding": "base64", "commitment": "finalized"}])
        res = r.get("result") or {}
        v = res.get("value") or {}
        import base64
        data = base64.b64decode(v["data"][0]) if v else b""
        o = 8 + 32 + 32
        threshold = int.from_bytes(data[o:o + 2], "little"); o += 2
        time_lock = int.from_bytes(data[o:o + 4], "little"); o += 4
        o += 16  # transaction_index, stale_transaction_index
        o += 33 if data[o] == 1 else 1  # rent_collector Option<Pubkey>
        o += 1  # bump
        n = int.from_bytes(data[o:o + 4], "little")
        vault0 = find_pda([b"multisig", b58d(ms), b"vault", bytes([0])], SQUADS_PROGRAM)
        out[ms] = {
            "program_owner": v.get("owner"), "slot": res.get("context", {}).get("slot"),
            "threshold": threshold, "members": n, "time_lock_s": time_lock,
            "vault0": vault0, "vault0_is_authority": vault0 == authority, "authority": authority,
            "method": "getAccountInfo (finalized) on the Squads v4 multisig account, decoded; "
                      "vault 0 = PDA(['multisig', multisig, 'vault', 0], SQDS4ep6…)",
        }
    return out


def _call(rpc, chain, to, data, tag, frm=None):
    p = {"to": to, "data": data}
    if frm:
        p["from"] = frm
    return rpc.call(chain, "eth_call", [p, tag])


def transfers(rpc: Rpc, pools: dict) -> dict:
    out = {}
    for name, (chain, token) in TRANSFER_TOKENS.items():
        blk = int(rpc.call(chain, "eth_blockNumber", [])["result"], 16)
        tag = hex(blk)
        rid = next((k for k in pools if k.endswith(f":{chain}:{token}")), None)
        cands = [p.get("pool") for p in (pools.get(rid) or {}).get("pools", []) if p.get("pool")]
        if any(p.get("pool_id") for p in (pools.get(rid) or {}).get("pools", [])) and chain in POOL_MANAGER_V4:
            cands.append(POOL_MANAGER_V4[chain])
        holder, bal = None, 0
        for c in cands:
            r = _call(rpc, chain, token, "0x70a08231" + c[2:].rjust(64, "0"), tag)
            b = int(r.get("result") or "0x0", 16)
            if b > 0:
                holder, bal = c, b
                break
        nonce = int(rpc.call(chain, "eth_getTransactionCount", [FRESH, tag]).get("result") or "0x0", 16)
        fb = int((_call(rpc, chain, token, "0x70a08231" + FRESH[2:].rjust(64, "0"), tag).get("result")) or "0x0", 16)
        entry = {"chain": chain, "token": token, "block": blk, "from": holder, "from_balance_raw": str(bal),
                 "to": FRESH, "to_nonce": nonce, "to_balance_raw": str(fb),
                 "call": "eth_call transfer(to, 1) from `from` at `block`; nothing broadcast"}
        if holder:
            r = _call(rpc, chain, token, "0xa9059cbb" + FRESH[2:].rjust(64, "0") + "1".rjust(64, "0"), tag, holder)
            if "result" in r:
                entry["outcome"] = "success"
                entry["returned"] = r["result"]
            else:
                err = r.get("error") or {}
                entry["outcome"] = "reverted"
                entry["revert"] = {"code": err.get("code"), "message": err.get("message"), "data": err.get("data")} if isinstance(err, dict) else {"message": str(err)}
        else:
            entry["outcome"] = "not run: no pool found holding the token"
        out[name] = entry
    return out


def beacons(rpc: Rpc) -> dict:
    out = {}
    for chain, b in ONDO_BEACONS.items():
        blk = int(rpc.call(chain, "eth_blockNumber", [])["result"], 16)
        r = _call(rpc, chain, b, "0x5c60da1b", hex(blk))
        out[chain] = {"beacon": b, "implementation": "0x" + r["result"][-40:], "block": blk, "method": "implementation()"}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, type=Path)
    a = ap.parse_args()
    pools = json.loads((a.src / "universe_pools.json").read_bytes())["tokens"]
    rpc = Rpc()
    out = {"read_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "squads": squads(rpc), "transfers": transfers(rpc, pools), "ondo_beacons": beacons(rpc)}
    path = a.src / "reads" / "controls_reread.json"
    path.write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))
    print(f"{rpc.calls} calls; wrote {path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
