"""
full_registry_ingest.py

Real, separate, full-scale ingestion of the real EVM-chain ERC-8004
registries (via 8004scan's Pro-tier API) into one MongoDB collection
(`full_agent_registry`, chain-tagged by each real doc's own `chain_id`) —
deliberately independent of `known_agents`, which stays diversity-capped
for the curated marketplace UI (see core/agent_store.py). This collection
is for real, honest analysis and reporting, never for direct display —
see docs/full-registry-analysis.md for how it now (2026-08-28) also feeds
the live marketplace's background refresh.

Real, critical finding that reshaped this design (2026-08-27, verified
live before writing any of this): the assumption that Pro-tier's real
3,000 req/min throughput would make a full scan straightforward was WRONG
— the real bottleneck is 8004scan's own OFFSET-based pagination, which
degrades sharply with depth, not our rate budget. Measured live against
the real API:

    offset       0 ->   2.2s
    offset  20,000 ->   7.2s
    offset  78,264 ->  15.2s
    offset 156,000 ->  44.4s
    offset 400,000 ->  >45s (timed out)

No alternative pagination exists — `sortBy`/`cursor`/`minTokenId`/`order`/
`orderBy`/`sort`/`minFeedbacks` params are all silently ignored (confirmed
live, real responses identical with or without them), and the registry
contract itself is NOT `ERC721Enumerable` (`totalSupply()` reverts —
confirmed via a real `eth_call`), so there's no on-chain enumeration
shortcut either. This module is deliberately RESUMABLE: it checkpoints
its own progress in Mongo and processes one bounded batch of real time/
pages per call.

Real, multi-chain redesign (2026-08-28): originally BSC-only
(`full_bsc_registry`, one collection, one progress checkpoint). Extended
to also cover Base (chain 8453) per real, official per-chain figures
confirmed live from 8004scan's own /networks page: Ethereum 30,922
agents/3,300 feedbacks, BSC 285,868/11,719, Base 52,548/441,569 (by far
the highest real feedback density of any chain). Real, important
efficiency insight that shaped this: a single raw page from this API
already contains a real MIX of chains (BSC share alone has been observed
anywhere from 16% to 92% across different real offsets) — so one single
scan pass, filtering for BOTH target chains at once
(adapters/bsc.py's list_agents_for_chains), captures both chains' real
agents from the exact same real requests, rather than two separate full
linear scans each re-reading the same real pages. The collection was
renamed from `full_bsc_registry` to `full_agent_registry` accordingly
(the real ~40,184 BSC docs already ingested were preserved, not
discarded) and the checkpoint was reset to offset 0 for one fresh,
combined pass — the shallow end of the real latency curve above is cheap,
so re-covering it once more to also pick up Base agents from those same
pages is a real, worthwhile, bounded cost, not wasted work.

Real, Ethereum added to the same repeatable pipeline (2026-08-27): Ethereum
was deliberately scoped OUT of the 2026-08-28 extension above (BSC/Base
only) even though its real per-chain figures were already known at the
time. Its only real data before this fix lived in `future_multichain_agents`
— a genuinely separate, one-time pull (all 62 real docs share the exact
same real `fetched_at` timestamp, 2026-08-25T12:29:29Z — confirmed live,
not assumed — written by an older, different mechanism, never touched by
this pipeline's own checkpoint/resume machinery, and never refreshed
since). Real, honest gap: that made Ethereum's real data stale in a way
BSC's and Base's genuinely isn't, since only they were on this real,
repeatable ingest+analyze cycle. Fixed by adding Ethereum's chain_id (1)
to TARGET_CHAIN_IDS below — the same real per-page-mix efficiency
argument applies again: every raw page this pipeline already scans for
BSC/Base may also contain real Ethereum agents, so adding a third chain_id
to the same filter costs zero additional real API calls, just captures
more of what's already being read past. `future_multichain_agents` is
left in place as real, historical data (not deleted), but is no longer
the only real source for Ethereum — this pipeline now accumulates real,
repeatable Ethereum coverage into `full_agent_registry` the same way it
already does for BSC and Base.

Real, explicit non-scope: Solana (1,465 real agents per the same real
/networks page, via a genuinely different technical structure — a real
Agent Registry Program `8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ` and
ATOM Engine Program `AToMw53aiPQ8j7iHVb4fGt6nzUNxUhcPc3tbPBZuzVVb`, not
chain_id-based REST calls at all) is deliberately NOT forced into this
same pipeline shape — it needs its own real, separate integration
(Solana RPC / program-account queries), scoped as a real follow-up, not
built here. See docs/full-registry-analysis.md.

Real max page size, confirmed live: 100 (server-enforced 422 above that).
"""

