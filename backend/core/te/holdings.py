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

TOKENS, IN THE SAME BATCH AND AT THE SAME BLOCK
-----------------------------------------------
Beside the versions, each chain's own coin (Multicall3.getEthBalance) and a
short named list of tokens (tokens_on_chain): the pay tokens an order can be
paid with on that chain (buy_chains.py, mirroring trade/chains.js), and the
other named stablecoins the Dashboard used to read in the browser before
2026-09-30 (OTHER_TOKENS below).
They are listed under `tokens`, apart from `holdings`, so the MCP tool and
prepare.py, which read `holdings`, are unchanged. Any other token the wallet
holds is not read, and the answer says so.

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
GET_ETH_BALANCE = _sel("getEthBalance(address)")
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


# Named tokens read beside the pay tokens: the ones the Dashboard read in the
# browser until 2026-09-30 (frontend wallet/evmTokens.js, removed then) that
# are not pay tokens. Each address was read on its own chain on 2026-09-25
# with symbol(), name() and decimals(), and totalSupply() to check it is a
# token in wide use: BNB Chain at block 123,932,916 (USD1, U), Arbitrum One
# at 508,734,602 (USD\u20ae0), Robinhood Chain at 72,155,401 (USDe). Not
# priced: Tnega has no price source for them.
OTHER_TOKENS: dict[int, list[dict]] = {
    56: [{"symbol": "USD1", "name": "World Liberty Financial USD",
          "address": "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d", "decimals": 18},
         {"symbol": "U", "name": "United Stables", "address": "0xce24439f2d9c6a2289f741120fe202248b666666",
          "decimals": 18}],
    42161: [{"symbol": "USD\u20ae0", "name": "USD\u20ae0", "address": "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
             "decimals": 6}],
    4663: [{"symbol": "USDe", "name": "USDe", "address": "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34",
            "decimals": 18}],
}
NATIVE_DECIMALS = 18

# How the versions are read, as the MCP tool tnega_wallet_holdings states it
# (the tool lists versions only, not the tokens read in the same batch).
VERSIONS_METHOD = "balanceOf(wallet) through Multicall3 (" + MULTICALL3 + ") at one block per chain, public RPCs"

TOKEN_SCOPE = ("each chain's own coin, the tokens an order can be paid with there (USDC; USDT and USDC on BNB "
               "Chain; USDG on Robinhood Chain), and USD1 and U on BNB Chain, USD\u20ae0 on Arbitrum and USDe on "
               "Robinhood Chain; any other token is not read")


def tokens_on_chain(chain_id: int) -> list[dict]:
    """The chain's own coin, then its pay tokens, then the other named
    tokens: kind ("native", "pay" or "other"), symbol, name, address (None
    for the coin) and decimals."""
    out = [{"kind": "native", "symbol": COST_CHAINS[chain_id]["native"], "name": None, "address": None,
            "decimals": NATIVE_DECIMALS}]
    out += [{"kind": "pay", "symbol": t["symbol"], "name": None, "address": t["address"],
             "decimals": t["decimals"]} for t in BUY_CHAINS[chain_id]["pay"]]
    out += [{"kind": "other", **t} for t in OTHER_TOKENS.get(chain_id, [])]
    return out


def _balance_call(token: str, wallet: str) -> tuple[str, bytes]:
    return token, BALANCE_OF + encode(["address"], [wallet])


