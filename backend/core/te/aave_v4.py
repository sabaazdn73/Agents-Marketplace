"""Aave V4 on Base: which tokenized-stock versions it accepts as collateral,
on what terms, and what borrowing USDC against them costs. Read on chain.

WHERE EVERY ADDRESS COMES FROM
------------------------------
Aave's own address book, github.com/aave-dao/aave-address-book, file
src/AaveV4Base.sol at commit 17567521ae51 (read 2026-09-29):
  AaveV4BaseHubs.EQUITIES_HUB           0xa4d5947Eb727A052bae69C593FfC84247EC9864E
  AaveV4BaseSpokes.MAG7_SPOKE           0x17905Db0e4A3514467539956c084180616AE7B8D
  AaveV4BaseSpokes.MAG7_SPOKE_ORACLE    0xaBaf048fD7675Ea34a84332371ffd5D55E322A47
  AaveV4BaseIRStrategies (all assets)   0x3b0c5FbEff9d32fB6bB706bACc988c88b1871770
The oracle and the strategy are also read back from the chain on every pass
(MAG7_SPOKE.ORACLE(), EQUITIES_HUB.getAssetConfig(id).irStrategy), and the
answer says so if the chain ever disagrees with the book.

The ABI is Aave's, github.com/aave/aave-v4 at commit 2524fe4018a4, the
commit the address book's lib/aave-v4 submodule pins: ISpoke, IHub,
IHubBase, IAaveOracle, IAssetInterestRateStrategy.

WHAT IS READ, AT ONE BLOCK
--------------------------
The spoke's reserves are enumerated (getReserveCount, getReserve), never
hard-coded, and each reserve's underlying is matched to Tnega's Base
versions (te_universe keys 8453/...) case-insensitively. Per reserve:
getReserveConfig, getDynamicReserveConfig at the reserve's current
dynamicConfigKey, getReserveSuppliedAssets, getReserveTotalDebt, the
spoke oracle's getReservePrice and getReserveSource, and the hub's
getSpokeConfig(assetId, spoke). For the borrowable reserves (USDC today):
getAssetDrawnRate, getAssetLiquidity, getAssetTotalOwed, getAssetConfig and
the strategy's getInterestRateData. For a Base version with no reserve:
the hub's isUnderlyingListed. Every call goes through Multicall3 at one
pinned block on the Base endpoints in chains.py (rotation, BASE_RPC_URL
first when set; public endpoints only otherwise, never a keyed one).

HOW V4 DIFFERS FROM V3, AND WHAT IS SERVED FOR IT
-------------------------------------------------
- ONE collateral factor. V4 has no separate max LTV and liquidation
  threshold: collateral is weighted by one factor, borrowing is allowed up
  to it and liquidation starts at it (Spoke._processUserAccountData;
  borrowing needs a health factor of at least 1, liquidation starts below
  1). It is served as collateral_factor_bps and presented as max LTV, with
  liquidation_threshold_bps the same number. A position keeps the factor
  stored at its last health-checked action (dynamicConfigKey); the one
  served is the reserve's current key.
- NO MARKET-WIDE COLLATERAL TOTAL. V4 keeps collateral per user
  (setUsingAsCollateral); no reserve-level amount exists. What is served is
  supplied_tokens (getReserveSuppliedAssets), labelled "supplied to the
  market", beside the add cap.
- THE BORROW RATE is the hub's drawnRate, in RAY (1e27), accrued linearly
  with a 365-day year (AssetLogic, MathUtils.calculateLinearInterest), so it
  is an APR. A borrower pays drawnRate x (1 + riskPremium), riskPremium
  being the debt-weighted collateralRisk of the collateral; collateralRisk
  is served per reserve (0 on every reserve when this was written).

Caps are in WHOLE tokens (IHub.SpokeConfig). MAX_ALLOWED_SPOKE_CAP,
2^40 - 1, means no cap; a draw cap of 0 means nothing can be drawn.

THE CACHE. snapshot() never reads the chain in the caller's path: it
returns the last snapshot with its age and, when that is older than
REFRESH_SECONDS, starts one read in the background. The read runs on one
dedicated thread with its own deadline, never more than one at a time, and
after a failure the next waits out a backoff (see the cache section). A
read that fails keeps the last good snapshot and records the failure;
nothing is replaced by zeros. Transport free.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import time
from decimal import Decimal

from eth_abi import decode, encode
from eth_utils import function_signature_to_4byte_selector as _sel

log = logging.getLogger("te.aave_v4")

CHAIN_ID = 8453
HUB = "0xa4d5947eb727a052bae69c593ffc84247ec9864e"
SPOKE = "0x17905db0e4a3514467539956c084180616ae7b8d"
ORACLE_BOOK = "0xabaf048fd7675ea34a84332371ffd5d55e322a47"
IR_STRATEGY_BOOK = "0x3b0c5fbeff9d32fb6bb706bacc988c88b1871770"
USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
MAX_ALLOWED_SPOKE_CAP = 2 ** 40 - 1
RAY = 10 ** 27

SOURCES = {
    "addresses": {"repo": "https://github.com/aave-dao/aave-address-book", "file": "src/AaveV4Base.sol",
                  "commit": "17567521ae51",
                  "url": "https://github.com/aave-dao/aave-address-book/blob/17567521ae51/src/AaveV4Base.sol",
                  "read_on": "2026-09-29",
                  "names": {"hub": "AaveV4BaseHubs.EQUITIES_HUB", "spoke": "AaveV4BaseSpokes.MAG7_SPOKE",
                            "oracle": "AaveV4BaseSpokes.MAG7_SPOKE_ORACLE",
                            "ir_strategy": "AaveV4BaseIRStrategies (EQUITIES_*_IR_STRATEGY)"}},
    "abi": {"repo": "https://github.com/aave/aave-v4", "commit": "2524fe4018a4",
            "interfaces": ["src/spoke/interfaces/ISpoke.sol", "src/hub/interfaces/IHub.sol",
                           "src/hub/interfaces/IHubBase.sol", "src/spoke/interfaces/IAaveOracle.sol",
                           "src/hub/interfaces/IAssetInterestRateStrategy.sol"]},
}
ELIGIBILITY = {
    "text": ("Coinbase Tokenized Stocks are securities issued by Coinbase and offered under Regulation S only to "
             "eligible non-U.S. persons in permitted jurisdictions."),
    "url": "https://aave.com/blog/coinbase-tokenized-stocks",
    "published": "2026-09-25", "class": "D",
    "note": "Aave's own sentence, copied whole from the linked post, quoted and not restated",
}
NOTES = {
    "single_factor": ("V4 uses one collateral factor: borrowing is allowed up to it and liquidation starts at it "
                      "(no buffer); a position's factor is the one stored at its last health-checked action "
                      "(dynamicConfigKey). The factor served is the reserve's current one."),
    "supplied": ("supplied_tokens is what is supplied to the market (getReserveSuppliedAssets). V4 keeps "
                 "collateral per user; no market-wide collateral total exists to read."),
    "borrow_rate": ("borrow_apr is the hub's drawn rate (RAY / 1e27), accrued linearly over a 365-day year: an "
                    "APR, not compounded. A borrower pays drawn rate x (1 + risk premium); the risk premium is "
                    "the debt-weighted collateralRisk of the collateral, served per reserve."),
    "caps": "Caps are whole tokens. 'no cap' is the hub's MAX_ALLOWED_SPOKE_CAP; a draw cap of 0 means nothing "
            "can be drawn.",
}

REFRESH_SECONDS = 600
# An answer older than the refresh by this much is marked stale (a normal
# read takes a few seconds, so this only trips after a quiet spell).
STALE_GRACE_S = 60


def _call(sig: str, types: list[str] | None = None, args: list | None = None) -> bytes:
    return _sel(sig) + (encode(types, args) if types else b"")


def _iso(t: float | None) -> str | None:
    if t is None:
        return None
    return dt.datetime.fromtimestamp(t, dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _units(raw: int, decimals: int) -> str:
    s = format(Decimal(raw).scaleb(-int(decimals)), "f")
    return s.rstrip("0").rstrip(".") if "." in s else s


def _cap(v: int) -> int | str:
    return "no cap" if v >= MAX_ALLOWED_SPOKE_CAP else int(v)


# ── the read ─────────────────────────────────────────────────────────────────

def base_versions() -> dict[str, dict]:
    """Tnega's listed Base versions, by lower-case address."""
    from .universe import load_universe
    u = load_universe()
    out = {}
    for i in u.listed_indices():
        r = u.row(i)
        if r["key"].startswith(f"{CHAIN_ID}/"):
            out[r["address"].lower()] = {"key": r["key"], "symbol": r["symbol"], "ticker": r["ticker"],
                                         "decimals": r["decimals"]}
    return out


