"""
cost_job.py

One chain's cost refresh, synchronous, for asyncio.to_thread in the worker:

  1. extend pool discovery (Initialize logs, bounded per run);
  2. re-rank the pools each version is quoted on, daily or when discovery
     found new ones (liquidity screen, then the probe at $1,000 and $25,000);
  3. quote every selected pool at every size at one pinned block.

State between runs is the chain's meta document (discovery cursors, the
selection, the discovered candidates). It is small: a version keeps at most
five discovered candidates and three selected pools.
"""

from __future__ import annotations

import os
import time

from . import pools as pools_mod
from .chains import rpc_for
from .cost import pack, rank, refresh_chain, unpack

RANK_EVERY_SECONDS = 24 * 3600
# Bumped when the selection rule changes, so stored selections are re-ranked
# at the next cycle rather than up to a day later. 2: the reference mid never
# comes from a pool the universe flags as a price outlier.
RANK_RULE = 2
DISCOVERED_KEEP = 2
LOG_CALLS_PER_RUN = {1: 24, 8453: 60, 42161: 16, 56: 24, 4663: 40}
if os.environ.get("TE_DISCOVERY_MAX_CALLS"):        # a one-off backfill run by hand
    LOG_CALLS_PER_RUN = {k: int(os.environ["TE_DISCOVERY_MAX_CALLS"]) for k in LOG_CALLS_PER_RUN}


def run_chain(chain_id: int, inputs: dict, meta: dict | None, native_px: dict) -> tuple[list[dict], dict]:
    meta = dict(meta or {})
    recs = [r for r in inputs["records"] if r["chain_id"] == chain_id]
    by_key = {r["key"]: r for r in recs}
    by_addr = {r["address"]: r for r in recs}
    rpc = rpc_for(chain_id)
    t0 = time.time()

    # 1. discovery
    found = []
    disc_calls = 0
    if pools_mod.managers(chain_id) and recs:
        found, meta["disc"] = pools_mod.scan(chain_id, list(by_addr), meta.get("disc"),
                                             max_calls=LOG_CALLS_PER_RUN.get(chain_id, 16))
        disc_calls = sum(v.get("last_calls", 0) for v in meta["disc"].values())
    discovered: dict[str, list[dict]] = {k: [unpack(x) for x in v] for k, v in (meta.get("discovered") or {}).items()}
    new = 0
    for p in found:
        if p.get("why"):
            continue
        k = by_addr[p["token"]]["key"]
        lst = discovered.setdefault(k, [])
        if not any(pack(x) == pack(p) for x in lst):
            lst.append(unpack(pack(p)))
            new += 1

    # 2. selection
    stale = time.time() - meta.get("ranked_at", 0) > RANK_EVERY_SECONDS
    if stale or new or not meta.get("selection") or meta.get("rank_rule") != RANK_RULE:
        cands = {}
        for r in recs:
            ps = [p for p in r["pools"] if not p.get("why")]
            seen = {tuple(pack(p)[:6]) for p in ps}
            ps += [p for p in discovered.get(r["key"], []) if tuple(pack(p)[:6]) not in seen]
            cands[r["key"]] = ps
        block = rpc.block_number()
        selection, summary = rank(rpc, chain_id, by_key, cands, block)
        # keep only the discovered candidates that survived screening
        # keep the discovered candidates that survived screening and were not
        # selected (the selection is stored anyway), at most DISCOVERED_KEEP
        keep = {k: {tuple(x[:6]) for x in summary[k].pop("candidates", [])} for k in summary}
        chosen = {k: {tuple(x[:6]) for x in v} for k, v in selection.items()}
        discovered = {k: [p for p in v if tuple(pack(p)[:6]) in keep.get(k, set()) - chosen.get(k, set())][:DISCOVERED_KEEP]
                      for k, v in discovered.items()}
        # the selected discovered pools come back as candidates at the next ranking
        for k, v in selection.items():
            for x in v:
                if x[7] == "initialize_log":
                    discovered.setdefault(k, []).insert(0, unpack(x))
        meta.update(selection=selection, summary=summary, ranked_at=time.time(), ranked_block=block, rank_rule=RANK_RULE)
    meta["discovered"] = {k: [pack(p) for p in v] for k, v in discovered.items() if v}
    rank_calls = rpc.stats.calls

    # 3. every size
    docs, report = refresh_chain(chain_id, recs, meta["selection"], meta.get("summary") or {}, native_px, rpc=rpc)
    report.update(discovery_log_calls=disc_calls, ranking_calls=rank_calls, new_pools_found=new,
                  total_seconds=round(time.time() - t0, 1),
                  discovery=pools_mod.coverage(meta.get("disc") or {}))
    meta["last_run"] = report
    rpc.close()
    return docs, meta
