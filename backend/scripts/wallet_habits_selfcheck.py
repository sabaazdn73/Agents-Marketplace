#!/usr/bin/env python3
"""wallet_habits_selfcheck.py -- the definitions behind POST /api/wallet/habits,
checked on fixture responses with no network.

  BODY      parse_body: one None for every malformed body, a lowercased address
            for a good one.
  FEES      maker and taker split by `crossed`, rebates kept signed, a capped
            fill set flagged with its window length, an absent side or token
            in a capped read reported as a limit, non-USDC fees kept apart and
            never summed in, small fees kept to full precision, zero fills
            withheld rather than zeroed.
  TAKER     taker share from dailyUserVlm, withheld at zero volume and when the
            rows are missing.
  FUNDING   the backwards walk against a fixture venue with many rows per
            timestamp: exact against an independent sum over the covered span,
            full pages split mid-hour, the page after a full page closing it,
            contiguous coverage ending now, three pages and 135 weight at most.
            MUTATION: the old max(time)+1 cursor is swapped in and the
            exactness check must fail.
  POST-ONLY the tracked definitions reused, the order floor, the age rule
            behind its constant, the label.
  ACCOUNT   no account costs three calls and carries no number; a failed
            userRole keeps the venue's own reason.
  FAILURE   a venue 429 stops the read, is partial, is not cached, and no
            exception text or address reaches the response.
  GATE      one read at a time, admission only with room for the worst case,
            Busy codes and details, the gate held until the thread ends, the
            cache.
  SIZE      a response for an address with 177 positions, serialised and in
            memory, and the cache's worst case.

Run from backend/:  ./venv/bin/python scripts/wallet_habits_selfcheck.py
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import threading
import tracemalloc
import urllib.error
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.hyperliquid import collector, history, service  # noqa: E402
from core.hyperliquid import wallet_habits as wh  # noqa: E402

FAILURES: list[str] = []
ADDR = "0x" + "ab" * 20
H = wh.HOUR_MS
# 20 minutes past an hour, so page one's end is not itself on the grid.
NOW_MS = 1_790_280_000_000 // H * H + 20 * 60_000 + 123
SECRET = "sentinel-exception-text-must-not-leak"


def check(cond: bool, what: str) -> None:
    print(("  ok    " if cond else "  FAIL  ") + what)
    if not cond:
        FAILURES.append(what)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

def fill(i: int, *, fee: str, token: str = "USDC", crossed: bool = False,
         coin: str = "BTC") -> dict:
    return {"coin": coin, "px": "1", "sz": "1", "side": "B",
            "time": NOW_MS - i * 1000, "crossed": crossed, "fee": fee,
            "feeToken": token, "oid": i, "tid": i}


def order(i: int, *, tif: str = "Alo", status: str = "filled",
          coin: str = "BTC", age_ms: int = 0) -> dict:
    return {"order": {"coin": coin, "tif": tif, "oid": i},
            "status": status, "statusTimestamp": NOW_MS - age_ms - i * 1000}


PERP_EMPTY = {"marginSummary": {"accountValue": "0.0", "totalNtlPos": "0.0",
                                "totalRawUsd": "0.0", "totalMarginUsed": "0.0"},
              "withdrawable": "0.0", "assetPositions": [], "time": NOW_MS}


def perp_held(n_positions: int = 1) -> dict:
    return {"marginSummary": {"accountValue": "1000.5", "totalNtlPos": "5000",
                              "totalRawUsd": "0", "totalMarginUsed": "250"},
            "withdrawable": "750.5", "time": NOW_MS,
            "assetPositions": [{"type": "oneWay", "position": {
                "coin": f"C{i}", "szi": "0.05", "entryPx": "100000.123",
                "positionValue": "5000.55", "unrealizedPnl": "12.5",
                "marginUsed": "250.25", "leverage": {"type": "cross", "value": 20},
                "liquidationPx": "81234.5678"}} for i in range(n_positions)]}


SPOT_EMPTY = {"balances": []}
SPOT_HELD = {"balances": [
    {"coin": "USDC", "token": 0, "total": "20.0", "hold": "0.0", "entryNtl": "0.0"},
    {"coin": "HYPE", "token": 150, "total": "0.0", "hold": "0.0", "entryNtl": "0.0"}]}
FEES = {"dailyUserVlm": [
    {"date": "2026-09-23", "userCross": "300", "userAdd": "700", "exchange": "1e9"},
    {"date": "2026-09-24", "userCross": "100", "userAdd": "900", "exchange": "1e9"}],
    "userCrossRate": "0.00045", "userAddRate": "0.00015"}


def funding_rows(coins_at) -> list[dict]:
    """Hourly funding rows for 31 days back from NOW_MS. coins_at(hours_ago)
    is how many coins are paid at that mark; every coin shares the mark's
    timestamp, with a few milliseconds of offset as the venue has."""
    rows = []
    top = NOW_MS // H * H
    for k in range(31 * 24):
        t = top - k * H
        for c in range(coins_at(k)):
            usdc = Decimal(((k * 7 + c * 13) % 97) - 48) / Decimal(1000)
            rows.append({"time": t + 5 + (c % 3) * 20, "hash": "0x0",
                         "delta": {"type": "funding", "coin": f"C{c}",
                                   "usdc": str(usdc), "szi": "1",
                                   "fundingRate": "0.00001"}})
    rows.sort(key=lambda r: (r["time"], r["delta"]["coin"]))
    return rows


class FundingVenue:
    """userFunding as the venue serves it: the rows in [startTime, endTime],
    oldest first, at most 500."""

    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.windows: list[tuple[int, int, int]] = []

    def page(self, s: int, e: int) -> list[dict]:
        out = [r for r in self.rows if s <= r["time"] <= e][:500]
        self.windows.append((s, e, len(out)))
        return out


def truth(rows: list[dict], frm_ms: int, to_ms: int) -> tuple[int, Decimal]:
    inside = [r for r in rows if frm_ms <= r["time"] <= to_ms]
    return len(inside), sum((Decimal(r["delta"]["usdc"]) for r in inside), Decimal(0))


class FakeVenue:
    """Answers info calls from a table and records what was asked."""

    def __init__(self, table: dict, fail: dict | None = None):
        self.table = table
        self.fail = fail or {}
        self.calls: list[dict] = []

    def __call__(self, body: dict):
        self.calls.append(body)
        key = body["type"] + (":" + body["dex"] if "dex" in body else "")
        if key in self.fail:
            raise self.fail[key]
        v = self.table.get(key)
        if callable(v):
            return v(body)
        return v


def http_429():
    return urllib.error.HTTPError("https://example.invalid/" + SECRET, 429,
                                  SECRET, {}, io.BytesIO(SECRET.encode()))


def numbers_in(v) -> list:
    out = []
    if isinstance(v, dict):
        for x in v.values():
            out += numbers_in(x)
    elif isinstance(v, list):
        for x in v:
            out += numbers_in(x)
    elif isinstance(v, (int, float)) and not isinstance(v, bool):
        out.append(v)
    return out


def roomy():
    """A ledger no fixture read can exhaust, so the module's own is untouched."""
    return wh._Budget(10 ** 9)


