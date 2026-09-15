#!/usr/bin/env python3
"""One collection cycle: poll the selected maker set, store typed counts.

Run every 15 minutes. See core/hyperliquid/collector.py for why 50 addresses
and why that cadence; both come from measurements rather than preference.
"""
import os, sys, time, json, datetime as dt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except Exception:
    pass

from core.hyperliquid import collector, store


def main() -> int:
    t0 = time.time()
    print(f"[hl] cycle start {dt.datetime.now(dt.UTC).isoformat()}", flush=True)

    conn = store.connect()
    store.ensure_schema(conn)

    targets = store.load_targets(conn)
    if targets:
        print(f"[hl] using cached target set: {len(targets)} addresses", flush=True)
    else:
        rows = collector.fetch_leaderboard()
        targets = collector.select_addresses(rows, collector.ADDRESS_COUNT)
        store.save_targets(conn, targets)
        print(f"[hl] refreshed target set from {len(rows):,} leaderboard rows "
              f"-> {len(targets)} addresses", flush=True)

    ok = failed = 0
    gaps = 0
    for i, t in enumerate(targets):
        try:
            orders = collector.fetch_orders(t["address"])
            summary = collector.summarise(t["address"], orders)
            store.write_poll(conn, summary, t.get("month_volume"))
            ok += 1
            if summary["n_records"] == 0:
                print(f"[hl]   {t['address'][:10]} no records", flush=True)
        except Exception as e:
            failed += 1
            print(f"[hl]   {t['address'][:10]} FAILED {type(e).__name__}: {str(e)[:90]}", flush=True)
        if i < len(targets) - 1:
            time.sleep(collector.POLL_SPACING_SECONDS)

    with conn.cursor() as cur:
        cur.execute("SELECT count(*), coalesce(sum(n_records),0) FROM hl_poll")
        polls, records = cur.fetchone()
        cur.execute("SELECT count(*) FROM hl_poll WHERE gap_seconds > 0")
        gaps = cur.fetchone()[0]
    conn.close()

    print(f"[hl] done in {time.time()-t0:.0f}s: {ok} ok, {failed} failed. "
          f"store now holds {polls:,} polls / {records:,} order records, "
          f"{gaps:,} polls with a coverage gap", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
