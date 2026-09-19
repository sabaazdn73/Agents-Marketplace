"""
collector.py

Polls Hyperliquid's historicalOrders for a fixed set of market-maker addresses
and reduces each response to typed status counts.

WHY THIS EXISTS AND WHY IT CANNOT WAIT
--------------------------------------
`historicalOrders` returns only the 2,000 most recent records per address and
ignores `startTime` and `endTime`. Both were tested: passing either returns the
identical 2,000 rows. So there is no backfill. Any history this project has is
history it collected, and every hour without a collector is an hour that cannot
be recovered later.

WHAT IS BEING MEASURED
----------------------
Post-only rejection. A market maker sends ALO (post-only) orders, and the
matching engine rejects any that would cross the book rather than resting them.
A rejected ALO never reaches the book, so it never provides liquidity, and it
is invisible in fills. Measured across six comparable top-volume makers on
2026-09-14, the rate ranged from 0.5% to 92.1%. A bot at 92% is spraying orders
that never rest; a bot at 0.5% is genuinely quoting. Nothing in the surveyed
tooling separates the two.

THE RATE BUDGET, WHICH SETS EVERY OTHER NUMBER HERE
---------------------------------------------------
Hyperliquid's IP limit is 1,200 request-weight per minute. `historicalOrders`
costs 20 base plus 1 per 20 items returned, so a full 2,000-record response is
120 weight. That is a hard ceiling of 10 polls per minute, and it is the
binding constraint on the whole design.

WHY 50 ADDRESSES
----------------
Not a round number. ALO usage was sampled across leaderboard volume bands on
2026-09-15:

    rank 0-20      6 of 6 addresses use ALO, median share 97%
    rank 20-50     3 of 5 use ALO, median share 100%
    rank 50-100    1 of 6 use ALO, median share 0%
    rank 100-200   1 of 6 use ALO, median share 0%

Market making stops at about rank 50. Below it the median address posts no
post-only orders at all, so polling further down spends the rate budget on
directional traders who cannot exhibit the signal being measured.

WHY A 15 MINUTE CADENCE
-----------------------
50 polls spaced 10 seconds apart is 6 polls per minute, 60% of the ceiling,
finishing in about 8.3 minutes. That leaves roughly 7 minutes of slack inside
each 15-minute window, which matters because scheduled GitHub Actions runs are
routinely late, and it leaves budget for the builder_fills job alongside.

WHAT THIS CANNOT DO, STATED PLAINLY
-----------------------------------
It samples, it does not capture. The 2,000-record window turns over in 14 to 24
seconds for the fastest makers measured, so no achievable cadence sees every
order from them. That is fine for the thing being measured, because a rejection
*rate* estimated from 2,000 consecutive orders is a precise estimate over the
window those orders span. It is not fine for counts, and nothing here should be
presented as a total. Every poll records the span it actually covers and the
gap since the previous poll, so coverage is measurable rather than assumed.
"""

from __future__ import annotations

import json
import urllib.request
from typing import Any

INFO_URL = "https://api.hyperliquid.xyz/info"
LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard"

# Measured ceiling is 10 polls/min. 10s spacing is 6/min, 60% of it.
POLL_SPACING_SECONDS = 10
ADDRESS_COUNT = 50

# The statuses that mean "this order never rested on the book". Kept as a set
# of distinct values rather than collapsed to a boolean, because they are
# different failures: a bad ALO price is a maker mispricing its quote against a
# moving book, while a minimum-notional rejection is a sizing bug. Collapsing
# them would destroy the only interesting distinction in the data.
#
# A plain "rejected" status does exist, but it is a minority of rejections and
# relying on it is the trap. Measured over the collector's first 56 polls
# across all 50 addresses: 10,889 rejections in total, of which only 1,392
# carried the bare "rejected" label. Filtering on `status == "rejected"` alone
# therefore catches about 13% of them and silently drops the rest, including
# every post-only rejection, which is the signal this whole tab exists for.
#
# An earlier version of this comment claimed the bare status did not exist at
# all. That was drawn from six addresses and was wrong; the collector's own
# data corrected it.
#
# Re-measured 2026-09-18, over the addresses in the current rotation rather
# than every address ever polled: the bare status produces ZERO records among
# them. It is kept in this set regardless. Its absence today is a fact about
# which thirty-one addresses are being watched, not about the venue, and
# dropping a status from the set because the current sample lacks it is how a
# collector stops being able to see something it once saw.
REJECTION_STATUSES = {
    "rejected",                  # the generic case, about 13% of rejections
    "badAloPxRejected",          # post-only that would have crossed
    "iocCancelRejected",         # IOC that could not fill
    "minTradeNtlRejected",       # below minimum notional
    "perpMarginRejected",        # insufficient margin
    "openInterestIncreaseRejected",
    "insufficientSpotBalanceRejected",
    "oracleRejected",
    "tickRejected",
}
# Cancels that the engine performed, as opposed to the maker withdrawing a
# quote. Tracked separately for the same reason.
SYSTEM_CANCEL_STATUSES = {"reduceOnlyCanceled", "marginCanceled", "siblingFilledCanceled"}

