# coordinator.py
#
# Passes work between agents, holds the shared state, and knows which agent
# is working right now. It is not a stage and produces no result of its own.
#
# WHY A JOB RATHER THAN A FUNCTION CALL
# A run takes real time. Context alone has measured at 74 seconds and a full
# physical run at 111. A synchronous endpoint would leave the caller with a
# spinner and no idea which agent was busy, which is the opposite of what
# the studio is for. So a run is started, given an id, and polled.
#
# Every poll returns the same shape: the agents in this flow, what each is
# doing, how long the working one has been at it, and what handed off to
# what. The visualisation reads that and draws it. It invents nothing: an
# agent is only shown as done when its stage returned, and only shown as
# blocked when a stage said so.
#
# State lives in memory. That is a deliberate limit rather than an
# oversight: a run is watched while it happens and has no value after, the
# backend is restarted often enough that persistence would need a store, and
# a dropped run costs a retry rather than money. Runs are evicted on age so
# a long-lived process does not accumulate them.

from __future__ import annotations

import asyncio
import time
import uuid

from .agents import api_fit as api_fit_agent
from .agents import context as context_agent
from .agents import intent as intent_agent
from .agents import match as match_agent
from .agents import merchant_fit as merchant_fit_agent
from .agents import payment as payment_agent
from .agents import profile as profile_agent
from .agents import qa as qa_agent
from .agents import search as search_agent
from .agents import styling as styling_agent
from .pipeline import _cart_from_state
from .state import StageResult, TaskState, _encode

# Robot states the visualisation draws. Nothing else is ever reported.
IDLE = "idle"
WORKING = "working"
DONE = "done"
BLOCKED = "blocked"
ASLEEP = "asleep"

FLOW_PHYSICAL = "physical"
FLOW_API = "api"

# Runs older than this are dropped. Long enough to finish and be read, short
# enough that a busy process does not hold them forever.
RUN_TTL_SECONDS = 30 * 60

_RUNS: dict[str, dict] = {}


def _agent(key, label, blurb, sprite, accent, prop):
    return {
        "key": key, "label": label, "blurb": blurb,
        "sprite": sprite, "accent": accent, "prop": prop,
    }


# The sprites are the Home page characters, so the studio looks like the
# same product. Colour and prop separate agents that share a sprite.
PHYSICAL_AGENTS = [
    _agent("profile", "Profile", "Collects size, budget, taste and where you are", "center", "#6366F1", "user"),
    _agent("context", "Context", "Occasion, season and destination", "teal", "#14B8A6", "calendar"),
    _agent("merchant_fit", "Merchant Fit", "Which shops can actually serve you", "gold", "#F59E0B", "globe"),
    _agent("search", "Search", "Reads the product links you gave", "orange", "#F97316", "search"),
    _agent("styling", "Styling", "Builds a set inside your budget", "purple", "#A855F7", "sparkles"),
    _agent("qa", "QA", "Looks for reasons to reject the cart", "top", "#EF4444", "shield"),
    _agent("payment", "Payment", "Physical checkout goes through a card partner", "small", "#64748B", "card"),
]

API_AGENTS = [
    _agent("intent", "Intent", "Works out what you are trying to do", "center", "#6366F1", "target"),
    _agent("api_fit", "API Fit", "Searches the B402 directory on BNB Chain", "gold", "#F59E0B", "plug"),
    _agent("match", "Match", "Compares price, terms and fit, then picks", "purple", "#A855F7", "scale"),
    _agent("qa", "QA", "Checks the price and terms before paying", "top", "#EF4444", "shield"),
    _agent("payment", "Payment", "Settles in $U on BNB Chain over B402", "small", "#10B981", "card"),
]

FLOWS = {
    FLOW_PHYSICAL: {
        "label": "Physical goods",
        "agents": PHYSICAL_AGENTS,
        # Payment never runs here. It is drawn dozing with a note, because
        # physical checkout needs a card partner that is not connected.
        "asleep": {"payment": "Physical checkout goes through a card partner. Not connected yet, so the finished cart is handed to you with a link for each item."},
    },
    FLOW_API: {
        "label": "API and services",
        "agents": API_AGENTS,
        "asleep": {},
    },
}


def flow_spec(flow: str) -> dict:
    spec = FLOWS.get(flow)
    if not spec:
        raise ValueError(f"unknown flow {flow!r}")
    return spec


def _new_run(flow: str, request: str) -> dict:
    spec = flow_spec(flow)
    asleep = spec["asleep"]
    return {
        "run_id": uuid.uuid4().hex[:16],
        "flow": flow,
        "request": request,
        "created_at": time.time(),
        "finished_at": None,
        "current": None,
        "handoff": None,
        "agents": {
            a["key"]: {
                "state": ASLEEP if a["key"] in asleep else IDLE,
                "note": asleep.get(a["key"], ""),
                "started_at": None,
                "ended_at": None,
            }
            for a in spec["agents"]
        },
        "stages": [],
        "questions": [],
        "result": None,
        "error": None,
    }


def _record(run: dict, key: str, result: StageResult) -> None:
    slot = run["agents"][key]
    slot["ended_at"] = time.time()
    slot["state"] = DONE if result.ok else BLOCKED
    slot["note"] = result.note[:300]
    run["stages"].append(result.to_dict())


