"""
worker.py

Standalone entrypoint for the escrow-compatibility audit background worker
(Render "Background Worker" service, added 2026-08-29). Runs
core/escrow_compat_audit.run_audit_batch() continuously and resumably in a
loop, instead of the single bounded call per HTTP request the existing
/api/admin/escrow-compat-audit-batch endpoint makes.

The audit itself doesn't change here — this only changes how often it runs.
That endpoint stays in place for the GitHub Actions scheduled workflow as a
fallback path (see the note in .github/workflows/full-registry-batch.yml),
but with this worker running continuously, the scheduled step becomes
redundant for this particular audit and can be dropped.

Only reads MONGODB_URI / MONGODB_DB_NAME (via core/db.py) — no other env
var is needed, since check_escrow_compatibility() only needs each agent's
already-stored service_endpoint/description.
"""

import asyncio
import logging
import time

from dotenv import load_dotenv

load_dotenv()

from core.escrow_compat_audit import run_audit_batch  # noqa: E402  (after load_dotenv)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("escrow_compat_worker")

# Seconds of audit work per batch call before yielding back to this loop —
# long enough to make real progress, short enough to log/checkpoint often.
BATCH_SECONDS = 90.0

# Short pacing gap between batches while there's still due work, so this
# doesn't hammer the target agents' endpoints back-to-back forever.
PACE_SECONDS = 5.0

# Once every due agent has been covered, there's nothing to do until the
# 7-day TTL (AUDIT_TTL_SECONDS) starts making agents due again — poll
# occasionally rather than busy-looping.
IDLE_SECONDS = 30 * 60


async def main() -> None:
    log.info("Escrow-compat audit worker starting.")
    consecutive_errors = 0
    while True:
        try:
            result = await run_audit_batch(max_seconds=BATCH_SECONDS)
            consecutive_errors = 0
            log.info(
                "batch done: audited=%d remaining_due=%d reached_end=%s total_audited_ever=%s elapsed=%.1fs",
                result["audited_this_batch"],
                result["remaining_due"],
                result["reached_end"],
                result["total_audited_ever"],
                result["elapsed_seconds"],
            )
            await asyncio.sleep(IDLE_SECONDS if result["reached_end"] else PACE_SECONDS)
        except Exception:
            consecutive_errors += 1
            backoff = min(300.0, 5.0 * (2 ** min(consecutive_errors, 6)))
            log.exception("batch failed (consecutive_errors=%d), backing off %.0fs", consecutive_errors, backoff)
            await asyncio.sleep(backoff)


if __name__ == "__main__":
    start = time.time()
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Worker stopped after %.0fs.", time.time() - start)
