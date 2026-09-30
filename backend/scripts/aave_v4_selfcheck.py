"""
aave_v4_selfcheck.py

Checks core/te/aave_v4.py: the reads of Aave V4 on Base, the decoding, the
cache, and where the answer is served (/api/te/underlying, /api/te/aave-v4,
the MCP tokenized_equities records).

    TE_COST_STORE=file:<dir> ./venv/bin/python scripts/aave_v4_selfcheck.py [--live] [--record]

Offline by default: every Multicall3 answer is replayed from
data/te/aave_v4_recorded.json, raw results captured from a live read of
Base (the block is in the file), so the decoding is checked on real answers
with no network. --record captures a new file from a live read; --live runs
the checks on a live read instead and prints the snapshot.

1. Decoding: the seven reserves the address book and the activation spec
   name, with their collateral factors and add caps as the spec's tables
   give them; SNDKc, MSTRc and SPCXc not listed; USDC borrowable, not
   collateral, with its caps; the reserves enumerated, not fixed; the book's
   oracle and rate strategy match the chain's.
2. The APR: the drawn rate equals the strategy's own formula at the
   strategy's own usage ratio, drawn / (liquidity + drawn + swept).
3. The cache: a caller never waits on a read; one read at a time on one
   dedicated thread; not read yet is said as such; a failed read keeps the
   last good snapshot, stale, and the next waits out a backoff (60 s,
   doubling, reset on success); a simulated five-minute outage starts at
   most four reads on at most one thread; a hung read stops itself at its
   deadline; never a zero for a missing read; switched off says off.
4. Where it is served: aave_v4 on every Base version of /api/te/underlying
   and null elsewhere, the USDC borrow block beside it; /api/te/aave-v4;
   the MCP records (underlying/<T>, a Base key, aave_v4/base) under their
   ceilings.

Exit status 0 only when every check passes.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

if not os.environ.get("TE_COST_STORE", "").startswith("file:"):
    print("TE_COST_STORE=file:<dir> is required: this check never reads the database.")
    raise SystemExit(2)

from core.te import aave_v4 as A  # noqa: E402

LIVE = "--live" in sys.argv
RECORD = "--record" in sys.argv
FIXTURE = ROOT / "data" / "te" / "aave_v4_recorded.json"
FAILURES: list[str] = []
LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(LOOP)

# The activation spec's tables (aave-proposals-v3 PR #79, AaveV4BaseActivation.md):
# collateral factor in bps, MAG7 add cap in whole tokens.
SPEC = {"AAPLc": (7800, 15000), "AMZNc": (7300, 10500), "GOOGLc": (7600, 15000), "METAc": (6500, 5800),
        "MSFTc": (7900, 5200), "NVDAc": (7000, 24000), "TSLAc": (6500, 14000)}
NOT_LISTED = {"SNDKc", "MSTRc", "SPCXc"}
NVDA_BASE = "8453/0xb20000000000000000000078ee7ce2fe4908108c"


def run(coro):
    return LOOP.run_until_complete(coro)


def check(ok, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
    if not ok:
        FAILURES.append(label)


class Replay:
    """The chain as recorded: block, header time, and each Multicall3 answer."""

    def __init__(self, rec: dict):
        self.rec = rec
        self.answers = {(to.lower(), data): res for to, data, res in rec["calls"]}
        self.missing: list = []

    def block_number(self):
        return self.rec["block"]

    def call(self, method, params):
        assert method == "eth_getBlockByNumber"
        return {"timestamp": hex(self.rec["block_time"])}

    def close(self):
        pass

    def agg(self, rpc, calls, block):
        out = []
        for to, data in calls:
            k = (to.lower(), data.hex())
            if k not in self.answers:
                self.missing.append(k)
            r = self.answers.get(k)
            out.append(bytes.fromhex(r) if r else None)
        return out


def record() -> dict:
    """A live read, keeping every Multicall3 call and answer."""
    from core.te.chains import rpc_for
    rpc = rpc_for(A.CHAIN_ID)
    calls = []
    orig = A._agg

    def rec_agg(r, cs, block):
        res = orig(r, cs, block)
        calls.extend([to.lower(), data.hex(), x.hex() if x else None] for (to, data), x in zip(cs, res))
        return res
    A._agg = rec_agg
    try:
        snap = A._read(rpc)
    finally:
        A._agg = orig
        rpc.close()
    import calendar
    return {"block": snap["block"], "block_time": calendar.timegm(time.strptime(snap["block_time"], "%Y-%m-%dT%H:%M:%SZ")),
            "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "how": "scripts/aave_v4_selfcheck.py --record: every Multicall3 call of one aave_v4 read, with its raw "
                   "return data, on public Base endpoints",
            "calls": calls}


def replay_snapshot(rec: dict) -> dict:
    rp = Replay(rec)
    orig = A._agg
    A._agg = rp.agg
    try:
        snap = A._read(rp)
    finally:
        A._agg = orig
    check(not rp.missing, "every call of the read has a recorded answer", f"{len(rp.missing)} missing")
    return snap


def check_decoding(snap: dict, exact: bool) -> None:
    print("\ndecoding" + (" (recorded answers)" if exact else " (live)"))
    rs = {r["symbol"]: r for r in snap["reserves"]}
    check(len(snap["reserves"]) >= 8, "the reserves are enumerated from the spoke", f"{len(snap['reserves'])} reserves")
    for sym, (cf, cap) in SPEC.items():
        r = rs.get(sym)
        if not r:
            check(False, f"{sym} is a reserve")
            continue
        ok = (r["key"] and r["collateral"] and not r["borrowable"] and r["collateral_only"]
              and r["max_ltv_bps"] == r["liquidation_threshold_bps"] == r["collateral_factor_bps"])
        if exact:
            ok = ok and r["collateral_factor_bps"] == cf and r["add_cap_tokens"] == cap
        check(ok, f"{sym}: collateral only, one factor served as max LTV and threshold"
              + (f", {cf / 100:.0f}% and cap {cap:,} as the spec's tables" if exact else ""),
              f"cf {r['collateral_factor_bps']}, cap {r['add_cap_tokens']}, supplied {r['supplied_tokens']}")
    nl = {v["symbol"] for v in snap["by_key"].values() if v.get("listed") is False}
    check(nl == NOT_LISTED if exact else NOT_LISTED <= nl | {r["symbol"] for r in snap["reserves"]},
          "SNDKc, MSTRc and SPCXc are not listed (isUnderlyingListed false)", ", ".join(sorted(nl)))
    u = snap["usdc_borrow"] or {}
    check(u.get("borrowable") and rs.get("USDC", {}).get("collateral") is False,
          "USDC is borrowable and not collateral", "")
    if exact:
        check(u.get("draw_cap_tokens") == 21_000_000 and u.get("add_cap_tokens") == 32_000_000,
              "USDC's MAG7 caps: add 32,000,000, draw 21,000,000", "")
    check(snap["oracle_matches_book"] and u.get("ir_strategy_matches_book"),
          "the chain's oracle and rate strategy are the address book's", snap["oracle"])
    ir = u.get("ir_data_bps") or {}
    util = u.get("utilization_pct")
    if ir and util is not None and util <= ir["optimal_usage_ratio"] / 100:
        want = ir["base_drawn_rate"] / 100 + ir["rate_growth_before_optimal"] / 100 * util / (ir["optimal_usage_ratio"] / 100)
        check(abs(want - u["borrow_apr_pct"]) < 1e-3,
              "the drawn rate equals the strategy's formula at the measured utilization",
              f"{u['borrow_apr_pct']}% APR vs {want:.5f}% from {util}% utilization")
    one = A.for_version(NVDA_BASE, {"snapshot": snap, "status": "ok", "age_seconds": 1.0})
    check(one["listed"] and one["max_ltv_pct"] == rs["NVDAc"]["collateral_factor_bps"] / 100 and "one collateral factor" in one["note"],
          "NVDAc's page object: listed, max LTV, the single-factor note", f"max LTV {one['max_ltv_pct']}%")
    check(A.for_version("4663/0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", {"snapshot": snap, "status": "ok"}) is None,
          "a version outside Base has no Aave V4 object (null)")
    words = json.dumps(snap).lower()
    check(" best" not in words and "recommend" not in words and "should" not in words,
          "no recommendation words in the snapshot")
    check("used as collateral" not in json.dumps(snap),
          "the phrase 'used as collateral' appears nowhere in the snapshot", "")
    check(snap["eligibility"]["text"] == ("Coinbase Tokenized Stocks are securities issued by Coinbase and offered "
                                          "under Regulation S only to eligible non-U.S. persons in permitted "
                                          "jurisdictions."), "Aave's eligibility sentence, whole")
    check(snap["oracle_decimals"] == 8, "the oracle's decimals are read (8)", str(snap["oracle_decimals"]))


def _reset() -> None:
    fut = A._state.get("future")
    if fut is not None:
        concurrent_wait(fut, 5)
    A._state.update(snap=None, at=None, error=None, error_at=None, future=None, started=None, failures=0,
                    next_try=0.0)


def _wait_idle(timeout: float = 5.0) -> None:
    fut = A._state.get("future")
    if fut is not None:
        concurrent_wait(fut, timeout)
        time.sleep(0.02)                  # the done callback runs right after


def concurrent_wait(fut, timeout):
    import concurrent.futures
    concurrent.futures.wait([fut], timeout=timeout)


def read_threads() -> int:
    import threading
    return sum(1 for t in threading.enumerate() if t.name.startswith("aave-v4-read") and t.is_alive())


class Clock:
    """A clock the cache reads (time.time) that the test moves, so a
    five-minute outage takes a moment; monotonic and sleep stay real."""

    def __init__(self):
        self.t = time.time()

    def time(self):
        return self.t

    def __getattr__(self, name):
        return getattr(time, name)


def check_cache(snap: dict) -> None:
    print("\nthe cache")
    import threading
    from core.te.rpcclient import RpcError
    _reset()
    gate = threading.Event()
    calls = {"n": 0}
    orig = A._read_with_deadline

    def slow_read():
        calls["n"] += 1
        gate.wait(5)
        return snap
    A._read_with_deadline = slow_read
    try:
        t = time.monotonic()
        first = [A.snapshot() for _ in range(50)]
        took = time.monotonic() - t
        check(all(x["snapshot"] is None and x["status"] == "not_read_yet" for x in first) and took < 0.1,
              "50 callers before the first read: none waits, each told not read yet", f"{took * 1000:.1f} ms for 50")
        check(calls["n"] <= 1 and read_threads() <= 1, "one read in flight, on one dedicated thread",
              f"{calls['n']} read, {read_threads()} thread")
        gate.set()
        _wait_idle()
        third = A.snapshot()
        check(third["status"] == "ok" and third["snapshot"]["block"] == snap["block"],
              "then the snapshot with its age", f"age {third['age_seconds']} s")

        # A failed refresh: the last good snapshot, stale; then a backoff.
        def fail():
            calls["n"] += 1
            raise RpcError("transient", "HTTP 429 rate limited")
        A._read_with_deadline = fail
        A._state["at"] -= A.REFRESH_SECONDS + 1
        n0 = calls["n"]
        A.snapshot()
        _wait_idle()
        stale = A.snapshot()
        check(stale["status"] == "stale" and stale["snapshot"]["block"] == snap["block"]
              and "last good snapshot" in stale["reason"] and "next read is not before" in stale["reason"],
              "a failed read keeps the last good snapshot, stale, and says when the next read may start",
              stale["reason"][:90])
        for _ in range(30):
            A.snapshot()
        check(calls["n"] - n0 == 1 and A._state["next_try"] - A._state["error_at"] == A.BACKOFF_BASE_S,
              "no new read during the 60 s backoff, however many requests", f"{calls['n'] - n0} read for 31 requests")
        v = A.for_version(NVDA_BASE)
        check(v["status"] == "stale" and v["max_ltv_pct"] > 0, "the page object carries the stale status, not zeros")

        # A five-minute outage, every read hanging until its deadline: bounded
        # reads, one thread, backoff doubling.
        clock = Clock()
        A.time = clock
        hung = {"n": 0}

        def hang():
            hung["n"] += 1
            time.sleep(0.05)               # stands for a read stopped by its deadline
            raise RpcError("deadline", "the job's deadline passed")
        A._read_with_deadline = hang
        _reset()
        A._state.update(snap=snap, at=clock.t - A.REFRESH_SECONDS - 1)
        max_threads, starts = 0, []
        for step in range(31):             # every 10 s for 300 s
            before = hung["n"]
            A.snapshot()
            _wait_idle(1)
            max_threads = max(max_threads, read_threads())
            if hung["n"] > before:
                starts.append(step * 10)
            clock.t += 10
        gaps = [b - a for a, b in zip(starts, starts[1:])]
        check(max_threads <= 1 and len(starts) <= 4 and all(g >= 60 for g in gaps),
              "a five-minute outage: at most one read thread, reads backing off 60, 120, 240 s",
              f"reads at t={starts} s, {max_threads} thread at most")
        A.time = time

        # Recovery resets the backoff.
        A._read_with_deadline = lambda: snap
        A._state["next_try"] = 0.0
        A.snapshot()
        _wait_idle()
        ok = A.snapshot()
        check(ok["status"] == "ok" and A._state["failures"] == 0 and A._state["next_try"] == 0.0,
              "a successful read resets the backoff", "")
    finally:
        A._read_with_deadline = orig
        A.time = time
    os.environ["AAVE_V4_READS"] = "0"
    check(A.snapshot()["status"] == "off", "AAVE_V4_READS=0 switches the reads off, and says so")
    os.environ.pop("AAVE_V4_READS")


def check_deadline() -> None:
    """Every Base endpoint hangs: the read's own deadline stops its thread."""
    print("\nthe read's deadline, with every Base endpoint hanging")
    import httpx
    orig_post, orig_deadline = httpx.Client.post, A.READ_DEADLINE_S

    def hang(self, url, *a, **k):
        time.sleep(min(float(k.get("timeout") or 30), 30))
        raise httpx.ConnectTimeout("hung", request=httpx.Request("POST", url))
    httpx.Client.post = hang
    A.READ_DEADLINE_S = 3.0
    t = time.monotonic()
    try:
        A._read_with_deadline()
        check(False, "a hung read stops at its deadline")
    except Exception as e:  # noqa: BLE001
        took = time.monotonic() - t
        check(took < A.READ_DEADLINE_S + 2, "a hung read stops itself at its deadline, not the RPC timeouts",
              f"{type(e).__name__} after {took:.1f} s with a {A.READ_DEADLINE_S:.0f} s deadline")
    finally:
        httpx.Client.post, A.READ_DEADLINE_S = orig_post, orig_deadline


