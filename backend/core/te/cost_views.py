"""
cost_views.py

The response shapes of /api/te/list, /api/te/underlying/{ticker} and
/api/te/curve/{ticker}, built from the stored cost documents. The shapes
follow frontend/src/te/api.js field for field, plus the fields that make a
figure checkable (block, computed_at, method, state, reason).

Rules that hold in every view:
- best is the minimum cost over the versions that filled the whole size, at
  the same size; a partial fill is never best.
- a version with no pool, a partial fill and a failed quote are three
  different states, each with its reason; none of them is a zero.
- eligibility is always {text, url, read_on}: the issuer's words, linked and
  dated (class D).
- costs include LI.FI's published 0.25% fee, and say so (lifi_fee_included).

build_list_doc() runs in the worker; the async views run in the web process
and read at most one underlying's documents (about 10) or the one list
document, cached for a minute.
"""

from __future__ import annotations

import time

from .cost import LIFI_FEE_RATE, METHOD, SIZES
from .universe import ISSUER_NAMES

LIST_SIZES = {"popular": 1000, "cost1k": 1000, "cost10k": 10000}
GROUPS = ("all", "evm", "nonevm")
COVERAGE_NOTE = ("EVM versions on Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and HyperEVM, measured on "
                 "their pools. Solana versions are not measured yet. Versions on chains outside the product's scope "
                 "(Optimism, Mantle, Ink, X Layer, TON, Tron) are not listed.")
SPARK_REASON = "price history is not built yet"
POPULAR_REASON = ("ordering by 7-day swap volume needs our swap-volume reads, which are not built yet; "
                  "ordered by cost at $1,000 instead")


def _i(size: int) -> int:
    return SIZES.index(size)


def _cell(d: dict, size: int) -> dict:
    """One version at one size, in the view's terms."""
    name = ISSUER_NAMES.get(d["issuer"], d["issuer"])
    base = {"key": d["key"], "symbol": d["symbol"], "issuer": name, "issuer_name": name,
            "issuer_id": d["issuer"], "chain": d["chain"], "chain_name": d["chain"], "chain_id": d["chain_id"], "group": d["group"],
            "block": d.get("block"), "computed_at": d.get("computed_at"), "us_market_open": d.get("us_market_open")}
    if d.get("state") == "no_pool":
        return {**base, "state": "no_pool", "cost_bps": None, "cost_usd": None, "paid_per_token": None,
                "filled_fraction": None, "pool_usd": None, "reason": d.get("reason")}
    i = _i(size)
    st = d["status"][i]
    if st == "filled":
        pools = d.get("pools") or []
        p = pools[d["pool"][i]] if d["pool"][i] is not None and d["pool"][i] < len(pools) else None
        gas = d["gas_usd"][i]
        l1 = (d.get("gas_ctx") or {}).get("l1_fee_usd")
        return {**base, "state": "filled", "cost_bps": d["cost_bps"][i], "cost_usd": d["cost_usd"][i],
                "paid_per_token": d["paid_per_token"][i], "filled_fraction": 1.0,
                "pool_usd": d.get("pool_usd"), "pool_usd_lower_bound": d.get("pool_usd_lower_bound"),
                "cost_parts": {"pool_usd": d["pool_cost_usd"][i], "gas_usd": gas, "l1_fee_usd": l1,
                               "lifi_fee_usd": round(LIFI_FEE_RATE * size, 4)},
                "mid_usd": d["mid_usd"][i], "mid_gap_bps": (d.get("mid_gap_bps") or [None] * len(SIZES))[i],
                "pool": _pool_label(p), "reason": None}
    if st == "partial":
        return {**base, "state": "partial", "cost_bps": None, "cost_usd": None, "paid_per_token": None,
                "filled_fraction": d["filled_fraction"][i], "pool_usd": d["filled_usd"][i],
                "reason": (f"the best pool fills {d['filled_fraction'][i] * 100:.1f}% of ${size:,} before its price "
                           f"moves 4x; it takes ${d['filled_usd'][i]:,.0f}")}
    if st == "no_l1_fee":
        return {**base, "state": "failed", "cost_bps": None, "cost_usd": None, "paid_per_token": None,
                "filled_fraction": None, "pool_usd": None, "reason": "the L1 data fee could not be read at this block"}
    return {**base, "state": "failed", "cost_bps": None, "cost_usd": None, "paid_per_token": None,
            "filled_fraction": None, "pool_usd": None,
            "reason": "every quote on this version's pools failed at this block (" + st.split(":", 1)[-1] + ")"}


def _pool_label(p: list | None) -> dict | None:
    if not p:
        return None
    f, addr, fee, ts, hooks, qa, params, src = p
    out = {"family": {"v3": "concentrated liquidity (V3 style)", "v4": "Uniswap V4",
                      "infinity_cl": "PancakeSwap Infinity CL"}.get(f, f), "address": addr, "other_side": qa}
    if f != "v3":
        out.update(fee=fee, tick_spacing=ts, hooks=hooks)
    return out


