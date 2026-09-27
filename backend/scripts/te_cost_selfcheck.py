"""
te_cost_selfcheck.py

Checks the tokenized-equity costs the API serves, by two routes that do not
share code with each other, and checks that the served figures reconcile.
Public RPCs only.

    ./venv/bin/python scripts/te_cost_selfcheck.py [--fresh] [--samples 20] [--chains 8453,4663] [--out report.json]

1. Probe identity: the committed source and runtime match the hashes in
   core/te/probe_bytecode.py (and a rebuild, when forge is installed).
2. Re-quote: random (version, size) pairs, each re-quoted with the probe on
   the same pool at the stored block. tokens out must equal the stored raw
   figure exactly, and the cost recomputed from it must be within 1 bp of
   what /api/te/underlying serves for that version and size.
3. Independent re-quote, for pairs on V3-math pools: core/te/v3_walk.py reads
   the pool's state at the block (slot0, liquidity, fee, tick bitmap, ticks)
   and computes the swap in Python from ports of V3's swap arithmetic; no
   pool code runs. Its output must equal the stored figure to the wei.
   Historical state is short-lived on most public RPCs (BSC about 110
   blocks, Robinhood Chain about 10 minutes), so --fresh refreshes each chain
   (under the cost cycle's lease) and checks it straight away. A pair that
   cannot be re-read at its block is a FAILURE, not a skip.
4. Reconciliation, over every stored version:
   - a filled row has filled_fraction 1 and a cost; a partial row has
     filled_fraction below 1, no cost and pool_usd above 0; rows with no
     quote (no_pool, not_searched, too_thin, not_a_venue, held) and failed
     rows have no cost and a reason;
   - the served best at each size follows the rule: the lowest all-in price
     per share among filled versions with a read share ratio, never a partial
     one or one whose ratio is not read (/underlying at 1,000 and 10,000,
     /list for every group, /curve per chain and stop).

Exit status 0 only when every check passes.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import random
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from core.te import cost_views  # noqa: E402
from core.te.chains import CHAINS, archive_endpoints, latest_endpoints, router_for  # noqa: E402
from core.te.cost import LIFI_FEE_RATE, SIZES, _family, _mid, build_req, unpack  # noqa: E402
from core.te.cost_inputs import load_inputs  # noqa: E402
from core.te.cost_store import get_store  # noqa: E402
from core.te.cost_worker import _native_prices, lease_owner, run_one_chain, write_list  # noqa: E402
from core.te.gasusd import ROUTER_ALLOWANCE_GAS, TX_BASE_GAS  # noqa: E402
from core.te.probe import quote_many  # noqa: E402
from core.te.probe_bytecode import RUNTIME_HEX, RUNTIME_SHA256, SOURCE_SHA256  # noqa: E402
from core.te.rpcclient import ChainRpc, RpcError, public_reason  # noqa: E402
from core.te import v3_walk  # noqa: E402
from core.te.cost_job import decode_pools  # noqa: E402
import bson  # noqa: E402  (pymongo's, for document sizes as Mongo counts them)

MAX_DOC_BYTES = 1_000_000

REPO = ROOT.parent
OWNER = None  # set in main(): hostname:pid:selfcheck
results: list[dict] = []


def check(name: str, ok: bool | None, detail="") -> None:
    results.append({"check": name, "ok": ok, "detail": detail})
    tag = "ok  " if ok else ("skip" if ok is None else "FAIL")
    print(f"  {tag}  {name}  {detail}"[:400], flush=True)


# ── 1. probe identity ────────────────────────────────────────────────────────

def probe_identity() -> None:
    print("probe identity")
    src = (REPO / "contracts" / "src" / "TnegaSwapProbe.sol").read_bytes()
    check("source sha256 matches probe_bytecode.py", hashlib.sha256(src).hexdigest() == SOURCE_SHA256)
    rt = bytes.fromhex(RUNTIME_HEX[2:])
    check("runtime sha256 matches probe_bytecode.py", hashlib.sha256(rt).hexdigest() == RUNTIME_SHA256)
    if not shutil.which("forge"):
        check("rebuild reproduces the runtime", None, "forge not installed")
        return
    r = subprocess.run(["forge", "build", "src/TnegaSwapProbe.sol"], cwd=REPO / "contracts",
                       env={**__import__("os").environ, "FOUNDRY_PROFILE": "probe"}, capture_output=True, text=True)
    out = REPO / "contracts" / "out-probe" / "TnegaSwapProbe.sol" / "TnegaSwapProbe.json"
    if r.returncode or not out.exists():
        check("rebuild reproduces the runtime", False, r.stderr[-200:])
        return
    built = json.loads(out.read_text())["deployedBytecode"]["object"]
    check("rebuild reproduces the runtime", built.lower() == RUNTIME_HEX.lower())


# ── 2. re-quote ──────────────────────────────────────────────────────────────

def _requote_endpoints(chain_id: int):
    eps = archive_endpoints(chain_id) + [e for e in latest_endpoints(chain_id) if e.url not in {a.url for a in archive_endpoints(chain_id)}]
    return eps


def recompute(doc: dict, rec: dict, size: int) -> dict:
    i = SIZES.index(size)
    pools = [unpack(x) for x in doc["pools"]]
    p = pools[doc["pool"][i]]
    req = build_req(rec, p, size)
    last = None
    for ep in _requote_endpoints(rec["chain_id"]):
        rpc = ChainRpc(rec["chain_id"], [ep], min_interval=0.3, retries_per_endpoint=4)
        try:
            q = quote_many(rpc, [req], doc["block"], at=router_for(rec["chain_id"], _family(p)))[0]
            return {"q": q, "endpoint": ep.label, "pool": p}
        except RpcError as e:
            last = e
    return {"error": last and f"{last.kind}: {last.message[:160]}"}


def cost_from(q: dict, doc: dict, rec: dict, p: dict, size: int) -> float:
    dec = {a.lower(): d for _s, (a, d) in CHAINS[rec["chain_id"]]["stables"].items()}[p["qa"]]
    tokens = q["received"] / 10 ** rec["decimals"]
    mid = _mid(q["sqrt_price_x96"], rec, p, dec)
    g = doc["gas_ctx"]
    gas = (q["gas_used"] + TX_BASE_GAS + ROUTER_ALLOWANCE_GAS) * g["gas_price_gwei"] * 1e-9 * g["native_usd"]
    total = (size - tokens * mid) + gas + (g["l1_fee_usd"] or 0) + LIFI_FEE_RATE * size
    return total / size * 1e4


async def requote(store, docs: list[dict], recs: dict, n: int, rng: random.Random) -> None:
    pairs = [(d, s) for d in docs if d.get("state") in ("measured", "partial") for s in SIZES
             if d["status"][SIZES.index(s)] in ("filled", "partial")]
    rng.shuffle(pairs)
    for d, s in pairs[:n]:
        rec = recs[d["key"]]
        i = SIZES.index(s)
        r = recompute(d, rec, s)
        name = f"re-quote {d['symbol']} {d['chain']} ${s:,} at block {d['block']}"
        if "error" in r:
            window = "outside the state window" if "not available" in (r["error"] or "") or "missing trie" in (r["error"] or "") \
                or "archive" in (r["error"] or "").lower() or "Unknown state" in (r["error"] or "") \
                or '"not supported"' in (r["error"] or "") else "rpc error"
            # A figure that cannot be re-checked is a failure of the check, not a pass
            # and not a skip: run with --fresh inside the chains' state windows.
            check(name, False, f"{window}: {public_reason(RpcError('rpc', r['error'] or ''))}")
            continue
        q = r["q"]
        # The independent path: a tick walk in Python from the pool's state at
        # the block (V3-math pools); no pool code is run.
        if r["pool"]["f"] == "v3":
            await independent(d, rec, r["pool"], s, i)
        if d["status"][i] == "partial":
            ok = q.get("status") == "partial" and str(q.get("received")) == d["tokens_out_raw"][i] \
                and abs(q["filled_fraction"] - d["filled_fraction"][i]) < 1e-6
            check(name + " (partial)", ok, f"stored ff {d['filled_fraction'][i]} vs {q.get('filled_fraction')}; via {r['endpoint']}")
            continue
        exact = q.get("ok") and str(q["received"]) == d["tokens_out_raw"][i]
        _code, view = await cost_views.underlying_view(store, d["underlying"], s)
        served = next((v for v in view.get("versions", []) if v["key"] == d["key"]), None)
        bps = cost_from(q, d, rec, r["pool"], s) if q.get("ok") else None
        diff = abs(bps - served["cost_bps"]) if (bps is not None and served and served["cost_bps"] is not None) else None
        check(name, bool(exact and diff is not None and diff <= 1.0),
              f"tokens out {'equal' if exact else 'DIFFER'}; served {served and served['cost_bps']} bps, "
              f"recomputed {bps and round(bps, 3)} bps, diff {diff and round(diff, 4)}; via {r['endpoint']}")


async def independent(d: dict, rec: dict, p: dict, s: int, i: int) -> None:
    req = build_req(rec, p, s)
    name = f"tick walk {d['symbol']} {d['chain']} ${s:,} at block {d['block']}"
    errors = []
    for ep in _requote_endpoints(rec["chain_id"]):
        rpc = ChainRpc(rec["chain_id"], [ep], min_interval=0.3, retries_per_endpoint=5, timeout=20)
        try:
            w = await asyncio.to_thread(v3_walk.quote_exact_in, rpc, p["pool"], req.zero_for_one, req.amount_in, d["block"])
        except RpcError as e:
            errors.append(f"{ep.label}: {public_reason(e)}")
            continue
        if not w.get("ok"):
            check(name, None, f"not V3 math: {w.get('reason')}")
            return
        same = str(w["out"]) == d["tokens_out_raw"][i]
        check(name, same, f"walk {w['out']} vs stored {d['tokens_out_raw'][i]} ({w['steps']} steps, {w['reads']} reads, "
                          f"fee {w['fee_ppm']}); via {ep.label}")
        return
    check(name, False, "could not read the pool at the block: " + "; ".join(errors))


# ── 3. reconciliation ────────────────────────────────────────────────────────

async def reconcile(store, docs: list[dict]) -> None:
    print("reconciliation")
    bad = []
    for d in docs:
        st = d.get("state")
        if st in ("no_pool", "not_searched", "too_thin", "not_a_venue"):
            if not d.get("reason"):
                bad.append(f"{d['key']} no_pool without reason")
            continue
        for i, s in enumerate(SIZES):
            x = d["status"][i]
            if x == "filled" and (d["filled_fraction"][i] != 1.0 or d["cost_bps"][i] is None):
                bad.append(f"{d['key']} ${s} filled but ff {d['filled_fraction'][i]} cost {d['cost_bps'][i]}")
            if x == "partial" and not (d["filled_fraction"][i] < 1 and d["cost_bps"][i] is None and (d["filled_usd"][i] or 0) > 0):
                bad.append(f"{d['key']} ${s} partial inconsistent")
            if x.startswith("failed") and d["cost_bps"][i] is not None:
                bad.append(f"{d['key']} ${s} failed with a cost")
    check("row states: filled has ff 1 and a cost; partial has ff < 1, no cost, pool_usd > 0; no_pool and failed have no cost",
          not bad, "; ".join(bad[:5]))

    by_u: dict[str, list[dict]] = {}
    for d in docs:
        by_u.setdefault(d["underlying"], []).append(d)

    def min_filled(ds, s, group="all"):
        """(cost_bps, key) of the version the rule crowns, recomputed from the
        stored documents: the lowest all-in price per share among filled
        versions whose share ratio is read."""
        i = SIZES.index(s)
        c = [(d["allin_per_share"][i], d["key"], d["cost_bps"][i]) for d in ds
             if d.get("status") and d["status"][i] == "filled" and d.get("comparable")
             and (d.get("allin_per_share") or [None] * 11)[i] and (group == "all" or d["group"] == group)]
        if not c:
            return None
        _p, k, bps = min(c, key=lambda x: (x[0], x[1]))
        return (bps, k)

    bad_u, bad_c = [], []
    for u, ds in by_u.items():
        for s in (1000, 10000):
            _code, v = await cost_views.underlying_view(store, u, s)
            m = min_filled(ds, s)
            got = v.get("best")
            if (m is None) != (got is None) or (m and (got["key"] != m[1] or got["cost_bps"] != m[0])):
                bad_u.append(f"{u} ${s}: served {got}, min {m}")
            if got:
                bv = next((x for x in v["versions"] if x["key"] == got["key"]), {})
                if bv.get("state") != "filled":
                    bad_u.append(f"{u} ${s}: best is not a filled version")
                if not bv.get("comparable"):
                    bad_u.append(f"{u} ${s}: best has no share ratio read")
        _code, c = await cost_views.curve_view(store, u)
        for ch in c.get("chains", []):
            cds = [d for d in ds if d["chain_id"] == ch["chain_id"]]
            for j, s in enumerate(SIZES):
                m = min_filled(cds, s)
                if (m[0] if m else None) != ch["bps"][j]:
                    bad_c.append(f"{u} {ch['chain']} ${s}: served {ch['bps'][j]}, min {m}")
    check("underlying: best = lowest all-in price per share among filled, ratio-read versions ($1,000, $10,000)",
          not bad_u, "; ".join(bad_u[:5]))
    check("curve: each chain and stop = that chain's best by the same rule", not bad_c, "; ".join(bad_c[:5]))

    bad_l = []
    ld = await store.get_meta("list")
    for sort, size in (("cost1k", 1000), ("cost10k", 10000)):
        for g in ("all", "evm", "nonevm"):
            cost_views._list_cache["doc"] = None
            _code, body = await cost_views.list_view(store, type_="", group=g, limit=100, sort=sort)
            for r in body.get("rows", []):
                m = min_filled(by_u.get(r["underlying"], []), size, g)
                if not m or r["best"]["key"] != m[1] or r["best"]["cost_bps"] != m[0]:
                    bad_l.append(f"{sort}/{g} {r['underlying']}: served {r['best']['cost_bps']}, min {m}")
            costs = [r["best"]["cost_bps"] for r in body.get("rows", [])]
            if costs != sorted(costs):
                bad_l.append(f"{sort}/{g} not in cost order")
    check("list: every row's best follows the rule in its group; rows in cost order", not bad_l, "; ".join(bad_l[:5]))
    check("list document present", bool(ld))

    # D1: a discovered pool that failed a check is still held, and a version
    # holding one is never served as no_pool.
    by_key = {d["key"]: d for d in docs}
    held_bad, held_total, sizes = [], 0, {}
    for ch in sorted({d["chain_id"] for d in docs}):
        meta = await store.get_meta(f"chain:{ch}") or {}
        sizes[f"te_cost_meta chain:{ch}"] = len(bson.encode(meta))
        for k, doc in (await store.get_pools_held(ch)).items():
            sizes[f"te_cost_pools {k}"] = len(bson.encode(doc))
            pools = decode_pools(ch, doc)
            held_total += len(pools)
            failed = any(x[8] in ("not_a_venue", "too_thin") for x in pools)
            if failed and (by_key.get(k) or {}).get("state") == "no_pool":
                held_bad.append(k)
        if meta.get("discovered"):
            held_bad.append(f"chain {ch}: discovered pools still in the meta document")
    check(f"no version holding a failed pool is served as no_pool ({held_total} discovered pools held)",
          not held_bad, ", ".join(held_bad[:5]))

    # Mongo refuses a document over 16 MB, and a refused write would stop a
    # chain. Every cost meta and pools document must stay under 1 MB.
    ld = await store.get_meta("list")
    if ld:
        sizes["te_cost_meta list"] = len(bson.encode(ld))
    big = {k: v for k, v in sizes.items() if v > MAX_DOC_BYTES}
    top = sorted(sizes.items(), key=lambda kv: -kv[1])[:3]
    check(f"every te_cost_meta and te_cost_pools document is under 1 MB (largest: "
          + ", ".join(f"{k} {v:,} B" for k, v in top) + ")", not big, ", ".join(f"{k} {v:,}" for k, v in big.items()))


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true", help="refresh each chain, then check it at once")
    ap.add_argument("--samples", type=int, default=20)
    ap.add_argument("--chains", default="8453,42161,1,56,999,4663")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out")
    a = ap.parse_args()
    rng = random.Random(a.seed)
    chains = [int(x) for x in a.chains.split(",")]
    global OWNER
    OWNER = lease_owner("selfcheck")
    store = get_store()
    if a.fresh and not await store.acquire_lease("te_cost_cycle", OWNER, 3600):
        print("another process holds the cost-cycle lease; run without --fresh or wait")
        return 1
    inputs = load_inputs()
    recs = {r["key"]: r for r in inputs["records"]}
    probe_identity()
    per_chain = max(1, a.samples // len(chains))
    prices = _native_prices() if a.fresh else None
    for ch in chains:
        print(f"re-quote, chain {ch}")
        if a.fresh:
            # the worker's own per-chain step, then the list, straight away
            r = await run_one_chain(store, ch, inputs, prices.get(CHAINS[ch]["native"]))
            print(f"  refreshed: {r}")
            await write_list(store, inputs)
            cost_views._list_cache["doc"] = None
        docs = [d for d in await store.all_costs() if d.get("chain_id") == ch and d["_id"] in recs]
        await requote(store, docs, recs, per_chain, rng)
    cost_views._list_cache["doc"] = None
    await reconcile(store, [d for d in await store.all_costs() if d["_id"] in recs])
    fails = [r for r in results if r["ok"] is False]
    skips = [r for r in results if r["ok"] is None]
    print(f"\n{len(results) - len(fails) - len(skips)} passed, {len(fails)} failed, {len(skips)} skipped")
    if a.out:
        Path(a.out).write_text(json.dumps(results, indent=1))
    if a.fresh:
        await store.release_lease("te_cost_cycle", OWNER)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
