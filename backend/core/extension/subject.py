"""
subject.py

What the extension is looking at, and what can be said about it.

THE RULE THIS FILE INHERITS
Every reason a number is not shown is decided here and rendered verbatim by
the client, exactly as core/hyperliquid/service.py does for that venue. The
extension computes nothing. If the rule for when a number is trustworthy lived
in the extension too, there would be two rules, and the one on screen would be
the one nobody reviewed.

TWO SUBJECTS, NOT THREE
Agents and Hyperliquid. A third, bots, was designed and dropped before it was
built: the whole bot dataset is two Solana addresses hardcoded in a React
component, with no endpoint and no collector behind them, so there was nothing
to serve. It is not a subject the extension covers and nothing here pretends
otherwise. When a bot collector exists, it arrives as a key space in
membership.py and a branch here, and not before.

WHAT IS NEVER RETURNED
`is_verified`. It is false for all 262,339 registry agents that carry the
field, because the upstream source never sets it. A field that is constant is
not a measurement, and putting it on a panel would publish a value that means
nothing. The agent block says so in `verification_note` rather than leaving a
reader to wonder why a verification flag is missing.
"""

from __future__ import annotations

import re
import time

from core.db import get_db
from core.extension.membership import CHAIN_SLUGS, SLUG_BY_CHAIN
from core.full_registry_ingest import FULL_REGISTRY_COLLECTION
from core import budget_index

ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
AGENT_RE = re.compile(r"^a:([a-z0-9-]+):(\d+)$")

# Chains whose stored service_status was produced by a health pass that
# understands that chain. Mirrors core/full_registry_analysis.ANALYSIS_CHAIN_IDS
# rather than restating it: a chain outside that list can hold a stale value
# from before the pass was per-chain aware, and 8,304 such values were cleared
# on 2026-09-05. Read from the source so the two cannot drift.
from core.full_registry_analysis import ANALYSIS_CHAIN_IDS  # noqa: E402

CHAIN_NAMES = {
    56: "BNB Chain",
    1: "Ethereum",
    8453: "Base",
    143: "Monad",
    42161: "Arbitrum",
    4663: "Robinhood Chain",
}

# The jobs index is built from one contract, on one chain. There is no
# chain_id on the documents to filter by, so the scope is a property of how
# the index is made rather than of what it holds, and it is stated here
# instead of inferred from data that cannot express it.
JOBS_CHAIN_ID = 56

SERVICE_STATUS_WORDS = {
    "responding": "Responding",
    "not_responding": "Not responding",
    "no_endpoint": "No endpoint published",
    "unknown": "Not established",
}


# The Hyperliquid address set, cached in this process.
#
# by_address is called once per covered page view and this set is 66 rows that
# change when the collector rotates its targets, which is hourly at most. Read
# without a cache it was the largest term in a 1.4 second lookup, because it
# crosses to CockroachDB while everything else is one indexed Mongo query.
_hl_set: set[str] | None = None
_hl_set_at: float = 0.0
_HL_TTL_SECONDS = 600


async def _in_hyperliquid_set(address: str) -> bool:
    global _hl_set, _hl_set_at
    import asyncio
    if _hl_set is None or time.time() - _hl_set_at > _HL_TTL_SECONDS:
        try:
            from core.hyperliquid import service
            rows = await asyncio.to_thread(service.all_known_addresses)
            _hl_set, _hl_set_at = set(rows), time.time()
        except Exception:  # noqa: BLE001
            # Unreachable store. Report "not this subject" rather than raising:
            # the agent half of this answer is already in hand and is worth
            # more than a 503. The cache is deliberately not written, so the
            # next call retries instead of holding an empty set for ten
            # minutes.
            return False
    return address in _hl_set


def _age_seconds(ts) -> float | None:
    if ts is None:
        return None
    try:
        return max(0.0, time.time() - float(ts))
    except (TypeError, ValueError):
        return None


