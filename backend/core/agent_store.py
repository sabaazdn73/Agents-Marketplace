"""
agent_store.py

Persistent MongoDB store of every agent we've EVER seen from a real 8004scan
refresh, so agents don't silently vanish between fetches.

Why this exists: the live 8004scan fetch is a small, cluster-capped sample of a
700k+ registry (see core/aggregate.py). Any single refresh returns only a slice,
and a server restart or a rate-limited fetch would otherwise drop agents a user
was looking at, or had just hired. This store UPSERTS agents (keyed by
agent_id, NEVER deletes) so the marketplace stays consistent across fetches and
restarts.

Staleness policy, stated honestly: because each fetch is a tiny sample of a
huge registry, an agent being ABSENT from a given refresh is completely normal
and is NOT evidence it was delisted on-chain. Flagging "delisted" on short-term
fetch-absence would cry wolf on almost every agent every hour. So we track
last_seen_at and only set `possibly_delisted` when an agent hasn't appeared in
ANY refresh for STALE_DAYS days, long enough (given hourly refreshes) that
continued absence is actually meaningful, and even then we only FLAG it (soft,
reversible) rather than removing it. The threshold is time-based, not
miss-count-based, precisely because miss-count is dominated by sampling noise.

Diversity is re-applied on READ: agents accumulate across refreshes, and without
a re-cap the big campaigns (Termix/Q402/Ave.ai) would slowly refill the store
with distinct-id duplicates. get_stored_agents() sorts by score then re-caps per
cluster so the served list stays diverse no matter how much has accumulated.

gap found and fixed 2026-08-18 (audited against the live store, not just
this docstring's stated intent): `upsert_agents` did a blind `$set` of every
field aggregate.py sent, every refresh. aggregate.py itself explicitly falls
back to None/False for its best-effort enrichment fields (tvl_usd,
defillama_slug/url, financial_data_available, owner_bnb_balance) whenever the
DefiLlama fetch or the owner-balance RPC transiently fails THAT round (see its
own try/except comments, "agents still shown, just without TVL"). A blind
$set meant a transient upstream hiccup on refresh N would silently OVERWRITE a
value learned on refresh N-1 with None, not a dropped agent (the
document survives, matching the headline promise above), but a real, silent
loss of previously-known data, live-confirmed: all 96 agents in the store
right now have a owner_bnb_balance, every one of them one bad RPC call
away from being wiped back to None on the next refresh under the old code.
Fixed below: these specific best-effort fields only get overwritten when the
fresh value is genuinely present; a fresh None/failed-match doesn't erase a
one already on record. Deliberate, stated tradeoff: this can't distinguish
"transient failure" from "this agent genuinely stopped matching a DefiLlama
protocol", it's biased toward keeping last-known-data rather than
silently losing it, consistent with this file's own possibly_delisted
philosophy above (flag soft and reversible, never erase).
"""

import re
import time
from datetime import datetime, timezone, timedelta

from core.db import get_db
import gc

from core.interaction_summary import describe_interaction
from core.chain_views import BUDGET_HIRE_CHAIN_IDS, ESCROW_HIRE_CHAIN_IDS
from core.clustering import cluster_agents as _cluster_agents
from core.clustering import diversify as _diversify # same multi-signal cluster-cap used at fetch time, see core/clustering.py

STALE_DAYS = 7          # not seen in any refresh for a week => possibly delisted
READ_CLUSTER_CAP = 3    # keep the served list diverse across accumulation

# How many documents the CHEAP selection pass may read. It reads only the
# clustering inputs, not whole documents, so a pool doc costs about 1.7KB
# against a full one's ~8.6KB -- measured, not estimated: 154,865 slim docs
# peaked at 268MB.
#
# Bounded for the same reason every other read here is bounded. This file's
# own history is a list of unbounded reads that were fine until the store
# grew: the pool must not become the next one. At 160,000 the slim read
# stays near the size actually measured safe; past that the best-scoring
# 160,000 are used and the rest are not considered, which is the same
# graceful degradation the 30,000 serving cap already makes.
#
# Raising this needs a fresh RSS measurement, not arithmetic -- see the
# repeated, documented failures above of reasoning a cap upward without
# testing it under a long, multi-refresh watch.
SELECTION_POOL_LIMIT = 160_000

# ── The stored survivor selection ───────────────────────────────────────────
#
# WHAT THIS IS FOR
# Choosing the served window costs a read of the WHOLE store plus a clustering
# pass in Python, and it ran on every cold boot. Measured against live data on
# 2026-09-20, that cost barely moves with the serving cap, because the pool
# read is the whole collection either way:
#
#     get_stored_agents(15000)  ->  15,000 rows in 275.1s
#     get_stored_agents( 6000)  ->   6,000 rows in 207.7s
#     get_stored_agents( 3000)  ->   3,000 rows in 177.1s
#
# About 150s of that is fixed. On a free-tier container it is the difference
# between a cold /api/agents answering and being killed before it does, and it
# is why the BNB grid came back empty while every other chain was fine: BNB is
# the only view served through this path.
#
# The selection is a list of ids. It changes only when known_agents changes,
# so it is computed once, stored, and reused until the store moves under it.
#
# WHAT IT IS NOT ALLOWED TO DO
# It must never be the reason a grid is empty. Every failure here, a missing
# document, a short one, a stale one, a malformed id list, a database that will
# not answer, falls through to the full recompute that was the only path
# before. The cache has no authority: it can make a boot fast, and it cannot
# make a boot wrong.
SELECTION_COLLECTION = "served_selection"
SELECTION_DOC_ID = "current"

# Age alone does not make a selection wrong; the store moving under it does,
# and that is checked exactly. The TTL is the backstop for what a count cannot
# catch, the same number of documents with different contents, which
# upsert-only writes can produce. A day matches the refresh cadence.
SELECTION_TTL_SECONDS = 24 * 60 * 60