def _agg(rpc, calls: list[tuple[str, bytes]], block: int) -> list[bytes | None]:
    """Multicall3 at the block. The one seam the self-check replaces with the
    raw results it recorded from a live read, so decoding is checked offline
    on real answers."""
    from .multicall import aggregate3
    return aggregate3(rpc, calls, block, chunk=200)


def _dec(types: list[str], data: bytes | None):
    if data is None:
        return None
    return decode(types, data)


def read(rpc=None) -> dict:
    """One snapshot at one pinned block. Blocking: call from a thread. With
    no client given, one is made with the read's deadline."""
    if rpc is None:
        return _read_with_deadline()
    return _read(rpc)


def _read(rpc) -> dict:
    block = rpc.block_number()
    hdr = rpc.call("eth_getBlockByNumber", [hex(block), False])
    block_time = int(hdr["timestamp"], 16)

    # 1. the spoke's size and its oracle
    count_b, oracle_b = _agg(rpc, [(SPOKE, _call("getReserveCount()")), (SPOKE, _call("ORACLE()"))], block)
    n = _dec(["uint256"], count_b)[0]
    oracle = _dec(["address"], oracle_b)[0].lower()
    (dec_b,) = _agg(rpc, [(oracle, _call("decimals()"))], block)
    oracle_decimals = _dec(["uint8"], dec_b)[0]

    # 2. each reserve
    calls = []
    for i in range(n):
        calls += [(SPOKE, _call("getReserve(uint256)", ["uint256"], [i])),
                  (SPOKE, _call("getReserveConfig(uint256)", ["uint256"], [i]))]
    res2 = _agg(rpc, calls, block)
    reserves = []
    for i in range(n):
        r = _dec(["address", "address", "uint16", "uint8", "uint24", "uint8", "uint32"], res2[2 * i])
        c = _dec(["uint24", "bool", "bool", "bool", "bool"], res2[2 * i + 1])
        reserves.append({"id": i, "underlying": r[0].lower(), "hub": r[1].lower(), "asset_id": r[2], "decimals": r[3],
                         "collateral_risk": r[4], "flags": r[5], "dynamic_config_key": r[6],
                         "paused": c[1], "frozen": c[2], "borrowable": c[3], "receive_shares": c[4]})

    # 3. per reserve: config at its key, amounts, price, hub-side caps
    calls = []
    for rv in reserves:
        i, aid, hub = rv["id"], rv["asset_id"], rv["hub"]
        calls += [(SPOKE, _call("getDynamicReserveConfig(uint256,uint32)", ["uint256", "uint32"],
                                [i, rv["dynamic_config_key"]])),
                  (SPOKE, _call("getReserveSuppliedAssets(uint256)", ["uint256"], [i])),
                  (SPOKE, _call("getReserveTotalDebt(uint256)", ["uint256"], [i])),
                  (oracle, _call("getReservePrice(uint256)", ["uint256"], [i])),
                  (oracle, _call("getReserveSource(uint256)", ["uint256"], [i])),
                  (hub, _call("getSpokeConfig(uint256,address)", ["uint256", "address"], [aid, SPOKE])),
                  (rv["underlying"], _call("symbol()"))]
    res3 = _agg(rpc, calls, block)
    k = 7
    for j, rv in enumerate(reserves):
        d = res3[k * j:k * j + 7]
        dyn = _dec(["uint16", "uint32", "uint16"], d[0])
        rv["collateral_factor_bps"], rv["max_liquidation_bonus_raw"], rv["liquidation_fee_bps"] = dyn
        rv["supplied_raw"] = _dec(["uint256"], d[1])[0]
        rv["debt_raw"] = _dec(["uint256"], d[2])[0]
        rv["price_raw"] = _dec(["uint256"], d[3])[0] if d[3] else None
        rv["price_source"] = _dec(["address"], d[4])[0].lower() if d[4] else None
        sc = _dec(["uint40", "uint40", "uint24", "bool", "bool"], d[5])
        rv.update(add_cap=sc[0], draw_cap=sc[1], risk_premium_threshold=sc[2], spoke_active=sc[3], spoke_halted=sc[4])
        try:
            rv["symbol"] = _dec(["string"], d[6])[0] if d[6] else None
        except Exception:  # noqa: BLE001  a symbol that is not a string is simply not shown
            rv["symbol"] = None

    # 4. the borrowable reserves: rate, liquidity, strategy
    borrow = [rv for rv in reserves if rv["borrowable"]]
    calls = []
    for rv in borrow:
        aid, hub = rv["asset_id"], rv["hub"]
        calls += [(hub, _call("getAssetDrawnRate(uint256)", ["uint256"], [aid])),
                  (hub, _call("getAssetLiquidity(uint256)", ["uint256"], [aid])),
                  (hub, _call("getAssetTotalOwed(uint256)", ["uint256"], [aid])),
                  (hub, _call("getAssetConfig(uint256)", ["uint256"], [aid])),
                  (hub, _call("getAssetOwed(uint256)", ["uint256"], [aid])),
                  (hub, _call("getAssetSwept(uint256)", ["uint256"], [aid]))]
    res4 = _agg(rpc, calls, block) if calls else []
    for j, rv in enumerate(borrow):
        d = res4[6 * j:6 * j + 6]
        rv["drawn_rate_ray"] = _dec(["uint256"], d[0])[0]
        rv["liquidity_raw"] = _dec(["uint256"], d[1])[0]
        rv["owed_raw"] = _dec(["uint256"], d[2])[0]
        rv["drawn_raw"] = _dec(["uint256", "uint256"], d[4])[0]
        rv["swept_raw"] = _dec(["uint256"], d[5])[0]
        ac = _dec(["address", "uint16", "address", "address"], d[3])
        rv["liquidity_fee_bps"], rv["ir_strategy"] = ac[1], ac[2].lower()
    calls = [(rv["ir_strategy"], _call("getInterestRateData(uint256)", ["uint256"], [rv["asset_id"]])) for rv in borrow]
    res5 = _agg(rpc, calls, block) if calls else []
    for rv, d in zip(borrow, res5):
        rv["ir_data"] = list(_dec(["uint16", "uint32", "uint32", "uint32"], d)) if d else None

    # 5. Tnega's Base versions with no reserve on this spoke: listed on the hub?
    versions = base_versions()
    on_spoke = {rv["underlying"] for rv in reserves}
    missing = sorted(a for a in versions if a not in on_spoke)
    res6 = _agg(rpc, [(HUB, _call("isUnderlyingListed(address)", ["address"], [a])) for a in missing], block) \
        if missing else []
    listed_elsewhere = {a: (bool(_dec(["bool"], d)[0]) if d else None) for a, d in zip(missing, res6)}
    return build(reserves, oracle, listed_elsewhere, versions, block, block_time, oracle_decimals)


