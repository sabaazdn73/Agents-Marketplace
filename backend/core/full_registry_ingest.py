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
more of what's already being read past. `future_multichain_agents` was
kept in place as historical data for a while after this, no longer the
only source for Ethereum but not yet redundant either. Deleted 2026-09-10
(along with core/future_chains.py, the module that wrote it, and
adapters/multichain_agents.py, which only that module used) once
directly confirmed — checked live, not assumed — that all 62 of its real
docs already existed in `full_agent_registry` (which has 16,284 real
Ethereum agents now, vastly more complete), part of a real, safe-data
cleanup pass to reclaim space on a MongoDB Atlas free-tier cluster that
had hit its 512MB quota.

Real, honest correction (2026-08-28): the paragraph that used to be here
claimed Solana needed "its own real, separate integration (Solana RPC /
program-account queries)" because it supposedly wasn't reachable via
chain_id-based REST calls at all. That was WRONG, and was never actually
tested — 8004scan's own real, live API already indexes Solana through the
exact same `/api/v1/agents` REST endpoint used for the EVM chains above,
just filtered with `chain_id=101` (confirmed live: total ~1,462, real
chain_type "solana", real base58 owner addresses, real Solana program
address in `contract_address`). What genuinely IS different, confirmed
live via a real ~700-item scan across offsets 0-300,000: Solana items
NEVER appear in the default/unfiltered listing this module's own
TARGET_CHAIN_IDS filtering relies on — so unlike Base/Ethereum (which ride
along for free in pages already being fetched for BSC), Solana can't be
added to TARGET_CHAIN_IDS and picked up the same way; it genuinely needs
its own real, separate, `chain_id`-filtered query
(adapters/bsc.py's list_agents_by_chain_id). See run_solana_ingest_batch
below — same real collection (`full_agent_registry`), same real resumable/
checkpointed discipline, just its own progress doc and its own real fetch
path, since Solana's real total (~1,462) is tiny next to the combined EVM
pool and doesn't share TARGET_CHAIN_IDS's page-mixing efficiency argument
at all (it would cost real, wasted requests scanning EVM-heavy pages that
never contain a Solana item). See docs/full-registry-analysis.md.

Real max page size, confirmed live: 100 (server-enforced 422 above that),
same limit for the Solana-specific query path.

Permanent no-endpoint deletion policy (added 2026-09-11): an agent with a
genuinely empty/missing service endpoint is never kept in
`full_agent_registry` — real, decisive precedent from a one-time cleanup
that found 176,691 docs (61% of the collection) in exactly this state,
confirmed unambiguously unreachable and safe to delete. Deliberately NOT
implemented in THIS module, even though it's the obvious first place to
look: ingestion only has whatever 8004scan's own /api/v1/agents listing
endpoint returns, which carries no endpoint/service field at all (checked
directly, not assumed — see core/agent_health.py's own docstring for the
same real finding). Only the on-chain tokenURI resolution
full_registry_analysis.py's own health-check pass does can determine
this, so that's where the real deletion happens, the moment an agent is
first confirmed no_endpoint rather than after it's been stored — see
run_analysis_batch's own docstring there for the real policy and its
reasoning.
"""

from __future__ import annotations

import asyncio
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
# that the checkpoint below stalled for ~70 real hours across 13
# consecutive scheduled batch failures — the strict in-order checkpoint
# guarantee (see run_ingest_batch's own docstring) meant one persistently
# flaky page blocked every page after it, forever, even though most
# nearby offsets were fetchable fine. Real, live-confirmed the failure
# mode is genuine flakiness (some requests at the same offset succeed,
# others time out or 500), not a hard, permanent block on one exact
# offset — so this collection exists to make forward progress possible
# without silently losing data: a page that still fails after its own
# internal retry budget is SKIPPED (checkpoint advances past it) rather
# than blocking the whole pipeline, but is recorded here — offset, when,
# how many times, the real last error — so it can be, and automatically
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
# a real outage as a pile of individually-bad pages. Hitting this ceiling
# stops the batch the same way an unhandled failure used to (see
# stopped_reason) rather than skipping further, so a real, widespread
# outage still shows up as a real, honest stall, not silent data loss at
# scale.
MAX_NEW_SKIPS_PER_BATCH = 5

# Real, confirmed-live target chains for the SHARED, unfiltered-page-mixing
# scan (see module docstring for the real per-chain figures behind this
# choice, and for why Ethereum — chain 1 — was added 2026-08-27 after
# starting out BSC/Base-only). Solana is deliberately NOT in this set, even
# though it's real and reachable (see module docstring's real, honest
# correction) — it never appears in this shared unfiltered scan no matter
# how long it runs, so it's ingested by its own separate real path instead
# (run_solana_ingest_batch below), not by adding 101 here.
TARGET_CHAIN_IDS = {1, 56, 8453}

# Real, dedicated Solana chain_id + its own real progress checkpoint —
# deliberately separate from PROGRESS_DOC_ID above, since this scans a
# genuinely different, chain_id-filtered query path, not the shared
# multi-chain page-mixing scan.
SOLANA_CHAIN_ID = 101
SOLANA_PROGRESS_DOC_ID = "solana_mainnet"

# Real, additional single-chain registries (2026-09-10) — same real
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

PAGE_SIZE = 100  # real, confirmed server-enforced max — see module docstring
REQUEST_TIMEOUT = 90.0  # generous — real, measured deep-offset requests already take 45s+

# Real, live-measured concurrency (2026-08-29), not assumed: this loop used
# to fetch one page at a time, fully serially, with no artificial
# rate-limiting sleep anywhere in the request path — the real bottleneck
# was never a self-imposed pacing throttle, it's that a serial loop can
# only ever move as fast as one request's own round-trip latency, and
# 8004scan's own offset-based pagination genuinely gets slower with depth
# (see module docstring: ~2s shallow, 44s+ past offset 150,000). Live-tested
# against the real API at the real, current checkpoint depth (~offset
# 60,000): 5 pages serial took 17.9s (3.58s/page); 5 pages concurrent took
# 1.7s total. Pushed further — 10, 20, and 30 concurrent requests all
# completed with zero errors, throughput still improving at 30. Chosen
# value is comfortably under Pro-tier's real 3,000 req/min (50 req/sec)
# ceiling even sustained (30 concurrent requests completing in ~3s is
# roughly 10 req/sec, not 50). This doesn't fix 8004scan's own real,
# server-side pagination latency at extreme depth — a slow individual
# request is still slow — but it means a WINDOW of them completes in
# roughly one request's worth of wall-clock time instead of N times that.
INGEST_CONCURRENCY = 20


async def _get_progress(doc_id: str = PROGRESS_DOC_ID) -> dict:
    # Real, generalized 2026-08-28 (took a plain `doc_id` param) so the same
    # real checkpoint machinery serves both the shared EVM scan
    # (PROGRESS_DOC_ID) and the separate Solana scan (SOLANA_PROGRESS_DOC_ID)
    # without duplicating this function.
    db = get_db()
    doc = await db[PROGRESS_COLLECTION].find_one({"_id": doc_id})
    if doc:
        return doc
    return {
        "_id": doc_id, "next_offset": 0, "total_ingested": 0,
        "total_server_reported": None, "started_at": None, "last_run_at": None,
        "completed_at": None, "last_error": None,
    }


async def _save_progress(progress: dict) -> None:
    db = get_db()
    await db[PROGRESS_COLLECTION].replace_one({"_id": progress["_id"]}, progress, upsert=True)


async def get_progress() -> dict:
    """Real, current EVM (multi-chain, shared-scan) ingestion progress —
    for reporting/monitoring."""
    return await _get_progress(PROGRESS_DOC_ID)


async def get_solana_progress() -> dict:
    """Real, current Solana-specific ingestion progress — separate real
    checkpoint from the shared EVM scan above, see SOLANA_PROGRESS_DOC_ID."""
    return await _get_progress(SOLANA_PROGRESS_DOC_ID)


def _additional_chain_progress_doc_id(name: str) -> str:
    return f"chain_{name}"


async def get_additional_chains_progress() -> dict:
    """Real, current progress for every ADDITIONAL_CHAINS entry — same
    real shape as get_progress()/get_solana_progress() above, one real
    checkpoint per chain."""
    return {
        name: await _get_progress(_additional_chain_progress_doc_id(name))
        for name in ADDITIONAL_CHAINS
    }


async def _record_skipped_offset(offset: int, error: str) -> None:
    """Real, upserted record of one page that failed after exhausting its
    own internal retries — see SKIPPED_OFFSETS_COLLECTION's own docstring.
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
    """Real, live summary for /api/full-registry-progress — a count (so a
    genuinely growing number is visible at a glance) plus a bounded sample
    (oldest-first, so the longest-unresolved real gaps are the ones shown,
    not an arbitrary slice) — never the full list unbounded, same
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
    """Real, bounded attempt to recover previously-skipped pages (oldest
    first) — called automatically at the start of every real
    run_ingest_batch (see below) so every real 6-hourly cycle gives
    8004scan's own API another real chance to have recovered at this
    depth, with zero extra scheduling/endpoints needed. A real success
    upserts that page's real agents into full_agent_registry exactly like
    the main forward scan does, then DELETES the skip record (it's no
    longer a real gap). A real failure just updates the existing record's
    skip_count/last_error and moves on — never blocks or re-raises, since
    a still-failing page here is expected, not a new problem."""
    db = get_db()
    docs = await db[SKIPPED_OFFSETS_COLLECTION].find(
        {}, sort=[("first_skipped_at", 1)],
    ).to_list(length=None)

    t0 = time.time()
    recovered = 0
    still_failing = 0
    agents_recovered = 0
    for doc in docs:
        if time.time() - t0 > max_seconds:
            break
        offset = doc["_id"]
        try:
            agents, _total, _raw_len = await bsc.list_agents_for_chains(
                api_key, TARGET_CHAIN_IDS, offset=offset, limit=PAGE_SIZE,
                timeout=REQUEST_TIMEOUT, max_retries=2,  # lighter retry here — the main loop's own retry already ran once for this exact offset before it ever landed here
            )
        except Exception as e:
            still_failing += 1
            await _record_skipped_offset(offset, f"{type(e).__name__}: {e}")
            continue

        if agents:
            ops = []
            for a in agents:
                real_id = a.get("id")
                if not real_id:
                    continue
                d = dict(a)
                d["_id"] = real_id
                d["_ingested_at"] = time.time()
                ops.append(d)
            if ops:
                await db[FULL_REGISTRY_COLLECTION].bulk_write(
                    [UpdateOne({"_id": d["_id"]}, {"$set": d}, upsert=True) for d in ops],
                    ordered=False,
                )
                agents_recovered += len(ops)
        await db[SKIPPED_OFFSETS_COLLECTION].delete_one({"_id": offset})
        recovered += 1
        print(f"[full_registry_ingest] RECOVERED previously-skipped offset {offset} "
              f"({len(agents)} real agents, was skipped {doc.get('skip_count', 1)}x)")

    return {"recovered": recovered, "still_failing": still_failing,
            "agents_recovered": agents_recovered, "elapsed_seconds": round(time.time() - t0, 1)}


async def run_ingest_batch(
    api_key: str, max_seconds: float = 600.0, max_pages: int | None = None,
    concurrency: int = INGEST_CONCURRENCY,
) -> dict:
    """Real, resumable ingestion batch — fetches real pages starting from
    the last real checkpoint, upserts every real agent matching
    TARGET_CHAIN_IDS into `full_agent_registry` (tagged by its own real
    chain_id), and stops after `max_seconds` (or `max_pages`, or reaching
    the real end of the registry). Returns a real summary of what THIS
    batch actually did.

    Real, concurrent fetching (2026-08-29) — see INGEST_CONCURRENCY's own
    docstring for the real, live-measured evidence behind this. Pages are
    fetched `concurrency` at a time via a real, live-parallel window, and
    each window's real results are still processed strictly IN OFFSET
    ORDER, one at a time — `next_offset` only advances past a page once
    it's been either successfully upserted OR recorded as a real, logged
    skip (see below), never silently, out of order.

    Real fix (2026-09-02, live incident — see SKIPPED_OFFSETS_COLLECTION's
    own docstring for the full real investigation): a page that still
    fails after its own internal retry budget (6 attempts) no longer
    stops the whole batch forever. It's SKIPPED — checkpoint advances past
    it, a clear log line is printed, and it's recorded in
    full_registry_skipped_offsets for automatic later retry (this
    function calls retry_skipped_offsets itself, first, every real
    invocation) — bounded by MAX_NEW_SKIPS_PER_BATCH so a genuine, broad
    8004scan outage still stops the batch honestly (stopped_reason) rather
    than skipping through it silently at scale. This replaces the
    original, stricter "one failure stops the whole window, no data lost,
    no forward progress either" behavior, which is exactly what let a
    single persistently-flaky depth stall real ingestion for ~70 real
    hours across 13 consecutive scheduled runs before this fix."""
    db = get_db()
    progress = await _get_progress()
    if progress.get("started_at") is None:
        progress["started_at"] = time.time()

    # Real, automatic recovery attempt — every real invocation gives
    # previously-skipped pages a bounded chance to succeed now, before any
    # new forward progress this call makes. A small, fixed sub-budget
    # (not carved out of max_seconds) — this is deliberately allowed to
    # add a little real wall time on top, since it's the one bounded thing
    # standing between a skip and it being retried at all.
    retry_result = await retry_skipped_offsets(api_key, max_seconds=15.0)

    offset = progress["next_offset"]
    pages_done = 0
    agents_this_batch = 0
    by_chain_this_batch: dict[int, int] = {}
    pages_skipped_this_batch = 0
    t0 = time.time()
    reached_end = False
    stopped_early = False
    stopped_reason = None

    while True:
        if time.time() - t0 > max_seconds:
            break
        if max_pages is not None and pages_done >= max_pages:
            break

        window = concurrency
        if max_pages is not None:
            window = min(window, max_pages - pages_done)
        window_offsets = [offset + i * PAGE_SIZE for i in range(window)]
        results = await asyncio.gather(
            *[
                bsc.list_agents_for_chains(
                    api_key, TARGET_CHAIN_IDS, offset=o, limit=PAGE_SIZE,
                    timeout=REQUEST_TIMEOUT, max_retries=6,
                )
                for o in window_offsets
            ],
            return_exceptions=True,
        )

        for i, result in enumerate(results):
            page_offset = window_offsets[i]

            if isinstance(result, Exception):
                error_str = f"{type(result).__name__}: {result}"
                if pages_skipped_this_batch >= MAX_NEW_SKIPS_PER_BATCH:
                    # Real safety ceiling hit — stop honestly instead of
                    # skipping further, in case this is a genuine, broad
                    # 8004scan outage rather than this-depth flakiness.
                    stopped_reason = (f"hit MAX_NEW_SKIPS_PER_BATCH ({MAX_NEW_SKIPS_PER_BATCH}) at "
                                       f"offset {page_offset}: {error_str}")
                    progress["last_error"] = stopped_reason[:300]
                    progress["last_run_at"] = time.time()
                    await _save_progress(progress)
                    stopped_early = True
                    break

                print(f"[full_registry_ingest] offset {page_offset} failed after internal retries, "
                      f"SKIPPING (recorded for automatic later retry): {error_str}")
                await _record_skipped_offset(page_offset, error_str)
                pages_skipped_this_batch += 1

                offset = page_offset + PAGE_SIZE
                pages_done += 1
                progress["next_offset"] = offset
                progress["last_run_at"] = time.time()
                progress["last_error"] = f"offset {page_offset} skipped: {error_str}"[:300]
                await _save_progress(progress)
                continue

            agents, total, raw_len = result
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
                    # Real bug found and fixed (2026-08-28): a full
                    # ReplaceOne here silently WIPED any service_status/
                    # category a prior real analysis pass
                    # (full_registry_analysis.py) had already written for
                    # an agent. Real fix: $set only the fresh raw-listing
                    # fields this page actually has, leaving any existing
                    # analysis fields untouched — a genuine merge, not a
                    # silent overwrite.
                    await db[FULL_REGISTRY_COLLECTION].bulk_write(
                        [UpdateOne({"_id": d["_id"]}, {"$set": d}, upsert=True) for d in ops],
                        ordered=False,
                    )
                    agents_this_batch += len(ops)

            offset = page_offset + PAGE_SIZE
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
                stopped_early = True
                break

        if stopped_early:
            break

    return {
        "pages_done": pages_done, "agents_ingested": agents_this_batch,
        "by_chain": by_chain_this_batch, "next_offset": offset, "reached_end": reached_end,
        "stopped_reason": stopped_reason,
        "pages_skipped_this_batch": pages_skipped_this_batch,
        "recovered_skipped_offsets": retry_result,
        "elapsed_seconds": round(time.time() - t0, 1),
    }


async def _run_single_chain_ingest_batch(
    api_key: str, chain_id: int, progress_doc_id: str,
    max_seconds: float = 60.0, max_pages: int | None = None,
) -> dict:
    """The one, real, shared single-chain (server-side chain_id-filtered)
    ingest loop. Originally built for Solana (2026-08-28) once 8004scan's
    own real `chain_id=101` filtering was confirmed live (see this
    module's own docstring for the full real correction); generalized
    2026-09-10 so ADDITIONAL_CHAINS (Monad/Billions Network/Robinhood
    Chain/Celo/Arbitrum) can reuse the exact same real, proven logic
    instead of five near-duplicate copies. Same real resumable/
    checkpointed shape as run_ingest_batch above (own progress doc per
    chain, own upserts into the SAME `full_agent_registry` collection
    per the real "store every chain the same way" requirement), but
    calls adapters/bsc.py's list_agents_by_chain_id (real, correctly
    server-side-filtered) instead of list_agents_for_chains (real,
    deliberately-unfiltered page mixing) — none of these chain_ids are
    in TARGET_CHAIN_IDS, confirmed live the same way Solana was, so
    reusing the shared scan here would silently ingest nothing for any
    of them."""
    db = get_db()
    progress = await _get_progress(progress_doc_id)
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
            agents, total, raw_len = await bsc.list_agents_by_chain_id(
                api_key, chain_id, offset=offset, limit=PAGE_SIZE,
                timeout=REQUEST_TIMEOUT, max_retries=6,
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
                # Same real $set-only merge discipline as run_ingest_batch
                # above — never wipe a prior real analysis pass's fields.
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
        "next_offset": offset, "reached_end": reached_end,
        "elapsed_seconds": round(time.time() - t0, 1),
    }


async def run_solana_ingest_batch(api_key: str, max_seconds: float = 60.0, max_pages: int | None = None) -> dict:
    """Real, resumable Solana-specific ingestion batch — thin wrapper
    around _run_single_chain_ingest_batch above (same function, unchanged
    real behavior; the loop itself was generalized 2026-09-10, this name
    kept for every existing real caller)."""
    return await _run_single_chain_ingest_batch(api_key, SOLANA_CHAIN_ID, SOLANA_PROGRESS_DOC_ID, max_seconds, max_pages)


async def run_additional_chains_ingest_batch(api_key: str, max_seconds_per_chain: float = 10.0, max_pages: int | None = None) -> dict:
    """Real, bounded batch across every ADDITIONAL_CHAINS entry, one
    small real time-slice per chain per real call — deliberately tight
    (default 10s/chain, ~50s total for five chains) to stay safely under
    this backend's own real, previously-measured Render request-timeout
    zone (~75s, see server.py's full_registry_batch route docstring),
    the same conservative discipline the shared 20s/15s ingest/analyze
    defaults already use elsewhere in this pipeline. Real, resumable per
    chain (its own progress doc each, via _additional_chain_progress_doc_id)
    — a slower chain (Billions Network at ~26,000 real agents) just takes
    more real 6-hourly cycles to catch up; it never blocks or starves the
    others, and a chain that's already reached_end costs almost nothing
    on a later call (one real page fetch confirming no new agents)."""
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
    # the real one was 332,377 -- it would have re-fetched a third of the
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
