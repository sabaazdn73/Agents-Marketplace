"""The tokenized-equity, vault and curated-basket datasets.

Three descriptors on the six existing tools (mcp/TOKENIZED-EQUITIES.md: one
dataset, no new tools; the vault and basket datasets follow the same
pattern). No tool, input schema or handler signature changes: every argument
arrives in the compound key or in a filter the tools already speak
(chain_id, search, key).

They read exactly what the site's routes read, through the same core/
functions:
  tokenized_equities  /api/te/list, /underlying, /summary, /controls: the
                      cost engine's stored measurements (core/te/cost_views,
                      cost_store) and the verified universe (core/te/universe)
  vaults.stablecoin   /api/vaults: the vault collector's store (core/vaults)
  baskets.curated     /api/baskets/curated and /<code> (core/te/baskets)

THE SCOPE BOUNDARY (spec section 0), kept here:
- Read-only. Nothing is signed, built, broadcast or held. The spec's unsigned
  route (`.../for/<wallet>`) is not built, and asking for it says so.
- Side by side, never ranked. A row carries its own figures; no field names a
  best, a cheapest or a safest, and rows are in key order, not by cost. A
  caller comparing costs does the comparing.
- No issuer-published figure (E18): issuer terms are linked and dated, never
  restated as a number. No Chainlink figure (E22): no premium is served.
- Every figure carries its source (`source` on each record and row).

Each record fits the tool ceilings in envelope.py: an instrument record and
an underlying record are a few KB; a list page is compact rows.
"""

from __future__ import annotations

import asyncio
import re

from mcp_server.registry import Dataset, iso_utc

# The two sizes the spec fixes for cost to fill (4.2.3). The engine measures
# eleven; the site shows all of them.
SIZES = (1000, 10000)
STALENESS_BOUND_S = 900

COST_SOURCE = ("Tnega's cost engine: a buy simulated on the pool itself at a stated block "
               "(TnegaSwapProbe inside eth_call), plus gas, the L1 fee and LI.FI's published 0.25% fee; "
               "dollar stablecoins taken at $1, an assumption")
UNIVERSE_SOURCE = ("Tnega's verified universe: issuer contracts read on chain by structure, "
                   "issuer terms linked and dated, never restated as figures")
VAULT_SOURCE = ("Tnega's vault collector: vault accounts read on chain (Solana through Helius) and the "
                "operator's own documents, each field with its provenance class")
BASKET_SOURCE = ("Tnega's curated baskets (backend/data/te/baskets.json), each leg priced from the cost "
                 "engine's stored measurements")

_KEY = re.compile(r"^(\d+)/(0x[0-9a-fA-F]{40})(?:/(for)/(0x[0-9a-fA-F]{40})|/(supply))?$")
_SOL = re.compile(r"^solana/([1-9A-HJ-NP-Za-km-z]{32,44})(?:/(supply))?$")
_TICKER = re.compile(r"^[A-Z0-9.\-]{1,12}$")


def _num(v, nd=2):
    return round(v, nd) if isinstance(v, (int, float)) else None


def _cost_cell(c: dict) -> dict:
    """One version at one size, the spec's cost-to-fill entry in the engine's
    terms. A version that does not fill carries its state and reason, never a
    zero."""
    out = {"state": c.get("state")}
    if c.get("state") == "filled":
        out.update({
            "total_cost_bps": _num(c.get("cost_bps")), "total_cost_usd": _num(c.get("cost_usd"), 4),
            "allin_per_share_usd": _num(c.get("allin_per_share"), 4),
            "allin_per_token_usd": _num(c.get("allin_per_token"), 4),
            "tokens_per_1000_usd": _num(c.get("tokens_per_1000"), 6),
            "pool_depth_2pct_usd": _num(c.get("pool_usd"), 0),
            "cost_parts_usd": c.get("cost_parts"),
        })
    else:
        out.update({"filled_fraction": c.get("filled_fraction"), "reason": c.get("reason")})
        if c.get("state") in ("partial", "too_thin"):
            out["pool_usd"] = _num(c.get("pool_usd"), 0)
    return out


POWERS = ("pause", "freeze", "burn", "upgrade", "mint", "allowlist")


def _powers(c: dict | None) -> dict | None:
    """Each power as its state and the one line saying who holds it. The
    role members and the eth_call evidence behind each stay on the site's
    /api/te/controls?by=key route, which is where a reader checks them."""
    if not c:
        return None
    return {p: {"state": (c.get(p) or {}).get("state"), "text": (c.get(p) or {}).get("text")}
            for p in POWERS if c.get(p)}


