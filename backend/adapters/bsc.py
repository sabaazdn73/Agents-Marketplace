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


async def list_registered_agents(rpc_url: str, use_mainnet: bool = False) -> list[OnChainAgent]:
    """Reads the Identity Registry for registered agents. NOT YET
    VERIFIED against a live RPC connection, first thing to check once
    you have a real testnet RPC URL: does bnbagent-sdk expose a
    direct 'list all agents' call, or does this need to be built from
    raw event logs (AgentRegistered events) via a normal web3 call
    instead? Don't assume the SDK has this exact method until
    confirmed."""
    try:
        from bnbagent import ERC8004Agent
    except ImportError as e:
        raise RuntimeError(
            "bnbagent-sdk not installed. Run: pip install bnbagent"
        ) from e

    config = get_chain_config(use_mainnet)
    raise NotImplementedError(
        "Real call not yet built, this needs a live testnet RPC to verify "
        "the actual SDK method name and response shape first (the same "
        "verify-before-code discipline used throughout this project). "
        "See debug_bnbagent_sdk.py (build once a testnet wallet exists)."
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
