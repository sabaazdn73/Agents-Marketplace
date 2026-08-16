"""
practice_layer.py

The real "try before you spend real money" layer.

We now run our OWN persistent fork instead of Tenderly's Virtual TestNet:
a long-lived Anvil (Foundry) instance forked from live BSC mainnet. Anvil
maintains state like a real chain, so a user can buy now / sell later /
check a lending position days after supplying it — state accumulates across
separate calls, which a stateless eth_call+stateOverride approach cannot do.

Deploy model (free tier): Anvil runs inside ONE public Docker Web Service,
bound to 127.0.0.1:8545 (never public). A tiny gateway on the container's
public port fronts it with two doors: a PUBLIC method-filtered door (safe
eth_* only) and an AUTHENTICATED /admin/rpc door (shared secret) that forwards
anvil_* cheats unfiltered. The backend reaches reads via the public door and
funding via the admin door.

Env:
  PRACTICE_RPC_URL   — the container gateway's PUBLIC door URL (method-filtered;
                       safe for reads / the browser proxy forward target).
  PRACTICE_ADMIN_URL — the gateway's authenticated /admin/rpc door (unfiltered).
                       Optional; falls back to PRACTICE_RPC_URL for bare local
                       dev pointed straight at a raw Anvil.
  PRACTICE_ADMIN_KEY — shared secret sent as X-Admin-Key on admin calls; must
                       match the value the container's gateway enforces.

State durability, stated honestly: the Anvil fork keeps state across separate
calls WHILE IT IS RUNNING. On the free-tier deploy there is no persistent disk,
so a service restart/redeploy resets the fork to fresh mainnet state — a user's
in-fork practice positions (balances, supplied/staked amounts) can disappear.
The permanent run HISTORY below (record_practice_run / get_practice_history)
lives in MongoDB, NOT on the fork, so it survives restarts regardless.

Funding uses Anvil's real cheat methods (verified live against Foundry
v1.7.1, not assumed):
  - Native BNB:  anvil_setBalance
  - ERC-20:      Anvil has NO anvil_setErc20Balance (that was Tenderly-only).
                 We impersonate a real whale that already holds the token
                 (anvil_impersonateAccount) and transfer from it, then
                 anvil_stopImpersonatingAccount. Token-agnostic and robust.

Every practice execution is still permanently recorded in MongoDB, keyed by
the user's real wallet address (unchanged — never depended on Tenderly).
"""

import os
import asyncio
import httpx
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

BSC_MAINNET_CHAIN_ID = 56


class PracticeForkWaking(Exception):
    """Raised when the fork's free-tier Render instance never came up within
    the retry budget below. Distinct from other RuntimeErrors so server.py can
    tell the user honestly "it's asleep, still waking" instead of a generic
    502/stack trace."""
    pass
USDT_BSC = "0x55d398326f99059fF775485246999027B3197955"

# Real holders that carry huge balances of these tokens on live BSC, used as
# impersonation sources for practice funding. Verified live on the fork: the
# Binance hot wallet below holds >500M USDT.
TOKEN_WHALES: dict[str, str] = {
    USDT_BSC.lower(): "0xF977814e90dA44bFA03b6295A0616a897441aceC",
}

# 10 BNB (hex wei) — plenty of gas for an impersonated whale to send a transfer.
_WHALE_GAS_WEI_HEX = hex(int(10 * 1e18))

_client: AsyncIOMotorClient | None = None


def get_db():
    global _client
    if _client is None:
        mongo_uri = os.environ.get("MONGODB_URI")
        if not mongo_uri:
            raise RuntimeError("MONGODB_URI not set.")
        _client = AsyncIOMotorClient(mongo_uri)
    return _client[os.environ.get("MONGODB_DB_NAME", "agents_marketplace")]


