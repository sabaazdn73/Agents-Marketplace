"""
contract_verification.py

Real, opt-in check of whether an agent's registered owner_address is a
plain wallet (an EOA) or an actual smart contract — and if it's a
contract, whether that contract's source code is verified.

Real investigation before building this (2026-08-30): checked how common
this even is first. Sampled 30 real, distinct owner addresses from the
top-scored agents in the live known_agents store via a real eth_getCode
RPC call: only 2/24 distinct addresses (~8%) were smart contracts at
all — most agent owners are plain wallets, for which "is the contract
verified" is a meaningless question. Given that real, modest prevalence,
this is built as a narrow, honest, best-effort detail-page signal, not a
marketplace-wide feature — same discipline as adapters/zerion.py and
adapters/termix.py: opt-in, per-agent, never bulk-fetched.

Two real, separate data sources, used in sequence to avoid wasting a real
BscScan call on the ~92% of addresses that are plain wallets:
  1. eth_getCode via the same real BSC RPC infrastructure
     adapters/bsc_balance.py already uses (free, unlimited, no key) — is
     this address a contract at all?
  2. Only if yes: Etherscan's real, unified V2 API
     (module=contract&action=getsourcecode), confirmed live and free for
     BSC (unlike the `account` module's balance/txlist endpoints, already
     confirmed elsewhere in this project to require a paid plan for BSC —
     see adapters/bsc_balance.py's own real investigation. The `contract`
     module is a real, separately-gated, free exception, confirmed live
     here: a real, known verified contract (an ERC1967Proxy) returned its
     real SourceCode, ContractName, CompilerVersion; a real, known
     unverified one returned real, honest empty strings for all three).

Best-effort, same discipline as every other adapter in this project: any
failure (RPC error, missing key, BscScan error) reports a real, honest
result rather than a fabricated one — `is_contract: False` is the
overwhelmingly common, genuinely honest case, not a fallback for "we
don't know".
"""

from __future__ import annotations

import os
import time

import httpx

_ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api"
_BSC_CHAIN_ID = 56

# Chains checked through Sourcify rather than an Etherscan-style explorer.
# Must stay in step with core/chain_capabilities._SOURCIFY_VERIFY_CHAINS.
_SOURCIFY_CHAINS = (4663,)
_SOURCIFY_BASE = "https://sourcify.dev/server"

_TTL_SECONDS = 24 * 60 * 60  # a contract's own verification status is a structural
# property that essentially never changes minute to minute — a full day's cache is
# honest and real, not stale-looking, same reasoning protocol_compat._cache uses
# for a different structural property.
_cache: dict[str, tuple[float, dict]] = {}


async def _is_contract(address: str, chain_id: int = _BSC_CHAIN_ID) -> bool | None:
    """Real eth_getCode check — returns True if the address has real
    on-chain bytecode (a contract), False for a plain wallet (empty
    code), None on a genuine RPC failure (honestly unknown, not assumed
    either way).

    `chain_id` defaults to BSC so every existing caller keeps its exact
    previous behaviour; other chains go through core/rpc.py's per-chain
    transport, which raises for a chain it has no RPC for rather than
    quietly answering from BSC."""
    from core.rpc import chain_rpc_post, rpc_post
    payload = {"jsonrpc": "2.0", "id": 1, "method": "eth_getCode", "params": [address, "latest"]}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await (
                rpc_post(client, payload) if chain_id == _BSC_CHAIN_ID
                else chain_rpc_post(client, chain_id, payload)
            )
            resp.raise_for_status()
            code = resp.json().get("result")
    except Exception:
        return None
    if not isinstance(code, str):
        return None
    return code not in ("0x", "0x0", "")