def _best(cells: list[dict]) -> dict | None:
    full = [c for c in cells if c["state"] == "filled" and c["cost_bps"] is not None]
    return min(full, key=lambda c: c["cost_bps"]) if full else None


# ── worker side ──────────────────────────────────────────────────────────────

_BEST_FIELDS = ("key", "cost_bps", "cost_usd", "paid_per_token", "filled_fraction", "pool_usd")
_VERSION_FIELDS = ("symbol", "issuer", "issuer_name", "issuer_id", "chain", "chain_name", "chain_id", "group", "block",
                   "computed_at", "us_market_open")


def build_list_doc(docs: list[dict], inputs: dict, discovery: dict | None = None) -> dict:
    """The one document /api/te/list reads. Each row keeps, per group and
    list size, only the best version's key and figures; the version's
    identity (symbol, issuer, chain, block, time) is held once in `versions`."""
    by_u: dict[str, list[dict]] = {}
    for d in docs:
        by_u.setdefault(d["underlying"], []).append(d)
    rows, versions = [], {}
    for u, vs in sorted(by_u.items()):
        info = inputs["underlyings"].get(u) or {}
        best = {}
        for size in (1000, 10000):
            cells = [_cell(d, size) for d in vs]
            for g in GROUPS:
                b = _best([c for c in cells if g == "all" or c["group"] == g])
                if b:
                    best[f"{g}:{size}"] = [b[k] for k in _BEST_FIELDS]
                    versions[b["key"]] = [b[k] for k in _VERSION_FIELDS]
        rows.append({"u": u, "name": info.get("name"), "type": info.get("type"), "n": len(vs), "best": best})
    issuers = {k: {"name": ISSUER_NAMES.get(k, v.get("name")), "eligibility": v.get("eligibility")}
               for k, v in inputs["issuers"].items()}
    return {"rows": rows, "versions": versions, "issuers": issuers,
            "tickers_without_measured_pool": inputs.get("tickers_without_measured_pool", []),
            "discovery": discovery or {},
            "computed_at": max((d.get("computed_at") or "" for d in docs), default=None),
            "inputs": inputs.get("source")}


def _row_best(ld: dict, row: dict, group: str, size: int) -> dict | None:
    x = row["best"].get(f"{group}:{size}")
    if not x:
        return None
    b = dict(zip(_BEST_FIELDS, x))
    b.update(zip(_VERSION_FIELDS, ld["versions"][b["key"]]))
    return b


# ── web side ─────────────────────────────────────────────────────────────────

_list_cache: dict = {"t": 0.0, "doc": None}
LIST_CACHE_SECONDS = 60


async def _list_doc(store) -> dict | None:
    if _list_cache["doc"] is None or time.monotonic() - _list_cache["t"] > LIST_CACHE_SECONDS:
        _list_cache["doc"] = await store.get_meta("list")
        _list_cache["t"] = time.monotonic()
    return _list_cache["doc"]


def _elig(ld: dict, issuer_id: str) -> dict | None:
    e = ((ld.get("issuers") or {}).get(issuer_id) or {}).get("eligibility")
    return e if e and e.get("text") and e.get("url") and e.get("read_on") else None


def _unavailable(reason: str) -> dict:
    return {"error": "not_measured", "reason": reason}


async def list_view(store, *, type_: str, group: str, limit: int, sort: str) -> tuple[int, dict]:
    ld = await _list_doc(store)
    if not ld:
        return 503, _unavailable("the cost worker has not written a list yet")
    size = LIST_SIZES[sort]
    applied = "cost1k" if sort == "popular" else sort
    out_rows, unfilled = [], 0
    for r in ld["rows"]:
        if type_ and r.get("type") != type_:
            continue
        b = _row_best(ld, r, group, size)
        if not b:
            unfilled += 1
            continue
        out_rows.append({"underlying": r["u"], "name": r["name"] or r["u"], "type": r["type"], "versions": r["n"],
                         "eligibility": _elig(ld, b["issuer_id"]), "best": b, "spark": None, "spark_reason": SPARK_REASON})
    out_rows.sort(key=lambda x: (x["best"]["cost_bps"], x["underlying"]))
    body = {"rows": out_rows[:limit], "sort": applied, "sort_requested": sort, "size": size, "type": type_ or None,
            "group": group, "computed_at": ld.get("computed_at"), "rows_total": len(out_rows),
            "rows_without_filled_version": unfilled, "lifi_fee_included": True, "method": METHOD.format(block="n"),
            "coverage": COVERAGE_NOTE, "best_rule": "lowest cost among versions that fill the whole size"}
    if sort == "popular":
        body["sort_reason"] = POPULAR_REASON
    if group == "nonevm":
        body["group_note"] = "no non-EVM version is measured yet"
    return 200, body


