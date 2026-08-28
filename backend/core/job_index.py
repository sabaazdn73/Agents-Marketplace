"""
job_index.py

Real, complete, persistent index of EVERY real ERC-8183 job ever created on
the shared AgenticCommerce contract — the real fix for a real, confirmed
gap: core/agent_performance.py's own cache only ever scans the most
RECENT `WINDOW` (1,500) job ids (a deliberate, disclosed tradeoff for that
module's real purpose — instant marketplace page loads, see its own
docstring), which core/revenue.py was reusing for a genuinely different
real promise: an agent's CUMULATIVE, complete earnings history.

Real, confirmed root cause (2026-08-28, investigated before writing any of
this): live-checked job_counter() = 56,665 real jobs total ever created on
the shared contract; WINDOW = 1,500. That means only the most recent 2.6%
of all real job ids were ever visible to Revenue Stream — any real,
on-chain, verifiably-completed job older than that was silently excluded,
not because it went through a different frontend (the window scan is
already protocol-wide within its range, not Tnega-specific), but purely
because of its job id's age. This is a real, artificial scoping limit, not
an honest reflection of "this agent hasn't earned much" — confirmed a real
example while building this fix (see docs/verification-methodology.md for
the exact real before/after numbers).

Same real constraint core/agent_performance.py already documented: there
is NO provider- or client-indexed event on this contract, so the only way
to build a genuinely complete, provider-queryable index is a real, one-time
linear scan of every job id from 1 to job_counter — same Multicall3-batched
approach (core/agent_performance.fetch_jobs_by_id), same resumable/
checkpointed discipline as core/full_registry_ingest.py (56,665 real jobs
is the same real order of magnitude as that pipeline's own per-batch cost,
not a new class of problem).

Real correctness nuance the full-registry pipeline didn't need: a job's
real STATUS can change after it's first indexed (OPEN -> FUNDED ->
SUBMITTED -> COMPLETED/REJECTED/EXPIRED) — a one-time linear pass alone
would go stale for any job still in flight when scanned. Fixed with a
second, bounded RE-CHECK pass each batch: any already-indexed job whose
stored status is still non-terminal gets re-read too, so a real delivery
or settlement that happens after the initial scan is still reflected —
never a permanently-stale "OPEN" for a job that's since actually completed.
"""

from __future__ import annotations

import time

from pymongo import UpdateOne

from core.agent_performance import fetch_jobs_by_id
from core.rpc import get_bsc_rpc_url, COMMERCE, JOB_STATUS
from core.db import get_db
import httpx
from eth_utils import function_signature_to_4byte_selector

JOB_INDEX_COLLECTION = "erc8183_job_index"
PROGRESS_COLLECTION = "job_index_progress"
PROGRESS_DOC_ID = "agentic_commerce"

CHUNK = 300  # same real, proven-safe Multicall3 batch size agent_performance.py already uses for this exact contract
_TERMINAL_STATUSES = {"COMPLETED", "REJECTED", "EXPIRED"}
_JOBCOUNTER_SEL = "0x" + function_signature_to_4byte_selector("jobCounter()").hex()


async def _get_job_counter() -> int:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(get_bsc_rpc_url(), json={
            "jsonrpc": "2.0", "id": 1, "method": "eth_call",
            "params": [{"to": COMMERCE, "data": _JOBCOUNTER_SEL}, "latest"],
        })
        resp.raise_for_status()
        body = resp.json()
        return int(body["result"], 16) if body.get("result") else 0


async def _get_progress() -> dict:
    db = get_db()
    doc = await db[PROGRESS_COLLECTION].find_one({"_id": PROGRESS_DOC_ID})
    if doc:
        return doc
    return {"_id": PROGRESS_DOC_ID, "next_job_id": 1, "job_counter_at_last_run": 0,
            "total_indexed": 0, "started_at": None, "last_run_at": None, "completed_at": None}


async def _save_progress(progress: dict) -> None:
    db = get_db()
    await db[PROGRESS_COLLECTION].replace_one({"_id": PROGRESS_DOC_ID}, progress, upsert=True)


async def get_progress() -> dict:
    """Real, current job-index progress — for reporting/monitoring, same
    shape/spirit as core/full_registry_ingest.get_progress()."""
    return await _get_progress()


