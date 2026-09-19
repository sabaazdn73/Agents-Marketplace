"""
brain.py

The persistence result the Hyperliquid tab's Brain section renders, computed
from `hl_ws_buckets` and `hl_ws_coverage` on every read rather than stored.

WHY IT IS COMPUTED AND NOT WRITTEN DOWN
---------------------------------------
The coefficient moves. The same statistic came out at +0.36, +0.26 and +0.16
in three windows two days apart, which is recorded in section 1.7 of
docs/hyperliquid-brain-spec.md and is the single constraint the section is
built on. A figure transcribed into a component, a fixture or a migration
cannot go stale in a way anybody notices; a figure read from the buckets can
only ever describe the buckets. So nothing here is a constant except the
thresholds, and every threshold that is a choice rather than a measurement says
so beside itself.

WHAT IT MAY RETURN
------------------
One window or nothing. The section draws no figure unless every field in
section 5 of the specification arrives, so a partial result here is worse than
no result: it would be drawn. `brain()` returns either a complete block or
None, and the caller passes None through untouched.

THE DEFINITIONS, so a re-run can match section 9 of the specification
--------------------------------------------------------------------
  bucket ratio     sum(n) FILTER (status = 'badAloPxRejected') / sum(n),
                   per (address, bucket_start)
  usable bucket    sum(n) >= 50
  lag-k            within address, demeaned over the usable buckets of the
                   window, numerator over pairs exactly 10k seconds apart with
                   both buckets usable, denominator the variance of all usable
                   buckets in the window
  standard error   1 / sqrt(pairs), per address, never pooled

Checked against the recorded W1 values on 2026-09-17: per-address lag-1
+0.594, +0.575, +0.455, +0.446, +0.356, +0.347, +0.334, +0.314, +0.204, median
+0.356, decay at nine lags, denominator control +0.845 and higher at 8 of 9,
over-dispersion median 4.01 from 1.65 to 264.8. Every figure reproduces.
"""

from __future__ import annotations

import datetime as dt
import math
import statistics
import time

# The measurement rules. These are the specification's, not tuning knobs, and
# changing one invalidates the comparison with every figure recorded in the
# spec, so a change here belongs in the same commit as a change there.
BUCKET_SECONDS = 10
MIN_UPDATES_PER_BUCKET = 50
WINDOW_HOURS = 6
REJECT_STATUS = "badAloPxRejected"

# Contiguous pairs needed before a coefficient is computed for an address. This
# is what resolves a correlation of 0.1 at one standard error, and it is the
# same discipline as MIN_POLLS_FOR_RATE on the REST side: below it the address
# is reported with a reason, never with a number.
MIN_PAIRS = 785

# Standard errors from zero below which the whole set is reported as no signal
# rather than as a weak positive.
SIGNIFICANCE_SE = 3.0

# The lags the decay table shows, in seconds. Multiples of BUCKET_SECONDS by
# construction: a lag that is not a whole number of buckets has no pairs.
LAGS = (10, 20, 30, 60, 120, 300, 600, 900, 1800)

# How far back a window may be looked for, and the age at which the result
# stops being shown.
#
# These are two different numbers on purpose. A search bounded at the same 14
# days as the withholding rule can never return a window old enough to withhold,
# so the section would fall back to "no window was measured", which reads as an
# outage and loses the date. Looking back further lets the result be named and
# then withheld by age, which is what section 6.4 of the specification asks for.
#
# STALE_AFTER_DAYS IS POLICY, NOT MEASUREMENT. Nothing in the data measures how
# long the coefficient survives. The evidence is that it moved from +0.1179 to
# +0.3559 across three complete windows inside three days, all three positive
# and each at least 2.9 standard errors from zero, which says the sign holds
# and the size moves. It does not say how fast, so this number is a choice.
LOOKBACK_DAYS = 60
STALE_AFTER_DAYS = 14

