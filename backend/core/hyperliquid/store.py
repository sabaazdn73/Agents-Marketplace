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

CREATE TABLE IF NOT EXISTS hl_ws_buckets (
    bucket_start TIMESTAMPTZ NOT NULL,
    address      STRING NOT NULL,
    coin         STRING NOT NULL,
    status       STRING NOT NULL,
    n            INT NOT NULL,
    PRIMARY KEY (bucket_start, address, coin, status),
    INDEX hl_ws_addr_time (address, bucket_start DESC),
    INDEX hl_ws_status (status, bucket_start DESC)
);

CREATE TABLE IF NOT EXISTS hl_targets (
    address      STRING PRIMARY KEY,
    month_volume FLOAT,
    rank         INT,
    refreshed_at TIMESTAMPTZ NOT NULL
);

-- Selection provenance. Added 2026-09-15 when the target set was rebuilt on a
-- live rule: these record WHY an address was kept, measured at selection time,
-- so a later reader can tell a still-good choice from a stale one.
ALTER TABLE hl_targets ADD COLUMN IF NOT EXISTS alo_share FLOAT;
ALTER TABLE hl_targets ADD COLUMN IF NOT EXISTS record_age_seconds FLOAT;
ALTER TABLE hl_targets ADD COLUMN IF NOT EXISTS probed_at TIMESTAMPTZ;

-- WebSocket coverage, recorded per bucket per address REGARDLESS of traffic.
--
-- hl_ws_buckets only has rows where updates happened, so an address that
-- delivers nothing has no rows at all, and "6 of 10 addresses" could only ever
-- be reconstructed afterwards from missing keys. Worse, absence there is
-- ambiguous: a subscribed-but-idle maker and a silently dead subscription look
-- identical.
--
-- This is the WebSocket analogue of hl_poll.gap_seconds. A row is written for
-- every address being watched on every flush, so zero updates is a recorded
-- fact with a reason attached rather than an absence to be inferred.
CREATE TABLE IF NOT EXISTS hl_ws_coverage (
    bucket_start      TIMESTAMPTZ NOT NULL,
    address           STRING NOT NULL,
    -- Did we hold a subscription the server CONFIRMED during this bucket.
    subscribed        BOOL NOT NULL,
    -- When the server last acknowledged the subscription on the live socket.
    confirmed_at      TIMESTAMPTZ,
    -- Seconds since this socket last delivered anything. Large with
    -- subscribed=true is the signature of a quiet maker; large and climbing
    -- past the idle deadline is what now forces a reconnect.
    idle_seconds      FLOAT,
    updates           INT NOT NULL DEFAULT 0,
    reconnects        INT NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_start, address),
    INDEX hl_wsc_addr_time (address, bucket_start DESC),
    INDEX hl_wsc_time (bucket_start DESC)
);

