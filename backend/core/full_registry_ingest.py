"""
full_registry_ingest.py

Real, separate, full-scale ingestion of the EVM-chain ERC-8004
registries (via 8004scan's Pro-tier API) into one MongoDB collection
(`full_agent_registry`, chain-tagged by each doc's own `chain_id`),
deliberately independent of `known_agents`, which stays diversity-capped
for the curated marketplace UI (see core/agent_store.py). This collection
is for real, analysis and reporting, never for direct display,
see docs/full-registry-analysis.md for how it now (2026-08-28) also feeds
the live marketplace's background refresh.

Real, critical finding that reshaped this design (2026-08-27, verified
live before writing any of this): the assumption that Pro-tier's real
3,000 req/min throughput would make a full scan straightforward was WRONG
, the bottleneck is 8004scan's own OFFSET-based pagination, which
degrades sharply with depth, not our rate budget. Measured live against
the API:

    offset       0 ->   2.2s
    offset  20,000 ->   7.2s
    offset  78,264 ->  15.2s
    offset 156,000 ->  44.4s
    offset 400,000 ->  >45s (timed out)

No alternative pagination exists, `sortBy`/`cursor`/`minTokenId`/`order`/
`orderBy`/`sort`/`minFeedbacks` params are all silently ignored (confirmed
live, responses identical with or without them), and the registry
contract itself is NOT `ERC721Enumerable` (`totalSupply()` reverts,
confirmed via a real `eth_call`), so there's no on-chain enumeration
shortcut either. This module is deliberately RESUMABLE: it checkpoints
its own progress in Mongo and processes one bounded batch of real time/
pages per call.

Real, multi-chain redesign (2026-08-28): originally BSC-only
(`full_bsc_registry`, one collection, one progress checkpoint). Extended
to also cover Base (chain 8453) per real, official per-chain figures
confirmed live from 8004scan's own /networks page: Ethereum 30,922
agents/3,300 feedbacks, BSC 285,868/11,719, Base 52,548/441,569 (by far
the highest feedback density of any chain). Real, important
efficiency insight that shaped this: a single raw page from this API
already contains a MIX of chains (BSC share alone has been observed
anywhere from 16% to 92% across different offsets), so one single
scan pass, filtering for BOTH target chains at once
(adapters/bsc.py's list_agents_for_chains), captures both chains' real
agents from the exact same requests, rather than two separate full
linear scans each re-reading the same pages. The collection was
renamed from `full_bsc_registry` to `full_agent_registry` accordingly
(the real ~40,184 BSC docs already ingested were preserved, not
discarded) and the checkpoint was reset to offset 0 for one fresh,
combined pass, the shallow end of the latency curve above is cheap,
so re-covering it once more to also pick up Base agents from those same
pages is a real, worthwhile, bounded cost, not wasted work.

Real, Ethereum added to the same repeatable pipeline (2026-08-27): Ethereum
was deliberately scoped OUT of the 2026-08-28 extension above (BSC/Base
only) even though its per-chain figures were already known at the
time. Its only data before this fix lived in `future_multichain_agents`
, a genuinely separate, one-time pull (all 62 docs share the exact
same real `fetched_at` timestamp, 2026-08-25T12:29:29Z, confirmed live,
not assumed, written by an older, different mechanism, never touched by
this pipeline's own checkpoint/resume machinery, and never refreshed
since). Real, gap: that made Ethereum's data stale in a way
BSC's and Base's genuinely isn't, since only they were on this real,
repeatable ingest+analyze cycle. Fixed by adding Ethereum's chain_id (1)
to TARGET_CHAIN_IDS below, the same per-page-mix efficiency
argument applies again: every raw page this pipeline already scans for
BSC/Base may also contain Ethereum agents, so adding a third chain_id
to the same filter costs zero additional API calls, just captures
more of what's already being read past. `future_multichain_agents` was
kept in place as historical data for a while after this, no longer the
only source for Ethereum but not yet redundant either. Deleted 2026-09-10
(along with core/future_chains.py, the module that wrote it, and
adapters/multichain_agents.py, which only that module used) once
directly confirmed, checked live, not assumed, that all 62 of its real
docs already existed in `full_agent_registry` (which has 16,284 real
Ethereum agents now, vastly more complete), part of a real, safe-data
cleanup pass to reclaim space on a MongoDB Atlas free-tier cluster that
had hit its 512MB quota.

Real, correction (2026-08-28): the paragraph that used to be here
claimed Solana needed "its own real, separate integration (Solana RPC /
program-account queries)" because it supposedly wasn't reachable via
chain_id-based REST calls at all. That was WRONG, and was never actually
tested, 8004scan's own real, live API already indexes Solana through the
exact same `/api/v1/agents` REST endpoint used for the EVM chains above,
just filtered with `chain_id=101` (confirmed live: total ~1,462, real
chain_type "solana", base58 owner addresses, Solana program
address in `contract_address`). What genuinely IS different, confirmed
live via a real ~700-item scan across offsets 0-300,000: Solana items
NEVER appear in the default/unfiltered listing this module's own
TARGET_CHAIN_IDS filtering relies on, so unlike Base/Ethereum (which ride
along for free in pages already being fetched for BSC), Solana can't be
added to TARGET_CHAIN_IDS and picked up the same way; it genuinely needs
its own real, separate, `chain_id`-filtered query
(adapters/bsc.py's list_agents_by_chain_id). See run_solana_ingest_batch
below, same collection (`full_agent_registry`), same resumable/
checkpointed discipline, just its own progress doc and its own fetch
path, since Solana's total (~1,462) is tiny next to the combined EVM
pool and doesn't share TARGET_CHAIN_IDS's page-mixing efficiency argument
at all (it would cost real, wasted requests scanning EVM-heavy pages that
never contain a Solana item). See docs/full-registry-analysis.md.

max page size, confirmed live: 100 (server-enforced 422 above that),
same limit for the Solana-specific query path.

Permanent no-endpoint deletion policy (added 2026-09-11): an agent with a
genuinely empty/missing service endpoint is never kept in
`full_agent_registry`, real, decisive precedent from a one-time cleanup
that found 176,691 docs (61% of the collection) in exactly this state,
confirmed unambiguously unreachable and safe to delete. Deliberately NOT
implemented in THIS module, even though it's the obvious first place to
look: ingestion only has whatever 8004scan's own /api/v1/agents listing
endpoint returns, which carries no endpoint/service field at all (checked
directly, not assumed, see core/agent_health.py's own docstring for the
same finding). Only the on-chain tokenURI resolution
full_registry_analysis.py's own health-check pass does can determine
this, so that's where the deletion happens, the moment an agent is
first confirmed no_endpoint rather than after it's been stored, see
run_analysis_batch's own docstring there for the policy and its
reasoning.
"""

