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

    # Targets are never built here any more. Selection parses a 37MB
    # leaderboard and spends the same per-IP rate budget this cycle needs, and
    # this now runs inside the Render web process where neither is affordable.
    # scripts/hl_select_targets.py owns it, on a GitHub runner, on its own IP.
    targets = store.load_targets(conn)
    if not targets:
        print("[hl] no target set stored. Run scripts/hl_select_targets.py "
              "(or the 'Hyperliquid target refresh' workflow) first.", flush=True)
        conn.close()
        return 1
    print(f"[hl] using stored target set: {len(targets)} addresses", flush=True)

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