def run_walk(rows: list[dict], positions: int | None = None):
    venue = FundingVenue(rows)
    weights = []

    def call(s, e):
        data = venue.page(s, e)
        weights.append(20 + wh._items_weight(len(data)))
        return {"data": data}
    walk = wh.funding_walk(call, NOW_MS, positions=positions)
    return walk, venue, weights


# ---------------------------------------------------------------------------
# checks
# ---------------------------------------------------------------------------

def check_body() -> None:
    print("BODY")
    good = json.dumps({"address": ADDR.upper().replace("0X", "0x")}).encode()
    check(wh.parse_body(good) == ADDR, "a good body gives the lowercased address")
    check(wh.parse_body(b' {"address": "  %s  "} ' % ADDR.encode()) == ADDR,
          "surrounding whitespace in the value is tolerated")
    bad = {
        "empty": b"",
        "not json": b"address=" + ADDR.encode(),
        "array": json.dumps([ADDR]).encode(),
        "string": json.dumps(ADDR).encode(),
        "wrong key": json.dumps({"client_address": ADDR}).encode(),
        "extra key": json.dumps({"address": ADDR, "x": 1}).encode(),
        "no key": b"{}",
        "number": json.dumps({"address": 12}).encode(),
        "null": json.dumps({"address": None}).encode(),
        "short": json.dumps({"address": ADDR[:-1]}).encode(),
        "non-hex": json.dumps({"address": "0x" + "zz" * 20}).encode(),
        "no 0x": json.dumps({"address": "ab" * 21}).encode(),
        "invalid utf8": b'{"address": "\xff\xfe"}',
        "oversized": json.dumps({"address": ADDR, "pad": " " * 300}).encode(),
        "oversized whitespace": b"{" + b" " * 300 + b'"address": "%s"}' % ADDR.encode(),
    }
    for name, raw in bad.items():
        check(wh.parse_body(raw) is None, f"malformed body refused: {name}")