async def _agent_block(doc: dict) -> dict:
    """One agent, as a panel renders it."""
    chain = doc.get("chain_id")
    status = doc.get("service_status")
    checked = doc.get("service_checked_at")

    if chain not in ANALYSIS_CHAIN_IDS:
        service = {"withheld_reason": "chain_not_analysed"}
    elif not status or status == "unknown":
        service = {"withheld_reason": "health_not_checked"}
    else:
        service = {
            "status": status,
            "label": SERVICE_STATUS_WORDS.get(status, status),
            "endpoint_published": bool(doc.get("service_endpoint")),
            "http_status": doc.get("service_http_status"),
            "checked_at": checked,
            "checked_age_seconds": _age_seconds(checked),
        }

    return {
        "token_id": str(doc.get("token_id")) if doc.get("token_id") is not None else None,
        "chain_id": chain,
        "chain_name": CHAIN_NAMES.get(chain, str(chain)),
        "chain_slug": SLUG_BY_CHAIN.get(chain),
        "name": doc.get("name"),
        "category": doc.get("category"),
        "owner_address": (doc.get("owner_address") or "").lower() or None,
        "service": service,
        # Stated, not shown as a value. See the module docstring.
        "verification_note": (
            "The registry's own verified flag is false for every agent it "
            "carries, so it is not shown. What is shown is whether the "
            "endpoint answered when it was last called."),
    }


async def _jobs_block(address: str) -> dict:
    """ERC-8183 jobs where this address is the provider."""
    db = get_db()
    cursor = db.erc8183_job_index.find(
        {"provider": {"$in": [address, address.lower()]}},
        {"status": 1, "budget": 1, "submittedAt": 1})
    rows = await cursor.to_list(length=500)
    if not rows:
        return {
            "withheld_reason": "no_jobs_indexed",
            "index_chain_id": JOBS_CHAIN_ID,
        }
    counts: dict[str, int] = {}
    for r in rows:
        s = (r.get("status") or "UNKNOWN").upper()
        counts[s] = counts.get(s, 0) + 1
    delivered = counts.get("SUBMITTED", 0) + counts.get("COMPLETED", 0)
    return {
        "total": len(rows),
        "by_status": counts,
        "delivered": delivered,
        "index_chain_id": JOBS_CHAIN_ID,
        "note": (
            "SUBMITTED means delivered and not yet settled. Budget is what was "
            "escrowed, not what was paid. This index covers one contract on "
            "BNB Chain, so an address with no jobs here may have been hired "
            "somewhere this project does not read."),
    }


async def _hyperliquid_block(address: str) -> dict:
    """The Hyperliquid reading, from the same handler the Hyperliquid panel
    uses.

    THE SAME HANDLER, NOT A SECOND PATH
    service.address_detail is what /api/hyperliquid/address serves and what the
    panel on app.hyperliquid.xyz renders. It is called here rather than
    reimplemented, so there is one place that decides whether a rate is worth
    showing and one set of words for why it is not. A second path would be a
    second rule, and the one on screen would be the one nobody reviewed.

    The set membership is checked first, from the ten-minute cache, so that
    looking up any of the 177,117 agent owners does not cross to CockroachDB to
    be told what the cached set already knows. `not_tracked` is the exact
    reason address_detail itself would return for an address outside the set,
    and it is already in every surface's vocabulary, so this shortcut changes
    what is spent and not what is said.
    """
    import asyncio
    if not await _in_hyperliquid_set(address):
        # NOT TRACKED IS STILL NOT NOTHING, changed 2026-09-19
        #
        # This used to return the reason and stop, so an address outside the
        # rotation got a panel carrying one sentence about our coverage and no
        # fact about the address. That reads as broken rather than as a limit
        # honestly stated, and it was not even true that nothing was known: the
        # venue publishes an account value and four windows of PnL, ROI and
        # volume for 46,000 addresses, and the daily selection job downloads
        # the whole file to pick 31 of them.
        #
        # The reason is kept exactly as it was. What is added beside it is the
        # venue's, is labelled as the venue's by service.leaderboard_row, and
        # is not a measurement by this project. Nothing here changes what we
        # claim to have measured.
        out = {"withheld_reason": "not_tracked"}
        try:
            row = await asyncio.to_thread(leaderboard_row, address)
        except Exception:  # noqa: BLE001
            row = None
        if row:
            out["venue_leaderboard"] = row
        try:
            from core.hyperliquid import venuerole
            out["account"] = await asyncio.to_thread(venuerole.describe, address)
        except Exception:  # noqa: BLE001
            pass
        return out
    try:
        d = await asyncio.to_thread(service_address_detail, address)
        from core.hyperliquid import venuerole
        d["account"] = await asyncio.to_thread(venuerole.describe, address)
        # No attachment here any more. address_detail does it for every
        # caller, which is what stopped the two endpoints disagreeing.
        return d
    except Exception:  # noqa: BLE001
        # The venue store is unreachable. That is not a statement about the
        # address, and it must not be rendered as one.
        return {"withheld_reason": "store_unavailable"}


