"""
aggregate.py

The real "make it not fake" function: combines every source built so
far into one clean list of agent records the frontend can render
directly, with no invented numbers.

Every agent record either has REAL data for a field, or that field is
explicitly None/"not reported", never a plausible-looking placeholder.

DIVERSITY (fixed 12 Aug 2026, confirmed against real 8004scan calls):
the live BSC ERC-8004 population is dominated by a few mass-registration
campaigns — in a real 1,014-agent sample, ~68% were the "X.agent on Termix
Platform" template and two other clusters ("Q402 Agent", "Ave.ai Trading
Agent") added ~20% more. Two real causes were making the marketplace show only
one cluster:
  1. The old pagination early-stop compared the CHAIN-FILTERED page length to
     page_size and broke after page 1 (a mixed-chain page is only ~70% BSC, so
     the filtered count is always < page_size) — so only the newest ~one page
     ever loaded, i.e. whatever campaign registered most recently.
  2. No de-duplication, so that tiny newest sample was all one campaign.
We also confirmed 8004scan's only honored sort (`sort_by=total_score`) SILENTLY
DROPS the chainId filter and returns a global, ~0%-BSC list, so it cannot be
used for BSC diversity. The fix therefore is: paginate correctly + deeply
(default order is the only one that returns BSC), then cap how many agents may
share one cluster signature so no single campaign dominates the rendered list.
"""

import asyncio
import re
from collections import Counter
from dataclasses import dataclass, asdict

from adapters.bsc import list_bsc_agents
from adapters.bsc_balance import fetch_owner_bnb_balances
from adapters.defillama import fetch_bsc_ai_agent_protocols, try_match_agent_to_protocol
from core.categorize import classify_agent
from core.pinned_agents import fetch_pinned_agents


@dataclass
class MarketplaceAgent:
    # From 8004scan (identity/reputation), real
    id: str
    token_id: int | None  # the ERC-8004 ERC-721 tokenId — the on-chain agentId
    #                        the AgentAccessMarket contract keys listings on
    name: str
    description: str
    owner_address: str
    owner_ens: str | None
    owner_username: str | None
    image_url: str | None
    chain_id: int
    network: str  # always "mainnet" now (mainnet-only), derived from chain_id, for honest UI labeling
    total_score: float | None
    star_count: int | None
    total_feedbacks: int | None
    created_at: str | None
    is_verified: bool
    x402_supported: bool
    health_score: float | None
    supported_protocols: list | None  # real, from 8004scan; often empty
    cross_chain_versions: list | None  # real mechanism for "same agent identity, other chains"

    # From categorize.py, deterministic keyword classification
    category: str | None  # one of the taxonomy, or None if unclassified
    category_matched_keywords: list[str]

    # From DefiLlama, only present if a real match was found
    financial_data_available: bool
    tvl_usd: float | None
    defillama_slug: str | None
    defillama_url: str | None

    # From a real BSC mainnet RPC read (adapters/bsc_balance.py). A DIFFERENT
    # metric from TVL — the owner wallet's actual native BNB, never conflated
    # with protocol TVL. None if the RPC read was unavailable.
    owner_bnb_balance: float | None


def _cluster_signature(name: str, description: str) -> tuple:
    """Collapses batch-registered clusters. Normalizes the description and
    strips the agent's own name out of it, so 'X.agent on Termix Platform' and
    'Y.agent on Termix Platform' share a signature, and identical-name /
    identical-description clusters (Q402, Ave.ai) collapse too. Falls back to
    the (serial-stripped) name when there is no description.

    Validated against a real 1,014-agent BSC sample: correctly identified the
    'on termix platform' (694), 'gasless stablecoin payment agent' (113) and
    'ai-driven multi-chain trading agent' (105) clusters."""
    name_l = (name or "").strip().lower()
    desc_l = (description or "").strip().lower()
    if name_l:
        desc_l = desc_l.replace(name_l, "")
    desc_l = re.sub(r"\s+", " ", desc_l).strip()
    desc_l = re.sub(r"[#0-9]+", "", desc_l).strip()  # drop serial numbers
    if desc_l:
        return ("desc", desc_l)
    return ("name", re.sub(r"[#0-9]+", "", name_l).strip())


def _diversify(raw_agents: list[dict], per_cluster_cap: int) -> list[dict]:
    """Keeps at most `per_cluster_cap` agents per cluster signature, preserving
    order. This is what stops one mass-registration campaign from filling the
    whole marketplace, while still showing a few real representatives of each."""
    counts: Counter = Counter()
    kept = []
    for a in raw_agents:
        sig = _cluster_signature(a.get("name", ""), a.get("description", ""))
        if counts[sig] >= per_cluster_cap:
            continue
        counts[sig] += 1
        kept.append(a)
    return kept