def check_fees() -> None:
    print("FEES")
    r = wh.fee_summary([])
    check(r["withheld_reason"] == "no_fills" and "usdc" not in r,
          "zero fills: withheld no_fills, no total at all")

    fills = [fill(0, fee="1.5", crossed=True),
             fill(1, fee="2.5", crossed=True),
             fill(2, fee="-0.2", crossed=False),
             fill(3, fee="0.01", token="HYPE", crossed=False),
             fill(4, fee="0.03", token="HYPE", crossed=True),
             fill(5, fee="5", token="UBTC", crossed=True)]
    r = wh.fee_summary(fills)
    u = r["usdc"]
    check(u["taker"] == 4.0 and u["maker"] == -0.2 and u["total"] == 3.8,
          "USDC split by crossed, rebate kept negative, total 3.8")
    check(u["taker_fills"] == 2 and u["maker_fills"] == 1 and u["fills"] == 3,
          "USDC fill counts by side")
    other = {o["token"]: o for o in r["other_tokens"]}
    check(set(other) == {"HYPE", "UBTC"} and other["HYPE"]["total"] == 0.04
          and other["UBTC"]["taker"] == 5.0, "non-USDC fees totalled per token")
    check(u["total"] == 3.8, "non-USDC fees are not summed into USDC")
    check(other["UBTC"]["maker"] is None
          and other["UBTC"]["maker_withheld_reason"] == "no_fills_on_side",
          "uncapped read: an absent side is a finding, no_fills_on_side")
    check(r["window"]["seconds"] == 5.0, "window length stated in seconds")

    tiny = wh.fee_summary([fill(0, fee="-0.0000006672", token="UBTC"),
                           fill(1, fee="0.0000004", token="PURR")])
    t = {o["token"]: o for o in tiny["other_tokens"]}
    check(t["UBTC"]["total"] == -6.672e-7 and t["PURR"]["total"] == 4e-7,
          "small fees keep their significant figures: -6.672e-7 and 4e-7, "
          "not -1e-06 and a false 0.0")

    capped = [fill(i, fee="0.1", crossed=False) for i in range(2000)]
    r = wh.fee_summary(capped)
    check(r["capped"] is True and r["fills"] == 2000 and "capped_note" in r,
          "2,000 fills: capped true, with a note saying earlier fees are absent")
    check(r["window"]["seconds"] == 1999.0 and r["window"]["hours"] == 0.555,
          "capped window length stated beside the totals (1,999 s, 0.555 h)")
    check(r["usdc"]["taker"] is None
          and r["usdc"]["taker_withheld_reason"] == "not_in_capped_fills",
          "capped read: an absent side is a limit, not_in_capped_fills")
    reads = base_reads(fills={"data": capped})
    out = wh.build(reads, NOW_MS)
    check({"section": "fees.USDC.taker", "withheld_reason": "not_in_capped_fills"}
          in out["missing"], "and it is listed in `missing`")
    check(out.pop("cacheable") is True, "a limit alone leaves the answer cacheable")

    r = wh.fee_summary([fill(i, fee="0.1", token="HYPE") for i in range(2000)])
    check(r["usdc"] is None and r["usdc_withheld_reason"] == "not_in_capped_fills",
          "capped read with no USDC fill: a limit, not a finding")
    r = wh.fee_summary([fill(0, fee="0.1", token="HYPE")])
    check(r["usdc"] is None and r["usdc_withheld_reason"] == "no_usdc_fee_fills",
          "uncapped read with no USDC fill: withheld no_usdc_fee_fills")

    r = wh.fee_summary([{"time": NOW_MS, "fee": "x"}, "junk"])
    check(r["withheld_reason"] == "fills_unreadable" and r["usdc"] is None,
          "unreadable fills: withheld fills_unreadable, no total")


def check_taker() -> None:
    print("TAKER")
    r = wh.taker_share(FEES)
    check(r["taker_share"] == 0.2, "taker share 400 / 2000 = 0.2")
    check(r["window"]["days"] == 2 and r["window"]["start_date"] == "2026-09-23",
          "window labelled by the rows actually returned")
    check(r["user_cross_rate"] == 0.00045 and r["user_add_rate"] == 0.00015,
          "the address's own rates carried beside it")
    z = wh.taker_share({"dailyUserVlm": [{"date": "2026-09-24", "userCross": "0.0",
                                          "userAdd": "0.0"}]})
    check(z["taker_share"] is None and z["taker_volume_usd"] is None
          and z["withheld_reason"] == "no_volume_in_window",
          "zero volume: withheld, no 0.0 volumes")
    for name, body in (("absent", {"userCrossRate": "0.00045"}),
                       ("empty", {"dailyUserVlm": []}),
                       ("not a list", {"dailyUserVlm": "x"})):
        m = wh.taker_share(body)
        check(m["withheld_reason"] == "volume_rows_missing" and "window" not in m,
              f"dailyUserVlm {name}: withheld volume_rows_missing, not 0.0 over 0 days")
    out = wh.build(base_reads(fees={"data": {}}), NOW_MS)
    check(out.pop("cacheable") is False, "missing volume rows are transient: not cached")


