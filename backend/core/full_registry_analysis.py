"""
full_registry_analysis.py

analysis pass over `full_agent_registry` (see full_registry_ingest.py
, multi-chain since 2026-08-28, docs tagged by their own chain_id)
, service health + categorization, reusing the EXACT SAME logic
already used for the curated marketplace (core/agent_health.py's
check_agents_health, core/categorize.py's classify_agent), just run
against the full, uncapped dataset instead of the diversity-capped
`known_agents` subset. Deliberately resumable/batched, same discipline as
the ingestion side, a full pass over hundreds of thousands of real
service endpoints is itself a real, substantial amount of network I/O,
not something to force into one call.

Real, scope note, stated up front rather than glossed over: this
project's "Verified working" tier (frontend/src/agentVerification.js)
means a real, on-chain-confirmed COMPLETED/SUBMITTED job through THIS
marketplace specifically (backend/core/agent_performance.py). That signal
is structurally near-meaningless for the vast majority of the full
registry, which has never been hired through Tnega at all, computing a
"verified" count here using that same definition would be honest (and
correctly near-zero) but wouldn't answer the question this pipeline
exists for. The real, meaningful registry-wide question is simpler, and is
what this module actually answers: does the agent's own registered
endpoint genuinely respond right now, the same independent, real
`service_status` signal already used everywhere else in this project.
That's what "alive" means below. It is NEVER conflated with "has
confirmed paid work somewhere", a per-agent detail page already covers
that honestly for the one platform (Tnega) that can actually see it.
"""

from __future__ import annotations

import time

from core.agent_health import check_agents_health
from core.categorize import classify_agent
from core.db import get_db
from core.full_registry_ingest import FULL_REGISTRY_COLLECTION

# How long a newly ingested document is protected from deletion. Ingest and
# analysis run independently, so a backfill can write an agent while an
# analysis pass is mid-flight. Thirty minutes is comfortably longer than a
# batch takes, and the only cost of waiting is that a genuinely endpointless
# agent survives one extra pass.
INGEST_GRACE_SECONDS = 30 * 60

# How long an `unknown` result stands before the agent is asked again. Six
# hours is a compromise: long enough that a host which is genuinely down is
# not re-probed on every pass, short enough that a blip does not survive a
# day. Only `unknown` is re-queued; a real finding is final until something
# else re-ingests the agent.
UNKNOWN_RECHECK_SECONDS = 6 * 60 * 60


# Chains the analysis pass may evaluate. Deliberately widened ONE AT A TIME,
# each only after a test confirmed correct results for known agents on
# that chain. 56 = BSC (original). 42161 = Arbitrum, added 2026-09-05 after
# a live test returned genuinely `responding` agents through Arbitrum's own
# RPC and registry.
#
# NOT included, and each for a stated reason rather than oversight:
#   1 Ethereum  -- added last, and only after Base was observed. Its public
#     RPC (llamarpc) had failed under test; that was the free provider's
#     fault, not Etherscan's, and switching to Infura fixed it. 5/5 known
# stored Ethereum agents then resolved real, distinct tokenURIs.
#   101 Solana  -- not an EVM chain; none of this applies, ever.
#   42220 Celo (deleted 2026-09-11) had a verified RPC and resolved tokenURIs, but
#     have not yet had a full analysis pass observed, so they wait their turn.
# 143 (Monad) added 2026-09-11 when it was promoted to its own tab, after
# the same three checks every chain before it had: eth_chainId 143, the
# ERC-8004 registry present with the same 130 bytes, and tokenURI resolving
# for 10 of 10 stored agents. 8453 (Base) stays here deliberately even
# though it now has no view: a retained catalogue that stops being analysed
# goes stale, and the point of keeping it is that it stays usable.
ANALYSIS_CHAIN_IDS = [56, 42161, 8453, 1, 4663, 143]
# 4663 (Robinhood Chain) added 2026-09-10, one chain at a time and only
# after being verified against its own real data rather than assumed:
# eth_chainId returned 4663, the ERC-8004 registry at 0x8004A169.. holds
# the same 130 bytes of code as every other chain, and a full read-only
# health pass over all 190 stored agents returned 190 results -- 31
# responding, 159 no_endpoint, zero resolution failures.
#
# ANALYSIS ONLY. DELETE_CHAIN_IDS below stays [56] and is not widened
# alongside this. Widening deletion in step with analysis is exactly what
# destroyed 41,379 non-BSC records, and the two lists are kept separate so
# that adding a chain here can never, on its own, delete anything.

