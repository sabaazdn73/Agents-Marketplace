"""
bsc.py

The ONLY file in this project that talks to bnbagent-sdk directly, per
the core/adapters split: core/ holds chain-agnostic business logic
(categorization, advantage reports), adapters/ holds one file per chain.
When this project expands to another chain later, that chain gets its
own adapters/<chain>.py, core/ doesn't change.

HONESTY NOTE: bnbagent-sdk's exact call signatures below are built from
its public GitHub README (real, confirmed contract addresses and the
general job-lifecycle shape), but have NOT been run against a real
BSC testnet connection yet, no wallet/RPC was available to verify
live. Treat every function here the way this whole project has
treated first-draft integration code all session: as a first pass to
verify against a real response before trusting it, not as
confirmed-working. Run debug_bnbagent_sdk.py (build that next, once
you have a testnet wallet ready) before relying on this in production.
"""

from dataclasses import dataclass

# Confirmed real, deployed contract addresses (from bnbagent-sdk's README,
# 7 Aug 2026). Testnet is the default per this project's security rules.
TESTNET_CHAIN_ID = 97
MAINNET_CHAIN_ID = 56

CONTRACTS = {
    TESTNET_CHAIN_ID: {
        "identity_registry": "0x8004A818BFB912233c491871b3d84c89A494BD9e",
        "agentic_commerce": "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
    },
    MAINNET_CHAIN_ID: {
        "identity_registry": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
        "agentic_commerce": "0xea4daa3100a767e86fded867729ae7446476eba6",
    },
}


@dataclass
class OnChainAgent:
    """What we get back after reading an agent's on-chain identity.
    Fields are what ERC-8004's Identity Registry is documented to
    expose, unverified against a live call yet (see module docstring)."""
    address: str
    agent_id: str
    metadata_uri: str | None
    is_registered: bool


def get_chain_config(use_mainnet: bool = False) -> dict:
    """Never defaults to mainnet, per this project's security rules,
    the caller must explicitly opt in."""
    chain_id = MAINNET_CHAIN_ID if use_mainnet else TESTNET_CHAIN_ID
    return {"chain_id": chain_id, **CONTRACTS[chain_id]}


async def list_bsc_agents(
    api_key: str,
    use_mainnet: bool = False,
    offset: int = 0,
    limit: int = 20,
    max_retries: int = 4,
) -> tuple[list[dict], int]:
    """REBUILT 8 Aug 2026 against a real, different, richer endpoint
    discovered live: 8004scan.io/api/v1/agents (NOT /api/v1/public/agents,
    a genuinely different endpoint, requires a real API key, uses
    offset/limit pagination and an {items, total, limit, offset}
    envelope, confirmed directly from a real response: total=714397
    agents across all chains as of 8 Aug 2026).

    Real fields now available that the old /public/ endpoint didn't
    have: is_verified, x402_supported, health_score, rank,
    network_rank, average_score, and critically cross_chain_versions
    (the real mechanism for "same agent identity across chains").

    Still filters to BSC only client-side (chain_id == 56 or 97),
    same discipline as before: server-side chainId filtering was
    never verified reliable for this endpoint either, don't assume it
    works just because the parameter name matches.

    Returns (agents, total_reported_by_server) so callers can decide
    how far to paginate.
    """
    import httpx
    import asyncio

    chain_id = MAINNET_CHAIN_ID if use_mainnet else TESTNET_CHAIN_ID
    headers = {"X-API-Key": api_key}

    last_error = None
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    "https://8004scan.io/api/v1/agents",
                    params={"chainId": chain_id, "offset": offset, "limit": limit},
                    headers=headers,
                )
                resp.raise_for_status()
                body = resp.json()
            break
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < max_retries - 1:
                wait_seconds = 8 * (2 ** attempt)
                print(f"[list_bsc_agents] 429 at offset {offset} (chain {chain_id}), "
                      f"attempt {attempt + 1}/{max_retries}, waiting {wait_seconds}s")
                last_error = e
                await asyncio.sleep(wait_seconds)
                continue
            raise
    else:
        raise last_error

    all_results = body.get("items", [])
    total = body.get("total", 0)

    bsc_only = [a for a in all_results if a.get("chain_id") == chain_id]
    if len(bsc_only) != len(all_results):
        print(f"[list_bsc_agents] Server returned {len(all_results)} agents for "
              f"chainId={chain_id} at offset {offset}, only {len(bsc_only)} actually "
              f"matched, client-side filter caught the rest.")

    return bsc_only, total


