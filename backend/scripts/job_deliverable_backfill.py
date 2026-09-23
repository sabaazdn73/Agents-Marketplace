"""
job_deliverable_backfill.py

Standalone, runnable entry point for the one-time `deliverable` backfill
over the ERC-8183 job index (core/job_index.run_deliverable_backfill).

Why a script and not a route: the same reason scripts/full_registry_scan.py
is one. This is a long, resumable batch over every already-indexed job id,
not something a request/response cycle should drive. The scheduled
/api/admin/job-index-batch endpoint is left alone: its forward pass and its
non-terminal re-check both keep working, and neither of them would ever
reach a job already sitting at COMPLETED, which is most of what this pass
exists to fill.

What the field is. `deliverable` is field eleven of the job tuple, a bytes32
the provider passes when it calls submit. It is not evidence that anything
was delivered: the contract checks no preimage, so the value need not be the
digest of anything, nothing need have been published, and no client need have
received anything.

What it turned out to be worth, measured over all 56,798 jobs on 2026-09-23:
every job at SUBMITTED or COMPLETED carries a non-zero value, all distinct,
and no job short of submit carries one. The same contract call writes the
commitment and sets the status, so the field is an identity with `status` and
separates no two delivered jobs. "Every delivery carries a content
commitment" is therefore a true sentence that says nothing, and should not be
quoted as reassurance. The one place the field adds to `status` is 8 EXPIRED
jobs that carry a commitment: submitted, then expired unsettled.

It is indexed for completeness, never as evidence. See
core.rpc.ZERO_DELIVERABLE.

This has already been run once, to completion, against the production database
on 2026-09-23, from this file before it was in version control: 56,798
documents, one additive field, 0 failures. The record of that run, including
what can and cannot be verified from it, is the "The backfill was executed"
section of docs/verification-methodology.md.

Usage (run from backend/, same env as the FastAPI app, needs MONGODB_URI):

    python -m scripts.job_deliverable_backfill status
    python -m scripts.job_deliverable_backfill run --minutes 10
    python -m scripts.job_deliverable_backfill distribution

`run` is resumable and safe to repeat: it checkpoints in the job index's own
progress document and reports `remaining`, the number of indexed jobs still
without the field. Repeat until that reads 0. `distribution` prints the
zero versus non-zero split once the backfill is done, overall and for the
providers holding the most delivered jobs.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

from core import job_index as job_index_mod
from core.db import get_db


async def _cmd_status() -> None:
    db = get_db()
    col = db[job_index_mod.JOB_INDEX_COLLECTION]
    total = await col.count_documents({})
    missing = await col.count_documents({"deliverable": {"$exists": False}})
    progress = await job_index_mod.get_progress()
    print(f"  indexed jobs:            {total}")
    print(f"  without deliverable:     {missing}")
    print(f"  backfill checkpoint:     {progress.get('deliverable_backfill_next_id') or 1}")


async def _cmd_run(minutes: float) -> None:
    deadline = minutes * 60
    done = 0.0
    while done < deadline:
        slice_seconds = min(30.0, deadline - done)
        result = await job_index_mod.run_deliverable_backfill(max_seconds=slice_seconds)
        done += result["elapsed_seconds"]
        print(f"  +{result['updated_this_batch']} written, "
              f"{result['ids_read_this_batch']} ids read in "
              f"{result['multicalls_this_batch']} multicalls, "
              f"next id {result['next_id']}, remaining {result['remaining']}")
        if result["remaining"] == 0:
            print("  backfill complete.")
            return
        if result["ids_read_this_batch"] == 0:
            # Nothing left to read but some documents still lack the field:
            # their reads failed. Stop rather than spin; re-run later.
            print("  no ids read and documents still missing the field, stopping.")
            return


async def _cmd_distribution() -> None:
    dist = await job_index_mod.deliverable_distribution()
    t = dist["totals"]
    delivered = t["non_zero"] + t["zero"] + t["not_indexed"]
    print("\n=== Deliverable commitment, jobs at SUBMITTED or COMPLETED ===")
    print("A non-zero value means the provider passed 32 bytes to submit.")
    print("It is not evidence that anything was produced, published or received,")
    print("and the same call writes it that sets the status, so a non-zero value")
    print("here restates the status rather than adding to it.")
    print(f"  delivered jobs:          {delivered}")
    print(f"  non-zero deliverable:    {t['non_zero']}")
    print(f"  zero deliverable:        {t['zero']}")
    print(f"  field not yet indexed:   {t['not_indexed']}")

    by_provider = dist["by_provider"]
    top = sorted(by_provider.items(), key=lambda kv: -kv[1]["delivered"])[:15]
    print("\n=== By provider, the fifteen with the most delivered jobs ===")
    for addr, row in top:
        print(f"  {addr}  delivered {row['delivered']:>6}  "
              f"non-zero {row['non_zero']:>6}  zero {row['zero']:>6}  "
              f"unindexed {row['not_indexed']:>6}")


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

    if cmd == "status":
        asyncio.run(_cmd_status())
    elif cmd == "run":
        asyncio.run(_cmd_run(_flag_value("--minutes", 10.0)))
    elif cmd == "distribution":
        asyncio.run(_cmd_distribution())
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
