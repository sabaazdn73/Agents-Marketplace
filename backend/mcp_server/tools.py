"""The six tools.

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
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from typing import Any

from mcp_server import envelope
from mcp_server.registry import call

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
RESOLVE_MAX = 5


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


def _empty_result(tool: str, dataset: str, filters: dict, cov: dict) -> dict:
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
    rows = []
    partial = False
    for d in sorted(datasets.values(), key=lambda x: x.id):
        row = {
            "id": d.id,
            "title": d.title,
            "measures": d.measures,
            "keys": d.keys,
            "supports": d.verbs(),
            "caveats": d.caveats,
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
        except Exception as e:  # noqa: BLE001
            partial = True
            row["coverage"] = {"partial": True,
                               "unavailable": type(e).__name__}
        rows.append(row)
    return envelope.build(
        measured="every dataset Tnega holds, with its coverage",
        coverage={"datasets": len(rows), "partial": partial},
        value=rows,
        caveats=["A row with coverage.partial true could not be read just now. "
                 "That is a fact about this call, not about the dataset."]
        if partial else [])


async def resolve(datasets: dict, args: dict) -> dict:
    """Local data only. The live 8004scan and RPC lookups in
    core/universal_search.py stay out: they spend a shared per-IP quota, and
    behind an unauthenticated endpoint that is a free proxy to someone else's
    rate budget."""
    query = str(args.get("query") or "").strip()
    if not query:
        return envelope.withheld(
            measured="what a string could refer to",
            coverage={"searched": "stored data only", "partial": False},
            reason="empty_query",
            explanation="Give a 0x address, a token id, an agent id, or a chain view name.")

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

    if not candidates:
        return envelope.withheld(
            measured=f"what '{_echo(query)}' could refer to",
            coverage={"searched": "stored data only", "partial": False},
            reason="unrecognised_identifier",
            explanation="Not an address, token id, agent id or chain view name. "
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

    if record is None:
        return envelope.withheld(
            measured=f"one record from {dataset}", coverage=cov,
            reason="not_found",
            explanation=f"{dataset} holds nothing under '{key[:48]}'. This is an "
                        f"absence of a record, not a measurement of zero.")

    # A dataset's own withheld reason wins. The Hyperliquid service returns one
    # rather than a rate for most addresses, and flattening that into a record
    # with nulls would lose the reason a reader needs.
    inner = record.get("withheld_reason") if isinstance(record, dict) else None
    return envelope.build(
        measured=f"one record from {dataset}", coverage=cov, value=record,
        withheld_reason=inner, caveats=list(d.caveats))


async def list_(datasets: dict, args: dict) -> dict:
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
            reason=str(page["withheld_reason"]),
            explanation=str(page.get("explanation")
                            or "This dataset cannot be listed with the "
                               "arguments given."))

    if not rows and not page.get("partial"):
        return _empty_result("tnega_list", dataset, filters, cov)
    nxt = offset + len(rows)
    caveats = list(d.caveats) + [
        "Rows are a projection, not whole records. Read one in full with "
        "tnega_get using the id in the row."]
    if page.get("partial"):
        caveats.append("This page is partial: a source was not readable.")

    # The page's own partial, not the dataset's. They are different claims:
    # the dataset may be wholly readable and this page still incomplete.
    page_cov = dict(cov)
    if page.get("partial"):
        page_cov["partial"] = True
    return envelope.build(
        measured=f"a page of {dataset}",
        coverage=_coverage(page_cov, matched=total, returned=len(rows), offset=offset),
        value=rows,
        next_cursor=(_cursor_encode(dataset, nxt, filters)
                     if total is not None and nxt < total else None),
        caveats=caveats)


async def summary(datasets: dict, args: dict) -> dict:
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
    value = await call(d.summary, **filters)
    if isinstance(value, dict) and value.get("matched") == 0:
        return _empty_result("tnega_summary", dataset, filters, cov)
    return envelope.build(
        measured=f"an aggregate over {dataset}", coverage=_coverage(cov), value=value,
        caveats=list(d.caveats) + [
            "An aggregate over what is stored, which is what coverage "
            "describes, not over everything that exists."])


async def series(datasets: dict, args: dict) -> dict:
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

    if not points:
        return envelope.withheld(
            measured=f"a series from {dataset} for {key[:48]}",
            coverage={**inner_cov, "points": 0},
            reason="no_observations",
            explanation="Nothing was recorded for this key in the window. "
                        "coverage says whether it was being watched and heard "
                        "nothing, or was not being watched at all.")

    return envelope.build(
        measured=f"a series from {dataset} for {key[:48]}",
        coverage=_coverage(inner_cov, points=len(points),
                           bucket_seconds=out.get("bucket_seconds")),
        value=points,
        next_cursor=out.get("next_before"),
        caveats=list(d.caveats))


# ── the manifest ─────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "tnega_catalogue",
        "description":
            "Lists every measurement Tnega holds: dataset ids, what each one "
            "measures, the keys it accepts, which of get/list/summary/series it "
            "supports, and its live coverage. Takes no arguments and returns one row "
            "per dataset, under 8KB. Call this first when you do not know a "
            "dataset id; then use tnega_get or tnega_list.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "handler": catalogue,
    },
    {
        "name": "tnega_resolve",
        "description":
            "Turns one string into the datasets that accept it: a 0x address, an "
            "ERC-8004 token id, an agent id, or a chain view name. Returns up to "
            "5 candidates under 2KB, from stored data only, with no live lookup. "
            "Use it before tnega_get when you hold an identifier and do not know "
            "which dataset it belongs to.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string",
                                     "description": "An address, token id, agent id or view name."}},
            "required": ["query"], "additionalProperties": False,
        },
        "handler": resolve,
    },
    {
        "name": "tnega_get",
        "description":
            "One record in full from one dataset: an agent, a Hyperliquid "
            "address, a provider's job record, an agent's budget record, or a "
            "chain view. Give dataset and id. Returns the record with its "
            "coverage and caveats under 8KB, or the reason there is nothing to "
            "return. For many records at once use tnega_list.",
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
        "description":
            "A filtered page of compact rows from one dataset, about 200 bytes "
            "each rather than whole records. Give dataset, optional filters or a "
            "key to narrow to one entity, and limit up to 50, default 25. Returns "
            "rows plus next_cursor, capped at 32KB. Read any row in full with "
            "tnega_get; for counts rather than rows use tnega_summary.",
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
                "verified": {"type": "boolean", "description": "Only agents with a delivered on-chain job."},
                "sort": {"type": "string"},
            },
            "required": ["dataset"], "additionalProperties": False,
        },
        "handler": list_,
    },
    {
        "name": "tnega_summary",
        "description":
            "An aggregate over one dataset with the coverage behind it: counts by "
            "verification tier or behaviour band, category breakdowns, totals. "
            "Give dataset and optional filters. Returns one rollup under 8KB and "
            "never a list of records. Use tnega_list for the rows, or "
            "tnega_series for movement over time.",
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
        "description":
            "A measurement over time from one dataset, newest first. Today that "
            "is hyperliquid.post_only at 10 second buckets for one address. Give "
            "dataset and key, with limit up to 200 points, returned under 16KB "
            "with the denominator behind them. For the current value rather than "
            "its history use tnega_get.",
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
]

BY_NAME = {t["name"]: t for t in TOOLS}


def manifest() -> list[dict]:
    """What tools/list returns. The handler is ours and does not go on the wire."""
    return [{k: v for k, v in t.items() if k != "handler"} for t in TOOLS]