def service_address_detail(address: str) -> dict:
    from core.hyperliquid import service
    return service.address_detail(address)


def leaderboard_row(address: str, include_pnl: bool = True) -> dict | None:
    from core.hyperliquid import service
    return service.leaderboard_row(address, include_pnl)


# Above this many distinct clients, "has this provider delivered to this client
# before" is not computed rather than computed expensively, and the field says
# so instead of implying an answer. Mirrors MAX_CLIENTS_FOR_PROVENANCE in
# core/job_index.py, which runs the same measurement in bulk.
MAX_CLIENTS_FOR_PROVENANCE = 200
_DELIVERED_STATUSES = ["COMPLETED", "SUBMITTED"]


async def _provenance_block(address: str) -> dict:
    """Who paid for the work this address delivered.

    THE REASON THIS IS ON THE PANEL AT ALL
    "Delivered nine jobs" and "delivered nine jobs, all to one client, and that
    client is its own owner" are the same count and a different fact. Measured
    across the verified set, 20 of 26 owners have every delivery from a single
    client, in three cases that client owns another agent in the same index,
    and six have jobs from other clients sitting funded and undelivered. A
    person about to fund the next job has none of that from a job count.

    KEYED BY THE PROVIDER ADDRESS, WHICH IS NOT THE SAME AS THE AGENT
    An ERC-8183 job document holds provider, client, budget, status and
    submittedAt, and nothing naming an agent, because the contract keys a job
    by address. So one owner's unanswered job cannot be attributed to one of
    their agents, and an owner listing several agents gets the same block on
    each. That is correct and it reads as a per-agent fact unless it says
    otherwise, so it says so, exactly as the site's block does.

    This is the same measurement core/job_index.py runs over the whole index,
    narrowed to one provider. It is not a second definition: the statuses that
    count as delivered, the client cap, and the treatment of the uncomputed
    case are read from the same constants and reproduced here for one address
    because the bulk pass builds a table this path has no reason to load.
    """
    db = get_db()
    addr = address.lower()

    # Sorted by count AND then by client address. The second key is not
    # decoration: two clients with one delivery each is a tie, and $first over
    # a tie picks arbitrarily, so "the largest client is the owner itself"
    # appeared and disappeared between two runs over the same data. Found by
    # cross-checking this against the bulk pass in core/job_index.py, which
    # disagreed on exactly one provider of 105, for exactly that reason. Both
    # sides now order the same way.
    delivered = await db.erc8183_job_index.aggregate([
        {"$match": {"provider": addr, "status": {"$in": _DELIVERED_STATUSES}}},
        {"$group": {"_id": "$client", "n": {"$sum": 1}}},
        {"$sort": {"n": -1, "_id": 1}},
    ]).to_list(length=None)

    funded = await db.erc8183_job_index.aggregate([
        {"$match": {"provider": addr, "status": "FUNDED"}},
        {"$group": {"_id": "$client", "n": {"$sum": 1}}},
    ]).to_list(length=None)

    if not delivered and not funded:
        return {"withheld_reason": "no_delivery_history"}

    clients = len(delivered)
    total_delivered = sum(r["n"] for r in delivered)
    # Counted directly rather than inferred from whichever client sorted first.
    # Whether an agent has been paid by anyone other than its own owner is the
    # single most load-bearing fact in this block, and it must not rest on a
    # tiebreak.
    self_funded = sum(r["n"] for r in delivered
                      if (r["_id"] or "").lower() == addr)
    top = (delivered[0]["_id"] or "").lower() if delivered else None
    top_n = delivered[0]["n"] if delivered else 0

    delivered_to = {(r["_id"] or "").lower() for r in delivered}
    if clients > MAX_CLIENTS_FOR_PROVENANCE:
        unanswered = None
        unanswered_known = False
    else:
        unanswered = sum(f["n"] for f in funded
                         if (f["_id"] or "").lower() not in delivered_to)
        unanswered_known = True

    # Is the largest buyer the owner itself, or the owner of another agent in
    # the registry? Both are buyers and neither is an unrelated one, and the
    # difference between them is worth naming.
    top_is_self = bool(top) and top == addr
    top_is_agent_owner = False
    top_agent_name = None
    if top and not top_is_self:
        other = await db[FULL_REGISTRY_COLLECTION].find_one(
            {"owner_address": top}, {"name": 1})
        if other:
            top_is_agent_owner = True
            top_agent_name = other.get("name")

    return {
        "clients_delivered": clients,
        "jobs_delivered": total_delivered,
        "jobs_self_funded": self_funded,
        "jobs_delivered_external": total_delivered - self_funded,
        "clients_external": sum(1 for r in delivered
                                if (r["_id"] or "").lower() != addr),
        "top_client_delivered": top_n,
        "top_client_is_self": top_is_self,
        "top_client_is_agent_owner": top_is_agent_owner,
        "top_client_agent_name": top_agent_name,
        "unanswered_from_new_clients": unanswered,
        "unanswered_from_new_clients_known": unanswered_known,
        "counted_by": "owner_address",
        "note": (
            "Counted for the owner address behind this agent, which may list "
            "more than one. A job names a provider address, not an agent."),
    }


