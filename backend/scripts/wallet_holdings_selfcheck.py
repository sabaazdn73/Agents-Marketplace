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
  TOKENS    each chain's own coin (getEthBalance through Multicall3), its pay
            tokens and the other named tokens, read in the same batch: a pay
            token valued at $1 and labelled an assumption; the coin valued
            only with an own-coin price, else native_price_unavailable; any
            other token no_price_source; totals per section and overall
            count only valued rows (k of n).
  COVERAGE  a failed chain reports versions_checked 0 (versions_listed
            says how many it lists); calls that return nothing at the block
            make the answer partial and are not counted as checked.
  NATIVE    the own-coin price is read once per NATIVE_CACHE_SECONDS, a
            failure is not retried for NATIVE_RETRY_SECONDS, and no price
            older than NATIVE_MAX_AGE_SECONDS is used.
  THREAD    a read whose caller stopped waiting keeps its slot until the
            read thread itself ends; its answer is then cached.
  ROUTE     200, 400, 415, 429 through the router with a test client;
            no-store; one client past CLIENT_READS_PER_MINUTE gets 429
            client_rate_budget.

Run from backend/:
  ./venv/bin/python scripts/wallet_holdings_selfcheck.py
  ./venv/bin/python scripts/wallet_holdings_selfcheck.py --live
--live reads 0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9 on the six chains
through the public endpoints (never a keyed one) and requires NVDAc on Base,
0.0217831, and a USDC balance on Base.
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
from core.te.multicall import MULTICALL3  # noqa: E402
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


def recorded_reader(fail: set[int] = frozenset(), held: dict | None = None, silent: dict | None = None):
    """A read_at_block that answers from RECORDED (plus `held`: (chain id,
    target address) or target address to raw balance; the coin's target is
    Multicall3) and raises for the chains in `fail`. `silent`: chain id to a
    set of target addresses whose call returns nothing."""
    def read(chain_id, calls, deadline):
        if chain_id in fail:
            raise RpcError("transient", "request timed out")
        r = RECORDED[chain_id]
        extra = held or {}
        quiet = (silent or {}).get(chain_id, set())
        out = []
        for token, _data in calls:
            t = token.lower()
            if t in quiet:
                out.append(None)
                continue
            raw = r["held"].get(t, extra.get((chain_id, t), extra.get(t, 0)))
            out.append(raw.to_bytes(32, "big"))
        return r["block"], r["ts"], out
    return read