# Wall-clock budgets. Two of them, and the split is the point.
#
# WHY THIS WAS ONE NUMBER AND WAS WRONG, corrected 2026-09-19
# There used to be a single 9 second budget measured from the start of the
# whole computation, with the headline window computed first and never cut.
# The headline work alone takes 9.4 to 10.4 seconds on this cluster, so the
# budget was already spent by the time the cross-window comparison was
# reached, every time, on a cold process. Measured that day: four warm calls
# returned three windows and the first cold call returned none.
#
# That was tolerable while one window existed, because "not compared" was
# true. With three complete windows it made the section assert there was only
# one, which is the failure this file exists to prevent: reporting an absence
# of evidence that is actually an absence of compute. The comparison now gets
# a budget of its own, measured from when it starts, under a total ceiling so
# an HTTP handler on a 512MiB container still has a bound.
TOTAL_BUDGET_SECONDS = 14.0
MAGNITUDE_BUDGET_SECONDS = 4.0

# How many NOT-YET-CACHED windows to compute per call. It is a rate limit on
# work, not a limit on how many windows the comparison covers: closed windows
# never change, so each one is computed once per process and then compared for
# free. A cold process reaches the full set within a few calls.
MAX_NEW_WINDOWS_PER_CALL = 3

# Median r1 per closed window, keyed by (start, end).
#
# WHY NOTHING IS EVICTED BY AGE, decided 2026-09-19
# This was `windows[1:MAX_MAGNITUDE_WINDOWS]` over a newest-first list, so the
# fourth complete window would have pushed out the oldest. On the day the
# question was asked the oldest window carried the entire high end of the
# range, +0.3559 against +0.1179 and +0.1748, so that rule would have narrowed
# the published range from 3.0x to about 1.5x with nothing having happened on
# the venue, and the page would have reported a steadier coefficient because
# it had forgotten the evidence of instability.
#
# The comparison exists to show that the magnitude does not replicate. A
# window that is the only evidence of instability is the one worth keeping,
# and dropping it for being old inverts what the comparison is for. So the
# range is taken over every window still inside LOOKBACK_DAYS, and the only
# pruning is of windows that have fallen out of that lookback entirely.
_WINDOW_MEDIANS: dict[tuple, float] = {}

DENOMINATOR = "all order updates, not post-only orders"
STATISTIC = "lag-k autocorrelation, within address, demeaned"

_GRID_PER_HOUR = 3600 // BUCKET_SECONDS
_GRID_PER_WINDOW = WINDOW_HOURS * _GRID_PER_HOUR


def _stamp(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _short(address: str) -> str:
    return address[:10]


# ---------------------------------------------------------------------------
# Window selection
# ---------------------------------------------------------------------------

def complete_windows(cur) -> list[tuple[dt.datetime, dt.datetime, int]]:
    """Hour-aligned windows where every watched address has a coverage row in
    every bucket, newest first and non-overlapping.

    Completeness is read from `hl_ws_coverage`, which holds a row per watched
    address per bucket whether or not that address delivered anything. Without
    it, a subscribed-but-idle address and a silently dead subscription are the
    same absence, and a coefficient computed across the difference would be
    measuring the collector.

    Hour alignment is a choice, made so that a window has a name a reader can
    hold ("14:00 to 20:00") rather than an arbitrary offset, and so that the
    window does not creep by a few seconds between requests and quietly change
    the figure under a reader who reloads.
    """
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=LOOKBACK_DAYS)
    cur.execute(
        """
        SELECT date_trunc('hour', bucket_start) AS h,
               count(*) AS slots, min(addrs) AS lo, max(addrs) AS hi
        FROM (
            SELECT bucket_start, count(DISTINCT address) AS addrs
            FROM hl_ws_coverage
            WHERE bucket_start >= %s
            GROUP BY bucket_start
        ) t
        GROUP BY h
        ORDER BY h
        """,
        (since,),
    )
    hours = {}
    for h, slots, lo, hi in cur.fetchall():
        # A full hour is every bucket start on the grid present, with the same
        # set of addresses in each of them.
        if slots == _GRID_PER_HOUR and lo == hi:
            hours[h] = int(lo)

    starts = sorted(hours, reverse=True)
    out: list[tuple[dt.datetime, dt.datetime, int]] = []
    claimed: set[dt.datetime] = set()
    for h in starts:
        span = [h - dt.timedelta(hours=i) for i in range(WINDOW_HOURS)]
        if any(s not in hours for s in span):
            continue
        if any(s in claimed for s in span):
            continue
        if len({hours[s] for s in span}) != 1:
            # The watch set changed inside the window. Two different address
            # sets in one coefficient is a different measurement, not a longer
            # one.
            continue
        start = span[-1]
        end = h + dt.timedelta(hours=1)
        out.append((start, end, hours[h]))
        claimed.update(span)
    return out


