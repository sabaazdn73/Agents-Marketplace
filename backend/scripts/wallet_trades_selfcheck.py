#!/usr/bin/env python3
"""wallet_trades_selfcheck.py -- POST /api/wallet/trades: the trade read
(core/te/trades.py) and the P/L by average cost (core/te/pnl.py), checked on
a simulated chain with no network (and, with --live, on the chains).

The simulated chain answers the calls the reader makes (eth_blockNumber,
eth_getTransactionCount and Multicall3 balanceOf at a block, eth_getLogs
with its range limit, receipts, block headers) from a list of transactions,
so the real reader code runs end to end.

  INVENTED  a buy with invented numbers in the shape of a real LI.FI swap on
            Base (block 40,123,456: 7 USDC paid, of which 0.0175 to the LI.FI
            fee collector, the rest through a stand-in pool and a stand-in
            intermediate, 0.0291375 NVDAc received; invented gas used,
            effective gas price and L1 fee), beside an approval and an
            unrelated transaction: exactly one buy is found, its price is
            7 / 0.0291375, its gas is gasUsed x effectiveGasPrice + l1Fee, and
            the unrealized P/L is against an invented measured price (251.75).
  AVERAGE   two buys then a partial sale: realized and unrealized P/L by
            average cost, return on the stablecoins paid.
  UNPAIRED  a transfer in with no stablecoin leg: no price, P/L "not known
            (no purchase found)"; a buy followed by a transfer in: basis
            unknown; a buy paid in another asset is a transfer, not a buy.
  ROUNDTRIP a buy and a full sale between two reads whose holdings are equal
            is still found (the wallet's nonce moved).
  SPLIT     a log range the endpoint refuses is halved and read.
  RESUME    a step stopped by its call budget continues on the next request
            and ends complete.
  NOTREAD   BNB Chain is reported as not read, with its reason; a position
            there has P/L "unknown", reason chain_not_read.
  LOSS      a price below the average buy-in: a negative unrealized amount
            and percentage, asserted as literals, and a gas figure with many
            significant digits.
  ROUTE     200 with no-store and no address in the answer; 400; 415 for a
            body that is not JSON; 429 when the gate is full.

Run from backend/:
  ./venv/bin/python scripts/wallet_trades_selfcheck.py
  PNL_SELFCHECK_WALLET=0x... ./venv/bin/python scripts/wallet_trades_selfcheck.py --live
--live reads that wallet's trades on the chains through the public endpoints
(never a keyed one), READ ONLY, and requires at least one NVDAc buy on Base
with a positive quantity paid in stablecoins, a known P/L and an average buy
price equal to the stablecoins paid over the quantity bought. Its unrealized
P/L is computed against the price Tnega's own API serves for that version
(/api/te/underlying/NVDA). The address is taken from the environment, never
written here, and so is nothing about its trades. Set, these make the check
exact (compared as numbers): PNL_SELFCHECK_BUYS, the number of NVDAc buys on
Base; PNL_SELFCHECK_QTY, the NVDAc bought in all; PNL_SELFCHECK_PAID, the
stablecoins paid in all.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from eth_abi import decode, encode  # noqa: E402

from core.te import trades as T  # noqa: E402
from core.te import trades_view as TV  # noqa: E402
from core.te.holdings import versions_on_buy_chains  # noqa: E402
from core.te.rpcclient import RpcError  # noqa: E402

FAILURES: list[str] = []
STAND_IN = "0x00000000000000000000000000000000000a11ce"
OTHER = "0x00000000000000000000000000000000000b0b00"
LIFI = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae"
FEE_COLLECTOR = "0xc06ebbefd94032b85424d51906e2a335efae264b"
POOL = "0x000000000000000000000000000000000900a1a1"  # stand-in pool
HOP = "0x000000000000000000000000000000000900a1a2"   # stand-in intermediate on the route
USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
NVDAC = "0xb20000000000000000000078ee7ce2fe4908108c"
NVDAC_KEY = "8453/" + NVDAC
BASE_HEAD = 50_500_000
MID_INVENTED = 251.75            # an invented measured price for NVDAc
GAS_USED, EGP, L1FEE = 250_000, 6_000_000, 30_000_000_000   # invented receipt figures
ETH_USD = 4000.0                 # a stand-in coin price for the offline checks only


def check(cond: bool, what: str) -> None:
    print(("ok    " if cond else "FAIL  ") + what)
    if not cond:
        FAILURES.append(what)


def h32(n: int) -> str:
    return "0x" + format(n, "064x")


# ── the simulated chain ────────────────────────────────────────────────────

class Stats:
    def __init__(self):
        self.calls = 0


class FakeChain:
    """txs: dicts {block, sender, transfers: [(token, from, to, raw)], gas}.
    Hashes and log indexes are assigned here."""

    def __init__(self, chain_id: int, head: int, txs: list[dict], max_range: int | None = None, ts_of=None):
        self.chain_id, self.head, self.max_range = chain_id, head, max_range
        self.ts_of = ts_of or (lambda b: 1_790_000_000 + b * 2 - 104_000_000)
        self.fail_headers: set[int] = set()
        self.txs = sorted(txs, key=lambda t: t["block"])
        for i, t in enumerate(self.txs):
            t["hash"] = h32(0xfeed0000 + chain_id * 1000 + i)
        self.refused = 0

    def balance(self, token: str, who: str, block: int) -> int:
        n = 0
        for t in self.txs:
            if t["block"] > block:
                break
            for tok, f, to, raw in t["transfers"]:
                if tok == token:
                    n += raw if to == who else 0
                    n -= raw if f == who else 0
        return n

    def logs_of(self, t: dict) -> list[dict]:
        out = []
        for i, (tok, f, to, raw) in enumerate(t["transfers"]):
            out.append({"address": tok, "topics": [T.TRANSFER, "0x" + "0" * 24 + f[2:], "0x" + "0" * 24 + to[2:]],
                        "data": h32(raw), "blockNumber": hex(t["block"]), "transactionHash": t["hash"],
                        "logIndex": hex(i), "removed": False})
        return out


class FakeRpc:
    def __init__(self, chain: FakeChain, budget: list | None = None):
        self.c = chain
        self.stats = Stats()
        self.budget = budget

    def close(self):
        pass

    def block_number(self) -> int:
        return int(self.call("eth_blockNumber", []), 16)

    def eth_call(self, to, data, block="latest", **_k):
        return self.call("eth_call", [{"to": to, "data": data}, hex(block) if isinstance(block, int) else block])

    def call(self, method, params, **_k):
        self.stats.calls += 1
        if self.budget is not None:
            self.budget[0] -= 1
            if self.budget[0] < 0:
                raise RpcError("deadline", "the job's deadline passed")
        c = self.c
        if method == "eth_blockNumber":
            return hex(c.head)
        if method == "eth_getCode":
            return "0x"
        if method == "eth_getTransactionCount":
            who, b = params[0].lower(), int(params[1], 16)
            return hex(sum(1 for t in c.txs if t["block"] <= b and t["sender"] == who))
        if method == "eth_call":
            b = int(params[1], 16)
            raw = bytes.fromhex(params[0]["data"][2:])
            (calls,) = decode(["(address,bool,bytes)[]"], raw[4:])
            res = []
            for target, _ok, data in calls:
                who = "0x" + data[4:36][-20:].hex()
                res.append((True, encode(["uint256"], [c.balance(target.lower(), who, b)])))
            return "0x" + encode(["(bool,bytes)[]"], [res]).hex()
        if method == "eth_getLogs":
            f = params[0]
            lo, hi = int(f["fromBlock"], 16), int(f["toBlock"], 16)
            if c.max_range and hi - lo + 1 > c.max_range:
                c.refused += 1
                raise RpcError("rpc", f"eth_getLogs is limited to a {c.max_range} range")
            out = []
            for t in c.txs:
                if lo <= t["block"] <= hi:
                    for lg in c.logs_of(t):
                        tp = f["topics"]
                        if all(want is None or want == lg["topics"][i] for i, want in enumerate(tp)):
                            if not f.get("address") or lg["address"] in (f["address"] if isinstance(f["address"], list) else [f["address"]]):
                                out.append(lg)
            return out
        if method == "eth_getTransactionReceipt":
            t = next(t for t in c.txs if t["hash"] == params[0])
            g = t.get("gas") or (21000, 10 ** 6, 0)
            r = {"from": t["sender"], "status": "0x1", "blockNumber": hex(t["block"]), "logs": c.logs_of(t),
                 "gasUsed": hex(g[0]), "effectiveGasPrice": hex(g[1])}
            if g[2]:
                r["l1Fee"] = hex(g[2])
            return r
        if method == "eth_getBlockByNumber":
            b = int(params[0], 16)
            if b in c.fail_headers:
                c.fail_headers.discard(b)          # fails once, answers next time
                raise RpcError("transient", "request timed out")
            return {"timestamp": hex(c.ts_of(b))}
        raise RpcError("rpc", f"not simulated: {method}")


def install(chains: dict[int, FakeChain], budget: list | None = None):
    def make(chain_id, role, deadline):
        return FakeRpc(chains.get(chain_id) or FakeChain(chain_id, 1_000_000, []), budget)
    T.make_rpc = make
    with T._jobs_lock:
        T._jobs.clear()


def holdings_answer(rows: list[dict], read_chains=(1, 8453, 42161, 56, 4663, 999)) -> dict:
    return {"status": "read", "stocks": rows, "etfs": [], "untyped": [], "tokens": [],
            "chains": [{"chain_id": c, "status": "read"} for c in read_chains], "as_of": "2026-10-01T15:00:00Z"}


def held_row(key: str, raw: int, decimals: int, price: float | None, chain_id: int = 8453) -> dict:
    v = next(x for x in versions_on_buy_chains()[chain_id] if x["key"] == key)
    bal = Decimal(raw).scaleb(-decimals)
    return {"key": key, "symbol": v["symbol"], "ticker": v["ticker"], "issuer": v["issuer"], "chain": "Base",
            "chain_id": chain_id, "address": v["address"], "decimals": decimals, "balance": format(bal.normalize(), "f"),
            "type": "stock", "name": v["ticker"],
            "value_usd": float((bal * Decimal(str(price))).quantize(Decimal("0.0001"))) if price else None}


async def _natives(coins):
    return {s: {"usd": ETH_USD, "source": "stand-in", "block": 1, "read_at": "2026-10-01T15:00:00Z"} for s in coins}


def gate_reset() -> None:
    """The rate windows cleared between steps, so a check can run a
    wallet's steps back to back; the gate itself is checked in ROUTE."""
    TV.gate.started.clear()
    TV.gate.clients.clear()
    TV.gate.wallets.clear()