def check_served(snap: dict) -> None:
    print("\nwhere it is served")
    _reset()
    A._state.update(snap=snap, at=time.time())
    from core.te.cost_store import get_store
    from core.te.cost_views import underlying_view
    st, body = run(underlying_view(get_store(), "NVDA", 1000))
    base = [v for v in body["versions"] if v["chain_id"] == 8453]
    other = [v for v in body["versions"] if v["chain_id"] != 8453]
    check(st == 200 and base and all(v["aave_v4"]["listed"] for v in base) and all(v["aave_v4"] is None for v in other),
          "/api/te/underlying/NVDA: aave_v4 on the Base version, null on the others",
          f"{base[0]['aave_v4']['max_ltv_pct']}% max LTV at block {base[0]['aave_v4']['block']}" if base else "")
    check((body.get("aave_v4_usdc_borrow") or {}).get("borrow_apr_pct") is not None,
          "the USDC borrow block beside it", str((body.get("aave_v4_usdc_borrow") or {}).get("borrow_apr_pct")))
    # Any stock in this store with no Base version (which ones exist depends
    # on the store the check runs against).
    nobase = None
    for t in ("TSM", "SPY", "QQQ", "GLD", "AMD", "COIN", "NFLX", "PLTR", "HOOD", "IVV", "VOO", "AVGO"):
        st, body = run(underlying_view(get_store(), t, 1000))
        if st == 200 and body.get("versions") and all(v["chain_id"] != 8453 for v in body["versions"]):
            nobase = (t, body)
            break
    if nobase is None:
        print("  --  a stock with no Base version: none of the candidates is in this store; not checked")
    else:
        t, body = nobase
        check("aave_v4_usdc_borrow" not in body and all(v["aave_v4"] is None for v in body["versions"]),
              f"a stock with no Base version ({t}): no Aave block at all")

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from te.router import router
    app = FastAPI()
    app.include_router(router)
    c = TestClient(app)
    r = c.get("/api/te/aave-v4")
    check(r.status_code == 200 and r.json()["snapshot"]["block"] == snap["block"], "/api/te/aave-v4 answers the snapshot",
          f"{len(r.content):,} bytes")
    A._state.update(snap=None, at=None)
    kick = A._kick
    A._kick = lambda: None
    r = c.get("/api/te/aave-v4")
    check(r.status_code == 503 and r.json()["error"] == "not_read_yet", "/api/te/aave-v4 before a read: 503 with the reason")
    A._kick = kick
    A._state.update(snap=snap, at=time.time())

    from mcp_server import envelope, protocol
    from mcp_server.te_datasets import build_te
    ds = {d.id: d for d in build_te()}

    def get(key):
        r = run(protocol.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                 "params": {"name": "tnega_get", "arguments": {"dataset": "tokenized_equities",
                                                                               "id": key}}}, ds))
        t = r["result"]["content"][0]["text"]
        return json.loads(t), len(t.encode())
    out, n = get("aave_v4/base")
    val = out.get("value") or {}
    rows = [dict(zip(val.get("columns") or [], r)) for r in val.get("versions") or []]
    can = sorted(r["symbol"] for r in rows if r.get("collateral"))
    check(n <= envelope.CEILINGS["tnega_get"] and len(can) == 7 and out["value"]["usdc_borrow"]["borrow_apr_pct"] is not None,
          "tnega_get aave_v4/base answers which versions can be borrowed against, under its ceiling",
          f"{n:,} bytes: {', '.join(can)}")
    out, n = get("underlying/NVDA")
    vs = {v["key"]: v for v in (out.get("value") or {}).get("versions") or []}
    check(n <= envelope.CEILINGS["tnega_get"] and vs.get(NVDA_BASE, {}).get("aave_v4_collateral") is True
          and vs[NVDA_BASE].get("aave_v4_max_ltv_pct") == 70.0 and (out["value"].get("aave_v4") or {}).get("usdc_borrow_apr_pct") is not None,
          "tnega_get underlying/NVDA: Aave fields on the Base version, the USDC APR beside", f"{n:,} bytes")
    out, n = get(NVDA_BASE)
    check(n <= envelope.CEILINGS["tnega_get"] and (out.get("value") or {}).get("aave_v4", {}).get("listed") is True,
          "tnega_get on the Base key carries aave_v4", f"{n:,} bytes")