# ---------------------------------------------------------------------------
# The measurement
# ---------------------------------------------------------------------------

def _bucket_rows(cur, start: dt.datetime, end: dt.datetime):
    """Usable buckets in the window, one row per (address, bucket_start).

    The usability rule is applied in the database rather than in Python so the
    rows that fail it never cross the wire: an unusable bucket is dropped
    before the pair is formed, which is the first line of `excluded`.
    """
    cur.execute(
        f"""
        SELECT address, bucket_start, sum(n)::FLOAT AS total,
               coalesce(sum(n) FILTER (WHERE status = '{REJECT_STATUS}'), 0)::FLOAT
        FROM hl_ws_buckets
        WHERE bucket_start >= %s AND bucket_start < %s
        GROUP BY address, bucket_start
        HAVING sum(n) >= {MIN_UPDATES_PER_BUCKET}
        """,
        (start, end),
    )
    series: dict[str, dict[int, tuple[float, float]]] = {}
    for address, bucket_start, total, rejected in cur.fetchall():
        series.setdefault(address, {})[int(bucket_start.timestamp())] = (
            rejected / total, total,
        )
    return series


def _autocorrelation(series: dict[int, tuple[float, float]], lag: int, idx: int):
    """Lag-k within one address, demeaned, contiguous pairs only.

    `idx` picks the quantity: 0 is the rejected share, 1 is the raw update
    count, which is the denominator control. Both are computed the same way on
    the same buckets so the comparison is between the two quantities and not
    between two methods.

    The denominator is the variance over every usable bucket in the window and
    the numerator is the mean product over the pairs that exist. Buckets whose
    partner 10k seconds later is missing or unusable contribute to the
    denominator and not to the numerator, which is what keeps a gap from
    reading as agreement.
    """
    keys = sorted(series)
    values = [series[k][idx] for k in keys]
    n = len(values)
    if n < 2:
        return None, 0
    mean = sum(values) / n
    variance = sum((v - mean) ** 2 for v in values) / n
    total = 0.0
    pairs = 0
    for k in keys:
        partner = series.get(k + lag)
        if partner is not None:
            total += (series[k][idx] - mean) * (partner[idx] - mean)
            pairs += 1
    if pairs == 0 or variance == 0:
        return None, pairs
    return (total / pairs) / variance, pairs


def _over_dispersion(series: dict[int, tuple[float, float]]) -> float | None:
    """How far the spread between buckets exceeds the binomial floor.

    The convention is the mean across buckets of p(1-p)/n_i, with p the
    address's mean ratio over the window and the variance taken as the
    population variance. The multiple moves with that convention, from about
    4.0 to about 4.8 at the median, so the convention travels with the figure
    to the reader rather than staying in this file.
    """
    ratios = [v[0] for v in series.values()]
    counts = [v[1] for v in series.values()]
    if len(ratios) < 2:
        return None
    p = sum(ratios) / len(ratios)
    variance = sum((r - p) ** 2 for r in ratios) / len(ratios)
    floor = sum(p * (1 - p) / n for n in counts if n) / len(counts)
    if floor <= 0:
        return None
    return variance / floor


