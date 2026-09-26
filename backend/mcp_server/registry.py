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


def _no_caveats() -> list[str]:
    return []


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
    #
    # default_factory is _no_caveats and not `list`, because inside this class
    # body `list` is the field above, whose default is None: the factory was
    # None, and a Dataset registered without caveats raised TypeError on
    # construction.
    caveats: list[str] = field(default_factory=_no_caveats)
    # Filters this dataset needs before it can answer, as an example a caller
    # can copy. chains.agents cannot page without a chain_id, and a model
    # should learn that from the catalogue rather than from an empty result.
    # It is also what the self-check calls each dataset with, so a dataset that
    # needs a filter is exercised rather than skipped.
    example_filters: dict | None = None
    # Set when a dataset is on its way out: a date and a replacement id. The
    # catalogue keeps showing it and every response carries it, because a
    # caller that stops working should have been told first.
    deprecated: str | None = None
    # WHEN THE DATA WAS MEASURED, which is what as_of carries in every
    # response. Given a coverage block, returns the time the data behind it
    # was measured: a collector's last poll, an indexer's last run, a series'
    # last bucket. tnega_series applies it to the series' own coverage, so a
    # dataset with a series reads whichever of its keys that block carries.
    # None, or a function returning None, means as_of is null and the dataset
    # says why in its caveats. The call time never stands in for it: that is
    # served_at.
    as_of: Callable[[dict], Any] | None = None
    # The same, for one record, where a record has its own measurement time
    # that differs from the dataset's. When set, tnega_get uses it and only
    # it: an address that left the collector's rotation days ago must not
    # borrow the collector's last poll as its own.
    record_as_of: Callable[[Any], Any] | None = None

    def verbs(self) -> list[str]:
        return [v for v in ("get", "list", "summary", "series")
                if getattr(self, v) is not None]


async def call(fn: Callable[..., Any], *args, **kwargs):
    """Service functions are a mix of sync and async. Callers should not care."""
    out = fn(*args, **kwargs)
    if inspect.isawaitable(out):
        return await out
    return out


def iso_utc(v: Any) -> str | None:
    """A measurement time as ISO 8601 UTC, whatever the store kept it as.

    The stores disagree: the job and registry indexers write epoch seconds as
    floats, the budget indexer as ints, Cockroach returns datetimes, and the
    Hyperliquid service has already formatted its own. A reader comparing two
    as_of values should not have to know which store each came from.
    """
    import datetime as dt
    if v is None or v == "" or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        # Zero and negatives are an unset timestamp, not 1970. server.py's
        # cache starts at fetched_at 0, and a store default can be 0 too.
        if v <= 0:
            return None
        return dt.datetime.fromtimestamp(float(v), dt.UTC).isoformat(timespec="seconds")
    if isinstance(v, dt.datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=dt.UTC)
        return v.astimezone(dt.UTC).isoformat(timespec="seconds")
    if isinstance(v, str):
        try:
            parsed = dt.datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            # Not a time. Passing it through would put a value in as_of that
            # a reader cannot compare with any other as_of.
            return None
        return iso_utc(parsed)
    return None


# How many category rows a summary carries before it starts summarising the
# summary. Nineteen exist today, so this is headroom rather than a limit that
# bites, and the remainder is never silently dropped.
MAX_CATEGORY_ROWS = 40


def _reconciled_categories(facets: list[dict], matched: int) -> dict:
    """Category counts that add up to the total beside them.

    They did not. The summary carried the top 15 and said nothing about the
    rest, so an agent reading it found 14,855 against a stated 14,875 and had
    to guess whether 20 agents were missing, miscounted, or uncategorised. Grid
    Trading, with four agents, was simply not in the breakdown at all.

    A number that does not reconcile with the number printed next to it is
    worse than a number that is absent, because it reads as arithmetic rather
    than as a cut. So: every category up to the cap, and if the cap bites, one
    explicit row carrying the remainder and saying how many categories are
    inside it. The sum always equals matched.
    """
    if len(facets) <= MAX_CATEGORY_ROWS:
        return {"categories": facets,
                "categories_total": len(facets),
                "categories_sum": sum(c["count"] for c in facets)}
    shown = facets[:MAX_CATEGORY_ROWS]
    rest = facets[MAX_CATEGORY_ROWS:]
    remainder = sum(c["count"] for c in rest)
    return {
        "categories": shown + [{"category": "(other categories)",
                                "count": remainder,
                                "categories_inside": len(rest)}],
        "categories_total": len(facets),
        "categories_sum": sum(c["count"] for c in shown) + remainder,
    }


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
            # Named for what it is, rather than `hireable`, which an agent
            # reading this surface took to mean that delivery had happened
            # somewhere on the chain. It means a contract is deployed and
            # nothing else. A list of the paths that exist cannot be read as a
            # claim about outcomes the way a bare yes could.
            "hire_paths_deployed": [
                name for name in ("budget", "escrow")
                if ((v.get("hire_paths") or {}).get(name) or {}).get("available")
            ],
        } for v in page],
        "total": len(rows),
        "partial": False,
    }


