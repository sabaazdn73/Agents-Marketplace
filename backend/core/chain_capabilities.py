# chain_capabilities.py
#
# Which evaluation signals are genuinely available for a given chain, and
# for the ones that are not, the reason.
#
# The chain views used to solve this by omission: BSC showed a rich
# evaluation and the other chains showed a thinner one, with nothing saying
# why. Omission reads as "we didn't bother" when the truth is usually
# "this cannot exist here" -- and occasionally the reverse, which is worse,
# because a partial version of BSC's display implies the missing parts were
# checked and came back empty.
#
# Every entry below was verified live on 2026-09-06 rather than assumed
# from documentation:
#
#   Contract verification  Etherscan V2 `chainid` was called for all six
#                          EVM chains and all six answered. The same
#                          address returned genuinely per-chain results
#                          (compiler v0.8.24 on Base/Arbitrum/Ethereum vs
# v0.8.28 on BSC), so these are per-chain
#                          lookups, not one chain's answer reused.
#                          Solana refuses: "Missing or unsupported chainid
#                          parameter", correctly, since it is not EVM.
#   Zerion                 GET /v1/chains lists 65 chains; ethereum,
#                          binance-smart-chain, base, arbitrum, celo and
#                          monad are all present.
#   DefiLlama              /protocols carries Ethereum, Base, Arbitrum,
# Celo, Monad and Solana as chain names
#                          alongside Binance (DefiLlama's own name for
#                          BSC -- not "BSC" or "BNB", confirmed earlier in
#                          adapters/defillama.py).
#   ERC-8183               Deployed on chains 56 and 97 only. Verified
#                          from the SDK's own constants and from the
#                          verified mainnet source: escrow, delivery and
#                          canary all settle in $U through that contract,
#                          so none of the three can exist elsewhere. This
#                          is not a gap to fill later -- it is a property
#                          of the protocol.
#
# A capability being listed here means the signal CAN be produced for that
# chain. It does not claim one has already been computed for a given agent:
# `service_status` in particular is only populated for chains in
# ANALYSIS_CHAIN_IDS, which is a separate, deliberately narrower list.

from __future__ import annotations

from core.full_registry_analysis import ANALYSIS_CHAIN_IDS

# ERC-8183's deployment. See frontend/src/erc8183.js and the SDK's own
# constants -- mainnet 56 and testnet 97, nothing else.
ERC8183_CHAIN_IDS = (56, 97)

# Chains this project can reach with its own RPC. Imported lazily inside the
# function so a missing RPC key can never break a descriptive endpoint.

_EVM_EXPLORER_SUPPORTED = (1, 56, 8453, 42161, 42220, 143)
# Chains we hold our own RPC for -- owner balances are trivially available
# on every one of them, verified live per chain.
NATIVE_RPC_CHAINS = (1, 56, 8453, 42161, 42220, 143)
_ZERION_CHAINS = {
    1: "ethereum", 56: "binance-smart-chain", 8453: "base",
    42161: "arbitrum", 42220: "celo", 143: "monad",
}
# The Agent0 subgraph is BSC-ONLY in practice, verified 2026-09-06 rather
# than assumed from its schema. Its Agent entity DOES expose a `chainId`
# field, which makes it look multi-chain -- but a 200-agent sample of the
# deployment on record was 100% chainId 56, and explicit
# where:{chainId:1|8453|42161} queries each returned 0 rows. The field
# exists; the data does not.
_THEGRAPH_CHAINS = {56}

# 8004scan's Quality Center works on EVERY chain -- it was assumed BSC-only
# and is not. Verified per chain against stored agents: the endpoint
# returns the requested chain_id and genuinely per-agent scoring (Base
# #45071 scored engagement 3.53 / service 30 / publisher 49.96 /
# compliance 69 / momentum 11.98 with a domain_verification_failed
# flag). It is flaky -- intermittent DATABASE_ERROR 500s -- which is a
# reliability property, not a coverage one.
_QUALITY_CHAINS = {1, 56, 8453, 42161, 42220, 143}

# Binance's token-risk endpoint answers for every chain, but the DEPTH
# degrades sharply and a field count alone would have hidden that. Measured
# on a stablecoin per chain, counting genuinely populated fields:
# BSC 89/101, Ethereum 83, Base 79, Arbitrum 40 (no holders), Celo 18
# (but tiny liquidity), Monad 5 (effectively nothing). Recorded as a
# tier so the UI can say "partial" rather than implying parity.
_BINANCE_TIERS = {56: "full", 1: "full", 8453: "full", 42161: "partial", 42220: "thin", 143: "none"}

_DEFILLAMA_CHAINS = {
    1: "Ethereum", 56: "Binance", 8453: "Base",
    42161: "Arbitrum", 42220: "Celo", 143: "Monad", 101: "Solana",
}

# Why a signal is absent, phrased for a reader rather than a maintainer.
_NO_ERC8183 = (
    "ERC-8183 escrow is deployed on BNB Smart Chain only, so there are no "
    "jobs, deliveries or payments to read on this chain. This is a property "
    "of the protocol, not something not yet built here."
)
_NOT_EVM = "This chain is not EVM-compatible, so the EVM-based checks used elsewhere don't apply."