def build(reserves: list[dict], oracle: str, listed_elsewhere: dict, versions: dict, block: int,
          block_time: int, oracle_decimals: int) -> dict:
    """The served snapshot from decoded reads. Pure."""
    at = {"block": block, "block_time": _iso(block_time)}
    by_key: dict[str, dict] = {}
    rows = []
    for rv in reserves:
        v = versions.get(rv["underlying"])
        dec = rv["decimals"]
        cf = rv["collateral_factor_bps"]
        supplied = _units(rv["supplied_raw"], dec)
        cap = _cap(rv["add_cap"])
        row = {
            "reserve_id": rv["id"], "asset_id": rv["asset_id"], "underlying": rv["underlying"],
            "symbol": rv.get("symbol") or (v or {}).get("symbol"), "key": (v or {}).get("key"),
            "decimals": dec,
            "collateral": bool(cf > 0),
            "collateral_factor_bps": cf, "max_ltv_bps": cf, "liquidation_threshold_bps": cf,
            "dynamic_config_key": rv["dynamic_config_key"],
            "max_liquidation_bonus_bps": max(0, rv["max_liquidation_bonus_raw"] - 10000),
            "liquidation_fee_bps": rv["liquidation_fee_bps"],
            "collateral_risk_bps": rv["collateral_risk"],
            "borrowable": rv["borrowable"], "collateral_only": bool(cf > 0 and not rv["borrowable"]),
            "paused": rv["paused"], "frozen": rv["frozen"],
            "spoke_active": rv["spoke_active"], "spoke_halted": rv["spoke_halted"],
            "supplied_tokens": supplied, "supplied_label": "supplied to the market",
            "debt_tokens": _units(rv["debt_raw"], dec),
            "add_cap_tokens": cap, "draw_cap_tokens": _cap(rv["draw_cap"]),
            "add_cap_used_pct": (round(float(Decimal(rv["supplied_raw"]).scaleb(-dec)) / cap * 100, 2)
                                 if isinstance(cap, int) and cap > 0 else None),
            "oracle_price_usd": (float(Decimal(rv["price_raw"]).scaleb(-oracle_decimals))
                                 if rv.get("price_raw") else None),
            "oracle_price_source": rv.get("price_source"),
            "oracle_price_basis": f"the MAG7 spoke oracle's getReservePrice ({oracle_decimals} decimals, read "
                                  f"from its decimals(), USD); its source is the "
                                  "feed at oracle_price_source",
        }
        row["accepts_new_collateral"] = bool(row["collateral"] and not rv["paused"] and not rv["frozen"]
                                             and rv["spoke_active"] and not rv["spoke_halted"])
        rows.append(row)
        if row["key"]:
            by_key[row["key"]] = row
    for addr, listed in listed_elsewhere.items():
        v = versions[addr]
        by_key[v["key"]] = {"key": v["key"], "symbol": v["symbol"], "underlying": addr, "listed": False,
                            "listed_on_hub": listed, "collateral": False,
                            "reason": ("no reserve on the MAG7 spoke" + (
                                "; the hub lists it (isUnderlyingListed true) for another spoke" if listed is True else
                                "; not listed on the Equities Hub (isUnderlyingListed false)" if listed is False else
                                "; the hub's listing call did not answer at this block, so whether the hub "
                                "lists it was not read"))}
    for k, r in by_key.items():
        r.setdefault("listed", True)
    borrow = []
    for rv in reserves:
        if not rv["borrowable"]:
            continue
        owed, liq, drawn, swept = rv["owed_raw"], rv["liquidity_raw"], rv["drawn_raw"], rv["swept_raw"]
        dec = rv["decimals"]
        ir = rv.get("ir_data")
        borrow.append({
            "reserve_id": rv["id"], "asset_id": rv["asset_id"], "underlying": rv["underlying"],
            "symbol": rv.get("symbol") or ("USDC" if rv["underlying"] == USDC_BASE else None),
            "borrowable": True, "paused": rv["paused"], "frozen": rv["frozen"],
            "spoke_active": rv["spoke_active"], "spoke_halted": rv["spoke_halted"],
            "drawn_rate_ray": str(rv["drawn_rate_ray"]),
            "borrow_apr_pct": round(rv["drawn_rate_ray"] / RAY * 100, 6),
            "rate_basis": NOTES["borrow_rate"],
            "utilization_pct": round(drawn / (liq + drawn + swept) * 100, 4) if (liq + drawn + swept) else None,
            "utilization_basis": ("the rate strategy's own usage ratio at this block: drawn / (liquidity + drawn + "
                                  "swept), from getAssetOwed (drawn), getAssetLiquidity and getAssetSwept "
                                  "(AssetInterestRateStrategy.calculateInterestRate). The rate served is "
                                  "getAssetDrawnRate, which the hub computes from the strategy for its current "
                                  "state when it is called (Hub.getAssetDrawnRate), at this block"),
            "total_owed_tokens": _units(owed, dec), "available_liquidity_tokens": _units(liq, dec),
            "add_cap_tokens": _cap(rv["add_cap"]), "draw_cap_tokens": _cap(rv["draw_cap"]),
            "liquidity_fee_bps": rv.get("liquidity_fee_bps"),
            "ir_strategy": rv.get("ir_strategy"),
            "ir_strategy_matches_book": rv.get("ir_strategy") == IR_STRATEGY_BOOK,
            "ir_data_bps": ({"optimal_usage_ratio": ir[0], "base_drawn_rate": ir[1],
                             "rate_growth_before_optimal": ir[2], "rate_growth_after_optimal": ir[3]} if ir else None),
        })
    usdc = next((b for b in borrow if b["underlying"] == USDC_BASE), None)
    return {
        "protocol": "Aave V4", "chain_id": CHAIN_ID, **at,
        "hub": HUB, "spoke": SPOKE, "spoke_name": "MAG7 Spoke", "hub_name": "Equities Hub",
        "oracle": oracle, "oracle_matches_book": oracle == ORACLE_BOOK, "oracle_decimals": oracle_decimals,
        "reserves": rows,
        "by_key": by_key,
        "borrow": borrow,
        "usdc_borrow": usdc,
        "eligibility": ELIGIBILITY,
        "notes": NOTES,
        "sources": SOURCES,
        "method": ("eth_call through Multicall3 at one pinned block on public Base endpoints (BASE_RPC_URL first "
                   "when set); reserves enumerated from the spoke, never a fixed list"),
    }


