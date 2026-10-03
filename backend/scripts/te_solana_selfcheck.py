"""
te_solana_selfcheck.py

Checks the Solana cost measurement and the Solana order path, offline.

    ./venv/bin/python scripts/te_solana_selfcheck.py

EVERY JUPITER ANSWER AND EVERY SOLANA RPC ANSWER IN THIS FILE IS CONSTRUCTED,
from the response format Jupiter documents for GET /swap/v1/quote
(inputMint, inAmount, outputMint, outAmount, otherAmountThreshold, swapMode,
slippageBps, priceImpactPct, routePlan[].swapInfo, contextSlot) and its error
body ({"error", "errorCode"}), and from the jsonParsed shape of a Token-2022
mint with a scaledUiAmountConfig extension. None of it was measured: the
prices, impacts and multipliers below are made up so that the arithmetic and
the states can be checked, and no check asserts that a real answer looks like
them. What stays untested until the code meets Jupiter is in the report that
came with the change (unit and meaning of priceImpactPct, the exact error
codes, rate limits, the RPC's jsonParsed output).

What is checked:
  1. The client: URL (JUPITER_API_URL), spacing between calls, retries on 429
     (Retry-After) and 5xx and timeouts, no_route, refusals, answers that do
     not match the question.
  2. The arithmetic: paid price, mid, cost, depth proxy, shares per token,
     and the states (too_thin, an impact of 0 is a failure, never a zero).
  3. The multiplier read: in force, pending, within 15 minutes (held), Ondo
     not read, a failed read.
  4. A worker pass over constructed answers into a file store, a transient
     failure keeping the previous document, and the views and MCP dataset that
     read it.
  5. The signing link for Solana, and that an EVM link is unchanged.
  6. Orders: a buy and a sale prepared against constructed answers, every
     refusal, GET /api/sign/{id} and POST /done for a Solana link.

Exit status 0 only when every check passes.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

_TMP = tempfile.mkdtemp(prefix="te-solana-selfcheck-")
os.environ["TE_COST_STORE"] = f"file:{_TMP}"
os.environ["SIGN_LINK_SECRET"] = "te-solana-selfcheck-only"
os.environ.pop("JUPITER_API_URL", None)
os.environ.pop("JUPITER_PRICE_IMPACT_UNIT", None)
os.environ["JUPITER_MIN_INTERVAL_S"] = "1.1"

import httpx  # noqa: E402

from core.te import cost_store, cost_views, prepare as P, prepare_solana as PS, sign_link as S, solana_cost as SC  # noqa: E402
from core.te.cost_inputs import solana_records  # noqa: E402
from core.te.cost_worker import run_solana_cycle, write_list  # noqa: E402

FAILURES: list[str] = []
LOOP = asyncio.new_event_loop()


def run(coro):
    return LOOP.run_until_complete(coro)


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
    if not ok:
        FAILURES.append(label)


# ── constructed stand-ins ────────────────────────────────────────────────────

WALLET = "So11111111111111111111111111111111111111112"          # a valid 32-byte address, used as a stand-in wallet
EVM_WALLET = "0x000000000000000000000000000000000000dead"
SLOT = 123_456_789
PRICE = 200.0                      # CONSTRUCTED dollars per token
IMPACT = {1000: "0.0010", 10000: "0.0100"}     # CONSTRUCTED price impact, as fractions


class Clock:
    def __init__(self):
        self.t = 1000.0
        self.slept: list[float] = []

    def now(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.slept.append(s)
        self.t += s


def constructed_quote(params: dict, *, price=PRICE, impact=None, dec=8, route="Raydium CLMM", mid_out=None) -> dict:
    """A body in Jupiter's documented format. CONSTRUCTED."""
    buy = params["inputMint"] == SC.USDC_MINT
    amt = int(params["amount"])
    slip = int(params["slippageBps"])
    if buy:
        usd = amt / 1e6
        out = int(usd / price * 10 ** dec)
        imp = impact or IMPACT[min(IMPACT, key=lambda s: abs(s - usd))]
    else:
        tokens = amt / 10 ** dec
        imp = impact or "0.0010"
        out = int(tokens * price * 1e6)
    return {"inputMint": params["inputMint"], "inAmount": params["amount"], "outputMint": params["outputMint"],
            "outAmount": str(out), "otherAmountThreshold": str(out * (10000 - slip) // 10000), "swapMode": "ExactIn",
            "slippageBps": slip, "platformFee": None, "priceImpactPct": imp,
            "routePlan": [{"swapInfo": {"ammKey": "Amm1111111111111111111111111111111111111111", "label": route,
                                        "inputMint": params["inputMint"], "outputMint": params["outputMint"],
                                        "inAmount": params["amount"], "outAmount": str(out), "feeAmount": "0",
                                        "feeMint": SC.USDC_MINT}, "percent": 100}],
            "contextSlot": SLOT, "timeTaken": 0.01}


def make_client(responder=None, **kw) -> tuple[SC.JupiterClient, SC.FixtureFetch, Clock]:
    clk = Clock()
    fetch = SC.FixtureFetch(default=responder or (lambda p: {"status": 200, "body": constructed_quote(p)}))
    c = SC.JupiterClient(fetch=fetch, sleep=clk.sleep, clock=clk.now, **kw)
    return c, fetch, clk


def mult_account(mult=1.0, new=None, new_at=0, program="Token-2022"):
    ext = [{"extension": "scaledUiAmountConfig", "state": {
        "authority": None, "multiplier": str(mult), "newMultiplier": str(new if new is not None else mult),
        "newMultiplierEffectiveTimestamp": new_at}}]
    return {"data": {"program": "spl-token-2022", "parsed": {"info": {"decimals": 8, "extensions": ext}, "type": "mint"}}}


class FakeRpc:
    def __init__(self):
        self.mult: dict[str, dict] = {}          # mint -> account
        self.balances: dict[tuple, int] = {}     # (wallet, mint) -> raw
        self.fail = False
        self.calls: list[str] = []

    def __call__(self, method, params):
        self.calls.append(method)
        if self.fail:
            raise RuntimeError("429")
        if method == "getMultipleAccounts":
            return {"context": {"slot": SLOT}, "value": [self.mult.get(m) for m in params[0]]}
        if method == "getTokenAccountsByOwner":
            w, mint = params[0], params[1]["mint"]
            raw = self.balances.get((w, mint))
            vals = [] if raw is None else [{"account": {"data": {"parsed": {"info": {"tokenAmount": {"amount": str(raw)}}}}}}]
            return {"context": {"slot": SLOT}, "value": vals}
        raise AssertionError(method)


# ── 1. the client ────────────────────────────────────────────────────────────

def check_client() -> None:
    print("\n1. the client (constructed answers)")
    c, fetch, clk = make_client()
    r = c.quote(SC.USDC_MINT, "MintA", 1_000_000_000)
    check(r["ok"], "a well-formed constructed answer is used")
    c2, f2, _ = make_client(lambda p: {"status": 200, "body": {**constructed_quote(p), "outputMint": "SomethingElse"}})
    r2 = c2.quote(SC.USDC_MINT, "MintA", 1_000_000_000)
    check((not r2["ok"]) and r2["kind"] == "bad_response", "a 200 for other mints than asked is refused", str(r2.get("reason"))[:70])
    check(fetch.calls[0]["url"] == "https://lite-api.jup.ag/swap/v1/quote", "default endpoint is the free lite API",
          fetch.calls[0]["url"])
    os.environ["JUPITER_API_URL"] = "https://example.invalid/jup/v1/"
    c, fetch, clk = make_client()
    mint = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"
    r = c.quote(SC.USDC_MINT, mint, 1_000_000_000)
    check(r["ok"] and fetch.calls[0]["url"] == "https://example.invalid/jup/v1/quote", "JUPITER_API_URL is used",
          fetch.calls[0]["url"])
    check(fetch.calls[0]["swapMode"] == "ExactIn" and fetch.calls[0]["amount"] == "1000000000", "the request is exact-in, amount raw")
    del os.environ["JUPITER_API_URL"]

    c, fetch, clk = make_client()
    for _ in range(3):
        c.quote(SC.USDC_MINT, mint, 1_000_000_000)
    check(len(clk.slept) == 2 and all(abs(s - 1.1) < 1e-6 for s in clk.slept), "calls are spaced by the minimum interval",
          f"waits {[round(s, 2) for s in clk.slept]}")

    seq = iter([{"status": 429, "body": {"error": "rate"}, "retry_after": 3.0}, {"status": 503, "body": None}, "ok"])

    def flaky(p):
        x = next(seq)
        return {"status": 200, "body": constructed_quote(p)} if x == "ok" else x
    c, fetch, clk = make_client(flaky)
    r = c.quote(SC.USDC_MINT, mint, 1_000_000_000)
    check(r["ok"] and c.stats["retries"] == 2 and 3.0 in clk.slept, "429 (Retry-After honoured) then 503 then 200 succeeds",
          f"retries {c.stats['retries']}, slept {[round(s, 1) for s in clk.slept]}")
    c, fetch, clk = make_client(lambda p: {"status": 429, "body": {"error": "rate"}})
    r = c.quote(SC.USDC_MINT, mint, 1_000_000_000)
    check((not r["ok"]) and r["kind"] == "rate_limited" and len(fetch.calls) == SC.RETRIES + 1,
          "429 forever gives rate_limited after the retries", f"{r.get('kind')}, {len(fetch.calls)} calls")
    c, fetch, clk = make_client(lambda p: httpx.ReadTimeout("t"))
    r = c.quote(SC.USDC_MINT, mint, 1_000_000_000)
    check((not r["ok"]) and r["kind"] == "unavailable" and "within" in r["reason"], "a timeout gives unavailable", r.get("reason", "")[:60])
    c, fetch, clk = make_client(lambda p: {"status": 400, "body": {"error": "Could not find any route", "errorCode": "COULD_NOT_FIND_ANY_ROUTE"}})
    r = c.quote(SC.USDC_MINT, mint, 1_000_000_000)
    check((not r["ok"]) and r["kind"] == "no_route" and len(fetch.calls) == 1, "COULD_NOT_FIND_ANY_ROUTE is no_route, not retried")
    c, fetch, clk = make_client(lambda p: {"status": 400, "body": {"error": "The token is not tradable", "errorCode": "TOKEN_NOT_TRADABLE"}})
    check(c.quote(SC.USDC_MINT, mint, 1_000_000_000)["kind"] == "no_route", "TOKEN_NOT_TRADABLE is no_route")
    c, fetch, clk = make_client(lambda p: {"status": 400, "body": {"error": "Invalid amount"}})
    check(c.quote(SC.USDC_MINT, mint, 1_000_000_000)["kind"] == "refused", "another 400 is refused, with Jupiter's words")
    for label, mut in (("no priceImpactPct", lambda b: b.pop("priceImpactPct")),
                       ("outAmount 0", lambda b: b.update(outAmount="0")),
                       ("another inAmount", lambda b: b.update(inAmount="5")),
                       ("a non-numeric impact", lambda b: b.update(priceImpactPct="abc"))):
        def resp(p, mut=mut):
            b = constructed_quote(p)
            mut(b)
            return {"status": 200, "body": b}
        c, fetch, clk = make_client(resp)
        r = c.quote(SC.USDC_MINT, mint, 1_000_000_000)
        check((not r["ok"]) and r["kind"] == "bad_response", f"an answer with {label} is not used")


# ── 2. the arithmetic and the states ─────────────────────────────────────────

def check_arithmetic() -> None:
    print("\n2. the arithmetic and the states (constructed numbers)")
    mint = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"
    c, fetch, clk = make_client()
    r = SC.quote_buy(c, mint, 8, 1000.0)
    tokens = 1000 / PRICE
    check(r["kind"] == "filled" and abs(r["tokens"] - tokens) < 1e-6, "tokens out = size / constructed price", f"{r.get('tokens')}")
    check(abs(r["paid_per_token"] - PRICE) < 1e-3, "paid_per_token = size / tokens out")
    check(abs(r["mid_usd"] - PRICE / 1.001) < 1e-3, "mid = paid / (1 + impact)", f"{r['mid_usd']:.4f}")
    check(abs(r["cost_usd"] - (1000 - r["tokens"] * r["mid_usd"])) < 1e-9 and r["cost_usd"] > 0, "cost = size - tokens x mid, above zero")
    check(abs(r["cost_bps"] - 0.001 / 1.001 * 1e4) < 1e-6, "cost_bps = impact / (1 + impact)", f"{r['cost_bps']:.4f}")
    check(abs(r["depth_proxy_usd"] - 1000 * 0.02 / 0.001) < 1e-6, "depth proxy = size x 2% / impact (linear), $20,000", f"{r['depth_proxy_usd']}")
    check(r["min_out_raw"] == int(r["out_raw"] * 0.995), "minimum out is Jupiter's otherAmountThreshold")

    os.environ["JUPITER_PRICE_IMPACT_UNIT"] = "percent"
    c, *_ = make_client()
    r2 = SC.quote_buy(c, mint, 8, 1000.0)
    del os.environ["JUPITER_PRICE_IMPACT_UNIT"]
    check(abs(r2["impact"] - 0.00001) < 1e-12, "JUPITER_PRICE_IMPACT_UNIT=percent reads the same text as percent")

    c, *_ = make_client(lambda p: {"status": 200, "body": constructed_quote(p, impact="0")})
    r = SC.quote_buy(c, mint, 8, 1000.0)
    check(r["kind"] == "failed" and "not served as a free one" in r["reason"], "an impact of exactly 0 is a failure to measure, not a free trade")
    c, *_ = make_client(lambda p: {"status": 200, "body": constructed_quote(p, impact="-0.001")})
    check(SC.quote_buy(c, mint, 8, 1000.0)["kind"] == "failed", "a negative impact is a failure to measure")
    c, *_ = make_client(lambda p: {"status": 200, "body": constructed_quote(p, impact="0.35")})
    r = SC.quote_buy(c, mint, 8, 1000.0)
    check(r["kind"] == "too_thin" and "35.0%" in r["reason"], "an impact over 10% is too_thin with the reason", r["reason"][:70])

    rec = next(r for r in solana_records()[0] if r["address"] == mint)
    ratio = {"ratio": 1.02, "basis": "constructed", "comparable": True, "hold": False}
    res = {1000: SC.quote_buy(make_client()[0], mint, 8, 1000.0), 10000: SC.quote_buy(make_client()[0], mint, 8, 10000.0)}
    doc = SC.version_doc(rec, res, ratio, 1_700_000_000.0)
    i1, i10 = SC.SIZES.index(1000), SC.SIZES.index(10000)
    check(doc["state"] == "measured" and doc["status"][i1] == doc["status"][i10] == "filled", "a version with both sizes is measured")
    check(doc["status"].count("not_measured") == len(SC.SIZES) - 2 and doc["cost_bps"][SC.SIZES.index(100)] is None,
          "the other nine sizes are not_measured, with no figure")
    check(abs(doc["allin_per_share"][i1] - doc["allin_per_token"][i1] / 1.02) < 1e-5, "allin_per_share = allin_per_token / shares_per_token")
    check(doc["cost_bps"][i10] > doc["cost_bps"][i1] > 0, "cost grows with size, and is never zero")
    check(doc["pool_usd"] == doc["depth_proxy_usd"][i10] and not doc.get("ref_mid_usd"), "pool_usd is the $10,000 depth proxy; no reference mid is set")
    check(all(doc["chain_id"] is None and doc["group"] == "nonevm" and doc["venue"] == "jupiter" for _ in [0]), "chain_id None, group nonevm, venue jupiter")
    c1 = cost_views._cell(doc, 1000)
    c100 = cost_views._cell(doc, 100)
    check(c1["state"] == "filled" and c1["cost_parts"]["lifi_fee_usd"] == 0.0 and c1["cost_parts"]["gas_usd"] is None,
          "the cell has no LI.FI fee and no gas figure (null, not 0)")
    check(c100["state"] == "not_measured" and c100["cost_bps"] is None and "$1,000 and $10,000" in c100["reason"], "an unmeasured size says so")

    nr = SC.version_doc(rec, {1000: {"kind": "no_route", "reason": "Jupiter found no route (COULD_NOT_FIND_ANY_ROUTE)"}}, ratio, 1.7e9)
    check(nr["state"] == "no_route" and "COULD_NOT_FIND_ANY_ROUTE" in nr["reason"], "no route at $1,000 gives state no_route with the reason")
    check(cost_views._cell(nr, 1000)["state"] == "no_route" and cost_views._cell(nr, 1000)["cost_bps"] is None, "no_route has no cost")
    th = SC.version_doc(rec, {1000: SC.quote_buy(make_client(lambda p: {"status": 200, "body": constructed_quote(p, impact="0.35")})[0], mint, 8, 1000.0)}, ratio, 1.7e9)
    check(th["state"] == "too_thin" and th["pool_usd"] and "proxy" in th["pool_usd_basis"], "too thin at $1,000 gives too_thin with a labelled depth proxy")
    held = SC.version_doc(rec, {}, {"hold": True, "hold_reason": "a multiplier change ... no quote"}, 1.7e9)
    check(held["state"] == "held", "a held multiplier gives state held")
    part = SC.version_doc(rec, {1000: res[1000], 10000: {"kind": "too_thin", "reason": "x", "depth_proxy_usd": 5000.0}}, ratio, 1.7e9)
    check(part["state"] == "measured" and cost_views._cell(part, 10000)["state"] == "too_thin", "$1,000 filled and $10,000 too thin: measured, with the larger size too_thin")

    c, *_ = make_client(lambda p: {"status": 429, "body": {}})
    d, note = SC.measure_version(c, rec, ratio, 1.7e9)
    check(d is None and note["outcome"] == "transient", "a rate limit gives no document (the caller keeps the previous one)")
    c, fetch, _ = make_client(lambda p: {"status": 400, "body": {"errorCode": "COULD_NOT_FIND_ANY_ROUTE", "error": "no"}})
    d, note = SC.measure_version(c, rec, ratio, 1.7e9)
    check(d["state"] == "no_route" and len(fetch.calls) == 1, "no route at $1,000: one call, $10,000 not asked")


# ── 3. the multiplier ────────────────────────────────────────────────────────

def check_multipliers() -> None:
    print("\n3. the shares per token (constructed mint accounts)")
    rpc = FakeRpc()
    now = 1_800_000_000
    rpc.mult["A"] = mult_account(1.0)
    rpc.mult["B"] = mult_account(1.0, new=0.5, new_at=now - 3600)          # changed an hour ago: the new one is in force
    rpc.mult["C"] = mult_account(1.0, new=0.5, new_at=now + 600)           # changes in ten minutes: held
    rpc.mult["D"] = mult_account(1.0, new=0.5, new_at=now + 7200)          # changes in two hours: old one in force
    rpc.mult["E"] = {"data": {"parsed": {"info": {"decimals": 8, "extensions": []}}}}
    got = SC.read_multipliers({"A": "xstocks", "B": "xstocks", "C": "xstocks", "D": "xstocks", "E": "xstocks", "F": "xstocks",
                               "O": "ondo"}, rpc, now=now)
    check(got["A"]["ratio"] == 1.0 and got["A"]["comparable"], "multiplier 1.0 is read as 1 share per token")
    check(got["B"]["ratio"] == 0.5, "newMultiplier is in force once its timestamp has passed")
    check(got["D"]["ratio"] == 1.0 and not got["D"]["hold"], "a change two hours ahead does not hold or apply")
    check(got["C"]["hold"] and "within 15 minutes" in got["C"]["hold_reason"], "a change within 15 minutes holds the quote")
    check(got["E"]["ratio"] is None and not got["E"]["comparable"], "a mint without the extension has no ratio read")
    check(got["F"]["ratio"] is None and "not returned" in got["F"]["basis"], "an account not returned has no ratio read")
    check(got["O"]["ratio"] is None and got["O"]["basis"] == "share ratio not read", "Ondo's share ratio is not read, as on EVM")
    check(rpc.calls == ["getMultipleAccounts"], "xStocks mints go in one batched read", str(rpc.calls))
    rpc.fail = True
    got = SC.read_multipliers({"A": "xstocks"}, rpc, now=now)
    check(got["A"]["ratio"] is None and "failed" in got["A"]["basis"], "a failed RPC read gives no ratio, with the reason")


# ── 4. a worker pass, the store, the views, the dataset ──────────────────────

NVDA = None
BEHAVE: dict[str, str] = {}


def fixture_world():
    """Constructed answers for the NVDA Solana versions plus a few others:
    one xStock quotable, one with no route, one that fails transiently."""
    recs, unders = solana_records()
    nvda = [r for r in recs if r["underlying"] == "NVDA"]
    others = [r for r in recs if r["underlying"] != "NVDA" and r["issuer"] == "xstocks"][:3]
    return nvda, others, unders, recs


def responder(p):
    mint = p["outputMint"] if p["inputMint"] == SC.USDC_MINT else p["inputMint"]
    b = BEHAVE.get(mint, "ok")
    if b == "no_route":
        return {"status": 400, "body": {"error": "Could not find any route", "errorCode": "COULD_NOT_FIND_ANY_ROUTE"}}
    if b == "429":
        return {"status": 429, "body": {}}
    dec = 8 if mint != "Ondo" else 9
    from core.te.universe import load_universe
    rec = load_universe().record(f"solana/{mint}", controls=False)
    return {"status": 200, "body": constructed_quote(p, dec=rec["decimals"])}


def check_worker_and_views() -> dict:
    print("\n4. a worker pass over constructed answers, the store, the views and the dataset")
    global NVDA
    nvda, others, unders, recs = fixture_world()
    NVDA = nvda
    xs = next(r for r in nvda if r["issuer"] == "xstocks")
    on = next((r for r in nvda if r["issuer"] == "ondo"), None)
    sel = nvda + others
    BEHAVE.clear()
    if others:
        BEHAVE[others[0]["address"]] = "no_route"
    store = cost_store.get_store()
    inputs = {"records": sel, "underlyings": {k: v for k, v in unders.items() if k in {r["underlying"] for r in sel}},
              "issuers": {}, "tickers_without_measured_pool": [], "source": {}}
    rpc = FakeRpc()
    for r in sel:
        rpc.mult[r["address"]] = mult_account(1.0)
    client, fetch, clk = make_client(responder)
    out = run(run_solana_cycle(store, inputs=inputs, client=client, rpc=rpc, budget_seconds=10_000))
    check(out["attempted"] == len(sel) and out["written"] == len(sel), "a pass attempts and writes every version",
          f"{out['attempted']} attempted, {out['written']} written, {out['by_state']}")
    check(out["by_state"].get("no_route") == (1 if others else 0) and out["by_state"].get("measured", 0) >= 1, "states: measured and no_route")
    docs = {d["key"]: d for d in run(store.all_costs())}
    check(all(k in docs for k in (r["key"] for r in sel)), "every version has a stored document")
    check(docs[xs["key"]]["state"] == "measured" and docs[xs["key"]]["computed_at"].endswith("Z"), "the document carries its measurement time (as_of)")
    meta = run(store.get_meta("chain:solana"))
    check(meta["last_run"]["written"] == len(sel) and "jupiter" in meta["last_run"], "the pass records its counts in te_cost_meta chain:solana")

    # a transient failure keeps the previous document
    before = docs[xs["key"]]["computed_at"]
    BEHAVE[xs["address"]] = "429"
    client2, *_ = make_client(responder)
    out2 = run(run_solana_cycle(store, inputs=inputs, client=client2, rpc=rpc, budget_seconds=10_000, limit=len(sel)))
    again = {d["key"]: d for d in run(store.all_costs())}
    check(out2["kept_previous"] >= 1 and again[xs["key"]]["computed_at"] == before and again[xs["key"]]["state"] == "measured",
          "a rate-limited version keeps its previous document and time", f"kept {out2['kept_previous']}")
    BEHAVE.pop(xs["address"])

    # the views
    cost_views._list_cache.update(t=0.0, doc=None)
    cost_views._snapshot.update(t=-1e9, docs=None, task=None)
    status, body = run(cost_views.underlying_view(store, "NVDA", 1000))
    vs = {v["key"]: v for v in body["versions"]}
    check(status == 200 and vs[xs["key"]]["state"] == "filled" and vs[xs["key"]]["chain"] == "Solana" and vs[xs["key"]]["chain_id"] is None,
          "underlying_view shows the Solana version as filled", f"{status}")
    check(body["best"] and body["best"]["key"] == xs["key"], "the comparable Solana version can be best (lowest all-in per share)")
    if on:
        check(vs[on["key"]]["state"] == "filled" and not vs[on["key"]]["comparable"] and body["best"]["key"] != on["key"],
              "Ondo on Solana is shown, not ranked (share ratio not read)")
    status10, body10 = run(cost_views.underlying_view(store, "NVDA", 10000))
    check({v["key"]: v for v in body10["versions"]}[xs["key"]]["state"] == "filled", "and at $10,000")
    status100, body100 = run(cost_views.underlying_view(store, "NVDA", 100))
    check({v["key"]: v for v in body100["versions"]}[xs["key"]]["state"] == "not_measured", "at $100 the Solana version says not_measured")
    if others:
        t = others[0]["underlying"]
        _, nb = run(cost_views.underlying_view(store, t, 1000))
        v0 = {v["key"]: v for v in nb["versions"]}[others[0]["key"]]
        check(v0["state"] == "no_route" and v0["cost_bps"] is None and v0["reason"] and "Solana" in str(v0["pool_search"]), "a no-route version has its state and reason, no cost",
              v0["reason"][:60])
    cs, curve = run(cost_views.curve_view(store, "NVDA"))
    check(cs == 200 and any(c["chain"] == "Solana" and c["chain_id"] is None for c in curve["chains"]), "curve_view lists Solana (chain_id null)")
    ls, lst = run(cost_views.list_view(store, type_="", group="nonevm", limit=50, sort="cost1k"))
    check(ls == 200 and any(r["underlying"] == "NVDA" and r["best"]["key"] == xs["key"] for r in lst["rows"]) and "Jupiter" in lst["group_note"],
          "list_view group=nonevm ranks the Solana version, and its note says how it is measured")
    ls, lst = run(cost_views.list_view(store, type_="", group="all", limit=50, sort="cost1k"))
    check(ls == 200 and "Solana versions are quoted through Jupiter" in lst["coverage"] and "not measured yet" not in lst["coverage"],
          "the coverage text is the truth")
    docs_all = run(store.all_costs())
    counts = cost_views.count_docs(docs_all)
    sol = next(c for c in counts["by_chain"] if c["chain_name"] == "Solana")
    check(sol["versions_read"] == len(sel) and sol["by_state"].get("quoted", 0) >= 1 and sol["chain_id"] is None
          and "Only EVM" not in counts["definition"], "count_docs counts Solana by state, chain_id null", json.dumps(sol["by_state"]))

    # the MCP dataset
    from mcp_server.te_datasets import build_te
    ds = build_te()[0]
    cov = run(ds.coverage())
    check("Jupiter" in cov["scope"] and "not measured yet" not in cov["scope"], "coverage.scope names Jupiter and no longer says Solana is not measured", cov["scope"][:90])
    rec_ = run(ds.get(xs["key"]))
    check(rec_ and rec_.get("withheld_reason") is None and rec_["chain"] == "solana" and rec_["token_address"] == xs["address"]
          and rec_["cost_to_fill"][0]["state"] == "filled" and rec_["cost_to_fill"][0]["total_cost_bps"] > 0
          and rec_["shares_per_token"] == 1.0 and rec_["measured_at"], "tnega_get solana/<mint> returns the measured record",
          json.dumps({k: rec_.get(k) for k in ("measured_at", "shares_per_token")}))
    check(rec_["cost_to_fill"][0]["pool_depth_2pct_usd"] == 20000 and "proxy" in rec_["cost_to_fill"][0]["pool_depth_basis"]
          and "Jupiter" in rec_["cost_to_fill"][0]["cost_basis"], "pool depth is present, labelled a proxy, and the cost says whose figure it is")
    if others:
        nr = run(ds.get(others[0]["key"]))
        check(nr["cost_to_fill"][0]["state"] == "no_route" and nr["cost_to_fill"][0]["reason"], "tnega_get for a no-route mint gives no_route with a reason, no cost",
              nr["cost_to_fill"][0]["reason"][:60])
    und = run(ds.get("underlying/NVDA"))
    uv = {v["key"]: v for v in und["versions"]}
    check(uv[xs["key"]].get("cost_bps_1k") and uv[xs["key"]].get("allin_per_share_usd_1k") and uv[xs["key"]]["chain"] == "Solana"
          and uv[xs["key"]].get("shares_per_token") == 1.0, "tnega_get underlying/NVDA shows the Solana version with cost_bps_1k and allin_per_share_usd_1k")
    check(len(json.dumps(und)) < 8000, "the underlying record fits the 8KB ceiling", f"{len(json.dumps(und))} bytes")
    lst = run(ds.list(limit=50, offset=0, search="NVDA"))
    row = next(r for r in lst["rows"] if r["key"] == xs["key"])
    check(row.get("cost_bps_1k") and row.get("cost_bps_10k") and "state_1k" not in row, "list rows carry cost_bps_1k and cost_bps_10k")
    summ = run(ds.summary())
    check(any(c.get("chain_name") == "Solana" for c in summ["by_chain"]) and "Only EVM" not in summ["definition"], "summary counts Solana by chain")
    check(not any("not measured yet" in c for c in ds.caveats), "the dataset caveats no longer say Solana is not measured")
    return {"xs": xs, "on": on}


# ── 5. the link ──────────────────────────────────────────────────────────────

def check_link(w) -> None:
    print("\n5. the signing link")
    xs = w["xs"]
    link_id, p = S.mint(side="b", chain_id="solana", token=xs["address"], pay=SC.USDC_MINT, amount="1000", wallet=WALLET,
                        cost_ex_gas_bps=10, max_slippage_bps=50)
    d = S.decode(link_id)
    check(d.status == "ok" and d.payload["c"] == "solana" and d.payload["t"] == xs["address"] and d.payload["w"] == WALLET,
          "a Solana link decodes to the same order, base58 case kept")
    check(S.decode(link_id[:-2] + ("A" if link_id[-2] != "A" else "B") + link_id[-1]).status == "invalid", "one changed character is invalid")
    bad = [("pay token", dict(pay=xs["address"])), ("address w", dict(wallet="not-a-key")), ("address t", dict(token=xs["address"][:-1] + "0")),
           ("amount", dict(amount="0")), ("slippage", dict(max_slippage_bps=301)), ("wallet", dict(wallet="1" * 32))]
    for label, over in bad:
        kw = dict(side="b", chain_id="solana", token=xs["address"], pay=SC.USDC_MINT, amount="1000", wallet=WALLET, cost_ex_gas_bps=10)
        kw.update(over)
        try:
            S.mint(**kw)
            check(False, f"mint refuses {label}")
        except ValueError:
            check(True, f"mint refuses {label}")
    try:
        S.mint(side="b", chain_id="solana", token=xs["address"], pay=SC.USDC_MINT, amount="10001", wallet=WALLET, cost_ex_gas_bps=10)
        check(False, "a buy over $10,000 is refused")
    except ValueError:
        check(True, "a buy over $10,000 is refused")
    # EVM unchanged: this id was minted by the code before the change (fixed secret, nonce, clock)
    import secrets as _s
    real = _s.token_hex
    _s.token_hex = lambda n: "abcd1234"
    try:
        lid, _p = S.mint(side="b", chain_id=8453, token="0xB20000000000000000000078EE7ce2fe4908108c",
                         pay="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount="10",
                         wallet="0x000000000000000000000000000000000000dEaD", cost_ex_gas_bps=12, now=1000)
    finally:
        _s.token_hex = real
    os.environ["SIGN_LINK_SECRET"] = "te-solana-selfcheck-only"
    check(lid == EVM_ID_BEFORE, "an EVM link is byte-identical to the one the code made before this change", lid[:40] + "...")


# ── 6. orders ────────────────────────────────────────────────────────────────

def set_client(responder_fn=None):
    c, fetch, clk = make_client(responder_fn or responder)
    SC.set_client(c)
    return c, fetch


def check_orders(w) -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from te.sign_router import router

    print("\n6. orders on Solana (constructed Jupiter and RPC answers)")
    xs, on = w["xs"], w["on"]
    rpc = FakeRpc()
    PS.RPC = rpc
    rpc.balances[(WALLET, SC.USDC_MINT)] = 5_000_000_000
    rpc.balances[(WALLET, xs["address"])] = 50 * 10 ** 8
    P._now = lambda: __import__("time").time()
    BEHAVE.clear()
    c, fetch = set_client()

    out = run(P.prepare_buy(xs["key"], "1000", WALLET))
    o = out.get("order") or {}
    check(not out.get("withheld_reason") and out.get("sign_url", "").startswith("https://www.tnega.app/sign/"), "a buy by key returns a sign link",
          out.get("withheld_reason") or out.get("explanation", "")[:80])
    want = {"side", "chain", "mint", "pay_mint", "amount", "slippage_bps", "wallet", "expires_at", "reference_price_usd", "limit"}
    check(want <= set(o) and o["side"] == "buy" and o["chain"] == "solana" and o["mint"] == xs["address"]
          and o["pay_mint"] == SC.USDC_MINT and o["amount"] == "1000" and o["slippage_bps"] == 50 and o["wallet"] == WALLET
          and o["expires_at"].endswith("Z") and o["reference_price_usd"] > 0 and 0.02 <= o["limit"] <= 0.05, "the order has the fields a Solana order carries",
          json.dumps(o)[:200])
    dec = S.decode(out["sign_url"].rsplit("/", 1)[1])
    check(dec.status == "ok" and dec.payload["c"] == "solana" and dec.payload["b"] == out["tolerance"]["cost_ex_gas_bps"], "the link decodes to the order, with b the measured cost")
    check(out["value_check"]["ok"] and out["quote"]["source"] == "Jupiter" and out["balance"]["read"] and out["balance"]["enough"],
          "value check ran and passed; USDC balance read", json.dumps(out["quote"])[:120])
    check(len(json.dumps(out)) < 12000, "the answer fits 12KB", f"{len(json.dumps(out))} bytes")
    check(len(fetch.calls) == 1 and fetch.calls[0]["amount"] == "1000000000" and fetch.calls[0]["slippageBps"] == "50", "one Jupiter call, $1,000 in raw USDC, slippage passed")

    set_client()
    t = run(P.prepare_buy("NVDA", "2500.50", WALLET, max_slippage_bps=100))
    check(not t.get("withheld_reason") and t["chosen"]["key"] == xs["key"] and t["order"]["amount"] == "2500.5" and t["order"]["slippage_bps"] == 100,
          "a buy by ticker picks the stored best Solana version", t.get("withheld_reason") or t["why"]["sentence"][:80])
    if on:
        check(any(x["key"] == on["key"] for x in t["why"]["not_ranked"]), "Ondo is not ranked for a ticker buy, and says why")

    refusals = [
        ("EVM key with a Solana wallet", P.prepare_buy("8453/0xb20000000000000000000078ee7ce2fe4908108c", "100", WALLET), "wallet_chain_mismatch"),
        ("Solana key with an EVM wallet", P.prepare_buy(xs["key"], "100", EVM_WALLET), "chain_not_supported"),
        ("USDT on Solana", P.prepare_buy(xs["key"], "100", WALLET, pay_with="USDT"), "bad_pay_token"),
        ("over $10,000", P.prepare_buy(xs["key"], "10001", WALLET), "bad_amount"),
        ("slippage 301", P.prepare_buy(xs["key"], "100", WALLET, max_slippage_bps=301), "bad_slippage"),
        ("unknown key", P.prepare_buy("solana/" + SC.USDC_MINT, "100", WALLET), "unknown_instrument"),
        ("a sale given a ticker", P.prepare_sell("NVDA", "1", WALLET), "version_key_needed"),
        ("a sale of too many places", P.prepare_sell(xs["key"], "1.123456789", WALLET), "bad_amount"),
    ]
    for label, coro, code in refusals:
        r = run(coro)
        check(r.get("withheld_reason") == code and not r.get("sign_url"), f"refused: {label}", f"{r.get('withheld_reason')}")

    BEHAVE[xs["address"]] = "no_route"
    r = run(P.prepare_buy(xs["key"], "100", WALLET))
    check(r.get("withheld_reason") == "no_route" and not r.get("sign_url"), "no route: refused, no link", r.get("explanation", "")[:80])
    BEHAVE[xs["address"]] = "429"
    set_client()
    r = run(P.prepare_buy(xs["key"], "100", WALLET))
    check(r.get("sign_url") is None and r.get("link_withheld_reason") == "quote_unavailable" and r.get("partial"),
          "Jupiter rate limiting: the version is named, no link, partial", str(r.get("quote_note"))[:60])
    BEHAVE.clear()
    set_client(lambda p: {"status": 200, "body": constructed_quote(p, impact="0.35", dec=8)})
    r = run(P.prepare_buy(xs["key"], "100", WALLET))
    check(r.get("withheld_reason") == "no_route" and "too_thin" in r["explanation"] or "35.0%" in r.get("explanation", ""), "an order that would move the price 35% is refused",
          r.get("explanation", "")[:80])
    set_client(lambda p: {"status": 200, "body": constructed_quote(p, impact="0", dec=8)})
    r = run(P.prepare_buy(xs["key"], "100", WALLET))
    check(r.get("withheld_reason") == "no_route" and not r.get("sign_url"), "an impact of 0 is never turned into a link")
    set_client(lambda p: {"status": 200, "body": {**constructed_quote(p, dec=8), "otherAmountThreshold": str(int(constructed_quote(p, dec=8)["outAmount"]) // 2)}})
    r = run(P.prepare_buy(xs["key"], "1000", WALLET))
    check(r.get("withheld_reason") == "no_route" and "value check failed" in r.get("explanation", ""), "a route whose minimum is half the estimate fails the value check",
          r.get("explanation", "")[:100])

    # a sale
    set_client()
    s = run(P.prepare_sell(xs["key"], "5", WALLET))
    so = s.get("order") or {}
    check(not s.get("withheld_reason") and so.get("side") == "sell" and so.get("chain") == "solana" and so.get("mint") == xs["address"]
          and so.get("pay_mint") == SC.USDC_MINT and so.get("amount") == "5" and so["reference_price_usd"] > 0 and 0.02 <= so["limit"] <= 0.05,
          "a sale returns a Solana order: amount is tokens, pay_mint USDC", json.dumps(so)[:160])
    check(s["balance"]["enough"] and abs(so["reference_price_usd"] - PRICE / (1 - 0.001)) < 0.01, "the sale's reference is the pre-trade price per token, balance read",
          f"{so['reference_price_usd']}")
    r = run(P.prepare_sell(xs["key"], "51", WALLET))
    check(r.get("withheld_reason") == "insufficient_balance" and not r.get("sign_url"), "a sale of more than the wallet holds is refused")
    rpc.fail = True
    r = run(P.prepare_sell(xs["key"], "5", WALLET))
    check(r.get("sign_url") and r["balance"]["read"] is False, "an unreadable balance is said, not taken for zero or for enough")
    rpc.fail = False

    # the page's routes
    app = FastAPI()
    app.include_router(router)
    api = TestClient(app)
    set_client()
    link_id = out["sign_url"].rsplit("/", 1)[1]
    g = api.get(f"/api/sign/{link_id}")
    b = g.json()
    check(g.status_code == 200 and b["status"] == "ok" and b["chain"] == "solana" and b["side"] == "buy" and b["mint"] == xs["address"]
          and b["pay_mint"] == SC.USDC_MINT and b["amount"] == "1000" and b["slippage_bps"] == 50 and b["wallet"] == WALLET
          and b["from_amount_raw"] == "1000000000" and b["value_check"]["limit"] == S.limit_from_b(dec.payload["b"])
          and b["value_check"]["reference_price_usd"] > 0, "GET /api/sign/{id} returns the Solana order and the check", json.dumps(b)[:150])
    sl_id = s["sign_url"].rsplit("/", 1)[1]
    gs = api.get(f"/api/sign/{sl_id}").json()
    check(gs["side"] == "sell" and gs["amount"] == "5" and gs["from_amount_raw"] == str(5 * 10 ** 8) and gs["pay_token"]["role"] == "receive",
          "and for a sale (amount raw in the token's decimals)")
    BEHAVE[xs["address"]] = "429"
    set_client()
    PS._view_cache.clear()
    gb = api.get(f"/api/sign/{link_id}").json()
    check(gb["value_check"]["limit"] is None and gb["reference"] is None, "if Jupiter cannot be measured when the page opens, the check says so and offers no signing")
    BEHAVE.clear()
    sig = "5" * 88
    check(api.post(f"/api/sign/{link_id}/done", json={"tx": "0x" + "a" * 64}).status_code == 400, "POST /done: an EVM hash on a Solana link is a bad hash")
    check(api.post(f"/api/sign/{link_id}/done", json={"tx": "nope"}).status_code == 400, "POST /done: garbage is a bad hash")
    check(api.post(f"/api/sign/{link_id}/done", json={"tx": sig}).status_code == 204, "POST /done: a Solana signature marks the link used")
    check(api.get(f"/api/sign/{link_id}").status_code == 409, "a used link answers 409")
    ex, _ = S.mint(side="b", chain_id="solana", token=xs["address"], pay=SC.USDC_MINT, amount="10", wallet=WALLET, cost_ex_gas_bps=5, ttl=1)
    import time as _t
    _t.sleep(1.2)
    check(api.get(f"/api/sign/{ex}").status_code == 410, "an expired Solana link answers 410")

    # through the MCP tools
    from mcp_server import tools
    env = run(tools.prepare_buy({}, {"query": xs["key"], "usd_amount": 100, "wallet": WALLET}))
    v = env.get("value") or env
    check(json.dumps(env).find("sign_url") > 0 and env["coverage"]["quote_source"] == "Jupiter" and env["coverage"]["chains"] == ["Solana"],
          "tnega_prepare_buy answers in the envelope for a Solana wallet", json.dumps(env["coverage"])[:120])
    check(any("Jupiter" in c for c in env["caveats"]) and not any("LI.FI" in c for c in env["caveats"]), "its caveats name Jupiter, not LI.FI")
    PS.RPC = None


EVM_ID_BEFORE = "eyJhIjoiMTAiLCJiIjoxMiwiYyI6ODQ1MywiZSI6MTYwMCwibSI6NTAsIm4iOiJhYmNkMTIzNCIsInAiOiIweDgzMzU4OWZjZDZlZGI2ZTA4ZjRjN2MzMmQ0ZjcxYjU0YmRhMDI5MTMiLCJzIjoiYiIsInQiOiIweGIyMDAwMDAwMDAwMDAwMDAwMDAwMDA3OGVlN2NlMmZlNDkwODEwOGMiLCJ2IjoxLCJ3IjoiMHgwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDBkZWFkIn02xKMRRBw11J2pph0"


def main() -> int:
    check_client()
    check_arithmetic()
    check_multipliers()
    w = check_worker_and_views()
    check_link(w)
    check_orders(w)
    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: " + "; ".join(FAILURES))
        return 1
    print("all passed (every Jupiter and RPC answer above was constructed, not measured)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
