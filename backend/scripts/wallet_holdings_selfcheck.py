#!/usr/bin/env python3
"""wallet_holdings_selfcheck.py -- POST /api/wallet/holdings, checked on
recorded chain answers with no network (and, with --live, on the chains).

  BODY      parse_body: one None for every malformed body, a lowercased
            address for a good one; the route's 400 repeats nothing sent.
  READ      a recorded read (2026-09-30, every chain answered, one version
            held: NVDAc on Base, 0.0217831) served through the real
            holdings.py code with only read_at_block replaced: the row, its
            type from the universe file, its name, the six chains with their
            blocks, and no wallet address anywhere in the answer.
  TYPE      a version of an ETF held goes to `etfs`, a stock to `stocks`, an
            underlying with no type to `untyped`, never into either list.
  FAILED    a chain whose provider fails is reported as failed with its
            reason, status "partial", and its versions are not listed as
            zero; every chain failing is "unavailable".
  PRICE     a value only from a stored, fresh, measured price for that exact
            version, with its source, block and time; older than a day,
            missing, unmeasured or an unreadable store give value null and a
            reason code explained in `reasons`. Records written before
            ref_mid_usd use pool 0's mid.
  GATE      a cached answer spends nothing; two requests for one wallet share
            one read; at most MAX_CONCURRENT_READS new reads at once and
            READS_PER_MINUTE a minute, refused with 429 and Retry-After.
  ROUTE     200, 400, 429 through the router with a test client; no-store.

Run from backend/:
  ./venv/bin/python scripts/wallet_holdings_selfcheck.py
  ./venv/bin/python scripts/wallet_holdings_selfcheck.py --live
--live reads 0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9 on the six chains
through the public endpoints (never a keyed one) and requires NVDAc on Base,
0.0217831.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.te import holdings as H  # noqa: E402
from core.te import wallet_view as V  # noqa: E402
from core.te.rpcclient import RpcError  # noqa: E402

FAILURES: list[str] = []
OWNER = "0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9"
NVDAC = "8453/0xb20000000000000000000078ee7ce2fe4908108c"

# Recorded 2026-09-30 20:52 UTC from the live read of OWNER: each chain's
# block and block time, and the one nonzero balanceOf (by token address).
RECORDED = {
    1: {"block": 26092804, "ts": 1790801531, "held": {}},
    8453: {"block": 52006098, "ts": 1790801543,
           "held": {"0xb20000000000000000000078ee7ce2fe4908108c": 2178310}},
    42161: {"block": 510456976, "ts": 1790801542, "held": {}},
    56: {"block": 124975746, "ts": 1790801543, "held": {}},
    4663: {"block": 76816691, "ts": 1790801542, "held": {}},
    999: {"block": 47320771, "ts": 1790801543, "held": {}},
}


def check(cond: bool, what: str) -> None:
    print(("ok    " if cond else "FAIL  ") + what)
    if not cond:
        FAILURES.append(what)


def recorded_reader(fail: set[int] = frozenset(), held: dict | None = None):
    """A read_at_block that answers from RECORDED (plus `held`, token address
    to raw balance) and raises for the chains in `fail`."""
    def read(chain_id, calls, deadline):
        if chain_id in fail:
            raise RpcError("transient", "request timed out")
        r = RECORDED[chain_id]
        extra = held or {}
        out = []
        for token, _data in calls:
            raw = r["held"].get(token.lower(), extra.get(token.lower(), 0))
            out.append(raw.to_bytes(32, "big"))
        return r["block"], r["ts"], out
    return read


def run_read(fail=frozenset(), held=None) -> dict:
    orig = H.read_at_block
    H.read_at_block = recorded_reader(fail, held)
    try:
        return H.wallet_holdings(OWNER)
    finally:
        H.read_at_block = orig


class Store:
    def __init__(self, docs=None, broken=False):
        self.docs = docs or []
        self.broken = broken

    async def costs_for(self, underlying):
        if self.broken:
            raise ConnectionError("store down")
        return [d for d in self.docs if d.get("underlying") == underlying]


def iso(t: float) -> str:
    import datetime as dt
    return dt.datetime.fromtimestamp(t, dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def body_checks() -> None:
    good = V.parse_body(json.dumps({"address": OWNER}).encode())
    check(good == OWNER.lower(), "BODY a good address is lowercased")
    bad = [b"", b"{}", b"[]", b"not json", json.dumps({"address": OWNER, "x": 1}).encode(),
           json.dumps({"address": 5}).encode(), json.dumps({"address": "0x123"}).encode(),
           json.dumps({"address": "0x" + "g" * 40}).encode(), b" " * 300]
    check(all(V.parse_body(b) is None for b in bad), "BODY every malformed body gives None")


def read_checks() -> None:
    h = run_read()
    body = V.shape(h, {}, True)
    rows = body["stocks"]
    check(h["status"] == "read" and body["status"] == "read", "READ every recorded chain answered: status read")
    check(len(rows) == 1 and rows[0]["key"] == NVDAC, "READ one holding, NVDAc on Base, under stocks")
    r = rows[0] if rows else {}
    check(r.get("balance") == "0.0217831" and r.get("balance_raw") == "2178310", "READ balance 0.0217831 exactly")
    check(r.get("symbol") == "NVDAc" and r.get("ticker") == "NVDA" and r.get("issuer") == "Coinbase"
          and r.get("chain") == "Base" and r.get("chain_id") == 8453, "READ symbol, ticker, issuer, chain")
    check(r.get("type") == "stock" and bool(r.get("name")) and r.get("name") != "NVDA",
          f"READ type stock and the universe's name ({r.get('name')})")
    check(r.get("block") == RECORDED[8453]["block"], "READ the row carries Base's block")
    check(body["etfs"] == [] and body["untyped"] == [], "READ no ETF, nothing untyped")
    ch = {c["chain_id"]: c for c in body["chains"]}
    check(set(ch) == set(RECORDED) and all(c["status"] == "read" and c["block"] == RECORDED[i]["block"]
                                          and c.get("block_time") for i, c in ch.items()),
          "READ six chains, each read with its block and block time")
    check(body["coverage"]["chains_failed"] == [] and len(body["coverage"]["chains_read"]) == 6,
          "READ coverage: six read, none failed")
    text = json.dumps(body)
    check(OWNER.lower() not in text.lower() and "wallet" not in body, "READ the wallet address is not in the answer")
    check(r.get("value_usd") is None and r.get("value_reason") == "no_measured_price"
          and "no_measured_price" in body["reasons"], "READ no stored price: no value, reason explained")


def type_checks() -> None:
    from core.te.universe import load_universe
    u = load_universe()
    etf = stock_other = None
    for cid, vs in H.versions_on_buy_chains().items():
        for v in vs:
            t = (u.underlying(v["ticker"]) or {}).get("type")
            if t == "etf" and etf is None:
                etf = v
            if t == "stock" and stock_other is None and v["key"] != NVDAC:
                stock_other = v
    check(etf is not None, "TYPE the universe has an ETF version on a buy chain")
    if etf is None:
        return
    held = {etf["address"].lower(): 10 ** int(etf["decimals"])}
    body = V.shape(run_read(held=held), {}, True)
    check([r["key"] for r in body["etfs"]] == [etf["key"]] and body["etfs"][0]["balance"] == "1",
          f"TYPE {etf['symbol']} ({etf['ticker']}) goes to etfs, balance 1")
    check([r["key"] for r in body["stocks"]] == [NVDAC], "TYPE the stock stays in stocks")
    # An underlying with no type: served, but in neither list.
    h = run_read()
    h["holdings"][0] = {**h["holdings"][0], "ticker": "ZZZNOTYPE"}
    b2 = V.shape(h, {}, True)
    check(b2["stocks"] == [] and b2["etfs"] == [] and len(b2["untyped"]) == 1 and b2["untyped"][0]["type"] is None,
          "TYPE an untyped underlying is served under untyped, not guessed")


def failed_checks() -> None:
    h = run_read(fail={8453})
    body = V.shape(h, {}, True)
    base = next(c for c in body["chains"] if c["chain_id"] == 8453)
    check(body["status"] == "partial", "FAILED one chain failing makes the answer partial")
    check(base["status"] == "failed" and base.get("reason") and "block" not in base,
          f"FAILED Base reported failed with a reason ({base.get('reason')}), no block")
    check(body["stocks"] == [] and any(f["chain"] == "Base" for f in body["coverage"]["chains_failed"]),
          "FAILED nothing listed from Base, and coverage names it failed")
    h = run_read(fail=set(RECORDED))
    body = V.shape(h, {}, True)
    check(body["status"] == "unavailable" and body["coverage"]["chains_read"] == [],
          "FAILED every chain failing is unavailable")


def price_checks() -> None:
    now = time.time()
    h = run_read()
    fresh = {"key": NVDAC, "underlying": "NVDA", "state": "measured", "ref_mid_usd": 200.0,
             "block": 52000000, "computed_at": iso(now - 120)}
    docs, ok = asyncio.run(V.stored_prices(Store([fresh]), ["NVDA"]))
    body = V.shape(h, docs, ok, now)
    r = body["stocks"][0]
    check(ok and r["value_usd"] == 4.3566 and r["value_reason"] is None,
          f"PRICE 0.0217831 x 200 = 4.3566 ({r['value_usd']})")
    p = r["price"] or {}
    check(p.get("source") == "tnega_cost_engine" and p.get("block") == 52000000 and p.get("computed_at")
          and p.get("basis"), "PRICE the value carries its source, block, time and basis")
    check(body["totals"]["stocks"]["value_usd"] == 4.3566 and body["totals"]["etfs"]["value_usd"] is None,
          "PRICE totals: stocks summed, ETFs none (no zero)")
    legacy = {**fresh, "ref_mid_usd": None, "pool": [1, 0, 0], "mid_usd": [999.0, 230.5, 230.5]}
    body = V.shape(h, {NVDAC: legacy}, True, now)
    check(body["stocks"][0]["price"]["price_usd"] == 230.5, "PRICE a record without ref_mid_usd uses pool 0's mid")
    old = {**fresh, "computed_at": iso(now - V.PRICE_MAX_AGE_SECONDS - 60)}
    body = V.shape(h, {NVDAC: old}, True, now)
    check(body["stocks"][0]["value_usd"] is None and body["stocks"][0]["value_reason"] == "price_too_old"
          and "price_too_old" in body["reasons"], "PRICE older than a day: no value, price_too_old")
    failed = {**fresh, "state": "failed"}
    body = V.shape(h, {NVDAC: failed}, True, now)
    check(body["stocks"][0]["value_reason"] == "no_measured_price", "PRICE an unmeasured record: no value")
    docs, ok = asyncio.run(V.stored_prices(Store(broken=True), ["NVDA"]))
    body = V.shape(h, docs, ok, now)
    check(not ok and body["stocks"][0]["value_reason"] == "price_store_unavailable"
          and body["stocks"][0]["balance"] == "0.0217831", "PRICE store down: balance kept, value withheld")


def gate_checks() -> None:
    async def go():
        calls = []

        async def reader(w):
            calls.append(w)
            await asyncio.sleep(0.05)
            return {"status": "read", "holdings": [], "chains": [], "coverage": {}}

        V._started.clear()
        a, b = await asyncio.gather(V.read(OWNER, reader=reader), V.read(OWNER.lower(), reader=reader))
        check(len(calls) == 1 and a == b, "GATE two requests for one wallet share one read")
        check(V._running == 0 and not V._inflight, "GATE the slot is freed when the read ends")

        # Concurrency: three slow reads running, a fourth wallet refused.
        V._started.clear()
        gate = asyncio.Event()

        async def slow(w):
            await gate.wait()
            return {"status": "read", "holdings": [], "chains": [], "coverage": {}}

        tasks = [asyncio.ensure_future(V.read("0x" + f"{i:040x}", reader=slow)) for i in range(V.MAX_CONCURRENT_READS)]
        await asyncio.sleep(0)
        try:
            await V.read("0x" + "ee" * 20, reader=slow)
            check(False, "GATE a read past MAX_CONCURRENT_READS is refused")
        except V.Busy as e:
            check(e.reason == "another_read_in_progress" and e.retry_after >= 1,
                  "GATE a read past MAX_CONCURRENT_READS is refused with another_read_in_progress")
        gate.set()
        await asyncio.gather(*tasks)

        # Rate: READS_PER_MINUTE started in the window, the next refused.
        V._started.clear()
        now = time.monotonic()
        V._started.extend([now] * V.READS_PER_MINUTE)
        try:
            await V.read("0x" + "dd" * 20, reader=reader)
            check(False, "GATE past READS_PER_MINUTE is refused")
        except V.Busy as e:
            check(e.reason == "route_rate_budget" and 1 <= e.retry_after <= 61,
                  f"GATE past READS_PER_MINUTE: route_rate_budget, retry after {e.retry_after} s")
        # A cached answer is served even then.
        with H._cache_lock:
            H._cache["0x" + "cc" * 20] = (time.monotonic(), {"status": "read", "holdings": [], "chains": []})
        hit = await V.read("0x" + "cc" * 20, reader=reader)
        check(hit.get("cached_seconds") is not None, "GATE a cached answer spends nothing, even with the budget spent")
        V._started.clear()
        with H._cache_lock:
            H._cache.clear()
    asyncio.run(go())


def route_checks() -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from te import wallet_router

    app = FastAPI()
    app.include_router(wallet_router.router)
    client = TestClient(app)
    orig_store, orig_read = wallet_router._price_store, H.read_at_block
    wallet_router._price_store = lambda: Store()
    H.read_at_block = recorded_reader()
    try:
        with H._cache_lock:
            H._cache.clear()
        V._started.clear()
        r = client.post("/api/wallet/holdings", json={"address": OWNER})
        b = r.json()
        check(r.status_code == 200 and r.headers.get("cache-control") == "no-store"
              and [x["symbol"] for x in b["stocks"]] == ["NVDAc"], "ROUTE 200, no-store, NVDAc in stocks")
        check(OWNER.lower() not in r.text.lower(), "ROUTE the address is not echoed")
        for bad in ({"address": "0x123"}, {"wallet": OWNER}, [OWNER]):
            r = client.post("/api/wallet/holdings", json=bad)
            check(r.status_code == 400 and "0x123" not in r.text and OWNER.lower() not in r.text.lower(),
                  f"ROUTE 400 for {json.dumps(bad)[:30]}, nothing repeated")
        r = client.post("/api/wallet/holdings", content=b"x" * 1000)
        check(r.status_code == 400, "ROUTE 400 for a body over the cap")
        r = client.get("/api/wallet/holdings")
        check(r.status_code == 405, "ROUTE GET is not a form of this route (405)")
        with H._cache_lock:
            H._cache.clear()
        V._started.extend([time.monotonic()] * V.READS_PER_MINUTE)
        r = client.post("/api/wallet/holdings", json={"address": "0x" + "ab" * 20})
        check(r.status_code == 429 and r.headers.get("retry-after") and r.json().get("reason") == "route_rate_budget",
              "ROUTE 429 with Retry-After when the budget is spent")
    finally:
        wallet_router._price_store, H.read_at_block = orig_store, orig_read
        V._started.clear()
        with H._cache_lock:
            H._cache.clear()


def live_check() -> None:
    os.environ.pop("INFURA_API_KEY", None)
    t0 = time.monotonic()
    h = H.wallet_holdings(OWNER)
    body = V.shape(h, {}, False)
    took = time.monotonic() - t0
    print(f"      live: status {body['status']}, {took:.1f} s, chains read {body['coverage']['chains_read']}, "
          f"failed {body['coverage']['chains_failed']}")
    for c in body["chains"]:
        print(f"      {c['chain']}: {c['status']} block {c.get('block')} {c.get('block_time') or c.get('reason')}")
    row = next((r for r in body["stocks"] if r["key"] == NVDAC), None)
    base = next(c for c in body["chains"] if c["chain_id"] == 8453)
    if base["status"] != "read":
        check(False, f"LIVE Base could not be read ({base.get('reason')}); rerun")
        return
    check(row is not None and row["balance"] == "0.0217831" and row["chain"] == "Base" and row["type"] == "stock",
          f"LIVE NVDAc on Base 0.0217831 under stocks ({row and row['balance']})")


def main() -> int:
    body_checks()
    read_checks()
    type_checks()
    failed_checks()
    price_checks()
    gate_checks()
    route_checks()
    if "--live" in sys.argv:
        live_check()
    print(f"\n{len(FAILURES)} failure(s)" if FAILURES else "\nall checks passed")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
