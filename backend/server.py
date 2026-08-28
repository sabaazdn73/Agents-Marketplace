"""
server.py

The real backend the frontend talks to. One endpoint for now:
GET /api/agents — real, cross-referenced, honestly-incomplete-where-
it-should-be agent data, no mock arrays.

Run locally: uvicorn server:app --reload --port 8000
"""

import os
import sys
import json
import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Real fix, found while investigating the practice-fork 429 outage below:
# Render's log timestamps for this exact incident (2026-08-25 19:35-19:39)
# showed print() lines that should be seconds apart (the retry loop's own
# 2s/3s/5s/8s/12s/15s/15s/15s backoff) landing within microseconds of each
# other, in clusters, after real multi-second gaps with nothing logged at
# all — the signature of Python's default block-buffered stdout under a
# non-TTY container (stdout isn't a terminal here, so print() doesn't
# flush per line by default; it waits for its internal buffer to fill).
# The retries themselves were firing on schedule the whole time — only the
# LOG LINES describing them were delayed, sometimes by minutes, which
# would have made "monitor real logs afterward to confirm" below
# unreliable. reconfigure(line_buffering=True) makes every print() flush
# immediately, same effect as `PYTHONUNBUFFERED=1` but expressed in code
# (this service's env vars are set directly in Render's dashboard, not
# via a render.yaml this repo controls) so it's covered by a normal commit
# instead of an out-of-band dashboard change.
sys.stdout.reconfigure(line_buffering=True)

from core.aggregate import get_marketplace_agents_as_dicts, get_agents_from_full_registry_as_dicts
from core import agent_builder
from core import agent_store
from core.db import get_db
from core import agent_performance
from core import agent_health
from core import erc8183_negotiate
from core import protocol_compat
from core import deliverable_proxy
from core import status_checks
from adapters import zerion
from adapters import coingecko
from adapters import termix
from core import canary
from core import pnl
from core import onchain_pnl
from core import onchain_history
from core import revenue
from core import full_registry_ingest
from core import full_registry_analysis
from core import job_index
from core import rpc

load_dotenv()

app = FastAPI(title="Tnega API")

# Wide open for local dev, tighten this (specific origins only) before
# any real deployment, per this project's security rules. The API serves
# both GET (agents, performance/history) and POST (build, hire-adjacent
# writes), so cross-origin POST + its OPTIONS preflight must be allowed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


import time
import asyncio

# Real, best-effort keep-alive for the explainer-agent's own Render free-tier
# instance (srv-da2api9t0dsc7392afdg) — added 2026-08-21 after a real,
# confirmed incident: a user's /ping check and a real hire attempt both hit
# the agent mid-idle-spindown-restart (a ~25-40s window where uvicorn isn't
# accepting connections yet), even though nothing had crashed or regressed —
# confirmed via direct Render log inspection (clean, repeating
# shutdown/restart cycles, no OOM/error/rate-limit anywhere). Render's free
# tier scales to zero after ~15 min of no traffic; this loop pings /ping every
# 10 minutes (comfortably under that threshold) so the instance ideally never
# goes idle long enough to spin down during real marketplace usage.
#
# Real removal, 2026-08-26: this briefly also covered anvil-practice-fork
# (Practice Mode's Anvil fork), removed along with the rest of Practice
# Mode — see git history if that's ever needed again.
#
# Honest limitation, stated plainly: THIS backend is also on Render's free
# tier, so this loop only runs while server.py itself happens to be awake —
# it reduces, but cannot fully eliminate, the explainer-agent's cold-start
# window (this server's own traffic pattern keeps it warm far more reliably
# than the explainer-agent's low-traffic norm, but there is no guarantee).
# The already-existing mitigations (agent_health.py's retry-with-backoff,
# and the explainer-agent's own pre-warm-on-startup) remain the real backstop
# for whatever this can't prevent.
_KEEPALIVE_TARGETS: list[tuple[str, str]] = [
    ("explainer-agent", "https://explainer-agent.onrender.com/ping"),
]
_KEEPALIVE_INTERVAL_SECONDS = 10 * 60


async def _keepalive_loop(name: str, url: str):
    path = url.split("://", 1)[-1].split("/", 1)[-1]
    path = "/" + path if not path.startswith("/") else path
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            try:
                resp = await client.get(url)
                print(f"[keepalive] {name} {path} -> {resp.status_code} "
                      f"({resp.elapsed.total_seconds():.2f}s)")
            except Exception as e:
                # Real, expected outcome during an actual cold start (the
                # ping itself is what wakes it up) — not fatal, just logged.
                print(f"[keepalive] {name} {path} failed (likely mid cold-start): {e}")
            await asyncio.sleep(_KEEPALIVE_INTERVAL_SECONDS)


@app.on_event("startup")
async def _start_keepalive_pingers():
    for name, url in _KEEPALIVE_TARGETS:
        asyncio.create_task(_keepalive_loop(name, url))


@app.on_event("startup")
async def _ensure_indexes():
    """Real fix (2026-08-27): known_agents had no index beyond the default
    _id, so agent_store.get_stored_agents()'s real sort-by-total_score ran
    as a COLLSCAN + in-memory SORT (confirmed live via .explain() before
    this fix) — not the dominant real cost at today's ~10,800-agent scale
    (20ms), but a real, growing risk as the collection keeps being upserted
    by every refresh. create_index is idempotent (a no-op if the index
    already exists), so this is safe to run on every boot rather than
    depending on a one-off manual step against this specific real database."""
    try:
        db = get_db()
        await db.known_agents.create_index([("total_score", -1)])
    except Exception as e:
        print(f"[server] Could not ensure known_agents index (non-fatal): {e}")


_cache: dict = {"data": None, "fetched_at": 0}
_CACHE_TTL_SECONDS = 60 * 60  # 60 minutes. A full refresh now paginates deeper
# for real agent diversity (aggregate.py: 20 pages × 100 = 20 real 8004scan
# requests + 1 DefiLlama). Budget math against the free_api tier (30 req/min,
# 1000 req/day): ≤24 refreshes/day × ~21 = ~504 req/day ⇒ well under 1000, with
# headroom for occasional force_refresh + 429 retries. TTL was raised from 30→60
# min precisely because each refresh now costs more requests (see aggregate.py).

_refresh_in_progress = False  # de-dupes concurrent background refreshes


