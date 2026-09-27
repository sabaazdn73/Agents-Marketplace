"""
Voltr vaults, read on chain.

Discovery: getProgramAccounts on the Voltr vault program with dataSize 928
(every vault), and one more with dataSize 192 (every strategy receipt). Two
calls cover the platform; no platform API is read.

Vault layout (@voltr/vault-sdk 2.1.1, Codama): disc [211,8,232,43,2,152,117,119]
name[32]@8 asset.mint@104 asset.idleAta@136 asset.totalValue u64@168
pendingAdmin@336 manager@368 admin@400 maxCap@432 withdrawalWaitingPeriod@456
disabledOperations u16@464 fees 8 x u16@512 (manager performance, admin
performance, manager management, admin management, redemption, issuance,
protocol performance, protocol management) lastUpdatedTs@656
allowAnyAdaptor u8@665.
StrategyInitReceipt: disc [51,8,192,253,115,78,112,214] vault@8 strategy@40
adaptorProgram@72 positionValue u64@104 lastUpdatedTs@112.

TVL: the vault's own recorded asset.totalValue. It is a value the vault
writes when its manager (or a crank) touches a strategy, so it is labelled
"vault_recorded", with the time it was last written, and compared with the
idle account we read plus the receipts' recorded position values.
"""

from __future__ import annotations

import datetime as dt

from . import catalog
from .solana import SYSTEM_PROGRAM, SolanaRpc, find_pda, pk32, pubkey, u16, u64, u128

VOLTR = "vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8"
PROTOCOL_PDA = "4sycXz9Xwevedo6eiXR8QEhY8yrQrkNS4G1deY9tAD2Y"
VAULT_DISC = bytes([211, 8, 232, 43, 2, 152, 117, 119])
RECEIPT_DISC = bytes([51, 8, 192, 253, 115, 78, 112, 214])

# Adaptor programs named on https://docs.voltr.xyz/security/deployed-programs
# (read 2026-09-25).
ADAPTORS = {
    "aVoLTRCRt3NnnchvLYH6rMYehJHwM5m45RmLBZq7PGz": ("lending adaptor", "onchain"),
    "to6Eti9CsC5FGkAtqiPphvKD2hiQiLsS8zWiDBqBPKR": ("Kamino adaptor", "onchain"),
    "EW35URAx3LiM13fFK3QxAXfGemHso9HWPixrv7YDY4AM": ("Jupiter Lend adaptor", "onchain"),
    "EBN93eXs5fHGBABuajQqdsKRkCgaqtJa8vEFD6vKXiP": ("Drift adaptor", "drift"),
    "3pnpK9nrs1R65eMV1wqCXkDkhSgN18xb1G5pgYPwoZjJ": ("Trustful (CEX) adaptor", "offchain"),
    "A5a3Xo2JaKbXNShSHHP4Fe1LxcxNuCZs97gy3FJMSzkM": ("Raydium adaptor (program closed)", "closed"),
}
LENDING_ADAPTOR = "aVoLTRCRt3NnnchvLYH6rMYehJHwM5m45RmLBZq7PGz"
DRIFT_ADAPTOR = "EBN93eXs5fHGBABuajQqdsKRkCgaqtJa8vEFD6vKXiP"
TRUSTFUL_ADAPTOR = "3pnpK9nrs1R65eMV1wqCXkDkhSgN18xb1G5pgYPwoZjJ"
KVAULT = "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd"
JUPITER_LEND = "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9"
# A lending-adaptor strategy account (owned by the lending adaptor, 304 bytes)
# names the protocol it lends into at offset 136 (read on chain 2026-09-26:
# Drift, klend, marginfi and Solend all appear there). The adaptor alone does
# not say where the money goes; this does.
LENDING_TARGET_OFFSET = 136
LENDING_TARGETS = {
    "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH": ("Drift", "drift"),
    "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD": ("Kamino Lend (klend)", "onchain"),
    "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA": ("marginfi", "onchain"),
    "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo": ("Solend", "onchain"),
}


