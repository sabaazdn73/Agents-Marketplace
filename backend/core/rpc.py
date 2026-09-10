"""
rpc.py

The one, real, shared BSC mainnet RPC URL resolver.

Real, confirmed finding (2026-08-27 release-readiness audit): this exact
`os.environ.get("BSC_MAINNET_RPC_URL") or "https://bsc-dataseed.binance.org"`
fallback was independently duplicated in THREE different files
(core/agent_health.py, core/agent_performance.py, adapters/bsc_balance.py)
, and core/canary.py had a FOURTH, different pattern: a hardcoded
`_RPC_URL = "https://bsc.rpc.blxrbdn.com"` that never read the env var at
all. Checked directly, not assumed: `BSC_MAINNET_RPC_URL` is NOT set in
this project's real, live Render environment variables (confirmed via the
Render API's own `/services/{id}/env-vars`), meaning every one of those
three duplicated fallbacks has been silently hitting the public, heavily-
shared `bsc-dataseed.binance.org` in production this whole time, not the
"real, tested bloXroute endpoint" `docs/getting-started.md` documents as
this project's intended setup (the frontend's own `VITE_MAINNET_READ_RPC`
already defaults to a bloXroute URL for exactly this reason, the
public node is known to rate-limit and be slow for anything beyond a
trivial single call). Real, measured consequence: a cold-cache
`get_all_agent_performance()` call (core/agent_performance.py, a genuinely
large 5-chunk Multicall3 scan) took a real, measured 16.5s against the
public fallback.

fix: one canonical function, fallback changed to the SAME
bloXroute URL canary.py already hardcoded and already relies on working,
no new credential needed, just no longer silently defaulting to the most
heavily-shared public node when the env var isn't set. Every real
call site updated to use this one function; canary.py's own hardcode
removed in favor of it, so a future env var change takes effect
everywhere at once, not in 3 out of 4 places.

reliability upgrade (2026-09-04): a real, live Infura BSC endpoint
(bsc-mainnet.infura.io, confirmed live against the project's own new
INFURA_API_KEY, eth_chainId -> 0x38, eth_blockNumber) is now
an automatic backup, not a second primary. `rpc_post()` below tries the
primary first (bloXroute, or BSC_MAINNET_RPC_URL if set) with a
real, short per-attempt timeout; only on a failure of the primary
(a httpx-level error, or a HTTP 5xx) does it retry the exact
same request against Infura. A HTTP 4xx from the primary is NOT
retried against the backup, that's a real, deterministic rejection
(a malformed request), not a reliability problem a different node fixes.
Every call site that used to POST directly to `get_bsc_rpc_url()`
now goes through `rpc_post()` instead, so this one fallback layer
covers every on-chain read this backend makes, not a handful.
core/status_checks.py's own `/status` "BSC RPC" check deliberately does
NOT use this function, it tests the primary specifically, on
purpose, since silently succeeding through a hidden backup would defeat
the entire point of a real, per-provider status page; it gets its
own separate "BSC RPC (Infura backup)" row instead.
"""

import os

import httpx
from eth_abi import decode as abi_decode
from eth_utils import function_signature_to_4byte_selector

# Real, keyless bloXroute BSC gateway, already proven, in production use
# by core/canary.py before this fix, and the same fallback logic in
# adapters/bsc_balance.py's own default (see this module's own docstring
# for why the public bsc-dataseed default is worth moving away from).
_FALLBACK_RPC_URL = "https://bsc.rpc.blxrbdn.com"

# A real, short per-attempt timeout, a few seconds, not a stall, so a
# slow/unreachable primary doesn't make every on-chain read wait the
# default 20s+ some callers configure before rpc_post() ever tries the
# backup.
_PRIMARY_TIMEOUT_SECONDS = 5.0


def get_bsc_rpc_url() -> str:
    """The one, real, current BSC mainnet RPC URL every backend on-chain
    read should use. env override takes priority; falls back to a
    real, already-proven-working bloXroute gateway (see module docstring),
    not the public bsc-dataseed node."""
    return os.environ.get("BSC_MAINNET_RPC_URL") or _FALLBACK_RPC_URL


