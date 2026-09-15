"""
service.py

Read side for the Hyperliquid tab. Queries Cockroach, returns plain dicts.

THE HONESTY RULE THIS FILE ENFORCES
-----------------------------------
Every response carries the window it was computed over and the number of
observations behind it. The tab is new, so on day one it holds hours rather
than history, and a rate from two polls must not be presented the way a rate
from two weeks would be.

This reuses the threshold discipline already used for budget records, where a
rate derived from fewer than five budgets is withheld rather than shown: a
number computed from one or two data points is a number pretending to be
evidence. Here the same idea applies to polls.
"""

from __future__ import annotations

import datetime as dt

from core.hyperliquid.collector import REJECTION_STATUSES, POST_ONLY_TIF

# Below this many polls for an address, rates are returned as null with the
# observation count still shown, so the UI can say "not enough yet" rather
# than render a spurious precise figure.
MIN_POLLS_FOR_RATE = 5

_REJ = tuple(sorted(REJECTION_STATUSES))


def _conn():
    from core.hyperliquid import store
    return store.connect()


def coverage() -> dict:
    """What the dataset actually contains. Shown at the top of the tab so the
    thinness of a new dataset is the first thing a reader sees, not something
    they have to infer."""
    with _conn() as c, c.cursor() as cur:
        cur.execute("SELECT count(*), count(DISTINCT address), min(polled_at), "
                    "max(polled_at) FROM hl_poll")
        polls, addrs, first, last = cur.fetchone()
        cur.execute("SELECT coalesce(sum(n),0) FROM hl_order_counts")
        orders = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM hl_poll WHERE gap_seconds > 0")
        gapped = cur.fetchone()[0]
    hours = ((last - first).total_seconds() / 3600.0) if (first and last) else 0.0
    return {
        "polls": polls or 0,
        "addresses": addrs or 0,
        "orders_observed": int(orders or 0),
        "first_poll": first.isoformat() if first else None,
        "last_poll": last.isoformat() if last else None,
        "hours_covered": round(hours, 2),
        "polls_with_gap": gapped or 0,
        "min_polls_for_rate": MIN_POLLS_FOR_RATE,
    }


# An address whose newest OBSERVED ORDER is older than this is not described
# with a current rate, however many polls it has.
#
# This is the lesson from 2026-09-15. historicalOrders can return a full 2,000
# records that are months old: the highest-volume address on the venue, trading
# billions a day, returned a fourteen-minute window from 147 days earlier. A
# poll count therefore says nothing about whether the data behind it is
# current, and polled_at says nothing either, because the poll succeeded. The
# only field that answers the question is the age of the newest order seen.
MAX_RECORD_AGE_SECONDS = 3600


def address_detail(address: str) -> dict:
    """Everything known about one address, with the reason attached when a
    number is withheld.

    Withholding is the point. An address can fail to produce a rate in three
    distinct ways, and a caller that cannot tell them apart will render "0%"
    for all three."""
    addr = (address or "").strip().lower()
    if not addr.startswith("0x") or len(addr) != 42:
        return {"address": address, "error": "not an address"}

    now = dt.datetime.now(dt.UTC)
    with _conn() as c, c.cursor() as cur:
        cur.execute("""
            SELECT count(*), max(polled_at), max(window_end), max(month_volume),
                   count(*) FILTER (WHERE gap_seconds > 0)
            FROM hl_poll WHERE address = %s""", (addr,))
        polls, last_polled, newest_record, month_volume, gapped = cur.fetchone()

        cur.execute("SELECT count(*) FROM hl_targets WHERE address = %s", (addr,))
        tracked = (cur.fetchone()[0] or 0) > 0

        cur.execute(f"""
            SELECT coalesce(sum(n) FILTER (WHERE tif = %s), 0),
                   coalesce(sum(n) FILTER (WHERE tif = %s AND status = ANY(%s)), 0),
                   coalesce(sum(n) FILTER (WHERE status = 'filled'), 0),
                   coalesce(sum(n) FILTER (WHERE status = 'canceled'), 0),
                   coalesce(sum(n), 0)
            FROM hl_order_counts WHERE address = %s""",
            (POST_ONLY_TIF, POST_ONLY_TIF, list(_REJ), addr))
        alo_total, alo_rejected, filled, cancels, total = cur.fetchone()

    age = (now - newest_record).total_seconds() if newest_record else None
    enough_polls = (polls or 0) >= MIN_POLLS_FOR_RATE
    is_current = age is not None and age <= MAX_RECORD_AGE_SECONDS

    # Order matters: not tracked is reported before thin, and thin before
    # stale, because that is the order in which a reader can act on them.
    if not polls:
        withheld = "not_tracked" if not tracked else "no_polls_yet"
    elif not enough_polls:
        withheld = "too_few_polls"
    elif not is_current:
        withheld = "stale_data"
    elif not alo_total:
        withheld = "no_post_only_orders"
    else:
        withheld = None

    rate = (alo_rejected / alo_total) if (withheld is None and alo_total) else None
    band = None
    if rate is not None:
        for name, lo, hi in BANDS:
            if lo <= rate < hi:
                band = name
                break

    return {
        "address": addr,
        "tracked": tracked,
        "as_of": now.isoformat(),
        "freshness": {
            "polls": polls or 0,
            "min_polls_for_rate": MIN_POLLS_FOR_RATE,
            "last_polled_at": last_polled.isoformat() if last_polled else None,
            "newest_record_at": newest_record.isoformat() if newest_record else None,
            "newest_record_age_seconds": round(age, 1) if age is not None else None,
            "max_record_age_seconds": MAX_RECORD_AGE_SECONDS,
            "is_current": is_current,
            "enough_polls": enough_polls,
            "polls_with_gap": gapped or 0,
        },
        "post_only": {
            "rejection_rate": rate,
            "band": band,
            "alo_total": int(alo_total or 0),
            "alo_rejected": int(alo_rejected or 0),
        },
        "observed": {
            "orders": int(total or 0),
            "filled": int(filled or 0),
            "canceled": int(cancels or 0),
            "month_volume": month_volume,
        },
        "withheld_reason": withheld,
    }


