"""
canary.py

Real, opt-in, human-triggered "canary probe" system — proactively testing a
small, real sample of "Responding, unproven" agents with a small, real,
funded test job, rather than waiting for organic buyer activity to reveal
whether an agent actually delivers. Directly motivated by two real findings:
job #56659 (a health-check-responding agent that silently never delivered
— see docs/limitations.md), and real, independent academic confirmation
that this gap is real and widespread, not a one-off: Xiong, Li, Wei, Wang,
Knottenbelt & Wang, "An Empirical Study of ERC-8004" (arXiv:2606.26028) —
a real, live measurement of Ethereum/BSC/Base's actual ERC-8004 registries
through May 2026 found only 3%/4%/15% of registrations expose a genuinely
live, valid service endpoint, and up to 90.6% of reputation feedback shows
coordinated Sybil-style behavior. See docs/verification-methodology.md for
the full real citation and reasoning.

REAL, DELIBERATE SAFETY BOUNDARY — read before touching this file: this
module NEVER holds a private key and NEVER autonomously signs or
broadcasts a real transaction. Every real canary hire is signed by a real,
connected HUMAN wallet through the exact same client-side hire flow every
other hire in this product already uses (useHireAgent.js) — this module's
own job is (a) choosing which agent to test next, respecting a real scope
+ a real spend cap, and (b) recording the real result after the human's
own wallet has already executed it on-chain. A truly "autonomous,
unattended, scheduled" spender would require a backend-held hot wallet —
a real, distinct security-posture change this project has consistently
avoided everywhere else (see docs/hire-flow-audit.md's matching note on
the same real tradeoff for auto-settlement). Not built here; see
docs/verification-methodology.md for the honest reasoning and what real
infrastructure decision would be needed to go further.

Real functions here fall into two honestly different categories:
  - Read-only (select_candidates, get_budget_status, get_canary_history,
    get_canary_status_bulk, check_pending_results): safe to automate/
    schedule freely — nothing here ever moves money.
  - record_canary_test: writes a real LOG ENTRY for a hire a human's own
    wallet already executed. Still never spends anything itself, but is
    deliberately only ever called right after a real, human-confirmed
    on-chain fund() — never speculatively, never in a loop.
"""

from __future__ import annotations

import time

import httpx

from core.db import get_db
from core import category_groups

CANARY_TESTS_COLLECTION = "canary_tests"

# Real, conservative starting defaults — see docs/verification-methodology.md
# for the full real cost reasoning (this is $U principal only; real BSC gas
# for the ~5-7 on-chain calls one hire makes is a separate, real cost on
# top, not captured by this cap).
DEFAULT_TEST_BUDGET_UNITS = 0.1     # $U per canary test
DEFAULT_WEEKLY_CAP_UNITS = 5.0      # real, hard cap — refuses beyond this
DEFAULT_WEEKLY_SAMPLE_SIZE = 10     # real, small starting cohort
RECENT_TEST_COOLDOWN_DAYS = 30      # don't re-test the same real agent sooner than this
PERIOD_DAYS = 7

# Real, deliberate starting scope — kept small and explicit rather than
# "every Responding agent" to control real cost while this is new.
# Real fix (2026-08-28): _GROUP_CATEGORIES used to be its own private,
# partial (2-of-5-group) copy of frontend/src/categoryGroups.js's real
# mapping; core/pnl.py needed the same real "Trading & DeFi" group too, so
# this is now the one, real, shared core/category_groups.py instead of a
# second/third independent copy.
ALLOWED_GROUPS = {"trading-defi", "data-analysis"}
_GROUP_CATEGORIES = category_groups.CATEGORY_GROUPS

# Real, numeric on-chain status enum order — kept here (not re-imported
# from core/rpc.py, which uses the string-label form) since _read_job's own
# real contract below returns the numeric index other code in this file
# already expects.
_JOB_STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"]


