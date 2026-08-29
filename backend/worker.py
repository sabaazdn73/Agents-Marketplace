"""
worker.py

Standalone entrypoint for this project's Render "Background Worker"
service. Runs THREE real, independent, continuous loops concurrently in
one process, not three separate $7/month services:

  1. Escrow-compatibility audit (core/escrow_compat_audit.run_audit_batch)
     — added 2026-08-29. Scoped to `known_agents` (the curated, actually
     displayed/hireable marketplace listing) — deliberately NOT the full,
     unfiltered registry. Confirmed and kept that way 2026-08-29: this
     audit's real purpose (warning a buyer before funding a job with an
     incompatible agent) only applies to agents someone could actually
     try to hire here; auditing the full 785,000+-agent registry would be
     ~54x the real, live HTTP probe volume against endpoints that are
     mostly never surfaced or reachable through this marketplace at all.
  2. Full-registry ingestion (core/full_registry_ingest.run_ingest_batch)
     — added 2026-08-29.
  3. Full-registry analysis — health-check + categorization
     (core/full_registry_analysis.run_analysis_batch) — added 2026-08-29,
     same day as #2, once ingestion sped up enough that the analysis pass
     (previously only running on the same 120s/6h GitHub Actions cadence)
     would otherwise fall permanently behind. See
     docs/full-registry-analysis.md's own "Evaluation coverage guarantee"
     section for the full real mapping of which evaluation steps apply to
     every ingested agent, the real capacity math behind this loop, and
     the real, bounded-backlog guarantee below.

One worker running three loops, not three services: all three are
I/O-bound (waiting on HTTP/Mongo, not CPU), so they interleave cheaply on
one asyncio event loop with no real resource contention on the worker's
own 0.5 CPU/512MB plan.

Real, bounded-backlog guarantee (2026-08-29): ingestion checks the real,
live count of ingested-but-unanalyzed agents before each batch and PAUSES
once it exceeds INGEST_BACKLOG_PAUSE_THRESHOLD, resuming once the
analysis loop brings it back under INGEST_BACKLOG_RESUME_THRESHOLD — so
ingestion can never silently outrun analysis capacity by an unbounded
amount. This is the real, load-bearing mechanism behind "every ingested
agent gets fully evaluated eventually, in a bounded real time" — not a
hope that the two loops' throughputs happen to match.

All three endpoints (/api/admin/escrow-compat-audit-batch,
/api/admin/full-registry-batch, which also runs the analysis pass) stay
in place as manual fallbacks; all remain on the same 6-hour GitHub
Actions schedule as a real, deliberate, redundant safety net (see
.github/workflows/full-registry-batch.yml's own header comment).

Reads MONGODB_URI / MONGODB_DB_NAME (via core/db.py, all three loops) and
SCAN_8004_API_KEY (ingestion loop only).
"""

import asyncio
import logging
import os
import time

from dotenv import load_dotenv

load_dotenv()

from core.escrow_compat_audit import run_audit_batch  # noqa: E402  (after load_dotenv)
from core.full_registry_ingest import run_ingest_batch  # noqa: E402
from core.full_registry_analysis import run_analysis_batch, get_unanalyzed_backlog  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker")

# ── Escrow-compat audit loop — unchanged, see the original single-loop
# worker's own commit for the real reasoning behind these numbers. ──
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


# ── Full-registry analysis loop — health-check + categorization, new
# 2026-08-29. Real, live-measured throughput at the time this was built:
# 300 agents / 18.8s ≈ 16 agents/sec ≈ 57,600/hour sustained. batch_size
# matches the existing HTTP-endpoint default (300) — not increased here;
# agent_health.py's own internal concurrency (_CONCURRENCY = 12) is
# deliberately left as-is, since it's tuned to be polite to hundreds of
# DIFFERENT, arbitrary third-party agent hosts plus one shared public
# IPFS gateway (ipfs.io) — a genuinely different real concern from
# INGEST_CONCURRENCY's own tuning against one paid, dedicated-capacity
# API this project has explicit headroom on. Raising it wasn't needed for
# the real guarantee this loop exists for (see INGEST_BACKLOG_PAUSE_
# THRESHOLD below, the actual load-bearing mechanism) — flagged in docs
# as a real, separate, not-yet-taken lever if more raw throughput is ever
# wanted later. ──
ANALYSIS_BATCH_SIZE = 300
ANALYSIS_IDLE_SECONDS = 5 * 60


