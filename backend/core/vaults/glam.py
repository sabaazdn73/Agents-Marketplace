"""
GLAM vaults, read on chain.

Discovery: getProgramAccounts on the GLAM protocol program, filtered by the
StateAccount discriminator, with a slice that reaches base_asset_mint (a
fixed offset, 154: disc 8, account_type 1, enabled 1, vault 32, owner 32,
portfolio_manager_name 32, created 48). One call covers the platform.

Full states are Borsh; they are decoded with the types reachable from
StateAccount in GLAM's IDL (glam_state_types.json, trimmed from IDL 1.0.4).

TVL: the stablecoin balances of the vault's own token accounts
(getTokenAccountsByOwner on the vault PDA, both token programs). A vault
with positions in other protocols (external_positions) is not listed,
because those positions are not valued here and a token-account total would
understate it.
"""

from __future__ import annotations

import json
import os

from . import catalog
from .solana import (
    TOKEN_2022_PROGRAM, TOKEN_PROGRAM, SolanaRpc, b58encode, memcmp, pubkey,
)

GLAM_PROTOCOL = "GLAMpaME8wdTEzxtiYEAa5yD8fZbxZiz2hNtV58RZiEz"
GLAM_PROGRAMS = [
    GLAM_PROTOCOL,
    "GM1NtvvnSXUptTrMCqbogAdZJydZSNv98DoU5AZVLmGh",  # mint
    "gConFzxKL9USmwTdJoeQJvfKmqhJ2CyUaXTyQ8v9TGX",  # config
    "po1iCYakK3gHCLbuju4wGzFowTMpAJxkqK1iwUqMonY",  # policies
    "G1NTcMDYgNLpDwgnrpSZvoSKQuR9NXG7S3DmtNQCDmrK",  # CCTP
    "G1NTkDEUR3pkEqGCKZtmtmVzCUEdYa86pezHkwYbLyde",  # Kamino
    "G1NTsQ36mjPe89HtPYqxKsjY5HmYsDR6CbD2gd2U2pta",  # SPL
    "G1NTMNMgmgJAWAD9G3toFVMtNcc21dEyHf3fTXc3t74t",  # Marinade
]
INTEGRATIONS = {
    GLAM_PROTOCOL: "GLAM protocol (system, stake, swap)",
    "GM1NtvvnSXUptTrMCqbogAdZJydZSNv98DoU5AZVLmGh": "GLAM Mint",
    "G1NTcMDYgNLpDwgnrpSZvoSKQuR9NXG7S3DmtNQCDmrK": "CCTP bridge",
    "G1NTkDEUR3pkEqGCKZtmtmVzCUEdYa86pezHkwYbLyde": "Kamino",
    "G1NTsQ36mjPe89HtPYqxKsjY5HmYsDR6CbD2gd2U2pta": "SPL token transfers",
    "G1NTMNMgmgJAWAD9G3toFVMtNcc21dEyHf3fTXc3t74t": "Marinade",
    "G1NTdrBmBpW43msRQmsf7qXSw3MFBNaqJcAkGiRmRq2F": "Drift",
}
DRIFT_INTEGRATIONS = {"G1NTdrBmBpW43msRQmsf7qXSw3MFBNaqJcAkGiRmRq2F"}
BRIDGE_INTEGRATIONS = {"G1NTcMDYgNLpDwgnrpSZvoSKQuR9NXG7S3DmtNQCDmrK", "G1NTbnLcjMex9Tjo8ocmNK9S2zBCiGVuxKUUNGhYZztx"}

with open(os.path.join(os.path.dirname(__file__), "glam_state_types.json")) as _f:
    _IDL = json.load(_f)
TYPES = _IDL["types"]
DISC = bytes(_IDL["discriminator"])
_PRIM = {"u8": (1, False), "i8": (1, True), "u16": (2, False), "i16": (2, True), "u32": (4, False),
         "i32": (4, True), "u64": (8, False), "i64": (8, True), "u128": (16, False), "i128": (16, True)}


class _Reader:
    def __init__(self, b: bytes, o: int = 0):
        self.b, self.o = b, o

    def take(self, n: int) -> bytes:
        if self.o + n > len(self.b):
            raise ValueError("borsh: past end of account")
        v = self.b[self.o:self.o + n]
        self.o += n
        return v


