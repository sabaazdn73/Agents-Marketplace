"""
full_registry_ingest.py

Real, separate, full-scale ingestion of the entire real BSC ERC-8004
registry (via 8004scan's Pro-tier API) into its own MongoDB collection
(`full_bsc_registry`) — deliberately independent of `known_agents`, which
stays diversity-capped for the curated marketplace UI (see
core/agent_store.py). This collection is for real, honest analysis and
reporting ("what fraction of the full real registry is actually alive"),
never for display — nothing here is meant to reach the marketplace UI.

Real, critical finding that reshaped this design (2026-08-27, verified
live before writing any of this): the assumption that Pro-tier's real
3,000 req/min throughput would make a full scan straightforward was WRONG
— the real bottleneck is 8004scan's own OFFSET-based pagination, which
degrades sharply with depth, not our rate budget. Measured live against
the real API (chainId=56 param; see adapters/bsc.py's own honesty note —
this doesn't reliably filter server-side, so client-side filtering still
applies here too):

    offset       0 ->   2.2s
    offset  20,000 ->   7.2s
    offset  78,264 ->  15.2s
    offset 156,000 ->  44.4s
    offset 400,000 ->  >45s (timed out)

Roughly super-linear growth (offset roughly doubling from 78k->156k nearly
TRIPLED the latency), consistent with a naive SQL `OFFSET n` scan on the
server side. No alternative pagination exists — `sortBy`/`cursor`/
`minTokenId` params are all silently ignored (confirmed live, real
responses identical with or without them), and the registry contract
itself is NOT `ERC721Enumerable` (`totalSupply()` reverts — confirmed via
a real `eth_call`), so there's no on-chain enumeration shortcut either.
This means a literal, unbroken full linear scan to the real total
(782,645 agents across ALL chains, as of this writing — see `/api/v1/agents`'s
own real `total` field) is NOT practical in one sitting; the deep end could
take many real hours per page at this rate. This module is therefore
deliberately built RESUMABLE: it checkpoints its own progress in Mongo and
processes one bounded batch of real time/pages per call, so real progress
accumulates across many separate runs (a scheduled job, or repeated manual
invocations) instead of requiring one unbroken multi-hour run.

Real max page size, confirmed live (not assumed): 100 — the server
enforces `limit <= 100` and returns a real 422 validation error above
that, tested up to 50,000 to be sure this wasn't a soft/lower default.
"""

from __future__ import annotations

import time

from pymongo import ReplaceOne

from adapters import bsc
from core.db import get_db

FULL_REGISTRY_COLLECTION = "full_bsc_registry"
PROGRESS_COLLECTION = "full_registry_ingest_progress"
PROGRESS_DOC_ID = "bsc_mainnet"

PAGE_SIZE = 100  # real, confirmed server-enforced max — see module docstring
# Generous — real, measured deep-offset requests already take 45s+; a
# short timeout here would misreport genuine (if slow) server responses as
# failures purely because of the pagination-depth issue this module exists
# to work around, not a real outage.
REQUEST_TIMEOUT = 90.0


async def _get_progress() -> dict:
    db = get_db()
    doc = await db[PROGRESS_COLLECTION].find_one({"_id": PROGRESS_DOC_ID})
    if doc:
        return doc
    return {
        "_id": PROGRESS_DOC_ID, "next_offset": 0, "total_ingested": 0,
        "total_server_reported": None, "started_at": None, "last_run_at": None,
        "completed_at": None, "last_error": None,
    }


async def _save_progress(progress: dict) -> None:
    db = get_db()
    await db[PROGRESS_COLLECTION].replace_one({"_id": PROGRESS_DOC_ID}, progress, upsert=True)


async def get_progress() -> dict:
    """Real, current ingestion progress — for reporting/monitoring."""
    return await _get_progress()


async def run_ingest_batch(api_key: str, max_seconds: float = 600.0, max_pages: int | None = None) -> dict:
    """Real, resumable ingestion batch — fetches consecutive real pages
    starting from the last real checkpoint, upserts real BSC-chain-filtered
    agents into `full_bsc_registry`, and stops after `max_seconds` (or
    `max_pages`, or reaching the real end of the registry) — this
    deliberately never tries to do the whole registry in one call (see the
    module docstring for why that's not realistic). Returns a real summary
    of what THIS batch actually did, not a projection.

    Checkpointing discipline: `next_offset` only advances after a page's
    real upserts have already landed in Mongo, and a genuine failure mid-
    page leaves the checkpoint at the last SUCCESSFUL offset — the next
    call retries that exact page rather than silently skipping it."""
    db = get_db()
    progress = await _get_progress()
    if progress.get("started_at") is None:
        progress["started_at"] = time.time()

    offset = progress["next_offset"]
    pages_done = 0
    agents_this_batch = 0
    t0 = time.time()
    reached_end = False

    while True:
        if time.time() - t0 > max_seconds:
            break
        if max_pages is not None and pages_done >= max_pages:
            break
        try:
            # Real fix (2026-08-27, see adapters/bsc.py's own docstring on
            # this exact incident): pass OUR real, generous timeout through
            # rather than relying on list_bsc_agents' own short default
            # (fine for aggregate.py's shallow-offset marketplace refresh,
            # NOT fine at the depths this module reaches), and a higher
            # real retry count — a transient timeout/connection error at
            # depth is now an EXPECTED outcome, not a rare fluke worth
            # aborting the whole batch over.
            bsc_agents, total, raw_len = await bsc.list_bsc_agents(
                api_key, offset=offset, limit=PAGE_SIZE, timeout=REQUEST_TIMEOUT, max_retries=6,
            )
        except Exception as e:
            progress["last_error"] = f"{type(e).__name__}: {e}"[:300]
            progress["last_run_at"] = time.time()
            await _save_progress(progress)
            return {
                "pages_done": pages_done, "agents_ingested": agents_this_batch,
                "next_offset": offset, "stopped_reason": f"error: {type(e).__name__}: {e}",
                "elapsed_seconds": round(time.time() - t0, 1),
            }

        progress["total_server_reported"] = total
        if bsc_agents:
            ops = []
            for a in bsc_agents:
                real_id = a.get("id")
                if not real_id:
                    continue
                doc = dict(a)
                doc["_id"] = real_id
                doc["_ingested_at"] = time.time()
                ops.append(doc)
            if ops:
                await db[FULL_REGISTRY_COLLECTION].bulk_write(
                    [ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in ops],
                    ordered=False,
                )
                agents_this_batch += len(ops)

        offset += PAGE_SIZE
        pages_done += 1
        progress["next_offset"] = offset
        progress["total_ingested"] = (progress.get("total_ingested") or 0) + len(bsc_agents)
        progress["last_run_at"] = time.time()
        progress["last_error"] = None
        await _save_progress(progress)

        if raw_len < PAGE_SIZE or (total and offset >= total):
            reached_end = True
            progress["completed_at"] = time.time()
            await _save_progress(progress)
            break

    return {
        "pages_done": pages_done, "agents_ingested": agents_this_batch,
        "next_offset": offset, "reached_end": reached_end,
        "elapsed_seconds": round(time.time() - t0, 1),
    }