async def _refresh_into_store() -> list[dict]:
    """One real refresh: draws a fresh, diversified sample and UPSERTs it into
    the persistent known_agents store (never deletes), then returns the FULL
    served list read back from the store. The store — not this single fetch —
    is the source of truth, so agents from earlier refreshes never vanish just
    because they weren't in this particular sample.

    Real architecture change (2026-08-28): the raw candidate pool now comes
    from full_agent_registry (core/aggregate.py's get_agents_from_full_registry
    — the background ingestion pipeline's own, much larger, continuously-
    growing dataset — see docs/full-registry-analysis.md) WHEN it has enough
    real data to be a genuine improvement over a live 8004scan fetch, since
    reading already-ingested Mongo data is both faster and draws from a real
    pool orders of magnitude larger than what one live paginated fetch can
    reach. Falls back to the original real live-fetch path
    (get_marketplace_agents_as_dicts) when full_agent_registry isn't ready yet
    — an honest degrade, not a silent regression. Either way, the REST of this
    function (upsert into known_agents, health-check pass, response shape) is
    completely unchanged — this is a real change to WHERE the raw sample comes
    from, not to the serving contract downstream of it.

    Also runs the real service-liveness health-check (core/agent_health.py)
    over the served list, on its own shorter TTL — see that module's own
    docstring for the real investigation behind it (8004scan's API has no
    endpoint field; the real source is the on-chain ERC-8004 tokenURI).
    Deliberately part of THIS same function, not a separate job: the whole
    point (per the real product ask) is that every agent already in the
    store gets checked on an ongoing basis, and any newly-upserted agent
    gets checked automatically on its very first appearance here — no
    separate manual trigger, no second pipeline to keep in sync."""
    api_key = os.environ.get("SCAN_8004_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="SCAN_8004_API_KEY is not set. The /api/v1/agents endpoint "
                   "requires a real key, get one at 8004scan.io/developers.",
        )
    # Real hardening (2026-08-27, agent-count-flicker investigation): this
    # used to treat "returned None" and "threw a real exception" the exact
    # same way — fall back to the small live-fetch path either way. That's
    # correct for the real, legitimate None case (full_agent_registry
    # genuinely doesn't have enough data yet — see that function's own
    # docstring), but was wrong for a genuine transient exception: live-
    # measured, the live-fetch fallback currently returns ~750 real agents
    # vs the full-registry path's ~12,700+ — upserting that MUCH smaller
    # real batch doesn't delete anything from known_agents (upsert_agents
    # never deletes), but it DOES mean the next get_stored_agents() read
    # reflects whatever got touched by that smaller, real but
    # unrepresentative batch, and — confirmed as the real, live root cause
    # of a reported agent-count flicker between ~13,000 and ~1,900 across
    # separate page loads — a transient full-registry failure (the same
    # owner-balance 429 storm fixed in adapters/bsc_balance.py this same
    # session could plausibly cascade into one) meant SOME real refreshes
    # served the small fallback's real numbers instead. Now that
    # full_agent_registry reliably has 60,000+ real BSC docs (function
    # fully implemented, growing, not a bootstrap concern anymore), a
    # genuine exception here doesn't need the same "any real fallback is
    # better than none" reasoning that None-case still deserves — the
    # existing, already-much-larger persistent store is a real, better
    # thing to keep serving than a fresh-but-far-thinner live fetch.
    used_full_registry = True
    try:
        fresh_data = await get_agents_from_full_registry_as_dicts(api_key=api_key)
    except Exception as e:
        print(f"[server] full-registry-backed refresh failed with a real exception "
              f"(not the legitimate 'not enough data yet' case) — keeping the "
              f"existing store as-is rather than falling back to a much smaller "
              f"live fetch: {e}")
        fresh_data = None
        used_full_registry = False

    if fresh_data is None and used_full_registry:
        # The real, legitimate case: full_agent_registry genuinely doesn't
        # have enough data yet (a fresh/bootstrap deployment) — falling
        # back to a real live fetch is still the right, honest degrade here.
        fresh_data = await get_marketplace_agents_as_dicts(api_key=api_key)

    if fresh_data:
        result = await agent_store.upsert_agents(fresh_data)
        print(f"[server] Upserted refresh into known_agents: {result}")
    elif used_full_registry:
        # A successful-but-empty fetch is treated as suspect (transient network
        # hiccup / a failed page mid-pagination): we do NOT upsert nothing, and
        # the persistent store keeps serving its existing agents untouched.
        print("[server] Refresh returned 0 agents — keeping the persistent store as-is.")
    else:
        print("[server] Skipping this refresh cycle after a real exception — "
              "keeping the persistent store as-is; the next scheduled refresh will try again.")

    served = await agent_store.get_stored_agents()

    try:
        health_results = await agent_health.check_agents_health(served)
        if health_results:
            updated = await agent_store.update_agent_health(health_results)
            print(f"[server] Real health-check pass: {len(health_results)} agents "
                  f"checked (TTL-fresh ones skipped), {updated} stored.")
            # Merge the fresh results into what we're about to return so THIS
            # response already reflects them, not just the next refresh.
            for a in served:
                if a.get("id") in health_results:
                    a.update(health_results[a["id"]])
    except Exception as e:
        # Real health-check failure never blocks serving real agent data —
        # agents just keep whatever service_status they already had on
        # record (or the honest "not yet checked" absence of one).
        print(f"[server] Real health-check pass failed: {e}")

    return served


async def _background_refresh():
    """Runs the slow, real, multi-page 8004scan refresh OUTSIDE the request
    path. Whoever's request triggered this already got served instantly from
    the store below; this just updates the in-memory cache (and the
    persistent store) for whoever asks next. De-duped so a burst of stale
    requests doesn't kick off N redundant live refreshes at once."""
    global _refresh_in_progress
    if _refresh_in_progress:
        return
    _refresh_in_progress = True
    try:
        _cache["data"] = await _refresh_into_store()
        _cache["fetched_at"] = time.time()
    except Exception as e:
        # A failed background refresh just leaves the existing cache/store
        # serving as before — nothing user-facing to report, there's no
        # request waiting on this.
        print(f"[server] Background refresh failed: {e}")
    finally:
        _refresh_in_progress = False


@app.get("/api/market/bnb-price")
async def bnb_price():
    """Real, live BNB/USD price from CoinGecko's public endpoint (5-min
    server-side cache) — backs the USD context shown next to every agent's
    owner-wallet BNB balance. {"usd": null} (never a fabricated number) if
    CoinGecko couldn't be reached and no prior real price is cached yet."""
    price = await coingecko.get_bnb_usd_price()
    return {"usd": price}


@app.get("/api/agents")
async def agents(force_refresh: bool = False, background_tasks: BackgroundTasks = None):
    """Serves INSTANTLY from the persistent store/in-memory cache — never
    blocks the response on a live 8004scan fetch. A live refresh (when the
    cache is stale, force_refresh is set, or this is a cold instance with an
    empty in-memory cache but a populated store) is kicked off as a
    background task instead, updating the cache for the next request.

    The one exception is a genuinely empty store (first-ever boot, nothing
    to serve at all) — there we have no choice but to wait for a real fetch,
    since serving an empty list would just be a worse user experience than a
    one-time real wait."""
    now = time.time()
    is_stale = (now - _cache["fetched_at"]) > _CACHE_TTL_SECONDS

    if _cache["data"] is None:
        # Cold in-memory cache (fresh instance boot) — read the persistent
        # store directly. This is a fast, single Mongo query, not a live
        # 8004scan fetch, so it's fine to await inline.
        try:
            _cache["data"] = await agent_store.get_stored_agents()
            _cache["fetched_at"] = now
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Couldn't load agent data right now: {e}")

    if not _cache["data"]:
        # Truly nothing anywhere yet (first-ever boot, empty store) — the
        # only case where we actually wait on a live fetch, since there's
        # nothing honest to serve otherwise.
        try:
            _cache["data"] = await _refresh_into_store()
            _cache["fetched_at"] = time.time()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Couldn't load agent data right now: {e}")
    elif is_stale or force_refresh:
        # We have real data to serve right now — return it immediately and
        # let the live refresh happen silently in the background.
        if background_tasks is not None:
            background_tasks.add_task(_background_refresh)

    now = time.time()
    return {
        "agents": _cache["data"] or [],
        "cached_at": _cache["fetched_at"],
        "cache_age_seconds": int(now - _cache["fetched_at"]),
    }


