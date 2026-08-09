"""
paper_trading.py

The real "try an agent without risking money" layer. Every recorded
result comes from a REAL Tenderly simulation against REAL current
chain state, nothing here is fabricated or sampled from a
distribution, if an agent has zero simulations, it honestly shows
zero, not a placeholder number.

Storage: a simple JSON file for now (paper_trading_log.json), one
record per simulation, append-only. Swap for a real database later if
volume grows, the interface (record_simulation / get_agent_performance)
stays the same either way.
"""

import json
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

from adapters.tenderly import simulate_transaction, SimulationResult

LOG_PATH = os.path.join(os.path.dirname(__file__), "..", "paper_trading_log.json")


@dataclass
class PaperTradeRecord:
    agent_id: str
    agent_name: str
    task_description: str  # human-readable: what was this simulation trying to do
    simulated_at: str  # ISO timestamp
    success: bool
    gas_used: int | None
    error_message: str | None
    balance_changes: list
    asset_changes: list
    network_id: str


def _load_log() -> list[dict]:
    if not os.path.exists(LOG_PATH):
        return []
    try:
        with open(LOG_PATH, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        # Corrupt or unreadable log, don't crash the whole feature over
        # it, start fresh rather than silently losing the ability to
        # record new results, but this loses old history, worth a
        # print so it's noticed.
        print(f"[paper_trading] WARNING: {LOG_PATH} unreadable, starting a fresh log")
        return []


def _save_log(records: list[dict]) -> None:
    with open(LOG_PATH, "w") as f:
        json.dump(records, f, indent=2)


async def run_paper_trade(
    agent_id: str,
    agent_name: str,
    task_description: str,
    account_slug: str,
    project_slug: str,
    access_key: str,
    network_id: str,
    from_address: str,
    to_address: str,
    input_data: str = "0x",
    value: str = "0",
) -> PaperTradeRecord:
    """Runs one real simulation and records it. Raises if the
    Tenderly call itself fails (network/auth error), that's different
    from the SIMULATED transaction failing (success=False), which is
    a normal, valuable, recorded outcome, not an exception."""
    result: SimulationResult = await simulate_transaction(
        account_slug=account_slug,
        project_slug=project_slug,
        access_key=access_key,
        network_id=network_id,
        from_address=from_address,
        to_address=to_address,
        input_data=input_data,
        value=value,
    )

    record = PaperTradeRecord(
        agent_id=agent_id,
        agent_name=agent_name,
        task_description=task_description,
        simulated_at=datetime.now(timezone.utc).isoformat(),
        success=result.success,
        gas_used=result.gas_used,
        error_message=result.error_message,
        balance_changes=result.balance_changes,
        asset_changes=result.asset_changes,
        network_id=network_id,
    )

    records = _load_log()
    records.append(asdict(record))
    _save_log(records)

    return record


def get_agent_performance(agent_id: str) -> dict:
    """Real, derived stats from actually-recorded simulations for one
    agent. Returns honest zeros/None if this agent has never been
    paper-traded, never a fabricated placeholder."""
    records = [r for r in _load_log() if r["agent_id"] == agent_id]

    if not records:
        return {
            "agent_id": agent_id,
            "total_simulations": 0,
            "success_rate": None,
            "avg_gas_used": None,
            "last_simulated_at": None,
        }

    successes = [r for r in records if r["success"]]
    gas_values = [r["gas_used"] for r in records if r.get("gas_used") is not None]

    return {
        "agent_id": agent_id,
        "total_simulations": len(records),
        "success_rate": round(len(successes) / len(records) * 100, 1),
        "avg_gas_used": round(sum(gas_values) / len(gas_values)) if gas_values else None,
        "last_simulated_at": max(r["simulated_at"] for r in records),
    }


def get_all_agent_performance() -> dict[str, dict]:
    """Every agent that has at least one real simulation on record,
    keyed by agent_id, for surfacing performance across the whole
    marketplace at once (e.g. for ranking) without one API call per
    agent."""
    records = _load_log()
    agent_ids = {r["agent_id"] for r in records}
    return {aid: get_agent_performance(aid) for aid in agent_ids}
