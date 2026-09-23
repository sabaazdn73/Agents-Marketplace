"""
history.py

The accumulated post-only series, and the cross-address comparison the
single-address endpoint cannot answer.

WHY THIS IS THE THING WORTH SERVING
-----------------------------------
`historicalOrders` returns only the 2,000 most recent records per address and
ignores `startTime` and `endTime`. Both were tested and each returns the
identical 2,000 rows, so there is no backfill. Any history this project has is
history it collected, and every hour without a collector is an hour that cannot
be recovered later. A caller can reproduce today's rate by calling the venue
themselves. They cannot reproduce the series.

WHO CAN CHECK THE FIGURES IN THIS FILE
--------------------------------------
This module's comments quote measurements taken while it was written. Most of
them were taken by querying the store directly, and no deployed route exposes
what they were computed from, so a third party CANNOT reproduce them today.
They become checkable when this endpoint deploys, and not before. Naming which
is which is part of the same discipline as naming a denominator.

NOT REPRODUCIBLE BY A THIRD PARTY TODAY. All of these come from direct queries
against hl_poll and hl_order_counts, whose window_start, window_end and capped
columns no deployed route serves:

    95,817 and 92,352 seconds   mean record window span over 24h for
                                0xe639710e64d709 and 0x856c3503859476
    0 of 94 and 0 of 106        gapped polls for those same two addresses
    8 of 33, and 3 of those     tracked addresses with any stale bucket, and
                                with every bucket stale, in the 24h to
                                2026-09-23
    0.00021 to 0.03120          one address's own hourly rates within a single
                                day, a factor of 148.6
    87.8%                       polls returning at the 2,000-record ceiling,
                                21,634 of 24,641 over seven days
    2 / 4 / 5,470               the address-hours holding zero, thin and
                                sufficient post-only flow, out of 5,476
    1.6s, 343s, 1,274 of 24,634 the record-age percentiles and the count of
                                polls more than an hour behind
    146.7 to 147.1 days         the record age behind the nine-point example

REPRODUCIBLE TODAY, and independently reproduced: the 72.6% gap share, 20,803
of 28,648 polls. It is served as coverage.polls_with_gap over coverage.polls on
the already deployed /api/hyperliquid/overview, so anyone can divide the two.
Two other readers measured it separately and agreed to within the collector's
own writes between reads.

A CAUTION THAT APPLIES TO ANY OF THESE QUOTED LATER. service.maker_rate_series
windows on now() minus an interval, so it is a sliding window and two reads
minutes apart cover different hours. A spread quoted off it moved between
reads during review: one address measured 13.5 times on one read and 7.6 on
another, which is why the figure above is the one that held on both reads and
why it is quoted with its window and its date. Quote no figure from this file
without them.

WHICH OF THE TWO SERIES THIS IS, BEFORE ANYTHING ELSE
-----------------------------------------------------
There are two post-only series in this project and they measure different
things. Naming which one this is has to come first, because attaching the
wrong one's caveat would itself be the error that caveat exists to prevent.

    service.address_series()     WebSocket, hl_ws_buckets, 10 second buckets.
                                 The feed carries no tif, so its denominator
                                 is every order update of any kind. This is
                                 what tnega_series on hyperliquid.post_only
                                 serves and what the catalogue's tif caveat
                                 covers.

    service.maker_rate_series()  REST, hl_order_counts filtered to tif='Alo',
                                 hourly. Its denominator is post-only orders.
                                 This is what /api/hyperliquid/address serves
                                 as `rate_series`.

THIS MODULE IS THE SECOND ONE. It reads hl_order_counts filtered to
tif = 'Alo' and never touches hl_ws_buckets. Its denominator is post-only
orders, which makes its ratio the same quantity as the rejection rate the
single-address endpoint returns, computed the same way from the same table.

So the catalogue's tif caveat does NOT describe this series and is not
attached to it as though it did. It is carried, verbatim and attributed, as a
statement about the OTHER series, because a caller is likely to hold both and
the one thing they must not do is put them on one axis. The exact wording is
the caveat beginning "The series comes from" on the hyperliquid.post_only
Dataset in mcp_server/registry.py.

It is cited by its own opening words rather than by a line number or a
position in that list, and the reason is a defect this pass produced twice.
A citation of another file is a claim with a lifetime: the line number here
said 327 to 329 and was made wrong by this same change set adding a caveat
above it, and "the third entry" was made wrong by the same edit for the same
reason. The wording is the only part that does not move, so the wording is
what this points at.

    "The series comes from the WebSocket feed, which carries no tif. Its
    denominator is all order updates, not post-only orders, so its ratio is
    not the same quantity as the rate."

Every response names its own source in coverage.series_source, so the
distinction does not depend on anyone reading this file.

AN HOUR WITH NO POST-ONLY ORDERS IS A GAP, NOT A ZERO
-----------------------------------------------------
Carried from maker_rate_series, which has the rule in its own docstring, and
carried into the bulk shape where it is easiest to lose. `rejection_rate` is
null for such a bucket and a caller must break the line rather than draw it to
the floor. A maker that stopped quoting for an hour did not achieve a 0%
rejection rate. In the bulk arrays the counts sit in their own arrays beside
the rates, so a null is never encoded as a zero on the way out.

WHAT A POINT IS
---------------
A point is one bucket of wall-clock time, keyed on `polled_at`, carrying the
post-only orders observed in that bucket, how many of them the engine refused,
and the rate of the second over the first.

THE TIME AXIS IS POLL TIME, NOT ORDER TIME
------------------------------------------
Each bucket groups by when the poll happened. The records inside a poll span
`window_start` to `window_end`, which is usually the same minute and sometimes
is not: measured over the seven days to 2026-09-23, the median poll's newest
record was 1.6 seconds old, the 90th percentile 343 seconds, and 1,274 of
24,634 polls (5.2%) carried a newest record more than an hour older than the
poll. For those, orders are attributed to the hour the poll ran rather than the
hour they happened. So every point carries `records_behind_poll_seconds`, the
largest such lag in the bucket, which lets a reader see the misattribution
instead of inheriting it.

PARTIAL COVERAGE IS THE NORMAL CASE
-----------------------------------
Collection started 2026-09-15 and addresses enter and leave the tracked set on
their own dates, so almost every interesting range is partly uncovered. The
answer never interpolates and never silently truncates: `coverage.segments`
partitions the requested range end to end and names the state of every part of
it, so a caller can tell an hour with no rejections from an hour nobody was
watching.
"""

from __future__ import annotations

import datetime as dt

from core.hyperliquid import service
from core.hyperliquid.collector import POST_ONLY_TIF, REJECTION_STATUSES

# The bucket widths offered, and the reason there is no smaller one.
#
# A tracked address is polled about once every 12.9 minutes (918 polls over
# 198 hours for the longest-running one), so an hour holds roughly five polls
# and anything under 15 minutes would hold one or none. A single poll is a
# 2,000-record rolling window that overlaps the poll before it, so a bucket of
# one poll is not an independent sample of anything; it is a redraw of the same
# window. Hour and day are the widths the collector's own cadence supports.
BUCKETS = {"hour": 3600, "day": 86400}
DEFAULT_BUCKET = "hour"

