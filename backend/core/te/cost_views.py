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

import logging
import time

from .cost import LIFI_FEE_RATE, METHOD, SIZES
from .universe import ISSUER_NAMES

log = logging.getLogger("te.cost")

# States with no quote at all. no_pool: every pool family was searched and
# none holds a dollar pool; not_searched: a family was not (fully) searched.
NO_QUOTE_STATES = ("no_pool", "not_searched", "too_thin", "not_a_venue", "held")
STATE_ORDER = {"held": 7, "filled": 0, "partial": 1, "too_thin": 2, "not_a_venue": 3, "failed": 4, "not_searched": 5, "no_pool": 6}
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
            "block": d.get("block"), "computed_at": d.get("computed_at"), "us_market_open": d.get("us_market_open"),
            "share_ratio": d.get("share_ratio"), "share_ratio_basis": d.get("share_ratio_basis") or "share ratio not read",
            "comparable": bool(d.get("comparable")), "ref_gap_bps": d.get("_ref_gap_bps"),
            "ref_gap_flag": d.get("_ref_gap_flag"), "ref_gap_basis": d.get("_ref_gap_basis")}
    if d.get("state") in NO_QUOTE_STATES:
        return {**base, "state": d["state"], "cost_bps": None, "cost_usd": None, "paid_per_token": None,
                "filled_fraction": None, "pool_usd": d.get("pool_usd") if d["state"] == "too_thin" else None,
                "reason": d.get("reason")}
    i = _i(size)
    st = d["status"][i]
    if st == "filled":
        pools = d.get("pools") or []
        p = pools[d["pool"][i]] if d["pool"][i] is not None and d["pool"][i] < len(pools) else None
        gas = d["gas_usd"][i]
        l1 = (d.get("gas_ctx") or {}).get("l1_fee_usd")
        return {**base, "state": "filled", "cost_bps": d["cost_bps"][i], "cost_usd": d["cost_usd"][i],
                "paid_per_token": d["paid_per_token"][i], "filled_fraction": 1.0,
                "allin_per_token": (d.get("allin_per_token") or [None] * len(SIZES))[i],
                "allin_per_share": (d.get("allin_per_share") or [None] * len(SIZES))[i],
                "tokens_per_1000": (d.get("tokens_per_1000") or [None] * len(SIZES))[i],
                "pool_usd": (d.get("depth2_usd") or [None] * 9)[d["pool"][i]] if d.get("depth2_usd") else None,
                "pool_usd_basis": "+-2% depth of this pool, the smaller side, at this block",
                "cost_parts": {"pool_usd": d["pool_cost_usd"][i], "gas_usd": gas, "l1_fee_usd": l1,
                               "lifi_fee_usd": round(LIFI_FEE_RATE * size, 4)},
                "mid_usd": d["mid_usd"][i], "mid_gap_bps": (d.get("mid_gap_bps") or [None] * len(SIZES))[i],
                "pool": _pool_label(p, d["key"].split("/", 1)[1]), "reason": None}
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


def _pool_label(p: list | None, token: str | None = None) -> dict | None:
    if not p:
        return None
    f, addr, fee, ts, hooks, qa, params, src = p
    out = {"family": {"v3": "concentrated liquidity (V3 style)", "v4": "Uniswap V4",
                      "infinity_cl": "PancakeSwap Infinity CL"}.get(f, f), "address": addr, "other_side": qa}
    if f != "v3":
        out.update(fee=fee, tick_spacing=ts, hooks=hooks, manager=addr)
        if token:
            from .cost import unpack
            from .pools import infinity_pool_id, v4_pool_id
            q = unpack(p)
            out["pool_id"] = "0x" + (v4_pool_id(q, token) if f == "v4" else infinity_pool_id(q, token)).hex()
    return out


def _best(cells: list[dict]) -> dict | None:
    """The version that gives the most of the underlying for the money: the
    lowest all-in price per share-equivalent, among versions that fill the
    whole size and whose share ratio is read. A version whose ratio is not
    read is shown but never crowned: its price per token cannot be set
    against another issuer's."""
    full = [c for c in cells if c["state"] == "filled" and c.get("comparable") and c.get("allin_per_share")]
    return min(full, key=lambda c: (c["allin_per_share"], c["key"])) if full else None


