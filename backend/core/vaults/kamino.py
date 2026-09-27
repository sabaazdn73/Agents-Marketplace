"""
Kamino kVaults, read on chain.

Discovery: getProgramAccounts on the kVault program with dataSize 62,552 and
a 32-byte slice at the token mint, so the whole set costs one small call and
no platform API is read.

VaultState offsets (kvault source, summed to VAULT_STATE_SIZE in phase 7):
admin@8 token_mint@80 token_mint_decimals@112 token_available@224
performance_fee_bps@256 management_fee_bps@264 prev_aum_sf u128@280 (U68F60)
pending_fees_sf@296 allocations 25 x 2160 @312 (reserve@0 ctoken_vault@32
target_weight@64 token_allocation_cap@72 ctoken_allocation@1104)
pending_admin@58448 name[40]@58528 allocation_admin@58648
withdrawal_penalty_lamports@58680 withdrawal_penalty_bps@58688
whitelist flags u8@58728/58729 deposit_cap@58736.

klend Reserve (klend master, reserve.rs): lending_market@32,
liquidity.mint@128 total_available_amount@224 borrowed_amount_sf u128@232
mint_decimals@272 accumulated_protocol_fees_sf@344
accumulated_referrer_fees_sf@360 pending_referrer_fees_sf@376;
collateral.mint@2560 mint_total_supply@2592.
klend LendingMarket: lending_market_owner@24, emergency_mode u8@122.

TVL is computed by us: token_available plus, for every allocation, the
cTokens in the vault's own cToken account times the reserve's exchange rate,
minus pending fees. The vault's own recorded AUM (prev_aum) is shown beside
it, and the two are compared.
"""

from __future__ import annotations

from . import catalog
from .solana import SYSTEM_PROGRAM, SolanaRpc, anchor_disc, memcmp, pk32, pubkey, u32, u64, u128

KVAULT = "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd"
KLEND = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
GLOBAL_CONFIG = "BKyTcUe6daNG8HbgBix2ugdRHbykG2dK9hPBBqhUyoEX"
VAULT_SIZE = 62552
ALLOC_BASE, ALLOC_SIZE, ALLOC_N = 312, 2160, 25
TAIL_OFF, TAIL_LEN = 58448, 296
SF = 2 ** 60

RESERVE_SIZE = 8624
AUM_FLAG_PCT = 0.5  # a computed-versus-recorded AUM gap above this is flagged
MARKET_TTL_S = 7 * 86400
NEW_MARKETS_PER_RUN = 60     # first classification of a market (one-off cost)
STALE_MARKETS_PER_RUN = 6    # re-classification of markets older than a week


def _name(b: bytes) -> str:
    return b.rstrip(b"\0").decode("utf-8", "replace").strip()


def discover(rpc: SolanaRpc) -> tuple[int, list[tuple[str, str]]]:
    slot, rows = rpc.program_accounts(KVAULT, [{"dataSize": VAULT_SIZE}], data_slice=(80, 32))
    return slot, [(a, pubkey(d, 0)) for a, d in rows]


def decode_header(d: bytes) -> dict:
    dec = u64(d, 112)
    return {
        "admin": pubkey(d, 8), "token_mint": pubkey(d, 80), "decimals": dec,
        "token_available_raw": u64(d, 224),
        "performance_fee_bps": u64(d, 256), "management_fee_bps": u64(d, 264),
        "prev_aum_raw": u128(d, 280) / SF, "pending_fees_raw": u128(d, 296) / SF,
    }


def decode_tail(t: bytes) -> dict:
    o = lambda x: x - TAIL_OFF  # noqa: E731
    return {
        "pending_admin": pubkey(t, o(58448)), "name": _name(t[o(58528):o(58528) + 40]),
        "allocation_admin": pubkey(t, o(58648)),
        "withdrawal_penalty_lamports": u64(t, o(58680)), "withdrawal_penalty_bps": u64(t, o(58688)),
        "whitelist_alloc_only": t[o(58728)], "whitelist_invest_only": t[o(58729)],
        "deposit_cap_raw": u64(t, o(58736)),
    }


def decode_allocations(d: bytes) -> list[dict]:
    out = []
    for i in range(ALLOC_N):
        x = d[ALLOC_BASE + i * ALLOC_SIZE: ALLOC_BASE + (i + 1) * ALLOC_SIZE]
        res = pubkey(x, 0)
        if res == SYSTEM_PROGRAM:
            continue
        out.append({"reserve": res, "ctoken_vault": pubkey(x, 32), "target_weight": u64(x, 64),
                    "token_cap_raw": u64(x, 72), "ctoken_allocation": u64(x, 1104)})
    return out


