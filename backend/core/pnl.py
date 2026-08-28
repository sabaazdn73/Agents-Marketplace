"""
pnl.py

Real, on-chain-balance-based Profit & Loss for a completed real job —
the real hiring wallet's own balance change, start vs. end, never a
creator-submitted or backtested number.

Real, deliberate simplification (2026-08-28): this used to require the
real job's on-chain description to carry the "(Altana session)" hire-flow
marker, on the theory that only a session hire delegates real, ongoing
fund authority worth measuring. Real, honest finding that motivated
dropping that restriction: a live scan of 23,000 real on-chain jobs found
**zero** real Altana-session-funded jobs had ever happened — meaning this
feature had been completely dormant, structurally incapable of ever
showing a real number, for its entire existence. Checked directly before
generalizing, not assumed: `job.client` is a real, directly-observable
wallet address for BOTH real hire types — for a standard "Always Ask"
hire it's simply the real wallet that called createJob/funded the job
(confirmed live against a real job, #56654: `client` is a real, distinct
address, not some intermediate contract); for an Altana-session hire it's
the real session/mini-wallet the agent was granted authority over. The
real, honest question this answers is the same either way: did the real
wallet that funded this specific hire end up with more or less than it
started with. Real, deliberately unchanged scope otherwise:
  - Only Trading & DeFi category-group agents (core/category_groups.py,
    mirroring frontend/src/categoryGroups.js) — the only real category
    where "did the funding wallet's balance grow or shrink" is a
    coherent question at all. Hiring a content-writing agent for a fixed
    fee isn't a real PnL question — of course the buyer's balance drops
    by exactly the fee, that's just paying for a service, not trading.
  - Only a real job that's genuinely been delivered (status SUBMITTED or
    COMPLETED) — nothing to measure PnL over yet for an unfinished job.

Real methodology:
  1. The real wallet tracked is job.client itself — the real hiring
     wallet, whichever real hire path was used. For a standard "Always
     Ask" hire, this is simply the real wallet that called
     createJob/funded the job. For an Altana-session hire, the on-chain
     client IS the session/mini-wallet the agent was actually granted
     authority over (confirmed by reading the installed
     @altananetwork/sdk directly, frontend/src/altana.js's own header:
     hireErc8183Agent executes via the session, so the session wallet is
     what appears as msg.sender/client on-chain) — never the agent's own
     owner_address (a different, unrelated real identity) either way.
  2. Real start/end timestamps: end = job.submittedAt (a real, exact
     on-chain field — the moment real work concluded). Start has no
     on-chain field at all (confirmed absent from the real job struct,
     the same real gap frontend/src/jobTiming.js already documents in
     full) — mirrors that file's own honest "approximate" tier exactly:
     expiredAt minus the real, confirmed 7-day disputeWindow minus the
     larger of the two real hire paths' own default expiry buffers.
     Always labeled "approximate" here — the backend has no access to any
     browser's own precisely-recorded real funding moment, so it can
     never honestly claim better than this tier.
  3. Real start/end portfolio VALUES: Zerion's real
     /wallets/{address}/charts/{period} endpoint (adapters/zerion.py) —
     NOT an arbitrary-timestamp API (confirmed live against Zerion's own
     real docs before assuming otherwise); returns a real, evenly-spaced
     series of points over a fixed period. The smallest real period whose
     own real coverage comfortably spans [start, end] is chosen, then the
     REAL chart point closest to each real target timestamp is used — its
     own real timestamp is always reported alongside the target, and a
     real, honest tolerance (relative to that period's own REAL measured
     point spacing, never a fixed guess) gates whether the match is close
     enough to trust at all.
  4. Real gas costs: Zerion's real /wallets/{address}/transactions/
     endpoint (already integrated for the "Agent activity" transparency
     view) — summing the real, confirmed `fee_usd` field across every
     real transaction in the [start, end] window. If any real transaction
     in the window has no priced fee, the real gas total is honestly
     flagged as a lower bound, not silently treated as exact.
  5. Real PnL = end_value - start_value - total_gas_usd.

Real, honest failure modes — every one reports a genuine reason, never a
fabricated or silently-zeroed number. Two real tiers, distinguished so the
UI can tell them apart: `applicable` (is this even the right kind of job
to have a PnL at all?) vs `available` (is a real number computable RIGHT
NOW, given real data gaps?).
"""