POST_ONLY_TIF = "Alo"


def _post(payload: dict, timeout: int = 45) -> Any:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        INFO_URL, data=body,
        headers={"content-type": "application/json", "User-Agent": "tnega-hl-collector/1"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def fetch_leaderboard(timeout: int = 180) -> list[dict]:
    """The full leaderboard. About 37MB and roughly 46,000 addresses, served
    without authentication.

    ONLY THE VOLUME FIELD IS USED, AND THE REASON IS NARROWER THAN IT WAS
    Each row carries accountValue and four windows of pnl, roi and vlm.

    A previous version of this docstring said the PnL fields contradicted
    themselves, on the grounds that month PnL exceeded allTime PnL for 51.3%
    of rows. That test was wrong and the claim it produced was wrong. PnL is
    signed. An account down $2M since it opened and up $200k this month has a
    month figure above its allTime figure and nothing is amiss. Of the 23,666
    rows that test flagged, 20,791 have a negative allTime PnL, and the rest
    are accounted for by a month that simply outran a smaller lifetime total.
    The test detected the sign of a number, not an inconsistency.

    What the fields mean was then checked against the venue rather than
    inferred from their names, on 2026-09-18. The portfolio endpoint returns
    the same four windows per address. Its allTime history spans 13 days for a
    new account and 1,101 for an old one, so allTime is since inception.
    Comparing the file against that endpoint for 60 randomly sampled addresses
    over $50k, the two disagree by a median of 0.17% of account value on
    allTime and 0.41% on month, which is the lag of a snapshot rather than a
    defect. accountValue holds up the same way: on 40 randomly sampled
    addresses the live total sits within 10% for 60% of them, the misses run in
    both directions, and the median ratio is 1.00.

    The earlier "45% to 100% away" figure for accountValue came from six
    addresses chosen by volume rank, which are the largest and most active
    accounts on the venue and the ones whose balances move furthest between a
    snapshot and a read. It was a biased sample generalised to the file.

    So the file is sound, and the reason only volume is read here is now a
    scope decision rather than a data one. Two things are worth knowing before
    that changes. accountValue is perps, spot, staking and vault equity
    together, not the perps figure clearinghouseState returns, so the two are
    not interchangeable. And the file is a periodic snapshot: Last-Modified
    was 29 minutes old when this was measured, so it is not a live read.

    On the question it was fetched to answer, the answer stands and is now
    supported rather than undermined by the source. Across the 30 rated makers
    that appear on it, the correlation between post-only rejection rate and
    month ROI is +0.013 by Pearson and +0.118 by rank. The two are unrelated,
    which means a clean quoter is not thereby a profitable one. That was worth
    saying when the source was thought to be broken and is worth more now.

    THE MONTH WINDOW ENDS AROUND 13:00 UTC, NOT AT THE FETCH TIME
    Established 2026-09-19 by fit, because the venue documents it nowhere. One
    address holds 12.0M HYPE staked and has never placed an order, so its whole
    profit is the stake moving with the price and can be recomputed
    independently. Sweeping the window boundary across 48 hours, that
    recomputation lands within 0.1% of the file's figure for an end between
    07:00 and 13:00 UTC, and diverges to +14% by 01:00 and +58% a day earlier.

    Read these figures as describing that window rather than the moment the
    file was downloaded. Last-Modified is when the file was written and is not
    the same thing: it was 29 minutes old when this was measured, while the
    window it describes had closed hours before.

    One address and one fit, so it is a working assumption rather than a
    documented fact, and a second attributable address is how it gets tested.

    WHERE THE PnL CAME FROM CAN BE RECOMPUTED, FOR ONE SHAPE OF ACCOUNT
    See core.hyperliquid.attribution. For an account whose value sits in
    staking the composition closes to 0.25% from userFills, delegatorSummary
    with its history and rewards, and the ledger. For an account that trades it
    cannot be done at all, because the venue serves no fills history: asked for
    any window older than today its fills endpoint returns nothing.
    """
    req = urllib.request.Request(
        LEADERBOARD_URL, headers={"User-Agent": "tnega-hl-collector/1"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.load(resp)
    return data.get("leaderboardRows", data if isinstance(data, list) else [])


def _month_volume(row: dict) -> float:
    for window in row.get("windowPerformances") or []:
        if window and window[0] == "month":
            try:
                return float((window[1] or {}).get("vlm") or 0.0)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def select_addresses(rows: list[dict], count: int = ADDRESS_COUNT) -> list[dict]:
    """Top `count` addresses by 30-day volume.

    Kept because it is the cheap ranking that orders the candidate list, but it
    is NOT the selection any more. See select_active_addresses: volume alone
    chose a set where 18 of 50 returned no current data at all."""
    ranked = sorted(rows, key=_month_volume, reverse=True)
    out = []
    for r in ranked:
        addr = (r.get("ethAddress") or "").lower()
        if not addr.startswith("0x") or len(addr) != 42:
            continue
        out.append({"address": addr, "month_volume": _month_volume(r),
                    "account_value": float(r.get("accountValue") or 0.0)})
        if len(out) >= count:
            break
    return out


# An address qualifies only if historicalOrders returns something newer than
# this. One hour is well past the 15-minute cadence, so a live maker cannot
# fail it on timing alone.
MAX_RECORD_AGE_SECONDS = 3600
# And only if it actually posts post-only orders, because post-only rejection
# is the measurement. Set at 20% rather than a majority so a mixed maker still
# qualifies while a purely directional trader does not.
MIN_ALO_SHARE = 0.20


def probe_activity(address: str, now_ms: int | None = None) -> dict:
    """One poll, reduced to the two facts that decide selection.

    Costs a full historicalOrders call, which is why this runs in the target
    refresh rather than anywhere near the 15-minute cycle."""
    import time as _t
    now_ms = now_ms or int(_t.time() * 1000)
    orders = fetch_orders(address)
    stamps = [r.get("statusTimestamp") for r in orders
              if isinstance(r.get("statusTimestamp"), (int, float)) and r.get("statusTimestamp") > 0]
    alo = sum(1 for r in orders if (r.get("order") or {}).get("tif") == POST_ONLY_TIF)
    newest = max(stamps) if stamps else None
    return {
        "address": address,
        "n_records": len(orders),
        "record_age_seconds": ((now_ms - newest) / 1000.0) if newest else None,
        "alo_share": (alo / len(orders)) if orders else 0.0,
    }


def is_active(probe: dict) -> bool:
    age = probe.get("record_age_seconds")
    return (age is not None and age <= MAX_RECORD_AGE_SECONDS
            and (probe.get("alo_share") or 0.0) >= MIN_ALO_SHARE)


def select_active_addresses(rows, count=ADDRESS_COUNT, max_probes=160,
                            probe=probe_activity, sleep=None, log=print) -> list[dict]:
    """Rank by volume, then keep only what the order endpoint proves is live.

    WHY THIS IS NOT A LEADERBOARD FILTER
    ------------------------------------
    The obvious cheap rule is the leaderboard's own daily volume, and it does
    not work. Measured 2026-09-15 on the top 40 by 30-day volume: 56 of the top
    60 show non-zero DAY volume, yet only 24 of 40 return an order newer than
    an hour from historicalOrders. The worst case is the number one address by
    volume, trading 2.2 billion a day, whose 2,000 records are a fourteen-minute
    span from 147 days earlier. The endpoint serves a frozen slice for some
    accounts, and no field on the leaderboard predicts which.

    So liveness has to be read from the endpoint the collector actually uses.
    That costs one call per candidate, which is why selection is a separate job
    on its own IP rather than part of the poll cycle.

    Yield measured on that same sample: 24 of 40 fresh, and 17 of 40 both fresh
    and posting post-only, so reaching 50 takes on the order of 120 probes.
    """
    import time as _t
    sleep = sleep or (lambda s: _t.sleep(s))
    ranked = select_addresses(rows, count=max_probes)
    out, probed, skipped = [], 0, {"stale": 0, "no_alo": 0, "error": 0}
    for cand in ranked:
        if len(out) >= count:
            break
        probed += 1
        try:
            p = probe(cand["address"])
        except Exception as e:  # noqa: BLE001 -- one bad candidate must not end the refresh
            skipped["error"] += 1
            log(f"[hl-select] {cand['address'][:10]} probe failed "
                f"{type(e).__name__}: {str(e)[:70]}", flush=True)
            sleep(POLL_SPACING_SECONDS)
            continue
        if is_active(p):
            out.append({**cand, "alo_share": p["alo_share"],
                        "record_age_seconds": p["record_age_seconds"]})
        elif p.get("record_age_seconds") is None or p["record_age_seconds"] > MAX_RECORD_AGE_SECONDS:
            skipped["stale"] += 1
        else:
            skipped["no_alo"] += 1
        if len(out) < count and probed < len(ranked):
            sleep(POLL_SPACING_SECONDS)
    log(f"[hl-select] probed {probed}, kept {len(out)}, "
        f"skipped stale={skipped['stale']} no_alo={skipped['no_alo']} "
        f"error={skipped['error']}", flush=True)
    return out


def fetch_orders(address: str) -> list[dict]:
    """The 2,000 most recent order records for one address."""
    result = _post({"type": "historicalOrders", "user": address})
    return result if isinstance(result, list) else []


def summarise(address: str, orders: list[dict]) -> dict:
    """Reduce one response to typed counts plus the window it covers.

    Counts are grouped by (coin, tif, status). That grouping is what preserves
    the typed statuses through storage, and it is small: a poll produces on the
    order of tens of rows rather than 2,000, which is what makes continuous
    collection affordable to store.
    """
    counts: dict[tuple[str, str, str], int] = {}
    stamps: list[int] = []
    alo = 0
    for rec in orders:
        order = rec.get("order") or {}
        status = rec.get("status") or "unknown"
        coin = order.get("coin") or "unknown"
        tif = order.get("tif") or "none"
        if tif == POST_ONLY_TIF:
            alo += 1
        counts[(coin, tif, status)] = counts.get((coin, tif, status), 0) + 1
        ts = rec.get("statusTimestamp")
        if isinstance(ts, (int, float)) and ts > 0:
            stamps.append(int(ts))

    n = len(orders)
    return {
        "address": address,
        "n_records": n,
        "window_start_ms": min(stamps) if stamps else None,
        "window_end_ms": max(stamps) if stamps else None,
        "alo_share": (alo / n) if n else None,
        # A full 2,000 means the response was truncated by the cap, so the
        # window is bounded by the cap rather than by the poll interval. A
        # short response means the address is quiet and the window is real.
        "capped": n >= 2000,
        "counts": [
            {"coin": c, "tif": t, "status": s, "n": v}
            for (c, t, s), v in sorted(counts.items())
        ],
    }


def rejection_metrics(counts: list[dict]) -> dict:
    """The three numbers the tab shows, from one poll's counts.

    Definitions are fixed here so the collector, the API and the UI cannot
    drift into three different versions of the same word.
    """
    alo_total = sum(c["n"] for c in counts if c["tif"] == POST_ONLY_TIF)
    alo_rejected = sum(c["n"] for c in counts
                       if c["tif"] == POST_ONLY_TIF and c["status"] in REJECTION_STATUSES)
    filled = sum(c["n"] for c in counts if c["status"] == "filled")
    # Only maker-initiated cancels belong in a cancel-to-fill ratio. Engine
    # cancels and rejections are different events and inflate the ratio when
    # counted in, which is the specific error this project set out to avoid.
    cancels = sum(c["n"] for c in counts if c["status"] == "canceled")
    rejected_all = sum(c["n"] for c in counts if c["status"] in REJECTION_STATUSES)
    total = sum(c["n"] for c in counts)

    return {
        # Share of post-only orders the engine refused to rest.
        "post_only_rejection_rate": (alo_rejected / alo_total) if alo_total else None,
        # Maker cancels per fill, rejections excluded from the numerator.
        "cancel_to_fill": (cancels / filled) if filled else None,
        # The same ratio computed the naive way, kept so the tab can show the
        # size of the error rather than just asserting it exists.
        "cancel_to_fill_naive": ((cancels + rejected_all) / filled) if filled else None,
        # Share of all submitted orders that became a fill.
        "effective_fill_rate": (filled / total) if total else None,
        "alo_total": alo_total,
        "alo_rejected": alo_rejected,
        "filled": filled,
        "cancels": cancels,
        "rejected_all": rejected_all,
        "total": total,
    }
