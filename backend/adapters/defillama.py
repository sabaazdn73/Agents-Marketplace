"""
defillama.py

Chain-agnostic-by-nature (DefiLlama covers 350+ chains), but used here
specifically to enrich BSC agent listings with REAL financial data
(TVL) that 8004scan simply doesn't have. Confirmed real, stable,
free, no-auth API (cross-checked against multiple independent live
integrations, not a single guess): https://api.llama.fi/protocols

IMPORTANT HONEST LIMITATION: DefiLlama tracks AI-agent-branded DeFi
PROTOCOLS (real financial products with real TVL), a different
population from individually-registered ERC-8004 agent identities.
Most 8004scan-registered agents are small/experimental and will NOT
have a DefiLlama match, that's an accurate reflection of reality, not
a bug, don't force a match where none exists.
"""

import httpx

DEFILLAMA_PROTOCOLS_URL = "https://api.llama.fi/protocols"

# The exact string DefiLlama uses for this category wasn't confirmed
# against a live call (only the URL slug /protocols/ai-agents was
# seen, not the raw category field value), check both common
# capitalizations rather than assuming one, and log if this needs
# expanding once you can see a real response.
_AI_AGENT_CATEGORY_CANDIDATES = {"ai agent", "ai agents"}


async def fetch_bsc_ai_agent_protocols() -> list[dict]:
    """Real financial data for AI-agent-category protocols active on
    BSC. Returns DefiLlama's own protocol dicts (name, slug, tvl,
    chains, category, url, description, ...), unmodified, so callers
    can see exactly what DefiLlama reports rather than a reshaped
    version that could hide a schema surprise.

    FIXED 8 Aug 2026: confirmed via a real, direct fetch of
    api.llama.fi/protocols that DefiLlama's actual chain name is
    "Binance" (e.g. PancakeSwap AMM and Venus Core Pool both list
    "Binance" exactly in their chains array), NOT "BSC" or "BNB" as a
    substring, the original filter checking for those would have
    silently matched zero BSC protocols despite the code looking
    reasonable."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(DEFILLAMA_PROTOCOLS_URL)
        resp.raise_for_status()
        all_protocols = resp.json()

    matched = [
        p for p in all_protocols
        if p.get("category", "").strip().lower() in _AI_AGENT_CATEGORY_CANDIDATES
        and "binance" in [str(c).lower() for c in p.get("chains", [])]
    ]
    return matched


def try_match_agent_to_protocol(agent_name: str, protocols: list[dict]) -> dict | None:
    """Best-effort name match between an 8004scan agent and a
    DefiLlama protocol. Deliberately simple (case-insensitive
    substring), and deliberately returns None rather than a weak
    guess when nothing matches, most agents legitimately won't."""
    name_lower = agent_name.strip().lower()
    for p in protocols:
        p_name = p.get("name", "").strip().lower()
        if p_name and (p_name in name_lower or name_lower in p_name):
            return p
    return None