BEST_RULE = ("lowest all-in price per share-equivalent (the size, gas, the L1 fee and LI.FI's fee, over the "
             "tokens received, over the shares per token) among versions that fill the whole size and whose share "
             "ratio is read; versions whose ratio is not read are shown, not ranked. cost_bps (fees and price "
             "impact against the pool's own mid) is a secondary figure")

REF_GAP_FLAG_BPS = 50


def annotate_ref_gap(docs: list[dict]) -> None:
    """Sets, on each version document of ONE underlying, the gap between its
    mid (its deepest passing pool's pre-trade price, per share) and a
    reference common to the underlying: the mid of the deepest passing pool
    across all its versions with a read share ratio. Flagged beyond 50 bps."""
    live = [d for d in docs if d.get("ref_mid_usd") and d.get("pool_usd")]
    comp = [d for d in live if d.get("comparable") and d.get("share_ratio")]
    if not comp:
        return
    ref = max(comp, key=lambda d: d["pool_usd"])
    ref_ps = ref["ref_mid_usd"] / ref["share_ratio"]
    basis = f"against {ref['symbol']} on {ref['chain']} (its deepest pool, ${ref['pool_usd']:,.0f} at +-2%), per share"
    for d in live:
        r = d.get("share_ratio") if d.get("comparable") else None
        gap = ((d["ref_mid_usd"] / (r or 1)) / ref_ps - 1) * 1e4
        d["_ref_gap_bps"] = round(gap, 1)
        d["_ref_gap_flag"] = abs(gap) > REF_GAP_FLAG_BPS
        d["_ref_gap_basis"] = basis if r else basis + "; this version's share ratio is not read, so per token"


# ── worker side ──────────────────────────────────────────────────────────────

_BEST_FIELDS = ("key", "cost_bps", "cost_usd", "paid_per_token", "filled_fraction", "pool_usd",
                "allin_per_token", "allin_per_share", "tokens_per_1000", "share_ratio", "ref_gap_bps", "ref_gap_flag")
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
        best, uncrowned = {}, {}
        annotate_ref_gap(vs)
        for size in (1000, 10000):
            cells = [_cell(d, size) for d in vs]
            # filled versions that cannot be ranked (share ratio not read), per group
            for g in GROUPS:
                nr = [c["key"] for c in cells if c["state"] == "filled" and not c.get("comparable")
                      and (g == "all" or c["group"] == g)]
                if nr:
                    uncrowned[f"{g}:{size}"] = nr
            for g in GROUPS:
                b = _best([c for c in cells if g == "all" or c["group"] == g])
                if b:
                    best[f"{g}:{size}"] = [b[k] for k in _BEST_FIELDS]
                    versions[b["key"]] = [b[k] for k in _VERSION_FIELDS]
        rows.append({"u": u, "name": info.get("name"), "name_basis": info.get("name_basis"), "type": info.get("type"),
                     "type_basis": info.get("type_basis"), "n": len(vs), "best": best,
                     "not_ranked": uncrowned})
    issuers = {k: {"name": ISSUER_NAMES.get(k, v.get("name")), "eligibility": v.get("eligibility")}
               for k, v in inputs["issuers"].items()}
    counts = count_docs(docs)
    return {"rows": rows, "versions": versions, "issuers": issuers, "counts": counts,
            "tickers_without_measured_pool": inputs.get("tickers_without_measured_pool", []),
            "discovery": discovery or {},
            "computed_at": max((d.get("computed_at") or "" for d in docs), default=None),
            "inputs": inputs.get("source")}


# THE COUNTS, AND WHAT EACH WORD MEANS. One vocabulary, used by
# /api/te/summary, /api/te/status and the MCP datasets.
#   read          every version the cost engine read (its inputs)
#   searched      the pool search finished for it: every state except
#                 not_searched. A finished search that found no pool
#                 (no_pool) is searched; so is a pool found too thin or not
#                 a venue, and a quote held back (held).
#   not_searched  the pool search did not finish
#   quoted        a quote was run on a pool that passed the venue checks
#                 (stored state "measured"; renamed here, since a no_pool
#                 answer is a measurement of absence and not a quote)
#   with_cost     quoted, and the best passing pool fills a $1,000 buy
STATE_NAMES = {"measured": "quoted"}
COUNTS_DEFINITION = (
    "versions_read: versions the cost engine read. versions_searched: those whose pool search finished (every "
    "state except not_searched; a search that found no pool, state no_pool, is searched). versions_not_searched: "
    "those whose pool search did not finish. versions_quoted: a quote was run on a pool that passed the venue "
    "checks (by_state.quoted). versions_with_cost: quoted, and the best passing pool fills a $1,000 buy at the "
    "refresh block. Only EVM versions are read: Solana versions are listed but not measured yet.")