def build_te(providers=None) -> list[Dataset]:
    from core.te import cost_views as cv
    from core.te import controls as te_controls
    from core.te.cost_store import get_store
    from core.te.universe import ISSUER_NAMES, load_universe

    async def universe():
        return await asyncio.to_thread(load_universe)

    async def list_doc():
        return await cv._list_doc(get_store())

    # ── coverage ─────────────────────────────────────────────────────────────
    async def coverage():
        u = await universe()
        s = u.summary()
        ld = await list_doc()
        counts = (ld or {}).get("counts") or {}
        return {
            "instruments": s.get("versions_listed"),
            "instruments_measured": counts.get("versions_measured"),
            "instruments_with_a_measured_cost": counts.get("versions_with_cost"),
            "underlyings": s.get("underlyings"),
            "underlyings_with_a_filled_version": len((ld or {}).get("rows") or []),
            "chains": [c["name"] for c in s.get("chain_list") or []],
            "issuers": sorted(ISSUER_NAMES.values()),
            "sizes_quoted_usd": list(SIZES),
            "numeraire": "USD, dollar stablecoins at $1 (an assumption)",
            "quote_staleness_bound_seconds": STALENESS_BOUND_S,
            "last_poll": (ld or {}).get("computed_at"),
            "universe_read_at": s.get("computed_at"),
            "partial": ld is None,
            **({"note": "the cost worker has not written its first list yet"} if ld is None else {}),
        }

    # ── get ──────────────────────────────────────────────────────────────────
    async def get(key: str):
        k = str(key).strip()
        if k.startswith("underlying/"):
            t = k.split("/", 1)[1].upper()
            if not _TICKER.match(t):
                return None
            return await _underlying(t)
        if k.startswith("issuer/"):
            return await _issuer(k.split("/", 1)[1].lower())
        m = _KEY.match(k)
        s = _SOL.match(k)
        if m and m.group(3) == "for":
            return {"key": k, "withheld_reason": "not_built",
                    "explanation": "The unsigned route for a wallet (spec section 9) is not built. Nothing is "
                                   "signed or built here; the site's buy panel is where a route is quoted."}
        if (m and m.group(5)) or (s and s.group(2)):
            return {"key": k, "withheld_reason": "not_built",
                    "explanation": "The supply key (spec 4.8) is not built. Issuer-published supply is on the "
                                   "issuer's page and is not restated here (E18)."}
        if s:
            return {"key": k, "withheld_reason": "not_covered",
                    "explanation": "Solana versions are listed but their cost is not measured yet."}
        if not m:
            return None
        return await _instrument(f"{m.group(1)}/{m.group(2).lower()}")

    async def _underlying(t: str):
        """Every version side by side, compact enough for the 8KB ceiling:
        per version its figures at 1,000 and 10,000 USD, or its state and
        reason (once, when it is the same at both sizes). The full record of
        one version is at its own key."""
        cells: dict[str, dict] = {}
        head = None
        for size in SIZES:
            status, body = await cv.underlying_view(get_store(), t, size)
            if status != 200:
                return None if status == 404 else {"key": f"underlying/{t}", "withheld_reason": "not_measured",
                                                   "explanation": body.get("reason")}
            head = head or body
            for c in body.get("versions") or []:
                cells.setdefault(c["key"], {})[size] = c
        versions = []
        for key in sorted(cells):
            c1, c10 = cells[key].get(1000) or {}, cells[key].get(10000) or {}
            v = {"key": key, "symbol": c1.get("symbol"), "issuer": c1.get("issuer"), "chain_id": c1.get("chain_id"),
                 "shares_per_token": _num(c1.get("share_ratio"), 6), "block": c1.get("block")}
            for size, c in ((1000, c1), (10000, c10)):
                tag = "1k" if size == 1000 else "10k"
                if c.get("state") == "filled":
                    v[f"allin_per_share_usd_{tag}"] = _num(c.get("allin_per_share"), 4)
                    v[f"cost_bps_{tag}"] = _num(c.get("cost_bps"))
                    if size == 1000:
                        v["tokens_per_1000_usd"] = _num(c.get("tokens_per_1000"), 6)
                        v["pool_depth_2pct_usd"] = _num(c.get("pool_usd"), 0)
                else:
                    v[f"state_{tag}"] = c.get("state")
            reasons = {c.get("reason") for c in (c1, c10) if c.get("state") != "filled" and c.get("reason")}
            if reasons:
                v["reason"] = "; ".join(sorted(r[:180] for r in reasons))
            versions.append(v)
        return {
            "key": f"underlying/{t}", "ticker": t, "name": head.get("name"), "type": head.get("type"),
            "versions": versions,
            "order": "by key; side by side, not ranked",
            "fields": ("allin_per_share_usd: all-in cost of one share's worth through this version (size, gas, "
                       "L1 fee, LI.FI's fee, over tokens received, over shares_per_token); it is the figure that "
                       "compares versions. cost_bps: fees and price impact against the pool's own mid. A missing "
                       "allin_per_share with a cost means shares_per_token is not read. state_1k or state_10k and "
                       "reason: why a version has no cost at that size."),
            "measured_at": head.get("computed_at"),
            "source": COST_SOURCE,
            "lifi_fee_included": True,
        }

    async def _instrument(key: str):
        from core.te.cost_views import _cell
        store = get_store()
        chain_id = int(key.split("/")[0])
        ld = await list_doc()
        if ld is None:
            return {"key": key, "withheld_reason": "not_measured", "explanation": "the cost worker has not written yet"}
        # One read: the documents of the underlying this key belongs to.
        u = await universe()
        ctl = te_controls.by_key(u, key)
        ticker = (ctl or {}).get("underlying")
        docs = await store.costs_for(ticker) if ticker else []
        doc = next((d for d in docs if d.get("key") == key), None)
        if doc is None:
            return None if ctl is None else {"key": key, "withheld_reason": "not_measured",
                                             "explanation": "listed, but the cost engine has no reading for it",
                                             "transfer_control": _powers(ctl.get("controls"))}
        cv.annotate_ref_gap(docs)
        cells = {size: _cell(doc, size) for size in SIZES}
        c0 = cells[SIZES[0]]
        return {
            "key": key, "chain_id": chain_id, "token_address": key.split("/")[1], "symbol": doc.get("symbol"),
            "issuer": ISSUER_NAMES.get(doc.get("issuer"), doc.get("issuer")), "issuer_key": f"issuer/{doc.get('issuer')}",
            "underlying_key": f"underlying/{doc.get('underlying')}",
            "shares_per_token": _num(doc.get("share_ratio"), 6),
            "shares_per_token_basis": doc.get("share_ratio_basis"),
            "quote_basis": {"block": doc.get("block"), "measured_at": doc.get("computed_at"),
                            "staleness_bound_seconds": STALENESS_BOUND_S,
                            "us_market_open": doc.get("us_market_open")},
            "cost_to_fill": [{"notional_usd": size, "side": "buy", **_cost_cell(cells[size])} for size in SIZES],
            "gap_to_reference_bps": c0.get("ref_gap_bps"), "gap_to_reference_basis": c0.get("ref_gap_basis"),
            "pool": c0.get("pool"),
            "transfer_control": _powers((ctl or {}).get("controls")),
            "transfer_control_source": UNIVERSE_SOURCE + "; role members and evidence: "
                                       f"https://agents-marketplace-q3k4.onrender.com/api/te/controls?by=key&key={key}",
            "eligibility": cv._elig(ld, doc.get("issuer")),
            "premium": None,
            "premium_basis": "not served: a premium needs a reference price feed, and Chainlink figures are "
                             "held until written permission (E22)",
            "source": COST_SOURCE,
        }

    async def _issuer(iid: str):
        if iid not in ISSUER_NAMES:
            return None
        u = await universe()
        rows = (await asyncio.to_thread(te_controls.by_issuer, u, iid, None)).get("rows") or []
        ld = await list_doc()
        return {"key": f"issuer/{iid}", "issuer": ISSUER_NAMES[iid],
                "programmes": [{"programme": r.get("programme"), "family": r.get("family"), "chains": r.get("chains"),
                                "tokens": r.get("tokens"), "powers": _powers(r)} for r in rows],
                "powers_detail": f"https://agents-marketplace-q3k4.onrender.com/api/te/controls?by=issuer&issuer={iid}",
                "eligibility": cv._elig(ld or {}, iid),
                "issuer_figures": "not restated here (E18): the issuer's own page is linked in eligibility",
                "source": UNIVERSE_SOURCE}

    # ── list ─────────────────────────────────────────────────────────────────
    async def list_(*, limit, offset, chain_id=None, search=None, key=None, **_):
        """One row per measured version, in key order. `search` matches a
        ticker, a token symbol or a name; `key` narrows to underlying/<T>."""
        from core.te.cost_views import _cell
        store = get_store()
        ld = await list_doc()
        if ld is None:
            return {"rows": [], "total": None, "partial": True, "note": "the cost worker has not written yet"}
        docs = await store.all_costs()
        q = str(search or "").strip().upper()
        want_u = str(key).split("/", 1)[1].upper() if key and str(key).startswith("underlying/") else None
        names = {r["u"]: (r.get("name") or "") for r in ld.get("rows") or []}
        rows = []
        for d in docs:
            if chain_id is not None and d.get("chain_id") != int(chain_id):
                continue
            if want_u and d.get("underlying") != want_u:
                continue
            if q and q not in (d.get("underlying") or "") and q not in (d.get("symbol") or "").upper() \
                    and q not in names.get(d.get("underlying"), "").upper():
                continue
            rows.append(d)
        rows.sort(key=lambda d: (d.get("underlying") or "", d.get("key")))
        page = rows[offset:offset + limit]
        out = []
        for d in page:
            c1, c10 = _cell(d, 1000), _cell(d, 10000)
            out.append({
                "key": d["key"], "underlying": d.get("underlying"), "symbol": d.get("symbol"),
                "issuer": ISSUER_NAMES.get(d.get("issuer"), d.get("issuer")), "chain_id": d.get("chain_id"),
                "state_1k": c1.get("state"),
                "allin_per_share_usd_1k": _num(c1.get("allin_per_share"), 4),
                "cost_bps_1k": _num(c1.get("cost_bps")), "cost_bps_10k": _num(c10.get("cost_bps")),
                "state_10k": c10.get("state"),
                "measured_at": d.get("computed_at"),
            })
        return {"rows": out, "total": len(rows), "partial": False,
                "note": "one row per version, in key order, side by side and not ranked; cost_bps is against the "
                        "pool's own mid, so allin_per_share_usd_1k is the figure that compares versions. Source: "
                        + COST_SOURCE}

    # ── summary ──────────────────────────────────────────────────────────────
    async def summary(*, chain_id=None, **_):
        ld = await list_doc()
        u = await universe()
        s = u.summary()
        counts = (ld or {}).get("counts") or {}
        by_chain = counts.get("by_chain") or []
        if chain_id is not None:
            by_chain = [c for c in by_chain if c.get("chain_id") == int(chain_id)]
        return {
            "instruments_listed": s.get("versions_listed"),
            "underlyings_listed": s.get("underlyings"),
            "instruments_measured": counts.get("versions_measured"),
            "instruments_with_a_measured_cost": counts.get("versions_with_cost"),
            "definition": counts.get("definition"),
            "by_chain": by_chain,
            "tokens_by_chain": [{"chain": c["name"], "tokens": c["tokens"]} for c in s.get("chain_list") or []],
            "measured_at": (ld or {}).get("computed_at"),
            "source": COST_SOURCE,
        }

    caveats = [
        "Cost to fill leads. Every figure is simulated on the pool at a stated block by this collector; "
        "see cost_to_fill and quote_basis. A version that does not fill a size carries its state and reason, "
        "never a zero.",
        "Side by side, never ranked: rows are in key order and no field names a best. total_cost_bps is "
        "measured against the pool's own mid, so it does not compare issuers; allin_per_share_usd does, where "
        "shares_per_token is read.",
        "Issuer figures are not restated (E18) and no premium is served (E22). Eligibility is the issuer's own "
        "words, linked and dated.",
        "Read-only: nothing is signed, built or held. The unsigned route of the spec is not built.",
        "Solana versions are listed but not measured yet.",
        "as_of is the cost engine's last poll, coverage.last_poll; each version also carries its own block "
        "and measured_at, which can be older when a chain's read failed.",
    ]
    return [Dataset(
        id="tokenized_equities",
        title="Tokenized equities: cost to fill",
        measures="what it costs to buy a tokenized stock or ETF at 1,000 and 10,000 USD, per issuer's version "
                 "on each chain, simulated on the pools at a stated block, with transfer controls and "
                 "eligibility",
        keys=["chain id/token address, as 4663/0x...",
              "underlying/<ticker>, which lists every token version side by side, as underlying/NVDA",
              "issuer/<id>, as issuer/robinhood (xstocks, robinhood, bstocks, ondo, coinbase)"],
        example_filters={"search": "NVDA"},
        coverage=coverage, get=get, list=list_, summary=summary,
        as_of=lambda c: iso_utc(c.get("last_poll")),
        caveats=caveats,
    )]


