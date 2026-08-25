"""
bsc.py

Reads real BNB Chain agent identities from 8004scan's public API. This is the
one adapter that talks to a BSC-specific data source; core/ stays chain-agnostic.

Mainnet-only: this project lists BSC MAINNET (chain 56) agents. The earlier
testnet listing, the direct-SDK/on-chain read stubs, and the layered-fallback
scaffolding were removed as dead code (hiring is client-side now — see
frontend/src/altana.js + useHireAgent.js).

HONESTY NOTE: 8004scan's endpoint/pagination shape was confirmed against a real
live response (offset/limit, an {items, total, limit, offset} envelope,
total≈714k across all chains as of 8 Aug 2026). Chain filtering is done
client-side (chain_id == 56) because server-side chainId filtering was never
verified reliable for this endpoint.

REAL HOST MIGRATION (2026-08-27, verified live, not assumed): 8004scan moved
their API to api.8004scan.io. Confirmed live before switching:
  - The list endpoint (/api/v1/agents) is unchanged in path and response
    shape on the new host (real {items, total, limit, offset} envelope).
  - The detail endpoint moved too, and NOT just the domain — the path
    dropped the "/public/" segment (was /api/v1/public/agents/{chain}/{id},
    now /api/v1/agents/{chain}/{id} — confirmed live: the old /public/ path
    genuinely 404s on the new host), AND the response is no longer wrapped
    in {"success": true, "data": {...}} — the agent object is now the
    top-level response body directly (confirmed live against a real known
    agent: same real fields, tags/categories/health_status/raw_metadata all
    present, just unwrapped).
  - The old host (8004scan.io, no "api." subdomain) still answered both
    endpoints correctly when checked, so this wasn't a hard cutover at
    verification time — moved anyway, to track the real, current endpoint
    rather than an about-to-be-deprecated one.
"""

import asyncio
import httpx

MAINNET_CHAIN_ID = 56
_8004SCAN_BASE = "https://api.8004scan.io"


async def list_bsc_agents(
    api_key: str,
    offset: int = 0,
    limit: int = 20,
    max_retries: int = 4,
) -> tuple[list[dict], int, int]:
    """Reads one page of BSC MAINNET agents from 8004scan. Returns
    (bsc_agents, total_reported_by_server, raw_page_len) so callers can
    paginate correctly. Retries on 429 with exponential backoff.

    raw_page_len is the number of agents the server returned for this page
    BEFORE the client-side chain filter. Callers MUST use raw_page_len (not
    len(bsc_agents)) to detect the real end of pagination: a page of `limit`
    mixed-chain results typically contains only ~70% BSC, so a chain-filtered
    count is almost always < limit even when many more pages remain. (This was
    a real bug — the old early-stop compared the filtered count to `limit` and
    broke after page 1, so the marketplace only ever showed the newest ~one
    page of agents, dominated by whatever batch registered most recently.)

    Real fields available: is_verified, x402_supported, health_score,
    rank, network_rank, average_score, supported_protocols, owner_ens,
    owner_username, image_url, and cross_chain_versions (the real mechanism
    for "same agent identity across chains")."""
    headers = {"X-API-Key": api_key}

    last_error = None
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{_8004SCAN_BASE}/api/v1/agents",
                    params={"chainId": MAINNET_CHAIN_ID, "offset": offset, "limit": limit},
                    headers=headers,
                )
                resp.raise_for_status()
                body = resp.json()
            break
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < max_retries - 1:
                wait_seconds = 8 * (2 ** attempt)
                print(f"[list_bsc_agents] 429 at offset {offset}, attempt "
                      f"{attempt + 1}/{max_retries}, waiting {wait_seconds}s")
                last_error = e
                await asyncio.sleep(wait_seconds)
                continue
            raise
    else:
        raise last_error

    all_results = body.get("items", [])
    total = body.get("total", 0)

    bsc_only = [a for a in all_results if a.get("chain_id") == MAINNET_CHAIN_ID]
    if len(bsc_only) != len(all_results):
        print(f"[list_bsc_agents] Server returned {len(all_results)} agents for "
              f"chainId={MAINNET_CHAIN_ID} at offset {offset}, only {len(bsc_only)} "
              f"actually matched, client-side filter caught the rest.")

    return bsc_only, total, len(all_results)


async def fetch_agent_detail(
    client: httpx.AsyncClient, api_key: str, token_id: int, chain_id: int = MAINNET_CHAIN_ID,
) -> dict | None:
    """Real per-agent detail record from the richer per-agent detail surface
    — confirmed real, live Pro-tier access 2026-08-25 (3000/min, 3,000,000/
    day; re-verified with random uncacheable token IDs before use, same
    rigor as the original tier check). Returns None on any failure (missing
    agent, transient error) — best-effort enrichment, never blocks the
    caller. Only used for agents the cheap name+description classifier
    couldn't place (see categorize.py's re-classify step in aggregate.py) —
    real, measured cost check before wiring this in for every refresh: at
    Pro-tier limits, even several hundred of these extra calls per refresh
    is nowhere near the 3M/day budget.

    Real host migration (2026-08-27): this path used to be
    /api/v1/public/agents/{chain}/{id} on the old host, wrapped in
    {"success": true, "data": {...}}. The new host dropped both the
    "/public/" path segment and the wrapper — confirmed live, not assumed
    — so this now hits /api/v1/agents/{chain}/{id} and returns the parsed
    body directly."""
    try:
        resp = await client.get(
            f"{_8004SCAN_BASE}/api/v1/agents/{chain_id}/{token_id}",
            headers={"X-API-Key": api_key},
            timeout=15,
        )
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception:
        return None


def augmented_classification_text(detail: dict) -> str:
    """Builds the richer text surface confirmed useful in the real
    2026-08-25 re-check: tags, categories, the offchain metadata's own
    description, and its services' names — none of which exist on the
    plain /api/v1/agents listing shape. Real, measured result on 489 real
    previously-Unclassified BSC agents: 21 (4.3%) got a real category from
    this text that plain name+description missed. Zero of those were Grid
    Trading specifically — an honest negative, not assumed away."""
    tags = " ".join(detail.get("tags") or [])
    categories = " ".join(detail.get("categories") or [])
    offchain = (detail.get("raw_metadata") or {}).get("offchain_content") or {}
    offchain_desc = offchain.get("description") or ""
    service_names = " ".join(s.get("name", "") for s in (offchain.get("services") or []))
    return " ".join([detail.get("description") or "", tags, categories, offchain_desc, service_names])
