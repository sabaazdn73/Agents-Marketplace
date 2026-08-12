"""
agent_performance.py

Real per-agent track record, read from on-chain ERC-8183 job history — the
answer to "how well has THIS agent performed when people actually hire it",
which is different from the Practice-Layer report (general Practice-Mode testing
activity, not a specific agent's real hires).

How it reads real data (and why it's bounded):
  - The AgenticCommerce kernel (ERC8183_ADDRESSES[56].commerce) exposes
    getJob(jobId) -> (id, client, provider, evaluator, description, budget,
    expiredAt, status, hook, submittedAt, deliverable), and jobCounter().
  - There is NO provider-indexed event, and there are already ~56k+ jobs, so a
    full per-agent scan of every job on every page view is infeasible.
  - Instead we scan the MOST RECENT `WINDOW` jobs once (batched eth_call), decode
    them, and tally outcomes per provider address. An agent's real track record
    is then a dict lookup. The window is stated honestly in the payload so the UI
    never implies it saw the agent's entire history.

Everything here is a real on-chain read (public BSC RPC). If a provider has no
jobs in the window, the agent honestly reports zero real hires — expected for a
new marketplace — rather than a fabricated number.
"""

import os
import time
import httpx
from eth_abi import decode as abi_decode, encode as abi_encode
from eth_utils import function_signature_to_4byte_selector

# AgenticCommerce (ERC-8183) on BSC mainnet — from the SDK's ERC8183_ADDRESSES[56]
# (verified live: jobCounter() returned 56,587 and getJob(1/2/5) returned real jobs).
COMMERCE = "0xEa4DAa3100A767e86FDed867729ae7446476EBA6"
# Multicall3, same canonical address on every EVM chain (incl. BSC). We read the
# job window through aggregate3 — ONE eth_call that internally fans out to many
# getJob reads — because public BSC RPCs rate-limit *batched* eth_call (even 50
# per JSON-RPC batch triggers -32005) and reject batches >100. A single
# aggregate3 eth_call sidesteps that entirely.
MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
JOB_STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"]

WINDOW = 1500          # most-recent jobs scanned (bounded, honestly labeled)
_TTL_SECONDS = 30 * 60
_CHUNK = 300           # getJob reads per aggregate3 eth_call

_GETJOB_SEL = function_signature_to_4byte_selector("getJob(uint256)")
_JOBCOUNTER_SEL = "0x" + function_signature_to_4byte_selector("jobCounter()").hex()
_AGG3_SEL = function_signature_to_4byte_selector("aggregate3((address,bool,bytes)[])")
# getJob's returned struct, in ABI order:
_JOB_TUPLE = "(uint256,address,address,address,string,uint256,uint256,uint8,address,uint256,bytes32)"

_cache: dict = {"at": 0, "by_provider": {}, "job_counter": 0, "window_from": 0, "window_to": 0}


def _rpc_url() -> str:
    return os.environ.get("BSC_MAINNET_RPC_URL") or "https://bsc-dataseed.binance.org"


def _job_calldata_bytes(job_id: int) -> bytes:
    return _GETJOB_SEL + job_id.to_bytes(32, "big")


def _agg3_calldata(job_ids: list[int]) -> str:
    # Call3[] = (address target, bool allowFailure, bytes callData); allowFailure
    # so one reverting job never sinks the whole aggregate.
    calls = [(COMMERCE, True, _job_calldata_bytes(j)) for j in job_ids]
    encoded = abi_encode(["(address,bool,bytes)[]"], [calls])
    return "0x" + _AGG3_SEL.hex() + encoded.hex()


async def _multicall_getjobs(client: httpx.AsyncClient, job_ids: list[int]) -> list[dict]:
    """Read a chunk of jobs via one Multicall3 aggregate3 eth_call. Returns the
    successfully-decoded jobs (reverted/empty entries are skipped honestly)."""
    resp = await client.post(_rpc_url(), json={
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{"to": MULTICALL3, "data": _agg3_calldata(job_ids)}, "latest"],
    })
    resp.raise_for_status()
    body = resp.json()
    if "error" in body and body["error"]:
        raise RuntimeError(f"multicall eth_call failed: {body['error']}")
    (results,) = abi_decode(["(bool,bytes)[]"], bytes.fromhex(body["result"][2:]))
    out = []
    for success, ret in results:
        if not success or not ret:
            continue
        try:
            (job,) = abi_decode([_JOB_TUPLE], ret)
            out.append({
                "id": job[0], "client": job[1], "provider": job[2],
                "budget": job[5], "expiredAt": job[6], "status": job[7],
                "submittedAt": job[9],
            })
        except Exception:
            continue  # malformed entry — skip honestly
    return out