def run_read(fail=frozenset(), held=None, silent=None) -> dict:
    orig = H.read_at_block
    H.read_at_block = recorded_reader(fail, held, silent)
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
    check(body["etfs"] == [] and body["untyped"] == [] and body["tokens"] == [],
          "READ no ETF, nothing untyped, no token (the recording holds none)")
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
    held = {**fresh, "state": "held",
            "reason": "a multiplier change was first seen at 2026-10-01T16:58:27Z, within 15 minutes of this block"}
    body = V.shape(h, {NVDAC: held}, True, now)
    check(body["stocks"][0]["value_usd"] is None and body["stocks"][0]["value_reason"] == "price_on_hold"
          and "15 minutes" in body["reasons"]["price_on_hold"],
          "PRICE a record on hold after a multiplier change: no value, price_on_hold explained")
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
        r = client.post("/api/wallet/holdings", content=b"x" * 1000, headers={"content-type": "application/json"})
        check(r.status_code == 400, "ROUTE 400 for a body over the cap")
        r = client.get("/api/wallet/holdings")
        check(r.status_code == 405, "ROUTE GET is not a form of this route (405)")
        good = json.dumps({"address": OWNER})
        for ctype in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", None):
            headers = {"content-type": ctype} if ctype else {}
            r = client.post("/api/wallet/holdings", content=good.encode(), headers=headers)
            check(r.status_code == 415 and OWNER.lower() not in r.text.lower(),
                  f"ROUTE 415 for Content-Type {ctype or '(none)'}")
        r = client.post("/api/wallet/holdings", content=good.encode(),
                        headers={"content-type": "application/json; charset=utf-8"})
        check(r.status_code == 200, "ROUTE application/json with a charset is accepted")
        with H._cache_lock:
            H._cache.clear()
        V._started.clear()
        V._client_started.clear()
        codes = []
        for i in range(V.CLIENT_READS_PER_MINUTE + 1):
            r = client.post("/api/wallet/holdings", json={"address": "0x" + f"{i + 1:040x}"},
                            headers={"true-client-ip": "203.0.113.7"})
            codes.append(r.status_code)
        last = r.json()
        check(codes[:-1] == [200] * V.CLIENT_READS_PER_MINUTE and codes[-1] == 429
              and last.get("reason") == "client_rate_budget" and r.headers.get("retry-after"),
              f"ROUTE one client past {V.CLIENT_READS_PER_MINUTE} new reads a minute: 429 client_rate_budget")
        r = client.post("/api/wallet/holdings", json={"address": "0x" + f"{1:040x}"},
                        headers={"true-client-ip": "203.0.113.7"})
        check(r.status_code == 200, "ROUTE the same client is still answered from the cache")
        r = client.post("/api/wallet/holdings", json={"address": "0x" + "fe" * 20},
                        headers={"true-client-ip": "198.51.100.9"})
        check(r.status_code == 200, "ROUTE another client is not affected")
        with H._cache_lock:
            H._cache.clear()
        V._started.clear()
        V._client_started.clear()
        with H._cache_lock:
            H._cache.clear()
        V._started.extend([time.monotonic()] * V.READS_PER_MINUTE)
        r = client.post("/api/wallet/holdings", json={"address": "0x" + "ab" * 20})
        check(r.status_code == 429 and r.headers.get("retry-after") and r.json().get("reason") == "route_rate_budget",
              "ROUTE 429 with Retry-After when the budget is spent")
    finally:
        wallet_router._price_store, H.read_at_block = orig_store, orig_read
        V._started.clear()
        V._client_started.clear()
        with H._cache_lock:
            H._cache.clear()


BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
BSC_USD1 = "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d"
ETH_PRICE = {"usd": 2500.0, "source": "Uniswap V3 USDC/WETH 0.05%, Ethereum", "pool": "0x88e6", "chain_id": 1,
             "block": 26092800, "window_seconds": 1800, "read_at": "2026-09-30T20:50:00Z", "age_seconds": 30}


def token_checks() -> None:
    held = {(8453, BASE_USDC): 1_890_000, (8453, MULTICALL3): 10 ** 15, (56, BSC_USD1): 5 * 10 ** 18}
    h = run_read(held=held)
    kinds = {(t["chain_id"], t["kind"], t["symbol"]) for t in h["tokens"]}
    check(kinds == {(8453, "pay", "USDC"), (8453, "native", "ETH"), (56, "other", "USD1")},
          f"TOKENS three nonzero token balances read beside the versions ({sorted(kinds)})")
    check(all(c.get("tokens_checked") == c.get("tokens_listed") and c["tokens_listed"] >= 2 for c in h["chains"]),
          "TOKENS every chain read its coin and pay tokens")
    body = V.shape(h, {}, True, native={"ETH": ETH_PRICE})
    t = {r["symbol"]: r for r in body["tokens"]}
    usdc, eth, usd1 = t.get("USDC", {}), t.get("ETH", {}), t.get("USD1", {})
    check(usdc.get("balance") == "1.89" and usdc.get("value_usd") == 1.89
          and (usdc.get("price") or {}).get("source") == "stablecoin_at_one_dollar"
          and (usdc.get("price") or {}).get("assumption") is True, "TOKENS USDC 1.89 valued at $1, labelled an assumption")
    check(eth.get("balance") == "0.001" and eth.get("value_usd") == 2.5
          and (eth.get("price") or {}).get("source") == "onchain_twap" and eth["price"].get("block")
          and eth["price"].get("read_at"), "TOKENS ETH 0.001 x 2500 = 2.5 from the on-chain average, with block and time")
    check(usd1.get("value_usd") is None and usd1.get("value_reason") == "no_price_source"
          and "no_price_source" in body["reasons"], "TOKENS USD1: balance, no value, no_price_source")
    tt = body["totals"]["tokens"]
    check(tt == {"value_usd": 4.39, "rows": 3, "rows_priced": 2}, f"TOKENS total 4.39, 2 of 3 valued ({tt})")
    body = V.shape(h, {}, True, native={})
    eth = next(r for r in body["tokens"] if r["symbol"] == "ETH")
    check(eth["value_usd"] is None and eth["value_reason"] == "native_price_unavailable",
          "TOKENS no own-coin price: the balance alone, native_price_unavailable")
    # Everything together: NVDAc priced, tokens as above.
    now = time.time()
    fresh = {"key": NVDAC, "underlying": "NVDA", "state": "measured", "ref_mid_usd": 200.0,
             "block": 52000000, "computed_at": iso(now - 120)}
    body = V.shape(h, {NVDAC: fresh}, True, now, native={"ETH": ETH_PRICE})
    al = body["totals"]["all"]
    check(al == {"value_usd": 8.7466, "rows": 4, "rows_priced": 3},
          f"TOKENS overall total 4.3566 + 1.89 + 2.5 = 8.7466, 3 of 4 valued ({al})")