def get_bsc_fallback_rpc_url() -> str | None:
    """The Infura BSC endpoint, or None if INFURA_API_KEY genuinely
    isn't configured (in which case rpc_post() below is just the real
    primary, same as before this upgrade, a missing key never breaks
    anything, it just means no backup exists yet)."""
    key = os.environ.get("INFURA_API_KEY")
    return f"https://bsc-mainnet.infura.io/v3/{key}" if key else None


async def rpc_post(client: httpx.AsyncClient, payload: dict, *, timeout: float = _PRIMARY_TIMEOUT_SECONDS) -> httpx.Response:
    """POST a JSON-RPC payload to BSC mainnet, the primary
    first, with a real, automatic fallback to Infura (if configured) on a
    primary failure. Returns the raw httpx.Response so callers
    keep doing their own real `raise_for_status()` / `.json()` /
    `body.get("error")` handling exactly as before; this only adds real
    URL-level failover underneath, never changes what a caller does with
    a response once it has one.

    A failure that triggers the backup: any httpx-level exception
    (a timeout, connection error, DNS failure) from the primary, or a
    HTTP 5xx status. A real 4xx is returned immediately, no
    failover, that's the primary node correctly rejecting a malformed
    request, not a reliability problem. If every URL fails, the
    last response (or the last exception, if none of them even
    returned a response) is surfaced, so a caller's own error handling
    sees a genuine, failure, never a silently swallowed one."""
    urls = [get_bsc_rpc_url()]
    backup = get_bsc_fallback_rpc_url()
    if backup:
        urls.append(backup)

    last_resp: httpx.Response | None = None
    last_exc: Exception | None = None
    for url in urls:
        try:
            resp = await client.post(url, json=payload, timeout=timeout)
        except httpx.HTTPError as exc:
            last_exc = exc
            continue
        if resp.status_code >= 500:
            last_resp = resp
            continue
        return resp
    if last_resp is not None:
        return last_resp
    raise last_exc


# Real, shared AgenticCommerce (ERC-8183) getJob() reader (2026-08-28),
# extracted for the same reason category_groups.py was: this exact
# eth_call + tuple-decode was independently duplicated in
# core/agent_performance.py (batched, via Multicall3) and core/canary.py
# (single-job, a PARTIAL decode, only status/expiredAt/submittedAt, not
# client/provider/description). core/pnl.py needs the FULL tuple
# (client, the wallet PnL tracks, and description, the real
# Altana-session marker), so this is the one, complete, shared version;
# canary.py's own narrower _read_job now delegates to it instead of
# keeping a second, partial copy.
COMMERCE = "0xEa4DAa3100A767e86FDed867729ae7446476EBA6"
_GETJOB_SEL = function_signature_to_4byte_selector("getJob(uint256)")
_JOB_TUPLE = "(uint256,address,address,address,string,uint256,uint256,uint8,address,uint256,bytes32)"
JOB_STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"]


