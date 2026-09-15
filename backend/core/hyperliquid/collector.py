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
    """The full leaderboard. About 37MB and roughly 45,000 addresses, served
    without authentication."""
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

    Volume is the selection key rather than ALO share because ALO share costs a
    poll to measure and volume does not. The band study above shows the two
    coincide closely down to about rank 50, which is where this stops."""
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