def coverage_checks() -> None:
    h = run_read(fail={8453})
    base = next(c for c in h["chains"] if c["chain_id"] == 8453)
    check(base["versions_checked"] == 0 and base["versions_listed"] > 0 and base["tokens_checked"] == 0,
          f"COVERAGE a failed chain checked 0 versions ({base['versions_listed']} listed), 0 tokens")
    check(h["coverage"]["versions_checked"] == sum(c["versions_checked"] for c in h["chains"])
          and h["coverage"]["versions_checked"] < h["coverage"]["versions_on_these_chains"]
          and h["coverage"]["partial"] is True, "COVERAGE the failed chain's versions are not counted as checked")
    v0 = H.versions_on_buy_chains()[1][0]["address"].lower()
    h = run_read(silent={1: {v0, MULTICALL3}})
    eth = next(c for c in h["chains"] if c["chain_id"] == 1)
    body = V.shape(h, {}, True)
    ce = next(c for c in body["chains"] if c["chain_id"] == 1)
    check(h["status"] == "read" and h["coverage"]["partial"] is True
          and eth["versions_unanswered"] == 1 and eth["versions_checked"] == eth["versions_listed"] - 1
          and eth["tokens_unanswered"] == 1 and eth["tokens_checked"] == eth["tokens_listed"] - 1,
          "COVERAGE calls answered with nothing: partial, not counted as checked")
    check(ce.get("versions_unanswered") == 1 and ce.get("tokens_unanswered") == 1 and ce.get("note")
          and body["coverage"]["partial"] is True, "COVERAGE the route carries the unanswered counts and the note")


def native_checks() -> None:
    calls = []

    def fake(sym):
        calls.append(sym)
        if sym == "BNB":
            raise RpcError("transient", "timed out")
        return {**ETH_PRICE, "usd": 2500.0}

    orig = V.read_native_price
    V.read_native_price = fake
    V._native_cache.clear()
    V._native_failed.clear()
    try:
        a = asyncio.run(V.native_prices(["ETH", "BNB"]))
        b = asyncio.run(V.native_prices(["ETH", "BNB"]))
        check(a.get("ETH", {}).get("usd") == 2500.0 and "BNB" not in a and b.get("ETH") and "BNB" not in b,
              "NATIVE ETH priced; BNB, whose read failed, has no price")
        check(calls == ["ETH", "BNB"], f"NATIVE one read per coin: cached, and the failure not retried at once ({calls})")
        with V._native_lock:
            t, p = V._native_cache["ETH"]
            V._native_cache["ETH"] = (t - V.NATIVE_MAX_AGE_SECONDS - 1, p)
            V._native_failed["ETH"] = time.monotonic()  # and no refresh allowed right now
        c = asyncio.run(V.native_prices(["ETH"]))
        check("ETH" not in c, "NATIVE a price older than NATIVE_MAX_AGE_SECONDS is not used")
    finally:
        V.read_native_price = orig
        V._native_cache.clear()
        V._native_failed.clear()


