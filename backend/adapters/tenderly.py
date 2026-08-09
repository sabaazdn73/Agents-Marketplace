"""
tenderly.py

Real transaction simulation via Tenderly's Simulation API, confirmed
against Tenderly's own documentation (docs.tenderly.co/simulations,
fetched 9 Aug 2026): a virtual replica of the real chain, giving 100%
accurate gas usage, balance changes, and asset changes for a
transaction WITHOUT sending it to the real network. This is the real
mechanism behind the paper-trading layer: an agent's proposed action
gets simulated against real, current on-chain state, so the outcome
is real (not a guess), but no real funds ever move.

Confirmed real endpoint shape:
  POST https://api.tenderly.co/api/v1/account/{account}/project/{project}/simulate
  Header: X-Access-Key: <key>
  Response: transaction.transaction_info.asset_changes,
            transaction.transaction_info.balance_changes

Cost note (confirmed in Tenderly's own FAQ): each simulate call costs
400 Tenderly Units, even for identical repeated payloads, budget
accordingly, don't simulate the same thing repeatedly without reason.
"""

import httpx

TENDERLY_BASE_URL = "https://api.tenderly.co/api/v1"


class SimulationResult:
    """A real simulated outcome, not a guess. success=False means the
    transaction would genuinely have reverted on-chain, this is
    valuable information, not a failure of the tool.

    HONESTY NOTE: transaction_info.asset_changes and
    transaction_info.balance_changes are CONFIRMED against Tenderly's
    own docs (docs.tenderly.co/simulations/asset-balance-changes,
    fetched 9 Aug 2026). The exact path for status/gas_used was NOT
    explicitly confirmed the same way, best-guess based on typical
    Tenderly response shape, verify against a real live call before
    trusting success/gas_used specifically, the same verify-then-trust
    discipline used throughout this project."""

    def __init__(self, raw: dict):
        self.raw = raw
        tx = raw.get("transaction", {})
        self.success = tx.get("status", False)  # UNCONFIRMED path, verify live
        self.gas_used = tx.get("gas_used")  # UNCONFIRMED path, verify live
        self.error_message = tx.get("error_message")
        info = tx.get("transaction_info", {})
        self.asset_changes = info.get("asset_changes", [])  # CONFIRMED path
        self.balance_changes = info.get("balance_changes", [])  # CONFIRMED path

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "gas_used": self.gas_used,
            "error_message": self.error_message,
            "asset_changes": self.asset_changes,
            "balance_changes": self.balance_changes,
        }


async def simulate_transaction(
    account_slug: str,
    project_slug: str,
    access_key: str,
    network_id: str,
    from_address: str,
    to_address: str,
    input_data: str = "0x",
    value: str = "0",
    gas: int = 8_000_000,
    save: bool = False,
) -> SimulationResult:
    """The real entry point: simulate one proposed transaction against
    real, current chain state, no funds move, no real transaction is
    ever broadcast.

    network_id: Tenderly's chain identifier, "56" for BSC mainnet,
    "97" for BSC testnet (Tenderly uses standard EVM chain IDs as
    strings, confirmed via their network list).

    save: if True, this simulation is saved to the Tenderly dashboard
    (useful for debugging), costs the same 400 TU either way per
    Tenderly's own FAQ, doesn't change cost, only visibility.
    """
    url = f"{TENDERLY_BASE_URL}/account/{account_slug}/project/{project_slug}/simulate"
    headers = {"X-Access-Key": access_key}
    payload = {
        "network_id": network_id,
        "from": from_address,
        "to": to_address,
        "input": input_data,
        "value": value,
        "gas": gas,
        "save": save,
        "save_if_fails": True,  # always keep a record of failures, they're useful data
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        return SimulationResult(resp.json())
