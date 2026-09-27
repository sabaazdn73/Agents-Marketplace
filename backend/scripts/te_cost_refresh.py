"""
te_cost_refresh.py

Runs one tokenized-equity cost cycle by hand, the same code the worker runs
every 15 minutes (core/te/cost_worker.run_cycle), and prints the per-chain
summary. With TE_COST_STORE=file:<dir> it writes JSON files instead of Mongo.

    ./venv/bin/python scripts/te_cost_refresh.py [chain_id ...]
"""

import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from core.te.cost_store import get_store  # noqa: E402
from core.te.cost_worker import CHAIN_ORDER, run_cycle  # noqa: E402

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    chains = tuple(int(x) for x in sys.argv[1:]) or CHAIN_ORDER
    print(json.dumps(asyncio.run(run_cycle(get_store(), chains=chains)), indent=1, default=str))