async def get_job(job_id: int, client: httpx.AsyncClient | None = None) -> dict | None:
    """Real, single-job on-chain read, the full struct: id, client,
    provider, evaluator, description, budget, expiredAt, status, hook,
    submittedAt, deliverable. Returns None on any failure (no such
    job, a malformed/errored RPC response), never a fabricated
    job record. Reuses a passed-in httpx client if the caller
    already has one open (e.g. a batch of lookups), opens its own
    otherwise."""
    calldata = "0x" + _GETJOB_SEL.hex() + job_id.to_bytes(32, "big").hex()
    payload = {
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{"to": COMMERCE, "data": calldata}, "latest"],
    }

    async def _do(c: httpx.AsyncClient) -> dict | None:
        resp = await rpc_post(c, payload)
        resp.raise_for_status()
        body = resp.json()
        if body.get("error") or not body.get("result") or body["result"] == "0x":
            return None
        try:
            (job,) = abi_decode([_JOB_TUPLE], bytes.fromhex(body["result"][2:]))
        except Exception:
            return None
        # fix (2026-08-28, found while building core/pnl.py): a
        # genuinely nonexistent job_id doesn't revert or return empty
        # calldata, it returns a real, successfully-ABI-decodable but
        # all-zero struct (confirmed live: getJob(99999999) -> id=0,
        # every address the zero address). Every job on this
        # contract has id >= 1 (confirmed against real, known jobs
        # throughout this project), so id==0 is the real, reliable "this
        # job never existed" signal, treated the same as any other real
        # not-found case (None), not as a fabricated, all-zero job record.
        if job[0] == 0:
            return None
        return {
            "id": job[0], "client": job[1], "provider": job[2], "evaluator": job[3],
            "description": job[4], "budget": job[5], "expiredAt": job[6],
            "status": JOB_STATUS[job[7]] if job[7] < len(JOB_STATUS) else "UNKNOWN",
            "hook": job[8], "submittedAt": job[9],
        }

    if client is not None:
        return await _do(client)
    async with httpx.AsyncClient(timeout=20) as c:
        return await _do(c)


# ── Per-chain RPC (2026-09-05) ───────────────────────────────────────────
# Added so core/agent_health.py can be made genuinely chain-aware. Every
# function above is untouched: get_bsc_rpc_url / get_bsc_fallback_rpc_url /
# rpc_post remain exactly the BSC path they always were, and the BSC
# health-check keeps using them unchanged.
#
# Why this is needed at all, restated so it does not get undone: the health
# check resolved an agent's tokenURI through ONE hardcoded registry over
# ONE BSC-only RPC. Run against a non-BSC agent it looked that agent's
# token_id up in BSC's registry, did not find it, and returned
# "no_endpoint" for reasons that had nothing to do with the agent's own
# chain. That false positive deleted 26,472 Base, 14,114 Ethereum and 793
# Solana records before it was caught.
#
# Verified live before writing this (eth_getCode plus a tokenURI call
# per chain, against each chain's own RPC): the ERC-8004 identity registry
# is deployed at the SAME address on BSC, Base, Arbitrum, Celo and Monad,
# all with identical 130-byte bytecode, and a stored agent on each of
# those chains resolves a real, distinct tokenURI. The registries were
# never the problem; asking the wrong chain was.
#
# Ethereum is deliberately absent below. Its public endpoint failed when
# tested, and a chain without a confirmed working RPC must not be added --
# that is exactly the shortcut that caused the original damage.
# Solana is absent permanently: it is not EVM, so none of this applies.

def _infura(path: str) -> str | None:
    key = os.environ.get("INFURA_API_KEY")
    return f"https://{path}.infura.io/v3/{key}" if key else None


_CHAIN_PRIMARY_RPC = {
    56: _FALLBACK_RPC_URL,                        # BSC, via the proven bloXroute gateway
    # Ethereum runs Infura FIRST rather than a free public node. It failed
    # an earlier test on llamarpc, which was a free provider having a bad
    # moment and said nothing about the chain -- verified 2026-09-05 via
    # Infura: chainId 1, registry deployed (identical 130 bytes), and 5 of
    # 5 known stored agents resolved real, distinct tokenURIs.
    1: _infura("mainnet"),
    8453: "https://mainnet.base.org",
    42161: "https://arb1.arbitrum.io/rpc",
    42220: "https://forno.celo.org",
    143: "https://rpc.monad.xyz",
    # Robinhood Chain, added 2026-09-10. An Arbitrum Orbit L2 with ETH as
    # its gas token, which is why it carries the same ERC-8004 registry
    # address as the other EVM chains here. Verified live before being
    # added, not assumed: eth_chainId returned 4663, the registry at
    # 0x8004A169.. holds 130 bytes of code (the same length as every other
    # chain's), and tokenURI resolved for 10 of 10 randomly taken stored
    # agents, e.g. agent #60 to https://api.spawnr.fun/...
    #
    # Has a failover, in _CHAIN_PUBLIC_BACKUP below. Corrected 2026-09-10:
    # this was briefly committed as primary-only on the strength of a probe
    # that found no working alternative. That probe was wrong. The chain
    # publishes four RPCs and two of them answer correctly, so the entry is
    # not the primary-alone case that Celo and Monad genuinely are.
    4663: "https://rpc.mainnet.chain.robinhood.com",
}

