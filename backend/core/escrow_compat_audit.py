"""
escrow_compat_audit.py

Real, persistent, resumable, marketplace-WIDE escrow-compatibility audit —
built 2026-08-28 after a real, confirmed incident: Sentinels Audit (a
genuinely escrow-compatible agent) was shown live as "doesn't speak this
marketplace's escrow protocol" because of an owner-address lookup
ambiguity (see server.py's _resolve_agent). Investigating that incident
properly (not just patching the one symptom) surfaced the real, harder
question: was that the only real misclassification live on the site right
now, or could there be others? A live-request-time-only check (the
existing /api/agents/escrow-compatibility, computed fresh per page view,
never persisted) can't answer that — there was no way to see the CURRENT
classification for every real agent at once. This module is the real fix
for that gap.

Real, honest scale finding that shaped this design: known_agents currently
holds 6,846 real, currently-`responding` agents (2026-08-28), across 6,287
DISTINCT real service_endpoints (most — 6,253 — used by exactly one real
agent each; the rest cluster mainly around two real mass-registration
platforms, evoevo.ai and q402.quackai.ai). A real, live, multi-format
negotiate probe against every one of those endpoints, run serially, is
NOT realistically a one-shot, one-request-cycle operation — each probe is
itself several real HTTP round trips (2+ real candidate URLs x 2 real
message-part shapes, plus real retries on a transient failure), so a full
sweep is honestly a multi-hour undertaking, not a single batch call. This
is deliberately built the same real, resumable, checkpointed way as
core/full_registry_ingest.py and core/agent_health.py: one bounded batch
per call, real progress persisted in Mongo, safe to run repeatedly on a
schedule until real, full coverage is reached — never a single, all-at-
once pass that either finishes or gets abandoned.

Real, deliberate ordering choice: within each batch, real, individually-
distinct long-tail agents (i.e., NOT the two dominant mass-registration
platforms) are always audited BEFORE any evoevo.ai/q402.quackai.ai agent.
There are only a real, small number of these (the same ~50-90-agent
long tail investigated in docs/agent-interaction-patterns.md) — full,
individual, live coverage of all of them is realistically achievable in
one or two real batch runs, and they're exactly the real agents most
likely to have a genuinely wrong, actionable, individually-consequential
classification (as BNB Lending Guardian and BNB Yield Optimizer's own
real, confirmed misclassification — see erc8183_negotiate.py's own
real, fixed supportedInterfaces card-parsing gap — turned out to be).
The two mass platforms get real, ongoing, but lower-priority coverage —
already confirmed close to structurally uniform (a real, live, random
20-agent evoevo.ai sample came back 20/20 escrow-incompatible; every
distinct real q402.quackai.ai agent shares the exact same real endpoint),
so broad statistical confidence is cheap even before literal 100%
per-agent coverage is reached.

Real persistence, not just a live compute-on-view: results are written
directly onto each real known_agents doc (escrow_compat_* fields below),
so /api/agents/escrow-compatibility can serve an instant, real, already-
computed answer for any already-audited agent instead of a live network
probe on every single page view — the live probe path stays as an
honest, on-demand fallback for agents this batch hasn't reached yet.
"""

from __future__ import annotations

import time
from urllib.parse import urlparse

from core.db import get_db
from core.protocol_compat import check_escrow_compatibility

PROGRESS_COLLECTION = "full_registry_ingest_progress"  # real, shared checkpoint collection — same one full_registry_ingest.py and job_index.py already use
PROGRESS_DOC_ID = "escrow_compat_audit"

# Real, deliberately longer TTL than protocol_compat.py's own 24h — a
# persisted, marketplace-wide field doesn't need to be as fresh as a
# single live check; an agent's real protocol support is a structural
# property (see protocol_compat.py's own docstring), and re-auditing
# 6,000+ real endpoints on a 24h cycle isn't a realistic real cadence.
AUDIT_TTL_SECONDS = 7 * 24 * 60 * 60  # 7 real days

# Real, confirmed-dominant mass-registration platforms (see
# docs/agent-interaction-patterns.md's own full real census) —
# deprioritized within each batch so the real, individually-distinct
# long tail always gets covered first.
_MASS_PLATFORM_DOMAINS = {"evoevo.ai", "q402.quackai.ai"}


def _is_mass_platform(service_endpoint: str | None) -> bool:
    if not service_endpoint:
        return False
    try:
        return urlparse(service_endpoint).netloc in _MASS_PLATFORM_DOMAINS
    except Exception:
        return False


