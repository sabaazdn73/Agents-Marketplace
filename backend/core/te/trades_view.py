"""
trades_view.py

The backing for POST /api/wallet/trades (te/wallet_router.py): one wallet's
trades of listed tokenized stocks and ETFs, read on chain by trades.py, and
the P/L per position and for the portfolio by average cost (pnl.py), against
the balances and values the holdings read serves (wallet_view.py).

WHY A SECOND ROUTE, NOT MORE FIELDS ON /api/wallet/holdings
The holdings read is about 28 calls and answers in about 3 s; the MCP tool
and the order page depend on it. A trade history is hundreds of calls (log
queries, state reads to narrow them, receipts) and may take several steps
for a wallet with a long history. Kept apart, the holdings answer stays as
fast as it is, and this route has its own budget, its own deadline and a
resumable per-wallet job.

ONE REQUEST
  1. the holdings answer for the wallet, from wallet_view (its cache, its
     read in flight, or a new read through its own gate);
  2. unless the wallet's trade job is complete and under
     trades.FRESH_SECONDS old: one bounded step of the trade read (every
     chain in parallel, trades.STEP_SECONDS), admitted by the gate below;
  3. the trades paired, the P/L computed, and the gas valued at today's
     price of each chain's coin (wallet_view.native_prices).
An answer whose read is not finished says so (`status` "partial",
`continues` true): asking again continues from where it stopped.

THE ADDRESS
In the POST body; used for the reads (it is a log topic and a balanceOf and
eth_getTransactionCount argument at the public RPC providers the privacy page
names), and a key of the in-memory job for trades.JOB_TTL_SECONDS. Not
written to any store, not logged, not echoed.

THE GATE
At most MAX_CONCURRENT_STEPS steps run at once, STEPS_PER_MINUTE start in a
minute, one client starts at most CLIENT_STEPS_PER_MINUTE and one wallet at
most WALLET_STEPS_PER_MINUTE (counted under a keyed digest of the address:
blake2b with a random key made when the process starts and never stored or
served, so the stored value cannot be matched against a candidate address
from outside; a timer drops every count older than a minute, every
PRUNE_SECONDS); otherwise 429
with Retry-After before anything is spent. A step counts as running until
its thread ends. A second request for a wallet already being stepped waits
for that step.
"""

from __future__ import annotations

import asyncio
import hashlib
import datetime as dt
import secrets
import threading
import time
from collections import deque

from . import pnl, trades
from . import wallet_view

MAX_CONCURRENT_STEPS = 2
STEPS_PER_MINUTE = 12
CLIENT_STEPS_PER_MINUTE = 6
# One wallet's read, however many steps it takes, starts at most this many a
# minute: a quarter of the route's budget, so one long history cannot hold
# the rest back.
WALLET_STEPS_PER_MINUTE = 3
CLIENTS_MAX = 4096
WINDOW_SECONDS = 60.0

REASONS = {
    **pnl.REASONS,
    "no_stablecoin_leg": ("No stablecoin left or reached this wallet in the same transaction: a transfer, a "
                          "bridge, or a trade paid in another asset. No price is used for it."),
    "several_versions": ("Several tokens moved in one transaction against one stablecoin amount, which cannot be "
                         "split between them. No price is used for them."),
    "another_read_in_progress": "This server is reading other wallets' trades right now. Retry in a few seconds.",
    "route_rate_budget": ("This server's share of the public chain providers' rate limits for trade reads is spent "
                          "for the minute. That is about the server, not the address. Retry after the time given."),
    "client_rate_budget": ("This network has started several trade reads in the last minute. Retry after the time "
                           "given."),
    "wallet_rate_budget": ("This wallet's trade history is long and is read a few steps a minute, to leave room for "
                           "other wallets. It continues after the time given."),
}


class Busy(Exception):
    def __init__(self, reason: str, retry_after: float):
        super().__init__(reason)
        self.reason = reason
        self.retry_after = max(1, int(retry_after))
        self.detail = REASONS[reason]


