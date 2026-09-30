"""The tools: six that read measurements, three that prepare an order.

The surface is split by the shape of the answer, not by subject. Subject is a
parameter whose valid values come from tnega_catalogue at run time. mcp/DESIGN.md
section 2 has the argument; the consequence is here: a new dataset adds a row to
the catalogue, never a tool, so the tool list a client cached last month is still
correct.

ON THE DESCRIPTIONS
-------------------
A REST endpoint's documentation is read by a developer who has already decided
to call it. These are read by a model deciding whether to call at all, from a
list, once, with no way to ask a follow-up. So each one states, in order: what
it answers, what it needs, what it returns including the cap, and which sibling
to use instead. That last clause carries the most weight, because the model's
question is usually "this one or that one".

The standard, from the Smithery survey: 99.7% of tools carry a description,
median length 197 characters. scripts/mcp_selfcheck.py enforces the shape here:
120 to 400 characters, at least one sibling named, and the cap stated.

THE THREE THAT PREPARE AN ORDER
-------------------------------
tnega_prepare_buy and tnega_prepare_sell choose a version, ask LI.FI for a
route, and return a link to tnega.app/sign where the user signs every
transaction in their own wallet. tnega_wallet_holdings reads balances. None
of them signs, sends, holds or stores anything: the order travels in the
link's own signed id (core/te/sign_link.py), and the logic is in
core/te/prepare.py and core/te/holdings.py, so these handlers only read and
refuse arguments and wrap the answer.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from typing import Any

from mcp_server import envelope
from mcp_server.registry import iso_utc, call

def _echo(query: str) -> str:
    """The identifier, whole.

    It was cut at 40 characters, which is two short of an address, so the
    surface echoed back a key that was not the key it had been given and that
    would not resolve if anyone copied it.
    """
    return query if len(query) <= 72 else query[:69] + "..."


_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_NUMERIC = re.compile(r"^\d+$")

LIST_DEFAULT = 25
LIST_MAX = 50
SERIES_MAX = 200
RESOLVE_MAX = 12  # an xStocks address is one version on each of four EVM chains, plus the address datasets


# ── cursors ──────────────────────────────────────────────────────────────────
#
# Opaque, and carrying the filter set as well as the position. A caller cannot
# widen a page by editing a number, and cannot change the filters halfway
# through a walk and still call it the same walk.

def _cursor_encode(dataset: str, offset: int, filters: dict) -> str:
    raw = json.dumps({"d": dataset, "o": offset, "f": filters},
                     separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _cursor_decode(cursor: str) -> dict | None:
    try:
        pad = "=" * (-len(cursor) % 4)
        return json.loads(base64.urlsafe_b64decode(cursor + pad))
    except (ValueError, binascii.Error, TypeError):
        return None


def _clamp(n: Any, default: int, hi: int) -> int:
    try:
        return max(1, min(int(n), hi))
    except (TypeError, ValueError):
        return default


def _coverage(cov: dict | None, **extra) -> dict:
    """Coverage as every tool reports it, with partial always present.

    partial was set by the catalogue and passed through untouched by the other
    four tools, so the same dataset answered partial false from one tool and
    left the field out entirely from another. A reader that has to tell false
    from absent will get it wrong, and an audit of this surface did.
    """
    base = dict(cov or {})
    base["partial"] = bool(base.get("partial"))
    base.update(extra)
    return base


def _as_of(fn, block: Any) -> str | None:
    """When the data was measured, from a dataset's own reader, or null.

    Never the call time: that is served_at, and the two being the same field
    is how a series that stopped on 2026-09-19 read as current on the 25th.
    A reader that fails gives null rather than taking the answer down with it.
    """
    if fn is None or not isinstance(block, dict):
        return None
    try:
        return iso_utc(fn(block))
    except Exception:  # noqa: BLE001
        return None


def _empty_result(tool: str, dataset: str, filters: dict, cov: dict,
                  as_of: str | None = None) -> dict:
    """Nothing matched, said as a reason rather than as zeros.

    The server's own instructions promise that a measurement with nothing
    behind it returns a withheld_reason. Asking agents.index for chain 1
    returned matched 0 with every tier count at 0 and withheld_reason null,
    which reads as a measured absence of agents rather than as a filter that
    selected nothing.
    """
    shown = ", ".join(f"{k}={v!r}" for k, v in sorted(filters.items())) or "no filters"
    return envelope.withheld(
        measured=f"{tool} over {dataset}",
        coverage=_coverage(cov, filters=filters, matched=0),
        as_of=as_of,
        reason="no_matches",
        explanation=f"Nothing in {dataset} matches {shown}. This is an empty "
                    f"selection, not a measurement of zero. tnega_catalogue "
                    f"lists what each dataset holds.")


def _unknown_dataset(tool: str, dataset: str, datasets: dict, verb: str | None = None) -> dict:
    """A wrong id recovers in one call rather than by guessing.

    The valid ids come back in the response, which is why this is a withheld
    envelope rather than a protocol error: an error string is not a list of
    what would have worked.
    """
    if verb:
        usable = sorted(k for k, d in datasets.items() if getattr(d, verb) is not None)
        explanation = (f"No dataset '{dataset}' supports {verb}. "
                       f"These do: {', '.join(usable) or 'none yet'}.")
        reason = "dataset_does_not_support_verb"
    else:
        explanation = (f"No dataset called '{dataset}'. "
                       f"Valid ids: {', '.join(sorted(datasets))}.")
        reason = "unknown_dataset"
    return envelope.withheld(
        measured=f"{tool} over dataset '{dataset}'",
        coverage={"datasets": len(datasets), "partial": False},
        reason=reason, explanation=explanation)


# ── the tools ────────────────────────────────────────────────────────────────

async def catalogue(datasets: dict, args: dict) -> dict:
    refused = _undeclared("tnega_catalogue", args, CATALOGUE_ARGS)
    if refused:
        return refused
    rows = []
    partial = False
    for d in sorted(datasets.values(), key=lambda x: x.id):
        # No caveats here. They rode along in every row and took the
        # catalogue over its ceiling, so production answered "what do you
        # have" with 4 of its 6 datasets. Every get, list and summary on a
        # dataset carries its caveats in full, which is where they are read
        # beside the number they qualify.
        row = {
            "id": d.id,
            "title": d.title,
            "measures": d.measures,
            "keys": d.keys,
            "supports": d.verbs(),
        }
        if d.example_filters:
            row["example_filters"] = d.example_filters
        if d.deprecated:
            row["deprecated"] = d.deprecated
        # Coverage per dataset, live. A catalogue that says what exists without
        # saying how current it is would be the one place in this surface where
        # a number arrives without its denominator.
        #
        # Isolated per dataset: one unreachable store degrades its own row to
        # partial and leaves the rest answerable, rather than turning "what do
        # you have" into an error.
        try:
            cov = await call(d.coverage)
            # partial is always present, never merely absent. A service that
            # does not use the word is not partial, and a reader that has to
            # tell "false" from "the key is missing" will eventually get it
            # wrong. Production showed partial=None on two of five rows.
            row["coverage"] = {**cov, "partial": bool(cov.get("partial"))}
            row["as_of"] = _as_of(d.as_of, cov)
        except Exception as e:  # noqa: BLE001
            partial = True
            row["coverage"] = {"partial": True,
                               "unavailable": type(e).__name__}
            row["as_of"] = None
        rows.append(row)
    # The catalogue's own as_of is its least current dataset: every row was
    # measured at that time or later. Rows with no measurement time, such as
    # configuration, do not count toward it.
    times = [r["as_of"] for r in rows if r.get("as_of")]
    caveats = ["Each row's as_of is when that dataset was measured, null for "
               "configuration or when no time is recorded. The catalogue's "
               "as_of is the oldest of them. Each dataset's caveats come "
               "with tnega_get, tnega_list and tnega_summary on it."]
    if partial:
        caveats.append("A row with coverage.partial true could not be read "
                       "just now. That is a fact about this call, not about "
                       "the dataset.")
    return envelope.build(
        measured="every dataset Tnega holds, with its coverage",
        coverage={"datasets": len(rows), "partial": partial},
        as_of=min(times) if times else None,
        value=rows,
        caveats=caveats)


async def resolve(datasets: dict, args: dict) -> dict:
    """Local data only. The live 8004scan and RPC lookups in
    core/universal_search.py stay out: they spend a shared per-IP quota, and
    behind an unauthenticated endpoint that is a free proxy to someone else's
    rate budget."""
    refused = _undeclared("tnega_resolve", args, RESOLVE_ARGS)
    if refused:
        return refused
    query = str(args.get("query") or "").strip()
    if not query:
        return envelope.withheld(
            measured="what a string could refer to",
            coverage={"searched": "stored data only", "partial": False},
            reason="empty_query",
            explanation="Give a 0x address, a token id, an agent id, a chain view name, a stock ticker or "
                        "company name, or a basket code.")

    candidates: list[dict] = []
    if _ADDRESS.match(query):
        addr = query.lower()
        for ds, note in (("hyperliquid.post_only", "as a maker address"),
                         ("budgets.escrow", "as an agent address"),
                         ("jobs.erc8183", "as a provider address")):
            if ds in datasets:
                candidates.append({"dataset": ds, "key": addr, "why": note})
    if _UUID.match(query) or _NUMERIC.match(query):
        if "agents.index" in datasets:
            candidates.append({"dataset": "agents.index", "key": query.lower(),
                               "why": "as an agent id or token id"})
    if "chains.views" in datasets:
        from core import chain_views
        if query.lower() in chain_views.view_ids():
            candidates.append({"dataset": "chains.views", "key": query.lower(),
                               "why": "as a chain view"})
    # Tokenized equities (mcp/TOKENIZED-EQUITIES.md section 5): a ticker or a
    # company name resolves to one underlying, which lists its versions; a
    # token address resolves to that version. Stored data only: the same
    # search the site's /api/te/search runs over the verified universe.
    if "tokenized_equities" in datasets and len(query) <= 64:
        try:
            import asyncio
            from core.te import search as te_search
            from core.te.universe import load_universe
            u = await asyncio.to_thread(load_universe)
            hits = (await asyncio.to_thread(te_search.search, u, query, 3)).get("results") or []
        except Exception:  # noqa: BLE001  the universe file, not the query
            hits = []
        # Rank: an exact ticker first, then a token-symbol or address match,
        # then a whole word of the name; a match that is only a substring of
        # a name (kriSPY for SPY) comes after all of those, and for a query of
        # four characters or fewer it is dropped as noise.
        q_up = query.upper()
        is_addr = bool(_ADDRESS.match(query))

        def _rank(h: dict) -> int:
            if str(h.get("underlying") or "").upper() == q_up:
                return 0
            if h.get("match") in ("symbol", "address") or h.get("matched_versions"):
                return 1
            words = re.findall(r"[A-Z0-9]+", str(h.get("name") or "").upper())
            if q_up in words:
                return 2
            return 3

        ranked = sorted(((_rank(h), i, h) for i, h in enumerate(hits)), key=lambda x: (x[0], x[1]))
        ranked = [(r, h) for r, _, h in ranked if not (r == 3 and len(query) <= 4)]
        te_c: list[dict] = []
        for _, h in ranked[:2]:
            listed = [m for m in (h.get("matched_versions") or []) if m.get("key") and m.get("listed", True)]
            if is_addr:
                # One address can be one token on several chains (xStocks
                # deploys the same address on each EVM chain): every version
                # at it comes back, one per chain, each named by its chain.
                mine = [m for m in listed if str(m.get("address") or "").lower() == query.lower()]
            else:
                # A token symbol returns every version with that symbol; a
                # prefix match only when nothing has the exact symbol.
                exact = [m for m in listed if str(m.get("symbol") or "").upper() == q_up]
                mine = exact or listed[:1]
            for m in mine:
                te_c.append({
                    "dataset": "tokenized_equities", "key": m["key"],
                    **({"match": f"this address on {m.get('chain')}"} if is_addr else {}),
                    "why": f"{m.get('symbol')} by {m.get('issuer')} on {m.get('chain')}"})
            if h.get("underlying"):
                te_c.append({"dataset": "tokenized_equities", "key": f"underlying/{h['underlying']}",
                             "why": f"{h.get('name') or h['underlying']}: every version side by side"})
        # ONE ORDER FOR EVERY QUERY: the underlying first (every version side
        # by side), then the labelled versions by chain id (Solana, which has
        # none, last), then the other datasets that merely accept the string.
        def _chain_order(c: dict) -> tuple:
            head = str(c["key"]).split("/", 1)[0]
            return (0, int(head)) if head.isdigit() else (1, 0)
        und = [c for c in te_c if str(c["key"]).startswith("underlying/")]
        ver = sorted((c for c in te_c if c not in und), key=_chain_order)
        candidates = und + ver + candidates
    if "baskets.curated" in datasets:
        from core.te import baskets as te_baskets
        if te_baskets.CODE.fullmatch(query.lower()) and any(
                b.get("code") == query.lower() for b in te_baskets.load_curated().get("baskets") or []):
            candidates.append({"dataset": "baskets.curated", "key": query.lower(), "why": "as a curated basket"})

    if not candidates:
        return envelope.withheld(
            measured=f"what '{_echo(query)}' could refer to",
            coverage={"searched": "stored data only", "partial": False},
            reason="unrecognised_identifier",
            explanation="Not an address, token id, agent id, chain view name, listed stock or basket code. "
                        "Free text is not searched here; use tnega_list with a "
                        "search filter instead.")

    return envelope.build(
        measured=f"what '{_echo(query)}' could refer to",
        coverage={"searched": "stored data only, no live lookup",
                  "candidates": len(candidates), "partial": False},
        value=candidates[:RESOLVE_MAX],
        caveats=["A candidate says which dataset accepts this key, not that the "
                 "dataset holds a record for it. tnega_get answers that."])


async def get(datasets: dict, args: dict) -> dict:
    refused = _undeclared("tnega_get", args, GET_ARGS)
    if refused:
        return refused
    dataset = str(args.get("dataset") or "")
    d = datasets.get(dataset)
    if d is None or d.get is None:
        return _unknown_dataset("tnega_get", dataset, datasets,
                                verb="get" if d is not None else None)
    key = str(args.get("id") or "").strip()
    if not key:
        return envelope.withheld(
            measured=f"one record from {dataset}",
            coverage={"accepts": d.keys, "partial": False},
            reason="missing_id",
            explanation=f"{dataset} is keyed by {', '.join(d.keys)}. "
                        f"Use tnega_resolve if you have a name rather than an id.")

    try:
        cov = _coverage(await call(d.coverage))
    except Exception as e:  # noqa: BLE001
        cov = {"partial": True, "unavailable": type(e).__name__}
    record = await call(d.get, key)
    # A record with its own measurement time uses that and only that. The
    # dataset's time is used where records carry none.
    as_of = (_as_of(d.record_as_of, record) if d.record_as_of is not None
             else _as_of(d.as_of, cov))

    if record is None:
        # The dataset's time, since that is when the absence was established:
        # nothing under this key as of the index's last run.
        return envelope.withheld(
            measured=f"one record from {dataset}", coverage=cov,
            as_of=_as_of(d.as_of, cov),
            reason="not_found",
            explanation=f"{dataset} holds nothing under '{key[:48]}'. This is an "
                        f"absence of a record, not a measurement of zero.")

    # A dataset's own withheld reason wins. The Hyperliquid service returns one
    # rather than a rate for most addresses, and flattening that into a record
    # with nulls would lose the reason a reader needs.
    inner = record.get("withheld_reason") if isinstance(record, dict) else None
    return envelope.build(
        measured=f"one record from {dataset}", coverage=cov, value=record,
        as_of=as_of, withheld_reason=inner, caveats=list(d.caveats))


# EVERY ARGUMENT IS EITHER USED OR REFUSED. The server validates nothing
# against the input schemas (they are documentation to a client), so an
# argument a schema does not declare, `issuer` or `platform` or a typo,
# was dropped and the call answered as if it had not been given: a filter
# the caller believed applied, silently not. These are the arguments each
# tool reads; anything else is refused by name.
LIST_ARGS = ("dataset", "key", "limit", "cursor", "chain_id", "category", "search", "verified", "sort")
SUMMARY_ARGS = ("dataset", "chain_id", "category", "search")
GET_ARGS = ("dataset", "id")
RESOLVE_ARGS = ("query",)
SERIES_ARGS = ("dataset", "key", "limit", "before")
CATALOGUE_ARGS: tuple = ()


def _undeclared(tool: str, args: dict, accepted: tuple) -> dict | None:
    extra = sorted(k for k in (args or {}) if k not in accepted)
    if not extra:
        return None
    return envelope.withheld(
        measured=f"what {tool} was asked", coverage={"partial": False},
        reason="filter_not_supported",
        explanation=f"{tool} does not accept {', '.join(extra)}. It accepts "
                    f"{', '.join(accepted) if accepted else 'no arguments'}"
                    + ("; a dataset may apply fewer filters, and says so" if tool in ("tnega_list", "tnega_summary") else "")
                    + ". Nothing is returned rather than an answer that ignores the argument.")


async def list_(datasets: dict, args: dict) -> dict:
    refused = _undeclared("tnega_list", args, LIST_ARGS)
    if refused:
        return refused
    cursor = args.get("cursor")
    filters: dict = {}
    offset = 0
    dataset = str(args.get("dataset") or "")

    if cursor:
        decoded = _cursor_decode(str(cursor))
        if not decoded:
            return envelope.withheld(
                measured="a page of rows",
                coverage={"partial": False},
                reason="bad_cursor",
                explanation="That cursor is not one this server issued. Call "
                            "tnega_list again without a cursor to start over.")
        dataset = decoded.get("d") or dataset
        offset = int(decoded.get("o") or 0)
        filters = decoded.get("f") or {}
    else:
        for k in ("key", "chain_id", "category", "search", "verified", "sort"):
            if args.get(k) not in (None, ""):
                filters[k] = args[k]

    d = datasets.get(dataset)
    if d is None or d.list is None:
        return _unknown_dataset("tnega_list", dataset, datasets,
                                verb="list" if d is not None else None)

    limit = _clamp(args.get("limit"), LIST_DEFAULT, LIST_MAX)
    try:
        cov = _coverage(await call(d.coverage))
    except Exception as e:  # noqa: BLE001
        cov = {"partial": True, "unavailable": type(e).__name__}

    as_of = _as_of(d.as_of, cov)
    page = await call(d.list, limit=limit, offset=offset, **filters)
    rows = page.get("rows") or []
    total = page.get("total")

    # A HANDLER THAT REFUSES SAYS SO, rather than returning an empty page.
    #
    # jobs.erc8183 needs a provider address and cannot list without one. It
    # said so, in a `note` this function dropped, and the refusal reached the
    # caller as zero rows, matched null, partial false, withheld_reason null,
    # and one caveat reading "a source was not readable" -- which was not what
    # happened and named no source. The one surface that carries a buyer
    # address and an escrowed amount therefore answered the most important
    # question about any agent with silence.
    #
    # A refusal is a withheld_reason in this project's vocabulary, so it is
    # returned as one.
    if page.get("withheld_reason"):
        return envelope.withheld(
            measured=f"a page of {dataset}",
            coverage=_coverage(cov, matched=total, returned=0, offset=offset),
            as_of=as_of,
            reason=str(page["withheld_reason"]),
            explanation=str(page.get("explanation")
                            or "This dataset cannot be listed with the "
                               "arguments given."))

    if not rows and not page.get("partial"):
        return _empty_result("tnega_list", dataset, filters, cov, as_of)
    nxt = offset + len(rows)
    caveats = list(d.caveats) + [
        "Rows are a projection, not whole records. Read one in full with "
        "tnega_get using the id in the row."]
    if page.get("partial"):
        # The dataset's own words for why, where it gave any. The fixed
        # sentence said "a source was not readable" for a page that was
        # partial because a filter was missing, which named the wrong cause.
        caveats.append("This page is partial: " + str(
            page.get("note") or "a source was not readable."))

    # The page's own partial, not the dataset's. They are different claims:
    # the dataset may be wholly readable and this page still incomplete.
    page_cov = dict(cov)
    if page.get("partial"):
        page_cov["partial"] = True
    # Which filters the dataset applied, echoed where a dataset reports them,
    # so a caller can see its filter was used and not silently dropped.
    if isinstance(page.get("filters"), dict):
        page_cov["filters"] = page["filters"]
    return envelope.build(
        measured=f"a page of {dataset}",
        coverage=_coverage(page_cov, matched=total, returned=len(rows), offset=offset),
        as_of=as_of,
        value=rows,
        next_cursor=(_cursor_encode(dataset, nxt, filters)
                     if total is not None and nxt < total else None),
        # If the ceiling trims this page, the cursor has to start at the first
        # row not sent, not at the first row not built.
        # No cursor once the rows consumed reach the end of the selection,
        # which happens when the last row is the one skipped as too large.
        resume=lambda kept: (_cursor_encode(dataset, offset + len(kept), filters)
                             if total is None or offset + len(kept) < total
                             else None),
        caveats=caveats)


async def summary(datasets: dict, args: dict) -> dict:
    refused = _undeclared("tnega_summary", args, SUMMARY_ARGS)
    if refused:
        return refused
    dataset = str(args.get("dataset") or "")
    d = datasets.get(dataset)
    if d is None or d.summary is None:
        return _unknown_dataset("tnega_summary", dataset, datasets,
                                verb="summary" if d is not None else None)
    filters = {k: args[k] for k in ("chain_id", "category", "search")
               if args.get(k) not in (None, "")}
    try:
        cov = _coverage(await call(d.coverage))
    except Exception as e:  # noqa: BLE001
        cov = {"partial": True, "unavailable": type(e).__name__}
    as_of = _as_of(d.as_of, cov)
    value = await call(d.summary, **filters)
    if isinstance(value, dict) and value.get("matched") == 0:
        return _empty_result("tnega_summary", dataset, filters, cov, as_of)
    return envelope.build(
        measured=f"an aggregate over {dataset}", coverage=_coverage(cov), value=value,
        as_of=as_of,
        caveats=list(d.caveats) + [
            "An aggregate over what is stored, which is what coverage "
            "describes, not over everything that exists."])


async def series(datasets: dict, args: dict) -> dict:
    refused = _undeclared("tnega_series", args, SERIES_ARGS)
    if refused:
        return refused
    dataset = str(args.get("dataset") or "")
    d = datasets.get(dataset)
    if d is None or d.series is None:
        return _unknown_dataset("tnega_series", dataset, datasets,
                                verb="series" if d is not None else None)
    key = str(args.get("key") or "").strip()
    if not key:
        return envelope.withheld(
            measured=f"a series from {dataset}",
            coverage={"accepts": d.keys, "partial": False},
            reason="missing_key",
            explanation=f"{dataset} needs a {d.keys[0]} to return a series.")

    limit = _clamp(args.get("limit"), SERIES_MAX, SERIES_MAX)
    out = await call(d.series, key, limit=limit, before=args.get("before"))
    points = out.get("points") or []
    inner_cov = out.get("coverage") or {}
    # The series' own coverage, not the dataset's: a series is as current as
    # its last bucket, whatever the collector behind the rest of the dataset
    # did since.
    as_of = _as_of(d.as_of, inner_cov)

    if not points:
        return envelope.withheld(
            measured=f"a series from {dataset} for {key[:48]}",
            coverage=_coverage(inner_cov, points=0),
            as_of=as_of,
            reason="no_observations",
            explanation="Nothing was recorded for this key in the window. "
                        "coverage says whether it was being watched and heard "
                        "nothing, or was not being watched at all.")

    return envelope.build(
        measured=f"a series from {dataset} for {key[:48]}",
        coverage=_coverage(inner_cov, points=len(points),
                           bucket_seconds=out.get("bucket_seconds")),
        as_of=as_of,
        value=points,
        next_cursor=out.get("next_before"),
        # A trimmed series continues from the last point kept. `before` is
        # exclusive, so that point's time is the cursor.
        # No cursor once the points consumed are all there is: every point
        # of this call, with none beyond it (no next_before).
        resume=lambda kept: (kept[-1].get("t")
                             if kept and (len(kept) < len(points)
                                          or out.get("next_before"))
                             else None),
        caveats=list(d.caveats))


# ── preparing an order ───────────────────────────────────────────────────────

PREPARE_BUY_ARGS = ("query", "usd_amount", "wallet", "pay_with", "max_slippage_bps")
PREPARE_SELL_ARGS = ("query", "token_amount", "wallet", "receive", "max_slippage_bps")
HOLDINGS_ARGS = ("wallet",)

ORDER_CAVEATS = [
    "Tnega prepared this; nothing is signed until you sign each transaction in your own wallet. Tnega never "
    "signs, sends or holds funds.",
    "quote is LI.FI's, as it answered at quoted_at, and nothing more. The signing page asks LI.FI again from "
    "the browser right before anything is signed, and shows that quote.",
    "The approval is for the exact amount sent, never unlimited. The link expires at expires_at, ten "
    "minutes after it was prepared.",
    "as_of is when the stored measurement behind the order was taken (value.as_of_basis says which); the "
    "quote's own time is value.quote.quoted_at.",
    "Costs in why are Tnega's stored measurements at a named block and size, not a promise of the price at "
    "signing. Stablecoins are taken at $1, an assumption.",
]


def _missing(tool: str, args: dict, required: tuple) -> dict | None:
    gone = [k for k in required if args.get(k) in (None, "")]
    if not gone:
        return None
    return envelope.withheld(
        measured=f"what {tool} was asked", coverage={"partial": False},
        reason="missing_argument",
        explanation=f"{tool} needs {', '.join(required)}; missing: {', '.join(gone)}.")


def _order_envelope(tool: str, out: dict) -> dict:
    measured = ("an order prepared for the user to sign in their own wallet; nothing is signed or sent")
    if out.get("withheld_reason"):
        cov = {"partial": False}
        for k in ("size_usd", "not_ranked", "attempts", "chains_read", "quotes_asked"):
            if out.get(k) is not None:
                cov[k] = out[k]
        return envelope.withheld(measured=measured, coverage=cov, reason=out["withheld_reason"],
                                 explanation=out.get("explanation") or "")
    why = out.get("why") or {}
    value = {k: v for k, v in out.items() if k not in ("as_of", "partial")}
    partial = bool(out.get("partial")) or not out.get("sign_url")
    coverage = {
        "versions_ranked": len(why.get("ranked") or []) if out.get("side") == "buy" else None,
        "versions_not_ranked": (len(why.get("not_ranked") or []) + int(why.get("not_ranked_more") or 0))
        if out.get("side") == "buy" else None,
        "quotes_asked": out.get("quotes_asked"),
        "quote_source": "LI.FI",
        "chains": [c["name"] for c in _buy_chains().values()],
        "partial": partial,
    }
    caveats = list(ORDER_CAVEATS)
    if partial:
        caveats.insert(0, "Partial: no link was made. " + (out.get("quote_note") or ""))
    return envelope.build(
        measured=measured,
        coverage={k: v for k, v in coverage.items() if v is not None},
        # When the figures the order rests on were measured; the quote's own
        # time is value.quote.quoted_at.
        as_of=out.get("as_of"),
        withheld_reason=out.get("link_withheld_reason"),
        value=value, caveats=caveats)


def _buy_chains() -> dict:
    from core.te.buy_chains import BUY_CHAINS
    return BUY_CHAINS


async def prepare_buy(datasets: dict, args: dict) -> dict:
    refused = (_undeclared("tnega_prepare_buy", args, PREPARE_BUY_ARGS)
               or _missing("tnega_prepare_buy", args, ("query", "usd_amount", "wallet")))
    if refused:
        return refused
    from core.te import prepare
    out = await prepare.prepare_buy(args.get("query"), args.get("usd_amount"), args.get("wallet"),
                                    pay_with=args.get("pay_with"), max_slippage_bps=args.get("max_slippage_bps"))
    return _order_envelope("tnega_prepare_buy", out)


async def prepare_sell(datasets: dict, args: dict) -> dict:
    refused = (_undeclared("tnega_prepare_sell", args, PREPARE_SELL_ARGS)
               or _missing("tnega_prepare_sell", args, ("query", "token_amount", "wallet")))
    if refused:
        return refused
    from core.te import prepare
    out = await prepare.prepare_sell(args.get("query"), args.get("token_amount"), args.get("wallet"),
                                     receive=args.get("receive"), max_slippage_bps=args.get("max_slippage_bps"))
    return _order_envelope("tnega_prepare_sell", out)


async def wallet_holdings(datasets: dict, args: dict) -> dict:
    refused = (_undeclared("tnega_wallet_holdings", args, HOLDINGS_ARGS)
               or _missing("tnega_wallet_holdings", args, HOLDINGS_ARGS))
    if refused:
        return refused
    wallet = str(args.get("wallet") or "").strip()
    measured = "tokenized stocks one wallet holds, read on chain"
    if not _ADDRESS.match(wallet):
        return envelope.withheld(measured=measured, coverage={"partial": False}, reason="bad_wallet",
                                 explanation="wallet must be an EVM address: 0x followed by 40 hex characters.")
    from core.te import holdings
    h = await holdings.holdings(wallet)
    # The token balances the site's Dashboard reads in the same batch are not
    # part of this tool's answer, so their coverage is not either.
    # partial: a failed chain, or a version whose balance call returned
    # nothing. A token call that returned nothing is not this tool's concern.
    cov = {**{k: v for k, v in h["coverage"].items() if not k.startswith("tokens")},
           "partial": bool(h["coverage"]["chains_failed"])
           or any(c.get("versions_unanswered") for c in h["chains"] if c["status"] == "read"),
           "blocks": [{"chain": c["chain"], "block": c.get("block"), "block_time": c.get("block_time")}
                      for c in h["chains"] if c["status"] == "read"],
           "held": len(h["holdings"])}
    rows = [{k: r[k] for k in ("key", "symbol", "ticker", "issuer", "chain_id", "balance", "balance_raw", "decimals")}
            for r in h["holdings"]]
    caveats = ["Only nonzero balances are listed. A version not listed was read as zero, or is on a chain in "
               "coverage.chains_failed, which is a fact about this call and not about the wallet.",
               holdings.VERSIONS_METHOD + ". Read-only: nothing is signed.",
               "as_of is the oldest block time among the chains read; each chain's block is in coverage.blocks."]
    if h.get("cached_seconds"):
        caveats.append(f"Answered from a read made {h['cached_seconds']} s ago (kept for 60 s).")
    failed = ", ".join(f"{f['chain']} ({f['reason']})" for f in h["coverage"]["chains_failed"])
    if h.get("status") == "unavailable":
        return envelope.withheld(measured=measured, coverage=_coverage(cov), reason="chains_unavailable",
                                 explanation=f"No chain could be read just now: {failed}. That is a fact about "
                                             f"this call, not about the wallet; nothing is known about its "
                                             f"balances. Try again shortly.")
    if not rows:
        if h["coverage"]["chains_failed"]:
            return envelope.withheld(measured=measured, coverage=_coverage(cov), as_of=h.get("as_of"),
                                     reason="none_held_on_chains_read",
                                     explanation=f"No listed tokenized-stock version holds a balance for this "
                                                 f"wallet on {', '.join(h['coverage']['chains_read'])}. Not read: "
                                                 f"{failed}, so the wallet may hold versions there.")
        # Every chain read and nothing held is a measurement, not an absence
        # of one: an empty list with its coverage, not a withheld answer.
        return envelope.build(measured=measured, coverage=_coverage(cov), as_of=h.get("as_of"), value=[],
                              caveats=["None held on the six chains read: every listed tokenized-stock version "
                                       "on Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and HyperEVM was "
                                       "read at the block in coverage.blocks, and none has a balance for this "
                                       "wallet."] + caveats[1:])
    return envelope.build(measured=measured, coverage=_coverage(cov), as_of=h.get("as_of"), value=rows,
                          caveats=caveats)


# ── the manifest ─────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "tnega_catalogue",
        "annotations": {
            "title": "The measurements Tnega holds",
            # NOTHING THIS SERVER EXPOSES WRITES ANYTHING. Stated here rather
            # than only in prose, because a client can enforce this and a
            # listing cannot. Verified rather than assumed: no handler in
            # tools.py, no dataset reader in registry.py, and nothing they
            # dispatch to performs a write, a signature or a transaction.
            "readOnlyHint": True,
            # Redundant under the spec, which says this is only meaningful
            # when readOnlyHint is false. Set anyway for a client that reads
            # it without checking readOnlyHint first.
            "destructiveHint": False,
            # True, and measured rather than defaulted. tnega_get on
            # hyperliquid.post_only reaches api.hyperliquid.xyz through
            # attribution.attribute while answering. The others are set
            # the same way rather than claimed closed, because proving
            # that negative across every dataset reader is not worth a
            # false annotation, and true is the spec default anyway.
            "openWorldHint": True,
        },
        "description":
            "Lists every measurement Tnega holds: dataset ids, what each one "
            "measures, the keys it accepts, which of get/list/summary/series it "
            "supports, its live coverage and as_of, when it was last measured. "
            "Takes no arguments and returns one row per dataset, under 16KB. "
            "Call this first when you do not know a dataset id; then use "
            "tnega_get or tnega_list.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "handler": catalogue,
    },
    {
        "name": "tnega_resolve",
        "annotations": {
            "title": "What this identifier belongs to",
            # NOTHING THIS SERVER EXPOSES WRITES ANYTHING. Stated here rather
            # than only in prose, because a client can enforce this and a
            # listing cannot. Verified rather than assumed: no handler in
            # tools.py, no dataset reader in registry.py, and nothing they
            # dispatch to performs a write, a signature or a transaction.
            "readOnlyHint": True,
            # Redundant under the spec, which says this is only meaningful
            # when readOnlyHint is false. Set anyway for a client that reads
            # it without checking readOnlyHint first.
            "destructiveHint": False,
            # False, and this one is checked: resolve reads stored data
            # only and performs no live lookup, which its own description
            # has always said.
            "openWorldHint": False,
        },
        "description":
            "Turns one string into the datasets that accept it: a 0x address, an "
            "ERC-8004 token id, an agent id, a chain view name, a stock or ETF "
            "ticker or company name, or a basket code. Returns up to "
            "12 candidates under 2KB, from stored data only, with no live lookup. "
            "Use it before tnega_get when you hold an identifier and do not know "
            "which dataset it belongs to.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string",
                                     "description": "An address, token id, agent id, chain view name, stock or "
                                                    "ETF ticker, company name, token address or basket code."}},
            "required": ["query"], "additionalProperties": False,
        },
        "handler": resolve,
    },
    {
        "name": "tnega_get",
        "annotations": {
            "title": "One measured record",
            # NOTHING THIS SERVER EXPOSES WRITES ANYTHING. Stated here rather
            # than only in prose, because a client can enforce this and a
            # listing cannot. Verified rather than assumed: no handler in
            # tools.py, no dataset reader in registry.py, and nothing they
            # dispatch to performs a write, a signature or a transaction.
            "readOnlyHint": True,
            # Redundant under the spec, which says this is only meaningful
            # when readOnlyHint is false. Set anyway for a client that reads
            # it without checking readOnlyHint first.
            "destructiveHint": False,
            # True, and measured rather than defaulted. tnega_get on
            # hyperliquid.post_only reaches api.hyperliquid.xyz through
            # attribution.attribute while answering. The others are set
            # the same way rather than claimed closed, because proving
            # that negative across every dataset reader is not worth a
            # false annotation, and true is the spec default anyway.
            "openWorldHint": True,
        },
        "description":
            "One record in full from one dataset: an agent, a Hyperliquid "
            "address, a provider's job record, an agent's budget record, or a "
            "chain view. Give dataset and id. Returns the record with its "
            "coverage, caveats and as_of (when it was measured; served_at is "
            "the call) under 8KB, or the reason there is nothing to return. "
            "For many records at once use tnega_list.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset": {"type": "string", "description": "A dataset id from tnega_catalogue."},
                "id": {"type": "string", "description": "The key, as named by that dataset."},
            },
            "required": ["dataset", "id"], "additionalProperties": False,
        },
        "handler": get,
    },
    {
        "name": "tnega_list",
        "annotations": {
            "title": "A page of records",
            # NOTHING THIS SERVER EXPOSES WRITES ANYTHING. Stated here rather
            # than only in prose, because a client can enforce this and a
            # listing cannot. Verified rather than assumed: no handler in
            # tools.py, no dataset reader in registry.py, and nothing they
            # dispatch to performs a write, a signature or a transaction.
            "readOnlyHint": True,
            # Redundant under the spec, which says this is only meaningful
            # when readOnlyHint is false. Set anyway for a client that reads
            # it without checking readOnlyHint first.
            "destructiveHint": False,
            # True, and measured rather than defaulted. tnega_get on
            # hyperliquid.post_only reaches api.hyperliquid.xyz through
            # attribution.attribute while answering. The others are set
            # the same way rather than claimed closed, because proving
            # that negative across every dataset reader is not worth a
            # false annotation, and true is the spec default anyway.
            "openWorldHint": True,
        },
        "description":
            "A filtered page of compact rows from one dataset, about 200 bytes "
            "each rather than whole records. Give dataset, optional filters or a "
            "key to narrow to one entity, and limit up to 50, default 25. Returns "
            "rows, as_of (when measured) and next_cursor, capped at 32KB. Read "
            "any row in full with tnega_get; for counts rather than rows use "
            "tnega_summary.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset": {"type": "string", "description": "A dataset id from tnega_catalogue."},
                "key": {"type": "string", "description": "Narrow to the records belonging to one entity, using that dataset's key. jobs.erc8183 uses it for a provider address, to list that provider's jobs."},
                "limit": {"type": "integer", "minimum": 1, "maximum": LIST_MAX},
                "cursor": {"type": "string", "description": "next_cursor from a previous call. Carries the filters, so do not resend them."},
                "chain_id": {"type": "integer"},
                "category": {"type": "string"},
                "search": {"type": "string", "description": "Matches name and description."},
                "verified": {"type": "boolean", "description": "Only agents where an address other than the owner funded an on-chain job that the agent then marked delivered. The marking is the provider calling submit, which is its own claim; nothing checks what was handed over."},
                "sort": {"type": "string"},
            },
            "required": ["dataset"], "additionalProperties": False,
        },
        "handler": list_,
    },
    {
        "name": "tnega_summary",
        "annotations": {
            "title": "A dataset's totals",
            # NOTHING THIS SERVER EXPOSES WRITES ANYTHING. Stated here rather
            # than only in prose, because a client can enforce this and a
            # listing cannot. Verified rather than assumed: no handler in
            # tools.py, no dataset reader in registry.py, and nothing they
            # dispatch to performs a write, a signature or a transaction.
            "readOnlyHint": True,
            # Redundant under the spec, which says this is only meaningful
            # when readOnlyHint is false. Set anyway for a client that reads
            # it without checking readOnlyHint first.
            "destructiveHint": False,
            # True, and measured rather than defaulted. tnega_get on
            # hyperliquid.post_only reaches api.hyperliquid.xyz through
            # attribution.attribute while answering. The others are set
            # the same way rather than claimed closed, because proving
            # that negative across every dataset reader is not worth a
            # false annotation, and true is the spec default anyway.
            "openWorldHint": True,
        },
        "description":
            "An aggregate over one dataset with the coverage behind it: counts by "
            "verification tier or behaviour band, category breakdowns, totals. "
            "Give dataset and optional filters. Returns one rollup with as_of, "
            "when it was measured, under 8KB and never a list of records. Use "
            "tnega_list for the rows, or tnega_series for movement over time.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset": {"type": "string", "description": "A dataset id from tnega_catalogue."},
                "chain_id": {"type": "integer"},
                "category": {"type": "string"},
                "search": {"type": "string"},
            },
            "required": ["dataset"], "additionalProperties": False,
        },
        "handler": summary,
    },
    {
        "name": "tnega_series",
        "annotations": {
            "title": "A measurement over time",
            # NOTHING THIS SERVER EXPOSES WRITES ANYTHING. Stated here rather
            # than only in prose, because a client can enforce this and a
            # listing cannot. Verified rather than assumed: no handler in
            # tools.py, no dataset reader in registry.py, and nothing they
            # dispatch to performs a write, a signature or a transaction.
            "readOnlyHint": True,
            # Redundant under the spec, which says this is only meaningful
            # when readOnlyHint is false. Set anyway for a client that reads
            # it without checking readOnlyHint first.
            "destructiveHint": False,
            # True, and measured rather than defaulted. tnega_get on
            # hyperliquid.post_only reaches api.hyperliquid.xyz through
            # attribution.attribute while answering. The others are set
            # the same way rather than claimed closed, because proving
            # that negative across every dataset reader is not worth a
            # false annotation, and true is the spec default anyway.
            "openWorldHint": True,
        },
        "description":
            "A measurement over time from one dataset, newest first. Today that "
            "is hyperliquid.post_only at 10 second buckets for one address. Give "
            "dataset and key, with limit up to 200 points, returned under 16KB "
            "with the denominator behind them and as_of, the last bucket. For "
            "the current value rather than its history use tnega_get.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset": {"type": "string", "description": "A dataset id from tnega_catalogue."},
                "key": {"type": "string", "description": "The key, as named by that dataset."},
                "limit": {"type": "integer", "minimum": 1, "maximum": SERIES_MAX},
                "before": {"type": "string", "description": "next_cursor from a previous call, to walk backwards."},
            },
            "required": ["dataset", "key"], "additionalProperties": False,
        },
        "handler": series,
    },
    {
        "name": "tnega_prepare_buy",
        "annotations": {
            "title": "Prepare a buy for the user to sign",
            # True: nothing changes anywhere when this runs. It reads stored
            # costs, asks LI.FI for a quote and reads the wallet's allowance;
            # the order it returns travels in a signed link and is not
            # stored. The user signs every transaction in their own wallet,
            # on the page the link opens, or nothing happens.
            "readOnlyHint": True,
            "destructiveHint": False,
            # True: it asks LI.FI and public chain endpoints while answering.
            "openWorldHint": True,
        },
        "description":
            "Prepares a buy of a tokenized stock for the user to sign: picks the version with the lowest "
            "measured all-in cost, quotes LI.FI (at most 2 quotes), and returns the route, fees, an exact "
            "approval and a tnega.app/sign link, under 12KB. Tnega signs nothing. Give query, usd_amount (1 to "
            "10000) and wallet. To sell use tnega_prepare_sell.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "A US ticker (NVDA) or a version key <chainId>/<token address>."},
                "usd_amount": {"type": "number", "minimum": 1, "maximum": 10000,
                               "description": "US dollars to spend, at most 2 decimal places."},
                "wallet": {"type": "string", "description": "The EVM address that will sign and receive."},
                "pay_with": {"type": "string", "description": "USDC, USDT or USDG, or <chainId>/<pay token address>. Default: the chain's first pay token."},
                "max_slippage_bps": {"type": "integer", "minimum": 10, "maximum": 300, "description": "Default 50."},
            },
            "required": ["query", "usd_amount", "wallet"], "additionalProperties": False,
        },
        "handler": prepare_buy,
    },
    {
        "name": "tnega_prepare_sell",
        "annotations": {
            "title": "Prepare a sale for the user to sign",
            # True, for the reason given on tnega_prepare_buy: nothing is
            # signed, sent or stored by this call.
            "readOnlyHint": True,
            "destructiveHint": False,
            "openWorldHint": True,
        },
        "description":
            "Prepares a sale of a tokenized stock the wallet holds for the user to sign: quotes LI.FI once, "
            "checks the price against Tnega's measured pool mid, and returns the route, an exact approval and a "
            "tnega.app/sign link, under 12KB. Give query, token_amount and wallet. Tnega signs nothing. Check "
            "balances first with tnega_wallet_holdings.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "A version key <chainId>/<token address>, or a ticker: then the version the wallet holds most of."},
                "token_amount": {"type": "string", "description": "Tokens to sell, as a plain decimal."},
                "wallet": {"type": "string", "description": "The EVM address that holds the tokens and will sign."},
                "receive": {"type": "string", "description": "USDC, USDT or USDG, or <chainId>/<token address>. Default: the chain's first pay token."},
                "max_slippage_bps": {"type": "integer", "minimum": 10, "maximum": 300, "description": "Default 50."},
            },
            "required": ["query", "token_amount", "wallet"], "additionalProperties": False,
        },
        "handler": prepare_sell,
    },
    {
        "name": "tnega_wallet_holdings",
        "annotations": {
            "title": "Tokenized stocks a wallet holds",
            "readOnlyHint": True,
            "destructiveHint": False,
            # True: balances are read from public chain endpoints.
            "openWorldHint": True,
        },
        "description":
            "Reads which listed tokenized stocks one wallet holds on Ethereum, Base, Arbitrum, BNB Chain, "
            "Robinhood Chain and HyperEVM: balanceOf on every version at one block per chain, nonzero balances "
            "only, with the chains read and failed, under 16KB. Read-only. Give wallet. To sell one, use "
            "tnega_prepare_sell.",
        "inputSchema": {
            "type": "object",
            "properties": {"wallet": {"type": "string", "description": "An EVM address."}},
            "required": ["wallet"], "additionalProperties": False,
        },
        "handler": wallet_holdings,
    },
]

BY_NAME = {t["name"]: t for t in TOOLS}


def manifest() -> list[dict]:
    """What tools/list returns. The handler is ours and does not go on the wire.

    EVERY TOOL DECLARES ITS OWN ANNOTATIONS, AND THIS REFUSES TO SHIP ONE THAT
    DOES NOT. Applying readOnlyHint centrally would be less typing and would be
    the wrong shape: a tool added later that did write something would inherit
    the claim that it does not, silently, and a false annotation is worse than
    an absent one because a client can act on it. Declared per tool, a new tool
    with no annotations fails here instead.
    """
    missing = [t["name"] for t in TOOLS if not t.get("annotations")]
    if missing:
        raise RuntimeError(
            "these tools declare no annotations, so tools/list would describe "
            "them less than the rest: " + ", ".join(missing))
    return [{k: v for k, v in t.items() if k != "handler"} for t in TOOLS]