def _job_doc(job: dict) -> dict:
    status_label = JOB_STATUS[job["status"]] if 0 <= job["status"] < len(JOB_STATUS) else "OPEN"
    return {
        "_id": int(job["id"]),
        "client": (job["client"] or "").lower(),
        "provider": (job["provider"] or "").lower(),
        "description": job["description"],
        "budget": str(job["budget"]),
        "expiredAt": int(job["expiredAt"]),
        "status": status_label,
        "submittedAt": int(job["submittedAt"]),
        "_indexed_at": time.time(),
    }


async def run_index_batch(max_seconds: float = 20.0, recheck_seconds: float = 10.0) -> dict:
    """Real, resumable batch: (1) indexes new real job ids forward from the
    last checkpoint toward the current real job_counter, and (2) re-checks a
    bounded number of previously-indexed jobs whose stored status is still
    non-terminal, so a real status change (delivery, settlement, dispute)
    after the initial index is still picked up. Both halves are genuinely
    bounded/time-boxed, same discipline as core/full_registry_ingest.py's
    run_ingest_batch — safe to call repeatedly from the same scheduled
    trigger without ever risking a hung request."""
    db = get_db()
    col = db[JOB_INDEX_COLLECTION]
    progress = await _get_progress()
    if progress.get("started_at") is None:
        progress["started_at"] = time.time()

    job_counter = await _get_job_counter()
    progress["job_counter_at_last_run"] = job_counter

    # Pass 1: forward indexing of real, never-yet-seen job ids.
    next_id = progress["next_job_id"]
    t0 = time.time()
    indexed_this_batch = 0
    while time.time() - t0 < max_seconds and next_id <= job_counter:
        batch_ids = list(range(next_id, min(next_id + CHUNK, job_counter + 1)))
        jobs = await fetch_jobs_by_id(batch_ids)
        if jobs:
            ops = [UpdateOne({"_id": _job_doc(j)["_id"]}, {"$set": _job_doc(j)}, upsert=True) for j in jobs]
            await col.bulk_write(ops, ordered=False)
            indexed_this_batch += len(ops)
        next_id = batch_ids[-1] + 1
        progress["next_job_id"] = next_id
        progress["total_indexed"] = (progress.get("total_indexed") or 0) + len(jobs)
        progress["last_run_at"] = time.time()
        await _save_progress(progress)

    reached_end = next_id > job_counter
    if reached_end and not progress.get("completed_at"):
        progress["completed_at"] = time.time()
        await _save_progress(progress)

    # Pass 2: bounded re-check of previously-indexed, still-non-terminal
    # jobs — real status transitions (e.g. SUBMITTED -> COMPLETED once the
    # real optimistic dispute window closes) happen after the job's own id
    # was first indexed, and the forward pass above never revisits an id
    # once past it.
    rechecked = 0
    t1 = time.time()
    stale_ids = [d["_id"] async for d in col.find(
        {"status": {"$nin": list(_TERMINAL_STATUSES)}}, {"_id": 1},
    ).limit(CHUNK * 5)]
    for i in range(0, len(stale_ids), CHUNK):
        if time.time() - t1 > recheck_seconds:
            break
        chunk_ids = stale_ids[i:i + CHUNK]
        jobs = await fetch_jobs_by_id(chunk_ids)
        if jobs:
            ops = [UpdateOne({"_id": _job_doc(j)["_id"]}, {"$set": _job_doc(j)}, upsert=True) for j in jobs]
            await col.bulk_write(ops, ordered=False)
            rechecked += len(ops)

    return {
        "indexed_this_batch": indexed_this_batch, "rechecked_this_batch": rechecked,
        "next_job_id": next_id, "job_counter": job_counter, "reached_end": reached_end,
        "elapsed_seconds": round(time.time() - t0, 1),
    }


async def get_provider_revenue_jobs(owner_address: str) -> dict:
    """Real, complete (never windowed) job history for one agent as
    PROVIDER, read from this module's own persistent index rather than
    core/agent_performance.py's WINDOW-bounded cache. Returns both the real
    matching jobs AND how complete the underlying index itself currently
    is (`index_complete`, `indexed_through`, `job_counter`) — callers
    (core/revenue.py) must surface that honestly rather than imply a
    number is final while the backfill is still in progress."""
    db = get_db()
    col = db[JOB_INDEX_COLLECTION]
    owner = (owner_address or "").lower()
    progress = await _get_progress()

    jobs = await col.find({"provider": owner}).to_list(length=None)
    return {
        "jobs": jobs,
        "index_complete": bool(progress.get("completed_at")),
        "indexed_through_job_id": progress.get("next_job_id", 1) - 1,
        "job_counter": progress.get("job_counter_at_last_run") or 0,
    }