class Gate:
    def __init__(self, running: int, per_minute: int, per_client: int):
        self.max_running, self.per_minute, self.per_client = running, per_minute, per_client
        self.lock = threading.Lock()
        self.running = 0
        self.started: deque = deque()
        self.clients: dict[str, deque] = {}
        self.wallets: dict[str, deque] = {}

    @staticmethod
    def _prune(q: deque, now: float) -> None:
        while q and now - q[0] >= WINDOW_SECONDS:
            q.popleft()

    def admit(self, now: float, client: str | None, wallet: str | None = None) -> None:
        with self.lock:
            self._prune(self.started, now)
            mine_w = self.wallets.get(wallet) if wallet is not None else None
            if mine_w is not None:
                self._prune(mine_w, now)
                if not mine_w:
                    del self.wallets[wallet]
                    mine_w = None
            mine = self.clients.get(client) if client is not None else None
            if mine is not None:
                self._prune(mine, now)
            if self.running >= self.max_running:
                raise Busy("another_read_in_progress", 5)
            if mine is not None and len(mine) >= self.per_client:
                raise Busy("client_rate_budget", WINDOW_SECONDS - (now - mine[0]) + 1)
            if mine_w is not None and len(mine_w) >= WALLET_STEPS_PER_MINUTE:
                raise Busy("wallet_rate_budget", WINDOW_SECONDS - (now - mine_w[0]) + 1)
            if len(self.started) >= self.per_minute:
                raise Busy("route_rate_budget", WINDOW_SECONDS - (now - self.started[0]) + 1)
            self.running += 1
            if wallet is not None:
                # Keyed by wallet_key(address), never the address; the timer
                # below drops it once it is a minute old.
                self.wallets.setdefault(wallet, deque()).append(now)
                if len(self.wallets) > CLIENTS_MAX:
                    for k in [k for k, q in self.wallets.items() if not q or now - q[-1] >= WINDOW_SECONDS]:
                        del self.wallets[k]
            self.started.append(now)
            if client is not None:
                if mine is None:
                    if len(self.clients) >= CLIENTS_MAX:
                        for k in [k for k, q in self.clients.items() if not q or now - q[-1] >= WINDOW_SECONDS]:
                            del self.clients[k]
                        while len(self.clients) >= CLIENTS_MAX:
                            del self.clients[min(self.clients, key=lambda k: self.clients[k][-1])]
                    mine = self.clients[client] = deque()
                mine.append(now)

    def release(self) -> None:
        with self.lock:
            self.running = max(0, self.running - 1)

    def prune(self, now: float) -> None:
        """Every per-client and per-wallet count older than the window."""
        with self.lock:
            for table in (self.clients, self.wallets):
                for k in list(table):
                    self._prune(table[k], now)
                    if not table[k]:
                        del table[k]


gate = Gate(MAX_CONCURRENT_STEPS, STEPS_PER_MINUTE, CLIENT_STEPS_PER_MINUTE)

# The per-wallet count's key: random per process, held only here.
_WALLET_KEY = secrets.token_bytes(32)
PRUNE_SECONDS = 15


def wallet_key(address: str) -> str:
    return hashlib.blake2b(address.lower().encode(), key=_WALLET_KEY, digest_size=16).hexdigest()


def _prune_loop() -> None:
    while True:
        time.sleep(PRUNE_SECONDS)
        try:
            gate.prune(time.monotonic())
        except Exception:  # noqa: BLE001  never let the timer die
            pass


threading.Thread(target=_prune_loop, name="trades-gate-prune", daemon=True).start()
_inflight: dict[str, asyncio.Future] = {}


def snapshot(job: trades.Job) -> dict:
    """Blocking (waits for a step in progress): the chain reports and every
    trade found, as plain data."""
    with job.lock:
        chains = [trades.chain_report(c) for c in job.chains.values()]
        found = []
        for c in job.chains.values():
            found += trades.trades_of(c, job.wallet)
        # Oldest first by block time across chains (block numbers of
        # different chains do not compare); within a chain by block and log.
        # For display: newest first by block time across chains (done in
        # shape). The cost walk in pnl.py orders each version's trades by
        # block and log index itself, so this order never changes a cost.
        found.sort(key=lambda t: (t.get("time") or "9999", t["chain_id"], t["block"], t.get("log_index") or 0, t["key"]))
        return {"chains": chains, "trades": found, "stepped_at": job.stepped_at,
                "read_started_at": job.read_started_at}


def held_by_chain(h: dict) -> dict[int, list[str]]:
    """chain_id -> addresses of the versions held there, for the chains the
    holdings read answered."""
    out = {c["chain_id"]: [] for c in h.get("chains") or [] if c.get("status") == "read"}
    for k in ("stocks", "etfs", "untyped"):
        for r in h.get(k) or []:
            if r.get("chain_id") in out and r.get("address"):
                out[r["chain_id"]].append(r["address"].lower())
    return out