def _median_r1(series_by_address: dict[str, dict[int, tuple[float, float]]]):
    """Median lag-1 across the addresses that clear MIN_PAIRS, or None."""
    values = []
    for series in series_by_address.values():
        r, pairs = _autocorrelation(series, BUCKET_SECONDS, 0)
        if r is not None and pairs >= MIN_PAIRS:
            values.append(r)
    return statistics.median(values) if values else None


def _watched_addresses(cur, start: dt.datetime, end: dt.datetime) -> list[str]:
    cur.execute(
        "SELECT DISTINCT address FROM hl_ws_coverage "
        "WHERE bucket_start >= %s AND bucket_start < %s",
        (start, end),
    )
    return sorted(r[0] for r in cur.fetchall())


def _never_listened_count(cur) -> int | None:
    """Tracked addresses that have never been on the WebSocket feed at all.

    All-time on both sides, because the sentence it feeds is an all-time claim.
    Subtracting this window's watch set from the tracked count would report an
    address that was listened to last week as one that never was, and the
    section's whole point about those addresses is that nothing has been heard
    from them in either direction.
    """
    try:
        cur.execute("SELECT DISTINCT address FROM hl_order_counts")
        tracked = {r[0] for r in cur.fetchall()}
        cur.execute("SELECT DISTINCT address FROM hl_ws_coverage")
        listened = {r[0] for r in cur.fetchall()}
        cur.execute("SELECT DISTINCT address FROM hl_ws_buckets")
        listened |= {r[0] for r in cur.fetchall()}
        return len(tracked - listened)
    except Exception:
        return None


def _coverage_floor(cur):
    """The first bucket with a coverage row, and whether bucket rows exist
    before it. Those earlier rows are excluded everywhere: silence in them
    cannot be told apart from a dead subscription."""
    cur.execute("SELECT min(bucket_start) FROM hl_ws_coverage")
    coverage_start = cur.fetchone()[0]
    cur.execute("SELECT min(bucket_start) FROM hl_ws_buckets")
    buckets_start = cur.fetchone()[0]
    if coverage_start is None or buckets_start is None:
        return None
    return coverage_start if buckets_start < coverage_start else None


def _excluded(thin: list[tuple[str, int]], coverage_start) -> list[str]:
    lines = [
        f"buckets under {MIN_UPDATES_PER_BUCKET} updates, dropped before the "
        "pair was formed",
        f"non-contiguous pairs, where the bucket {BUCKET_SECONDS}s later has "
        "no usable row",
    ]
    if len(thin) == 1:
        address, usable = thin[0]
        lines.append(
            f"one watched address, {_short(address)}, with {usable:,} usable "
            f"buckets of {_GRID_PER_WINDOW:,}"
        )
    elif thin:
        named = ", ".join(_short(a) for a, _ in thin)
        lines.append(
            f"{len(thin)} watched addresses with fewer than {MIN_PAIRS:,} "
            f"contiguous pairs: {named}"
        )
    lines.append("all addresses outside the WebSocket watch set")
    if coverage_start is not None:
        lines.append(
            f"all bucket rows before {_stamp(coverage_start)}, which have no "
            "coverage row"
        )
    return lines