# Best-effort enrichment fields that a transient upstream failure can null out
# on any given refresh (see the module docstring). Grouped because they
# describe ONE outcome (the DefiLlama match), preserved or overwritten
# together, never partially, so tvl_usd can't end up stale while
# financial_data_available flips to False (or vice versa).
#
# Real, added 2026-08-29 (API-data investigation): tvl_change_7d_pct,
# audit_count, tvl_data_flagged, mcap_usd all come from the exact same
# DefiLlama match as the four fields above, added to this same group so
# a transient DefiLlama fetch failure can't silently regress THEM to None/
# False either, while leaving tvl_usd/defillama_slug/url looking fine.
_DEFILLAMA_FIELD_GROUP = [
    "tvl_usd", "defillama_slug", "defillama_url", "financial_data_available",
    "tvl_change_7d_pct", "audit_count", "tvl_data_flagged", "mcap_usd",
]
_OWNER_BALANCE_FIELD = "owner_bnb_balance"
# fix (2026-08-27, owner-balance 429 investigation): moves together
# with _OWNER_BALANCE_FIELD, same real "preserve on failure" discipline,
# see core/aggregate.py's own TTL-skip logic, which reads this exact
# timestamp back on the next refresh to decide whether an owner's balance
# is still fresh enough to skip re-fetching.
_OWNER_BALANCE_CHECKED_AT_FIELD = "owner_bnb_balance_checked_at"


def _merge_preserving_real_data(fresh: dict, existing: dict | None) -> dict:
    """Returns the $set payload for one agent: fresh data, except the
    best-effort fields above fall back to the EXISTING stored value when the
    fresh fetch came back empty/failed for them this round."""
    merged = dict(fresh)
    if not existing:
        return merged
    if fresh.get("tvl_usd") is None and existing.get("tvl_usd") is not None:
        for f in _DEFILLAMA_FIELD_GROUP:
            merged[f] = existing.get(f)
    if fresh.get(_OWNER_BALANCE_FIELD) is None and existing.get(_OWNER_BALANCE_FIELD) is not None:
        merged[_OWNER_BALANCE_FIELD] = existing[_OWNER_BALANCE_FIELD]
        merged[_OWNER_BALANCE_CHECKED_AT_FIELD] = existing.get(_OWNER_BALANCE_CHECKED_AT_FIELD)
    return merged


async def upsert_agents(agents: list[dict]) -> dict:
    """Upsert each freshly-fetched agent into `known_agents`, keyed by agent id.
    Updates mutable fields (score, feedback, category, …) in place, stamps
    last_seen_at, records first_seen_at once, and NEVER deletes, and never
    silently regresses a best-effort enrichment field to empty just because
    this round's fetch of it happened to fail (see module docstring)."""
    db = get_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    coll = db.known_agents
    new_count = 0

    ids = [a.get("id") for a in agents if a.get("id") and a.get("id") != "None"]
    existing_docs = await coll.find({"_id": {"$in": ids}}).to_list(length=len(ids)) if ids else []
    existing_by_id = {d["_id"]: d for d in existing_docs}

    for a in agents:
        aid = a.get("id")
        if not aid or aid == "None":
            continue
        merged = _merge_preserving_real_data(a, existing_by_id.get(aid))
        res = await coll.update_one(
            {"_id": aid},
            {"$set": {**merged, "last_seen_at": now_iso},
             "$setOnInsert": {"first_seen_at": now_iso}},
            upsert=True,
        )
        if res.upserted_id is not None:
            new_count += 1
    total = await coll.count_documents({})
    return {"seen": len(agents), "new": new_count, "total_known": total, "at": now_iso}


# How many agents `known_agents` may hold. This is a ceiling on the WRITE, not
# a periodic cleanup, because a periodic cleanup is what was tried and what
# regressed.
#
# WHY THE STORE GROWS WITHOUT ONE
# The refresh does not select the same agents twice. `get_agents_from_full_registry`
# draws its pool with MongoDB's `$sample`, deliberately, so that the
# diversification input is a representative cross-section rather than whatever
# sits first in insertion order. Each refresh therefore names a different subset
# of `full_agent_registry`, `upsert_agents` never deletes, and the union of many
# random samples converges on the whole registry. Measured 2026-09-16: the
# served window is 15,000 and 33,506 distinct agents had been stamped within
# 24 hours, on the way to 102,997 stored against a registry of 261,479.
#
# That is also why the 2026-09-08 fix did not hold. It deleted down to 15,000
# and changed nothing about the mechanism, so the store refilled. A cap applied
# where the write happens cannot regress the same way: the next refresh enforces
# it again.
#
# WHY 40,000
# The serving read takes a pool from this collection and diversifies it down to
# SERVE_LIMIT. A cap of roughly two and a half times the served window leaves
# diversification a real choice while bounding the collection permanently. At
# about 1.06KB per document this holds `known_agents` near 42MB rather than the
# 108MB it had reached, against a 512MiB cluster quota that has refused writes
# once already.
KNOWN_AGENTS_MAX = 40_000

# One run never deletes more than this. A cap that tries to remove 60,000
# documents in a single call on a shared-tier cluster is its own outage.
KNOWN_AGENTS_MAX_DELETE_PER_RUN = 25_000

# The last thing the cap did, so that "did it run" is a question somebody can
# answer by fetching a URL.
#
# It was answered with a log line, and the log line could not be read: the
# service emits about six lines a second, the platform's log API returns the
# newest hundred with no time range, so a hundred lines is seventeen seconds of
# history and anything older is unreachable. A fact that scrolls out of reach
# in seventeen seconds is not observability. This is queryable for as long as
# the process lives, which is the interval that matters for a job that runs
# every refresh.
#
# In-process only, and that was not enough. On 2026-09-23 an investigation into
# the responding tier falling 652 -> 529 in a day needed to know whether this
# cap had deleted anything, and /api/status returned null for it: the refresh
# that last ran the cap had happened in a worker that no longer existed. The
# question "did the cap run, and what did it take" survived seventeen seconds
# of logs and then nothing at all. So the same result is now also written to a
# collection, below, and this global is kept as the cheap read for the current
# process.
_LAST_CAP_RESULT: dict | None = None

# Where a cap run is recorded so it outlives the process that made it.
#
# One document per run, never updated, because the value of this record is the
# sequence: a single tier count falling over a day is explained by what a
# series of runs removed, not by what the most recent one did.
CAP_RUN_COLLECTION = "known_agents_cap_runs"


def last_cap_result() -> dict | None:
    """What the store cap did on its most recent run in this process."""
    return _LAST_CAP_RESULT


async def recent_cap_runs(limit: int = 20) -> list[dict]:
    """The last `limit` cap runs, newest first, across every process.

    Reads the durable record rather than the in-process global, so this answers
    the question the global could not: what has the cap been doing since before
    this worker booted.
    """
    db = get_db()
    return await db[CAP_RUN_COLLECTION].find(
        {}, {"_id": 0}).sort("ran_at_ts", -1).limit(limit).to_list(length=limit)