def strategy_target(receipt: dict, acct: dict | None) -> tuple[str, str, str | None]:
    """(where the money goes, class, target program) for one strategy.
    Class is one of onchain, kvault, drift, offchain, closed, unlisted."""
    ad = receipt["adaptor"]
    if ad == DRIFT_ADAPTOR:
        return "Drift", "drift", "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"
    if ad == TRUSTFUL_ADAPTOR:
        return "off-chain custodian (Trustful)", "offchain", None
    if acct is None:
        return "strategy account closed", "closed", None
    owner = acct["owner"]
    if owner == LENDING_ADAPTOR and len(acct["data"]) >= LENDING_TARGET_OFFSET + 32:
        prog = pubkey(acct["data"], LENDING_TARGET_OFFSET)
        name, cls = LENDING_TARGETS.get(prog, (f"unlisted program {prog[:8]}…", "unlisted"))
        return name, cls, prog
    if owner == KVAULT:
        return "Kamino vault", "kvault", KVAULT
    if owner == JUPITER_LEND:
        return "Jupiter Lend", "onchain", JUPITER_LEND
    return f"unlisted (strategy owned by {owner[:8]}…)", "unlisted", owner


FEE_NAMES = ["manager_performance", "admin_performance", "manager_management", "admin_management",
             "redemption", "issuance", "protocol_performance", "protocol_management"]


def decode_vault(d: bytes) -> dict:
    fees = dict(zip(FEE_NAMES, (u16(d, 512 + 2 * i) for i in range(8))))
    return {
        "name": d[8:40].rstrip(b"\0").decode("utf-8", "replace").strip(),
        "mint": pubkey(d, 104), "idle_ata": pubkey(d, 136), "total_value_raw": u64(d, 168),
        "pending_admin": pubkey(d, 336), "manager": pubkey(d, 368), "admin": pubkey(d, 400),
        "max_cap_raw": u64(d, 432), "withdrawal_waiting_s": u64(d, 456),
        "disabled_operations": u16(d, 464), "fees_bps": fees,
        "last_updated_ts": u64(d, 656), "allow_any_adaptor": d[665],
    }


def decode_receipt(d: bytes) -> dict:
    return {"vault": pubkey(d, 8), "strategy": pubkey(d, 40), "adaptor": pubkey(d, 72),
            "position_raw": u64(d, 104), "last_updated_ts": u64(d, 112)}


def _ts(t: int) -> str | None:
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ") if t else None


def _dur(s: int) -> str:
    if not s:
        return "none"
    if s % 86400 == 0:
        return f"{s // 86400} day(s)"
    if s % 3600 == 0:
        return f"{s // 3600} h"
    if s % 60 == 0:
        return f"{s // 60} min"
    return f"{s} s"


