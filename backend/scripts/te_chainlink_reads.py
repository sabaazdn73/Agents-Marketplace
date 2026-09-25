"""What the Chainlink equity feeds carry, read from chain, for section 4.3 of
mcp/TOKENIZED-EQUITIES.md and the Chainlink section of
docs/tokenized-equity-measurements.md.

Run: ./venv/bin/python scripts/te_chainlink_reads.py [--ink-only]

NOTHING FROM THESE FEEDS IS SERVED. The owner decided that no feed value is
served until Chainlink Labs confirms in writing that it may be (the spec, E22).
This script exists so that every class A statement the measurements record
makes about the feeds can be taken again. It prints feed answers for the person
running it. The committed documents cite its blocks, times, counts and ratios,
and do not reproduce the answers.

What it reads:

  1. The Robinhood Chain feeds for NVDA, MSFT and GOOGL against an underlying
     24/5 feed (Ethereum and Optimism for NVDA and GOOGL; Optimism alone for
     MSFT, which has no Ethereum 24/5 feed in Chainlink's directory), paired
     where the two updatedAt values are within 20 seconds. Each pair's ratio
     is tested for an exact match (within 1e-4 bp) against the token's uiMultiplier() in
     effect at the Robinhood round's updatedAt, and against the other value as
     a control. The value before effectiveAt() is read through an archive
     endpoint at the last block before it; the value after is read now. Then
     AAPL and QQQ, the two that do not resolve, the same way, with the
     nearest pairs printed where none fall within 20 seconds.
  2. The weekend of 2026-09-18 to 2026-09-21. EDT is UTC-4, so the NYSE close
     at 16:00 ET is 20:00 UTC, the end of post-market at 20:00 ET is 00:00 UTC,
     and Sunday 20:00 ET is Monday 00:00 UTC. For each 24/5 feed: rounds in
     post-market on Friday, rounds from Friday 20:00 ET to Sunday 20:00 ET, and
     the first round after. Then the BNB Smart Chain NVDA feed's rounds from
     Friday 19:00 UTC to Monday 14:00 UTC.
  3. The Ink wNVDAx, wSPYx and wQQQx feeds against the Ethereum and Optimism
     24/5 feeds for the underlying, and each token's two xStocks wrappers:
     code, convertToAssets(1e18) and asset() on each, on Ethereum and on Ink.
     --ink-only runs this section alone.

READS ONLY. eth_call for every contract value (rounds are read in batches
through Multicall3's aggregate3, itself an eth_call), eth_getBlockByNumber for
block numbers and times, eth_getCode for the one code check. No key, no
signature, no transaction. Every read on a chain is pinned to the block taken
for that chain at the start of the run, printed first; the pre-effectiveAt
multiplier reads name their own past blocks.

ENDPOINTS. Public, no key. Overridable by environment: TE_RPC_ROBINHOOD,
TE_RPC_ETHEREUM, TE_RPC_OPTIMISM, TE_RPC_BSC, TE_RPC_INK, and
TE_RH_ARCHIVE_RPC for past state on Robinhood Chain, which its public endpoint
does not serve. Only the scheme and host of an endpoint are ever printed.
Retries are bounded: six attempts per request, then the read is reported as
unanswered, which is a statement about our access and never about the feed.
"""
from __future__ import annotations

import datetime as dt
import os
import statistics as st
import sys
import time
from urllib.parse import urlsplit

import httpx
from eth_abi import decode, encode
from eth_utils import keccak

RPC = {
    "robinhood": "https://rpc.mainnet.chain.robinhood.com",
    "ethereum": "https://ethereum-rpc.publicnode.com",
    "optimism": "https://optimism-rpc.publicnode.com",
    "bsc": "https://bsc-rpc.publicnode.com",
    "ink": "https://rpc-gel.inkonchain.com",
}
RPC = {k: os.environ.get("TE_RPC_" + k.upper(), v) for k, v in RPC.items()}
RH_ARCHIVE = os.environ.get("TE_RH_ARCHIVE_RPC", "https://robinhood.drpc.org")
MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"