async def _step(job: trades.Job, h: dict, client: str | None, stepper=None) -> None:
    w = job.wallet
    running = _inflight.get(w)
    if running is not None:
        await asyncio.shield(running)
        return
    gate.admit(time.monotonic(), client, wallet_key(w))
    held = held_by_chain(h)
    work = asyncio.ensure_future(asyncio.to_thread(stepper or trades.step, job, held))

    def done(f: asyncio.Future) -> None:
        _inflight.pop(w, None)
        gate.release()
        if not f.cancelled():
            f.exception()

    _inflight[w] = work
    work.add_done_callback(done)
    await asyncio.wait_for(asyncio.shield(work), timeout=trades.STEP_SECONDS + 4.0)


def _iso(t: float) -> str:
    return dt.datetime.fromtimestamp(t, dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def shape(h: dict, snap: dict, native: dict[str, dict], now: float | None = None) -> dict:
    """The route's body. Pure."""
    now = time.time() if now is None else now
    held = (h.get("stocks") or []) + (h.get("etfs") or []) + (h.get("untyped") or [])
    status_by_chain = {c["chain_id"]: c for c in snap["chains"]}
    native_usd = {s: p["usd"] for s, p in native.items() if p.get("usd")}
    rows, tot = pnl.positions(snap["trades"], held, status_by_chain, native_usd)
    used = {r["reason"] for r in rows if r["reason"]} | {r["unrealized_reason"] for r in rows if r["unrealized_reason"]}
    used |= {t["reason"] for t in snap["trades"] if t.get("reason")}
    readable = [c for c in snap["chains"] if c["mode"] != "none"]
    complete = all(c["status"] == "complete" for c in readable)
    continues = any(c["status"] == "partial" or (c["status"] == "failed" and c["mode"] != "none")
                    or c["status"] == "not_started" for c in readable)
    recent = list(reversed(snap["trades"]))[:trades.MAX_TRADES_SERVED]
    gas_prices = {s: {"price_usd": p["usd"], "pool_label": wallet_view._public_label(p.get("source")),
                      "block": p.get("block"), "read_at": p.get("read_at")} for s, p in native.items()}
    return {
        "status": "complete" if complete else "partial",
        "continues": continues and not complete,
        # Real progress only: ranges settled, receipts and block times read.
        # A poll that only re-reads the head does not move it.
        "progress": sum(c.get("progress") or 0 for c in readable),
        "positions": rows,
        "totals": tot,
        "trades": recent,
        "trades_total": len(snap["trades"]),
        "chains": snap["chains"],
        "holdings_status": h.get("status"),
        "holdings_as_of": h.get("as_of"),
        # The holdings answer these positions were valued with, whole: the
        # Dashboard shows its balances and values from whichever holdings
        # read is newer, so the P/L and the Positions card never disagree.
        "holdings": h,
        "gas_prices": gas_prices,
        "method": pnl.METHOD,
        "trade_basis": ("A trade is a transaction in which this wallet's balance of one listed version and of the "
                        "chain's dollar stablecoins moved in opposite directions, read from the transaction's "
                        "receipt. Anything else is a transfer, with no price: tokens that arrive that way have no "
                        "known cost, and tokens that leave that way (a sale for another asset, a gift, a bridge) "
                        "have no known proceeds, so the P/L of that holding cycle is not known and it is left out "
                        "of every figure, the return included."),
        "return_basis": pnl.RETURN_BASIS,
        "gas_basis": pnl.GAS_BASIS,
        "stable_basis": pnl.STABLE_BASIS,
        "price_basis": wallet_view.PRICE_BASIS,
        "reasons": {k: REASONS[k] for k in sorted(used) if k in REASONS},
        "read_started_at": _iso(snap["read_started_at"]) if snap.get("read_started_at") else None,
        "served_at": _iso(now),
    }


async def wallet_trades(wallet: str, store, *, client: str | None = None, holdings=None, stepper=None,
                        natives=None) -> dict:
    """Raises wallet_view.Busy (the holdings gate), Busy (this gate) or
    asyncio.TimeoutError."""
    w = wallet.lower()
    h = await (holdings(w) if holdings else wallet_view.wallet_holdings(w, store, client=client))
    job = trades.job_for(w)
    if not trades.is_fresh(job):
        await _step(job, h, client, stepper)
    snap = await asyncio.to_thread(snapshot, job)
    coins = sorted({t["gas"]["symbol"] for t in snap["trades"] if t.get("gas")})
    nat = await (natives or wallet_view.native_prices)(coins) if coins else {}
    return shape(h, snap, nat)