# How many maker rows are read to page or summarise over. The service's own
# default is 50, which is the tab's table, and paging a model over it cut 24
# of the 74 polled addresses off with no cursor to reach them and partial
# false. The read is one aggregate over every address whatever the LIMIT, so
# reading them all costs rows in memory for one call, about 500 bytes each,
# and not another scan. If the store ever holds more than this, the page and
# the summary say partial and name the cut rather than pretend it is whole.
HL_MAKERS_READ = 1000


def _chain_record(chain_views, view: str) -> dict | None:
    """One chain view, with `hireable` replaced as the list replaces it.

    The list stopped serving `hireable` after a model read it as delivery
    having happened, and tnega_get kept serving it. A name that misled once
    misleads from either tool, so the record carries hire_paths_deployed,
    the same list the row carries, and hire_paths stays as the detail.
    """
    v = next((v for v in chain_views.describe_views() if v["id"] == view), None)
    if v is None:
        return None
    out = {k: val for k, val in v.items() if k != "hireable"}
    out["hire_paths_deployed"] = [
        name for name in ("budget", "escrow")
        if ((v.get("hire_paths") or {}).get(name) or {}).get("available")]
    return out


def _retry_serialization(fn: Callable[[], Any]) -> Any:
    """One retry on a Cockroach serialization failure, SQLSTATE 40001.

    Cockroach answers a transaction that lost a conflict with 40001 and
    expects the client to run it again; it is a signal to retry, not a fault.
    coverage() runs six reads against tables the collector is writing, and
    one of them occasionally lost, which took the dataset's whole coverage
    block to unavailable for that call. makers() and address_series() read
    tables the collectors write in the same way and take the same wrapper.
    Once, not in a loop: a second failure is reported as the failure it is.
    """
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        if getattr(e, "sqlstate", None) != "40001":
            raise
        return fn()


def _hl_order(m: dict) -> tuple:
    vol = m.get("month_volume")
    return (not m.get("tracked"), vol is None, -float(vol or 0),
            str(m.get("address") or ""))


def _hl_makers(hl) -> tuple[list[dict], bool]:
    """Every maker, in an order that is the same on every call.

    The service orders by rotation then volume, and leaves ties to the
    database. Addresses without a volume all tie, and Cockroach returned them
    in whatever order it liked, so a cursor walk could see one twice and miss
    another. The address breaks the tie here, over the same ordering.
    """
    # Retried like coverage(): the same collector writes these tables, and a
    # makers read that lost a conflict took the list, summary and every page
    # of the dataset down with it for that call.
    rows = _retry_serialization(lambda: hl.makers(HL_MAKERS_READ))
    return sorted(rows, key=_hl_order), len(rows) >= HL_MAKERS_READ


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
    rows, cut = _hl_makers(hl)
    page = rows[offset:offset + limit]
    return {
        "rows": [{
            "address": m.get("address"),
            "post_only_rejection_rate": m.get("post_only_rejection_rate"),
            "post_only_orders": m.get("alo_total"),
            "polls": m.get("polls"),
            # The reason travels with the absence. Without it a null rate in a
            # row was indistinguishable from a rate of zero that failed to
            # encode, and the row could not say why it was empty.
            "withheld_reason": m.get("withheld_reason"),
            "newest_record_age_seconds": m.get("newest_record_age_seconds"),
            "enough_data": m.get("enough_data"),
        } for m in page],
        "total": len(rows),
        "partial": cut,
        **({"note": f"Read stopped at {HL_MAKERS_READ} addresses; the store "
                    f"holds more, and they are not in this list."} if cut else {}),
    }