# Points per response for one address. 1,000 hours is 41 days, which is longer
# than the dataset has existed; the cap is here so that it is still bounded
# when the dataset is a year old. Past it the response pages with next_cursor.
MAX_POINTS = 1000

# The cross-address view does not page, so it is bounded by refusing rather
# than by trimming. Trimming a comparison would hand back a narrower window
# than the caller asked for with no mark on it, and every figure in the
# response would then be over a range the caller did not choose.
MAX_BULK_ADDRESSES = 25
MAX_BULK_POINTS = 200

# Seven days by default. The tab's own history window is 48 hours
# (service.RATE_SERIES_HOURS) because it rides along with a page; this is the
# endpoint people come to for history, so its default is the week.
DEFAULT_RANGE_SECONDS = 7 * 86400

# A bucket needs enough post-only orders to divide. This is
# service.MIN_ORDERS_FOR_MARKET_RATE, reused rather than restated: it answers
# exactly this question for a per-market slice, and a per-hour slice is the
# same question. 1 of 3 refused is not 33%.
#
# Measured before adopting it, over the 5,476 address-hours in the seven days
# to 2026-09-23: 2 buckets hold zero post-only orders, 4 hold between 1 and
# 199, and 5,470 clear the floor. The median bucket holds 7,993. So this
# withholds 0.07% of buckets and guards the ones that would otherwise print a
# rate off a handful of orders.
MIN_ORDERS_FOR_BUCKET_RATE = service.MIN_ORDERS_FOR_MARKET_RATE

_REJ = sorted(REJECTION_STATUSES)

# Carried into every response from this module, whatever the shape.
CAVEATS = [
    "A refused post-only order never rests, provides no liquidity and leaves "
    "no trace in fills, so it is invisible in volume.",

    "WHO CAN CHECK THE FIGURES IN THESE CAVEATS. The percentages quoted below "
    "were measured by querying the store directly, and the columns they came "
    "from (hl_poll.window_start, window_end and capped) are not served by any "
    "route, so they cannot be reproduced from this API: the 87.8% capped "
    "share, the 25.8% overlapping-record share, and the 148.6 intraday factor "
    "are on that footing. The one exception is the 72.6% gap share, which is "
    "coverage.polls_with_gap over coverage.polls on "
    "/api/hyperliquid/overview, so anyone can divide the two, and which two "
    "readers reproduced independently. Every figure here carries the date it "
    "was measured, because the collector keeps running and they move.",

    "THIS IS THE REST POST-ONLY SERIES, the one service.maker_rate_series "
    "produces: hl_order_counts filtered to tif=Alo, so the denominator is "
    "post-only orders and the ratio is the same quantity as the rejection "
    "rate on /api/hyperliquid/address/{address}, computed the same way from "
    "the same table. There is a SECOND series in this project, "
    "service.address_series, which tnega_series on hyperliquid.post_only "
    "serves, and the catalogue says of it: \"The series comes from the "
    "WebSocket feed, which carries no tif. Its denominator is all order "
    "updates, not post-only orders, so its ratio is not the same quantity as "
    "the rate.\" That sentence is about that series and not about this one. "
    "If you hold both, do not put them on one axis and do not compare their "
    "points.",

    "A bucket with no post-only orders returns a null rate, never a zero. A "
    "maker that stopped quoting for an hour did not achieve a 0% rejection "
    "rate, and a line drawn to the floor there says it did.",

    "A rate over a range is pooled: the counts are summed first and divided "
    "once. It is not the mean of the bucket rates, which would weight a quiet "
    "bucket of 40 orders the same as a busy one of 8,000.",

    "Consecutive points are not independent. historicalOrders returns a "
    "rolling 2,000-record window that ignores any date range, so when an "
    "address is quiet consecutive polls return overlapping records and a "
    "bucket can share orders with the bucket before it. 25.8% of all stored "
    "records come from a poll whose window overlapped the poll before it, "
    "measured 2026-09-20.",

    "Buckets are keyed on poll time, not order time. Each point carries "
    "records_behind_poll_seconds, the age of the newest record in the bucket's "
    "slowest poll. Where that is large, orders are attributed to the bucket "
    "the poll ran in rather than the bucket they happened in.",

    "polls_with_gap counts polls where orders happened between the end of the "
    "previous window and the start of this one, so the sample inside a bucket "
    "is not contiguous. Measured 2026-09-23 it stands at 72.5% of all polls "
    "(20,400 of 28,138), and on the busiest addresses it is near every poll. "
    "The hyperliquid.post_only catalogue entry carries its own reading of the "
    "same quantity, taken minutes apart on the same day, and is the surface "
    "to compare against rather than a figure restated here. A rate is pooled "
    "counts over what was seen, which a gap makes an undercount of activity "
    "rather than a wrong rate.",

    "alo_total COUNTS RECORDS SEEN, NOT DISTINCT ORDERS. It is the rate's "
    "denominator, which is why it is here, and it is not a volume figure. "
    "21,634 of the 24,641 polls in the seven days to 2026-09-23 (87.8%) came "
    "back at the 2,000-record ceiling, so for a busy address it is close to "
    "2,000 times the number of polls that landed in the bucket, times that "
    "address's post-only share. A bucket with a larger alo_total than its "
    "neighbour was polled more often, not necessarily busier.",

    "`orders`, the bucket's total observed order count, is WITHHELD with "
    "count_withheld_reason=capped_sample whenever polls_capped equals polls. "
    "At that point it is 2,000 times the number of polls and nothing else, an "
    "identity with how often we polled rather than a measurement, and this "
    "project withholds such a figure rather than publishing it with a note. "
    "The collector's own docstring draws the line in the same place: the rate "
    "is a precise estimate over the window its records span, and the counts "
    "are not totals and must not be presented as any.",

    "value.rate.covers IS THE WINDOW THE RATE DESCRIBES, and it is the "
    "requested range only when every bucket earned one. Where buckets were "
    "withheld, the divisor spans less time than was asked for, and the rate "
    "is a measurement of `covers` rather than of the range. It is labelled "
    "rather than withheld below some fraction, because there is no fraction "
    "at which a partial window becomes representative: measured 2026-09-23 "
    "over 24 hours, one tracked address's own hourly rates ran from 0.00021 "
    "to 0.03120, a factor of 148.6 between two hours of one day. Read "
    "covers.buckets against "
    "covers.of_buckets_in_range, and covers.contiguous, before treating the "
    "figure as the range's.",

    "A trailing after_last_poll segment shorter than one poll interval is the "
    "cycle in progress, not a hole. coverage.unobserved_states names which "
    "kinds of uncovered time the response actually contains, so a range that "
    "is only missing the current cycle reads differently from one that is "
    "missing the days before an address was tracked.",
]

MEASURED = ("the share of an address's post-only orders that the matching "
            "engine refused instead of resting on the book, per bucket of "
            "poll time")


class RangeError(ValueError):
    """A request this module will not answer, with the reason in the message.

    Raised rather than answered, for the cases where answering would mean
    guessing what was meant. The handler turns it into a 400 carrying this
    text, so the boundary is stated to the caller rather than discovered.
    """


# ---------------------------------------------------------------------------
# parsing and alignment
# ---------------------------------------------------------------------------