def compute(cur) -> dict | None:
    """The whole block, or None when no window supports one.

    None is not an error and not a zero. It means no six-hour stretch in the
    store has a coverage row in every bucket, which is a statement about the
    collector, and the section says so rather than drawing anything.
    """
    began = time.monotonic()
    windows = complete_windows(cur)
    if not windows:
        return None

    start, end, watched_count = windows[0]
    series_by_address = _bucket_rows(cur, start, end)
    watched = _watched_addresses(cur, start, end)
    if not watched:
        return None
    if len(watched) != watched_count:
        # The hour scan counts addresses per bucket; this counts the distinct
        # addresses over the whole window. They differ only if the watch set
        # changed inside the window while its size stayed the same, which a
        # per-bucket count cannot see. Two different address sets in one
        # coefficient is a different measurement, not a longer one.
        return None

    rows = []
    measured: dict[str, dict[int, tuple[float, float]]] = {}
    thin: list[tuple[str, int]] = []
    for address in watched:
        series = series_by_address.get(address)
        if not series:
            rows.append({
                "address": address, "usable_buckets": 0, "pairs": 0,
                "r1": None, "standard_error": None, "mean_ratio": None,
                "withheld_reason": "no_buckets_yet",
            })
            continue
        r1, pairs = _autocorrelation(series, BUCKET_SECONDS, 0)
        usable = len(series)
        if r1 is None or pairs < MIN_PAIRS:
            thin.append((address, usable))
            rows.append({
                "address": address, "usable_buckets": usable, "pairs": pairs,
                "r1": None, "standard_error": None, "mean_ratio": None,
                "withheld_reason": "too_few_buckets",
            })
            continue
        measured[address] = series
        ratios = [v[0] for v in series.values()]
        rows.append({
            "address": address,
            "usable_buckets": usable,
            "pairs": pairs,
            "r1": round(r1, 4),
            "standard_error": round(1.0 / math.sqrt(pairs), 4),
            "mean_ratio": round(sum(ratios) / len(ratios), 4),
            "withheld_reason": None,
        })

    if not measured:
        return None

    # Ordered by the coefficient, strongest first, with the withheld addresses
    # last: they are shown, never dropped, but they are not the reading.
    rows.sort(key=lambda r: (r["r1"] is None, -(r["r1"] or 0)))

    per_address = {a: _autocorrelation(s, BUCKET_SECONDS, 0) for a, s in measured.items()}
    pair_counts = [p for _, p in per_address.values()]
    usable_counts = [len(s) for s in measured.values()]
    errors = [1.0 / math.sqrt(p) for p in pair_counts]
    median_r1 = statistics.median([r for r, _ in per_address.values()])

    decay = []
    for lag in LAGS:
        values = []
        pairs_at_lag = []
        for series in measured.values():
            r, pairs = _autocorrelation(series, lag, 0)
            if r is not None:
                values.append(r)
                pairs_at_lag.append(pairs)
        if len(values) == len(measured) and values:
            # The standard error at this lag, from the thinnest address at this
            # lag. A decay row has its own pair count, and it is not the
            # headline's: at 1,800 seconds the thinnest address has fewer pairs
            # than at 10, so the error is larger and the significance test is
            # harder. Sending the headline's error with every row would let a
            # row be read against a threshold it never had to pass.
            error = 1.0 / math.sqrt(min(pairs_at_lag))
            median = statistics.median(values)
            decay.append({
                "lag_seconds": lag,
                "median_r1": round(median, 4),
                "pairs_min": min(pairs_at_lag),
                "standard_error": round(error, 4),
                "addresses_significant": sum(
                    1 for r, p in zip(values, pairs_at_lag)
                    if abs(r) >= SIGNIFICANCE_SE / math.sqrt(p)),
                "addresses_total": len(values),
            })

    control = []
    higher = 0
    for address, series in measured.items():
        r, _ = _autocorrelation(series, BUCKET_SECONDS, 1)
        if r is None:
            continue
        control.append(r)
        if r > per_address[address][0]:
            higher += 1

    dispersion = [d for d in (_over_dispersion(s) for s in measured.values()) if d]

    # The coefficient is withheld for the whole set when it is inside three
    # standard errors of zero at the thinnest address. A null result keeps its
    # place: it is reported as a tested absence, not rewritten as a weak
    # positive.
    withheld_reason = None
    if abs(median_r1) < SIGNIFICANCE_SE * max(errors):
        withheld_reason = "not_significant"
    # Age is taken from the end of the measured window, never from the last
    # bucket written: a collector running now says nothing about whether the
    # window being quoted is current. Reported rather than suppressed, so the
    # section can name the window and say it is too old, which is a different
    # sentence from "nothing was measured".
    age = (dt.datetime.now(dt.timezone.utc) - end).total_seconds()
    if age > STALE_AFTER_DAYS * 86400:
        withheld_reason = "stale_window"

    never_listened = _never_listened_count(cur)
    block = {
        "window_start": _stamp(start),
        "window_end": _stamp(end),
        "window_hours": WINDOW_HOURS,
        "bucket_seconds": BUCKET_SECONDS,
        "min_updates_per_bucket": MIN_UPDATES_PER_BUCKET,
        "addresses_measured": len(measured),
        "addresses_watched": len(watched),
        "usable_buckets_min": min(usable_counts),
        "usable_buckets_max": max(usable_counts),
        "pairs_min": min(pair_counts),
        "standard_error": {
            "min": round(min(errors), 4),
            "max": round(max(errors), 4),
        },
        "lag_seconds": BUCKET_SECONDS,
        "median_r1": round(median_r1, 4),
        "denominator": DENOMINATOR,
        "statistic": STATISTIC,
        "excluded": _excluded(thin, _coverage_floor(cur)),
        "withheld_reason": withheld_reason,
        "decay": decay,
        "addresses": rows,
    }
    if never_listened is not None:
        block["addresses_not_watched"] = never_listened
    if control:
        block["denominator_control"] = {
            "median_r1": round(statistics.median(control), 4),
            "addresses_higher": higher,
            "addresses_total": len(control),
        }
    if dispersion:
        block["over_dispersion"] = {
            "median": round(statistics.median(dispersion), 2),
            "min": round(min(dispersion), 2),
            "max": round(max(dispersion), 1),
            "convention": "the mean over buckets of p(1-p)/n",
            # How many addresses the multiple was computed for, against how
            # many were measured. "Every address" is a claim about a
            # population, and it is only checkable if the population travels
            # with it.
            "addresses": len(dispersion),
            "addresses_total": len(measured),
        }

    # The cross-window comparison, which is the constraint the whole section is
    # built on rather than a decoration: the sign replicates and the magnitude
    # does not.
    #
    # How many complete windows EXIST is reported unconditionally, separately
    # from how many were compared. Those are different facts and collapsing
    # them is what let the section claim there was one window while three were
    # stored.
    block["complete_windows"] = len(windows)

    _WINDOW_MEDIANS[(start, end)] = median_r1
    live = {(s, e) for s, e, _ in windows}
    for key in list(_WINDOW_MEDIANS):
        if key not in live:
            del _WINDOW_MEDIANS[key]

    phase_began = time.monotonic()
    computed = 0
    for other_start, other_end, _ in windows:
        if (other_start, other_end) in _WINDOW_MEDIANS:
            continue
        if computed >= MAX_NEW_WINDOWS_PER_CALL:
            break
        now = time.monotonic()
        if (now - phase_began > MAGNITUDE_BUDGET_SECONDS
                or now - began > TOTAL_BUDGET_SECONDS):
            break
        other = _median_r1(_bucket_rows(cur, other_start, other_end))
        computed += 1
        if other is not None:
            _WINDOW_MEDIANS[(other_start, other_end)] = other

    medians = list(_WINDOW_MEDIANS.values())
    if len(medians) > 1:
        block["magnitude_range"] = {
            "min": round(min(medians), 4),
            "max": round(max(medians), 4),
            "windows": len(medians),
            # So a reader can tell a comparison over everything stored from one
            # that is still filling in behind a budget.
            "windows_available": len(windows),
        }
    elif len(windows) > 1:
        # The distinction the old code could not draw. More than one complete
        # window is stored and this call could not compute them, which is not
        # the same as there being nothing to compare against.
        block["magnitude_range_pending"] = {
            "windows_available": len(windows),
            "windows_compared": len(medians),
        }
    return block
