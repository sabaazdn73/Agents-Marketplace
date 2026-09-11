# budget_index.py
#
# The delivery record for chains that have no ERC-8183.
#
# BNB Chain shows a delivery rate built from ERC-8183 jobs: funded versus
# delivered, with the count and the age of anything stuck. Arbitrum and
# Robinhood Chain have no ERC-8183 and never will, because that contract is
# Altana's and is deployed on BNB Chain only. They showed nothing at all,
# which read as "no information exists" when in fact the same information
# does exist in a different contract.
#
# A budget funded and never drawn from is a client who committed money and
# got nothing, which is the same fact an undelivered ERC-8183 job records.
# This module reads that fact.
#
#
# WHY THIS READS EVENTS AND NOT `spent`
#
# The obvious implementation is to enumerate budgets from contract state
# (budgetCounter is public, ids are sequential from 1, getBudget is a view)
# and treat `spent > 0` as "the agent drew". That is wrong, and it is wrong
# in the direction that invents a delivery that never happened.
#
# AgentBudgetEscrow.reclaim does this before paying the client back:
#
#     b.spent = b.total;
#     b.status = Status.RECLAIMED;
#
# It marks the whole budget spent so a re-entering token cannot reclaim
# twice. That is correct for the contract and fatal for this reading: after
# a reclaim, `spent == total` whether the agent drew everything or nothing.
#
# This is not hypothetical. Checked on chain on 2026-09-11, the single
# Robinhood Chain budget reads total 7e12, spent 7e12, status RECLAIMED.
# Read from state it looks like an agent that drew its entire budget. There
# are zero Drawn events for it. The agent drew nothing and the client took
# the money back.
#
# So `spent` is only truthful while status is OPEN or CLOSED, and the
# ambiguous case is the common one: 3 of the 5 budgets that exist are
# RECLAIMED. The Drawn event is the only source that cannot be overwritten,
# so the Drawn event is what this reads.
#
#
# WHERE THE SCAN STARTS
#
# From the block that opened budget #1 on each chain. Ids are sequential
# from 1, so no budget can exist before the block that opened the first one,
# which makes this an exact floor rather than a guess at a deploy block.
# Confirmed by scanning each chain and finding budget #1 at these blocks.
#
# A cursor is persisted per chain, so the long first scan happens once and
# later runs cover only new blocks.

from __future__ import annotations

import os
import time
from typing import Any

import httpx

from core.rpc import get_chain_rpc_url, get_chain_fallback_rpc_url

# keccak("Drawn(uint256,address,uint256,uint256,uint256,uint256,bytes32)")
DRAWN_TOPIC = "0x857eef7b9debffbe023f8d5f0d03d0e4f26b954deeef5d68ef6c5ebe33a5aae3"
# keccak("BudgetOpened(uint256,address,address,address,uint256,uint256,uint64,uint64)")
OPENED_TOPIC = "0x3aba8d716ec2c8a56e018967b6db59e71c926d3cbfcfa54050e0889536113e93"

# Must stay in step with frontend/src/chainContracts.js. Note that the same
# address is AgentAccessMarket on BSC, which is why this is keyed by chain and
# why 56 has a different entry rather than reusing the other three.
ESCROW_ADDRESS = {
    56: "0x4728f03693DDABbe50E79c7BfFCb930e522D585B",
    1: "0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333",
    42161: "0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333",
    4663: "0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333",
}

# The block of BudgetOpened for budget #1 on each chain, read from chain
# 2026-09-11. An exact floor, not an estimate: see the note above.
# Ethereum has no budget #1 yet, so its floor is the contract's own creation
# block (25957217, tx 0x5e2d3149..., creator 0x48cE74cd...), read from
# Etherscan rather than guessed. No log can predate the contract, so this is
# an exact floor by construction, the same guarantee the other three get from
# budget #1's block.
FIRST_BUDGET_BLOCK = {56: 120311961, 1: 25957217, 42161: 503840279, 4663: 59515146}

# eth_getLogs page size. BSC's endpoints cap the range at 5,000 blocks and
# reject anything wider outright rather than truncating, so the page size is
# per chain and BSC's sits under its cap.
LOG_PAGE_BLOCKS = {56: 4_900, 42161: 40_000, 4663: 40_000}
DEFAULT_PAGE_BLOCKS = 10_000

COLLECTION = "budget_index"
PROGRESS_COLLECTION = "budget_index_progress"

# Below this many budgets against one agent, no percentage is shown. A rate
# derived from one or two data points is a number pretending to be evidence.
# The UI takes this from the API rather than hardcoding its own threshold, so
# the rule cannot drift between the card and the detail page.
MIN_BUDGETS_FOR_RATE = 5


async def _rpc(client: httpx.AsyncClient, chain_id: int, method: str, params: list) -> Any:
    """One JSON-RPC call, primary then failover. Raises if both fail."""
    urls = [u for u in (get_chain_rpc_url(chain_id), get_chain_fallback_rpc_url(chain_id)) if u]
    if not urls:
        raise RuntimeError(f"no RPC configured for chain {chain_id}")
    last: Exception | None = None
    for url in urls:
        try:
            r = await client.post(
                url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=45.0
            )
            r.raise_for_status()
            body = r.json()
            if "error" in body:
                raise RuntimeError(body["error"])
            return body["result"]
        except Exception as e:  # noqa: BLE001 -- try the failover, then report
            last = e
    raise RuntimeError(f"chain {chain_id} {method} failed on every RPC: {last}")


