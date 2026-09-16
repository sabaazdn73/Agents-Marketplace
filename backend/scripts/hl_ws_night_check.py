#!/usr/bin/env python3
"""Did the overnight WebSocket run actually run. One query, no logs.

    cd backend && python3 scripts/hl_ws_night_check.py

Reads hl_ws_coverage, which is the table that exists precisely so this
question has an answer in the data rather than in a log file. A coverage row
is written for every watched address on every closed bucket whether or not
anything was delivered, so an hour the collector was not running is an hour
with no rows, and an hour it was running but deaf is an hour of rows with zero
updates. Those two look identical in a bucket table and different here.

Read the output like this:

    buckets   360 is a complete hour at one bucket per 10 seconds. Fewer means
              the collector was down, or stalled, for the difference.
    subs      how many of the ten sockets held a confirmed subscription. 10 is
              healthy. A number below 10 for a whole hour is the degradation
              that once went unnoticed for 90 minutes.
    updates   orders seen that hour. Zero with subs=10 is a quiet market, not a
              broken collector, which is the distinction this table buys.
    silent    coverage rows with no updates behind them, out of buckets x 10.
    recon     running total of reconnects. Flat is calm. Rising is the socket
              layer doing its job, and only a concern if buckets fell with it.
"""

import datetime as dt
import os
import pathlib
import sys

SQL = """
SELECT date_trunc('hour', bucket_start)                     AS hour,
       count(DISTINCT bucket_start)                         AS buckets,
       count(DISTINCT address) FILTER (WHERE subscribed)    AS subs,
       sum(updates)                                         AS updates,
       count(*) FILTER (WHERE updates = 0)                  AS silent,
       max(reconnects)                                      AS recon
FROM hl_ws_coverage
WHERE bucket_start > now() - INTERVAL '20 hours'
GROUP BY 1
ORDER BY 1
"""


def main():
    env = pathlib.Path(__file__).resolve().parent.parent / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

    from core.cockroach import build_dsn
    import psycopg

    with psycopg.connect(build_dsn(), connect_timeout=30) as conn, conn.cursor() as cur:
        cur.execute(SQL)
        rows = cur.fetchall()

    if not rows:
        print("No coverage rows in the last 20 hours. The collector did not run.")
        return 1

    print(f"{'hour (UTC)':<17}{'buckets':>9}{'subs':>6}{'updates':>12}"
          f"{'silent':>9}{'recon':>7}")
    for hour, buckets, subs, updates, silent, recon in rows:
        flag = "" if buckets >= 355 and subs == 10 else "   <-- look"
        print(f"{hour:%Y-%m-%d %H:%M}  {buckets:>9}{subs:>6}{int(updates or 0):>12,}"
              f"{silent:>9}{int(recon or 0):>7}{flag}")

    # The verdict, from the rows already fetched rather than a second query.
    first, last = rows[0][0], rows[-1][0]
    wall_hours = (last - first).total_seconds() / 3600 + 1
    covered = sum(r[1] for r in rows) / 360
    full = sum(1 for r in rows if r[1] >= 355 and r[2] == 10)
    print(f"\n{covered:.1f} hours of buckets across {wall_hours:.0f} hours of clock, "
          f"{full} of {len(rows)} hours complete with all ten sockets up.")
    if covered < wall_hours - 0.5:
        print(f"Missing about {wall_hours - covered:.1f} hours. The hours marked "
              f"above are where it went.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