def decode_reserve(head: bytes, coll: bytes) -> dict:
    avail = u64(head, 224)
    borrowed = u128(head, 232) / SF
    fees = (u128(head, 344) + u128(head, 360) + u128(head, 376)) / SF
    total = avail + borrowed - fees
    supply = u64(coll, 32)
    return {"lending_market": pubkey(head, 32), "liquidity_mint": pubkey(head, 128),
            "total_liquidity_raw": total, "collateral_supply": supply,
            "collateral_mint": pubkey(coll, 0),
            "rate": (total / supply) if supply else None}


MARKET_CACHE_VERSION = 2


def classify_markets(rpc: SolanaRpc, markets: list[str], cache: dict) -> dict:
    """market -> {v, reserves: [{mint, symbol, name, label, mint_authority, program,
    institutional, offchain_backed}], institutional, read_at, slot}.

    A market is `institutional` when ANY of its reserves' mints has a mint
    authority in catalog.INSTITUTIONAL_MINT_AUTHORITIES (Kamino's
    institutional-yield markets). Structural, from chain reads; the vault's
    name plays no part. Each market costs one getProgramAccounts plus its
    mints' metadata, so results are kept for a week and refreshed a few at a
    time."""
    import time as _t
    from . import tokenmeta
    now = _t.time()
    fresh = {m: c for m, c in cache.items() if c.get("v") == MARKET_CACHE_VERSION}
    cache.clear()
    cache.update(fresh)
    new = [m for m in markets if m not in cache]
    stale = sorted((m for m in markets if m in cache and now - cache[m].get("read_at", 0) > MARKET_TTL_S),
                   key=lambda m: cache[m].get("read_at", 0))
    todo = new[:NEW_MARKETS_PER_RUN] + stale[:STALE_MARKETS_PER_RUN]
    found: dict[str, tuple[int, list[str]]] = {}
    for m in todo:
        slot, rows = rpc.program_accounts(KLEND, [{"dataSize": RESERVE_SIZE}, memcmp(32, pk32(m))], data_slice=(128, 32))
        found[m] = (slot, sorted({pubkey(d, 0) for _, d in rows}))
    meta = tokenmeta.read(rpc, sorted({x for _, ms in found.values() for x in ms}))
    for m, (slot, mints) in found.items():
        res = []
        for x in mints:
            info = meta.get(x) or {}
            inst = info.get("mint_authority") in catalog.INSTITUTIONAL_MINT_AUTHORITIES
            stable = catalog.STABLECOINS.get(x)
            res.append({
                "mint": x, "symbol": stable["symbol"] if stable else info.get("symbol"), "name": info.get("name"),
                "label": catalog.token_label(x) if stable else tokenmeta.label(x, info),
                "metadata_source": info.get("source"), "mint_authority": info.get("mint_authority"),
                "program": info.get("program"), "stablecoin": bool(stable), "institutional": inst,
                "offchain_backed": catalog.offchain_backed(x, info),
            })
        cache[m] = {"v": MARKET_CACHE_VERSION, "reserves": res, "institutional": any(r["institutional"] for r in res),
                    "read_at": now, "slot": slot}
    return cache


