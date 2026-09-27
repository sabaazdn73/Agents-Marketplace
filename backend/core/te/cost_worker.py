"""
cost_worker.py

One 15-minute cycle of the cost refresh, for backend/worker.py (never the
web process). Chains run one after another, each in a thread with a
timeout, so a slow or failing chain cannot hold the others or the event
loop. A chain that fails keeps its previous documents, which carry their
own block and time; the failure is recorded in its meta document.

RPC use is logged per chain, per endpoint and per method on every run
(`[te-cost] chain ...` lines) and kept in te_cost_meta "chain:<id>".last_run.
"""

from __future__ import annotations

import asyncio
import logging
import time

from .chains import CHAINS, rpc_for
from .cost_inputs import load_inputs
from .cost_job import run_chain
from .cost_views import build_list_doc
from .gasusd import NATIVE_REF, native_usd

log = logging.getLogger("te.cost")

CHAIN_ORDER = (8453, 42161, 1, 56, 999, 4663)
CHAIN_TIMEOUT_SECONDS = 300


def _native_prices() -> dict:
    out = {}
    for sym, ref in NATIVE_REF.items():
        try:
            r = rpc_for(ref["chain_id"])
            out[sym] = native_usd(r, sym, r.block_number())
            r.close()
        except Exception as e:  # a price we cannot read is reported, not guessed
            out[sym] = {"error": f"{type(e).__name__}: {str(e)[:160]}"}
    return out


def _coverage(meta: dict) -> list | None:
    cov = (meta.get("last_run") or {}).get("discovery") or []
    return [{"manager": c["manager"], "scanned_from_block": c["scanned_from"], "to_block": c["scanned_to"],
             "complete": c["complete"], "error": c.get("error")} for c in cov] or None


async def run_cycle(store, *, chains=CHAIN_ORDER, inputs: dict | None = None) -> dict:
    t0 = time.time()
    inputs = inputs or await asyncio.to_thread(load_inputs)
    prices = await asyncio.wait_for(asyncio.to_thread(_native_prices), 120)
    summary = {}
    for ch in chains:
        px = prices.get(CHAINS[ch]["native"]) or {}
        meta = await store.get_meta(f"chain:{ch}") or {}
        if "usd" not in px:
            meta["last_error"] = {"at": time.time(), "error": f"native price unavailable: {px.get('error')}"}
            await store.put_meta(f"chain:{ch}", meta)
            summary[ch] = "skipped: no native price"
            continue
        try:
            docs, meta = await asyncio.wait_for(asyncio.to_thread(run_chain, ch, inputs, meta, px), CHAIN_TIMEOUT_SECONDS)
        except Exception as e:
            meta["last_error"] = {"at": time.time(), "error": f"{type(e).__name__}: {str(e)[:300]}"}
            await store.put_meta(f"chain:{ch}", meta)
            log.warning("[te-cost] chain %s failed: %s", ch, meta["last_error"]["error"])
            summary[ch] = "failed"
            continue
        meta.pop("last_error", None)
        await store.put_costs(docs)
        await store.put_meta(f"chain:{ch}", meta)
        lr = meta["last_run"]
        log.info("[te-cost] chain %s block %s: %s versions, %s quotes, rpc %s calls %s, %ss",
                 ch, lr["block"], len(docs), lr["quotes"], lr["rpc"]["calls"], lr["rpc"]["by_endpoint"], lr["total_seconds"])
        summary[ch] = {"versions": len(docs), "calls": lr["rpc"]["calls"], "block": lr["block"]}
    discovery = {}
    for ch in CHAIN_ORDER:
        m = await store.get_meta(f"chain:{ch}") or {}
        if _coverage(m):
            discovery[str(ch)] = _coverage(m)
    # versions no longer in the inputs (dropped from scope) are not listed
    keys = {r["key"] for r in inputs["records"]}
    all_docs = [d for d in await store.all_costs() if d["_id"] in keys]
    await store.put_meta("list", build_list_doc(all_docs, inputs, discovery))
    summary["seconds"] = round(time.time() - t0, 1)
    return summary