def run(wallet: str, h: dict, rounds: int = 8) -> dict:
    async def hold(_w):
        return h
    body = None
    for _ in range(rounds):
        gate_reset()
        body = asyncio.run(TV.wallet_trades(wallet, None, holdings=hold, natives=_natives))
        if body["status"] == "complete":
            break
        with T._jobs_lock:
            for j in T._jobs.values():
                j.stepped_at = None
    return body


# ── INVENTED ───────────────────────────────────────────────────────────────
# Invented numbers in the shape of a real LI.FI swap on Base; none of them is
# a real transaction, block, balance or route. USDC has 6 decimals, NVDAc 8.
#   paid            7_000_000   = 7 USDC, wallet -> LI.FI diamond
#   LI.FI fee          17_500   = 0.25% of 7 USDC, diamond -> fee collector
#   to the pool     6_982_500   = 7_000_000 - 17_500
#   pool -> hop     2_913_788   NVDAc, of which the hop keeps 38 (dust)
#   hop -> diamond  2_913_750   NVDAc, passed on in full to the wallet
#   received        2_913_750   = 0.0291375 NVDAc
# Expected, worked by hand:
#   average buy price  7 / 0.0291375 = 240.24023..., served as 240.2402
#   value              0.0291375 x 251.75 = 7.33536..., served as 7.3354
#   unrealized         7.3354 - 7 = 0.3354 (4.79%)
#   gas (wei)          250_000 x 6_000_000 + 30_000_000_000 = 1_530_000_000_000

def invented_chain() -> FakeChain:
    w = STAND_IN
    return FakeChain(8453, BASE_HEAD, [
        {"block": 40_123_400, "sender": w, "transfers": [], "gas": (46_000, EGP, 0)},          # the approval
        {"block": 40_123_456, "sender": w, "gas": (GAS_USED, EGP, L1FEE), "transfers": [
            (USDC_BASE, w, LIFI, 7_000_000), (USDC_BASE, LIFI, FEE_COLLECTOR, 17_500),
            (USDC_BASE, LIFI, POOL, 6_982_500), (NVDAC, POOL, HOP, 2_913_788),
            (NVDAC, HOP, LIFI, 2_913_750), (NVDAC, LIFI, w, 2_913_750)]},
        {"block": 39_000_000, "sender": w, "transfers": []},                                   # unrelated
    ], max_range=2_000)