from __future__ import annotations

import os
import time

from pymongo import UpdateOne

from adapters import bsc
from core.db import get_db

FULL_REGISTRY_COLLECTION = "full_agent_registry"
PROGRESS_COLLECTION = "full_registry_ingest_progress"
PROGRESS_DOC_ID = "multi_chain_evm"

# Real, added 2026-09-02 (live incident): a genuine, confirmed real-time
# investigation found 8004scan's own API had gotten unreliable enough at
# extreme pagination depth (~84% through the registry, offset ~668,900)
# that the checkpoint below stalled for ~70 hours across 13
# consecutive scheduled batch failures, the strict in-order checkpoint
# guarantee (see run_ingest_batch's own docstring) meant one persistently
# flaky page blocked every page after it, forever, even though most
# nearby offsets were fetchable fine. Real, live-confirmed the failure
# mode is flakiness (some requests at the same offset succeed,
# others time out or 500), not a hard, permanent block on one exact
# offset, so this collection exists to make forward progress possible
# without silently losing data: a page that still fails after its own
# internal retry budget is SKIPPED (checkpoint advances past it) rather
# than blocking the whole pipeline, but is recorded here, offset, when,
# how many times, the last error, so it can be, and automatically
# is (see retry_skipped_offsets below), retried later once 8004scan
# recovers at this depth. A doc here is deleted once a retry actually
# succeeds; this collection is never meant to grow forever, only to hold
# real, currently-unresolved gaps.
SKIPPED_OFFSETS_COLLECTION = "full_registry_skipped_offsets"

# A real, deliberately small per-batch ceiling on how many NEW pages can be
# skipped in one run_ingest_batch call. Guards against the different real
# failure mode this isn't meant to handle silently: a genuine, broad
# 8004scan outage (not just this-depth flakiness) would otherwise let the
# pipeline skip through hundreds of pages in one batch, silently treating
# a outage as a pile of individually-bad pages. Hitting this ceiling
# stops the batch the same way an unhandled failure used to (see
# stopped_reason) rather than skipping further, so a real, widespread
# outage still shows up as a real, stall, not silent data loss at
# scale.
MAX_NEW_SKIPS_PER_BATCH = 5

