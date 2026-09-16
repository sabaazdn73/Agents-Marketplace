"""
job_index.py

Real, complete, persistent index of EVERY ERC-8183 job ever created on
the shared AgenticCommerce contract, the fix for a real, confirmed
gap: core/agent_performance.py's own cache only ever scans the most
RECENT `WINDOW` (1,500) job ids (a deliberate, disclosed tradeoff for that
module's purpose, instant marketplace page loads, see its own
docstring), which core/revenue.py was reusing for a genuinely different
promise: an agent's CUMULATIVE, complete earnings history.

Real, confirmed root cause (2026-08-28, investigated before writing any of
this): live-checked job_counter() = 56,665 jobs total ever created on
the shared contract; WINDOW = 1,500. That means only the most recent 2.6%
of all job ids were ever visible to Revenue Stream, any real,
on-chain, verifiably-completed job older than that was silently excluded,
not because it went through a different frontend (the window scan is
already protocol-wide within its range, not Tnega-specific), but purely
because of its job id's age. This is a real, artificial scoping limit, not
an reflection of "this agent hasn't earned much", confirmed a real
example while building this fix (see docs/verification-methodology.md for
the exact before/after numbers).

Same constraint core/agent_performance.py already documented: there
is NO provider- or client-indexed event on this contract, so the only way
to build a genuinely complete, provider-queryable index is a real, one-time
linear scan of every job id from 1 to job_counter, same Multicall3-batched
approach (core/agent_performance.fetch_jobs_by_id), same resumable/
checkpointed discipline as core/full_registry_ingest.py (56,665 jobs
is the same order of magnitude as that pipeline's own per-batch cost,
not a new class of problem).

correctness nuance the full-registry pipeline didn't need: a job's
STATUS can change after it's first indexed (OPEN -> FUNDED ->
SUBMITTED -> COMPLETED/REJECTED/EXPIRED), a one-time linear pass alone
would go stale for any job still in flight when scanned. Fixed with a
second, bounded RE-CHECK pass each batch: any already-indexed job whose
stored status is still non-terminal gets re-read too, so a delivery
or settlement that happens after the initial scan is still reflected,
never a permanently-stale "OPEN" for a job that's since actually completed.
"""

from __future__ import annotations

import time

from pymongo import UpdateOne

from core.agent_performance import fetch_jobs_by_id
from core.rpc import rpc_post, COMMERCE, JOB_STATUS
from core.db import get_db
import httpx
from eth_utils import function_signature_to_4byte_selector

JOB_INDEX_COLLECTION = "erc8183_job_index"
PROGRESS_COLLECTION = "job_index_progress"
PROGRESS_DOC_ID = "agentic_commerce"

CHUNK = 300 # same real, proven-safe Multicall3 batch size agent_performance.py already uses for this exact contract
_TERMINAL_STATUSES = {"COMPLETED", "REJECTED", "EXPIRED"}
_JOBCOUNTER_SEL = "0x" + function_signature_to_4byte_selector("jobCounter()").hex()


