"""
full_registry_analysis.py

Real analysis pass over `full_bsc_registry` (see full_registry_ingest.py)
— service health + categorization, reusing the EXACT SAME real logic
already used for the curated marketplace (core/agent_health.py's
check_agents_health, core/categorize.py's classify_agent), just run
against the full, uncapped dataset instead of the diversity-capped
`known_agents` subset. Deliberately resumable/batched, same discipline as
the ingestion side — a full pass over hundreds of thousands of real
service endpoints is itself a real, substantial amount of network I/O,
not something to force into one call.

Real, honest scope note, stated up front rather than glossed over: this
project's "Verified working" tier (frontend/src/agentVerification.js)
means a real, on-chain-confirmed COMPLETED/SUBMITTED job through THIS
marketplace specifically (backend/core/agent_performance.py). That signal
is structurally near-meaningless for the vast majority of the full
registry, which has never been hired through Tnega at all — computing a
"verified" count here using that same definition would be honest (and
correctly near-zero) but wouldn't answer the real question this pipeline
exists for. The real, meaningful registry-wide question is simpler, and is
what this module actually answers: does the agent's own registered
endpoint genuinely respond right now — the same independent, real
`service_status` signal already used everywhere else in this project.
That's what "alive" means below. It is NEVER conflated with "has
confirmed paid work somewhere" — a per-agent detail page already covers
that honestly for the one platform (Tnega) that can actually see it.
"""

from __future__ import annotations

import time

from core.agent_health import check_agents_health
from core.categorize import classify_agent
from core.db import get_db
from core.full_registry_ingest import FULL_REGISTRY_COLLECTION


async def run_analysis_batch(batch_size: int = 300) -> dict:
    """One real, bounded batch: pulls up to `batch_size` docs from
    `full_bsc_registry` that have never been health-checked, categorizes
    them (cheap, synchronous, no network) and health-checks them (real
    HTTP, the slow part), writes results back onto each doc. Returns a
    real summary; `done: True` once nothing is left to check."""
    db = get_db()
    col = db[FULL_REGISTRY_COLLECTION]

    docs = await col.find({"service_status": {"$exists": False}}).limit(batch_size).to_list(length=batch_size)
    if not docs:
        return {"checked": 0, "done": True}

    for d in docs:
        if not d.get("category"):
            result = classify_agent(d.get("name") or "", d.get("description") or "")
            d["category"] = result.category or "Unclassified"

    health_results = await check_agents_health(docs)

    for d in docs:
        update = {"category": d["category"]}
        h = health_results.get(d.get("id"))
        if h:
            update.update(h)
        else:
            # Genuinely couldn't be checked this round (e.g. no real
            # token_id on record) — mark attempted so it isn't re-queued
            # into every subsequent batch forever.
            update.setdefault("service_status", "unknown")
            update.setdefault("service_checked_at", time.time())
        await col.update_one({"_id": d["_id"]}, {"$set": update})

    return {"checked": len(docs), "done": False}


async def compute_full_registry_stats() -> dict:
    """Real, current top-line numbers over whatever has actually been
    ingested + analyzed so far — honestly a PARTIAL picture unless
    full_registry_ingest.get_progress()'s `completed_at` is set AND
    `total_analyzed` below equals `total_ingested`. Callers must report
    both together, not this alone, to avoid implying completeness that
    isn't real yet."""
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

    return {
        "total_ingested": total,
        "total_analyzed": analyzed,
        "responding": responding,
        "not_responding": not_responding,
        "no_endpoint": no_endpoint,
        "unknown_or_unchecked": unknown,
        "responding_pct_of_analyzed": round(responding / analyzed * 100, 1) if analyzed else None,
        "by_category": by_category,
    }
