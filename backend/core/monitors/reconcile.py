"""
reconcile.py

Does each number this project publishes still match the source it came from.

WHY THIS EXISTS
Three of the defects found on 2026-09-18 were numbers that had quietly stopped
matching their source, and not one of them raised an error. A constant on the
How It Works page said 14,907 agents while the API served 14,911. A health
verdict was fresh in one store and three weeks frozen in another, and the two
disagreed for a third of the agents they shared. A count labelled "all time"
included the same orders more than once because the upstream window overlaps.

Every one of those is the same shape: a figure and its source drifted apart,
nothing threw, and the page kept rendering. Tests do not catch this because the
code is doing exactly what it was written to do. Only a comparison against the
source catches it, and only if something runs that comparison on a schedule.

WHAT A CHECK IS
A check names a published figure, recomputes it from the store or the API it
claims to come from, and returns both numbers with a verdict. It never repairs
anything and never writes to a store it is checking.

THE RULES THIS FILE FOLLOWS
A check that could not run returns `unknown`, never `ok`. "We could not compare"
and "they match" are different answers and collapsing them would make this
monitor worse than useless, because it would report health it did not measure.

Tolerances are stated per check and are part of the finding. A figure that is
allowed to drift 1% says so; one that must match exactly says that instead.

Nothing here imports the function that produces the published number when it
can help it. A check that calls the same code the site calls proves only that
the code agrees with itself, which is what let all three of today's defects
through.
"""

from __future__ import annotations

import re
import time
import pathlib

from core.db import get_db

REPO = pathlib.Path(__file__).resolve().parents[3]

OK = "ok"
DRIFT = "drift"
UNKNOWN = "unknown"


def _result(name, published, measured, verdict, note, tolerance=None) -> dict:
    return {
        "name": name,
        "published": published,
        "measured": measured,
        "verdict": verdict,
        "tolerance": tolerance,
        "note": note,
        "checked_at": time.time(),
    }


def _constant_from_jsx(path: str, name: str):
    """Read a numeric constant out of a frontend file.

    Deliberately reads the SOURCE rather than importing anything: the figure
    being checked is a literal a person typed, and the point of the check is
    that nothing recomputes it.
    """
    try:
        text = (REPO / path).read_text()
    except OSError:
        return None
    m = re.search(rf"^const {re.escape(name)}\s*=\s*'?([0-9.]+)%?'?", text, re.M)
    return m.group(1) if m else None


async def check_agents_listed() -> dict:
    """The headline count on How It Works against the live index."""
    published = _constant_from_jsx("frontend/src/HowItWorksPage.jsx", "AGENTS_LISTED")
    if published is None:
        return _result("agents_listed", None, None, UNKNOWN,
                       "Could not read AGENTS_LISTED from HowItWorksPage.jsx.")
    published = int(published)
    # Asked of the endpoint the page is describing, not reconstructed from the
    # store. Two earlier versions of this check compared against the raw
    # collection (39,650) and against a name-length filter (39,200), and both
    # were measuring a different population from the one a visitor is shown.
    # The grid's own filter is not just a name length, it also applies
    # diversity capping, so reproducing it here would be a second copy of a
    # rule that is allowed to change. The served total is the source.
    import urllib.request
    import json as _json
    try:
        req = urllib.request.Request(
            "https://agents-marketplace-q3k4.onrender.com/api/agents/facets",
            headers={"user-agent": "TnegaMonitor/1.0"})
        with urllib.request.urlopen(req, timeout=120) as r:
            measured = int(_json.loads(r.read())["total"])
    except Exception as e:  # noqa: BLE001
        return _result("agents_listed", published, None, UNKNOWN,
                       f"Could not reach the facets endpoint: {type(e).__name__}. "
                       "A figure that could not be compared is not a figure that "
                       "matched.")
    drift = abs(measured - published) / max(published, 1)
    return _result(
        "agents_listed", published, measured,
        OK if drift <= 0.005 else DRIFT,
        "AGENTS_LISTED is a literal in HowItWorksPage.jsx with no refresh "
        "behind it, compared against the total the grid actually serves.",
        tolerance="0.5%")