def check_funding() -> None:
    print("FUNDING")

    def exact(walk, rows, label):
        n, net = truth(rows, walk["covered_from_ms"], walk["covered_to_ms"])
        got = sum((Decimal(r["delta"]["usdc"]) for r in walk["rows"]), Decimal(0))
        ok = len(walk["rows"]) == n and got == net
        check(ok, f"{label}: {len(walk['rows'])} rows, net {got} against an "
                  f"independent {n} rows, net {net}")
        return ok

    def invariants(walk, venue, weights, label):
        check(walk["covered_to_ms"] == NOW_MS, f"{label}: coverage ends now")
        check(walk["pages"] <= 3 and sum(weights) <= 135,
              f"{label}: {walk['pages']} pages, {sum(weights)} weight (cap 3, 135)")
        grid = all(s % H == wh.HALF_MS for s, _, _ in venue.windows) and all(
            e == NOW_MS or e % H == wh.HALF_MS for _, e, _ in venue.windows)
        check(grid, f"{label}: every window boundary on hh:30 (page one ends now)")
        check(abs(venue.windows[0][1] - venue.windows[0][0] - 24 * H) <= H,
              f"{label}: page one is the last 24 hours")

    # A: 7 coins every hour. 168 rows, then two pages of floor(450/7)=64 marks.
    rows = funding_rows(lambda k: 7)
    walk, venue, weights = run_walk(rows)
    exact(walk, rows, "A, 7 coins an hour")
    invariants(walk, venue, weights, "A")
    check([w[2] for w in venue.windows] == [168, 448, 448],
          "A: pages of 168, 448, 448 rows: sized from page one's rate")
    check(walk["partial"] is True
          and wh.funding_summary(walk)["partial_reason"] == "funding_page_cap",
          "A: the oldest days are missing, reason funding_page_cap")
    s = wh.funding_summary(walk)
    check(s["window"]["covered_days"] == round((NOW_MS - walk["covered_from_ms"]) / wh.DAY_MS, 3)
          and s["window"]["covered_days"] < 30,
          f"A: covered_days is the actual {s['window']['covered_days']}, not 30")

    # C: 22 coins an hour. Page one holds 528 rows and comes back at exactly
    # 500, ending part-way through an hour (500 = 22 * 22 + 16).
    rows_c = funding_rows(lambda k: 22)
    walk, venue, weights = run_walk(rows_c)
    check(venue.windows[0][2] == 500, "C: page one comes back at exactly 500 rows")
    ok_c = exact(walk, rows_c, "C, 22 coins an hour, full first page")
    invariants(walk, venue, weights, "C")
    first, second = venue.windows[0], venue.windows[1]
    check(second[1] == NOW_MS and second[0] > first[0],
          "C: the next page reads the missing newest part of page one's window")
    check(walk["rows_read_outside_span"] == 0,
          "C: that page closes the gap, so nothing read falls outside the span")

    # The old cursor, max(time) + 1, must fail this check.
    real = wh._page_cut
    wh._page_cut = lambda times: max(times) + 1
    try:
        walk_m, _, _ = run_walk(rows_c)
        n, net = truth(rows_c, walk_m["covered_from_ms"], walk_m["covered_to_ms"])
        caught = len(walk_m["rows"]) != n
    finally:
        wh._page_cut = real
    check(ok_c and caught,
          f"MUTATION: with the cursor at max(time)+1 the walk reads "
          f"{len(walk_m['rows'])} rows where {n} exist, so the exactness check fails")

    # B: the rate rises further back, so a later page comes back full.
    rows_b = funding_rows(lambda k: 7 if k < 48 else 21)
    walk, venue, weights = run_walk(rows_b)
    check(any(w[2] == 500 for w in venue.windows[1:]),
          "B: a later page comes back at 500 when the rate rises")
    exact(walk, rows_b, "B, rate rising with age")
    invariants(walk, venue, weights, "B")
    check(walk["rows_read_outside_span"] > 0 and walk["partial"],
          "B: rows from the unclosed full page are outside the span and reported")

    # D: exactly 500 rows in existence, all in the last 20 hours.
    rows_d = funding_rows(lambda k: 25 if k < 20 else 0)
    walk, venue, weights = run_walk(rows_d)
    check(venue.windows[0][2] == 500 and len(walk["rows"]) == 500,
          "D: a page of exactly 500 with nothing after it: all 500 counted")
    exact(walk, rows_d, "D")

    # E: one coin for the whole 30 days reaches the start of the window.
    rows_e = funding_rows(lambda k: 1)
    walk, venue, weights = run_walk(rows_e)
    exact(walk, rows_e, "E, one coin")
    invariants(walk, venue, weights, "E")
    check(walk["partial"] is False and walk["covered_from_ms"] == walk["requested_from_ms"],
          "E: all 30 days read, not partial")

    # P: 40 open positions, each paid at every mark. Page 1 sized from the
    # position count holds floor(450/40) = 11 marks and every page joins the
    # span; the fixed 24 hours would fill page 1 at 500 and waste it.
    rows_p = funding_rows(lambda k: 40)
    fixed, vf, _ = run_walk(rows_p)
    sized, vs, ws = run_walk(rows_p, positions=40)
    exact(sized, rows_p, "P, 40 positions, page 1 sized from them")
    check(vf.windows[0][2] == 500,
          f"P without the count: page 1 comes back at 500 and the walk covers "
          f"{(NOW_MS - fixed['covered_from_ms']) / H:.1f} hours, "
          f"{len(fixed['rows'])} rows, {fixed['rows_read_outside_span']} wasted")
    check([w[2] for w in vs.windows] == [440, 440, 440]
          and sized["rows_read_outside_span"] == 0,
          "P with the count: pages of 440, 440, 440 rows, none wasted")
    hours = (NOW_MS - sized["covered_from_ms"]) / H
    check(hours > (NOW_MS - fixed["covered_from_ms"]) / H and len(sized["rows"]) == 1320,
          f"P: coverage spans all three pages, {hours:.1f} hours and 1,320 rows")
    check(vs.windows[0][1] == NOW_MS and vs.windows[0][0] % H == wh.HALF_MS
          and sum(ws) <= 135, "P: page 1 ends now, starts on hh:30, 135 weight at most")

    # Q: the count is wrong (positions closed inside the window still paid
    # funding). Page 1 comes back full and the full-page handling takes over.
    q, vq, wq = run_walk(rows_c, positions=5)
    check(vq.windows[0][2] == 500, "Q: a count of 5 against 22 paid coins fills page 1")
    exact(q, rows_c, "Q, the full-page fallback")
    check(q["rows_read_outside_span"] > 0 and sum(wq) <= 135,
          f"Q: the span stays exact; page 1's {q['rows_read_outside_span']} "
          "unjoinable rows are reported as read outside it, not counted")
    z, vz, _ = run_walk(rows_a := funding_rows(lambda k: 7), positions=0)
    check(abs(vz.windows[0][1] - vz.windows[0][0] - 24 * H) <= H,
          "a count of zero falls back to 24 hours, since closed positions paid")
    exact(z, rows_a, "zero-count fallback")

    # Nothing at all: one page, no rows, no zero.
    walk, venue, _ = run_walk([])
    s = wh.funding_summary(walk)
    check(walk["pages"] == 2 and not walk["partial"]
          and s["withheld_reason"] == "no_funding_in_window" and s["net_usdc"] is None,
          "no rows in 30 days: withheld no_funding_in_window, net null, not partial")

    # A page that fails after one page: partial for the read, not the cap.
    calls = {"n": 0}

    def flaky(s, e):
        calls["n"] += 1
        if calls["n"] == 2:
            return {"failed": "venue_unreachable"}
        return {"data": [r for r in rows if s <= r["time"] <= e][:500]}
    walk = wh.funding_walk(flaky, NOW_MS)
    s = wh.funding_summary(walk)
    check(s["partial"] and s["partial_reason"] == "venue_unreachable",
          "a failed second page: partial, with the venue's reason")


