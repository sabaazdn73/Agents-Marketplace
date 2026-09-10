# agent_evaluation.py
#
# The evaluation for ONE agent on ANY chain, assembled from the sources
# that were verified to work on that chain rather than the ones we happened
# to wire up for BSC first.
#
# Non-BSC agents had a much thinner display than BSC's, and most of that gap
# turned out to be unused capability rather than a limit. Every entry
# below was checked live on 2026-09-06 against stored agents on each
# chain, in the same way the registry addresses were verified per chain
# instead of assumed:
#
#   8004scan Quality Center  ALL SIX CHAINS. This was assumed BSC-only and
#     is not. /api/v1/agents/{chain}/{id}/quality returned the correct
#     chain_id and genuinely per-agent data on Ethereum, Base, Arbitrum,
#     Celo and Monad -- e.g. Base #45071 scored engagement 3.53, service
# 30, publisher 49.96, compliance 69, momentum 11.98 with a real
#     `domain_verification_failed` flag, while Arbitrum/Celo agents
#     honestly reported "not yet scored". The endpoint is FLAKY: roughly
#     one call in three returned HTTP 500 during testing, so a None here
#     means "could not read", never "no quality".
#
#   Zerion                   ALL SIX CHAINS. GET /v1/chains/ lists 65 and
# all six of ours are present; confirmed further by pulling a REAL
# stored owner's portfolio per chain and getting USD values back
#     (Ethereum $19.00, Base $12.00, Arbitrum $3.43, Celo $0.05, Monad
#     $0.90). See adapters/zerion.ZERION_CHAIN_SLUGS.
#
#   Native RPC owner balance ALL SIX CHAINS, through core/rpc.py's own
#     per-chain transport, which raises for a chain it has no RPC for
#     rather than silently answering from BSC.
#
#   Contract verification    ALL SIX EVM CHAINS via Etherscan V2's chainid
#     parameter. Solana correctly refuses -- it is not EVM.
#
# And the two that genuinely do NOT port, stated so they are not retried:
#
#   The Graph   BSC ONLY. The Agent0 subgraph's Agent entity does expose a
#     `chainId` field, which makes it look multi-chain, but the deployment
#     on record contains chain 56 and nothing else: a 200-agent sample was
#     100% chainId 56, and explicit `where:{chainId:1|8453|42161}` queries
#     each returned 0 rows. The field exists; the data does not.
#
#   ERC-8183    BSC ONLY, and permanently so -- escrow, delivery record and
#     canary results all settle through a contract deployed on chains 56
#     and 97 only. This is the one set of signals that stays exclusive.
#
# Deliberately ON-DEMAND, one agent at a time. These are per-agent API
# calls against rate-limited keys; running them across 154,865 stored
# agents would be both a budget and a memory problem, and this service has
# an OOM history. The bulk list stays cheap and this fills in when someone
# opens one agent.

from __future__ import annotations

import asyncio
import os

import httpx

from adapters import bsc, contract_verification, zerion
from adapters.zerion import zerion_chain_slug
from core.chain_capabilities import ERC8183_CHAIN_IDS
from core.rpc import chain_rpc_post, supported_rpc_chain_ids

# Native currency per chain, so a balance is never labelled in the wrong
# unit. A chain absent here still reports its balance, just unlabelled.
NATIVE_SYMBOL = {
    1: "ETH", 56: "BNB", 8453: "ETH", 42161: "ETH", 42220: "CELO", 143: "MON",
    # 4663 (Robinhood Chain) is an Arbitrum Orbit L2 with ETH as its gas
    # token. Without this the owner balance rendered as a bare number with
    # no unit, which reads as a quantity of nothing.
    4663: "ETH",
}


async def _quality_with_retry(client: httpx.AsyncClient, api_key: str, token_id: int, chain_id: int):
    """One retry, because this endpoint's failures are mostly transient.

    Measured rather than assumed: calling it for the same agents twice, the
    first attempt returned HTTP 500 with {"code":"DATABASE_ERROR"} for
    agents that answered 200 moments later on an identical request. Without
    a retry the evaluation reported "no quality record" for agents that do
    have one, which is exactly the false negative this module must not
    produce. The retry is deliberately single and short -- this runs while
    a user waits on a detail view, and a outage should surface as
    unavailable quickly rather than being hidden behind a long backoff."""
    for attempt in (0, 1):
        result = await bsc.fetch_agent_quality(client, api_key, token_id, chain_id=chain_id)
        if result is not None:
            return result
        if attempt == 0:
            await asyncio.sleep(1.2)
    return None


