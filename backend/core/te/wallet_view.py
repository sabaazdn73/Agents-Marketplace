"""
wallet_view.py

What the Dashboard shows of one wallet's tokenized stocks and ETFs, and of
its coins and named stablecoins on the same chains: the backing for POST
/api/wallet/holdings (te/wallet_router.py).

THE READ IS holdings.py's, UNCHANGED
balanceOf(wallet) on every listed version on the six buy chains (Ethereum,
Base, Arbitrum, BNB Chain, Robinhood Chain, HyperEVM) through Multicall3 at
one block per chain, on the cost engine's endpoints (chains.py: public ones,
and on Base the server's own BASE_RPC_URL first when it is set), cached per wallet
for 60 s. It is the same reader the MCP tool tnega_wallet_holdings uses, so
the site and the tool cannot disagree about what a wallet holds.

WHAT THIS ADDS
  type    stock or ETF, from the universe file's underlying record: the same
          field /api/te/list filters the Stocks and ETFs lists on. An
          underlying the file has no type for is served under `untyped`,
          never guessed into either list.
  name    the underlying's name from the same record (the ticker alone when
          the file has none).
  value   balance x a price only when our own cost store has one for that
          exact version: the pre-trade mid of the version's deepest measured
          pool (ref_mid_usd, or the mid of pool 0 in records written before
          that field), at the block and time the cost worker read it, with
          the pool's stablecoin counted at $1. No other price is used. A
          version without one, or whose price is older than
          PRICE_MAX_AGE_SECONDS, or when the store cannot be read, has
          value null and a value_reason code, explained in `reasons`.

TOKENS (`tokens`, read by holdings.py in the same batch and block)
  each chain's own coin, the pay tokens and a few other named stablecoins
  (holdings.tokens_on_chain). Values:
    pay tokens    counted at $1, labelled as an assumption about the peg,
                  as the rest of the site does (buy_chains.py).
    own coin      balance x native_usd from gasusd.py: a 30-minute average
                  from one pool on chain (ETH: Uniswap V3 USDC/WETH on
                  Ethereum; BNB: PancakeSwap v3 WBNB/USDT; HYPE: WHYPE/USDC
                  on HyperEVM), the read the cost engine prices network fees
                  with. Read here at most once per NATIVE_CACHE_SECONDS per
                  coin, one refresh at a time, on its own deadline, and only
                  when a wallet holds that coin; a price older than
                  NATIVE_MAX_AGE_SECONDS is not used. Without one the balance
                  is shown with no value and a reason.
    other tokens  no value: Tnega has no price source for them.

WHAT AN ANSWER SAYS ABOUT ITSELF
Only nonzero balances are listed. `chains` lists every chain with its status:
read (with block and block time) or failed (with the provider's reason). A
failed chain is reported, never shown as holding nothing; `status` is
"partial" when any chain failed and "unavailable" when none answered.

THE ADDRESS
It arrives in a POST body, is used for the reads, and is a cache key in
process memory for 60 s (holdings.py). It is not written to any store, not
logged, and not echoed in the response. It does reach those RPC providers
inside the eth_call data, as balanceOf's argument (the privacy page names
them).

THE RATE BUDGET
An uncached read is about 28 requests to public RPC providers across six
chains (a block number, about 16 Multicall3 batches and a block header), from
this process's IP, which the MCP tool shares. So an uncached read is admitted
only when fewer than MAX_CONCURRENT_READS are running and fewer than
READS_PER_MINUTE started in the last minute; otherwise the route answers 429
at once with Retry-After, and nothing is spent. One client (by the network
address the rate limiter keys on, core/rate_limit.py) may start at most
CLIENT_READS_PER_MINUTE of those, so one visitor cannot spend the whole
budget. A read counts as running until its thread has ended, not until the
caller stopped waiting (holdings.holdings, thread_ended), so no more than
MAX_CONCURRENT_READS reads are ever in flight. A second request for a wallet
already being read waits for that read instead of starting another. Cached
answers are not limited.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import datetime as dt
import json
import re
import threading
import time
from collections import deque
from decimal import Decimal, InvalidOperation

from core import wallet_hash

from . import gasusd
from . import holdings as holdings_mod
from .chains import CHAINS as COST_CHAINS, latest_endpoints, rotates
from .rpcclient import ChainRpc
from .universe import load_universe

# {"address": "0x" + 40 hex} is 53 bytes; the rest is room for whitespace.
MAX_BODY_BYTES = 256

MAX_CONCURRENT_READS = 3
READS_PER_MINUTE = 20
CLIENT_READS_PER_MINUTE = 6
CLIENTS_MAX = 4096
WINDOW_SECONDS = 60.0

# The own-coin price (gasusd.native_usd): kept this long, never used older
# than NATIVE_MAX_AGE_SECONDS, and waited for at most NATIVE_WAIT_SECONDS by
# a request (the refresh goes on in its one thread and answers the next).
NATIVE_CACHE_SECONDS = 300
NATIVE_MAX_AGE_SECONDS = 900
NATIVE_RETRY_SECONDS = 60
NATIVE_WAIT_SECONDS = 4.0
NATIVE_DEADLINE_SECONDS = 8.0

# A cost-store price older than this is not used for a value. The cost
# worker rewrites each version at most 15 minutes apart while it runs, so a
# day-old price means the worker stopped, not that the market was quiet.
PRICE_MAX_AGE_SECONDS = 86_400
STORE_TIMEOUT_SECONDS = 3.0

SCOPE = ("Listed tokenized-stock and ETF versions on Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and "
         "HyperEVM, and on the same chains " + holdings_mod.TOKEN_SCOPE + ". Solana is not read.")

STABLE_BASIS = ("counted at $1 per token: an assumption that the stablecoin holds its peg, not a price Tnega "
                "read")
NATIVE_BASIS = ("balance x a 30-minute average price of the coin from one pool, read on chain by Tnega (the "
                "read its cost engine prices network fees with), with the pool's stablecoin counted at $1")

PRICE_BASIS = ("balance x the pre-trade mid of this version's deepest measured pool, read by Tnega's cost engine "
               "at the block shown, with the pool's stablecoin counted at $1. A mid price, not what a sale "
               "would receive after fees and price impact.")

REASONS = {
    "no_measured_price": (
        "Tnega's cost engine has no measured pool price for this version, so no dollar value is shown."),
    "price_on_hold": (
        "How many shares one token stands for has changed, or is about to, on chain. Tnega does not price "
        "a version within 15 minutes of such a change, counted from when a price run first sees it; the "
        "value returns at the first run after that, usually within 30 minutes (runs are about every 15 "
        "minutes). The balance is unaffected."),
    "price_too_old": (
        "The last pool price measured for this version is more than a day old, so no dollar value is shown."),
    "price_store_unavailable": (
        "Tnega's stored prices could not be read just now, so no dollar value is shown. The balance is "
        "unaffected."),
    "native_price_unavailable": (
        "The on-chain price of this coin could not be read just now, so no dollar value is shown. The balance "
        "is unaffected."),
    "no_price_source": (
        "Tnega has no price source for this token, so no dollar value is shown."),
    "another_read_in_progress": (
        "This server is reading other wallets right now. Retry in a few seconds."),
    "route_rate_budget": (
        "This server's share of the public chain providers' rate limits is spent for the minute. That is "
        "about the server, not the address. Retry after the time given."),
    "client_rate_budget": (
        "This network has started several new wallet reads in the last minute. Retry after the time given; "
        "an address read in the last minute is answered at once."),
}
BUSY_REASONS = ("another_read_in_progress", "route_rate_budget", "client_rate_budget")


class Busy(Exception):
    """Refused before any read, not queued. `reason` is one of BUSY_REASONS."""

    def __init__(self, reason: str, retry_after: int):
        assert reason in BUSY_REASONS, reason
        super().__init__(reason)
        self.reason = reason
        self.retry_after = max(1, int(retry_after))
        self.detail = REASONS[reason]


def parse_body(raw: bytes) -> str | None:
    """The address from a POST /api/wallet/holdings body, lowercased, or None.
    The /api/wallet/habits contract: one None for every malformed body, so the
    route's one fixed 400 repeats nothing that was sent."""
    if not raw or len(raw) > MAX_BODY_BYTES:
        return None
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(body, dict) or set(body) != {"address"} or not isinstance(body["address"], str):
        return None
    value = body["address"].strip()
    return value.lower() if wallet_hash.is_address(value) else None


