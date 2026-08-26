"""Durable deliverable storage — MongoDB, survives Render's ephemeral disk.

Real regression fixed 2026-08-24: job #56620's delivered content (a real,
on-chain-published deliverable, previously fetched and keccak256-verified
against the on-chain record, cited in the Advantage Report as permanent
proof) started 404ing at GET /erc8183/job/56620/response with
``{"error":"no deliverable on disk for job 56620"}``.

Real cause, confirmed via Render's own API (not assumed): the last actual
*deploy* of this service predates the delivery by nothing relevant, but
Render's ``/events`` (a separate history from ``/deploys``) show a
``service_suspended``→``service_resumed`` cycle on 2026-08-21 and a
``server_restarted`` on 2026-08-22 — both AFTER the 2026-08-19 delivery, both
real container-refresh events. Render's free tier has no persistent volume,
and studio.toml's ``[storage].kind = "local"`` (``LocalStorageProvider``)
writes deliverables ONLY to that ephemeral disk — so either event would wipe
``.agent-data/erc8183-job-56620.json``, and did.

Real recovery attempt for #56620 specifically (before writing this module):
checked every real place a copy could plausibly still exist — this machine's
own /tmp (nothing), the rest of this repo (only job-number references in
comments/UI, no cached raw JSON), and Render's own log retention (queried the
real /v1/logs API for the delivery window — window has already rolled off
retention, nothing returned). Genuinely gone; see AdvantageReport.jsx for the
honest disclosure. The on-chain submit tx itself is unaffected — that's a
separate, permanent record this local-disk loss never touched.

Real fix, general (not #56620-specific): a second, durable copy, written
alongside the SDK's own local-disk write, at the one point in this codebase
that already has both the job id and the finished content in hand —
``seller_core._do_work_and_submit``, right after ``signing.submit_result``
lands the on-chain ``submit()``. Deliberately NOT a swap of the SDK's
configured storage provider itself (still ``local`` — that's what
``ERC8183JobOps.submit_result`` writes to and what the on-chain
``deliverable_url`` pointer resolves to via this same service's own
``/erc8183/job/{id}/response`` route); this reads back that exact file right
after it's written and mirrors it into MongoDB, so ``_serve_deliverable`` can
read Mongo FIRST (survives any restart/resume/redeploy) and only fall back to
the (ephemeral) local copy for the narrow window before a Mongo write lands.

Same MongoDB deployment the main backend already uses
(``backend/core/db.py``) — ``MONGODB_URI`` / ``MONGODB_DB_NAME``,
added to THIS service's own Render env (it had neither before this fix; the
two services are otherwise independent). A dedicated collection
(``explainer_deliverables``) so this never collides with the backend's own
collections.

Uses plain ``pymongo`` (sync), not ``motor`` — matches this service's
existing style (``signing.py``/``seller_core.py`` are synchronous, wrapped in
``asyncio.to_thread`` at their one async call site) rather than introducing a
new async Mongo client into a service that has never had one.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger("seller-agent.deliverable_store")

_client = None  # lazy singleton — a missing MONGODB_URI must never crash import


def _local_path(job_id) -> Path:
    """The ephemeral copy the SDK's LocalStorageProvider writes/expects — same
    STORAGE_LOCAL_PATH + explicit ``erc8183-job-{id}.json`` naming ERC8183JobOps
    .submit_result() uses (real filename confirmed by reading the actual writer,
    not assumed; see the git history around 2026-08-19 for that trace)."""
    base_dir = os.environ.get("STORAGE_LOCAL_PATH") or ".agent-data"
    return Path(base_dir) / f"erc8183-job-{job_id}.json"


def _collection():
    global _client
    mongo_uri = os.environ.get("MONGODB_URI")
    if not mongo_uri:
        return None
    if _client is None:
        from pymongo import MongoClient

        _client = MongoClient(mongo_uri)
    db_name = os.environ.get("MONGODB_DB_NAME", "agents_marketplace")
    return _client[db_name]["explainer_deliverables"]


def capture_and_store(job_id) -> None:
    """Call right after a successful ``signing.submit_result`` — reads back the
    file it (via LocalStorageProvider) just wrote and durably mirrors it into
    MongoDB.

    Best-effort and silent on failure: a submit() that already landed on-chain
    must never be treated as failed because the durability write hiccupped —
    worst case, ``read_deliverable`` falls back to the (still-present, for now)
    local copy.
    """
    col = _collection()
    if col is None:
        logger.warning(
            "MONGODB_URI not set — deliverable for job %s is on local disk ONLY "
            "(will not survive a restart/redeploy)",
            job_id,
        )
        return
    path = _local_path(job_id)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        logger.exception(
            "could not read back local deliverable for job %s right after submit "
            "— nothing to durably store",
            job_id,
        )
        return
    try:
        col.replace_one(
            {"_id": str(job_id)},
            {"_id": str(job_id), "raw_json": raw},
            upsert=True,
        )
        logger.info("deliverable for job %s durably stored in MongoDB", job_id)
    except Exception:
        logger.exception(
            "failed to durably store deliverable for job %s (local disk copy "
            "still exists for now, but will not survive a restart)",
            job_id,
        )


def read_deliverable(job_id) -> str | None:
    """MongoDB first (durable), local disk as fallback (pre-fix deliveries /
    the narrow window before a Mongo write lands). ``None`` if neither has it."""
    col = _collection()
    if col is not None:
        try:
            doc = col.find_one({"_id": str(job_id)})
        except Exception:
            logger.exception("MongoDB read failed for job %s, falling back to local disk", job_id)
            doc = None
        if doc is not None:
            return doc.get("raw_json")

    path = _local_path(job_id)
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None