def collect(rpc: SolanaRpc, resolver, market_cache: dict | None = None) -> dict:
    """Returns {"vaults": [doc], "excluded": {reason: n}, "named_exclusions": [..],
    "read": {...}, "market_cache": {...}}."""
    market_cache = dict(market_cache or {})
    d_slot, found = discover(rpc)
    excluded: dict[str, int] = {}
    named: list[dict] = []

    def ex(reason, n=1):
        excluded[reason] = excluded.get(reason, 0) + n

    cands = []
    for addr, mint in found:
        if mint in catalog.STABLECOINS:
            cands.append(addr)
        elif mint in catalog.UNIDENTIFIED_TOKENS:
            named.append({"address": addr, "reason": "deposit token not identified: " + catalog.UNIDENTIFIED_TOKENS[mint],
                          "token_mint": mint})
            ex("deposit token not identified")
        else:
            ex("deposit token is not a stablecoin (crypto or LST)")
    h_slot, heads = rpc.multiple(cands, data_slice=(0, ALLOC_BASE))
    t_slot, tails = rpc.multiple(cands, data_slice=(TAIL_OFF, TAIL_LEN))
    disc = anchor_disc("VaultState")
    keep = []
    for a in cands:
        h, t = heads.get(a), tails.get(a)
        if not h or not t or h["data"][:8] != disc:
            ex("account unreadable or discriminator mismatch")
            continue
        v = {"address": a, **decode_header(h["data"]), **decode_tail(t["data"])}
        tokens = v["prev_aum_raw"] / 10 ** v["decimals"]
        if catalog.looks_like_test(v["name"]):
            ex("named as a test, staging or demo vault")
        elif tokens < catalog.MIN_TVL_TOKENS:
            ex(f"empty or under {catalog.MIN_TVL_TOKENS:,} tokens")
        else:
            keep.append(v)

    # Full reads for the allocations (62,552 bytes each; small batches).
    f_slot, fulls = rpc.multiple([v["address"] for v in keep], batch=5)
    for v in keep:
        f = fulls.get(v["address"])
        v["allocations"] = decode_allocations(f["data"]) if f else []

    reserves = sorted({al["reserve"] for v in keep for al in v["allocations"]})
    ctok = sorted({al["ctoken_vault"] for v in keep for al in v["allocations"]})
    r_slot, rheads = rpc.multiple(reserves, data_slice=(0, 448))
    _, rcolls = rpc.multiple(reserves, data_slice=(2560, 48))
    c_slot, cvaults = rpc.multiple(ctok, data_slice=(64, 8))
    rdec = {}
    for r in reserves:
        if rheads.get(r) and rcolls.get(r) and rheads[r]["owner"] == KLEND:
            rdec[r] = decode_reserve(rheads[r]["data"], rcolls[r]["data"])
    markets = sorted({x["lending_market"] for x in rdec.values()})
    m_slot, mk = rpc.multiple(markets, data_slice=(24, 99))
    market = {m: {"owner": pubkey(v["data"], 0), "emergency_mode": v["data"][122 - 24]}
              for m, v in mk.items() if v and v["owner"] == KLEND}
    # Structure: does the vault lend into a market whose only collateral is
    # one bespoke token (the off-chain-backed SPV markets)?
    used = sorted({rdec[al["reserve"]]["lending_market"] for v in keep for al in v["allocations"]
                   if al["reserve"] in rdec and (al["target_weight"] or al["ctoken_allocation"])})
    classify_markets(rpc, used, market_cache)
    listed = []
    for v in keep:
        dec_scale = 10 ** v["decimals"]
        pos, unclassified, total_val = [], [], v["token_available_raw"]
        for al in v["allocations"]:
            r = rdec.get(al["reserve"])
            if not r:
                continue
            val = al["ctoken_allocation"] * (r["rate"] or 0)
            total_val += val
            if not (al["target_weight"] or al["ctoken_allocation"]):
                continue
            mc = market_cache.get(r["lending_market"])
            if mc is None:
                unclassified.append(r["lending_market"])
            elif mc["institutional"]:
                coll = [x for x in mc["reserves"] if x["institutional"]]
                pos.append({"market": r["lending_market"], "collateral": [x["label"] for x in coll],
                            "collateral_mints": [x["mint"] for x in coll],
                            "value_tokens": round(val / dec_scale, 2)})
        if pos:
            share = sum(p["value_tokens"] for p in pos) / (total_val / dec_scale) if total_val else None
            named.append({"address": v["address"], "name": v["name"],
                          "reason": ("lends into Kamino's institutional-yield market(s): collateral minted by "
                                     "Kamino's institutional mint authority 4gPJLzZo…"),
                          "source": catalog.INSTITUTIONAL_YIELD_STRUCTURE, "source_read_on": "2026-09-26",
                          "share_of_vault": round(share, 4) if share is not None else None, "positions": pos})
            ex("lends into Kamino's institutional-yield markets")
        elif unclassified:
            ex("a market it lends into is not classified yet (next run)")
        else:
            listed.append(v)
    keep = listed

    g_slot, g = rpc.multiple([GLOBAL_CONFIG], data_slice=(8, 64))
    global_admin = pubkey(g[GLOBAL_CONFIG]["data"], 0) if g.get(GLOBAL_CONFIG) else None

    auths = [global_admin] + [m["owner"] for m in market.values()]
    for v in keep:
        auths += [v["admin"], v["allocation_admin"], v["pending_admin"]]
    who = resolver.resolve([a for a in auths if a])

    docs = []
    for v in keep:
        docs.append(_doc(v, rdec, cvaults, market, who, global_admin, market_cache,
                         slots={"discovery": d_slot, "header": h_slot, "tail": t_slot, "full": f_slot,
                                "reserves": r_slot, "ctoken_accounts": c_slot, "markets": m_slot,
                                "global_config": g_slot}))
    return {"vaults": docs, "excluded": excluded, "named_exclusions": named, "market_cache": market_cache,
            "read": {"discovered": len(found), "slot": d_slot, "global_admin": who.get(global_admin)}}