def invented_checks() -> None:
    install({8453: invented_chain()})
    h = holdings_answer([held_row(NVDAC_KEY, 2_913_750, 8, MID_INVENTED)])
    b = run(STAND_IN, h)
    base = next(c for c in b["chains"] if c["chain_id"] == 8453)
    check(b["status"] == "complete" and base["status"] == "complete", f"INVENTED read complete ({b['status']})")
    buys = [t for t in b["trades"] if t["side"] == "buy"]
    check(len(b["trades"]) == 1 and len(buys) == 1, f"INVENTED exactly one trade, a buy ({len(b['trades'])})")
    t = buys[0] if buys else {}
    check(t.get("quantity") == "0.0291375" and t.get("usd") == "7" and t.get("block") == 40_123_456
          and t.get("symbol") == "NVDAc", "INVENTED 0.0291375 NVDAc for 7 USDC at block 40,123,456")
    gas = (t.get("gas") or {})
    check(gas.get("wei") == str(GAS_USED * EGP + L1FEE) == "1530000000000" and gas.get("symbol") == "ETH",
          f"INVENTED gas = gasUsed x effectiveGasPrice + l1Fee = {gas.get('amount')} ETH")
    p = next((r for r in b["positions"] if r["key"] == NVDAC_KEY), {})
    avg = float((Decimal(7) / Decimal("0.0291375")).quantize(Decimal("0.0001")))
    check(p.get("avg_buy_price_usd") == avg == 240.2402,
          f"INVENTED average buy price {p.get('avg_buy_price_usd')} (7 / 0.0291375 = 240.2402)")
    value = float((Decimal("0.0291375") * Decimal(str(MID_INVENTED))).quantize(Decimal("0.0001")))
    check(value == 7.3354 and p.get("cost_basis_usd") == 7.0 and p.get("unrealized_usd") == round(value - 7.0, 4) == 0.3354
          and p.get("unrealized_pct") == 4.79 and p.get("pnl") == "known",
          f"INVENTED unrealized {p.get('unrealized_usd')} = value {value} - basis 7 ({p.get('unrealized_pct')}%)")
    check(p.get("realized_usd") == 0.0 and b["totals"]["total_usd"] == p.get("unrealized_usd")
          and b["totals"]["invested_usd"] == 7.0 and b["totals"]["buys"] == 1,
          "INVENTED totals: realized 0, total = unrealized, invested 7, one buy")
    check(STAND_IN[2:] not in json.dumps(b).lower(), "INVENTED the wallet address is nowhere in the answer")
    check(b["trades"][0].get("tx_url", "").startswith("https://basescan.org/tx/0x"), "INVENTED explorer link")


# ── AVERAGE, UNPAIRED, ROUNDTRIP, SPLIT ────────────────────────────────────

def base_versions(n: int) -> list[dict]:
    return [v for v in versions_on_buy_chains()[8453] if v["address"] != NVDAC][:n]


def average_checks() -> None:
    w = "0x00000000000000000000000000000000000ca5e1"
    v = base_versions(1)[0]
    a, d = v["address"], int(v["decimals"])
    one = 10 ** d
    chain = FakeChain(8453, BASE_HEAD, [
        {"block": 40_000_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 1_000_000_000), (a, LIFI, w, 10 * one)]},
        {"block": 45_000_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 1_200_000_000), (a, LIFI, w, 10 * one)]},
        {"block": 50_000_000, "sender": w, "transfers": [(a, w, LIFI, 5 * one), (USDC_BASE, LIFI, w, 650_000_000)]},
    ], max_range=2_000)
    install({8453: chain})
    b = run(w, holdings_answer([held_row(v["key"], 15 * one, d, 130.0)]))
    p = next((r for r in b["positions"] if r["key"] == v["key"]), {})
    check([t["side"] for t in reversed(b["trades"])] == ["buy", "buy", "sell"], "AVERAGE buy, buy, sell found in order")
    check(p.get("avg_buy_price_usd") == 110.0 and p.get("cost_basis_usd") == 1650.0,
          f"AVERAGE 15 left at an average 110 (basis {p.get('cost_basis_usd')})")
    check(p.get("realized_usd") == 100.0, f"AVERAGE realized 650 - 5 x 110 = 100 ({p.get('realized_usd')})")
    check(p.get("unrealized_usd") == 300.0 and p.get("unrealized_pct") == 18.18,
          f"AVERAGE unrealized 15 x 130 - 1650 = 300, 18.18% ({p.get('unrealized_usd')}, {p.get('unrealized_pct')}%)")
    tt = b["totals"]
    check(tt["total_usd"] == 400.0 and tt["invested_usd"] == 2200.0 and tt["return_pct"] == 18.18,
          f"AVERAGE total 400 on 2,200 paid: 18.18% ({tt['total_usd']}, {tt['return_pct']}%)")


def unpaired_checks() -> None:
    w = "0x00000000000000000000000000000000000ca5e2"
    v1, v2, v3 = base_versions(3)
    o1, o2, o3 = (10 ** int(v["decimals"]) for v in (v1, v2, v3))
    chain = FakeChain(8453, BASE_HEAD, [
        {"block": 41_000_000, "sender": OTHER, "transfers": [(v1["address"], OTHER, w, 3 * o1)]},
        {"block": 42_000_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 200_000_000), (v2["address"], LIFI, w, 2 * o2)]},
        {"block": 43_000_000, "sender": OTHER, "transfers": [(v2["address"], OTHER, w, 1 * o2)]},
        # paid in another asset: the version arrives, no stablecoin moves
        {"block": 44_000_000, "sender": w, "transfers": [("0x4200000000000000000000000000000000000006", w, LIFI, 10 ** 17),
                                                          (v3["address"], LIFI, w, 1 * o3)]},
    ], max_range=2_000)
    install({8453: chain})
    b = run(w, holdings_answer([held_row(v1["key"], 3 * o1, int(v1["decimals"]), 50.0),
                                held_row(v2["key"], 3 * o2, int(v2["decimals"]), 50.0),
                                held_row(v3["key"], 1 * o3, int(v3["decimals"]), 50.0)]))
    pos = {r["key"]: r for r in b["positions"]}
    sides = {t["key"]: [] for t in b["trades"]}
    for t in b["trades"]:
        sides[t["key"]].append(t["side"])
    check(sides.get(v1["key"]) == ["transfer_in"] and next(t for t in b["trades"] if t["key"] == v1["key"]).get("usd") is None,
          "UNPAIRED a transfer in has no price")
    p1 = pos.get(v1["key"], {})
    check(p1.get("pnl") == "unknown" and p1.get("reason") == "no_purchase_found" and p1.get("cost_basis_usd") is None
          and p1.get("unrealized_usd") is None, "UNPAIRED only a transfer in: P/L not known (no purchase found)")
    p2 = pos.get(v2["key"], {})
    check(p2.get("pnl") == "unknown" and p2.get("reason") == "transfer_in_without_price" and p2.get("avg_buy_price_usd") is None,
          "UNPAIRED a buy then a transfer in: basis unknown, nothing estimated")
    t3 = [t for t in b["trades"] if t["key"] == v3["key"]]
    check(len(t3) == 1 and t3[0]["side"] == "transfer_in" and t3[0]["reason"] == "no_stablecoin_leg",
          "UNPAIRED a buy paid in another asset is a transfer with no price")
    check(b["totals"]["positions_counted"] == 0 and b["totals"]["total_usd"] is None,
          "UNPAIRED no position counted, no total P/L")
    check("no_purchase_found" in b["reasons"] and "no_stablecoin_leg" in b["reasons"], "UNPAIRED reasons explained")