# ── the gate ────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_running = 0
_started: deque[float] = deque()
_client_started: dict[str, deque] = {}
_inflight: dict[str, asyncio.Future] = {}


def _prune(q: deque, now: float) -> None:
    while q and now - q[0] >= WINDOW_SECONDS:
        q.popleft()


def _admit(now: float, client: str | None = None) -> None:
    global _running
    with _lock:
        _prune(_started, now)
        mine = _client_started.get(client) if client is not None else None
        if mine is not None:
            _prune(mine, now)
        if _running >= MAX_CONCURRENT_READS:
            raise Busy("another_read_in_progress", 3)
        if mine is not None and len(mine) >= CLIENT_READS_PER_MINUTE:
            raise Busy("client_rate_budget", WINDOW_SECONDS - (now - mine[0]) + 1)
        if len(_started) >= READS_PER_MINUTE:
            raise Busy("route_rate_budget", WINDOW_SECONDS - (now - _started[0]) + 1)
        _running += 1
        _started.append(now)
        if client is not None:
            if mine is None:
                if len(_client_started) >= CLIENTS_MAX:
                    for k in [k for k, q in _client_started.items() if not q or now - q[-1] >= WINDOW_SECONDS]:
                        del _client_started[k]
                    while len(_client_started) >= CLIENTS_MAX:
                        del _client_started[min(_client_started, key=lambda k: _client_started[k][-1])]
                mine = _client_started[client] = deque()
            mine.append(now)


