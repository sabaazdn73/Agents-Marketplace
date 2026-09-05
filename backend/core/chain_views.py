"""
chain_views.py

Read-on-demand access to the non-BSC agent data this project already
stores but has never displayed.

Deliberately separate from the BSC serving path. `server.py`'s
`/api/agents` keeps an encoded body of ~15,600 BSC agents in memory for an
hour, and the 30,000-document read behind it is the known cause of this
service's memory ratchet (see scripts/refresh_subprocess.py). Nothing here
touches that cache, and nothing here is cached at all: every call is a
bounded, projected, skip/limit read straight from MongoDB. Adding a chain
view therefore adds no resting memory, only the transient of one page.

Two honesty constraints are enforced in this module rather than left to
the UI, because they are properties of the DATA and belong where the data
is read:

1. `service_status` is never returned for a non-BSC agent. That field is
   computed by core/agent_health.py, which reads ONE hardcoded identity
   registry over ONE BSC RPC and has no per-chain awareness. It produced
   false positives on every other chain, which is why
   core/full_registry_analysis.py was scoped to chain_id 56 and why 8,304
   stale non-BSC values were cleared. The projection below simply does not
   ask for it, so it cannot leak back into a view by accident.

2. Only BSC agents are hireable. ERC-8183 escrow is deployed on BSC only,
   so every non-BSC view reports `hireable: False` and the UI is expected
   to say so rather than offering an action that cannot complete.
"""

from __future__ import annotations

from core.db import get_db
from core.full_registry_ingest import FULL_REGISTRY_COLLECTION
from core.full_registry_analysis import ANALYSIS_CHAIN_IDS

# Chain id -> display name. Kept here so a view definition reads as names
# rather than numbers, and so one place needs editing when a chain is added.
CHAIN_NAMES = {
    56: "BNB Chain",
    1: "Ethereum",
    101: "Solana",
    8453: "Base",
    42161: "Arbitrum",
    42220: "Celo",
    143: "Monad",
    137: "Polygon",
    4663: "Robinhood Chain",
    45056: "Billions Network",
}

# The four views. BNB is declared here for completeness and so the UI can
# render one consistent list of tabs, but it is deliberately NOT served by
# this module: it keeps its existing /api/agents path, untouched.
VIEWS = {
    "bnb": {
        "label": "BNB Chain",
        "chain_ids": [56],
        "hireable": True,
        "coming_soon": False,
        "served_by": "/api/agents",
    },
    "ethereum": {
        "label": "Ethereum",
        "chain_ids": [1],
        "hireable": False,
        "coming_soon": False,
        "served_by": "/api/chain-view/ethereum",
    },
    "solana": {
        # Its own view, marked coming soon. The data exists (1,465 agents
        # ingested) but Solana is not an EVM chain: none of this project's
        # on-chain reads, escrow, or wallet paths apply to it, so listing
        # the agents as if they behaved like the others would overstate
        # what the app can actually do with them.
        "label": "Solana",
        "chain_ids": [101],
        "hireable": False,
        "coming_soon": True,
        "served_by": "/api/chain-view/solana",
    },
    "multichain": {
        # Everything else that has real stored data. Polygon (137) is
        # deliberately absent: it is in CHAIN_NAMES because the Agent0
        # subgraph covers it, but this store currently holds zero Polygon
        # agents, so listing it as a covered chain would be inaccurate.
        "label": "Multi-Chain",
        "chain_ids": [8453, 42161, 42220, 143, 4663, 45056],
        "hireable": False,
        "coming_soon": False,
        "served_by": "/api/chain-view/multichain",
    },
}

# Chain-agnostic fields only. Every one of these is either intrinsic to the
# registration (name, description, ids, owner) or computed by something
# that does not depend on the chain: `category` comes from
# core/categorize.py's name/description classifier, which was confirmed
# chain-agnostic in the audit that cleared the stale statuses.
#
# service_status, service_endpoint, service_checked_at are absent by
# design -- see this module's docstring.
_PROJECTION = {
    "_id": 0,
    "id": 1, "name": 1, "description": 1, "category": 1,
    "chain_id": 1, "token_id": 1, "owner_address": 1,
    "created_at": 1, "total_score": 1, "total_feedbacks": 1,
    "source": 1,
    # Requested, but NOT unconditionally returned -- see _apply_status_policy.
    "service_status": 1, "service_endpoint": 1, "service_checked_at": 1,
}

# Health fields are only meaningful for a chain the chain-aware health check
# has actually been widened to. Everything else keeps the honest thin display.
_HEALTH_FIELDS = ("service_status", "service_endpoint", "service_checked_at")


