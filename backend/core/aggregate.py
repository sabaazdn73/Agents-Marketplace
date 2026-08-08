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
    is_verified: bool
    x402_supported: bool
    health_score: float | None
    cross_chain_versions: list | None  # real mechanism for "same agent identity, other chains"

    # From categorize.py, deterministic keyword classification
    category: str | None  # one of the 4 required, or None if unclassified
    category_matched_keywords: list[str]

    # From DefiLlama, only present if a real match was found
    financial_data_available: bool
    tvl_usd: float | None
    defillama_slug: str | None
    defillama_url: str | None


async def get_marketplace_agents(
    api_key: str,
    max_offset: int = 200,
    page_size: int = 20,
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

    Paginates via offset (0, 20, 40, ... up to max_offset) PER chain,
    matching the real /api/v1/agents endpoint's pagination style
    (confirmed 8 Aug 2026, total=714397 across all chains). Stops
    early if a page comes back short (fewer than page_size results),
    the real signal that pagination has reached the end for that chain.
    """

    raw_agents = []
    for use_mainnet in (False, True):  # testnet first (primary dev target), then mainnet
        offset = 0
        while offset < max_offset:
            page_agents, total = await list_bsc_agents(
                api_key=api_key, use_mainnet=use_mainnet, offset=offset, limit=page_size
            )
            raw_agents.extend(page_agents)
            offset += page_size
            if len(page_agents) < page_size:
                break  # short page = no more real results for this chain

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
            is_verified=bool(agent.get("is_verified")),
            x402_supported=bool(agent.get("x402_supported")),
            health_score=agent.get("health_score"),
            cross_chain_versions=agent.get("cross_chain_versions"),
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
