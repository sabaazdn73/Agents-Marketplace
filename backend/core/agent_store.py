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
"""

from datetime import datetime, timezone, timedelta

from core.practice_layer import get_db  # reuse the one shared Mongo client
from core.aggregate import _diversify   # same cluster-cap used at fetch time

STALE_DAYS = 7          # not seen in any refresh for a week => possibly delisted
READ_CLUSTER_CAP = 3    # keep the served list diverse across accumulation


async def upsert_agents(agents: list[dict]) -> dict:
    """Upsert each freshly-fetched agent into `known_agents`, keyed by agent id.
    Updates mutable fields (score, feedback, balance, category, …) in place,
    stamps last_seen_at, records first_seen_at once, and NEVER deletes."""
    db = get_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    coll = db.known_agents
    new_count = 0
    for a in agents:
        aid = a.get("id")
        if not aid or aid == "None":
            continue
        res = await coll.update_one(
            {"_id": aid},
            {"$set": {**a, "last_seen_at": now_iso},
             "$setOnInsert": {"first_seen_at": now_iso}},
            upsert=True,
        )
        if res.upserted_id is not None:
            new_count += 1
    total = await coll.count_documents({})
    return {"seen": len(agents), "new": new_count, "total_known": total, "at": now_iso}


async def get_stored_agents(limit: int = 5000) -> list[dict]:
    """The real serving list: every agent ever seen, re-diversified and with a
    soft `possibly_delisted` flag. Active agents first (highest score first);
    possibly-delisted agents sink to the bottom but are never dropped."""
    db = get_db()
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)).isoformat()
    docs = await db.known_agents.find({}).to_list(length=limit)

    # Highest score first so the per-cluster cap keeps the best representatives.
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
