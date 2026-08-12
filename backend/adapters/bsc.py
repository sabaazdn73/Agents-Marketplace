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
"""

import asyncio
import httpx

MAINNET_CHAIN_ID = 56


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
                    "https://8004scan.io/api/v1/agents",
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
