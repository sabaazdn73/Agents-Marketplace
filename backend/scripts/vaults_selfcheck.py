"""
vaults_selfcheck.py: re-read one random listed vault at a new slot and
compare it with what the collector stored.

    ./venv/bin/python scripts/vaults_selfcheck.py [--seed N] [--address ADDR]

Reads the stored documents from the `vaults` collection, or from the JSON
file named by VAULTS_STORE_FILE (development). Then, for one vault:

  1. fetches the vault account alone with getAccountInfo, at a slot later
     than the stored one, and decodes the key fields with offsets written
     out again here, independently of the collector's decoders;
  2. compares name, deposit mint, admin (and manager), fees and lockup
     exactly;
  3. recomputes TVL (Kamino: token_available plus cToken balances times
     reserve exchange rates, minus pending fees; Voltr: the recorded
     asset.totalValue) and reports its change against the stored figure;
  4. re-derives each Squads authority's vault PDA and re-reads its threshold
     and timelock;
  5. re-reads the program's upgrade authority;
  6. flips one byte in each fee field of the fetched data and checks that
     the collector's decoder reports a different fee (it reads the field).

  7. listing checks over every stored listed vault, from fresh reads:
     no Voltr vault has a strategy reaching Drift with a nonzero recorded
     position (the strategy account's owner, and for the lending adaptor
     the program named at offset 136); every Voltr position in a Kamino vault
     is in a listed Kamino vault; no Kamino vault lends into a klend market
     whose only non-stablecoin reserve is a token minted by a bespoke-
     collateral authority (now: ANY reserve of the market minted by Kamino's
     institutional mint authority, written out in this file). Every
     zero-position strategy a listed Voltr vault keeps into Drift or into an
     unlisted Kamino vault must be noted on its row. The same checks are run on two known-bad vaults
     (Vectis Multi Lend, which lends into Drift, and Kamino Private Credit,
     which lends into such a market) and must flag both, so a check that
     has stopped catching anything fails too.

Exit 0 when every exact comparison holds. TVL moves with deposits, so it is
reported and fails only past --tvl-tolerance (default 10%).
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import os
import random
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from core.vaults import catalog, kamino, voltr  # noqa: E402
from core.vaults.authorities import SQUADS_V4, decode_multisig, squads_vault, upgrade_authorities  # noqa: E402
from core.vaults.solana import SolanaRpc, b58encode  # noqa: E402
from core.vaults.store import get_store  # noqa: E402

FAILS: list[str] = []


def check(ok: bool, what: str):
    print(("PASS " if ok else "FAIL ") + what)
    if not ok:
        FAILS.append(what)


def pk(b, o):
    return b58encode(b[o:o + 32])


def fetch(rpc: SolanaRpc, addr: str, min_slot: int) -> tuple[int, bytes, str]:
    r = rpc.call("getAccountInfo", [addr, {"encoding": "base64", "commitment": "confirmed", "minContextSlot": min_slot}])
    return int(r["context"]["slot"]), base64.b64decode(r["value"]["data"][0]), r["value"]["owner"]


def check_kamino(rpc, doc, slot, d):
    q = lambda o: struct.unpack_from("<Q", d, o)[0]  # noqa: E731
    name = d[58528:58568].rstrip(b"\0").decode("utf-8", "replace").strip()
    check(name == doc["name"], f"name {name!r} == stored {doc['name']!r}")
    check(pk(d, 80) == doc["token"]["mint"], "deposit mint matches")
    check(pk(d, 8) == doc["manager"]["vault_admin"]["address"], "vault admin matches")
    check(q(256) == doc["fees"]["performance_bps"] and q(264) == doc["fees"]["management_bps"],
          f"fees {q(256)}/{q(264)} bps == stored {doc['fees']['performance_bps']}/{doc['fees']['management_bps']}")
    check(q(58688) == doc["lockup"]["withdrawal_penalty_bps"], "withdrawal penalty matches")
    # TVL, recomputed from the account alone plus its reserves and cToken accounts.
    dec = q(112)
    total = q(224)
    reserves, ctoks, cts = [], [], []
    for i in range(25):
        x = d[312 + i * 2160: 312 + (i + 1) * 2160]
        r = pk(x, 0)
        if r == "11111111111111111111111111111111":
            continue
        reserves.append(r)
        ctoks.append(pk(x, 32))
    _, racc = rpc.multiple(reserves)
    _, cacc = rpc.multiple(ctoks)
    for r, c in zip(reserves, ctoks):
        rd, cd = racc[r]["data"], cacc[c]["data"]
        liq = (struct.unpack_from("<Q", rd, 224)[0] + int.from_bytes(rd[232:248], "little") / 2 ** 60
               - sum(int.from_bytes(rd[o:o + 16], "little") for o in (344, 360, 376)) / 2 ** 60)
        supply = struct.unpack_from("<Q", rd, 2592)[0]
        held = struct.unpack_from("<Q", cd, 64)[0]
        total += held * liq / supply if supply else 0
    total -= int.from_bytes(d[296:312], "little") / 2 ** 60
    return total / 10 ** dec


def check_voltr(rpc, doc, slot, d):
    name = d[8:40].rstrip(b"\0").decode("utf-8", "replace").strip()
    check(name == doc["name"], f"name {name!r} == stored {doc['name']!r}")
    check(pk(d, 104) == doc["token"]["mint"], "deposit mint matches")
    check(pk(d, 400) == doc["manager"]["admin"]["address"], "admin matches")
    check(pk(d, 368) == doc["manager"]["manager"]["address"], "manager matches")
    fees = list(struct.unpack_from("<8H", d, 512))
    check(fees == list(doc["fees"]["bps"].values()), f"fees {fees} == stored")
    check(struct.unpack_from("<Q", d, 456)[0] == doc["lockup"]["withdrawal_waiting_s"], "withdrawal waiting period matches")
    return struct.unpack_from("<Q", d, 168)[0] / 10 ** doc["token"]["decimals"]


def mutation(doc, d):
    """The collector's decoder must see a changed fee byte."""
    if doc["platform_key"] == "kamino":
        base = kamino.decode_header(d[:312])
        for off, key in ((256, "performance_fee_bps"), (264, "management_fee_bps")):
            m = bytearray(d[:312])
            m[off] ^= 0x01
            check(kamino.decode_header(bytes(m))[key] != base[key], f"mutating byte {off} changes decoded {key}")
    else:
        base = voltr.decode_vault(d)
        for i, key in enumerate(voltr.FEE_NAMES):
            m = bytearray(d)
            m[512 + 2 * i] ^= 0x01
            check(voltr.decode_vault(bytes(m))["fees_bps"][key] != base["fees_bps"][key], f"mutating fee byte changes {key}")


