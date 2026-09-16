"""What is behind the six tools, and how a seventh dataset arrives.

A dataset is a descriptor, not a tool. The tools read this registry, so adding
a body of measurement means adding a Dataset here: no new tool, no schema
change, no caller breakage, and no edit to a client that cached the tool list a
month ago.

THE ONE REQUIRED FIELD
----------------------
`coverage`. A dataset that cannot say what its numbers were computed over
cannot be registered, which puts the site's honesty rule at the point of entry
rather than the point of display. Everything else is optional: a dataset with
no series function simply is not reachable through tnega_series, and the tool
says so by name rather than failing obscurely.

WHERE THE FUNCTIONS COME FROM
-----------------------------
core/ only. This module imports service functions and calls them. It holds no
thresholds, no bands, no formatting of a number into a sentence, and no second
opinion about what any of it means. Where a rule was missing it was added to
core/ and both transports got it, which is why AgentsIndex.project and
service.address_series exist.

THE AGENTS INDEX IS INJECTED
----------------------------
It lives in server.py's cache rather than in core/, because server.py owns its
refresh. Importing server.py from here would make the adapter depend on the
transport it is meant to sit beside, so server.py passes a reader in at mount
time instead and this module never learns where it came from.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass(frozen=True)
class Dataset:
    id: str
    title: str
    # One line, read by a model choosing a dataset. Says what is measured, not
    # what the dataset is called.
    measures: str
    # The identifiers this dataset accepts for tnega_get.
    keys: list[str]
    coverage: Callable[..., Any]
    get: Callable[..., Any] | None = None
    list: Callable[..., Any] | None = None
    summary: Callable[..., Any] | None = None
    series: Callable[..., Any] | None = None
    # Carried into every response from this dataset, whatever the tool. This is
    # where a denominator that differs from the obvious one gets said out loud.
    caveats: list[str] = field(default_factory=list)
    # Set when a dataset is on its way out: a date and a replacement id. The
    # catalogue keeps showing it and every response carries it, because a
    # caller that stops working should have been told first.
    deprecated: str | None = None

    def verbs(self) -> list[str]:
        return [v for v in ("get", "list", "summary", "series")
                if getattr(self, v) is not None]


async def call(fn: Callable[..., Any], *args, **kwargs):
    """Service functions are a mix of sync and async. Callers should not care."""
    out = fn(*args, **kwargs)
    if inspect.isawaitable(out):
        return await out
    return out


def _chain_page(chain_views, limit: int, offset: int) -> dict:
    """Chain views as compact rows.

    describe_views() carries every chain in a view, its hire paths and the
    escrow addresses behind them, which is about 700 bytes a row and exactly
    what the tab needs to draw itself. A list is for choosing which one to read,
    so it answers that and nothing else.
    """
    rows = chain_views.describe_views()
    page = rows[offset:offset + limit]
    return {
        "rows": [{
            "id": v.get("id"),
            "label": v.get("label"),
            "chains": len(v.get("chains") or []),
            "hireable": v.get("hireable"),
        } for v in page],
        "total": len(rows),
        "partial": False,
    }


def _hl_page(hl, limit: int, offset: int) -> dict:
    """Makers as compact rows.

    The tab's own rows carry eleven fields including volume and two
    cancel-to-fill variants, which is about 500 bytes each and the right answer
    for a table a person is reading. A model asking for a page wants to know
    which addresses to look at, so this is the address, what the rate is, and
    how much is behind it. The rest is one tnega_get away.

    A rate that the service withheld stays withheld here. Reprojecting a null
    into a 0.0 would be the exact failure the whole surface is built to avoid.
    """
    rows = hl.makers(50)
    page = rows[offset:offset + limit]
    return {
        "rows": [{
            "address": m.get("address"),
            "post_only_rejection_rate": m.get("post_only_rejection_rate"),
            "post_only_orders": m.get("alo_total"),
            "polls": m.get("polls"),
            "enough_data": m.get("enough_data"),
        } for m in page],
        "total": len(rows),
        "partial": False,
    }


def _hl_summary(hl) -> dict:
    """Counts per band, not the members of each band.

    The first version returned maker_bands() whole, which is every maker record
    filed under its band. That is 50 records where the question was four
    numbers, and it went over the 8KB ceiling and was refused: the ceiling did
    its job and the shape was still wrong. A summary that has to be trimmed to
    fit was never a summary.
    """
    rows = hl.makers(50)
    bands = hl.maker_bands(rows)
    return {
        "makers": len(rows),
        "bands": {name: len(members) for name, members in bands.items()},
        "statuses": hl.status_breakdown()[:12],
        "websocket": hl.ws_coverage(),
    }


def build(providers) -> dict[str, Dataset]:
    """The registry, wired to the service layer.

    `providers` carries what cannot be imported: today that is one reader for
    the agents index.
    """
    from core import chain_views
    from core.hyperliquid import service as hl

    datasets: list[Dataset] = []

    # ── agents ────────────────────────────────────────────────────────────
    #
    # The five chains, Robinhood Chain (4663) among them. There is no separate
    # stock token dataset because there is no separate service behind one: the
    # tokenized stock work is chain 4663 in this index and in the chain views,
    # so it is reachable as a filter rather than as a name. If it grows its own
    # measurements it gets its own descriptor here and no tool changes.
    def agents_coverage():
        ix = providers.agents_index()
        if ix is None:
            return {"agents": 0, "partial": True,
                    "note": "the index has not been built on this instance yet"}
        idx = ix.select()
        return {
            "agents": ix.count,
            "selectable": len(idx),
            "tiers": ix.tier_counts(idx),
            "chains": sorted({c for c in ix.chain if c}),
            "partial": False,
        }

    def agents_get(agent_id: str):
        ix = providers.agents_index()
        return ix.record(agent_id) if ix else None

    def agents_list(*, limit: int, offset: int, chain_id: int | None = None,
                    category: str | None = None, search: str | None = None,
                    verified: bool | None = None, sort: str | None = None):
        ix = providers.agents_index()
        if ix is None:
            return {"rows": [], "total": 0, "partial": True}
        from core import agents_index as ai
        idx = ix.select(chain_id=chain_id, category=category, search=search,
                        min_tier=ai.TIER_VERIFIED if verified else None)
        idx = ix.sort(idx, sort)
        return {"rows": ix.project(idx, offset, limit), "total": len(idx),
                "partial": False}

    def agents_summary(*, chain_id: int | None = None,
                       category: str | None = None, search: str | None = None):
        ix = providers.agents_index()
        if ix is None:
            return {"partial": True}
        idx = ix.select(chain_id=chain_id, category=category, search=search)
        return {
            "matched": len(idx),
            "tiers": ix.tier_counts(idx),
            "categories": ix.facets(idx)[:15],
            "feedback_entries": ix.feedback_total(idx),
        }

    datasets.append(Dataset(
        id="agents.index",
        title="Agent index",
        measures="ERC-8004 agents across five chains, ranked by what they have "
                 "delivered rather than by what they claim",
        keys=["agent id", "token id"],
        coverage=agents_coverage,
        get=agents_get,
        list=agents_list,
        summary=agents_summary,
        caveats=["A verification tier is a claim about delivered work. "
                 "verified means a completed on-chain job; canary_verified is a "
                 "weaker claim from a test hire and the two are not the same."],
    ))

    # ── hyperliquid ───────────────────────────────────────────────────────
    datasets.append(Dataset(
        id="hyperliquid.post_only",
        title="Hyperliquid post-only rejection",
        measures="the share of an address's post-only orders that the matching "
                 "engine refused instead of resting on the book",
        keys=["address"],
        coverage=hl.coverage,
        get=hl.address_detail,
        # Every list takes the same keyword contract and returns the same shape,
        # so the tool does not need to know which dataset it is paging. Where a
        # service function predates that contract it is adapted here rather than
        # changed there: the tab calls makers(limit) and is not this adapter's
        # to rewrite.
        list=lambda *, limit, offset, **_: _hl_page(hl, limit, offset),
        summary=lambda **_: _hl_summary(hl),
        series=hl.address_series,
        caveats=["A refused post-only order never rests, provides no liquidity "
                 "and leaves no trace in fills, so it is invisible in volume.",
                 "The series comes from the WebSocket feed, which carries no "
                 "tif. Its denominator is all order updates, not post-only "
                 "orders, so its ratio is not the same quantity as the rate."],
    ))

    # ── chains ────────────────────────────────────────────────────────────
    datasets.append(Dataset(
        id="chains.views",
        title="Chains and hire paths",
        measures="which chains are covered, which can be hired on, and by which "
                 "escrow contract",
        keys=["view id"],
        coverage=lambda: {"views": len(chain_views.view_ids()),
                          "ids": chain_views.view_ids(), "partial": False},
        get=chain_views.get_view,
        list=lambda *, limit, offset, **_: _chain_page(chain_views, limit, offset),
        caveats=["Hireable means an escrow contract is deployed and reachable "
                 "on that chain, not that any agent on it has delivered."],
    ))

    # ── jobs ──────────────────────────────────────────────────────────────
    def jobs_coverage():
        from core import job_index
        return job_index.get_progress()

    async def jobs_get(owner_address: str):
        from core import job_index
        stats = await job_index.get_provider_stats(owner_address)
        # A provider with no jobs comes back as hired=False with zero counts and
        # a note saying why. A person reads the note; a model reads hire_count 0
        # and has been told, in numbers, that this agent was hired zero times,
        # which is a measurement rather than an absence. The reason goes in the
        # field that exists for reasons, and the note travels with it.
        if isinstance(stats, dict) and not stats.get("hired"):
            return {**stats, "withheld_reason": "no_jobs_indexed"}
        return stats

    datasets.append(Dataset(
        id="jobs.erc8183",
        title="ERC-8183 job index",
        measures="on-chain jobs, their status, and what each provider was paid "
                 "for work that was delivered",
        keys=["provider address"],
        coverage=jobs_coverage,
        get=jobs_get,
        caveats=["Indexed from chain logs in batches, so the index can trail "
                 "the chain. coverage says how far it has reached."],
    ))

    # ── budgets ───────────────────────────────────────────────────────────
    async def budgets_coverage():
        from core import budget_index
        from core.db import get_db
        stats = await budget_index.get_agent_budget_stats(get_db())
        rated = sum(1 for v in stats.values() if v.get("rate") is not None)
        return {"agents_with_budgets": len(stats), "agents_with_a_rate": rated,
                "partial": False}

    async def budgets_get(agent_address: str):
        from core import budget_index
        from core.db import get_db
        stats = await budget_index.get_agent_budget_stats(get_db())
        return stats.get(str(agent_address).lower())

    datasets.append(Dataset(
        id="budgets.escrow",
        title="Budget escrow",
        measures="budgets funded to agents, what was drawn against them, and "
                 "what was reclaimed",
        keys=["agent address"],
        coverage=budgets_coverage,
        get=budgets_get,
        caveats=["A rate is withheld below the minimum sample rather than "
                 "computed from a few budgets.",
                 "Spend is counted from Drawn events. The contract's own spent "
                 "field is overwritten by a reclaim and does not mean delivery."],
    ))

    out: dict[str, Dataset] = {}
    for d in datasets:
        if d.coverage is None:
            raise ValueError(f"{d.id} has no coverage function")
        out[d.id] = d
    return out