async def check_owner_contract_verification(address: str, chain_id: int = _BSC_CHAIN_ID) -> dict:
    """Returns one of:
      {"is_contract": False} — the real, common case: a plain wallet,
        nothing more to check.
      {"is_contract": True, "verified": True, "contract_name": ...,
       "compiler_version": ..., "is_proxy": bool} — a real, verified
        contract.
      {"is_contract": True, "verified": False} — a real, honest finding:
        this owner operates through an UNVERIFIED smart contract, a real
        risk signal (its real behavior can't be independently audited).
      {"is_contract": True, "verified": None, "reason": ...} — is a
        contract, but real verification status couldn't be checked right
        now (missing key, BscScan error) — never guessed either way.
      {"is_contract": None, "reason": ...} — the real RPC check itself
        failed; genuinely unknown.
    24-hour cache per (address, chain) — verification status is structural
    rather than time-sensitive, but it is NOT the same fact across chains:
    the same address can be a verified contract on one chain, an unverified
    one on another, and a plain wallet on a third. Keying this cache on the
    address alone (as it was before chain support) would have let the first
    chain checked answer for every other one."""
    addr = (address or "").lower()
    if not addr.startswith("0x") or len(addr) != 42:
        return {"is_contract": None, "reason": "not a valid EVM address"}

    key = (addr, chain_id)
    cached = _cache.get(key)
    if cached and time.time() - cached[0] < _TTL_SECONDS:
        return cached[1]

    try:
        is_contract = await _is_contract(addr, chain_id)
    except ValueError as e:
        # core/rpc.py raises for a chain it has no RPC for. Reported as
        # honestly unknown rather than allowed to look like a wallet.
        return {"is_contract": None, "reason": f"no RPC configured for chain {chain_id}: {e}"}
    if is_contract is None:
        result = {"is_contract": None, "reason": "couldn't reach the chain's RPC to check"}
        _cache[key] = (time.time(), result)
        return result
    if not is_contract:
        result = {"is_contract": False}
        _cache[key] = (time.time(), result)
        return result

    # Chains with no Etherscan-style explorer resolve through Sourcify
    # instead. Added 2026-09-10 for Robinhood Chain, whose Blockscout API sits
    # behind a Cloudflare interstitial and returns 403 to a client.
    #
    # Added because core/chain_capabilities.py had already been told this
    # chain could answer the contract check, and a capability list that
    # promises what the adapter cannot deliver is a false claim. The same
    # mistake was made with Zerion on the same day; see adapters/zerion.py.
    #
    # Verified on real addresses on 4663: our own escrow and the ERC-8004
    # registry both return exact_match with non-zero code, and real agent
    # owner addresses return zero code, which is handled above as a wallet.
    if chain_id in _SOURCIFY_CHAINS:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(f"{_SOURCIFY_BASE}/v2/contract/{chain_id}/{addr}")
            if resp.status_code == 404:
                result = {"is_contract": True, "verified": False}
            elif resp.status_code == 200:
                body = resp.json()
                match = body.get("match") or body.get("runtimeMatch")
                result = {"is_contract": True, "verified": bool(match),
                          "contract_name": None, "compiler_version": None, "is_proxy": None,
                          "source": "Sourcify"}
            else:
                result = {"is_contract": True, "verified": None,
                          "reason": f"Sourcify returned HTTP {resp.status_code}"}
        except Exception as e:
            result = {"is_contract": True, "verified": None,
                      "reason": f"couldn't reach Sourcify: {e}"}
        _cache[key] = (time.time(), result)
        return result

    api_key = os.environ.get("BSCSCAN_API_KEY")
    if not api_key:
        result = {"is_contract": True, "verified": None, "reason": "BSCSCAN_API_KEY not set"}
        _cache[key] = (time.time(), result)
        return result

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                _ETHERSCAN_V2_BASE,
                params={"chainid": chain_id, "module": "contract", "action": "getsourcecode",
                        "address": addr, "apikey": api_key},
            )
            resp.raise_for_status()
            body = resp.json()
    except Exception as e:
        result = {"is_contract": True, "verified": None, "reason": f"couldn't reach BscScan: {e}"}
        _cache[key] = (time.time(), result)
        return result

    entries = body.get("result")
    if not isinstance(entries, list) or not entries:
        result = {"is_contract": True, "verified": None, "reason": "BscScan returned an unexpected response shape"}
        _cache[key] = (time.time(), result)
        return result

    entry = entries[0]
    source = entry.get("SourceCode") or ""
    verified = bool(source)
    result = {
        "is_contract": True,
        "verified": verified,
        "contract_name": entry.get("ContractName") or None if verified else None,
        "compiler_version": entry.get("CompilerVersion") or None if verified else None,
        "is_proxy": (entry.get("Proxy") == "1") if verified else None,
    }
    _cache[key] = (time.time(), result)
    return result