def parse_time(value: str, field: str) -> dt.datetime:
    """ISO 8601, with or without a trailing Z. Nothing else.

    A bare date is accepted and means midnight UTC on that date, because that
    is what someone asking for 2026-09-17 means. A naive timestamp is read as
    UTC rather than as the server's local zone, which would make the same
    string mean two things on two machines.
    """
    text = (value or "").strip()
    if not text:
        raise RangeError(f"{field} is empty; expected an ISO 8601 timestamp "
                         f"such as 2026-09-17T00:00:00Z")
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise RangeError(
            f"{field}={text!r} is not an ISO 8601 timestamp. Expected a form "
            f"like 2026-09-17T00:00:00Z or 2026-09-17.") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.UTC)
    return parsed.astimezone(dt.UTC)


def _floor(t: dt.datetime, bucket: str) -> dt.datetime:
    if bucket == "day":
        return t.replace(hour=0, minute=0, second=0, microsecond=0)
    return t.replace(minute=0, second=0, microsecond=0)


def _ceil(t: dt.datetime, bucket: str) -> dt.datetime:
    floored = _floor(t, bucket)
    if floored == t:
        return t
    return floored + dt.timedelta(seconds=BUCKETS[bucket])


def _iso(t: dt.datetime | None) -> str | None:
    return t.isoformat() if t else None


def _cursor(t: dt.datetime | None) -> str | None:
    """A timestamp meant to be pasted straight back into a query string.

    Everything else in a response uses the +00:00 offset form. This one does
    not, because a bare "+" in a URL query decodes to a space: handing back
    2026-09-16T05:00:00+00:00 as next_cursor gives a caller a value that fails
    on the next request unless they remember to percent-encode it. Found by
    following the cursor, which is the only way it was ever going to be found.
    """
    return t.isoformat().replace("+00:00", "Z") if t else None


def normalise_address(value: str, field: str = "address") -> str:
    addr = (value or "").strip().lower()
    if not addr.startswith("0x") or len(addr) != 42:
        raise RangeError(f"{field}={value!r} is not an address")
    try:
        int(addr[2:], 16)
    except ValueError:
        raise RangeError(f"{field}={value!r} is not an address") from None
    return addr


def resolve_range(start: str | None, end: str | None, bucket: str,
                  now: dt.datetime) -> tuple[dt.datetime, dt.datetime]:
    """The requested range, exactly as asked for, before any clipping.

    Neither end is clipped here. A start before collection began and an end in
    the future are both answerable questions, and the answer is a coverage
    segment saying so rather than a quietly narrowed window. The only refusal
    is a range that does not run forwards, because there is no reading of that
    which is a question.
    """
    if bucket not in BUCKETS:
        raise RangeError(
            f"bucket={bucket!r} is not offered. Use one of: "
            f"{', '.join(sorted(BUCKETS))}.")
    t_end = parse_time(end, "end") if end else now
    t_start = parse_time(start, "start") if start else (
        t_end - dt.timedelta(seconds=DEFAULT_RANGE_SECONDS))
    if t_end <= t_start:
        raise RangeError(
            f"start={_iso(t_start)} is not before end={_iso(t_end)}. "
            f"The range is read as [start, end) and must run forwards.")
    return t_start, t_end


# ---------------------------------------------------------------------------
# reads
# ---------------------------------------------------------------------------

def _collection_start(cur) -> dt.datetime | None:
    cur.execute("SELECT min(polled_at) FROM hl_poll")
    return cur.fetchone()[0]


def _address_facts(cur, addrs: list[str]) -> dict[str, dict]:
    """Per address: every poll ever, and whether it is in the rotation now.

    Both are needed and neither substitutes for the other. An address with
    polls that is no longer tracked has a series that has stopped and will not
    resume, which is a different fact from a series that has a hole in it, and
    the segment states say which.
    """
    out = {a: {"polls": 0, "first_poll": None, "last_poll": None,
               "tracked": False} for a in addrs}
    cur.execute("""
        SELECT address, count(*), min(polled_at), max(polled_at)
        FROM hl_poll WHERE address = ANY(%s) GROUP BY address""", (addrs,))
    for address, polls, first, last in cur.fetchall():
        out[address].update({"polls": int(polls or 0),
                             "first_poll": first, "last_poll": last})
    cur.execute("SELECT address FROM hl_targets WHERE address = ANY(%s)",
                (addrs,))
    for (address,) in cur.fetchall():
        if address in out:
            out[address]["tracked"] = True
    return out


def _counts(cur, addrs: list[str], bucket: str,
            w0: dt.datetime, w1: dt.datetime) -> dict[str, dict]:
    """Post-only counts per address per bucket, over the aligned window.

    The bucket name is interpolated rather than bound. It is one of two
    literals from BUCKETS, checked before this is reached, and date_trunc's
    first argument is not a value the planner will take as a parameter.
    """
    unit = bucket if bucket in BUCKETS else DEFAULT_BUCKET
    cur.execute(f"""
        SELECT address, date_trunc('{unit}', polled_at) AS b,
               coalesce(sum(n) FILTER (WHERE tif = %s), 0),
               coalesce(sum(n) FILTER (WHERE tif = %s AND status = ANY(%s)), 0),
               coalesce(sum(n), 0)
        FROM hl_order_counts
        WHERE address = ANY(%s) AND polled_at >= %s AND polled_at < %s
        GROUP BY address, b
        ORDER BY address, b""",
        (POST_ONLY_TIF, POST_ONLY_TIF, _REJ, addrs, w0, w1))
    out: dict[str, dict] = {a: {} for a in addrs}
    for address, b, alo, rej, total in cur.fetchall():
        out.setdefault(address, {})[b] = {
            "alo_total": int(alo or 0),
            "alo_rejected": int(rej or 0),
            "orders": int(total or 0),
        }
    return out


def _poll_meta(cur, addrs: list[str], bucket: str,
               w0: dt.datetime, w1: dt.datetime) -> dict[str, dict]:
    """How many polls stand behind each bucket, and how good they were.

    Separate from the counts because hl_order_counts has no row for a poll
    that returned nothing, and a bucket that was polled and came back empty is
    not a bucket nobody polled.
    """
    unit = bucket if bucket in BUCKETS else DEFAULT_BUCKET
    cur.execute(f"""
        SELECT address, date_trunc('{unit}', polled_at) AS b, count(*),
               count(*) FILTER (WHERE gap_seconds > 0),
               max(extract(epoch FROM (polled_at - window_end))),
               count(*) FILTER (WHERE capped),
               max(extract(epoch FROM (window_end - window_start)))
        FROM hl_poll
        WHERE address = ANY(%s) AND polled_at >= %s AND polled_at < %s
        GROUP BY address, b
        ORDER BY address, b""", (addrs, w0, w1))
    out: dict[str, dict] = {a: {} for a in addrs}
    for address, b, polls, gapped, lag, capped, span in cur.fetchall():
        out.setdefault(address, {})[b] = {
            "polls": int(polls or 0),
            "polls_with_gap": int(gapped or 0),
            "polls_capped": int(capped or 0),
            "records_behind_poll_seconds": (
                round(float(lag), 1) if lag is not None else None),
            # How wide a stretch the widest poll's own records covered. A poll
            # whose 2,000 records span a day files all of them under one
            # bucket, and no measure of their AGE can see that.
            "records_span_seconds": (
                round(float(span), 1) if span is not None else None),
        }
    return out


