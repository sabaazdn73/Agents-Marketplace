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
from .probe import DEFAULT_MAX_GRANT, Req, infinity_key, quote_many, v4_key
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


def build_req(rec: dict, p: dict, size_usd: float) -> Req:
    """A buy of the version with `size_usd` of the pool's stablecoin."""
    dec = {a.lower(): d for _s, (a, d) in CHAINS[rec["chain_id"]]["stables"].items()}[p["qa"]]
    amt = int(round(size_usd * 10 ** dec))
    c0, c1 = sort_pair(rec["address"], p["qa"])
    zf1 = p["qa"] == c0               # paying the stable: token0 -> token1 when the stable sorts first
    if p["f"] == "v3":
        return Req(0, p["pool"], zf1, amt, b"")
    if p["f"] == "v4":
        return Req(1, p["mgr"], zf1, amt, v4_key(c0, c1, p["fee"], p["ts"], p["hooks"]))
    if p["f"] == "infinity_cl":
        return Req(2, p["mgr"], zf1, amt, infinity_key(c0, c1, p["hooks"], p["mgr"], p["fee"], bytes.fromhex(p["params"][2:])))
    raise ValueError(p["f"])


def run_quotes(rpc: ChainRpc, chain_id: int, items: list[tuple[object, Req, str]], block: int) -> dict:
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
                    res = quote_many(rpc, [r for _t, r in part], block, at=router or None)
                except RpcError as e:
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
                q = quote_many(rpc, [r], block, at=router or None, max_grant=OOG_RETRY_GRANT)[0]
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


# ── Selection: which pools each version is quoted on ────────────────────────