async def analysis_loop() -> None:
    log.info("Full-registry analysis loop starting.")
    consecutive_errors = 0
    while True:
        try:
            result = await run_analysis_batch(batch_size=ANALYSIS_BATCH_SIZE)
            consecutive_errors = 0
            log.info("[analysis] batch done: checked=%d done=%s", result["checked"], result["done"])
            await asyncio.sleep(ANALYSIS_IDLE_SECONDS if result["done"] else 0)
        except Exception:
            consecutive_errors += 1
            backoff = min(300.0, 5.0 * (2 ** min(consecutive_errors, 6)))
            log.exception("[analysis] batch failed (consecutive_errors=%d), backing off %.0fs", consecutive_errors, backoff)
            await asyncio.sleep(backoff)


# ── Full-registry ingestion loop — new 2026-08-29, real concurrent
# fetching (see core/full_registry_ingest.py's own INGEST_CONCURRENCY).
#
# Real, bounded-backlog guarantee: this is the actual mechanism behind
# "every ingested agent gets fully evaluated eventually, in a bounded
# real time" — not a hope that ingestion and analysis throughput happen
# to match (real, measured, they don't: ingestion alone can run several
# times faster than analysis alone). Real, live backlog (ingested minus
# analyzed) is checked before every batch; ingestion pauses once it's
# >= INGEST_BACKLOG_PAUSE_THRESHOLD and only resumes once the analysis
# loop brings it back <= INGEST_BACKLOG_RESUME_THRESHOLD — a real
# hysteresis band so the two loops don't flap pause/resume right at one
# boundary value. At analysis's own real, measured ~16 agents/sec, a
# 25,000-agent backlog is a real, bounded worst case of about 26 minutes
# to clear, not an unbounded, silently growing gap. ──
INGEST_BATCH_SECONDS = 300.0
INGEST_BACKLOG_PAUSE_THRESHOLD = 25_000
INGEST_BACKLOG_RESUME_THRESHOLD = 15_000
INGEST_BACKLOG_CHECK_PACE_SECONDS = 15.0
INGEST_IDLE_SECONDS = 30 * 60


async def ingest_loop() -> None:
    api_key = os.environ.get("SCAN_8004_API_KEY")
    if not api_key:
        log.error("[ingest] SCAN_8004_API_KEY not set — ingestion loop can't run, staying idle.")
        return
    log.info("Full-registry ingestion loop starting.")
    consecutive_errors = 0
    paused = False
    while True:
        try:
            backlog = await get_unanalyzed_backlog()
            if not paused and backlog >= INGEST_BACKLOG_PAUSE_THRESHOLD:
                paused = True
                log.warning(
                    "[ingest] pausing: real unanalyzed backlog is %d (>= %d) — waiting for the analysis loop "
                    "to catch up before ingesting more.",
                    backlog, INGEST_BACKLOG_PAUSE_THRESHOLD,
                )
            if paused:
                if backlog <= INGEST_BACKLOG_RESUME_THRESHOLD:
                    paused = False
                    log.info("[ingest] resuming: real unanalyzed backlog dropped to %d (<= %d).",
                              backlog, INGEST_BACKLOG_RESUME_THRESHOLD)
                else:
                    await asyncio.sleep(INGEST_BACKLOG_CHECK_PACE_SECONDS)
                    continue

            result = await run_ingest_batch(api_key, max_seconds=INGEST_BATCH_SECONDS)
            consecutive_errors = 0
            log.info(
                "[ingest] batch done: pages=%d agents=%d by_chain=%s next_offset=%d reached_end=%s "
                "backlog=%d elapsed=%.1fs%s",
                result["pages_done"], result["agents_ingested"], result["by_chain"],
                result["next_offset"], result["reached_end"], backlog, result["elapsed_seconds"],
                f" stopped_reason={result['stopped_reason']}" if result.get("stopped_reason") else "",
            )
            await asyncio.sleep(INGEST_IDLE_SECONDS if result["reached_end"] else 0)
        except Exception:
            consecutive_errors += 1
            backoff = min(300.0, 5.0 * (2 ** min(consecutive_errors, 6)))
            log.exception("[ingest] batch failed (consecutive_errors=%d), backing off %.0fs", consecutive_errors, backoff)
            await asyncio.sleep(backoff)


async def main() -> None:
    log.info("Worker starting: escrow-compat audit + full-registry ingestion + full-registry analysis, concurrently.")
    await asyncio.gather(audit_loop(), ingest_loop(), analysis_loop())


if __name__ == "__main__":
    start = time.time()
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Worker stopped after %.0fs.", time.time() - start)