# Where AgentBudgetEscrow is deployed AND accepts the token the hire flow
# sends. Mirrors core/chain_views.BUDGET_HIRE_CHAIN_IDS. Ethereum is absent on
# purpose: the contract is there, acceptedTokens(NATIVE) is false, and every
# budget opened on it reverted.
BUDGET_CHAIN_IDS = (56, 42161, 4663)


async def _budgets_block(address: str) -> dict:
    """Budgets funded to this address, and how many were drawn against.

    DRAWS, NEVER `spent`
    The escrow's `spent` field is not a delivery figure. `reclaim` sets
    `b.spent = b.total` before paying the client back, so a budget the client
    took back in full reads as one the agent drew in full. `lastDrawAt` is no
    better: `openBudget` seeds it with the creation timestamp so that a
    cooldown is honoured before the first draw, so a non-zero value does not
    mean a draw happened.

    Both traps are live, together, on the single budget that exists on chain
    4663: read directly on 2026-09-18 it reports spent equal to total and a
    lastDrawAt six hours before its deadline, and it was in fact opened, never
    drawn, and reclaimed. core/budget_index.py counts Drawn events instead and
    records draws 0 for it, which is the correct account. This function reads
    that index and never the contract's own fields.
    """
    db = get_db()
    rows = await db[budget_index.COLLECTION].find(
        {"agent": address.lower()},
        {"chain_id": 1, "budget_id": 1, "draws": 1, "opened_block": 1},
    ).to_list(length=100)

    if not rows:
        return {
            "withheld_reason": "no_budgets_opened",
            "index_chain_ids": list(BUDGET_CHAIN_IDS),
        }

    drawn = sum(1 for r in rows if (r.get("draws") or 0) > 0)
    return {
        "budgets": len(rows),
        "budgets_drawn_from": drawn,
        "budgets_never_drawn": len(rows) - drawn,
        "chains": sorted({r.get("chain_id") for r in rows if r.get("chain_id")}),
        "index_chain_ids": list(BUDGET_CHAIN_IDS),
        "note": (
            "Counted from Drawn events, not from the escrow's own spent field, "
            "which a client reclaiming their money overwrites to the full "
            "amount. A budget that was opened and never drawn is money "
            "committed and not collected."),
    }