async def check_verified_share() -> dict:
    """VERIFIED_SHARE is a string literal, not a computation.

    The comment above it says the share is computed from the other two "so they
    cannot drift apart". It is not. This check does what that comment claims.
    """
    listed = _constant_from_jsx("frontend/src/HowItWorksPage.jsx", "AGENTS_LISTED")
    verified = _constant_from_jsx("frontend/src/HowItWorksPage.jsx", "AGENTS_VERIFIED")
    share = _constant_from_jsx("frontend/src/HowItWorksPage.jsx", "VERIFIED_SHARE")
    if not all((listed, verified, share)):
        return _result("verified_share", share, None, UNKNOWN,
                       "Could not read all three constants.")
    computed = round(int(verified) / int(listed) * 100, 1)
    published = float(share)
    return _result(
        "verified_share", f"{published}%", f"{computed}%",
        OK if abs(computed - published) <= 0.05 else DRIFT,
        "VERIFIED_SHARE is a hardcoded string. Its own comment claims it is "
        "derived from the other two constants so they cannot drift apart, "
        "which is the check this performs instead.",
        tolerance="0.05 percentage points")


async def check_health_store_agreement() -> dict:
    """The same agent's service_status in two stores.

    known_agents is refreshed on a TTL; full_agent_registry writes a verdict
    once and, for `responding`, never re-queues it. The site reads the first
    and the Chrome extension reads the second, so a disagreement is two
    surfaces telling a reader different things about one agent.
    """
    from core.full_registry_ingest import FULL_REGISTRY_COLLECTION
    db = get_db()
    fresh = {}
    async for d in db.known_agents.find(
            {"service_status": {"$ne": None}},
            {"token_id": 1, "service_status": 1}).limit(5000):
        fresh[str(d.get("token_id"))] = d.get("service_status")
    if not fresh:
        return _result("health_store_agreement", None, None, UNKNOWN,
                       "No health verdicts in known_agents to compare.")
    pairs = disagree = 0
    async for d in db[FULL_REGISTRY_COLLECTION].find(
            {"chain_id": 56, "service_status": {"$ne": None}},
            {"token_id": 1, "service_status": 1}).limit(80000):
        k = str(d.get("token_id"))
        if k in fresh:
            pairs += 1
            if fresh[k] != d.get("service_status"):
                disagree += 1
    if not pairs:
        return _result("health_store_agreement", None, None, UNKNOWN,
                       "No agents present in both stores with a verdict.")
    rate = disagree / pairs
    return _result(
        "health_store_agreement", "the two stores agree",
        f"{disagree} of {pairs} disagree ({rate:.1%})",
        OK if rate <= 0.05 else DRIFT,
        "The site reads known_agents and the Chrome extension reads "
        "full_agent_registry. Every disagreement is one agent described two "
        "ways depending on which surface a reader is on.",
        tolerance="5%")


def check_orders_observed_overlap() -> dict:
    """How much of the 'all time' order count is the same orders twice.

    Hyperliquid's historicalOrders returns a rolling 2,000-record window that
    ignores any date range. When an address is quiet the window barely moves,
    so consecutive polls return overlapping records and each poll stores them
    again. A negative gap between one poll's window and the next is the
    signature.
    """
    from core.hyperliquid import service
    try:
        with service._conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT coalesce(sum(n), 0) FROM hl_order_counts")
            total = int(cur.fetchone()[0])
            cur.execute("""
                SELECT coalesce(sum(c.n), 0)
                FROM hl_order_counts c
                JOIN hl_poll p ON p.poll_id = c.poll_id
                WHERE p.gap_seconds < 0
            """)
            overlapped = int(cur.fetchone()[0])
    except Exception as e:  # noqa: BLE001
        return _result("orders_observed_overlap", None, None, UNKNOWN,
                       f"Could not reach the Hyperliquid store: {type(e).__name__}")
    if not total:
        return _result("orders_observed_overlap", None, None, UNKNOWN,
                       "No orders stored yet.")
    rate = overlapped / total
    return _result(
        "orders_observed_overlap", f"{total:,} orders, labelled all time",
        f"{overlapped:,} of them ({rate:.1%}) came from polls whose window "
        f"overlapped the previous one",
        OK if rate <= 0.05 else DRIFT,
        "The collector's own docstring says this figure is not fine for counts "
        "and nothing should be presented as a total. The tab presents it as a "
        "total. Rates are not affected, because numerator and denominator "
        "inflate together; the effective sample size is.",
        tolerance="5%")


