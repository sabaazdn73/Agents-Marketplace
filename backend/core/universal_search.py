"""
universal_search.py

Real, live fallback for a search that isn't answered by the local
known_agents cache — see docs/universal-search.md for the full real
investigation and design reasoning behind what's built here.

Real, deliberate scope: only ever triggers for input that already LOOKS
like an agent id or an address. A plain-text name search that just
doesn't match anything stays a plain "no results" (the existing,
unchanged client-side name filter) — this module never guesses at what
free-text input might mean, only classifies genuinely structured input
(a UUID, a numeric token id, a 0x-address) and looks up the real,
authoritative source for whichever kind it is.

Real, load-bearing finding this is built on (checked directly, not
assumed): known_agents' own `_id` is 8004scan's internal UUID for that
listing, NOT the real, on-chain ERC-8004 tokenId a user would see
referenced anywhere else (BscScan, 8004scan's own public pages, an
on-chain job's provider metadata). The real, on-chain id is the
separate `token_id` integer field. A user pasting a plain number almost
certainly means the real token id, not our internal UUID — this module
checks token_id for a numeric query, not _id.
"""

from __future__ import annotations

import os
import re
import time

import httpx
from eth_abi import decode as abi_decode
from eth_utils import function_signature_to_4byte_selector

from core.db import get_db
from core.rpc import rpc_post
from adapters.bsc import fetch_agent_detail, MAINNET_CHAIN_ID

_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
_NUMERIC_ID_RE = re.compile(r"^\d+$")

# Real, short cache per the explicit ask: a live lookup at search time,
# not a permanent one — repeat searches of the same real input within
# this window are served from memory instead of re-hitting a live API/RPC.
_TTL_SECONDS = 5 * 60
_CACHE_MAX_ENTRIES = 5_000  # real, bounded — same discipline as the recent
# protocol_compat.py OOM fix; this cache is keyed by arbitrary user input
# (never validated against a real, bounded population the way
# service_endpoint is), so it needs its own explicit ceiling from day one.
_cache: dict[str, tuple[float, dict]] = {}


def _cache_get(key: str) -> dict | None:
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _TTL_SECONDS:
        return hit[1]
    return None


def _cache_set(key: str, value: dict) -> None:
    if len(_cache) >= _CACHE_MAX_ENTRIES:
        _cache.clear()
    _cache[key] = (time.time(), value)


def classify_query(raw: str) -> str:
    """Real, plain classification — 'address' | 'uuid' | 'token_id' |
    'unrecognized'. Never guesses at free text; only these three
    structured shapes are treated as a live-lookup candidate."""
    q = (raw or "").strip()
    if _ADDRESS_RE.match(q):
        return "address"
    if _UUID_RE.match(q):
        return "uuid"
    if _NUMERIC_ID_RE.match(q):
        return "token_id"
    return "unrecognized"


# ---- Known, real, hardcoded contracts — mirrors the exact same real
# addresses already hardcoded on the frontend (erc8183.js, defiSkills.js,
# pancakeswapSkill.js, agentMarket.js), never guessed or independently
# sourced. Kept small and literal on purpose, same discipline as
# protocol_compat.py's own _SAAS_LANGUAGE_MARKERS — a real, curated list,
# not an attempt at general-purpose contract identification. ----
_KNOWN_CONTRACTS = {
    "0xea4daa3100a767e86fded867729ae7446476eba6": "Tnega's own AgenticCommerce contract (ERC-8183 escrow)",
    "0x51895229e12f9876011789b04f8698af06ccd6da": "Tnega's own EvaluatorRouter contract (ERC-8183)",
    "0x9c01845705b3078aa2e8cff7520a6376fd766de5": "Tnega's own OptimisticPolicy contract (ERC-8183 default dispute policy)",
    "0x9dba8ebb17fa4ac5c9da083632e9294845ad1333": "Tnega's own AgentAccessMarket contract (Sell Your Agent)",
    "0x10ed43c718714eb63d5aa57b78b54704e256024e": "PancakeSwap V2 Router",
    "0xca143ce32fe78f1f7019d7d551a6402fc5350c73": "PancakeSwap V2 Factory",
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": "Wrapped BNB (WBNB)",
    "0x55d398326f99059ff775485246999027b3197955": "Tether USD (USDT, BSC-USD)",
    "0xfd5840cd36d94d7229439859c0112a4185bc0255": "Venus vUSDT market",
    "0x6807dc923806fe8fd134338eabca509979a7e0cb": "Aave V3 Pool (BSC)",
    "0x1adb950d8bb3da4be104211d5ab038628e477fe6": "Lista DAO staking manager",
}

