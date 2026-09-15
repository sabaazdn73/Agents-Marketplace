"""
store.py

Cockroach storage for the Hyperliquid collector.

WHY COCKROACH AND NOT MONGO
---------------------------
Mongo is the marketplace's store and sits near its Atlas free-tier quota, which
is metered on dataSize plus indexSize and has already caused a write outage
once. This data is append-only time series that grows every 15 minutes forever,
so putting it there would be pointing a growing series at a store that is
already close to full. Cockroach is separate, empty, and the DSN is already
configured with verify-full TLS.

WHY COUNTS AND NOT ORDERS
-------------------------
Storing every order is not affordable and not necessary. The fastest maker
measured submits about 8,500 orders per minute, which is roughly 12 million
rows per day from one address. Consecutive polls also overlap heavily, so most
of those rows would be duplicates of each other.

What the metrics need is counts grouped by (coin, tif, status), which is tens
of rows per poll rather than 2,000. That grouping preserves every typed status
distinctly, which is the one thing that must not be lost.

THE GAP COLUMN
--------------
`gap_seconds` records whether orders happened between the end of the previous
poll's window and the start of this one. A positive gap means orders were
missed and the sample is not contiguous. It is stored rather than hidden
because a rate computed over an unknown window is not a measurement, and
because this project has already been bitten once by treating an absence of
data as data.
"""

from __future__ import annotations

import datetime as dt
import os
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS hl_poll (
    poll_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    polled_at    TIMESTAMPTZ NOT NULL,
    address      STRING NOT NULL,
    n_records    INT NOT NULL,
    window_start TIMESTAMPTZ,
    window_end   TIMESTAMPTZ,
    alo_share    FLOAT,
    capped       BOOL NOT NULL DEFAULT false,
    gap_seconds  FLOAT,
    month_volume FLOAT,
    INDEX hl_poll_addr_time (address, polled_at DESC),
    INDEX hl_poll_time (polled_at DESC)
);

CREATE TABLE IF NOT EXISTS hl_order_counts (
    poll_id   UUID NOT NULL,
    polled_at TIMESTAMPTZ NOT NULL,
    address   STRING NOT NULL,
    coin      STRING NOT NULL,
    tif       STRING NOT NULL,
    status    STRING NOT NULL,
    n         INT NOT NULL,
    PRIMARY KEY (poll_id, coin, tif, status),
    INDEX hl_counts_addr_time (address, polled_at DESC),
    INDEX hl_counts_coin_time (coin, polled_at DESC),
    INDEX hl_counts_status (status, polled_at DESC)
);

CREATE TABLE IF NOT EXISTS hl_builder_fills (
    builder     STRING NOT NULL,
    day         DATE NOT NULL,
    fill_time   TIMESTAMPTZ NOT NULL,
    user_addr   STRING NOT NULL,
    coin        STRING NOT NULL,
    side        STRING,
    px          FLOAT,
    sz          FLOAT,
    crossed     BOOL,
    tif         STRING,
    counterparty STRING,
    closed_pnl  FLOAT,
    builder_fee FLOAT,
    INDEX hl_bf_builder_day (builder, day),
    INDEX hl_bf_user (user_addr),
    INDEX hl_bf_counterparty (counterparty)
);