def _token_call(t: dict, wallet: str) -> tuple[str, bytes]:
    if t["kind"] == "native":
        return MULTICALL3, GET_ETH_BALANCE + encode(["address"], [wallet])
    return _balance_call(t["address"], wallet)


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
    tokens = tokens_on_chain(chain_id)
    # versions_checked counts only balances actually answered: a failed
    # chain checked none, whatever it lists (versions_listed).
    base = {"chain_id": chain_id, "chain": name, "versions_listed": len(versions), "tokens_listed": len(tokens)}
    calls = [_balance_call(v["address"], wallet) for v in versions] + [_token_call(t, wallet) for t in tokens]
    try:
        block, ts, res = read_at_block(chain_id, calls, deadline)
    except Exception as e:  # noqa: BLE001  the endpoint, not the wallet
        return {**base, "status": "failed", "reason": public_reason(e), "versions_checked": 0,
                "tokens_checked": 0, "held": [], "tokens": []}
    held, unread = [], 0
    for v, data in zip(versions, res[:len(versions)]):
        if data is None or len(data) < 32:
            unread += 1
            continue
        raw = int.from_bytes(data[:32], "big")
        if raw:
            held.append({"key": v["key"], "symbol": v["symbol"], "ticker": v["ticker"], "issuer": v["issuer"],
                         "chain": name, "chain_id": chain_id, "address": v["address"], "decimals": v["decimals"],
                         "balance_raw": str(raw), "balance": fmt_units(raw, v["decimals"]), "block": block})
    toks, tok_unread = [], 0
    for t, data in zip(tokens, res[len(versions):]):
        if data is None or len(data) < 32:
            tok_unread += 1
            continue
        raw = int.from_bytes(data[:32], "big")
        if raw:
            toks.append({**t, "chain": name, "chain_id": chain_id, "balance_raw": str(raw),
                         "balance": fmt_units(raw, t["decimals"]), "block": block})
    out = {**base, "status": "read", "block": block, "block_time": _iso(ts),
           "versions_checked": len(versions) - unread, "tokens_checked": len(tokens) - tok_unread,
           "held": held, "tokens": toks}
    notes = []
    if not versions:
        notes.append("no listed version on this chain")
    if unread:
        out["versions_unanswered"] = unread
        notes.append(f"{unread} balanceOf calls reverted or returned nothing at this block; those versions are not read")
    if tok_unread:
        out["tokens_unanswered"] = tok_unread
        notes.append(f"{tok_unread} token balance calls returned nothing at this block; those tokens are not read")
    if notes:
        out["note"] = "; ".join(notes)
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
    tokens = [t for c in chains for t in c.pop("tokens")]
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
        "tokens": tokens,
        "chains": chains,
        "coverage": {
            "chains_read": [c["chain"] for c in read],
            "chains_failed": [{"chain": c["chain"], "reason": c["reason"]} for c in failed],
            "versions_checked": sum(c["versions_checked"] for c in read),
            "versions_on_these_chains": sum(len(v) for v in by_chain.values()),
            "partial": bool(failed) or any(c.get("versions_unanswered") or c.get("tokens_unanswered") for c in read),
            "tokens_checked": sum(c["tokens_checked"] for c in read),
            "tokens_on_these_chains": sum(c["tokens_listed"] for c in chains),
            "tokens_scope": TOKEN_SCOPE,
            "scope": ("listed tokenized-stock versions on Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and "
                      "HyperEVM; Solana versions and tokens Tnega does not list are not read"),
        },
        "read_started_at": _iso(started),
        "as_of": min(times) if times else None,
        "as_of_basis": "the oldest block time among the chains read; each chain carries its own block",
        "method": ("balanceOf(wallet), and getEthBalance(wallet) for each chain's own coin, through Multicall3 ("
                   + MULTICALL3 + ") at one block per chain, public RPCs"),
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


def _remember(w: str, out: dict) -> None:
    now = time.monotonic()
    with _cache_lock:
        for k in [k for k, (t, _) in _cache.items() if now - t >= CACHE_SECONDS]:
            del _cache[k]
        while len(_cache) >= CACHE_MAX:
            del _cache[min(_cache, key=lambda k: _cache[k][0])]
        _cache[w] = (now, out)


async def holdings(wallet: str, *, thread_ended=None) -> dict:
    """wallet_holdings off the event loop, cached per wallet for a minute.

    The caller may stop waiting at DEADLINE_S + 1.5 s, but a thread cannot be
    stopped from outside: it ends at its own deadline (every RPC call checks
    it) or when a slow call returns. `thread_ended`, when given, is called
    once, when the read thread has actually ended (or at once when no thread
    was started), so a gate that counts running reads counts that thread
    until it is gone. A read that finishes after its caller gave up is still
    cached, so the next request gets it without reading again."""
    w = wallet.lower()
    hit = cached_answer(w)
    if hit is not None:
        if thread_ended is not None:
            thread_ended()
        return hit
    work = asyncio.ensure_future(asyncio.to_thread(wallet_holdings, w))

    def ended(f: asyncio.Future) -> None:
        if not f.cancelled() and f.exception() is None:
            _remember(w, f.result())
        if thread_ended is not None:
            thread_ended()

    work.add_done_callback(ended)
    out = await asyncio.wait_for(asyncio.shield(work), timeout=DEADLINE_S + 1.5)
    return {**out, "cached_seconds": 0.0}
