# ingest_status.py
#
# Says out loud what an upstream registry outage does and does not affect.
#
# Written 2026-09-06 during a real 8004scan outage (HTTP 500 on every
# chain, at offset 0 as well as deep offsets -- not just the deep-pagination
# failure already on record). The pipeline itself held up well, which was
# measured rather than assumed:
#
#   - Serving:    /api/agents returned 15,191 agents in 0.36s throughout.
#                 It reads the in-memory cache / known_agents, never the
#                 upstream, and a failed background refresh deliberately
#                 keeps the previous body.
#   - Evaluation: a real analysis batch ran mid-outage and checked 40
#                 agents. Health checking resolves tokenURIs over our own
#                 per-chain RPC, so it does not involve 8004scan at all.
#   - Storage:    known_agents is upsert-only; nothing deletes from it, so
#                 an outage cannot shrink what we serve.
#   - Discovery:  genuinely stalled. Every chain's ingest progress doc
#                 carried the same 500.
#
# So the gap was never resilience, it was honesty: the status page reported
# 8004scan as simply "not ok" with an empty detail string, and said nothing
# about discovery being stopped or when it last worked. A visitor could not
# tell the difference between "one upstream is down but the marketplace is
# fine" and "the marketplace is broken". This module answers that
# explicitly, from real stored progress rather than from a guess.
#
# Deliberately read-only and best-effort. It exists to explain a degraded
# state, so it must not become a way for the status endpoint itself to fail.

from __future__ import annotations

import time

from core.db import get_db

PROGRESS_COLLECTION = "full_registry_ingest_progress"

# How long discovery can go without a successful page before it is called
# stalled rather than merely idle. The batch workflow runs every 6 hours,
# so a quiet gap of a few hours is normal; 8 hours is not.
STALL_AFTER_SECONDS = 8 * 3600

# Progress docs that are not chain ingestion and would misreport discovery
# health if counted (escrow_compat_audit is an internal audit pass over
# already-stored agents, not an upstream fetch).
_NON_DISCOVERY_IDS = {"escrow_compat_audit"}


def _looks_upstream(error: str) -> bool:
    """Whether a stored last_error reads like the upstream failing rather
    than something on our side. Kept deliberately loose: this only chooses
    the wording shown to a reader, never any behaviour."""
    e = (error or "").lower()
    return any(s in e for s in ("500", "502", "503", "504", "timeout", "timed out", "httpstatuserror"))


async def get_discovery_status() -> dict:
    """Real state of new-agent discovery, and an explicit statement of what
    an outage does not affect.

    `last_success_at` is written by full_registry_ingest only on a page that
    genuinely came back and was stored, so it means what it says. Progress
    docs written before that field existed simply have no value for it,
    which is reported as None rather than filled in with last_run_at --
    last_run_at updates on failures too, so using it here would claim a
    success that may never have happened.
    """
    try:
        db = get_db()
        docs = [d async for d in db[PROGRESS_COLLECTION].find({})]
    except Exception as e:
        return {
            "ok": None,
            "stalled": None,
            "detail": f"could not read ingest progress: {type(e).__name__}",
            "sources": [],
            "unaffected": _UNAFFECTED,
        }

    now = time.time()
    sources, successes, failing = [], [], 0

    for d in docs:
        name = str(d.get("_id"))
        if name in _NON_DISCOVERY_IDS:
            continue
        err = d.get("last_error") or None
        success_at = d.get("last_success_at")
        if success_at:
            successes.append(success_at)
        if err:
            failing += 1
        sources.append({
            "source": name,
            "ok": not err,
            "last_success_at": success_at,          # None = never recorded one
            "last_attempt_at": d.get("last_run_at"),
            "last_completed_at": d.get("completed_at"),
            "agents_ingested": d.get("total_ingested"),
            "last_error": (err[:200] if err else None),
        })

    sources.sort(key=lambda s: (s["ok"], s["source"]))
    last_success = max(successes) if successes else None
    # Stalled means every discovery source is currently erroring. A partial
    # failure is reported as degraded rather than stalled, because new
    # agents are still arriving from the sources that work.
    all_failing = bool(sources) and failing == len(sources)
    stale = last_success is not None and (now - last_success) > STALL_AFTER_SECONDS
    stalled = all_failing or stale

    if not sources:
        detail = "No ingestion has been recorded yet."
    elif stalled and all_failing:
        upstream = any(_looks_upstream(s["last_error"] or "") for s in sources)
        detail = (
            "New-agent discovery is paused: every ingestion source is currently failing"
            + (" against the upstream registry." if upstream else ".")
            + " Existing agents are unaffected — they are served from our own store and"
            " evaluated over our own RPC."
        )
    elif failing:
        detail = (
            f"New-agent discovery is degraded: {failing} of {len(sources)} sources are failing."
            " The rest are still ingesting, and existing agents are unaffected."
        )
    elif stale:
        detail = (
            "New-agent discovery has not completed a successful page recently,"
            " though no source is reporting an error."
        )
    else:
        detail = "New-agent discovery is running normally."

    return {
        "ok": not stalled and failing == 0,
        "stalled": stalled,
        "degraded": bool(failing) and not stalled,
        "last_success_at": last_success,
        "seconds_since_success": (round(now - last_success) if last_success else None),
        "detail": detail,
        "sources": sources,
        "unaffected": _UNAFFECTED,
    }


# Stated as data rather than prose so the UI can render it as a list and it
# stays honest: each line is something measured during the 2026-09-06
# outage, not a reassurance written in advance.
_UNAFFECTED = [
    "Browsing and serving existing agents (served from our own store, not the upstream)",
    "Live service health checks (resolved over our own per-chain RPC)",
    "On-chain job and escrow reads (read directly from the chain)",
]