# Real, confirmed-live target chains for the SHARED, unfiltered-page-mixing
# scan (see module docstring for the per-chain figures behind this
# choice, and for why Ethereum, chain 1, was added 2026-08-27 after
# starting out BSC/Base-only). Solana is deliberately NOT in this set, even
# though it's and reachable (see module docstring's real, honest
# correction), it never appears in this shared unfiltered scan no matter
# how long it runs, so it's ingested by its own separate path instead
# (run_solana_ingest_batch below), not by adding 101 here.
TARGET_CHAIN_IDS = {1, 56, 8453}

# BSC INGESTION IS OFF UNLESS EXPLICITLY TURNED ON.
#
# BSC is the largest outstanding gap in the registry, roughly 178,000
# agents, and pulling it in would spend most of the cluster's remaining
# headroom. That is a decision to take deliberately, with the current free
# space in front of you, not something that should begin the moment a deploy
# reaches the worker.
#
# So the mixed scan filters BSC out by default. Set INGEST_BSC=1 in the
# environment to include it. The flag is read at call time rather than at
# import, so it can be turned on without a code change, and turning it off
# again takes effect on the next batch.
#
# This does not affect anything that already holds BSC data. Analysis,
# health checks, serving and the existing 132,263 BSC documents are all
# untouched. It only governs whether the scan ingests MORE.
BSC_CHAIN_ID = 56
INGEST_BSC_ENV_VAR = "INGEST_BSC"


def bsc_ingestion_enabled() -> bool:
    """Whether the mixed scan may ingest BSC. Off unless INGEST_BSC is set
    to a truthy value."""
    return os.environ.get(INGEST_BSC_ENV_VAR, "").strip().lower() in {"1", "true", "yes", "on"}


def active_target_chain_ids() -> set[int]:
    """TARGET_CHAIN_IDS with BSC removed unless it has been turned on."""
    if bsc_ingestion_enabled():
        return set(TARGET_CHAIN_IDS)
    return {c for c in TARGET_CHAIN_IDS if c != BSC_CHAIN_ID}

# Real, dedicated Solana chain_id + its own progress checkpoint,
# deliberately separate from PROGRESS_DOC_ID above, since this scans a
# genuinely different, chain_id-filtered query path, not the shared
# multi-chain page-mixing scan.
SOLANA_CHAIN_ID = 101
SOLANA_PROGRESS_DOC_ID = "solana_mainnet"

# Real, additional single-chain registries (2026-09-10), same real
# reasoning as Solana above: none of these chain_ids are in
# TARGET_CHAIN_IDS, so none of them ever ride along for free in the
# shared page-mixing scan; each needs its own real,
# server-side-filtered list_agents_by_chain_id pass and its own real
# progress checkpoint. Real, live totals confirmed via 8004scan
# (2026-09-10): Monad 10,158, Billions Network 25,977 (a real, separate
# proof-of-personhood/AI-agent-verification network, distinct from the
# BNB/World-ID work investigated elsewhere in this project), Robinhood
# Chain 32, Celo 9,759, Arbitrum 1,377.
ADDITIONAL_CHAINS = {
    "monad": 143,
    "billions": 45056,
    "robinhood": 4663,
    "celo": 42220,
    "arbitrum": 42161,
}

PAGE_SIZE = 100 # real, confirmed server-enforced max, see module docstring
REQUEST_TIMEOUT = 90.0 # generous, real, measured deep-offset requests already take 45s+

# Real, live-measured concurrency (2026-08-29), not assumed: this loop used
# to fetch one page at a time, fully serially, with no artificial
# rate-limiting sleep anywhere in the request path, the bottleneck
# was never a self-imposed pacing throttle, it's that a serial loop can
# only ever move as fast as one request's own round-trip latency, and
# 8004scan's own offset-based pagination genuinely gets slower with depth
# (see module docstring: ~2s shallow, 44s+ past offset 150,000). Live-tested
# against the API at the real, current checkpoint depth (~offset
# 60,000): 5 pages serial took 17.9s (3.58s/page); 5 pages concurrent took
# 1.7s total. Pushed further, 10, 20, and 30 concurrent requests all
# completed with zero errors, throughput still improving at 30. Chosen
# value is comfortably under Pro-tier's real 3,000 req/min (50 req/sec)
# ceiling even sustained (30 concurrent requests completing in ~3s is
# roughly 10 req/sec, not 50). This doesn't fix 8004scan's own real,
# server-side pagination latency at extreme depth, a slow individual
# request is still slow, but it means a WINDOW of them completes in
# roughly one request's worth of wall-clock time instead of N times that.
INGEST_CONCURRENCY = 20