def roundtrip_checks() -> None:
    w = "0x00000000000000000000000000000000000ca5e3"
    v = base_versions(1)[0]
    one = 10 ** int(v["decimals"])
    chain = FakeChain(8453, BASE_HEAD, [
        {"block": 30_000_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 100_000_000), (v["address"], LIFI, w, one)]},
        {"block": 30_000_500, "sender": w, "transfers": [(v["address"], w, LIFI, one), (USDC_BASE, LIFI, w, 110_000_000)]},
    ], max_range=2_000)
    install({8453: chain})
    b = run(w, holdings_answer([]))
    p = next((r for r in b["positions"] if r["key"] == v["key"]), {})
    check(len(b["trades"]) == 2 and p.get("realized_usd") == 10.0 and p.get("pnl") == "known",
          f"ROUNDTRIP a buy and a full sale with equal holdings at both ends found; realized 10 ({p.get('realized_usd')})")
    check(b["totals"]["realized_usd"] == 10.0 and b["totals"]["unrealized_usd"] == 0.0,
          "ROUNDTRIP totals: realized 10, unrealized 0")


def split_checks() -> None:
    w = "0x00000000000000000000000000000000000ca5e4"
    v = base_versions(1)[0]
    one = 10 ** int(v["decimals"])
    chain = FakeChain(8453, BASE_HEAD, [
        {"block": 30_000_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 100_000_000), (v["address"], LIFI, w, one)]},
    ], max_range=700)
    install({8453: chain})
    b = run(w, holdings_answer([held_row(v["key"], one, int(v["decimals"]), 100.0)]))
    check(chain.refused > 0 and len(b["trades"]) == 1 and b["status"] == "complete",
          f"SPLIT a refused log range is halved and read ({chain.refused} refusals)")


def resume_checks() -> None:
    w = "0x00000000000000000000000000000000000ca5e5"
    v = base_versions(1)[0]
    one = 10 ** int(v["decimals"])
    chain = FakeChain(8453, BASE_HEAD, [
        {"block": 30_000_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 100_000_000), (v["address"], LIFI, w, one)]},
    ], max_range=2_000)
    budget = [12]
    install({8453: chain}, budget)
    h = holdings_answer([held_row(v["key"], one, int(v["decimals"]), 100.0)])

    async def hold(_w):
        return h
    first = asyncio.run(TV.wallet_trades(w, None, holdings=hold, natives=_natives))
    p = next((r for r in first["positions"] if r["key"] == v["key"]), {})
    check(first["status"] == "partial" and first["continues"] and p.get("reason") == "history_partial",
          "RESUME a step stopped early says partial, continues, and shows no P/L yet")
    budget[0] = 10 ** 6
    with T._jobs_lock:
        for j in T._jobs.values():
            j.stepped_at = None
    second = run(w, h)
    check(second["status"] == "complete" and len(second["trades"]) == 1, "RESUME the next request completes it")


def unpriced_out_checks() -> None:
    """2: a sale for another asset is not a clean zero; 6: a fresh basis after
    the position returns to zero; 11: tokens that only came in and went out
    are never a P/L position."""
    weth = "0x4200000000000000000000000000000000000006"
    v1, v2 = base_versions(2)
    o1, o2 = (10 ** int(v["decimals"]) for v in (v1, v2))
    w = "0x00000000000000000000000000000000000ca5e8"
    sell_eth = [
        {"block": 30_000_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 1_000_000_000), (v1["address"], LIFI, w, 10 * o1)]},
        {"block": 31_000_000, "sender": w, "transfers": [(v1["address"], w, LIFI, 10 * o1), (weth, LIFI, w, 3 * 10 ** 17)]},
    ]
    install({8453: FakeChain(8453, BASE_HEAD, [dict(t) for t in sell_eth], max_range=2_000)})
    b = run(w, holdings_answer([]))
    p = next((r for r in b["positions"] if r["key"] == v1["key"]), {})
    out = [t for t in b["trades"] if t["side"] == "transfer_out"]
    check(len(out) == 1 and out[0]["reason"] == "no_stablecoin_leg",
          "UNPRICED a sale for WETH is a transfer out with no price")
    check(p.get("pnl") == "unknown" and p.get("reason") == "left_without_price" and p.get("realized_usd") is None,
          f"UNPRICED buy 10 for $1,000 then sold for WETH: P/L not known, not a realized 0 ({p.get('pnl')}, {p.get('reason')})")
    check(b["totals"]["positions_counted"] == 0 and b["totals"]["return_pct"] is None
          and b["totals"]["invested_usd"] is None and b["totals"]["sells_not_counted"] == 0
          and b["totals"]["buys_not_counted"] == 1,
          "UNPRICED its $1,000 is not in Paid for buys and the return is not diluted")
    w2 = "0x00000000000000000000000000000000000ca5e9"
    again = [dict(t) for t in sell_eth] + [
        {"block": 32_000_000, "sender": w2, "transfers": [(USDC_BASE, w2, LIFI, 300_000_000), (v1["address"], LIFI, w2, 2 * o1)]}]
    for t in again:
        t["transfers"] = [(tok, w2 if f == w else f, w2 if to == w else to, raw) for tok, f, to, raw in t["transfers"]]
        t["sender"] = w2
    install({8453: FakeChain(8453, BASE_HEAD, again, max_range=2_000)})
    b = run(w2, holdings_answer([held_row(v1["key"], 2 * o1, int(v1["decimals"]), 160.0)]))
    p = next((r for r in b["positions"] if r["key"] == v1["key"]), {})
    check(p.get("pnl") == "known" and p.get("cycles_left_out") == 1 and p.get("avg_buy_price_usd") == 150.0
          and p.get("unrealized_usd") == 20.0 and p.get("realized_usd") == 0.0 and p.get("counted_bought_usd") == 300.0,
          f"FRESH back to zero, then a new buy: a fresh basis of 150, unrealized 20, the unknown cycle left out "
          f"({p.get('pnl')}, {p.get('avg_buy_price_usd')}, {p.get('cycles_left_out')})")
    check(b["totals"]["invested_usd"] == 300.0 and b["totals"]["return_pct"] == 6.67 and b["totals"]["cycles_left_out"] == 1,
          "FRESH the return is on the $300 of the counted cycle (6.67%), one cycle left out")
    w3 = "0x00000000000000000000000000000000000ca5ea"
    install({8453: FakeChain(8453, BASE_HEAD, [
        {"block": 30_000_000, "sender": OTHER, "transfers": [(v2["address"], OTHER, w3, 5 * o2)]},
        {"block": 30_100_000, "sender": w3, "transfers": [(v2["address"], w3, OTHER, 5 * o2)]},
    ], max_range=2_000)})
    b = run(w3, holdings_answer([]))
    p = next((r for r in b["positions"] if r["key"] == v2["key"]), {})
    check(p.get("pnl") == "unknown" and p.get("reason") == "no_purchase_found" and b["totals"]["positions_counted"] == 0
          and b["totals"]["total_usd"] is None,
          "NOBUY tokens that only came in and went out: not a P/L position, nothing counted")


