"""
pinned_agents.py

A small, explicit list of on-chain-verified agent token_ids that MUST always
appear in the marketplace, fetched directly from the chain (ownerOf() +
tokenURI() on the ERC-8004 identity registry) rather than through 8004scan's
own index.

Real, confirmed reason this exists (2026-08-21): our own explainer agent
(token_id 270213, owner 0x08cef8b3ec5d33529dfe6700ccbffc97158cb5dd) is
genuinely real and registered on BSC mainnet — confirmed live via a real
ownerOf() call (returned that exact address) and a decodable tokenURI() —
but 8004scan's own /api/v1/agents never returns it for ANY query tried:
owner_address filter with chainId, without chainId, lowercase, and mixed
case — all real 200s with total:0. This is NOT our max_offset=2000
pagination window missing it (a real, separate, worth-knowing limitation of
the sampled fetch — see aggregate.py's own docstring); a direct owner_address
lookup bypasses pagination entirely and still returned nothing. This means
8004scan's OWN index has never ingested this specific registration, for
reasons outside our visibility (maybe an indexer gap, maybe it only crawls
certain registrar paths — we can't tell from the outside). Since we always
fetch agents THROUGH 8004scan's API, no pagination or sort-order fix on our
side can ever surface an agent 8004scan itself doesn't have on record.

The only real fix for an agent we specifically know is genuine: read it
directly from the chain, bypassing 8004scan entirely for just this handful
of agents, and merge the result into the same aggregate.py pipeline
(classify/diversify/enrich) as everything else, so it's indistinguishable
from a normal listing once it's in.

Real trade-off, stated honestly: because 8004scan never indexed this agent,
its REPUTATION fields (total_score, star_count, total_feedbacks, is_verified,
x402_supported, ...) are genuinely unknown to us too — left None/False below,
never fabricated. Only what we can actually read from the chain (name,
description, image, owner_address) is populated.
"""

from __future__ import annotations

import httpx
from eth_abi import decode as abi_decode
from eth_utils import function_signature_to_4byte_selector

from core.agent_health import IDENTITY_REGISTRY, _fetch_metadata, _tokenuri_calldata, _rpc_url

# Real, on-chain-confirmed agents that 8004scan's own index has never
# returned for any query (see module docstring). Add a token_id here only
# after directly confirming (ownerOf + tokenURI) it's real — never
# speculatively, and never anything we can't independently verify on-chain.
PINNED_TOKEN_IDS = [
    270213,  # our own explainer-agent, registered on BSC mainnet
]

_OWNEROF_SEL = function_signature_to_4byte_selector("ownerOf(uint256)")


async def _owner_of(client: httpx.AsyncClient, token_id: int) -> str | None:
    data = "0x" + _OWNEROF_SEL.hex() + token_id.to_bytes(32, "big").hex()
    resp = await client.post(_rpc_url(), json={
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{"to": IDENTITY_REGISTRY, "data": data}, "latest"],
    })
    resp.raise_for_status()
    body = resp.json()
    if body.get("error") or not body.get("result") or body["result"] == "0x":
        return None
    (owner,) = abi_decode(["address"], bytes.fromhex(body["result"][2:]))
    return owner


async def _token_uri(client: httpx.AsyncClient, token_id: int) -> str | None:
    data = "0x" + _tokenuri_calldata(token_id).hex()
    resp = await client.post(_rpc_url(), json={
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{"to": IDENTITY_REGISTRY, "data": data}, "latest"],
    })
    resp.raise_for_status()
    body = resp.json()
    if body.get("error") or not body.get("result") or body["result"] == "0x":
        return None
    (uri,) = abi_decode(["string"], bytes.fromhex(body["result"][2:]))
    return uri


async def fetch_pinned_agents() -> list[dict]:
    """Real, direct on-chain read for each PINNED_TOKEN_IDS entry, shaped to
    slot into aggregate.py's normal raw_agents pipeline (the same keys
    get_marketplace_agents() already reads off a raw 8004scan record) so
    classification/diversity/enrichment all just work, unchanged. Best-effort
    per agent — one bad RPC read doesn't take down the others or the refresh
    that calls this."""
    if not PINNED_TOKEN_IDS:
        return []
    out = []
    async with httpx.AsyncClient(timeout=15) as client:
        for token_id in PINNED_TOKEN_IDS:
            try:
                owner = await _owner_of(client, token_id)
                uri = await _token_uri(client, token_id)
                if not owner or not uri:
                    print(f"[pinned_agents] token {token_id}: no real owner/tokenURI on-chain, skipping")
                    continue
                meta = await _fetch_metadata(uri, client)
                out.append({
                    "id": f"onchain-56-{token_id}",  # stable, distinct from 8004scan's uuid ids
                    "token_id": token_id,
                    "name": meta.get("name") or f"Agent #{token_id}",
                    "description": meta.get("description") or "",
                    "owner_address": owner,
                    "owner_ens": None,
                    "owner_username": None,
                    "image_url": meta.get("image") or None,
                    "chain_id": 56,
                    # Honest gap: 8004scan never indexed this agent (see
                    # module docstring), so its reputation fields are
                    # genuinely unknown to us, not fabricated as zero/false.
                    "total_score": None,
                    "star_count": None,
                    "total_feedbacks": None,
                    "created_at": None,
                    "is_verified": False,
                    "x402_supported": False,
                    "health_score": None,
                    "supported_protocols": None,
                    "cross_chain_versions": None,
                })
            except Exception as e:
                print(f"[pinned_agents] real fetch failed for token {token_id}: {e}")
    return out
