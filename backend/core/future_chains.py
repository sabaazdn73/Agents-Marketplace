"""
future_chains.py

Background, NOT-YET-DISPLAYED multi-chain agent data collection, for future
multi-chain expansion — real data, stored now, shown nowhere yet.

REAL SEPARATION GUARANTEE (the actual requirement this module exists to
satisfy): this writes to its own MongoDB collection, `future_multichain_agents`
— completely distinct from `known_agents`, the ONLY collection
core/agent_store.py's get_stored_agents() (the function backing the live
GET /api/agents route) ever reads. Nothing in this module is imported by
server.py, aggregate.py, or agent_store.py. No route in server.py exposes
this collection's contents. Grep-checked before considering this done:

    grep -rn "future_multichain_agents" backend/server.py
    grep -rn "future_chains" backend/server.py
    -> zero matches for either (confirmed after writing this module)

Real coverage investigation (2026-08-27, see adapters/multichain_agents.py's
docstring for the full method): 8004scan's registry is EVM-only — sampled
5000 real records with no chain filter, chain_type was "evm" on all of
them, zero Solana records. So this module only fetches Ethereum (chain_id
1) for now; SUPPORTED_CHAINS below is the real, honest, current scope — not
a stub for Solana that would silently store nothing or fabricate empty
records. If 8004scan ever indexes a non-EVM chain, add it here for real,
don't assume support first.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from adapters.multichain_agents import list_chain_agents
from core.practice_layer import get_db

# Real, current 8004scan coverage — see module docstring. Solana isn't
# here on purpose: confirmed absent, not an oversight.
SUPPORTED_CHAINS = {
    1: "Ethereum",
}

_COLLECTION_NAME = "future_multichain_agents"


async def fetch_and_store_chain(
    api_key: str, chain_id: int, max_offset: int = 5000, page_size: int = 100,
) -> dict:
    """Real fetch + store for one chain, completely isolated from the live
    known_agents collection/serving path (see module docstring). Returns a
    real summary dict — no fabricated counts."""
    if chain_id not in SUPPORTED_CHAINS:
        return {"chain_id": chain_id, "error": "not a chain 8004scan's registry actually covers (confirmed EVM-only)"}

    chain_label = SUPPORTED_CHAINS[chain_id]
    raw_agents: list[dict] = []
    offset = 0
    while offset < max_offset:
        page_agents, total, raw_len = await list_chain_agents(
            api_key=api_key, chain_id=chain_id, offset=offset, limit=page_size
        )
        raw_agents.extend(page_agents)
        offset += page_size
        if raw_len < page_size or offset >= total:
            break

    now_iso = datetime.now(timezone.utc).isoformat()
    db = get_db()
    coll = db[_COLLECTION_NAME]

    upserted = 0
    for a in raw_agents:
        aid = a.get("id") or a.get("agent_id")
        if not aid:
            continue
        doc = dict(a)
        doc["_future_multichain_only"] = True  # explicit, unambiguous marker
        doc["source_chain_id"] = chain_id
        doc["source_chain_label"] = chain_label
        doc["fetched_at"] = now_iso
        await coll.update_one({"_id": str(aid)}, {"$set": {**doc, "id": str(aid)}}, upsert=True)
        upserted += 1

    return {
        "chain_id": chain_id,
        "chain_label": chain_label,
        "real_agents_fetched": len(raw_agents),
        "upserted": upserted,
        "collection": _COLLECTION_NAME,
        "fetched_at": now_iso,
    }


async def fetch_and_store_all_supported(api_key: str) -> list[dict]:
    """Runs fetch_and_store_chain for every real, currently-supported chain
    (see SUPPORTED_CHAINS). Sequential, not concurrent — this is a one-off
    background collection task, not something latency-sensitive."""
    results = []
    for chain_id in SUPPORTED_CHAINS:
        result = await fetch_and_store_chain(api_key, chain_id)
        results.append(result)
    return results
