#!/usr/bin/env python3
"""Rebuild the collector's target set on a live rule.

WHY THIS IS A SEPARATE JOB AND NOT PART OF THE CYCLE
-----------------------------------------------------
Two reasons, and they point the same way.

Memory. The leaderboard is a 37MB JSON document of about 45,000 rows, and
parsing it costs several hundred megabytes of Python objects. Both Render
services are OOM-killed on a 512Mi cap (docs/memory-ceiling.md), so this
parse must not happen inside the web process that now runs the poll loop. A
GitHub runner has its own memory and nothing else to take down with it.

Rate budget. Selection probes candidates against historicalOrders, which is
the same endpoint and the same 1,200 weight/minute per-IP budget the poll
cycle spends. Run from a GitHub runner it is a different IP, so the two
cannot starve each other. Run in the same process they would.

Cadence does not matter here. A target set a few hours stale is fine, which
is exactly the property the 15-minute poll loop does not have, and why that
one moved to Render while this one stayed on Actions.
"""
import datetime as dt
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except Exception:
    pass

from core.hyperliquid import collector, store


def main() -> int:
    t0 = time.time()
    print(f"[hl-select] start {dt.datetime.now(dt.UTC).isoformat()}", flush=True)

    rows = collector.fetch_leaderboard()
    print(f"[hl-select] leaderboard: {len(rows):,} rows", flush=True)

    targets = collector.select_active_addresses(rows, collector.ADDRESS_COUNT)
    if not targets:
        print("[hl-select] no address passed the liveness rule, keeping the "
              "existing set rather than emptying it", flush=True)
        return 1

    conn = store.connect()
    store.ensure_schema(conn)
    store.save_targets(conn, targets)

    ages = [t["record_age_seconds"] for t in targets if t.get("record_age_seconds") is not None]
    alos = [t["alo_share"] for t in targets if t.get("alo_share") is not None]
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM hl_targets")
        stored, = cur.fetchone()
    conn.close()

    print(f"[hl-select] stored {stored} targets in {time.time()-t0:.0f}s. "
          f"newest record age: median {sorted(ages)[len(ages)//2]:.0f}s, "
          f"max {max(ages):.0f}s. post-only share: median "
          f"{sorted(alos)[len(alos)//2]:.0%}, min {min(alos):.0%}", flush=True)
    if stored < collector.ADDRESS_COUNT:
        print(f"[hl-select] NOTE: wanted {collector.ADDRESS_COUNT}, found {stored}. "
              f"The probe budget ran out before the quota filled.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