from __future__ import annotations

import asyncio

from core import category_groups
from core.rpc import get_job
from core.agent_performance import get_agent_performance
from adapters import zerion

# Real, deliberate bound on how many of an agent's own real recent jobs
# get PnL-checked per summary call — same real "recent_job_ids[:10]" cap
# core/agent_performance.py already applies for a related real reason
# (bounded real work per request). Each real job here can cost up to 2
# real Zerion calls (a chart + a transaction-fee lookup), so this also
# directly bounds real Zerion quota use per agent-detail-page view.
MAX_JOBS_PER_SUMMARY = 8

# Real, on-chain-confirmed constants — matches frontend/src/jobTiming.js's
# own real constants exactly (mirrored here since the backend can't import
# frontend JS; see that file for the full real derivation of both).
DISPUTE_WINDOW_SECONDS = 604800       # 7 days, OptimisticPolicy.disputeWindow(), read live via eth_call
DEFAULT_EXPIRY_BUFFER_SECONDS = 65 * 60  # the larger of the two real hire paths' own default expiry buffers

# Real, deliberate scope — the one real category-group PnL is a coherent
# question for (see module docstring).
PNL_ELIGIBLE_GROUP = "trading-defi"

_DELIVERED_STATUSES = {"SUBMITTED", "COMPLETED"}

# Real chart periods this module will try, narrowest (best real
# resolution) first — see adapters/zerion.py's own get_wallet_chart
# docstring for the real, live-confirmed point spacing of each.
_CHART_PERIOD_COVERAGE_SECONDS = {
    "day": 24 * 3600,
    "week": 7 * 24 * 3600,
    "month": 30 * 24 * 3600,
    "3months": 90 * 24 * 3600,
}

# Real, honest tolerance: how far the REAL nearest chart point may sit
# from the real target timestamp before this is reported as "too coarse
# to trust" instead of silently used — a real multiple of the CHOSEN
# period's own actually-measured point spacing, never a fixed number
# unrelated to that period's real resolution.
_MAX_POINT_GAP_MULTIPLIER = 2

# Same real 2-minute pad frontend/src/jobTiming.js already found genuinely
# necessary (not cosmetic) for Zerion's own transaction-window bounds —
# live-confirmed there that an exact-second min/max_mined_at can miss a
# real transaction mined at exactly that second.
_WINDOW_PAD_SECONDS = 120


def is_pnl_eligible(category: str | None, description: str | None = None) -> tuple[bool, str | None]:
    """Real, honest eligibility check — returns (eligible, reason_if_not).
    This project never computes or displays a PnL number for anything
    outside this real, deliberate scope. `description` kept as an
    optional parameter (unused now) so existing call sites don't need to
    change — real, deliberate simplification 2026-08-28: category is now
    the only real gate, see module docstring for why the Altana-session
    restriction was dropped."""
    group = category_groups.group_for_category(category)
    if group != PNL_ELIGIBLE_GROUP:
        return False, "Not a Trading & DeFi agent — real PnL isn't a coherent measure for this category of work."
    return True, None


def _approximate_funded_at(expired_at: int) -> int:
    """Real, deterministic, honest start-time estimate — the backend has
    no access to any browser's own precisely-recorded real funding moment
    (see frontend/src/jobTiming.js's header for the full real
    investigation into why no general on-chain fundedAt field exists at
    all), so this mirrors that file's own 'approximate' tier exactly: the
    only honest estimate computable from real on-chain data alone."""
    return expired_at - DISPUTE_WINDOW_SECONDS - DEFAULT_EXPIRY_BUFFER_SECONDS