def thread_checks() -> None:
    import threading
    ended = threading.Event()

    def slow_read(wallet, *, deadline_s=H.DEADLINE_S):
        time.sleep(0.8)
        ended.set()
        return {"wallet": wallet, "status": "read", "holdings": [], "tokens": [], "chains": [], "coverage": {}}

    orig_read, orig_deadline = H.wallet_holdings, H.DEADLINE_S
    H.wallet_holdings, H.DEADLINE_S = slow_read, -1.2  # the caller gives up after 0.3 s
    V._started.clear()
    w = "0x" + "ab" * 20

    async def go():
        try:
            await V.read(w)
            check(False, "THREAD the caller times out")
        except asyncio.TimeoutError:
            check(True, "THREAD the caller stops waiting at the deadline")
        check(V._running == 1 and not ended.is_set(), "THREAD the slot stays held while the thread still runs")
        for _ in range(40):
            if ended.is_set() and V._running == 0:
                break
            await asyncio.sleep(0.05)
        await asyncio.sleep(0.05)
        check(V._running == 0, "THREAD the slot is freed when the thread ends")
        check(H.cached_answer(w) is not None, "THREAD the late answer is cached for the next request")
    try:
        asyncio.run(go())
    finally:
        H.wallet_holdings, H.DEADLINE_S = orig_read, orig_deadline
        V._started.clear()
        with H._cache_lock:
            H._cache.clear()


def mcp_checks() -> None:
    """The MCP tool reads the same function: its method string is main's, and
    a token call that returned nothing does not make its answer partial."""
    from mcp_server import tools
    v0 = H.versions_on_buy_chains()[1][0]["address"].lower()
    for silent, want in (({1: {MULTICALL3}}, False), ({1: {v0}}, True)):
        h = run_read(silent=silent)
        with H._cache_lock:
            H._cache[OWNER.lower()] = (time.monotonic(), h)
        try:
            out = asyncio.run(tools.wallet_holdings({}, {"wallet": OWNER}))
        finally:
            with H._cache_lock:
                H._cache.clear()
        text = json.dumps(out)
        cov = out.get("coverage") or {}
        check(cov.get("partial") is want and "tokens_scope" not in text and H.VERSIONS_METHOD in text
              and "getEthBalance" not in text,
              f"MCP {'a version' if want else 'only a token'} unanswered: partial {want}, main's method, no token fields")
    b = V.shape(run_read(held={(56, MULTICALL3): 10 ** 18}), {}, True,
                native={"BNB": {**ETH_PRICE, "usd": 700.0, "source": "PancakeSwap v3 WBNB/USDT, BNB Chain (core/bnb_usd.py)"}})
    bnb = next(r for r in b["tokens"] if r["symbol"] == "BNB")
    check(bnb["price"]["pool_label"] == "PancakeSwap v3 WBNB/USDT, BNB Chain",
          f"TOKENS the pool label carries no internal file name ({bnb['price']['pool_label']})")


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
    for t in body["tokens"]:
        print(f"      token {t['chain']} {t['symbol']} {t['balance']} value {t['value_usd']} {t['value_reason'] or ''}")
    usdc = next((t for t in body["tokens"] if t["chain_id"] == 8453 and t["symbol"] == "USDC"), None)
    check(usdc is not None and float(usdc["balance"]) > 0 and usdc["value_usd"] == round(float(usdc["balance"]), 4),
          f"LIVE USDC on Base read and valued at $1 ({usdc and usdc['balance']})")
    t0 = time.monotonic()
    prices = asyncio.run(V.native_prices(["ETH", "BNB", "HYPE"]))
    print(f"      own-coin prices in {time.monotonic() - t0:.1f} s: "
          + ", ".join(f"{k} {v['usd']:.2f} ({v['source']}, block {v['block']})" for k, v in prices.items()))
    check(set(prices) == {"ETH", "BNB", "HYPE"} and all(v["usd"] > 0 for v in prices.values()),
          "LIVE the three own-coin prices read on chain")


def main() -> int:
    body_checks()
    read_checks()
    type_checks()
    failed_checks()
    price_checks()
    gate_checks()
    token_checks()
    coverage_checks()
    native_checks()
    thread_checks()
    mcp_checks()
    route_checks()
    if "--live" in sys.argv:
        live_check()
    print(f"\n{len(FAILURES)} failure(s)" if FAILURES else "\nall checks passed")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