async def _agent_half(addr: str) -> dict:
    """The agent reading for one address: registered identities, and jobs."""
    db = get_db()
    docs = await db[FULL_REGISTRY_COLLECTION].find(
        {"owner_address": addr},
        {"chain_id": 1, "token_id": 1, "name": 1, "category": 1,
         "owner_address": 1, "service_status": 1, "service_checked_at": 1,
         "service_endpoint": 1, "service_http_status": 1},
    ).to_list(length=25)

    jobs = await _jobs_block(addr)
    provenance = await _provenance_block(addr)
    budgets = await _budgets_block(addr)

    if not docs:
        # A provider with jobs but no registered agent. Fifty of the 119
        # ERC-8183 providers are in this position: they were hired and paid
        # through the escrow without ever minting an identity. Reporting
        # not_covered here would have made every surface silent about the one
        # set of addresses with on-chain delivery behind them, which is the
        # strongest evidence this project holds.
        # A budget or a job, with no registered identity behind it. Both are
        # coverage: somebody committed money to this address through one of
        # this project's own contracts, which is a stronger fact than a
        # registry entry, and an earlier version discarded it because the
        # branch keyed only on the registry. Same defect as the one that lost
        # the 50 job providers who never minted an identity.
        has_jobs = "withheld_reason" not in jobs
        has_budgets = "withheld_reason" not in budgets
        if has_jobs or has_budgets:
            if has_jobs and has_budgets:
                note = ("This address has been hired through the ERC-8183 "
                        "escrow and has had a spending budget funded to it, but holds "
                        "no registered agent identity, so there is nothing to "
                        "say about a published service endpoint.")
            elif has_jobs:
                note = ("This address has been hired through the ERC-8183 "
                        "escrow but holds no registered agent identity, so "
                        "there is nothing to say about a published service "
                        "endpoint.")
            else:
                note = ("A budget has been funded to this address through this "
                        "project's escrow, but it holds no registered agent "
                        "identity, so there is nothing to say about a "
                        "published service endpoint.")
            return {
                "agents": [],
                "agent_count": 0,
                "chains": [],
                "multi_chain": False,
                "jobs": jobs,
                "provenance": provenance,
                "budgets": budgets,
                "note": note,
            }
        return {"withheld_reason": "not_covered"}

    agents = [await _agent_block(d) for d in docs]
    # Owners hold agents on more than one chain: 2,245 of them do. A panel is
    # drawn on one explorer, so it is told which chains these are and can say
    # so rather than presenting a Base agent as though the BscScan page were
    # about it.
    chains = sorted({a["chain_id"] for a in agents if a["chain_id"] is not None})
    return {
        "agents": agents,
        "agent_count": len(agents),
        "chains": chains,
        "multi_chain": len(chains) > 1,
        "jobs": jobs,
        "provenance": provenance,
        "budgets": budgets,
    }


