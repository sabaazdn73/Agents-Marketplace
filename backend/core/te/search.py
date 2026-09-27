"""Search over the listed universe: by ticker, name, token symbol or address.

An underlying comes back once, with how many listed versions it has, where
they are, and which versions matched when the match was on a token symbol or
an address. An address that is in the universe but not listed comes back too,
flagged `listed: false` with the reason, so a pasted address is never met
with a silent nothing.

Vaults are not indexed yet (SPEC B.5, track T6); every answer says so in
`coverage` rather than implying there are none.
"""

from __future__ import annotations

import re

from core.te.universe import CHAINS, ISSUER_NAMES, LEFT_OUT_REASONS, Universe

MAX_Q = 100
DEFAULT_LIMIT = 20
MAX_LIMIT = 50

COVERAGE = {
    "instruments": "every listed token (see /api/te/summary for the definition)",
    "vaults": None,
    "vaults_reason": "vaults are searched on the Vaults page, not here",
}

_EVM = re.compile(r"^0x[0-9a-fA-F]{40}$")
_B58 = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
_TON = re.compile(r"^(?:[EU]Q[A-Za-z0-9_-]{46}|-?\d:[0-9a-fA-F]{64})$")
_TRON = re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$")


def looks_like_address(q: str) -> bool:
    return bool(_EVM.match(q) or _B58.match(q) or _TON.match(q) or _TRON.match(q))


def _index(u: Universe) -> list[tuple]:
    """(ticker, name_lower, symbols_upper, n_versions) per listed underlying."""
    def build():
        out = []
        for t, idx in u.ticker_indices().items():
            info = u.underlying(t)
            syms = frozenset((u.row(i)["symbol"] or "").upper() for i in idx)
            out.append((t, (info.get("name") or "").lower(), syms, len(idx)))
        out.sort(key=lambda x: x[0])
        return out
    return u.memo("search_index", build)


def _version(u: Universe, i: int) -> dict:
    r = u.row(i)
    c = CHAINS.get(r["chain"], {})
    out = {"key": r["key"], "symbol": r["symbol"], "issuer": ISSUER_NAMES.get(r["issuer"], r["issuer"]),
           "chain": c.get("name", r["chain"]), "group": c.get("group"), "address": r["address"],
           "listed": u.reason(i) is None}
    if not out["listed"]:
        out["not_listed_reason"] = LEFT_OUT_REASONS[u.reason(i)]
    return out


def _underlying_result(u: Universe, ticker: str, match: str, matched: list[dict] | None = None) -> dict:
    info = u.underlying(ticker)
    res = {
        "kind": "instrument",
        "underlying": ticker,
        "symbol": ticker,
        "name": info["name"],
        "type": info["type"],
        "versions": info["versions"],
        "issuers": info["issuers"],
        "chains": info["chains"],
        "groups": info["groups"],
        "match": match,
    }
    # group is always present: the one group, or "mixed".
    res["group"] = info["groups"][0] if len(info["groups"]) == 1 else "mixed"
    if matched:
        res["matched_versions"] = matched
        syms = {v["symbol"] for v in matched}
        if len(syms) == 1:
            # A token or address match names the token, not the underlying.
            res["symbol"] = next(iter(syms))
        if len(matched) == 1:
            v = matched[0]
            res.update({"key": v["key"], "issuer": v["issuer"], "chain": v["chain"], "group": v["group"]})
    return res


def search(u: Universe, q: str, limit: int = DEFAULT_LIMIT) -> dict:
    q = (q or "").strip()
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    base = {"q": q, "coverage": COVERAGE, "computed_at": u.source.get("generated_at")}
    if not q:
        return {**base, "results": [], "reason": "empty query"}
    if len(q) > MAX_Q:
        return {**base, "q": q[:MAX_Q], "results": [], "reason": f"query longer than {MAX_Q} characters"}

    if looks_like_address(q):
        hits = u.address_indices(q)
        results = []
        by_ticker: dict[str, list[int]] = {}
        for i in hits:
            by_ticker.setdefault(u.row(i)["ticker"], []).append(i)
        unlisted = []
        for t, idx in by_ticker.items():
            matched = [_version(u, i) for i in idx]
            if u.underlying(t):
                results.append(_underlying_result(u, t, "address", matched))
            else:
                unlisted.extend(matched)
        out = {**base, "results": results[:limit]}
        excluded = u.excluded_at(q)
        unlisted.extend(excluded)
        if unlisted:
            # In the universe but not listed: its underlying has no listed
            # version, or the universe pass excluded it (with the reason).
            out["unlisted_matches"] = unlisted
        if not hits and excluded:
            out["reason"] = "; ".join(sorted({f"{x['symbol']}: {x['not_listed_reason']}" for x in excluded}))
        elif not hits:
            out["reason"] = "no token in the universe at this address on any chain read"
        return out

    qu, ql = q.upper(), q.lower()
    scored = []
    for t, name, syms, n in _index(u):
        if t == qu:
            s, m = 0, "ticker"
        elif qu in syms:
            s, m = 1, "symbol"
        elif t.startswith(qu):
            s, m = 2, "ticker"
        elif any(x.startswith(qu) for x in syms):
            s, m = 3, "symbol"
        elif name and (name.startswith(ql) or f" {ql}" in f" {name}"):
            s, m = 4, "name"
        elif name and ql in name:
            s, m = 5, "name"
        else:
            continue
        scored.append((s, -n, t, m))
    scored.sort()
    results = []
    for s, _, t, m in scored[:limit]:
        matched = None
        if m == "symbol":
            matched = [_version(u, i) for i in u.ticker_indices()[t]
                       if (u.row(i)["symbol"] or "").upper().startswith(qu)][:20]
        results.append(_underlying_result(u, t, m, matched))
    out = {**base, "results": results, "total_matches": len(scored)}
    if len(scored) > limit:
        out["truncated"] = True
    return out