def _dec(r: _Reader, t):
    if isinstance(t, str):
        if t in _PRIM:
            n, sg = _PRIM[t]
            return int.from_bytes(r.take(n), "little", signed=sg)
        if t == "bool":
            return r.take(1)[0] == 1
        if t == "pubkey":
            return b58encode(r.take(32))
        if t == "string":
            n = int.from_bytes(r.take(4), "little")
            return r.take(n).decode("utf-8", "replace")
        if t == "bytes":
            n = int.from_bytes(r.take(4), "little")
            return r.take(n).hex()
        raise ValueError(f"borsh: type {t}")
    if "vec" in t:
        n = int.from_bytes(r.take(4), "little")
        if n > 4096:
            raise ValueError("borsh: implausible vec length")
        return [_dec(r, t["vec"]) for _ in range(n)]
    if "option" in t:
        return _dec(r, t["option"]) if r.take(1)[0] else None
    if "array" in t:
        et, n = t["array"]
        if et == "u8":
            return r.take(n)
        return [_dec(r, et) for _ in range(n)]
    if "defined" in t:
        td = TYPES[t["defined"]["name"]]
        if td["kind"] == "struct":
            fs = td.get("fields", [])
            if fs and isinstance(fs[0], dict):
                return {f["name"]: _dec(r, f["type"]) for f in fs}
            return [_dec(r, f) for f in fs]
        v = td["variants"][r.take(1)[0]]
        fs = v.get("fields")
        if not fs:
            return v["name"]
        if isinstance(fs[0], dict):
            return {v["name"]: {f["name"]: _dec(r, f["type"]) for f in fs}}
        return {v["name"]: [_dec(r, f) for f in fs]}
    raise ValueError(f"borsh: type {t}")


def decode_state(data: bytes) -> dict:
    if data[:8] != DISC:
        raise ValueError("not a GLAM StateAccount")
    s = _dec(_Reader(data, 8), {"defined": {"name": "StateAccount"}})
    s["name"] = s["name"].rstrip(b"\0").decode("utf-8", "replace").strip()
    s["portfolio_manager_name"] = s["portfolio_manager_name"].rstrip(b"\0").decode("utf-8", "replace").strip()
    return s


def _param(state: dict, name: str):
    for group in state.get("params") or []:
        for f in group:
            if f.get("name") == name:
                v = f["value"]
                return next(iter(v.values()))["val"] if isinstance(v, dict) else v
    return None


def collect(rpc: SolanaRpc, resolver) -> dict:
    d_slot, rows = rpc.program_accounts(GLAM_PROTOCOL, [memcmp(0, DISC)], data_slice=(0, 186))
    excluded: dict[str, int] = {}
    named: list[dict] = []

    def ex(reason):
        excluded[reason] = excluded.get(reason, 0) + 1

    cands = []
    for a, d in rows:
        if pubkey(d, 154) in catalog.STABLECOINS:
            cands.append(a)
        else:
            ex("base asset is not a stablecoin")
    f_slot, fulls = rpc.multiple(cands, batch=10)
    survivors = []
    for a in cands:
        v = fulls.get(a)
        try:
            s = decode_state(v["data"]) if v else None
        except ValueError:
            s = None
        if not s:
            ex("state unreadable")
            continue
        ints = {x["integration_program"] for x in s["integration_acls"]}
        if s["account_type"] not in ("TokenizedVault", "SingleAssetVault"):
            ex("not a tokenized vault (no share token; a managed account)")
        elif not s["enabled"]:
            ex("disabled by its owner")
        elif catalog.looks_like_test(s["name"]):
            ex("named as a test, staging or demo vault")
        elif ints & DRIFT_INTEGRATIONS:
            ex("Drift integration enabled (excluded by the owner's rule)")
        elif ints & BRIDGE_INTEGRATIONS:
            ex("bridge integration enabled: assets can move off Solana, where they are not read")
        elif any(m not in catalog.STABLECOINS for m in s["assets"]):
            ex("assets allowlist includes non-stablecoin tokens")
        elif s["external_positions"]:
            ex("holds positions in other protocols that this reader does not value")
        else:
            survivors.append((a, s))
    keep = []
    h_slot = None
    for a, s in survivors:
        holdings = []
        for prog in (TOKEN_PROGRAM, TOKEN_2022_PROGRAM):
            slot, accts = rpc.token_accounts_by_owner(s["vault"], prog)
            h_slot = slot if h_slot is None else min(h_slot, slot)
            holdings += [x for x in accts if x["raw"] > 0]
        if any(x["mint"] not in catalog.STABLECOINS for x in holdings):
            ex("holds non-stablecoin tokens")
            continue
        tokens = sum(x["raw"] / 10 ** x["decimals"] for x in holdings)
        if tokens < catalog.MIN_TVL_TOKENS:
            ex(f"empty or under {catalog.MIN_TVL_TOKENS:,} tokens")
            continue
        keep.append((a, s, holdings, tokens))
    who = resolver.resolve([s["owner"] for _, s, _, _ in keep]) if keep else {}
    docs = [_doc(a, s, h, t, who, {"discovery": d_slot, "state": f_slot, "holdings": h_slot})
            for a, s, h, t in keep]
    return {"vaults": docs, "excluded": excluded, "named_exclusions": named,
            "read": {"discovered": len(rows), "stablecoin_based": len(cands), "slot": d_slot}}