# Feed proxies, from Chainlink's reference data directory (class D for the
# listing; what each answers is read here).
FEED = {
    ("robinhood", "NVDA"): "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",
    ("robinhood", "MSFT"): "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E",
    ("robinhood", "GOOGL"): "0xF6f373a037c30F0e5010d854385cA89185AE638b",
    ("robinhood", "AAPL"): "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0",
    ("robinhood", "QQQ"): "0x80901d846d5D7B030F26B480776EE3b29374C2ae",
    ("robinhood", "TSLA"): "0x4A1166a659A55625345e9515b32adECea5547C38",
    ("robinhood", "SPY"): "0x319724394D3A0e3669269846abE664Cd621f9f6A",
    ("ethereum", "NVDA"): "0x2c47b8CD75C818969b398911b70C633e280552d4",
    ("ethereum", "GOOGL"): "0x4720bcC6f940d709D7e2F510936e611Db07C240E",
    ("ethereum", "QQQ"): "0xA1D955b4E582C784583df7071B8a3Fb6d4bcaC42",
    ("ethereum", "TSLA"): "0xB204328559E17F84eE7A285036AA0d47124F85D5",
    ("ethereum", "SPY"): "0x25efbA0d9b115D233cfA849F16BA743E8FFba2a1",
    ("optimism", "NVDA"): "0xe04E47A971770C55Ad7A73F294AA28e625c5B911",
    ("optimism", "MSFT"): "0xab97582664f2A24ecA411AA2B02D4C1Ae82E52a6",
    ("optimism", "GOOGL"): "0x367d706bf106136dc51a74209f619d4EF833BCc4",
    ("optimism", "AAPL"): "0x5241f3beaDaD396ef67035A9187c2F71D9cC58f2",
    ("optimism", "QQQ"): "0xE59148F773705A7231e9E04c8431CDD6EDF197D1",
    ("optimism", "TSLA"): "0x5Ce9c0a0Bc15236a110fbC19df547d2b23d3ce3B",
    ("optimism", "SPY"): "0x5F77134CfAA7DB2906649Ca21C50dA54daE9291d",
    ("bsc", "NVDA"): "0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8",
    ("ink", "wNVDAx"): "0x2328B6602e93d07f69099a8b120846409B9D3047",
}
# Robinhood stock tokens on chain 4663 (behind beacon 0xe10b6f6b...1b00).
RH_TOKEN = {
    "NVDA": "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
    "MSFT": "0xe93237c50d904957cf27e7b1133b510c669c2e74",
    "GOOGL": "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3",
    "AAPL": "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
    "QQQ": "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68",
}
# xStocks NVDA: the token, and the two ERC-4626 wrappers.
NVDAX = "0xc845b2894dbddd03858fd2d643b4ef725fe0849d"
WRAP_V1 = "0x93e62845c1dd5822ebc807ab71a5fb750decd15a"
WRAP_V2 = "0xa8ddb5cd96b5222afe198316e9a57caa642850d5"

PAIR_WINDOW_S = 20
MASK64 = (1 << 64) - 1

client = httpx.Client(timeout=60, headers={"User-Agent": "tnega-te-chainlink"})


class Unanswered(Exception):
    """A read we could not make. Ours, never evidence about the feed."""


class Reverted(Exception):
    pass


def host(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.hostname}" + (f":{p.port}" if p.port else "")


def iso(t: int) -> str:
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%a %Y-%m-%dT%H:%M:%SZ")


def ts(s: str) -> int:
    return int(dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc).timestamp())


def sel(sig: str) -> bytes:
    return keccak(text=sig)[:4]


