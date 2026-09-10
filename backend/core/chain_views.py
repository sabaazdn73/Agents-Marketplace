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

1. `service_status` is returned only for chains the analysis pass has
   actually been widened to, which is ANALYSIS_CHAIN_IDS and nothing else.
   It began as a BSC-only field: core/agent_health.py read ONE hardcoded
   identity registry over ONE BSC RPC with no per-chain awareness, produced
   false positives everywhere else, and 8,304 stale non-BSC values were
   cleared on 2026-09-05. _apply_status_policy strips the field per agent
   rather than trusting what is stored, so a chain that has not been
   analysed cannot show a status even if an old value survived the cleanup.

2. Hireability is per chain AND per path, since 2026-09-10 there are two.
   ERC-8183 escrow hiring is BSC only -- that contract is Altana's and
   exists on chains 56 and 97, and is not ours to deploy. Budget hiring
   works wherever AgentBudgetEscrow is deployed, which is now BSC,
   Arbitrum and Robinhood Chain. A view therefore reports BOTH, and the UI
   is expected to name which one it means rather than showing a single
   "hireable" flag that would be true for one path and false for the other.
"""

from __future__ import annotations

from core.db import get_db
from core.full_registry_ingest import FULL_REGISTRY_COLLECTION
from core.chain_capabilities import summarize_view_capabilities
from core.full_registry_analysis import ANALYSIS_CHAIN_IDS

# Chains where each hire path actually works. Kept as data next to the views
# that report it. BUDGET_HIRE_CHAIN_IDS must stay in step with
# frontend/src/chainContracts.js -- the frontend is what resolves the address,
# this is what the API promises, and they describe the same deployments.
#
# ESCROW_HIRE_CHAIN_IDS deliberately excludes BNB testnet (97): no testnet
# value may be reachable from a production path.
BUDGET_HIRE_CHAIN_IDS = (56, 42161, 4663)
ESCROW_HIRE_CHAIN_IDS = (56,)

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

# The views, in the order the UI renders their tabs. Python preserves
# insertion order and describe_views() iterates this dict, so this is the
# tab order and there is no second list to keep in sync.
#
# BNB is declared here for completeness and so the UI can render one
# consistent list of tabs, but it is deliberately NOT served by this
# module: it keeps its existing /api/agents path, untouched.
#
# Arbitrum and Robinhood Chain were promoted out of Multi-Chain on
# 2026-09-10 and Multi-Chain moved to the end. A chain with its own tab is
# removed from Multi-Chain rather than left in both, so the counts stay
# additive and one agent cannot appear under two tabs.
# No per-view "hireable" flag lives here on purpose. It was removed on
# 2026-09-10 when a second hire path appeared: a single boolean cannot say
# "budget hiring works, escrow hiring does not", and a static copy of a fact
# derived from chain ids is a second source of truth waiting to drift.
# _hire_paths() derives it from chain_ids instead.
VIEWS = {
    "bnb": {
        "label": "BNB Chain",
        "chain_ids": [56],
        "coming_soon": False,
        "served_by": "/api/agents",
    },
    "ethereum": {
        "label": "Ethereum",
        "chain_ids": [1],
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
        "coming_soon": True,
        "served_by": "/api/chain-view/solana",
    },
    "arbitrum": {
        # Its own view because the analysis pass already covers it:
        # 42161 is in ANALYSIS_CHAIN_IDS, so its agents carry a real
        # service_status and _apply_status_policy keeps their health
        # fields rather than stripping them.
        "label": "Arbitrum",
        "chain_ids": [42161],
        "coming_soon": False,
        "served_by": "/api/chain-view/arbitrum",
    },
    "robinhood": {
        # Analysed as of 2026-09-10: 4663 is now in ANALYSIS_CHAIN_IDS and
        # NATIVE_RPC_CHAINS, so its agents carry a real service_status and
        # _apply_status_policy keeps their health fields instead of
        # stripping them. It stays OUT of the explorer list, because this
        # project speaks the Etherscan API and Robinhood Chain publishes a
        # Blockscout instance, so the contract-code signal alone still
        # reports its reason. Nothing here special-cases any of that: the
        # per-agent policy and the capabilities block read the lists.
        #
        # Not marked coming_soon: the agents are real, stored and now
        # checked.
        "label": "Robinhood Chain",
        "chain_ids": [4663],
        "coming_soon": False,
        "served_by": "/api/chain-view/robinhood",
    },
    "multichain": {
        # Everything else that has stored data and no tab of its own.
        # Arbitrum and Robinhood Chain were removed on 2026-09-10 when they
        # got their own views. Polygon (137) is deliberately absent: it is
        # in CHAIN_NAMES because the Agent0 subgraph covers it, but this
        # store currently holds zero Polygon agents, so listing it as a
        # covered chain would be inaccurate.
        "label": "Multi-Chain",
        "chain_ids": [8453, 42220, 143, 45056],
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
    # Added 2026-09-10 so a hireable chain's card can carry the same
    # information BSC's does. Every one of these is stored identically on
    # every chain (checked across 400-agent samples on 56, 42161 and 4663),
    # and none of them is computed by a BSC-specific method, so showing them
    # off BSC is reporting stored registry data rather than implying a check
    # that never ran.
    "star_count": 1, "average_score": 1, "image_url": 1,
    "is_verified": 1, "x402_supported": 1,
    # Requested, but NOT unconditionally returned -- see _apply_status_policy.
    "service_status": 1, "service_endpoint": 1, "service_checked_at": 1,
}

# Health fields are only meaningful for a chain the chain-aware health check
# has actually been widened to. Everything else keeps the thin display.
_HEALTH_FIELDS = ("service_status", "service_endpoint", "service_checked_at")


def _hire_paths(chain_ids: list[int]) -> dict:
    """Which hire paths work for this view, named per chain.

    Derived from the chain ids rather than read from the view's own static
    flag, so a view cannot claim a path its chains do not support. Both paths
    are always reported, including the one that does NOT work and why, because
    the UI's job here is to say which is which rather than to show a single
    yes/no that is true for one path and false for the other."""
    budget = [c for c in chain_ids if c in BUDGET_HIRE_CHAIN_IDS]
    escrow = [c for c in chain_ids if c in ESCROW_HIRE_CHAIN_IDS]
    def names(cs):
        return [{"chain_id": c, "name": CHAIN_NAMES.get(c, str(c))} for c in cs]
    return {
        "budget": {
            "available": bool(budget),
            "chains": names(budget),
            "contract": "AgentBudgetEscrow",
            "note": (
                "A client funds a budget and the agent draws against it as it "
                "works. Available wherever AgentBudgetEscrow is deployed."
            ),
        },
        "escrow": {
            "available": bool(escrow),
            "chains": names(escrow),
            "contract": "ERC-8183 AgenticCommerce",
            "note": (
                "Payment is locked and released on delivery. The ERC-8183 "
                "contract is Altana's and is deployed on BNB Chain only, so "
                "this path is not available on other chains."
            ),
        },
        "any": bool(budget or escrow),
    }


def _capabilities_with_names(chain_ids: list[int]) -> dict:
    """summarize_view_capabilities plus human chain names, so the UI can
    name the chains a partial signal is missing on."""
    cap = summarize_view_capabilities(chain_ids)
    for sig in cap["signals"]:
        sig["missing_chains"] = [
            {"chain_id": c, "name": CHAIN_NAMES.get(c, str(c))}
            for c in sig.get("missing_chain_ids", [])
        ]
    return cap


def _apply_status_policy(doc: dict) -> dict:
    """Keep health fields only for chains in ANALYSIS_CHAIN_IDS; strip them
    otherwise, and say which case this is.

    Applied PER AGENT rather than per view, deliberately: Multi-Chain still
    mixes chains, and Base (analysed) sits in the same list as Celo, Monad
    and Billions Network (not yet). A view-level rule would either hide
    Base's signals or imply the others had been checked. Arbitrum was in
    that same position until it was given its own view on 2026-09-10, and
    the next chain promoted will be too, so the per-agent rule stays.

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
            "hireable": _hire_paths(v["chain_ids"])["any"],
            "hire_paths": _hire_paths(v["chain_ids"]),
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
    # Total for this view, so the UI can show numbered pages rather than an
    # open-ended "load more". Counted per request: these views are not cached
    # and the count is a covered index lookup on chain_id.
    total = await col.count_documents(q)

    return {
        "view": view,
        "label": v["label"],
        "total": total,
        "hireable": _hire_paths(v["chain_ids"])["any"],
        "hire_paths": _hire_paths(v["chain_ids"]),
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
        # Which evaluation signals this view can genuinely show, and for
        # each one it cannot, the reason. Sent with the view rather
        # than hardcoded in the UI so the frontend cannot claim a signal
        # the data layer has no way to produce -- and so an absence reads
        # as an explanation instead of as an empty space. Chain names are
        # attached here because the UI should be able to say WHICH chains
        # a partial signal is missing on without knowing the chain table.
        "capabilities": _capabilities_with_names(v["chain_ids"]),
        "status_note": (
            "Live endpoint checks have been extended to some chains but not all. "
            "Agents marked as unverified have not been checked, and no status is "
            "implied for them."
        ),
    }
