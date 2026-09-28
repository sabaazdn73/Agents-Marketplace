"""The verified tokenized-equity universe, loaded once from a versioned data
file, and the reads over it.

WHERE THE DATA COMES FROM
-------------------------
`data/te_universe.json.gz`, built by `scripts/te_build_universe.py` from the
universe pass (chain reads with a block or slot on every value; UNIVERSE.md).
Static and versioned on purpose: it is not in Atlas, which is metered and near
its quota, and a refresh is a rebuild plus a commit, so every change to what
the site lists is a reviewable diff.

MEMORY
------
The file holds 14,290 rows, stored column-wise with categorical values as
indexes into shared lists, and the control cells are shared: every token of
one family on one chain points at one set. Measured by
`scripts/te_universe_selfcheck.py` (tracemalloc over a cold load): about
8.5 MB of objects kept, a transient peak of about 15 MB during the parse. The
pools file (every pool per token) is separate and is loaded only by a caller
of `get_pools`, which is the cost worker, not a route.

WHAT A "TOKEN" IS HERE
----------------------
One issuer's token on one chain (a version), counted as listed when all four
hold, tested in this order:

  1. verified on chain by structure (proxy slot, beacon, authority set);
  2. the underlying is US-listed: issuer ISIN or listing country, or a ticker
     match against Nasdaq Trader's directory (`us_not_established` stays in
     the file, flagged, and out of every count and list);
  3. total supply above zero at the read block;
  4. the chain is in the site's chain scope (SITE_CHAINS; SPEC B.1, pending
     owner decision D5).

A record that fails is kept and answers `listed: false` with the first reason
it fails, so a search for its address says why it is not shown rather than
finding nothing.

LOADER API (for the cost worker, T3a)
-------------------------------------
    u = load_universe()                 # cached; safe from any thread
    u.listed_keys()                     # keys of every listed token
    u.record(key_or_id)                 # one expanded record, or None
    u.versions(ticker)                  # listed versions of one underlying
    u.underlying(ticker)                # {ticker, name, type, ...}
    u.underlyings()                     # ticker -> info, listed ones only
    get_pools(key_or_id)                # every pool the universe pass found

Keys are SPEC B.1's: `<chainId>/<address>` on EVM (address lower-case),
`solana/<mint>`, `ton/<address>`, `tron/<address>`. Record ids are the
universe pass's `issuer:chain:address`. Both are accepted everywhere.
"""

from __future__ import annotations

import ctypes
import datetime as dt
import gc
import gzip
import json
import sys
import threading
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

SCHEMA = "te_universe/1"

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
UNIVERSE_FILE = DATA_DIR / "te_universe.json.gz"
POOLS_FILE = DATA_DIR / "te_pools.json.gz"

# The address and the universe pass's record id are not stored: the address
# is the key's tail and the id is issuer:chain:address.
RECORD_FIELDS = (
    "key", "issuer", "chain", "ticker", "symbol", "decimals", "supply",
    "scope", "status", "block_or_slot", "unit", "read_at", "basis", "ctl", "liq",
)
_F = {name: i for i, name in enumerate(RECORD_FIELDS)}

# Written to the file as indexes into `enums[field]`; `liq` as an index into
# `liqs`. The loader turns both back into shared objects.
ENUM_FIELDS = ("issuer", "chain", "ticker", "symbol", "scope", "status", "unit", "read_at")

# status: "pools_found", "no_pool_found" (searched, none against a listed
# quote asset) or "not_measured" (chain not searched). Depth and TVL are null,
# not 0, when no pool was found. `block` is always an int; `block_label`
# says when it is approximate.
LIQ_FIELDS = ("status", "pool_count", "price_outlier_pools", "depth_plus2pct_usd_ub_total",
              "depth_minus2pct_usd_ub_total", "tvl_usd_total", "block", "block_unit", "block_label",
              "top_pools", "venues", "reason")

# The film's seven chains (SPEC B.1). xStocks on Optimism, Mantle, Ink, X Layer,
# TON and Tron are verified and kept in the file, and left out here until the
# owner decides D5. Changing this set is the one switch.
SITE_CHAINS = frozenset({"ethereum", "arbitrum", "base", "bsc", "robinhood", "solana", "hyperevm"})