SITE_FEATURES_NOTE = (
    "Features of the Tnega website for this agent's chain: which panels the "
    "site can show, and why the others are absent. Not data available over "
    "MCP, and not a finding about this agent.")


def _site_features(rec: Any) -> Any:
    """The site's capabilities block, named for what it is.

    chain_views attaches `capabilities` to a record so the site can say which
    panels it can draw on each chain and why the rest are absent. Served to a
    model under that name it reads as what this data holds, which it is not:
    several of the signals it lists are site panels fed by sources this
    surface never serves. The same lesson as `hireable`: a caveat beside a
    field does not undo how the field's name reads, so the name changes here
    and the explanation travels inside it. The site's own REST response keeps
    `capabilities`, which is what ChainViewShared.jsx reads.
    """
    if not isinstance(rec, dict) or not isinstance(rec.get("capabilities"), dict):
        return rec
    out = {k: v for k, v in rec.items() if k != "capabilities"}
    out["tnega_website_features"] = {"about": SITE_FEATURES_NOTE,
                                     **rec["capabilities"]}
    return out


def _hl_summary(hl) -> dict:
    """Counts per band, not the members of each band.

    The first version returned maker_bands() whole, which is every maker record
    filed under its band. That is 50 records where the question was four
    numbers, and it went over the 8KB ceiling and was refused: the ceiling did
    its job and the shape was still wrong. A summary that has to be trimmed to
    fit was never a summary.
    """
    rows, cut = _hl_makers(hl)
    bands = hl.maker_bands(rows)
    return {
        "makers": len(rows),
        # makers counts addresses with both polls and order counts. It can
        # sit below coverage.addresses, which counts every address ever
        # polled, including ones whose polls returned no orders at all.
        "makers_cut_at": HL_MAKERS_READ if cut else None,
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
    def _index_as_of():
        # When the data in the index was last refreshed from the registry, as
        # server.py measured it at build time: the newest last_seen_at over
        # the records. Not when this process loaded it, which is what the
        # cache's own timestamp says, and the container restarts often.
        reader = getattr(providers, "agents_index_as_of", None)
        if reader is None:
            return None
        try:
            return reader() or None
        except Exception:  # noqa: BLE001
            return None

    async def _index():
        """The index, built now if this process has not built it yet.

        server.py builds it on the first site request for agents, so on a
        fresh process an MCP caller used to find nothing until a person had
        loaded the site. The builder is server.py's own, under its own lock,
        into its one cache: nothing is built twice and nothing is held here.
        """
        ix = providers.agents_index()
        ensure = getattr(providers, "ensure_agents_index", None)
        if ix is None and ensure is not None:
            try:
                await ensure()
            except Exception:  # noqa: BLE001
                return None
            ix = providers.agents_index()
        return ix

    async def agents_coverage():
        ix = await _index()
        if ix is None:
            return {"agents": 0, "partial": True,
                    "note": "the index could not be built on this instance just now"}
        idx = ix.select()
        return {
            "agents": ix.count,
            "selectable": len(idx),
            "tiers": ix.tier_counts(idx),
            "liveness_coverage": ix.liveness_coverage(idx),
            "chains": sorted({c for c in ix.chain if c}),
            # Last, so the counts lead for any reader that shows the first
            # few fields, as the Telegram /coverage reply does.
            "registry_last_seen_at": iso_utc(_index_as_of()),
            "partial": False,
        }

    async def agents_get(agent_id: str):
        ix = await _index()
        return ix.record(agent_id) if ix else None

    async def agents_list(*, limit: int, offset: int, chain_id: int | None = None,
                          category: str | None = None, search: str | None = None,
                          verified: bool | None = None, sort: str | None = None):
        ix = await _index()
        if ix is None:
            return {"rows": [], "total": 0, "partial": True,
                    "note": "the index could not be built on this instance just now."}
        from core import agents_index as ai
        idx = ix.select(chain_id=chain_id, category=category, search=search,
                        min_tier=ai.TIER_VERIFIED if verified else None)
        idx = ix.sort(idx, sort)
        return {"rows": ix.project(idx, offset, limit), "total": len(idx),
                "partial": False}

    async def agents_summary(*, chain_id: int | None = None,
                             category: str | None = None, search: str | None = None):
        ix = await _index()
        if ix is None:
            return {"partial": True}
        idx = ix.select(chain_id=chain_id, category=category, search=search)
        facets = ix.facets(idx)
        return {
            "matched": len(idx),
            "tiers": ix.tier_counts(idx),
            "liveness_coverage": ix.liveness_coverage(idx),
            **_reconciled_categories(facets, len(idx)),
            "feedback_entries": ix.feedback_total(idx),
        }

    datasets.append(Dataset(
        id="agents.index",
        title="Agent index",
        measures="the BNB Chain marketplace: ERC-8004 agents with live service "
                 "status, ranked by what they have delivered rather than by "
                 "what they claim",
        keys=["agent id", "token id"],
        coverage=agents_coverage,
        get=agents_get,
        list=agents_list,
        summary=agents_summary,
        as_of=lambda c: c.get("registry_last_seen_at"),
        caveats=["as_of is the last time the registry refresh saw any agent in "
                 "this index, coverage.registry_last_seen_at, which is the "
                 "newest last_seen_at over its records. One agent's own "
                 "last_seen_at can be older. It is not the time of any "
                 "agent's health check, and it is null when the server did "
                 "not report it.",
                 "the tier id verified reads, in full: an address other than "
                 "the owner funded an on-chain job, and the agent then marked "
                 "it delivered. Marking it delivered is the provider calling "
                 "submit, which is the provider's own claim, and the tier "
                 "attaches the moment that lands. For almost all of these jobs "
                 "nobody disputed it and nobody ever settled it: settle is "
                 "permissionless once the dispute window elapses but nothing "
                 "calls it, so SUBMITTED is usually the end state rather than a "
                 "stage. Nothing inspects what was handed over: submit stores a "
                 "bytes32 commitment and the contract never checks its "
                 "preimage. The evidence is delivered_external "
                 "in jobs.erc8183 for the same owner address. The id stays "
                 "verified so existing filters keep working; the label shown to "
                 "people reads Buyer-funded, marked delivered.",
                 "Jobs an owner funds for its own agent are counted as activity "
                 "and never as verification. Enforcing that on 2026-09-16 moved "
                 "the BNB verified count from 29 to 27; "
                 "docs/verification-methodology.md names the two agents and why.",
                 "canary_verified is a weaker claim, from a test hire funded by "
                 "Tnega rather than by a buyer, and is never blended with "
                 "verified.",
                 "unproven and unchecked are different answers and were one id "
                 "until 2026-09-23. unproven means the agent was probed and "
                 "there was nothing to point to: its endpoint did not answer, "
                 "or it registered none. unchecked means nothing was ever "
                 "established, either because no health pass has reached the "
                 "agent or because resolving its metadata failed on our side, "
                 "usually a shared public IPFS gateway rate-limiting us. The "
                 "second is a statement about our coverage and is never "
                 "evidence about the agent. They were merged, and the merged "
                 "bucket was 98.8% unchecked while its published definition "
                 "said every agent in it had failed to answer.",
                 "responding is a count over agents that were probed, not over "
                 "agents that exist. liveness_coverage beside the tiers carries "
                 "probed, unprobed and the responding share OF PROBED; the "
                 "share over the unprobed is withheld with a reason rather than "
                 "returned as a number, because most of the store has never "
                 "been probed and dividing by it measures us, not them.",
                 "is_verified in the record is 8004scan's own registry field. "
                 "It is false for every agent in this index and is unrelated to "
                 "tier. Where the two look like they disagree, tier is the one "
                 "computed from job history.",
                 "score is 8004scan's total_score, carried through unchanged. "
                 "It barely discriminates: tens of thousands of agents share "
                 "identical values, and the whole verified set sits between "
                 "12.02 and 12.10. It is not a ranking of quality and should "
                 "not be used as one.",
                 "coverage.agents counts every stored record; coverage.selectable "
                 "is what any query can return. The difference is records whose "
                 "name is under three characters, which are excluded because a "
                 "name that short cannot identify an agent to a reader.",
                 "BNB Chain only. Agents on Ethereum, Arbitrum, Robinhood Chain, "
                 "Solana and Monad are in chains.agents, which is a different "
                 "store with a different field set. coverage.chains lists what "
                 "is actually here rather than what the site covers."],
    ))

    # ── hyperliquid ───────────────────────────────────────────────────────
    datasets.append(Dataset(
        id="hyperliquid.post_only",
        title="Hyperliquid post-only rejection",
        measures="the share of an address's post-only orders that the matching "
                 "engine refused instead of resting on the book",
        keys=["address"],
        coverage=lambda: _retry_serialization(hl.coverage),
        get=hl.address_detail,
        # Every list takes the same keyword contract and returns the same shape,
        # so the tool does not need to know which dataset it is paging. Where a
        # service function predates that contract it is adapted here rather than
        # changed there: the tab calls makers(limit) and is not this adapter's
        # to rewrite.
        list=lambda *, limit, offset, **_: _hl_page(hl, limit, offset),
        summary=lambda **_: _hl_summary(hl),
        # The series reads the WebSocket tables, which lose the same
        # conflicts coverage() does, so it takes the same single retry.
        series=lambda address, **kw: _retry_serialization(
            lambda: hl.address_series(address, **kw)),
        # The REST collector's last poll for the dataset, and the WebSocket
        # series' last bucket for a series: the two coverage blocks carry one
        # key each and never both.
        as_of=lambda c: c.get("last_poll") or c.get("last_bucket"),
        record_as_of=lambda r: ((r or {}).get("freshness") or {}).get("last_polled_at"),
        caveats=["as_of is the REST collector's last poll for the dataset, the "
                 "address's own last poll for one record (null if it was never "
                 "polled), and the last WebSocket bucket for a series. The "
                 "record's own as_of field inside value is the time of the "
                 "read, not of the measurement.",
                 "The WebSocket collector behind the series was suspended on "
                 "2026-09-19 after the study it was run for had its windows, "
                 "so every series ends on that date unless it has been "
                 "resumed since. coverage.last_bucket says where a series "
                 "ends. The REST rate is collected separately and is current.",
                 "A refused post-only order never rests, provides no liquidity "
                 "and leaves no trace in fills, so it is invisible in volume.",
                 "coverage.polls_with_gap counts polls where orders happened "
                 "between the end of the previous window and the start of this "
                 "one, so the sample is not contiguous. Measured 2026-09-23 it "
                 "is 72.6% of polls, 20,803 of 28,648. The figure here read "
                 "'around 60%' until that date, which was the share when it "
                 "was written. Rates are pooled counts over what was seen, "
                 "which a gap makes an undercount of activity rather than a "
                 "wrong rate.",
                 "polls_with_gap can only see orders that happened BETWEEN "
                 "polls. It is computed from the first and last order "
                 "timestamps in each poll and counted only when positive, so a "
                 "poll returning exactly the records its predecessor returned "
                 "moves neither boundary, comes out negative, and is recorded "
                 "as not gapped. A run of polls that brought back no new "
                 "orders at all is therefore indistinguishable here from "
                 "perfect contiguous coverage.",
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
        get=lambda view: _chain_record(chain_views, view),
        list=lambda *, limit, offset, **_: _chain_page(chain_views, limit, offset),
        # Configuration, not a measurement: which chains a view groups and
        # which contracts are deployed there. There is no time it was measured
        # at, so as_of is null rather than the call time.
        as_of=None,
        caveats=["This dataset is configuration rather than a measurement, so "
                 "as_of is null. served_at is the time of the call.",
                 "hire_paths_deployed names the contracts that exist on that "
                 "chain. It is a fact about deployment, not about delivery: no "
                 "agent on the chain need ever have been hired, and none of it "
                 "implies a job was completed.",
                 "The ERC-8183 escrow path is deployed on BNB Chain only. A "
                 "view with an empty list has neither contract."],
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

    async def jobs_list(*, limit, offset, key=None, **_):
        """One provider's jobs, one row each.

        The aggregate was all this dataset exposed, and an audit of the surface
        listed what it could not answer from it: who hired the agent, what it
        was paid, and which jobs are the unfinished ones. All three are fields
        on the job documents the index already holds. They were not missing
        from the data, only from this.
        """
        from core import job_index
        if not key:
            # A refusal, not a partial page. The distinction is the whole
            # point: partial says some of the answer is missing, and this says
            # the question cannot be answered as asked. tools.list turns this
            # into a withheld_reason; it used to become an empty page.
            return {
                "rows": [], "total": None, "partial": False,
                "withheld_reason": "key_required",
                "explanation": "This dataset lists one provider's jobs, so it "
                               "needs a provider address in `key`. Get one "
                               "from tnega_list on agents.index, where it is "
                               "the owner_address of any agent, or from "
                               "tnega_resolve. The whole index cannot be "
                               "listed: it holds 56,790 jobs across every "
                               "provider and paging it would say nothing "
                               "about any of them.",
            }
        # The paged read, not the revenue read. Slicing in Python after
        # materialising every job bounds the wire and not the heap, which is
        # how a 17MB response and its MCP sibling shared one defect.
        out = await job_index.get_provider_jobs_page(
            str(key).lower(), offset=offset, limit=limit)
        page = out.get("jobs") or []
        return {
            "rows": [{
                "job_id": j.get("_id"),
                "status": j.get("status"),
                "client": j.get("client"),
                "budget": j.get("budget"),
                "submitted_at": j.get("submittedAt"),
                "expired_at": j.get("expiredAt"),
                # The bytes32 passed to submit. None means the index has not
                # read it for this job yet, which is not the same as the zero
                # word, which means the provider committed nothing.
                "deliverable": j.get("deliverable"),
            } for j in page],
            "total": out.get("total"),
            "partial": False,
        }

    datasets.append(Dataset(
        id="jobs.erc8183",
        title="ERC-8183 job index",
        measures="on-chain jobs for one provider: who hired them, what was "
                 "escrowed, and what state each job is in",
        keys=["provider address"],
        example_filters={"key": "0x20f1ca5d1e5a3ee94c29dbf95e6bf6cea6a8d64b"},
        coverage=jobs_coverage,
        get=jobs_get,
        list=jobs_list,
        as_of=lambda c: c.get("last_pass_completed_at"),
        caveats=["as_of is the end of the indexer's last complete pass, "
                 "coverage.last_pass_completed_at: the last time the index "
                 "was read against the chain, whether or not that pass found "
                 "new jobs. last_pass_reached_head says whether it also caught "
                 "up to the chain's job counter. It is null until a pass has "
                 "recorded it. last_run_at is different: it moves only when a "
                 "new job is indexed.","Provider is the agent owner's address. The field is called "
                 "owner_address in the aggregate and provider in the job "
                 "documents, and they are the same address.",
                 "budget is the amount escrowed for the job in the contract's "
                 "own units, not a settled payment. A job that never completed "
                 "still carries one.",
                 "completed and submitted are different states. SUBMITTED "
                 "means the provider called submit and settlement has not "
                 "happened, which is what the verified tier rests on; it is "
                 "counted in active as well, so active alone cannot tell a "
                 "submission from silence.",
                 "deliverable is field eleven of the job tuple, the bytes32 "
                 "passed to submit. It is not evidence of delivery: the "
                 "contract checks no preimage, so the value need not be the "
                 "digest of anything, nothing need have been published, and no "
                 "client need have received it. Nor does its presence add "
                 "anything to status. Measured over all 56,798 jobs on "
                 "2026-09-23, every job at SUBMITTED or COMPLETED carries a "
                 "non-zero value and no job short of submit carries one, "
                 "because the same call writes both. The exception, and the "
                 "only place the field says more than status, is 8 EXPIRED "
                 "jobs that carry a commitment.",
                 "Indexed from chain logs in batches, so the index can trail "
                 "the chain. index_complete describes the index as of "
                 "coverage.last_pass_completed_at, not this moment."],
    ))

    # ── budgets ───────────────────────────────────────────────────────────
    async def budgets_coverage():
        from core import budget_index
        from core.db import get_db
        db = get_db()
        stats = await budget_index.get_agent_budget_stats(db)
        # draw_rate, not rate. This read `rate`, a key the service has never
        # returned, so agents_with_a_rate was 0 whatever the data said.
        rated = sum(1 for v in stats.values() if v.get("draw_rate") is not None)
        # When each chain was last indexed, from the indexer's own checkpoint.
        # The dataset is as current as its least current chain, so that one
        # is as_of, and every chain is listed so the lag is visible by name.
        indexed = {}
        async for doc in db[budget_index.PROGRESS_COLLECTION].find(
                {}, {"_id": 0, "chain_id": 1, "updated_at": 1}):
            if doc.get("chain_id") is not None:
                indexed[str(doc["chain_id"])] = doc.get("updated_at")
        times = [t for t in indexed.values() if t]
        return {"agents_with_budgets": len(stats), "agents_with_a_rate": rated,
                "chains_indexed_at": {k: iso_utc(v) for k, v in sorted(indexed.items())},
                "oldest_chain_indexed_at": iso_utc(min(times)) if times else None,
                "partial": False}

    async def budgets_get(agent_address: str):
        from core import budget_index
        from core.db import get_db
        stats = await budget_index.get_agent_budget_stats(get_db())
        return stats.get(str(agent_address).lower())

    datasets.append(Dataset(
        id="budgets.escrow",
        title="Spending budgets",
        measures="budgets funded to agents, what was drawn against them, and "
                 "what was reclaimed",
        keys=["agent address"],
        coverage=budgets_coverage,
        get=budgets_get,
        as_of=lambda c: c.get("oldest_chain_indexed_at"),
        caveats=["as_of is the least recently indexed chain, "
                 "coverage.oldest_chain_indexed_at; chains_indexed_at gives "
                 "each chain's own time, keyed by chain id.","A rate is withheld below the minimum sample rather than "
                 "computed from a few budgets.",
                 "Spend is counted from Drawn events. The contract's own spent "
                 "field is overwritten by a reclaim and does not mean delivery.",
                 # The dataset id and the contract name both say "escrow",
                 # and a client reading only those would draw the wrong
                 # conclusion about what a drawn budget implies.
                 "AgentBudgetEscrow is a spending mechanism and not an escrow, "
                 "whatever its name suggests. draw() requires no deliverable, "
                 "there is no dispute function and no window, and reclaim() "
                 "recovers only what has not been drawn. A budget drawn from "
                 "records that the agent took money, never that anything was "
                 "delivered. Delivery-gated payment on this project is the "
                 "ERC-8183 path in jobs.erc8183, which is BNB Chain only."],
    ))

    # ── agents on the other chains ────────────────────────────────────────
    #
    # The gap an external agent found: the catalogue described agents.index as
    # five chains, coverage.chains said [56], and the agents behind the other
    # four were in no dataset at all. They are a different store with a
    # different field set, which is why they are a second dataset rather than
    # a filter on the first, and why the two say so in each other's caveats.
    #
    # Keyed by chain id rather than by view name so that no tool schema had to
    # grow a `view` filter: chain_id is already a filter every list understands.
    # A dataset should not be able to widen the vocabulary the tools speak.
    chain_by_id = {c: vid for vid, v in chain_views.VIEWS.items()
                   for c in v["chain_ids"] if vid != "bnb"}

    async def chain_agents_coverage():
        views = [v for v in chain_views.view_ids() if v != "bnb"]
        counts = {}
        for vid in views:
            if (chain_views.VIEWS.get(vid) or {}).get("kind") == "venue":
                continue
            counts[vid] = await chain_views.count_view(vid)
        # When each registry scan behind these views last SUCCEEDED, from the
        # ingest's own checkpoints. last_run_at moves on failures too, so it
        # dated Solana to an attempt that returned HTTP 525. Ethereum rides
        # the shared EVM scan; Solana and the three single-chain registries
        # have their own checkpoints.
        from core import full_registry_ingest as fri
        docs = {"ethereum": await fri.get_progress(),
                "solana": await fri.get_solana_progress(),
                **(await fri.get_additional_chains_progress())}
        ok = {k: (d or {}).get("last_success_at") for k, d in docs.items() if k in counts}
        never = sorted(k for k, t in ok.items() if not t)
        # A view with no recorded success makes the dataset's as_of null
        # rather than being left out of it: an as_of says every view was read
        # at that time or later, and for these no time can be said.
        oldest = (iso_utc(min(ok.values())) if ok and not never else None)
        return {"views": counts, "agents": sum(counts.values()),
                "chain_ids": sorted(chain_by_id),
                "ingest_last_success_at": {k: iso_utc(v) for k, v in ok.items()},
                "ingest_no_recorded_success": never,
                "oldest_ingest_success_at": oldest,
                "partial": False}

    async def chain_agents_get(key: str):
        # "<chain id>/<token id>", which is the shape of the site's own URL for
        # one of these agents.
        parts = str(key).split("/")
        if len(parts) != 2 or not parts[0].isdigit():
            return None
        rec = await chain_views.fetch_agent(int(parts[0]), parts[1])
        return _site_features(rec)

    async def chain_agents_list(*, limit, offset, chain_id=None, category=None, **_):
        if chain_id is None:
            return {"rows": [], "total": None, "partial": True,
                    "note": f"chain_id is required here. Valid: {sorted(chain_by_id)}."}
        view = chain_by_id.get(int(chain_id))
        if view is None:
            return {"rows": [], "total": None, "partial": True,
                    "note": f"chain {chain_id} is not one of these views. "
                            f"Valid: {sorted(chain_by_id)}. BNB Chain is agents.index."}
        page = await chain_views.fetch_page(view, offset=offset, limit=limit,
                                            category=category)
        # fetch_page names its list "agents". Read the key rather than
        # guessing between two, so a rename breaks loudly instead of returning
        # an empty page that looks like an empty chain.
        rows = page.get("agents") or []
        return {
            "rows": [{
                "id": a.get("id"),
                "token_id": a.get("token_id"),
                "name": (a.get("name") or "")[:80],
                "chain_id": a.get("chain_id"),
                "category": a.get("category"),
                "score": a.get("total_score"),
            } for a in rows],
            "total": page.get("total"),
            "partial": False,
        }

    async def chain_agents_summary(*, chain_id=None, **_):
        if chain_id is None:
            return {"note": f"chain_id is required here. Valid: {sorted(chain_by_id)}."}
        view = chain_by_id.get(int(chain_id))
        if view is None:
            return {"note": f"chain {chain_id} is not one of these views."}
        facets = await chain_views.category_facets(view)
        total = await chain_views.count_view(view)
        # One page is fetched for its status breakdown, which chain_views
        # computes per view and only for chains the analysis pass has actually
        # run against. A blanket "not checked" would be wrong for Ethereum,
        # Arbitrum and Robinhood Chain, which have been.
        head = await chain_views.fetch_page(view, offset=0, limit=1)
        return {"view": view, "matched": total,
                "service_status": head.get("status_counts"),
                "health_checked_chains": head.get("verified_chains"),
                **_reconciled_categories(facets, total)}

    datasets.append(Dataset(
        id="chains.agents",
        title="Agents on the other chains",
        measures="ERC-8004 agents on Ethereum, Arbitrum, Robinhood Chain, "
                 "Solana and Monad, from the full registry rather than the "
                 "BNB marketplace",
        keys=["chain id/token id, as 42161/1234"],
        example_filters={"chain_id": 1},
        coverage=chain_agents_coverage,
        get=chain_agents_get,
        list=chain_agents_list,
        summary=chain_agents_summary,
        as_of=lambda c: c.get("oldest_ingest_success_at"),
        caveats=["as_of is the least recent successful registry scan across "
                 "these views, coverage.oldest_ingest_success_at, and "
                 "ingest_last_success_at gives each view's own. A view named "
                 "in ingest_no_recorded_success has no recorded success, and "
                 "while any view is in it as_of is null rather than a time "
                 "that would not hold for that view.",
                 "A different store from agents.index, with a thinner record: "
                 "no verification tier, because delivery has not been joined "
                 "for these chains.",
                 "Service status exists only for chains the analysis pass has "
                 "run against. summary.health_checked_chains says which, and "
                 "an absent status is unchecked rather than unhealthy.",
                 "list and summary need chain_id. Without it this returns no "
                 "rows and says which chain ids it knows.",
                 "BNB Chain is deliberately not here. It is agents.index, "
                 "which carries a fuller record for the same kind of agent."],
    ))

    out: dict[str, Dataset] = {}
    for d in datasets:
        if d.coverage is None:
            raise ValueError(f"{d.id} has no coverage function")
        out[d.id] = d
    return out