def _release() -> None:
    global _running
    with _lock:
        _running = max(0, _running - 1)


async def read(wallet: str, *, reader=None, client: str | None = None) -> dict:
    """holdings.py's answer for this wallet: from its cache, from a read
    already running for it, or from a new read if the gate admits one.
    Raises Busy when it does not; asyncio.TimeoutError past the read's
    deadline. `client` is the requester's rate-limit key (None: no per-client
    count)."""
    w = wallet.lower()
    hit = holdings_mod.cached_answer(w)
    if hit is not None:
        return hit
    running = _inflight.get(w)
    if running is not None:
        return await asyncio.shield(running)
    _admit(time.monotonic(), client)
    freed = []

    def release_once() -> None:
        if not freed:
            freed.append(True)
            _release()

    # The slot is freed when the read's THREAD ends (holdings.holdings calls
    # thread_ended then), not when a caller stops waiting at the timeout: a
    # thread cannot be stopped from outside, so until it ends it is still a
    # read in flight. A reader passed in (the selfcheck's) has no thread, and
    # its slot is freed when it returns.
    try:
        if reader is None:
            fut = asyncio.ensure_future(holdings_mod.holdings(w, thread_ended=release_once))
        else:
            fut = asyncio.ensure_future(reader(w))
    except BaseException:
        release_once()
        raise

    def done(f: asyncio.Future) -> None:
        _inflight.pop(w, None)
        if reader is not None:
            release_once()
        if not f.cancelled():
            f.exception()  # retrieved here, so an error is not reported twice

    _inflight[w] = fut
    fut.add_done_callback(done)
    return await asyncio.shield(fut)


# ── the own-coin price ─────────────────────────────────────────────────────