def _names(xs: list[str], cap: int = 5) -> str:
    if not xs:
        return "stablecoins only"
    return ", ".join(xs[:cap]) + (f" and {len(xs) - cap} more" if len(xs) > cap else "")


def _now_iso() -> str:
    import datetime as _dt
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def _doc(v, rdec, cvaults, market, who, global_admin, market_cache, slots) -> dict:
    dec = v["decimals"]
    scale = 10 ** dec
    mint = v["token_mint"]
    sym = catalog.token_symbol(mint)
    face = catalog.STABLECOINS[mint]["usd_face"]
    gross = v["token_available_raw"]
    allocs, recon_bad, unread = [], [], 0
    for al in v["allocations"]:
        r = rdec.get(al["reserve"])
        cv = cvaults.get(al["ctoken_vault"])
        held = u64(cv["data"], 0) if cv else None
        value = None
        if r and r["rate"] is not None and held is not None:
            value = held * r["rate"]
            gross += value
        else:
            unread += 1
        if held is not None and held != al["ctoken_allocation"]:
            recon_bad.append(al["reserve"])
        m = market.get(r["lending_market"]) if r else None
        owner = who.get(m["owner"]) if m else None
        allocs.append({
            "reserve": al["reserve"], "lending_market": r["lending_market"] if r else None,
            "market_owner": m["owner"] if m else None,
            "market_owner_text": owner["text"] if owner else None,
            "market_emergency_mode": m["emergency_mode"] if m else None,
            "target_weight": al["target_weight"],
            "ctokens_recorded": al["ctoken_allocation"], "ctokens_held": held,
            "value_tokens": round(value / scale, 2) if value is not None else None,
        })
    net = gross - v["pending_fees_raw"]
    computed = net / scale
    recorded = v["prev_aum_raw"] / scale
    diff_pct = ((computed - recorded) / recorded * 100) if recorded else None
    complete = unread == 0
    if not complete:
        reconciliation = f"partial: {unread} allocation(s) not valued"
    elif recon_bad:
        reconciliation = f"does not reconcile: cToken balance differs from the vault's record on {len(recon_bad)} reserve(s)"
    else:
        reconciliation = "reconciles: every cToken account holds what the vault records"
    aum_flag = diff_pct is not None and abs(diff_pct) > AUM_FLAG_PCT
    if diff_pct is not None:
        reconciliation += (f"; the vault's recorded AUM differs by {diff_pct:+.3f}% ("
                           + ("above" if aum_flag else "within") + f" the {AUM_FLAG_PCT}% flag)")
    tvl_usd = round(computed, 2) if (face and complete) else None

    admin, alloc_admin = who.get(v["admin"]), who.get(v["allocation_admin"])
    pend = None if v["pending_admin"] == SYSTEM_PROGRAM else who.get(v["pending_admin"])
    gadm = who.get(global_admin) if global_admin else None
    lent = [a for a in allocs if a["target_weight"] or a["ctokens_held"]]
    mk_n = len({a["lending_market"] for a in lent if a["lending_market"]})
    owner_texts = sorted({a["market_owner_text"] for a in lent if a["market_owner_text"]})

    by_market: dict[str, float] = {}
    for a in lent:
        if a["lending_market"] and a["value_tokens"] is not None:
            by_market[a["lending_market"]] = by_market.get(a["lending_market"], 0.0) + a["value_tokens"]
    against = []
    for m, val in sorted(by_market.items(), key=lambda x: -x[1]):
        mc = market_cache.get(m) or {}
        coll = [r for r in mc.get("reserves", []) if r["mint"] != mint]
        against.append({
            "market": m, "share_of_vault": round(val / (gross / scale), 4) if gross else None,
            "share_basis": "value in this market over the vault's gross holdings (before pending fees)",
            "value_tokens": round(val, 2),
            "market_owner_text": (market.get(m) and who.get(market[m]["owner"], {}).get("text")),
            "collateral": [{"mint": r["mint"], "label": r["label"], "stablecoin": r["stablecoin"],
                            "offchain_backed": r["offchain_backed"]} for r in coll],
            "collateral_class": "A (reserve mints, read on chain); names are each token's own metadata (D)",
            "slot": mc.get("slot"),
        })
    shown = [a for a in against if (a["share_of_vault"] or 0) > 0] or against
    against_text = "; ".join(
        f"{round(a['share_of_vault'] * 100, 1) if a['share_of_vault'] is not None else '?'}% in a market taking "
        + _names([c["label"] for c in a["collateral"] if not c["stablecoin"]])
        for a in shown[:4]) + ("; and more" if len(shown) > 4 else "")
    pen_bps, pen_lam = v["withdrawal_penalty_bps"], v["withdrawal_penalty_lamports"]
    lock_text = "No lock-up field; withdrawals limited by the vault's available liquidity"
    if pen_bps or pen_lam:
        lock_text += (f"; withdrawal penalty {pen_bps / 100:g}%"
                      + (f" plus a flat {pen_lam / scale:.{dec}f}".rstrip("0").rstrip(".")
                         + f" {sym} ({pen_lam} base unit{'s' if pen_lam != 1 else ''})" if pen_lam else ""))
    fee_text = f"{v['performance_fee_bps'] / 100:g}% performance, {v['management_fee_bps'] / 100:g}% management"

    return {
        "_id": f"kamino:{v['address']}", "kind": "vault", "platform": "Kamino", "platform_key": "kamino",
        "chain": "Solana", "group": "nonevm", "address": v["address"], "program": KVAULT, "name": v["name"],
        "sort_key": f"kamino|{v['name'].lower()}|{v['address']}",
        "token": {"mint": mint, "symbol": sym, "decimals": dec, "kind": catalog.token_kind(mint)},
        "slots": slots,
        "tvl": {
            "usd": tvl_usd, "amount": round(computed, 2), "symbol": sym, "slot": slots["ctoken_accounts"],
            "source": "computed_from_chain",
            "basis": ("token_available plus each cToken account's balance times its reserve's exchange rate, "
                      "minus pending fees; " + catalog.face_note(mint)),
            "computed_at": _now_iso(), "aum_flag": aum_flag,
            "vault_recorded": {"amount": round(recorded, 2), "field": "prev_aum_sf / 2^60", "slot": slots["header"]},
            "difference_pct": round(diff_pct, 4) if diff_pct is not None else None,
            "reconciliation": reconciliation, "partial": not complete,
        },
        "fees": {"text": fee_text, "class": "A", "slot": slots["header"],
                 "performance_bps": v["performance_fee_bps"], "management_bps": v["management_fee_bps"]},
        "lockup": {"text": lock_text, "class": "A", "slot": slots["tail"],
                   "withdrawal_penalty_bps": pen_bps, "withdrawal_penalty_lamports": pen_lam},
        "manager": {"text": f"Vault admin: {admin['text'] if admin else 'unread'}", "class": "A", "slot": slots["header"],
                    "vault_admin": admin, "allocation_admin": alloc_admin, "pending_admin": pend},
        "assets": {"text": f"{catalog.token_label(mint)}, lent into {len(lent)} klend reserve(s) in {mk_n} market(s)", "class": "A",
                   "slot": slots["reserves"], "allocations": allocs,
                   "lends_against": against, "lends_against_text": against_text,
                   "whitelisted_reserves_only": {"allocations": v["whitelist_alloc_only"], "invest": v["whitelist_invest_only"]},
                   "deposit_cap_tokens": round(v["deposit_cap_raw"] / scale, 2)},
        "controls": {
            "class": "A", "slot": slots["markets"],
            "admin": admin["text"] if admin else None,
            "allocation_admin": alloc_admin["text"] if alloc_admin else None,
            "global_admin": gadm,
            "market_owners": owner_texts,
            "pause": {"text": "No pause field in VaultState (kvault source); each klend market has an emergency mode, read per allocation", "class": "D"},
        },
        "audits": {"text": catalog.audits_text("kamino"), "class": "D", **catalog.AUDITS["kamino"]},
        "powers": {"class": "D", **catalog.POWERS["kamino"]},
    }
