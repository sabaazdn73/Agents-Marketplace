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
import copy
import logging
import os
import socket
import time

from .chains import CHAINS, rpc_for
from .cost_inputs import add_solana, load_inputs
from .cost_job import decode_pools, pools_doc, run_chain
from .cost_views import build_list_doc
from .gasusd import NATIVE_REF, native_usd

log = logging.getLogger("te.cost")

CHAIN_ORDER = (8453, 42161, 1, 56, 999, 4663)
# Seconds per chain. The job stops itself at its deadline (every RPC call
# checks it); the asyncio timeout is only a backstop. Sum stays under the
# 15-minute cycle.
CHAIN_BUDGET = {8453: 150, 42161: 90, 1: 150, 56: 120, 999: 60, 4663: 300}
BACKSTOP_SECONDS = 30
LEASE_SECONDS = 20 * 60
_cycle_lock = asyncio.Lock()


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


def _snapshot(obj, tries: int = 5):
    """A deep copy of a structure another thread may be changing; None if it
    kept changing while being copied."""
    for _ in range(tries):
        try:
            return copy.deepcopy(obj)
        except RuntimeError:          # "dictionary changed size during iteration"
            time.sleep(0.05)
    return None


async def run_one_chain(store, ch: int, inputs: dict, px: dict) -> dict | str:
    """One chain: run to its deadline in a thread, then persist its meta (the
    discovery progress is in it even when the job failed) and its documents."""
    meta = await store.get_meta(f"chain:{ch}") or {}
    # Discovered pools live in te_cost_pools, not in the chain's meta document
    # (which reached 2.1 MB on Robinhood Chain in the list form). Pools still
    # in meta from before are carried over on this run and written out below.
    held = await store.get_pools_held(ch)
    disc = {k: decode_pools(ch, d) for k, d in held.items()}
    for k, v in (meta.get("discovered") or {}).items():
        disc.setdefault(k, v)
    meta["discovered"] = disc
    budget = CHAIN_BUDGET.get(ch, 120)
    deadline = time.monotonic() + budget
    try:
        docs = await asyncio.wait_for(
            asyncio.to_thread(run_chain, ch, inputs, meta, px, deadline=deadline), budget + BACKSTOP_SECONDS)
    except Exception as e:  # backstop only: the job raises nothing itself
        docs = None
        meta.setdefault("last_run", {})["error"] = f"{type(e).__name__}"
    # The job's thread may still be running after the backstop fired, and
    # would keep changing `meta`: persist a copy, never the live object.
    snap = _snapshot(meta)
    if snap is None:
        log.warning("[te-cost] chain %s: state still changing after the backstop; not persisted this run", ch)
        return "failed: state still changing after the backstop"
    meta = snap
    lr = meta.get("last_run") or {}
    now = int(time.time())
    disc = meta.pop("discovered", None) or {}
    docs_p = [pools_doc(ch, k, v, now) for k, v in disc.items() if v]
    skipped = sum(d.get("skipped", 0) for d in docs_p)
    if skipped:
        lr["pools_not_stored"] = skipped
    await store.put_pools_held(docs_p)
    await store.put_meta(f"chain:{ch}", meta)
    if docs is None:
        log.warning("[te-cost] chain %s stopped: %s", ch, lr.get("error"))
        return f"failed: {lr.get('error')}"
    await store.put_costs(docs)
    log.info("[te-cost] chain %s block %s: %s versions, %s quotes, rpc %s calls %s, %ss",
             ch, lr["block"], len(docs), lr["quotes"], lr["rpc"]["calls"], lr["rpc"]["by_endpoint"], lr["total_seconds"])
    return {"versions": len(docs), "calls": lr["rpc"]["calls"], "block": lr["block"]}


def lease_owner(role: str = "worker") -> str:
    """Unique per process: hostname:pid:role. Two workers (two processes, or
    two hosts) can never share an owner, so the second is refused."""
    return f"{socket.gethostname()}:{os.getpid()}:{role}"


async def run_cycle(store, *, chains=CHAIN_ORDER, inputs: dict | None = None, owner: str | None = None) -> dict:
    """One cycle. Refuses to start while another holds the lease (this process
    or another: the self-check takes the same lease)."""
    owner = owner or lease_owner()
    if _cycle_lock.locked():
        return {"skipped": "a cycle is already running in this process"}
    async with _cycle_lock:
        if not await store.acquire_lease("te_cost_cycle", owner, LEASE_SECONDS):
            return {"skipped": "another process holds the cost-cycle lease"}
        try:
            return await _run_cycle(store, chains, inputs)
        finally:
            await store.release_lease("te_cost_cycle", owner)


async def _run_cycle(store, chains, inputs) -> dict:
    t0 = time.time()
    inputs = inputs or await asyncio.to_thread(lambda: add_solana(load_inputs()))
    prices = await asyncio.wait_for(asyncio.to_thread(_native_prices), 120)
    summary = {}
    for ch in chains:
        px = prices.get(CHAINS[ch]["native"]) or {}
        if "usd" not in px:
            meta = await store.get_meta(f"chain:{ch}") or {}
            meta.setdefault("last_run", {})["error"] = "native price unavailable"
            await store.put_meta(f"chain:{ch}", meta)
            summary[ch] = "skipped: no native price"
            continue
        summary[ch] = await run_one_chain(store, ch, inputs, px)
    await write_list(store, inputs)
    summary["seconds"] = round(time.time() - t0, 1)
    return summary


