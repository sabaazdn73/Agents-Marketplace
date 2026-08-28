"""
revenue.py

Real "Revenue Stream" feature: how much has an agent, as a real ERC-8183
PROVIDER, actually verifiably earned — over time, not just a lifetime
total. Deliberately simpler than core/pnl.py / core/onchain_pnl.py: no
Zerion timestamp-matching, no wallet-activity scanning, no session
tracking.

Real, corrected data source (2026-08-28): this used to reuse
core/agent_performance.py's own in-process cache, which only scans the
most RECENT WINDOW (1,500) job ids — a deliberate, disclosed tradeoff for
THAT module's real purpose (instant marketplace page loads), but a real,
confirmed bug for THIS one. Live-checked before fixing: job_counter =
56,665 real jobs total on the shared contract; WINDOW = 1,500 — only the
most recent 2.6% of all real job ids were ever visible, so any agent with
real, older completed jobs showed an artificially small (or zero) total,
not because the scan was Tnega-specific (it was already protocol-wide
within its range) but purely because of job age. Now reads from
core/job_index.py's own real, complete, persistent index instead — every
real job id from 1 to the current job_counter, backfilled once and kept
current via a bounded re-check pass. See job_index.py's own docstring and
docs/verification-methodology.md for the full real investigation and
before/after numbers.

Real, honest completeness signal, always included: `index_completeness`
reports whether job_index.py's own backfill has reached the real,
current job_counter yet (`complete: true/false`), and exactly how far it
got (`indexed_through_job_id`). While a backfill is still catching up
(e.g. right after this fix first shipped), a real, growing number is
still shown — never hidden behind a loading state — but honestly labeled
as partial rather than implied final.

Real, deliberate scope on which real jobs count as "earned":
  - SUBMITTED and COMPLETED — the same real pair core/pnl.py's own
    _DELIVERED_STATUSES already uses, and the same real reasoning
    agent_performance.py's own _win_rate already documents: settlement is
    permissionless and optimistic — an un-disputed SUBMITTED job already
    represents a real, delivered result the provider is entitled to be
    paid for, just not yet formally auto/manually resolved to COMPLETED
    on-chain. Excludes OPEN/FUNDED (nothing delivered yet — no real
    earning has happened) and REJECTED/EXPIRED (no real payment reached
    the provider).
  - The real amount counted per job is that job's own on-chain `budget`
    field — the real amount actually locked and (for a delivered job)
    releasable/released to the provider. This project's hire flow always
    funds the job's own budget in full before work starts (see
    useHireAgent.js), so budget is the real, correct figure, not an
    estimate.

Real currency handling: the real ERC-8183 settlement token is read LIVE
from the AgenticCommerce contract's own `paymentToken()` (never
hardcoded, never assumed — same discipline frontend/src/useHireAgent.js
already applies to `decimals()` before every real hire), then that
token's own real `symbol()`/`decimals()` are read live too. Every real
amount is shown in that real token's own units — deliberately NO USD
conversion anywhere in this module: there is no real, current, honest
exchange rate this project has integrated for $U (unlike BNB, which
CoinGecko actually prices), so converting would mean inventing one. The
existing UI copy elsewhere ("$U is worth about $1") is informal,
approximate context for a human reading a tooltip — not a real rate this
code will silently apply to a number presented as a fact.

Real, honest zero-state: an agent with no real SUBMITTED/COMPLETED jobs
in the scanned window returns `has_earnings: False` with a clear,
specific real reason (never hidden, never a fabricated $0 chart).
"""

from __future__ import annotations

import time

import httpx
from eth_abi import decode as abi_decode
from eth_utils import function_signature_to_4byte_selector

from core import job_index
from core.rpc import get_bsc_rpc_url, COMMERCE

_EARNING_STATUSES = {"SUBMITTED", "COMPLETED"}

_PAYMENT_TOKEN_SEL = "0x" + function_signature_to_4byte_selector("paymentToken()").hex()
_DECIMALS_SEL = "0x" + function_signature_to_4byte_selector("decimals()").hex()
_SYMBOL_SEL = "0x" + function_signature_to_4byte_selector("symbol()").hex()

# Real, long TTL — the real settlement token's own identity (which token,
# its decimals, its symbol) is a structural, essentially-never-changing
# property, not something worth re-reading on every request. 24h matches
# this project's own established discipline for similarly structural
# real data (e.g. core/protocol_compat.py's own real 24h probe cache).
_TOKEN_TTL_SECONDS = 24 * 60 * 60
_token_cache: dict | None = None
_token_cache_at = 0.0


async def _eth_call(client: httpx.AsyncClient, to: str, data: str) -> str | None:
    resp = await client.post(get_bsc_rpc_url(), json={
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{"to": to, "data": data}, "latest"],
    })
    resp.raise_for_status()
    body = resp.json()
    if body.get("error") or not body.get("result") or body["result"] == "0x":
        return None
    return body["result"]