CREATE TABLE IF NOT EXISTS hl_targets (
    address      STRING PRIMARY KEY,
    month_volume FLOAT,
    rank         INT,
    refreshed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS hl_builder_days (
    builder   STRING NOT NULL,
    day       DATE NOT NULL,
    rows      INT NOT NULL,
    loaded_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (builder, day)
);
"""


def connect():
    """A psycopg connection using the project's verify-full DSN builder."""
    import psycopg
    from core.cockroach import build_dsn
    return psycopg.connect(build_dsn(), connect_timeout=30)


def ensure_schema(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(SCHEMA)
    conn.commit()


def _ms_to_dt(ms: int | None):
    if not ms:
        return None
    return dt.datetime.fromtimestamp(ms / 1000.0, dt.UTC)


def last_window_end(conn, address: str):
    """End of the most recent stored window for this address, used to work out
    whether the new poll is contiguous with it."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT window_end FROM hl_poll WHERE address = %s "
            "ORDER BY polled_at DESC LIMIT 1", (address,))
        row = cur.fetchone()
    return row[0] if row and row[0] else None


def write_poll(conn, summary: dict, month_volume: float | None = None) -> str:
    """Store one poll and its counts. Returns the poll_id."""
    polled_at = dt.datetime.now(dt.UTC)
    w_start = _ms_to_dt(summary.get("window_start_ms"))
    w_end = _ms_to_dt(summary.get("window_end_ms"))

    prev_end = last_window_end(conn, summary["address"])
    gap = None
    if prev_end and w_start:
        # Positive means orders happened that no poll saw.
        gap = (w_start - prev_end).total_seconds()

    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO hl_poll (polled_at, address, n_records, window_start, "
            "window_end, alo_share, capped, gap_seconds, month_volume) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING poll_id",
            (polled_at, summary["address"], summary["n_records"], w_start, w_end,
             summary.get("alo_share"), bool(summary.get("capped")), gap, month_volume),
        )
        poll_id = cur.fetchone()[0]

        rows = [(poll_id, polled_at, summary["address"], c["coin"], c["tif"],
                 c["status"], c["n"]) for c in summary.get("counts") or []]
        if rows:
            cur.executemany(
                "INSERT INTO hl_order_counts (poll_id, polled_at, address, coin, "
                "tif, status, n) VALUES (%s,%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT DO NOTHING", rows)
    conn.commit()
    return str(poll_id)


def already_loaded(conn, builder: str, day: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM hl_builder_days WHERE builder=%s AND day=%s",
                    (builder, day))
        return cur.fetchone() is not None


def write_builder_fills(conn, builder: str, day: str, rows: list[dict]) -> int:
    """Insert one builder-day of fills. Chunked because a single large
    bulk write against a shared tier times out, the same lesson the subgraph
    backfill learned."""
    if not rows:
        return 0
    payload = []
    for r in rows:
        try:
            payload.append((
                builder, day,
                dt.datetime.fromisoformat(r["time"].replace("Z", "+00:00")),
                (r.get("user") or "").lower(), r.get("coin") or "",
                r.get("side"), float(r.get("px") or 0), float(r.get("sz") or 0),
                str(r.get("crossed")).lower() == "true", r.get("tif"),
                (r.get("counterparty") or "").lower(),
                float(r.get("closed_pnl") or 0), float(r.get("builder_fee") or 0),
            ))
        except (ValueError, KeyError, AttributeError):
            continue

    written = 0
    with conn.cursor() as cur:
        for i in range(0, len(payload), 200):
            cur.executemany(
                "INSERT INTO hl_builder_fills (builder, day, fill_time, user_addr, "
                "coin, side, px, sz, crossed, tif, counterparty, closed_pnl, "
                "builder_fee) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                payload[i:i + 200])
            written += len(payload[i:i + 200])
        cur.execute(
            "UPSERT INTO hl_builder_days (builder, day, rows, loaded_at) "
            "VALUES (%s,%s,%s,%s)", (builder, day, written, dt.datetime.now(dt.UTC)))
    conn.commit()
    return written


def load_targets(conn, max_age_hours: float = 24.0):
    """The stored address set, or None if it is missing or stale.

    The leaderboard is 37MB. Re-downloading it every 15 minutes would be about
    3.5GB a day of somebody else's bandwidth for a set that barely moves, so it
    is refreshed once a day and cached here in between."""
    with conn.cursor() as cur:
        cur.execute("SELECT max(refreshed_at) FROM hl_targets")
        row = cur.fetchone()
        newest = row[0] if row else None
        if not newest:
            return None
        age = (dt.datetime.now(dt.UTC) - newest).total_seconds() / 3600.0
        if age > max_age_hours:
            return None
        cur.execute("SELECT address, month_volume FROM hl_targets ORDER BY rank")
        return [{"address": a, "month_volume": v} for a, v in cur.fetchall()]


def save_targets(conn, targets: list[dict]) -> None:
    now = dt.datetime.now(dt.UTC)
    with conn.cursor() as cur:
        cur.execute("DELETE FROM hl_targets")
        cur.executemany(
            "INSERT INTO hl_targets (address, month_volume, rank, refreshed_at) "
            "VALUES (%s,%s,%s,%s)",
            [(t["address"], t.get("month_volume"), i, now) for i, t in enumerate(targets)])
    conn.commit()