def check_rest_hours_covered() -> dict:
    """hours_covered is a wall-clock span, not time actually collected.

    ws_coverage() already fixed this for the WebSocket feed and returns both
    hours_covered and hours_span. The REST path never got the same treatment.
    """
    from core.hyperliquid import service
    try:
        with service._conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT min(polled_at), max(polled_at) FROM hl_poll")
            lo, hi = cur.fetchone()
            # Floor division, not `/`. In CockroachDB `::int / 15` is DECIMAL
            # division, so every poll produced its own distinct slot and this
            # check reported 580 hours of collection inside an 81 hour span.
            # The monitor caught its own defect by producing an impossible
            # number, which is the behaviour to preserve: a check that cannot
            # be wrong out loud is not worth running.
            cur.execute("""
                SELECT count(*) FROM (
                  SELECT DISTINCT date_trunc('hour', polled_at)
                         + (extract(minute FROM polled_at)::int // 15) * interval '15 minutes'
                  FROM hl_poll) s
            """)
            slots = int(cur.fetchone()[0])
    except Exception as e:  # noqa: BLE001
        return _result("rest_hours_covered", None, None, UNKNOWN,
                       f"Could not reach the Hyperliquid store: {type(e).__name__}")
    if not lo or not hi:
        return _result("rest_hours_covered", None, None, UNKNOWN, "No polls stored.")
    span = (hi - lo).total_seconds() / 3600
    collected = slots * 15 / 60
    drift = (span - collected) / max(span, 1e-9)
    return _result(
        "rest_hours_covered", f"{span:.2f} hours of span",
        f"{collected:.2f} hours with a poll in them",
        OK if drift <= 0.05 else DRIFT,
        "coverage() publishes the span as hours_covered. Dead stretches inside "
        "it are counted as observation. ws_coverage() reports both numbers and "
        "the REST path reports one.",
        tolerance="5%")


async def run_all() -> dict:
    """Every check, with the ones that could not run named rather than dropped."""
    import asyncio
    checks = []
    for fn in (check_agents_listed, check_verified_share,
               check_health_store_agreement):
        try:
            checks.append(await fn())
        except Exception as e:  # noqa: BLE001
            checks.append(_result(fn.__name__, None, None, UNKNOWN,
                                  f"Check raised {type(e).__name__}: {e}"))
    for fn in (check_orders_observed_overlap, check_rest_hours_covered):
        try:
            checks.append(await asyncio.to_thread(fn))
        except Exception as e:  # noqa: BLE001
            checks.append(_result(fn.__name__, None, None, UNKNOWN,
                                  f"Check raised {type(e).__name__}: {e}"))

    counts = {OK: 0, DRIFT: 0, UNKNOWN: 0}
    for c in checks:
        counts[c["verdict"]] = counts.get(c["verdict"], 0) + 1
    return {
        "checked_at": time.time(),
        "summary": counts,
        # Never "all clear" when something could not be checked. An unknown is
        # an unmeasured figure, not a passing one.
        "clear": counts[DRIFT] == 0 and counts[UNKNOWN] == 0,
        "checks": checks,
    }
