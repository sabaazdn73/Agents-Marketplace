"""
wallet_view.py

What the Dashboard shows of one wallet's tokenized stocks and ETFs: the
backing for POST /api/wallet/holdings (te/wallet_router.py).

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
at once with Retry-After, and nothing is spent. A second request for a wallet
already being read waits for that read instead of starting another. Cached
answers are not limited.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import threading
import time
from collections import deque
from decimal import Decimal, InvalidOperation

from core import wallet_hash

from . import holdings as holdings_mod
from .universe import load_universe

# {"address": "0x" + 40 hex} is 53 bytes; the rest is room for whitespace.
MAX_BODY_BYTES = 256

MAX_CONCURRENT_READS = 3
READS_PER_MINUTE = 20
WINDOW_SECONDS = 60.0

# A cost-store price older than this is not used for a value. The cost
# worker rewrites each version at most 15 minutes apart while it runs, so a
# day-old price means the worker stopped, not that the market was quiet.
PRICE_MAX_AGE_SECONDS = 86_400
STORE_TIMEOUT_SECONDS = 3.0

SCOPE = ("Listed tokenized-stock and ETF versions on Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and "
         "HyperEVM. Solana versions and tokens Tnega does not list are not read.")

PRICE_BASIS = ("balance x the pre-trade mid of this version's deepest measured pool, read by Tnega's cost engine "
               "at the block shown, with the pool's stablecoin counted at $1. A mid price, not what a sale "
               "would receive after fees and price impact.")

REASONS = {
    "no_measured_price": (
        "Tnega's cost engine has no measured pool price for this version, so no dollar value is shown."),
    "price_too_old": (
        "The last pool price measured for this version is more than a day old, so no dollar value is shown."),
    "price_store_unavailable": (
        "Tnega's stored prices could not be read just now, so no dollar value is shown. The balance is "
        "unaffected."),
    "another_read_in_progress": (
        "This server is reading other wallets right now. Retry in a few seconds."),
    "route_rate_budget": (
        "This server's share of the public chain providers' rate limits is spent for the minute. That is "
        "about the server, not the address. Retry after the time given."),
}
BUSY_REASONS = ("another_read_in_progress", "route_rate_budget")


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
_inflight: dict[str, asyncio.Future] = {}


def _admit(now: float) -> None:
    global _running
    with _lock:
        while _started and now - _started[0] >= WINDOW_SECONDS:
            _started.popleft()
        if _running >= MAX_CONCURRENT_READS:
            raise Busy("another_read_in_progress", 3)
        if len(_started) >= READS_PER_MINUTE:
            raise Busy("route_rate_budget", WINDOW_SECONDS - (now - _started[0]) + 1)
        _running += 1
        _started.append(now)


def _release() -> None:
    global _running
    with _lock:
        _running = max(0, _running - 1)


async def read(wallet: str, *, reader=None) -> dict:
    """holdings.py's answer for this wallet: from its cache, from a read
    already running for it, or from a new read if the gate admits one.
    Raises Busy when it does not; asyncio.TimeoutError past the read's
    deadline."""
    w = wallet.lower()
    hit = holdings_mod.cached_answer(w)
    if hit is not None:
        return hit
    running = _inflight.get(w)
    if running is not None:
        return await asyncio.shield(running)
    _admit(time.monotonic())
    try:
        fut = asyncio.ensure_future((reader or holdings_mod.holdings)(w))
    except BaseException:
        _release()
        raise

    # The read may outlive a caller that stopped waiting, so the slot is
    # freed when the read itself ends, not when a caller does.
    def done(f: asyncio.Future) -> None:
        _inflight.pop(w, None)
        _release()
        if not f.cancelled():
            f.exception()  # retrieved here, so an error is not reported twice

    _inflight[w] = fut
    fut.add_done_callback(done)
    return await asyncio.shield(fut)


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


def shape(h: dict, docs: dict[str, dict], store_ok: bool, now: float | None = None) -> dict:
    """The route's body from holdings.py's answer and the stored cost records.
    Pure: no read happens here."""
    now = time.time() if now is None else now
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

    def total(rows: list) -> dict:
        priced = [r["value_usd"] for r in rows if r["value_usd"] is not None]
        return {"value_usd": round(sum(priced), 4) if priced else None, "rows": len(rows),
                "rows_priced": len(priced)}

    chains = []
    for c in h.get("chains") or []:
        out = {"chain_id": c["chain_id"], "chain": c["chain"], "status": c["status"],
               "versions_checked": c.get("versions_checked")}
        if c["status"] == "read":
            out.update(block=c.get("block"), block_time=c.get("block_time"))
            if c.get("versions_unanswered"):
                out["versions_unanswered"] = c["versions_unanswered"]
            if c.get("note"):
                out["note"] = c["note"]
        else:
            out["reason"] = c.get("reason")
        chains.append(out)
    return {
        "status": h.get("status"),
        "stocks": groups["stock"],
        "etfs": groups["etf"],
        "untyped": groups["untyped"],
        "totals": {"stocks": total(groups["stock"]), "etfs": total(groups["etf"]),
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
        "reasons": {k: REASONS[k] for k in sorted(used)},
        "served_at": dt.datetime.fromtimestamp(now, dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }


async def wallet_holdings(wallet: str, store, *, reader=None) -> dict:
    h = await read(wallet, reader=reader)
    tickers = sorted({r.get("ticker") for r in h.get("holdings") or [] if r.get("ticker")})
    docs, ok = await stored_prices(store, tickers) if store is not None else ({}, False)
    return shape(h, docs, ok)