def _chain_counts(c: dict) -> dict:
    st = {STATE_NAMES.get(k, k): v for k, v in (c.get("by_state") or {}).items()}
    read = sum(st.values())
    keep = ("chain_name", "chain_id", "versions_with_cost")
    return {**{k: c[k] for k in keep if k in c}, "by_state": st, "versions_read": read,
            "versions_searched": read - st.get("not_searched", 0),
            "versions_not_searched": st.get("not_searched", 0),
            "versions_quoted": st.get("quoted", 0)}


def count_docs(docs: list[dict]) -> dict:
    """The engine's own counts, by chain and in total. One function, so
    /api/te/summary and the MCP datasets count alike."""
    i1k = _i(1000)
    by_chain: dict[str, dict] = {}
    for d in docs:
        c = by_chain.setdefault(d["chain"], {"chain_name": d["chain"], "chain_id": d["chain_id"],
                                             "versions_with_cost": 0, "by_state": {}})
        c["by_state"][d["state"]] = c["by_state"].get(d["state"], 0) + 1
        if d.get("status") and d["status"][i1k] == "filled":
            c["versions_with_cost"] += 1
    return _totals([_chain_counts(c) for c in by_chain.values()])


def _totals(chains: list[dict]) -> dict:
    total = lambda k: sum(c[k] for c in chains)  # noqa: E731
    return {"versions_read": total("versions_read"), "versions_searched": total("versions_searched"),
            "versions_not_searched": total("versions_not_searched"), "versions_quoted": total("versions_quoted"),
            "versions_with_cost": total("versions_with_cost"),
            "by_chain": sorted(chains, key=lambda c: (-c["versions_with_cost"], c["chain_id"])),
            "definition": COUNTS_DEFINITION}


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


# ONE SNAPSHOT of the per-version store, shared by /api/te/summary and the
# MCP datasets, so both count the same records at the same time. The list
# document is written after the last chain of a cycle; the per-version
# records are written chain by chain, so between the two a count taken from
# each could differ by the versions a chain had just rewritten. Counting the
# records themselves, once per minute, removes that.
_snapshot: dict = {"t": -1e9, "docs": None}
SNAPSHOT_SECONDS = 60


async def cost_snapshot(store) -> tuple[list[dict], str | None]:
    """Every per-version record, and the newest measurement time among them."""
    if _snapshot["docs"] is None or time.monotonic() - _snapshot["t"] > SNAPSHOT_SECONDS:
        _snapshot["docs"] = await store.all_costs()
        _snapshot["t"] = time.monotonic()
    docs = _snapshot["docs"]
    return docs, (max((d.get("computed_at") or "" for d in docs), default="") or None)


async def measured_counts(store) -> dict | None:
    """The cost engine's counts for /api/te/summary, from the shared snapshot,
    with the time of that snapshot. None before the first cycle."""
    docs, at = await cost_snapshot(store)
    if not docs:
        return None
    return {**count_docs(docs), "computed_at": at,
            "computed_at_basis": "the newest measurement among the per-version records counted"}


def _elig(ld: dict, issuer_id: str) -> dict | None:
    e = ((ld.get("issuers") or {}).get(issuer_id) or {}).get("eligibility")
    return e if e and e.get("text") and e.get("url") and e.get("read_on") else None


def _unavailable(reason: str) -> dict:
    return {"error": "not_measured", "reason": reason}


# The last time this process answered "no list", kept for /api/te/status and
# logged, so a 503 can be traced after the fact: which route, what the cache
# held, and what the store returned. Nothing secret.
last_unavailable: dict = {"count": 0, "at": None, "route": None, "cache_age_seconds": None}


