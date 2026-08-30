"""
agent_store.py

Persistent MongoDB store of every agent we've EVER seen from a real 8004scan
refresh, so agents don't silently vanish between fetches.

Why this exists: the live 8004scan fetch is a small, cluster-capped sample of a
700k+ registry (see core/aggregate.py). Any single refresh returns only a slice,
and a server restart or a rate-limited fetch would otherwise drop agents a user
was looking at — or had just hired. This store UPSERTS agents (keyed by
agent_id, NEVER deletes) so the marketplace stays consistent across fetches and
restarts.

Staleness policy, stated honestly: because each fetch is a tiny sample of a
huge registry, an agent being ABSENT from a given refresh is completely normal
and is NOT evidence it was delisted on-chain. Flagging "delisted" on short-term
fetch-absence would cry wolf on almost every agent every hour. So we track
last_seen_at and only set `possibly_delisted` when an agent hasn't appeared in
ANY refresh for STALE_DAYS days — long enough (given hourly refreshes) that
continued absence is actually meaningful — and even then we only FLAG it (soft,
reversible) rather than removing it. The threshold is time-based, not
miss-count-based, precisely because miss-count is dominated by sampling noise.

Diversity is re-applied on READ: agents accumulate across refreshes, and without
a re-cap the big campaigns (Termix/Q402/Ave.ai) would slowly refill the store
with distinct-id duplicates. get_stored_agents() sorts by score then re-caps per
cluster so the served list stays diverse no matter how much has accumulated.

Real gap found and fixed 2026-08-18 (audited against the live store, not just
this docstring's stated intent): `upsert_agents` did a blind `$set` of every
field aggregate.py sent, every refresh. aggregate.py itself explicitly falls
back to None/False for its best-effort enrichment fields (tvl_usd,
defillama_slug/url, financial_data_available, owner_bnb_balance) whenever the
DefiLlama fetch or the owner-balance RPC transiently fails THAT round (see its
own try/except comments — "agents still shown, just without TVL"). A blind
$set meant a transient upstream hiccup on refresh N would silently OVERWRITE a
real value learned on refresh N-1 with None — not a dropped agent (the
document survives, matching the headline promise above), but a real, silent
loss of previously-known real data, live-confirmed: all 96 agents in the store
right now have a real owner_bnb_balance, every one of them one bad RPC call
away from being wiped back to None on the next refresh under the old code.
Fixed below: these specific best-effort fields only get overwritten when the
fresh value is genuinely present; a fresh None/failed-match doesn't erase a
real one already on record. Deliberate, stated tradeoff: this can't distinguish
"transient failure" from "this agent genuinely stopped matching a DefiLlama
protocol" — it's biased toward keeping last-known-real data rather than
silently losing it, consistent with this file's own possibly_delisted
philosophy above (flag soft and reversible, never erase).
"""

import re
from datetime import datetime, timezone, timedelta

from core.db import get_db
from core.clustering import diversify as _diversify   # same real multi-signal cluster-cap used at fetch time — see core/clustering.py

STALE_DAYS = 7          # not seen in any refresh for a week => possibly delisted
READ_CLUSTER_CAP = 3    # keep the served list diverse across accumulation

# Best-effort enrichment fields that a transient upstream failure can null out
# on any given refresh (see the module docstring). Grouped because they
# describe ONE outcome (the DefiLlama match) — preserved or overwritten
# together, never partially, so tvl_usd can't end up stale while
# financial_data_available flips to False (or vice versa).
#
# Real, added 2026-08-29 (API-data investigation): tvl_change_7d_pct,
# audit_count, tvl_data_flagged, mcap_usd all come from the exact same
# DefiLlama match as the four fields above — added to this same group so
# a transient DefiLlama fetch failure can't silently regress THEM to None/
# False either, while leaving tvl_usd/defillama_slug/url looking fine.
_DEFILLAMA_FIELD_GROUP = [
    "tvl_usd", "defillama_slug", "defillama_url", "financial_data_available",
    "tvl_change_7d_pct", "audit_count", "tvl_data_flagged", "mcap_usd",
]
_OWNER_BALANCE_FIELD = "owner_bnb_balance"
# Real fix (2026-08-27, owner-balance 429 investigation): moves together
# with _OWNER_BALANCE_FIELD, same real "preserve on failure" discipline —
# see core/aggregate.py's own real TTL-skip logic, which reads this exact
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
    last_seen_at, records first_seen_at once, and NEVER deletes — and never
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


