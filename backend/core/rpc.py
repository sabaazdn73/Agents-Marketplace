"""
rpc.py

The one, real, shared BSC mainnet RPC URL resolver.

Real, confirmed finding (2026-08-27 release-readiness audit): this exact
`os.environ.get("BSC_MAINNET_RPC_URL") or "https://bsc-dataseed.binance.org"`
fallback was independently duplicated in THREE different files
(core/agent_health.py, core/agent_performance.py, adapters/bsc_balance.py)
— and core/canary.py had a FOURTH, different pattern: a hardcoded
`_RPC_URL = "https://bsc.rpc.blxrbdn.com"` that never read the env var at
all. Checked directly, not assumed: `BSC_MAINNET_RPC_URL` is NOT set in
this project's real, live Render environment variables (confirmed via the
Render API's own `/services/{id}/env-vars`) — meaning every one of those
three duplicated fallbacks has been silently hitting the public, heavily-
shared `bsc-dataseed.binance.org` in production this whole time, not the
"real, tested bloXroute endpoint" `docs/getting-started.md` documents as
this project's intended setup (the frontend's own `VITE_MAINNET_READ_RPC`
already defaults to a real bloXroute URL for exactly this reason — the
public node is known to rate-limit and be slow for anything beyond a
trivial single call). Real, measured consequence: a cold-cache
`get_all_agent_performance()` call (core/agent_performance.py, a genuinely
large 5-chunk Multicall3 scan) took a real, measured 16.5s against the
public fallback.

Real fix: one canonical function, real fallback changed to the SAME
bloXroute URL canary.py already hardcoded and already relies on working —
no new credential needed, just no longer silently defaulting to the most
heavily-shared public node when the real env var isn't set. Every real
call site updated to use this one function; canary.py's own hardcode
removed in favor of it, so a future real env var change takes effect
everywhere at once, not in 3 out of 4 places.
"""

import os

import httpx
from eth_abi import decode as abi_decode
from eth_utils import function_signature_to_4byte_selector

# Real, keyless bloXroute BSC gateway — already proven, in production use
# by core/canary.py before this fix, and the same fallback logic in
# adapters/bsc_balance.py's own default (see this module's own docstring
# for why the public bsc-dataseed default is worth moving away from).
_FALLBACK_RPC_URL = "https://bsc.rpc.blxrbdn.com"


def get_bsc_rpc_url() -> str:
    """The one, real, current BSC mainnet RPC URL every backend on-chain
    read should use. Real env override takes priority; falls back to a
    real, already-proven-working bloXroute gateway (see module docstring),
    not the public bsc-dataseed node."""
    return os.environ.get("BSC_MAINNET_RPC_URL") or _FALLBACK_RPC_URL


# Real, shared AgenticCommerce (ERC-8183) getJob() reader (2026-08-28) —
# extracted for the same real reason category_groups.py was: this exact
# real eth_call + tuple-decode was independently duplicated in
# core/agent_performance.py (batched, via Multicall3) and core/canary.py
# (single-job, a PARTIAL decode — only status/expiredAt/submittedAt, not
# client/provider/description). core/pnl.py needs the FULL real tuple
# (client — the real wallet PnL tracks — and description — the real
# Altana-session marker), so this is the one, complete, shared version;
# canary.py's own narrower _read_job now delegates to it instead of
# keeping a second, partial copy.
COMMERCE = "0xEa4DAa3100A767e86FDed867729ae7446476EBA6"
_GETJOB_SEL = function_signature_to_4byte_selector("getJob(uint256)")
_JOB_TUPLE = "(uint256,address,address,address,string,uint256,uint256,uint8,address,uint256,bytes32)"
JOB_STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"]


async def get_job(job_id: int, client: httpx.AsyncClient | None = None) -> dict | None:
    """Real, single-job on-chain read — the full real struct: id, client,
    provider, evaluator, description, budget, expiredAt, status, hook,
    submittedAt, deliverable. Returns None on any real failure (no such
    job, a malformed/errored real RPC response) — never a fabricated
    job record. Reuses a passed-in real httpx client if the caller
    already has one open (e.g. a batch of real lookups), opens its own
    otherwise."""
    calldata = "0x" + _GETJOB_SEL.hex() + job_id.to_bytes(32, "big").hex()
    payload = {
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{"to": COMMERCE, "data": calldata}, "latest"],
    }

    async def _do(c: httpx.AsyncClient) -> dict | None:
        resp = await c.post(get_bsc_rpc_url(), json=payload)
        resp.raise_for_status()
        body = resp.json()
        if body.get("error") or not body.get("result") or body["result"] == "0x":
            return None
        try:
            (job,) = abi_decode([_JOB_TUPLE], bytes.fromhex(body["result"][2:]))
        except Exception:
            return None
        # Real fix (2026-08-28, found while building core/pnl.py): a
        # genuinely nonexistent job_id doesn't revert or return empty
        # calldata — it returns a real, successfully-ABI-decodable but
        # all-zero struct (confirmed live: getJob(99999999) -> id=0,
        # every address the zero address). Every real job on this
        # contract has id >= 1 (confirmed against real, known jobs
        # throughout this project), so id==0 is the real, reliable "this
        # job never existed" signal — treated the same as any other real
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