def rank(rpc: ChainRpc, chain_id: int, recs: dict[str, dict], cands: dict[str, list[dict]], block: int) -> tuple[dict, dict]:
    """cands: version key -> candidate pools (dollar-quoted). Screens them
    by liquidity and price (pools.screen / pools.select), then quotes the
    survivors at $1,000 and $25,000 and keeps, per version, the pool paying
    the most at each of those sizes and the deepest: at most three pools,
    quoted at every size on each refresh."""
    flat = [(recs[k], p) for k, ps in cands.items() for p in ps]
    sc = screen(rpc, chain_id, flat, block) if flat else []
    screened: dict[str, list[dict]] = {}
    for (rec, p), s in zip(flat, sc):
        screened.setdefault(rec["key"], []).append(dict(p, **s))
    selection, summary, items = {}, {}, []
    live: dict[str, list[dict]] = {}
    for k in cands:
        ok_pools, why = select(recs[k], screened.get(k, []))
        # keep up to 8 live candidates for the next ranking (select() returns 3,
        # so re-run on the live list with a larger cap)
        live[k] = ok_pools
        summary[k] = why
    # rank by probe: quote each live, non-outlier candidate at the rank sizes
    for k in cands:
        pool_list = [p for p in screened.get(k, []) if p.get("screen") == "ok" and p.get("mid_usd")]
        ref = live[k][0]["mid_usd"] if live[k] else None      # select() sorts deepest first; recompute from its reference
        unflagged = [p for p in pool_list if not p.get("po")]
        if unflagged and live[k]:
            ref = max(unflagged, key=lambda p: p["depth1_usd"])["mid_usd"]
        if ref:
            pool_list = [p for p in pool_list if abs(p["mid_usd"] / ref - 1) <= 0.10]
        # deepest unflagged first: pool 0 is the version's reference mid (mid_gap_bps)
        pool_list = sorted(pool_list, key=lambda p: (bool(p.get("po")), -p["depth1_usd"]))[:8]
        live[k] = pool_list
        for i, p in enumerate(pool_list):
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
        summary[k].pop("reference_pool", None)
        summary[k]["candidates"] = [pack(p) for p in pool_list]
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
                  native_px: dict, *, rpc: ChainRpc | None = None) -> tuple[list[dict], dict]:
    """Quotes every selected pool of every version at every size at one
    pinned block and returns (one document per version, run report)."""
    rpc = rpc or rpc_for(chain_id)
    t_start = time.time()
    block = rpc.block_number()
    guard = honesty_guard(rpc, block)
    if not guard["ok"]:
        raise RpcError("rpc", f"endpoint served state other than block {block}: {guard}")
    ctx = gas_context(rpc, chain_id, block, native_px)
    items = []
    selection = {k: [unpack(x) for x in v] for k, v in selection.items()}
    for rec in recs:
        for i, p in enumerate(selection.get(rec["key"], [])):
            for s in SIZES:
                items.append(((rec["key"], i, s), build_req(rec, p, s), _family(p)))
    res = run_quotes(rpc, chain_id, items, block) if items else {}
    now = time.time()
    open_, open_basis = us_market_open(dt.datetime.fromtimestamp(now, dt.timezone.utc))
    docs = [_version_doc(rec, selection.get(rec["key"], []), why.get(rec["key"]) or {}, res, ctx, block, now,
                         open_, open_basis) for rec in recs]
    report = {
        "chain_id": chain_id, "block": block, "computed_at": _iso(now), "seconds": round(time.time() - t_start, 1),
        "quotes": len(items), "rpc": rpc.stats.as_dict(), "honesty_guard": guard,
        "gas": {k: ctx[k] for k in ("gas_price_wei", "native", "native_usd", "native_usd_source", "l1_fee_usd")},
        "statuses": _count(q.get("status") for q in res.values()),
        "oog_retries": _count(q.get("oog_retry") for q in res.values() if q.get("oog_retry")),
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
                 open_: bool | None, open_basis: str) -> dict:
    c = CHAINS[rec["chain_id"]]
    base = {
        "_id": rec["key"], "key": rec["key"], "underlying": rec["underlying"], "chain_id": rec["chain_id"],
        "chain": c["name"], "group": "evm", "symbol": rec["symbol"], "issuer": rec["issuer"],
        "block": block, "computed_at": _iso(now), "us_market_open": open_, "us_market_basis": open_basis,
        "controls": rec.get("controls"), "controls_block": rec.get("controls_block"),
    }
    if not pools:
        reason = ("no pool against a dollar stablecoin found" if not why.get("screened")
                  else "pools found, none with liquidity at a price within 10% of the version's deepest pool")
        return {**base, "state": "no_pool", "reason": reason, "pool_search": _search_note(rec, why)}
    stable_dec = {a.lower(): d for _s, (a, d) in c["stables"].items()}
    per = {k: [] for k in ("cost_bps", "cost_usd", "pool_cost_usd", "gas_usd", "tokens_out_raw", "paid_per_token",
                           "mid_usd", "mid_gap_bps", "filled_fraction", "filled_usd", "pool", "status")}
    # The reference mid: pool 0 (the deepest at ranking), pre-swap, this block.
    ref_mid = None
    for s in SIZES:
        q0 = res.get((rec["key"], 0, s)) or {}
        if q0.get("sqrt_price_x96"):
            ref_mid = _mid(q0["sqrt_price_x96"], rec, pools[0], stable_dec[pools[0]["qa"]])
            break
    pool_usd = None
    pool_usd_lower_bound = False
    for s in SIZES:
        qs = [(res.get((rec["key"], i, s)) or {"ok": False, "status": "missing"}, i) for i in range(len(pools))]
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
    # pool_usd: the dollars the best pool takes before its price moves 4x, from
    # the largest size; a lower bound when even that size filled.
    last = per["status"][-1]
    if last == "partial":
        pool_usd = per["filled_usd"][-1]
    elif last == "filled":
        pool_usd, pool_usd_lower_bound = float(SIZES[-1]), True
    else:
        fills = [u for u, st in zip(per["filled_usd"], per["status"]) if st in ("filled", "partial") and u]
        pool_usd = max(fills) if fills else None
        pool_usd_lower_bound = True
    per["lifi_fee_rate"] = LIFI_FEE_RATE
    state = "measured" if any(st == "filled" for st in per["status"]) else (
        "partial" if any(st == "partial" for st in per["status"]) else "failed")
    return {
        **base, **per, "state": state, "method_id": METHOD_ID, "sizes": SIZES, "pools": [pack(p) for p in pools], "pool_usd": pool_usd,
        "pool_usd_lower_bound": pool_usd_lower_bound,
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