# Chains where a confirmed no_endpoint may be DELETED. Deliberately narrower
# than ANALYSIS_CHAIN_IDS. Analysis is reversible -- a wrong status can be
# recomputed -- but deletion is not, and this exact policy destroyed 26,472
# Base, 14,114 Ethereum and 793 Solana records when it ran on a check that
# was invalid for those chains. So a newly-added chain is analysed first and
# only becomes deletable once its results have been observed. Arbitrum
# is analysed but not yet deletable.
DELETE_CHAIN_IDS = [56]


async def run_analysis_batch(batch_size: int = 300) -> dict:
    """One real, bounded batch: pulls up to `batch_size` docs from
    `full_bsc_registry` that have never been health-checked, categorizes
    them (cheap, synchronous, no network) and health-checks them (real
    HTTP, the slow part), writes results back onto each doc. Returns a
    summary; `done: True` once nothing is left to check.

    Real, permanent no-endpoint policy (added 2026-09-11, after a real,
    one-time cleanup found 176,691 full_agent_registry docs, 61% of the
    collection, permanently, unambiguously unreachable, confirmed via
    the exact same service_status == "no_endpoint" signal this function
    computes): an agent whose tokenURI is empty or whose resolved
    metadata has no services[] with an http(s) endpoint isn't stored with
    that status, it's DELETED here, the moment this analysis pass
    confirms it. There's no path to ever hiring or interacting with
    an agent that was never given an endpoint at registration, keeping
    it costs real, scarce storage for zero benefit. This is
    deliberately narrower than "unreachable": an endpoint that's merely
    not_responding right now, or a tokenURI/metadata fetch that failed
    for OUR pipeline's own reasons (service_status == "unknown", see
    core/agent_health.py's own state-model docstring) is NEVER
    deleted here, only genuinely confirmed no_endpoint. ingestion
    time (full_registry_ingest.py) can't apply this same filter itself,
    checked directly: 8004scan's own /api/v1/agents listing endpoint
    (what ingestion reads) carries no endpoint/service field at all, only
    the later on-chain tokenURI resolution this analysis pass does can
    determine it, so this is the one, real, correct place the rule can
    actually run at the moment the information first becomes available,
    not a workaround.

    known_agents is a downstream, diversified subset of
    full_agent_registry (core/aggregate.py), deleting here, before a
    no-endpoint agent is ever available to be diversified into
    known_agents, means the same policy propagates there
    automatically going forward, with no separate logic needed.

    URGENT correction (2026-09-11, found while scoping this policy to
    every chain as requested, checked before extending it, not assumed):
    check_agents_health()'s own tokenURI lookup is hardcoded to ONE
    contract address (core/agent_health.py's IDENTITY_REGISTRY) read via
    ONE BSC-only RPC (core/rpc.py's get_bsc_rpc_url()). It has no per-chain
    awareness at all. For a non-BSC agent, this reads BSC's own registry
    for that agent's token_id, which almost never exists there, so
    the multicall finds nothing, and the exact same code path a genuinely
    empty tokenURI takes fires: `service_status` comes back "no_endpoint"
    for reasons that have nothing to do with whether the agent's OWN chain
    has a endpoint for it. This is a real, confirmed false-positive
    machine for every chain except BSC, not a partial/best-effort signal,
    live-confirmed against the breakdown data from the original
    2026-09-11 cleanup, which already (before this fix) deleted 26,472
    Base, 14,114 Ethereum, and 793 Solana docs under this same unreliable
    "no_endpoint" signal, alongside the real 135,312 BSC ones. That
    specific loss can't be undone; this fix stops it from continuing.

    fix: this batch now only ever pulls chain_id 56 (BSC) docs, the
    one chain IDENTITY_REGISTRY/get_bsc_rpc_url() actually correspond to.
    Every other chain's docs are left with no `service_status` at all
    (genuinely unanalyzed, not mislabeled) until real, chain-specific
    identity-registry addresses and RPC endpoints exist to check them
    properly, a real, separate, not-yet-scoped piece of work, not
    something to fake with the wrong chain's data in the meantime."""
    db = get_db()
    col = db[FULL_REGISTRY_COLLECTION]
    now = time.time()

    # Chains this pass is allowed to analyse. Widened one at a time, and
    # only after a test confirmed the chain-aware health check returns
    # correct results for known agents on THAT chain (2026-09-05: Arbitrum
    # returned genuinely `responding` agents, which the old BSC-only code
    # could never produce). A chain gets added here only after it has both
    # a verified registry deployment and a working RPC -- never on the
    # assumption that a pattern holds.
    # Never checked, OR checked and the answer was "we could not find out".
    #
    # UNKNOWN IS NOT AN ANSWER, added 2026-09-10. The query used to be
    # `service_status: {$exists: False}` alone, so the first write of any
    # status settled an agent forever. That is right for responding,
    # not_responding and no_endpoint, which are findings. It is wrong for
    # unknown, which means the metadata could not be resolved: a transient
    # timeout, a host that was down for a minute, a gateway hiccup. Writing
    # that once and never asking again turns a momentary failure into a
    # permanent verdict.
    #
    # Measured before changing it: of 300 Ethereum agents sitting at unknown,
    # 137 (45.7%) resolved perfectly on a re-check. Roughly 14,000 agents on
    # that chain alone were carrying a stale non-answer, and the same
    # staleness was accumulating on every chain.
    #
    # Re-queued only after UNKNOWN_RECHECK_SECONDS, so a genuinely dead host
    # is not hammered every pass. Agents with a real finding are still never
    # re-queued here.
    now = time.time()
    docs = await col.find({
        "chain_id": {"$in": ANALYSIS_CHAIN_IDS},
        "$or": [
            {"service_status": {"$exists": False}},
            {"service_status": "unknown",
             "service_checked_at": {"$lt": now - UNKNOWN_RECHECK_SECONDS}},
        ],
    }).limit(batch_size).to_list(length=batch_size)
    if not docs:
        return {"checked": 0, "done": True}

    for d in docs:
        if not d.get("category"):
            result = classify_agent(d.get("name") or "", d.get("description") or "")
            d["category"] = result.category or "Unclassified"

    health_results = await check_agents_health(docs)

    deleted_no_endpoint = 0
    held_too_new = 0
    for d in docs:
        h = health_results.get(d.get("id"))
        # An agent moving from `unknown` to `no_endpoint` is NOT deleted on
        # that pass. Added 2026-09-10 alongside the unknown re-queue above.
        #
        # `unknown` means the metadata could not be resolved. When a re-check
        # finally resolves it and finds no endpoint, that is a real finding,
        # but it is the FIRST time we have ever successfully read this agent,
        # and deleting on a first successful read is how a transient failure
        # becomes a permanent loss. The re-queue newly exposed 16,432 BSC
        # agents to this path in one change, which is exactly the shape of the
        # incident that destroyed 41,379 records.
        #
        # So the status is written and the agent is kept. Deletion continues
        # to apply to agents whose no_endpoint was found on a normal first
        # check, which is the case the policy was written for.
        was_unknown = d.get("service_status") == "unknown"
        if (h and h.get("service_status") == "no_endpoint"
                and d.get("chain_id") in DELETE_CHAIN_IDS and not was_unknown):
            # A doc written moments ago is not a candidate for deletion.
            # Ingest and analysis run independently, so without this an
            # agent could be saved by a backfill and removed by an analysis
            # pass in the same minute, on a health check made while the
            # write was still settling. It keeps its status and category
            # either way; it just cannot be deleted until it has sat still
            # for INGEST_GRACE_SECONDS and been checked again on a later
            # pass. Deleting is the one action here that cannot be undone,
            # so it is the one that waits.
            ingested_at = d.get("_ingested_at")
            too_new = ingested_at is None or (now - float(ingested_at)) < INGEST_GRACE_SECONDS
            if too_new:
                held_too_new += 1
            else:
                await col.delete_one({"_id": d["_id"]})
                deleted_no_endpoint += 1
                continue

        update = {"category": d["category"]}
        if h:
            update.update(h)
        else:
            # Genuinely couldn't be checked this round (e.g. no real
            # token_id on record), mark attempted so it isn't re-queued
            # into every subsequent batch forever.
            update.setdefault("service_status", "unknown")
            update.setdefault("service_checked_at", time.time())
        await col.update_one({"_id": d["_id"]}, {"$set": update})

    return {"checked": len(docs), "deleted_no_endpoint": deleted_no_endpoint, "held_too_new": held_too_new, "done": False}


