"""
aggregate.py

The real "make it not fake" function: combines every source built so
far into one clean list of agent records the frontend can render
directly, with no invented numbers.

Every agent record either has REAL data for a field, or that field is
explicitly None/"not reported", never a plausible-looking placeholder.
"""

from dataclasses import dataclass, asdict

from adapters.bsc import list_bsc_agents
from adapters.defillama import fetch_bsc_ai_agent_protocols, try_match_agent_to_protocol
from core.categorize import classify_agent


@dataclass
class MarketplaceAgent:
    # From 8004scan (identity/reputation), real
    id: str
    name: str
    description: str
    owner_address: str
    chain_id: int
    network: str  # "testnet" or "mainnet", derived from chain_id, for honest UI labeling
    total_score: float | None
    star_count: int | None
    total_feedbacks: int | None
    created_at: str | None

    # From categorize.py, deterministic keyword classification
    category: str | None  # one of the 4 required, or None if unclassified
    category_matched_keywords: list[str]

    # From DefiLlama, only present if a real match was found
    financial_data_available: bool
    tvl_usd: float | None
    defillama_slug: str | None
    defillama_url: str | None


async def get_marketplace_agents(
    api_key: str | None = None,
    max_pages: int = 10,
) -> list[MarketplaceAgent]:
    """The real entry point for the frontend. Fetches, cross-references,
    and classifies, doesn't fabricate anything it can't source.

    Reads BOTH testnet AND mainnet agent data, real coverage of the
    whole BNB network. This is safe: reading agent identity/reputation
    is read-only, no wallet, no keys, no financial risk, unlike hiring
    an agent (bsc.py's hire_agent), which stays testnet-only per this
    project's security rules until that's explicitly changed. Reading
    broadly and acting narrowly are two different risk profiles, not
    a contradiction.

    Paginates across up to max_pages (20 agents/page) PER chain rather
    than just page 1, confirmed necessary 8 Aug 2026: a real
    single-page fetch (top 20 by total_score) returned zero category
    matches, the live BSC agent population is large (tens of
    thousands under ERC-8004) and the highest-reputation agents
    aren't necessarily the ones describing themselves in our 4 target
    categories, searching deeper is a real, not cosmetic, improvement.
    """

    raw_agents = []
    for use_mainnet in (False, True):  # testnet first (primary dev target), then mainnet
        for page in range(1, max_pages + 1):
            page_agents = await list_bsc_agents(api_key=api_key, use_mainnet=use_mainnet, page=page)
            if not page_agents:
                break  # ran out of real pages for this chain, stop rather than requesting empty ones
            raw_agents.extend(page_agents)

    try:
        defillama_protocols = await fetch_bsc_ai_agent_protocols()
    except Exception as e:
        print(f"[aggregate] DefiLlama fetch failed, continuing without financial "
              f"enrichment (agents still shown, just without TVL): {e}")
        defillama_protocols = []

    results = []
    for agent in raw_agents:
        name = agent.get("name", "")
        description = agent.get("description", "")

        classification = classify_agent(name, description)
        matched_protocol = try_match_agent_to_protocol(name, defillama_protocols)

        chain_id = agent.get("chain_id")
        results.append(MarketplaceAgent(
            id=str(agent.get("id") or agent.get("agent_id") or agent.get("token_id")),
            name=name,
            description=description,
            owner_address=agent.get("owner_address", ""),
            chain_id=chain_id,
            network="mainnet" if chain_id == 56 else "testnet" if chain_id == 97 else "unknown",
            total_score=agent.get("total_score"),
            star_count=agent.get("star_count"),
            total_feedbacks=agent.get("total_feedbacks"),
            created_at=agent.get("created_at"),
            category=classification.category,
            category_matched_keywords=classification.matched_keywords,
            financial_data_available=matched_protocol is not None,
            tvl_usd=matched_protocol.get("tvl") if matched_protocol else None,
            defillama_slug=matched_protocol.get("slug") if matched_protocol else None,
            defillama_url=matched_protocol.get("url") if matched_protocol else None,
        ))

    return results


async def get_marketplace_agents_as_dicts(**kwargs) -> list[dict]:
    """JSON-serializable version, for the API layer."""
    agents = await get_marketplace_agents(**kwargs)
    return [asdict(a) for a in agents]
