"""
rpc_credits.py

Our own daily count of metered RPC credits, per provider, with a per-chain
breakdown, and a warning in the log when a day passes a share of its budget.

Why our own count. QuickNode meters every call in credits against one pool
shared by every chain on the multichain endpoint, including the Solana reads
still to come. Its dashboard says how much went; this says which of our jobs
spent it, and warns in our own logs before the pool runs out rather than
after.

One document per provider per UTC day, `_id` "<provider>:<YYYY-MM-DD>":

    {provider, day, credits, calls,
     by_chain: {"<chain_id>": {credits, calls}},
     warned: {"80": <epoch>, "100": <epoch>}}

Each call is one atomic `$inc`, so several processes can count into the same
day without losing a call. The warning is claimed with a conditional update,
so it is logged once a day per threshold however many processes cross it.

A failure to count is logged and swallowed. This is an accounting aid for
the indexer, not a ledger anything is charged against, and a Mongo blip must
not stop a read that already happened from being used.

Costs, from QuickNode's published table (agents.md and /api-credits, read
2026-09-25): base credits per chain tier times a method multiplier. Every EVM
chain this project reads (Ethereum, BNB, Base, Arbitrum) is 20 credits, and
eth_getLogs, eth_call and eth_blockNumber are all "Standard", 1x. Solana is
30 at 1x.
"""

from __future__ import annotations

import datetime as dt
import os
import time

COLLECTION = "rpc_credits"

DEFAULT_DAILY_BUDGET = 250_000
WARN_THRESHOLDS = (80, 100)          # percent of the daily budget

# Credits for one Standard (1x) call, by provider and chain.
_EVM_STANDARD = 20
_SOLANA_STANDARD = 30
SOLANA = "solana"


def credits_per_call(provider: str, chain: int | str) -> int:
    if provider != "quicknode":
        return 0
    return _SOLANA_STANDARD if str(chain) == SOLANA else _EVM_STANDARD


def daily_budget(provider: str) -> int:
    """QUICKNODE_CREDITS_PER_DAY for QuickNode, default 250,000."""
    if provider != "quicknode":
        return 0
    try:
        n = int(os.environ.get("QUICKNODE_CREDITS_PER_DAY", ""))
    except ValueError:
        return DEFAULT_DAILY_BUDGET
    return n if n > 0 else DEFAULT_DAILY_BUDGET


def _day(now: float | None = None) -> str:
    return dt.datetime.fromtimestamp(now if now is not None else time.time(),
                                     tz=dt.timezone.utc).strftime("%Y-%m-%d")


def _log(msg: str) -> None:
    print(f"[rpc_credits] {msg}", flush=True)


async def record(db, provider: str, chain: int | str, calls: int = 1,
                 credits: int | None = None, now: float | None = None) -> int | None:
    """Count `calls` metered calls against today's document. Returns the
    day's credit total after this call, or None if the count failed (which
    is logged, never raised)."""
    if db is None or calls <= 0:
        return None
    cost = credits if credits is not None else calls * credits_per_call(provider, chain)
    day = _day(now)
    doc_id = f"{provider}:{day}"
    try:
        col = db[COLLECTION]
        await col.update_one(
            {"_id": doc_id},
            {"$inc": {"credits": cost, "calls": calls,
                      f"by_chain.{chain}.credits": cost, f"by_chain.{chain}.calls": calls},
             "$setOnInsert": {"provider": provider, "day": day}},
            upsert=True,
        )
        doc = await col.find_one({"_id": doc_id}, {"credits": 1, "warned": 1})
        total = int((doc or {}).get("credits") or 0)
        budget = daily_budget(provider)
        if budget:
            for pct in WARN_THRESHOLDS:
                if total * 100 < budget * pct:
                    continue
                # Claimed, not checked: only the update that sets the flag
                # logs, so the warning appears once a day per threshold.
                claim = await col.update_one(
                    {"_id": doc_id, f"warned.{pct}": {"$exists": False}},
                    {"$set": {f"warned.{pct}": int(time.time())}},
                )
                if getattr(claim, "modified_count", 0):
                    _log(f"WARNING {provider} {day}: {total:,} credits used, {pct}% of the "
                         f"{budget:,} daily budget (latest: chain {chain}).")
        return total
    except Exception as e:  # noqa: BLE001 -- counting must not stop the read
        _log(f"could not count {calls} {provider} call(s) for chain {chain}: "
             f"{type(e).__name__}")
        return None


async def today(db, provider: str, now: float | None = None) -> dict:
    """Today's document, or an empty count. For a status view or a check."""
    doc = await db[COLLECTION].find_one({"_id": f"{provider}:{_day(now)}"})
    return doc or {"provider": provider, "day": _day(now), "credits": 0, "calls": 0}