async def _record_cap_run(result: dict) -> None:
    """Persist one cap run. Never raises: the cap must not fail because its own
    bookkeeping could not be written."""
    try:
        db = get_db()
        await db[CAP_RUN_COLLECTION].insert_one(
            {**result, "ran_at_ts": time.time()})
    except Exception as e:  # noqa: BLE001
        print(f"[agent_store] cap run not recorded ({type(e).__name__}: {e}); "
              f"the cap itself ran and its result stands", flush=True)


async def _owners_with_delivery(db) -> list[str]:
    """Owner addresses that have delivered an on-chain job to somebody.

    The cap must not be able to evict these, which it could and did. Dropping
    the least recently selected agent is the right rule for an agent nobody has
    looked at; it is the wrong rule for the twenty-odd agents the site's
    strongest claim rests on, and on 2026-09-17 the first capped run took the
    verified count from 27 to 20 by exactly that route. Least-recently-selected
    is not a proxy for least valuable.

    Read from the job index rather than from a tier, because the tier is
    computed downstream of this collection and would be circular.
    """
    from core.job_index import JOB_INDEX_COLLECTION
    rows = await db[JOB_INDEX_COLLECTION].aggregate([
        {"$match": {"provider": {"$ne": ""},
                     "status": {"$in": ["COMPLETED", "SUBMITTED"]}}},
        {"$group": {"_id": "$provider"}},
    ]).to_list(length=None)
    return [r["_id"] for r in rows if r["_id"]]