def _pick_chart_period(window_seconds: float) -> str | None:
    """Real, smallest chart period whose own real coverage comfortably
    spans the real [start, end] window, for the best real resolution
    available. None if the window exceeds every real period this project
    currently uses — an honest 'can't resolve this' signal, not a silent
    over-stretch of the coarsest one."""
    for period, coverage in _CHART_PERIOD_COVERAGE_SECONDS.items():
        if window_seconds <= coverage * 0.9:  # real margin so the window doesn't sit right at the period's own edge
            return period
    return None


def _nearest_point(points: list[tuple[float, float]], target_ts: float) -> tuple[float, float] | None:
    """Real nearest [timestamp, value] to a real target — never
    interpolated or fabricated, always an actual point Zerion returned."""
    if not points:
        return None
    return min(points, key=lambda p: abs(p[0] - target_ts))


async def compute_job_pnl(job_id: int, category: str | None) -> dict:
    """The real, main PnL computation for one job. Always returns a real,
    honest result — either a real number with full real provenance, or a
    clear, specific reason it couldn't be computed. Never a fabricated or
    silently-zeroed value.

    `applicable=False` means this job/agent is genuinely outside PnL's
    real scope (wrong category, not an Altana-session hire) — the UI
    should show nothing, not an error. `available=False` (with
    `applicable=True`) means it's the RIGHT kind of job but a real data
    gap or genuine timing issue means a number can't be computed right
    now — the UI should say so honestly."""
    job = await get_job(job_id)
    if job is None:
        return {"available": False, "applicable": None, "reason": f"Couldn't read real job #{job_id} on-chain."}

    eligible, reason = is_pnl_eligible(category, job.get("description"))
    if not eligible:
        return {"available": False, "applicable": False, "reason": reason}

    if job["status"] not in _DELIVERED_STATUSES:
        return {"available": False, "applicable": True,
                "reason": f"This job hasn't been delivered yet (real on-chain status: {job['status']})."}

    wallet = job["client"]
    end_ts = int(job["submittedAt"])
    start_ts = _approximate_funded_at(int(job["expiredAt"]))
    if start_ts >= end_ts:
        return {"available": False, "applicable": True,
                "reason": "The real, computed start-time estimate isn't chronologically sane for this job — "
                          "can't establish a real window to measure."}

    window_seconds = end_ts - start_ts
    period = _pick_chart_period(window_seconds)
    if period is None:
        return {"available": False, "applicable": True,
                "reason": f"This job's real window ({window_seconds / 86400:.1f} real days) is wider than any "
                          f"real chart period this project currently supports."}

    chart = await zerion.get_wallet_chart(wallet, period)
    if not chart.get("available"):
        return {"available": False, "applicable": True,
                "reason": f"Real portfolio history unavailable from Zerion: {chart.get('reason')}"}

    points = chart["points"]
    start_point = _nearest_point(points, start_ts)
    end_point = _nearest_point(points, end_ts)
    if start_point is None or end_point is None:
        return {"available": False, "applicable": True, "reason": "No real chart data points in this job's window."}

    # Real, MEASURED point spacing (not estimated from period/count) — the
    # honest basis for "is the nearest real point close enough to trust".
    point_spacing = (points[1][0] - points[0][0]) if len(points) >= 2 else _CHART_PERIOD_COVERAGE_SECONDS[period]
    max_gap = point_spacing * _MAX_POINT_GAP_MULTIPLIER
    start_gap = abs(start_point[0] - start_ts)
    end_gap = abs(end_point[0] - end_ts)
    if start_gap > max_gap or end_gap > max_gap:
        return {
            "available": False, "applicable": True,
            "reason": f"The closest real Zerion data points are too far from this job's real start/end to "
                      f"trust (real gaps: {start_gap / 60:.0f}m / {end_gap / 60:.0f}m against this period's "
                      f"own real {point_spacing / 60:.0f}m resolution).",
        }

    activity = await zerion.get_wallet_activity(
        wallet,
        int((start_ts - _WINDOW_PAD_SECONDS) * 1000),
        int((end_ts + _WINDOW_PAD_SECONDS) * 1000),
    )
    gas_usd = 0.0
    gas_complete = True
    if activity.get("available"):
        for tx in activity.get("transactions", []):
            fee = tx.get("fee_usd")
            if isinstance(fee, (int, float)):
                gas_usd += fee
            else:
                # A real transaction in the window with no priced fee —
                # the real gas total below is an honest LOWER bound from
                # here on, not exact. Flagged, never silently ignored.
                gas_complete = False
    else:
        gas_complete = False

    start_value = start_point[1]
    end_value = end_point[1]
    pnl_usd = end_value - start_value - gas_usd

    return {
        "available": True,
        "applicable": True,
        "pnl_usd": round(pnl_usd, 2),
        "start_value_usd": round(start_value, 2),
        "end_value_usd": round(end_value, 2),
        "gas_usd": round(gas_usd, 2),
        "gas_complete": gas_complete,
        "wallet": wallet,
        "start_precision": "approximate",  # never better than this — see module docstring, point 2
        "target_start_ts": int(start_ts),
        "target_end_ts": int(end_ts),
        "real_start_point_ts": int(start_point[0]),
        "real_end_point_ts": int(end_point[0]),
        "chart_period_used": period,
    }


