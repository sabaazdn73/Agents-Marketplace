"""
cost.py

The cost of buying each tokenized-equity version with dollars, measured by
simulating the swap on its own pools at one pinned block per chain.

Per version and order size (the slider's 11 stops):

  tokens_out     the probe's exact output from the best pool (the one paying
                 out the most tokens, among quotes that filled the whole size)
  mid            that pool's price before the swap, read in the same eth_call
  pool_cost_usd  size - tokens_out x mid          (stablecoin = $1, labelled)
  gas_usd        (venue gas + 21,000 + 60,000) x gas price x native_usd
  l1_fee_usd     the rollup's L1 data fee (Base, Arbitrum, Robinhood Chain)
  lifi_fee_usd   0.25% x size, LI.FI's published fee, included by default and
                 labelled; the buy flow goes through LI.FI
  cost_usd       the sum; cost_bps = cost_usd / size x 10,000
  paid_per_token size / tokens_out
  mid_gap_bps    how far the best pool's mid sits from the version's deepest
                 pool not flagged as a price outlier, at the same block. Cost is measured against the
                 pool's own mid (fees and price impact); a pool priced away
                 from its neighbours shows here, not in the cost

A partial fill (the pool paid in less than asked before its price moved 4x)
never gets a cost at that size: cost_bps is null, filled_fraction says how
much filled and pool_usd how many dollars the pool took. A version with no
pool, or whose quotes all failed, carries its reason instead of a number.

Every quote is a pool's own swap code run at the block (the probe), so hooks,
dynamic fees and plugins are included exactly. It is an upper bound on what
a buyer pays: an aggregator can split an order or fill it off-pool.

Nothing here does I/O except through the ChainRpc it is handed; it runs in a
worker thread (backend/worker.py), never in a web request.
"""

from __future__ import annotations

import datetime as dt
import logging
import time

from .chains import CHAINS, router_for, rpc_for
from .gasusd import gas_context, gas_usd
from .market_hours import us_market_open
from .pools import screen, select, sort_pair
from . import share_ratio
from .probe import DEFAULT_LIMIT_SQRT_BPS, DEFAULT_MAX_GRANT, Req, infinity_key, quote_many, v4_key
from .rpcclient import ChainRpc, RpcError

log = logging.getLogger("te.cost")

SIZES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000]
RANK_SIZES = (1000, 25000)
LIFI_FEE_RATE = 0.0025
OOG_RETRY_GRANT = 30_000_000
BATCH = {1: 80, 8453: 40, 42161: 60, 56: 80, 4663: 40, 999: 40}
METHOD_ID = "probe-v2"

METHOD = (
    "Measured by simulating the swap on each pool at block {block}: TnegaSwapProbe runs the pool's own swap "
    "code inside eth_call (state override, nothing deployed), including pool fees, hooks and dynamic fees, "
    "and reverts before any token moves. Cost = size - tokens out x the pool's pre-trade mid, plus network "
    "fee at current gas (with the L1 data fee on rollups) and LI.FI's published 0.25% fee. Dollar "
    "stablecoins are taken at $1 (an assumption). A partial fill has no cost at that size. The best pool is "
    "the one paying out the most tokens; mid_gap_bps shows how far its mid sits from the version's deepest "
    "pool. An aggregator may do better by splitting the order; this is the cost on the single best pool."
)


def _iso(t: float) -> str:
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _family(p: dict) -> str:
    return "infinity_cl" if p["f"] == "infinity_cl" else ("v4" if p["f"] == "v4" else "v3")


def build_req(rec: dict, p: dict, size_usd: float, *, sell_tokens: float | None = None) -> Req:
    """A buy of the version with `size_usd` of the pool's stablecoin, or, with
    `sell_tokens`, a sale of that many whole tokens for the stablecoin."""
    dec = {a.lower(): d for _s, (a, d) in CHAINS[rec["chain_id"]]["stables"].items()}[p["qa"]]
    c0, c1 = sort_pair(rec["address"], p["qa"])
    if sell_tokens is None:
        amt = int(round(size_usd * 10 ** dec))
        zf1 = p["qa"] == c0           # paying the stable: token0 -> token1 when the stable sorts first
    else:
        amt = int(sell_tokens * 10 ** rec["decimals"])
        zf1 = rec["address"] == c0    # paying the token
    if p["f"] == "v3":
        return Req(0, p["pool"], zf1, amt, b"")
    if p["f"] == "v4":
        return Req(1, p["mgr"], zf1, amt, v4_key(c0, c1, p["fee"], p["ts"], p["hooks"]))
    if p["f"] == "infinity_cl":
        return Req(2, p["mgr"], zf1, amt, infinity_key(c0, c1, p["hooks"], p["mgr"], p["fee"], bytes.fromhex(p["params"][2:])))
    raise ValueError(p["f"])