def check_post_only() -> None:
    print("POST-ONLY")
    floor = history.MIN_ORDERS_FOR_BUCKET_RATE
    check(floor == service.MIN_ORDERS_FOR_MARKET_RATE == 200,
          "the floor is the existing per-market 200, reused")

    thin = [order(i, status="badAloPxRejected" if i < 20 else "filled")
            for i in range(floor - 1)]
    r = wh.post_only_summary(thin, NOW_MS)
    check(r["withheld_reason"] == "too_few_post_only_orders"
          and r["rejection_rate"] is None and r["band"] is None
          and r["enough_data"] is False and r["alo_total"] == floor - 1,
          "199 post-only orders: withheld, counts shown, enough_data false")
    check("post-only orders" in r["enough_data_basis"]
          and "polls" in r["enough_data_basis"],
          "enough_data says it counts orders here and polls on the tracked rate")

    at = ([order(i, status="badAloPxRejected") for i in range(20)]
          + [order(20 + i, status="canceled") for i in range(90)]
          + [order(110 + i, status="filled") for i in range(90)]
          + [order(200 + i, tif="Gtc", status="minTradeNtlRejected") for i in range(5)])
    r = wh.post_only_summary(at, NOW_MS)
    m = collector.rejection_metrics(collector.summarise("", at)["counts"])
    check(r["rejection_rate"] == m["post_only_rejection_rate"] == 0.1,
          "rate equals collector.rejection_metrics (20 of 200)")
    check(r["band"] == "mixed", "0.10 is service's 'mixed' band")
    check(r["cancels_per_fill"] == m["cancel_to_fill"] == 1.0,
          "cancels per fill equals collector's cancel_to_fill")

    old = [order(i, status="filled", age_ms=19 * wh.DAY_MS) for i in range(250)]
    r = wh.post_only_summary(old, NOW_MS)
    check(wh.POST_ONLY_WITHHOLD_AFTER_SECONDS is None and r["rejection_rate"] == 0.0
          and r["withheld_reason"] is None
          and r["age_rule"]["older_than_tracked_limit"] is True,
          "owner's rule: 19-day-old orders are shown, not withheld, and flagged "
          "as older than the tracked limit")
    check(r["label"].startswith("Orders from ") and "newest 19 days ago" in r["label"]
          and "not a tracked series" in r["label"],
          f"labelled with its window and age: {r['label']!r}")
    wh.POST_ONLY_WITHHOLD_AFTER_SECONDS = service.MAX_RECORD_AGE_SECONDS
    try:
        r2 = wh.post_only_summary(old, NOW_MS)
    finally:
        wh.POST_ONLY_WITHHOLD_AFTER_SECONDS = None
    check(r2["withheld_reason"] == "stale_data" and r2["rejection_rate"] is None,
          "the one constant turns withholding on: stale_data, service's word")

    r = wh.post_only_summary([order(i, tif="Gtc") for i in range(300)], NOW_MS)
    check(r["withheld_reason"] == "no_post_only_orders", "no post-only orders")
    r = wh.post_only_summary([order(i, status="canceled") for i in range(250)], NOW_MS)
    check(r["rejection_rate"] == 0.0 and r["band"] == "quoting"
          and r["cancels_per_fill_withheld_reason"] == "no_filled_orders",
          "no fills: rate stands, cancels per fill withheld no_filled_orders")