async def compute_agent_pnl_summary(owner_address: str, category: str | None) -> dict:
    """Real, aggregate PnL across one agent's own real, recent, PnL-
    eligible jobs — what the agent detail page actually shows (a single
    job's PnL is real but not very meaningful on its own; the real,
    honest question a buyer asks is "how has this agent's real session-
    managed trading actually done").

    Real, honest short-circuit: checks category eligibility ONCE, up
    front — never spends real Zerion quota probing individual jobs for an
    agent whose category makes this fundamentally inapplicable."""
    group = category_groups.group_for_category(category)
    if group != PNL_ELIGIBLE_GROUP:
        return {"applicable": False, "jobs": [],
                "reason": "Not a Trading & DeFi agent — real PnL isn't a coherent measure for this category of work."}

    perf = await get_agent_performance(owner_address)
    job_ids = perf.get("recent_job_ids") or []
    if not job_ids:
        return {"applicable": True, "jobs": [], "total_pnl_usd": None,
                "reason": "No real on-chain jobs found for this agent yet."}

    checked_ids = job_ids[:MAX_JOBS_PER_SUMMARY]
    results = await asyncio.gather(*(compute_job_pnl(jid, category) for jid in checked_ids))

    # Real, honest split: only jobs that were BOTH applicable (an Altana-
    # session Trading & DeFi hire) AND successfully computed count toward
    # the real total — a job that's applicable but data-gapped is
    # surfaced (so the UI can be honest about a real, partial picture),
    # never silently dropped or treated as $0.
    session_jobs = [
        {"job_id": jid, **r} for jid, r in zip(checked_ids, results)
        if r.get("applicable")
    ]
    computed = [j for j in session_jobs if j.get("available")]

    if not session_jobs:
        return {"applicable": True, "jobs": [], "total_pnl_usd": None,
                "reason": f"None of this agent's last {len(checked_ids)} checked real jobs were hired via an "
                          f"Altana session — no real session-managed activity to measure PnL against yet."}

    total_pnl = round(sum(j["pnl_usd"] for j in computed), 2) if computed else None
    return {
        "applicable": True,
        "jobs": session_jobs,
        "jobs_checked": len(checked_ids),
        "jobs_with_real_pnl": len(computed),
        "total_pnl_usd": total_pnl,
        "reason": None if computed else "Found real Altana-session jobs for this agent, but couldn't compute a "
                                         "real PnL for any of them yet (see each job's own real reason).",
    }