async def _get_progress(doc_id: str = PROGRESS_DOC_ID) -> dict:
    # Real, generalized 2026-08-28 (took a plain `doc_id` param) so the same
    # checkpoint machinery serves both the shared EVM scan
    # (PROGRESS_DOC_ID) and the separate Solana scan (SOLANA_PROGRESS_DOC_ID)
    # without duplicating this function.
    db = get_db()
    doc = await db[PROGRESS_COLLECTION].find_one({"_id": doc_id})
    if doc:
        return doc
    return {
        # `cursor` replaced `next_offset` on 2026-09-08 when 8004scan
        # capped offset at 10,000. next_offset is kept in the shape so an
        # existing checkpoint still loads, but nothing reads it any more.
        "_id": doc_id, "cursor": None, "next_offset": 0, "total_ingested": 0,
        "total_server_reported": None, "started_at": None, "last_run_at": None,
        "completed_at": None, "last_error": None,
    }


async def _save_progress(progress: dict) -> None:
    db = get_db()
    await db[PROGRESS_COLLECTION].replace_one({"_id": progress["_id"]}, progress, upsert=True)


async def get_progress() -> dict:
    """Real, current EVM (multi-chain, shared-scan) ingestion progress,
    for reporting/monitoring."""
    return await _get_progress(PROGRESS_DOC_ID)


async def get_solana_progress() -> dict:
    """Real, current Solana-specific ingestion progress, separate real
    checkpoint from the shared EVM scan above, see SOLANA_PROGRESS_DOC_ID."""
    return await _get_progress(SOLANA_PROGRESS_DOC_ID)


def _additional_chain_progress_doc_id(name: str) -> str:
    return f"chain_{name}"


async def get_additional_chains_progress() -> dict:
    """Real, current progress for every ADDITIONAL_CHAINS entry, same
    shape as get_progress()/get_solana_progress() above, one real
    checkpoint per chain."""
    return {
        name: await _get_progress(_additional_chain_progress_doc_id(name))
        for name in ADDITIONAL_CHAINS
    }


async def _record_skipped_offset(offset: int, error: str) -> None:
    """Real, upserted record of one page that failed after exhausting its
    own internal retries, see SKIPPED_OFFSETS_COLLECTION's own docstring.
    `skip_count` and `last_skipped_at`/`last_error` update every time the
    SAME offset fails again (e.g. a later retry attempt also fails);
    `first_skipped_at` is set once, never overwritten."""
    db = get_db()
    now = time.time()
    await db[SKIPPED_OFFSETS_COLLECTION].update_one(
        {"_id": offset},
        {
            "$set": {"last_skipped_at": now, "last_error": error[:300]},
            "$setOnInsert": {"first_skipped_at": now},
            "$inc": {"skip_count": 1},
        },
        upsert=True,
    )


async def get_skipped_offsets_summary() -> dict:
    """Real, live summary for /api/full-registry-progress, a count (so a
    genuinely growing number is visible at a glance) plus a bounded sample
    (oldest-first, so the longest-unresolved gaps are the ones shown,
    not an arbitrary slice), never the full list unbounded, same
    discipline as every other public aggregate this project exposes."""
    db = get_db()
    count = await db[SKIPPED_OFFSETS_COLLECTION].count_documents({})
    sample = await db[SKIPPED_OFFSETS_COLLECTION].find(
        {}, sort=[("first_skipped_at", 1)], limit=20,
    ).to_list(length=20)
    return {
        "count": count,
        "oldest_unresolved": [
            {"offset": d["_id"], "skip_count": d.get("skip_count", 1),
             "first_skipped_at": d.get("first_skipped_at"), "last_error": d.get("last_error")}
            for d in sample
        ],
    }