def get_practice_rpc() -> str:
    """The PUBLIC door of the Anvil fork's container gateway (method-filtered:
    only safe eth_* / read-write calls pass). Used for status reads and as the
    forward target of the browser proxy. Server-side reads go here."""
    url = os.environ.get("PRACTICE_RPC_URL")
    if not url:
        raise RuntimeError(
            "PRACTICE_RPC_URL not set. Point it at the Anvil fork container's "
            "PUBLIC gateway URL (e.g. https://anvil-practice-fork.onrender.com)."
        )
    return url


def get_practice_admin() -> tuple[str, str | None]:
    """The AUTHENTICATED admin door of the container gateway, which forwards
    UNFILTERED to Anvil (anvil_setBalance, impersonation, eth_sendTransaction).
    Returns (url, admin_key). Falls back to the public URL with no key for a
    bare local dev setup that points straight at a raw Anvil (no gateway)."""
    url = os.environ.get("PRACTICE_ADMIN_URL") or get_practice_rpc()
    key = os.environ.get("PRACTICE_ADMIN_KEY")  # None only in bare local dev
    return url, key


# Retry budget for the free-tier Render instance waking from idle sleep.
# CONFIRMED against Render's own docs (render.com/docs/free, 16 Aug 2026):
# a Free web service spins down after 15 minutes with no inbound traffic and
# "takes about one minute" to spin back up. This schedule sums to 75s of
# waiting, comfortably past that documented ~60s, before we give up honestly.
_COLD_START_BACKOFF_SECONDS = [2, 3, 5, 8, 12, 15, 15, 15]  # 8 retries, 75s total
# Each individual attempt gets its own short timeout (independent of whatever
# the caller's AsyncClient default is) so a hung attempt fails fast into the
# backoff loop instead of eating the whole budget on one try.
_COLD_START_ATTEMPT_TIMEOUT = 10.0

# Real failure signals that mean a cold start, EMPIRICALLY CONFIRMED (16 Aug
# 2026) against the actual live fork, not assumed: 502/503/504 from Render's
# edge while the container is still booting, a refused connection, AND
# ReadTimeout — tested live and the real failure mode was a held-open
# connection that timed out client-side, not a fast 502. Retrying reads
# (eth_chainId, eth_blockNumber, getBalance, etc.) on any of these is fully
# safe — no state changes involved. The one state-changing admin call in this
# module that isn't naturally idempotent is the whale eth_sendTransaction in
# _fund_erc20_via_whale: if a timeout happens AFTER Anvil actually received
# and mined it, a retry could send a second, real (on-fork) transfer. Accepted
# tradeoff, stated honestly: this is fake practice-fork money the user is
# being GIVEN for free — a rare double-funded practice wallet is a cosmetic
# non-issue, not a safety issue, and far better than a hard-failing funding
# call on every cold start.
_COLD_START_EXCEPTIONS = (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.PoolTimeout)
_COLD_START_STATUS_CODES = {502, 503, 504}