# Infura path per chain, used as the failover where Infura covers it. Base
# and Arbitrum are covered; Celo and Monad are not, so those two run on
# their primary alone -- stated here rather than silently having no backup.
# Robinhood Chain is not covered by Infura either, but it does have a
# failover: a public endpoint, held in _CHAIN_PUBLIC_BACKUP below.
_CHAIN_INFURA_PATH = {
    56: "bsc-mainnet",
    8453: "base-mainnet",
    42161: "arbitrum-mainnet",
}

# Ethereum inverts the usual arrangement: Infura is the PRIMARY (above) and
# a public node is the backup, rather than the other way round. Stated
# explicitly because it is the one chain here where the paid endpoint is the
# reliable one and the free one is what failed.
_CHAIN_PUBLIC_BACKUP = {
    1: "https://eth.llamarpc.com",
    # Robinhood Chain. Infura does not cover this chain, so its failover is
    # a public endpoint rather than an Infura path. Verified against the
    # primary before being trusted, not taken from a list: it returns
    # chainId 4663, the ERC-8004 registry at 0x8004A169.. with the same 130
    # bytes the primary reports, and it resolves tokenURI(60) to the same
    # value, at a block height within ~15 of the primary.
    4663: "https://robinhood-rpc.publicnode.com",
}


def supported_rpc_chain_ids() -> list[int]:
    """Chains with a WORKING primary RPC. A chain absent from this list has
    not been verified and must not be health-checked.

    Entries whose primary is None are excluded: Ethereum's depends on
    INFURA_API_KEY, and without the key it must drop out of the supported
    set rather than appear supported and fail at call time."""
    return sorted(c for c, u in _CHAIN_PRIMARY_RPC.items() if u)


def get_chain_rpc_url(chain_id: int) -> str | None:
    """Primary RPC for a chain, or None if this chain has no verified
    endpoint. Callers must treat None as 'cannot check', never as a
    negative result about an agent."""
    if chain_id == 56:
        return get_bsc_rpc_url()          # keeps the BSC env override working
    return _CHAIN_PRIMARY_RPC.get(chain_id)


def get_chain_fallback_rpc_url(chain_id: int) -> str | None:
    """Failover endpoint, or None if this chain has only a primary."""
    if chain_id in _CHAIN_PUBLIC_BACKUP:
        return _CHAIN_PUBLIC_BACKUP[chain_id]
    key = os.environ.get("INFURA_API_KEY")
    path = _CHAIN_INFURA_PATH.get(chain_id)
    return f"https://{path}.infura.io/v3/{key}" if (key and path) else None


async def chain_rpc_post(
    client: httpx.AsyncClient, chain_id: int, payload: dict,
    *, timeout: float = _PRIMARY_TIMEOUT_SECONDS,
) -> httpx.Response:
    """Same primary-then-failover discipline as rpc_post, for any supported
    chain. Raises ValueError for an unsupported chain rather than quietly
    falling back to BSC -- falling back to BSC is precisely the bug this
    exists to prevent."""
    primary = get_chain_rpc_url(chain_id)
    if not primary:
        raise ValueError(
            f"No verified RPC for chain {chain_id}. Refusing to fall back to another "
            f"chain's RPC: that is what produced the no_endpoint false positives."
        )
    urls = [primary]
    backup = get_chain_fallback_rpc_url(chain_id)
    if backup:
        urls.append(backup)

    last_resp = None
    last_exc = None
    for url in urls:
        try:
            resp = await client.post(url, json=payload, timeout=timeout)
            if resp.status_code >= 500:
                last_resp = resp
                continue
            return resp
        except Exception as e:
            last_exc = e
            continue
    if last_resp is not None:
        return last_resp
    raise last_exc
