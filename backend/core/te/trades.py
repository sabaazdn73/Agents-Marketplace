"""
trades.py

One wallet's buys and sells of listed tokenized-stock versions, read on
chain: the trade history behind the Dashboard's P/L (pnl.py does the
maths, trades_view.py serves it). Read-only: logs, receipts and balances are
read, nothing is signed.

WHAT IS A TRADE
---------------
Every ERC-20 Transfer of a listed version to or from the wallet is found
(below), and the receipt of its transaction is read. In that receipt:
  - the version's net movement for the wallet (in minus out), and
  - the net movement of the chain's dollar stablecoins for the wallet (the
    pay tokens and the cost engine's stablecoins, chains.py), each counted
    at $1, an assumption about the peg that every answer states.
One version in, stablecoins out: a BUY at the stablecoins paid (a LI.FI fee
taken from the amount paid is inside it). One version out, stablecoins in: a
SELL at the stablecoins received. Anything else is a TRANSFER IN or OUT with
no price: a gift, a bridge, a move between own wallets, a trade paid in
another asset, or several versions in one transaction (a single stablecoin
amount cannot be split between them). Those never get a price, and pnl.py
marks the position's cost basis unknown.

Gas: gasUsed x effectiveGasPrice, plus the L1 data fee on Base (receipt
field l1Fee), in the chain's own coin, counted only when the wallet sent
the transaction. A separate approval transaction's gas is not counted.

HOW THE TRANSFERS ARE FOUND, PER CHAIN
--------------------------------------
eth_getLogs with the wallet as a Transfer topic (topic 2 for transfers in,
topic 1 for transfers out) and no address filter, then kept only where the
emitting contract is a listed version. That one query serves every version
on the chain at once, whatever the universe lists. Each public endpoint caps
the block range of such a query, so:

  bisect   Ethereum, Base, HyperEVM: the endpoints hold full state history,
           and log ranges are short (Base 2,000 blocks; about 21 million
           blocks of history would be 11,000 queries). So the history is
           narrowed first: at a block, the wallet's state is its nonce
           (transactions sent) and its balance of every listed version on
           the chain, read through Multicall3. An interval whose two ends
           have the same state holds no change of holdings and no
           transaction sent by the wallet, and is skipped. Intervals whose
           holdings differ are split first, newest first; intervals where
           only the nonce moved (the wallet sent something but its holdings
           are the same at both ends, so a buy and a full sale inside cannot
           be ruled out) are split after them. An interval no wider than the
           endpoint's log range is read with eth_getLogs. Log ranges measured
           2026-10-01 for queries with no address: mainnet.base.org 2,000
           blocks, rpc.mevblocker.io 10,000 (50,000 answered "service
           temporarily unavailable"), hyperliquid.drpc.org 101 (its error
           text says 10,000).
           A contract wallet's nonce does not count its transactions; for
           one, a buy and a full sale between two reads could be missed, and
           the answer says so.
  logs     Arbitrum: arb1.arbitrum.io answers these queries over tens of
           millions of blocks, so the whole history is read in windows,
           newest first, halved where the endpoint refuses or times out.
  held     Robinhood Chain: its RPC allows 30,000 blocks for a query with
           no address and 10,000,000 with one address, and holds about
           6,000 blocks of state. So only the versions the wallet holds now
           are read, one address at a time; a version already sold in full
           there is not found, and the answer says so.
  none     BNB Chain: no public endpoint serves its log history or old state
           (measured 2026-09-27 and 2026-10-01), so no trade is read there.

Floors: the block Multicall3 was deployed at (eth_getCode, 2026-10-01:
Ethereum 14,353,601, Base 5,022, HyperEVM 13,051), long before any listed
version; Arbitrum and Robinhood Chain from block 0.

BOUNDS
------
The work is resumable and runs in steps: one step reads each chain in its
own thread until a deadline (STEP_SECONDS) or a call budget per chain
(CALLS_PER_STEP), keeps what it found and what is left in a per-wallet job
in this process's memory, and the answer says how far it got. The next
request continues where it stopped; once complete, a later request reads
only the blocks after the last head (the head is held fixed while a search
is under way, so an active wallet's moving nonce does not keep adding work).
Round-trip checks spend at most ROUND_TRIP_CALLS per chain; the ranges left
are reported as not searched. Receipts of transfers already found are read
first in every step, so a chain's trades show while its search goes on, and
a chain is complete only when every receipt is read. Jobs are kept for
JOB_TTL_SECONDS after the last request (a timer drops them), at
most JOBS_MAX wallets, oldest dropped first. Nothing is written to a
database; a stored index of Transfer logs per wallet would remove the
narrowing step and the per-request deadline.
"""

