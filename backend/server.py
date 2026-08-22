"""
server.py

The real backend the frontend talks to. One endpoint for now:
GET /api/agents — real, cross-referenced, honestly-incomplete-where-
it-should-be agent data, no mock arrays.

Run locally: uvicorn server:app --reload --port 8000
"""

import os
import json
import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from core.aggregate import get_marketplace_agents_as_dicts
from core import agent_builder
from core import practice_layer
from core import agent_store
from core import agent_performance
from core import agent_health
from core import erc8183_negotiate

load_dotenv()

app = FastAPI(title="Agents Marketplace API")

# Wide open for local dev, tighten this (specific origins only) before
# any real deployment, per this project's security rules. The API serves
# both GET (agents, performance/history) and POST (practice init/fund/record
# and the /api/practice/rpc proxy the browser's practice wallet depends on),
# so cross-origin POST + its OPTIONS preflight must be allowed.
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
# Honest limitation, stated plainly: THIS backend is also on Render's free
# tier, so this loop only runs while server.py itself happens to be awake —
# it reduces, but cannot fully eliminate, the explainer-agent's cold-start
# window (this server's own traffic pattern keeps it warm far more reliably
# than the explainer-agent's low-traffic norm, but there is no guarantee).
# The already-existing mitigations (agent_health.py's retry-with-backoff,
# and the explainer-agent's own pre-warm-on-startup) remain the real backstop
# for whatever this can't prevent.
_EXPLAINER_AGENT_PING_URL = "https://explainer-agent.onrender.com/ping"
_KEEPALIVE_INTERVAL_SECONDS = 10 * 60


async def _explainer_agent_keepalive_loop():
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            try:
                resp = await client.get(_EXPLAINER_AGENT_PING_URL)
                print(f"[keepalive] explainer-agent /ping -> {resp.status_code} "
                      f"({resp.elapsed.total_seconds():.2f}s)")
            except Exception as e:
                # Real, expected outcome during an actual cold start (the
                # ping itself is what wakes it up) — not fatal, just logged.
                print(f"[keepalive] explainer-agent /ping failed (likely mid cold-start): {e}")
            await asyncio.sleep(_KEEPALIVE_INTERVAL_SECONDS)


@app.on_event("startup")
async def _start_explainer_agent_keepalive():
    asyncio.create_task(_explainer_agent_keepalive_loop())


_cache: dict = {"data": None, "fetched_at": 0}
_CACHE_TTL_SECONDS = 60 * 60  # 60 minutes. A full refresh now paginates deeper
# for real agent diversity (aggregate.py: 20 pages × 100 = 20 real 8004scan
# requests + 1 DefiLlama). Budget math against the free_api tier (30 req/min,
# 1000 req/day): ≤24 refreshes/day × ~21 = ~504 req/day ⇒ well under 1000, with
# headroom for occasional force_refresh + 429 retries. TTL was raised from 30→60
# min precisely because each refresh now costs more requests (see aggregate.py).

_refresh_in_progress = False  # de-dupes concurrent background refreshes


