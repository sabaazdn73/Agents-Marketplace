"""
multichain_agents.py

Generic (not BSC-specific) real agent listing from 8004scan's registry —
kept in a SEPARATE module from adapters/bsc.py on purpose: bsc.py backs the
live, BSC-only marketplace, and nothing in this file is imported by any
live-serving code path (server.py, aggregate.py, agent_store.py's
get_stored_agents). This exists only for core/future_chains.py's
background, not-yet-displayed multi-chain data collection — see that
module's docstring for the real scope and the real "this must not touch
the live site" guarantee.

Real investigation before writing this (2026-08-27): checked which chains
8004scan's registry actually covers by sampling 5000 real records with no
chainId filter. Real result: chain_type was "evm" on 100% of them — zero
Solana records anywhere (consistent with ERC-8004 being an EVM-only
standard; there is no non-EVM equivalent registry indexed here). Real EVM
chain_ids seen, by volume: 56 (BSC, dominant), 8453 (Base), 2741 (Abstract),
1 (Ethereum mainnet, 62 real agents in the 5000-sample), 42161 (Arbitrum),
196 (X Layer), 100 (Gnosis), plus several real testnets. Also confirmed:
passing chainId as a query param does NOT reliably filter server-side (the
same real gap already documented for chain 56 in adapters/bsc.py) — this
does the same client-side filter that module does.
"""

import asyncio
import httpx

_8004SCAN_BASE = "https://api.8004scan.io"


async def list_chain_agents(
    api_key: str,
    chain_id: int,
    offset: int = 0,
    limit: int = 100,
    max_retries: int = 4,
) -> tuple[list[dict], int, int]:
    """Same real pagination/retry contract as adapters/bsc.py's
    list_bsc_agents, generalized to any real chain_id — returns
    (chain_only_agents, total_reported_by_server, raw_page_len)."""
    headers = {"X-API-Key": api_key}

    last_error = None
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{_8004SCAN_BASE}/api/v1/agents",
                    params={"chainId": chain_id, "offset": offset, "limit": limit},
                    headers=headers,
                )
                resp.raise_for_status()
                body = resp.json()
            break
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < max_retries - 1:
                wait_seconds = 8 * (2 ** attempt)
                last_error = e
                await asyncio.sleep(wait_seconds)
                continue
            raise
    else:
        raise last_error

    all_results = body.get("items", [])
    total = body.get("total", 0)
    chain_only = [a for a in all_results if a.get("chain_id") == chain_id]
    return chain_only, total, len(all_results)
