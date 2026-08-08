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
    api_key: str | None = None,
    use_mainnet: bool = False,
    page: int = 1,
    limit: int = 20,
) -> list[dict]:
    """CONFIRMED against 8004scan's real, published OpenAPI spec
    (8004scan.io/api/v1/public/docs/openapi.json, fetched 8 Aug 2026),
    not a guess like the rest of this file. Filters to BSC only via
    chainId, per this hackathon's explicit eligibility rule ("agents
    surfaced on your marketplace must be live on BSC"), even though
    8004scan itself indexes 45+ chains.

    No API key required for basic use: anonymous tier gets 10 req/min,
    100/day, plenty for building and testing. Pass api_key once you
    have one for higher limits (free_api tier: 30/min, 1000/day).
    """
    import httpx

    chain_id = MAINNET_CHAIN_ID if use_mainnet else TESTNET_CHAIN_ID
    headers = {"X-API-Key": api_key} if api_key else {}

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://8004scan.io/api/v1/public/agents",
            params={"chainId": chain_id, "page": page, "limit": limit, "sortBy": "total_score", "sortOrder": "desc"},
            headers=headers,
        )
        resp.raise_for_status()
        body = resp.json()

    if not body.get("success"):
        raise RuntimeError(f"8004scan API error: {body.get('error')}")

    all_results = body["data"]

    # SAFETY FILTER, confirmed necessary 8 Aug 2026: a live test call with
    # chainId=56 (exactly the documented parameter) still returned agents
    # with chain_id 1, 8453, etc mixed in, the server-side filter is not
    # reliable. Filtering client-side here instead of trusting it, the
    # same verify-then-trust discipline used throughout this project.
    # If you ever see this filter removing zero agents, the server-side
    # filter may have been fixed, but don't remove this without checking
    # a live call again first.
    bsc_only = [a for a in all_results if a.get("chain_id") == chain_id]
    if len(bsc_only) != len(all_results):
        print(f"[list_bsc_agents] Server returned {len(all_results)} agents for "
              f"chainId={chain_id}, only {len(bsc_only)} actually matched, "
              f"client-side filter caught {len(all_results) - len(bsc_only)} "
              f"wrong-chain results.")

    return bsc_only


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