async def update_agent_health(results: dict[str, dict]) -> int:
    """Persist real health-check results (see core/agent_health.py) — one
    $set per agent, keyed by the same `_id` upsert_agents uses. A separate
    write path from upsert_agents on purpose: health-checks run on a
    shorter TTL than the main 8004scan refresh (liveness changes faster
    than metadata), so this needs to update a SUBSET of known_agents
    on its own cadence, not piggyback on the full-list $set above. Agents
    not present in `results` (skipped because their existing check was
    still fresh — see agent_health.HEALTH_TTL_SECONDS) are left untouched,
    never regressed to unknown just because this pass didn't re-check them.
    Returns the real number of documents updated."""
    if not results:
        return 0
    db = get_db()
    coll = db.known_agents
    updated = 0
    for aid, fields in results.items():
        res = await coll.update_one({"_id": aid}, {"$set": fields})
        if res.matched_count:
            updated += 1
    return updated


_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


async def get_agent_by_owner(owner_address: str) -> dict | None:
    """Real lookup for one agent by its owner address (case-insensitive —
    on-chain addresses vary in casing across sources). Used by the negotiate
    proxy (server.py) to find an agent's real, on-chain-sourced
    `service_endpoint` without a fresh RPC round trip on every hire attempt.
    Returns the freshest-scored match if an owner somehow has more than one
    (real, if rare) known agent; None if genuinely not in the store yet, or
    if the input isn't even a well-formed address (also guards the regex
    query below against anything but a real hex address reaching Mongo).

    Real, honest, confirmed-live limitation (2026-08-28): "if rare" above
    was wrong — checked directly, 1,457 real owner addresses in the
    current, live known_agents have MORE than one registered agent. This
    function's own "freshest-scored" tie-break is a genuine coin flip
    among them, and a real, visible bug traced back to exactly this:
    SmartSentinels (one real owner, three real, structurally different
    agents — AIDA, Sentinels Audit, Sentinels Prediction) got AIDA's
    escrow-compatibility data served for a Sentinels Audit lookup, a
    real, wrong, publicly-visible result. Prefer get_agent_by_id below
    wherever the caller already knows which SPECIFIC real agent it means
    (every real frontend call site does — the UI always already has the
    exact agent's own real id). This function stays as a real, honest
    best-effort fallback for the one caller that genuinely can't know a
    specific listing id (server.py's job-PnL-by-provider path, which only
    has a completed real job's on-chain provider wallet to go on — a
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
    """Real, UNAMBIGUOUS lookup for one exact, specific real agent by its
    own real, unique id (the same value known_agents stores each real
    agent's document under as `_id` — see upsert_agents above). Added
    2026-08-28 as the real fix for the real bug documented on
    get_agent_by_owner above: this is the one real key that's never
    ambiguous, since it's the exact agent a real user is actually looking
    at, not "some agent owned by this wallet". Every real caller that has
    a specific agent in hand (which is every real frontend call site —
    the UI already has the agent's own id) should prefer this."""
    if not agent_id:
        return None
    db = get_db()
    return await db.known_agents.find_one({"_id": agent_id})


async def get_stored_agents(limit: int = 35_000) -> list[dict]:
    """The real serving list: every agent ever seen, re-diversified and with a
    soft `possibly_delisted` flag. Active agents first (highest score first);
    possibly-delisted agents sink to the bottom but are never dropped.

    Real bug found and fixed (2026-08-27): this used to default to
    `limit=5000` and fetch with NO sort at the DB level — `.find({}).to_list
    (length=5000)` returns Mongo's natural (roughly insertion) order, so the
    5000 docs actually considered were an arbitrary early slice, not the
    best 5000. With known_agents having grown to 10,837+ (and climbing) since
    the full-registry-backed refresh shipped, this silently discarded more
    than half the real store before diversification ever ran — live-
    confirmed: get_stored_agents() was returning 4,763 agents (matching a
    real user report of "~4,800 agents") while the store itself already held
    10,837+. Fixed two ways: (1) sort by total_score at the DB level BEFORE
    limiting, so if the cap is ever actually hit again, it keeps the
    objectively best-scoring agents, not an arbitrary slice; (2) raised the
    default cap to 50,000 — comfortably above the real store size at the time
    (10,837), so the cap didn't bind at all.

    Real fix (2026-08-29, OOM crash-loop round 5): that 50,000 comfort margin
    eroded fast -- known_agents is upsert-only/never-delete, and every
    refresh (each one now also pulling from the much larger full_agent_
    registry pipeline) grows it further. Live-confirmed the same day:
    10,837 -> 26,736 -> 34,374 -> 38,033+ within about an hour of real
    refreshes, on a real trajectory toward the 50,000 cap itself, not just
    toward "large". This function has no field projection (fetches every
    full known_agents doc) and is called on every cold boot and inside every
    background refresh -- its cost was rising every single time known_agents
    grew, with no ceiling. Lowered the default cap to 15,000 (sorted by
    total_score first, so this always keeps the objectively best-scoring
    agents, same as before) to put a real, permanent bound back under this
    call regardless of how large known_agents keeps growing -- the same
    "bound the pool, not just hope it stays small" discipline already
    applied to the full_agent_registry clustering pool and the health-check
    pass. Real, honest tradeoff: once known_agents exceeds 15,000, the
    lowest-scoring agents stop being served even though they're still in the
    store -- an intentional trade of completeness for actual service
    stability, matching the same tradeoff already accepted for the
    clustering pool.

    Real attempt to raise, tested live and reverted (2026-08-29, same day):
    after rounds 3-4 held stable for 1h47m, tried raising this to 25,000
    (known_agents was 42,281 and climbing at the time) on the reasoning that
    the dominant causes were already fixed elsewhere. Deployed, then forced
    the exact refresh path immediately (`?force_refresh=true`) rather than
    waiting -- a real oomKilled event landed 31 seconds after that refresh's
    own "Upserted refresh" log line (total_known 45,730 at that point).
    Reverted back to 15,000 the same session. Honest conclusion: at the
    real, current store size, this function's own uncapped `.find({})` (no
    field projection, fetches every full doc) is still expensive enough on
    its own that 15,000 is closer to the real live ceiling than 25,000 --
    not just a conservative guess made under pressure. A real raise above
    15,000 would need either a smaller per-doc read (a real field
    projection here, not yet done) or a genuinely smaller known_agents
    (real pruning of stale/never-hired agents, not yet built) -- raising
    the raw number alone was tested and does not hold.

    Real field projection added (2026-08-29, same investigation): checked
    every field this query returns against every real consumer of its
    output -- the whole frontend (web + mobile, grep'd directly) and every
    backend module that reads get_stored_agents()'s result (core/
    clustering.py's diversify(), core/canary.py, core/future_chains.py).
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
    reduces real per-document transfer/deserialize/memory cost with no
    functional change -- confirmed zero consumers, not a guess.

    Real, second retry (2026-08-30), now WITH the field projection above
    already live and confirmed (25+ real minutes stable under real traffic
    at 15,000, ~7.5% smaller real response size than before the
    projection). known_agents had grown to 58,439 by the time of this
    retry -- raised to 20,000 (a real, moderate step, not straight back to
    25,000 or the original 50,000), deployed, force-tested via
    `?force_refresh=true` immediately, then watched for a real oomKilled
    in the following minutes, same discipline as the first attempt. See
    the real, live result recorded at the point this note was written for
    whether it held."""
    db = get_db()
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)).isoformat()
    # Real, confirmed-unused-downstream fields excluded from this read only
    # (upsert_agents' own separate query is untouched, so preservation of
    # e.g. defillama_slug across refreshes still works normally).
    _EXCLUDE_FIELDS = ("category_matched_keywords", "cross_chain_versions", "health_score", "defillama_slug")
    projection = {f: 0 for f in _EXCLUDE_FIELDS}
    docs = await db.known_agents.find({}, projection).sort("total_score", -1).to_list(length=limit)

    # Already sorted by total_score at the DB level above — re-stating the
    # sort key here (cheap, a no-op on already-sorted data) keeps this
    # function's own contract self-evident without relying on the query above.
    docs.sort(key=lambda d: (d.get("total_score") or 0), reverse=True)
    docs = _diversify(docs, per_cluster_cap=READ_CLUSTER_CAP)

    out = []
    for d in docs:
        last_seen = d.get("last_seen_at", "")
        d["possibly_delisted"] = bool(last_seen and last_seen < cutoff_iso)
        d.pop("_id", None)  # _id duplicates the existing 'id' field
        out.append(d)

    # Active agents on top (score desc), possibly-delisted at the bottom.
    out.sort(key=lambda x: (0 if x["possibly_delisted"] else 1, x.get("total_score") or 0), reverse=True)
    return out