def makers(limit: int = 50) -> list[dict]:
    """Per-address metrics, pooled over every poll stored for that address.

    Pooled rather than averaged across polls on purpose: averaging per-poll
    rates would weight a quiet poll of 40 orders the same as a busy one of
    2,000. Summing the counts first weights by activity, which is what the
    question is actually about.
    """
    sql = f"""
    WITH agg AS (
        SELECT address,
               sum(n) FILTER (WHERE tif = %s)                          AS alo_total,
               sum(n) FILTER (WHERE tif = %s AND status = ANY(%s))     AS alo_rejected,
               sum(n) FILTER (WHERE status = 'filled')                 AS filled,
               sum(n) FILTER (WHERE status = 'canceled')               AS cancels,
               sum(n) FILTER (WHERE status = ANY(%s))                  AS rejected_all,
               sum(n)                                                  AS total
        FROM hl_order_counts GROUP BY address
    ), p AS (
        SELECT address, count(*) AS polls, max(polled_at) AS last_seen,
               max(month_volume) AS month_volume,
               count(*) FILTER (WHERE gap_seconds > 0) AS gapped
        FROM hl_poll GROUP BY address
    )
    SELECT p.address, p.polls, p.last_seen, p.month_volume, p.gapped,
           agg.alo_total, agg.alo_rejected, agg.filled, agg.cancels,
           agg.rejected_all, agg.total
    FROM p JOIN agg ON agg.address = p.address
    ORDER BY p.month_volume DESC NULLS LAST
    LIMIT %s
    """
    out = []
    with _conn() as c, c.cursor() as cur:
        cur.execute(sql, (POST_ONLY_TIF, POST_ONLY_TIF, list(_REJ), list(_REJ), limit))
        for (addr, polls, last_seen, vol, gapped, alo_total, alo_rej,
             filled, cancels, rej_all, total) in cur.fetchall():
            alo_total = int(alo_total or 0); alo_rej = int(alo_rej or 0)
            filled = int(filled or 0); cancels = int(cancels or 0)
            rej_all = int(rej_all or 0); total = int(total or 0)
            enough = (polls or 0) >= MIN_POLLS_FOR_RATE
            out.append({
                "address": addr,
                "polls": polls,
                "last_seen": last_seen.isoformat() if last_seen else None,
                "month_volume": vol,
                "polls_with_gap": gapped,
                "orders_observed": total,
                "alo_total": alo_total,
                "alo_rejected": alo_rej,
                # Null until there are enough polls. The counts stay visible
                # either way so a reader can see why a rate is withheld.
                "post_only_rejection_rate": (alo_rej / alo_total)
                    if (enough and alo_total) else None,
                "cancel_to_fill": (cancels / filled) if (enough and filled) else None,
                "cancel_to_fill_naive": ((cancels + rej_all) / filled)
                    if (enough and filled) else None,
                "effective_fill_rate": (filled / total) if (enough and total) else None,
                "enough_data": enough,
            })
    return out


def markets(limit: int = 40) -> list[dict]:
    """Post-only rejection by market, pooled across all tracked makers.

    This is the per-coin view: which books are moving fast enough that resting
    quotes get refused."""
    sql = f"""
    SELECT coin,
           sum(n) FILTER (WHERE tif = %s)                      AS alo_total,
           sum(n) FILTER (WHERE tif = %s AND status = ANY(%s)) AS alo_rejected,
           count(DISTINCT address)                             AS makers,
           sum(n)                                              AS total
    FROM hl_order_counts
    GROUP BY coin
    HAVING sum(n) FILTER (WHERE tif = %s) > 0
    ORDER BY alo_total DESC
    LIMIT %s
    """
    out = []
    with _conn() as c, c.cursor() as cur:
        cur.execute(sql, (POST_ONLY_TIF, POST_ONLY_TIF, list(_REJ), POST_ONLY_TIF, limit))
        for coin, alo_total, alo_rej, n_makers, total in cur.fetchall():
            alo_total = int(alo_total or 0); alo_rej = int(alo_rej or 0)
            out.append({
                "coin": coin,
                "alo_total": alo_total,
                "alo_rejected": alo_rej,
                "post_only_rejection_rate": (alo_rej / alo_total) if alo_total else None,
                "makers": n_makers,
                "orders_observed": int(total or 0),
            })
    return out