async def enforce_store_cap(max_docs: int = KNOWN_AGENTS_MAX,
                            max_delete: int = KNOWN_AGENTS_MAX_DELETE_PER_RUN) -> dict:
    """Hold `known_agents` near its ceiling, oldest `last_seen_at` first.

    Near, not at. The cutoff is a whole hour of `last_seen_at`, and a run stops
    rather than delete an hour that would take it past its own per-run bound,
    so the collection settles at the cap plus at most one hour bucket. Measured
    on the first run: 102,997 down to 42,596 against a cap of 40,000. That is a
    bound, which is what this is for, and it is not an exact count, which is
    what the name would otherwise imply.

    Least-recently-selected is the right thing to drop: an agent the sampler
    has not named in a long time is an agent the marketplace has not served in
    a long time, and its enrichment is correspondingly stale. If the sampler
    names it again it is re-created by the next upsert, and
    `_merge_preserving_real_data` treats it as new rather than regressing a
    live field to empty.

    Returns what it did rather than logging it, so the caller decides whether
    a deletion is worth saying out loud.
    """
    db = get_db()
    coll = db.known_agents
    global _LAST_CAP_RESULT
    ran_at = datetime.now(timezone.utc).isoformat()
    total = await coll.count_documents({})
    over = total - max_docs
    if over <= 0:
        # A run that found nothing to do still writes a row. Zero rather than
        # null or absent, because "the cap ran and removed nothing" and "the
        # cap never ran" are different facts, and the sequence of runs is the
        # whole point of recording them: a tier falling over a day is explained
        # by what a series of runs took, not by the most recent one.
        _LAST_CAP_RESULT = {"ran_at": ran_at, "total": total, "over": 0,
                            "deleted": 0, "verdicts_destroyed": 0,
                            "verdicts_destroyed_by_status": {"responding": 0, "not_responding": 0,
                                             "no_endpoint": 0, "unknown": 0},
                            "verdicts_exclude_unknown": True,
                            "capped_at": max_docs,
                            "note": "under the ceiling; nothing to remove"}
        await _record_cap_run(_LAST_CAP_RESULT)
        return dict(_LAST_CAP_RESULT)

    # Never evictable, however long since they were last selected.
    protected = await _owners_with_delivery(db)
    keep = {"owner_address": {"$nin": protected}} if protected else {}

    take = min(over, max_delete)

    # Chosen by counting, not by sorting.
    #
    # The obvious implementation is find().sort("last_seen_at", 1).limit(n).
    # It fails here: nothing indexes last_seen_at, so the sort is in memory,
    # and an in-memory sort of this collection exceeds MongoDB's 32MB limit.
    # allowDiskUse is the documented escape and is not available on a shared
    # tier, so the escape is unavailable exactly where the limit binds.
    #
    # Instead: one pass that buckets last_seen_at by hour, then walk the hours
    # oldest first until the bucket total reaches what has to go, and delete by
    # that timestamp. One aggregation and one delete, no sort stage, and the
    # cutoff is a real boundary in the data rather than an offset into an
    # ordering that has ties.
    # Bucketed over what is actually deletable, so the walk below counts what
    # it can remove rather than what exists.
    buckets = await coll.aggregate([
        {"$match": keep} if keep else {"$match": {}},
        {"$group": {"_id": {"$substrBytes": ["$last_seen_at", 0, 13]},
                     "n": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]).to_list(length=None)

    running, cutoff = 0, None
    for b in buckets:
        # Stop before crossing the allowance: deleting a whole hour that takes
        # the total past `take` would break the per-run bound this exists to
        # respect. The next run takes the next hour.
        if running + b["n"] > take:
            break
        running += b["n"]
        cutoff = b["_id"]

    if not cutoff and buckets:
        # Nothing fits under the allowance, because the oldest hour alone is
        # bigger than the overage. Stopping here is what the first version did,
        # and it meant the collection settled permanently above the cap: after
        # the first run it sat at 42,596 against a ceiling of 40,000 and could
        # never move again. Take that one hour anyway when it is inside the
        # per-run bound. Overshooting the ceiling downward by part of an hour
        # is harmless; never reaching it is not.
        oldest = buckets[0]
        if oldest["n"] <= max_delete:
            cutoff, running = oldest["_id"], oldest["n"]

    if not cutoff or not running:
        _LAST_CAP_RESULT = {"ran_at": ran_at, "total": total, "over": over,
                            "deleted": 0, "verdicts_destroyed": 0,
                            "verdicts_destroyed_by_status": {"responding": 0, "not_responding": 0,
                                             "no_endpoint": 0, "unknown": 0},
                            "verdicts_exclude_unknown": True,
                            "capped_at": max_docs,
                            "note": "the oldest hour alone exceeds the per-run "
                                    "delete bound; nothing removed this run"}
        await _record_cap_run(_LAST_CAP_RESULT)
        return dict(_LAST_CAP_RESULT)

    doomed = {**keep, "last_seen_at": {"$lte": cutoff + "\uffff"}}

    # WHAT THIS RUN IS ABOUT TO DESTROY THAT CANNOT BE RECOMPUTED.
    #
    # A `service_status` is the only evidence behind the responding tier, and
    # unlike every other field on these documents it is not re-derivable from
    # the registry: it was earned by a live probe of that agent's endpoint at a
    # moment that has passed. Deleting the document deletes the verdict, and
    # the agent returns from the next upsert with no health state at all.
    #
    # This counts that loss BEFORE the delete, because afterwards there is
    # nothing left to count. It is the number that decides whether eviction
    # explains a falling responding tier: on 2026-09-23 that tier fell from 652
    # to 529 in a day and the question could only be argued by elimination,
    # because no measurement of this existed. One count_documents against the
    # same filter the delete uses, so the two cannot describe different sets.
    #
    # Deliberately NOT a policy change. This run still deletes exactly what it
    # would have deleted before, including the verdicts. Instrumenting and
    # changing what is evicted are separate, and doing both at once would make
    # the first measurement unattributable.
    #
    # NOT YET EXERCISED, AS OF 2026-09-23. This counting path has never run.
    # enforce_store_cap is only called on a refresh landing 5,000 or more fresh
    # agents, and no such refresh happened while this was written, so the first
    # verdicts_destroyed figure will be produced in production with nobody
    # watching it. Treat the first row this collection receives as the thing
    # being tested rather than as a measurement to act on: check it against
    # `deleted` and against the invariant below before believing it.
    # WHAT COUNTS AS A VERDICT, AND WHY `unknown` DOES NOT.
    #
    # The first version of this counted every document with a non-null
    # service_status, which counts `unknown` as lost evidence. It is not:
    # update_agent_health above exists precisely to stop `unknown` overwriting
    # a verdict, on the stated grounds that a failed check is not a verdict.
    # `unknown` is this pipeline failing to resolve an agent's metadata, so
    # deleting it destroys nothing that was ever established. On 2026-09-23,
    # 181 of 754 probed records were `unknown`, so a single number under this
    # name would have been up to a quarter our own failed resolutions counted
    # as evidence lost, overstating the exact quantity the eviction question
    # turns on.
    #
    # So the headline counts only earned verdicts, and the breakdown is kept
    # beside it so nobody has to trust the classification blind.
    verdicts_destroyed = None
    verdicts_destroyed_by_status = None
    try:
        by_status = {}
        for st in ("responding", "not_responding", "no_endpoint", "unknown"):
            by_status[st] = await coll.count_documents(
                {**doomed, "service_status": st})
        verdicts_destroyed_by_status = by_status
        # `unknown` deliberately excluded from the headline, per above.
        verdicts_destroyed = (by_status["responding"]
                              + by_status["not_responding"]
                              + by_status["no_endpoint"])
    except Exception as e:  # noqa: BLE001
        # Counting must never be the reason the cap does not run: the cap
        # exists to keep the cluster inside a quota that has refused writes
        # once. An uncounted run is recorded as uncounted rather than as zero,
        # because null here means "not measured" and 0 means "measured, none",
        # and collapsing those is the defect this whole pass is about.
        print(f"[agent_store] cap could not count doomed verdicts "
              f"({type(e).__name__}: {e})", flush=True)

    # `<` against the next hour's boundary, so the chosen hour is included
    # whole and no document is deleted whose hour was only partly counted.
    res = await coll.delete_many(doomed)
    deleted = res.deleted_count
    _LAST_CAP_RESULT = {"ran_at": ran_at, "total": total, "over": over,
                        "deleted": deleted, "remaining": total - deleted,
                        "verdicts_destroyed": verdicts_destroyed,
                        "verdicts_destroyed_by_status": verdicts_destroyed_by_status,
                        "verdicts_exclude_unknown": True,
                        "capped_at": max_docs, "cutoff": cutoff,
                        "protected_owners": len(protected)}

    # THE INVARIANT, PUBLISHED RATHER THAN ASSUMED.
    #
    # Counting and deleting are two operations with upserts running between
    # them, so verdicts_destroyed is an upper bound on what was really lost,
    # with a known direction of error: last_seen_at only moves forward, so a
    # document can leave the doomed set between the count and the delete and
    # can never join it. The count can therefore exceed the deletion, never the
    # reverse.
    #
    # So verdicts_destroyed <= deleted always holds, and a row that violates it
    # is a row where the race fired and whose count is stale. Saying which is
    # cheaper than having a later reader rediscover the race from an impossible
    # number.
    if (verdicts_destroyed is not None) and verdicts_destroyed > deleted:
        _LAST_CAP_RESULT["invariant_violated"] = (
            f"verdicts_destroyed ({verdicts_destroyed}) exceeds deleted "
            f"({deleted}): documents left the doomed set between the count and "
            f"the delete, so the verdict counts on this row are stale upper "
            f"bounds rather than what was removed")

    await _record_cap_run(_LAST_CAP_RESULT)
    return dict(_LAST_CAP_RESULT)


async def update_agent_health(results: dict[str, dict]) -> int:
    """Persist health-check results (see core/agent_health.py), one
    $set per agent, keyed by the same `_id` upsert_agents uses. A separate
    write path from upsert_agents on purpose: health-checks run on a
    shorter TTL than the main 8004scan refresh (liveness changes faster
    than metadata), so this needs to update a SUBSET of known_agents
    on its own cadence, not piggyback on the full-list $set above. Agents
    not present in `results` (skipped because their existing check was
    still fresh, see agent_health.HEALTH_TTL_SECONDS) are left untouched,
    never regressed to unknown just because this pass didn't re-check them.

    The same rule now holds for an agent that WAS re-checked and whose check
    failed on our side: `unknown` never overwrites a stored verdict. See the
    comment in the loop for what that cost when it did not hold.

    Returns the number of documents updated."""
    if not results:
        return 0
    db = get_db()
    coll = db.known_agents
    updated = 0
    for aid, fields in results.items():
        if fields.get("service_status") == "unknown":
            # A FAILED CHECK IS NOT A VERDICT.
            #
            # `unknown` means we never reached the agent's metadata, so we
            # learned nothing about whether it answers. Writing it over a
            # stored `responding` destroys evidence that was earned and
            # replaces it with our own failure, and because the check runs on
            # a rolling TTL it does that to the whole store in a day: on
            # 2026-09-17 the public IPFS gateway began returning 429 and the
            # responding count fell from 3,855 to 1,230 without a single
            # agent changing. 368 of the resulting `unknown` records still
            # carried service_http_status 200 from the check before.
            #
            # So the failure is recorded beside the verdict rather than on top
            # of it. A stored verdict survives; the attempt is dated, counted
            # and given its cause, which is what tells a later reader that a
            # figure is not being refreshed.
            attempt = {
                "service_recheck_failed_at": fields.get("service_checked_at"),
                "service_recheck_error": fields.get("service_check_error")
                                          or "resolve_failed",
            }
            # Only write `unknown` itself where nothing better is stored. A
            # missing field, null, or a previous `unknown` all qualify; a
            # verdict of any kind, including `not_responding` and
            # `no_endpoint`, does not, because those were learned about the
            # agent rather than about us.
            res = await coll.update_one(
                {"_id": aid, "service_status": {"$in": [None, "unknown"]}},
                {"$set": {**fields, **attempt},
                 "$inc": {"service_recheck_failures": 1}})
            if not res.matched_count:
                res = await coll.update_one(
                    {"_id": aid},
                    {"$set": attempt, "$inc": {"service_recheck_failures": 1}})
        else:
            # A real verdict. It stands, and it clears the failure markers so
            # a record cannot read as both current and failing.
            res = await coll.update_one(
                {"_id": aid},
                {"$set": {**fields, "service_recheck_failures": 0},
                 "$unset": {"service_recheck_failed_at": "",
                            "service_recheck_error": ""}})
        if res.matched_count:
            updated += 1
    return updated


_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


async def get_agent_by_owner(owner_address: str) -> dict | None:
    """lookup for one agent by its owner address (case-insensitive,
    on-chain addresses vary in casing across sources). Used by the negotiate
    proxy (server.py) to find an agent's real, on-chain-sourced
    `service_endpoint` without a fresh RPC round trip on every hire attempt.
    Returns the freshest-scored match if an owner somehow has more than one
    (real, if rare) known agent; None if genuinely not in the store yet, or
    if the input isn't even a well-formed address (also guards the regex
    query below against anything but a hex address reaching Mongo).

    Real, honest, confirmed-live limitation (2026-08-28): "if rare" above
    was wrong, checked directly, 1,457 owner addresses in the
    current, live known_agents have MORE than one registered agent. This
    function's own "freshest-scored" tie-break is a coin flip
    among them, and a real, visible bug traced back to exactly this:
    SmartSentinels (one owner, three real, structurally different
    agents, AIDA, Sentinels Audit, Sentinels Prediction) got AIDA's
    escrow-compatibility data served for a Sentinels Audit lookup, a
    real, wrong, publicly-visible result. Prefer get_agent_by_id below
    wherever the caller already knows which SPECIFIC agent it means
    (every frontend call site does, the UI always already has the
    exact agent's own id). This function stays as a real, honest
    best-effort fallback for the one caller that genuinely can't know a
    specific listing id (server.py's job-PnL-by-provider path, which only
    has a completed job's on-chain provider wallet to go on, a
    genuine, structural limitation of that on-chain data itself, not
    fixable by a better lookup here)."""
    if not owner_address or not _ADDRESS_RE.match(owner_address):
        return None
    db = get_db()
    docs = await db.known_agents.find(
        {"owner_address": {"$regex": f"^{owner_address}$", "$options": "i"}}
    ).to_list(length=5)
    if not docs:
        return None
    docs.sort(key=lambda d: (d.get("total_score") or 0), reverse=True)
    return docs[0]


async def get_agent_by_id(agent_id: str) -> dict | None:
    """Real, UNAMBIGUOUS lookup for one exact, specific agent by its
    own real, unique id (the same value known_agents stores each real
    agent's document under as `_id`, see upsert_agents above). Added
    2026-08-28 as the fix for the bug documented on
    get_agent_by_owner above: this is the one key that's never
    ambiguous, since it's the exact agent a user is actually looking
    at, not "some agent owned by this wallet". Every caller that has
    a specific agent in hand (which is every frontend call site,
    the UI already has the agent's own id) should prefer this."""
    if not agent_id:
        return None
    db = get_db()
    return await db.known_agents.find_one({"_id": agent_id})


SERVE_LIMIT = 15_000
"""How many agents /api/agents serves, and the read cap that produces them.

Since selection now returns only survivors, served == limit, so this one
number sets BOTH the read cost and the response size.

Lowered from 30,000 on 2026-09-06 after it broke the site. Raising the
served count to 30,000 doubled the response from ~14.8MB to 28.9MB, and
that body is held in the web service's cache and streamed on every
request. The OOM rate went from about 1.5/hour to 7/hour and the
marketplace started failing to load with "Failed to fetch".

The mistake was measuring the wrong thing. Peak RSS during the read was
measured (301 -> 294MB, which looked safe) but the resulting payload was
not, even though payload size is what this file's own history identifies
as the binding constraint. Read cost and response cost are separate and
both have to be checked.

At 15,000 the payload is back to the size that has held, while keeping
the whole point of survivor selection: every served agent is one that
survives the cluster cap, so these 15,000 span ~15,000 clusters where the
old window's 15,191 spanned 10,576. Same cost, more variety, and the read
is now half what it was before survivor selection existed.
"""


async def _current_store_count(db) -> int | None:
    """How many documents known_agents holds, cheaply.

    estimated_document_count reads collection metadata rather than scanning,
    which is the point: a staleness check that cost a real count would
    reintroduce the read this exists to avoid. None means the question could
    not be answered, and an unanswerable question is a miss, not agreement.
    """
    try:
        return await db.known_agents.estimated_document_count()
    except Exception:
        return None


async def _load_selection(db, limit: int) -> list | None:
    """The stored survivor ids, or None meaning recompute.

    Returns None on every doubt. The caller's fallback is the full selection
    pass, so a false miss costs one slow boot, while a false hit would serve a
    window that no longer matches the store.
    """
    try:
        doc = await db[SELECTION_COLLECTION].find_one({"_id": SELECTION_DOC_ID})
    except Exception:
        return None                        # database unhappy: recompute
    if not doc:
        return None                        # never built: recompute

    ids = doc.get("ids")
    if not isinstance(ids, list) or not ids:
        return None                        # malformed or empty: recompute

    # A selection computed for a smaller window cannot be stretched to a larger
    # one: the ids past its own cap were never chosen. A larger one truncates
    # cleanly, because the list is already in serving order.
    if (doc.get("limit") or 0) < limit:
        return None

    if time.time() - (doc.get("built_at") or 0) > SELECTION_TTL_SECONDS:
        return None                        # older than the refresh cadence

    # The store moving under it is what actually invalidates a selection.
    live_count = await _current_store_count(db)
    if live_count is None or doc.get("store_count") != live_count:
        return None

    return ids[:limit]


async def _store_selection(db, keep_ids: list, limit: int, store_count) -> None:
    """Record a freshly computed selection. Never raises into the caller.

    A write that fails costs the next boot the same recompute this one just
    did, which is exactly today's behaviour and not a regression. Serving the
    list that was already computed matters more than persisting it.
    """
    if not keep_ids:
        return
    try:
        await db[SELECTION_COLLECTION].replace_one(
            {"_id": SELECTION_DOC_ID},
            {
                "_id": SELECTION_DOC_ID,
                "ids": keep_ids,
                "limit": limit,
                "store_count": store_count,
                "built_at": time.time(),
            },
            upsert=True,
        )
    except Exception:
        pass


async def _select_survivor_ids(db, limit: int) -> list:
    """The full selection pass: read the store slim, cluster it, keep the
    survivors.

    This is what ran on every cold boot before the selection was stored, and it
    stays the fallback for every case where the stored one cannot be trusted.
    """
    # ── Survivor selection (2026-09-06) ─────────────────────────────────
    #
    # The served count had been falling for days -- 16,640 -> 15,743 ->
    # 15,433 -> 15,191 -- while known_agents kept GROWING (154,865 by the
    # time this was investigated). Not noise, and not the no-endpoint
    # deletion policy either: nothing deletes from known_agents, the only
    # delete in the codebase is on full_agent_registry.
    #
    # The cause was this read. Served count is not "limit minus some
    # noise"; it is Sum(min(cluster_size, 3)) over the clusters that happen
    # to be IN the window. Selecting the window by total_score alone was
    # diversity-blind, and total_score barely discriminates: 38,647 agents
    # share the identical score 12.01 and 74,137 score 0.0. So the window
    # filled up with many members of a few big clusters -- 30,000 agents
    # forming only 10,576 clusters -- and the 3-per-cluster cap then threw
    # away 14,809 of them. Half the window was agents that could never be
    # served, and it got worse every time ingestion deepened an existing
    # cluster rather than adding a new one.
    #
    # Fixed by choosing the window from agents that will actually SURVIVE
    # the cap. A cheap projection (the clustering inputs only) is read for
    # the whole store, clustered, and at most READ_CLUSTER_CAP per cluster
    # are selected; only then are the full documents fetched, for those
    # ids alone. The expensive read stays bounded by exactly the same
    # `limit` as before -- this buys diversity, not memory.
    #
    # Measured against live production data before keeping it:
    #     served    15,191 -> 30,000   (+97.5%, the window is now all
    #                                   survivors: 30,000 in, 30,000 out)
    #     peak RSS     301 -> 315 MB   (+4.7%)
    #     window spans 10,576 -> 19,370 clusters
    # The memory cost is small because the slim list is released before
    # the full documents are fetched, so the two phases reuse the same
    # arenas rather than stacking.
    #
    # A dedupe-aware window keyed on the blocking signature was tried
    # FIRST and measured WORSE at every setting (5,038 / 5,713 / 6,920
    # served vs 15,191). The whole store holds only 3,914 distinct
    # signatures, so such a pool cannot even fill the window -- and more
    # importantly most of what we serve is agents that share a description
    # template but are correctly kept APART by the corroboration rules.
    # Capping on the template alone destroys exactly those. Recorded here
    # because it is the obvious idea and it is wrong.
    slim_projection = {
        "_id": 0, "id": 1, "total_score": 1, "name": 1, "description": 1,
        "owner_address": 1, "created_at": 1, "service_endpoint": 1,
    }
    # Sorted on total_score ALONE at the database, deliberately. There is a
    # total_score index, so this streams in index order with no sort stage.
    # Adding ("id", 1) here to get a total order server-side was tried and
    # is a trap: no index covers that compound key, so MongoDB falls
    # back to an in-memory sort and, at a pool this size, fails outright --
    # "Sort exceeded memory limit of 33554432 bytes". The old query only
    # survived it because a 30,000 top-K sort is bounded; ~155,000 is not.
    # The tiebreaker belongs below, in Python, where it costs nothing.
    pool = await db.known_agents.find({}, slim_projection).sort(
        "total_score", -1
    ).to_list(length=SELECTION_POOL_LIMIT)

    # THE total order. total_score alone is not one -- 38,647 agents tie on
    # exactly 12.01 -- so the order among ties was undefined and drifted as
    # the collection was written to. `id` breaks every tie, so the same
    # store now always yields the same window in the same order. Same defect
    # class as the pagination overlap fixed earlier, in a different place.
    #
    # limit: once the store outgrows SELECTION_POOL_LIMIT, WHICH tied
    # agents fall inside the pool boundary is still the database's choice.
    # Ordering within the pool is fully deterministic either way, and today
    # the pool holds the entire store, so the boundary does not bind at all.
    pool.sort(key=lambda d: (-(d.get("total_score") or 0), str(d.get("id"))))

    cluster_of = _cluster_agents(pool)
    per_cluster: dict[int, int] = {}
    keep_ids: list = []
    for i, d in enumerate(pool):
        c = cluster_of[i]
        if per_cluster.get(c, 0) >= READ_CLUSTER_CAP:
            continue
        per_cluster[c] = per_cluster.get(c, 0) + 1
        keep_ids.append(d.get("id"))
        if len(keep_ids) >= limit:
            break

    # Released before the expensive read, deliberately: this is what keeps
    # the two phases from stacking into a peak the container cannot take.
    del pool, cluster_of, per_cluster
    gc.collect()
    return keep_ids


async def get_stored_agents(limit: int = SERVE_LIMIT) -> list[dict]:
    """The serving list: every agent ever seen, re-diversified and with a
    soft `possibly_delisted` flag. Active agents first (highest score first);
    possibly-delisted agents sink to the bottom but are never dropped.

    bug found and fixed (2026-08-27): this used to default to
    `limit=5000` and fetch with NO sort at the DB level, `.find({}).to_list
    (length=5000)` returns Mongo's natural (roughly insertion) order, so the
    5000 docs actually considered were an arbitrary early slice, not the
    best 5000. With known_agents having grown to 10,837+ (and climbing) since
    the full-registry-backed refresh shipped, this silently discarded more
    than half the store before diversification ever ran, live-
    confirmed: get_stored_agents() was returning 4,763 agents (matching a
    user report of "~4,800 agents") while the store itself already held
    10,837+. Fixed two ways: (1) sort by total_score at the DB level BEFORE
    limiting, so if the cap is ever actually hit again, it keeps the
    objectively best-scoring agents, not an arbitrary slice; (2) raised the
    default cap to 50,000, comfortably above the store size at the time
    (10,837), so the cap didn't bind at all.

    fix (2026-08-29, OOM crash-loop round 5): that 50,000 comfort margin
    eroded fast -- known_agents is upsert-only/never-delete, and every
    refresh (each one now also pulling from the much larger full_agent_
    registry pipeline) grows it further. Live-confirmed the same day:
    10,837 -> 26,736 -> 34,374 -> 38,033+ within about an hour of real
    refreshes, on a trajectory toward the 50,000 cap itself, not just
    toward "large". This function has no field projection (fetches every
    full known_agents doc) and is called on every cold boot and inside every
    background refresh -- its cost was rising every single time known_agents
    grew, with no ceiling. Lowered the default cap to 15,000 (sorted by
    total_score first, so this always keeps the objectively best-scoring
    agents, same as before) to put a real, permanent bound back under this
    call regardless of how large known_agents keeps growing -- the same
    "bound the pool, not just hope it stays small" discipline already
    applied to the full_agent_registry clustering pool and the health-check
    pass. Real, tradeoff: once known_agents exceeds 15,000, the
    lowest-scoring agents stop being served even though they're still in the
    store -- an intentional trade of completeness for service
    stability, matching the same tradeoff already accepted for the
    clustering pool.

    attempt to raise, tested live and reverted (2026-08-29, same day):
    after rounds 3-4 held stable for 1h47m, tried raising this to 25,000
    (known_agents was 42,281 and climbing at the time) on the reasoning that
    the dominant causes were already fixed elsewhere. Deployed, then forced
    the exact refresh path immediately (`?force_refresh=true`) rather than
    waiting -- a oomKilled event landed 31 seconds after that refresh's
    own "Upserted refresh" log line (total_known 45,730 at that point).
    Reverted back to 15,000 the same session. conclusion: at the
    real, current store size, this function's own uncapped `.find({})` (no
    field projection, fetches every full doc) is still expensive enough on
    its own that 15,000 is closer to the live ceiling than 25,000 --
    not just a conservative guess made under pressure. A raise above
    15,000 would need either a smaller per-doc read (a field
    projection here, not yet done) or a genuinely smaller known_agents
    (pruning of stale/never-hired agents, not yet built) -- raising
    the raw number alone was tested and does not hold.

    field projection added (2026-08-29, same investigation): checked
    every field this query returns against every consumer of its
    output -- the whole frontend (web + mobile, grep'd directly) and every
    backend module that reads get_stored_agents()'s result (core/
    clustering.py's diversify(), core/canary.py, and core/future_chains.py
    , the last of these removed 2026-09-10, kept here as accurate history
    of the audit at the time, not a current dependency).
    `created_at` looked like a dead candidate from the frontend alone but
    is genuinely read by clustering.py's registration-burst signal, so it
    stays. Four fields are confirmed write-only from this read path's
    perspective -- set by core/aggregate.py at ingest time, never read
    back by anything downstream of get_stored_agents(): category_matched_
    keywords (classification debug detail), cross_chain_versions (never
    actually read anywhere, only ever set to a value or None), health_score
    (same), and defillama_slug (only read back by agent_store.upsert_agents'
    own preservation logic, which queries known_agents independently of
    this function, not from this function's output). Excluding these four
    reduces per-document transfer/deserialize/memory cost with no
    functional change -- confirmed zero consumers, not a guess.

    Real, second retry (2026-08-30), now WITH the field projection above
    already live and confirmed (25+ minutes stable under traffic
    at 15,000, ~7.5% smaller response size than before the
    projection). known_agents had grown to 58,439 by the time of this
    retry. A genuinely UNRELATED blocker hit partway through: the
    shared MongoDB Atlas cluster hit its 512MB storage cap (shared with
    other, unrelated databases on the same account -- confirmed live,
    `sample_mflix`, a generic public sample dataset, alone was using as
    much room as this entire project), blocking every write cluster-wide.
    Not a memory/OOM issue at all -- freed by clearing that unrelated
    database (confirmed safe by the user first), which unblocked writes
    and let testing resume.

    Real, step-by-step ladder actually run, each step deployed and force-
    tested via `?force_refresh=true` immediately, watched for a real
    oomKilled in the following minutes before moving on -- per explicit
    instruction, not jumping straight to a large number. First pass (one
    quick force-refresh-and-watch-briefly per step):
      20,000 / 25,000 / 30,000 / 35,000 / 40,000 -- each looked clean
      50,000 -- oomKilled, ~17 seconds after that refresh's own
                "Upserted refresh" log line (store 80,466 at that point)

    Settled on 40,000 first, called it proven-safe, then ran one real,
    longer (15-min) stability watch on it as a final check before fully
    trusting it -- and it FAILED: a oomKilled ~2 minutes after
    deploy, well after the single quick check that had called it clean.
    Real, important, humbling correction: every "clean" verdict in the
    first-pass ladder above only covered ONE forced refresh followed by a
    brief watch -- not long enough to catch the exact "crashes a few
    minutes after a refresh, not during it" delayed pattern this same
    file's own history had already documented multiple times earlier the
    same day for different root causes. Re-tested 30,000 (two steps back)
    the same, stricter way -- a real, extended watch with MULTIPLE forced
    refreshes across it, not one -- and it ALSO failed: oomKilled
    ~3.3 minutes after deploy, on the very first forced refresh of that
    stricter run.

    Real, final, conclusion: every value tried above 15,000 failed
    once tested with a genuinely long, multi-refresh watch, not just a
    single quick check. The only value with real, rigorous, long-duration
    (25+ minutes, periodic traffic) confirmation from earlier
    the same day is 15,000 itself -- reverted back to it here. The field
    projection above is still and still helps (confirmed: smaller
    response size, and the two failures above needed MORE store
    growth and MORE elapsed time to manifest than the pre-projection
    baseline did), but it did not unlock as much headroom as the
    under-tested first-pass ladder suggested. A future attempt to raise
    this again should use the stricter test from the start: multiple
    forced refreshes across a real, long watch, not one quick check."""
    db = get_db()
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)).isoformat()
    # Real, confirmed-unused-downstream fields excluded from this read only
    # (upsert_agents' own separate query is untouched, so preservation of
    # e.g. defillama_slug across refreshes still works normally).
    #
    # Real, second exclusion pass (2026-08-30, following up on the "is
    # 15,000 permanent" investigation): traced every remaining field's
    # FULL usage path -- every .jsx/.js file, and every backend
    # module reading get_stored_agents()'s output -- before adding each
    # one here, same discipline as the first pass. All 11 confirmed zero
    # consumers of THIS specific read:
    # escrow_compat_* (7 fields, including evidence -- a real, up-to-6-
    #     item list, the biggest single field found in this pass): only
    #     ever read via the separate GET /api/agents/escrow-compatibility
    #     endpoint, which queries known_agents independently
    #     (_resolve_agent -> get_agent_by_id, no projection) -- confirmed
    #     zero references anywhere in the frontend's marketplace-list
    #     mapping.
    #   owner_bnb_balance_checked_at: read back only by
    #     core/aggregate.py's own separate, minimal-projection query
    #     (line ~277), never through this function's output.
    #   first_seen_at: write-only ($setOnInsert in upsert_agents), never
    #     read back anywhere -- not here, not in aggregate.py, not in the
    #     frontend.
    #   service_http_status / service_error: write-only diagnostic
    #     fields from core/agent_health.py, never read back anywhere.
    #
    # Real, measured impact: at the 15,000-doc cap, raw JSON size dropped
    # from 18.42 MB to 13.06 MB -- a real 29.1% reduction (measured
    # directly against live production data before deploying, not
    # estimated), meaningfully larger than the first pass's ~7.5%.
    #
    # Real, third cap-raise attempt (2026-08-30, same day, this deeper
    # projection now in place), using the SAME rigorous standard the
    # second attempt established (multiple forced refreshes across a
    # real, long watch at every step, not one quick check):
    #   15,000 -- re-confirmed clean (25 min, 5 forced refreshes)
    #   20,000 -- clean (25 min, 5 forced refreshes)
    #   25,000 -- clean (25 min, 5 forced refreshes)
    #   30,000 -- clean (25 min, 5 forced refreshes) -- the exact value
    #             that genuinely oomKilled under the SHALLOWER (4-field)
    #             projection earlier the same day now holds under the
    #             deeper one.
    #
    # Settled at 30,000 -- a real, fully-proven 2x increase over the
    # 15,000 this session's first cap investigation landed on, entirely
    # attributable to the deeper field projection, not a guess or an
    # under-tested ladder. Not pushed further (35k/40k/50k, the values
    # that failed the first attempt) given real time constraints and
    # diminishing returns after four consecutive clean, rigorously-tested
    # steps -- a real, deliberate stopping point, not an assumption that
    # higher values would also fail. Revisit with the same standard if
    # more headroom is ever needed again.
    _EXCLUDE_FIELDS = (
        "category_matched_keywords", "cross_chain_versions", "health_score", "defillama_slug",
        "escrow_compat_checked_at",
        "escrow_compat_evidence", "escrow_compat_external_link",
        "owner_bnb_balance_checked_at", "first_seen_at",
        "service_http_status", "service_error",
    )
    # The four escrow_compat booleans came OFF this exclusion list on
    # 2026-09-10 so the interaction sentence can be decided from them. They
    # are four booleans per document, which is a fraction of what was cut
    # here (escrow_compat_evidence is an array and stays excluded), and they
    # are stripped from the payload again in the loop below: they are read to
    # DECIDE the code and never sent, so the response gains one short code
    # per agent rather than four fields and a sentence.
    _INTERACTION_ONLY_FIELDS = (
        "escrow_compat_incompatible", "escrow_compat_auth_gated",
        "escrow_compat_different_protocol", "escrow_compat_offers_x402",
    )
    # _id is excluded at the query rather than popped after the fact. The
    # loop below pops it anyway because it duplicates `id`, but popping
    # happens after 30,000 ObjectIds have already been allocated; excluding
    # it here means they are never built. Small, but free and provably
    # safe: nothing between the query and the pop reads it.
    projection = {f: 0 for f in _EXCLUDE_FIELDS}
    projection["_id"] = 0

    # THE STORED SELECTION, AND THE FALLBACK THAT MAKES IT SAFE
    #
    # _load_selection returns None on every doubt: no document, a short one,
    # one older than the refresh cadence, one computed against a different
    # store size, or a database that will not answer. Every one of those lands
    # on the full pass, which is what this function did unconditionally
    # before. The cache can save a boot; it cannot empty a grid.
    store_count = await _current_store_count(db)
    keep_ids = await _load_selection(db, limit)
    if keep_ids is None:
        keep_ids = await _select_survivor_ids(db, limit)
        await _store_selection(db, keep_ids, limit, store_count)

    docs = await db.known_agents.find({"id": {"$in": keep_ids}}, projection).to_list(length=limit)

    docs.sort(key=lambda d: (-(d.get("total_score") or 0), str(d.get("id"))))
    # Still applied, and still meaningful: selection uses the same rule, but
    # this stays the single place the guarantee is actually enforced rather
    # than assumed. On a survivor-selected window it is close to a no-op.
    docs = _diversify(docs, per_cluster_cap=READ_CLUSTER_CAP)

    out = []
    for d in docs:
        last_seen = d.get("last_seen_at", "")
        d["possibly_delisted"] = bool(last_seen and last_seen < cutoff_iso)
        d.pop("_id", None)  # _id duplicates the existing 'id' field
        # How a person actually interacts with this agent, as one short code
        # the UI turns into a sentence. Decided here, from the escrow probe
        # results, then those raw fields are dropped so the payload does not
        # carry them.
        d["interaction"] = describe_interaction(
            d,
            budget_chain_ids=BUDGET_HIRE_CHAIN_IDS,
            escrow_chain_ids=ESCROW_HIRE_CHAIN_IDS,
        )
        for f in _INTERACTION_ONLY_FIELDS:
            d.pop(f, None)
        out.append(d)

    # Active agents on top (score desc), possibly-delisted at the bottom.
    out.sort(key=lambda x: (0 if x["possibly_delisted"] else 1, x.get("total_score") or 0), reverse=True)
    return out
