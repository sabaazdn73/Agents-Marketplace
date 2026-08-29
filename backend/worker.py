"""
worker.py

Standalone entrypoint for this project's Render "Background Worker"
service. Runs TWO real, independent, continuous loops concurrently in
one process, not two separate $7/month services:

  1. Escrow-compatibility audit (core/escrow_compat_audit.run_audit_batch)
     — added 2026-08-29.
  2. Full-registry ingestion (core/full_registry_ingest.run_ingest_batch)
     — added 2026-08-29, the same day the user confirmed she's paying for
     both this worker AND 8004scan's Pro tier (3,000 req/min), and asked
     that both actually be used to their real potential. See
     docs/worker-and-ingestion-throughput.md for the full real
     investigation this answers, including why one worker running two
     loops is the real, more cost-effective choice over two services:
     both loops are I/O-bound (waiting on HTTP/Mongo, not CPU), so they
     interleave cheaply on one asyncio event loop with no real resource
     contention — a second $7/month service would buy real isolation
     neither workload actually needs.

Neither loop's own logic changes here — this only changes how often each
one runs (continuously, instead of the single bounded call per HTTP
request their respective /api/admin/*-batch endpoints make). Both
endpoints stay in place as manual fallbacks; both remain on the same
6-hour GitHub Actions schedule as a real, deliberate, redundant safety
net (see .github/workflows/full-registry-batch.yml's own header comment
for why that's intentional, not an oversight).

Reads MONGODB_URI / MONGODB_DB_NAME (via core/db.py, both loops) and
SCAN_8004_API_KEY (ingestion loop only — the escrow audit never needs it,
since check_escrow_compatibility() only reads each agent's already-stored
service_endpoint/description).
"""

import asyncio
import logging
import os
import time

from dotenv import load_dotenv

load_dotenv()

from core.escrow_compat_audit import run_audit_batch  # noqa: E402  (after load_dotenv)
from core.full_registry_ingest import run_ingest_batch  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker")

# ── Escrow-compat audit loop — unchanged from the original single-loop
# worker (2026-08-29), see that commit's own reasoning. ──
AUDIT_BATCH_SECONDS = 90.0
AUDIT_PACE_SECONDS = 5.0
AUDIT_IDLE_SECONDS = 30 * 60


async def audit_loop() -> None:
    log.info("Escrow-compat audit loop starting.")
    consecutive_errors = 0
    while True:
        try:
            result = await run_audit_batch(max_seconds=AUDIT_BATCH_SECONDS)
            consecutive_errors = 0
            log.info(
                "[audit] batch done: audited=%d remaining_due=%d reached_end=%s total_audited_ever=%s elapsed=%.1fs",
                result["audited_this_batch"], result["remaining_due"], result["reached_end"],
                result["total_audited_ever"], result["elapsed_seconds"],
            )
            await asyncio.sleep(AUDIT_IDLE_SECONDS if result["reached_end"] else AUDIT_PACE_SECONDS)
        except Exception:
            consecutive_errors += 1
            backoff = min(300.0, 5.0 * (2 ** min(consecutive_errors, 6)))
            log.exception("[audit] batch failed (consecutive_errors=%d), backing off %.0fs", consecutive_errors, backoff)
            await asyncio.sleep(backoff)


# ── Full-registry ingestion loop — new 2026-08-29. Real batch window
# (300s) chosen for the same reason the audit loop uses 90s: long enough
# to make real, substantial progress per call (with real, live-measured
# concurrency — see core/full_registry_ingest.py's INGEST_CONCURRENCY —
# this covers a lot of real ground in 300s), short enough to log/
# checkpoint often and stay responsive to a real deploy/restart. No
# artificial rate-limiting pacing between batches: the real, live-measured
# concurrency work already stays comfortably under Pro-tier's real
# 3,000 req/min ceiling (see INGEST_CONCURRENCY's own docstring), so
# there's no real reason to add an idle gap here the way the audit loop's
# AUDIT_PACE_SECONDS does for a different real reason (being polite to
# individual third-party agent endpoints, not this project's own paid
# API budget). ──
INGEST_BATCH_SECONDS = 300.0
INGEST_IDLE_SECONDS = 30 * 60


async def ingest_loop() -> None:
    api_key = os.environ.get("SCAN_8004_API_KEY")
    if not api_key:
        log.error("[ingest] SCAN_8004_API_KEY not set — ingestion loop can't run, staying idle.")
        return
    log.info("Full-registry ingestion loop starting.")
    consecutive_errors = 0
    while True:
        try:
            result = await run_ingest_batch(api_key, max_seconds=INGEST_BATCH_SECONDS)
            consecutive_errors = 0
            log.info(
                "[ingest] batch done: pages=%d agents=%d by_chain=%s next_offset=%d reached_end=%s elapsed=%.1fs%s",
                result["pages_done"], result["agents_ingested"], result["by_chain"],
                result["next_offset"], result["reached_end"], result["elapsed_seconds"],
                f" stopped_reason={result['stopped_reason']}" if result.get("stopped_reason") else "",
            )
            await asyncio.sleep(INGEST_IDLE_SECONDS if result["reached_end"] else 0)
        except Exception:
            consecutive_errors += 1
            backoff = min(300.0, 5.0 * (2 ** min(consecutive_errors, 6)))
            log.exception("[ingest] batch failed (consecutive_errors=%d), backing off %.0fs", consecutive_errors, backoff)
            await asyncio.sleep(backoff)


async def main() -> None:
    log.info("Worker starting: escrow-compat audit + full-registry ingestion, concurrently.")
    await asyncio.gather(audit_loop(), ingest_loop())


if __name__ == "__main__":
    start = time.time()
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Worker stopped after %.0fs.", time.time() - start)
