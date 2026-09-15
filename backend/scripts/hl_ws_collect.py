#!/usr/bin/env python3
"""Seconds-resolution collector on the orderUpdates WebSocket feed.

Runs continuously. See core/hyperliquid/ws_collector.py for why it exists
alongside the REST collector rather than replacing it, and for the 10-address
per-IP limit that sets its scope.
"""
import asyncio, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except Exception:
    pass

from core.hyperliquid import store, ws_collector
from core.hyperliquid.collector import REJECTION_STATUSES, POST_ONLY_TIF

REJ = sorted(REJECTION_STATUSES)


def pick_addresses(conn, limit=ws_collector.MAX_WS_USERS):
    """Chosen from the REST collector's own observations: enough post-only
    volume to measure, and a rate strictly inside the bounds, because an
    address pinned at 0 or 1 cannot exhibit or refute persistence."""
    with conn.cursor() as cur:
        cur.execute("""
          SELECT address,
                 coalesce(sum(n) FILTER (WHERE tif=%s),0) alo,
                 coalesce(sum(n) FILTER (WHERE tif=%s AND status = ANY(%s)),0) rej
          FROM hl_order_counts GROUP BY address
        """, (POST_ONLY_TIF, POST_ONLY_TIF, REJ))
        rows = cur.fetchall()
    out = []
    for a, alo, rej in rows:
        alo, rej = int(alo), int(rej)
        if alo < 2000:
            continue
        r = rej / alo
        if r < 0.002 or r > 0.98:
            continue
        out.append((a, alo))
    out.sort(key=lambda x: -x[1])
    return [a for a, _ in out[:limit]]


async def main() -> int:
    conn = store.connect()
    store.ensure_schema(conn)
    addrs = pick_addresses(conn)
    if not addrs:
        print("[hl-ws] no eligible addresses yet; let the REST collector run first",
              flush=True)
        return 1
    print(f"[hl-ws] watching {len(addrs)} addresses", flush=True)
    for a in addrs:
        print(f"[hl-ws]   {a}", flush=True)

    def write(rows):
        # A connection per flush. See write_ws_buckets_fresh for why the
        # long-lived one was the wrong choice here.
        store.write_ws_buckets_fresh(rows)

    stats = await ws_collector.run(addrs, write,
                                   stop_after=float(os.environ.get("HL_WS_SECONDS", 0)) or None)
    print(f"[hl-ws] {stats}", flush=True)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