def receipts_checks() -> None:
    """3: a chain is not complete while receipts of found transfers are unread."""
    w = "0x00000000000000000000000000000000000ca5eb"
    v = base_versions(1)[0]
    one = 10 ** int(v["decimals"])
    txs = [{"block": 40_000_000 + i * 10, "sender": w,
            "transfers": [(USDC_BASE, w, LIFI, 10_000_000), (v["address"], LIFI, w, one)]} for i in range(70)]
    install({8453: FakeChain(8453, BASE_HEAD, txs, max_range=2_000)})
    h = holdings_answer([held_row(v["key"], 70 * one, int(v["decimals"]), 11.0)])

    async def hold(_w):
        return h
    saved = T.CALLS_PER_STEP
    T.CALLS_PER_STEP = 50          # small steps, so receipts run out mid-read
    seen_partial, last = None, None
    try:
        for _ in range(40):
            gate_reset()
            last = asyncio.run(TV.wallet_trades(w, None, holdings=hold, natives=_natives))
            base = next(c for c in last["chains"] if c["chain_id"] == 8453)
            if base.get("transfers_found") and base["receipts_missing"] and seen_partial is None:
                seen_partial = (base["status"], last["continues"], base["receipts_missing"], base["remaining"]["receipts"],
                                last["status"])
            if last["status"] == "complete":
                break
            with T._jobs_lock:
                for j in T._jobs.values():
                    j.stepped_at = None
    finally:
        T.CALLS_PER_STEP = saved
    check(seen_partial is not None and seen_partial[0] == "partial" and seen_partial[1] and seen_partial[2] == seen_partial[3]
          and seen_partial[4] == "partial",
          f"RECEIPTS with receipts unread the chain is partial and the read continues ({seen_partial})")
    base = next(c for c in last["chains"] if c["chain_id"] == 8453)
    check(last["status"] == "complete" and base["receipts_missing"] == 0 and len(last["trades"]) == 70,
          f"RECEIPTS complete only once all 70 are read ({base['receipts_read']})")


def busy_wallet_checks() -> None:
    """5: an active wallet's round-trip checks are capped and reported, and
    its holdings changes are still found."""
    w = "0x00000000000000000000000000000000000ca5ed"
    v = base_versions(1)[0]
    one = 10 ** int(v["decimals"])
    txs = [{"block": 20_000_000 + i * 150_000, "sender": w, "transfers": []} for i in range(200)]
    txs.append({"block": 45_000_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 50_000_000), (v["address"], LIFI, w, one)]})
    chain = FakeChain(8453, BASE_HEAD, txs, max_range=2_000)
    install({8453: chain})
    b = run(w, holdings_answer([held_row(v["key"], one, int(v["decimals"]), 60.0)]), rounds=10)
    base = next(c for c in b["chains"] if c["chain_id"] == 8453)
    p = next((r for r in b["positions"] if r["key"] == v["key"]), {})
    check(base["status"] == "limited" and not b["continues"] and base["round_trip_ranges_not_searched"] > 0
          and "not searched" in (base.get("note") or "") and len(b["trades"]) == 1,
          f"BUSY round-trip checks capped at {T.ROUND_TRIP_CALLS} calls: Base 'limited', not complete, "
          f"{base['round_trip_ranges_not_searched']} ranges reported not searched, the buy found ({base['calls']} calls)")
    check(p.get("pnl") == "unknown" and p.get("reason") == "ranges_not_searched" and b["totals"]["positions_counted"] == 0,
          f"BUSY its position's P/L is not shown while ranges are unsearched ({p.get('pnl')}, {p.get('reason')})")