# ---------------------------------------------------------------------------
# shaping
# ---------------------------------------------------------------------------

def _enough_data(alo: int) -> bool:
    """The field service.makers and service.maker_markets already use for this.

    True when the bucket holds enough post-only orders to divide. Reported on
    every point so a null rate is never ambiguous: enough_data false with no
    reason is the thin bucket, and it needs no word of its own.
    """
    return alo >= MIN_ORDERS_FOR_BUCKET_RATE


def _stale_threshold(step: int) -> int:
    """How fresh a bucket's records have to be, in seconds.

    The bucket width, floored at service.MAX_RECORD_AGE_SECONDS, so a coarser
    axis never relaxes what "current" means.
    """
    return min(int(step), service.MAX_RECORD_AGE_SECONDS)


def _bucket_rate(alo: int, rejected: int, lag: float | None, step: int,
                 span: float | None = None) -> tuple[float | None, str | None]:
    """The rule for one bucket, in one place, with the reason beside it.

    Three ways a bucket gets no rate, and the counts stay in the point for all
    three, so a withheld rate is visibly withheld rather than missing: a reader
    sees the denominator that was not enough.

      no_post_only_orders        the address posted none in this bucket.
      stale_data                 the records in this bucket do not belong to
                                 it. Two independent ways that happens, and
                                 the second is the one that matters most:

                                   age  the newest record is older than the
                                        threshold, so the whole poll describes
                                        earlier time.
                                   span the 2,000 records of a single poll
                                        cover a wider stretch than the
                                        threshold, so they cross bucket
                                        boundaries and every one of them is
                                        filed under the one bucket the poll
                                        ran in.

    THE SPAN TEST EXISTS BECAUSE THE AGE TEST CANNOT SEE THE WORST CASE.
    Measured 2026-09-23 over the addresses publishing a rate: one had a mean
    record window of 95,817 seconds, 26.6 hours, with a mean record age of
    4,703 seconds, well inside any age threshold. Its 2,000 records span more
    than a day and are attributed to whichever single hour the poll ran in, so
    fourteen consecutive hourly points carried a rate identical to five
    significant figures. Age said the data was current. It was current and it
    was a day wide.

    A third case, a bucket holding some post-only orders but fewer than it
    takes to divide, gets NO reason string and carries `enough_data: false`
    instead. That is not a gap in the vocabulary, it is the vocabulary: this
    is exactly how service.maker_markets already reports a market too thin to
    rate, down to the field name, and inventing too_few_post_only_orders
    beside it would have been a second way of saying one thing.

    THE THIRD ONE IS THE ONE THAT WOULD HAVE SOLD A FABRICATED LINE.
    Found by calling this endpoint rather than by reading it. An address that
    left the rotation returned nine consecutive hourly points on 2026-09-15,
    every one carrying a rate of 0.005528 to six decimals, its alo_total
    exactly 1,990 times the number of polls in the bucket, every poll at the
    2,000-record ceiling, and gap_seconds at zero on all 31 polls. The records
    behind them aged from 146.7 days at the first point to 147.1 days at the
    last poll, because they were one April window being handed back unchanged
    while the clock moved: a single age quoted for all nine would be stated
    more tightly than the data allows.

    gap_seconds cannot catch this, and the reason is structural rather than a
    tuning problem. store.py computes it as (window_start - previous
    window_end), where those are the first and last order timestamps in the
    poll, and a poll is counted as gapped only when that is above zero. A poll
    that returns exactly the records its predecessor did moves neither
    boundary, so the difference is NEGATIVE by the width of the window and the
    poll is recorded as not gapped, indistinguishable from perfect contiguous
    coverage. gap_seconds can only see orders that happened between polls. It
    is structurally incapable of seeing that no new orders arrived at all.

    THE THRESHOLD IS min(bucket width, service.MAX_RECORD_AGE_SECONDS).
    The bucket width alone was wrong and in the wrong direction. At bucket=day
    it is 86,400, so a record 23 hours old would have passed while being
    useless for the day it describes: the rule got MORE permissive exactly as
    the bucket got coarser. A wider bucket needs at least as much freshness,
    not less. The floor is this project's own definition of current, the one
    service.address_detail already applies to today's rate, so hourly is
    unchanged, daily stops admitting records the address-level gate would
    refuse, and there is one definition of current rather than two.
    """
    if alo <= 0:
        return None, "no_post_only_orders"
    limit = _stale_threshold(step)
    if lag is not None and lag > limit:
        return None, "stale_data"
    if span is not None and span > limit:
        return None, "stale_data"
    if alo < MIN_ORDERS_FOR_BUCKET_RATE:
        return None, None              # enough_data: false carries this one
    return round(rejected / alo, 6), None