def collect(rpc: SolanaRpc, resolver) -> dict:
    v_slot, vrows = rpc.program_accounts(VOLTR, [{"dataSize": 928}])
    r_slot, rrows = rpc.program_accounts(VOLTR, [{"dataSize": 192}])
    receipts: dict[str, list] = {}
    for a, d in rrows:
        if d[:8] == RECEIPT_DISC:
            rc = decode_receipt(d)
            receipts.setdefault(rc["vault"], []).append({"receipt": a, **rc})
    excluded: dict[str, int] = {}
    named: list[dict] = []

    def ex(reason):
        excluded[reason] = excluded.get(reason, 0) + 1

    mints = sorted({pubkey(d, 104) for _, d in vrows if d[:8] == VAULT_DISC and pubkey(d, 104) in catalog.STABLECOINS})
    _, macc = rpc.multiple(mints, data_slice=(44, 1))
    decimals = {m: v["data"][0] for m, v in macc.items() if v}
    keep, cands = [], []
    for a, d in vrows:
        if d[:8] != VAULT_DISC:
            ex("account unreadable or discriminator mismatch")
            continue
        v = {"address": a, **decode_vault(d), "receipts": receipts.get(a, [])}
        if v["mint"] not in catalog.STABLECOINS:
            ex("deposit token is not a stablecoin (crypto or LST)")
            continue
        if catalog.looks_like_test(v["name"]):
            ex("named as a test, staging or demo vault")
            continue
        dec = decimals.get(v["mint"])
        if dec is None:
            ex("deposit token mint unreadable")
            continue
        v["decimals"] = dec
        if v["total_value_raw"] / 10 ** dec < catalog.MIN_TVL_TOKENS:
            ex(f"empty or under {catalog.MIN_TVL_TOKENS:,} tokens")
            continue
        cands.append(v)

    # Where each strategy's money goes: the strategy account's owner, and for
    # the lending adaptor the program it names at offset 136.
    s_slot, saccts = rpc.multiple([r["strategy"] for v in cands for r in v["receipts"]])
    for v in cands:
        dec = v["decimals"]
        for r in v["receipts"]:
            r["target"], r["target_class"], r["target_program"] = strategy_target(r, saccts.get(r["strategy"]))
        live = [r for r in v["receipts"] if r["position_raw"] > 0]
        kinds = {r["target_class"] for r in live}
        reason = None
        if "drift" in kinds:
            reason = "places funds with Drift (excluded by the owner's rule)"
        elif "offchain" in kinds:
            reason = "holds a manager-reported off-chain (custodial) position"
        elif "closed" in kinds:
            reason = "records a position in a strategy whose account is closed"
        elif "unlisted" in kinds:
            reason = "holds a position in a program not on the known list"
        if reason:
            ex(reason)
            drift_raw = sum(r["position_raw"] for r in live if r["target_class"] == "drift")
            named.append({"address": v["address"], "name": v["name"], "reason": reason,
                          "recorded_total_tokens": round(v["total_value_raw"] / 10 ** dec, 2),
                          **({"in_drift_tokens": round(drift_raw / 10 ** dec, 2)} if drift_raw else {})})
            continue
        keep.append(v)

    # Where a Kamino-vault strategy's money really is: the kVault shares held
    # by the strategy's authority PDA ["vault_strategy_auth", vault, strategy]
    # (@voltr/vault-sdk findVaultStrategyAuthPda), valued at the kVault's
    # recorded AUM per share. Compared with the receipt's recorded position.
    kv = [(v, r) for v in keep for r in v["receipts"] if r["target_class"] == "kvault"]
    h_slot, hdrs = rpc.multiple(sorted({r["strategy"] for _, r in kv}), data_slice=(0, 312))
    for v, r in kv:
        h = (hdrs.get(r["strategy"]) or {}).get("data")
        if not h:
            continue
        auth = find_pda([b"vault_strategy_auth", pk32(v["address"]), pk32(r["strategy"])], VOLTR)[0]
        smint, issued, aum = pubkey(h, 184), u64(h, 232), u128(h, 280) / 2 ** 60
        _, accts = rpc.token_accounts_by_owner(auth, mint=smint)
        shares = sum(x["raw"] for x in accts)
        r["holding"] = {"strategy_authority": auth, "shares_mint": smint, "shares_raw": shares,
                        "value_raw": (shares * aum / issued) if issued else 0.0, "slot": h_slot}

    i_slot, idle = rpc.multiple([v["idle_ata"] for v in keep], data_slice=(0, 72))
    _, pslot = rpc.multiple([PROTOCOL_PDA], data_slice=(8, 34))
    proto = pslot.get(PROTOCOL_PDA)
    protocol = {"admin": pubkey(proto["data"], 0), "operational_state": u16(proto["data"], 32)} if proto else None
    auths = [protocol["admin"]] if protocol else []
    for v in keep:
        auths += [v["admin"], v["manager"], v["pending_admin"]]
    who = resolver.resolve([a for a in auths if a and a != SYSTEM_PROGRAM])
    docs = [_doc(v, idle.get(v["idle_ata"]), who, {"vaults": v_slot, "receipts": r_slot, "idle": i_slot,
                                                    "strategies": s_slot})
            for v in keep]
    return {"vaults": docs, "excluded": excluded, "named_exclusions": named,
            "read": {"discovered": len(vrows), "receipts": len(rrows), "slot": v_slot,
                     "protocol": protocol, "protocol_admin": who.get(protocol["admin"]) if protocol else None}}


