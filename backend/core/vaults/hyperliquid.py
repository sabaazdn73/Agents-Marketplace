"""
Hyperliquid and HyperEVM: the evidence behind "no qualifying vault".

Nothing on either qualifies today (PLAN-7 §3 and §7.2), and the page says so
with the reason. The reason is backed by live reads made on each run, so the
line never outlives the facts it rests on:

- Hyperliquid (HyperCore): `vaultDetails` for HLP on the public info API
  (weight 20). Its legacy user vaults and HLP trade crypto perps; HLP also
  supplies USDC in Earn (Hyperliquid docs). Neither holds a real-world asset.
- HyperEVM (chain 999, counted as EVM): the two published vault contracts
  found in the research are re-read at the latest block on
  rpc.hyperliquid.xyz/evm: Hyperbeat wVLP's deposit contract `paused()`, and
  Liminal xHYPE's `symbol()`.

Only the fields named below are kept. No APY or performance field is stored.
"""

from __future__ import annotations

import datetime as dt

import httpx

INFO_URL = "https://api.hyperliquid.xyz/info"
EVM_URL = "https://rpc.hyperliquid.xyz/evm"
HLP = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303"
WVLP_TOKEN = "0xD66d69c288d9a6FD735d7bE8b2e389970fC4fD42"
WVLP_DEPOSIT = "0xc800f672EE8693BC0138E513038C84fe2D1B8a78"
XHYPE_SHARES = "0xac962fa04bf91b7fd0dc0c5c32414e0ce3c51e03"
DOCS = "https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults"
LEGACY_DOCS = "https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/for-vault-leaders-legacy"


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def hypercore_row(client: httpx.Client) -> dict:
    as_of = _now()
    try:
        r = client.post(INFO_URL, json={"type": "vaultDetails", "vaultAddress": HLP})
        r.raise_for_status()
        d = r.json()
        evidence = {"call": "info vaultDetails", "vault": HLP, "read_at": as_of,
                    "name": d.get("name"), "is_closed": d.get("isClosed"), "leader": d.get("leader"),
                    "child_vaults": len(((d.get("relationship") or {}).get("data") or {}).get("childAddresses") or [])}
        ok = True
    except (httpx.HTTPError, ValueError) as e:
        evidence = {"call": "info vaultDetails", "vault": HLP, "read_at": as_of,
                    "unreachable": f"{type(e).__name__} from api.hyperliquid.xyz"}
        ok = False
    return {
        "platform": "Hyperliquid", "platform_key": "hyperliquid", "chain": "Hyperliquid", "group": "nonevm",
        "status": "none_qualifying", "listed": 0, "as_of": as_of[:10],
        "reason": ("A Hyperliquid vault does not take a stablecoin deposit to lend it: HLP and the legacy user "
                   "vaults trade crypto perpetuals at their leader's discretion (legacy vaults trade "
                   "validator-operated perps only and cannot trade spot or HIP-3, per Hyperliquid's docs). "
                   "HIP-3 equity markets are perpetuals tracking a stock, not the stock."),
        "reason_class": "D", "sources": [LEGACY_DOCS, DOCS], "sources_read_on": "2026-09-25",
        "evidence": evidence, "evidence_ok": ok,
    }


def _eth(client: httpx.Client, method: str, params: list):
    r = client.post(EVM_URL, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    r.raise_for_status()
    d = r.json()
    if "error" in d:
        return {"error": str(d["error"].get("message", "error"))[:100]}
    return d["result"]


def _abi_string(hexs: str) -> str | None:
    try:
        b = bytes.fromhex(hexs[2:])
        n = int.from_bytes(b[32:64], "big")
        return b[64:64 + n].decode("utf-8", "replace")
    except (ValueError, TypeError):
        return None


def hyperevm_row(client: httpx.Client) -> dict:
    as_of = _now()
    try:
        block = int(_eth(client, "eth_blockNumber", []), 16)
        tag = "latest"  # the official RPC serves latest state only; the block is recorded above
        paused = _eth(client, "eth_call", [{"to": WVLP_DEPOSIT, "data": "0x5c975abb"}, tag])
        sym_w = _eth(client, "eth_call", [{"to": WVLP_TOKEN, "data": "0x95d89b41"}, tag])
        sym_x = _eth(client, "eth_call", [{"to": XHYPE_SHARES, "data": "0x95d89b41"}, tag])
        evidence = {
            "chain_id": 999, "block": block, "read_at": as_of, "rpc": "rpc.hyperliquid.xyz/evm",
            "wvlp": {"token": WVLP_TOKEN, "symbol": _abi_string(sym_w) if isinstance(sym_w, str) else None,
                     "deposit_contract": WVLP_DEPOSIT,
                     "paused": (int(paused, 16) == 1) if isinstance(paused, str) else None},
            "xhype": {"share_manager": XHYPE_SHARES,
                      "symbol": _abi_string(sym_x) if isinstance(sym_x, str) else None,
                      "symbol_call": None if isinstance(sym_x, str) else sym_x},
        }
        ok = True
    except (httpx.HTTPError, ValueError, TypeError) as e:
        evidence = {"chain_id": 999, "read_at": as_of, "unreachable": f"{type(e).__name__} from rpc.hyperliquid.xyz"}
        ok = False
    return {
        "platform": "HyperEVM", "platform_key": "hyperevm", "chain": "HyperEVM", "group": "evm",
        "status": "none_qualifying", "listed": 0, "as_of": as_of[:10],
        "reason": _evm_reason(evidence),
        "reason_class": "A and D", "sources": [DOCS], "sources_read_on": "2026-09-25",
        "evidence": evidence, "evidence_ok": ok,
    }


def _evm_reason(ev: dict) -> str:
    w = ev.get("wvlp") or {}
    x = ev.get("xhype") or {}
    p = w.get("paused")
    wv = {True: "its deposit contract reads paused() = true, so it takes no deposits (its docs say it is being unwound)",
          False: "its deposit contract reads paused() = false, but its trading path is not established",
          None: "its deposit contract's paused() was not read this run"}[p]
    return ("Two published HyperEVM vault contracts were read. Hyperbeat wVLP: " + wv + ". Liminal xHYPE (share "
            f"token {x.get('symbol') or 'unread'}): a HYPE-denominated strategy, not a stablecoin deposit. Neither "
            "has verified source on Sourcify, so neither's trading path is established.")


def collect() -> list[dict]:
    with httpx.Client(timeout=20.0, headers={"content-type": "application/json"}) as c:
        return [hypercore_row(c), hyperevm_row(c)]