from __future__ import annotations

import concurrent.futures
import datetime as dt
import hashlib
import heapq
import threading
import time
from decimal import Decimal

from eth_abi import encode
from eth_utils import function_signature_to_4byte_selector as _sel, keccak

from .buy_chains import BUY_CHAINS, tx_url
from .chains import CHAINS, _base_endpoints, _ep, discovery_endpoints, rotates
from .holdings import fmt_units, versions_on_buy_chains
from .multicall import MULTICALL3, aggregate3
from .rpcclient import ChainRpc, RpcError, public_reason

TRANSFER = "0x" + keccak(text="Transfer(address,address,uint256)").hex()
BALANCE_OF = _sel("balanceOf(address)")

STEP_SECONDS = 14.0
# Round-trip checks (intervals where only the wallet's nonce moved) may spend
# at most this many calls per chain over a job; what is left is reported as
# not searched, never as searched. Measured 2026-10-01: an active Base wallet
# spent about 2,400 calls on them, a buy-and-hold wallet under 100.
ROUND_TRIP_CALLS = 300
RECEIPTS_FIRST = 40          # receipts read at the start of a step, before searching on
CALLS_PER_STEP = 400
# 29 minutes, so with the timer below (every minute) no job outlives 30.
JOB_TTL_SECONDS = 1740
FRESH_SECONDS = 120          # a complete job answers from memory this long
JOBS_MAX = 128
MAX_TRADES_SERVED = 200

MODES: dict[int, dict] = {
    1: {"mode": "bisect", "floor": 14_353_601, "window": 10_000, "chunk": 900, "min_interval": 0.15},
    8453: {"mode": "bisect", "floor": 5_022, "window": 2_000, "chunk": 400, "min_interval": 0.12},
    999: {"mode": "bisect", "floor": 13_051, "window": 100, "chunk": 600, "min_interval": 0.3},
    42161: {"mode": "logs", "floor": 0, "window": 50_000_000, "min_window": 50_000, "min_interval": 0.12},
    4663: {"mode": "held", "floor": 0, "window": 10_000_000, "min_window": 100_000, "min_interval": 0.5},
    56: {"mode": "none", "reason": (
        "No public endpoint serves BNB Chain's log history or old state (publicnode keeps about 10,000 "
        "blocks of logs and dRPC's free plan no old state; measured 2026-09-27 and 2026-10-01), so no "
        "trade is read there.")},
}

MODE_TEXT = {
    "bisect": ("Transfer logs with this wallet as a topic, in the block ranges where its holdings of listed "
               "versions or its sent-transaction count changed, found by reading both at chosen blocks"),
    "logs": "Transfer logs with this wallet as a topic, over the whole chain history in windows",
    "held": ("Transfer logs with this wallet as a topic, for each version it holds now; a version already "
             "sold in full is not found"),
    "none": "not read",
}


