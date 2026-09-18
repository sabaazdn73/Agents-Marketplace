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
import statistics
import threading
import time

from core.hyperliquid.collector import REJECTION_STATUSES, POST_ONLY_TIF

# Below this many polls for an address, rates are returned as null with the
# observation count still shown, so the UI can say "not enough yet" rather
# than render a spurious precise figure.
MIN_POLLS_FOR_RATE = 5

_REJ = tuple(sorted(REJECTION_STATUSES))


# Every read on this module is a small aggregate behind an HTTP handler that
# runs it with asyncio.to_thread, and to_thread hands the work to the event
# loop's default executor, whose threads cannot be taken back once a blocking
# call has them. So each read carries its own two bounds: the keepalives
# store.connect sets, which fail the socket when the cluster stops answering,
# and this statement_timeout, which fails the query when the cluster answers
# but slowly. Without both, one unreachable database turns into executor
# threads that are never returned, on a service with a 512MiB ceiling.
#
# 20 seconds is far above anything measured here and well under any client's
# patience, so it is a ceiling on pathology rather than a tuning knob.
_READ_STATEMENT_TIMEOUT_MS = 20_000


def _conn():
    from core.hyperliquid import store
    return store.connect(statement_timeout_ms=_READ_STATEMENT_TIMEOUT_MS)


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
        # The set being polled NOW, which is not the set ever polled. Target
        # selection moved to a liveness rule on 2026-09-15 and the two numbers
        # separated: 66 addresses have records, 31 are in the rotation. A
        # surface that shows only the first says the collector covers twice
        # what it covers, and every address in the difference is frozen at the
        # moment it was dropped.
        cur.execute("SELECT count(*), max(refreshed_at) FROM hl_targets")
        tracked_now, targets_refreshed = cur.fetchone()
        cur.execute("SELECT count(DISTINCT address) FROM hl_poll "
                    "WHERE polled_at > now() - INTERVAL '1 hour'")
        polled_last_hour = cur.fetchone()[0]
    hours = ((last - first).total_seconds() / 3600.0) if (first and last) else 0.0
    return {
        "polls": polls or 0,
        # Every address that has ever been polled. Kept under its old name for
        # existing callers, and no longer the number a reader should be shown
        # on its own: see addresses_tracked.
        "addresses": addrs or 0,
        "addresses_tracked": tracked_now or 0,
        "addresses_polled_last_hour": polled_last_hour or 0,
        "targets_refreshed_at": targets_refreshed.isoformat() if targets_refreshed else None,
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
    #
    # `left_rotation` sits between them and is the reason this list grew.
    # Target selection moved to a liveness rule on 2026-09-15 and the polled
    # set went from 66 addresses to 31. The 35 that were dropped still have
    # records, and those records stopped ageing at the moment they left, so
    # every one of them reported `stale_data`. That is the wrong fact: stale
    # on a tracked address means the collector is behind and the number will
    # refresh, and stale on a dropped address means nobody is polling it and
    # the number never will. A reader deciding whether to wait or to stop
    # looking needs to be told which.
    if not polls:
        withheld = "not_tracked" if not tracked else "no_polls_yet"
    elif not enough_polls:
        withheld = "too_few_polls"
    elif not is_current and not tracked:
        withheld = "left_rotation"
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
    ), t AS (
        -- The set still being polled. makers() reported stale_data for every
        -- address whose records had aged, which on 2026-09-17 was 33 of the 50
        -- rows and not one of them a tracked address that was merely behind:
        -- all 33 had left the rotation. address_detail already said
        -- left_rotation for exactly these; this had not been changed with it,
        -- so the same address read one reason on the extension and another on
        -- the tab.
        SELECT address FROM hl_targets
    ), p AS (
        SELECT address, count(*) AS polls, max(polled_at) AS last_seen,
               -- The age of the newest ORDER, not of the newest poll. A poll
               -- that succeeded says nothing about whether what it returned is
               -- current, which is the lesson recorded above this function.
               max(window_end) AS newest_record,
               max(month_volume) AS month_volume,
               count(*) FILTER (WHERE gap_seconds > 0) AS gapped
        FROM hl_poll GROUP BY address
    )
    SELECT p.address, p.polls, p.last_seen, p.newest_record, p.month_volume, p.gapped,
           agg.alo_total, agg.alo_rejected, agg.filled, agg.cancels,
           agg.rejected_all, agg.total,
           (t.address IS NOT NULL) AS tracked
    FROM p JOIN agg ON agg.address = p.address
           LEFT JOIN t ON t.address = p.address
    -- THE ROTATION FIRST, then volume within each group.
    --
    -- Ordering by volume alone ranked all 66 addresses together and cut at 50,
    -- which dropped twelve of the thirty-one addresses actually being polled:
    -- they sat at ranks 51 to 65 behind larger addresses that left the
    -- rotation. The table is the evidence a reader checks the filtered market
    -- and status figures against, and it was missing twelve of the addresses
    -- those figures are computed from while showing thirty-one that contribute
    -- to neither.
    ORDER BY (t.address IS NOT NULL) DESC, p.month_volume DESC NULLS LAST
    LIMIT %s
    """
    out = []
    with _conn() as c, c.cursor() as cur:
        cur.execute(sql, (POST_ONLY_TIF, POST_ONLY_TIF, list(_REJ), list(_REJ), limit))
        now = dt.datetime.now(dt.UTC)
        for (addr, polls, last_seen, newest_record, vol, gapped, alo_total, alo_rej,
             filled, cancels, rej_all, total, tracked) in cur.fetchall():
            alo_total = int(alo_total or 0); alo_rej = int(alo_rej or 0)
            filled = int(filled or 0); cancels = int(cancels or 0)
            rej_all = int(rej_all or 0); total = int(total or 0)
            enough = (polls or 0) >= MIN_POLLS_FOR_RATE

            # The currency test address_detail() applies, applied here too.
            #
            # It was not. This function checked the poll count and nothing
            # else, so it published rates for addresses whose newest observed
            # order was months old: measured 2026-09-16, 16 of the 34 rates it
            # returned were ones address_detail() was withholding as
            # stale_data, one computed from a record 11,042 hours old. The row
            # carried no age field either, so nothing downstream could tell.
            # The extension, which reads address_detail, refused to show a
            # number for the same address this told the tab to render.
            age = (now - newest_record).total_seconds() if newest_record else None
            is_current = age is not None and age <= MAX_RECORD_AGE_SECONDS
            if not enough:
                withheld = "too_few_polls"
            elif not is_current and not tracked:
                withheld = "left_rotation"
            elif not is_current:
                withheld = "stale_data"
            elif not alo_total:
                withheld = "no_post_only_orders"
            else:
                withheld = None
            show_rate = withheld is None

            out.append({
                "address": addr,
                "polls": polls,
                "last_seen": last_seen.isoformat() if last_seen else None,
                "newest_record_at": newest_record.isoformat() if newest_record else None,
                "newest_record_age_seconds": round(age, 1) if age is not None else None,
                "is_current": is_current,
                "tracked": bool(tracked),
                # The same vocabulary address_detail uses, so a caller that
                # knows one knows the other.
                "withheld_reason": withheld,
                "month_volume": vol,
                "polls_with_gap": gapped,
                "orders_observed": total,
                "alo_total": alo_total,
                "alo_rejected": alo_rej,
                # Null until there are enough polls. The counts stay visible
                # either way so a reader can see why a rate is withheld.
                "post_only_rejection_rate": (alo_rej / alo_total)
                    if (show_rate and alo_total) else None,
                "cancel_to_fill": (cancels / filled) if (show_rate and filled) else None,
                "cancel_to_fill_naive": ((cancels + rej_all) / filled)
                    if (show_rate and filled) else None,
                "effective_fill_rate": (filled / total) if (show_rate and total) else None,
                # enough_data keeps meaning "enough polls", so no existing
                # reader of it changes meaning underneath. is_current and
                # withheld_reason carry what it never said.
                "enough_data": enough,
            })
    return out


def markets(limit: int = 40) -> list[dict]:
    """Post-only rejection by market, over the addresses being polled now.

    This is the per-coin view: which books are moving fast enough that resting
    quotes get refused.

    RESTRICTED TO THE CURRENT ROTATION, and it was not until 2026-09-18.
    Pooling every address that has ever been polled put a year-old frozen slice
    into a figure a reader takes as a live market condition, and the difference
    is not small. Measured on 2026-09-18: ETH published 4.88% pooled and reads
    1.40% over the rotation, BTC published 51.33% and reads 57.58%, and the
    maker column fell from 42 to 21 on ETH and 49 to 23 on BTC.

    Those figures move with the market and are given as the size of the
    correction rather than as constants; re-measure before quoting them.

    address_detail() applies the same restriction. makers() does something
    different and deliberately so: it keeps every row and withholds the rate
    with a reason, because a per-address table that silently drops addresses
    is hiding its own population. Only the pooled figures are filtered, since
    those are the ones a reader takes as a condition of the venue.

    WHAT THE FILTER DOES NOT FIX. A per-market rate over 23 addresses is
    dominated by whoever quotes most: on 2026-09-18 two addresses placed about
    60% of the BTC post-only volume and refused over 94% of their own, so the
    57% is largely theirs. The rotation is rebuilt nightly by
    scripts/hl_select_targets.py as a full delete and reinsert, so a market
    rate here can move tens of points overnight with nothing happening on the
    venue. Read it as a property of the set being watched.

    An address that left the rotation keeps its stored records, and those
    records stop ageing at the moment it left, so including it means averaging
    now against a moment that will never move again."""
    sql = f"""
    SELECT coin, address,
           sum(n) FILTER (WHERE tif = %s)                      AS alo_total,
           sum(n) FILTER (WHERE tif = %s AND status = ANY(%s)) AS alo_rejected,
           sum(n)                                              AS total
    FROM hl_order_counts
    WHERE address IN (SELECT address FROM hl_targets)
    GROUP BY coin, address
    HAVING sum(n) FILTER (WHERE tif = %s) > 0
    """
    per_coin: dict[str, list[tuple[int, int, int]]] = {}
    with _conn() as c, c.cursor() as cur:
        cur.execute(sql, (POST_ONLY_TIF, POST_ONLY_TIF, list(_REJ), POST_ONLY_TIF))
        for coin, _addr, alo_total, alo_rej, total in cur.fetchall():
            per_coin.setdefault(coin, []).append(
                (int(alo_total or 0), int(alo_rej or 0), int(total or 0)))

    out = []
    for coin, rows in per_coin.items():
        alo_total = sum(a for a, _, _ in rows)
        alo_rej = sum(r for _, r, _ in rows)
        total = sum(t for _, _, t in rows)
        rates = sorted(r / a for a, r, _ in rows if a)
        out.append({
            "coin": coin,
            "alo_total": alo_total,
            "alo_rejected": alo_rej,
            # THE DISTRIBUTION, not one number.
            #
            # The pooled rate is the share of all post-only orders on this coin
            # that were refused, and on a book where two addresses place most
            # of the quotes it is a statement about those two. Measured
            # 2026-09-18: BTC pools to 57.61% while the median of its 23
            # makers is 0.42%, fifteen of them are under 1%, and two are over
            # 50%. Dropping the largest address takes the pooled figure to
            # about 38%, and dropping the second takes it to about 1%, with
            # nothing happening on the venue.
            #
            # So the median and the spread lead, the pooled figure is kept and
            # named for what it is, and neither is presented as the market's
            # rate. This is the same choice made when the True Liquidity Index
            # was dropped: a number that describes two participants out of
            # twenty-three is not describing the venue.
            "median_rejection_rate": (statistics.median(rates) if rates else None),
            "rate_min": (rates[0] if rates else None),
            "rate_max": (rates[-1] if rates else None),
            "makers_over_half": sum(1 for x in rates if x > 0.5),
            "makers_under_one_percent": sum(1 for x in rates if x < 0.01),
            "pooled_rejection_rate": (alo_rej / alo_total) if alo_total else None,
            # Kept under its old name so nothing downstream breaks, and equal
            # to the pooled figure it always was.
            "post_only_rejection_rate": (alo_rej / alo_total) if alo_total else None,
            "makers": len(rows),
            "orders_observed": total,
        })
    out.sort(key=lambda r: r["alo_total"], reverse=True)
    return out[:limit]


def status_breakdown() -> list[dict]:
    """Every typed status with its share, over the addresses being polled now.

    Restricted to the current rotation on 2026-09-18, for the reason given in
    markets(). Pooled over every address ever polled it reported filled at
    3.93%, reduceOnlyCanceled at 1.062% and a plain rejected at 0.281%. Over
    the addresses actually being polled, measured the same day, those are
    0.76%, 0.90% and nothing at all.

    An earlier version of this note put the filtered figures at 1.09% and
    0.011%. Both were wrong, the second by about eighty times; they were
    carried over from an audit's estimate rather than measured after the
    filter was applied. Re-measure before quoting any of them.

    The last of those mattered most: the tab uses this breakdown as the
    evidence for saying a plain rejected status exists but covers a minority of
    refusals, and every record carrying that status came from addresses nobody
    polls. The claim was being evidenced entirely by data that stopped moving.
    """
    with _conn() as c, c.cursor() as cur:
        cur.execute("SELECT status, sum(n) s FROM hl_order_counts "
                    "WHERE address IN (SELECT address FROM hl_targets) "
                    "GROUP BY status ORDER BY s DESC")
        rows = cur.fetchall()
    total = sum(int(r[1] or 0) for r in rows) or 1
    return [{"status": s, "n": int(n or 0), "share": int(n or 0) / total,
             "is_rejection": s in REJECTION_STATUSES} for s, n in rows]


def _ws_watch_cap() -> int | None:
    """The collector's own subscription ceiling, read from the collector
    rather than restated here, so the two cannot drift."""
    try:
        from core.hyperliquid import ws_collector
        return int(ws_collector.MAX_WS_USERS)
    except Exception:
        return None


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
    # Two different quantities, and the tab was showing the first while
    # calling it the second. The span from the first bucket to the last counts
    # every hour the collector was NOT running: 49.76 hours of wall clock
    # against 11.9 hours of collection on 2026-09-17. What was actually
    # collected is the bucket count times the bucket width.
    span_hours = ((last - first).total_seconds() / 3600.0) if (first and last) else 0.0
    collected_hours = (buckets or 0) * 10 / 3600.0
    return {
        "bucket_rows": rows or 0,
        # Kept under its old name for the existing callers, but it is the
        # delivering count and always was.
        "addresses": addrs or 0,
        "buckets": buckets or 0,
        "updates": int(updates or 0),
        "post_only_rejected": int(rejected or 0),
        # Kept under its old name, and now the honest one: the hours that
        # carry buckets, not the distance between the first and the last.
        "hours_covered": round(collected_hours, 2),
        "hours_span": round(span_hours, 2),
        # The exchange's own limit on subscriptions from one connection point,
        # which is what the watch set is sized against. The tab used to print
        # the number of addresses that have EVER produced a bucket row and
        # call it this limit; that number is 13 because the watch set changed
        # between runs, and stating it as the exchange's rule was simply
        # wrong.
        "watch_cap": _ws_watch_cap(),
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


# The series read, added for the MCP adapter's tnega_series. Bucket width is
# the collector's own (10 seconds), so this returns what was recorded rather
# than a re-bucketing of it.
MAX_SERIES_POINTS = 200


def address_series(address: str, limit: int = MAX_SERIES_POINTS,
                   before: str | None = None) -> dict:
    """Seconds-resolution updates for one address, newest first.

    THE DENOMINATOR IS NOT THE REST DENOMINATOR
    The WebSocket feed carries no `tif`, so the post-only denominator the REST
    rate uses cannot be reconstructed from it. `rejected` here is exact,
    because badAloPxRejected can only happen to a post-only order, but
    `updates` is every order update of any kind. The ratio of the two is a
    different quantity from the rate on the tab and the two must not be shown
    as though they were the same. That is stated in the return rather than
    left to the caller to remember.

    Coverage is returned whether or not there are points, and says whether the
    collector held a confirmed subscription for the window. An address with no
    rows and a subscription is quiet; an address with no rows and no
    subscription was not being watched, and those are different facts.
    """
    limit = max(1, min(int(limit or MAX_SERIES_POINTS), MAX_SERIES_POINTS))
    args: list = [address.lower()]
    cutoff = ""
    if before:
        cutoff = "AND bucket_start < %s"
        args.append(before)

    with _conn() as c, c.cursor() as cur:
        cur.execute(f"""
            SELECT bucket_start,
                   coalesce(sum(n), 0) AS updates,
                   coalesce(sum(n) FILTER (WHERE status = 'badAloPxRejected'), 0)
            FROM hl_ws_buckets
            WHERE address = %s {cutoff}
            GROUP BY bucket_start
            ORDER BY bucket_start DESC
            LIMIT %s""", (*args, limit))
        rows = cur.fetchall()

        cur.execute("""
            SELECT count(*), min(bucket_start), max(bucket_start),
                   count(*) FILTER (WHERE subscribed)
            FROM hl_ws_coverage WHERE address = %s""", (address.lower(),))
        cov_rows, cov_first, cov_last, cov_subscribed = cur.fetchone()

    points = [
        {"t": b.isoformat(), "updates": int(u or 0), "rejected": int(r or 0)}
        for b, u, r in rows
    ]
    return {
        "address": address.lower(),
        "bucket_seconds": 10,
        "coverage": {
            "buckets_returned": len(points),
            "coverage_rows": int(cov_rows or 0),
            "buckets_subscribed": int(cov_subscribed or 0),
            "first_bucket": cov_first.isoformat() if cov_first else None,
            "last_bucket": cov_last.isoformat() if cov_last else None,
            "denominator": "all order updates, not post-only orders",
        },
        "points": points,
        "next_before": points[-1]["t"] if len(points) == limit else None,
    }


# ---------------------------------------------------------------------------
# The persistence result, behind a cache
# ---------------------------------------------------------------------------
#
# core.hyperliquid.brain reads six hours of ten-second buckets and computes a
# coefficient per address at nine lags. It is the heaviest read in this file by
# an order of magnitude, about four seconds against the cluster, and its answer
# changes only when the collector completes another hour. So it is computed at
# most once every half hour per process and handed out from memory in between.
#
# The cache holds the answer, including the answer "there is no window", which
# is a measurement of the collector and not a failure. A failure caches for
# five minutes instead, so an unreachable cluster is retried soon rather than
# every request.
_BRAIN_TTL_SECONDS = 1800
_BRAIN_FAILURE_TTL_SECONDS = 300
_BRAIN_LOCK_WAIT_SECONDS = 15

_brain_cache: dict = {"at": 0.0, "ttl": 0.0, "value": None}
_brain_lock = threading.Lock()


def brain(force: bool = False) -> dict | None:
    """The Brain section's block, or None.

    None means no figure is served, and the section says so in those terms. It
    never means zero persistence: a coefficient that was measured and came out
    flat arrives as a block with `withheld_reason` set to `not_significant`,
    which is a different sentence on the page and a different fact.

    Exceptions are swallowed here on purpose. The Hyperliquid tab must still
    render when this one read fails, and a section that says nothing is served
    is honest about exactly that.
    """
    now = time.monotonic()
    if not force:
        cached = _brain_cache
        if cached["at"] and now - cached["at"] < cached["ttl"]:
            return cached["value"]

    # One computation at a time per process. A caller that cannot get the lock
    # inside the wait takes whatever is cached, stale or None, rather than
    # queueing: these run on the event loop's default executor, whose threads
    # are not returned while a blocking database read holds them.
    if not _brain_lock.acquire(timeout=_BRAIN_LOCK_WAIT_SECONDS):
        return _brain_cache["value"]
    try:
        now = time.monotonic()
        if not force and _brain_cache["at"] and now - _brain_cache["at"] < _brain_cache["ttl"]:
            return _brain_cache["value"]
        from core.hyperliquid import brain as brain_module
        try:
            with _conn() as c, c.cursor() as cur:
                value = brain_module.compute(cur)
            ttl = _BRAIN_TTL_SECONDS
        except Exception:
            value = None
            ttl = _BRAIN_FAILURE_TTL_SECONDS
        _brain_cache.update({"at": time.monotonic(), "ttl": ttl, "value": value})
        return value
    finally:
        _brain_lock.release()


def all_known_addresses() -> list[str]:
    """Every address this venue's store has ever held, for the extension's
    membership filter.

    The union of the polled set and the current target set, not either alone.
    An address that left the rotation still has stored observations and still
    gets a panel, carrying `left_rotation` as its reason, so leaving it out of
    the filter would make the extension silent about exactly the addresses
    whose history is the interesting part.

    Lowercased here rather than at the call site: every other key space in
    core/extension/membership.py is lowercased, and one that was not would fail
    only for the addresses a page happened to render in checksummed form.
    """
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT address FROM hl_poll "
            "UNION SELECT address FROM hl_targets")
        return [r[0].lower() for r in cur.fetchall() if r[0]]
