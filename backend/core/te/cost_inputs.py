"""
cost_inputs.py

The versions and pools the cost engine measures, read from the verified
universe (core/te/universe.py: load_universe, get_pools). Built in the
worker once per cycle; the web process never calls this.

Kept: listed tokens (verified on chain, US scope, supply above zero, in the
site's chain scope) on the EVM chains the engine reads (1, 8453, 42161, 56,
4663, 999), of the underlyings that have at least one pool the probe can
measure. Every version of such an underlying is kept, pool or not, so a
version with no pool is a row of its own ("no pool found").

Record shape handed to the engine:
  key "<chain_id>/<address>", chain_id, address, symbol, decimals,
  underlying, issuer, controls {pause, freeze, burn, upgrade} (the control
  cells' state, from the universe), controls_block,
  pools [{f, pool | mgr+fee+ts+hooks, qa, q, src, depth2, why?}]

A pool the engine cannot simulate (a V2 or Solidly pair, or one whose other
side is not a dollar stablecoin) is kept with `why`, so a missing figure is
never silent.
"""

from __future__ import annotations

import json
from pathlib import Path

from .chains import CHAINS, NATIVE
from .universe import ISSUER_NAMES

# Pools T0 met by hand (NVDA, TSLA, SPY), added when the universe lacks them.
T0_POOLS = [
    ("4663/0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
     {"f": "v4", "mgr": "0x8366a39cc670b4001a1121b8f6a443a643e40951", "fee": 8388608, "ts": 10,
      "hooks": "0x66622f77b797d506e5376f7798b67ab288966080", "qa": "0x5fc5360d0400a0fd4f2af552add042d716f1d168"}),
    ("4663/0x322f0929c4625ed5bad873c95208d54e1c003b2d",
     {"f": "v3", "pool": "0xc4f0172d6ac8dd294dd1137d047d5e1893760236", "qa": "0x5fc5360d0400a0fd4f2af552add042d716f1d168"}),
    ("4663/0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
     {"f": "v3", "pool": "0xa7bb1ac63bbab0c44316e6c8c455213441689167", "qa": "0x5fc5360d0400a0fd4f2af552add042d716f1d168"}),
    ("8453/0xb20000000000000000000078ee7ce2fe4908108c",
     {"f": "v3", "pool": "0x853f5f1b92b16714fe6cda67caad0856b83c7ab9", "qa": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"}),
]


def _pool(chain_id: int, p: dict) -> dict:
    stables = {a.lower(): s for s, (a, _d) in CHAINS[chain_id]["stables"].items()}
    qa = (p.get("quote_address") or "").lower()
    if p.get("quote") in ("ETH", "BNB", "HYPE") and not qa:
        qa = NATIVE
    fam = p.get("family")
    out = {"qa": qa, "q": stables.get(qa, p.get("quote")), "src": "universe", "po": bool(p.get("price_outlier")),
           "depth2": round(min(p.get("depth_plus2pct_usd_ub") or 0, p.get("depth_minus2pct_usd_ub") or 0), 2)}
    if fam in ("v3", "slipstream", "algebra"):
        out.update(f="v3", pool=(p.get("pool") or "").lower())
    elif fam == "v4":
        out.update(f="v4", mgr=(p.get("pool_manager") or "").lower(), fee=p.get("fee"), ts=p.get("tick_spacing"),
                   hooks=(p.get("hooks") or NATIVE).lower())
    else:
        out.update(f="unsupported", pool=(p.get("pool") or "").lower(), why=f"{fam} pools are not simulated by the probe")
    if out["f"] != "unsupported" and qa not in stables:
        out["why"] = f"other side is {p.get('quote')}, not a dollar stablecoin; two-hop not measured"
    return out


def _control_words(ctl: dict | None) -> tuple[dict | None, int | None]:
    if not ctl:
        return None, None
    words = {}
    for k in ("pause", "freeze", "burn", "upgrade"):
        c = ctl.get(k) or {}
        words[k] = c.get("state") or (c.get("text") or "not established")[:80]
    block = ((ctl.get("pause") or {}).get("evidence") or {}).get("block_or_slot")
    return words, block


def _type_overrides() -> dict:
    """Stock or ETF for underlyings the universe gives no type, from Nasdaq
    Trader's directory ETF flag (data/te/type_overrides.json, with its source)."""
    p = Path(__file__).resolve().parents[2] / "data" / "te" / "type_overrides.json"
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return {"source": None, "types": {}}


def load_inputs(universe=None) -> dict:
    from .universe import get_pools, iter_listed, load_universe

    u = universe or load_universe()
    by_chain_id = set(CHAINS)
    rows = [r for r in iter_listed(u) if r.get("chain_id") in by_chain_id]
    recs = []
    for r in rows:
        pools = get_pools(r["key"]) or []
        recs.append({
            "key": r["key"], "chain_id": r["chain_id"], "address": r["address"], "symbol": r["symbol"],
            "decimals": r["decimals"], "underlying": r["underlying"], "issuer": r["issuer"],
            "pools": [q for q in (_pool(r["chain_id"], p) for p in pools) if q.get("pool") or q.get("mgr")],
        })
    by_key = {r["key"]: r for r in recs}
    for key, p in T0_POOLS:
        r = by_key.get(key)
        if not r:
            continue
        stables = {a.lower(): s for s, (a, _d) in CHAINS[r["chain_id"]]["stables"].items()}
        q = dict(p, src="t0", q=stables.get(p["qa"]))
        same = [x for x in r["pools"] if (x.get("pool") and x.get("pool") == q.get("pool")) or
                (q.get("mgr") and (x.get("mgr"), x.get("fee"), x.get("ts"), x.get("hooks"), x.get("qa")) ==
                 (q["mgr"], q["fee"], q["ts"], q["hooks"], q["qa"]))]
        if not same:
            r["pools"].append(q)
    measured = {r["underlying"] for r in recs if any(not p.get("why") for p in r["pools"])}
    others = sorted({r["underlying"] for r in recs} - measured)
    recs = [r for r in recs if r["underlying"] in measured]
    for r in recs:
        full = u.record(r["key"], controls=True) or {}
        r["controls"], r["controls_block"] = _control_words(full.get("controls"))
    unders = {}
    over = _type_overrides()
    for t in measured:
        info = u.underlying(t) or {}
        unders[t] = {"name": info.get("name"), "name_basis": info.get("name_basis"), "type": info.get("type"),
                     "type_basis": info.get("type_basis")}
        if not info.get("name") and t in (over.get("names") or {}):
            n = over["names"][t]
            unders[t].update(name=n["security_name"], name_basis=f"{over['source']}: security name")
        if not info.get("type") and t in over["types"]:
            o = over["types"][t]
            unders[t].update(type=o["type"], type_basis=f"{over['source']}: ETF column = {o['etf_flag']} ({o['security_name']})")
    issuers = {k: {"name": ISSUER_NAMES.get(k, k), "eligibility": u.eligibility(k)} for k in ISSUER_NAMES}
    prov = u.provenance() if hasattr(u, "provenance") else {}
    return {"records": sorted(recs, key=lambda r: (r["underlying"], r["chain_id"], r["issuer"])),
            "underlyings": unders, "issuers": issuers, "tickers_without_measured_pool": others,
            "source": {"universe": prov, "note": "listed EVM tokens on chains 1, 8453, 42161, 56, 4663, 999 "
                                                 "of underlyings with at least one measurable pool"}}


def by_underlying(inputs: dict) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in inputs["records"]:
        out.setdefault(r["underlying"], []).append(r)
    return out