def _iso(t: float | None) -> str | None:
    if t is None:
        return None
    return dt.datetime.fromtimestamp(t, dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _topic(addr: str) -> str:
    return "0x" + "0" * 24 + addr.lower()[2:]


def stables(chain_id: int) -> dict[str, tuple[str, int]]:
    """address -> (symbol, decimals): the pay tokens and the cost engine's
    dollar stablecoins on this chain."""
    out = {a.lower(): (s, d) for s, (a, d) in CHAINS[chain_id]["stables"].items()}
    for t in BUY_CHAINS[chain_id]["pay"]:
        out[t["address"].lower()] = (t["symbol"], t["decimals"])
    return out


# ── endpoints (replaced by the selfcheck) ──────────────────────────────────

def log_endpoints(chain_id: int):
    if chain_id == 8453:
        return discovery_endpoints(8453)
    return {1: [_ep("https://rpc.mevblocker.io")],
            999: [_ep("https://hyperliquid.drpc.org")],
            42161: [_ep("https://arb1.arbitrum.io/rpc")],
            4663: [_ep("https://rpc.mainnet.chain.robinhood.com")]}[chain_id]


def state_endpoints(chain_id: int):
    if chain_id == 8453:
        return [ep for ep in _base_endpoints() if ep.window is None]
    return log_endpoints(chain_id)


def make_rpc(chain_id: int, role: str, deadline: float) -> ChainRpc:
    eps = log_endpoints(chain_id) if role == "logs" else state_endpoints(chain_id)
    return ChainRpc(chain_id, eps, min_interval=MODES[chain_id]["min_interval"], retries_per_endpoint=2,
                    timeout=10.0, deadline=deadline, rotate=rotates(chain_id) and role != "logs")


# ── the per-wallet, per-chain job ──────────────────────────────────────────

class ChainJob:
    """What is known and what is left for one wallet on one chain. Touched
    by one thread at a time (the wallet's step holds Job.lock)."""

    def __init__(self, chain_id: int):
        m = MODES[chain_id]
        self.chain_id = chain_id
        self.mode = m["mode"]
        self.window = m.get("window")
        self.floor = m.get("floor", 0)
        self.head: int | None = None
        self.head_state = None
        self.states: dict[int, tuple] = {}
        self.pending: list = []               # heap of (kind, -hi, lo, hi)
        self.covered_to: int | None = None    # the highest block searched through
        self.logs: dict[tuple, dict] = {}     # (tx, logIndex) -> log
        self.receipts: dict[str, dict] = {}
        self.block_times: dict[int, int] = {}
        self.held_addresses: set[str] = set()
        self.calls = 0
        self.error: str | None = None
        self.contract_wallet: bool | None = None
        self.started = False
        self.rt_calls = 0                     # calls spent on round-trip checks
        self.rt_skipped: list[tuple[int, int]] = []   # round-trip ranges left unsearched

    def missing_receipts(self) -> int:
        return len({k[0] for k in self.logs} - set(self.receipts))

    def remaining(self) -> dict:
        changes = sum(1 for k, *_ in self.pending if k == 0)
        checks = sum(1 for k, *_ in self.pending if k == 1)
        return {"holdings_changes": changes, "round_trip_checks": checks, "receipts": self.missing_receipts()}

    def complete(self) -> bool:
        return (self.started and not self.pending and self.error is None and self.mode != "none"
                and self.missing_receipts() == 0)


def _state(rpc: ChainRpc, chain_id: int, wallet: str, versions: list[dict], block: int) -> tuple:
    """(nonce, digest of every listed version's balance) at one block. A call
    that returns nothing (no code there yet) counts as a zero balance."""
    nonce = int(rpc.call("eth_getTransactionCount", [wallet, hex(block)]), 16)
    calls = [(v["address"], BALANCE_OF + encode(["address"], [wallet])) for v in versions]
    res = aggregate3(rpc, calls, block, chunk=MODES[chain_id]["chunk"]) if calls else []
    h = hashlib.blake2b(digest_size=16)
    for data in res:
        raw = int.from_bytes(data[:32], "big") if data and len(data) >= 32 else 0
        h.update(raw.to_bytes(32, "big"))
    return nonce, h.digest()


def _get_logs(rpc: ChainRpc, lo: int, hi: int, wallet: str, address=None) -> list:
    out = []
    for topics in ([TRANSFER, None, _topic(wallet)], [TRANSFER, _topic(wallet)]):
        f = {"fromBlock": hex(lo), "toBlock": hex(hi), "topics": topics}
        if address:
            f["address"] = address
        res = rpc.call("eth_getLogs", [f])
        if not isinstance(res, list):
            raise RpcError("decode", "eth_getLogs answered no list")
        out += res
    return out


# "service temporarily unavailable" is how rpc.mevblocker.io answers a log
# query too heavy for it (50,000 blocks with no address, 2026-10-01).
_SPLIT_WORDS = ("range", "limit", "too large", "exceed", "timed out", "timeout", "results", "spans", "block count",
                "service temporarily unavailable", "too big")


def _should_split(e: RpcError) -> bool:
    m = (e.message or "").lower()
    return e.kind != "deadline" and any(w in m for w in _SPLIT_WORDS)


def _push(job: ChainJob, kind: int, lo: int, hi: int, leaf: bool = False) -> None:
    """An interval (lo, hi] still to search. A leaf is read with eth_getLogs
    as it is (cut again if the window shrank); any other interval has a known
    state at both ends and is split by reading the state between them."""
    if hi > lo:
        heapq.heappush(job.pending, (kind, -hi, lo, hi, leaf))


def _windows(job: ChainJob, lo: int, hi: int, kind: int = 0) -> None:
    """(lo, hi] cut into log windows, each pushed as its own leaf."""
    w = job.window
    top = hi
    while top > lo:
        bottom = max(lo, top - w)
        _push(job, kind, bottom, top, leaf=True)
        top = bottom


def _keep_logs(job: ChainJob, logs: list, listed: set[str]) -> None:
    for lg in logs:
        if (lg.get("address") or "").lower() not in listed or lg.get("removed"):
            continue
        job.logs[(lg["transactionHash"].lower(), int(lg["logIndex"], 16))] = lg


def _step_bisect(job: ChainJob, srpc: ChainRpc, lrpc: ChainRpc, wallet: str, versions: list[dict],
                 listed: set[str], budget: list[int]) -> None:
    head = srpc.block_number()
    if job.contract_wallet is None:
        job.contract_wallet = len(srpc.call("eth_getCode", [wallet, "latest"]) or "0x") > 2
    if not job.started:
        floor_state = _state(srpc, job.chain_id, wallet, versions, job.floor)
        job.states[job.floor] = floor_state
        top = _state(srpc, job.chain_id, wallet, versions, head)
        job.states[head] = top
        job.started = True
        if top != floor_state:
            _push(job, 0 if top[1] != floor_state[1] else 1, job.floor, head)
        job.head, job.head_state, job.covered_to = head, top, head
    elif not job.pending and head > (job.head or 0):
        # Only once the search below the last head is done: an active
        # wallet's nonce moves every few blocks, and following the head while
        # the search runs kept adding intervals (2026-10-01).
        top = _state(srpc, job.chain_id, wallet, versions, head)
        job.states[head] = top
        prev = job.head_state
        if top != prev:
            _push(job, 0 if top[1] != prev[1] else 1, job.head, head)
        job.head, job.head_state, job.covered_to = head, top, head
    while job.pending and budget[0] > 0:
        kind, _neg, lo, hi, leaf = heapq.heappop(job.pending)
        if kind == 1 and job.rt_calls >= ROUND_TRIP_CALLS:
            job.rt_skipped.append((lo, hi))
            continue
        spent_before = budget[0]
        try:
            if leaf and hi - lo > job.window:
                _windows(job, lo, hi, kind)
                continue
            if leaf or hi - lo <= job.window:
                before = lrpc.stats.calls
                try:
                    _keep_logs(job, _get_logs(lrpc, lo + 1, hi, wallet), listed)
                finally:
                    budget[0] -= lrpc.stats.calls - before
                continue
            mid = (lo + hi) // 2
            before = srpc.stats.calls
            try:
                s = _state(srpc, job.chain_id, wallet, versions, mid)
            finally:
                budget[0] -= srpc.stats.calls - before
            job.states[mid] = s
            for a, b in ((mid, hi), (lo, mid)):
                sa, sb = job.states[a], job.states[b]
                if sa != sb:
                    _push(job, 0 if sa[1] != sb[1] else 1, a, b)
        except RpcError as e:
            if hi - lo <= job.window and _should_split(e) and hi - lo > 1:
                job.window = max(1, (hi - lo) // 2)
                _windows(job, lo, hi, kind)
                continue
            _push(job, kind, lo, hi, leaf)
            raise
        except BaseException:
            _push(job, kind, lo, hi, leaf)
            raise
        finally:
            if kind == 1:
                job.rt_calls += spent_before - budget[0]
    # States no pending interval ends at are no longer needed.
    keep = {job.floor, job.head} | {x for _k, _n, lo, hi, leaf in job.pending if not leaf for x in (lo, hi)}
    for b in [b for b in job.states if b not in keep]:
        del job.states[b]


def _step_logs(job: ChainJob, rpc: ChainRpc, wallet: str, listed: set[str], budget: list[int],
               addresses: list[str] | None = None) -> None:
    head = rpc.block_number()
    if not job.started:
        job.started = True
        if job.mode == "held":
            for a in addresses or []:
                job.held_addresses.add(a)
        _windows(job, job.floor - 1 if job.floor else -1, head)
        job.head, job.covered_to = head, head
    else:
        new = [a for a in (addresses or []) if a not in job.held_addresses]
        if job.mode == "held" and new:
            # A version held now that was not held when the job began: its
            # whole history, for that address only, rides on the same windows.
            job.held_addresses.update(new)
            job.pending.clear()
            _windows(job, -1, head)
        elif head > (job.head or 0):
            _windows(job, job.head, head)
        job.head, job.covered_to = head, head
    min_w = MODES[job.chain_id].get("min_window", 1)
    while job.pending and budget[0] > 0:
        kind, _neg, lo, hi, _leaf = heapq.heappop(job.pending)
        before = rpc.stats.calls
        try:
            if job.mode == "held":
                for a in sorted(job.held_addresses):
                    _keep_logs(job, _get_logs(rpc, lo + 1, hi, wallet, address=a), listed)
            else:
                _keep_logs(job, _get_logs(rpc, lo + 1, hi, wallet), listed)
        except RpcError as e:
            if _should_split(e) and hi - lo > min_w:
                mid = (lo + hi) // 2
                _push(job, kind, mid, hi, leaf=True)
                _push(job, kind, lo, mid, leaf=True)
                continue
            _push(job, kind, lo, hi, leaf=True)
            raise
        except BaseException:
            _push(job, kind, lo, hi, leaf=True)
            raise
        finally:
            budget[0] -= rpc.stats.calls - before


def _receipts(job: ChainJob, rpc: ChainRpc, budget: list[int]) -> None:
    for tx in sorted({k[0] for k in job.logs}):
        if tx in job.receipts:
            continue
        if budget[0] <= 0:
            return
        before = rpc.stats.calls
        try:
            r = rpc.call("eth_getTransactionReceipt", [tx])
            if isinstance(r, dict):
                job.receipts[tx] = r
                b = int(r["blockNumber"], 16)
                if b not in job.block_times:
                    blk = rpc.call("eth_getBlockByNumber", [hex(b), False])
                    if isinstance(blk, dict) and blk.get("timestamp"):
                        job.block_times[b] = int(blk["timestamp"], 16)
        finally:
            budget[0] -= rpc.stats.calls - before


def step_chain(job: ChainJob, wallet: str, held: list[str], deadline: float) -> None:
    """One bounded step on one chain. Errors are kept on the job (a short
    public category), never raised."""
    if job.mode == "none":
        return
    cid = job.chain_id
    versions = versions_on_buy_chains().get(cid) or []
    listed = {v["address"].lower() for v in versions}
    budget = [CALLS_PER_STEP]
    lrpc = make_rpc(cid, "logs", deadline)
    srpc = make_rpc(cid, "state", deadline) if job.mode == "bisect" else lrpc
    job.error = None
    try:
        # Receipts of transfers already found come first, so a chain's trades
        # show while the rest of its history is still being searched.
        _receipts(job, lrpc, [RECEIPTS_FIRST])
        if job.mode == "bisect":
            _step_bisect(job, srpc, lrpc, wallet, versions, listed, budget)
        else:
            _step_logs(job, lrpc, wallet, listed, budget,
                       addresses=[a.lower() for a in held] if job.mode == "held" else None)
        budget[0] = max(budget[0], 60)   # receipts get their own small share
        _receipts(job, lrpc, budget)
    except RpcError as e:
        job.error = public_reason(e)
    except Exception as e:  # noqa: BLE001  the endpoint, not the wallet
        job.error = public_reason(e)
    finally:
        job.calls += lrpc.stats.calls + (srpc.stats.calls if srpc is not lrpc else 0)
        lrpc.close()
        if srpc is not lrpc:
            srpc.close()


# ── pairing a transaction's transfers into trades ──────────────────────────

def trades_of(job: ChainJob, wallet: str) -> list[dict]:
    """Every trade or transfer found on this chain, oldest first."""
    cid = job.chain_id
    w = wallet.lower()
    versions = {v["address"].lower(): v for v in versions_on_buy_chains().get(cid) or []}
    usd_tokens = stables(cid)
    native = CHAINS[cid]["native"]
    out = []
    for tx in sorted({k[0] for k in job.logs}):
        r = job.receipts.get(tx)
        if r is None:
            continue
        if r.get("status") not in (None, "0x1", 1):
            continue
        vnet: dict[str, int] = {}
        snet: dict[str, int] = {}
        first_index = None
        for lg in r.get("logs") or []:
            t = lg.get("topics") or []
            if len(t) < 3 or t[0].lower() != TRANSFER:
                continue
            a = (lg.get("address") or "").lower()
            frm, to = "0x" + t[1][-40:].lower(), "0x" + t[2][-40:].lower()
            if frm != w and to != w:
                continue
            try:
                amt = int(lg.get("data") or "0x0", 16)
            except ValueError:
                continue
            sign = (1 if to == w else 0) - (1 if frm == w else 0)
            if a in versions:
                vnet[a] = vnet.get(a, 0) + sign * amt
                li = int(lg["logIndex"], 16)
                first_index = li if first_index is None else min(first_index, li)
            elif a in usd_tokens:
                snet[a] = snet.get(a, 0) + sign * amt
        vnet = {a: n for a, n in vnet.items() if n}
        if not vnet:
            continue
        usd = sum(Decimal(n).scaleb(-usd_tokens[a][1]) for a, n in snet.items())
        pay = [{"symbol": usd_tokens[a][0], "amount": fmt_units(abs(n), usd_tokens[a][1]),
                "direction": "in" if n > 0 else "out"} for a, n in snet.items() if n]
        block = int(r["blockNumber"], 16)
        gas = None
        if (r.get("from") or "").lower() == w:
            try:
                wei = int(r.get("gasUsed") or "0x0", 16) * int(r.get("effectiveGasPrice") or "0x0", 16)
                l1 = int(r.get("l1Fee") or "0x0", 16) if r.get("l1Fee") else 0
                gas = {"symbol": native, "amount": fmt_units(wei + l1, 18), "wei": str(wei + l1),
                       "l1_fee_wei": str(l1) if l1 else None}
            except (TypeError, ValueError):
                gas = None
        ts = job.block_times.get(block)
        rows = []
        for a, n in sorted(vnet.items()):
            v = versions[a]
            q = Decimal(abs(n)).scaleb(-int(v["decimals"]))
            row = {"chain_id": cid, "chain": BUY_CHAINS[cid]["name"], "key": v["key"], "symbol": v["symbol"],
                   "ticker": v["ticker"], "issuer": v["issuer"], "quantity": format(q.normalize(), "f"),
                   "quantity_raw": str(abs(n)), "block": block, "time": _iso(ts), "tx": tx,
                   "tx_url": tx_url(cid, tx), "log_index": first_index, "pay": pay}
            if len(vnet) == 1 and n > 0 and usd < 0:
                row.update(side="buy", usd=format((-usd).normalize(), "f"))
            elif len(vnet) == 1 and n < 0 and usd > 0:
                row.update(side="sell", usd=format(usd.normalize(), "f"))
            else:
                row.update(side="transfer_in" if n > 0 else "transfer_out", usd=None,
                           reason="several_versions" if len(vnet) > 1 and snet else "no_stablecoin_leg")
            rows.append(row)
        for i, row in enumerate(rows):
            row["gas"] = gas if i == 0 else None
            row["gas_shared"] = len(rows) > 1
        out += rows
    out.sort(key=lambda x: (x["block"], x["log_index"] or 0, x["key"]))
    return out


# ── the jobs ───────────────────────────────────────────────────────────────

class Job:
    def __init__(self, wallet: str):
        self.wallet = wallet
        self.chains = {c: ChainJob(c) for c in BUY_CHAINS}
        self.lock = threading.Lock()
        self.touched = time.monotonic()
        self.stepped_at: float | None = None
        self.read_started_at: float | None = None


_jobs: dict[str, Job] = {}
_jobs_lock = threading.Lock()


def prune() -> int:
    """Drops every job not asked for in JOB_TTL_SECONDS; the count dropped."""
    now = time.monotonic()
    with _jobs_lock:
        old = [k for k, j in _jobs.items() if now - j.touched > JOB_TTL_SECONDS]
        for k in old:
            del _jobs[k]
    return len(old)


def _prune_loop() -> None:
    while True:
        time.sleep(PRUNE_EVERY_SECONDS)
        try:
            prune()
        except Exception:  # noqa: BLE001  never let the timer die
            pass


# A job is kept JOB_TTL_SECONDS after its last request and no longer: this
# timer drops it whether or not another request comes, so what the privacy
# page says about retention holds.
PRUNE_EVERY_SECONDS = 60
threading.Thread(target=_prune_loop, name="trades-prune", daemon=True).start()


def job_for(wallet: str) -> Job:
    w = wallet.lower()
    now = time.monotonic()
    prune()
    with _jobs_lock:
        j = _jobs.get(w)
        if j is None:
            while len(_jobs) >= JOBS_MAX:
                del _jobs[min(_jobs, key=lambda k: _jobs[k].touched)]
            j = _jobs[w] = Job(w)
        j.touched = now
        return j


def is_fresh(job: Job) -> bool:
    return (job.stepped_at is not None and time.monotonic() - job.stepped_at < FRESH_SECONDS
            and all(c.complete() or c.mode == "none" for c in job.chains.values()))


def step(job: Job, held_by_chain: dict[int, list[str]], *, step_s: float = STEP_SECONDS) -> None:
    """Blocking: one step on every chain in parallel threads, under one
    deadline. Call it from a thread."""
    with job.lock:
        deadline = time.monotonic() + step_s
        if job.read_started_at is None:
            job.read_started_at = time.time()
        work = []
        for c in job.chains.values():
            if c.mode == "none":
                continue
            if c.mode == "held" and c.chain_id not in held_by_chain:
                # Which versions to search is what the wallet holds there,
                # and that read did not answer this time.
                c.error = c.error if c.started else "the holdings read did not answer on this chain"
                continue
            work.append(c)
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(work))) as ex:
            list(ex.map(lambda c: step_chain(c, job.wallet, held_by_chain.get(c.chain_id) or [], deadline), work))
        job.stepped_at = time.monotonic()
        job.touched = job.stepped_at