def _no_list(route: str) -> tuple[int, dict]:
    last_unavailable["count"] += 1
    last_unavailable["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    last_unavailable["route"] = route
    last_unavailable["cache_age_seconds"] = round(time.monotonic() - _list_cache["t"], 1)
    log.warning("[te] %s answered 503: the store returned no list document (cache age %ss)",
                route, last_unavailable["cache_age_seconds"])
    return 503, _unavailable("the cost worker has not written a list yet")


async def list_view(store, *, type_: str, group: str, limit: int, sort: str, offset: int = 0) -> tuple[int, dict]:
    ld = await _list_doc(store)
    if not ld:
        return _no_list("list")
    size = LIST_SIZES[sort]
    applied = "cost1k" if sort == "popular" else sort
    out_rows, unfilled, not_ranked, untyped = [], 0, [], 0
    for r in ld["rows"]:
        if not r.get("type"):
            untyped += 1
        if type_ and r.get("type") != type_:
            continue
        b = _row_best(ld, r, group, size)
        if not b:
            if (r.get("not_ranked") or {}).get(f"{group}:{size}"):
                not_ranked.append(r["u"])        # filled, but no version with a read share ratio
            else:
                unfilled += 1
            continue
        out_rows.append({"underlying": r["u"], "name": r["name"] or r["u"], "name_basis": r.get("name_basis") or
                         ("ticker only" if not r["name"] else None), "type": r["type"], "type_basis": r.get("type_basis"),
                         "versions": r["n"],
                         "eligibility": _elig(ld, b["issuer_id"]), "best": b, "spark": None, "spark_reason": SPARK_REASON})
    out_rows.sort(key=lambda x: (x["best"]["cost_bps"], x["underlying"]))
    page = out_rows[offset:offset + limit]
    body = {"rows": page, "sort": applied, "sort_requested": sort, "size": size, "type": type_ or None,
            "group": group, "computed_at": ld.get("computed_at"), "rows_total": len(out_rows),
            "offset": offset, "limit": limit, "next_offset": offset + limit if offset + limit < len(out_rows) else None,
            "rows_without_filled_version": unfilled,
            "rows_not_ranked": {"count": len(not_ranked), "underlyings": not_ranked[:50],
                                "reason": "a version in this group fills the size, but none has a read share ratio "
                                          "(Ondo); shown with the stock's other versions, not ranked here"},
            "underlyings_without_type": untyped, "lifi_fee_included": True, "method": METHOD.format(block="n"),
            "coverage": COVERAGE_NOTE, "best_rule": BEST_RULE}
    if sort == "popular":
        body["sort_reason"] = POPULAR_REASON
    if group == "nonevm":
        body["group_note"] = "no non-EVM version is measured yet"
    return 200, body


async def underlying_view(store, ticker: str, size: int) -> tuple[int, dict]:
    ld = await _list_doc(store)
    if not ld:
        return _no_list("underlying")
    row = next((r for r in ld["rows"] if r["u"] == ticker), None)
    if not row:
        if ticker in (ld.get("tickers_without_measured_pool") or []):
            return 200, {"ticker": ticker, "name": None, "size": size, "versions": [], "best": None,
                         "reason": "no version of this ticker has a pool against a dollar stablecoin that we found on the chains measured",
                         "coverage": COVERAGE_NOTE, "computed_at": ld.get("computed_at")}
        return 404, {"error": "unknown_ticker", "reason": f"{ticker} is not in the verified universe we measure"}
    docs = await store.costs_for(ticker)
    annotate_ref_gap(docs)
    cells = [_cell(d, size) for d in docs]
    by_key = {d["key"]: d for d in docs}
    for c in cells:
        d = by_key[c["key"]]
        c["eligibility"] = _elig(ld, c["issuer_id"])
        c["controls"] = d.get("controls")
        c["controls_basis"] = f"read at block {d.get('controls_block')} (universe pass)"
        if c["state"] in NO_QUOTE_STATES:
            c["pool_search"] = {**(d.get("pool_search") or {}),
                                "initialize_logs": (ld.get("discovery") or {}).get(str(c["chain_id"])) or
                                "not searched on this chain; pools found by factory construction in the universe pass"}
    b = _best(cells)
    cells.sort(key=lambda c: (STATE_ORDER.get(c["state"], 9), not c.get("comparable"), c.get("allin_per_share") or 0, c["key"]))
    blocks = sorted({(c["chain_id"], c["block"]) for c in cells if c.get("block")})
    return 200, {
        "ticker": ticker, "name": row["name"] or ticker, "name_basis": row.get("name_basis"), "type": row["type"],
        "type_basis": row.get("type_basis"), "size": size,
        "computed_at": max((c["computed_at"] or "" for c in cells), default=None),
        "versions": cells, "best": b and {"key": b["key"], "cost_bps": b["cost_bps"]},
        "best_rule": BEST_RULE,
        "blocks": [{"chain_id": c, "block": n} for c, n in blocks],
        "lifi_fee_included": True, "method": METHOD.format(block="n (per version)"), "coverage": COVERAGE_NOTE,
    }


async def curve_view(store, ticker: str) -> tuple[int, dict]:
    ld = await _list_doc(store)
    if not ld:
        return _no_list("curve")
    if not any(r["u"] == ticker for r in ld["rows"]):
        return 404, {"error": "unknown_ticker" if ticker not in (ld.get("tickers_without_measured_pool") or []) else "not_measured",
                     "reason": f"no measured version of {ticker}"}
    docs = await store.costs_for(ticker)
    annotate_ref_gap(docs)
    by_chain: dict[int, list[dict]] = {}
    for d in docs:
        by_chain.setdefault(d["chain_id"], []).append(d)
    chains, without = [], []
    for cid, ds in sorted(by_chain.items()):
        if all(d.get("state") in NO_QUOTE_STATES for d in ds):
            states = sorted({d["state"] for d in ds})
            without.append({"chain": ds[0]["chain"], "chain_id": cid, "group": ds[0]["group"],
                            "symbols": sorted({d["symbol"] for d in ds}), "states": states,
                            "state": states[0] if len(states) == 1 else "mixed",
                            "reasons": sorted({d.get("reason") or d["state"] for d in ds})[:4]})
            continue
        bps, pool_usd, keys, syms, why_null = [], [], [], [], []
        for s in SIZES:
            cells = [_cell(d, s) for d in ds]
            b = _best(cells)
            if b:
                bps.append(b["cost_bps"]); pool_usd.append(b.get("pool_usd")); keys.append(b["key"]); syms.append(b["symbol"])
                why_null.append(None)
            else:
                part = [c for c in cells if c["state"] == "partial"]
                bps.append(None); keys.append(None); syms.append(None)
                pool_usd.append(max(c["pool_usd"] for c in part) if part else None)
                st = sorted({c["state"] for c in cells})
                why_null.append("filled, but no version with a read share ratio" if "filled" in st else
                                "partial fill" if "partial" in st else "failed: every quote failed at this block"
                                if "failed" in st else "no quotable pool: " + ", ".join(st))
        named = next((syms[i] for i in (_i(10000), _i(1000)) if syms[i]), next((x for x in syms if x), ds[0]["symbol"]))
        nd = next(d for d in ds if d["symbol"] == named) if any(d["symbol"] == named for d in ds) else ds[0]
        chains.append({"chain": nd["chain"], "chain_id": cid, "group": nd["group"], "symbol": named,
                       "issuer": ISSUER_NAMES.get(nd["issuer"], nd["issuer"]), "bps": bps, "pool_usd": pool_usd,
                       "keys": keys, "symbols": syms, "null_reason": why_null,
                       "version_states": {x: sum(1 for d in ds if d["state"] == x) for x in sorted({d["state"] for d in ds})},
                       "block": nd.get("block"), "computed_at": nd.get("computed_at")})
    return 200, {"ticker": ticker, "stops": SIZES, "computed_at": max((c["computed_at"] or "" for c in chains), default=None),
                 "chains": chains, "chains_without_pool": without, "rule": "per chain and stop, the best version by the rule in best_rule; bps is its cost_bps; null where no ranked version fills", "best_rule": BEST_RULE,
                 "lifi_fee_included": True, "method": METHOD.format(block="n (per chain)"), "coverage": COVERAGE_NOTE}