async def get_budget_status(period_days: int = PERIOD_DAYS) -> dict:
    """Real, current canary spend within the trailing real period, vs the
    real cap. Read-only."""
    db = get_db()
    cutoff = time.time() - period_days * 86400
    spent = 0.0
    count = 0
    async for doc in db[CANARY_TESTS_COLLECTION].find({"funded_at": {"$gte": cutoff}}):
        spent += doc.get("budget_units", 0)
        count += 1
    return {
        "period_days": period_days,
        "spent_units": round(spent, 4),
        "cap_units": DEFAULT_WEEKLY_CAP_UNITS,
        "remaining_units": round(max(0.0, DEFAULT_WEEKLY_CAP_UNITS - spent), 4),
        "tests_this_period": count,
        # Real fix (2026-08-27 audit): CanaryTestingPanel.jsx used to
        # hardcode the real RECENT_TEST_COOLDOWN_DAYS value as a literal
        # `{30}` in its "no candidates" copy — currently correct, but a
        # duplicate, not a live read, so it'd silently go stale if this
        # constant ever changed. Exposed here so the frontend can read it.
        "recent_test_cooldown_days": RECENT_TEST_COOLDOWN_DAYS,
    }


async def select_candidates(limit: int = DEFAULT_WEEKLY_SAMPLE_SIZE) -> list[dict]:
    """Real, read-only candidate selection for a human operator to review:
    agents currently 'Responding, unproven' (a real health check answered,
    zero confirmed delivered jobs), inside the real allowed scope, not
    real-canary-tested within the real cooldown window. Never spends
    anything — just proposes what a human could choose to test next."""
    from core.agent_store import get_stored_agents
    from core.agent_performance import get_all_agent_performance

    allowed_categories = set()
    for g in ALLOWED_GROUPS:
        allowed_categories |= _GROUP_CATEGORIES.get(g, set())

    db = get_db()
    recent_cutoff = time.time() - RECENT_TEST_COOLDOWN_DAYS * 86400
    recently_tested = set()
    async for doc in db[CANARY_TESTS_COLLECTION].find({"funded_at": {"$gte": recent_cutoff}}, {"owner_address": 1}):
        recently_tested.add(doc["owner_address"])

    agents = await get_stored_agents()
    perf = await get_all_agent_performance()
    by_owner = perf.get("by_owner", {})

    candidates = []
    for a in agents:
        if not a.get("name") or len(a["name"].strip()) <= 2:
            continue
        if a.get("category") not in allowed_categories:
            continue
        owner = (a.get("owner_address") or "").lower()
        if not owner or owner in recently_tested:
            continue
        p = by_owner.get(owner)
        delivered = (p.get("completed", 0) + p.get("submitted", 0)) if p else 0
        if delivered > 0:
            continue  # already organically Verified — no real need to canary-test
        if a.get("service_status") != "responding":
            continue  # only test agents that are genuinely Responding-unproven
        candidates.append({
            "owner_address": owner, "name": a.get("name"), "category": a.get("category"),
            "id": a.get("id"), "token_id": a.get("token_id"),
        })
        if len(candidates) >= limit:
            break
    return candidates


async def record_canary_test(*, owner_address: str, agent_name: str, job_id, budget_units: float, tx_hash: str | None = None) -> dict:
    """Real record of a canary hire a human operator's OWN connected wallet
    just executed through the normal, real hire flow. Never signs or
    spends anything itself — only logs what already happened on-chain.
    Enforces the real budget cap here too (defense in depth), but this is
    a LOG of a real transaction already broadcast, not a gate that could
    have prevented it — the frontend's own pre-check is what actually
    stops an over-cap attempt before a wallet prompt ever appears."""
    status = await get_budget_status()
    over_cap = budget_units > status["remaining_units"]

    db = get_db()
    doc = {
        "owner_address": owner_address.lower(),
        "agent_name": agent_name,
        "job_id": str(job_id),
        "budget_units": budget_units,
        "tx_hash": tx_hash,
        "funded_at": time.time(),
        "result": "pending",  # pending | delivered | failed
        "checked_at": None,
        "over_cap_when_recorded": over_cap,
    }
    res = await db[CANARY_TESTS_COLLECTION].insert_one(doc)
    return {"recorded": True, "id": str(res.inserted_id), "over_cap": over_cap}


