"""Encoded response sizes for the tokenized_equities spec, section 3.3 and 8.1.

Run: ./venv/bin/python scripts/te_response_sizes.py            (sizes only, offline)
     ./venv/bin/python scripts/te_response_sizes.py --verify   (also checks every
                                                                example pool on chain)

Every byte figure mcp/TOKENIZED-EQUITIES.md cites in 3.3, 6, 8.1 and 9.1 is printed
here, encoded with envelope.encode, the function the server itself uses. The
examples are held in this file. They are filled records, not the placeholder
JSON in the spec: full-length addresses and pool ids, and numbers at realistic
precision.

THE EXAMPLES ARE REAL POOLS. `--verify` reads each one on chain 4663 and fails
if it is not what the example says it is:
  V4        the pool id is keccak256 of the pool key held here, and extsload
            of its slot0 is non-zero
  V3, fork  token0(), token1(), fee() and factory() answer, slot0() answers,
            and the tokens are the ones named
  algebra   token0() and token1() are the ones named, globalState() answers
            and slot0() does not, and factory() is the one named
The numbers inside the records (costs, prices, rates) are illustrative values
of realistic length. They are not measurements and nothing cites them.

The caveats are read from the spec itself (section 3.2, "So, seven:"), so a
caveat edit changes these figures the next time this runs, which is the point.

No key is used. --verify reads through TE_LOG_RPC, default
https://rpc.mainnet.chain.robinhood.com.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from eth_abi import encode  # noqa: E402
from eth_utils import keccak  # noqa: E402

from mcp_server import envelope  # noqa: E402

SPEC = ROOT / "mcp/TOKENIZED-EQUITIES.md"
DATASET = "tokenized_equities"
AS_OF = "2026-10-02T23:59:59+00:00"
BLK = 71627504

# ---------------------------------------------------------------- addresses
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
USDE = "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34"
ETH = "0x0000000000000000000000000000000000000000"
NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec"
SPY = "0x117cc2133c37b721f49de2a7a74833232b3b4c0c"
V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa"
FORK_FACTORY = "0xece6ecd61177336ea6fb9b17937ac439d85ee20b"
ALGEBRA_FACTORY = "0x16494a80e08bcb9285d87b67149d7b01774d82f8"
BEACON = "0xe10b6f6b275de231345c20d14ab812db62151b00"
IMPL = "0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2"
WETH_USDG_REF = "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca"
USDE_USDG_REF = "0xa5f23cae4e5c3388c5a8a6b08a83f53e56df8f1a63757e606b362994b68a2361"


def v4(c0, c1, fee, ts, hooks=ETH):
    key = (c0, c1, fee, ts, hooks)
    pid = "0x" + keccak(encode(["address", "address", "uint24", "int24", "address"], list(key))).hex()
    return {"family": "uniswap_v4", "walker": "v4", "pool": pid, "key": key}


# Each venue: what the record shows, plus what --verify checks.
NVDA_VENUES = [
    dict(v4(USDG, NVDA, 3000, 60), quote=USDG, fee_bps=30),
    dict(v4(USDE, NVDA, 38000, 760), quote=USDE, fee_bps=380),
    {"family": "uniswap_v3", "walker": "v3", "pool": "0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3",
     "quote": USDG, "tokens": (USDG, NVDA), "factory": V3_FACTORY, "fee_bps": 5},
    {"family": "v3_fork", "walker": "v3", "pool": "0xf28521367b68a68ffc85ed6fad4af73c5ff7b24a",
     "quote": USDG, "tokens": (USDG, NVDA), "factory": FORK_FACTORY, "fee_bps": 1},
    {"family": "algebra_integral", "walker": "algebra", "pool": "0x8097a5015711825f5f2ffc703fa0f750ef183dcc",
     "quote": WETH, "tokens": (WETH, NVDA), "factory": ALGEBRA_FACTORY, "fee_bps": 0},
]
SPY_VENUES = [
    dict(v4(SPY, USDG, 3000, 60), quote=USDG, fee_bps=30),
    {"family": "uniswap_v3", "walker": "v3", "pool": "0xddcbba3666f578e3f09516f21ff85bfee859ab5e",
     "quote": WETH, "tokens": (WETH, SPY), "factory": V3_FACTORY, "fee_bps": 5},
    {"family": "v3_fork", "walker": "v3", "pool": "0xabe817af4fe3420152ab1464a45dc971e7eaaeae",
     "quote": USDG, "tokens": (SPY, USDG), "factory": FORK_FACTORY, "fee_bps": 0},
    {"family": "algebra_integral", "walker": "algebra", "pool": "0x43343e5881c9382bbdc7b8fb44e837d7a6c254ad",
     "quote": WETH, "tokens": (WETH, SPY), "factory": ALGEBRA_FACTORY, "fee_bps": 0},
]


def enc(o) -> int:
    return len(envelope.encode(o).encode("utf-8")) if isinstance(o, dict) else \
        len(json.dumps(o, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def caveats() -> list[str]:
    text = SPEC.read_text()
    sec = text[text.index("So, seven:"):text.index("Measured as written")]
    out = [re.sub(r"\s+", " ", m).strip() for m in re.findall(r'^\d\. "(.*?)"\s*$', sec, flags=re.S | re.M)]
    assert len(out) == 7, len(out)
    return out


def coverage() -> dict:
    return {"instruments": 204, "instruments_with_a_live_quote": 192, "underlyings": 204, "chains": [4663],
            "issuers": ["robinhood"], "sizes_quoted_usd": [1000, 10000], "numeraire": "USDG",
            "quote_staleness_bound_seconds": 900, "first_poll": "2026-10-01T00:00:00Z",
            "last_poll": "2026-10-02T23:45:00Z", "buckets": 192, "scheduled_reads": 39168,
            "answered_reads": 39011, "unanswered_our_side": 97, "unanswered_venue_side": 60,
            "stale_block_reads": 412, "non_canonical_mints_excluded": 0, "partial": False}


def depth(i):
    return {"test_size": 10000, "impact_bps": i, "threshold_bps": 10, "passed": True}


REFS = {
    USDG: {"symbol": "USDG", "is_numeraire": True},
    WETH: {"symbol": "WETH", "same_as": "gas_token"},
    USDE: {"symbol": "USDe", "rate": 0.999612, "pool": USDE_USDG_REF, "venue_family": "uniswap_v4",
           "block": BLK, "depth": depth(0.3991), "withheld_reason": None},
}


def usd_reference(quotes):
    return {"numeraire": {"symbol": "USDG", "address": USDG, "usd_value": 1.0,
                          "usd_value_basis": "assumed, not measured"},
            "gas_token": {"symbol": "ETH", "rate": 2604.118276, "pool": WETH_USDG_REF,
                          "venue_family": "uniswap_v3", "block": BLK, "depth": depth(0.3569),
                          "withheld_reason": None},
            "quote_references": {q: REFS[q] for q in quotes}}


TRANSFER_CONTROL = {
    "model": "denylist", "established": "measured",
    "gate": {"contract": BEACON, "where": "the beacon, not the token and not a contract the token points at",
             "function": "isBlocked"},
    "population": {"blocked_events": 246, "distinct_addresses_blocked": 177, "unblocked_events": 4,
                   "distinct_addresses_unblocked": 2, "currently_denied": 175},
    "controls": {"denied_address_transfer": "reverts with the typed Blocked error naming that address",
                 "never_used_address_transfer": "succeeds in the same pass",
                 "further_controls": "three, each reverting with its expected typed error"},
    "ordinary_wallet_gated": False, "checked_at_block": 71528495}
BASIS_NOTE = ("Share of in-range liquidity. The V4 position key includes a salt, so a position resolves to "
              "its PositionManager NFT holder, or to the contract that opened it directly. Self-checked: "
              "in-range positions sum to the pool's own liquidity exactly, or no figure is returned.")


def record(sym, token, venues, primary, alt_idx, conc, ui):
    def entry(n, side, k):
        p = venues[primary]
        return {"notional_usd": n, "side": side, "venue_family": p["family"], "pool": p["pool"],
                "method": "tick_walk_against_pool_state", "enough_data": True, "filled_fraction": 1.0,
                "slippage_bps": round(1.84 + k * 3.1, 2), "pool_fee_bps": 30.0, "protocol_fee_bps": 10.0,
                "gas_usd": 0.0213, "gas_bps": 0.21, "total_cost_bps": round(42.05 + k * 3.1, 2),
                "total_cost_usd": 4.205, "quoted_at_block": BLK, "quote_age_seconds": 312,
                "staleness_bound_seconds": 900, "quote_token": p["quote"],
                "alternatives": [{"venue_family": venues[i]["family"], "pool": venues[i]["pool"],
                                  "quote_token": venues[i]["quote"], "total_cost_bps": round(8.73 + i + k, 2)}
                                 for i in alt_idx]}
    quotes = list(dict.fromkeys([venues[primary]["quote"]] + [venues[i]["quote"] for i in alt_idx]))
    return {
        "key": f"4663/{token}", "chain_id": 4663, "token_address": token, "symbol": sym,
        "underlying_key": f"underlying/{sym}", "issuer": "robinhood",
        "issuer_source": {"beacon": BEACON, "implementation": IMPL, "block": BLK, "date": "2026-10-02"},
        "issuer_structure_key": "issuer/robinhood", "canonical": True, "decimals": 18,
        "cost_to_fill": [entry(n, s, k) for k, (n, s) in
                         enumerate([(1000, "buy"), (1000, "sell"), (10000, "buy"), (10000, "sell")])],
        "usd_reference": usd_reference(quotes),
        "premium": {"value_bps": None, "window": None, "samples": 0, "underlying_market_state": None,
                    "reference_source": None, "withheld_reason": "unestablished_source"},
        "shares_per_token": 1.0, "shares_per_token_source": "issuer_publication",
        "shares_per_token_convention": "not_published", "ui_multiplier": ui, "new_ui_multiplier": None,
        "effective_at": None, "ui_multiplier_read_at_block": BLK, "per_share_price_usd": 181.3918,
        "token_price_usd": 181.5294, "total_return": True,
        "distributions": {"paid_to_holder": False, "mechanism": "reinvested into the multiplier, net of withholding",
                          "withholding_rate_bps": "not_published"},
        "terms_url_matches_issuer": True, "transfer_control": copy.deepcopy(TRANSFER_CONTROL),
        "venues": [{k: v for k, v in dict(
            family=x["family"], walker=x["walker"], pool=x["pool"], fee_bps=x["fee_bps"],
            protocol_fee_bps=10 if x["family"] == "uniswap_v4" else None,
            liquidity="506281920529444552" if x["family"] == "uniswap_v4" else None, live=True,
            read_via="extsload" if x["family"] == "uniswap_v4" else None,
            factory=x.get("factory")).items() if v is not None} for x in venues],
        "best_venue_by_size": {"1000": "uniswap_v4", "10000": "uniswap_v3"},
        "liquidity_concentration": {"basis": "v4_position_salt", "basis_note": BASIS_NOTE,
                                    "providers": conc[0], "largest_share_pct": conc[1],
                                    "measured_at_block": 71435476, "withheld_reason": None},
        "unestablished_source": {"product_line": "no on-chain read distinguishes the product line per instrument"},
    }


def nvda_record():
    return record("NVDA", NVDA, NVDA_VENUES, 0, [1, 4], (157, 17.17), 1.0007751591646306)


def spy_record(n_venues=4, n_alts=1):
    venues = SPY_VENUES[:n_venues]
    return record("SPY", SPY, venues, 0, [1][:n_alts], (350, 10.19), 1.001717991187472)


def response(tool, value, cov=None):
    return enc(envelope.build(measured=f"{tool} over {DATASET}", coverage=cov or coverage(), value=value,
                              as_of=AS_OF, caveats=caveats()))


# --------------------------------------------------------------- layouts
PER_POLL = ["method", "staleness_bound_seconds", "quoted_at_block", "quote_age_seconds"]


def hoist(r):
    r = copy.deepcopy(r)
    r["quote_basis"] = {"method": "tick_walk_against_pool_state", "quoted_at_block": BLK,
                        "quote_age_seconds": 312, "staleness_bound_seconds": 900}
    for e in r["cost_to_fill"]:
        for f in PER_POLL:
            e.pop(f)
    return r


def alts_without_pool(r):
    r = copy.deepcopy(r)
    for e in r["cost_to_fill"]:
        for a in e["alternatives"]:
            a.pop("pool")
    return r


def tc_by_key(r):
    r = copy.deepcopy(r)
    r["transfer_control"] = {"model": "denylist", "detail_key": "issuer/robinhood"}
    return r


def note_out(r):
    r = copy.deepcopy(r)
    r["liquidity_concentration"].pop("basis_note")
    return r


def venue_index(r, venues):
    r = copy.deepcopy(r)
    idx = {v["pool"]: i for i, v in enumerate(r["venues"])}
    for v, src in zip(r["venues"], venues):
        v["quote_token"] = src["quote"]
    for e in r["cost_to_fill"]:
        e["venue"] = idx[e.pop("pool")]
        e.pop("venue_family")
        e.pop("quote_token")
        e["alternatives"] = [{"venue": idx[a["pool"]], "total_cost_bps": a["total_cost_bps"]}
                             for a in e["alternatives"]]
    return r


# ----------------------------------------------------------------- route
NOT_GUARANTEED_HEADING = "### 9.4"


def route_record(rec, venues, wallet="0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE"):
    text = SPEC.read_text()
    sec = text[text.index(NOT_GUARANTEED_HEADING):text.index("### 9.5")].split("\n", 2)[2]
    not_guaranteed = [re.sub(r"\s+", " ", x).strip() for x in re.findall(r"^- (.*?)(?=^- |\Z)", sec, flags=re.S | re.M)]
    p = venues[0]
    c0, c1, fee, ts, hooks = p["key"]
    zero_for_one = c0 == p["quote"]
    approve = "0x095ea7b3" + encode(["address", "uint256"], ["0x0000000000000000000000000000000000000001", 10 ** 30]).hex()
    params = [encode(["((address,address,uint24,int24,address),bool,uint128,uint128,bytes)"],
                     [((c0, c1, fee, ts, hooks), zero_for_one, 10 ** 10, 55 * 10 ** 18, b"")]),
              encode(["address", "uint256"], [p["quote"], 10 ** 10]),
              encode(["address", "uint256"], [rec["token_address"], 55 * 10 ** 18])]
    swap_input = encode(["bytes", "bytes[]"], [bytes([6, 12, 15]), params])
    swap = "0x3593564c" + encode(["bytes", "bytes[]", "uint256"], [bytes([0x10]), [swap_input], 1790300000]).hex()
    route = {
        "what_this_is": "An unsigned transaction. It has not been signed, has not been broadcast, and we will "
                        "never know whether it was sent. Sign it in your own wallet if you choose to.",
        "chain_id": 4663,
        "steps": [{"purpose": "approval", "to": p["quote"], "data": approve, "value": "0"},
                  {"purpose": "swap", "to": "0x0000000000000000000000000000000000000002", "data": swap, "value": "0"}],
        "intended_signer": wallet, "gas_limit_estimate": 310000, "min_amount_out": "55000000000000000000",
        "slippage_tolerance_bps": 50, "quoted_at_block": BLK, "quote_age_seconds": 312,
        "quote_expires_at": "2026-10-03T00:14:59Z", "venue_family": p["family"], "pool": p["pool"],
        "instrument_conditions": {"terms_url": "https://robinhood.com/stocktoken/rhj", "terms_read_at_block": BLK,
                                  "transfer_control_model": "denylist",
                                  "applies_to_your_address": "We describe the instrument's transfer control and "
                                                             "do not evaluate your address against it. Check it "
                                                             "yourself before signing."},
        "not_guaranteed": not_guaranteed}
    rr = {k: rec[k] for k in ["key", "chain_id", "token_address", "symbol", "underlying_key", "issuer",
                              "issuer_structure_key", "canonical", "decimals"]}
    rr["key"] = f"{rec['key']}/for/{wallet}"
    q = rec["cost_to_fill"][2]
    ref = rec["usd_reference"]
    rr.update({"quote": q, "usd_reference": {"numeraire": ref["numeraire"], "gas_token": ref["gas_token"],
                                             "quote_references": {q["quote_token"]: ref["quote_references"][q["quote_token"]]}},
               "transfer_control": rec["transfer_control"], "unsigned_route": route})
    return rr, route, swap, not_guaranteed


# ---------------------------------------------------------------- series
POINT = {"t": "2026-10-02T23:45:00Z", "c1": 42.05, "c10": 44.31, "px": 181.5294, "pr": None, "v": "v4",
         "liq": 1843211.57, "blk": BLK}
LEGEND_OLD = {"t": "bucket start", "c1": "cost bps at 1,000 USD", "c10": "cost bps at 10,000 USD",
              "px": "token price USD", "pr": "premium bps", "v": "winning venue family",
              "liq": "quotable liquidity USD", "blk": "block"}
LEGEND_NEW = {"t": "bucket start", "c1": "cost bps at 1,000 USDG", "c10": "cost bps at 10,000 USDG",
              "px": "token price in USDG, USD by assumption; null if its reference is withheld",
              "pr": "premium bps", "v": "winning venue family",
              "liq": "quotable liquidity in USDG; null if its reference is withheld", "blk": "block"}


def series_coverage(legend):
    return {"legend": legend, "scheduled": 192, "answered": 190, "unanswered_our_side": 1,
            "unanswered_venue_side": 1, "stale_block": 3, "first_bucket": "2026-10-01T00:00:00Z",
            "last_bucket": "2026-10-02T23:45:00Z", "bucket_seconds": 900}


LIST_ROW = {"key": f"4663/{NVDA}", "symbol": "NVDA", "issuer": "robinhood", "chain_id": 4663,
            "best_venue_10k": "uniswap_v4", "cost_bps_10k": 44.31, "premium_bps": None,
            "quote_age_seconds": 312, "withheld_reason": None}


# ---------------------------------------------------------------- verify
def verify() -> int:
    import httpx
    url = os.environ.get("TE_LOG_RPC", "https://rpc.mainnet.chain.robinhood.com")
    print(f"verifying example pools via {urlsplit(url).scheme}://{urlsplit(url).hostname}")
    client = httpx.Client(timeout=60)

    class Unanswered(Exception):
        pass

    def call(to, sig, data=b""):
        """The call's return data, or None if the call reverted. A refusal or
        an error that is not a revert is retried and then raised, so a read we
        could not make is never reported as a pool that is not what it says."""
        import time
        payload = {"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                   "params": [{"to": to, "data": "0x" + (keccak(text=sig)[:4] + data).hex()}, "latest"]}
        for attempt in range(6):
            try:
                resp = client.post(url, json=payload)
                if resp.status_code == 200:
                    r = resp.json()
                    err = (r.get("error") or {}).get("message", "")
                    if "error" not in r or "revert" in err.lower():
                        res = r.get("result")
                        return bytes.fromhex(res[2:]) if res and len(res) > 2 else None
            except (httpx.HTTPError, ValueError):
                pass
            time.sleep(2 * 2 ** attempt)
        raise Unanswered(f"{sig} on {to}")

    bad = 0
    for label, venues in (("NVDA", NVDA_VENUES), ("SPY", SPY_VENUES)):
        for v in venues:
          try:
            if v["family"] == "uniswap_v4":
                base = int.from_bytes(keccak(bytes.fromhex(v["pool"][2:]) + (6).to_bytes(32, "big")), "big")
                raw = call("0x8366a39cc670b4001a1121b8f6a443a643e40951", "extsload(bytes32)", base.to_bytes(32, "big"))
                ok = raw is not None and int.from_bytes(raw, "big") != 0 and v["quote"] in v["key"][:2]
                what = f"key {v['key'][:4]}"
            else:
                t0, t1, fac = call(v["pool"], "token0()"), call(v["pool"], "token1()"), call(v["pool"], "factory()")
                gs, s0 = call(v["pool"], "globalState()"), call(v["pool"], "slot0()")
                toks = ("0x" + t0[-20:].hex(), "0x" + t1[-20:].hex()) if t0 and t1 else None
                shape = (gs is not None and s0 is None) if v["family"] == "algebra_integral" else (s0 is not None)
                ok = toks == v["tokens"] and fac is not None and "0x" + fac[-20:].hex() == v["factory"] and shape
                what = f"tokens {toks}, factory {'0x' + fac[-20:].hex() if fac else None}, shape ok {shape}"
            print(f"  {label:4} {v['family']:17} {v['pool'][:12]}… {'ok' if ok else 'WRONG'}  {what}")
            bad += not ok
          except Unanswered as e:
            print(f"  {label:4} {v['family']:17} {v['pool'][:12]}… UNANSWERED  {e}; not a finding about the pool")
            bad += 1
    return bad


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()

    cav, cov = caveats(), coverage()
    rec = nvda_record()
    env_get = enc(envelope.build(measured=f"tnega_get over {DATASET}", coverage={}, value=None,
                                 as_of=AS_OF, caveats=[])) - enc({}) - len("null") - enc([])
    print("section 3.3, filled NVDA record: five venues in four families, three quote tokens "
          "(USDG, USDe, WETH), four cost entries with two alternatives each")
    print(f"  caveats {enc(cav)}  coverage {enc(cov)}  envelope {env_get}")
    print(f"  record {enc(rec)}  (usd_reference {enc(rec['usd_reference'])}, cost_to_fill {enc(rec['cost_to_fill'])})")
    print(f"  tnega_get instrument response {response('tnega_get', rec)}  ceiling 8192")

    rr, route, swap, ng = route_record(rec, NVDA_VENUES)
    print(f"  route: calldata {len(swap)} hex chars, steps {enc(route['steps'])}, not_guaranteed {enc(ng)}, "
          f"route object {enc(route)}, route record {enc(rr)}, response {response('tnega_get', rr)}")
    rr2 = copy.deepcopy(rr)
    rr2.pop("transfer_control")
    rr2["quote"].pop("alternatives")
    print(f"  route record without transfer_control and alternatives {enc(rr2)}, response {response('tnega_get', rr2)}")
    rr3 = copy.deepcopy(rr2)
    for f in PER_POLL + ["venue_family", "pool"]:
        rr3["quote"].pop(f)
    print(f"  and without the quote fields the route object repeats or the record states once "
          f"(method, block, age, staleness bound, family, pool) {enc(rr3)}, response {response('tnega_get', rr3)}")

    print("layouts, instrument record, cumulative (record, response):")
    a = alts_without_pool(rec)
    b = hoist(a)
    c = tc_by_key(b)
    d = note_out(c)
    e = venue_index(hoist(rec), NVDA_VENUES)
    f = tc_by_key(e)
    g = note_out(f)
    for name, r in [("as specified", rec), ("alternatives without pool", a), ("then per-poll fields once", b),
                    ("then transfer_control by key", c), ("then basis_note in the descriptor", d),
                    ("instead: venue index, per-poll fields once", e), ("that, with transfer_control by key", f),
                    ("that, with basis_note in the descriptor", g)]:
        print(f"  {name:44} {enc(r):5} {response('tnega_get', r):5}")

    print("real SPY record: two quote tokens (USDG, WETH), one alternative per entry (response bytes):")
    s4 = spy_record(4, 1)
    s2 = spy_record(2, 1)
    print(f"  four venues {response('tnega_get', s4)}; two venues {response('tnega_get', s2)}; "
          f"two venues with transfer_control by key {response('tnega_get', tc_by_key(s2))}")

    print("section 8.1, series:")
    for name, leg in (("old legend", LEGEND_OLD), ("USDG legend", LEGEND_NEW)):
        sc = series_coverage(leg)
        n = 0
        while response("tnega_series", [POINT] * (n + 1), sc) <= 16384:
            n += 1
        print(f"  {name}: coverage {enc(sc)}, point {enc(POINT)}, points that fit {n}, "
              f"total at {n} {response('tnega_series', [POINT] * n, sc)}, "
              f"total at 117 {response('tnega_series', [POINT] * 117, sc)}")
    env_series = response("tnega_series", [], series_coverage(LEGEND_NEW)) - enc(cav) - enc(series_coverage(LEGEND_NEW)) - 2
    print(f"  series envelope {env_series}")
    print(f"section 6, list: row {enc(LIST_ROW)}, 25-row page {response('tnega_list', [LIST_ROW] * 25)}")

    return verify() if args.verify else 0


if __name__ == "__main__":
    sys.exit(main())