# ── the cache ────────────────────────────────────────────────────────────────
#
# ONE READ AT A TIME, ON ITS OWN THREAD, WITH ITS OWN DEADLINE. A read runs
# on a single dedicated thread, never the shared pool, so a hung endpoint
# cannot take threads other requests need. A new read starts only when the
# previous one has finished; the read's client carries a deadline
# (READ_DEADLINE_S), so its thread stops itself even when every endpoint
# hangs. After a failed read the next is not tried before a backoff of
# 60 s, doubling per failure up to REFRESH_SECONDS, reset on success; in the
# meantime callers get the last good snapshot marked stale, or "not read
# yet" with the reason.

import concurrent.futures
import threading

READ_DEADLINE_S = 45.0
BACKOFF_BASE_S = 60.0
_EXEC = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="aave-v4-read")
_lock = threading.Lock()
_state: dict = {"snap": None, "at": None, "error": None, "error_at": None, "future": None, "started": None,
                "failures": 0, "next_try": 0.0}


def _enabled() -> bool:
    return os.environ.get("AAVE_V4_READS", "1").strip().lower() not in ("0", "false", "no")


def _read_with_deadline():
    from .chains import rpc_for
    rpc = rpc_for(CHAIN_ID)
    rpc.deadline = time.monotonic() + READ_DEADLINE_S
    try:
        return _read(rpc)
    finally:
        rpc.close()