CHAINS = {
    "ethereum": {"name": "Ethereum", "chain_id": 1, "group": "evm"},
    "bsc": {"name": "BNB Chain", "chain_id": 56, "group": "evm"},
    "arbitrum": {"name": "Arbitrum", "chain_id": 42161, "group": "evm"},
    "base": {"name": "Base", "chain_id": 8453, "group": "evm"},
    "robinhood": {"name": "Robinhood Chain", "chain_id": 4663, "group": "evm"},
    "hyperevm": {"name": "HyperEVM", "chain_id": 999, "group": "evm"},
    "optimism": {"name": "Optimism", "chain_id": 10, "group": "evm"},
    "mantle": {"name": "Mantle", "chain_id": 5000, "group": "evm"},
    "ink": {"name": "Ink", "chain_id": 57073, "group": "evm"},
    "xlayer": {"name": "X Layer", "chain_id": 196, "group": "evm"},
    "solana": {"name": "Solana", "chain_id": None, "group": "nonevm"},
    "ton": {"name": "TON", "chain_id": None, "group": "nonevm"},
    "tron": {"name": "Tron", "chain_id": None, "group": "nonevm"},
}

ISSUER_NAMES = {
    "xstocks": "xStocks", "ondo": "Ondo", "robinhood": "Robinhood",
    "bstocks": "bStocks", "coinbase": "Coinbase",
}

DEFINITION = {
    "token": "issuer-by-chain versions: one issuer's token on one chain counts once; "
             "the same stock from five issuers on seven chains is up to 35 versions of one underlying",
    "counted_when": [
        "verified on chain by structure (proxy slot, beacon or authority set), never by symbol",
        "the underlying is US-listed: issuer ISIN or listing country (class D), or a ticker match "
        "against Nasdaq Trader's symbol directory",
        "total supply above zero at the read block",
        "the chain is one of the seven chains the site covers",
    ],
    # Every top-level count of /api/te/summary that this pass makes. All are
    # out of the counted (listed) versions, `tokens`, except records_read.
    "tokens": "counted versions (issuer-by-chain tokens) that pass every test in counted_when",
    "versions_listed": "the same number as tokens, under the name the cost engine's counts use",
    "issuers": "distinct issuers with at least one counted token",
    "chains": "distinct chains with at least one counted token; chain_list sums to tokens",
    "underlyings": "distinct underlying tickers among the counted versions",
    "versions_with_pool": "counted versions with at least one pool found by the universe pass against a listed "
                          "quote asset (price-outlier pools not counted)",
    "versions_without_pool": "counted versions with no such pool found: tokens minus versions_with_pool; no "
                             "on-chain venue we read",
    "listed_versions_pool_search_not_run": "counted versions for which the universe pass's own pool search did "
                                           "not run; a different count from cost.versions_not_searched, which "
                                           "is the cost engine's and is out of cost.versions_read",
    "records_read": "every record the universe pass read: the verified and unverified token records plus the "
                    "candidates it excluded; the only top-level count not out of tokens",
}

LEFT_OUT_REASONS = {
    "excluded_listing": "excluded: the underlying is listed outside the US, or a test token",
    "not_deployed": "not deployed on this chain: no code at the address at the read block",
    "scope_not_established": "US listing not established: no issuer ISIN or listing country and no Nasdaq Trader ticker match",
    "supply_zero": "total supply 0 at the read block",
    "chain_out_of_scope": "chain scope: the site covers seven chains (Ethereum, BNB Chain, Arbitrum, Base, Robinhood Chain, HyperEVM, Solana), and this is not one of them",
}

CONTROL_KEYS = ("pause", "freeze", "burn", "upgrade", "mint", "allowlist")


class UniverseUnavailable(RuntimeError):
    """The data file is missing or unreadable. A fact about this process, not
    about any token."""


def _supply_zero(s: Any) -> bool | None:
    if s is None:
        return None
    try:
        return Decimal(str(s)) == 0
    except InvalidOperation:
        return None