def _doc(addr, s, holdings, tokens, who, slots) -> dict:
    base = s["base_asset_mint"]
    sym = catalog.token_symbol(base)
    face = all(catalog.STABLECOINS[x["mint"]]["usd_face"] for x in holdings)
    fs = _param(s, "FeeStructure") or {}
    ns = _param(s, "NotifyAndSettle")
    owner = who.get(s["owner"])
    fee_text = "not set in the vault state"
    if fs:
        fee_text = (f"{fs['performance']['fee_bps'] / 100:g}% performance, {fs['management']['fee_bps'] / 100:g}% management, "
                    f"{(fs['vault']['subscription_fee_bps'] + fs['manager']['subscription_fee_bps']) / 100:g}% in, "
                    f"{(fs['vault']['redemption_fee_bps'] + fs['manager']['redemption_fee_bps']) / 100:g}% out; "
                    f"protocol {fs['protocol']['base_fee_bps'] / 100:g}% base")
    if ns:
        unit = "slots" if ns.get("time_unit") == "Slot" else "s"
        lock_text = f"Redemption notice {ns['redeem_notice_period']} {unit}, settlement {ns['redeem_settlement_period']} {unit}"
    else:
        lock_text = "No notice-and-settle parameter in the vault state"
    lock_text += f"; state-change timelock {s['timelock_duration']} s"
    return {
        "_id": f"glam:{addr}", "kind": "vault", "platform": "GLAM", "platform_key": "glam",
        "chain": "Solana", "group": "nonevm", "address": addr, "program": GLAM_PROTOCOL, "name": s["name"],
        "sort_key": f"glam|{s['name'].lower()}|{addr}",
        **({"curator": {"name": s["portfolio_manager_name"], "class": "D",
                        "basis": "the vault's own on-chain portfolio_manager_name field, as set by its owner (self-declared)",
                        "slot": slots["state"]}} if s["portfolio_manager_name"] else {}),
        "token": {"mint": base, "symbol": sym, "decimals": s["base_asset_decimals"], "share_mint": s["mint"]},
        "slots": slots,
        "tvl": {"usd": round(tokens, 2) if face else None, "amount": round(tokens, 2), "symbol": sym,
                "slot": slots["holdings"], "source": "computed_from_chain",
                "basis": "sum of the vault PDA's stablecoin token-account balances, counted at 1 USD per token (face value, not a market price)",
                "holdings": holdings, "reconciliation": "our read of the vault's own token accounts", "partial": False},
        "fees": {"text": fee_text, "class": "A", "slot": slots["state"], "structure": fs},
        "lockup": {"text": lock_text, "class": "A", "slot": slots["state"], "notify_and_settle": ns},
        "manager": {"text": f"Owner: {owner['text'] if owner else 'unread'}", "class": "A", "slot": slots["state"],
                    "owner": owner, "portfolio_manager_name": s["portfolio_manager_name"],
                    "delegates": [{"key": d["pubkey"], "expires_at": d["expires_at"]} for d in s["delegate_acls"]]},
        "assets": {"text": f"{sym}; allowlist " + ", ".join(catalog.token_symbol(m) for m in s["assets"]),
                   "class": "A", "slot": slots["state"],
                   "integrations": [INTEGRATIONS.get(x["integration_program"], x["integration_program"]) for x in s["integration_acls"]]},
        "controls": {"class": "A", "slot": slots["state"], "admin": owner["text"] if owner else None,
                     "timelock_s": s["timelock_duration"],
                     "pause": {"text": f"enabled = {str(s['enabled']).lower()}", "class": "A", "slot": slots["state"]}},
        "audits": {"text": catalog.audits_text("glam"), "class": "D", **catalog.AUDITS["glam"]},
        "powers": {"class": "D", **catalog.POWERS["glam"]},
    }