async def by_address(address: str) -> dict:
    """An address, on an explorer, on an 8004scan owner page, or in the popup.

    BOTH HALVES, NOT A PRECEDENCE
    An earlier version picked one subject and, for a Hyperliquid address,
    returned a pointer at the other endpoint rather than the reading. That made
    the popup impossible to serve from this handler and it was wrong on its own
    terms: an address can be a registered agent owner and a Hyperliquid maker,
    and answering with one of them is answering half the question. None of the
    66 Hyperliquid addresses currently owns an agent, checked rather than
    assumed, so today one half is always withheld. The shape does not depend on
    that staying true.

    `subjects` lists the halves that carry a reading. An empty list means
    neither does, and each half still says why.
    """
    addr = address.lower()

    agent = await _agent_half(addr)
    hyperliquid = await _hyperliquid_block(addr)

    subjects = []
    if "withheld_reason" not in agent:
        subjects.append("agent")
    if not hyperliquid.get("withheld_reason"):
        subjects.append("hyperliquid")

    return {
        "identifier": addr,
        "subjects": subjects,
        "agent": agent,
        "hyperliquid": hyperliquid,
    }


async def by_agent(slug: str, token_id: str) -> dict:
    """One agent, from an 8004scan agent URL."""
    chain = CHAIN_SLUGS.get(slug)
    if chain is None:
        return {
            "identifier": f"a:{slug}:{token_id}",
            "subjects": [],
            "agent": {"withheld_reason": "chain_not_covered"},
            "hyperliquid": {"withheld_reason": "no_address_on_page"},
            "chain_slug": slug,
        }

    db = get_db()
    # token_id is stored as a string in this collection and as an integer in
    # known_agents. Both shapes are tried because a type mismatch in Mongo is
    # an empty result rather than an error, which would read here as "we have
    # never seen this agent".
    candidates: list = [str(token_id)]
    try:
        candidates.append(int(token_id))
    except (TypeError, ValueError):
        pass

    doc = await db[FULL_REGISTRY_COLLECTION].find_one(
        {"chain_id": chain, "token_id": {"$in": candidates}},
        {"chain_id": 1, "token_id": 1, "name": 1, "category": 1,
         "owner_address": 1, "service_status": 1, "service_checked_at": 1,
         "service_endpoint": 1, "service_http_status": 1})

    if doc is None:
        return {
            "identifier": f"a:{slug}:{token_id}",
            "subjects": [],
            "agent": {"withheld_reason": "not_in_snapshot"},
            # An agent page carries no address, so there is nothing to ask the
            # venue store about. That is a different absence from "this address
            # is not in the collector's set" and gets its own reason rather
            # than borrowing one that would read as a finding.
            "hyperliquid": {"withheld_reason": "no_address_on_page"},
            "chain_id": chain,
            "chain_slug": slug,
        }

    block = await _agent_block(doc)
    owner = block.get("owner_address")
    return {
        "identifier": f"a:{slug}:{token_id}",
        "subjects": ["agent"],
        "agent": {
            "agents": [block],
            "agent_count": 1,
            "chains": [chain],
            "multi_chain": False,
            "jobs": (await _jobs_block(owner)) if owner else {
                "withheld_reason": "no_jobs_indexed",
                "index_chain_id": JOBS_CHAIN_ID},
            "provenance": (await _provenance_block(owner)) if owner else {
                "withheld_reason": "no_delivery_history"},
            "budgets": (await _budgets_block(owner)) if owner else {
                "withheld_reason": "no_budgets_opened"},
        },
        "hyperliquid": {"withheld_reason": "no_address_on_page"},
    }


async def resolve(identifier: str) -> dict:
    """Route one identifier to its subject.

    Accepts the two shapes the extension can read out of a URL: a 0x address,
    and an agent key of the form a:<chain slug>:<token id>.
    """
    ident = (identifier or "").strip()
    if ADDRESS_RE.match(ident):
        return await by_address(ident)
    m = AGENT_RE.match(ident)
    if m:
        return await by_agent(m.group(1), m.group(2))
    return {
        "identifier": ident,
        "subjects": [],
        "agent": {"withheld_reason": "unreadable_identifier"},
        "hyperliquid": {"withheld_reason": "unreadable_identifier"},
    }
