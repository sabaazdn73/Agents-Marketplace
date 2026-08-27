"""
full_registry_scan.py

Real, standalone, runnable entry point for the full-BSC-registry ingestion
+ analysis pipeline (core/full_registry_ingest.py, core/full_registry_analysis.py).
Deliberately a plain script, not a web route — this is a long-running,
resumable batch job (see full_registry_ingest.py's own docstring for why a
literal one-shot full scan isn't realistic), not something a web request/
response cycle should try to drive.

Usage (run from backend/, same real env as the FastAPI app — needs
SCAN_8004_API_KEY and MONGODB_URI):

    python -m scripts.full_registry_scan ingest --minutes 30
    python -m scripts.full_registry_scan analyze --minutes 30
    python -m scripts.full_registry_scan status

Real, recommended schedule (not automatically wired into any scheduler by
this script — see this project's own README on why adding a paid Render
Cron Job service is a deliberate infra decision, flagged rather than made
unilaterally):
  - A `ingest --minutes 30` run, repeated every few hours until
    `status` reports `completed_at` set, to build out full_bsc_registry
    the first time.
  - After that, a full re-ingest weekly (agents get added to the real
    registry continuously; a week-old full snapshot is a real, reasonable
    staleness bound for a dataset this size) — same command, since a
    completed run's checkpoint naturally needs resetting to offset 0 for a
    fresh pass (this script's `ingest --restart` flag does that).
  - `analyze --minutes 30`, run on a similar cadence, health-checks/
    categorizes whatever's been ingested but not yet analyzed — the real
    HEALTH_TTL_SECONDS (20 min, core/agent_health.py) means a health check
    written today is treated as stale again in 20 minutes, so more
    frequent analysis passes mostly just refresh already-checked agents
    rather than making new real progress; daily is more than enough to
    keep pace with ingestion without wasting the real request budget.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

from core import full_registry_ingest as ingest_mod
from core import full_registry_analysis as analysis_mod


async def _cmd_ingest(minutes: float, restart: bool) -> None:
    api_key = os.environ.get("SCAN_8004_API_KEY")
    if not api_key:
        print("SCAN_8004_API_KEY not set — cannot ingest.")
        return
    if restart:
        progress = await ingest_mod._get_progress()
        progress.update({"next_offset": 0, "completed_at": None, "started_at": None})
        await ingest_mod._save_progress(progress)
        print("Checkpoint reset to offset 0 for a fresh full pass.")

    result = await ingest_mod.run_ingest_batch(api_key, max_seconds=minutes * 60)
    print(f"Ingest batch done: {result}")


async def _cmd_analyze(minutes: float) -> None:
    import time
    t0 = time.time()
    total_checked = 0
    while time.time() - t0 < minutes * 60:
        result = await analysis_mod.run_analysis_batch(batch_size=300)
        total_checked += result["checked"]
        print(f"  analyzed batch: {result}")
        if result.get("done"):
            print("Analysis is fully caught up with everything ingested so far.")
            break
    print(f"Analysis run done: {total_checked} agents checked this run.")


async def _cmd_status() -> None:
    progress = await ingest_mod.get_progress()
    stats = await analysis_mod.compute_full_registry_stats()
    print("=== Ingestion progress ===")
    for k, v in progress.items():
        print(f"  {k}: {v}")
    print("\n=== Analysis stats (partial unless ingestion is complete AND total_analyzed == total_ingested) ===")
    for k, v in stats.items():
        print(f"  {k}: {v}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]
    args = sys.argv[2:]

    def _flag_value(name: str, default: float) -> float:
        for i, a in enumerate(args):
            if a == name and i + 1 < len(args):
                return float(args[i + 1])
        return default

    if cmd == "ingest":
        asyncio.run(_cmd_ingest(_flag_value("--minutes", 10.0), "--restart" in args))
    elif cmd == "analyze":
        asyncio.run(_cmd_analyze(_flag_value("--minutes", 10.0)))
    elif cmd == "status":
        asyncio.run(_cmd_status())
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
