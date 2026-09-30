"""What tokenized stocks one wallet holds, read on chain.

balanceOf(wallet) on every listed version on the chains an order can be
prepared on (buy_chains.BUY_CHAINS), through Multicall3 at one pinned block
per chain, on the same public endpoints the cost engine uses (chains.py;
never a keyed endpoint). Read-only: a balance is read, nothing is signed.

WHAT AN ANSWER SAYS ABOUT ITSELF
--------------------------------
Only nonzero balances are listed, and a zero is never written: a version not
listed is either read and zero, or on a chain that could not be read, and
`chains` says which chains were read, at which block, and which failed and
why. A chain that failed is a fact about this call, not about the wallet.

Versions outside the listed universe (a token Tnega does not list, a Solana
version, a chain outside BUY_CHAINS) are not read, and the answer says so.

COST. About 5,900 balanceOf calls across six chains, in chunks of 400 per
eth_call: about 16 calls, the chains in parallel threads, under a deadline.
Answers are cached per wallet for 60 seconds in this process, at most
CACHE_MAX wallets, oldest dropped first.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import datetime as dt
import threading
import time
from decimal import Decimal

from eth_abi import encode
from eth_utils import function_signature_to_4byte_selector as _sel

from .buy_chains import BUY_CHAINS
from .chains import CHAINS as COST_CHAINS, latest_endpoints, rotates
from .multicall import MULTICALL3, aggregate3
from .rpcclient import ChainRpc, RpcError, public_reason
from .universe import ISSUER_NAMES, load_universe

BALANCE_OF = _sel("balanceOf(address)")
CHUNK = 400
# The whole read, every chain, inside one MCP call that holds the server's
# one-call gate: measured at about 3 s on 2026-09-28, so 9 s leaves room for
# a slow endpoint and still answers in about 10.
DEADLINE_S = 9.0
CACHE_SECONDS = 60
CACHE_MAX = 256

_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def _iso(t: float | None) -> str | None:
    if t is None:
        return None
    return dt.datetime.fromtimestamp(t, dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def fmt_units(raw: int, decimals: int) -> str:
    """An integer amount in token units as a plain decimal string, exact."""
    d = Decimal(raw).scaleb(-int(decimals))
    s = format(d, "f")
    return s.rstrip("0").rstrip(".") if "." in s else s


def versions_on_buy_chains() -> dict[int, list[dict]]:
    """Every listed version on each BUY_CHAIN: key, address, symbol, ticker,
    name, issuer, decimals."""
    u = load_universe()

    def build():
        out: dict[int, list[dict]] = {c: [] for c in BUY_CHAINS}
        for i in u.listed_indices():
            r = u.row(i)
            key = r["key"]
            head = key.split("/", 1)[0]
            if not head.isdigit() or int(head) not in BUY_CHAINS:
                continue
            out[int(head)].append({
                "key": key, "address": r["address"], "symbol": r["symbol"], "ticker": r["ticker"],
                "issuer": ISSUER_NAMES.get(r["issuer"], r["issuer"]), "decimals": r["decimals"],
            })
        return out
    return u.memo(("buy_chain_versions",), build)


def _balance_call(token: str, wallet: str) -> tuple[str, bytes]:
    return token, BALANCE_OF + encode(["address"], [wallet])


def read_at_block(chain_id: int, calls: list[tuple[str, bytes]], deadline: float) -> tuple[int, int | None, list]:
    """(block, block timestamp or None, return data per call) at one pinned block."""
    rpc = ChainRpc(chain_id, latest_endpoints(chain_id), min_interval=COST_CHAINS[chain_id]["min_interval"],
                   retries_per_endpoint=2, timeout=6.0, deadline=deadline, rotate=rotates(chain_id))
    try:
        block = rpc.block_number()
        res = aggregate3(rpc, calls, block, chunk=CHUNK)
        ts = None
        try:
            b = rpc.call("eth_getBlockByNumber", [hex(block), False])
            ts = int(b["timestamp"], 16) if isinstance(b, dict) and b.get("timestamp") else None
        except (RpcError, ValueError, TypeError):
            ts = None
        return block, ts, res
    finally:
        rpc.close()


def _read_chain(chain_id: int, versions: list[dict], wallet: str, deadline: float) -> dict:
    name = BUY_CHAINS[chain_id]["name"]
    base = {"chain_id": chain_id, "chain": name, "versions_checked": len(versions)}
    if not versions:
        return {**base, "status": "read", "block": None, "block_time": None, "held": [],
                "note": "no listed version on this chain"}
    try:
        block, ts, res = read_at_block(chain_id, [_balance_call(v["address"], wallet) for v in versions], deadline)
    except Exception as e:  # noqa: BLE001  the endpoint, not the wallet
        return {**base, "status": "failed", "reason": public_reason(e), "held": []}
    held, unread = [], 0
    for v, data in zip(versions, res):
        if data is None or len(data) < 32:
            unread += 1
            continue
        raw = int.from_bytes(data[:32], "big")
        if raw:
            held.append({"key": v["key"], "symbol": v["symbol"], "ticker": v["ticker"], "issuer": v["issuer"],
                         "chain": name, "chain_id": chain_id, "address": v["address"], "decimals": v["decimals"],
                         "balance_raw": str(raw), "balance": fmt_units(raw, v["decimals"]), "block": block})
    out = {**base, "status": "read", "block": block, "block_time": _iso(ts), "held": held}
    if unread:
        out["versions_unanswered"] = unread
        out["note"] = f"{unread} balanceOf calls reverted or returned nothing at this block; those versions are not read"
    return out


def wallet_holdings(wallet: str, *, deadline_s: float = DEADLINE_S) -> dict:
    """Blocking: every chain in parallel threads. Call it from a thread, or
    use holdings() from async code."""
    w = wallet.lower()
    by_chain = versions_on_buy_chains()
    deadline = time.monotonic() + deadline_s
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(BUY_CHAINS)) as ex:
        futs = {c: ex.submit(_read_chain, c, by_chain.get(c) or [], w, deadline) for c in BUY_CHAINS}
        chains = [futs[c].result() for c in BUY_CHAINS]
    held = [h for c in chains for h in c.pop("held")]
    held.sort(key=lambda h: (h["ticker"] or "", h["chain_id"], h["key"]))
    read = [c for c in chains if c["status"] == "read"]
    failed = [c for c in chains if c["status"] == "failed"]
    times = [c["block_time"] for c in read if c.get("block_time")]
    # What the answer can claim. "unavailable": no chain answered, so nothing
    # is known about the wallet. "partial": some chains answered; a version
    # not listed may be on a chain that did not.
    status = "unavailable" if not read else ("partial" if failed else "read")
    return {
        "wallet": w,
        "status": status,
        "holdings": held,
        "chains": chains,
        "coverage": {
            "chains_read": [c["chain"] for c in read],
            "chains_failed": [{"chain": c["chain"], "reason": c["reason"]} for c in failed],
            "versions_checked": sum(c["versions_checked"] for c in read),
            "versions_on_these_chains": sum(len(v) for v in by_chain.values()),
            "partial": bool(failed) or any(c.get("versions_unanswered") for c in read),
            "scope": ("listed tokenized-stock versions on Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and "
                      "HyperEVM; Solana versions and tokens Tnega does not list are not read"),
        },
        "read_started_at": _iso(started),
        "as_of": min(times) if times else None,
        "as_of_basis": "the oldest block time among the chains read; each chain carries its own block",
        "method": "balanceOf(wallet) through Multicall3 (" + MULTICALL3 + ") at one block per chain, public RPCs",
    }


def cached_answer(wallet: str) -> dict | None:
    """The cached answer for this wallet while it is under a minute old, or
    None. Spends nothing: the site's route asks this before it admits a new
    read."""
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(wallet.lower())
        if hit and now - hit[0] < CACHE_SECONDS:
            return {**hit[1], "cached_seconds": round(now - hit[0], 1)}
    return None


async def holdings(wallet: str) -> dict:
    """wallet_holdings off the event loop, cached per wallet for a minute."""
    w = wallet.lower()
    now = time.monotonic()
    hit = cached_answer(w)
    if hit is not None:
        return hit
    out = await asyncio.wait_for(asyncio.to_thread(wallet_holdings, w), timeout=DEADLINE_S + 1.5)
    with _cache_lock:
        for k in [k for k, (t, _) in _cache.items() if now - t >= CACHE_SECONDS]:
            del _cache[k]
        while len(_cache) >= CACHE_MAX:
            del _cache[min(_cache, key=lambda k: _cache[k][0])]
        _cache[w] = (time.monotonic(), out)
    return {**out, "cached_seconds": 0.0}