async def retry_skipped_offsets(api_key: str, max_seconds: float = 20.0) -> dict:
    """Retired 2026-09-08. Kept so existing callers still work.

    Every entry this ever queued is an offset above 10,000, and 8004scan now
    answers those with HTTP 422 rather than serving them, so retrying is
    guaranteed to fail. The queue held 8,751 offsets between 40,900 and
    1,655,700, some retried more than 600 times each, and it was cleared.

    Coverage past the offset ceiling now comes from cursor traversal, which
    has no depth limit at all. See list_agents_cursor in adapters/bsc.py.
    """
    return {
        "retried": 0, "recovered": 0, "still_failing": 0,
        "note": "offset retries are retired: 8004scan caps offset at 10,000 "
                "and the ingest now walks by cursor instead",
    }

async def run_ingest_batch(
    api_key: str, max_seconds: float = 600.0, max_pages: int | None = None,
    concurrency: int = INGEST_CONCURRENCY,
) -> dict:
    """The shared multi-chain scan, walked by CURSOR.

    Rewritten 2026-09-08 for the same reason as the single-chain loop:
    8004scan now caps offset at 10,000 and answers anything beyond it with
    HTTP 422. This scan used to walk the whole unfiltered registry by
    offset, so past that point it was reading nothing at all.

    This walk passes no chain_id, and per 8004scan's spec a cursor without
    chain_id is only supported alongside created_at sorting, so that is the
    sort here. It keeps the original page-mixing idea: one unfiltered pass
    picks up every chain in TARGET_CHAIN_IDS from the same requests rather
    than one full scan per chain.

    BSC is excluded from that set unless INGEST_BSC is turned on. See
    active_target_chain_ids above for why that gate exists. The return value
    reports which chains were actually in scope, so a run that quietly
    ingested no BSC is visible rather than something to infer.

    The concurrency parameter is now accepted and ignored. A cursor walk is
    serial by construction, because each page's cursor comes from the page
    before it. Concurrency across chains is available to the per-chain loop
    instead, and it is where the parallelism went.

    The skipped-offset machinery is gone with the offsets. A page that fails
    after its retry budget now ends the batch with a stated reason and an
    intact cursor, which the next run resumes from. There is nothing to skip
    past, because there is no numbering to skip within.
    """
    db = get_db()
    progress = await _get_progress()
    if progress.get("started_at") is None:
        progress["started_at"] = time.time()

    cursor = progress.get("cursor")
    pages_done = 0
    agents_this_batch = 0
    by_chain_this_batch: dict = {}
    stopped_reason = None
    reached_end = False
    t0 = time.time()

    while True:
        if time.time() - t0 > max_seconds:
            break
        if max_pages is not None and pages_done >= max_pages:
            break

        try:
            items, total, next_cursor, has_more = await bsc.list_agents_cursor(
                api_key, chain_id=None, cursor=cursor, limit=PAGE_SIZE,
                sort_by="created_at", mainnet_only=True,
                timeout=REQUEST_TIMEOUT, max_retries=6,
            )
        except Exception as e:
            stopped_reason = f"page failed after retries: {type(e).__name__}: {e}"
            progress["last_error"] = stopped_reason[:300]
            progress["last_run_at"] = time.time()
            await _save_progress(progress)
            break

        # Read per batch, not once at import, so the flag can be flipped
        # without a redeploy.
        targets = active_target_chain_ids()
        agents = [a for a in items if a.get("chain_id") in targets]
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
                # $set only, never ReplaceOne: a full replace here silently
                # wiped the service_status and category a prior analysis
                # pass had written. This is a merge, not an overwrite.
                await db[FULL_REGISTRY_COLLECTION].bulk_write(
                    [UpdateOne({"_id": d["_id"]}, {"$set": d}, upsert=True) for d in ops],
                    ordered=False,
                )
                agents_this_batch += len(ops)

        cursor = next_cursor
        pages_done += 1
        progress["cursor"] = cursor
        progress["total_ingested"] = (progress.get("total_ingested") or 0) + len(agents)
        progress["last_run_at"] = time.time()
        progress["last_error"] = None
        # Distinct from last_run_at, which updates on failures too. This is
        # the only point where a page genuinely came back and was written,
        # so it is the one honest answer to "when did discovery last
        # actually work?", which core/ingest_status.py reports.
        progress["last_success_at"] = progress["last_run_at"]
        await _save_progress(progress)

        if not cursor or not has_more:
            reached_end = True
            progress["completed_at"] = time.time()
            await _save_progress(progress)
            break

    return {
        "pages_done": pages_done, "agents_ingested": agents_this_batch,
        "by_chain": by_chain_this_batch, "cursor": cursor,
        "reached_end": reached_end, "stopped_reason": stopped_reason,
        "target_chain_ids": sorted(active_target_chain_ids()),
        "bsc_ingestion_enabled": bsc_ingestion_enabled(),
        "elapsed_seconds": round(time.time() - t0, 1),
    }


