# reference-agent/agent.py
#
# A REFERENCE IMPLEMENTATION of the drawable-budget pattern.
#
# This is not a third-party agent and must never be presented as one. It is
# a worked example, written by us, of how an agent that must SPEND to
# produce actually uses AgentBudgetEscrow. Every surface that shows it says
# so -- see core/budget_agents.py, whose entry for this service carries
# kind="reference_implementation" and a label that spells it out.
#
# WHY IT EXISTS
# -------------
# Deploying the escrow proved the contract works but left nothing able to
# call draw(). Without at least one real drawer, budget mode is a funding
# model with no counterparty: a buyer could fund a budget that nothing
# could ever draw from. This closes that, honestly, by being a real drawer
# rather than by pretending adoption exists.
#
# WHAT IT ACTUALLY DOES, AND WHY THE COST IS REAL
# -----------------------------------------------
# It produces a wallet due-diligence report on an address the client names.
# That work genuinely costs money to perform: it consumes Zerion API quota,
# which this project pays for on a real 300-calls-per-day budget. So this is
# a true instance of the case ERC-8183 cannot fund -- the agent must spend
# before it can deliver, and a locked escrow would leave it unable to start.
#
# It is deliberately NOT a no-op that draws for show. Each draw is tied to
# one real, completed, chargeable call, and the memo names that call. If a
# call fails, no draw is made for it: an agent that charged for work it did
# not do would be a worse example than no example at all.
#
# THE MEMOS
# ---------
# bytes32, and meant to be read by a person watching the live spend view.
# Each is the actual step performed -- "positions", "pnl:30d",
# "activity:90d" -- not a counter or a filler string. That is the whole
# point of the Drawn event: a buyer should be able to see WHAT their money
# was spent on as it happens, which ERC-8183 cannot show at all because it
# emits one payment at the end.
#
# KEY HANDLING
# ------------
# The agent's private key is read from the environment and never committed,
# logged, or echoed. It is the agent's OWN wallet -- the one the client
# named as `agent` when opening the budget -- and it can only ever move
# money the client already granted, capped by maxPerDraw, the cooldown and
# the deadline. It cannot touch anything else.

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field

import httpx
from eth_account import Account
from web3 import Web3

BUDGET_ESCROW_ADDRESS = os.environ.get("BUDGET_ESCROW_ADDRESS", "")
AGENT_PRIVATE_KEY = os.environ.get("AGENT_PRIVATE_KEY", "")
BSC_RPC = os.environ.get("BSC_RPC_URL", "https://bsc-dataseed.binance.org")
ZERION_API_KEY = os.environ.get("ZERION_API_KEY", "")

# Only what this agent calls. Same minimal-ABI discipline as the frontend.
ESCROW_ABI = [
    {"type": "function", "name": "draw", "stateMutability": "nonpayable",
     "inputs": [{"name": "budgetId", "type": "uint256"}, {"name": "amount", "type": "uint256"},
                {"name": "memo", "type": "bytes32"}], "outputs": []},
    {"type": "function", "name": "close", "stateMutability": "nonpayable",
     "inputs": [{"name": "budgetId", "type": "uint256"}], "outputs": []},
    {"type": "function", "name": "drawableNow", "stateMutability": "view",
     "inputs": [{"name": "budgetId", "type": "uint256"}], "outputs": [{"type": "uint256"}]},
    {"type": "function", "name": "getBudget", "stateMutability": "view",
     "inputs": [{"name": "budgetId", "type": "uint256"}],
     "outputs": [{"type": "tuple", "components": [
         {"name": "client", "type": "address"}, {"name": "agent", "type": "address"},
         {"name": "token", "type": "address"}, {"name": "total", "type": "uint256"},
         {"name": "spent", "type": "uint256"}, {"name": "maxPerDraw", "type": "uint256"},
         {"name": "deadline", "type": "uint64"}, {"name": "cooldown", "type": "uint64"},
         {"name": "lastDrawAt", "type": "uint64"}, {"name": "status", "type": "uint8"}]}]},
]

STATUS_OPEN = 1


@dataclass
class Step:
    """One unit of chargeable work. `memo` is what the buyer will read."""
    memo: str
    cost_wei: int
    run: object                      # async callable -> dict
    result: dict | None = None
    charged: bool = False
    error: str | None = None


@dataclass
class ReportRun:
    budget_id: int
    subject: str
    steps: list[Step] = field(default_factory=list)
    drawn_wei: int = 0
    tx_hashes: list[str] = field(default_factory=list)