async def _get_progress() -> dict:
    db = get_db()
    doc = await db[PROGRESS_COLLECTION].find_one({"_id": PROGRESS_DOC_ID})
    if doc:
        return doc
    return {
        "_id": PROGRESS_DOC_ID, "total_audited": 0, "total_incompatible": 0,
        "started_at": None, "last_run_at": None, "long_tail_complete": False,
    }


async def _save_progress(progress: dict) -> None:
    db = get_db()
    await db[PROGRESS_COLLECTION].replace_one({"_id": PROGRESS_DOC_ID}, progress, upsert=True)


async def get_audit_progress() -> dict:
    """Real, current audit progress — for reporting/monitoring."""
    return await _get_progress()


async def _audit_one(db, doc: dict, progress: dict) -> None:
    service_endpoint = doc.get("service_endpoint")
    description = doc.get("description")
    result = await check_escrow_compatibility(service_endpoint, description)
    now = time.time()
    await db.known_agents.update_one(
        {"_id": doc["_id"]},
        {"$set": {
            "escrow_compat_checked_at": now,
            "escrow_compat_incompatible": result["escrow_incompatible"],
            "escrow_compat_auth_gated": result["auth_gated"],
            "escrow_compat_different_protocol": result["different_protocol"],
            "escrow_compat_offers_x402": result["offers_x402_alternative"],
            "escrow_compat_external_link": result["external_link"],
            "escrow_compat_evidence": result["evidence"][:6],  # real, bounded — full evidence stays available via a live re-check if ever needed
        }},
    )
    progress["total_audited"] = (progress.get("total_audited") or 0) + 1
    if result["escrow_incompatible"]:
        progress["total_incompatible"] = (progress.get("total_incompatible") or 0) + 1


async def run_audit_batch(max_seconds: float = 60.0, limit: int | None = None) -> dict:
    """Real, resumable batch — audits real, currently-`responding` agents
    whose escrow-compat fields are missing or older than AUDIT_TTL_SECONDS,
    long-tail (non-mass-platform) agents always first within each call
    (see module docstring). Stops after `max_seconds` (or `limit`, or
    running out of real, due agents). Returns a real summary of what THIS
    batch actually did — never a claim of total marketplace coverage
    unless `reached_end` is true."""
    db = get_db()
    progress = await _get_progress()
    if progress.get("started_at") is None:
        progress["started_at"] = time.time()

    stale_cutoff = time.time() - AUDIT_TTL_SECONDS
    due_filter = {
        "service_status": "responding",
        "$or": [
            {"escrow_compat_checked_at": {"$exists": False}},
            {"escrow_compat_checked_at": {"$lt": stale_cutoff}},
        ],
    }

    t0 = time.time()
    audited_this_batch = 0
    reached_end = False

    # Real, deliberate two-phase order — see module docstring. Phase 1:
    # every real, due, non-mass-platform agent (the small, individually-
    # consequential long tail). Only once none remain due does phase 2
    # (the two real mass platforms) start spending the real time budget.
    for phase_filter in (
        {**due_filter, "service_endpoint": {"$not": {"$regex": r"evoevo\.ai|q402\.quackai\.ai"}}},
        {**due_filter, "service_endpoint": {"$regex": r"evoevo\.ai|q402\.quackai\.ai"}},
    ):
        cursor = db.known_agents.find(phase_filter, {"service_endpoint": 1, "description": 1})
        async for doc in cursor:
            if time.time() - t0 > max_seconds:
                break
            if limit is not None and audited_this_batch >= limit:
                break
            await _audit_one(db, doc, progress)
            audited_this_batch += 1
        if time.time() - t0 > max_seconds or (limit is not None and audited_this_batch >= limit):
            break

    # Real, honest completion check — only true once a fresh count finds
    # zero real due agents left in EITHER phase.
    remaining = await db.known_agents.count_documents(due_filter)
    reached_end = remaining == 0
    progress["last_run_at"] = time.time()
    progress["long_tail_complete"] = reached_end or progress.get("long_tail_complete", False)
    await _save_progress(progress)

    return {
        "audited_this_batch": audited_this_batch,
        "elapsed_seconds": round(time.time() - t0, 1),
        "remaining_due": remaining,
        "reached_end": reached_end,
        "total_audited_ever": progress.get("total_audited"),
    }