@app.get("/api/health")
async def health():
    return {"ok": True}


# ── Public status page backing endpoint ──
# Real, live, right-now reachability of every external integration this
# project depends on (see core/status_checks.py for the honesty rules and
# the real per-service checks). No auth — deliberately public so hackathon
# judges (or anyone) can verify these are real, not claimed.
@app.get("/api/status")
async def status():
    return await status_checks.get_status()


# ── Real, scheduler-driven full-registry batch trigger (2026-08-28) ──
# Real, standing gap this closes: core/full_registry_ingest.py and
# core/full_registry_analysis.py are real, bounded, resumable/checkpointed
# batch units (see scripts/full_registry_scan.py) — but had NO scheduler at
# all. Render Cron Jobs are a paid-plan feature, out of scope per this
# project's own standing "no paid/unknown-cost infrastructure without an
# explicit decision" rule (see docs/full-registry-analysis.md), so this
# pipeline only ever advanced when a human ran the script by hand — real,
# confirmed consequence: known_agents/full_agent_registry can go stale for
# days at a time with nobody noticing. Real fix: GitHub Actions offers
# genuinely free scheduled workflows for a public repository (confirmed
# live against this repo's own real visibility via the GitHub API, and
# against GitHub's own current docs — "GitHub Actions usage is free for
# standard GitHub-hosted runners in public repositories", no minute cap at
# all, not the 2,000 min/month private-repo figure) —
# .github/workflows/full-registry-batch.yml calls THIS endpoint on a
# schedule instead.
@app.post("/api/admin/full-registry-batch")
async def full_registry_batch(request: Request, ingest_seconds: float = 20.0, analyze_seconds: float = 15.0):
    """Real, secret-gated trigger for ONE bounded batch of the full-registry
    ingestion + analysis pipeline — the exact same real, resumable units
    scripts/full_registry_scan.py already runs by hand, now callable over
    HTTP.

    Real security (the explicit real requirement this was built against):
    this is the one, deliberate exception to this project's normal "every
    /api/* route is public, no auth" pattern — this route triggers real,
    bounded backend work and real 8004scan API quota use, so leaving it
    open would be a real, exploitable public trigger anyone could hit
    repeatedly to waste resources. Requires a real shared secret in the
    `X-Batch-Secret` header, checked against `BATCH_TRIGGER_SECRET` (an
    env var set only on this backend service and, identically, as a
    GitHub Actions repository secret — never committed, never logged,
    never echoed back in any response). Real, fail-closed default: if
    `BATCH_TRIGGER_SECRET` isn't configured on this service at all, the
    endpoint refuses every call rather than silently running unauthenticated.

    Real, conservative time bounds, each independently capped at 120s as a
    hard ceiling (`ingest_seconds`/`analyze_seconds` let a caller ask for
    less, never more) — but the real, live-measured DEFAULTS (20s/15s) are
    tighter than that ceiling, based on a real, direct finding while
    testing this against the live deployment (2026-08-28): Render's own
    exact request-timeout figure isn't publicly documented, but a real
    call requesting 45s ingest + 30s analyze (75s combined) came back a
    real HTTP 502 at ~75s wall time, while a real call requesting 20s +
    15s completed successfully at ~60-66s wall time (each individual page/
    batch can run a bit past its own requested budget — the loop only
    checks elapsed time between whole pages/batches, never mid-fetch).
    These lower defaults keep real wall time comfortably under the
    observed failure point. Safe either way regardless of exact timing
    because both halves are genuinely checkpointed
    (full_registry_ingest.py's own Mongo-backed progress doc) — a short,
    frequent real batch makes exactly as much real progress as a long one
    over time, just never risks a hung/cutoff request."""
    secret = os.environ.get("BATCH_TRIGGER_SECRET")
    if not secret:
        raise HTTPException(status_code=503, detail="BATCH_TRIGGER_SECRET is not configured on this service.")
    if request.headers.get("X-Batch-Secret") != secret:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Batch-Secret header.")

    api_key = os.environ.get("SCAN_8004_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="SCAN_8004_API_KEY is not set.")

    ingest_result = await full_registry_ingest.run_ingest_batch(api_key, max_seconds=min(ingest_seconds, 120.0))

    analyze_checked = 0
    analyze_done = False
    t0 = time.time()
    analyze_budget = min(analyze_seconds, 120.0)
    while time.time() - t0 < analyze_budget:
        r = await full_registry_analysis.run_analysis_batch(batch_size=300)
        analyze_checked += r["checked"]
        if r.get("done"):
            analyze_done = True
            break

    return {
        "ingest": ingest_result,
        "analysis": {"checked": analyze_checked, "done": analyze_done},
        "triggered_at": time.time(),
    }


# ── Real, scheduler-driven ERC-8183 job-index batch trigger (2026-08-28) ──
# Real, standing gap this closes: core/revenue.py's "Revenue Stream" was
# reusing core/agent_performance.py's WINDOW-bounded (most-recent-1,500)
# job cache, which — live-confirmed — silently excluded ~97% of all real
# job history on the shared AgenticCommerce contract (job_counter 56,665
# vs. WINDOW 1,500). core/job_index.py builds a real, complete, persistent
# index instead (a real, one-time linear backfill plus ongoing bounded
# catch-up), same resumable/checkpointed shape as the full-registry
# pipeline above. Kept as a SEPARATE endpoint/call (not folded into
# /api/admin/full-registry-batch) so each individual HTTP call stays
# safely inside the real, observed ~75s failure zone documented above —
# .github/workflows/full-registry-batch.yml calls this as a second step
# on the same schedule, same shared secret.
@app.post("/api/admin/job-index-batch")
async def job_index_batch(request: Request, index_seconds: float = 20.0, recheck_seconds: float = 10.0):
    """Real, secret-gated trigger for one bounded batch of
    core/job_index.py's real, complete ERC-8183 job index — see that
    module's own docstring for the full real methodology (forward
    backfill + bounded re-check of non-terminal jobs). Same real security
    model as /api/admin/full-registry-batch (shared X-Batch-Secret,
    fail-closed if BATCH_TRIGGER_SECRET isn't configured) — deliberately
    reuses the exact same secret rather than introducing a second one,
    since both routes protect the same real concern (an unauthenticated
    public trigger for real, bounded backend work)."""
    secret = os.environ.get("BATCH_TRIGGER_SECRET")
    if not secret:
        raise HTTPException(status_code=503, detail="BATCH_TRIGGER_SECRET is not configured on this service.")
    if request.headers.get("X-Batch-Secret") != secret:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Batch-Secret header.")

    result = await job_index.run_index_batch(
        max_seconds=min(index_seconds, 120.0), recheck_seconds=min(recheck_seconds, 60.0),
    )
    return {"job_index": result, "triggered_at": time.time()}


# ── Real, independent Live Status reliability pass (2026-08-28) ──
# Real, confirmed gap this closes: the marketplace's own service-health
# check (agent_health.check_agents_health) previously only ran as a side
# effect of _refresh_into_store's own much heavier, real full-registry-
# backed refresh — the exact same real path confirmed this session to
# repeatedly OOM-crash under real memory pressure (see
# core/aggregate.py's own real fix commits). When that heavier refresh
# fails partway through, the health-check pass never runs either that
# cycle, silently letting Live Status go stale for however long the
# crash-loop persists. This endpoint decouples the two: a real, cheap,
# independent pass over the ALREADY-diversified known_agents store
# (agent_store.get_stored_agents() — no 64,000+-doc raw pool involved),
# re-checking only agents whose service_status is stale
# (agent_health.py's own real 20-minute TTL, unchanged — a safe, cheap
# no-op for anything already fresh). Same real security model as the
# sibling batch endpoints (shared X-Batch-Secret).
@app.post("/api/admin/health-check-batch")
async def health_check_batch(request: Request, batch_limit: int = 500):
    secret = os.environ.get("BATCH_TRIGGER_SECRET")
    if not secret:
        raise HTTPException(status_code=503, detail="BATCH_TRIGGER_SECRET is not configured on this service.")
    if request.headers.get("X-Batch-Secret") != secret:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Batch-Secret header.")

    # Real, deliberate bound (found live: check_agents_health is genuinely
    # unbounded without one — a real, large stale share of the store could
    # otherwise try to probe thousands of real endpoints in one call).
    # 500/run at a 20-minute TTL comfortably keeps pace with a
    # ~14,000-agent real store on the same 6-hour schedule as the sibling
    # batch endpoints.
    served = await agent_store.get_stored_agents()
    health_results = await agent_health.check_agents_health(served, limit=min(batch_limit, 1000))
    updated = await agent_store.update_agent_health(health_results) if health_results else 0
    return {
        "candidates": len(served), "real_checks_run": len(health_results), "updated": updated,
        "triggered_at": time.time(),
    }


# ── Real, dedicated Solana ingestion batch (2026-08-28) ──
# Real, urgent correction this closes: earlier assumed Solana "needs its
# own real, separate integration" and scoped it out entirely. Wrong,
# confirmed live — 8004scan's own unified /api/v1/agents endpoint already
# indexes Solana, just needs the real, correct `chain_id=101` param (see
# core/full_registry_ingest.py's own docstring for the full real
# correction). What genuinely IS true: Solana never appears in the shared,
# unfiltered EVM scan the other three chains ride along in for free, so it
# can't just be added to TARGET_CHAIN_IDS — it needs this own real,
# separate, cheap batch endpoint (real total is tiny, ~1,462 agents, vs.
# 787,000+ combined EVM). Stores into the SAME full_agent_registry
# collection as Base/Ethereum (not surfaced on the live BSC-only
# marketplace — see agent_store.py, still BSC-only there), same real
# security model as the sibling batch endpoints.
@app.post("/api/admin/solana-registry-batch")
async def solana_registry_batch(request: Request, ingest_seconds: float = 45.0):
    secret = os.environ.get("BATCH_TRIGGER_SECRET")
    if not secret:
        raise HTTPException(status_code=503, detail="BATCH_TRIGGER_SECRET is not configured on this service.")
    if request.headers.get("X-Batch-Secret") != secret:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Batch-Secret header.")

    api_key = os.environ.get("SCAN_8004_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="SCAN_8004_API_KEY is not set.")

    result = await full_registry_ingest.run_solana_ingest_batch(api_key, max_seconds=min(ingest_seconds, 120.0))
    return {"solana_ingest": result, "triggered_at": time.time()}


# ── Altana Skills Registry proxy ──
# Real bug (2026-08-19): the frontend used to fetch
# raw.githubusercontent.com/altananetwork/skills/main/index.json directly from
# each visitor's own browser. GitHub's raw-content CDN rate-limits by source
# IP, and that limit is SHARED across everyone behind the same IP (VPNs,
# corporate NAT, cloud/CGNAT egress) — so a real visitor could get a real 429
# through no fault of their own, and it's not reproducible from any one
# tester's machine (confirmed live: the exact same URL returned a clean 200
# from here at the time this was fixed). One server-side fetch, cached and
# served to every visitor, fixes this the same way the /api/agents /
# known_agents pattern already does: real data, never re-fetched live in the
# request path once cached.
_skills_cache: dict = {"data": None, "fetched_at": 0}
_SKILLS_CACHE_TTL_SECONDS = 60 * 60  # the real registry changes rarely; matches /api/agents' TTL reasoning
_SKILLS_INDEX_URL = "https://raw.githubusercontent.com/altananetwork/skills/main/index.json"


async def _fetch_skills_registry() -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(_SKILLS_INDEX_URL)
        resp.raise_for_status()
        return resp.json().get("skills", [])


@app.get("/api/skills-registry")
async def skills_registry():
    """Serves the real Altana Skills Registry, proxied and cached server-side
    (see the module comment above for why). Same "always serve fast, refresh
    stale data in the background" shape as /api/agents — a request never
    blocks on a live GitHub fetch once real data exists in the cache."""
    now = time.time()
    is_stale = (now - _skills_cache["fetched_at"]) > _SKILLS_CACHE_TTL_SECONDS

    if _skills_cache["data"] is None:
        try:
            _skills_cache["data"] = await _fetch_skills_registry()
            _skills_cache["fetched_at"] = now
        except Exception as e:
            # Nothing cached yet and the live fetch failed — genuinely nothing
            # honest to serve. The frontend turns this into a friendly retry
            # prompt, not a raw error string.
            raise HTTPException(status_code=502, detail=f"Couldn't reach the skills list right now: {e}")
    elif is_stale:
        try:
            _skills_cache["data"] = await _fetch_skills_registry()
            _skills_cache["fetched_at"] = now
        except Exception as e:
            # Stale-but-real data beats no data — keep serving what we have
            # and try again on the next request past the TTL.
            print(f"[server] Skills registry refresh failed, serving stale cache: {e}")

    return {"skills": _skills_cache["data"] or [], "cache_age_seconds": int(time.time() - _skills_cache["fetched_at"])}


# NOTE: the "Ask our explainer agent" widget + its backing
# /api/explainer-agent/ask endpoint were removed 2026-08-20 — real user
# feedback: paying and waiting up to 10 real minutes just to see a signed
# quote, with no visible answer without payment, was confusing UX, not
# worth keeping as a live site feature. The explainer agent itself is
# untouched: still real, still deployed on Render (BSC mainnet,
# self-hosted, ERC-8004 agent_id 270213), still the real infrastructure
# behind the TermiX Advantage Report's Task 3 (see AdvantageReport.jsx —
# real jobs #56611/#56616/#56620, the last one delivered end-to-end and
# hash-verified). It's just no longer exposed as a site widget.

# NOTE: the old paper-trade feature (Tenderly simulate-and-persist) and its
# later replacement, the Practice Layer (self-hosted Anvil fork,
# POST /api/practice/*), have both been removed — real user decision,
# 2026-08-26: the fork's repeated free-tier infrastructure instability
# risked giving a fake/unreliable impression that outweighed the real
# trust value of a "try before you spend" sandbox. There is no
# simulate-before-hire mechanism on this project anymore.


# ── Hiring an agent (ERC-8183) now happens entirely CLIENT-SIDE ──
# The whole createJob -> registerJob -> setBudget -> approve -> fund
# batch is driven from the browser by the Altana passkey wallet
# (frontend/src/altana.js hireAgentWithSession + useHireAgent.js),
# signed client-side. There is no backend-held key and no /api/hire
# route anymore — the obsolete adapters/erc8183.py path was removed.


# ── Real "build in the browser" pipeline ──
# In-memory status store, fine for a single-instance deployment (this
# project's current scale), each build takes 1-10+ real minutes
# (package install, LLM activation, platform deploy), so the client
# starts a build then polls status rather than waiting on one request.
_build_status: dict = {}


async def _run_build_pipeline(slug: str, description: str):
    """The real, ordered pipeline. Every step's real ok/output is
    recorded, a failure at any step stops the pipeline honestly rather
    than pretending later steps succeeded."""
    def update(step: str, **kwargs):
        _build_status[slug] = {"step": step, **kwargs}

    try:
        update("scaffolding")
        scaffold = await agent_builder.scaffold_agent(description)
        if not scaffold["ok"]:
            update("error", error=f"Scaffold failed: {scaffold['output'][-500:]}")
            return

        update("creating_wallet")
        wallet = await agent_builder.create_wallet(slug)
        if not wallet["ok"]:
            update("error", error=f"Wallet creation failed: {wallet['output'][-500:]}")
            return
        wallet_password = wallet["wallet_password"]

        update("writing_logic")
        logic = agent_builder.write_agent_logic(slug, description)
        if not logic["ok"]:
            update("error", error=f"Writing agent logic failed: {logic.get('error')}")
            return

        update("activating_llm")
        llm = await agent_builder.activate_llm(slug, wallet_password)
        if not llm["ok"]:
            update("error", error=f"LLM activation failed: {llm['output'][-500:]}")
            return

        update("deploying")
        deploy = await agent_builder.deploy_to_platform(slug, wallet_password)
        if not deploy["ok"]:
            update("error", error=f"Deploy failed: {deploy['output'][-800:]}")
            return

        update("done", address=wallet.get("address"), deploy_output=deploy["output"][-800:])
    except Exception as e:
        update("error", error=f"Unexpected pipeline failure: {e}")


@app.post("/api/build")
async def start_build(description: str, background_tasks: BackgroundTasks):
    """Starts the real pipeline, returns immediately with a slug to
    poll. Doesn't block the request on a multi-minute real deploy."""
    if not description or not description.strip():
        raise HTTPException(status_code=400, detail="Please describe what you want your agent to do.")
    slug = agent_builder.slugify(description)
    _build_status[slug] = {"step": "queued"}
    background_tasks.add_task(_run_build_pipeline, slug, description)
    return {"slug": slug}


@app.get("/api/build/{slug}/status")
async def build_status(slug: str):
    """Real, current status of one build, polled by the client."""
    status = _build_status.get(slug)
    if status is None:
        raise HTTPException(status_code=404, detail="Unknown build slug.")
    return status


@app.get("/api/agents/performance")
async def agent_perf(owner_address: str):
    """Real per-agent track record from on-chain ERC-8183 job history (the
    agent's owner as provider). Honest zero-history state when not yet
    hired. Real fix (2026-08-28): now reads core/job_index.py's own
    COMPLETE job index — not core/agent_performance.py's WINDOW-bounded
    (most-recent-1,500) cache — the same real scoping bug already fixed
    for Revenue Stream, found again here while investigating the
    "Verified working" verification tier (this endpoint's own data feeds
    that tier's jobsCompleted/jobsSubmitted). See
    core/job_index.py's own module docstring and
    docs/verification-methodology.md for the full real investigation."""
    try:
        return await job_index.get_provider_stats(owner_address)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Couldn't look up hire history right now: {e}")


@app.get("/api/agents/revenue")
async def agent_revenue(owner_address: str):
    """Real "Revenue Stream" — how much this agent has actually,
    verifiably earned as a real ERC-8183 provider, over time. Real, fixed
    (2026-08-28): now reads core/job_index.py's own COMPLETE, persistent
    job index — not core/agent_performance.py's WINDOW-bounded recent-jobs
    cache /api/agents/performance uses — since a real scoping bug there
    was confirmed to silently exclude ~97% of all real job history (see
    core/revenue.py and core/job_index.py's own module docstrings, and
    docs/verification-methodology.md, for the full real investigation).
    Sums real SUBMITTED/COMPLETED job budgets into a real chronological
    timeline, and reads the real ERC-8183 settlement token's own identity
    live (never hardcoded). Always 200 with a real, honest {"has_earnings":
    ..., "reason": ..., "index_completeness": {...}} shape — never a
    fabricated number, and never implying the underlying index is complete
    when a real backfill is still catching up."""
    try:
        return await revenue.get_revenue_timeline(owner_address)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Couldn't look up real revenue history right now: {e}")


@app.get("/api/agents/performance/bulk")
async def agent_perf_bulk():
    """Real, bulk on-chain track record for every real provider — the real
    data behind the marketplace's "Most hired"/"Highest success rate" sort
    options AND the "Verified working" verification tier (getVerificationTier
    in frontend/src/agentVerification.js, via useAgentPerformanceBulk.js).
    Real fix (2026-08-28): now reads core/job_index.py's own COMPLETE job
    index (a real, one-time linear backfill of every real job id, kept
    current via a bounded re-check pass) instead of
    core/agent_performance.py's WINDOW-bounded (most-recent-1,500) cache —
    confirmed live before fixing that the verification tier was still
    running off the same narrow window already fixed for Revenue Stream.
    The verification bar itself is unchanged: still requires a real
    on-chain SUBMITTED/COMPLETED job, just checked against this agent's
    real, complete history instead of a recent slice of it."""
    try:
        return await job_index.get_all_provider_stats()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Couldn't look up hire history right now: {e}")


@app.get("/api/agents/wallet-portfolio")
async def agent_wallet_portfolio(owner_address: str):
    """Real, OPT-IN wallet portfolio via Zerion (core/adapters/zerion.py) —
    every real token this owner address holds on BSC, with real USD values,
    not just the native BNB balance already shown for free on every agent
    card. Deliberately never called from the bulk marketplace refresh — our
    key's real, measured tier is 300 requests/day (confirmed live via
    response headers, not docs), nowhere near enough for 500+ agents; this
    exists only for a buyer who opens ONE specific agent's detail page and
    asks to see more. Always returns 200 with an honest {"available": false,
    "reason": ...} on any real failure (missing key, rate limited,
    unreachable) rather than a 5xx — this is a nice-to-have enrichment, never
    something that should break the detail page."""
    return await zerion.get_wallet_portfolio(owner_address)


@app.get("/api/agents/activity")
async def agent_activity(owner_address: str, min_mined_at: int, max_mined_at: int):
    """Real, opt-in "what is this agent actually doing" transparency view
    for one job — the agent owner's real on-chain activity (via Zerion,
    core/adapters/zerion.py's get_wallet_activity) scoped to a real time
    window in Unix MILLISECONDS, not the wallet's entire history. See
    JobStatusPanel.jsx for the real UI this backs, and zerion.py's own
    docstring for the real, live-verified filter format (milliseconds, not
    seconds — confirmed against job #56646's real, known submit() tx before
    this shipped).

    Deliberately per-job, opt-in, on request (never called in bulk) — the
    same real rate-budget discipline as /api/agents/wallet-portfolio.
    Always returns 200 with an honest {"available": false, "reason": ...}
    on any real failure or genuine "nothing happened in this window" —
    never a fabricated transaction."""
    return await zerion.get_wallet_activity(owner_address, min_mined_at, max_mined_at)


@app.get("/api/agents/pnl")
async def agent_pnl(job_id: int):
    """Real, on-chain-balance Profit & Loss for one completed real job —
    see core/pnl.py's own module docstring for the full real methodology,
    scope, and honesty tiers. Resolves the job's real provider (on-chain)
    to its real, current category via known_agents (same source the
    Marketplace's own category groups use), then delegates the real
    eligibility/computation to core/pnl.py. Always returns 200 with a
    real, honest {"available": ..., "applicable": ..., "reason": ...}
    shape — never a fabricated number, and 404 only for a job_id that
    genuinely doesn't exist on-chain at all."""
    job = await rpc.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"No real job #{job_id} found on-chain.")
    agent = await agent_store.get_agent_by_owner(job["provider"])
    category = agent.get("category") if agent else None
    return await pnl.compute_job_pnl(job_id, category=category)


@app.get("/api/agents/pnl-summary")
async def agent_pnl_summary(owner_address: str):
    """Real, aggregate on-chain PnL across one agent's own recent,
    PnL-eligible real jobs — see core/pnl.py's own compute_agent_pnl_summary
    docstring for the full real methodology. What the agent detail page
    actually renders (a real, honest picture across an agent's own real
    history, not one arbitrary job). Always 200 with a real, honest
    {"applicable": ..., "jobs": [...], "total_pnl_usd": ..., "reason": ...}
    shape — never a fabricated number."""
    agent = await agent_store.get_agent_by_owner(owner_address)
    category = agent.get("category") if agent else None
    return await pnl.compute_agent_pnl_summary(owner_address, category=category)


@app.get("/api/agents/onchain-performance")
async def agent_onchain_performance(owner_address: str):
    """Real, standalone "Historical on-chain performance" signal — see
    core/onchain_pnl.py's own module docstring for the full real
    methodology. Deliberately INDEPENDENT of /api/agents/pnl-summary
    above: that endpoint only ever looks at real jobs that went through
    Tnega's own Altana-session hire flow; this one looks directly at the
    agent's own real, on-chain execution history (real trades, deposits,
    withdrawals, LP mint/burn, claims) on its own real operating wallet —
    whether or not that activity ever happened through this marketplace.
    Always 200 with a real, honest {"applicable": ..., "has_activity":
    ..., "attribution_confidence": ..., ...} shape — never a fabricated
    number, and never a claim of certainty this project's real data
    can't actually back."""
    agent = await agent_store.get_agent_by_owner(owner_address)
    category = agent.get("category") if agent else None
    token_id = agent.get("token_id") if agent else None
    return await onchain_pnl.get_historical_onchain_performance(owner_address, category=category, token_id=token_id)


@app.get("/api/agents/onchain-history")
async def agent_onchain_history(owner_address: str):
    """Real "Full on-chain history" — every real transaction type this
    agent's developer wallet has genuinely made on BSC (sends, receives,
    approvals, trades, mints, contract calls...), via Zerion — see
    core/onchain_history.py's own module docstring for the full real
    methodology, including why this is built on Zerion rather than
    BscScan (live-confirmed: BSCSCAN_API_KEY's real free tier doesn't
    cover BSC's account/txlist module). Deliberately additional to, never
    a duplicate of, core/onchain_pnl.py (DeFi-execution only) and
    core/job_index.py (ERC-8183 job activity only). Always 200 with a
    real, honest {"available": ..., "has_activity": ..., "has_more": ...}
    shape — never a fabricated transaction, and never implying
    completeness beyond the real, deliberate page budget actually
    fetched."""
    return await onchain_history.get_full_onchain_history(owner_address)


@app.get("/api/canary/candidates")
async def canary_candidates(limit: int = canary.DEFAULT_WEEKLY_SAMPLE_SIZE):
    """Real, read-only candidate list for a human operator to review before
    choosing to canary-test one — see core/canary.py's own docstring for
    the full real selection rule and the real safety boundary (this never
    spends anything; only a human's own connected wallet, clicking through
    the normal hire flow, ever does)."""
    return {"candidates": await canary.select_candidates(limit=limit)}


@app.get("/api/canary/budget-status")
async def canary_budget_status():
    """Real, current canary spend vs the real weekly cap — read-only."""
    return await canary.get_budget_status()


@app.get("/api/canary/status-bulk")
async def canary_status_bulk():
    """Real, bulk canary-verification status for every agent that's ever
    been canary-tested — the real data behind the 'Canary-verified' tier."""
    return {"by_owner": await canary.get_canary_status_bulk()}


@app.get("/api/canary/history")
async def canary_history(owner_address: str):
    """Real, full canary test history for one agent — every real attempt,
    success or failure, surfaced transparently."""
    return {"history": await canary.get_canary_history(owner_address)}


@app.post("/api/canary/record")
async def canary_record(request: Request):
    """Records a real canary hire a human operator's OWN connected wallet
    just executed through the normal, real hire flow (useHireAgent.js) —
    this route never signs or spends anything itself, it only logs a real
    transaction that already happened on-chain. Body: {owner_address,
    agent_name, job_id, budget_units, tx_hash?}."""
    body = await request.json()
    owner_address = body.get("owner_address")
    job_id = body.get("job_id")
    if not owner_address or job_id is None:
        raise HTTPException(status_code=400, detail="owner_address and job_id are required")
    return await canary.record_canary_test(
        owner_address=owner_address,
        agent_name=body.get("agent_name") or "",
        job_id=job_id,
        budget_units=float(body.get("budget_units") or canary.DEFAULT_TEST_BUDGET_UNITS),
        tx_hash=body.get("tx_hash"),
    )


@app.post("/api/canary/check-pending")
async def canary_check_pending():
    """Real, read-only re-check of every still-pending canary test's actual
    on-chain status. Never touches money — safe to call on any real
    schedule (unlike the funding step, which always requires a real,
    connected human wallet)."""
    return await canary.check_pending_results()


@app.get("/api/agents/termix-performance")
async def agent_termix_performance(owner_address: str):
    """Real, independent, protocol-wide track record for one agent, from
    TermiX's own real AACP registry — NOT this marketplace's data. See
    adapters/termix.py's own docstring for the full real investigation
    (including the live, confirmed token-id match this proxy relies on to
    know it found the RIGHT agent, not just a same-named one).

    Real reason this exists (2026-08-28): our own /api/agents/performance
    stat is young and has had real bugs (the notify_funded authorization-
    gate bug) fail real jobs for reasons unrelated to an agent's actual
    quality. This gives the agent detail page ("Past Hires") a second, real,
    less-biased data point to show alongside our own — never blended into
    one number, always honestly labeled and separately sourced.

    Always returns 200 with an honest {"available": false, "reason": ...} on
    any real failure (not on TermiX's registry, network error, malformed
    reply) — this is a supplementary enrichment, never something that should
    break the detail page."""
    agent = await agent_store.get_agent_by_owner(owner_address)
    if not agent:
        return {"available": False, "reason": "no agent on record for this owner address"}
    return await termix.get_termix_stats(agent.get("token_id"), agent.get("name"))


@app.post("/api/agents/negotiate")
async def agent_negotiate(request: Request):
    """Real, server-side proxy for the ERC-8183 A2A `negotiate` skill.

    Real, confirmed reason this exists (2026-08-22): job #56636 was funded
    through the old generic hire flow (a fixed plain-text description, no
    negotiate step) and was PERMANENTLY rejected by the seller's own
    notify_funded — "no signed quote anchored in job description" — traced
    through the real SDK verification logic. Strict ERC-8183 sellers require
    a Schema-v1 JobDescription carrying a negotiation_hash + provider_sig
    THEY signed, which only `negotiate` produces. See core/erc8183_negotiate.py
    for the full investigation (including why this must run server-side: the
    agent's endpoint has no CORS support, confirmed live).

    Body: {"owner_address": "0x...", "task_description": "...", "terms": {...}}.
    Returns the raw negotiation-result envelope on a real accepted quote, or
    a clean {"available": false} the frontend can fall back on — never a
    fabricated/synthesized quote."""
    body = await request.json()
    owner_address = body.get("owner_address")
    task_description = body.get("task_description")
    terms = body.get("terms") or {}
    if not owner_address or not task_description:
        raise HTTPException(status_code=400, detail="owner_address and task_description are required")

    agent = await agent_store.get_agent_by_owner(owner_address)
    service_endpoint = (agent or {}).get("service_endpoint")
    if not service_endpoint:
        return {"available": False, "reason": "no registered service_endpoint on record for this agent"}

    result = await erc8183_negotiate.negotiate(service_endpoint, task_description, terms)
    if result is None:
        return {"available": False, "reason": "agent did not accept a real negotiate call (unsupported, unreachable, or rejected)"}
    return {"available": True, "negotiation_result": result}


@app.post("/api/agents/notify-funded")
async def agent_notify_funded(request: Request):
    """Real, server-side proxy for the ERC-8183 A2A `notify_funded` push.

    Real, confirmed gap (2026-08-24): the hire flow (useHireAgent.js) funds
    a job on-chain but had no way to tell the seller agent to start work — a
    strict seller's own background sweep only runs as a side effect of
    ANOTHER buyer's notify_funded landing first, so a job funded through
    this marketplace could sit forever with no delivery. Confirmed live
    against job #56646 (zero delivery activity in the seller's own logs
    until this call was sent manually). See core/erc8183_negotiate.py's
    notify_funded() for the full trace; same server-side requirement as
    negotiate (the agent's endpoint has no CORS support).

    Body: {"owner_address": "0x...", "job_id": 123, "authorization": {...}?}.
    `authorization` is optional — real, confirmed need (2026-08-24): some
    sellers (e.g. the live stockanalyst-agent) unconditionally require a
    real, EIP-712-signed envelope here (see core/erc8183_negotiate.py's
    notify_funded() docstring for the exact real shape); most don't and
    this is simply omitted/forwarded as None for them. Returns a clean
    {"notified": false} on ANY failure (no endpoint, agent doesn't
    implement notify_funded, timeout, rejection) — the caller must treat
    that as "delivery may be slower, not that funding failed": the job is
    already funded on-chain by the time this is ever called."""
    body = await request.json()
    owner_address = body.get("owner_address")
    job_id = body.get("job_id")
    authorization = body.get("authorization")
    if not owner_address or job_id is None:
        raise HTTPException(status_code=400, detail="owner_address and job_id are required")

    agent = await agent_store.get_agent_by_owner(owner_address)
    service_endpoint = (agent or {}).get("service_endpoint")
    if not service_endpoint:
        return {"notified": False, "reason": "no registered service_endpoint on record for this agent"}

    result = await erc8183_negotiate.notify_funded(service_endpoint, job_id, authorization)
    if result is None:
        return {"notified": False, "reason": "couldn't reach the agent (unsupported skill, unreachable, or a malformed reply)"}
    if result.get("status") != "accepted":
        return {"notified": False, "reason": result.get("reason") or "agent rejected the notification"}
    return {"notified": True}


@app.get("/api/agents/escrow-compatibility")
async def agent_escrow_compatibility(owner_address: str):
    """Real, conservative check: can this agent realistically ever fulfill
    a real, escrowed ERC-8183 job through this marketplace's normal hire
    flow, or is it a real, confirmed class of registered-but-off-chain
    SaaS/business tool (real, confirmed example: "AIDA — AI Medical
    Receptionist", which returns a real HTTP 405 on every real A2A/
    JSON-RPC format tried — it simply doesn't speak the protocol at all)?

    Reuses the exact same real candidate-discovery and multi-format probe
    logic the actual hire flow's negotiate()/notify_funded() calls depend
    on (core/erc8183_negotiate.py's probe_a2a_protocol), combined
    conservatively with supporting-only metadata evidence from the agent's
    own real, submitted description (core/protocol_compat.py). Only ever
    flags `escrow_incompatible: true` on a strong, real, hard
    protocol-level rejection — never on category, reputation, or a
    keyword match alone.

    24h in-process cache (protocol_compat._cache) — this is a real,
    live network probe against the agent's own endpoint, not free, and an
    agent's real protocol support is a structural property that doesn't
    change minute to minute (matches agent_health.py's own caching
    discipline). Always returns 200 with an honest, conservative
    `escrow_incompatible: false` on any missing/unreachable data — this is
    a safety warning surfaced ON TOP of the real hire flow, never something
    that itself blocks the page from loading.

    Real, additive fields (2026-08-28, from a full, ground-up interaction-
    pattern investigation — see docs/agent-interaction-patterns.md):
    `auth_gated` (a real 401/403 — inconclusive, not a hard rejection, but
    real and previously invisible), `different_protocol` (a real, live
    JSON API that just doesn't speak A2A, distinct from a plain website),
    `offers_x402_alternative` (the agent's own description explicitly
    mentions x402 pay-per-call access). None of these change the meaning
    of `escrow_incompatible` itself — existing callers of this endpoint
    are unaffected."""
    agent = await agent_store.get_agent_by_owner(owner_address)
    if not agent:
        return {"escrow_incompatible": False, "confidence": None, "evidence": ["No agent on record for this owner_address."], "external_link": None}

    service_endpoint = agent.get("service_endpoint")
    description = agent.get("description")
    return await protocol_compat.check_escrow_compatibility(service_endpoint, description)


@app.get("/api/deliverable/proxy")
async def deliverable_proxy_route(request: Request):
    """Real, server-side proxy for fetching a job's on-chain deliverable_url.

    Real, confirmed reason this exists (2026-08-24): job #56646's deliverable
    showed "Couldn't load it automatically here (Failed to fetch)" in the UI
    even though the content is genuinely fetchable directly. Confirmed live:
    the agent's endpoint has no CORS support (same real gap as
    erc8183_negotiate.py's negotiate/notify_funded proxies) — a browser's own
    direct fetch() to it is blocked by the browser itself before the response
    body is ever readable. See core/deliverable_proxy.py for the full trace
    and the SSRF guarding this needs (the URL comes from a job's on-chain
    provider-published deliverable_url — attacker-influenced input).

    Query: ?url=<the deliverable_url read from the job's on-chain record>.
    Returns the real fetched bytes with the real content-type, so the
    frontend's existing content-type-based rendering (JSON/image/text) needs
    no changes beyond fetching from this URL instead of the direct one."""
    url = request.query_params.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    try:
        content, content_type, status_code = await deliverable_proxy.fetch_deliverable(url)
    except deliverable_proxy.DeliverableProxyError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return Response(content=content, media_type=content_type, status_code=status_code)


# The exact prefixes our own hire flows write into a job's real, immutable
# on-chain `description` (useHireAgent.js / AltanaSessionPanel.jsx / mobile
# app — all three checked and matched here). Keep these in sync if any of
# those change.
#
# Real rebrand note (2026-08-28): the site's brand name changed from "Agents
# Marketplace" to "Tnega" — useHireAgent.js/AltanaSessionPanel.jsx now write
# "Hire via Tnega…" for every NEW job. The old "Agents Marketplace" prefixes
# are kept here too, deliberately NOT removed: they're baked into real,
# already-existing on-chain job descriptions, which are immutable — a job
# hired before this rebrand will forever say "Agents Marketplace" on-chain,
# and removing that prefix here would break _parse_hired_agent_name for
# every one of those real past jobs. Both prefixes are checked, old jobs and
# new jobs both resolve correctly.
_HIRE_DESCRIPTION_PREFIXES = [
    "Hire via Tnega (Altana session): ",
    "Hire via Tnega: ",
    "Hire via Agents Marketplace (Altana session): ",
    "Hire via Agents Marketplace: ",
]


def _parse_hired_agent_name(description: str) -> str | None:
    """Recovers the exact agent name shown at hire time, straight from the
    job's own real on-chain description — see the real bug this fixes below.

    Real update 2026-08-22: since useHireAgent.js's negotiate step (see
    core/erc8183_negotiate.py), a job hired against a strict ERC-8183 seller
    no longer has a plain-text description — it's a Schema-v1 JobDescription
    JSON blob whose OWN `task` field carries this exact same prefixed string
    (see erc8183Negotiate.js's buildJobDescription: `task` is the sanitized
    task_description passed in, unchanged). Try the JSON `task` field first;
    fall back to the legacy plain-text prefix match for jobs hired before
    this, or against agents that don't require negotiate at all."""
    if not description:
        return None
    try:
        parsed = json.loads(description)
        if isinstance(parsed, dict) and isinstance(parsed.get("task"), str):
            description = parsed["task"]
    except (ValueError, TypeError):
        pass  # not JSON — the legacy plain-text case, fall through as-is
    for prefix in _HIRE_DESCRIPTION_PREFIXES:
        if description.startswith(prefix):
            return description[len(prefix):].strip() or None
    return None


@app.get("/api/my-jobs")
async def my_jobs(client_address: str):
    """The real backing for the "My Agents" tab: every ERC-8183 job where the
    given wallet is the CLIENT, from the same recent-window on-chain scan
    agent_performance.py already does for providers (see that module's docstring
    for why this is the right approach — no client-indexed event exists either).

    Real bug fixed 2026-08-19: a job's `provider` field is a WALLET address,
    not an agent identity — and one wallet can genuinely own several distinct
    ERC-8004 agents (confirmed live: the wallet behind job #56606 owns THREE
    registered identities from the same mass-registration cluster). Resolving
    "the agent" purely by owner_address is ambiguous — it can silently pick a
    different one of that wallet's agents than the one actually hired, which
    is exactly what happened (hire-time notification correctly showed
    "Ethgar9qoq1pf7b" from the specific agent object the user clicked;
    owner_address-only resolution here later showed a same-wallet sibling,
    "Chaingarvppv", instead).

    Real fix: our own hire flows (useHireAgent.js, AltanaSessionPanel.jsx —
    web and mobile) write the exact agent name into the job's own real,
    immutable on-chain `description` field ("Hire via Tnega: {name}", or
    "Hire via Agents Marketplace: {name}" for jobs hired before the
    2026-08-28 rebrand — see _HIRE_DESCRIPTION_PREFIXES above). That string
    is the authoritative record of which agent was
    actually hired, sourced from the chain itself, not a guess — parsed and
    preferred over the owner_address lookup, which now only breaks the
    provider/name tie (and supplies agent_id for the link) rather than
    picking the name outright. Falls back to owner_address alone only for
    jobs our own flows didn't create (no parseable description) — honestly
    a best-effort/ambiguous case in that scenario, same real limitation as
    before, now scoped to only where it's unavoidable."""
    try:
        result = await agent_performance.get_my_jobs(client_address)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Couldn't look up hire history right now: {e}")

    try:
        known = await agent_store.get_stored_agents()
        by_owner: dict[str, list[dict]] = {}
        for a in known:
            owner = (a.get("owner_address") or "").lower()
            if owner:
                by_owner.setdefault(owner, []).append(a)
    except Exception:
        by_owner = {}  # resolution is a nice-to-have; a store hiccup shouldn't break the jobs list

    for job in result["jobs"]:
        candidates = by_owner.get((job["provider"] or "").lower(), [])
        raw_description = job.get("description") or ""
        parsed_name = _parse_hired_agent_name(raw_description)
        # Real fix, 2026-08-22: a negotiated job's real on-chain description
        # is a JobDescription JSON blob (see _parse_hired_agent_name's own
        # docstring), not readable prose — show its `task` field in the UI
        # instead of the raw JSON. Legacy plain-text descriptions pass
        # through unchanged.
        try:
            parsed_description = json.loads(raw_description)
            if isinstance(parsed_description, dict) and isinstance(parsed_description.get("task"), str):
                job["description"] = parsed_description["task"]
        except (ValueError, TypeError):
            pass

        agent = None
        if parsed_name:
            # The real, on-chain-sourced name wins — find the specific known
            # agent that's BOTH this provider wallet AND this exact name.
            agent = next((a for a in candidates if a.get("name") == parsed_name), None)

        if agent:
            job["agent_id"] = agent.get("id")
            job["agent_name"] = agent.get("name")
        elif parsed_name:
            # We know the real name (it's on-chain) but this specific agent
            # isn't in our store (or the store is momentarily behind) — show
            # the real name honestly, just without a working detail-page link.
            job["agent_id"] = None
            job["agent_name"] = parsed_name
        elif len(candidates) == 1:
            # No parseable description (not one of our own hire flows), but
            # this wallet only has one known agent — unambiguous.
            job["agent_id"] = candidates[0].get("id")
            job["agent_name"] = candidates[0].get("name")
        else:
            # Genuinely ambiguous (multiple same-wallet agents, no on-chain
            # name to disambiguate with) or simply unknown — the honest
            # fallback is the raw provider address, not a guess.
            job["agent_id"] = None
            job["agent_name"] = None

    return result