class ReferenceAgent:
    """Performs paid work, then draws exactly for the work that succeeded."""

    def __init__(self) -> None:
        if not Web3.is_address(BUDGET_ESCROW_ADDRESS):
            raise RuntimeError("BUDGET_ESCROW_ADDRESS is not set to a valid address")
        if not AGENT_PRIVATE_KEY:
            raise RuntimeError("AGENT_PRIVATE_KEY is not set")
        self.w3 = Web3(Web3.HTTPProvider(BSC_RPC))
        self.account = Account.from_key(AGENT_PRIVATE_KEY)
        self.escrow = self.w3.eth.contract(
            address=Web3.to_checksum_address(BUDGET_ESCROW_ADDRESS), abi=ESCROW_ABI
        )

    @property
    def address(self) -> str:
        return self.account.address

    # ── the paid work ────────────────────────────────────────────────────

    async def _zerion(self, client: httpx.AsyncClient, path: str, params: dict) -> dict:
        """One real, chargeable Zerion call. Raises on failure so the caller
        can decline to charge for it."""
        resp = await client.get(
            f"https://api.zerion.io/v1{path}", params=params, auth=(ZERION_API_KEY, ""),
        )
        resp.raise_for_status()
        return resp.json()

    def _plan(self, client: httpx.AsyncClient, subject: str, unit_cost_wei: int) -> list[Step]:
        """The report's steps, each priced at one unit of API quota.

        Memos are the real step names a reader would want to see in the
        spend feed, and are kept inside 32 bytes so they survive as bytes32
        without truncation surprising anyone."""
        addr = subject.lower()
        return [
            Step("positions", unit_cost_wei,
                 lambda: self._zerion(client, f"/wallets/{addr}/positions/",
                                      {"currency": "usd", "filter[chain_ids]": "binance-smart-chain"})),
            Step("pnl:30d", unit_cost_wei,
                 lambda: self._zerion(client, f"/wallets/{addr}/pnl/",
                                      {"currency": "usd", "filter[chain_ids]": "binance-smart-chain"})),
            Step("activity:90d", unit_cost_wei,
                 lambda: self._zerion(client, f"/wallets/{addr}/transactions/",
                                      {"currency": "usd", "page[size]": 25,
                                       "filter[chain_ids]": "binance-smart-chain"})),
        ]

    # ── drawing ──────────────────────────────────────────────────────────

    def _budget(self, budget_id: int) -> dict:
        b = self.escrow.functions.getBudget(budget_id).call()
        keys = ["client", "agent", "token", "total", "spent", "maxPerDraw",
                "deadline", "cooldown", "lastDrawAt", "status"]
        return dict(zip(keys, b))

    def _draw(self, budget_id: int, amount_wei: int, memo: str) -> str:
        """One real draw, for one completed step.

        The memo is encoded as bytes32 exactly as the contract expects and
        as BudgetSpendView decodes it, so what a buyer reads in the live
        feed is the same string this agent chose here."""
        memo_bytes = memo.encode("utf-8")[:32].ljust(32, b"\x00")
        tx = self.escrow.functions.draw(budget_id, amount_wei, memo_bytes).build_transaction({
            "from": self.address,
            "nonce": self.w3.eth.get_transaction_count(self.address),
            "gasPrice": self.w3.eth.gas_price,
        })
        signed = self.account.sign_transaction(tx)
        h = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(h, timeout=120)
        if receipt.status != 1:
            raise RuntimeError(f"draw reverted: {h.hex()}")
        return h.hex()

    # ── the loop ─────────────────────────────────────────────────────────

    async def fulfil(self, budget_id: int, subject: str) -> ReportRun:
        """Do the work and charge for it, one completed step at a time.

        Order matters and is deliberate: the work happens BEFORE its draw.
        Charging first would mean taking money for a call that might fail,
        which is exactly the behaviour that makes the budget model feel
        unsafe to a buyer.
        """
        b = self._budget(budget_id)
        if b["agent"].lower() != self.address.lower():
            raise RuntimeError("this budget names a different agent")
        if b["status"] != STATUS_OPEN:
            raise RuntimeError("budget is not open")

        run = ReportRun(budget_id=budget_id, subject=subject)

        async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
            # Priced so a whole report fits inside one per-draw cap and the
            # budget as a whole: never assume the client funded generously.
            unit = min(b["maxPerDraw"] or b["total"], (b["total"] - b["spent"]) // 3 or 1)
            run.steps = self._plan(client, subject, unit)

            for step in run.steps:
                remaining = self._budget(budget_id)
                if remaining["status"] != STATUS_OPEN:
                    step.error = "budget closed or revoked mid-run"
                    break
                if time.time() > remaining["deadline"]:
                    step.error = "deadline passed"
                    break

                try:
                    step.result = await step.run()
                except Exception as e:            # the call failed
                    step.error = f"{type(e).__name__}"
                    continue                      # and so it is NOT charged

                drawable = self.escrow.functions.drawableNow(budget_id).call()
                if drawable < step.cost_wei:
                    step.error = "not enough budget remaining to charge for this step"
                    continue
                try:
                    tx = self._draw(budget_id, step.cost_wei, step.memo)
                    step.charged = True
                    run.drawn_wei += step.cost_wei
                    run.tx_hashes.append(tx)
                except Exception as e:
                    # The work was done but could not be charged -- a revoke
                    # landing first is the expected cause. Recorded, and the
                    # client is not billed for it.
                    step.error = f"draw failed: {type(e).__name__}"

                if remaining["cooldown"]:
                    await asyncio.sleep(remaining["cooldown"] + 1)

        # Signals the work is finished so the client can reclaim the rest
        # without waiting for the deadline. Best effort: a failure here
        # costs the client nothing, since reclaim never depends on it.
        try:
            self.escrow.functions.close(budget_id).call({"from": self.address})
            self._send_close(budget_id)
        except Exception:
            pass

        return run

    def _send_close(self, budget_id: int) -> None:
        tx = self.escrow.functions.close(budget_id).build_transaction({
            "from": self.address,
            "nonce": self.w3.eth.get_transaction_count(self.address),
            "gasPrice": self.w3.eth.gas_price,
        })
        signed = self.account.sign_transaction(tx)
        self.w3.eth.send_raw_transaction(signed.raw_transaction)