async def _refresh_into_store() -> list[dict]:
    """One real refresh: fetch a fresh 8004scan sample, UPSERT it into the
    persistent known_agents store (never deletes), then return the FULL served
    list read back from the store. The store — not this single fetch — is the
    source of truth, so agents from earlier refreshes never vanish just because
    they weren't in this particular paginated sample.

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
    fresh_data = await get_marketplace_agents_as_dicts(api_key=api_key)
    if fresh_data:
        result = await agent_store.upsert_agents(fresh_data)
        print(f"[server] Upserted refresh into known_agents: {result}")
    else:
        # A successful-but-empty fetch is treated as suspect (transient network
        # hiccup / a failed page mid-pagination): we do NOT upsert nothing, and
        # the persistent store keeps serving its existing agents untouched.
        print("[server] Refresh returned 0 agents — keeping the persistent store as-is.")

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
            raise HTTPException(status_code=502, detail=f"Failed to fetch real agent data: {e}")

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
            raise HTTPException(status_code=502, detail=f"Failed to fetch real agent data: {e}")
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
            raise HTTPException(status_code=502, detail=f"Could not reach the real skills registry: {e}")
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
# read endpoints were removed — the Practice Layer (POST /api/practice/*) with
# permanent MongoDB history is the real "try before you spend" mechanism now.


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
        raise HTTPException(status_code=400, detail="A real description is required.")
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


# ── Practice Layer (self-hosted Anvil fork of live BSC mainnet) ──
# One long-lived Anvil instance (a Render Private Service) IS the shared,
# persistent fork — it keeps state across separate calls, so no per-user
# vnet is created. Its admin RPC (PRACTICE_RPC_URL) exposes anvil_* cheat
# methods and stays SERVER-SIDE ONLY; the browser reaches the fork through
# the allow-listed proxy below, never the admin RPC directly.


_COLD_START_DETAIL = (
    "The practice fork is waking up — it's a free-tier service that sleeps after "
    "15 minutes idle and takes about a minute to restart (confirmed against Render's "
    "own docs). We already retried server-side with real patience. Please try again "
    "in a few seconds; it should be warm now."
)


@app.post("/api/practice/init")
async def practice_init():
    """Confirms the Anvil practice fork is alive and returns its chain id and
    current forked block. No vnet creation — Anvil is the persistent fork."""
    try:
        return await practice_layer.get_practice_status()
    except practice_layer.PracticeForkWaking:
        raise HTTPException(status_code=503, detail=_COLD_START_DETAIL)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Practice fork not reachable: {e}")


@app.post("/api/practice/fund")
async def practice_fund(address: str, bnb_amount: float = 10.0):
    """Real faucet funding on the persistent fork: native BNB via
    anvil_setBalance, plus a starter USDT balance via whale impersonation
    (BSC-USD, the token nearly every skill here actually uses)."""
    try:
        result = await practice_layer.fund_practice_wallet(
            address, bnb_amount=bnb_amount,
            tokens={practice_layer.USDT_BSC: 1000.0},  # generous starter USDT
        )
        return {"ok": True, "result": result}
    except practice_layer.PracticeForkWaking:
        raise HTTPException(status_code=503, detail=_COLD_START_DETAIL)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Funding failed: {e}")


# The browser's practice-mode wallet (viem) talks to the fork ONLY through
# this proxy. Admin cheat methods (anvil_*, hardhat_*, evm_*) and unsigned
# eth_sendTransaction are refused; the browser signs locally and submits via
# eth_sendRawTransaction.
_PRACTICE_RPC_ALLOWED = {
    "eth_chainId", "eth_blockNumber", "eth_gasPrice", "eth_maxPriorityFeePerGas",
    "eth_feeHistory", "eth_estimateGas", "eth_call", "eth_getBalance",
    "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount",
    "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs",
    "eth_getBlockByNumber", "eth_getBlockByHash", "eth_sendRawTransaction",
    "net_version", "web3_clientVersion",
}


@app.post("/api/practice/rpc")
async def practice_rpc(request: Request):
    """Allow-listed JSON-RPC passthrough to the Anvil fork for the browser's
    practice wallet, keeping the admin RPC and its cheat methods off the
    public internet."""
    body = await request.json()
    calls = body if isinstance(body, list) else [body]
    for call in calls:
        method = call.get("method") if isinstance(call, dict) else None
        if method not in _PRACTICE_RPC_ALLOWED:
            raise HTTPException(status_code=403, detail=f"Method not allowed in practice proxy: {method}")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(practice_layer.get_practice_rpc(), json=body)
    except httpx.HTTPError as e:
        # Upstream Anvil fork unreachable — surface a clean 502 rather than an
        # unhandled 500, so the browser can show "practice fork is down".
        raise HTTPException(status_code=502, detail=f"Practice fork unreachable: {e}")
    return Response(content=resp.content, media_type="application/json", status_code=resp.status_code)


@app.post("/api/practice/record")
async def practice_record(wallet_address: str, agent_id: str, agent_name: str, skill_id: str, action: str, result: dict):
    """Persists one real practice run to MongoDB, keyed by wallet
    address, per Saba's explicit requirement that history survive."""
    await practice_layer.record_practice_run(wallet_address, agent_id, agent_name, skill_id, action, result)
    return {"ok": True}


@app.get("/api/practice/history/{wallet_address}")
async def practice_history(wallet_address: str):
    """Real, persisted practice history for one wallet."""
    return await practice_layer.get_practice_history(wallet_address)


@app.get("/api/agents/performance")
async def agent_perf(owner_address: str):
    """Real per-agent track record from on-chain ERC-8183 job history (the
    agent's owner as provider). Honest zero-history state when not yet hired."""
    try:
        return await agent_performance.get_agent_performance(owner_address)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to read on-chain job history: {e}")


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


# The exact prefixes our own hire flows write into a job's real, immutable
# on-chain `description` (useHireAgent.js / AltanaSessionPanel.jsx / mobile
# app — all three checked and matched here). Keep these in sync if any of
# those change.
_HIRE_DESCRIPTION_PREFIXES = [
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
    immutable on-chain `description` field ("Hire via Agents Marketplace:
    {name}"). That string is the authoritative record of which agent was
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
        raise HTTPException(status_code=502, detail=f"Failed to read on-chain job history: {e}")

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


@app.get("/api/practice/stats")
async def practice_stats():
    """Real, aggregated practice-layer execution stats (per skill: real run
    count, distinct wallets, actions exercised, last run). Powers the rebuilt
    Advantage Report tab — real data, not the old fabricated comparison array."""
    try:
        return await practice_layer.get_practice_stats()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to aggregate practice stats: {e}")