def _done(fut: concurrent.futures.Future) -> None:
    now = time.time()
    with _lock:
        try:
            snap = fut.result()
            _state.update(snap=snap, at=now, error=None, error_at=None, failures=0, next_try=0.0)
        except Exception as e:  # noqa: BLE001  the endpoints, not the market: the last good snapshot stays
            from .rpcclient import public_reason
            _state["failures"] += 1
            wait = min(BACKOFF_BASE_S * 2 ** (_state["failures"] - 1), REFRESH_SECONDS)
            _state.update(error=public_reason(e) if hasattr(e, "kind") else type(e).__name__, error_at=now,
                          next_try=now + wait)
            log.warning("[aave-v4] read failed (%s); next try in %.0f s, keeping the last snapshot",
                        _state["error"], wait)


def _kick() -> None:
    """Starts a read unless one is running or the backoff has not passed."""
    with _lock:
        fut = _state["future"]
        if fut is not None and not fut.done():
            return
        if time.time() < _state["next_try"]:
            return
        _state["started"] = time.time()
        fut = _EXEC.submit(lambda: read())       # read() makes the client with the deadline
        _state["future"] = fut
    fut.add_done_callback(_done)


def snapshot() -> dict:
    """{"snapshot" or None, "age_seconds", "status", "reason"}. Never reads
    the chain in the caller's path; starts a background refresh when the
    snapshot is missing or older than REFRESH_SECONDS."""
    if not _enabled():
        return {"snapshot": None, "status": "off", "reason": "Aave V4 reads are switched off on this server"}
    now = time.time()
    if _state["snap"] is None or now - (_state["at"] or 0) > REFRESH_SECONDS:
        _kick()
    snap = _state["snap"]
    if snap is None:
        fut = _state["future"]
        running = fut is not None and not fut.done()
        if _state["error"]:
            why = (f"no read of Aave V4 on Base has succeeded yet; the last attempt failed ({_state['error']}, "
                   f"{_iso(_state['error_at'])}); "
                   + ("a new read is running" if running else f"the next is not before {_iso(_state['next_try'])}"))
        elif running:
            why = "the first read of Aave V4 on Base has started and has not finished"
        else:
            why = f"no read of Aave V4 on Base has run yet; the next is not before {_iso(max(_state['next_try'], now))}"
        return {"snapshot": None, "status": "not_read_yet", "reason": why}
    out = {"snapshot": snap, "status": "ok", "age_seconds": round(now - _state["at"], 1),
           "read_at": _iso(_state["at"])}
    if out["age_seconds"] > REFRESH_SECONDS + STALE_GRACE_S and not (
            _state["error"] and (_state["error_at"] or 0) > (_state["at"] or 0)):
        # Reads run only when someone asks, so after a quiet spell the first
        # answer can be old: say so rather than calling it current.
        out["status"] = "stale"
        out["reason"] = (f"this snapshot was read {out['age_seconds']:.0f} s ago, over the "
                         f"{REFRESH_SECONDS // 60}-minute refresh; reads run only when asked for, and a new one "
                         "has been started")
    if _state["error"] and (_state["error_at"] or 0) > (_state["at"] or 0):
        out["status"] = "stale"
        out["reason"] = (f"the latest read failed ({_state['error']}, {_iso(_state['error_at'])}); this is the last "
                         f"good snapshot, read {out['age_seconds']:.0f} s ago; the next read is not before "
                         f"{_iso(_state['next_try'])}. That is a fact about this server's reads, not about Aave.")
    return out