KNOWN_BAD = {
    "voltr": "DT3srSkTf2tyoAyz9nHf112MChkKEG7LGTGaGWccwgkE",   # Vectis Multi Lend: strategies in Drift
    "kamino": "91b1opzHNUQobfLZxGMNYT5qDRKoqV8FdsdQBmH4wBxy",  # Kamino Private Credit: single bespoke collateral
}
DRIFT = "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"


def voltr_listing_faults(rpc, vault: str, listed_kamino: set) -> list[str]:
    """Independent read of a Voltr vault's strategies."""
    from core.vaults.solana import b58decode
    res = rpc.call("getProgramAccounts", [voltr.VOLTR, {"encoding": "base64", "filters": [
        {"dataSize": 192}, {"memcmp": {"offset": 8, "bytes": vault}}]}])
    rec = []
    for a in res:
        d = base64.b64decode(a["account"]["data"][0])
        rec.append((pk(d, 40), pk(d, 72), struct.unpack_from("<Q", d, 104)[0]))
    _, accts = rpc.multiple([r[0] for r in rec])
    faults = []
    for strat, adaptor, pos in rec:
        if not pos:
            continue
        a = accts.get(strat)
        owner = a["owner"] if a else None
        target = None
        if adaptor == "EBN93eXs5fHGBABuajQqdsKRkCgaqtJa8vEFD6vKXiP":
            target = DRIFT
        elif owner == "aVoLTRCRt3NnnchvLYH6rMYehJHwM5m45RmLBZq7PGz":
            target = pk(a["data"], 136)
        if target == DRIFT:
            faults.append(f"strategy {strat[:8]}… reaches Drift with {pos} raw units")
        if owner == kamino.KVAULT and strat not in listed_kamino:
            faults.append(f"strategy {strat[:8]}… is a Kamino vault that is not listed")
    return faults


# Written out here, not imported from the collector's catalog, so the check
# does not share the rule it is checking.
INSTITUTIONAL_AUTHORITY = "4gPJLzZoTHYfFdGwnFSoyNhWXaqWJ8mvoWeGDcsmb2kJ"