async def _owner_native_balance(client: httpx.AsyncClient, chain_id: int, owner: str) -> dict:
    if chain_id not in supported_rpc_chain_ids():
        return {"available": False, "reason": f"no RPC configured for chain {chain_id}"}
    try:
        resp = await chain_rpc_post(
            client, chain_id,
            {"jsonrpc": "2.0", "id": 1, "method": "eth_getBalance", "params": [owner, "latest"]},
        )
        raw = resp.json().get("result")
        if not isinstance(raw, str):
            return {"available": False, "reason": "unexpected RPC response"}
        return {
            "available": True,
            "balance": int(raw, 16) / 1e18,
            "symbol": NATIVE_SYMBOL.get(chain_id, ""),
        }
    except Exception as e:
        return {"available": False, "reason": f"{type(e).__name__}"}


def _summarize_quality(q: dict | None) -> dict:
    """The parts of Quality Center worth showing, flattened.

    Returns available=False when the call failed, which is NOT the same as
    a zero: this endpoint 500s intermittently, so a failure must never
    render as "this agent scored nothing"."""
    if not q:
        return {"available": False, "reason": "8004scan did not return a quality record"}
    score = q.get("score") or {}
    dims = [
        {
            "key": d.get("key"), "label": d.get("label"), "score": d.get("score"),
            "weight": d.get("weight"), "explanation": d.get("explanation"),
        }
        for d in (score.get("dimensions") or [])
    ]
    flags = [
        {
            "id": f.get("id"), "severity": f.get("severity"),
            "title": f.get("title"), "description": f.get("description"),
        }
        for f in (q.get("risk_flags") or [])
    ]
    scored_at = score.get("last_scored_at")
    return {
        "available": True,
        "total_score": score.get("total_score"),
        # Distinguishes "scored zero" from "not scored yet". 8004scan says
        # so itself via last_scored_at, so this is read rather than guessed.
        "scored": scored_at is not None,
        "last_scored_at": scored_at,
        "dimensions": dims,
        "risk_flags": flags,
        "endpoint_health": (q.get("endpoint_health") or {}).get("overall_status"),
        "metadata_status": (q.get("metadata_validation") or {}).get("status"),
    }


async def evaluate_agent(chain_id: int, token_id: int, owner_address: str | None) -> dict:
    """Everything genuinely retrievable about one agent on its own chain.

    Every source is independent and best-effort: one failing never blocks
    the others, and each reports its own availability so the UI can
    say "couldn't read this" instead of rendering an absence as a finding.
    """
    api_key = os.environ.get("SCAN_8004_API_KEY")
    owner = (owner_address or "").strip()
    has_owner = owner.lower().startswith("0x") and len(owner) == 42

    async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
        tasks = {
            "quality": _quality_with_retry(client, api_key, token_id, chain_id)
            if api_key else _none(),
            "balance": _owner_native_balance(client, chain_id, owner) if has_owner else _unavailable("no owner address on record"),
            "portfolio": zerion.get_wallet_portfolio(owner, chain_id=chain_id) if has_owner else _unavailable("no owner address on record"),
            "verification": contract_verification.check_owner_contract_verification(owner, chain_id=chain_id)
            if has_owner else _unavailable("no owner address on record"),
        }
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)

    out = {}
    for name, res in zip(tasks.keys(), results):
        if isinstance(res, Exception):
            out[name] = {"available": False, "reason": f"{type(res).__name__}"}
        elif name == "quality":
            out[name] = _summarize_quality(res)
        else:
            out[name] = res

    out["chain_id"] = chain_id
    out["token_id"] = token_id
    # Said explicitly rather than left to be inferred from missing keys.
    out["erc8183_applicable"] = chain_id in ERC8183_CHAIN_IDS
    out["graph_applicable"] = chain_id == 56
    return out


async def _none():
    return None


async def _unavailable(reason: str) -> dict:
    return {"available": False, "reason": reason}