def busy_table(n_positions: int = 1, dexes: int = 1) -> dict:
    rows = funding_rows(lambda k: 22)
    for i, r in enumerate(rows):
        if i % 50 == 0:
            r["delta"]["coin"] = f"d{i // 50 % dexes}:OIL"
    t = {
        "clearinghouseState": perp_held(n_positions),
        "spotClearinghouseState": SPOT_HELD,
        "userFills": [fill(i, fee="0.1", crossed=bool(i % 3)) for i in range(2000)],
        "historicalOrders": [order(i, status="badAloPxRejected" if i % 10 == 0
                                   else "filled") for i in range(2000)],
        "userFees": FEES,
        "userFunding": lambda b: [r for r in rows
                                  if b["startTime"] <= r["time"] <= b["endTime"]][:500],
    }
    for d in range(dexes):
        t[f"clearinghouseState:d{d}"] = perp_held(n_positions)
    return t


def base_reads(**over) -> dict:
    reads = {"perp": {"data": perp_held()}, "spot": {"data": SPOT_HELD},
             "fills": {"data": [fill(0, fee="1", crossed=True)]},
             "orders": {"data": []}, "fees": {"data": FEES},
             "funding": {"rows": [], "covered_from_ms": NOW_MS - 30 * wh.DAY_MS,
                         "covered_to_ms": NOW_MS,
                         "requested_from_ms": NOW_MS - 30 * wh.DAY_MS,
                         "pages": 2, "partial": False, "stopped_by": None,
                         "rows_read_outside_span": 0}}
    reads.update(over)
    return reads