async def get_marketplace_agents(
    api_key: str,
    max_offset: int = 2000,
    page_size: int = 100,
    per_cluster_cap: int = 3,
    page_delay_seconds: float = 2.0,
) -> list[MarketplaceAgent]:
    """The real entry point for the frontend. Fetches, cross-references,
    classifies, and diversifies — doesn't fabricate anything it can't source.

    Mainnet-only: reads BSC MAINNET (chain 56) agent identity/reputation. This
    is read-only (no wallet, no keys, no financial risk).

    Request budget (free_api tier: 30 req/min, 1000 req/day), shown explicitly:
      pages per refresh   = max_offset / page_size = 2000 / 100 = 20 requests
      + DefiLlama (1) + owner-balance RPC (different host, not on this budget)
      per-minute          = 20 requests × page_delay_seconds(2.0s) ≈ 40s ⇒ ≤30/min ✓
      per-day @ 60min TTL = ≤24 refreshes × ~21 = ~504 req/day ⇒ ≤1000/day ✓ (with
                            headroom for occasional force_refresh + 429 retries)
    Deeper coverage (2000 scanned, ~1,400 BSC after the chain filter) replaces
    the old ~1-page (~15 agent) sample; the cluster cap then diversifies it.
    """

    raw_agents = []
    offset = 0
    while offset < max_offset:
        page_agents, total, raw_len = await list_bsc_agents(
            api_key=api_key, offset=offset, limit=page_size
        )
        raw_agents.extend(page_agents)
        offset += page_size
        # Stop on the REAL end signal: the server returned a short RAW page (not
        # a short chain-FILTERED page — that check was the page-1 bug). Also stop
        # if we've walked past the server's reported total.
        if raw_len < page_size or offset >= total:
            break
        if page_delay_seconds and offset < max_offset:
            await asyncio.sleep(page_delay_seconds)  # respect 30 req/min

    # Real, explicit safety net for agents we know are genuinely real but that
    # 8004scan's own index doesn't return for ANY query (see
    # core/pinned_agents.py's docstring for the real, confirmed investigation
    # — a direct owner_address lookup, which bypasses pagination entirely,
    # still returned nothing for our own explainer agent). Fetched directly
    # on-chain and merged in BEFORE diversify/classify/enrich, so from here on
    # it's treated identically to every other agent. Deduped by token_id in
    # case 8004scan ever does start indexing one of these for real.
    try:
        pinned = await fetch_pinned_agents()
        known_token_ids = {a.get("token_id") for a in raw_agents}
        raw_agents.extend(a for a in pinned if a["token_id"] not in known_token_ids)
    except Exception as e:
        print(f"[aggregate] pinned-agent on-chain fetch failed, continuing without it: {e}")

    # Cap clusters so one mass-registration campaign can't dominate the list.
    raw_agents = _diversify(raw_agents, per_cluster_cap=per_cluster_cap)

    try:
        defillama_protocols = await fetch_bsc_ai_agent_protocols()
    except Exception as e:
        print(f"[aggregate] DefiLlama fetch failed, continuing without financial "
              f"enrichment (agents still shown, just without TVL): {e}")
        defillama_protocols = []

    # Real owner BNB balances (best-effort; a different, honestly-labeled metric
    # from TVL). One de-duped batched RPC read for the whole diversified set.
    try:
        owner_balances = await fetch_owner_bnb_balances(
            [a.get("owner_address", "") for a in raw_agents]
        )
    except Exception as e:
        print(f"[aggregate] owner-balance RPC failed, continuing without it "
              f"(field shown as None): {e}")
        owner_balances = {}

    results = []
    for agent in raw_agents:
        name = agent.get("name", "")
        description = agent.get("description", "")

        classification = classify_agent(name, description)
        matched_protocol = try_match_agent_to_protocol(name, defillama_protocols)

        chain_id = agent.get("chain_id")
        owner_address = agent.get("owner_address", "")
        _tid = agent.get("token_id")
        results.append(MarketplaceAgent(
            id=str(agent.get("id") or agent.get("agent_id") or agent.get("token_id")),
            token_id=int(_tid) if isinstance(_tid, (int, str)) and str(_tid).isdigit() else None,
            name=name,
            description=description,
            owner_address=owner_address,
            owner_ens=agent.get("owner_ens"),
            owner_username=agent.get("owner_username"),
            image_url=agent.get("image_url"),
            chain_id=chain_id,
            network="mainnet" if chain_id == 56 else "unknown",
            total_score=agent.get("total_score"),
            star_count=agent.get("star_count"),
            total_feedbacks=agent.get("total_feedbacks"),
            created_at=agent.get("created_at"),
            is_verified=bool(agent.get("is_verified")),
            x402_supported=bool(agent.get("x402_supported")),
            health_score=agent.get("health_score"),
            supported_protocols=agent.get("supported_protocols"),
            cross_chain_versions=agent.get("cross_chain_versions"),
            category=classification.category,
            category_matched_keywords=classification.matched_keywords,
            financial_data_available=matched_protocol is not None,
            tvl_usd=matched_protocol.get("tvl") if matched_protocol else None,
            defillama_slug=matched_protocol.get("slug") if matched_protocol else None,
            defillama_url=matched_protocol.get("url") if matched_protocol else None,
            owner_bnb_balance=owner_balances.get((owner_address or "").lower()),
        ))

    return results


async def get_marketplace_agents_as_dicts(**kwargs) -> list[dict]:
    """JSON-serializable version, for the API layer."""
    agents = await get_marketplace_agents(**kwargs)
    return [asdict(a) for a in agents]
