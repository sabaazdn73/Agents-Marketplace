"""Checks the tokenized-equity universe the site serves against its own
definition and against the chain.

Run: ./venv/bin/python scripts/te_universe_selfcheck.py [--seed N] [--sample 30]
         [--no-chain] [--src <universe pass dir>] [--base-url http://localhost:8xxx]

Five groups:

  load        the data file loads, and what it costs in memory (tracemalloc
              over a cold load: resident after, and the transient peak).

  summary     /api/te/summary reconciles: chain_list sums to tokens; tokens,
              issuers and chains are recounted here from the raw rows with
              the four tests applied independently of the loader; every record
              is either counted or left out under exactly one reason. With
              --src, the same recount from the universe pass's universe.json.
              With --base-url, the running app's answer equals the local one.

  content     every listed token has controls and dated, linked eligibility;
              the controls rows cover every issuer counted and their token
              counts sum to the total; the file carries no LI.FI field and no
              ISIN (E18: no issuer figure is served).

  chain       30 random listed tokens (seeded; the seed is printed) and the
              film's six, re-read at a block or slot newer than the record's:
              symbol, decimals, total supply above zero, and the proxy
              (EIP-1967 implementation slot for xStocks, beacon slot for
              Ondo, Robinhood and bStocks, the 1-byte B20 code for Coinbase;
              on Solana the Token-2022 owner and the mint, freeze and
              permanent-delegate authorities).

  pacing      one call at a time with a pause between, public endpoints
              only: the Infura key is shared with production and is never
              used. An endpoint that does not answer is reported as
              unreachable, a fact about the call, never as a token failure.

Exit status: 0 all passed; 1 a check failed; 2 passed but the chain group is
incomplete (more than a fifth of the sampled tokens unreachable).
"""

from __future__ import annotations

import argparse
import gc
import gzip
import json
import os
import random
import re
import sys
import time
import tracemalloc
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:  # noqa: BLE001
    pass

import httpx  # noqa: E402

FAILURES: list[str] = []
PAUSE_S = 0.35

FILM_KEYS = (
    "42161/0xc845b2894dbddd03858fd2d643b4ef725fe0849d",   # NVDAx, Arbitrum
    "solana/Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",  # NVDAx, Solana
    "8453/0xb20000000000000000000078ee7ce2fe4908108c",    # NVDAc, Base
    "1/0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee",       # NVDAon, Ethereum
    "56/0x02fca66c1d1afb4e2a7884261eb00f63598a7436",      # NVDAB, BNB Chain
    "4663/0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",    # NVDA, Robinhood Chain
)


# Public endpoints only. The Infura key is shared with production and is
# never used here.
RPCS = {
    "ethereum": ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
    "bsc": ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"],
    "arbitrum": ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
    "base": ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    "robinhood": ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood-rpc.publicnode.com"],
    "hyperevm": ["https://rpc.hyperliquid.xyz/evm"],
    "solana": ["https://api.mainnet-beta.solana.com"],
}

IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50"
TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

SEL_SYMBOL, SEL_DECIMALS, SEL_SUPPLY = "0x95d89b41", "0x313ce567", "0x18160ddd"


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
    if not ok:
        FAILURES.append(label)


def _redact(s: str) -> str:
    return re.sub(r"/v3/[0-9a-fA-F]{16,}", "/v3/<key>", s)


class Unreachable(Exception):
    pass