def for_version(key: str | None, snap: dict | None = None) -> dict | None:
    """The per-version object served beside a Base version; None elsewhere."""
    if not key or not str(key).startswith(f"{CHAIN_ID}/"):
        return None
    s = snap or snapshot()
    data = s.get("snapshot")
    if data is None:
        return {"read": False, "status": s["status"], "reason": s.get("reason")}
    r = data["by_key"].get(key)
    at = {"block": data["block"], "block_time": data["block_time"], "age_seconds": s.get("age_seconds"),
          "status": s["status"]}
    if s.get("reason"):
        at["status_reason"] = s["reason"]
    if r is None:
        return {"listed": False, "collateral": False, "reason": "not a reserve on the MAG7 spoke and not read", **at}
    if not r.get("listed", True):
        return {"listed": False, "collateral": False, "reason": r["reason"], **at}
    return {
        "listed": True, "collateral": r["collateral"], "accepts_new_collateral": r["accepts_new_collateral"],
        "max_ltv_pct": r["max_ltv_bps"] / 100, "liquidation_threshold_pct": r["liquidation_threshold_bps"] / 100,
        "collateral_factor_bps": r["collateral_factor_bps"], "collateral_only": r["collateral_only"],
        "supplied_tokens": r["supplied_tokens"], "supplied_label": r["supplied_label"],
        "add_cap_tokens": r["add_cap_tokens"], "add_cap_used_pct": r["add_cap_used_pct"],
        "paused": r["paused"], "frozen": r["frozen"], "halted": r["spoke_halted"], "active": r["spoke_active"],
        "collateral_risk_bps": r["collateral_risk_bps"],
        "oracle_price_usd": r["oracle_price_usd"], "oracle_price_source": r["oracle_price_source"],
        "reserve_id": r["reserve_id"], "spoke": data["spoke"], "hub": data["hub"],
        "note": NOTES["single_factor"], **at,
    }


def usdc_borrow(snap: dict | None = None) -> dict | None:
    s = snap or snapshot()
    data = s.get("snapshot")
    if data is None:
        return {"read": False, "status": s["status"], "reason": s.get("reason")}
    b = data.get("usdc_borrow")
    if b is None:
        return {"borrowable": False, "reason": "no borrowable USDC reserve on the MAG7 spoke at this block",
                "block": data["block"], "block_time": data["block_time"]}
    return {**{k: b[k] for k in ("borrow_apr_pct", "rate_basis", "utilization_pct", "utilization_basis",
                                 "borrowable", "paused", "frozen", "spoke_halted", "available_liquidity_tokens",
                                 "total_owed_tokens", "draw_cap_tokens")},
            "block": data["block"], "block_time": data["block_time"], "age_seconds": s.get("age_seconds"),
            "status": s["status"]}