def kamino_listing_faults(rpc, vault: str, market_memo: dict) -> list[str]:
    """Independent read: no market the vault lends into may have ANY reserve
    whose mint is minted by Kamino's institutional mint authority."""
    _, acc = rpc.multiple([vault])
    d = acc[vault]["data"]
    res = []
    for i in range(25):
        x = d[312 + i * 2160: 312 + (i + 1) * 2160]
        r = pk(x, 0)
        if r != "11111111111111111111111111111111" and (struct.unpack_from("<Q", x, 64)[0] or struct.unpack_from("<Q", x, 1104)[0]):
            res.append(r)
    _, racc = rpc.multiple(res, data_slice=(32, 32))
    faults = []
    for r in res:
        m = pk(racc[r]["data"], 0)
        if m not in market_memo:
            rows = rpc.call("getProgramAccounts", [kamino.KLEND, {"encoding": "base64", "dataSlice": {"offset": 128, "length": 32},
                            "filters": [{"dataSize": 8624}, {"memcmp": {"offset": 32, "bytes": m}}]}])
            mints = sorted({pk(base64.b64decode(x["account"]["data"][0]), 0) for x in rows})
            _, ma = rpc.multiple(mints, data_slice=(0, 36))
            market_memo[m] = [x for x in mints if ma.get(x) and struct.unpack_from("<I", ma[x]["data"], 0)[0] == 1
                              and pk(ma[x]["data"], 4) == INSTITUTIONAL_AUTHORITY]
        if market_memo[m]:
            faults.append(f"lends into market {m[:8]}…, which has reserve(s) minted by {INSTITUTIONAL_AUTHORITY[:8]}…: "
                          + ", ".join(x[:8] + "…" for x in market_memo[m]))
    return sorted(set(faults))


def attached_zero_faults(rpc, doc, listed_kamino) -> list[str]:
    """A zero-position strategy into Drift or an unlisted Kamino vault must be
    noted on the row."""
    res = rpc.call("getProgramAccounts", [voltr.VOLTR, {"encoding": "base64", "filters": [
        {"dataSize": 192}, {"memcmp": {"offset": 8, "bytes": doc["address"]}}]}])
    rec = [(pk(d, 40), pk(d, 72), struct.unpack_from("<Q", d, 104)[0])
           for d in (base64.b64decode(a["account"]["data"][0]) for a in res)]
    _, accts = rpc.multiple([r[0] for r in rec])
    notes = " ".join(doc.get("notes") or [])
    faults = []
    for strat, adaptor, pos in rec:
        if pos:
            continue
        a = accts.get(strat)
        owner = a["owner"] if a else None
        drift = adaptor == "EBN93eXs5fHGBABuajQqdsKRkCgaqtJa8vEFD6vKXiP" or (
            owner == "aVoLTRCRt3NnnchvLYH6rMYehJHwM5m45RmLBZq7PGz" and pk(a["data"], 136) == DRIFT)
        if drift and "Drift strategy attached" not in notes:
            faults.append(f"zero-position Drift strategy {strat[:8]}… not noted")
        if owner == kamino.KVAULT and strat not in listed_kamino and "not listed here (currently 0)" not in notes:
            faults.append(f"zero-position strategy in unlisted Kamino vault {strat[:8]}… not noted")
    return faults