def _apply_status_policy(doc: dict) -> dict:
    """Keep health fields only for chains in ANALYSIS_CHAIN_IDS; strip them
    otherwise, and say which case this is.

    Applied PER AGENT rather than per view, deliberately: the Multi-Chain
    view mixes chains, and Arbitrum (analysed) sits in the same list as
    Base, Celo and Monad (not yet). A view-level rule would either hide
    Arbitrum's real signals or imply the others had been checked.

    Stripping rather than trusting the stored value is the safe direction.
    Any residue from the old BSC-only pass -- 8,304 such values were
    cleared on 2026-09-05, but the principle should not depend on that
    cleanup having been complete -- cannot reach the UI through here."""
    verified = doc.get("chain_id") in ANALYSIS_CHAIN_IDS
    if not verified:
        for f in _HEALTH_FIELDS:
            doc.pop(f, None)
    doc["status_verified"] = verified
    return doc

MAX_LIMIT = 100


def view_ids() -> list[str]:
    return list(VIEWS.keys())


def get_view(view: str) -> dict | None:
    return VIEWS.get(view)


def describe_views() -> list[dict]:
    """The view list the UI renders its tabs from, with the honesty flags
    attached so the frontend does not have to hardcode them."""
    out = []
    for vid, v in VIEWS.items():
        out.append({
            "id": vid,
            "label": v["label"],
            "chains": [{"chain_id": c, "name": CHAIN_NAMES.get(c, str(c))} for c in v["chain_ids"]],
            "hireable": v["hireable"],
            "coming_soon": v["coming_soon"],
            "served_by": v["served_by"],
        })
    return out


async def count_view(view: str) -> int:
    v = VIEWS.get(view)
    if not v:
        return 0
    col = get_db()[FULL_REGISTRY_COLLECTION]
    return await col.count_documents({"chain_id": {"$in": v["chain_ids"]}})


async def fetch_page(view: str, *, offset: int = 0, limit: int = 24) -> dict:
    """One bounded page. No caching, by design (see module docstring).

    Sorted by total_score descending so a page is a meaningful slice
    rather than insertion order, matching how the BSC list is ordered,
    with `id` as a tiebreaker.

    The tiebreaker is not cosmetic. Sorting on total_score alone is not a
    total order here -- huge numbers of agents share a score -- so MongoDB
    is free to return tied documents in any order, and two skip/limit
    queries can then disagree about which page a given agent falls on.
    Caught in testing: page 1 and page 2 of the multichain view overlapped.
    Adding a unique second key makes the ordering total and the paging
    stable.

    `_id` is excluded in the projection rather than popped afterwards, so
    the ObjectIds are never built."""
    v = VIEWS.get(view)
    if not v:
        raise ValueError(f"Unknown chain view {view!r}. Known: {sorted(VIEWS)}")

    limit = max(1, min(int(limit), MAX_LIMIT))
    offset = max(0, int(offset))

    col = get_db()[FULL_REGISTRY_COLLECTION]
    q = {"chain_id": {"$in": v["chain_ids"]}}
    docs = await (
        col.find(q, _PROJECTION)
        .sort([("total_score", -1), ("id", 1)])
        .skip(offset)
        .limit(limit)
        .to_list(length=limit)
    )
    for d in docs:
        d["chain_name"] = CHAIN_NAMES.get(d.get("chain_id"), str(d.get("chain_id")))
        _apply_status_policy(d)
    return {
        "view": view,
        "label": v["label"],
        "hireable": v["hireable"],
        "coming_soon": v["coming_soon"],
        "offset": offset,
        "limit": limit,
        "agents": docs,
        "has_more": len(docs) == limit,
        # Stated on every page so a caller cannot render these agents as if
        # their liveness had been checked.
        # Which of THIS view's chains have genuinely been health-checked, so
        # the UI can be specific instead of blanket-disclaiming a view that
        # is now partly verified.
        "verified_chains": [
            {"chain_id": c, "name": CHAIN_NAMES.get(c, str(c))}
            for c in v["chain_ids"] if c in ANALYSIS_CHAIN_IDS
        ],
        "unverified_chains": [
            {"chain_id": c, "name": CHAIN_NAMES.get(c, str(c))}
            for c in v["chain_ids"] if c not in ANALYSIS_CHAIN_IDS
        ],
        "status_note": (
            "Live endpoint checks have been extended to some chains but not all. "
            "Agents marked as unverified have not been checked, and no status is "
            "implied for them."
        ),
    }