def _doc(v, idle_acct, who, slots) -> dict:
    mint = v["mint"]
    sym = catalog.token_symbol(mint)
    face = catalog.STABLECOINS[mint]["usd_face"]
    dec = v["decimals"]
    idle_raw = None
    if idle_acct and len(idle_acct["data"]) >= 72 and pubkey(idle_acct["data"], 0) == mint:
        idle_raw = u64(idle_acct["data"], 64)
    scale = 10 ** dec
    recorded = v["total_value_raw"] / scale
    pos_sum = sum(r["position_raw"] for r in v["receipts"])
    cross = ((idle_raw or 0) + pos_sum) / scale if idle_raw is not None else None
    strategies = [{"receipt": r["receipt"], "strategy": r["strategy"], "adaptor": r["adaptor"],
                   "adaptor_name": ADAPTORS.get(r["adaptor"], ("unlisted adaptor",))[0],
                   "target": r["target"], "target_class": r["target_class"], "target_program": r["target_program"],
                   "holding": ({**r["holding"], "value_tokens": round(r["holding"]["value_raw"] / scale, 2)}
                               if r.get("holding") else None),
                   "position_tokens": round(r["position_raw"] / scale, 2),
                   "last_updated": _ts(r["last_updated_ts"])} for r in v["receipts"]]
    active = [s for s in strategies if s["position_tokens"] > 0]
    notes = []
    if any(s["target_class"] == "drift" for s in strategies):
        notes.append("Drift strategy attached (currently 0)")
    def held(s):  # tokens actually held on chain, falling back to the receipt only if unread
        return s["holding"]["value_tokens"] if s.get("holding") else s["position_tokens"]
    attached = [{"platform_key": "kamino", "address": s["strategy"]} for s in strategies
                if s["target_class"] == "kvault" and not held(s) and not s["position_tokens"]]
    for s in strategies:
        if s["target_class"] != "kvault" or not s.get("holding"):
            continue
        rec, hv = s["position_tokens"], s["holding"]["value_tokens"]
        if abs(hv - rec) > max(1.0, 0.005 * max(hv, rec)):
            notes.append(f"receipt records {rec:,.2f} in Kamino vault {s['strategy'][:8]}…, but the shares held on chain "
                         f"are worth {hv:,.2f}; the row uses the holdings")
    nested = [{"platform_key": "kamino", "address": s["strategy"],
               "tokens": s["holding"]["value_tokens"] if s.get("holding") else s["position_tokens"],
               "receipt_tokens": s["position_tokens"],
               "basis": ("kVault shares held by the strategy authority "
                         + (s["holding"]["strategy_authority"] if s.get("holding") else "(unread)")
                         + ", read on chain and valued at the kVault's recorded AUM per share"),
               "shares": s["holding"]["shares_raw"] if s.get("holding") else None}
              for s in strategies if s["target_class"] == "kvault" and
              ((s["holding"]["value_tokens"] if s.get("holding") else s["position_tokens"]) > 0)]
    admin, manager = who.get(v["admin"]), who.get(v["manager"])
    pend = None if v["pending_admin"] == SYSTEM_PROGRAM else who.get(v["pending_admin"])
    f = v["fees_bps"]
    perf = f["manager_performance"] + f["admin_performance"]
    mgmt = f["manager_management"] + f["admin_management"]
    fee_text = f"{perf / 100:g}% performance, {mgmt / 100:g}% management"
    extra = [f"{f[k] / 100:g}% {k}" for k in ("redemption", "issuance") if f[k]]
    if extra:
        fee_text += ", " + ", ".join(extra)
    if f["protocol_performance"] or f["protocol_management"]:
        fee_text += f"; protocol {f['protocol_performance'] / 100:g}% performance, {f['protocol_management'] / 100:g}% management"
    if admin and manager and v["admin"] == v["manager"]:
        mtext = f"Admin and manager: one {admin['text']}"
    else:
        mtext = f"Manager: {manager['text'] if manager else 'unread'}; admin: {admin['text'] if admin else 'unread'}"
    if manager and manager.get("kind") == "single_key":
        notes.append("manager: single key, can move funds between strategies without an admin step")
    return {
        "_id": f"voltr:{v['address']}", "kind": "vault", "platform": "Voltr", "platform_key": "voltr",
        "chain": "Solana", "group": "nonevm", "address": v["address"], "program": VOLTR, "name": v["name"],
        "sort_key": f"voltr|{v['name'].lower()}|{v['address']}",
        "token": {"mint": mint, "symbol": sym, "decimals": dec, "kind": catalog.token_kind(mint)},
        "slots": slots,
        "tvl": {
            "usd": round(recorded, 2) if face else None, "amount": round(recorded, 2), "symbol": sym,
            "slot": slots["vaults"], "source": "vault_recorded",
            "basis": (f"the vault's own recorded total (asset.totalValue), last written {_ts(v['last_updated_ts'])} "
                      f"when the manager or a crank last updated it; positions as recorded by the vault, not recomputed "
                      "by us; " + catalog.face_note(mint)),
            "cross_check": {"idle_tokens": round(idle_raw / scale, 2) if idle_raw is not None else None,
                            "idle_slot": slots["idle"],
                            "strategy_positions_recorded": round(pos_sum / scale, 2),
                            "sum": round(cross, 2) if cross is not None else None},
            "reconciliation": "recorded by the vault, not reconciled: strategy positions are the vault's own records",
            "recorded_at": _ts(v["last_updated_ts"]), "recorded_at_ts": v["last_updated_ts"], "partial": False,
        },
        "fees": {"text": fee_text, "class": "A", "slot": slots["vaults"], "bps": f},
        "lockup": {"text": f"Withdrawal waiting period: {_dur(v['withdrawal_waiting_s'])}", "class": "A",
                   "slot": slots["vaults"], "withdrawal_waiting_s": v["withdrawal_waiting_s"]},
        "manager": {"text": mtext, "class": "A", "slot": slots["vaults"],
                    "admin": admin, "manager": manager, "pending_admin": pend},
        "notes": notes, "nested_in": nested, "attached_kvaults": attached,
        "assets": {"text": f"{catalog.token_label(mint)}; positions as recorded by the vault: "
                           + (", ".join(sorted({s['target'] for s in active})) if active else "idle only"),
                   "class": "A", "note": "positions as recorded by the vault", "slot": slots["receipts"], "strategies": strategies},
        "controls": {
            "class": "A", "slot": slots["vaults"],
            "admin": admin["text"] if admin else None,
            "allow_any_adaptor": v["allow_any_adaptor"],
            "disabled_operations": v["disabled_operations"],
            "pause": {"text": (f"disabledOperations = {v['disabled_operations']} (bit meanings not published in the SDK)"
                               if v["disabled_operations"] else "disabledOperations = 0"), "class": "A", "slot": slots["vaults"]},
            "max_cap_tokens": round(v["max_cap_raw"] / scale, 2) if v["max_cap_raw"] < 2 ** 63 else None,
        },
        "audits": {"text": catalog.audits_text("voltr"), "class": "D", **catalog.AUDITS["voltr"]},
        "powers": {"class": "D", **catalog.POWERS["voltr"]},
    }