def _intern(x: Any) -> Any:
    """Interns every string in a parsed JSON value, so the same method or
    kind text read in a thousand cells is one object in memory."""
    if isinstance(x, str):
        return sys.intern(x)
    if isinstance(x, dict):
        return {sys.intern(k): _intern(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_intern(v) for v in x]
    return x


_UNDERLYING_FIELDS = ("name", "name_basis", "type", "type_basis")


def _address(key: str) -> str:
    return key.split("/", 1)[1]


class _Rows:
    """The records, stored column-wise; a row is assembled on access."""

    __slots__ = ("cols",)

    def __init__(self, cols: list[list]) -> None:
        self.cols = cols

    def __len__(self) -> int:
        return len(self.cols[0])

    def __getitem__(self, i: int) -> tuple:
        return tuple(c[i] for c in self.cols)

    def __iter__(self):
        return zip(*self.cols)


class Universe:
    def __init__(self, art: dict, *, path: Path, size: int) -> None:
        if art.get("schema") != SCHEMA:
            raise UniverseUnavailable(f"{path.name}: schema {art.get('schema')!r}, expected {SCHEMA!r}")
        if tuple(art.get("fields") or ()) != RECORD_FIELDS:
            raise UniverseUnavailable(f"{path.name}: record fields do not match this loader")
        self.path = path
        self.file_bytes = size
        self.source: dict = art["source"]
        self.issuers: dict = art["issuers"]
        self._underlyings: dict = {
            sys.intern(t): tuple(_intern(v.get(k)) for k in _UNDERLYING_FIELDS)
            for t, v in art["underlyings"].items()
        }
        self._bases: list = [sys.intern(b) for b in art["bases"]]
        if tuple(art.get("control_keys") or ()) != CONTROL_KEYS:
            raise UniverseUnavailable(f"{path.name}: control keys do not match this loader")
        self._cells: tuple = tuple(_intern(c) for c in art["control_cells"])
        self._controls: tuple = tuple(tuple(ids) for ids in art["controls"])
        self.loaded_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        enums = {f: [_intern(v) for v in art["enums"][f]] for f in ENUM_FIELDS}
        # Most tokens have no pool, and their liquidity entry is the same on
        # every token of a chain, so the file stores each distinct entry
        # once and the rows share it.
        liqs = [tuple(tuple(_intern(v)) if isinstance(v, list) else _intern(v) for v in liq) for liq in art["liqs"]]
        cols = art["columns"]
        if tuple(cols) != RECORD_FIELDS:
            raise UniverseUnavailable(f"{path.name}: columns do not match this loader")
        for f in ENUM_FIELDS:
            vals = enums[f]
            col = cols[f]
            for j, v in enumerate(col):
                if v is not None:
                    col[j] = vals[v]
        col = cols["liq"]
        for j, v in enumerate(col):
            if v is not None:
                col[j] = liqs[v]
        self._rows = _Rows([cols[f] for f in RECORD_FIELDS])
        # Candidates the universe pass excluded (non-US listings, a test
        # token), kept compact: [key, issuer, chain, symbol, reason].
        self._excluded: dict[str, tuple] = {x[0]: tuple(_intern(v) for v in x[1:]) for x in art.get("excluded") or []}
        self.coverage: list = art.get("coverage") or []
        self.venues: dict = art.get("venues") or {}
        self.corrections: list = art.get("corrections") or []
        art.clear()
        self._by_key: dict[str, int] = {}
        self._reason: list[str | None] = []
        self._listed: list[int] = []
        self._by_ticker: dict[str, list[int]] = {}
        for i, r in enumerate(self._rows):
            self._by_key[r[_F["key"]]] = i
            reason = self._first_failure(r)
            self._reason.append(reason)
            if reason is None:
                self._listed.append(i)
                self._by_ticker.setdefault(r[_F["ticker"]], []).append(i)
        self._cache: dict = {}
        self._lock = threading.Lock()

    # ── listing ────────────────────────────────────────────────────────────

    @staticmethod
    def _first_failure(r: tuple) -> str | None:
        if r[_F["status"]] != "verified":
            return "not_deployed"
        if r[_F["scope"]] not in ("us_confirmed", "us_ticker_match"):
            return "scope_not_established"
        if _supply_zero(r[_F["supply"]]) is not False:
            return "supply_zero"
        if r[_F["chain"]] not in SITE_CHAINS:
            return "chain_out_of_scope"
        return None

    def listed_keys(self) -> list[str]:
        return [self._rows[i][_F["key"]] for i in self._listed]

    def _memo(self, key, fn):
        with self._lock:
            if key in self._cache:
                return self._cache[key]
        val = fn()
        with self._lock:
            self._cache[key] = val
        return val

    # ── records ────────────────────────────────────────────────────────────

    def _index(self, key_or_id: str) -> int | None:
        if not key_or_id:
            return None
        i = self._by_key.get(key_or_id)
        if i is not None:
            return i
        if "/" in key_or_id:
            head, _, addr = key_or_id.partition("/")
            if head.isdigit():
                return self._by_key.get(f"{head}/{addr.lower()}")
            return None
        parts = key_or_id.split(":")
        if len(parts) == 3 and parts[1] in CHAINS:
            # A universe-pass record id, issuer:chain:address.
            k = self._key_for(parts[1], parts[2])
            j = self._by_key.get(k)
            if j is not None and self._rows[j][_F["issuer"]] == parts[0]:
                return j
        return None

    @staticmethod
    def _key_for(chain: str, address: str) -> str:
        cid = CHAINS[chain]["chain_id"]
        return f"{cid}/{address.lower()}" if cid is not None else f"{chain}/{address}"

    def _eligibility(self, issuer: str) -> dict | None:
        e = (self.issuers.get(issuer) or {}).get("eligibility") or {}
        if not (e.get("text") and e.get("url") and e.get("read_on")):
            return None
        return {"text": e["text"], "url": e["url"], "read_on": e["read_on"], "class": e.get("class", "D"),
                **({"also": e["also"]} if e.get("also") else {}), "read_note": e.get("read_note")}

    def _fill(self, cell: Any, r: tuple) -> Any:
        """A copy of a shared cell with the token's own address and read
        block put where the cell says "@token" and from_record."""
        if isinstance(cell, dict):
            out = {k: self._fill(v, r) for k, v in cell.items()}
            if out.get("address") == "@token":
                out["address"] = _address(r[_F["key"]])
            if out.pop("from_record", False):
                out["block_or_slot"] = r[_F["block_or_slot"]]
                out["unit"] = r[_F["unit"]]
            return out
        if isinstance(cell, list):
            return [self._fill(v, r) for v in cell]
        return cell

    def controls_of(self, i: int) -> dict | None:
        r = self._rows[i]
        ci = r[_F["ctl"]]
        if ci is None:
            return None
        out = {k: self._fill(self._cells[c], r) for k, c in zip(CONTROL_KEYS, self._controls[ci])}
        out["who_may_hold"] = self._eligibility(r[_F["issuer"]]) or {
            "text": None, "reason": "eligibility text not read for this issuer"}
        return out

    def _uinfo(self, ticker: str) -> dict:
        v = self._underlyings.get(ticker)
        return dict(zip(_UNDERLYING_FIELDS, v)) if v else dict.fromkeys(_UNDERLYING_FIELDS)

    def _chain(self, slug: str) -> dict:
        c = CHAINS.get(slug) or {"name": slug, "chain_id": None, "group": None}
        return {"chain": slug, "chain_name": c["name"], "chain_id": c["chain_id"], "group": c["group"]}

    def _liquidity(self, r: tuple) -> dict | None:
        liq = r[_F["liq"]]
        if liq is None:
            return None
        d = dict(zip(LIQ_FIELDS, liq))
        d["top_pools"] = [dict(p) for p in d["top_pools"] or ()]
        if d["status"] == "not_measured":
            return {"status": d["status"], "reason": d["reason"] or "not searched on this chain"}
        d.pop("reason")
        d["method"] = ("our pool reads: construction discovery plus creation logs where available; "
                       "USD assumes stablecoins at par; depth is an upper bound")
        return d

    def _expand(self, i: int, *, controls: bool = True) -> dict:
        r = self._rows[i]
        reason = self._reason[i]
        address = _address(r[_F["key"]])
        out = {
            "key": r[_F["key"]], "id": f"{r[_F['issuer']]}:{r[_F['chain']]}:{address}",
            "issuer": r[_F["issuer"]], "issuer_name": ISSUER_NAMES.get(r[_F["issuer"]], r[_F["issuer"]]),
            **self._chain(r[_F["chain"]]),
            "address": address,
            "underlying": r[_F["ticker"]],
            "underlying_name": self._uinfo(r[_F["ticker"]])["name"],
            "type": self._uinfo(r[_F["ticker"]])["type"],
            "symbol": r[_F["symbol"]], "decimals": r[_F["decimals"]],
            "total_supply": r[_F["supply"]],
            "supply_zero": _supply_zero(r[_F["supply"]]),
            "us_scope": r[_F["scope"]],
            "verification": {
                "status": r[_F["status"]], "basis": self._bases[r[_F["basis"]]],
                "block_or_slot": r[_F["block_or_slot"]], "unit": r[_F["unit"]], "read_at": r[_F["read_at"]],
            },
            "listed": reason is None,
            "eligibility": self._eligibility(r[_F["issuer"]]),
            "liquidity": self._liquidity(r),
        }
        if reason:
            out["not_listed_reason"] = LEFT_OUT_REASONS[reason]
        if controls:
            out["controls"] = self.controls_of(i)
        return out

    def record(self, key_or_id: str, *, controls: bool = True) -> dict | None:
        i = self._index(key_or_id)
        return None if i is None else self._expand(i, controls=controls)

    def versions(self, ticker: str, *, controls: bool = True) -> list[dict]:
        return [self._expand(i, controls=controls) for i in self._by_ticker.get((ticker or "").upper(), [])]

    def underlying(self, ticker: str) -> dict | None:
        t = (ticker or "").upper()
        idx = self._by_ticker.get(t)
        if not idx:
            return None
        info = self._uinfo(t)
        rows = [self._rows[i] for i in idx]
        return {
            "ticker": t, "name": info.get("name"), "name_basis": info.get("name_basis"),
            "type": info.get("type"), "type_basis": info.get("type_basis"),
            "versions": len(rows),
            "issuers": sorted({ISSUER_NAMES.get(r[_F["issuer"]], r[_F["issuer"]]) for r in rows}),
            "chains": sorted({CHAINS[r[_F["chain"]]]["name"] for r in rows}),
            "groups": sorted({CHAINS[r[_F["chain"]]]["group"] for r in rows}),
        }

    def underlyings(self) -> dict:
        return {t: self.underlying(t) for t in sorted(self._by_ticker)}

    # ── summary ────────────────────────────────────────────────────────────

    def summary(self) -> dict:
        return self._memo("summary", self._summary)

    def _summary(self) -> dict:
        per_chain: dict[str, int] = {}
        per_issuer: dict[str, int] = {}
        for i in self._listed:
            r = self._rows[i]
            per_chain[r[_F["chain"]]] = per_chain.get(r[_F["chain"]], 0) + 1
            per_issuer[r[_F["issuer"]]] = per_issuer.get(r[_F["issuer"]], 0) + 1
        left: dict[str, int] = {k: 0 for k in LEFT_OUT_REASONS}
        left["excluded_listing"] = len(self._excluded)
        out_chains: dict[str, int] = {}
        for i, reason in enumerate(self._reason):
            if reason:
                left[reason] += 1
                if reason == "chain_out_of_scope":
                    c = self._rows[i][_F["chain"]]
                    out_chains[c] = out_chains.get(c, 0) + 1
        chain_list = [
            {"name": CHAINS[c]["name"], "chain": c, "chain_id": CHAINS[c]["chain_id"],
             "group": CHAINS[c]["group"], "tokens": n}
            for c, n in sorted(per_chain.items(), key=lambda kv: (-kv[1], kv[0]))
        ]
        tokens = len(self._listed)
        assert sum(c["tokens"] for c in chain_list) == tokens
        groups: dict[str, int] = {}
        for c in chain_list:
            groups[c["group"]] = groups.get(c["group"], 0) + c["tokens"]
        with_pool = 0
        pools_by_chain: dict[str, list] = {}
        not_searched = 0
        for i in self._listed:
            r = self._rows[i]
            liq = r[_F["liq"]]
            st = liq[0] if liq else "not_measured"
            c = r[_F["chain"]]
            pc = pools_by_chain.setdefault(c, [0, 0])
            if st == "pools_found":
                with_pool += 1
                pc[0] += 1
            else:
                pc[1] += 1
                if st == "not_measured":
                    not_searched += 1
        records_read = int(self.source.get("records") or 0) + int(self.source.get("excluded_candidates") or 0)
        return {
            "tokens": tokens,
            "versions_listed": tokens,
            "underlyings": len(self._by_ticker),
            "versions_with_pool": with_pool,
            "versions_without_pool": tokens - with_pool,
            "listed_versions_pool_search_not_run": not_searched,
            "records_read": records_read,
            "issuers": len(per_issuer),
            "chains": len(chain_list),
            "computed_at": self.source.get("generated_at"),
            "definition": DEFINITION,
            "chain_list": [dict(c, with_pool=pools_by_chain[c["chain"]][0], without_pool=pools_by_chain[c["chain"]][1])
                           for c in chain_list],
            "issuer_list": [{"issuer": s, "name": ISSUER_NAMES.get(s, s), "tokens": n}
                            for s, n in sorted(per_issuer.items(), key=lambda kv: (-kv[1], kv[0]))],
            "groups": groups,
            "venues_searched": [{"chain": CHAINS[c["chain"]]["name"], "venues": (self.venues.get(c["chain"]) or {}).get("venues") or [],
                                 "quote_assets": (self.venues.get(c["chain"]) or {}).get("quote_assets")}
                                for c in chain_list],
            "pools_method": ("our pool reads at a named block per chain: factory construction for every token against "
                             "each listed quote asset, plus creation logs where a log API answered; Solana is Raydium "
                             "only; depth is an upper bound"),
            "coverage": self.coverage,
            "left_out": {
                "records_read": records_read,
                "counted_once_under_the_first_test_failed": True,
                "by_reason": [{"reason": k, "text": LEFT_OUT_REASONS[k], "records": n} for k, n in left.items()],
                "chains_out_of_scope": [{"name": CHAINS[c]["name"], "chain": c, "records": n}
                                        for c, n in sorted(out_chains.items(), key=lambda kv: (-kv[1], kv[0]))],
            },
            "source": self.provenance(),
        }

    def excluded_at(self, address: str) -> list[dict]:
        """Excluded candidates at this address on any chain, with the reason."""
        a = (address or "").strip()
        out = []
        for chain in CHAINS:
            x = self._excluded.get(self._key_for(chain, a))
            if x:
                iss, ch, sym, reason = x
                out.append({"key": self._key_for(chain, a), "symbol": sym, "issuer": ISSUER_NAMES.get(iss, iss),
                            "chain": CHAINS[ch]["name"], "group": CHAINS[ch]["group"], "address": a,
                            "listed": False, "excluded": True, "not_listed_reason": reason})
        return out

    def chain_record_count(self, chain: str) -> int:
        return sum(1 for r in self._rows.cols[_F["chain"]] if r == chain)

    def provenance(self) -> dict:
        return {
            "universe_generated_at": self.source.get("generated_at"),
            "universe_sha256": self.source.get("sha256"),
            "reads": self.source.get("reads_note"),
            "class": "A (chain reads) for identity, supply and controls; D (issuer words, linked and dated) for eligibility",
        }

    # ── indexes the search and controls modules read ───────────────────────

    def listed_indices(self) -> list[int]:
        return self._listed

    def ticker_indices(self) -> dict[str, list[int]]:
        return self._by_ticker

    def address_indices(self, address: str) -> list[int]:
        """Every record at this address on any chain (xStocks deploys the same
        CREATE2 address on each EVM chain)."""
        a = (address or "").strip()
        out = []
        for chain in CHAINS:
            i = self._by_key.get(self._key_for(chain, a))
            if i is not None:
                out.append(i)
        return out

    def row(self, i: int) -> dict:
        """The raw row as a dict (no expansion), with its address and id."""
        d = dict(zip(RECORD_FIELDS, self._rows[i]))
        d["address"] = _address(d["key"])
        d["id"] = f"{d['issuer']}:{d['chain']}:{d['address']}"
        return d

    def reason(self, i: int) -> str | None:
        return self._reason[i]

    def control_set(self, i: int) -> int | None:
        return self._rows[i][_F["ctl"]]

    def raw_controls(self, ci: int) -> dict:
        """One control set as {control: cell}, cells unfilled (evidence still
        carries "@token" and from_record)."""
        return dict(zip(CONTROL_KEYS, (self._cells[c] for c in self._controls[ci])))

    def expand(self, i: int, *, controls: bool = False) -> dict:
        return self._expand(i, controls=controls)

    def eligibility(self, issuer: str) -> dict | None:
        return self._eligibility(issuer)

    def memo(self, key, fn):
        return self._memo(key, fn)


_LOCK = threading.Lock()
_UNIVERSE: Universe | None = None
_POOLS: dict | None = None


def _read_gz(path: Path) -> tuple[dict, int]:
    if not path.exists():
        raise UniverseUnavailable("the tokenized-equity data file is missing on this server")
    try:
        with gzip.open(path, "rb") as fh:
            return json.loads(fh.read()), path.stat().st_size
    except (OSError, ValueError) as e:
        raise UniverseUnavailable(f"the tokenized-equity data file could not be read ({type(e).__name__})") from e


def load_universe(path: Path | None = None) -> Universe:
    """The universe, loaded on first use and then shared. Blocking (a
    decompress and a parse, well under a second): call it from a thread in a
    request path."""
    global _UNIVERSE
    if path is not None:
        art, size = _read_gz(path)
        return Universe(art, path=path, size=size)
    if _UNIVERSE is not None:
        return _UNIVERSE
    with _LOCK:
        if _UNIVERSE is None:
            art, size = _read_gz(UNIVERSE_FILE)
            _UNIVERSE = Universe(art, path=UNIVERSE_FILE, size=size)
            del art
            _release_heap()
    return _UNIVERSE


def _release_heap() -> None:
    """The parse is a transient of about 16 MB over the 9 MB kept. On glibc
    (the Linux services) hand the freed pages back rather than letting the
    allocator keep them; elsewhere this does nothing."""
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        pass


def get_pools(key_or_id: str) -> list[dict] | None:
    """Every pool the universe pass found for one token, deepest first, with
    the block they were read at on each pool's `block`. [] when the pass
    searched and found none; None when the token is unknown or its
    liquidity was not measured (TON, Tron, unverified).

    Loads data/te_pools.json.gz on first call (about 1 MB gzip). Meant for
    the cost worker; no route calls it."""
    global _POOLS
    u = load_universe()
    i = u._index(key_or_id)
    if i is None:
        return None
    r = u.row(i)
    liq = r["liq"]
    if not liq or liq[0] == "not_measured":
        return None
    if liq[0] == "no_pool_found":
        return []
    if _POOLS is None:
        with _LOCK:
            if _POOLS is None:
                _POOLS = _read_gz(POOLS_FILE)[0]["tokens"]
    entry = _POOLS.get(r["id"])
    if not entry:
        return []
    block = entry.get("block")
    pools = [dict(p, block=p.get("block", block), block_unit=entry.get("block_unit"), block_label=entry.get("block_label"),
                  native_usd_ref=entry.get("native_usd_ref")) for p in entry["pools"]]
    pools.sort(key=lambda p: -min(p.get("depth_plus2pct_usd_ub") or 0, p.get("depth_minus2pct_usd_ub") or 0))
    return pools


def iter_listed(u: Universe | None = None) -> Iterable[dict]:
    """Every listed token, expanded without controls: the cost worker's input."""
    u = u or load_universe()
    for i in u.listed_indices():
        yield u.expand(i, controls=False)