def build_vaults(providers=None) -> list[Dataset]:
    from core.vaults import service
    from core.vaults.store import get_store

    async def coverage():
        body = await service.list_vaults(get_store(), None, 1, 0)
        if body is None:
            return {"vaults": 0, "partial": True, "note": "no vault read has been stored yet"}
        return {"vaults": body.get("total"),
                "platforms": [{"platform": p.get("platform"), "listed": p.get("listed"), "status": p.get("status")}
                              for p in body.get("platforms") or []],
                "listing_rule_at": "https://agents-marketplace-q3k4.onrender.com/api/vaults (field rule)",
                "read_at": body.get("computed_at"),
                "partial": bool(body.get("partial"))}

    def _row(v: dict) -> dict:
        # About 250 bytes: what to choose a vault by. Who controls it, what it
        # lends against, fees and audits are one tnega_get away.
        return {"key": v.get("key"), "name": v.get("name"), "platform": v.get("platform"),
                "token": v.get("token_symbol") or v.get("tvl_symbol"),
                "tvl_usd": v.get("tvl_usd"), "tvl_source": v.get("tvl_source"),
                "tvl_stale": v.get("tvl_stale"),
                "inside_another_listed_vault": bool(v.get("nested_in"))}

    async def list_(*, limit, offset, search=None, **_):
        body = await service.list_vaults(get_store(), None, 1000, 0)
        if body is None:
            return {"rows": [], "total": None, "partial": True, "note": "no vault read has been stored yet"}
        rows = body.get("vaults") or []
        q = str(search or "").strip().lower()
        if q:
            rows = [v for v in rows if q in (v.get("name") or "").lower() or q in (v.get("platform") or "").lower()
                    or q in (v.get("address") or "").lower() or q in (v.get("token_symbol") or "").lower()]
        return {"rows": [_row(v) for v in rows[offset:offset + limit]], "total": len(rows),
                "partial": bool(body.get("partial")),
                "note": "in the site's order (platform, then name), not ranked. tvl_usd counts tokens at 1 USD "
                        "(face value); a vault inside another listed vault is named in nested_in, and its dollars "
                        "are already in that vault's TVL. Source: " + VAULT_SOURCE}

    async def get(key: str):
        parts = str(key).split("/")
        if len(parts) != 2:
            return None
        d = await service.vault_detail(get_store(), parts[0], parts[1])
        if d is None:
            return None
        row = d.get("row") or {}
        return {"key": key, "name": d.get("name"), "platform": d.get("platform"), "chain": d.get("chain"),
                "address": d.get("address"), "token": d.get("token"),
                "tvl": {k: v for k, v in (d.get("tvl") or {}).items() if k not in ("allocations",)},
                "manager": (d.get("manager") or {}).get("text"), "controls": (d.get("controls") or {}).get("text"),
                "fees": (d.get("fees") or {}).get("text"), "lockup": (d.get("lockup") or {}).get("text"),
                "audits": (d.get("audits") or {}).get("text"),
                "assets": (d.get("assets") or {}).get("text"),
                "lends_against": row.get("lends_against"), "notes": row.get("notes"),
                "nested_in": row.get("nested_in"), "contains_nested": row.get("contains_nested"),
                "read_at": d.get("read_at"), "deposits": "on the venue, signed in the user's own wallet; this "
                                                         "server never holds funds and has no deposit path",
                "source": VAULT_SOURCE}

    async def summary(**_):
        body = await service.list_vaults(get_store(), None, 1000, 0)
        if body is None:
            return {"note": "no vault read has been stored yet"}
        vs = body.get("vaults") or []
        nested = {v.get("address") for v in vs if v.get("nested_in")}
        by_platform: dict[str, dict] = {}
        for v in vs:
            p = by_platform.setdefault(v.get("platform"), {"vaults": 0, "tvl_usd": 0.0})
            p["vaults"] += 1
            p["tvl_usd"] = round(p["tvl_usd"] + (v.get("tvl_usd") or 0), 2)
        return {"vaults": len(vs), "by_platform": by_platform,
                "tvl_usd_sum": round(sum(v.get("tvl_usd") or 0 for v in vs), 2),
                "tvl_usd_sum_basis": "the sum of each listed vault's TVL, tokens at 1 USD; vaults inside another "
                                     "listed vault are counted in both, so this sum counts those dollars twice",
                "vaults_inside_another_listed_vault": len(nested),
                "read_at": body.get("computed_at"), "source": VAULT_SOURCE}

    return [Dataset(
        id="vaults.stablecoin",
        title="Stablecoin vaults: due diligence",
        measures="vaults taking a stablecoin deposit, read on chain: TVL, who controls them, what they lend "
                 "against, fees, lockup and audits",
        keys=["platform/address, as kamino/A1USdzqDHmw5oz97AkqAGLxEQZfFjASZFuy4T6Qdvnpo"],
        coverage=coverage, get=get, list=list_, summary=summary,
        as_of=lambda c: iso_utc(c.get("read_at")),
        caveats=["Read on chain and from each operator's documents; not a recommendation, not ranked. "
                 "Deposits happen on each venue, signed in the user's own wallet.",
                 "TVL counts stablecoins at 1 USD (face value). No 30-day return or age is served yet: the "
                 "collector keeps its latest read, not a history.",
                 "as_of is the collector's last pass, coverage.read_at; a vault marked tvl_stale carries an "
                 "older figure, as recorded."],
    )]