def chain_report(c: ChainJob) -> dict:
    m = MODES[c.chain_id]
    out = {"chain_id": c.chain_id, "chain": BUY_CHAINS[c.chain_id]["name"], "mode": c.mode,
           "method": MODE_TEXT[c.mode]}
    if c.mode == "none":
        return {**out, "status": "not_read", "reason": m["reason"]}
    if not c.started:
        return {**out, "status": "failed" if c.error else "not_started", "reason": c.error}
    rem = c.remaining()
    status = "complete" if c.complete() else (
        "failed" if c.error and not c.pending and not c.missing_receipts() else "partial")
    out.update(status=status, from_block=c.floor, to_block=c.covered_to, remaining=rem, calls=c.calls,
               transfers_found=len(c.logs), receipts_read=len(c.receipts),
               receipts_missing=c.missing_receipts(),
               round_trip_ranges_not_searched=len(c.rt_skipped))
    if c.error:
        out["reason"] = c.error
    if c.mode == "held":
        out["note"] = ("Only the versions held now are searched here; a version bought and sold in full on this "
                       "chain is not found.")
    if c.rt_skipped:
        out["note"] = (f"{len(c.rt_skipped)} block ranges where this wallet sent transactions but its holdings were "
                       "the same at both ends were not searched (the read's limit for them was reached); a buy and a "
                       "sale of the same size inside one would be missed.")
    if c.contract_wallet:
        out["note"] = ("This address is a contract, whose nonce does not count its transactions: a buy and a full "
                       "sale between two reads could be missed.")
    return out