def _signal(available: bool, name: str, detail: str, reason: str = "") -> dict:
    return {"signal": name, "available": available,
            "detail": detail if available else "", "reason": "" if available else reason}


def get_chain_capabilities(chain_id: int) -> dict:
    """Per-signal availability for one chain, with a reason for each
    absence. Pure and side-effect free -- it describes what could be
    produced, and never itself performs a lookup."""
    is_evm = chain_id in _EVM_EXPLORER_SUPPORTED
    analysed = chain_id in ANALYSIS_CHAIN_IDS
    has_escrow = chain_id in ERC8183_CHAIN_IDS

    signals = [
        _signal(True, "category",
                "Classified from the agent's own name and description, which carry no chain "
                "dependency, so this works identically on every chain."),
        _signal(analysed, "live_health",
                "The agent's registered endpoint is resolved from its on-chain tokenURI over this "
                "chain's own RPC and probed live.",
                "This chain's agents haven't been added to the health-checking pass yet. Nothing "
                "is implied about whether they're online -- they simply haven't been checked."
                if is_evm else _NOT_EVM),
        _signal(is_evm, "contract_verification",
                "The owner address is checked on this chain's own explorer: whether it's a contract "
                "at all, and if so whether its source is verified.",
                _NOT_EVM),
        _signal(chain_id in _ZERION_CHAINS, "independent_corroboration",
                "Independent wallet activity for this chain, read from Zerion.",
                "Zerion doesn't index this chain, so there's no independent record to corroborate against."),
        _signal(chain_id in _DEFILLAMA_CHAINS, "financial_record",
                "Protocol-level financial data for this chain, from DefiLlama.",
                "DefiLlama doesn't cover this chain, so there's no financial record to show."),
        _signal(chain_id in _QUALITY_CHAINS, "quality_score",
                "8004scan's own independent quality score for this agent: engagement, "
                "service, publisher, compliance and momentum, plus any risk flags it raised.",
                "8004scan doesn't score agents on this chain."),
        _signal(chain_id in NATIVE_RPC_CHAINS, "owner_balance",
                "The owner wallet's native balance on this chain, read from our own RPC.",
                "We have no RPC for this chain, so its balances can't be read."),
        _signal(_BINANCE_TIERS.get(chain_id, "none") != "none", "token_risk",
                "Token liquidity and risk signals from Binance's market data."
                + (" Coverage on this chain is partial." if _BINANCE_TIERS.get(chain_id) in ("partial", "thin") else ""),
                "Binance's market data doesn't meaningfully cover this chain."),
        _signal(chain_id in _THEGRAPH_CHAINS, "subgraph_provenance",
                "Registration and feedback history read from the Agent0 subgraph.",
                "The Agent0 subgraph indexes BNB Smart Chain only. Its schema has a chain "
                "field, but the deployment carries no agents from other chains."),
        _signal(has_escrow, "escrow_compatibility",
                "Whether the agent can accept an ERC-8183 escrowed job.", _NO_ERC8183),
        _signal(has_escrow, "delivery_record",
                "completed and disputed jobs, read from the escrow contract.", _NO_ERC8183),
        _signal(has_escrow, "canary_results",
                "Results of the test jobs this marketplace runs against agents itself.",
                _NO_ERC8183 + " Canary tests are paid jobs, so they can't run here either."),
    ]

    return {
        "chain_id": chain_id,
        "hireable": has_escrow,
        "available": [s["signal"] for s in signals if s["available"]],
        "unavailable": [s["signal"] for s in signals if not s["available"]],
        "signals": signals,
    }


def summarize_view_capabilities(chain_ids: list[int]) -> dict:
    """Capabilities for a whole view, which may span several chains.

    A signal is reported as available for the view when it is available for
    EVERY chain in it. A view that mixes chains would otherwise show a
    signal as present while silently having nothing for some of its agents
    -- exactly the "partial version implies more than it does" failure this
    module exists to prevent. Chains where it is missing are named, so a
    partial case reads as partial instead of as absent.
    """
    per = [get_chain_capabilities(c) for c in chain_ids]
    if not per:
        return {"signals": [], "chain_ids": []}

    names = [s["signal"] for s in per[0]["signals"]]
    out = []
    for i, name in enumerate(names):
        missing = [p["chain_id"] for p in per if not p["signals"][i]["available"]]
        present = [p for p in per if p["signals"][i]["available"]]
        first = present[0]["signals"][i] if present else per[0]["signals"][i]
        out.append({
            "signal": name,
            "available": not missing,
            "partial": bool(missing) and bool(present),
            "missing_chain_ids": missing,
            "detail": first.get("detail", ""),
            "reason": next((p["signals"][i]["reason"] for p in per
                            if not p["signals"][i]["available"]), ""),
        })
    return {"signals": out, "chain_ids": list(chain_ids)}