def time_order_checks() -> None:
    """A block time that failed to read: the chain stays unread until it is
    read again, and the cost follows block order, never time."""
    from core.te import pnl
    w = "0x00000000000000000000000000000000000ca5f1"
    v = base_versions(1)[0]
    one = 10 ** int(v["decimals"])
    chain = FakeChain(8453, BASE_HEAD, [
        {"block": 30_000_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 1_000_000_000), (v["address"], LIFI, w, 10 * one)]},
        {"block": 30_001_000, "sender": w, "transfers": [(v["address"], w, LIFI, 5 * one), (USDC_BASE, LIFI, w, 750_000_000)]},
        {"block": 30_002_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 1_000_000_000), (v["address"], LIFI, w, 5 * one)]},
    ], max_range=2_000)
    chain.fail_headers = {30_002_000}
    install({8453: chain})
    h = holdings_answer([held_row(v["key"], 10 * one, int(v["decimals"]), 160.0)])

    async def hold(_w):
        return h
    gate_reset()
    first = asyncio.run(TV.wallet_trades(w, None, holdings=hold, natives=_natives))
    base = next(c for c in first["chains"] if c["chain_id"] == 8453)
    p = next((r for r in first["positions"] if r["key"] == v["key"]), {})
    check(base["status"] == "partial" and base["receipts_missing"] == 1 and first["continues"] and p.get("pnl") == "unknown",
          f"TIME a block time not read: Base partial, 1 unread, P/L not shown yet ({base['status']}, {base['receipts_missing']})")
    b = run(w, h)
    p = next((r for r in b["positions"] if r["key"] == v["key"]), {})
    # Buy 10 for 1,000 (avg 100); sell 5 for 750 (realized 750 - 500 = 250);
    # buy 5 for 1,000: basis 500 + 1,000 = 1,500 on 10, avg 150.
    check(b["status"] == "complete" and p.get("avg_buy_price_usd") == 150.0 and p.get("realized_usd") == 250.0,
          f"TIME header read again next step: complete, average 150, realized 250 ({p.get('avg_buy_price_usd')}, {p.get('realized_usd')})")
    # The cost walk ignores the order it is given: trades handed over in a
    # wrong order (the last one with no time, sorted first) cost the same.
    ts = sorted(b["trades"], key=lambda t: (t["block"] != 30_002_000, t["block"]))
    ts[0] = {**ts[0], "time": None}
    rows, _tot = pnl.positions(ts, h["stocks"], {8453: {"status": "complete"}}, {})
    check(rows[0]["avg_buy_price_usd"] == 150.0 and rows[0]["realized_usd"] == 250.0,
          f"TIME cost in block order whatever the input order ({rows[0]['avg_buy_price_usd']})")


def overflow_checks() -> None:
    """Too many transfers for an ordinary wallet: not read, memory freed."""
    w = "0x00000000000000000000000000000000000ca5f2"
    v = base_versions(1)[0]
    one = 10 ** int(v["decimals"])
    txs = [{"block": 30_000_000 + i * 100, "sender": OTHER, "transfers": [(v["address"], OTHER, w, one)]} for i in range(60)]
    chain = FakeChain(8453, BASE_HEAD, txs, max_range=2_000)
    install({8453: chain})
    saved = T.MAX_TRANSFERS
    T.MAX_TRANSFERS = 40
    try:
        b = run(w, holdings_answer([held_row(v["key"], 60 * one, int(v["decimals"]), 1.0)]))
    finally:
        T.MAX_TRANSFERS = saved
    base = next(c for c in b["chains"] if c["chain_id"] == 8453)
    job = T._jobs.get(w)
    held = sum(len(c.logs) + len(c.receipts) for c in job.chains.values()) if job else -1
    p = next((r for r in b["positions"] if r["key"] == v["key"]), {})
    check(base["status"] == "not_read" and base.get("too_many_transfers") and "too many" in base["reason"] and held == 0
          and p.get("reason") == "chain_not_read" and not b["continues"],
          f"OVERFLOW past the cap: Base not read with the reason, nothing held ({held}), P/L not shown")
    saved_total = T.TOTAL_TRANSFERS
    T.TOTAL_TRANSFERS = 5
    try:
        for i, ww in enumerate(("0x00000000000000000000000000000000000ca5f3", "0x00000000000000000000000000000000000ca5f4")):
            install_keep = {8453: FakeChain(8453, BASE_HEAD, [
                {"block": 30_000_000 + k * 100, "sender": ww, "transfers": [(USDC_BASE, ww, LIFI, 1_000_000), (v["address"], LIFI, ww, one)]}
                for k in range(4)], max_range=2_000)}
            T.make_rpc = (lambda chains: (lambda cid, role, dl: FakeRpc(chains.get(cid) or FakeChain(cid, 1_000_000, []))))(install_keep)
            run(ww, holdings_answer([held_row(v["key"], 4 * one, int(v["decimals"]), 1.0)]))
        total = sum(T.held_transfers(j) for j in T._jobs.values())
        check(total <= 5 and "0x00000000000000000000000000000000000ca5f4" in T._jobs
              and "0x00000000000000000000000000000000000ca5f3" not in T._jobs,
              f"OVERFLOW across jobs at most TOTAL_TRANSFERS kept, the older job dropped ({total})")
    finally:
        T.TOTAL_TRANSFERS = saved_total


def progress_checks() -> None:
    """Progress counts real work only: a poll of a finished read does not
    move it, so the page's stall test can fire."""
    w = "0x00000000000000000000000000000000000ca5f5"
    v = base_versions(1)[0]
    one = 10 ** int(v["decimals"])
    install({8453: FakeChain(8453, BASE_HEAD, [
        {"block": 30_000_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 1_000_000), (v["address"], LIFI, w, one)]}],
        max_range=2_000)})
    h = holdings_answer([held_row(v["key"], one, int(v["decimals"]), 1.0)])
    b1 = run(w, h)
    b2 = run(w, h)            # the job is stepped again (run() clears stepped_at between rounds only)
    with T._jobs_lock:
        for j in T._jobs.values():
            j.stepped_at = None
    b3 = run(w, h)
    check(b1["progress"] > 0 and b1["progress"] == b2["progress"] == b3["progress"],
          f"PROGRESS a poll that finds nothing new does not move it ({b1['progress']}, {b2['progress']}, {b3['progress']})")


def realized_loss_checks() -> None:
    """A realized loss stays negative; and a holding that began with a
    transfer after earlier buys says so."""
    w = "0x00000000000000000000000000000000000ca5f6"
    v1, v2 = base_versions(2)
    o1, o2 = (10 ** int(v["decimals"]) for v in (v1, v2))
    install({8453: FakeChain(8453, BASE_HEAD, [
        {"block": 30_000_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 1_000_000_000), (v1["address"], LIFI, w, 10 * o1)]},
        {"block": 30_001_000, "sender": w, "transfers": [(v1["address"], w, LIFI, 4 * o1), (USDC_BASE, LIFI, w, 300_000_000)]},
        {"block": 30_002_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 50_000_000), (v2["address"], LIFI, w, 2 * o2)]},
        {"block": 30_003_000, "sender": w, "transfers": [(v2["address"], w, LIFI, 2 * o2), (USDC_BASE, LIFI, w, 60_000_000)]},
        {"block": 30_004_000, "sender": OTHER, "transfers": [(v2["address"], OTHER, w, 1 * o2)]},
    ], max_range=2_000)})
    b = run(w, holdings_answer([held_row(v1["key"], 6 * o1, int(v1["decimals"]), 90.0),
                                held_row(v2["key"], 1 * o2, int(v2["decimals"]), 30.0)]))
    p1 = next((r for r in b["positions"] if r["key"] == v1["key"]), {})
    p2 = next((r for r in b["positions"] if r["key"] == v2["key"]), {})
    # Buy 10 for 1,000 (avg 100), sell 4 for 300: realized 300 - 400 = -100;
    # 6 left at 600, worth 540: unrealized -60, total -160.
    check(p1.get("realized_usd") == -100.0 and p1.get("unrealized_usd") == -60.0 and p1.get("total_usd") == -160.0,
          f"LOSS realized -100, unrealized -60, total -160 ({p1.get('realized_usd')}, {p1.get('unrealized_usd')})")
    check(p2.get("pnl") == "unknown" and p2.get("reason") == "holding_began_with_transfer"
          and "began with tokens that arrived without a purchase" in b["reasons"].get("holding_began_with_transfer", ""),
          f"REASON the holding began with a transfer in after earlier buys ({p2.get('reason')})")