async def write_list(store, inputs: dict) -> None:
    discovery = {}
    for ch in CHAIN_ORDER:
        m = await store.get_meta(f"chain:{ch}") or {}
        cov = (m.get("last_run") or {}).get("discovery")
        if cov:
            discovery[str(ch)] = cov
    # versions no longer in the inputs (dropped from scope) are not listed
    keys = {r["key"] for r in inputs["records"]}
    all_docs = [d for d in await store.all_costs() if d["_id"] in keys]
    doc = build_list_doc(all_docs, inputs, discovery)
    # Which commit wrote it, and when: /api/te/status shows both beside the
    # web process's own commit, so a web and a worker on different code can
    # be seen.
    doc["writer_commit"] = os.environ.get("RENDER_GIT_COMMIT", "").strip()[:12] or None
    doc["written_at"] = time.time()
    await store.put_meta("list", doc)


# ── Solana: Jupiter quotes, a few hundred versions a pass ───────────────────
#
# A separate pass, with its own lease, because it shares nothing with the EVM
# chains' pinned-block reads and must not take their 15-minute cycle's time:
# the free Jupiter endpoint allows about 60 requests a minute, and a version
# takes two (one, when the first finds no route). The versions never quoted
# go first, then the oldest measurement, so every version is revisited in
# turn and each document carries its own time. A version whose quote fails for
# a reason that is about the call (rate limit, timeout, outage) keeps its
# previous document: a measurement is not replaced by a fact about this call.

SOLANA_BUDGET_S = int(os.environ.get("TE_SOLANA_BUDGET_S", "600"))
SOLANA_FLUSH_EVERY = 20
SOLANA_LEASE_SECONDS = 20 * 60


async def run_solana_cycle(store, *, inputs: dict | None = None, owner: str | None = None, client=None,
                           rpc=None, budget_seconds: float | None = None, limit: int | None = None) -> dict:
    from . import solana_cost
    owner = owner or lease_owner("solana")
    if not await store.acquire_lease("te_solana_cycle", owner, SOLANA_LEASE_SECONDS):
        return {"skipped": "another process holds the solana-cycle lease"}
    try:
        return await _run_solana(store, inputs, client or solana_cost.default_client(), rpc or solana_cost.rpc_call,
                                 budget_seconds if budget_seconds is not None else SOLANA_BUDGET_S, limit)
    finally:
        await store.release_lease("te_solana_cycle", owner)


async def _run_solana(store, inputs, client, rpc, budget, limit) -> dict:
    from . import solana_cost
    t0 = time.monotonic()
    deadline = t0 + budget
    inputs = inputs or await asyncio.to_thread(lambda: add_solana(load_inputs()))
    recs = [r for r in inputs["records"] if r.get("chain") == "solana"]
    have = {d["_id"]: d for d in await store.all_costs() if str(d.get("_id", "")).startswith("solana/")}
    # never measured first, then the oldest measurement
    recs.sort(key=lambda r: ((have.get(r["key"]) or {}).get("computed_at") or "", r["key"]))
    todo = recs[:limit] if limit else recs
    stats = {"attempted": 0, "kept_previous": 0, "by_state": {}, "calls_before": dict(client.stats)}
    meta = await store.get_meta("chain:solana") or {}
    meta["last_run"] = {"started": time.time(), "versions_listed": len(recs)}
    pending: list[dict] = []
    done = 0
    for lo in range(0, len(todo), 100):
        if time.monotonic() >= deadline:
            break
        part = todo[lo:lo + 100]
        ratios = await asyncio.to_thread(solana_cost.read_multipliers, {r["address"]: r["issuer"] for r in part}, rpc)
        for rec in part:
            if time.monotonic() >= deadline:
                break
            now = time.time()
            doc, note = await asyncio.to_thread(solana_cost.measure_version, client, rec, ratios.get(rec["address"]), now,
                                                time.monotonic() + 60)
            stats["attempted"] += 1
            if doc is None:
                stats["kept_previous"] += 1
                stats["last_transient"] = note.get("reason")
                if stats["kept_previous"] >= 8 and stats["kept_previous"] == stats["attempted"]:
                    break              # eight in a row failed for the call's own reasons: stop spending the budget
                continue
            stats["by_state"][doc["state"]] = stats["by_state"].get(doc["state"], 0) + 1
            pending.append(doc)
            done += 1
            if len(pending) >= SOLANA_FLUSH_EVERY:
                await store.put_costs(pending)
                pending = []
        else:
            continue
        break
    if pending:
        await store.put_costs(pending)
    after = dict(client.stats)
    meta["last_run"].update(
        seconds=round(time.monotonic() - t0, 1), attempted=stats["attempted"], written=done,
        kept_previous=stats["kept_previous"], by_state=stats["by_state"],
        jupiter={k: after[k] - stats["calls_before"].get(k, 0) for k in after},
        **({"last_transient": stats["last_transient"]} if stats.get("last_transient") else {}),
        method_id=solana_cost.METHOD_ID)
    await store.put_meta("chain:solana", meta)
    if done:
        await write_list(store, inputs)
    log.info("[te-cost] solana: %s attempted, %s written %s, %s kept, %ss", stats["attempted"], done,
             stats["by_state"], stats["kept_previous"], meta["last_run"]["seconds"])
    return {"attempted": stats["attempted"], "written": done, "kept_previous": stats["kept_previous"],
            "by_state": stats["by_state"], "seconds": meta["last_run"]["seconds"]}