-- The venue's own leaderboard file, kept rather than discarded.
--
-- WHY THIS TABLE EXISTS, added 2026-09-19
-- hl_select_targets.py fetched all 46,171 rows every day, took the 31 it
-- wanted, and threw the rest away. Meanwhile an address outside the rotation
-- got a panel that said nothing at all, which reads as broken rather than as
-- honest: the venue publishes an account value, four PnL windows and four
-- volume windows for every one of those addresses, and this project was
-- already downloading them daily.
--
-- EVERY COLUMN HERE IS THE VENUE'S, NOT OURS. Nothing in this table is
-- measured by this project. It is a cached copy of a file Hyperliquid
-- publishes, and every surface that renders it has to say so, the same way
-- the 30-day volume column on the tab does.
--
-- Soundness: checked 2026-09-19 against the venue's own portfolio endpoint
-- over 60 randomly sampled addresses. Median disagreement 0.17% of account
-- value on allTime and 0.41% on month. allTime is since inception, confirmed
-- by its history spanning 13 days for a new account and 1,101 for an old one.
-- accountValue is perps, spot, staking and vault equity together, which is
-- why it does not match clearinghouseState and must not be compared to it.
CREATE TABLE IF NOT EXISTS hl_role_summary (
    id          STRING PRIMARY KEY,
    payload     JSONB NOT NULL,
    measured_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS hl_leaderboard (
    address       STRING PRIMARY KEY,
    account_value FLOAT,
    day_pnl     FLOAT, day_roi     FLOAT, day_vlm     FLOAT,
    week_pnl    FLOAT, week_roi    FLOAT, week_vlm    FLOAT,
    month_pnl   FLOAT, month_roi   FLOAT, month_vlm   FLOAT,
    alltime_pnl FLOAT, alltime_roi FLOAT, alltime_vlm FLOAT,
    -- Rank by 30-day volume, which is the ordering that selects the rotation.
    -- Stored so a panel can say where an address sits among all of them
    -- rather than only what it traded.
    volume_rank   INT,
    rows_in_file  INT,
    fetched_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS hl_builder_days (
    builder   STRING NOT NULL,
    day       DATE NOT NULL,
    rows      INT NOT NULL,
    loaded_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (builder, day)
);
"""


# Keepalive settings, chosen so a silently dead peer fails the socket in about
# a minute: 30s idle before the first probe, then 3 probes 10s apart.
_KEEPALIVE_IDLE = 30
_KEEPALIVE_INTERVAL = 10
_KEEPALIVE_COUNT = 3

# Server-side ceiling for the WebSocket collector's per-flush writes. Below
# ws_collector.WRITE_TIMEOUT_SECONDS so a reachable-but-slow cluster fails with
# the database's own message rather than with the collector's deadline. Not
# applied to the shared connections: ensure_schema runs ALTER TABLE ADD COLUMN,
# which is a schema-change job on Cockroach and has no business being cut off
# at 30 seconds.
_WS_WRITE_STATEMENT_TIMEOUT_MS = 30_000


def connect(*, statement_timeout_ms: int | None = None):
    """A psycopg connection using the project's verify-full DSN builder.

    WHY THERE ARE FOUR TIMEOUTS HERE AND NOT ONE
    --------------------------------------------
    `connect_timeout` bounds the handshake and nothing after it. Once the
    connection is up, every psycopg call blocks inside libpq on a socket read,
    and a socket read has no deadline of its own. If the peer stops answering
    without sending a FIN or an RST, which is what a vanished network looks
    like, that read waits for as long as the process lives. That is the
    condition the WebSocket collector hit, and the reason a flush could block
    forever while the caller's timeout fired and moved on.

    Each parameter covers a case the others do not:

      connect_timeout   the handshake only.
      keepalives*       the kernel probes a silent peer and fails the socket
                        after idle + interval * count, about 60 seconds here.
                        This is the one that covers the vanished network, and
                        it is the reason a blocked write now returns.
      tcp_user_timeout  bounds data already sent and not acknowledged. Linux
                        only; libpq ignores it elsewhere, so it covers the
                        Render services and not the laptop the WebSocket
                        collector runs from.
      statement_timeout server-side, so it only fires when the server is
                        reachable and answering. It bounds a slow query and
                        says nothing about a dead network.

    What none of them bound is a call blocked inside libpq on something other
    than a socket. A caller that must not be held up still needs to be able to
    walk away from the thread; see ws_collector._write_detached.
    """
    import psycopg
    from core.cockroach import build_dsn

    options = None
    if statement_timeout_ms:
        options = f"-c statement_timeout={int(statement_timeout_ms)}"

    kwargs = dict(
        connect_timeout=30,
        keepalives=1,
        keepalives_idle=_KEEPALIVE_IDLE,
        keepalives_interval=_KEEPALIVE_INTERVAL,
        keepalives_count=_KEEPALIVE_COUNT,
        # 60s, matching the keepalive budget. Ignored on macOS.
        tcp_user_timeout=60_000,
    )
    if options:
        kwargs["options"] = options
    return psycopg.connect(build_dsn(), **kwargs)


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
            "INSERT INTO hl_targets (address, month_volume, rank, refreshed_at, "
            "alo_share, record_age_seconds, probed_at) VALUES (%s,%s,%s,%s,%s,%s,%s)",
            [(t["address"], t.get("month_volume"), i, now,
              t.get("alo_share"), t.get("record_age_seconds"),
              now if t.get("record_age_seconds") is not None else None)
             for i, t in enumerate(targets)])
    conn.commit()


def write_ws_coverage_fresh(rows: list[dict]) -> int:
    """Coverage rows on their own connection, same reasoning as the buckets."""
    if not rows:
        return 0
    with connect(statement_timeout_ms=_WS_WRITE_STATEMENT_TIMEOUT_MS) as conn:
        return write_ws_coverage(conn, rows)


def write_ws_coverage(conn, rows: list[dict]) -> int:
    """One row per watched address per bucket, written whether or not that
    address delivered anything.

    UPSERT for the same reason the buckets use it: a late flush may revisit a
    bucket, and coverage for a bucket is a statement about the window rather
    than a running total, so the last writer wins."""
    if not rows:
        return 0
    payload = [(r["bucket_start"], r["address"], r["subscribed"],
                r.get("confirmed_at"), r.get("idle_seconds"),
                r.get("updates", 0), r.get("reconnects", 0)) for r in rows]
    with conn.cursor() as cur:
        for i in range(0, len(payload), 200):
            cur.executemany(
                "UPSERT INTO hl_ws_coverage (bucket_start, address, subscribed, "
                "confirmed_at, idle_seconds, updates, reconnects) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s)", payload[i:i + 200])
    conn.commit()
    return len(payload)


def write_ws_buckets_fresh(rows: list[dict]) -> int:
    """Write on a connection opened for this flush and closed after it.

    The collector runs for hours between writes to any one bucket set, and a
    connection held open across that is a connection the server has probably
    already dropped. Opening per flush costs a handshake and removes a class
    of silent stall."""
    if not rows:
        return 0
    with connect(statement_timeout_ms=_WS_WRITE_STATEMENT_TIMEOUT_MS) as conn:
        return write_ws_buckets(conn, rows)


def write_ws_buckets(conn, rows: list[dict]) -> int:
    """Store closed WebSocket buckets.

    UPSERT rather than INSERT because a reconnect can replay part of a bucket
    that was already written, and a duplicate would inflate the count. The
    primary key makes the bucket idempotent."""
    if not rows:
        return 0
    payload = [(r["bucket_start"], r["address"], r["coin"], r["status"], r["n"])
               for r in rows]
    with conn.cursor() as cur:
        for i in range(0, len(payload), 200):
            cur.executemany(
                "UPSERT INTO hl_ws_buckets (bucket_start, address, coin, status, n) "
                "VALUES (%s,%s,%s,%s,%s)", payload[i:i + 200])
    conn.commit()
    return len(payload)


def write_leaderboard(conn, rows: list[dict], fetched_at=None) -> int:
    """Replace the cached copy of the venue's leaderboard file.

    UPSERT plus a delete of anything not in this file, rather than TRUNCATE
    then insert. An address that drops off the leaderboard has to disappear
    from here too, or a panel would keep quoting a figure the venue no longer
    publishes, with a fetched_at that says it is current.

    Batched because this is 46,000 rows against a serverless cluster and one
    statement that size is a transaction nobody wants retried.
    """
    import datetime as dt
    if not rows:
        return 0
    stamp = fetched_at or dt.datetime.now(dt.timezone.utc)
    ranked = sorted(rows, key=lambda r: _window(r, "month", "vlm"), reverse=True)
    total = len(ranked)
    payload = []
    for i, r in enumerate(ranked):
        addr = (r.get("ethAddress") or "").lower()
        if not addr.startswith("0x") or len(addr) != 42:
            continue
        payload.append((
            addr, _f(r.get("accountValue")),
            _window(r, "day", "pnl"), _window(r, "day", "roi"), _window(r, "day", "vlm"),
            _window(r, "week", "pnl"), _window(r, "week", "roi"), _window(r, "week", "vlm"),
            _window(r, "month", "pnl"), _window(r, "month", "roi"), _window(r, "month", "vlm"),
            _window(r, "allTime", "pnl"), _window(r, "allTime", "roi"), _window(r, "allTime", "vlm"),
            i + 1, total, stamp,
        ))
    with conn.cursor() as cur:
        for i in range(0, len(payload), 500):
            cur.executemany(
                """UPSERT INTO hl_leaderboard (
                     address, account_value,
                     day_pnl, day_roi, day_vlm,
                     week_pnl, week_roi, week_vlm,
                     month_pnl, month_roi, month_vlm,
                     alltime_pnl, alltime_roi, alltime_vlm,
                     volume_rank, rows_in_file, fetched_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                payload[i:i + 500])
        conn.commit()
        cur.execute("DELETE FROM hl_leaderboard WHERE fetched_at < %s", (stamp,))
    conn.commit()
    return len(payload)


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _window(row: dict, name: str, field: str):
    for w in row.get("windowPerformances") or []:
        if w and w[0] == name:
            return _f((w[1] or {}).get(field))
    return None


# ── The account-role summary, persisted ─────────────────────────────────────
#
# The venue rate-limits: 25 userRole calls with no pause returned 14 HTTP 429s
# when that was measured. Reading three calls for each of 68 addresses inside
# one web request therefore answers for a handful and reports the rest as
# unanswered, which is truthful and useless. So it is computed on a schedule,
# in the background, at a pace the venue tolerates, and the page reads the
# stored answer with the time it was taken.

ROLE_SUMMARY_ID = "current"


def read_role_summary(conn) -> dict | None:
    with conn.cursor() as cur:
        cur.execute("SELECT payload, measured_at FROM hl_role_summary WHERE id = %s",
                    (ROLE_SUMMARY_ID,))
        row = cur.fetchone()
    if not row:
        return None
    payload, measured_at = row
    out = dict(payload or {})
    out["measured_at"] = measured_at.isoformat() if measured_at else None
    return out


def write_role_summary(conn, payload: dict) -> None:
    import json as _json
    with conn.cursor() as cur:
        cur.execute(
            "UPSERT INTO hl_role_summary (id, payload, measured_at) VALUES (%s, %s, now())",
            (ROLE_SUMMARY_ID, _json.dumps(payload)))
    conn.commit()