def order_checks() -> None:
    """4: recent trades in time order across chains."""
    w = "0x00000000000000000000000000000000000ca5ec"
    vb = base_versions(1)[0]
    va = versions_on_buy_chains()[42161][0]
    usdc_arb = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"
    ob, oa = 10 ** int(vb["decimals"]), 10 ** int(va["decimals"])
    base = FakeChain(8453, BASE_HEAD, [
        {"block": 30_000_000, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 10_000_000), (vb["address"], LIFI, w, ob)]},
        {"block": 30_000_900, "sender": w, "transfers": [(USDC_BASE, w, LIFI, 10_000_000), (vb["address"], LIFI, w, ob)]},
    ], max_range=2_000, ts_of=lambda b: 1_700_000_000 + (b - 30_000_000) * 2)
    arb = FakeChain(42161, 420_000_000, [
        {"block": 410_000_000, "sender": w, "transfers": [(usdc_arb, w, LIFI, 10_000_000), (va["address"], LIFI, w, oa)]},
    ], ts_of=lambda b: 1_700_000_000 + (b - 410_000_000) // 4 + 1000)
    install({8453: base, 42161: arb})
    b = run(w, holdings_answer([]))
    seq = [(t["chain_id"], t["block"]) for t in b["trades"]]
    times = [t["time"] for t in b["trades"]]
    check(seq == [(8453, 30_000_900), (42161, 410_000_000), (8453, 30_000_000)] and times == sorted(times, reverse=True),
          f"ORDER newest first by block time across chains ({seq})")


def loss_checks() -> None:
    """A price below the average buy-in: the loss is negative, never folded."""
    w = "0x00000000000000000000000000000000000ca5ee"
    v = base_versions(1)[0]
    one = 10 ** int(v["decimals"])
    install({8453: FakeChain(8453, BASE_HEAD, [
        {"block": 33_000_000, "sender": w, "gas": (187_349, 5_934_217, 27_455_812_931),
         "transfers": [(USDC_BASE, w, LIFI, 360_123_456), (v["address"], LIFI, w, 3 * one)]},
    ], max_range=2_000)})
    b = run(w, holdings_answer([held_row(v["key"], 3 * one, int(v["decimals"]), 100.5)]))
    p = next((r for r in b["positions"] if r["key"] == v["key"]), {})
    t = b["trades"][0] if b["trades"] else {}
    # Worked by hand: value 3 x 100.5 = 301.5; basis 360.123456; unrealized
    # 301.5 - 360.123456 = -58.623456, served -58.6235; -58.623456 / 360.123456
    # = -16.2787...%, served -16.28; average 360.123456 / 3 = 120.041152,
    # served 120.0412. Gas 187,349 x 5,934,217 + 27,455,812,931 =
    # 1,139,225,433,664 wei = 0.000001139225433664 ETH; at the stand-in $4,000,
    # 0.004556901734656, served 0.0046; after gas -58.623456 - 0.0046 = -58.6281.
    check(p.get("unrealized_usd") == -58.6235 and p.get("unrealized_pct") == -16.28 and p.get("avg_buy_price_usd") == 120.0412,
          f"LOSS unrealized -58.6235 (-16.28%) at an average 120.0412 ({p.get('unrealized_usd')}, {p.get('unrealized_pct')}%)")
    check(t.get("gas", {}).get("wei") == "1139225433664" and t.get("gas", {}).get("amount") == "0.000001139225433664",
          f"LOSS gas 0.000001139225433664 ETH exactly ({t.get('gas', {}).get('amount')})")
    tt = b["totals"]
    check(tt["total_usd"] == -58.6235 and tt["return_pct"] == -16.28 and tt["gas_counted_usd"] == 0.0046
          and tt["all_in_usd"] == -58.6281,
          f"LOSS totals: -58.6235, -16.28%, gas 0.0046, after gas -58.6281 ({tt['total_usd']}, {tt['all_in_usd']})")


def notread_checks() -> None:
    w = "0x00000000000000000000000000000000000ca5e6"
    install({})
    bsc = versions_on_buy_chains()[56][0]
    row = {**held_row(NVDAC_KEY, 1, 8, 1.0), "key": bsc["key"], "chain_id": 56, "chain": "BNB Chain"}
    b = run(w, holdings_answer([row]))
    c56 = next(c for c in b["chains"] if c["chain_id"] == 56)
    p = next(r for r in b["positions"] if r["key"] == bsc["key"])
    check(c56["status"] == "not_read" and "BNB Chain" in c56["reason"], "NOTREAD BNB Chain not read, reason given")
    check(p["pnl"] == "unknown" and p["reason"] == "chain_not_read", "NOTREAD its position: P/L unknown, chain_not_read")


def route_checks() -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from te import wallet_router

    w = "0x00000000000000000000000000000000000ca5e7"
    install({8453: invented_chain()})
    app = FastAPI()
    app.include_router(wallet_router.router)
    client = TestClient(app)
    orig = TV.wallet_view.wallet_holdings

    async def hold(_w, _store, client=None):
        return holdings_answer([])
    TV.wallet_view.wallet_holdings = hold
    try:
        r = client.post("/api/wallet/trades", json={"address": w})
        check(r.status_code == 200 and r.headers.get("cache-control") == "no-store" and "positions" in r.json(),
              "ROUTE 200, no-store")
        check(w[2:] not in r.text.lower(), "ROUTE the address is not echoed")
        r = client.post("/api/wallet/trades", json={"address": "0x123"})
        check(r.status_code == 400 and "0x123" not in r.text, "ROUTE 400 for a bad body, nothing repeated")
        r = client.post("/api/wallet/trades", content=json.dumps({"address": w}), headers={"content-type": "text/plain"})
        check(r.status_code == 415, "ROUTE 415 for a body that is not JSON")
        with T._jobs_lock:
            T._jobs.clear()
        TV.gate.running = TV.gate.max_running
        r = client.post("/api/wallet/trades", json={"address": w})
        check(r.status_code == 429 and r.headers.get("retry-after") and r.json().get("reason") == "another_read_in_progress",
              "ROUTE 429 with Retry-After when the gate is full")
    finally:
        TV.gate.running = 0
        TV.wallet_view.wallet_holdings = orig


# ── LIVE ───────────────────────────────────────────────────────────────────

def live_check() -> None:
    import httpx
    from core.te import holdings as H
    from core.te import wallet_view as V
    os.environ.pop("INFURA_API_KEY", None)
    wallet = os.environ.get("PNL_SELFCHECK_WALLET", "").strip().lower()
    if not wallet:
        check(False, "LIVE set PNL_SELFCHECK_WALLET to the wallet to read")
        return
    if V.parse_body(json.dumps({"address": wallet}).encode()) is None:
        check(False, "LIVE PNL_SELFCHECK_WALLET is not a 0x-prefixed 40 character hex address")
        return
    exact = {}
    for k in ("PNL_SELFCHECK_BUYS", "PNL_SELFCHECK_QTY", "PNL_SELFCHECK_PAID"):
        v = os.environ.get(k, "").strip()
        if v:
            try:
                exact[k] = Decimal(v)
            except Exception:  # noqa: BLE001
                check(False, f"LIVE {k} is not a number")
                return
    import importlib
    importlib.reload(T)
    importlib.reload(TV)
    h_raw = H.wallet_holdings(wallet)
    u = httpx.get("https://agents-marketplace-q3k4.onrender.com/api/te/underlying/NVDA?size=100", timeout=40).json()
    ver = next((x for x in u.get("versions") or [] if x.get("key") == NVDAC_KEY), {})
    print(f"      measured NVDAc mid {ver.get('mid_usd')} at block {ver.get('block')}, {ver.get('computed_at')}")

    class ApiStore:
        async def costs_for(self, ticker):
            return [{"key": NVDAC_KEY, "state": "measured", "ref_mid_usd": ver.get("mid_usd"),
                     "computed_at": ver.get("computed_at"), "block": ver.get("block")}] if ticker == "NVDA" else []

    async def hold(_w):
        docs, ok = await V.stored_prices(ApiStore(), ["NVDA"])
        return V.shape(h_raw, docs, ok)
    body = None
    t0 = time.monotonic()
    for i in range(40):
        gate_reset()
        body = asyncio.run(TV.wallet_trades(wallet, None, holdings=hold))
        print(f"      step {i}: {body['status']} " + ", ".join(f"{c['chain']} {c['status']}" for c in body["chains"]))
        if body["status"] == "complete":
            break
        with T._jobs_lock:
            for j in T._jobs.values():
                j.stepped_at = None
    print(f"      {time.monotonic() - t0:.0f} s")
    base = [t for t in body["trades"] if t["chain_id"] == 8453]
    buys = [t for t in body["trades"] if t["side"] == "buy"]
    check(body["status"] == "complete", "LIVE every readable chain read in full")
    nv = [t for t in base if t["side"] == "buy" and t.get("key") == NVDAC_KEY]
    check(len(nv) >= 1 and all(Decimal(t["quantity"]) > 0 and t.get("usd") and Decimal(t["usd"]) > 0 for t in nv),
          f"LIVE at least one NVDAc buy on Base, each with a quantity and the stablecoins paid ({len(nv)} of {len(base)} on Base)")
    for t in nv:
        print(f"      gas {t['gas']}, time {t['time']}")
    if exact:
        got = {"PNL_SELFCHECK_BUYS": Decimal(len(nv)),
               "PNL_SELFCHECK_QTY": sum((Decimal(t["quantity"]) for t in nv), Decimal(0)),
               "PNL_SELFCHECK_PAID": sum((Decimal(t["usd"]) for t in nv), Decimal(0))}
        for k, want in exact.items():
            check(got[k] == want, f"LIVE {k}: the read equals the value set ({'equal' if got[k] == want else 'differs'})")
    p = next((r for r in body["positions"] if r["key"] == NVDAC_KEY), {})
    print(f"      position: avg {p.get('avg_buy_price_usd')}, value {p.get('value_usd')}, unrealized "
          f"{p.get('unrealized_usd')} ({p.get('unrealized_pct')}%), gas ${p.get('gas_usd')}")
    print(f"      totals: {json.dumps(body['totals'])}")
    only_buys = nv and len(nv) == len([t for t in base if t.get("key") == NVDAC_KEY])
    if only_buys:
        paid = sum(Decimal(t["usd"]) for t in nv)
        qty = sum(Decimal(t["quantity"]) for t in nv)
        avg = float((paid / qty).quantize(Decimal("0.0001")))
        check(p.get("pnl") == "known" and p.get("avg_buy_price_usd") is not None
              and abs(p["avg_buy_price_usd"] - avg) <= 0.0001 and p.get("cost_basis_usd") == float(paid),
              f"LIVE average buy price = paid / bought ({p.get('avg_buy_price_usd')} vs {avg}) and P/L known")
        if p.get("value_usd") is not None:
            check(p.get("unrealized_usd") == round(p["value_usd"] - float(paid), 4),
                  "LIVE unrealized = measured value - stablecoins paid")
    else:
        check(p.get("pnl") == "known" and p.get("avg_buy_price_usd"),
              "LIVE NVDAc on Base has a known P/L and an average buy price")


def main() -> int:
    saved = T.make_rpc
    try:
        invented_checks()
        average_checks()
        unpaired_checks()
        roundtrip_checks()
        split_checks()
        resume_checks()
        unpriced_out_checks()
        receipts_checks()
        order_checks()
        busy_wallet_checks()
        time_order_checks()
        overflow_checks()
        progress_checks()
        realized_loss_checks()
        loss_checks()
        notread_checks()
        route_checks()
    finally:
        T.make_rpc = saved
        with T._jobs_lock:
            T._jobs.clear()
    if "--live" in sys.argv:
        live_check()
    print(f"\n{len(FAILURES)} failure(s)" if FAILURES else "\nall checks passed")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