def _agent_from_drawn(log: dict) -> str:
    """Drawn's second indexed field is the agent address."""
    return "0x" + log["topics"][2][-40:].lower()


def _agent_from_opened(log: dict) -> str:
    """BudgetOpened's third indexed field is the agent address."""
    return "0x" + log["topics"][3][-40:].lower()


def _budget_id(log: dict) -> int:
    return int(log["topics"][1], 16)


async def _scan(client: httpx.AsyncClient, chain_id: int, topic: str,
                from_block: int, to_block: int) -> list[dict]:
    """Page through eth_getLogs. A page that fails on both RPCs raises rather
    than being skipped: a silently dropped page would under-count draws, and
    an under-counted draw reads as an agent that took money and delivered
    nothing. Wrong in the direction that accuses somebody."""
    addr = ESCROW_ADDRESS[chain_id]
    step = LOG_PAGE_BLOCKS.get(chain_id, DEFAULT_PAGE_BLOCKS)
    out: list[dict] = []
    cur = from_block
    while cur <= to_block:
        end = min(cur + step, to_block)
        out += await _rpc(client, chain_id, "eth_getLogs", [{
            "address": addr, "fromBlock": hex(cur), "toBlock": hex(end), "topics": [topic],
        }])
        cur = end + 1
    return out


async def refresh_chain(db, chain_id: int) -> dict:
    """Bring one chain's budget index up to the current head.

    Stores one document per budget, keyed by (chain_id, budget_id), holding
    the agent it was opened against and whether it was ever drawn from."""
    if chain_id not in ESCROW_ADDRESS:
        raise ValueError(f"chain {chain_id} has no AgentBudgetEscrow deployment")

    progress = db[PROGRESS_COLLECTION]
    state = await progress.find_one({"chain_id": chain_id}) or {}
    start = int(state.get("next_block") or FIRST_BUDGET_BLOCK[chain_id])

    async with httpx.AsyncClient() as client:
        head = int(await _rpc(client, chain_id, "eth_blockNumber", []), 16)
        if start > head:
            return {"chain_id": chain_id, "scanned": 0, "head": head}

        opened = await _scan(client, chain_id, OPENED_TOPIC, start, head)
        drawn = await _scan(client, chain_id, DRAWN_TOPIC, start, head)

    col = db[COLLECTION]
    for log in opened:
        bid = _budget_id(log)
        await col.update_one(
            {"chain_id": chain_id, "budget_id": bid},
            {"$set": {
                "agent": _agent_from_opened(log),
                "opened_block": int(log["blockNumber"], 16),
            }, "$setOnInsert": {"draws": 0}},
            upsert=True,
        )
    # A draw is recorded against the budget it belongs to. `$inc` is safe on
    # re-scan only because the cursor never replays a block it has passed;
    # a replay would double-count, which is why the cursor advances only
    # after both scans have succeeded.
    for log in drawn:
        bid = _budget_id(log)
        await col.update_one(
            {"chain_id": chain_id, "budget_id": bid},
            {"$inc": {"draws": 1}, "$set": {"agent": _agent_from_drawn(log)}},
            upsert=True,
        )

    await progress.update_one(
        {"chain_id": chain_id},
        {"$set": {"next_block": head + 1, "head": head, "updated_at": int(time.time())}},
        upsert=True,
    )
    return {"chain_id": chain_id, "opened": len(opened), "drawn": len(drawn), "head": head}


async def get_agent_budget_stats(db, chain_ids: list[int] | None = None) -> dict[str, dict]:
    """Per-agent budget record, keyed by lowercased agent address.

    `rate` is None below MIN_BUDGETS_FOR_RATE on purpose. The caller is meant
    to render the counts in that case and say the sample is too small, not to
    divide two small integers and print a percentage."""
    q: dict = {}
    if chain_ids:
        q["chain_id"] = {"$in": chain_ids}

    by_agent: dict[str, dict] = {}
    async for doc in db[COLLECTION].find(q, {"_id": 0}):
        agent = (doc.get("agent") or "").lower()
        if not agent:
            continue
        s = by_agent.setdefault(agent, {"funded": 0, "drawn_from": 0, "chains": set()})
        s["funded"] += 1
        if int(doc.get("draws") or 0) > 0:
            s["drawn_from"] += 1
        s["chains"].add(int(doc["chain_id"]))

    out: dict[str, dict] = {}
    for agent, s in by_agent.items():
        funded = s["funded"]
        enough = funded >= MIN_BUDGETS_FOR_RATE
        out[agent] = {
            "budgets_funded": funded,
            "budgets_drawn_from": s["drawn_from"],
            "budgets_never_drawn": funded - s["drawn_from"],
            "chains": sorted(s["chains"]),
            # Null below the threshold, so a caller cannot accidentally
            # render 0% off a single budget.
            "draw_rate": (s["drawn_from"] / funded) if enough else None,
            "sample_too_small": not enough,
            "min_for_rate": MIN_BUDGETS_FOR_RATE,
        }
    return out