def rpc(url: str, method: str, params):
    last = None
    for k in range(6):
        try:
            r = client.post(url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
            if r.status_code == 200:
                j = r.json()
                if "error" not in j:
                    return j["result"]
                msg = str(j["error"].get("message", "")).lower()
                if "revert" in msg or "execution" in msg:
                    raise Reverted(method)
                last = f"rpc error {j['error'].get('code')}"
            else:
                last = f"HTTP {r.status_code}"
        except (httpx.HTTPError, ValueError) as e:
            last = type(e).__name__
        time.sleep(2 * (k + 1))
    raise Unanswered(f"{method} via {host(url)}: {last}")


def pin(net: str, url: str | None = None) -> tuple[int, int]:
    b = rpc(url or RPC[net], "eth_getBlockByNumber", ["latest", False])
    return int(b["number"], 16), int(b["timestamp"], 16)


def block_time(url: str, n: int) -> int:
    return int(rpc(url, "eth_getBlockByNumber", [hex(n), False])["timestamp"], 16)


def call(net: str, to: str, data: bytes, block: int, url: str | None = None) -> bytes | None:
    try:
        r = rpc(url or RPC[net], "eth_call", [{"to": to, "data": "0x" + data.hex()}, hex(block)])
    except Reverted:
        return None
    return bytes.fromhex(r[2:]) if r and len(r) > 2 else None


def uint(b: bytes | None) -> int | None:
    return int.from_bytes(b[:32], "big") if b and len(b) >= 32 else None


def multicall(net: str, calls: list[tuple[str, bytes]], block: int) -> list[bytes | None]:
    out: list[bytes | None] = []
    for i in range(0, len(calls), 150):
        chunk = calls[i:i + 150]
        data = sel("aggregate3((address,bool,bytes)[])") + encode(
            ["(address,bool,bytes)[]"], [[(t, True, d) for t, d in chunk]])
        raw = call(net, MULTICALL3, data, block)
        if raw is None:
            raise Unanswered(f"aggregate3 on {net} returned nothing")
        (res,) = decode(["(bool,bytes)[]"], raw)
        out += [b if ok and len(b) >= 160 else None for ok, b in res]
    return out


def round_row(b: bytes, dec: int) -> dict:
    rid, ans, _, upd, _ = decode(["uint80", "int256", "uint256", "uint256", "uint80"], b)
    return {"rid": rid, "answer": ans / 10**dec, "updatedAt": upd}


def walk(net: str, proxy: str, block: int, since: int, max_rounds: int = 4000) -> tuple[list[dict], str]:
    """Rounds of one feed with updatedAt at or after `since`, plus the last one
    before it, oldest first. Walks back through getRoundData on the proxy at
    `block`. Stops at the start of the proxy's current phase and says so."""
    dec = uint(call(net, proxy, sel("decimals()"), block))
    latest = round_row(call(net, proxy, sel("latestRoundData()"), block), dec)
    phase, agg = latest["rid"] >> 64, latest["rid"] & MASK64
    rows, note, k = [latest], "", 1
    while rows[-1]["updatedAt"] >= since and k <= max_rounds:
        ids = [agg - j for j in range(k, min(k + 150, agg))]
        if not ids:
            note = f"phase {phase} start reached at {iso(rows[-1]['updatedAt'])}; earlier phases not walked"
            break
        got = multicall(net, [(proxy, sel("getRoundData(uint80)") + encode(["uint80"], [(phase << 64) | i]))
                              for i in ids], block)
        for b in got:
            if b is None:
                continue
            r = round_row(b, dec)
            if r["updatedAt"]:
                rows.append(r)
            if r["updatedAt"] and r["updatedAt"] < since:
                break
        k += len(ids)
    if rows[-1]["updatedAt"] >= since and not note:
        note = f"stopped after {max_rounds} rounds without reaching {iso(since)}"
    return sorted(rows, key=lambda r: r["updatedAt"]), note


def pairs(a: list[dict], b: list[dict], window: int = PAIR_WINDOW_S) -> list[tuple[dict, dict]]:
    out = []
    for ra in a:
        rb = min(b, key=lambda x: abs(x["updatedAt"] - ra["updatedAt"]))
        if abs(rb["updatedAt"] - ra["updatedAt"]) <= window:
            out.append((ra, rb))
    return out


def bp(x: float) -> float:
    return (x - 1) * 1e4


# Two rounds updated within 20 seconds of each other are not necessarily the
# same observation: most such pairs differ by several basis points because the
# price moved between them. So a median over the pairs measures that movement,
# not the relation. What tests the relation is an exact match: a pair whose
# ratio equals a candidate factor to within EXACT_BP, far below the movement
# and far above 8-decimal quantisation (under 1e-6 bp at these prices). Each
# test is run against the candidate and against the alternative, and only the
# first may match.
EXACT_BP = 1e-4


def exact_bp_report(label, sub, m, mname, alt, altname):
    rat = [p[0]["answer"] / p[1]["answer"] for p in sub]
    dev_m = [bp(r / m) for r in rat]
    dev_alt = [bp(r / alt) for r in rat]
    hits = [(p, d) for p, d in zip(sub, dev_m) if abs(d) < EXACT_BP]
    span = f"{iso(min(p[0]['updatedAt'] for p in sub))} to {iso(max(p[0]['updatedAt'] for p in sub))}"
    print(f"    {label}: {len(sub)} pairs within {PAIR_WINDOW_S} s, {span}; median ratio {st.median(rat)!r}")
    print(f"      equal to {mname} ({m!r}) within {EXACT_BP:g} bp: {len(hits)};"
          f" equal to {altname} ({alt!r}) within {EXACT_BP:g} bp: {sum(abs(d) < EXACT_BP for d in dev_alt)};"
          f" closest to {mname} {min(abs(d) for d in dev_m):.3e} bp, closest to {altname}"
          f" {min(abs(d) for d in dev_alt):.3e} bp")
    for p, d in hits:
        print(f"      exact: {iso(p[0]['updatedAt'])} and {iso(p[1]['updatedAt'])}"
              f" ({p[1]['updatedAt'] - p[0]['updatedAt']:+d} s), {d:+.2e} bp")


def block_before(url: str, t: int, hi: int) -> int:
    """The last block with timestamp < t, by bisection on block headers."""
    lo = 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if block_time(url, mid) < t:
            lo = mid
        else:
            hi = mid
    return lo


# ------------------------------------------------------------------ section 1

UNDERLYING = {"NVDA": ["ethereum", "optimism"], "GOOGL": ["ethereum", "optimism"], "MSFT": ["optimism"],
              "AAPL": ["optimism"], "QQQ": ["ethereum", "optimism"]}
SINCE = {"NVDA": "2026-09-04T00:00:00Z", "MSFT": "2026-09-01T00:00:00Z", "GOOGL": "2026-09-11T00:00:00Z",
         "AAPL": "2026-09-03T00:00:00Z", "QQQ": "2026-09-15T00:00:00Z"}


def section_robinhood(pins):
    print("\n== 1. Robinhood Chain feed against the underlying 24/5 feed, and the token's uiMultiplier ==")
    rh_blk = pins["robinhood"][0]
    for sym in ("NVDA", "MSFT", "GOOGL", "AAPL", "QQQ"):
        tok = RH_TOKEN[sym]
        m_now = uint(call("robinhood", tok, sel("uiMultiplier()"), rh_blk)) / 1e18
        m_new = uint(call("robinhood", tok, sel("newUIMultiplier()"), rh_blk)) / 1e18
        eff = uint(call("robinhood", tok, sel("effectiveAt()"), rh_blk))
        paused = uint(call("robinhood", tok, sel("oraclePaused()"), rh_blk))
        pre_blk = block_before(RH_ARCHIVE, eff, rh_blk) if eff else None
        m_pre = uint(call("robinhood", tok, sel("uiMultiplier()"), pre_blk, RH_ARCHIVE)) / 1e18 if pre_blk else None
        print(f"\n  {sym}: token {tok}, read at block {rh_blk}: uiMultiplier {m_now!r}, newUIMultiplier {m_new!r},"
              f" effectiveAt {iso(eff) if eff else None}, oraclePaused {paused}")
        print(f"  {sym}: uiMultiplier at block {pre_blk}, the last before effectiveAt"
              f" ({iso(block_time(RH_ARCHIVE, pre_blk)) if pre_blk else None}, via {host(RH_ARCHIVE)}): {m_pre!r}")
        since = ts(SINCE[sym])
        a, note_a = walk("robinhood", FEED[("robinhood", sym)], rh_blk, since)
        print(f"  RH feed {FEED[('robinhood', sym)]}: {len(a)} rounds {iso(a[0]['updatedAt'])} to"
              f" {iso(a[-1]['updatedAt'])} {note_a}")
        for net in UNDERLYING[sym]:
            b, note_b = walk(net, FEED[(net, sym)], pins[net][0], since)
            print(f"  {net} {sym} 24/5 feed {FEED[(net, sym)]} at block {pins[net][0]}: {len(b)} rounds"
                  f" {iso(b[0]['updatedAt'])} to {iso(b[-1]['updatedAt'])} {note_b}")
            ps = pairs(a, b)
            for label, sub, m, alt in (("before effectiveAt", [p for p in ps if p[0]["updatedAt"] < eff], m_pre, m_now),
                                       ("from effectiveAt", [p for p in ps if p[0]["updatedAt"] >= eff], m_now, m_pre)):
                if not sub:
                    print(f"    {label}: 0 pairs within {PAIR_WINDOW_S} s")
                    continue
                exact_bp_report(label, sub, m, "the multiplier in effect", alt, "the other multiplier")
            post = [r for r in a if r["updatedAt"] >= eff]
            if post and not [p for p in ps if p[0]["updatedAt"] >= eff]:
                near = sorted(((abs(min(b, key=lambda x: abs(x["updatedAt"] - r["updatedAt"]))["updatedAt"]
                                    - r["updatedAt"]), r) for r in post), key=lambda x: x[0])[:3]
                for d, r in near:
                    rb = min(b, key=lambda x: abs(x["updatedAt"] - r["updatedAt"]))
                    print(f"    nearest from effectiveAt: RH {iso(r['updatedAt'])} and {net} {iso(rb['updatedAt'])},"
                          f" {d} s apart, ratio {r['answer'] / rb['answer']!r}")


# ------------------------------------------------------------------ section 2

FRI_CLOSE = ts("2026-09-18T20:00:00Z")   # 16:00 ET
FRI_POST_END = ts("2026-09-19T00:00:00Z")  # 20:00 ET
SUN_REOPEN = ts("2026-09-21T00:00:00Z")  # Sunday 20:00 ET
WEEKEND_24_5 = [("robinhood", s) for s in ("NVDA", "MSFT", "GOOGL", "AAPL", "QQQ", "TSLA", "SPY")] + \
               [("ethereum", s) for s in ("NVDA", "GOOGL", "QQQ", "TSLA", "SPY")] + \
               [("optimism", s) for s in ("NVDA", "MSFT", "GOOGL", "AAPL", "QQQ", "TSLA", "SPY")]


def section_weekend(pins):
    print("\n== 2. The weekend of 2026-09-18 to 2026-09-21 ==")
    print("  24/5 feeds. Windows: post-market Fri 20:00Z to Sat 00:00Z (16:00 to 20:00 ET);"
          " closed Sat 00:00Z to Mon 00:00Z (Fri 20:00 ET to Sun 20:00 ET)")
    total_closed = 0
    for net, sym in WEEKEND_24_5:
        rows, note = walk(net, FEED[(net, sym)], pins[net][0], ts("2026-09-18T12:00:00Z"))
        post = [r for r in rows if FRI_CLOSE <= r["updatedAt"] < FRI_POST_END]
        closed = [r for r in rows if FRI_POST_END <= r["updatedAt"] < SUN_REOPEN]
        before = [r for r in rows if r["updatedAt"] < FRI_POST_END]
        after = [r for r in rows if r["updatedAt"] >= SUN_REOPEN]
        total_closed += len(closed)
        print(f"  {net:9} {sym:5} {FEED[(net, sym)]} block {pins[net][0]}: last before Sat 00:00Z"
              f" {iso(before[-1]['updatedAt']) if before else None}; post-market rounds {len(post)}"
              f" {[iso(r['updatedAt']) for r in post]}; rounds Sat 00:00Z to Mon 00:00Z {len(closed)}"
              f" {[iso(r['updatedAt']) for r in closed][:5]}; first at or after Mon 00:00Z"
              f" {iso(after[0]['updatedAt']) if after else None} {note}")
    print(f"  24/5 feeds read: {len(WEEKEND_24_5)}; rounds between Fri 20:00 ET and Sun 20:00 ET across all: {total_closed}")

    print("\n  BNB Smart Chain NVDA / USD (an NYSE-hours feed in the directory),"
          f" {FEED[('bsc', 'NVDA')]}, block {pins['bsc'][0]}:")
    rows, note = walk("bsc", FEED[("bsc", "NVDA")], pins["bsc"][0], ts("2026-09-18T19:00:00Z"))
    win = [r for r in rows if ts("2026-09-18T19:00:00Z") <= r["updatedAt"] <= ts("2026-09-21T14:00:00Z")]
    for r in win:
        print(f"    round {r['rid']}  updatedAt {iso(r['updatedAt'])}  answer {r['answer']!r}")
    fri = [r for r in win if r["updatedAt"] < FRI_POST_END]
    sat = [r for r in win if ts("2026-09-19T00:00:00Z") <= r["updatedAt"] < ts("2026-09-20T00:00:00Z")]
    sun = [r for r in win if ts("2026-09-20T00:00:00Z") <= r["updatedAt"] < SUN_REOPEN]
    if fri and sat and sun:
        f, s, u = fri[-1], sat[0], sun[0]
        print(f"    Friday's last against Saturday's: answer {'equal' if f['answer'] == s['answer'] else 'differs'},"
              f" updatedAt differs by {s['updatedAt'] - f['updatedAt']} s")
        print(f"    Saturday's against Sunday's: answer {'equal' if s['answer'] == u['answer'] else 'differs'},"
              f" updatedAt differs by {u['updatedAt'] - s['updatedAt']} s")
        mon = [r for r in win if r["updatedAt"] >= SUN_REOPEN]
        if mon:
            print(f"    Sunday's against Monday's first: answer {'equal' if u['answer'] == mon[0]['answer'] else 'differs'},"
                  f" updatedAt differs by {mon[0]['updatedAt'] - u['updatedAt']} s")
    print(f"    {note}")


# ------------------------------------------------------------------ section 3

# xStocks on Ink: token, v1 wrapper, v2 wrapper, the Ink feed, the underlying
# symbol. Wrapper addresses are the ones the issuer's address list gave in the
# xStocks pass (2026-09-24); whether each holds code on Ink is read here.
INK_WRAPPED = {
    "wNVDAx": (NVDAX, WRAP_V1, WRAP_V2, "0x2328B6602e93d07f69099a8b120846409B9D3047", "NVDA"),
    "wSPYx": ("0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48", "0xc88fcd8b874fdb3256e8b55b3decb8c24eab4c02",
              "0xe7e553cd128f0011777323a0b44a7b96ea1cb540", "0x713e7F6f38779DC38a64B26862f2CfF1C10cADbf", "SPY"),
    "wQQQx": ("0xa753a7395cae905cd615da0b82a53e0560f250af", "0xdbd9232fee15351068fe02f0683146e16d9f2cea",
              "0x4c1ae29c159838fc1b224636e28e086eb69101f7", "0x36E2BeFa7Ec599Bd30536c5F0f699818FDFE1Dd7", "QQQ"),
}


def section_ink(pins):
    print("\n== 3. Ink wrapped-xStocks feeds, the underlying, and the two wrappers ==")
    eb, ib = pins["ethereum"][0], pins["ink"][0]
    one = sel("convertToAssets(uint256)") + encode(["uint256"], [10**18])
    since = ts("2026-09-21T00:00:00Z")
    for name, (tok, w1, w2, feed, und) in INK_WRAPPED.items():
        print(f"\n  {name}:")
        rates = {}
        for label, w in (("v1", w1), ("v2", w2)):
            for net, blk in (("ethereum", eb), ("ink", ib)):
                code = rpc(RPC[net], "eth_getCode", [w, hex(blk)])
                has = len(code) > 2
                r = uint(call(net, w, one, blk)) if has else None
                a = call(net, w, sel("asset()"), blk) if has else None
                supply = uint(call(net, w, sel("totalSupply()"), blk)) if has else None
                assets = uint(call(net, w, sel("totalAssets()"), blk)) if has else None
                # An ERC-4626 vault with no shares answers convertToAssets from
                # its virtual share and asset, (totalAssets + 1) / (totalSupply + 1)
                # scaled, which is an artefact of being empty and not a rate.
                empty = has and supply == 0
                rates[(label, net)] = r / 1e18 if (r is not None and not empty) else None
                shown = "EMPTY VAULT, no rate" if empty else repr(rates[(label, net)])
                print(f"    {label} {w} on {net} block {blk}: code {len(code) // 2 - 1} bytes,"
                      f" totalSupply {supply / 1e18 if supply is not None else None!r},"
                      f" totalAssets {assets} raw, convertToAssets(1e18) {shown}"
                      f"{f' (raw answer {r / 1e18!r})' if empty and r is not None else ''},"
                      f" asset 0x{a[-20:].hex() if a else None}")
        m_eth = uint(call("ethereum", tok, sel("getCurrentMultiplier()"), eb))
        m_ink = uint(call("ink", tok, sel("getCurrentMultiplier()"), ib))
        print(f"    {name[1:]} {tok} getCurrentMultiplier: Ethereum {m_eth / 1e18 if m_eth else None!r},"
              f" Ink {m_ink / 1e18 if m_ink else None!r}")
        a, note_a = walk("ink", feed, ib, since)
        print(f"    Ink feed {feed}: {len(a)} rounds {iso(a[0]['updatedAt'])} to {iso(a[-1]['updatedAt'])} {note_a}")
        v1, v2 = rates[("v1", "ethereum")], rates[("v2", "ink")] or rates[("v2", "ethereum")]
        if v1 is None or v2 is None:
            print("    a wrapper rate could not be read; no test")
            continue
        print(f"    v2 rate over v1 rate {bp(v2 / v1):+.2f} bp")
        for net in ("ethereum", "optimism"):
            b, note_b = walk(net, FEED[(net, und)], pins[net][0], since)
            ps = pairs(a, b)
            print(f"    {net} {und} 24/5 at block {pins[net][0]}: {len(b)} rounds {note_b};"
                  f" pairs within {PAIR_WINDOW_S} s: {len(ps)}")
            if not ps:
                continue
            med = st.median([p[0]["answer"] / p[1]["answer"] for p in ps])
            exact_bp_report("Ink feed over underlying", ps, v1, "the v1 wrapper rate on Ethereum",
                            v2, "the v2 wrapper rate")
            print(f"      median against the v2 rate {bp(med / v2):+.2f} bp, against the v1 rate {bp(med / v1):+.4f} bp")


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)
    print(f"started {dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}")
    print("endpoints (host only):", *[f"{k}={host(v)}" for k, v in RPC.items()], f"robinhood-archive={host(RH_ARCHIVE)}")
    pins = {}
    for net in RPC:
        pins[net] = pin(net)
        print(f"  pinned {net}: block {pins[net][0]} at {iso(pins[net][1])}")
    sections = (section_robinhood, section_weekend, section_ink)
    if "--ink-only" in sys.argv:
        sections = (section_ink,)
    for section in sections:
        try:
            section(pins)
        except Unanswered as e:
            print(f"  UNANSWERED: {e}. Not a finding about any feed.")
    print(f"\nfinished {dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