def _rate_window(rated: list, bucket_slots: int, step: int) -> dict:
    """The window a pooled rate actually covers, to travel beside the rate.

    WHY LABELLING AND NOT A THRESHOLD.
    A range rate pooled over the buckets that earned one can cover far less
    time than the range that was asked for. Measured 2026-09-23, two tracked
    addresses had 23 of their 24 hourly buckets withheld as stale, so a
    24-hour request produced a figure whose divisor was one hour. Reporting
    buckets_rated beside buckets_with_stale_records states the inputs
    correctly and still leaves a headline number attributed to a window it
    does not describe, which is the same shape as every figure removed here.

    The fix is to put the covered window inside the same object as the number,
    so the rate cannot be read without it. It is NOT a minimum fraction of the
    range, and the data is the reason: measured 2026-09-23 over a 24 hour
    window, one of those addresses' own hourly rates ran from 0.00021 to
    0.03120, a factor of 148.6 between two hours of the same day. When an hour
    varies that much from its neighbour, a rate over half a day is not the
    day's rate either. There is
    no fraction at which a partial window becomes representative, so any
    threshold would be a line drawn across a continuum, and this project does
    not carry a constant it cannot justify by measurement. An exact label is
    truthful at every point on that continuum.

    The per-bucket detail is served either way, and it is the part that is
    sound: a caller who needs the whole range can read the points and see
    exactly which hours are missing and why.
    """
    if not rated:
        return {"first_bucket": None, "last_bucket": None, "buckets": 0,
                "of_buckets_in_range": bucket_slots,
                "fraction_of_requested_range": 0.0, "contiguous": None}
    lo, hi = min(rated), max(rated)
    spanned = int((hi - lo).total_seconds() // step) + 1
    return {
        "first_bucket": _iso(lo),
        "last_bucket": _iso(hi + dt.timedelta(seconds=step)),
        "buckets": len(rated),
        "of_buckets_in_range": bucket_slots,
        "fraction_of_requested_range": (round(len(rated) / bucket_slots, 4)
                                        if bucket_slots else None),
        # False when the rated buckets have withheld buckets between them, so
        # the first and last do not imply everything in between was measured.
        "contiguous": len(rated) == spanned,
    }


def _band(rate: float | None) -> str | None:
    if rate is None:
        return None
    for name, lo, hi in service.BANDS:
        if lo <= rate < hi:
            return name
    return None


def _grid(w0: dt.datetime, w1: dt.datetime, bucket: str) -> list[dt.datetime]:
    step = dt.timedelta(seconds=BUCKETS[bucket])
    out, t = [], w0
    while t < w1:
        out.append(t)
        t += step
    return out


def _segments(*, requested_start: dt.datetime, requested_end: dt.datetime,
              bucket: str, now: dt.datetime,
              collection_start: dt.datetime | None,
              facts: dict, observed: set[dt.datetime]) -> list[dict]:
    """A partition of the requested range, end to end, with nothing implied.

    Every second the caller asked about falls in exactly one segment and every
    segment names why it is what it is. This is the answer to "what happens
    when coverage is partial", and partial is the normal case: collection
    started on a date, and addresses enter and leave the tracked set on theirs.

    The states, and what a reader should do with each:

      before_collection_start  nothing was being collected anywhere yet. No
                               later collection can fill this in.
      before_first_poll        collection was running; this address was not in
                               it yet.
      observed                 polled, with counts behind it.
      not_polled               inside the address's own span, but no poll
                               landed in these buckets. The collector was
                               behind or the process was down.
      after_last_poll          the address's series stops here. `reason` says
                               left_rotation when it is no longer a target,
                               which means it will not resume, as against a
                               collector that is merely behind.
      future                   later than now. No measurement can exist here.
      never_polled             this address has no record at all.
    """
    segs: list[dict] = []

    def add(a: dt.datetime, b: dt.datetime, state: str,
            reason: str | None = None) -> None:
        if b <= a:
            return
        if segs and segs[-1]["state"] == state and segs[-1]["reason"] == reason:
            segs[-1]["to"] = _iso(b)
            return
        segs.append({"from": _iso(a), "to": _iso(b), "state": state,
                     "reason": reason})

    horizon = min(requested_end, now)

    if collection_start is None:
        add(requested_start, horizon, "before_collection_start", "no_polls_yet")
        add(max(requested_start, now), requested_end, "future", None)
        return segs

    add(requested_start, min(horizon, collection_start),
        "before_collection_start", None)

    first, last = facts.get("first_poll"), facts.get("last_poll")
    if first is None:
        add(max(requested_start, collection_start), horizon, "never_polled",
            "not_tracked" if not facts.get("tracked") else "no_polls_yet")
        add(max(requested_start, now), requested_end, "future", None)
        return segs

    add(max(requested_start, collection_start), min(horizon, first),
        "before_first_poll", None)

    # The middle, walked on the bucket grid so a hole is a hole rather than a
    # point pulled earlier in time to close it.
    mid0 = _floor(max(requested_start, first), bucket)
    mid1 = min(horizon, last)
    for t in _grid(mid0, mid1, bucket):
        step = dt.timedelta(seconds=BUCKETS[bucket])
        a = max(t, requested_start, first)
        b = min(t + step, mid1)
        add(a, b, "observed" if t in observed else "not_polled", None)

    add(max(requested_start, last), horizon, "after_last_poll",
        None if facts.get("tracked") else "left_rotation")
    add(max(requested_start, now), requested_end, "future", None)
    return segs


def _range_withheld(*, facts: dict, polls_in_range: int, alo: int,
                    alo_seen: int | None = None,
                    stale_buckets: int = 0) -> str | None:
    """Why there is no rate for the range, in the vocabulary already in use.

    The words are service.address_detail's, and they mean the same things here:
    not_tracked, no_polls_yet, too_few_polls, no_post_only_orders. Two words
    are added, because two facts here have no name there.

      no_polls_in_range      this project holds polls for the address, none of
                             them inside the window asked about. "We have never
                             seen this address" and "we have seen it, but not
                             then" are different answers and a caller acts
                             differently on each.
    A range whose rated buckets hold too few post-only orders to divide
    reports enough_data false and no reason, exactly as a point does and
    exactly as service.maker_markets already does for a thin market.

    stale_data appears here too, and only in one situation: every bucket that
    held polls was withheld as stale, so there is nothing left to pool. `alo`
    is the post-only count over the RATED buckets alone, which is why a range
    with some sound buckets and some stale ones still returns a rate, computed
    out of the sound ones and reported beside alo_total_rated so the
    two denominators cannot be confused.

    too_few_polls is counted over the address's whole record, not over the
    range, which is how service.address_detail counts it. It asks whether this
    address has been observed enough to be described at all. Counting it per
    range would have made a one-hour window of a nine-day address report
    too_few_polls while the single point inside it carried a rate off 7,881
    orders, which is one response giving two answers about one measurement.

    left_rotation is deliberately NOT a range reason. It says that today's
    rate will not refresh, which is a statement about now. A range that ended a
    week ago is not waiting for anything; it is finished. Where the series
    stops and whether it will resume is in coverage.segments instead, which is
    where a reader looking at history will find it. stale_data is different and
    does belong here, because it is a statement about the records inside the
    range rather than about the clock.
    """
    if not facts.get("polls"):
        return "not_tracked" if not facts.get("tracked") else "no_polls_yet"
    if facts["polls"] < service.MIN_POLLS_FOR_RATE:
        return "too_few_polls"
    if not polls_in_range:
        return "no_polls_in_range"
    if not alo:
        if stale_buckets:
            return "stale_data"
        if not alo_seen:
            return "no_post_only_orders"
        return None                    # thin: enough_data false says it
    if alo < MIN_ORDERS_FOR_BUCKET_RATE:
        return None                    # thin: enough_data false says it
    return None


def _envelope(*, coverage: dict, value, withheld_reason: str | None,
              caveats: list[str], next_cursor: str | None = None,
              now: dt.datetime) -> dict:
    """The same field order the MCP envelope uses, built here rather than
    imported: core must not depend on the adapter that sits beside it.

    Coverage precedes value in field order as well as in principle, so a reader
    that truncates a long response sees the denominator rather than only the
    number.
    """
    return {
        "measured": MEASURED,
        "coverage": coverage,
        "as_of": now.isoformat(timespec="seconds"),
        "value": value,
        "withheld_reason": withheld_reason,
        "caveats": caveats,
        "next_cursor": next_cursor,
    }


# ---------------------------------------------------------------------------
# one address
# ---------------------------------------------------------------------------

def address_history(address: str, *, start: str | None = None,
                    end: str | None = None, bucket: str = DEFAULT_BUCKET,
                    limit: int | None = None) -> dict:
    """The post-only series for one address, oldest first.

    Oldest first because a series is read forwards and because it makes paging
    a walk rather than a rewind: next_cursor is the bucket after the last one
    returned, and handing it back as `start` continues where this stopped.
    """
    addr = normalise_address(address)
    now = dt.datetime.now(dt.UTC)
    req_start, req_end = resolve_range(start, end, bucket, now)
    step = BUCKETS[bucket]
    cap = MAX_POINTS if limit is None else max(1, min(int(limit), MAX_POINTS))

    # Aligned outwards, so a range that starts mid-bucket gets the whole bucket
    # its start falls in rather than a bucket computed over part of itself.
    # Whether that happened is reported rather than smoothed over.
    w0, w1 = _floor(req_start, bucket), _ceil(req_end, bucket)
    extends = (w0 != req_start) or (w1 != req_end)
    shorter_than_bucket = (req_end - req_start).total_seconds() < step

    with service._conn() as c, c.cursor() as cur:
        collection_start = _collection_start(cur)
        facts = _address_facts(cur, [addr])[addr]
        counts = _counts(cur, [addr], bucket, w0, w1).get(addr, {})
        meta = _poll_meta(cur, [addr], bucket, w0, w1).get(addr, {})

    grid = _grid(w0, w1, bucket)
    truncated = len(grid) > cap
    shown = grid[:cap]

    points = []
    alo_sum = rej_sum = polls_sum = gapped_sum = capped_sum = 0
    # Pooled separately, over the buckets whose records belong to them. The
    # range rate is divided out of these, so a summary figure cannot be made
    # of points that were themselves withheld.
    alo_rated = rej_rated = stale_buckets = 0
    rated_keys: list = []
    for t in shown:
        cnt = counts.get(t)
        mt = meta.get(t)
        if cnt is None and mt is None:
            continue                       # nobody polled this bucket
        cnt = cnt or {"alo_total": 0, "alo_rejected": 0, "orders": 0}
        mt = mt or {"polls": 0, "polls_with_gap": 0, "polls_capped": 0,
                    "records_behind_poll_seconds": None,
                    "records_span_seconds": None}
        alo = cnt["alo_total"]
        rej = cnt["alo_rejected"]
        alo_sum += alo
        rej_sum += rej
        polls_sum += mt["polls"]
        gapped_sum += mt["polls_with_gap"]
        capped_sum += mt["polls_capped"]
        lag = mt["records_behind_poll_seconds"]
        r, r_reason = _bucket_rate(alo, rej, lag, step,
                                   mt["records_span_seconds"])
        if r_reason == "stale_data":
            stale_buckets += 1
        if r is not None:
            alo_rated += alo
            rej_rated += rej
            rated_keys.append(t)
        # THE TOTAL IS WITHHELD WHEN EVERY POLL IN THE BUCKET HIT THE CEILING.
        #
        # collector.py sets `capped` at n_records >= 2000, and 21,634 of the
        # 24,641 polls in the seven days to 2026-09-23 (87.8%) came back at
        # it. When polls_capped equals polls, `orders` is 2,000 times the
        # number of polls and nothing else: an identity with how often we
        # polled, carrying no information about how much the address traded.
        # Annotating it and leaving the caller to work that out is not the
        # house standard; withholding with a reason is.
        #
        # alo_total and alo_rejected stay, under the names service.py already
        # uses for them, because they are the coverage of the rate rather than
        # a total: they are what the ratio was divided out of, and a rate
        # published without its denominator would break the rule this whole
        # module exists to keep. The collector's own docstring draws the line
        # in the same place: a rate estimated from 2,000 consecutive orders is
        # a precise estimate over the window they span, and it is not fine for
        # counts, and nothing here should be presented as a total.
        all_capped = mt["polls"] > 0 and mt["polls_capped"] == mt["polls"]
        points.append({
            "t": _iso(t),
            "alo_total": alo,
            "alo_rejected": rej,
            "orders": None if all_capped else cnt["orders"],
            "count_withheld_reason": "capped_sample" if all_capped else None,
            # Null where the bucket earned no rate, with the reason beside it.
            # The two counts above stay, so the absence is legible.
            "rejection_rate": r,
            "rate_withheld_reason": r_reason,
            "enough_data": _enough_data(alo),
            "polls": mt["polls"],
            "polls_with_gap": mt["polls_with_gap"],
            # How many of those polls came back at the 2,000-record ceiling.
            # Where this equals polls, the counts above are a floor set by the
            # poll cadence rather than a measure of how much the address sent.
            "polls_capped": mt["polls_capped"],
            "records_behind_poll_seconds": mt["records_behind_poll_seconds"],
            "records_span_seconds": mt["records_span_seconds"],
        })

    observed = {t for t in shown if t in counts or t in meta}
    # The segments describe what was actually returned, so a response cut at
    # the point cap does not claim coverage past its own last point.
    seg_end = min(req_end, shown[-1] + dt.timedelta(seconds=step)) if (
        truncated and shown) else req_end
    segments = _segments(
        requested_start=req_start, requested_end=seg_end, bucket=bucket,
        now=now, collection_start=collection_start, facts=facts,
        observed=observed)

    withheld = _range_withheld(facts=facts, polls_in_range=polls_sum,
                               alo=alo_rated, alo_seen=alo_sum,
                               stale_buckets=stale_buckets)
    rate = (round(rej_rated / alo_rated, 6)
            if (withheld is None and alo_rated) else None)

    observed_seconds = sum(
        (dt.datetime.fromisoformat(s["to"]) - dt.datetime.fromisoformat(s["from"])
         ).total_seconds() for s in segments if s["state"] == "observed")
    requested_seconds = (req_end - req_start).total_seconds()

    coverage = {
        "requested": {"start": _iso(req_start), "end": _iso(req_end),
                      "bucket": bucket, "bucket_seconds": step},
        "aligned": {"start": _iso(w0), "end": _iso(w1)},
        # True when the buckets returned cover time outside the range asked
        # for. A five-minute range still gets a whole hour, and saying so is
        # the difference between a point and a point that means something else.
        "buckets_extend_beyond_requested_range": extends,
        "requested_range_shorter_than_bucket": shorter_than_bucket,
        "collection_started_at": _iso(collection_start),
        "address": {
            "polls_all_time": facts["polls"],
            "first_poll": _iso(facts["first_poll"]),
            "last_poll": _iso(facts["last_poll"]),
            "tracked": facts["tracked"],
        },
        "in_range": {
            "points": len(points),
            "buckets_in_window": len(shown),
            "buckets_with_polls": len(points),
            "buckets_without_polls": len(shown) - len(points),
            "polls": polls_sum,
            "polls_with_gap": gapped_sum,
            "polls_capped": capped_sum,
            "alo_total": alo_sum,
            "alo_rejected": rej_sum,
            "buckets_rated": len(rated_keys),
            "buckets_with_stale_records": stale_buckets,
            "seconds_requested": requested_seconds,
            "seconds_observed": observed_seconds,
            "fraction_observed": (round(observed_seconds / requested_seconds, 4)
                                  if requested_seconds else None),
        },
        # WHICH OF THE TWO SERIES THIS IS, in the response rather than only
        # in a docstring. The other one is service.address_series, which reads
        # hl_ws_buckets and whose denominator is every order update.
        "series_source": {
            "table": "hl_order_counts",
            "filter": "tif='Alo'",
            "denominator": "post-only orders",
            # THE AXIS LABEL, where a caller reads it rather than only in a
            # module docstring. One poll in twenty carries a record more than
            # an hour older than the poll itself, so which of the two times a
            # point is stamped with is load-bearing.
            "timestamp_is": "when the poll ran, not when the orders happened",
            "same_quantity_as": "the rejection_rate on "
                                "/api/hyperliquid/address/{address}",
            "not": "service.address_series / tnega_series on "
                   "hyperliquid.post_only, which reads the WebSocket feed and "
                   "counts all order updates",
        },
        "denominator": "post-only orders (tif=Alo) from polled records",
        "min_polls_for_rate": service.MIN_POLLS_FOR_RATE,
        "min_orders_for_bucket_rate": MIN_ORDERS_FOR_BUCKET_RATE,
        "truncated": truncated,
        "segments": segments,
        "partial": bool(truncated or observed_seconds < requested_seconds),
        # WHICH KINDS of time were not observed, not just that some was.
        #
        # `partial` alone is true on almost every response, because the
        # seconds between the last poll and now are always unobserved, and a
        # flag that is always true carries nothing. These are the segment
        # states behind it, so a range missing only the cycle in progress
        # reads differently from one missing the week before an address
        # entered the tracked set.
        "unobserved_states": sorted({s["state"] for s in segments
                                     if s["state"] != "observed"}),
    }

    value = {
        "address": addr,
        "bucket_seconds": step,
        # WHAT WAS OBSERVED OVER THE RANGE THAT WAS ASKED FOR. No rate here:
        # these figures are range-scoped and the rate is not, so they do not
        # share a block. See `rate` below.
        "range": {
            # The rate's coverage: records seen, not a total. See the note on
            # the points above for why these survive and `orders` does not.
            "alo_total": alo_sum,
            "alo_rejected": rej_sum,
            "polls": polls_sum,
        },
        # THE RATE, WITH THE WINDOW IT ACTUALLY COVERS INSIDE THE SAME OBJECT.
        # `covers` is the window the divisor spans, which is the requested
        # range only when every bucket earned a rate. A caller reading one
        # field reads the number and its window together.
        "rate": {
            "rejection_rate": rate,
            "band": _band(rate),
            "enough_data": _enough_data(alo_rated),
            "alo_total": alo_rated,
            "alo_rejected": rej_rated,
            "withheld_reason": withheld,
            "covers": _rate_window(rated_keys, len(shown), step),
        },
        "points": points,
    }
    cursor = _cursor(shown[-1] + dt.timedelta(seconds=step)) if (
        truncated and shown) else None
    return _envelope(coverage=coverage, value=value, withheld_reason=withheld,
                     caveats=CAVEATS, next_cursor=cursor, now=now)


# ---------------------------------------------------------------------------
# many addresses
# ---------------------------------------------------------------------------

def bulk_history(addresses: list[str], *, start: str | None = None,
                 end: str | None = None, bucket: str = DEFAULT_BUCKET) -> dict:
    """The same series for several addresses, plus the window they share.

    ITS OWN ROUTE, NOT A PARAMETER ON THE OTHER ONE.
    "How did this address behave" and "which of these addresses is quoting"
    are different questions with different boundaries. The first pages, because
    a long history is a long answer; the second refuses a range it cannot fit,
    because a comparison silently trimmed to a narrower window is a comparison
    over a range nobody chose. They are also read differently: one is a line,
    the other is a table of lines that have to be read against each other.

    THE WINDOW THEY SHARE IS THE POINT.
    Ranking makers by a rate is only meaningful where the rates were measured
    over the same time. One address entering the tracked set on 2026-09-23 and
    another running since 2026-09-15 produce figures a table will happily put
    in one column. So the response computes the intersection of what it covered
    for each address, recomputes every rate over just that window, and returns
    both figures per address with the window named. An address with no coverage
    at all is excluded from the intersection rather than emptying it, and named
    in `addresses_without_coverage`.

    The compact grid, rather than a point object per bucket: this returns one
    series per address, and at 25 addresses the object form was several times
    the payload for the same numbers. The grid is regular, so the timestamps
    are implied by a start and a step. Nulls survive the change, which is the
    property that matters: a withheld rate must still arrive as null and never
    as a zero, and the counts that produced it are in their own arrays beside
    it.
    """
    now = dt.datetime.now(dt.UTC)
    req_start, req_end = resolve_range(start, end, bucket, now)
    step = BUCKETS[bucket]

    if not addresses:
        raise RangeError(
            "addresses is empty. Pass a comma separated list, at most "
            f"{MAX_BULK_ADDRESSES}.")
    addrs, seen = [], set()
    for i, a in enumerate(addresses):
        norm = normalise_address(a, f"addresses[{i}]")
        if norm not in seen:
            seen.add(norm)
            addrs.append(norm)
    if len(addrs) > MAX_BULK_ADDRESSES:
        # Refused rather than trimmed. Trimming drops addresses the caller
        # named by hand, and a table missing a row it asked for is worse than
        # an error saying which cap was hit.
        raise RangeError(
            f"{len(addrs)} addresses requested and the cap is "
            f"{MAX_BULK_ADDRESSES}. Split the request.")

    w0, w1 = _floor(req_start, bucket), _ceil(req_end, bucket)
    grid = _grid(w0, w1, bucket)
    if len(grid) > MAX_BULK_POINTS:
        raise RangeError(
            f"the range holds {len(grid)} {bucket} buckets and this route "
            f"returns at most {MAX_BULK_POINTS} per address. This route does "
            f"not page, because a comparison trimmed to a shorter window "
            f"would be a comparison over a range you did not choose. Narrow "
            f"the range, use bucket=day, or read one address at a time from "
            f"/api/hyperliquid/history/{{address}}, which pages.")

    with service._conn() as c, c.cursor() as cur:
        collection_start = _collection_start(cur)
        facts = _address_facts(cur, addrs)
        counts = _counts(cur, addrs, bucket, w0, w1)
        meta = _poll_meta(cur, addrs, bucket, w0, w1)

    rows, per_cover = [], {}
    for addr in addrs:
        cnt, mt = counts.get(addr, {}), meta.get(addr, {})
        rates, alos, rejs, polls_arr, reasons, enough = [], [], [], [], [], []
        alo_sum = rej_sum = polls_sum = gapped_sum = capped_sum = 0
        alo_rated = rej_rated = stale_buckets = 0
        rated_keys: list = []
        for t in grid:
            c_t = cnt.get(t)
            m_t = mt.get(t)
            if c_t is None and m_t is None:
                rates.append(None)
                alos.append(None)       # null, not 0: nobody polled this bucket
                rejs.append(None)
                polls_arr.append(0)
                reasons.append(None)    # not withheld; not observed at all
                enough.append(None)     # null, not false: nothing was measured
                continue
            c_t = c_t or {"alo_total": 0, "alo_rejected": 0}
            m_t = m_t or {"polls": 0, "polls_with_gap": 0, "polls_capped": 0,
                          "records_behind_poll_seconds": None,
                          "records_span_seconds": None}
            alo, rej = c_t["alo_total"], c_t["alo_rejected"]
            r, r_reason = _bucket_rate(
                alo, rej, m_t.get("records_behind_poll_seconds"), step,
                m_t.get("records_span_seconds"))
            rates.append(r)
            reasons.append(r_reason)
            enough.append(_enough_data(alo))
            alos.append(alo)
            rejs.append(rej)
            polls_arr.append(m_t["polls"])
            alo_sum += alo
            rej_sum += rej
            polls_sum += m_t["polls"]
            gapped_sum += m_t["polls_with_gap"]
            capped_sum += m_t["polls_capped"]
            if r_reason == "stale_data":
                stale_buckets += 1
            if r is not None:
                alo_rated += alo
                rej_rated += rej
                rated_keys.append(t)

        observed = {t for t in grid if t in cnt or t in mt}
        segments = _segments(
            requested_start=req_start, requested_end=req_end, bucket=bucket,
            now=now, collection_start=collection_start, facts=facts[addr],
            observed=observed)
        withheld = _range_withheld(facts=facts[addr], polls_in_range=polls_sum,
                                   alo=alo_rated, alo_seen=alo_sum,
                                   stale_buckets=stale_buckets)
        rate = (round(rej_rated / alo_rated, 6)
                if (withheld is None and alo_rated) else None)
        if observed:
            per_cover[addr] = (min(observed),
                               max(observed) + dt.timedelta(seconds=step))

        rows.append({
            "address": addr,
            "tracked": facts[addr]["tracked"],
            # Observed over the requested range. No rate here; see `rate`.
            "range": {
                "alo_total": alo_sum,
                "alo_rejected": rej_sum,
                "buckets_rated": len(rated_keys),
                "buckets_with_stale_records": stale_buckets,
                "polls": polls_sum,
                "polls_with_gap": gapped_sum,
                "polls_capped": capped_sum,
            },
            # The rate and the window its divisor spans, in one object, for
            # the same reason as the single-address route: a rate pooled over
            # one sound bucket in twenty-four is a sound measurement of that
            # bucket and is not the range's rate.
            "rate": {
                "rejection_rate": rate,
                "band": _band(rate),
                "enough_data": _enough_data(alo_rated),
                "alo_total": alo_rated,
                "alo_rejected": rej_rated,
                "withheld_reason": withheld,
                "covers": _rate_window(rated_keys, len(grid), step),
            },
            "coverage": {
                "first_poll": _iso(facts[addr]["first_poll"]),
                "last_poll": _iso(facts[addr]["last_poll"]),
                "buckets_with_polls": len(observed),
                "buckets_in_window": len(grid),
                "segments": segments,
            },
            "series": {
                "start": _iso(w0),
                "step_seconds": step,
                "rejection_rate": rates,
                # Why a null in the array above is null, position for
                # position. Null here alongside a null rate means the bucket
                # was not observed at all, which is the one case that is an
                # absence rather than a withholding.
                "rate_withheld_reason": reasons,
                # False means the bucket was polled and holds too few
                # post-only orders to divide; null means it was not polled at
                # all. The same distinction hl_ws_coverage writes a row for.
                "enough_data": enough,
                "alo_total": alos,
                "alo_rejected": rejs,
                "polls": polls_arr,
            },
            "withheld_reason": withheld,
        })

    # The shared window, and every rate recomputed inside it.
    uncovered = [a for a in addrs if a not in per_cover]
    if per_cover:
        lo = max(v[0] for v in per_cover.values())
        hi = min(v[1] for v in per_cover.values())
    else:
        lo = hi = None
    comparable = None
    if lo is not None and hi is not None and hi > lo:
        idx0 = int((lo - w0).total_seconds() // step)
        idx1 = int((hi - w0).total_seconds() // step)
        members = []
        for row in rows:
            if row["address"] in uncovered:
                continue
            s = row["series"]
            polls = sum(s["polls"][idx0:idx1])
            alo_seen = sum(v for v in s["alo_total"][idx0:idx1] if v)
            rej_seen = sum(v for v in s["alo_rejected"][idx0:idx1] if v)
            # Pooled over the buckets that earned a rate, exactly as the
            # per-address range figure is. A ranking built out of buckets the
            # response itself withheld would be the failure this block exists
            # to prevent, one level up.
            alo_sum = rej_sum = stale = 0
            rated_in_window: list = []
            for i in range(idx0, idx1):
                if s["rate_withheld_reason"][i] == "stale_data":
                    stale += 1
                elif s["rejection_rate"][i] is not None:
                    alo_sum += s["alo_total"][i] or 0
                    rej_sum += s["alo_rejected"][i] or 0
                    rated_in_window.append(
                        w0 + dt.timedelta(seconds=step * i))
            reason = _range_withheld(facts=facts[row["address"]],
                                     polls_in_range=polls, alo=alo_sum,
                                     alo_seen=alo_seen, stale_buckets=stale)
            r = round(rej_sum / alo_sum, 6) if (reason is None and alo_sum) else None
            members.append({
                "address": row["address"],
                "rejection_rate": r,
                "band": _band(r),
                "alo_total": alo_seen,
                "alo_rejected": rej_seen,
                "alo_total_rated": alo_sum,
                "enough_data": _enough_data(alo_sum),
                "buckets_with_stale_records": stale,
                "polls": polls,
                "withheld_reason": reason,
                # Which part of the shared window this row's own divisor
                # spans. The shared window is the most two addresses have in
                # common; this is what each one actually measured inside it,
                # and a ranking reads wrong without it.
                "covers": _rate_window(rated_in_window, idx1 - idx0, step),
            })
        # Ordered by rate, with every withheld rate last rather than sorted as
        # if it were zero. A null that sorts to the top of a rejection ranking
        # is the exact failure this surface exists to avoid.
        members.sort(key=lambda m: (m["rejection_rate"] is None,
                                    -(m["rejection_rate"] or 0.0)))
        comparable = {
            "start": _iso(lo), "end": _iso(hi),
            "addresses": len(members),
            "excluded_without_coverage": uncovered,
            "rows": members,
        }

    coverage = {
        "requested": {"start": _iso(req_start), "end": _iso(req_end),
                      "bucket": bucket, "bucket_seconds": step},
        "aligned": {"start": _iso(w0), "end": _iso(w1)},
        "buckets_extend_beyond_requested_range": (w0 != req_start) or (w1 != req_end),
        "collection_started_at": _iso(collection_start),
        "addresses_requested": len(addrs),
        "addresses_with_coverage": len(per_cover),
        "addresses_without_coverage": uncovered,
        # WHICH OF THE TWO SERIES THIS IS, in the response rather than only
        # in a docstring. The other one is service.address_series, which reads
        # hl_ws_buckets and whose denominator is every order update.
        "series_source": {
            "table": "hl_order_counts",
            "filter": "tif='Alo'",
            "denominator": "post-only orders",
            # THE AXIS LABEL, where a caller reads it rather than only in a
            # module docstring. One poll in twenty carries a record more than
            # an hour older than the poll itself, so which of the two times a
            # point is stamped with is load-bearing.
            "timestamp_is": "when the poll ran, not when the orders happened",
            "same_quantity_as": "the rejection_rate on "
                                "/api/hyperliquid/address/{address}",
            "not": "service.address_series / tnega_series on "
                   "hyperliquid.post_only, which reads the WebSocket feed and "
                   "counts all order updates",
        },
        "denominator": "post-only orders (tif=Alo) from polled records",
        "min_polls_for_rate": service.MIN_POLLS_FOR_RATE,
        "min_orders_for_bucket_rate": MIN_ORDERS_FOR_BUCKET_RATE,
        "buckets_in_window": len(grid),
        "partial": bool(uncovered) or any(
            r["coverage"]["buckets_with_polls"] < len(grid) for r in rows),
        "unobserved_states": sorted({
            s["state"] for r in rows for s in r["coverage"]["segments"]
            if s["state"] != "observed"}),
    }
    withheld = None if per_cover else "not_tracked"
    caveats = list(CAVEATS)
    caveats.append(
        "comparable_window is the intersection of the buckets actually "
        "covered for every address that has any. Rates outside it were "
        "measured over different windows and are not a ranking. When the "
        "intersection is empty, comparable_window is null and there is no "
        "window over which these addresses can be compared.")
    value = {
        "addresses": rows,
        "comparable_window": comparable,
    }
    return _envelope(coverage=coverage, value=value, withheld_reason=withheld,
                     caveats=caveats, now=now)