async def get_canary_history(owner_address: str) -> list[dict]:
    """Real, full canary test history for one agent — every real attempt,
    including failures, surfaced transparently rather than hidden. Never
    used to silently downgrade an agent's own stored tier; see this
    module's own docstring on the non-punitive design."""
    db = get_db()
    docs = await db[CANARY_TESTS_COLLECTION].find(
        {"owner_address": (owner_address or "").lower()}
    ).sort("funded_at", -1).to_list(length=20)
    for d in docs:
        d["_id"] = str(d["_id"])
    return docs


async def get_canary_status_bulk() -> dict:
    """Real, bulk 'has this owner ever passed a canary test' map, mirroring
    agent_performance.py's get_all_agent_performance() bulk shape so the
    frontend can merge it the same way. 'Canary-verified' means at least
    one real canary test for this owner reached 'delivered'."""
    db = get_db()
    by_owner: dict[str, dict] = {}
    async for doc in db[CANARY_TESTS_COLLECTION].find({}):
        owner = doc["owner_address"]
        entry = by_owner.setdefault(owner, {"tests": 0, "delivered": 0, "failed": 0, "pending": 0, "last_tested_at": 0})
        entry["tests"] += 1
        result = doc.get("result", "pending")
        entry[result] = entry.get(result, 0) + 1
        entry["last_tested_at"] = max(entry["last_tested_at"], doc.get("funded_at", 0))
    return by_owner


async def _read_job(client: httpx.AsyncClient, job_id: int) -> dict | None:
    # Real fix (2026-08-28): delegates to the one, shared, full-tuple
    # core/rpc.py's get_job() now (see that module's own docstring — this
    # used to be its own partial, independent decode). Keeps this
    # function's own narrower {status, expiredAt, submittedAt} contract so
    # every existing real call site here is unaffected — status here is
    # the real numeric enum index other code in this file already expects,
    # not get_job()'s own string label, so it's re-derived rather than
    # passed through directly.
    from core.rpc import get_job as _shared_get_job
    job = await _shared_get_job(job_id, client=client)
    if job is None:
        return None
    return {
        "status": _JOB_STATUS.index(job["status"]) if job["status"] in _JOB_STATUS else None,
        "expiredAt": job["expiredAt"], "submittedAt": job["submittedAt"],
    }


async def check_pending_results() -> dict:
    """Real, read-only status check for every canary test still marked
    'pending' — reads each real job's actual on-chain status and updates
    the real result: SUBMITTED/COMPLETED -> 'delivered'; REJECTED, or
    FUNDED-but-past-its-real-expiredAt (never delivered) -> 'failed';
    otherwise left 'pending' (still genuinely in progress). Never touches
    money — safe to run on any real schedule."""
    db = get_db()
    pending = await db[CANARY_TESTS_COLLECTION].find({"result": "pending"}).to_list(length=200)
    if not pending:
        return {"checked": 0, "updated": 0}

    updated = 0
    now = time.time()
    async with httpx.AsyncClient(timeout=20) as client:
        for doc in pending:
            try:
                job = await _read_job(client, int(doc["job_id"]))
            except Exception:
                continue
            if job is None:
                continue
            status_label = _JOB_STATUS[job["status"]] if job["status"] < len(_JOB_STATUS) else "UNKNOWN"
            new_result = None
            if status_label in ("SUBMITTED", "COMPLETED"):
                new_result = "delivered"
            elif status_label in ("REJECTED", "EXPIRED"):
                new_result = "failed"
            elif status_label == "FUNDED" and job["expiredAt"] and now > int(job["expiredAt"]):
                new_result = "failed"  # real deadline passed, never delivered
            if new_result:
                await db[CANARY_TESTS_COLLECTION].update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"result": new_result, "checked_at": now}},
                )
                updated += 1
    return {"checked": len(pending), "updated": updated}