async def _run_single_chain_ingest_batch(
    api_key: str, chain_id: int, progress_doc_id: str,
    max_seconds: float = 60.0, max_pages: int | None = None,
) -> dict:
    """The shared single-chain ingest loop, walked by CURSOR.

    Rewritten 2026-09-08. It used to page by offset, which 8004scan now
    rejects above 10,000 with HTTP 422. Nothing on this chain past agent
    10,000 was reachable any more, whatever the retry budget. The cursor has
    no depth limit, and on a live run it was also several times faster than
    the offset walk it replaces.

    Sorting is by token_id ascending. A token id is fixed for the life of an
    agent, so a traversal cannot be disturbed part way through by a record
    being touched, which is a risk with created_at.

    Still resumable and still checkpointed per chain, the checkpoint is just
    an opaque cursor now rather than a number. Upserts remain $set-only into
    the same collection, so an analysis pass's own fields are never wiped.
    """
    db = get_db()
    progress = await _get_progress(progress_doc_id)
    if progress.get("started_at") is None:
        progress["started_at"] = time.time()

    cursor = progress.get("cursor")
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
            agents, total, next_cursor, has_more = await bsc.list_agents_cursor(
                api_key, chain_id=chain_id, cursor=cursor, limit=PAGE_SIZE,
                timeout=REQUEST_TIMEOUT, max_retries=6,
            )
        except Exception as e:
            progress["last_error"] = f"{type(e).__name__}: {e}"[:300]
            progress["last_run_at"] = time.time()
            await _save_progress(progress)
            return {
                "pages_done": pages_done, "agents_ingested": agents_this_batch,
                "cursor": cursor, "stopped_reason": f"error: {type(e).__name__}: {e}",
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
            if ops:
                await db[FULL_REGISTRY_COLLECTION].bulk_write(
                    [UpdateOne({"_id": d["_id"]}, {"$set": d}, upsert=True) for d in ops],
                    ordered=False,
                )
                agents_this_batch += len(ops)

        cursor = next_cursor
        pages_done += 1
        progress["cursor"] = cursor
        progress["total_ingested"] = (progress.get("total_ingested") or 0) + len(agents)
        progress["last_run_at"] = time.time()
        progress["last_error"] = None
        await _save_progress(progress)

        # The traversal is over when the server stops handing back a cursor.
        # Nothing else ends it: a short page in the middle of a cursor walk
        # is not a signal, unlike with offsets.
        if not cursor or not has_more:
            reached_end = True
            progress["completed_at"] = time.time()
            await _save_progress(progress)
            break

    return {
        "pages_done": pages_done, "agents_ingested": agents_this_batch,
        "cursor": cursor, "reached_end": reached_end,
        "elapsed_seconds": round(time.time() - t0, 1),
    }


async def run_solana_ingest_batch(api_key: str, max_seconds: float = 60.0, max_pages: int | None = None) -> dict:
    """Real, resumable Solana-specific ingestion batch, thin wrapper
    around _run_single_chain_ingest_batch above (same function, unchanged
    behavior; the loop itself was generalized 2026-09-10, this name
    kept for every existing caller)."""
    return await _run_single_chain_ingest_batch(api_key, SOLANA_CHAIN_ID, SOLANA_PROGRESS_DOC_ID, max_seconds, max_pages)


async def run_additional_chains_ingest_batch(api_key: str, max_seconds_per_chain: float = 10.0, max_pages: int | None = None) -> dict:
    """Real, bounded batch across every ADDITIONAL_CHAINS entry, one
    small real time-slice per chain per call, deliberately tight
    (default 10s/chain, ~50s total for five chains) to stay safely under
    this backend's own real, previously-measured Render request-timeout
    zone (~75s, see server.py's full_registry_batch route docstring),
    the same conservative discipline the shared 20s/15s ingest/analyze
    defaults already use elsewhere in this pipeline. Real, resumable per
    chain (its own progress doc each, via _additional_chain_progress_doc_id)
    , a slower chain (Billions Network at ~26,000 agents) just takes
    more real 6-hourly cycles to catch up; it never blocks or starves the
    others, and a chain that's already reached_end costs almost nothing
    on a later call (one page fetch confirming no new agents)."""
    results = {}
    for name, chain_id in ADDITIONAL_CHAINS.items():
        results[name] = await _run_single_chain_ingest_batch(
            api_key, chain_id, _additional_chain_progress_doc_id(name),
            max_seconds=max_seconds_per_chain, max_pages=max_pages,
        )
    return results


# ── The Graph coverage fallback (2026-09-04, ETHGlobal Online) ────────────
# 8004scan's deep-offset pagination is a hard ceiling on what this pipeline
# can see: 361 offsets sit in full_registry_skipped_offsets in a permanent
# retry loop, and offsets past ~700,000 time out outright (checked live).
# The Agent0 subgraph indexes the same on-chain registries with no such
# ceiling, so this closes the gap from the other end: instead of paging
# forward through an upstream that stops answering, it asks for everything
# above the highest agent id already stored.
#
# Deliberately additive. Rows are merged with $set exactly like the
# 8004scan path, and adapters/thegraph.to_registry_doc writes only fields
# the subgraph genuinely knows, so a later 8004scan pass still fills in
# total_score, star_count, category and image_url rather than being
# overwritten with nulls by this source.

async def run_thegraph_backfill_batch(
    max_seconds: float = 30.0, chain_id: int = 56, page_size: int = 1000,
) -> dict:
    """One bounded pass: find the highest stored agent id for `chain_id`,
    then pull everything above it from the subgraph."""
    import httpx as _httpx
    from adapters import thegraph

    db = get_db()
    col = db[FULL_REGISTRY_COLLECTION]

    # Highest numeric token_id already stored for this chain.
    #
    # token_id is stored as a STRING, so this cannot sort on it: lexical
    # order puts "99979" above "332377", and an early version of this
    # function did exactly that and reported a highest id of 99,979 when
    # the one was 332,377 -- it would have re-fetched a third of the
    # registry every run. Converted to a number in the aggregation instead,
    # which is the only way to get a true maximum here.
    highest = 0
    pipeline = [
        {"$match": {"chain_id": chain_id}},
        {"$project": {"n": {"$convert": {"input": "$token_id", "to": "long", "onError": 0, "onNull": 0}}}},
        {"$group": {"_id": None, "mx": {"$max": "$n"}}},
    ]
    async for doc in col.aggregate(pipeline):
        highest = int(doc.get("mx") or 0)

    t0 = time.time()
    fetched = upserted = 0
    cursor = highest
    reached_end = False
    error = None

    try:
        async with _httpx.AsyncClient() as client:
            while time.time() - t0 < max_seconds:
                agents = await thegraph.fetch_agents_after(
                    client, cursor, limit=page_size, chain_id=chain_id,
                )
                if not agents:
                    reached_end = True
                    break
                ops = []
                for a in agents:
                    doc = thegraph.to_registry_doc(a, chain_id=chain_id)
                    ops.append(UpdateOne({"chain_id": chain_id, "token_id": doc["token_id"]},
                                         {"$set": doc}, upsert=True))
                    try:
                        cursor = max(cursor, int(a.get("agentId")))
                    except (TypeError, ValueError):
                        pass
                # Chunked: a single 1000-op bulk_write against this
                # Atlas tier returns MaxTimeMSExpired (confirmed live), so
                # writes go out in smaller batches that complete inside the
                # cluster's own write-concern deadline.
                for i in range(0, len(ops), 200):
                    res = await col.bulk_write(ops[i:i + 200], ordered=False)
                    upserted += (res.upserted_count or 0) + (res.modified_count or 0)
                fetched += len(agents)
                if len(agents) < page_size:
                    reached_end = True
                    break
    except thegraph.TheGraphError as e:
        # Never fatal: this is a fallback, and 8004scan ingestion is
        # unaffected by it failing.
        error = str(e)

    return {
        "chain_id": chain_id, "started_above_agent_id": highest,
        "fetched": fetched, "upserted": upserted, "highest_seen": cursor,
        "reached_end": reached_end, "error": error,
        "elapsed_seconds": round(time.time() - t0, 1),
    }