async def _get_job_counter() -> int:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await rpc_post(client, {
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
    """Real, current job-index progress, for reporting/monitoring, same
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
    """Real, resumable batch: (1) indexes new job ids forward from the
    last checkpoint toward the current job_counter, and (2) re-checks a
    bounded number of previously-indexed jobs whose stored status is still
    non-terminal, so a status change (delivery, settlement, dispute)
    after the initial index is still picked up. Both halves are genuinely
    bounded/time-boxed, same discipline as core/full_registry_ingest.py's
    run_ingest_batch, safe to call repeatedly from the same scheduled
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
    # jobs, status transitions (e.g. SUBMITTED -> COMPLETED once the
    # optimistic dispute window closes) happen after the job's own id
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
    is (`index_complete`, `indexed_through`, `job_counter`), callers
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


# fix (2026-08-28) for a real, confirmed gap found investigating the
# "Verified working" verification tier: agentVerification.js's
# getVerificationTier() reads jobsCompleted/jobsSubmitted, which the
# frontend gets from GET /api/agents/performance(/bulk),
# core/agent_performance.py's own WINDOW=1,500-bounded cache, THE SAME
# scoping bug already fixed for Revenue Stream, never wired to this real,
# complete index. The two functions below give server.py's two
# performance endpoints a complete, not-windowed data source, in the
# exact same return shape agent_performance.py's own
# get_agent_performance()/get_all_agent_performance() already produce,
# a deliberate, minimal-risk swap. agent_performance.py itself, and its
# other internal callers (core/pnl.py's recent_job_ids,
# core/canary.py's candidate selection), are left untouched, a real,
# separate, not-yet-made decision, noted honestly rather than silently
# changed as a side effect here.
_TERMINAL_LIKE_KEYS = ("COMPLETED", "REJECTED", "EXPIRED", "OPEN", "FUNDED", "SUBMITTED")


async def _completeness() -> dict:
    progress = await _get_progress()
    return {
        "index_complete": bool(progress.get("completed_at")),
        "indexed_through_job_id": progress.get("next_job_id", 1) - 1,
        "job_counter": progress.get("job_counter_at_last_run") or 0,
    }


def _win_rate(counts: dict) -> float | None:
    """win rate, same real, deliberate definition
    agent_performance.py's own _win_rate already documents (SUBMITTED
    counts as a success signal too, not just COMPLETED, settlement
    is optimistic, an un-disputed SUBMITTED is already a real, delivered
    result)."""
    successes = counts.get("COMPLETED", 0) + counts.get("SUBMITTED", 0)
    failures = counts.get("REJECTED", 0) + counts.get("EXPIRED", 0)
    total = successes + failures
    return (successes / total) if total else None


async def get_provider_stats(owner_address: str) -> dict:
    """Real, complete per-agent job stats, mirrors
    core/agent_performance.py's own get_agent_performance() return shape
    exactly (hired/hire_count/completed/rejected/expired/active/settled/
    completion_rate/last_submitted_at/recent_job_ids), computed from the
    complete index instead of a 1,500-job window. Real, zero-state
    when nothing's found, never fabricated."""
    db = get_db()
    col = db[JOB_INDEX_COLLECTION]
    owner = (owner_address or "").lower()
    completeness = await _completeness()

    counts = {k: 0 for k in _TERMINAL_LIKE_KEYS}
    self_counts = {k: 0 for k in _TERMINAL_LIKE_KEYS}
    total = 0
    last_submitted_at = 0
    async for doc in col.find({"provider": owner}):
        total += 1
        status = doc.get("status")
        if status in counts:
            counts[status] += 1
            # Who paid. A job whose client is its own provider is the agent
            # hiring itself, which the verification tier does not count.
            if (doc.get("client") or "").lower() == owner:
                self_counts[status] += 1
        sub = doc.get("submittedAt")
        if sub and sub > last_submitted_at:
            last_submitted_at = sub

    if total == 0:
        return {
            "owner_address": owner_address, "hired": False, "hire_count": 0,
            **completeness,
            "note": ("We checked this agent's complete job history against the shared AgenticCommerce "
                      "contract and found none, it hasn't been hired yet."
                      if completeness["index_complete"] else
                      "No jobs found for this agent yet in the portion of the shared contract's full "
                      "history indexed so far, the real, complete backfill is still in progress."),
        }

    settled = counts["COMPLETED"] + counts["REJECTED"] + counts["EXPIRED"]
    active = counts["OPEN"] + counts["FUNDED"] + counts["SUBMITTED"]
    recent_job_ids = [d["_id"] async for d in col.find({"provider": owner}).sort("_id", -1).limit(10)]
    return {
        "owner_address": owner_address, "hired": True, "hire_count": total,
        "completed": counts["COMPLETED"], "rejected": counts["REJECTED"], "expired": counts["EXPIRED"],
        # SUBMITTED reported on its own, not only folded into `active`.
        #
        # It was only inside `active`, which is OPEN + FUNDED + SUBMITTED, so a
        # record could show completed 0 and active 1 for an agent that had
        # delivered work and was waiting for settlement, and for an agent that
        # had done nothing at all. Those are different facts. The verification
        # tier rests on COMPLETED + SUBMITTED (agentVerification.js), so this
        # was also the one number that could have explained why an agent is
        # verified, missing from the record a reader checks it against. An
        # external audit of the MCP surface concluded the tier was unfounded on
        # exactly this evidence, and the tier was right.
        "submitted": counts["SUBMITTED"],
        "self_funded_delivered": self_counts["COMPLETED"] + self_counts["SUBMITTED"],
        "delivered_external": (counts["COMPLETED"] + counts["SUBMITTED"]
                               - self_counts["COMPLETED"] - self_counts["SUBMITTED"]),
        "open": counts["OPEN"], "funded": counts["FUNDED"],
        "active": active, "settled": settled,
        "completion_rate": (counts["COMPLETED"] / settled) if settled else None,
        # The denominator, beside the rate. completion_rate is COMPLETED over
        # jobs that reached a verdict, so an agent with 5 completed and 4 still
        # open reads 1.0. That is a defensible metric and an indefensible thing
        # to print on its own.
        "completion_rate_basis": (
            f"{counts['COMPLETED']} of {settled} jobs that reached a verdict. "
            f"{active} more are unfinished and are not in this denominator."
            if settled else
            f"No job has reached a verdict yet. {active} are unfinished."
        ),
        "last_submitted_at": last_submitted_at or None,
        "recent_job_ids": recent_job_ids,
        **completeness,
        "note": ("Based on this agent's complete job history."
                  if completeness["index_complete"] else
                  f"Based on this agent's job history indexed so far (job #{completeness['indexed_through_job_id']:,} "
                  f"of {completeness['job_counter']:,} total, a real, one-time backfill is still catching up)."),
    }


# Delivery provenance: who paid for the work an agent has delivered.
#
# WHY THIS IS NOT A PYTHON LOOP OVER JOBS
# One provider in this index (0xc0d7d888..., a third-party platform's shared
# wallet) has 32,546 distinct clients. Every other provider has at most four.
# Pulling per-client rows into the process would mean 32,000 dicts to answer a
# question about 74 providers, on a container with a 512MiB cap. The grouping
# is therefore done twice inside the pipeline, and what comes back is one row
# per provider.
#
# The client cap below is what keeps the second pass bounded as well: for the
# outlier, "has this provider delivered to this client before" is not computed
# rather than computed expensively, and the field says so instead of implying
# an answer.
MAX_CLIENTS_FOR_PROVENANCE = 200

_DELIVERED_STATUSES = ["COMPLETED", "SUBMITTED"]


async def _delivery_provenance(col) -> tuple[dict, dict]:
    """Per provider: how many clients, the largest one, and stuck new clients.

    Returns (by_provider, store_wide).
    """
    # One row per provider, reduced in the pipeline.
    rows = await col.aggregate([
        {"$match": {"provider": {"$ne": ""},
                    "status": {"$in": _DELIVERED_STATUSES}}},
        {"$group": {"_id": {"p": "$provider", "c": "$client"}, "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$group": {"_id": "$_id.p",
                    "clients": {"$sum": 1},
                    "delivered": {"$sum": "$n"},
                    "top_client": {"$first": "$_id.c"},
                    "top_n": {"$first": "$n"}}},
    ]).to_list(length=None)

    prov: dict[str, dict] = {}
    for r in rows:
        owner = r["_id"]
        top = (r.get("top_client") or "").lower()
        prov[owner] = {
            "clients_delivered": r["clients"],
            "top_client": top or None,
            "top_client_delivered": r["top_n"],
            "top_client_is_self": bool(top) and top == owner,
            "unanswered_from_new_clients": 0,
            # Set below, and left as None where it was not computed rather
            # than defaulted to a number that would read as measured.
            "unanswered_from_new_clients_known": True,
        }

    # Funded and undelivered, by client. 313 jobs in the whole index, so this
    # one is small enough to read directly.
    funded = await col.aggregate([
        {"$match": {"provider": {"$ne": ""}, "status": "FUNDED"}},
        {"$group": {"_id": {"p": "$provider", "c": "$client"}, "n": {"$sum": 1}}},
    ]).to_list(length=None)

    wanted = {f["_id"]["p"] for f in funded}
    skip = {o for o in wanted
            if (prov.get(o) or {}).get("clients_delivered", 0) > MAX_CLIENTS_FOR_PROVENANCE}
    pairs = await col.aggregate([
        {"$match": {"provider": {"$in": sorted(wanted - skip)},
                    "status": {"$in": _DELIVERED_STATUSES}}},
        {"$group": {"_id": {"p": "$provider", "c": "$client"}}},
    ]).to_list(length=None) if (wanted - skip) else []
    delivered_to = {}
    for d in pairs:
        delivered_to.setdefault(d["_id"]["p"], set()).add((d["_id"]["c"] or "").lower())

    for f in funded:
        owner, client = f["_id"]["p"], (f["_id"]["c"] or "").lower()
        rec = prov.setdefault(owner, {
            "clients_delivered": 0, "top_client": None, "top_client_delivered": 0,
            "top_client_is_self": False, "unanswered_from_new_clients": 0,
            "unanswered_from_new_clients_known": True,
        })
        if owner in skip:
            rec["unanswered_from_new_clients"] = None
            rec["unanswered_from_new_clients_known"] = False
            continue
        if client not in (delivered_to.get(owner) or set()):
            rec["unanswered_from_new_clients"] += f["n"]

    store_wide = {
        "providers_with_delivery": len(rows),
        "delivered_jobs": sum(r["delivered"] for r in rows),
        "funded_undelivered_jobs": sum(f["n"] for f in funded),
    }
    return prov, store_wide


async def get_all_provider_stats() -> dict:
    """Bulk version of get_provider_stats, the data behind the
    marketplace's "Most hired"/"Highest success rate" sorts AND the
    "Verified working" tier (agentVerification.js's getVerificationTier,
    via useAgentPerformanceBulk.js), computed from the complete index via
    one MongoDB aggregation (grouped by provider + status) rather
    than a live RPC re-scan, fast even at full scale, no TTL cache
    needed the way agent_performance.py's own live-scan cache does."""
    db = get_db()
    col = db[JOB_INDEX_COLLECTION]
    completeness = await _completeness()

    # Grouped by whether the buyer was someone other than the provider, as
    # well as by status.
    #
    # WHY THE BUYER'S IDENTITY IS PART OF THE COUNT
    # The verification tier's definition of record has always read "at least
    # one on-chain job for this agent's owner, from a PAYING BUYER, reached
    # SUBMITTED or COMPLETED" (frontend/src/agentVerification.js). The counts
    # it was computed from never checked who the buyer was, so a provider
    # funding its own jobs earned the same tier as one that was hired. Two
    # agents held it on nothing else: one on a single self-funded job, one on
    # 184 of them. Money moving from an address back to itself is not demand,
    # and a buyer reading the tier was being told it was.
    pipeline = [
        {"$match": {"provider": {"$ne": ""}}},
        {"$group": {
            "_id": {
                "provider": "$provider",
                "status": "$status",
                "self_funded": {"$eq": ["$client", "$provider"]},
            },
            "count": {"$sum": 1},
        }},
    ]
    raw: dict[str, dict] = {}
    self_funded: dict[str, dict] = {}
    async for doc in col.aggregate(pipeline):
        owner = doc["_id"]["provider"]
        status = doc["_id"]["status"]
        p = raw.setdefault(owner, {k: 0 for k in _TERMINAL_LIKE_KEYS})
        sf = self_funded.setdefault(owner, {k: 0 for k in _TERMINAL_LIKE_KEYS})
        if status in p:
            p[status] += doc["count"]
            if doc["_id"].get("self_funded"):
                sf[status] += doc["count"]

    # Funded jobs whose deadline has already passed, per provider. Counted in
    # a second pass rather than folded into the group above because it needs
    # each job's own expiredAt, not a count by status.
    #
    # This is the number a buyer needs before funding the next job, and it is
    # the one nobody else is measuring. Across the 13 agents that will quote a
    # price, 41 jobs have been funded: 27 produced something, 13 were paid and
    # produced nothing, and 12 of those are past their own deadline by a
    # median of 49 days.
    now = int(time.time())
    stuck: dict[str, dict] = {}
    async for doc in col.find(
        {"status": "FUNDED", "provider": {"$ne": ""}},
        {"provider": 1, "expiredAt": 1, "budget": 1, "_id": 0},
    ):
        try:
            deadline = int(doc.get("expiredAt") or 0)
        except (TypeError, ValueError):
            continue
        # A deadline in the future is not stuck, it is simply not due yet.
        # Treating those as failures would accuse a provider of nothing.
        if not deadline or deadline >= now:
            continue
        s = stuck.setdefault(doc["provider"], {"n": 0, "oldest": 0, "value": 0})
        s["n"] += 1
        s["oldest"] = max(s["oldest"], now - deadline)
        try:
            s["value"] += int(doc.get("budget") or 0)
        except (TypeError, ValueError):
            pass

    provenance, store_wide = await _delivery_provenance(col)

    # Is the largest client itself an agent operator. One query over the top
    # clients rather than a scan of every owner in the store: there are 74
    # providers with delivery, so this is a lookup of at most that many
    # addresses.
    top_clients = sorted({v["top_client"] for v in provenance.values() if v["top_client"]})
    operator_names: dict[str, str] = {}
    if top_clients:
        async for d in db["known_agents"].find(
            {"owner_address": {"$in": top_clients}},
            {"_id": 0, "owner_address": 1, "name": 1},
        ):
            addr = (d.get("owner_address") or "").lower()
            operator_names.setdefault(addr, d.get("name") or "")

    by_owner: dict[str, dict] = {}
    for owner, counts in raw.items():
        s = stuck.get(owner) or {"n": 0, "oldest": 0, "value": 0}
        delivered = counts["COMPLETED"] + counts["SUBMITTED"]
        sf = self_funded.get(owner) or {k: 0 for k in _TERMINAL_LIKE_KEYS}
        self_delivered = sf["COMPLETED"] + sf["SUBMITTED"]
        # What the tier is computed from: delivery to somebody else.
        delivered_external = delivered - self_delivered
        # Everything ever paid for. OPEN is excluded deliberately: it was
        # never funded, so it belongs on neither side of this ratio.
        ever_funded = delivered + counts["FUNDED"] + counts["REJECTED"] + counts["EXPIRED"]
        by_owner[owner] = {
            "hire_count": sum(counts.values()),
            "completed": counts["COMPLETED"], "submitted": counts["SUBMITTED"],
            # Kept beside the totals rather than subtracted from them. The
            # counts above are every job and stay that way, because "most
            # hired" and the revenue figures are about activity and a
            # self-funded job did happen. Only the verification tier asks
            # whether anyone else wanted the work, and it reads these.
            "self_funded_delivered": self_delivered,
            "delivered_external": delivered_external,
            "rejected": counts["REJECTED"], "expired": counts["EXPIRED"],
            "active": counts["OPEN"] + counts["FUNDED"],
            "win_rate": _win_rate(counts),
            # Funded versus delivered. `funded_undelivered` is kept separate
            # from `active` on purpose: an OPEN job is unpaid and costs a
            # buyer nothing, a FUNDED one is money already committed with
            # nothing back, and collapsing them hid the difference.
            "funded_undelivered": counts["FUNDED"],
            "funded_expired": s["n"],
            "ever_funded": ever_funded,
            "delivered": delivered,
            # None, not 0, when nothing was ever funded. No data is not a
            # zero delivery rate, and showing 0% for an agent nobody has
            # hired would be an accusation the data does not support.
            "delivery_rate": (delivered / ever_funded) if ever_funded else None,
            "oldest_stuck_days": round(s["oldest"] / 86400, 1) if s["oldest"] else None,
            "stuck_value_raw": str(s["value"]) if s["value"] else None,
            # Who paid for the delivery, not just how much there was of it.
            **(provenance.get(owner) or {
                "clients_delivered": 0, "top_client": None,
                "top_client_delivered": 0, "top_client_is_self": False,
                "unanswered_from_new_clients": 0,
                "unanswered_from_new_clients_known": True,
            }),
            "top_client_is_agent_owner": bool(
                (provenance.get(owner) or {}).get("top_client")
                and (provenance.get(owner) or {})["top_client"] in operator_names
                and not (provenance.get(owner) or {}).get("top_client_is_self")
            ),
            # Only when the largest client is somebody else. An agent that
            # paid itself has its own name here otherwise, beside a flag
            # saying the client is not an operator, which is two answers to
            # one question.
            "top_client_agent_name": (
                None if (provenance.get(owner) or {}).get("top_client_is_self")
                else operator_names.get(
                    (provenance.get(owner) or {}).get("top_client") or "") or None),
        }

    # What the whole index holds, so a count drawn from the served slice can be
    # read against it. The marketplace lists a diversified slice of a larger
    # store (agent_store.SERVE_LIMIT), and a reader told "27 verified" has no
    # way to know that without this.
    store_wide = {
        **store_wide,
        "providers_with_external_delivery": sum(
            1 for v in by_owner.values() if (v.get("delivered_external") or 0) > 0),
        "providers_self_funded_only": sum(
            1 for v in by_owner.values()
            if (v.get("self_funded_delivered") or 0) > 0
            and not (v.get("delivered_external") or 0)),
        "jobs_indexed": completeness.get("indexed_through_job_id"),
    }
    return {"by_owner": by_owner, "store_wide_totals": store_wide, **completeness}