def build_baskets(providers=None) -> list[Dataset]:
    from core.te import baskets as core
    from core.te.cost_store import get_store

    async def coverage():
        doc = core.load_curated()
        try:
            priced_at = (await core.curated_list(get_store(), 1000)).get("computed_at")
        except Exception:  # noqa: BLE001  the cost store, not the file
            priced_at = None
        return {"baskets": len(doc.get("baskets") or []), "file_version": doc.get("file_version"),
                "sizes": "any measured size; lists use 1,000 USD", "priced_at": priced_at,
                "partial": priced_at is None}

    def _card(b: dict) -> dict:
        # Tickers and weights only; the version each leg buys, with its cost,
        # is in the basket's own record.
        return {"key": b.get("code"), "name": b.get("name"), "complete": b.get("complete"),
                "legs": ", ".join(f"{l.get('ticker')} {round((l.get('weight_bps') or 0) / 100)}%"
                                  for l in b.get("legs") or []),
                "cost_bps_at_1000_usd": b.get("cost_bps"), "signatures": b.get("signatures"),
                "largest_size_under_1pct_usd": b.get("cap_usd")}

    async def list_(*, limit, offset, **_):
        body = await core.curated_list(get_store(), 1000)
        cards = [_card(b) for b in body.get("baskets") or []]
        return {"rows": cards[offset:offset + limit], "total": len(cards), "partial": False,
                "note": body.get("note", "") + " Each leg's version is the cost engine's lowest all-in price per "
                        "share at the leg's own size when read. Source: " + BASKET_SOURCE}

    async def get(key: str):
        code = str(key).strip().lower()
        if not core.CODE.fullmatch(code):
            return None
        d = await core.curated_detail(get_store(), code, 1000)
        if d is None:
            return None
        keep = ("code", "name", "description", "version", "created_at", "note", "size", "complete", "cost_bps",
                "cost_usd", "cost_reason", "signatures", "evm", "nonevm", "cap_usd", "cap_leg", "cap_lower_bound",
                "computed_at", "cost_basis", "cap_basis")
        out = {k: d.get(k) for k in keep}
        out["legs"] = [{k: l.get(k) for k in ("ticker", "weight_bps", "symbol", "issuer", "chain", "state",
                                              "leg_usd", "leg_cost_bps", "reason")} for l in d.get("legs") or []]
        out["return_since_creation_pct"] = None
        out["return_basis"] = d.get("return_basis")
        out["source"] = BASKET_SOURCE
        return out

    async def summary(**_):
        body = await core.curated_list(get_store(), 1000)
        return {"baskets": [{"key": b.get("code"), "name": b.get("name"), "legs": len(b.get("legs") or []),
                             "cost_bps_at_1000_usd": b.get("cost_bps")} for b in body.get("baskets") or []],
                "computed_at": body.get("computed_at"), "source": BASKET_SOURCE}

    return [Dataset(
        id="baskets.curated",
        title="Curated baskets: a fixed example, priced",
        measures="Tnega's fixed example baskets of tokenized stocks and ETFs, each leg priced at 1,000 USD "
                 "from the cost engine's measurements",
        keys=["basket code, as tech-4"],
        coverage=coverage, get=get, list=list_, summary=summary,
        as_of=lambda c: iso_utc(c.get("priced_at")),
        caveats=["A fixed example basket, equal or stated weights; not a recommendation. No return is served: "
                 "price history is not kept.",
                 "as_of is when the legs were priced, coverage.priced_at: the cost engine's reading the basket "
                 "was priced from."],
    )]
