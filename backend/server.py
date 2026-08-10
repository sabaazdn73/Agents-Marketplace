"""
server.py

The real backend the frontend talks to. One endpoint for now:
GET /api/agents — real, cross-referenced, honestly-incomplete-where-
it-should-be agent data, no mock arrays.

Run locally: uvicorn server:app --reload --port 8000
"""

import os
import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from core.aggregate import get_marketplace_agents_as_dicts
from core.paper_trading import get_agent_performance, get_all_agent_performance, get_agent_history
from core import agent_builder
from core import practice_layer

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

_cache: dict = {"data": None, "fetched_at": 0}
_CACHE_TTL_SECONDS = 30 * 60  # 30 minutes: a full refresh (~20-40 real API
# calls across both networks) stays well inside the free_api 1000/day
# budget even refreshed every 30 min (48 refreshes/day max), while
# keeping the marketplace reasonably fresh, not stale for hours.


@app.get("/api/agents")
async def agents(force_refresh: bool = False):
    now = time.time()
    is_stale = (now - _cache["fetched_at"]) > _CACHE_TTL_SECONDS
    if _cache["data"] is None or is_stale or force_refresh:
        api_key = os.environ.get("SCAN_8004_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="SCAN_8004_API_KEY is not set. The /api/v1/agents endpoint "
                       "requires a real key, get one at 8004scan.io/developers.",
            )
        try:
            fresh_data = await get_marketplace_agents_as_dicts(api_key=api_key)
            # FIXED 8 Aug 2026, confirmed live: a successful-but-empty
            # refresh (transient network hiccup, cold-start timing, a
            # single failed page mid-pagination) was overwriting a
            # perfectly good previous cache with an empty list, then
            # serving that empty list for a full 30 minutes with no
            # visible error, exactly what happened in production. An
            # empty result now only replaces the cache if there was no
            # real previous cache to protect, otherwise it's treated
            # as suspect and the old, real data keeps serving while
            # this gets logged for investigation.
            if not fresh_data and _cache["data"]:
                print(f"[server] Refresh returned 0 agents despite {len(_cache['data'])} "
                      f"cached previously, treating as a transient failure, keeping the old cache.")
            else:
                _cache["data"] = fresh_data
                _cache["fetched_at"] = now
        except Exception as e:
            if _cache["data"] is not None:
                print(f"[server] Refresh failed, serving stale cache: {e}")
            else:
                raise HTTPException(status_code=502, detail=f"Failed to fetch real agent data: {e}")
    return {
        "agents": _cache["data"] or [],
        "cached_at": _cache["fetched_at"],
        "cache_age_seconds": int(now - _cache["fetched_at"]),
    }


@app.get("/api/health")
async def health():
    return {"ok": True}


# NOTE: the old POST /api/paper-trade (Tenderly simulate-and-persist) was
# removed with Tenderly. The Practice Layer (POST /api/practice/*) is the real
# "try before you spend" mechanism now. The read endpoints below still serve
# any previously-persisted paper_trades history honestly.

@app.get("/api/paper-trade/performance/{agent_id}")
async def paper_trade_performance(agent_id: str):
    """Real, persisted performance for one agent, category-aware
    metric, honest empty state if never tested."""
    return await get_agent_performance(agent_id)


@app.get("/api/paper-trade/history/{agent_id}")
async def paper_trade_history(agent_id: str):
    """Real, persisted chronological simulation history for one agent."""
    return await get_agent_history(agent_id)


@app.get("/api/paper-trade/performance")
async def paper_trade_performance_all():
    """Every agent with at least one real, persisted simulation."""
    return await get_all_agent_performance()


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


@app.post("/api/practice/init")
async def practice_init():
    """Confirms the Anvil practice fork is alive and returns its chain id and
    current forked block. No vnet creation — Anvil is the persistent fork."""
    try:
        return await practice_layer.get_practice_status()
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