async def underlying_view(store, ticker: str, size: int) -> tuple[int, dict]:
    ld = await _list_doc(store)
    if not ld:
        return 503, _unavailable("the cost worker has not written a list yet")
    row = next((r for r in ld["rows"] if r["u"] == ticker), None)
    if not row:
        if ticker in (ld.get("tickers_without_measured_pool") or []):
            return 200, {"ticker": ticker, "name": None, "size": size, "versions": [], "best": None,
                         "reason": "no version of this ticker has a pool against a dollar stablecoin that we found on the chains measured",
                         "coverage": COVERAGE_NOTE, "computed_at": ld.get("computed_at")}
        return 404, {"error": "unknown_ticker", "reason": f"{ticker} is not in the verified universe we measure"}
    docs = await store.costs_for(ticker)
    cells = [_cell(d, size) for d in docs]
    by_key = {d["key"]: d for d in docs}
    for c in cells:
        d = by_key[c["key"]]
        c["eligibility"] = _elig(ld, c["issuer_id"])
        c["controls"] = d.get("controls")
        c["controls_basis"] = f"read at block {d.get('controls_block')} (universe pass)"
        if c["state"] == "no_pool":
            c["pool_search"] = {**(d.get("pool_search") or {}),
                                "initialize_logs": (ld.get("discovery") or {}).get(str(c["chain_id"])) or
                                "not searched on this chain; pools found by factory construction in the universe pass"}
    b = _best(cells)
    cells.sort(key=lambda c: ({"filled": 0, "partial": 1, "failed": 2, "no_pool": 3}[c["state"]], c["cost_bps"] or 0, c["key"]))
    blocks = sorted({(c["chain_id"], c["block"]) for c in cells if c.get("block")})
    return 200, {
        "ticker": ticker, "name": row["name"] or ticker, "type": row["type"], "size": size,
        "computed_at": max((c["computed_at"] or "" for c in cells), default=None),
        "versions": cells, "best": b and {"key": b["key"], "cost_bps": b["cost_bps"]},
        "best_rule": "lowest cost among versions that fill the whole size",
        "blocks": [{"chain_id": c, "block": n} for c, n in blocks],
        "lifi_fee_included": True, "method": METHOD.format(block="n (per version)"), "coverage": COVERAGE_NOTE,
    }


async def curve_view(store, ticker: str) -> tuple[int, dict]:
    ld = await _list_doc(store)
    if not ld:
        return 503, _unavailable("the cost worker has not written a list yet")
    if not any(r["u"] == ticker for r in ld["rows"]):
        return 404, {"error": "unknown_ticker" if ticker not in (ld.get("tickers_without_measured_pool") or []) else "not_measured",
                     "reason": f"no measured version of {ticker}"}
    docs = await store.costs_for(ticker)
    by_chain: dict[int, list[dict]] = {}
    for d in docs:
        by_chain.setdefault(d["chain_id"], []).append(d)
    chains, without = [], []
    for cid, ds in sorted(by_chain.items()):
        if all(d.get("state") == "no_pool" for d in ds):
            without.append({"chain": ds[0]["chain"], "chain_id": cid, "group": ds[0]["group"],
                            "symbols": sorted({d["symbol"] for d in ds}), "state": "no_pool",
                            "reason": "no version on this chain has a pool against a dollar stablecoin that we found"})
            continue
        bps, pool_usd, keys, syms = [], [], [], []
        for s in SIZES:
            cells = [_cell(d, s) for d in ds]
            b = _best(cells)
            if b:
                bps.append(b["cost_bps"]); pool_usd.append(b.get("pool_usd")); keys.append(b["key"]); syms.append(b["symbol"])
            else:
                part = [c for c in cells if c["state"] == "partial"]
                bps.append(None); keys.append(None); syms.append(None)
                pool_usd.append(max(c["pool_usd"] for c in part) if part else None)
        named = next((syms[i] for i in (_i(10000), _i(1000)) if syms[i]), next((x for x in syms if x), ds[0]["symbol"]))
        nd = next(d for d in ds if d["symbol"] == named) if any(d["symbol"] == named for d in ds) else ds[0]
        chains.append({"chain": nd["chain"], "chain_id": cid, "group": nd["group"], "symbol": named,
                       "issuer": ISSUER_NAMES.get(nd["issuer"], nd["issuer"]), "bps": bps, "pool_usd": pool_usd,
                       "keys": keys, "symbols": syms, "block": nd.get("block"), "computed_at": nd.get("computed_at")})
    return 200, {"ticker": ticker, "stops": SIZES, "computed_at": max((c["computed_at"] or "" for c in chains), default=None),
                 "chains": chains, "chains_without_pool": without, "rule": "per chain and stop, the lowest-cost version that fills the whole size; null where none does",
                 "lifi_fee_included": True, "method": METHOD.format(block="n (per chain)"), "coverage": COVERAGE_NOTE}