async def _run_stage(run: dict, key: str, coro_factory) -> StageResult:
    slot = run["agents"][key]
    slot["state"] = WORKING
    slot["started_at"] = time.time()
    run["current"] = key
    try:
        result = await coro_factory()
    except Exception as e:
        result = StageResult(
            stage=key, status="error", data={},
            note=f"{type(e).__name__}: {str(e)[:200]}",
        )
    _record(run, key, result)
    return result


def _handoff(run: dict, frm: str, to: str, label: str) -> None:
    """What travels between two robots. The visualisation draws this."""
    run["handoff"] = {"from": frm, "to": to, "label": label, "at": time.time()}


async def _physical(run: dict, state: TaskState) -> None:
    steps = [
        ("profile", lambda: profile_agent.run(state), "size, budget, where you are"),
        ("context", lambda: context_agent.run(state), "occasion and season"),
        ("merchant_fit", lambda: merchant_fit_agent.run(state), "shops that can serve you"),
        ("search", lambda: search_agent.run(state), "priced candidates"),
        ("styling", lambda: styling_agent.run(state), "a set inside budget"),
    ]
    previous = None
    for key, factory, carries in steps:
        if previous:
            _handoff(run, previous, key, carries)
        result = await _run_stage(run, key, factory)
        if not result.ok:
            run["error"] = f"Stopped at {key}."
            return
        previous = key

    _handoff(run, "styling", "qa", "the cart")
    cart = _cart_from_state(state)
    qa_result = await _run_stage(run, "qa", lambda: qa_agent.run(state, cart, check_links=True))
    if not qa_result.ok or state.findings:
        run["error"] = f"QA raised {len(state.findings)} finding(s). Nothing was charged."
        return

    # Payment stays asleep. The cart is handed to the person instead.
    run["result"] = {
        "kind": "cart",
        "lines": [
            {"title": ln.title, "url": ln.url, "price": ln.price.to_dict(), "size": ln.size}
            for ln in cart.lines
        ],
        "total": cart.total().to_dict(),
    }


async def _api(run: dict, state: TaskState) -> None:
    steps = [
        ("intent", lambda: intent_agent.run(state), "what you need"),
        ("api_fit", lambda: api_fit_agent.run(state), "matching services"),
        ("match", lambda: match_agent.run(state), "the chosen service"),
    ]
    previous = None
    for key, factory, carries in steps:
        if previous:
            _handoff(run, previous, key, carries)
        result = await _run_stage(run, key, factory)
        if not result.ok:
            run["error"] = f"Stopped at {key}."
            return
        previous = key

    _handoff(run, "match", "qa", "price and terms")
    cart = _cart_from_state(state)
    qa_result = await _run_stage(run, "qa", lambda: qa_agent.run(state, cart, check_links=False))
    if not qa_result.ok or state.findings:
        run["error"] = f"QA raised {len(state.findings)} finding(s). Nothing was charged."
        return

    _handoff(run, "qa", "payment", "an approved purchase")
    # Payment reports which rail would settle. It does not sign: the
    # signature comes from the buyer's wallet on the Pay.B402 surface, and
    # this backend holds no key.
    pay_result = await _run_stage(run, "payment", lambda: payment_agent.run(state, cart))
    run["result"] = {
        "kind": "service",
        "selection": _encode(state.selection),
        "payment": _encode(state.payment),
        "settled": pay_result.ok and (state.payment or {}).get("status") == "settled",
    }


async def _drive(run: dict) -> None:
    state = TaskState(request=run["request"])
    for key, value in (run.get("seed") or {}).items():
        if key == "profile":
            state.profile.update(value)
        elif key == "context":
            state.context.update(value)
    try:
        if run["flow"] == FLOW_PHYSICAL:
            await _physical(run, state)
        else:
            await _api(run, state)
    except Exception as e:
        run["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    finally:
        run["current"] = None
        run["finished_at"] = time.time()
        run["questions"] = [
            q for q in (state.profile.get("questions") or [])
            + ((state.context.get("intent") or {}).get("questions") or [])
            if isinstance(q, str)
        ]
        for slot in run["agents"].values():
            if slot["state"] == WORKING:
                slot["state"] = BLOCKED


def _evict() -> None:
    cutoff = time.time() - RUN_TTL_SECONDS
    for rid in [r for r, v in _RUNS.items() if v["created_at"] < cutoff]:
        _RUNS.pop(rid, None)


def start(flow: str, request: str, seed: dict | None = None) -> dict:
    _evict()
    run = _new_run(flow, request)
    run["seed"] = seed or {}
    _RUNS[run["run_id"]] = run
    # Fire and forget. The caller polls; nothing awaits this.
    asyncio.create_task(_drive(run))
    return public_view(run)


def get(run_id: str) -> dict | None:
    run = _RUNS.get(run_id)
    return public_view(run) if run else None


def public_view(run: dict) -> dict:
    now = time.time()
    current = run.get("current")
    elapsed = None
    if current:
        started = run["agents"][current].get("started_at")
        if started:
            elapsed = round(now - started, 1)
    return {
        "run_id": run["run_id"],
        "flow": run["flow"],
        "agents": flow_spec(run["flow"])["agents"],
        "state": run["agents"],
        "current": current,
        "current_elapsed_s": elapsed,
        "handoff": run["handoff"],
        "stages": run["stages"],
        "questions": run["questions"],
        "result": run["result"],
        "error": run["error"],
        "finished": run["finished_at"] is not None,
        "total_elapsed_s": round((run["finished_at"] or now) - run["created_at"], 1),
    }