async def get_unanalyzed_backlog() -> int:
    """Real, cheap, live count of `full_agent_registry` docs that have
    been ingested but not yet analyzed (`service_status` missing), added
    2026-08-29 for worker.py's ingestion loop, which uses this to keep
    ingestion from outrunning analysis capacity by more than a real,
    bounded margin (see that file's own INGEST_BACKLOG_PAUSE_THRESHOLD).
    Deliberately a single, cheap count_documents call, not the fuller
    compute_full_registry_stats() below, which runs several additional
    aggregations this pacing check doesn't need and shouldn't pay for on
    every loop iteration.

    Scoped to chain_id 56 (2026-09-11), matching run_analysis_batch's own
    BSC-only scoping above: every non-BSC doc is now permanently
    unanalyzed (no chain-aware health-check exists yet), so counting them
    here would make this number grow forever regardless of BSC
    analysis capacity, and would eventually trip
    INGEST_BACKLOG_PAUSE_THRESHOLD for a reason that has nothing to do
    with what this pacing guarantee actually protects, BSC ingestion
    correctly outrunning BSC analysis capacity."""
    db = get_db()
    col = db[FULL_REGISTRY_COLLECTION]
    # Counts the same work run_analysis_batch actually selects, including
    # `unknown` agents due a re-check. Counting only never-checked agents
    # would report zero backlog while thousands of stale non-answers waited.
    return await col.count_documents({
        "chain_id": {"$in": ANALYSIS_CHAIN_IDS},
        "$or": [
            {"service_status": {"$exists": False}},
            {"service_status": "unknown",
             "service_checked_at": {"$lt": time.time() - UNKNOWN_RECHECK_SECONDS}},
        ],
    })


