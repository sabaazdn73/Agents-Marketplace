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
_DEFILLAMA_FIELD_GROUP = ["tvl_usd", "defillama_slug", "defillama_url", "financial_data_available"]
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
    query below against anything but a real hex address reaching Mongo)."""
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


async def get_stored_agents(limit: int = 50_000) -> list[dict]:
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
    default cap to 50,000 — comfortably above the current real store size,
    so for the foreseeable future this cap doesn't bind at all. Live-
    confirmed post-fix: returns 10,506 real diversified agents in 5.4s
    (10,837 raw docs fetched in 2.3s, diversify in 3.1s) — a one-time cost
    only paid on cold boot or inside the background refresh, never on a
    warm-cache request."""
    db = get_db()
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)).isoformat()
    docs = await db.known_agents.find({}).sort("total_score", -1).to_list(length=limit)

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