async def fetch_bsc_agents_layered(api_key: str | None = None, use_mainnet: bool = False) -> tuple[list[dict], str]:
    """The real entry point: layered fallback across data sources,
    returns (agents, source_used) so callers/UI can show provenance.

    Layer 1: 8004scan (confirmed working via list_bsc_agents above,
    real OpenAPI spec verified 8 Aug 2026, officially AltLayer-built
    and BNB-Chain-endorsed).

    Layer 2: 8k4 Protocol (documented in the ERC-8004 ecosystem list as
    covering 44,020 BSC agents, more than 8004scan showed in a live
    test, but 8k4's exact REST endpoint schema is NOT published
    anywhere findable as of 8 Aug 2026, don't guess it, this layer
    stays a documented TODO until its real API docs are found, e.g.
    by asking in the ERC-8004 Telegram (t.me/ERC8004) or 8k4's own
    channels).

    Layer 3: direct on-chain read via the Identity Registry's
    confirmed ABI (register/ownerOf/getMetadata, from the official
    erc-8004-contracts repo), the ultimate ground truth, independent
    of any third-party indexer's completeness or uptime. Not yet
    built, real next step if layers 1-2 prove insufficient.
    """
    try:
        agents = await list_bsc_agents(api_key=api_key, use_mainnet=use_mainnet)
        if agents:
            return agents, "8004scan"
    except Exception as e:
        print(f"[fetch_bsc_agents_layered] 8004scan failed: {e}")

    # Layer 2 (8k4) intentionally not called yet, real endpoint schema
    # unconfirmed, see docstring. Raising here rather than silently
    # returning an empty list, an empty marketplace should look like
    # an error, not a legitimate "no agents" state.
    raise RuntimeError(
        "8004scan returned no agents and no other verified data source "
        "is wired in yet. Layer 2 (8k4 Protocol) and Layer 3 (direct "
        "on-chain read) are documented but not implemented, see this "
        "function's docstring for what's needed to build each one."
    )


async def list_registered_agents(rpc_url: str, use_mainnet: bool = False) -> list[OnChainAgent]:
    """Superseded by list_bsc_agents() above, which reads from
    8004scan's confirmed public API instead of guessing at a direct
    SDK/RPC call. Kept here in case a DIRECT on-chain read (bypassing
    8004scan entirely) is ever needed, still unverified, still needs
    a live RPC connection to confirm."""
    try:
        from bnbagent import ERC8004Agent
    except ImportError as e:
        raise RuntimeError(
            "bnbagent-sdk not installed. Run: pip install bnbagent"
        ) from e

    config = get_chain_config(use_mainnet)
    raise NotImplementedError(
        "Only needed if you want to bypass 8004scan and read the "
        "Identity Registry directly, use list_bsc_agents() instead "
        "for the normal case, that one is confirmed working."
    )


async def hire_agent(
    agent_address: str,
    spend_cap: int,
    session_expiry_seconds: int,
    rpc_url: str,
    operator_wallet,  # bnbagent-sdk wallet object, never a raw private key string
    use_mainnet: bool = False,
) -> dict:
    """The ERC-8183 hire flow: negotiate -> create -> fund. Stubbed
    the same way, needs live verification before trusting it. The
    X402Signer spend-cap pattern from bnbagent-sdk's README:

        signer = X402Signer(
            wallet,
            max_value_per_call={token: spend_cap},
            session_budget={token: spend_cap},
        )

    is the real mechanism to wire in here once confirmed live."""
    raise NotImplementedError(
        "Real call not yet built, needs live testnet verification first."
    )


async def revoke_session(agent_address: str, rpc_url: str, operator_wallet, use_mainnet: bool = False) -> bool:
    """Per this project's security rules: user-facing revoke must
    always work and always be one transaction. Stubbed pending live
    verification, same as above."""
    raise NotImplementedError(
        "Real call not yet built, needs live testnet verification first."
    )