class Rpc:
    def __init__(self) -> None:
        self.client = httpx.Client(timeout=15.0)
        self.calls = 0

    def call(self, chain: str, method: str, params: list):
        last = None
        for url in [u for u in RPCS[chain] if u]:
            time.sleep(PAUSE_S)
            self.calls += 1
            try:
                r = self.client.post(url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
                if r.status_code != 200:
                    last = f"HTTP {r.status_code} from {_redact(url)}"
                    continue
                body = r.json()
                if "error" in body:
                    last = f"{_redact(url)}: {str(body['error'])[:160]}"
                    continue
                return body["result"]
            except Exception as e:  # noqa: BLE001
                last = f"{type(e).__name__} from {_redact(url)}"
        raise Unreachable(last or "no endpoint")


def _abi_string(h: str) -> str | None:
    b = bytes.fromhex(h[2:]) if h and h.startswith("0x") else b""
    if len(b) >= 64:
        off = int.from_bytes(b[:32], "big")
        if off + 32 <= len(b):
            n = int.from_bytes(b[off:off + 32], "big")
            return b[off + 32: off + 32 + n].decode("utf-8", "replace")
    if len(b) == 32:
        return b.rstrip(b"\0").decode("utf-8", "replace")
    return None


def _addr_from_slot(h: str) -> str:
    return "0x" + h[-40:].lower()


# ── groups ──────────────────────────────────────────────────────────────────


def group_load():
    print("load")
    from core.te import universe as U
    gc.collect()
    tracemalloc.start()
    t = time.time()
    u = U.load_universe()
    secs = time.time() - t
    gc.collect()
    cur, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    check(True, "data file loads", f"{u.file_bytes:,} bytes gzip, {secs:.2f} s")
    check(cur < 12e6, "Python objects kept after load under 12 MB", f"{cur / 1e6:.2f} MB (transient peak {peak / 1e6:.2f} MB)")
    # Process RSS, in a fresh interpreter without tracemalloc (which inflates
    # it). It includes what the allocator keeps after the parse's transient,
    # which depends on the platform: glibc gives it back after malloc_trim,
    # macOS mostly does not. Reported, not asserted.
    probe = (
        "import os,subprocess,sys\n"
        "r=lambda:int(subprocess.check_output(['ps','-o','rss=','-p',str(os.getpid())]))/1024\n"
        "import core.te.universe as U\n"
        "a=r();U.load_universe();b=r()\n"
        "print(f'{a:.1f} {b:.1f}')\n"
    )
    try:
        import subprocess
        out = subprocess.check_output([sys.executable, "-c", probe], cwd=str(Path(__file__).resolve().parent.parent),
                                      text=True, timeout=60).split()
        a, b = float(out[0]), float(out[1])
        print(f"        process RSS {a:.1f} -> {b:.1f} MB ({b - a:+.1f}) on {sys.platform}, fresh interpreter")
    except Exception as e:  # noqa: BLE001
        print(f"        process RSS not measured ({type(e).__name__})")
    return u


def _raw_rows(u):
    return [u.row(i) for i in range(len(u._rows))]


def group_summary(u, src: Path | None, base_url: str | None):
    print("summary")
    from core.te.universe import SITE_CHAINS
    s = u.summary()
    check(sum(c["tokens"] for c in s["chain_list"]) == s["tokens"], "chain_list sums to tokens",
          f"{s['tokens']:,}")
    check(len(s["chain_list"]) == s["chains"], "chains equals the length of chain_list", str(s["chains"]))

    # Independent recount from the raw rows.
    counted, reasons = [], {"excluded_listing": len(u._excluded), "not_deployed": 0, "scope_not_established": 0, "supply_zero": 0, "chain_out_of_scope": 0}
    for r in _raw_rows(u):
        if r["status"] != "verified":
            reasons["not_deployed"] += 1
        elif r["scope"] not in ("us_confirmed", "us_ticker_match"):
            reasons["scope_not_established"] += 1
        elif not (r["supply"] and Decimal(r["supply"]) > 0):
            reasons["supply_zero"] += 1
        elif r["chain"] not in SITE_CHAINS:
            reasons["chain_out_of_scope"] += 1
        else:
            counted.append(r)
    check(len(counted) == s["tokens"], "tokens recounted from the rows", f"{len(counted):,}")
    check(len({r['issuer'] for r in counted}) == s["issuers"], "issuers recounted", str(s["issuers"]))
    check(len({r['chain'] for r in counted}) == s["chains"], "chains recounted", str(s["chains"]))
    left = {x["reason"]: x["records"] for x in s["left_out"]["by_reason"]}
    check(left == reasons, "left-out reasons recounted", json.dumps(reasons))
    check(s["tokens"] + sum(left.values()) == s["records_read"],
          "every record read is counted or left out exactly once", f"{s['records_read']:,}")
    check(s["records_read"] == int(u.source["records"]) + int(u.source["excluded_candidates"]),
          "records_read is the records plus the excluded candidates",
          f"{u.source['records']:,} + {u.source['excluded_candidates']:,}")
    check(s["versions_listed"] == s["tokens"] and s["versions_with_pool"] + s["versions_without_pool"] == s["tokens"],
          "versions with and without a pool sum to the versions listed",
          f"{s['versions_with_pool']:,} + {s['versions_without_pool']:,}")
    check(sum(c["with_pool"] for c in s["chain_list"]) == s["versions_with_pool"], "per-chain with_pool sums")
    check("issuer-by-chain versions" in s["definition"]["token"], "the token definition says issuer-by-chain versions")
    check({c["scope"] for c in s["coverage"]} == {"xStocks on Solana", "Ondo on Solana", "Coinbase on Base"},
          "coverage caveats present", f"Solana xStocks missing {s['coverage'][0].get('missing_us_underlyings')}")

    if src:
        raw = json.loads((src / "universe.json").read_bytes())["records"]
        n = sum(1 for r in raw if r["verification"]["status"] == "verified"
                and r["scope"] in ("us_confirmed", "us_ticker_match")
                and Decimal((r.get("onchain") or {}).get("total_supply") or "0") > 0
                and r["chain"] in SITE_CHAINS)
        fixed = [c.split(":")[0:3] for c in u.corrections if "normalised" in c]
        newly = sum(1 for iss, ch, addr in fixed
                    if (rec := u.record(f"{iss}:{ch}:{addr.split(' ')[0]}", controls=False)) and rec["listed"])
        check(n + newly == s["tokens"], "tokens recounted from the universe pass's universe.json, plus the corrections",
              f"{n:,} + {newly} listed after ticker normalisation")
        vs = sum(1 for r in raw if r["verification"]["status"] == "verified"
                 and Decimal((r.get("onchain") or {}).get("total_supply") or "0") > 0)
        print(f"        (universe.json: {len(raw):,} records, {vs:,} verified with supply > 0 on all chains and scopes)")

    if base_url:
        try:
            live = httpx.get(f"{base_url.rstrip('/')}/api/te/summary", timeout=30).json()
            check(live == json.loads(json.dumps(s)), "the running app's /api/te/summary equals the local one", base_url)
        except Exception as e:  # noqa: BLE001
            check(False, "the running app answers /api/te/summary", f"{type(e).__name__}: {e}")
    return s


def group_content(u, s):
    print("content")
    from core.te import controls as C
    missing_ctl, missing_elig = 0, 0
    for i in u.listed_indices():
        rec = u.expand(i, controls=True)
        if not rec["controls"]:
            missing_ctl += 1
        e = rec["eligibility"] or {}
        if not (e.get("text") and e.get("url") and e.get("read_on")):
            missing_elig += 1
    check(missing_ctl == 0, "every listed token has its six controls", f"{missing_ctl} without")
    check(missing_elig == 0, "every listed token has eligibility text, URL and read date", f"{missing_elig} without")
    rows = C.by_issuer(u)["rows"]
    check({r["issuer_slug"] for r in rows} == {x["issuer"] for x in s["issuer_list"]},
          "controls rows cover exactly the issuers counted")
    check(sum(r["tokens"] for r in rows) == s["tokens"], "controls rows' tokens sum to the total",
          f"{sum(r['tokens'] for r in rows):,}")
    rh = next((r for r in rows if r["issuer_slug"] == "robinhood"), None)
    sim = (rh or {}).get("burn", {}).get("simulation")
    check(bool(sim) and any(c.get("result") == "0x" for c in sim["calls"]) and any("0xe2517d3f" in json.dumps(c.get("error", "")) for c in sim["calls"]),
          "Robinhood burn carries the adminBurn simulation as measured (0x from the holder, 0xe2517d3f from a stranger)")
    # One standard for what an upgrade can reach.
    fam = {r["family"]: r for r in rows}
    for f in ("xstocks-evm", "bstocks-evm"):
        st = fam.get(f, {}).get("burn", {}).get("state", "")
        check(st.startswith("no direct function; reachable by an upgrade with no delay"), f"{f} burn names the no-delay upgrade path", st[:90])
    for k in ("pause", "freeze", "burn"):
        up = (fam.get("ondo-evm", {}).get(k, {}).get("upgrade_path") or {}).get("text", "")
        check("2 h timelock" in up, f"ondo-evm {k} names the 2 h timelock", up[:80])
    fh = fam.get("xstocks-evm", {}).get("freeze", {})
    check("token owner()" in (fh.get("text") or ""), "xStocks EVM freeze names the token owner() that can swap the list")
    cbf = fam.get("coinbase-evm", {}).get("freeze", {})
    check((cbf.get("holder") or {}).get("address") == "0xec0f05c174e54fbf0fe16ad930a8afebce612812", "Coinbase freeze holder is policyAdmin(5)")

    # Served text: booleans for capability, no local file names, no Python
    # reprs, no mis-decoded UTF-8, no earlier-pass claims without a block.
    served = [C.by_issuer(u), C.by_chain(u)] + [C.by_key(u, k) for k in u.listed_keys()[::97]]
    caps = []

    def walk(x):
        if isinstance(x, dict):
            if "capability" in x:
                caps.append(x["capability"])
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(served)
    check(all(c in (True, False, None) for c in caps), "capability is true, false or null everywhere", f"{len(caps):,} cells")
    # The served data file's own name (backend/data/te_universe.json.gz) is
    # this repository's provenance, not a universe-pass file; it is removed
    # before the scan.
    blob = (json.dumps(served, ensure_ascii=False) + json.dumps(u.summary(), ensure_ascii=False)).replace(
        "backend/data/te_universe.json.gz", "")
    for pat, label in ((r"reads/|src/|scratch/|UNIVERSE\.md|NOTES\.md|\.json\b", "no local file names"),
                       (r"\{'", "no Python dict reprs"), (r"Ã|â€", "no mis-decoded UTF-8"),
                       (r"earlier pass", "no earlier-pass claims")):
        hits = re.findall(r".{0,30}(?:" + pat + r").{0,30}", blob)
        check(not hits, f"served controls and summary: {label}", hits[0] if hits else "")

    from core.te import search as S
    r = S.search(u, "0xfa15e42c18cf57aeef4b1bac1cee7754af7cfe42")
    check("Hong Kong" in (r.get("reason") or ""), "search answers an excluded address with its reason", r.get("reason") or "")
    r = S.search(u, "NVDAx")
    res = (r.get("results") or [{}])[0]
    check(res.get("symbol") == "NVDAx" and res.get("group") == "mixed", "a symbol match names the token and group is always set")
    r = S.search(u, "0x02fca66c1d1afb4e2a7884261eb00f63598a7436")
    res = (r.get("results") or [{}])[0]
    check(res.get("issuer") == "bStocks" and res.get("chain") == "BNB Chain" and res.get("key"), "a single-version match carries issuer, chain and key")
    t = C.by_issuer(u, None, "ton")
    check(t["rows"] == [] and t.get("records_on_chain", 0) > 0 and bool(t.get("reason")), "an out-of-scope chain answers rows [] with a reason and the count")
    b = C.by_issuer(u, None, "base")
    check([r["issuer_slug"] for r in b["rows"]] == ["coinbase"], "by=issuer&chain=base filters to Base")

    from core.te.universe import UNIVERSE_FILE
    text = gzip.open(UNIVERSE_FILE, "rb").read().decode()
    check(not re.search(r"Ã|â€", text), "no mis-decoded UTF-8 in the data file")
    check(not re.search(r'"[^"]*lifi[^"]*"\s*:', text, re.I), "no LI.FI field in the data file")
    check('"isin"' not in text.lower(), "no ISIN field in the data file (E18)")
    for banned in ("jup.ag", "coingecko", "geckoterminal", "api.coinbase.com", "backed.fi/api", "api.xstocks"):
        check(banned not in text.lower(), f"no {banned} reference in the data file")


def _reread_evm(rpc: Rpc, u, rec: dict, blocks: dict) -> str | None:
    chain = rec["chain"]
    if chain not in blocks:
        blocks[chain] = int(rpc.call(chain, "eth_blockNumber", []), 16)
    b = blocks[chain]
    tag = hex(b)
    old = rec["verification"]["block_or_slot"]
    addr = rec["address"]
    problems = []
    if isinstance(old, int) and b <= old:
        problems.append(f"block {b} is not newer than the record's {old}")
    sym = _abi_string(rpc.call(chain, "eth_call", [{"to": addr, "data": SEL_SYMBOL}, tag]))
    dec = int(rpc.call(chain, "eth_call", [{"to": addr, "data": SEL_DECIMALS}, tag]), 16)
    sup = int(rpc.call(chain, "eth_call", [{"to": addr, "data": SEL_SUPPLY}, tag]), 16)
    if sym != rec["symbol"]:
        problems.append(f"symbol {sym!r} != {rec['symbol']!r}")
    if dec != rec["decimals"]:
        problems.append(f"decimals {dec} != {rec['decimals']}")
    if sup <= 0:
        problems.append("total supply is 0 now")
    up = (rec["controls"] or {}).get("upgrade") or {}
    if rec["issuer"] == "xstocks":
        impl = _addr_from_slot(rpc.call(chain, "eth_getStorageAt", [addr, IMPL_SLOT, tag]))
        want = (up.get("implementation") or "").lower()
        proxy = f"implementation {impl[:10]}…"
        if impl != want:
            problems.append(f"implementation {impl} != {want}")
    elif rec["issuer"] in ("ondo", "robinhood", "bstocks"):
        beacon = _addr_from_slot(rpc.call(chain, "eth_getStorageAt", [addr, BEACON_SLOT, tag]))
        want = (up.get("beacon") or "").lower()
        proxy = f"beacon {beacon[:10]}…"
        if beacon != want:
            problems.append(f"beacon {beacon} != {want}")
    elif rec["issuer"] == "coinbase":
        code = rpc.call(chain, "eth_getCode", [addr, tag])
        n = (len(code) - 2) // 2
        proxy = f"code {n} byte"
        if n != 1:
            problems.append(f"code is {n} bytes, not the 1-byte B20 precompile")
    else:
        proxy = "proxy not checked"
    scale = Decimal(sup) / (Decimal(10) ** dec)
    old_sup = Decimal(rec["total_supply"] or "0")
    change = f"{(scale - old_sup) / old_sup * 100:+.2f}%" if old_sup else "n/a"
    detail = f"block {b} (was {old}); {sym}, {dec} dp, supply {scale:.6g} ({change} since); {proxy}"
    return ("; ".join(problems) + " | " + detail) if problems else detail, not problems


def _reread_solana(rpc: Rpc, u, rec: dict) -> tuple[str, bool]:
    res = rpc.call("solana", "getAccountInfo", [rec["address"], {"encoding": "jsonParsed", "commitment": "finalized"}])
    slot = res["context"]["slot"]
    v = res["value"] or {}
    info = ((v.get("data") or {}).get("parsed") or {}).get("info") or {}
    exts = {e.get("extension"): e.get("state") or {} for e in info.get("extensions") or []}
    problems = []
    old = rec["verification"]["block_or_slot"]
    if isinstance(old, int) and slot <= old:
        problems.append(f"slot {slot} is not newer than the record's {old}")
    if v.get("owner") != TOKEN_2022:
        problems.append(f"owner {v.get('owner')} is not Token-2022")
    sym = (exts.get("tokenMetadata") or {}).get("symbol")
    if sym != rec["symbol"]:
        problems.append(f"symbol {sym!r} != {rec['symbol']!r}")
    if info.get("decimals") != rec["decimals"]:
        problems.append(f"decimals {info.get('decimals')} != {rec['decimals']}")
    sup = int(info.get("supply") or 0)
    if sup <= 0:
        problems.append("supply is 0 now")
    c = rec["controls"] or {}
    want = {
        "mint authority": ((c.get("mint") or {}).get("holder") or {}).get("address"),
        "freeze authority": ((c.get("freeze") or {}).get("holder") or {}).get("address"),
    }
    got = {"mint authority": info.get("mintAuthority"), "freeze authority": info.get("freezeAuthority")}
    if rec["issuer"] == "xstocks":
        want["permanent delegate"] = ((c.get("burn") or {}).get("holder") or {}).get("address")
        got["permanent delegate"] = (exts.get("permanentDelegate") or {}).get("delegate")
    for k in want:
        if want[k] != got[k]:
            problems.append(f"{k} {got[k]} != {want[k]}")
    scale = Decimal(sup) / (Decimal(10) ** int(info.get("decimals") or 0))
    detail = f"slot {slot} (was {old}); {sym}, {info.get('decimals')} dp, supply {scale:.6g}; Token-2022, {', '.join(want)} match"
    return (("; ".join(problems) + " | " + detail) if problems else detail), not problems


def group_chain(u, sample: int, seed: int) -> int:
    print(f"chain (seed {seed}, {sample} random listed tokens plus the film's six)")
    rng = random.Random(seed)
    keys = u.listed_keys()
    picked = rng.sample(keys, sample)
    todo = [(k, "film") for k in FILM_KEYS] + [(k, "random") for k in picked if k not in FILM_KEYS]
    rpc = Rpc()
    blocks: dict = {}
    unreachable = 0
    for key, why in todo:
        rec = u.record(key)
        if rec is None:
            check(False, f"{why} {key} is in the universe")
            continue
        label = f"{why} {rec['symbol']} {rec['issuer_name']} {rec['chain_name']} {key}"
        if not rec["listed"]:
            check(False, label, f"not listed: {rec.get('not_listed_reason')}")
            continue
        try:
            if rec["chain"] == "solana":
                detail, ok = _reread_solana(rpc, u, rec)
            else:
                detail, ok = _reread_evm(rpc, u, rec, blocks)
            check(ok, label, detail)
        except Unreachable as e:
            unreachable += 1
            print(f"  skip  {label}  unreachable: {e} (a fact about the call, not the token)")
    print(f"        {rpc.calls} RPC calls, {PAUSE_S}s apart; {unreachable} of {len(todo)} tokens unreachable")
    return 2 if unreachable > len(todo) / 5 else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--sample", type=int, default=30)
    ap.add_argument("--no-chain", action="store_true")
    ap.add_argument("--src", type=Path, default=None)
    ap.add_argument("--base-url", default=None)
    a = ap.parse_args()
    seed = a.seed if a.seed is not None else random.SystemRandom().randrange(1, 10**6)
    u = group_load()
    s = group_summary(u, a.src, a.base_url)
    group_content(u, s)
    incomplete = 0
    if not a.no_chain:
        incomplete = group_chain(u, a.sample, seed)
    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED")
        return 1
    print("all passed" + (" (chain group incomplete)" if incomplete else ""))
    return incomplete


if __name__ == "__main__":
    raise SystemExit(main())
