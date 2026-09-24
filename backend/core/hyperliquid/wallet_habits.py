"""
wallet_habits.py

What a visitor's own trading habits on Hyperliquid have cost them, measured,
and what the account holds. The backing for POST /api/wallet/habits.

WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
---------------------------------------------
Every figure is read from the venue's public info API for the address the
visitor sent, and is a sum or a ratio of what came back. There is no
counterfactual here. "What crossing cost you versus making" would need a price
the order did not trade at, and that is a model, not a measurement. The
definitions live in this file so the dashboard, and anything else that wants
them later, cannot drift into a second version.

THE POST-ONLY FIGURES: SAME DEFINITIONS, DIFFERENT WITHHOLDING
The definitions are the tracked-maker ones, reused rather than restated:
collector.summarise and collector.rejection_metrics reduce the orders, and
service.maker_bands names the band. The withholding rules are NOT the tracked
address-level ones, and an earlier version of this docstring said they were.

  tracked address rate (service.address_detail)
      no order floor. Withheld on too few POLLS (MIN_POLLS_FOR_RATE), and as
      stale_data when the newest record is older than
      service.MAX_RECORD_AGE_SECONDS (3,600 s).
  tracked per-market and per-hour rates (service.maker_markets, history)
      withheld below 200 post-only ORDERS (MIN_ORDERS_FOR_MARKET_RATE,
      history.MIN_ORDERS_FOR_BUCKET_RATE).
  this reading
      one historicalOrders response, so there are no polls to count. The
      per-market order floor is applied, because it answers the question a
      single reading actually has: are there enough post-only orders to
      divide. `enough_data` here therefore means orders, not polls, and the
      response says so in `enough_data_basis`.

      Age is NOT a reason to withhold here. OWNER'S DECISION, 2026-09-24: a
      user's own wallet shows its post-only figure whatever the age of the
      newest order, labelled with the order window and that age ("orders from
      3 Sep to 5 Sep, newest 19 days ago"). The tracked rule answers "is this
      maker's rate current", which a dashboard of your own history is not
      asking. The rule sits in POST_ONLY_WITHHOLD_AFTER_SECONDS, so changing
      it is one line.

THE RATE BUDGET, WHICH SETS THE SHAPE OF THE READ
-------------------------------------------------
These calls go out from the web process's IP. The venue's limit is 1,200 weight
a minute per IP. The weights, from the venue's "Rate limits and user limits"
page, read 2026-09-24:

    clearinghouseState, spotClearinghouseState     2
    userRole                                      60
    every other info request                      20
    userFills, historicalOrders, userFunding      20 + 1 per 20 items returned

One request here makes, in order:

    clearinghouseState (main perp dex)              2
    spotClearinghouseState                          2
    userRole, ONLY when both of those are empty    60
    userFills                                      20 + n/20, at most 120
    historicalOrders                               20 + n/20, at most 120
    userFees                                       20
    clearinghouseState per builder dex in fills
      and orders                                    2 each
    userFunding, at most FUNDING_MAX_PAGES pages   20 + n/20 each, at most 135
    clearinghouseState per builder dex named only
      in funding                                    2 each; at most MAX_DEX_READS
                                                    dex reads in all

Worst case 479. Measured live 2026-09-24: 401 for a busy maker in 9 calls, 64
for an address with no account in 3 calls, which is where that path stops.

WHO ELSE SPENDS THE SAME IP'S BUDGET
The web process also calls api.hyperliquid.xyz from: the collector poll loop
(server.py _hl_collect_loop, collector.py) when HL_COLLECTOR_ENABLED is set;
venuerole.py and attribution.py, per panel view on /api/hyperliquid/* and
/api/extension/subject; the MCP server mounted at /mcp in the same process,
whose hyperliquid.post_only reads reach attribution.attribute; and
core/monitors/ingest_check.py. corestate.py calls the HyperEVM RPC, a
different endpoint with its own limit, and ws_collector.py runs as a separate
Render worker with its own IP.

The collector polls at 10-second spacing, 6 historicalOrders a minute at up to
120 each: at most 720 a minute while a cycle runs. How long a cycle runs
depends on the rotation, which held 31 addresses when service.py was last
annotated (about 5.2 minutes of every 15) and was sized for 50 (8.3 minutes);
720 is the upper bound per minute either way. WEIGHT_BUDGET_PER_MINUTE is the
480 left beside it. This module's ledger bounds its own spend and nothing
else: the other readers above are not counted in it.

WHY ONE READ AT A TIME, ADMITTED ONLY WITH ROOM FOR THE WORST CASE
Two busy reads cannot both fit in 480. An earlier version admitted two and let
calls wait for room; the second then stalled for up to 40 seconds and came back
partial. Now MAX_CONCURRENT_READS is 1, a read is admitted only when the ledger
has room for MAX_REQUEST_WEIGHT (479), and otherwise the route answers 429 at
once with Retry-After. So an admitted read never waits and is never starved by
its own route. The cost, stated plainly: after any uncached read, the next
uncached read waits until that read's weight leaves the rolling minute, so
this route completes about one uncached read a minute. Cached answers are not
limited. Raising WEIGHT_BUDGET_PER_MINUTE raises that rate one for one.

MEMORY
------
userFills and historicalOrders at 2,000 rows are each about 750KB of JSON. Both
are read with a byte cap (MAX_RESPONSE_BYTES) and parsed in the one worker
thread. The parsed lists are held together until build() reduces them, then
dropped. Measured 2026-09-24 on a live busy maker with tracemalloc: a 6.2MB
Python heap peak for the read and 0.17MB held after. Responses measured 7KB
for the busy maker and about 39KB for an address with 177 positions (a
fixture with 177 on each of two dexes is 80KB serialised and 158KB as a dict).
The cache holds compact JSON bytes, at most CACHE_MAX answers and
CACHE_MAX_BYTES (4MB) in total, so its worst case is 4MB rather than the
~20MB the same answers would take as dicts.

THE ADDRESS
-----------
It arrives in a POST body, is used for the reads, and is a cache key in process
memory for CACHE_TTL_SECONDS. It is not written to any store, not logged, and
not echoed in the response: the caller already has it, and a response that
does not carry it cannot leak it into a log or a cache further along.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import threading
import time
import urllib.error
import urllib.request
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

from core import wallet_hash
from core.hyperliquid import collector, history, service
from core.safe_errors import describe

INFO_URL = collector.INFO_URL
HOUR_MS = 3_600_000
HALF_MS = 1_800_000
DAY_MS = 86_400_000

# ---------------------------------------------------------------------------
# limits
# ---------------------------------------------------------------------------

# {"address": "0x" + 40 hex} is 53 bytes. The rest is room for whitespace.
MAX_BODY_BYTES = 256

# The venue's own caps, from its info API documentation and confirmed live on
# 2026-09-24: 2,000 fills, 2,000 order records, 500 funding rows per response.
FILLS_CAP = 2000
ORDERS_CAP = 2000
FUNDING_PAGE_ROWS = 500

FUNDING_WINDOW_DAYS = 30
FUNDING_MAX_PAGES = 3
# Page one covers this many hourly funding marks back from now. Later pages are
# sized from the rows-per-hour page one measured, aiming at this many rows so a
# page lands under the venue's 500 rather than at it.
FUNDING_FIRST_PAGE_HOURS = 24
FUNDING_TARGET_ROWS = 450

# Builder-deployed (HIP-3) perp dexes hold their own margin, and the default
# clearinghouseState does not include them. Read the ones this address's own
# fills, orders or funding name, up to this many. The venue listed ten on
# 2026-09-24; any cut is reported as dex_read_cap.
MAX_DEX_READS = 10

# Bytes, per response. 2,000 fills measured 738,804; 2,000 orders 755,463.
MAX_RESPONSE_BYTES = 3_000_000

CALL_TIMEOUT_SECONDS = 12.0
# Checked before each call. The thread therefore ends within this plus one
# call timeout, whatever the venue does.
READ_DEADLINE_SECONDS = 40.0

WEIGHT_WINDOW_SECONDS = 60.0
WEIGHT_BUDGET_PER_MINUTE = 480
MAX_CONCURRENT_READS = 1

CACHE_TTL_SECONDS = 300
CACHE_MAX = 128
# Cached answers are held as compact JSON bytes, not dicts, and the cache is
# cleared when either bound would be passed. Measured in the selfcheck: an
# answer for 177 positions on each of two dexes is about 80KB serialised and
# about 158KB as a Python dict, so 128 of them as dicts would be about 20MB.
# As bytes under this cap the cache cannot pass 4MB whatever it holds.
CACHE_MAX_BYTES = 4_000_000

# The post-only figure is withheld as stale_data when the newest order record
# is older than this. None means never. OWNER'S DECISION, 2026-09-24: a user's
# own wallet is not withheld for age; the figure is shown with its order window
# and the newest record's age. The tracked address-level rate uses
# service.MAX_RECORD_AGE_SECONDS (3,600 s) for a different question, whether a
# maker's rate is current, and the response reports that comparison.
POST_ONLY_WITHHOLD_AFTER_SECONDS: int | None = None


def _items_weight(n: int) -> int:
    """The venue's per-item surcharge. Rounded up, so a charge taken before a
    call is never smaller than what the venue charges."""
    return -(-n // 20)


FUNDING_PAGE_MAX_WEIGHT = 20 + _items_weight(FUNDING_PAGE_ROWS)          # 45
FUNDING_MAX_WEIGHT = FUNDING_MAX_PAGES * FUNDING_PAGE_MAX_WEIGHT        # 135

# The most one request can cost. A read is admitted only with this much room.
MAX_REQUEST_WEIGHT = (
    2 + 2 + 60
    + 20 + _items_weight(FILLS_CAP)
    + 20 + _items_weight(ORDERS_CAP)
    + 20
    + FUNDING_MAX_WEIGHT
    + MAX_DEX_READS * 2
)
assert FUNDING_MAX_WEIGHT <= 135, FUNDING_MAX_WEIGHT
assert MAX_REQUEST_WEIGHT <= WEIGHT_BUDGET_PER_MINUTE, MAX_REQUEST_WEIGHT

# ---------------------------------------------------------------------------
# vocabulary
# ---------------------------------------------------------------------------

# Each code is carried as a string, the shape core/hyperliquid/service.py and
# core/extension/subject.py use. The sentences are returned beside the codes
# the response actually used, so a surface does not have to write its own.
#
# Reused: no_account (venuerole's kind for role "missing"), venue_rate_limited
# and venue_unreachable (venuerole), no_post_only_orders and stale_data
# (service).
#
# Added, one per fact that had no word:
#   no_fills, no_fills_on_side, no_usdc_fee_fills, no_volume_in_window,
#   no_funding_in_window, no_filled_orders
#       an absence of the thing measured, in a read that saw everything it
#       asked for. These are findings.
#   too_few_post_only_orders
#       history.py declined this exact word for a thin bucket, because there a
#       point sits in a series whose envelope publishes the floor, and
#       enough_data false next to it is unambiguous. Here the rate is one
#       figure on a dashboard, and the house rule for this route is that every
#       absence carries a reason. enough_data false is still returned.
#   not_in_capped_fills, funding_page_cap, dex_read_cap,
#   venue_response_too_large
#       LIMITS of the read: the same on every read of the same address, so an
#       answer carrying them is complete as far as it goes and may be cached.
#   read_deadline, route_rate_budget, fills_unreadable, volume_rows_missing
#       TRANSIENT, with venue_rate_limited and venue_unreachable: the next
#       read may differ, so an answer carrying any of them is not cached.
#   already_reading, another_read_in_progress
#       why a request was refused before any read, with route_rate_budget.
REASONS = {
    "no_account": (
        "The venue reports no record of this address on Hyperliquid. That is "
        "the venue's answer, not a lookup that failed, and there is nothing "
        "here to measure."),
    "no_fills": (
        "The venue returned no fills for this address, so there are no fees "
        "to add up."),
    "no_fills_on_side": (
        "None of this address's fills were on this side, maker or taker, and "
        "the read was not capped, so there is no fee to state for it."),
    "no_usdc_fee_fills": (
        "None of this address's fills paid their fee in USDC, and the read was "
        "not capped. Fees in other tokens are listed separately and are not "
        "converted."),
    "not_in_capped_fills": (
        "None of the fills in this read were of this kind. The read is the "
        "venue's 2,000 most recent fills, covering only the window shown, so "
        "earlier fills of this kind may exist. A limit of the read, not a "
        "finding about the address."),
    "fills_unreadable": (
        "The venue returned fills this server could not read (no fee, fee "
        "token or side), so no total is stated. That is about the read, not "
        "the address."),
    "no_volume_in_window": (
        "The venue's daily volume rows show no maker or taker volume for this "
        "address in the window, so there is no share to divide."),
    "volume_rows_missing": (
        "The venue's fee answer carried no daily volume rows, so no share is "
        "stated. That is about the read, not the address."),
    "no_funding_in_window": (
        "The venue returned no funding payments for this address in the "
        "covered window, so there is nothing to net."),
    "funding_page_cap": (
        "Funding is read newest first in at most three pages, to hold the rate "
        "budget. The oldest days of the 30 were not reached and are not in "
        "these totals. A limit of the read, not a finding about the address."),
    "dex_read_cap": (
        "This address traded on more builder-deployed perp dexes than this "
        "read will look up, so the ones listed were not read. A limit of the "
        "read."),
    "no_post_only_orders": (
        "None of the order records read were post-only, so there is no "
        "post-only rejection rate to state."),
    "too_few_post_only_orders": (
        "Fewer post-only orders than the floor this project applies to every "
        "per-market and per-hour rate. A handful of refusals out of a handful "
        "of orders is not a rate."),
    "stale_data": (
        "The newest order record is older than this surface's age limit."),
    "no_filled_orders": (
        "None of the order records read ended filled, so cancels per fill has "
        "no denominator."),
    "venue_rate_limited": (
        "The venue limited this server's requests, so this part was not read. "
        "That is about the call, not the address."),
    "venue_unreachable": (
        "The venue did not answer this part of the read. That is about the "
        "call, not the address."),
    "venue_response_too_large": (
        "The venue's answer was larger than this server will parse in one "
        "request, so it was not read. A limit of the read, not a finding "
        "about the address."),
    "route_rate_budget": (
        "This server's own share of the venue's rate limit is spent for the "
        "minute. That is about the server, not the address. Retry after the "
        "time given."),
    "read_deadline": (
        "The read ran out of time before this part was reached. That is about "
        "the call, not the address."),
    "already_reading": (
        "This address is being read right now. Retry in a few seconds; unless "
        "that read was cut short, the answer will come from the cache."),
    "another_read_in_progress": (
        "This server reads one wallet at a time from the venue, and another "
        "read is running. Retry in a few seconds."),
}

TRANSIENT = {"venue_rate_limited", "venue_unreachable", "read_deadline",
             "route_rate_budget", "fills_unreadable", "volume_rows_missing"}
LIMITS = {"not_in_capped_fills", "funding_page_cap", "dex_read_cap",
          "venue_response_too_large"}
BUSY_REASONS = ("already_reading", "another_read_in_progress", "route_rate_budget")
assert TRANSIENT | LIMITS | set(BUSY_REASONS) <= set(REASONS)

# ---------------------------------------------------------------------------
# body
# ---------------------------------------------------------------------------


def parse_body(raw: bytes) -> str | None:
    """The address from a POST /api/wallet/habits body, lowercased, or None.

    The same contract as agent_performance.parse_my_jobs_body: one answer for
    every malformed body, so the route's one fixed 400 repeats nothing that was
    sent. Exactly one key, "address", holding 0x and 40 hex characters.
    """
    if not raw or len(raw) > MAX_BODY_BYTES:
        return None
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(body, dict) or set(body) != {"address"}:
        return None
    value = body["address"]
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value.lower() if wallet_hash.is_address(value) else None


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------


def _dec(v: Any) -> Decimal | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        d = Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None
    return d if d.is_finite() else None


def _num(d: Decimal | None) -> float | None:
    """A float with every significant figure the venue sent. Not rounded to a
    number of places: 6 places turned a UBTC fee of -6.672e-7 into -1e-06 and
    anything under 5e-7 into a false 0.0."""
    return None if d is None else float(d)


def _is_ms(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0


def _iso_ms(ms: int | float | None) -> str | None:
    if not _is_ms(ms):
        return None
    return dt.datetime.fromtimestamp(ms / 1000.0, dt.UTC).isoformat()


def _withheld(reason: str, **extra) -> dict:
    return {**extra, "withheld_reason": reason}


def _failure(read: dict | None) -> str | None:
    """The reason code for a failed read, or None when it succeeded."""
    return read.get("failed") if isinstance(read, dict) else None


def _span(start_ms: int | None, end_ms: int | None) -> dict:
    if start_ms is None or end_ms is None:
        return {"seconds": None, "hours": None}
    s = (end_ms - start_ms) / 1000.0
    return {"seconds": round(s, 3), "hours": round(s / 3600.0, 3)}


def _ago(seconds: float) -> str:
    if seconds < 90:
        return f"{int(seconds)} seconds ago"
    if seconds < 90 * 60:
        return f"{round(seconds / 60)} minutes ago"
    if seconds < 48 * 3600:
        return f"{round(seconds / 3600)} hours ago"
    return f"{round(seconds / 86400)} days ago"


def _when(ms: int, span_ms: int) -> str:
    """A date, with the time when the window is under a day and the seconds
    when it is under an hour, so the two ends of a short window differ."""
    d = dt.datetime.fromtimestamp(ms / 1000.0, dt.UTC)
    if span_ms >= DAY_MS:
        return f"{d.day} {d:%b}"
    clock = d.strftime("%H:%M:%S" if span_ms < HOUR_MS else "%H:%M")
    return f"{d.day} {d:%b} {clock} UTC"


# ---------------------------------------------------------------------------
# fees
# ---------------------------------------------------------------------------


def fee_summary(fills: list[dict]) -> dict:
    """Fees over userFills, split maker and taker by `crossed`.

    `fee` is signed as the venue reports it: positive is paid, negative is a
    rebate received. Fees in any token other than USDC are totalled per token
    and never added to the USDC figure, because a HYPE fee and a USDC fee are
    not the same unit and pricing one into the other is a model.

    When the read is capped at 2,000 fills, an absent side or token is a limit
    of the read (not_in_capped_fills), not a finding (no_fills_on_side,
    no_usdc_fee_fills), and the window length is stated beside the totals.
    """
    base = {
        "source": "userFills",
        "cap": FILLS_CAP,
        "sign_convention": "Positive is paid. Negative is a rebate received.",
    }
    if not fills:
        return _withheld("no_fills", **base, fills=0, capped=False)

    n = len(fills)
    capped = n >= FILLS_CAP
    absent_side = "not_in_capped_fills" if capped else "no_fills_on_side"
    absent_usdc = "not_in_capped_fills" if capped else "no_usdc_fee_fills"

    per: dict[str, dict] = {}
    builder: dict[str, dict] = {}
    stamps: list[int] = []
    unreadable = 0
    for f in fills:
        if not isinstance(f, dict):
            unreadable += 1
            continue
        if _is_ms(f.get("time")):
            stamps.append(int(f["time"]))
        fee = _dec(f.get("fee"))
        token = f.get("feeToken") if isinstance(f.get("feeToken"), str) else None
        crossed = f.get("crossed")
        if fee is None or token is None or not isinstance(crossed, bool):
            unreadable += 1
            continue
        row = per.setdefault(token, {"maker": Decimal(0), "taker": Decimal(0),
                                     "maker_fills": 0, "taker_fills": 0})
        side = "taker" if crossed else "maker"
        row[side] += fee
        row[f"{side}_fills"] += 1
        bf = _dec(f.get("builderFee"))
        if bf is not None:
            b = builder.setdefault(token, {"total": Decimal(0), "fills": 0})
            b["total"] += bf
            b["fills"] += 1

    def shape(token: str, r: dict) -> dict:
        # A side with no fills has no fee to state. 0.0 would read as "made
        # fills on this side and paid nothing".
        return {
            "token": token,
            "total": _num(r["maker"] + r["taker"]),
            "maker": _num(r["maker"]) if r["maker_fills"] else None,
            "taker": _num(r["taker"]) if r["taker_fills"] else None,
            "maker_withheld_reason": None if r["maker_fills"] else absent_side,
            "taker_withheld_reason": None if r["taker_fills"] else absent_side,
            "maker_fills": r["maker_fills"],
            "taker_fills": r["taker_fills"],
            "fills": r["maker_fills"] + r["taker_fills"],
        }

    start = min(stamps) if stamps else None
    end = max(stamps) if stamps else None
    out = {
        **base,
        "window": {
            "start": _iso_ms(start),
            "end": _iso_ms(end),
            **_span(start, end),
            "basis": "the first to the last fill returned",
        },
        "fills": n,
        "capped": capped,
        "usdc": shape("USDC", per["USDC"]) if "USDC" in per else None,
        "usdc_withheld_reason": None if "USDC" in per else absent_usdc,
        "other_tokens": [shape(t, per[t]) for t in sorted(per) if t != "USDC"],
        "unreadable_fills": unreadable,
        "withheld_reason": None,
    }
    if capped:
        out["capped_note"] = (
            f"The venue returns at most the {FILLS_CAP:,} most recent fills, "
            f"here {out['window']['hours']} hours of trading. Fees on fills "
            "before the window start are not in these totals, and a token or "
            "side seen only in earlier fills is not listed.")
    if builder:
        out["builder_fee"] = {
            "by_token": [{"token": t, "total": _num(b["total"]), "fills": b["fills"]}
                         for t, b in sorted(builder.items())],
            "note": ("The venue reports builderFee in its own field on fills "
                     "routed through a builder. It is shown here and not added "
                     "to the totals above; whether `fee` already includes it "
                     "is not established by this read."),
        }
    if not per:
        # Fills came back and none carried a readable fee. A zero would claim
        # they were free.
        return _withheld("fills_unreadable", **{k: v for k, v in out.items()
                                                if k != "withheld_reason"})
    return out


# ---------------------------------------------------------------------------
# taker share
# ---------------------------------------------------------------------------


def taker_share(fees: dict) -> dict:
    """Taker share by volume, userCross / (userCross + userAdd), summed over
    the venue's daily rows, with the address's own fee rates beside it."""
    fees = fees if isinstance(fees, dict) else {}
    raw = fees.get("dailyUserVlm")
    rows = [r for r in raw if isinstance(r, dict)] if isinstance(raw, list) else []
    base = {"source": "userFees.dailyUserVlm"}
    if not rows:
        # Not a zero over zero days. The venue answers fifteen rows even for an
        # address with no account, so their absence is about the read.
        return _withheld("volume_rows_missing", **base)
    dates = sorted(r["date"] for r in rows if isinstance(r.get("date"), str))
    cross = sum((_dec(r.get("userCross")) or Decimal(0)) for r in rows)
    add = sum((_dec(r.get("userAdd")) or Decimal(0)) for r in rows)
    out = {
        **base,
        "window": {
            "start_date": dates[0] if dates else None,
            "end_date": dates[-1] if dates else None,
            "days": len(dates),
            "label": f"the last {len(dates)} days",
            "basis": ("the venue's own daily rows. The last one is the current "
                      "UTC day and is still accruing."),
        },
        "taker_volume_usd": _num(cross),
        "maker_volume_usd": _num(add),
        "taker_share": None,
        # The rates the venue reports charging this address now. They are the
        # venue's figures, not computed here.
        "user_cross_rate": _num(_dec(fees.get("userCrossRate"))),
        "user_add_rate": _num(_dec(fees.get("userAddRate"))),
        "withheld_reason": None,
    }
    total = cross + add
    if total <= 0:
        out["taker_volume_usd"] = None
        out["maker_volume_usd"] = None
        out["withheld_reason"] = "no_volume_in_window"
        return out
    out["taker_share"] = float(cross / total)
    return out


# ---------------------------------------------------------------------------
# funding: the walk
# ---------------------------------------------------------------------------
#
# WHY THE WALK LOOKS LIKE THIS, 2026-09-24
# The first version paged forward from 30 days ago with the next page starting
# at max(time) + 1. Two defects, both measured live on a busy maker:
#
#   Rows were dropped. Every coin an account holds is paid funding at the same
#   hourly mark, so a 500-row page ends part-way through an hour (one page
#   held 98 of an hour's 134 rows), and max(time) + 1 skips the rest of that
#   hour. 1,500 rows were read where 1,507 existed; net 182.884944 against a
#   correct 182.994538.
#
#   The newest days were the ones lost. Oldest-first with a page cap cuts off
#   the end of the window, which is the part a dashboard cares about most.
#
# So the walk runs backwards from now, every window boundary sits on a
# half-hour mark (hh:30) where no funding row is ever stamped (rows land within
# 62 ms of the hour, measured), and a full page is never trusted past the
# half-hour before its last row. Coverage is always one contiguous span ending
# now; what a partial answer lacks is the oldest days.


def _half_floor(ms: int) -> int:
    """The latest hh:30 mark at or before ms."""
    return ((ms - HALF_MS) // HOUR_MS) * HOUR_MS + HALF_MS


def _half_ceil(ms: int) -> int:
    f = _half_floor(ms)
    return f if f == ms else f + HOUR_MS


def _marks(start: int, end: int) -> int:
    """Hourly funding marks (hh:00) inside [start, end]."""
    first = -(-start // HOUR_MS) * HOUR_MS
    return 0 if first > end else (end - first) // HOUR_MS + 1


def _page_cut(times: list[int]) -> int:
    """For a page that came back at the 500-row cap: the bound below which its
    rows are complete. The page is time-ordered (verified live), so every hour
    before the last one it reached is whole; the last hour may be split. The
    half-hour mark before the last row separates the two."""
    return _half_floor(max(times))


def _row_key(r: dict) -> tuple:
    d = r.get("delta") or {}
    return (r.get("time"), d.get("coin"))


def funding_walk(call: Callable[[int, int], dict], now_ms: int,
                 positions: int | None = None) -> dict:
    """Read funding newest first, at most FUNDING_MAX_PAGES pages.

    `call(start_ms, end_ms)` returns {"data": [...]} or {"failed": code}.
    `positions` is the open-position count across the perp dexes read, when
    known. Returns the rows inside the covered span and the span itself.

    Page 1 ends now. Its size comes from `positions`: every open position is
    paid funding at every hourly mark, so r is about the position count and
    page 1 holds floor(450 / r) marks. With no count, or a count of zero (a
    position closed inside the window still paid funding while it was open),
    page 1 is the last FUNDING_FIRST_PAGE_HOURS marks. Sizing page 1 from a
    fixed 24 hours wasted it for any account holding more than about 20
    positions: measured live 2026-09-24, an address with 134 positions filled
    page 1 at 500, those rows could never join the span, and 402 of 1,500 rows
    read were discarded. Each later page ends where coverage currently begins
    and holds floor(450 / r) marks, r being the most rows per mark seen so far,
    the position count included. A page at exactly 500 rows is
    kept only below _page_cut, and the next page goes to the missing newest
    part of that window before anything older, so coverage stays contiguous
    back from now. If the full page was the last one allowed, its rows cannot
    join the span and are reported as read outside it.
    """
    oldest = _half_ceil(now_ms - FUNDING_WINDOW_DAYS * DAY_MS)
    frontier = now_ms                       # [frontier, now] is complete
    kept: dict[tuple, dict] = {}
    blocks: list[tuple[int, int, list]] = []  # complete, older, not yet joined
    rate: float | None = float(positions) if positions else None
    pages = 0
    stop: str | None = None

    while frontier > oldest and pages < FUNDING_MAX_PAGES:
        end = frontier
        floor_ = max([oldest] + [b[1] for b in blocks if b[1] <= end])
        top = (end // HOUR_MS) * HOUR_MS    # newest mark in the window
        if rate is None:
            h = FUNDING_FIRST_PAGE_HOURS
        elif rate <= 0:
            h = None
        else:
            h = max(1, int(FUNDING_TARGET_ROWS // rate))
        start = floor_ if h is None else max(floor_, top - (h - 1) * HOUR_MS - HALF_MS)

        page = call(start, end)
        if _failure(page):
            stop = _failure(page)
            break
        pages += 1
        rows = [r for r in page["data"] if isinstance(r, dict) and _is_ms(r.get("time"))]
        if len(page["data"]) < FUNDING_PAGE_ROWS:
            for r in rows:
                kept[_row_key(r)] = r
            m = _marks(start, end)
            rate = max(rate or 0.0, (len(rows) / m) if m else 0.0)
            frontier = start
        else:
            times = [int(r["time"]) for r in rows]
            cut = _page_cut(times) if times else start
            whole = [r for r in rows if r["time"] < cut]
            if cut > start:
                blocks.append((start, cut, whole))
            m = _marks(start, cut) if cut > start else 0
            rate = max(rate or 0.0,
                       (len(whole) / m) if m else float(FUNDING_PAGE_ROWS))
        # Join any complete block that now touches the covered span.
        joined = True
        while joined:
            joined = False
            for b in list(blocks):
                if b[1] == frontier:
                    for r in b[2]:
                        kept[_row_key(r)] = r
                    frontier = b[0]
                    blocks.remove(b)
                    joined = True

    inside = [r for r in kept.values() if frontier <= r["time"] <= now_ms]
    return {
        "rows": inside,
        "covered_from_ms": frontier,
        "covered_to_ms": now_ms,
        "requested_from_ms": oldest,
        "pages": pages,
        "partial": frontier > oldest,
        "stopped_by": stop,
        "rows_read_outside_span": sum(len(b[2]) for b in blocks),
        "page_one_sized_from_positions": positions or None,
    }


def funding_summary(walk: dict) -> dict:
    """Funding paid and received over the covered span.

    `usdc` on each row is signed as the venue reports it: negative is paid by
    this address, positive received.
    """
    paid = Decimal(0)
    received = Decimal(0)
    n = 0
    for r in walk["rows"]:
        delta = r.get("delta")
        usdc = _dec(delta.get("usdc")) if isinstance(delta, dict) else None
        if usdc is None:
            continue
        n += 1
        if usdc < 0:
            paid += -usdc
        else:
            received += usdc
    frm, to = walk["covered_from_ms"], walk["covered_to_ms"]
    out = {
        "source": "userFunding",
        "window": {
            "requested_from": _iso_ms(walk["requested_from_ms"]),
            "covered_from": _iso_ms(frm),
            "covered_to": _iso_ms(to),
            "covered_days": round((to - frm) / DAY_MS, 3),
            "requested_days": FUNDING_WINDOW_DAYS,
            "basis": "read newest first; the covered span always ends now",
        },
        "rows": n,
        "pages": walk["pages"],
        "partial": walk["partial"],
        "partial_reason": None,
        "sign_convention": ("net_usdc is received minus paid: positive means "
                            "this address received more funding than it paid."),
        "net_usdc": None,
        "paid_usdc": None,
        "received_usdc": None,
        "withheld_reason": None,
    }
    if walk["partial"]:
        out["partial_reason"] = walk["stopped_by"] or "funding_page_cap"
        out["missing"] = (
            f"The oldest days were not read: {_iso_ms(walk['requested_from_ms'])} "
            f"to {_iso_ms(frm)}.")
    out["rows_read_outside_span"] = walk["rows_read_outside_span"]
    out["page_one_sized_from_positions"] = walk.get("page_one_sized_from_positions")
    if n == 0:
        out["withheld_reason"] = "no_funding_in_window"
        return out
    out["net_usdc"] = _num(received - paid)
    out["paid_usdc"] = _num(paid)
    out["received_usdc"] = _num(received)
    return out


# ---------------------------------------------------------------------------
# post-only
# ---------------------------------------------------------------------------


def _band(rate: float) -> str | None:
    """service.maker_bands, asked about one rate."""
    grouped = service.maker_bands([{"post_only_rejection_rate": rate,
                                    "enough_data": True}])
    for name, members in grouped.items():
        if members and name != "unknown":
            return name
    return None


def post_only_summary(orders: list[dict], now_ms: int) -> dict:
    """The tracked-maker post-only definitions, from one historicalOrders read.

    Withholding differs from the tracked address-level rate; see the module
    docstring. `enough_data` here counts post-only orders in this reading.
    """
    orders = [o for o in orders if isinstance(o, dict)]
    s = collector.summarise("", orders)
    m = collector.rejection_metrics(s["counts"])
    floor = history.MIN_ORDERS_FOR_BUCKET_RATE
    enough = m["alo_total"] >= floor
    first, newest = s["window_start_ms"], s["window_end_ms"]
    age = round((now_ms - newest) / 1000.0, 1) if newest else None
    if newest:
        span = newest - first
        label = (f"Orders from {_when(first, span)} to "
                 f"{_when(newest, span)}, newest {_ago(age)}. One reading "
                 f"of this address's most recent {ORDERS_CAP:,} order records, "
                 "not a tracked series.")
    else:
        label = (f"One reading of this address's most recent {ORDERS_CAP:,} "
                 "order records, not a tracked series.")
    out = {
        "source": "historicalOrders",
        "label": label,
        "window": {
            "start": _iso_ms(first),
            "end": _iso_ms(newest),
            **_span(first, newest),
            "newest_record_age_seconds": age,
            "basis": "the first to the last status timestamp returned",
        },
        "age_rule": {
            "withhold_after_seconds": POST_ONLY_WITHHOLD_AFTER_SECONDS,
            "tracked_rate_max_record_age_seconds": service.MAX_RECORD_AGE_SECONDS,
            "older_than_tracked_limit": (age is not None
                                         and age > service.MAX_RECORD_AGE_SECONDS),
            "note": ("A user's own wallet is not withheld for age (owner's "
                     "decision). The tracked address-level rate would be "
                     "withheld as stale_data past the tracked limit."),
        },
        "orders": s["n_records"],
        "capped": s["capped"],
        "cap": ORDERS_CAP,
        "alo_total": m["alo_total"],
        "alo_rejected": m["alo_rejected"],
        "filled": m["filled"],
        "cancels": m["cancels"],
        "min_alo_orders_for_rate": floor,
        "enough_data": enough,
        "enough_data_basis": ("post-only orders in this reading, at least "
                              f"{floor}. On the tracked address-level rate the "
                              "same field counts polls."),
        "rejection_rate": None,
        "band": None,
        "cancels_per_fill": None,
        "cancels_per_fill_withheld_reason": None,
        "withheld_reason": None,
    }
    if not m["alo_total"]:
        out["withheld_reason"] = "no_post_only_orders"
    elif not enough:
        out["withheld_reason"] = "too_few_post_only_orders"
    elif (POST_ONLY_WITHHOLD_AFTER_SECONDS is not None and age is not None
          and age > POST_ONLY_WITHHOLD_AFTER_SECONDS):
        out["withheld_reason"] = "stale_data"
    if out["withheld_reason"]:
        out["cancels_per_fill_withheld_reason"] = out["withheld_reason"]
        return out
    rate = m["post_only_rejection_rate"]
    out["rejection_rate"] = rate
    out["band"] = _band(rate)
    if m["cancel_to_fill"] is None:
        out["cancels_per_fill_withheld_reason"] = "no_filled_orders"
    else:
        out["cancels_per_fill"] = m["cancel_to_fill"]
    return out


# ---------------------------------------------------------------------------
# holdings
# ---------------------------------------------------------------------------


def _perp_dex(dex: str, state: dict) -> dict:
    state = state if isinstance(state, dict) else {}
    ms = state.get("marginSummary")
    ms = ms if isinstance(ms, dict) else {}
    positions = []
    for ap in state.get("assetPositions") or []:
        p = ap.get("position") if isinstance(ap, dict) else None
        if not isinstance(p, dict):
            continue
        lev = p.get("leverage") if isinstance(p.get("leverage"), dict) else {}
        positions.append({
            "coin": p.get("coin"),
            "size": _num(_dec(p.get("szi"))),
            "entry_px": _num(_dec(p.get("entryPx"))),
            "position_value_usd": _num(_dec(p.get("positionValue"))),
            "unrealized_pnl_usd": _num(_dec(p.get("unrealizedPnl"))),
            "margin_used_usd": _num(_dec(p.get("marginUsed"))),
            "leverage": lev.get("value"),
            "leverage_type": lev.get("type"),
            "liquidation_px": _num(_dec(p.get("liquidationPx"))),
        })
    return {
        "dex": dex or "main",
        "account_value_usd": _num(_dec(ms.get("accountValue"))),
        "total_margin_used_usd": _num(_dec(ms.get("totalMarginUsed"))),
        "total_notional_usd": _num(_dec(ms.get("totalNtlPos"))),
        "withdrawable_usd": _num(_dec(state.get("withdrawable"))),
        "positions": positions,
        "as_of": _iso_ms(state.get("time")),
    }


def _holds_anything(perp: dict | None, spot: dict | None) -> bool:
    if isinstance(perp, dict):
        ms = perp.get("marginSummary") or {}
        if (_dec(ms.get("accountValue")) or 0) != 0 or perp.get("assetPositions"):
            return True
    if isinstance(spot, dict):
        for b in spot.get("balances") or []:
            if isinstance(b, dict) and (_dec(b.get("total")) or 0) != 0:
                return True
    return False


def holdings_summary(perp_reads: dict[str, dict], spot_read: dict,
                     dexes_cut: list[str]) -> dict:
    """Perp margin and positions per dex read, and spot balances.

    Spot balances are listed, not priced: pricing them would take another read
    and a choice of price, and entry_notional is the venue's cost basis rather
    than a value.
    """
    dexes, dex_missing = [], []
    for dex, read in perp_reads.items():
        reason = _failure(read)
        if reason:
            dex_missing.append({"dex": dex or "main", "withheld_reason": reason})
        else:
            dexes.append(_perp_dex(dex, read["data"]))
    for dex in dexes_cut:
        dex_missing.append({"dex": dex, "withheld_reason": "dex_read_cap"})
    perps = {
        "source": "clearinghouseState",
        "dexes": dexes,
        "dexes_not_read": dex_missing,
        "coverage": ("The main perp dex, and each builder-deployed dex named in "
                     "this address's fills, orders or funding read here, up to "
                     f"{MAX_DEX_READS}. A position on another builder dex with "
                     "no activity in those reads would not appear."),
        "withheld_reason": None if dexes else (dex_missing[0]["withheld_reason"]
                                               if dex_missing else "venue_unreachable"),
    }
    reason = _failure(spot_read)
    if reason:
        spot = _withheld(reason, source="spotClearinghouseState")
    else:
        balances = []
        data = spot_read.get("data") if isinstance(spot_read.get("data"), dict) else {}
        for b in data.get("balances") or []:
            if not isinstance(b, dict):
                continue
            total = _dec(b.get("total"))
            if not total:
                continue
            balances.append({
                "coin": b.get("coin"),
                "total": _num(total),
                "hold": _num(_dec(b.get("hold"))),
                "entry_notional_usd": _num(_dec(b.get("entryNtl"))),
            })
        spot = {
            "source": "spotClearinghouseState",
            "balances": balances,
            "note": ("Non-zero balances only. Not priced here; "
                     "entry_notional_usd is the venue's cost basis."),
            "withheld_reason": None,
        }
    return {"perps": perps, "spot": spot}


def _dex_names(*sources: list) -> list[str]:
    """Every builder dex prefix ("xyz" in "xyz:BRENTOIL") seen in the reads."""
    seen: set[str] = set()
    for rows in sources:
        for r in rows or []:
            if not isinstance(r, dict):
                continue
            coin = r.get("coin")
            if coin is None and isinstance(r.get("order"), dict):
                coin = r["order"].get("coin")
            if coin is None and isinstance(r.get("delta"), dict):
                coin = r["delta"].get("coin")
            if isinstance(coin, str) and ":" in coin:
                seen.add(coin.split(":", 1)[0])
    return sorted(seen)


# ---------------------------------------------------------------------------
# the response
# ---------------------------------------------------------------------------

SECTIONS = ("fees", "taker_share", "funding", "post_only")


def build(reads: dict, now_ms: int) -> dict:
    """The response, from whatever the reader managed to read.

    `reads` maps each call to {"data": ...} or {"failed": code}; "funding" holds
    a funding_walk result. Pure: the selfcheck drives it with fixtures.
    Returns the response with a `cacheable` key the caller removes.
    """
    perp_main = reads["perp"]
    spot = reads["spot"]
    role = reads.get("role")

    # Does the address have an account at all. Holdings answer it without
    # userRole whenever they hold anything.
    holds = _holds_anything(perp_main.get("data"), spot.get("data"))
    if holds:
        account = {"exists": True, "basis": "the address holds a balance or position"}
    elif role is not None and not _failure(role):
        r = role["data"].get("role") if isinstance(role.get("data"), dict) else None
        if r == "missing":
            account = {"exists": False, "basis": "the venue's userRole answered 'missing'"}
        else:
            account = {"exists": True, "role": r,
                       "basis": "the venue's userRole answered; the account holds nothing"}
    else:
        # Whether an account exists was not read. The code is the underlying
        # failure, as venuerole reports it, so a rate limit and an outage stay
        # distinguishable.
        account = {"exists": None,
                   "withheld_reason": (_failure(role) or _failure(perp_main)
                                       or _failure(spot) or "venue_unreachable"),
                   "basis": ("the account holds nothing and the venue's userRole "
                             "did not answer")}

    out: dict = {"as_of": _iso_ms(now_ms), "account": account}

    if account["exists"] is False:
        out["holdings"] = _withheld("no_account")
        for s in SECTIONS:
            out[s] = _withheld("no_account")
    else:
        dex_perps = reads.get("dex_perps", {})
        out["holdings"] = holdings_summary({"": perp_main, **dex_perps}, spot,
                                           reads.get("dexes_cut", []))
        fills = reads.get("fills", {"failed": "read_deadline"})
        out["fees"] = (_withheld(_failure(fills), source="userFills")
                       if _failure(fills) else fee_summary(fills["data"]))
        fees = reads.get("fees", {"failed": "read_deadline"})
        out["taker_share"] = (_withheld(_failure(fees), source="userFees.dailyUserVlm")
                              if _failure(fees) else taker_share(fees["data"]))
        walk = reads.get("funding")
        if walk is None:
            out["funding"] = _withheld("read_deadline", source="userFunding")
        elif walk["pages"] == 0 and walk["stopped_by"]:
            out["funding"] = _withheld(walk["stopped_by"], source="userFunding")
        else:
            out["funding"] = funding_summary(walk)
        orders = reads.get("orders", {"failed": "read_deadline"})
        out["post_only"] = (_withheld(_failure(orders), source="historicalOrders")
                            if _failure(orders)
                            else post_only_summary(orders["data"], now_ms))

    # `missing` lists every limit of this read and every part it failed to
    # read. A section withheld because the address has no fills is not here:
    # that absence is what was measured.
    missing: list[dict] = []

    def note(section: str, reason: str | None, **extra) -> None:
        if reason in TRANSIENT or reason in LIMITS:
            missing.append({"section": section, "withheld_reason": reason, **extra})

    note("account", account.get("withheld_reason"))
    h = out["holdings"]
    if "perps" in h:
        for d in h["perps"]["dexes_not_read"]:
            note(f"holdings.perps.{d['dex']}", d["withheld_reason"])
        note("holdings.spot", h["spot"].get("withheld_reason"))
    for s in SECTIONS:
        note(s, out[s].get("withheld_reason"))
    f = out["fees"]
    for tok in ([f["usdc"]] if f.get("usdc") else []) + f.get("other_tokens", []):
        for side in ("maker", "taker"):
            note(f"fees.{tok['token']}.{side}", tok.get(f"{side}_withheld_reason"))
    note("fees.USDC", f.get("usdc_withheld_reason"))
    fu = out["funding"]
    if fu.get("partial"):
        note("funding", fu["partial_reason"], detail=fu.get("missing"))

    out["partial"] = bool(missing)
    out["missing"] = missing
    if missing:
        out["missing_note"] = ("Everything under `missing` is a limit of this "
                               "read or a part it could not read, not a fact "
                               "about the address.")
    out["cacheable"] = not any(m["withheld_reason"] in TRANSIENT for m in missing)

    used: set[str] = set()

    def collect(v):
        if isinstance(v, dict):
            for k, x in v.items():
                if (k.endswith("withheld_reason") or k == "partial_reason") \
                        and isinstance(x, str):
                    used.add(x)
                else:
                    collect(x)
        elif isinstance(v, list):
            for x in v:
                collect(x)
    collect(out)
    out["reasons"] = {c: REASONS[c] for c in sorted(used) if c in REASONS}
    return out


# ---------------------------------------------------------------------------
# the read
# ---------------------------------------------------------------------------


class _Budget:
    """A rolling-minute weight ledger for this route, shared across the process.

    Each venue call takes its own maximum weight immediately before it is made,
    and the entry is corrected to the actual weight once the response is
    counted, so the route's spend in any rolling minute never exceeds
    `per_minute`. Admission (get_wallet_habits) requires room for a whole
    worst-case read, and there is one read at a time, so a call inside an
    admitted read always finds room and never waits.
    """

    def __init__(self, per_minute: int,
                 clock: Callable[[], float] = time.monotonic):
        self.per_minute = per_minute
        self._clock = clock
        self._entries: list[list] = []      # [monotonic time, weight]
        self._lock = threading.Lock()

    def _used(self, now: float) -> int:
        cut = now - WEIGHT_WINDOW_SECONDS
        self._entries = [e for e in self._entries if e[0] > cut]
        return sum(e[1] for e in self._entries)

    def try_take(self, weight: int) -> list | None:
        with self._lock:
            now = self._clock()
            if self._used(now) + weight <= self.per_minute:
                entry = [now, weight]
                self._entries.append(entry)
                return entry
            return None

    def settle(self, entry: list, actual: int) -> None:
        with self._lock:
            entry[1] = actual

    def wait_hint(self, weight: int) -> float:
        """Seconds until `weight` would fit, for a Retry-After."""
        with self._lock:
            now = self._clock()
            need = self._used(now) + weight - self.per_minute
            if need <= 0:
                return 0.0
            freed = 0
            for t, w in sorted(self._entries):
                freed += w
                if freed >= need:
                    return max(1.0, t + WEIGHT_WINDOW_SECONDS - now)
            return WEIGHT_WINDOW_SECONDS

    def used(self) -> int:
        with self._lock:
            return self._used(self._clock())


_budget = _Budget(WEIGHT_BUDGET_PER_MINUTE)


class _TooLarge(Exception):
    pass


def _post(body: dict) -> Any:
    """One info call, read with a byte cap. Raises on anything short of a
    complete, parseable answer."""
    req = urllib.request.Request(
        INFO_URL, data=json.dumps(body).encode(),
        headers={"content-type": "application/json",
                 "User-Agent": "tnega-wallet-habits/1"})
    with urllib.request.urlopen(req, timeout=CALL_TIMEOUT_SECONDS) as r:
        raw = r.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise _TooLarge()
    return json.loads(raw)


def _reason_for(exc: BaseException) -> str:
    if isinstance(exc, _TooLarge):
        return "venue_response_too_large"
    if isinstance(exc, urllib.error.HTTPError) and exc.code == 429:
        return "venue_rate_limited"
    return "venue_unreachable"


def read_all(address: str, *, info: Callable[[dict], Any] = _post,
             now_ms: int | None = None,
             clock: Callable[[], float] = time.monotonic,
             budget: "_Budget | None" = None) -> tuple[dict, list]:
    """Every read one request makes, in budget order. Never raises.

    Returns (reads, spent) where spent is [(monotonic time, weight)] per call
    made. The address is passed to the venue and to nothing else.
    """
    budget = budget if budget is not None else _budget
    started = clock()
    now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
    spent: list[tuple[float, int]] = []
    reads: dict = {}
    state = {"stop": None}

    def call(body: dict, base: int, cap: int = 0, shape: type | None = None) -> dict:
        """`cap` is the most items the venue returns for this call, 0 for a
        call with no per-item weight. `shape` is the type the answer must be."""
        if state["stop"]:
            return {"failed": state["stop"]}
        if clock() - started > READ_DEADLINE_SECONDS:
            state["stop"] = "read_deadline"
            return {"failed": "read_deadline"}
        entry = budget.try_take(base + _items_weight(cap))
        if entry is None:
            state["stop"] = "route_rate_budget"
            return {"failed": "route_rate_budget"}
        try:
            data = info(body)
        except Exception as e:  # noqa: BLE001 -- every failure becomes a reason
            budget.settle(entry, base)
            spent.append((clock(), base))
            reason = _reason_for(e)
            # A venue 429 will be a 429 on the next call too, and each one
            # still costs weight. Stop rather than spend it.
            if reason == "venue_rate_limited":
                state["stop"] = reason
            return {"failed": reason, "detail": describe(e)}
        n = len(data) if (cap and isinstance(data, list)) else 0
        budget.settle(entry, base + _items_weight(n))
        spent.append((clock(), base + _items_weight(n)))
        if shape is not None and not isinstance(data, shape):
            return {"failed": "venue_unreachable", "detail": "unexpected shape"}
        return {"data": data}

    reads["perp"] = call({"type": "clearinghouseState", "user": address}, 2, shape=dict)
    reads["spot"] = call({"type": "spotClearinghouseState", "user": address}, 2,
                         shape=dict)
    if not _holds_anything(reads["perp"].get("data"), reads["spot"].get("data")):
        reads["role"] = call({"type": "userRole", "user": address}, 60, shape=dict)
        role = reads["role"].get("data")
        if isinstance(role, dict) and role.get("role") == "missing":
            return reads, spent

    reads["fills"] = call({"type": "userFills", "user": address}, 20, FILLS_CAP,
                          shape=list)
    reads["orders"] = call({"type": "historicalOrders", "user": address}, 20,
                           ORDERS_CAP, shape=list)
    reads["fees"] = call({"type": "userFees", "user": address}, 20, shape=dict)

    # Builder dexes named in fills and orders are read before funding, so the
    # open-position count that sizes funding's first page covers them.
    def read_dexes(names: list[str]) -> None:
        for d in names:
            if d in reads["dex_perps"] or d in reads["dexes_cut"]:
                continue
            if len(reads["dex_perps"]) >= MAX_DEX_READS:
                reads["dexes_cut"].append(d)
                continue
            reads["dex_perps"][d] = call(
                {"type": "clearinghouseState", "user": address, "dex": d}, 2,
                shape=dict)

    reads["dex_perps"], reads["dexes_cut"] = {}, []
    read_dexes(_dex_names(reads["fills"].get("data"), reads["orders"].get("data")))
    positions = sum(
        len(r["data"].get("assetPositions") or [])
        for r in [reads["perp"], *reads["dex_perps"].values()]
        if isinstance(r.get("data"), dict))

    reads["funding"] = funding_walk(
        lambda s, e: call({"type": "userFunding", "user": address,
                           "startTime": s, "endTime": e}, 20, FUNDING_PAGE_ROWS,
                          shape=list),
        now_ms, positions=positions)
    # A dex named only in funding (a position closed before the fills and
    # orders windows) is read after, within the same cap.
    read_dexes(_dex_names(reads["funding"]["rows"]))
    return reads, spent


# ---------------------------------------------------------------------------
# the entry point
# ---------------------------------------------------------------------------

_cache: dict[str, tuple[float, bytes]] = {}
_cache_bytes = 0
_cache_lock = threading.Lock()
_in_flight: set[str] = set()
_active = 0
_active_lock = threading.Lock()


class Busy(Exception):
    """Refused before any read, not queued. `reason` is one of BUSY_REASONS
    and `retry_after` is in seconds."""

    def __init__(self, reason: str, retry_after: float):
        assert reason in BUSY_REASONS, reason
        super().__init__(reason)
        self.reason = reason
        self.detail = REASONS[reason]
        self.retry_after = int(max(1, round(retry_after)))


def _cached(addr: str, now: float) -> tuple[float, dict] | None:
    global _cache_bytes
    with _cache_lock:
        hit = _cache.get(addr)
        if hit and now - hit[0] >= CACHE_TTL_SECONDS:
            _cache.pop(addr, None)
            _cache_bytes -= len(hit[1])
            hit = None
    return (hit[0], json.loads(hit[1])) if hit else None


def _store(addr: str, now: float, value: dict) -> None:
    global _cache_bytes
    blob = json.dumps(value, separators=(",", ":")).encode()
    if len(blob) > CACHE_MAX_BYTES:
        return
    with _cache_lock:
        old = _cache.pop(addr, None)
        if old:
            _cache_bytes -= len(old[1])
        if len(_cache) >= CACHE_MAX or _cache_bytes + len(blob) > CACHE_MAX_BYTES:
            _cache.clear()
            _cache_bytes = 0
        _cache[addr] = (now, blob)
        _cache_bytes += len(blob)


def _release(addr: str) -> None:
    global _active
    with _active_lock:
        _active -= 1
        _in_flight.discard(addr)


def _read_then_release(addr: str) -> tuple[dict, list]:
    """The thread body. The gate is released here, when the read has actually
    ended, not when the awaiting request gave up: a timed-out await leaves this
    thread running, and a second read admitted beside it would be the fan-out
    the gate exists to prevent."""
    try:
        return read_all(addr)
    finally:
        _release(addr)


async def get_wallet_habits(address: str) -> dict:
    """The response for one address, from cache or from one bounded read.

    Raises Busy when the gate or the ledger refuses the read. A refused request
    spends nothing and is told when to retry.
    """
    global _active
    addr = address.lower()
    now = time.monotonic()
    hit = _cached(addr, now)
    if hit is not None:
        # `read` describes the read that produced the cached answer. This
        # request made no venue call, and says so.
        return {**hit[1], "read": {**hit[1]["read"], "weight_spent_by_this_request": 0},
                "served_from_cache": True,
                "cache_age_seconds": round(now - hit[0], 1)}

    with _active_lock:
        if addr in _in_flight:
            raise Busy("already_reading", 5)
        if _active >= MAX_CONCURRENT_READS:
            raise Busy("another_read_in_progress", 5)
        if _budget.used() + MAX_REQUEST_WEIGHT > _budget.per_minute:
            raise Busy("route_rate_budget", _budget.wait_hint(MAX_REQUEST_WEIGHT))
        _active += 1
        _in_flight.add(addr)

    try:
        task = asyncio.ensure_future(asyncio.to_thread(_read_then_release, addr))
    except BaseException:
        _release(addr)
        raise
    # shield: a timeout or a client disconnect abandons the await, never the
    # thread, which releases the gate itself when it ends.
    reads, spent = await asyncio.wait_for(
        asyncio.shield(task),
        timeout=READ_DEADLINE_SECONDS + CALL_TIMEOUT_SECONDS + 5)
    out = build(reads, int(time.time() * 1000))
    weight = sum(w for _, w in spent)
    out["read"] = {
        "venue_calls": len(spent),
        "venue_weight": weight,
        "venue_weight_limit_per_minute": 1200,
        "route_weight_budget_per_minute": WEIGHT_BUDGET_PER_MINUTE,
    }
    if out.pop("cacheable"):
        _store(addr, time.monotonic(), out)
    return {**out, "read": {**out["read"], "weight_spent_by_this_request": weight},
            "served_from_cache": False, "cache_age_seconds": None}