def check_read_and_build() -> None:
    print("ACCOUNT AND READ")
    venue = FakeVenue({"clearinghouseState": PERP_EMPTY,
                       "spotClearinghouseState": SPOT_EMPTY,
                       "userRole": {"role": "missing"}})
    reads, spent = wh.read_all(ADDR, info=venue, now_ms=NOW_MS, budget=roomy())
    out = wh.build(reads, NOW_MS)
    check([c["type"] for c in venue.calls]
          == ["clearinghouseState", "spotClearinghouseState", "userRole"],
          "no account: three calls, then stop")
    check(sum(w for _, w in spent) == 64, "no account costs 2 + 2 + 60 = 64 weight")
    check(all(out[s]["withheld_reason"] == "no_account"
              for s in ("holdings",) + wh.SECTIONS), "every section withheld no_account")
    check(numbers_in({k: out[k] for k in ("holdings",) + wh.SECTIONS}) == [],
          "no number anywhere in a no-account answer, zeros included")
    check(out["partial"] is False and out.pop("cacheable") is True,
          "no-account answer is complete and cacheable")

    venue = FakeVenue({"clearinghouseState": PERP_EMPTY,
                       "spotClearinghouseState": SPOT_EMPTY,
                       "userRole": {"role": "user"},
                       "userFills": [], "historicalOrders": [],
                       "userFees": {"dailyUserVlm": [{"date": "2026-09-24",
                                                      "userCross": "0", "userAdd": "0"}]},
                       "userFunding": []})
    reads, _ = wh.read_all(ADDR, info=venue, now_ms=NOW_MS, budget=roomy())
    out = wh.build(reads, NOW_MS)
    check(out["account"]["exists"] is True and out["account"]["role"] == "user",
          "an emptied account is an account, on userRole's word")
    check(out["fees"]["withheld_reason"] == "no_fills"
          and out["post_only"]["withheld_reason"] == "no_post_only_orders"
          and out["funding"]["withheld_reason"] == "no_funding_in_window"
          and out["taker_share"]["withheld_reason"] == "no_volume_in_window",
          "each empty section carries its own reason")

    venue = FakeVenue(busy_table(dexes=1))
    reads, spent = wh.read_all(ADDR, info=venue, now_ms=NOW_MS, budget=roomy())
    out = wh.build(reads, NOW_MS)
    types = [c["type"] + (":" + c["dex"] if "dex" in c else "") for c in venue.calls]
    check("userRole" not in types, "holdings present: userRole is not spent")
    check(types.count("userFunding") == 3, "funding takes its 3 pages")
    check("clearinghouseState:d0" in types,
          "a builder dex named in the reads gets its own clearinghouseState")
    w = sum(x for _, x in spent)
    check(w <= wh.MAX_REQUEST_WEIGHT, f"busy read costs {w}, within {wh.MAX_REQUEST_WEIGHT}")
    check(out["funding"]["partial"] and out["missing"][-1]["section"] == "funding"
          and out["missing"][-1]["withheld_reason"] == "funding_page_cap",
          "page-capped funding is in `missing` with funding_page_cap, not null")
    check(out.pop("cacheable") is True, "a page-capped answer is still cacheable")
    check(ADDR not in json.dumps(out), "the address is not in the response")
    check(set(out["reasons"]) <= set(wh.REASONS), "every reason used is defined")

    venue = FakeVenue(busy_table(dexes=12))
    reads, _ = wh.read_all(ADDR, info=venue, now_ms=NOW_MS, budget=roomy())
    out = wh.build(reads, NOW_MS)
    cut = [d for d in out["holdings"]["perps"]["dexes_not_read"]
           if d["withheld_reason"] == "dex_read_cap"]
    read = [c for c in venue.calls if "dex" in c]
    check(len(read) == 10 and len(cut) == 2,
          "12 builder dexes seen: 10 read, 2 reported as dex_read_cap")
    check(any(m["withheld_reason"] == "dex_read_cap" for m in out["missing"])
          and out.pop("cacheable") is True,
          "the cut is in `missing` and, being a limit, still cacheable")

    print("FAILURE")
    venue = FakeVenue(busy_table(), fail={"userFills": http_429()})
    reads, spent = wh.read_all(ADDR, info=venue, now_ms=NOW_MS, budget=roomy())
    out = wh.build(reads, NOW_MS)
    check([c["type"] for c in venue.calls]
          == ["clearinghouseState", "spotClearinghouseState", "userFills"],
          "a venue 429 stops the read: no call after it")
    sections = {m["section"]: m["withheld_reason"] for m in out["missing"]}
    check(sections.get("fees") == "venue_rate_limited"
          and sections.get("post_only") == "venue_rate_limited"
          and sections.get("funding") == "venue_rate_limited",
          "sections not read are listed as missing, venue_rate_limited")
    check(out["partial"] is True and out.pop("cacheable") is False,
          "a failed read is partial and not cached")
    check(out["holdings"]["perps"]["dexes"][0]["account_value_usd"] == 1000.5,
          "what was read before the failure is still returned")
    dumped = json.dumps(out)
    check(SECRET not in dumped and "example.invalid" not in dumped,
          "no exception text or URL in the response")
    check(reads["fills"].get("detail") == "HTTP 429",
          "the failure detail is safe_errors.describe's 'HTTP 429'")

    for exc, code in ((http_429(), "venue_rate_limited"),
                      (TimeoutError(SECRET), "venue_unreachable")):
        venue = FakeVenue({"clearinghouseState": PERP_EMPTY,
                           "spotClearinghouseState": SPOT_EMPTY,
                           "userFills": [], "historicalOrders": [],
                           "userFees": FEES, "userFunding": []},
                          fail={"userRole": exc})
        reads, _ = wh.read_all(ADDR, info=venue, now_ms=NOW_MS, budget=roomy())
        out = wh.build(reads, NOW_MS)
        check(out["account"]["exists"] is None
              and out["account"]["withheld_reason"] == code
              and {"section": "account", "withheld_reason": code} in out["missing"],
              f"userRole failing on an empty account: exists null, reason {code}")
        check(SECRET not in json.dumps(out), "and no exception text")


