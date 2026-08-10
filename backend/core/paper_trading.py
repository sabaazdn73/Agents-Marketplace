"""
paper_trading.py

Read-side of the persisted paper-trading history in MongoDB (category-aware
performance + chronological history per agent).

NOTE (Tenderly removed): the earlier simulate-only writer (run_paper_trade,
which ran a Tenderly simulation and persisted the result) has been removed
along with adapters/tenderly.py. The Practice Layer (core/practice_layer.py,
a persistent Anvil fork) is now the real "try before you spend" mechanism and
writes its own history via record_practice_run. These read functions still
serve any previously-persisted paper_trades honestly (empty state if none).

Performance is category-aware, per Saba's correction (9 Aug 2026): not every
agent trades, so "performance" can't be one universal number. Each category
maps to the metric that actually makes sense for what that agent does,
honestly None where nothing was measured.
"""

import os

from motor.motor_asyncio import AsyncIOMotorClient

_client: AsyncIOMotorClient | None = None


def get_db():
    global _client
    if _client is None:
        mongo_uri = os.environ.get("MONGODB_URI")
        if not mongo_uri:
            raise RuntimeError("MONGODB_URI not set, paper trading needs real persistent storage.")
        _client = AsyncIOMotorClient(mongo_uri)
    # Explicit database name, not relying on it being embedded in the
    # URI (MongoDB Atlas connection strings often omit a db name in
    # the path, which breaks get_default_database() with a real,
    # confirmed ConfigurationError, caught via direct testing).
    db_name = os.environ.get("MONGODB_DB_NAME", "agents_marketplace")
    return _client[db_name]


# Which real metric actually reflects "did this agent do its job well",
# per category. Extend this as new categories get added to categorize.py,
# an unmapped category honestly reports metric_type=None rather than
# forcing a number that doesn't mean anything for that kind of work.
CATEGORY_METRIC_MAP: dict[str, str] = {
    "Rebalancing": "gas_efficiency",
    "Grid Trading": "profit_loss",
    "Yield Optimisation": "profit_loss",
    "Health Factor Monitoring": "risk_avoided",
    "Trading Signals": "profit_loss",
    "Copy Trading": "profit_loss",
    "Smart Contract Auditing": "issues_found",
    "Data Analysis": "time_saved",
    "Research": "time_saved",
    "Content & Copywriting": "time_saved",
    "Identity & Verification": "accuracy",
    "Customer Support": "time_saved",
    "NFT & Generative Art": "time_saved",
    "Gaming": "time_saved",
    "Prediction Markets": "accuracy",
    "Social & Community": "time_saved",
    "Payments & Settlement": "gas_efficiency",
    "Developer Tools": "time_saved",
}


async def get_agent_performance(agent_id: str) -> dict:
    """Real, persisted performance for one agent, category-aware.
    Honest empty state if this agent has never been paper-traded."""
    db = get_db()
    records = await db.paper_trades.find({"agent_id": agent_id}).to_list(length=1000)

    if not records:
        return {
            "agent_id": agent_id, "total_simulations": 0, "success_rate": None,
            "metric_type": None, "avg_metric_value": None, "last_simulated_at": None,
        }

    successes = [r for r in records if r["success"]]
    metric_type = records[0].get("metric_type")  # consistent per agent's category
    metric_values = [r["metric_value"] for r in records if r.get("metric_value") is not None]

    return {
        "agent_id": agent_id,
        "total_simulations": len(records),
        "success_rate": round(len(successes) / len(records) * 100, 1),
        "metric_type": metric_type,
        "avg_metric_value": round(sum(metric_values) / len(metric_values), 4) if metric_values else None,
        "last_simulated_at": max(r["simulated_at"] for r in records),
    }


async def get_all_agent_performance() -> dict[str, dict]:
    """Every agent with at least one real, persisted simulation,
    keyed by agent_id."""
    db = get_db()
    agent_ids = await db.paper_trades.distinct("agent_id")
    results = {}
    for aid in agent_ids:
        results[aid] = await get_agent_performance(aid)
    return results


async def get_agent_history(agent_id: str, limit: int = 50) -> list[dict]:
    """The real, persisted, chronological simulation history for one
    agent, so a user can revisit prior results, not just the aggregate."""
    db = get_db()
    records = await db.paper_trades.find({"agent_id": agent_id}) \
        .sort("simulated_at", -1).to_list(length=limit)
    for r in records:
        r["_id"] = str(r["_id"])  # ObjectId isn't JSON-serializable as-is
    return records