_native_lock = threading.Lock()
_native_cache: dict[str, tuple[float, dict]] = {}   # symbol -> (monotonic, price)
_native_failed: dict[str, float] = {}               # symbol -> monotonic of the last failure
_native_job: concurrent.futures.Future | None = None
_native_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="native-usd")


def read_native_price(symbol: str) -> dict:
    """Blocking: gasusd.native_usd for ETH, BNB or HYPE at the latest block,
    on the cost engine's public endpoints, under its own deadline."""
    ref = gasusd.NATIVE_REF[symbol]
    cid = ref["chain_id"]
    rpc = ChainRpc(cid, latest_endpoints(cid), min_interval=COST_CHAINS[cid]["min_interval"],
                   retries_per_endpoint=2, timeout=5.0, deadline=time.monotonic() + NATIVE_DEADLINE_SECONDS,
                   rotate=rotates(cid))
    try:
        p = gasusd.native_usd(rpc, symbol, rpc.block_number())
    finally:
        rpc.close()
    return {**p, "read_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")}


def _refresh_native(symbols: list[str]) -> None:
    """One refresh at a time (the caller holds _native_job); the coins in it
    are read side by side, each on its own chain and deadline."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(symbols))) as ex:
        list(ex.map(_refresh_one, symbols))


def _refresh_one(sym: str) -> None:
    try:
        price = read_native_price(sym)
        usd = float(price.get("usd") or 0)
        if not usd > 0:
            raise ValueError("no price")
    except Exception:  # noqa: BLE001  a price we cannot read is withheld, not guessed
        with _native_lock:
            _native_failed[sym] = time.monotonic()
        return
    with _native_lock:
        _native_cache[sym] = (time.monotonic(), {**price, "usd": usd})
        _native_failed.pop(sym, None)


async def native_prices(symbols: list[str]) -> dict[str, dict]:
    """{symbol: price} for the coins with a price read in the last
    NATIVE_MAX_AGE_SECONDS; a coin missing from the answer has none."""
    global _native_job
    wanted = [s for s in symbols if s in gasusd.NATIVE_REF]
    now = time.monotonic()
    with _native_lock:
        due = [s for s in wanted
               if not (s in _native_cache and now - _native_cache[s][0] < NATIVE_CACHE_SECONDS)
               and now - _native_failed.get(s, -1e18) >= NATIVE_RETRY_SECONDS]
        job = None
        if due:
            if _native_job is None or _native_job.done():
                _native_job = _native_pool.submit(_refresh_native, due)
            job = _native_job
    if job is not None:
        try:
            await asyncio.wait_for(asyncio.shield(asyncio.wrap_future(job)), timeout=NATIVE_WAIT_SECONDS)
        except (asyncio.TimeoutError, Exception):  # noqa: BLE001  the price, not the wallet
            pass
    now = time.monotonic()
    out = {}
    with _native_lock:
        for s in wanted:
            hit = _native_cache.get(s)
            if hit and now - hit[0] < NATIVE_MAX_AGE_SECONDS:
                out[s] = {**hit[1], "age_seconds": int(now - hit[0])}
    return out


# ── prices ──────────────────────────────────────────────────────────────────

def _parse_iso(s: str | None) -> float | None:
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def price_of(doc: dict | None, now: float) -> tuple[dict | None, str | None]:
    """(price, None) or (None, reason code) for one stored cost record."""
    if doc and doc.get("state") == "held":
        return None, "price_on_hold"
    if not doc or doc.get("state") not in ("measured", "partial"):
        return None, "no_measured_price"
    mid = doc.get("ref_mid_usd")
    if not mid:
        # Records written before ref_mid_usd: the mid of pool 0, which is the
        # deepest passing pool (cost.rank keeps it first), wherever a size
        # was quoted on it.
        for p, m in zip(doc.get("pool") or [], doc.get("mid_usd") or []):
            if p == 0 and m:
                mid = m
                break
    try:
        mid = float(mid) if mid else None
    except (TypeError, ValueError):
        mid = None
    if not mid or mid <= 0:
        return None, "no_measured_price"
    at = _parse_iso(doc.get("computed_at"))
    if at is None or now - at > PRICE_MAX_AGE_SECONDS:
        return None, "price_too_old"
    return {"price_usd": mid, "block": doc.get("block"), "computed_at": doc.get("computed_at"),
            "age_seconds": int(now - at)}, None


async def stored_prices(store, tickers: list[str]) -> tuple[dict[str, dict], bool]:
    """({key: cost record}, ok) for every version of these underlyings.
    ok False when the store could not be read in time."""
    if not tickers:
        return {}, True
    try:
        lists = await asyncio.wait_for(asyncio.gather(*(store.costs_for(t) for t in tickers)),
                                       timeout=STORE_TIMEOUT_SECONDS)
    except Exception:  # noqa: BLE001  the store, not the wallet
        return {}, False
    return {d.get("key"): d for docs in lists for d in (docs or []) if isinstance(d, dict)}, True


# ── the answer ──────────────────────────────────────────────────────────────

def _value(balance: str, price: float) -> float | None:
    try:
        return float((Decimal(balance) * Decimal(str(price))).quantize(Decimal("0.0001")))
    except (InvalidOperation, ValueError):
        return None


def _public_label(label: str | None) -> str | None:
    """A pool label as a visitor reads it: without the internal file name
    gasusd.py keeps in some labels, e.g. " (core/bnb_usd.py)"."""
    return re.sub(r"\s*\([^()]*\.py\)", "", label).strip() if label else label


def _token_row(t: dict, native: dict[str, dict]) -> dict:
    cid = t.get("chain_id")
    row = {
        "key": f"{cid}/native" if t.get("kind") == "native" else f"{cid}/{t.get('address')}",
        "kind": t.get("kind"), "symbol": t.get("symbol"), "name": t.get("name"), "chain": t.get("chain"),
        "chain_id": cid, "address": t.get("address"), "decimals": t.get("decimals"),
        "balance": t.get("balance"), "balance_raw": t.get("balance_raw"), "block": t.get("block"),
        "type": "token", "value_usd": None, "price": None, "value_reason": None,
    }
    if t.get("kind") == "pay":
        row["value_usd"] = _value(t.get("balance") or "0", 1.0)
        row["price"] = {"price_usd": 1.0, "source": "stablecoin_at_one_dollar", "assumption": True,
                        "basis": STABLE_BASIS}
    elif t.get("kind") == "native":
        p = native.get(t.get("symbol") or "")
        if p:
            row["value_usd"] = _value(t.get("balance") or "0", p["usd"])
            row["price"] = {"price_usd": p["usd"], "source": "onchain_twap", "pool_label": _public_label(p.get("source")),
                            "pool": p.get("pool"), "pool_chain_id": p.get("chain_id"), "block": p.get("block"),
                            "window_seconds": p.get("window_seconds"), "read_at": p.get("read_at"),
                            "age_seconds": p.get("age_seconds"), "basis": NATIVE_BASIS}
        else:
            row["value_reason"] = "native_price_unavailable"
    else:
        row["value_reason"] = "no_price_source"
    return row


def shape(h: dict, docs: dict[str, dict], store_ok: bool, now: float | None = None,
          native: dict[str, dict] | None = None) -> dict:
    """The route's body from holdings.py's answer, the stored cost records and
    the own-coin prices. Pure: no read happens here."""
    now = time.time() if now is None else now
    native = native or {}
    u = load_universe()
    groups: dict[str, list] = {"stock": [], "etf": [], "untyped": []}
    used: set[str] = set()
    for r in h.get("holdings") or []:
        info = u.underlying(r.get("ticker") or "") or {}
        typ = info.get("type") if info.get("type") in ("stock", "etf") else None
        row = {
            "key": r["key"], "symbol": r["symbol"], "name": info.get("name") or r.get("ticker"),
            "ticker": r.get("ticker"), "issuer": r.get("issuer"), "chain": r.get("chain"),
            "chain_id": r.get("chain_id"), "address": r.get("address"), "decimals": r.get("decimals"),
            "balance": r.get("balance"), "balance_raw": r.get("balance_raw"), "block": r.get("block"),
            "type": typ, "value_usd": None, "price": None, "value_reason": None,
        }
        if not store_ok:
            row["value_reason"] = "price_store_unavailable"
        else:
            price, why = price_of(docs.get(r["key"]), now)
            if price:
                row["value_usd"] = _value(r.get("balance") or "0", price["price_usd"])
                row["price"] = {**price, "source": "tnega_cost_engine", "basis": PRICE_BASIS}
            else:
                row["value_reason"] = why
        if row["value_reason"]:
            used.add(row["value_reason"])
        groups[typ or "untyped"].append(row)

    tokens = [_token_row(t, native) for t in h.get("tokens") or []]
    tokens.sort(key=lambda r: (r["value_usd"] is None, -(r["value_usd"] or 0), r["chain_id"] or 0, r["key"]))
    used.update(r["value_reason"] for r in tokens if r["value_reason"])

    def total(rows: list) -> dict:
        priced = [r["value_usd"] for r in rows if r["value_usd"] is not None]
        return {"value_usd": round(sum(priced), 4) if priced else None, "rows": len(rows),
                "rows_priced": len(priced)}

    chains = []
    for c in h.get("chains") or []:
        out = {"chain_id": c["chain_id"], "chain": c["chain"], "status": c["status"],
               "versions_checked": c.get("versions_checked"), "versions_listed": c.get("versions_listed"),
               "tokens_checked": c.get("tokens_checked"), "tokens_listed": c.get("tokens_listed")}
        if c["status"] == "read":
            out.update(block=c.get("block"), block_time=c.get("block_time"))
            for k in ("versions_unanswered", "tokens_unanswered", "note"):
                if c.get(k):
                    out[k] = c[k]
        else:
            out["reason"] = c.get("reason")
        chains.append(out)
    everything = groups["stock"] + groups["etf"] + groups["untyped"] + tokens
    return {
        "status": h.get("status"),
        "stocks": groups["stock"],
        "etfs": groups["etf"],
        "untyped": groups["untyped"],
        "tokens": tokens,
        "totals": {"stocks": total(groups["stock"]), "etfs": total(groups["etf"]),
                   "untyped": total(groups["untyped"]), "tokens": total(tokens), "all": total(everything),
                   "basis": "the sum of the rows that carry a value; rows without one are not in it"},
        "chains": chains,
        "coverage": {k: v for k, v in (h.get("coverage") or {}).items() if k != "scope"} | {"scope": SCOPE},
        "as_of": h.get("as_of"),
        "as_of_basis": h.get("as_of_basis"),
        "read_started_at": h.get("read_started_at"),
        "cached_seconds": h.get("cached_seconds"),
        "method": h.get("method"),
        "type_basis": "the underlying's type in Tnega's tokenized-equity universe file, as the Stocks and ETFs lists use",
        "price_basis": PRICE_BASIS,
        "stable_basis": STABLE_BASIS,
        "native_basis": NATIVE_BASIS,
        "reasons": {k: REASONS[k] for k in sorted(used)},
        "served_at": dt.datetime.fromtimestamp(now, dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }


async def wallet_holdings(wallet: str, store, *, reader=None, client: str | None = None,
                          natives=None) -> dict:
    h = await read(wallet, reader=reader, client=client)
    tickers = sorted({r.get("ticker") for r in h.get("holdings") or [] if r.get("ticker")})
    coins = sorted({t.get("symbol") for t in h.get("tokens") or [] if t.get("kind") == "native"})

    async def no_store():
        return {}, False

    async def no_coins():
        return {}

    (docs, ok), nat = await asyncio.gather(
        stored_prices(store, tickers) if store is not None else no_store(),
        (natives or native_prices)(coins) if coins else no_coins())
    return shape(h, docs, ok, native=nat)