def main() -> int:
    if RECORD:
        rec = record()
        FIXTURE.write_text(json.dumps(rec, indent=0))
        print(f"recorded {len(rec['calls'])} calls at block {rec['block']} into {FIXTURE}")
    if LIVE:
        t = time.monotonic()
        snap = A.read()
        print(f"live read: block {snap['block']} ({snap['block_time']}) in {time.monotonic() - t:.1f} s")
        check_decoding(snap, exact=False)
        print("\nlive snapshot")
        for r in snap["reserves"]:
            print(f"  {r['symbol']:7} {str(r['key'] or '')[:22]:22} factor {r['collateral_factor_bps'] / 100:5.1f}%  "
                  f"supplied {r['supplied_tokens']:>18} of cap {r['add_cap_tokens']!s:>10}  price "
                  f"{r['oracle_price_usd']}  borrowable {r['borrowable']}")
        for v in snap["by_key"].values():
            if v.get("listed") is False:
                print(f"  {v['symbol']:7} not listed: {v['reason']}")
        u = snap["usdc_borrow"]
        print(f"  USDC borrow {u['borrow_apr_pct']}% APR, utilization {u['utilization_pct']}%, owed "
              f"{u['total_owed_tokens']}, available {u['available_liquidity_tokens']}")
    else:
        rec = json.loads(FIXTURE.read_text())
        print(f"replaying {len(rec['calls'])} recorded calls, block {rec['block']} (recorded {rec['recorded_at']})")
        snap = replay_snapshot(rec)
        check_decoding(snap, exact=True)
    check_cache(snap)
    check_deadline()
    check_served(snap)
    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: " + "; ".join(FAILURES))
        return 1
    print("all passed" + ("" if LIVE else " (offline, recorded answers; --live reads Base)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