def check_gate() -> None:
    print("GATE")
    check(wh.MAX_CONCURRENT_READS == 1, "one read at a time")
    t = [1000.0]
    b = wh._Budget(480, clock=lambda: t[0])
    e1 = b.try_take(120)
    b.settle(e1, 22)
    check(b.used() == 22, "a call takes its maximum and settles to what was charged")
    check(b.try_take(458) is not None and b.try_take(1) is None,
          "the ledger fills to exactly 480 and refuses past it")
    hint = b.wait_hint(wh.MAX_REQUEST_WEIGHT)
    check(1 <= hint <= 60, f"Retry-After hint inside the minute ({hint:.0f}s)")
    t[0] += 61
    check(b.try_take(wh.MAX_REQUEST_WEIGHT) is not None,
          "after the minute rolls over a worst-case read fits")

    check(set(wh.BUSY_REASONS) == {"already_reading", "another_read_in_progress",
                                   "route_rate_budget"}
          and all(wh.Busy(c, 5).detail == wh.REASONS[c] for c in wh.BUSY_REASONS),
          "three Busy codes, each with its own sentence as the 429 detail")

    real = wh.read_all
    saved_budget = wh._budget
    calls = {"n": 0}

    def fake_read(addr, **kw):
        calls["n"] += 1
        return real(addr, info=FakeVenue({"clearinghouseState": PERP_EMPTY,
                                          "spotClearinghouseState": SPOT_EMPTY,
                                          "userRole": {"role": "missing"}}),
                    budget=wh._budget)

    async def run():
        wh._cache.clear()
        wh._budget = wh._Budget(480)
        wh.read_all = fake_read
        try:
            a = await wh.get_wallet_habits(ADDR)
            c = await wh.get_wallet_habits(ADDR.upper().replace("0X", "0x"))
            try:
                await wh.get_wallet_habits("0x" + "cd" * 20)
                refused = None
            except wh.Busy as e:
                refused = e
            used = wh._budget.used()
            return a, c, refused, used
        finally:
            wh.read_all = real

    a, c, refused, used = asyncio.run(run())
    check(a["served_from_cache"] is False and c["served_from_cache"] is True
          and calls["n"] == 1 and c["read"]["weight_spent_by_this_request"] == 0,
          "second request served from cache, one read, 0 weight spent by it")
    check(a["read"]["venue_weight"] == 64 and "cacheable" not in a,
          "the response states its weight; the internal flag is not returned")
    check(used == 64, "the module ledger holds the 64 actually spent")
    check(refused is not None and refused.reason == "route_rate_budget",
          "64 spent + 479 worst case > 480: the next uncached read is refused "
          "at once with route_rate_budget, not started and starved")

    # The gate is held until the read thread ends, not until the await gives up.
    release = threading.Event()

    def slow_read(addr, **kw):
        release.wait(5)
        return {"perp": {"data": PERP_EMPTY}, "spot": {"data": SPOT_EMPTY},
                "role": {"data": {"role": "missing"}}}, [(0.0, 64)]

    async def run_timeout():
        wh._cache.clear()
        wh._budget = wh._Budget(480)
        wh.read_all = slow_read
        saved = (wh.READ_DEADLINE_SECONDS, wh.CALL_TIMEOUT_SECONDS)
        wh.READ_DEADLINE_SECONDS, wh.CALL_TIMEOUT_SECONDS = -4.8, 0.0
        try:
            try:
                await wh.get_wallet_habits(ADDR)
                timed_out = False
            except (asyncio.TimeoutError, TimeoutError):
                timed_out = True
            held = wh._active
            try:
                await wh.get_wallet_habits("0x" + "cd" * 20)
                second = None
            except wh.Busy as e:
                second = e.reason
            release.set()
            for _ in range(100):
                if wh._active == 0:
                    break
                await asyncio.sleep(0.02)
            return timed_out, held, second, wh._active
        finally:
            wh.READ_DEADLINE_SECONDS, wh.CALL_TIMEOUT_SECONDS = saved
            wh.read_all = real
            wh._budget = saved_budget

    timed_out, held, second, after = asyncio.run(run_timeout())
    check(timed_out and held == 1 and second == "another_read_in_progress",
          "after the await times out the gate stays held and a second read is refused")
    check(after == 0, "the gate is released when the thread actually ends")
    check(len(wh._cache) <= wh.CACHE_MAX, "cache within its cap")


def check_size() -> None:
    print("SIZE")
    venue = FakeVenue(busy_table(n_positions=177, dexes=1))
    reads, _ = wh.read_all(ADDR, info=venue, now_ms=NOW_MS, budget=roomy())
    tracemalloc.start()
    out = wh.build(reads, NOW_MS)
    out.pop("cacheable")
    out["read"] = {"venue_calls": 9, "venue_weight": 401}
    held = tracemalloc.get_traced_memory()[0]
    tracemalloc.stop()
    del reads
    size = len(json.dumps(out).encode())
    check(size < 100_000,
          f"177 positions on each of two dexes: {size:,} bytes serialised, "
          f"{held / 1e3:,.0f} KB as a Python dict")
    check(held * wh.CACHE_MAX > wh.CACHE_MAX_BYTES,
          f"as dicts, {wh.CACHE_MAX} such answers would be "
          f"{held * wh.CACHE_MAX / 1e6:.1f} MB; the cache holds bytes instead")
    wh._cache.clear()
    wh._cache_bytes = 0
    for i in range(200):
        wh._store(f"0x{i:040x}", 0.0, out)
    total = sum(len(v[1]) for v in wh._cache.values())
    check(total == wh._cache_bytes and total <= wh.CACHE_MAX_BYTES
          and len(wh._cache) <= wh.CACHE_MAX,
          f"200 stores of it: {len(wh._cache)} held, {total:,} bytes, within "
          f"{wh.CACHE_MAX_BYTES:,}")
    hit = wh._cached(f"0x{199:040x}", 1.0)
    check(hit is not None and hit[1] == json.loads(json.dumps(out)),
          "a cached answer comes back identical, floats included")
    wh._cache.clear()
    wh._cache_bytes = 0


def main() -> int:
    check_body()
    check_fees()
    check_taker()
    check_funding()
    check_post_only()
    check_read_and_build()
    check_gate()
    check_size()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