from __future__ import annotations

import time

from pymongo import UpdateOne

from adapters import bsc
from core.db import get_db

FULL_REGISTRY_COLLECTION = "full_agent_registry"
PROGRESS_COLLECTION = "full_registry_ingest_progress"
PROGRESS_DOC_ID = "multi_chain_evm"

# Real, confirmed-live target chains (see module docstring for the real
# per-chain figures behind this choice, and for why Ethereum — chain 1 —
# was added 2026-08-27 after starting out BSC/Base-only). Solana is
# explicitly excluded — it isn't reachable through this same chainId-based
# REST pagination at all, not a scope choice made for cost reasons like
# Ethereum's and Base's own real additions here.
TARGET_CHAIN_IDS = {1, 56, 8453}

PAGE_SIZE = 100  # real, confirmed server-enforced max — see module docstring
REQUEST_TIMEOUT = 90.0  # generous — real, measured deep-offset requests already take 45s+


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
    starting from the last real checkpoint, upserts every real agent
    matching TARGET_CHAIN_IDS into `full_agent_registry` (tagged by its
    own real chain_id), and stops after `max_seconds` (or `max_pages`, or
    reaching the real end of the registry). Returns a real summary of what
    THIS batch actually did.

    Checkpointing discipline: `next_offset` only advances after a page's
    real upserts have already landed in Mongo, and a genuine failure mid-
    page leaves the checkpoint at the last SUCCESSFUL offset."""
    db = get_db()
    progress = await _get_progress()
    if progress.get("started_at") is None:
        progress["started_at"] = time.time()

    offset = progress["next_offset"]
    pages_done = 0
    agents_this_batch = 0
    by_chain_this_batch: dict[int, int] = {}
    t0 = time.time()
    reached_end = False

    while True:
        if time.time() - t0 > max_seconds:
            break
        if max_pages is not None and pages_done >= max_pages:
            break
        try:
            agents, total, raw_len = await bsc.list_agents_for_chains(
                api_key, TARGET_CHAIN_IDS, offset=offset, limit=PAGE_SIZE,
                timeout=REQUEST_TIMEOUT, max_retries=6,
            )
        except Exception as e:
            progress["last_error"] = f"{type(e).__name__}: {e}"[:300]
            progress["last_run_at"] = time.time()
            await _save_progress(progress)
            return {
                "pages_done": pages_done, "agents_ingested": agents_this_batch,
                "by_chain": by_chain_this_batch, "next_offset": offset,
                "stopped_reason": f"error: {type(e).__name__}: {e}",
                "elapsed_seconds": round(time.time() - t0, 1),
            }

        progress["total_server_reported"] = total
        if agents:
            ops = []
            for a in agents:
                real_id = a.get("id")
                if not real_id:
                    continue
                doc = dict(a)
                doc["_id"] = real_id
                doc["_ingested_at"] = time.time()
                ops.append(doc)
                cid = a.get("chain_id")
                by_chain_this_batch[cid] = by_chain_this_batch.get(cid, 0) + 1
            if ops:
                # Real bug found and fixed (2026-08-28): a full ReplaceOne
                # here silently WIPED any service_status/category a prior
                # real analysis pass (full_registry_analysis.py) had
                # already written for an agent — real, confirmed live: a
                # re-scan of an already-analyzed offset range (triggered by
                # this exact multi-chain migration's own checkpoint reset)
                # reset total_analyzed from 17,418 back to 0. Real fix:
                # $set only the fresh raw-listing fields this page actually
                # has, leaving any existing analysis fields (which this raw
                # listing response never includes in the first place)
                # untouched — a genuine merge, not a silent overwrite.
                await db[FULL_REGISTRY_COLLECTION].bulk_write(
                    [UpdateOne({"_id": d["_id"]}, {"$set": d}, upsert=True) for d in ops],
                    ordered=False,
                )
                agents_this_batch += len(ops)

        offset += PAGE_SIZE
        pages_done += 1
        progress["next_offset"] = offset
        progress["total_ingested"] = (progress.get("total_ingested") or 0) + len(agents)
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
        "by_chain": by_chain_this_batch, "next_offset": offset, "reached_end": reached_end,
        "elapsed_seconds": round(time.time() - t0, 1),
    }