async def _scan_recent_window() -> dict:
    """Scan the most-recent WINDOW jobs and tally outcomes per provider."""
    async with httpx.AsyncClient(timeout=30) as client:
        cnt_resp = await client.post(_rpc_url(), json={
            "jsonrpc": "2.0", "id": 1, "method": "eth_call",
            "params": [{"to": COMMERCE, "data": _JOBCOUNTER_SEL}, "latest"],
        })
        cnt_resp.raise_for_status()
        job_counter = int(cnt_resp.json()["result"], 16)
        if job_counter <= 0:
            return {"by_provider": {}, "job_counter": 0, "window_from": 0, "window_to": 0}

        window_to = job_counter
        window_from = max(1, job_counter - WINDOW + 1)
        ids = list(range(window_from, window_to + 1))

        by_provider: dict[str, dict] = {}
        for i in range(0, len(ids), _CHUNK):
            jobs = await _multicall_getjobs(client, ids[i:i + _CHUNK])
            for job in jobs:
                prov = (job["provider"] or "").lower()
                if not prov or prov == "0x" + "0" * 40:
                    continue
                st = JOB_STATUS[job["status"]] if 0 <= job["status"] < len(JOB_STATUS) else "OPEN"
                p = by_provider.setdefault(prov, {
                    "total": 0, "COMPLETED": 0, "REJECTED": 0, "EXPIRED": 0,
                    "OPEN": 0, "FUNDED": 0, "SUBMITTED": 0,
                    "last_submitted_at": 0, "job_ids": [],
                })
                p["total"] += 1
                p[st] = p.get(st, 0) + 1
                p["job_ids"].append(int(job["id"]))
                if job["submittedAt"] and int(job["submittedAt"]) > p["last_submitted_at"]:
                    p["last_submitted_at"] = int(job["submittedAt"])

    return {"by_provider": by_provider, "job_counter": job_counter,
            "window_from": window_from, "window_to": window_to}


async def _ensure_fresh() -> None:
    if time.time() - _cache["at"] > _TTL_SECONDS or not _cache["by_provider"]:
        scan = await _scan_recent_window()
        _cache.update(scan)
        _cache["at"] = time.time()


async def get_agent_performance(owner_address: str) -> dict:
    """Real on-chain track record for one agent's owner (as ERC-8183 provider),
    from the most-recent WINDOW jobs. Honest zero-history state when none found."""
    owner = (owner_address or "").lower()
    await _ensure_fresh()
    window = {
        "scanned_window": WINDOW,
        "job_counter": _cache["job_counter"],
        "window_from": _cache["window_from"],
        "window_to": _cache["window_to"],
    }
    p = _cache["by_provider"].get(owner)
    if not p:
        return {
            "owner_address": owner_address,
            "hired": False,
            "hire_count": 0,
            **window,
            "note": "No ERC-8183 jobs found for this agent in the most recent "
                    f"{WINDOW} on-chain jobs — not yet hired through this marketplace.",
        }
    settled = p["COMPLETED"] + p["REJECTED"] + p["EXPIRED"]
    active = p["OPEN"] + p["FUNDED"] + p["SUBMITTED"]
    return {
        "owner_address": owner_address,
        "hired": True,
        "hire_count": p["total"],
        "completed": p["COMPLETED"],
        "rejected": p["REJECTED"],
        "expired": p["EXPIRED"],
        "active": active,
        "settled": settled,
        "completion_rate": (p["COMPLETED"] / settled) if settled else None,
        "last_submitted_at": p["last_submitted_at"] or None,
        "recent_job_ids": sorted(p["job_ids"], reverse=True)[:10],
        **window,
        "note": "Real on-chain ERC-8183 outcomes for this agent as the provider, "
                f"from the most recent {WINDOW} jobs.",
    }