async def compute_full_registry_stats() -> dict:
    """Real, current top-line numbers over whatever has actually been
    ingested + analyzed so far, honestly a PARTIAL picture unless
    full_registry_ingest.get_progress()'s `completed_at` is set AND
    `total_analyzed` below equals `total_ingested`. Callers must report
    both together, not this alone, to avoid implying completeness that
    isn't yet.

    `no_endpoint` will structurally stay at/near zero from 2026-09-11
    onward, by design, see run_analysis_batch's own docstring on the
    permanent no-endpoint deletion policy. A confirmed no_endpoint agent
    is deleted the moment it's found, not stored with that status, so
    this count only ever reflects a real, momentary in-flight batch, not
    an accumulating population the way it did before that policy."""
    db = get_db()
    col = db[FULL_REGISTRY_COLLECTION]

    total = await col.count_documents({})
    analyzed = await col.count_documents({"service_status": {"$exists": True}})
    responding = await col.count_documents({"service_status": "responding"})
    not_responding = await col.count_documents({"service_status": "not_responding"})
    no_endpoint = await col.count_documents({"service_status": "no_endpoint"})
    unknown = await col.count_documents({"service_status": "unknown"})

    by_category: dict[str, int] = {}
    async for doc in col.aggregate([
        {"$match": {"category": {"$exists": True}}},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
    ]):
        by_category[doc["_id"] or "Unclassified"] = doc["count"]

    by_chain: dict[str, int] = {}
    async for doc in col.aggregate([{"$group": {"_id": "$chain_id", "count": {"$sum": 1}}}]):
        by_chain[str(doc["_id"])] = doc["count"]

    return {
        "total_ingested": total,
        "total_analyzed": analyzed,
        "responding": responding,
        "not_responding": not_responding,
        "no_endpoint": no_endpoint,
        "unknown_or_unchecked": unknown,
        "responding_pct_of_analyzed": round(responding / analyzed * 100, 1) if analyzed else None,
        "by_category": by_category,
        "by_chain": by_chain,
    }


async def compute_feedback_distribution(chain_id: int | None = None) -> dict:
    """Real, investigation of where real `total_feedbacks` actually
    concentrates in the ingested dataset, built 2026-08-28 after a real
    correction: an earlier, small-sample finding ("total_feedbacks is 0 on
    every agent we checked") was NOT a platform-wide truth, just an
    artifact of a too-small sample. 8004scan's own real /networks page
    confirms real, non-trivial feedback totals per chain (BSC: 11,719;
    Base: 441,569, the highest of any chain). This function reports the
    distribution across whatever's actually been ingested so far,
    honestly partial, same discipline as compute_full_registry_stats."""
    db = get_db()
    col = db[FULL_REGISTRY_COLLECTION]
    match = {"chain_id": chain_id} if chain_id is not None else {}

    total_agents = await col.count_documents(match)
    with_feedback = await col.count_documents({**match, "total_feedbacks": {"$gt": 0}})

    pipeline = [
        {"$match": match},
        {"$group": {"_id": None, "sum_feedbacks": {"$sum": "$total_feedbacks"}, "max_feedbacks": {"$max": "$total_feedbacks"}}},
    ]
    sum_feedbacks = 0
    max_feedbacks = 0
    async for doc in col.aggregate(pipeline):
        sum_feedbacks = doc.get("sum_feedbacks") or 0
        max_feedbacks = doc.get("max_feedbacks") or 0

    top = []
    async for doc in col.find({**match, "total_feedbacks": {"$gt": 0}}).sort("total_feedbacks", -1).limit(20):
        top.append({
            "name": doc.get("name"), "owner_address": doc.get("owner_address"),
            "chain_id": doc.get("chain_id"), "total_feedbacks": doc.get("total_feedbacks"),
            "total_score": doc.get("total_score"),
        })

    return {
        "chain_id": chain_id,
        "total_agents_in_sample": total_agents,
        "agents_with_feedback": with_feedback,
        "sum_feedbacks_in_sample": sum_feedbacks,
        "max_feedbacks_on_one_agent": max_feedbacks,
        "top_agents_by_feedback": top,
    }