def status_breakdown() -> list[dict]:
    """Every typed status with its share, which is the evidence for why
    collapsing them would be wrong."""
    with _conn() as c, c.cursor() as cur:
        cur.execute("SELECT status, sum(n) s FROM hl_order_counts "
                    "GROUP BY status ORDER BY s DESC")
        rows = cur.fetchall()
    total = sum(int(r[1] or 0) for r in rows) or 1
    return [{"status": s, "n": int(n or 0), "share": int(n or 0) / total,
             "is_rejection": s in REJECTION_STATUSES} for s, n in rows]


def ws_coverage() -> dict:
    """What the seconds-resolution collector holds.

    Reported separately from the REST coverage and never added to it. The two
    measure different things: the WebSocket feed omits `tif`, so its
    denominator is not the ALO denominator the REST metrics use. Summing them
    would produce a number that means nothing."""
    with _conn() as c, c.cursor() as cur:
        cur.execute("SELECT count(*), count(DISTINCT address), "
                    "count(DISTINCT bucket_start), min(bucket_start), "
                    "max(bucket_start), coalesce(sum(n),0) FROM hl_ws_buckets")
        rows, addrs, buckets, first, last, updates = cur.fetchone()
        cur.execute("SELECT coalesce(sum(n),0) FROM hl_ws_buckets "
                    "WHERE status = 'badAloPxRejected'")
        rejected = cur.fetchone()[0]

        # Subscribed is read from hl_ws_coverage, which has a row per watched
        # address per bucket whether or not that address delivered. Delivering
        # is read from the bucket table. The two being different is the thing
        # that was invisible before: a collector watching ten and hearing six
        # used to look identical to one watching six.
        subscribed = delivering = watched = None
        coverage_last = None
        try:
            # count() over an empty table returns 0, not NULL, so an empty
            # coverage table would otherwise report "0 of 0 subscribed" and
            # read as a measurement of a dead collector rather than as no
            # measurement at all. The existence check is what separates them.
            cur.execute("SELECT count(*) FROM hl_ws_coverage")
            if (cur.fetchone()[0] or 0) > 0:
                cur.execute("""
                    SELECT count(DISTINCT address),
                           count(DISTINCT address) FILTER (WHERE subscribed),
                           count(DISTINCT address) FILTER (WHERE updates > 0),
                           max(bucket_start)
                    FROM hl_ws_coverage
                    WHERE bucket_start > (SELECT max(bucket_start) FROM hl_ws_coverage)
                                         - INTERVAL '10 minutes'
                """)
                watched, subscribed, delivering, coverage_last = cur.fetchone()
        except Exception:
            # The table is new. An older store simply cannot answer this, and
            # saying so is better than reporting a zero that looks like a
            # measurement.
            pass
    hours = ((last - first).total_seconds() / 3600.0) if (first and last) else 0.0
    return {
        "bucket_rows": rows or 0,
        # Kept under its old name for the existing callers, but it is the
        # delivering count and always was.
        "addresses": addrs or 0,
        "buckets": buckets or 0,
        "updates": int(updates or 0),
        "post_only_rejected": int(rejected or 0),
        "hours_covered": round(hours, 2),
        "bucket_seconds": 10,
        "first_bucket": first.isoformat() if first else None,
        "last_bucket": last.isoformat() if last else None,
        # Coverage over the last 10 minutes of recorded buckets. None means the
        # coverage table holds nothing yet, which is not the same as zero.
        "watched_addresses": watched,
        "subscribed_addresses": subscribed,
        "delivering_addresses": delivering,
        "coverage_last_bucket": coverage_last.isoformat() if coverage_last else None,
        "coverage_available": watched is not None,
    }


# Bands for the at-a-glance grouping. The boundaries are set where the
# measured distribution actually separates: the tracked makers cluster below
# about 5% or above about 50%, with comparatively few in between, so the
# middle band is genuinely a middle rather than an arbitrary slice.
BANDS = [
    ("quoting", 0.0, 0.05),
    ("mixed", 0.05, 0.50),
    ("spraying", 0.50, 1.01),
]


def maker_bands(rows: list[dict]) -> dict:
    """Group makers by what their rejection rate says they are doing."""
    out = {k: [] for k, _, _ in BANDS}
    out["unknown"] = []
    for m in rows:
        r = m.get("post_only_rejection_rate")
        if r is None or not m.get("enough_data"):
            out["unknown"].append(m)
            continue
        for name, lo, hi in BANDS:
            if lo <= r < hi:
                out[name].append(m)
                break
    return out