async def _rpc(client: httpx.AsyncClient, method: str, params: list, *, admin: bool = False) -> dict:
    """One JSON-RPC call to the Anvil fork. Raises on a JSON-RPC error so a
    failed cheat surfaces honestly instead of silently no-op'ing.

    admin=True routes to the authenticated /admin/rpc door (carrying the shared
    secret) so anvil_* cheat methods reach Anvil; admin=False routes to the
    public, method-filtered door (safe for reads).

    Retries on the real, empirically-observed cold-start signals — see
    _COLD_START_EXCEPTIONS / _COLD_START_STATUS_CODES above (and their comment
    for the one accepted, honestly-stated tradeoff)."""
    if admin:
        url, key = get_practice_admin()
        headers = {"X-Admin-Key": key} if key else {}
    else:
        url, headers = get_practice_rpc(), {}

    attempts = len(_COLD_START_BACKOFF_SECONDS) + 1
    last_error = None
    for attempt in range(attempts):
        try:
            resp = await client.post(url, headers=headers, json={
                "jsonrpc": "2.0", "method": method, "params": params, "id": 1,
            }, timeout=_COLD_START_ATTEMPT_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            if "error" in data and data["error"]:
                raise RuntimeError(f"{method} failed: {data['error']}")
            return data
        except _COLD_START_EXCEPTIONS as e:
            last_error = e
        except httpx.HTTPStatusError as e:
            if e.response.status_code not in _COLD_START_STATUS_CODES:
                raise
            last_error = e

        if attempt < len(_COLD_START_BACKOFF_SECONDS):
            wait = _COLD_START_BACKOFF_SECONDS[attempt]
            print(f"[practice_layer] {method} got a cold-start signal ({type(last_error).__name__}: {last_error}), "
                  f"retrying in {wait}s (attempt {attempt + 1}/{attempts})")
            await asyncio.sleep(wait)

    raise PracticeForkWaking(
        f"The practice fork's free-tier service did not respond within "
        f"{sum(_COLD_START_BACKOFF_SECONDS) + attempts * _COLD_START_ATTEMPT_TIMEOUT:.0f}s of retrying "
        f"— it may still be waking from idle sleep, or genuinely down. Last error: {last_error}"
    )


async def get_practice_status() -> dict:
    """Liveness/identity of the practice fork — the replacement for the old
    Tenderly vnet-creation step. No per-user vnet is created: Anvil itself is
    the single persistent fork, so this just confirms it's alive and reports
    its chain id and current forked block."""
    async with httpx.AsyncClient(timeout=20) as client:
        chain_id = (await _rpc(client, "eth_chainId", []))["result"]
        block = (await _rpc(client, "eth_blockNumber", []))["result"]
    return {
        "ready": True,
        "chain_id": int(chain_id, 16),
        "block_number": int(block, 16),
        # The browser must use the allow-listed backend proxy, never this
        # admin RPC directly. The frontend already knows the proxy path.
        "rpc_proxy_path": "/api/practice/rpc",
    }


def _encode_transfer(to_address: str, amount_raw: int) -> str:
    """calldata for ERC-20 transfer(address,uint256)."""
    selector = "a9059cbb"
    to_padded = to_address.lower().replace("0x", "").rjust(64, "0")
    amount_padded = format(amount_raw, "064x")
    return "0x" + selector + to_padded + amount_padded


async def _fund_erc20_via_whale(client: httpx.AsyncClient, token: str, to_address: str, amount_raw: int) -> dict:
    """Impersonate a real whale holding `token` and transfer `amount_raw` to
    the practice wallet. Verifies the tx receipt status is success (0x1)
    rather than trusting that the send returned a hash."""
    whale = TOKEN_WHALES.get(token.lower())
    if not whale:
        raise RuntimeError(f"No known whale configured for token {token}; cannot fund it via impersonation.")

    # All of these go through the authenticated admin door (anvil_* cheats +
    # the unsigned eth_sendTransaction from the impersonated whale are blocked
    # at the public edge).
    await _rpc(client, "anvil_impersonateAccount", [whale], admin=True)
    try:
        await _rpc(client, "anvil_setBalance", [whale, _WHALE_GAS_WEI_HEX], admin=True)  # gas for the whale
        tx_hash = (await _rpc(client, "eth_sendTransaction", [{
            "from": whale,
            "to": token,
            "data": _encode_transfer(to_address, amount_raw),
        }], admin=True))["result"]
        # Anvil auto-mines, but block mining can lag a few ms behind the send
        # returning its hash — poll the receipt rather than reading it once
        # (a single immediate read races the miner and returns null).
        receipt = None
        for _ in range(20):
            receipt = (await _rpc(client, "eth_getTransactionReceipt", [tx_hash], admin=True))["result"]
            if receipt is not None:
                break
            await asyncio.sleep(0.1)
    finally:
        await _rpc(client, "anvil_stopImpersonatingAccount", [whale], admin=True)

    status = (receipt or {}).get("status")
    if status != "0x1":
        raise RuntimeError(f"Whale transfer of {token} did not succeed (receipt status {status}).")
    return {"tx_hash": tx_hash, "status": status, "whale": whale}


async def fund_practice_wallet(address: str, bnb_amount: float = 10.0, tokens: dict | None = None) -> dict:
    """Real funding on the persistent Anvil fork. Native BNB via
    anvil_setBalance; each ERC-20 via whale impersonation + transfer.

    tokens: {token_contract_address: amount_in_whole_units}. Whole units are
    converted at 18 decimals (USDT and most BSC tokens use 18)."""
    results: dict = {}
    async with httpx.AsyncClient(timeout=60) as client:
        bnb_wei_hex = hex(int(bnb_amount * 1e18))
        await _rpc(client, "anvil_setBalance", [address, bnb_wei_hex], admin=True)
        results["native"] = {"bnb": bnb_amount}

        for token_address, amount in (tokens or {}).items():
            amount_raw = int(amount * 1e18)  # 18 decimals on BSC (USDT included)
            results[token_address] = await _fund_erc20_via_whale(client, token_address, address, amount_raw)

    return results


# ── MongoDB history (unchanged — never depended on Tenderly) ──

async def record_practice_run(wallet_address: str, agent_id: str, agent_name: str, skill_id: str, action: str, result: dict) -> None:
    """Permanent record, keyed by the real wallet address: a user can revisit
    their own practice history later."""
    db = get_db()
    await db.practice_runs.insert_one({
        "wallet_address": wallet_address.lower(),
        "agent_id": agent_id,
        "agent_name": agent_name,
        "skill_id": skill_id,
        "action": action,
        "result": result,
        "ran_at": datetime.now(timezone.utc).isoformat(),
    })


async def get_practice_history(wallet_address: str, limit: int = 100) -> list[dict]:
    """Real, persisted history for one wallet, most recent first."""
    db = get_db()
    records = await db.practice_runs.find({"wallet_address": wallet_address.lower()}) \
        .sort("ran_at", -1).to_list(length=limit)
    for r in records:
        r["_id"] = str(r["_id"])
    return records


async def get_practice_stats() -> dict:
    """Real, aggregated stats over ALL practice runs, grouped by skill.

    HONESTY NOTE (verified against the real collection, 12 Aug 2026): the
    stored `result` dicts do NOT record gas used or an explicit success/failure
    flag — they hold per-skill output values (bnbStaked, lpReceived,
    usdtSupplied, …). So this deliberately aggregates only what is genuinely
    recorded, and does NOT fabricate an "average gas" or "success rate" that the
    data cannot support. Per skill we return: real execution count, number of
    distinct practice wallets, the set of actions actually exercised, and the
    most-recent run time. All real, all already in MongoDB.
    """
    db = get_db()
    pipeline = [
        {"$group": {
            "_id": "$skill_id",
            "agent_name": {"$last": "$agent_name"},
            "executions": {"$sum": 1},
            "wallets": {"$addToSet": "$wallet_address"},
            "actions": {"$addToSet": "$action"},
            "last_ran_at": {"$max": "$ran_at"},
            "first_ran_at": {"$min": "$ran_at"},
        }},
        {"$sort": {"executions": -1}},
    ]
    rows = await db.practice_runs.aggregate(pipeline).to_list(length=200)
    skills = [{
        "skill_id": r["_id"],
        "agent_name": r.get("agent_name") or r["_id"],
        "executions": r.get("executions", 0),
        "distinct_wallets": len(r.get("wallets", [])),
        "actions": sorted(a for a in r.get("actions", []) if a),
        "last_ran_at": r.get("last_ran_at"),
        "first_ran_at": r.get("first_ran_at"),
    } for r in rows]

    total_runs = sum(s["executions"] for s in skills)
    all_wallets = await db.practice_runs.distinct("wallet_address")
    return {
        "total_runs": total_runs,
        "distinct_wallets": len(all_wallets),
        "skill_count": len(skills),
        "skills": skills,
        # Stated in the payload so the UI can be honest about what these numbers
        # are (and are not) without hard-coding the caveat in the frontend.
        "note": "Real execution counts from the practice layer's on-chain-fork "
                "runs (persisted in MongoDB). Gas and pass/fail are not recorded "
                "per run, so they are intentionally not shown.",
    }