def parent_faults(rpc, doc) -> list[str]:
    """The Kamino vaults a Voltr vault sits in, from the shares its strategy
    authorities hold now, must be exactly the parents the row serves."""
    from core.vaults.solana import find_pda, pk32
    res = rpc.call("getProgramAccounts", [voltr.VOLTR, {"encoding": "base64", "filters": [
        {"dataSize": 192}, {"memcmp": {"offset": 8, "bytes": doc["address"]}}]}])
    strats = [pk(base64.b64decode(a["account"]["data"][0]), 40) for a in res]
    _, accts = rpc.multiple(strats, data_slice=(0, 312))
    parents = set()
    for st in strats:
        a = accts.get(st)
        if not a or a["owner"] != kamino.KVAULT:
            continue
        auth = find_pda([b"vault_strategy_auth", pk32(doc["address"]), pk32(st)], voltr.VOLTR)[0]
        smint = pk(a["data"], 184)
        r = rpc.call("getTokenAccountsByOwner", [auth, {"mint": smint}, {"encoding": "jsonParsed"}])
        if sum(int(x["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for x in r["value"]):
            parents.add(st)
    served = {n["address"] for n in doc.get("nested_in") or []}
    return [] if parents == served else [f"holdings show parents {sorted(parents)}, row serves {sorted(served)}"]


def listing_checks(rpc, docs):
    listed_kamino = {d["address"] for d in docs if d["platform_key"] == "kamino"}
    memo: dict = {}
    for d in docs:
        if d["platform_key"] == "voltr":
            f = parent_faults(rpc, d)
            check(not f, f"parent from on-chain share holdings: {d['name']} " + ("matches" if not f else "; ".join(f)))
            f = attached_zero_faults(rpc, d, listed_kamino)
            check(not f, f"attached strategies noted: {d['name']} " + ("ok" if not f else "; ".join(f)))
        f = (voltr_listing_faults(rpc, d["address"], listed_kamino) if d["platform_key"] == "voltr"
             else kamino_listing_faults(rpc, d["address"], memo) if d["platform_key"] == "kamino" else [])
        check(not f, f"listing: {d['platform']} {d['name']} " + ("clean" if not f else "; ".join(f)))
    for plat, addr in KNOWN_BAD.items():
        f = (voltr_listing_faults(rpc, addr, listed_kamino) if plat == "voltr" else kamino_listing_faults(rpc, addr, memo))
        check(bool(f), f"listing check catches the known-bad {plat} vault {addr[:8]}… ({'; '.join(f) or 'NOT caught'})")


def authorities_of(doc):
    m = doc["manager"]
    return [a for a in (m.get("vault_admin"), m.get("allocation_admin"), m.get("admin"), m.get("manager"), m.get("owner")) if a]


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int)
    ap.add_argument("--address")
    ap.add_argument("--tvl-tolerance", type=float, default=10.0)
    ap.add_argument("--no-listing", action="store_true", help="skip the listing checks over every vault")
    args = ap.parse_args()
    store = get_store()
    docs = [d for d in await store.all_docs() if d.get("kind") == "vault"]
    if not docs:
        print("No stored vaults: run the collector first.")
        return 2
    all_listed = docs
    docs = [d for d in docs if d["platform_key"] in ("kamino", "voltr")]
    doc = next((d for d in docs if d["address"] == args.address), None) if args.address else random.Random(args.seed).choice(docs)
    if not doc:
        print("address not among the stored vaults")
        return 2
    stored_slot = max(v for v in doc["slots"].values() if v)
    print(f"vault {doc['platform']} {doc['name']} {doc['address']} (stored at slots up to {stored_slot})")
    rpc = SolanaRpc()
    try:
        slot, d, owner = fetch(rpc, doc["address"], stored_slot + 1)
        check(slot > stored_slot, f"re-read at a new slot {slot} > {stored_slot}")
        check(owner == doc["program"], "account owner is the platform program")
        tvl = (check_kamino if doc["platform_key"] == "kamino" else check_voltr)(rpc, doc, slot, d)
        was = doc["tvl"]["amount"]
        move = (tvl - was) / was * 100 if was else 0.0
        print(f"TVL now {tvl:,.2f} vs stored {was:,.2f} ({move:+.4f}%)")
        check(abs(move) <= args.tvl_tolerance, f"TVL moved within {args.tvl_tolerance}%")
        for a in authorities_of(doc):
            if a.get("kind") != "squads_v4":
                continue
            check(squads_vault(a["multisig"], a["vault_index"]) == a["address"],
                  f"{a['address'][:8]}… re-derives from multisig {a['multisig'][:8]}… vault {a['vault_index']}")
            _, md, mo = fetch(rpc, a["multisig"], 0)
            ms = decode_multisig(md)
            check(mo == SQUADS_V4 and ms["threshold"] == a["threshold"] and ms["timelock_s"] == a["timelock_s"],
                  f"multisig {a['multisig'][:8]}… still {ms['threshold']} of {ms['voters']}, timelock {ms['timelock_s']} s")
        up = upgrade_authorities(rpc, [doc["program"]])[doc["program"]]
        stored_up = next(p for p in doc["controls"]["upgrade"]["programs"] if p["program"] == doc["program"])
        check(up.get("authority") == stored_up.get("authority"), f"program upgrade authority {str(up.get('authority'))[:8]}… matches")
        mutation(doc, d)
        if not args.no_listing:
            listing_checks(rpc, all_listed)
    finally:
        rpc.close()
    print(f"{len(FAILS)} failure(s); {rpc.calls} RPC calls on {rpc.endpoint_name}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