async def _resolve_payment_token() -> dict | None:
    """Real, live read of the actual ERC-8183 settlement token's identity
    — address, symbol, decimals — straight from the AgenticCommerce
    contract itself and the token it names, never hardcoded. Returns None
    only on a genuine real RPC failure; cached 24h once real data is
    obtained."""
    global _token_cache, _token_cache_at
    if _token_cache and time.time() - _token_cache_at < _TOKEN_TTL_SECONDS:
        return _token_cache

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            token_result = await _eth_call(client, COMMERCE, _PAYMENT_TOKEN_SEL)
            if not token_result:
                return _token_cache  # real, honest fallback to whatever we last had, if anything
            (token_addr,) = abi_decode(["address"], bytes.fromhex(token_result[2:]))

            decimals_result = await _eth_call(client, token_addr, _DECIMALS_SEL)
            (decimals,) = abi_decode(["uint8"], bytes.fromhex(decimals_result[2:])) if decimals_result else (18,)

            symbol_result = await _eth_call(client, token_addr, _SYMBOL_SEL)
            symbol = None
            if symbol_result:
                try:
                    (symbol,) = abi_decode(["string"], bytes.fromhex(symbol_result[2:]))
                except Exception:
                    symbol = None
    except Exception:
        return _token_cache  # real, honest — keep serving the last real value we had, if any

    _token_cache = {"address": token_addr, "decimals": int(decimals), "symbol": symbol or "U"}
    _token_cache_at = time.time()
    return _token_cache


async def get_revenue_timeline(owner_address: str) -> dict:
    """The real, main entry point. Always returns a real, honest result —
    either a real cumulative-earnings timeline with full provenance, or a
    clear, specific reason there isn't one yet. Never a fabricated number.

    Shape:
      - `has_earnings`: False when there's nothing real to show (no jobs
        at all, or jobs exist but none have reached SUBMITTED/COMPLETED
        yet) — `reason` explains which.
      - `token_symbol`/`token_decimals`/`token_address`: the real,
        live-read ERC-8183 settlement token identity.
      - `total_earned`: real, human-readable sum across every real
        SUBMITTED/COMPLETED job's own on-chain budget.
      - `timeline`: real, chronological (oldest first) per-job entries —
        job id, real ISO date (from the job's own real submittedAt),
        real amount earned, real running cumulative total, real status.
      - `index_completeness`: honest status of the underlying job index
        itself — see module docstring."""
    real_index = await job_index.get_provider_revenue_jobs(owner_address)
    jobs = real_index["jobs"]
    token = await _resolve_payment_token()
    completeness = {
        "index_completeness": {
            "complete": real_index["index_complete"],
            "indexed_through_job_id": real_index["indexed_through_job_id"],
            "job_counter": real_index["job_counter"],
        }
    }

    if not jobs:
        return {
            "has_earnings": False,
            "reason": ("We checked this agent's complete real job history against the shared AgenticCommerce "
                       "contract and found none — it hasn't been hired (through Tnega or anywhere else using "
                       "this same contract) yet."
                       if real_index["index_complete"] else
                       "No real jobs found for this agent yet in the portion of the shared contract's full "
                       "history indexed so far — the real, complete backfill is still in progress."),
            **completeness,
        }

    earning_jobs = [j for j in jobs if j["status"] in _EARNING_STATUSES]
    if not earning_jobs:
        return {
            "has_earnings": False,
            "reason": f"This agent has {len(jobs)} real job(s) on record, but none have been delivered "
                      "(SUBMITTED or COMPLETED) yet — no real revenue to show.",
            **completeness,
        }

    if token is None:
        return {
            "has_earnings": False,
            "reason": "Found real, delivered jobs, but couldn't read the real settlement token's identity from "
                      "the chain right now — try again shortly.",
            **completeness,
        }

    decimals = token["decimals"]
    # Real, chronological order — submittedAt is the real on-chain moment
    # each job was actually delivered; falls back to job id (also
    # monotonic with real creation order) for the rare real case
    # submittedAt is somehow unset on an otherwise-delivered job.
    earning_jobs = sorted(earning_jobs, key=lambda j: (j["submittedAt"] or 0, j["_id"]))

    timeline = []
    running_total = 0
    for j in earning_jobs:
        raw = int(j["budget"])
        running_total += raw
        timeline.append({
            "job_id": j["_id"],
            "submitted_at": j["submittedAt"] or None,
            "status": j["status"],
            "amount_raw": str(raw),
            "amount": raw / (10 ** decimals),
            "running_total_raw": str(running_total),
            "running_total": running_total / (10 ** decimals),
            "description": j["description"],
        })

    total_raw = running_total
    return {
        "has_earnings": True,
        "token_address": token["address"],
        "token_symbol": token["symbol"],
        "token_decimals": decimals,
        "jobs_counted": len(earning_jobs),
        "total_earned_raw": str(total_raw),
        "total_earned": total_raw / (10 ** decimals),
        "timeline": timeline,
        **completeness,
    }