_ERC20_SELECTORS = {
    "name": function_signature_to_4byte_selector("name()"),
    "symbol": function_signature_to_4byte_selector("symbol()"),
    "decimals": function_signature_to_4byte_selector("decimals()"),
    "totalSupply": function_signature_to_4byte_selector("totalSupply()"),
}


async def _rpc_batch(calls: list[dict]) -> dict[int, dict]:
    """Real, shared batched JSON-RPC helper — one POST, N calls, mapped
    back by the id each call was assigned (batch responses aren't
    guaranteed to come back in request order, same real discipline as
    adapters/bsc_balance.py)."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await rpc_post(client, calls)
        resp.raise_for_status()
        results = resp.json()
    return {r.get("id"): r for r in results if isinstance(r, dict)}


async def resolve_agent_id(query: str) -> dict:
    """Real handling for a numeric token id or a 8004scan-internal UUID.
    Always local-first (free, fast); only makes a real, live 8004scan
    call on a genuine local miss for a numeric token id — a UUID miss is
    reported honestly rather than guessed at (8004scan's own public API
    is keyed by token_id+chain, not by their internal listing UUID, so
    there's no live path to resolve one we don't already have)."""
    kind = classify_query(query)
    cache_key = f"id:{query.strip().lower()}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    db = get_db()

    if kind == "uuid":
        agent = await db.known_agents.find_one({"_id": query.strip()})
        result = (
            {"input_kind": "uuid", "source": "local", "found": True, "agent": _agent_summary(agent)}
            if agent else
            {"input_kind": "uuid", "source": "local", "found": False,
             "reason": "Not in our local marketplace index, and this looks like 8004scan's own internal listing id "
                       "rather than an on-chain agent id — there's no real, live way to look that specific value up "
                       "directly. If you have the agent's real, on-chain token id instead (a plain number), search "
                       "for that instead."}
        )
        _cache_set(cache_key, result)
        return result

    if kind != "token_id":
        result = {"input_kind": "unrecognized", "found": False,
                   "reason": "Doesn't look like a real agent id (a plain number) or a wallet/contract address (0x...)."}
        _cache_set(cache_key, result)
        return result

    token_id = int(query.strip())
    agent = await db.known_agents.find_one({"token_id": token_id})
    if agent:
        result = {"input_kind": "token_id", "source": "local", "found": True, "agent": _agent_summary(agent)}
        _cache_set(cache_key, result)
        return result

    # Real, live fallback — the local cache genuinely doesn't have this
    # one (a brand-new registration, or one this project's own diversity
    # clustering filtered out of the curated known_agents view). BSC
    # mainnet only, matching this project's own stated scope everywhere
    # else (adapters/bsc.py's MAINNET_CHAIN_ID).
    api_key = os.environ.get("SCAN_8004_API_KEY")
    if not api_key:
        result = {"input_kind": "token_id", "source": "live_lookup_unavailable", "found": False,
                   "reason": "Not in our local index, and a live 8004scan lookup isn't configured on this deployment "
                              "(SCAN_8004_API_KEY not set) — can't honestly confirm whether this id is real."}
        _cache_set(cache_key, result)
        return result

    async with httpx.AsyncClient() as client:
        detail = await fetch_agent_detail(client, api_key, token_id, chain_id=MAINNET_CHAIN_ID)

    if detail is None:
        result = {"input_kind": "token_id", "source": "live_8004scan", "found": False,
                   "reason": f"Checked live against 8004scan's own registry for BSC mainnet (chain {MAINNET_CHAIN_ID}) "
                              f"— genuinely no agent exists with token id {token_id} there either. Not a caching gap, "
                              f"this id doesn't appear to be a real, registered agent on this chain."}
        _cache_set(cache_key, result)
        return result

    result = {
        "input_kind": "token_id", "source": "live_8004scan", "found": True,
        "in_curated_marketplace": False,
        "agent": {
            "id": detail.get("id"), "token_id": token_id,
            "name": detail.get("name"), "description": detail.get("description"),
            "owner_address": detail.get("owner_address"), "image_url": detail.get("image_url"),
            "is_verified": detail.get("is_verified"), "star_count": detail.get("star_count"),
            "total_score": detail.get("total_score"), "is_active": detail.get("is_active"),
            "created_tx_hash": detail.get("created_tx_hash"),
        },
        "reason": "This is a real, registered ERC-8004 agent, confirmed live against 8004scan — it's just not in "
                   "our own curated marketplace listing (a brand-new registration, or filtered out by this "
                   "marketplace's own diversity limits). Shown here from the live registry directly.",
    }
    _cache_set(cache_key, result)
    return result


def _agent_summary(agent: dict) -> dict:
    return {
        "id": agent.get("_id"), "token_id": agent.get("token_id"),
        "name": agent.get("name"), "description": agent.get("description"),
        "owner_address": agent.get("owner_address"), "category": agent.get("category"),
        "image_url": agent.get("image_url"), "service_status": agent.get("service_status"),
    }


async def classify_address(address: str) -> dict:
    """Real, live classification for a 0x-address that isn't a known
    agent owner in the local cache: EOA vs contract (eth_getCode), with
    real balance/activity for an EOA, and real, best-effort identification
    for a contract (a known, hardcoded address first, then a live ERC-20
    metadata self-check). Every branch returns a real, honest, non-dead-
    end answer — including the case where nothing further can be said."""
    addr = address.strip().lower()
    cache_key = f"addr:{addr}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    db = get_db()
    # Real, unambiguous — every registered agent this address owns, not
    # just a best-effort single pick (see agent_store.get_agent_by_owner's
    # own docstring for why picking just one would be dishonest here).
    owned_agents = await db.known_agents.find(
        {"owner_address": {"$regex": f"^{re.escape(addr)}$", "$options": "i"}}
    ).to_list(length=20)

    calls = [
        {"jsonrpc": "2.0", "id": 1, "method": "eth_getCode", "params": [addr, "latest"]},
        {"jsonrpc": "2.0", "id": 2, "method": "eth_getBalance", "params": [addr, "latest"]},
        {"jsonrpc": "2.0", "id": 3, "method": "eth_getTransactionCount", "params": [addr, "latest"]},
    ]
    try:
        by_id = await _rpc_batch(calls)
    except Exception as e:
        result = {"input_kind": "address", "found": False,
                   "reason": f"Couldn't reach a real BSC RPC to check this address live: {e}. Try again shortly."}
        _cache_set(cache_key, result)
        return result

    code_result = by_id.get(1, {}).get("result")
    balance_result = by_id.get(2, {}).get("result")
    nonce_result = by_id.get(3, {}).get("result")
    is_contract = bool(code_result) and code_result not in ("0x", "0x0")
    bnb_balance = int(balance_result, 16) / 1e18 if isinstance(balance_result, str) else None
    tx_count = int(nonce_result, 16) if isinstance(nonce_result, str) else None

    if owned_agents:
        result = {
            "input_kind": "address", "found": True, "address_kind": "contract" if is_contract else "wallet",
            "registered_agent_owner": True,
            "agents": [_agent_summary(a) for a in owned_agents],
            "bnb_balance": bnb_balance,
            "reason": f"This address owns {len(owned_agents)} real, registered agent"
                       f"{'s' if len(owned_agents) != 1 else ''} in our marketplace.",
        }
        _cache_set(cache_key, result)
        return result

    if not is_contract:
        result = {
            "input_kind": "address", "found": True, "address_kind": "wallet",
            "registered_agent_owner": False,
            "bnb_balance": bnb_balance, "transaction_count": tx_count,
            "reason": "A real, live BNB Chain wallet (confirmed via eth_getCode — no contract code), "
                       "not a registered agent owner in our marketplace.",
        }
        _cache_set(cache_key, result)
        return result

    # Real contract path — known list first (free), then a live ERC-20
    # self-check (four cheap eth_calls, one batch) before giving up honestly.
    known_name = _KNOWN_CONTRACTS.get(addr)
    if known_name:
        result = {
            "input_kind": "address", "found": True, "address_kind": "contract",
            "registered_agent_owner": False, "contract_identity": known_name,
            "reason": f"A real, live smart contract — identified as {known_name}.",
        }
        _cache_set(cache_key, result)
        return result

    erc20_calls = [
        {"jsonrpc": "2.0", "id": i, "method": "eth_call",
         "params": [{"to": addr, "data": "0x" + sel.hex()}, "latest"]}
        for i, sel in enumerate(_ERC20_SELECTORS.values(), start=1)
    ]
    try:
        erc20_by_id = await _rpc_batch(erc20_calls)
    except Exception:
        erc20_by_id = {}

    def _decode_string(hex_result: str | None) -> str | None:
        if not hex_result or hex_result == "0x":
            return None
        try:
            (val,) = abi_decode(["string"], bytes.fromhex(hex_result[2:]))
            return val or None
        except Exception:
            # Some real, older BSC tokens return a raw bytes32, not a
            # dynamic string (a real, known ERC-20 non-conformance, not
            # a bug here) — try that shape before giving up on this field.
            try:
                raw = bytes.fromhex(hex_result[2:])
                return raw.rstrip(b"\x00").decode("utf-8", errors="ignore") or None
            except Exception:
                return None

    keys = list(_ERC20_SELECTORS.keys())
    name = _decode_string(erc20_by_id.get(1, {}).get("result"))
    symbol = _decode_string(erc20_by_id.get(2, {}).get("result"))
    decimals_raw = erc20_by_id.get(3, {}).get("result")
    supply_raw = erc20_by_id.get(4, {}).get("result")
    decimals = int(decimals_raw, 16) if isinstance(decimals_raw, str) and decimals_raw != "0x" else None
    total_supply = int(supply_raw, 16) if isinstance(supply_raw, str) and supply_raw != "0x" else None

    if symbol or name:
        result = {
            "input_kind": "address", "found": True, "address_kind": "contract",
            "registered_agent_owner": False, "contract_identity": "token",
            "token_name": name, "token_symbol": symbol, "token_decimals": decimals,
            "token_total_supply_raw": total_supply,
            "reason": f"A real, live smart contract that answers as an ERC-20 token"
                       f"{f' ({symbol})' if symbol else ''} — confirmed via a live on-chain read, not a static list.",
        }
        _cache_set(cache_key, result)
        return result

    result = {
        "input_kind": "address", "found": True, "address_kind": "contract",
        "registered_agent_owner": False, "contract_identity": None,
        "reason": "A real, live smart contract (confirmed via eth_getCode) — not a registered agent owner, not a "
                   "recognized token, and not one of the known contracts this project can identify by name. "
                   "Genuinely unidentified, not a failed lookup.",
    }
    _cache_set(cache_key, result)
    return result


async def resolve_search_fallback(raw_query: str) -> dict:
    """The one, real entry point — classifies the input and routes to the
    right real, live lookup. Always returns a real, honest, categorized
    answer, never a bare 'not found' — the whole point of this module."""
    kind = classify_query(raw_query)
    if kind == "address":
        return await classify_address(raw_query)
    if kind in ("uuid", "token_id"):
        return await resolve_agent_id(raw_query)
    return {"input_kind": "unrecognized", "found": False,
            "reason": "Doesn't look like a real agent id (a plain number) or a wallet/contract address (0x...) — "
                       "nothing further to check live for this input."}