def run_quotes(rpc: ChainRpc, chain_id: int, items: list[tuple[object, Req, str]], block: int,
               *, limit_sqrt_bps: int = DEFAULT_LIMIT_SQRT_BPS) -> dict:
    """items: (tag, Req, family). Batches per router address; re-sends quotes
    a batch ran out of gas for; re-runs an out-of-gas quote alone with a 30M
    grant to establish whether the 8M cap was the cause. Returns tag -> result."""
    out: dict = {}
    by_router: dict[str, list] = {}
    for tag, req, fam in items:
        by_router.setdefault(router_for(chain_id, fam) or "", []).append((tag, req))
    n = BATCH.get(chain_id, 40)
    for router, lst in by_router.items():
        queue = list(lst)
        rounds = 0
        while queue and rounds < 6:
            rounds += 1
            nxt = []
            for i in range(0, len(queue), n):
                part = queue[i:i + n]
                try:
                    res = quote_many(rpc, [r for _t, r in part], block, at=router or None, limit_sqrt_bps=limit_sqrt_bps)
                except RpcError as e:
                    if e.kind == "deadline":
                        raise
                    for t, _r in part:
                        out[t] = {"ok": False, "status": "rpc_error", "detail": f"{e.kind}: {e.message[:160]}"}
                    continue
                for (t, r), q in zip(part, res):
                    if q["status"] == "batch_gas":
                        nxt.append((t, r))
                    else:
                        out[t] = q
            queue = nxt
            n = max(1, n // 2)
        for t, _r in queue:
            out[t] = {"ok": False, "status": "batch_gas", "detail": "no gas left after 6 rounds"}
        # (5) empty reverts: is the 8M per-quote cap the cause?
        oog = [(t, r) for t, r in lst if out.get(t, {}).get("status") == "out_of_gas"]
        for t, r in oog[:20]:
            try:
                q = quote_many(rpc, [r], block, at=router or None, max_grant=OOG_RETRY_GRANT,
                               limit_sqrt_bps=limit_sqrt_bps)[0]
            except RpcError as e:
                out[t]["oog_retry"] = f"rpc_error: {e.message[:120]}"
                continue
            out[t]["oog_retry"] = q["status"]
            if q.get("ok"):
                q["detail"] = f"filled with a {OOG_RETRY_GRANT:,} gas grant after running out at {DEFAULT_MAX_GRANT:,}"
                out[t] = q
    return out


def honesty_guard(rpc: ChainRpc, block: int) -> dict:
    """The node must execute eth_call on the state of `block`: compare the
    TIMESTAMP an overridden eth_call sees with the header's. Some HyperEVM
    RPCs answer every historical tag with latest state, silently."""
    addr = "0x00000000000000000000000000000000000071e5"
    seen = int(rpc.eth_call(addr, "0x", block, overrides={addr: {"code": "0x4260005260206000f3"}}), 16)
    hdr = int(rpc.call("eth_getBlockByNumber", [hex(block), False])["timestamp"], 16)
    return {"ok": seen == hdr, "call_timestamp": seen, "header_timestamp": hdr}


# ── Venue sanity: fee ceiling and depth floor ────────────────────────────────

FEE_CEILING_PPM = 10_000          # 1%: a pool charging more is not a venue
TAKE_CEILING_BPS = 110            # a $10 buy losing more than this to fees or hooks (1%, plus rounding)
DEPTH_FLOOR_USD = 2_000           # SPEC B.3: +-2% depth of at least $2,000
DEPTH_LIMIT_SQRT_BPS = 10_100     # the swap stops when the price has moved by 1.0100^2 = 1.0201
TAKE_SIZE_USD = 10
ROUNDING_BPS = 1                  # integer rounding in the swap on a $10 quote
GUARD_BACK = 50


def venue_checks(rpc: ChainRpc, chain_id: int, pairs: list[tuple[dict, dict]], block: int) -> list[dict]:
    """pairs: [(record, screened pool)], each screened pool carrying fee_ppm
    and mid_usd from pools.screen(). Per pair: the current LP fee, the take on
    a $10 buy (fees and hook takes; price impact is nil at $10 on any pool
    that passes the floor), and the dollars that move the price 2% up (a buy)
    and down (a sale, valued at the mid), measured by the probe with the swap
    stopped at the 2% price limit. Verdict: ok, not_a_venue or too_thin."""
    stable_dec = {a.lower(): d for _s, (a, d) in CHAINS[chain_id]["stables"].items()}
    take_items, depth_items = [], []
    for j, (rec, p) in enumerate(pairs):
        take_items.append(((j, "take"), build_req(rec, p, TAKE_SIZE_USD), _family(p)))
        depth_items.append(((j, "buy"), build_req(rec, p, 1e9), _family(p)))
        depth_items.append(((j, "sell"), build_req(rec, p, 0, sell_tokens=1e9), _family(p)))
    take = run_quotes(rpc, chain_id, take_items, block) if take_items else {}
    depth = run_quotes(rpc, chain_id, depth_items, block, limit_sqrt_bps=DEPTH_LIMIT_SQRT_BPS) if depth_items else {}
    out = []
    for j, (rec, p) in enumerate(pairs):
        dec = stable_dec[p["qa"]]
        mid = p.get("mid_usd")
        t, b, s = take.get((j, "take")) or {}, depth.get((j, "buy")) or {}, depth.get((j, "sell")) or {}
        v = {"fee_ppm": p.get("fee_ppm"), "take_bps": None, "buy2_usd": None, "sell2_usd": None}
        if t.get("ok") and t.get("status") == "ok" and mid:
            v["take_bps"] = round((TAKE_SIZE_USD - t["received"] / 10 ** rec["decimals"] * mid) / TAKE_SIZE_USD * 1e4, 2)
        if b.get("ok"):
            v["buy2_usd"] = round(b["paid"] / 10 ** dec, 2)
        if s.get("ok") and mid:
            v["sell2_usd"] = round(s["paid"] / 10 ** rec["decimals"] * mid, 2)
        # What a $10 buy loses beyond the LP fee, the protocol fee and its own
        # (tiny) price impact is a hook's take. The ceiling applies to the pool's
        # fee: LP fee plus any hook take. The protocol fee is the venue's, shown,
        # and not counted against the pool.
        v["protocol_fee_ppm"] = p.get("protocol_fee_ppm") or 0
        hook_bps = None
        if v["take_bps"] is not None and v["fee_ppm"] is not None:
            impact_bps = (TAKE_SIZE_USD / v["buy2_usd"] * 100) if v.get("buy2_usd") else 0
            hook_bps = v["take_bps"] - v["fee_ppm"] / 100 - v["protocol_fee_ppm"] / 100 - impact_bps
            v["hook_take_bps"] = round(max(0.0, hook_bps), 2)
        # Order: the LP fee; then depth (on a thin pool a $10 buy's own impact is
        # large and only estimated, so no hook take is inferred there); then a
        # hook take on pools deep enough for the $10 test to isolate it.
        if v["fee_ppm"] is not None and v["fee_ppm"] > FEE_CEILING_PPM:
            v.update(verdict="not_a_venue", reason=f"LP fee {v['fee_ppm'] / 1e4:g}% exceeds 1%")
        elif v["buy2_usd"] is None or v["sell2_usd"] is None:
            v.update(verdict="too_thin", reason="its +-2% depth could not be measured (" +
                     ", ".join(x.get("status", "missing") for x in (b, s) if not x.get("ok")) + ")")
        elif min(v["buy2_usd"], v["sell2_usd"]) < DEPTH_FLOOR_USD:
            v.update(verdict="too_thin", reason=f"+-2% depth ${min(v['buy2_usd'], v['sell2_usd']):,.0f} is under the "
                                               f"${DEPTH_FLOOR_USD:,} floor (buy ${v['buy2_usd']:,.0f}, sell ${v['sell2_usd']:,.0f})")
        elif hook_bps is not None and v["fee_ppm"] / 100 + max(0.0, hook_bps) > FEE_CEILING_PPM / 100 + ROUNDING_BPS:
            v.update(verdict="not_a_venue", reason=f"LP fee {v['fee_ppm'] / 1e4:g}% plus a hook take of "
                                                  f"{max(0.0, hook_bps) / 100:.2f}% exceeds 1%")
        elif hook_bps is None and v["take_bps"] is not None and v["take_bps"] > TAKE_CEILING_BPS:
            v.update(verdict="not_a_venue", reason=f"a ${TAKE_SIZE_USD} buy loses {v['take_bps'] / 100:.2f}% to fees or hooks, over 1%")
        else:
            v.update(verdict="ok", reason=None)
        out.append(v)
    return out


# ── Selection: which pools each version is quoted on ────────────────────────

def rank(rpc: ChainRpc, chain_id: int, recs: dict[str, dict], cands: dict[str, list[dict]], block: int) -> tuple[dict, dict]:
    """cands: version key -> candidate pools (dollar-quoted, every one ever
    found). In order: screen every candidate (price and active liquidity);
    merge adapters that show another pool's exact liquidity; run the venue
    checks on EVERY live candidate (no cap before the checks, so a large
    pool that is not a venue can never push a real one out); take the
    version's reference mid from its deepest passing pool by measured depth
    and set aside passing pools priced more than 10% from it; quote the eight
    deepest remaining at $1,000 and $25,000; keep the deepest and the best at
    each size, at most three pools.

    summary[k]["verdicts"] holds a verdict for every candidate (ok, not_a_venue,
    too_thin, price_outlier, adapter, no_price, no_liquidity), so the caller
    keeps every pool and re-checks it at the next ranking."""
    flat = [(recs[k], p) for k, ps in cands.items() for p in ps]
    sc = screen(rpc, chain_id, flat, block) if flat else []
    screened: dict[str, list[dict]] = {}
    for (rec, p), s in zip(flat, sc):
        screened.setdefault(rec["key"], []).append(dict(p, **s))
    selection, summary, items = {}, {}, []
    live: dict[str, list[dict]] = {}
    for k in cands:
        ps = screened.get(k, [])
        summary[k] = {"screened": len(ps), "verdicts": []}
        ok = []
        for p in ps:
            if p.get("screen") == "ok" and p.get("mid_usd"):
                ok.append(p)
            else:
                summary[k]["verdicts"].append((pack(p), p.get("screen") or "no_price"))
        summary[k]["no_price_or_liquidity"] = len(ps) - len(ok)
        # One liquidity, one venue: a V3-interface adapter over a V4 pool (4663
        # factory 0xd09e..., poolManager() = the PoolManager) shows the V4 pool's
        # exact price and liquidity; the native pool is kept.
        seen_liq, uniq = set(), []
        for p in sorted(ok, key=lambda p: p["f"] == "v3"):
            sig = (p.get("sqrtp"), p.get("L"))
            if sig in seen_liq:
                summary[k]["verdicts"].append((pack(p), "adapter"))
                continue
            seen_liq.add(sig)
            uniq.append(p)
        live[k] = uniq
    pairs = [(recs[k], p) for k in cands for p in live[k]]
    checked = venue_checks(rpc, chain_id, pairs, block) if pairs else []
    j = 0
    for k in cands:
        passed, dropped = [], []
        for p in live[k]:
            v = checked[j]
            j += 1
            p = dict(p, venue_check=v, depth2=(min(v["buy2_usd"], v["sell2_usd"])
                                                if v.get("buy2_usd") is not None and v.get("sell2_usd") is not None else 0))
            (passed if v["verdict"] == "ok" else dropped).append(p)
            if v["verdict"] != "ok":
                summary[k]["verdicts"].append((pack(p), v["verdict"]))
        why = summary[k]
        why["not_a_venue"] = [p["venue_check"]["reason"] for p in dropped if p["venue_check"]["verdict"] == "not_a_venue"][:3]
        why["too_thin"] = [p["venue_check"]["reason"] for p in dropped if p["venue_check"]["verdict"] == "too_thin"][:3]
        why["dropped"] = len(dropped)
        thin = [p["depth2"] for p in dropped if p["venue_check"]["verdict"] == "too_thin" and p["depth2"]]
        if thin:
            why["thin_depth_usd"] = max(thin)
        # reference: the deepest passing pool the universe does not flag, by measured depth
        passed.sort(key=lambda p: (bool(p.get("po")), -p["depth2"]))
        if passed:
            ref = passed[0]["mid_usd"]
            band = [p for p in passed if abs(p["mid_usd"] / ref - 1) <= 0.10]
            for p in passed:
                if p not in band:
                    why["verdicts"].append((pack(p), "price_outlier"))
            why["price_outliers"] = len(passed) - len(band)
            passed = band
        for p in passed:
            why["verdicts"].append((pack(p), "ok"))
        live[k] = passed[:8]
        for i, p in enumerate(live[k]):
            for s in RANK_SIZES:
                items.append(((k, i, s), build_req(recs[k], p, s), _family(p)))
    res = run_quotes(rpc, chain_id, items, block) if items else {}
    for k, pool_list in live.items():
        keep = [0] if pool_list else []     # the deepest first: its mid is the version's reference
        for s in RANK_SIZES:
            got = [(res.get((k, i, s), {}), i) for i in range(len(pool_list))]
            got = [(q["received"], i) for q, i in got if q.get("ok") and q.get("status") == "ok"]
            if got:
                keep.append(max(got)[1])
        idx = list(dict.fromkeys(keep))[:3]
        selection[k] = [pack(pool_list[i]) for i in idx]
        summary[k]["kept"] = len(selection[k])
    return selection, summary


def pack(p: dict) -> list:
    """A pool in stored form: [family, address or manager, fee, tick spacing,
    hooks, other currency, Infinity parameters, source]. The V4 or Infinity
    pool id is recomputed from these (pools.v4_pool_id / infinity_pool_id)."""
    return [p["f"], p.get("pool") or p.get("mgr"), p.get("fee"), p.get("ts"), p.get("hooks"), p["qa"], p.get("params"),
            p.get("src")]


def unpack(x: list) -> dict:
    f, addr, fee, ts, hooks, qa, params, src = x
    p = {"f": f, "qa": qa, "src": src}
    if f == "v3":
        p["pool"] = addr
    else:
        p.update(mgr=addr, fee=fee, ts=ts, hooks=hooks, params=params)
    return {k: v for k, v in p.items() if v is not None}


# ── Refresh: every size on the selected pools ────────────────────────────────

def refresh_chain(chain_id: int, recs: list[dict], selection: dict[str, list[dict]], why: dict[str, dict],
                  native_px: dict, *, rpc: ChainRpc | None = None, search: dict | None = None,
                  prev_ratios: dict | None = None) -> tuple[list[dict], dict]:
    """Quotes every selected pool of every version at every size at one
    pinned block and returns (one document per version, run report)."""
    rpc = rpc or rpc_for(chain_id)
    t_start = time.time()
    block = rpc.block_number()
    # A node that answers every tag with latest state passes a check at the
    # head; one at head-50 catches it. Then again after the quotes, on every
    # endpoint that served a call, in case a failover moved us to one.
    guard = {"head_minus_50": honesty_guard(rpc, block - GUARD_BACK), "block": honesty_guard(rpc, block)}
    if not (guard["head_minus_50"]["ok"] and guard["block"]["ok"]):
        raise RpcError("rpc", f"endpoint did not execute on the requested block's state near {block}")
    guard["header_timestamp"] = guard["block"]["header_timestamp"]
    ctx = gas_context(rpc, chain_id, block, native_px)
    block_time = guard["header_timestamp"]
    ratios = share_ratio.read(rpc, recs, block, block_time, prev_ratios)
    items = []
    selection = {k: [unpack(x) for x in v] for k, v in selection.items()}
    # venue sanity again at this block, on the selected pools
    by_key = {r["key"]: r for r in recs}
    pairs = [(by_key[k], p) for k, ps in selection.items() if k in by_key for p in ps]
    sc = screen(rpc, chain_id, pairs, block) if pairs else []
    checked = venue_checks(rpc, chain_id, [(r, dict(p, **s)) for (r, p), s in zip(pairs, sc)], block) if pairs else []
    venue: dict[tuple, dict] = {}
    n_seen: dict[str, int] = {}
    for ((r, p), v) in zip(pairs, checked):
        i = n_seen.get(r["key"], 0)
        venue[(r["key"], i)] = v
        n_seen[r["key"]] = i + 1
    for rec in recs:
        for i, p in enumerate(selection.get(rec["key"], [])):
            if (venue.get((rec["key"], i)) or {}).get("verdict") != "ok":
                continue                        # never quoted, never best
            if ratios[rec["key"]]["hold"]:
                continue                        # a multiplier change is within 15 minutes
            for s in SIZES:
                items.append(((rec["key"], i, s), build_req(rec, p, s), _family(p)))
    res = run_quotes(rpc, chain_id, items, block) if items else {}
    guard["after"] = {}
    for ep in rpc.endpoints:
        if rpc.stats.by_endpoint.get(ep.label):
            one = ChainRpc(chain_id, [ep], min_interval=rpc.min_interval, deadline=rpc.deadline)
            g = honesty_guard(one, block)
            one.close()
            guard["after"][ep.label] = g["ok"]
            if not g["ok"]:
                raise RpcError("rpc", f"{ep.label} did not execute on block {block}'s state after the quotes")
    now = time.time()
    # the market flag is for the block the figures are from, not the clock
    open_, open_basis = us_market_open(dt.datetime.fromtimestamp(block_time, dt.timezone.utc))
    docs = [_version_doc(rec, selection.get(rec["key"], []), why.get(rec["key"]) or {}, res, ctx, block, now,
                         open_, open_basis, search or {},
                         [venue.get((rec["key"], i)) or {} for i in range(len(selection.get(rec["key"], [])))],
                         ratios[rec["key"]], block_time)
            for rec in recs]
    report = {
        "chain_id": chain_id, "block": block, "computed_at": _iso(now), "seconds": round(time.time() - t_start, 1),
        "quotes": len(items), "rpc": rpc.stats.as_dict(), "honesty_guard": guard,
        "gas": {k: ctx[k] for k in ("gas_price_wei", "native", "native_usd", "native_usd_source", "l1_fee_usd")},
        "statuses": _count(q.get("status") for q in res.values()),
        "oog_retries": _count(q.get("oog_retry") for q in res.values() if q.get("oog_retry")),
        "ratios": ratios, "held": sum(1 for v in ratios.values() if v["hold"]),
    }
    return docs, report


def _count(xs) -> dict:
    out: dict = {}
    for x in xs:
        out[x] = out.get(x, 0) + 1
    return out


def _r(x: float | None, n: int) -> float | None:
    return None if x is None else round(x, n)


def _version_doc(rec: dict, pools: list[dict], why: dict, res: dict, ctx: dict, block: int, now: float,
                 open_: bool | None, open_basis: str, search: dict | None = None,
                 venues: list[dict] | None = None, ratio: dict | None = None, block_time: int | None = None) -> dict:
    c = CHAINS[rec["chain_id"]]
    base = {
        "_id": rec["key"], "key": rec["key"], "underlying": rec["underlying"], "chain_id": rec["chain_id"],
        "chain": c["name"], "group": "evm", "symbol": rec["symbol"], "issuer": rec["issuer"],
        "block": block, "computed_at": _iso(now), "us_market_open": open_, "us_market_basis": open_basis,
        "controls": rec.get("controls"), "controls_block": rec.get("controls_block"),
        "block_time": block_time,
        "share_ratio": (ratio or {}).get("ratio"), "share_ratio_basis": (ratio or {}).get("basis"),
        "comparable": bool((ratio or {}).get("comparable")),
    }
    venues = venues or []
    if (ratio or {}).get("hold"):
        return {**base, "state": "held", "reason": ratio["hold_reason"]}
    ok_idx = [i for i in range(len(pools)) if (venues[i] if i < len(venues) else {}).get("verdict") == "ok"]
    if not ok_idx and (why.get("dropped") or pools):
        # Pools exist, and none passes: never measured, never best.
        vs = [v for v in venues if v.get("verdict") in ("not_a_venue", "too_thin")]
        thin = why.get("too_thin") or [v["reason"] for v in vs if v["verdict"] == "too_thin"]
        nav = why.get("not_a_venue") or [v["reason"] for v in vs if v["verdict"] == "not_a_venue"]
        depths = [min(v["buy2_usd"], v["sell2_usd"]) for v in vs if v.get("buy2_usd") is not None and v.get("sell2_usd") is not None]
        if thin or nav:
            state = "too_thin" if thin else "not_a_venue"
            reason = "; ".join(([f"too thin: {thin[0]}"] if thin else []) + ([f"not a venue: {nav[0]}"] if nav else []))
            vc = why.get("verdict_counts") or {}
            words = {"not_a_venue": "not a venue", "too_thin": "too thin", "no_liquidity": "no liquidity at the current "
                     "price", "no_price": "no price", "price_outlier": "priced >10% from the reference", "adapter":
                     "an adapter over another pool"}
            if vc:
                reason += " (pools held: " + ", ".join(f"{n} {words.get(v, v)}" for v, n in sorted(vc.items())) + ")"
            return {**base, "state": state, "reason": reason, "pool_usd": max(depths) if depths and thin else
                    why.get("thin_depth_usd"), "pool_usd_basis": "+-2% depth of its deepest pool (the smaller side)",
                    "pool_search": {**_search_note(rec, why), "not_a_venue": nav, "too_thin": thin}}
    if not pools:
        reason = ("no pool against a dollar stablecoin found" if not why.get("screened")
                  else "pools found, none with liquidity at a price within 10% of the version's deepest pool")
        note = {**_search_note(rec, why), "hooked_pools": search or {"status": "not_applicable"}}
        st = (search or {}).get("status", "not_applicable")
        if st not in ("complete", "not_applicable"):
            # The hooked-pool family is not fully searched on this chain, so
            # "no pool" cannot be claimed, whether nothing was found or only
            # pools with no price or liquidity were.
            found = ("no pool found by factory construction" if not why.get("screened") else
                     f"{why.get('screened')} pools found, none with a price and liquidity")
            return {**base, "state": "not_searched",
                    "reason": f"{found}; hooked V4/Infinity pools not fully searched: "
                              f"{(search or {}).get('reason') or st}", "pool_search": note}
        return {**base, "state": "no_pool", "reason": reason, "pool_search": note}
    stable_dec = {a.lower(): d for _s, (a, d) in c["stables"].items()}
    per = {k: [] for k in ("cost_bps", "cost_usd", "pool_cost_usd", "gas_usd", "tokens_out_raw", "paid_per_token",
                           "allin_per_token", "allin_per_share", "tokens_per_1000",
                           "mid_usd", "mid_gap_bps", "filled_fraction", "filled_usd", "pool", "status")}
    share = (ratio or {}).get("ratio")
    # The reference mid: the first passing pool (the deepest at ranking), pre-swap, this block.
    ref_mid = None
    r0 = ok_idx[0] if ok_idx else 0
    for s in SIZES:
        q0 = res.get((rec["key"], r0, s)) or {}
        if q0.get("sqrt_price_x96"):
            ref_mid = _mid(q0["sqrt_price_x96"], rec, pools[r0], stable_dec[pools[r0]["qa"]])
            break
    # +-2% depth per pool, measured at this block (the smaller of the two sides)
    depth2 = [min(v["buy2_usd"], v["sell2_usd"]) if v.get("buy2_usd") is not None and v.get("sell2_usd") is not None
              else None for v in (venues + [{}] * len(pools))[:len(pools)]]
    for s in SIZES:
        qs = [(res.get((rec["key"], i, s)) or {"ok": False, "status": "missing"}, i) for i in ok_idx]
        full = [(q, i) for q, i in qs if q.get("ok") and q.get("status") == "ok"]
        part = [(q, i) for q, i in qs if q.get("ok") and q.get("status") == "partial"]
        row = dict.fromkeys(per)
        if full:
            q, i = max(full, key=lambda x: x[0]["received"])
            dec_s = stable_dec[pools[i]["qa"]]
            tokens = q["received"] / 10 ** rec["decimals"]
            mid = _mid(q["sqrt_price_x96"], rec, pools[i], dec_s)
            ex, l1 = gas_usd(ctx, q["gas_used"])
            pool_cost = s - tokens * mid
            lifi = LIFI_FEE_RATE * s
            total = None if l1 is None else pool_cost + ex + l1 + lifi
            # The primary figure: everything paid (the size, gas, the L1 fee and
            # LI.FI's fee) over the tokens received; per share where the ratio is read.
            allin = None if l1 is None else (s + ex + l1 + lifi) / tokens
            row.update(allin_per_token=_r(allin, 6), allin_per_share=_r(allin / share, 6) if allin and share else None,
                       tokens_per_1000=_r(1000 / allin, 8) if allin else None)
            row.update(cost_bps=_r(total / s * 1e4, 2) if total is not None else None, cost_usd=_r(total, 4),
                       pool_cost_usd=_r(pool_cost, 4), gas_usd=_r(ex, 5),
                       tokens_out_raw=str(q["received"]), paid_per_token=_r(s / tokens, 6),
                       mid_usd=_r(mid, 6), mid_gap_bps=_r((mid / ref_mid - 1) * 1e4, 2) if ref_mid else None,
                       filled_fraction=1.0, filled_usd=float(s), pool=i,
                       status="filled" if l1 is not None else "no_l1_fee")
        elif part:
            q, i = max(part, key=lambda x: x[0]["paid"])
            dec_s = stable_dec[pools[i]["qa"]]
            paid_usd = q["paid"] / 10 ** dec_s
            # not rounded to cents: a pool that takes $0.0008 is thin, not absent
            row.update(filled_fraction=float(f"{q['filled_fraction']:.6g}"), filled_usd=float(f"{paid_usd:.6g}"), pool=i, status="partial",
                       tokens_out_raw=str(q["received"]), mid_usd=_r(_mid(q["sqrt_price_x96"], rec, pools[i], dec_s), 6))
        else:
            st = _count(q.get("status") for q, _i in qs)
            row.update(status="failed:" + ",".join(f"{k}x{v}" for k, v in st.items()))
        for k in per:
            per[k].append(row[k])
    # pool_usd: the reference pool's measured +-2% depth (the smaller side),
    # dollars that move its price 2%; per pool in depth2_usd.
    pool_usd = depth2[r0] if ok_idx else None
    per["ref_mid_usd"] = _r(ref_mid, 6)       # the version's own reference: its deepest passing pool
    per["lifi_fee_rate"] = LIFI_FEE_RATE
    state = "measured" if any(st == "filled" for st in per["status"]) else (
        "partial" if any(st == "partial" for st in per["status"]) else "failed")
    return {
        **base, **per, "state": state, "method_id": METHOD_ID, "sizes": SIZES, "pools": [pack(p) for p in pools], "pool_usd": pool_usd,
        "pool_usd_basis": "+-2% depth of the pool, the smaller side, measured by the probe at this block",
        "depth2_usd": depth2, "venues": [[v.get("verdict"), v.get("fee_ppm"), v.get("take_bps"), v.get("buy2_usd"),
                                          v.get("sell2_usd")] for v in (venues + [{}] * len(pools))[:len(pools)]],
        "gas_ctx": {"gas_price_gwei": _r(ctx["gas_price_wei"] / 1e9, 6), "native": ctx["native"],
                    "native_usd": _r(ctx["native_usd"], 4), "l1_fee_usd": _r(ctx["l1_fee_usd"], 6)},
        "pool_search": _search_note(rec, why),
    }


def _search_note(rec: dict, why: dict) -> dict:
    return {k: why.get(k) for k in ("screened", "no_price_or_liquidity", "price_outliers", "kept") if why.get(k)}


def _mid(sqrtp: int, rec: dict, p: dict, dec_s: int) -> float:
    t0, _t1 = sort_pair(rec["address"], p["qa"])
    d0, d1 = (rec["decimals"], dec_s) if t0 == rec["address"] else (dec_s, rec["decimals"])
    p10 = (sqrtp / 2 ** 96) ** 2 * 10 ** (d0 - d1)
    return p10 if t0 == rec["address"] else 1 / p10
