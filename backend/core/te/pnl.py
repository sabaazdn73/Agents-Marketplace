"""
pnl.py

Profit and loss per position from the trades trades.py found and the
balances and values wallet_view.py serves. Pure: no read happens here.

THE METHOD: AVERAGE COST, the standard for a pooled holding of one asset.
Per version (one token on one chain), oldest trade first, in HOLDING CYCLES:
a cycle starts when the quantity leaves zero and ends when it returns to
zero, and each cycle is costed on its own.
  buy           quantity += q; cost basis += the stablecoins paid (a LI.FI fee
                taken from the amount paid is inside it).
  sell          the units sold leave at the average cost (basis / quantity):
                realized P/L += proceeds - average cost x q; basis and
                quantity fall by that cost and q.
  transfer in   tokens that arrived without a purchase: their cost is not
                known, so the cycle's basis is unknown, and so are its
                unrealized P/L and the realized P/L of its later sales.
  transfer out  tokens that left without a stablecoin payment (a sale for
                another asset, a gift, a bridge, a deposit elsewhere): what
                they fetched is not known, so the cycle's realized P/L is
                unknown. Never booked as a zero.
  back to zero  the cycle ends; the next buy starts a fresh one, with a fresh
                basis. A cycle that ended unknown stays out of the figures;
                the position says how many cycles are left out and why.
A cycle with no buy (tokens that only came in and went out) is never a P/L
cycle.

Then, over the cycles that are fully known:
  average buy price  basis / quantity of the open cycle
  unrealized P/L     current value - basis (the value is wallet_view's: the
                     balance at the pool mid Tnega's cost engine measured,
                     with its block and time)
  realized P/L       sale proceeds - average cost of the units sold
  total P/L          realized + unrealized
  return %           total P/L / the stablecoins paid for the buys of the
                     cycles counted (a simple return, not time-weighted)
  fees               gas of the trades of the cycles counted, in each chain's
                     own coin, and in dollars at today's price of that coin
                     (its 30-minute on-chain average); P/L "all-in"
                     subtracts exactly that gas.

A position's P/L is shown only when its chain's history is read in full, the
quantity the trades add up to equals the balance read on chain, and its open
cycle (if any) is known; otherwise it says why (REASONS) and is not counted.
Stablecoins and each chain's own coin are cash, not positions.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

USD_Q = Decimal("0.0001")

REASONS = {
    "chain_not_read": "Trades are not read on this chain, so the cost of this position is not known.",
    "history_partial": ("This chain's trade history is still being read; the P/L appears once the read is "
                        "complete."),
    "no_purchase_found": ("No purchase of this token by this wallet was found on chain, so its cost is not "
                          "known (it may have arrived by a transfer or a bridge)."),
    "transfer_in_without_price": ("Some of these tokens arrived without a purchase (a transfer, a bridge, or a "
                                  "trade paid in another asset), so their cost, and the P/L, are not known."),
    "left_without_price": ("Some of these tokens left the wallet without a stablecoin payment (a sale for another "
                           "asset, a gift, a bridge or a deposit elsewhere), so what they fetched, and the P/L, "
                           "are not known."),
    "quantity_mismatch": ("The trades found do not add up to the balance read on chain, so the cost basis cannot "
                          "be matched to what is held."),
    "sold_more_than_found": ("More was sold or sent out than the purchases found, so the cost of what was sold "
                             "is not known."),
    "no_current_value": ("Tnega has no current measured price for this version, so its unrealized P/L is not "
                         "shown."),
    "held_only_search": ("On this chain only the versions held now are searched; this one is not held, so its "
                         "history may be incomplete."),
    "cycles_left_out": ("Earlier holdings of this token, sold or sent out in full, are left out of the figures: "
                        "their cost or what they fetched is not known."),
}

METHOD = ("Average cost per position, in holding cycles (from zero back to zero): buys add the stablecoins paid "
          "to the cost basis; a sale removes units at the average cost and realizes proceeds minus that cost. "
          "Tokens that arrive or leave without a stablecoin payment make their cycle's P/L unknown, and that cycle "
          "is left out; nothing is estimated.")
RETURN_BASIS = ("Total P/L divided by the stablecoins paid for the buys of the cycles counted: a simple return, "
                "not time-weighted.")
GAS_BASIS = ("Gas of the trade transactions this wallet sent (gas used x effective gas price, plus the L1 data "
             "fee on Base), in each chain's own coin; in dollars at today's 30-minute on-chain average price of "
             "that coin, not the price on the day. Gas paid counts the trades of the positions counted, the same "
             "gas P/L after gas subtracts; the gas of every trade found is given beside it. A separate approval "
             "transaction is not counted.")
STABLE_BASIS = "Stablecoins paid or received are counted at $1 each: an assumption that they hold their peg."


def _d(x) -> Decimal | None:
    if x is None:
        return None
    try:
        return Decimal(str(x))
    except (InvalidOperation, ValueError):
        return None


def _f(x: Decimal | None) -> float | None:
    if x is None:
        return None
    v = float(x.quantize(USD_Q))
    return 0.0 if v == 0 else v   # never a signed zero


def _pct(num: Decimal, den: Decimal) -> float | None:
    if den <= 0:
        return None
    v = float((num / den * 100).quantize(Decimal("0.01")))
    return 0.0 if v == 0 else v


def _q(x: Decimal | None) -> str | None:
    if x is None:
        return None
    s = format(x.normalize(), "f")
    return "0" if s in ("-0", "") else s


def _cycle() -> dict:
    return {"qty": Decimal(0), "cost": Decimal(0), "basis_known": True, "realized": Decimal(0),
            "realized_known": True, "why": None, "bought_usd": Decimal(0), "bought_qty": Decimal(0),
            "buys": 0, "sells": 0, "gas": {}}


def cycle_known(c: dict) -> bool:
    return c["basis_known"] and c["realized_known"] and c["buys"] > 0


def cycle_why(c: dict) -> str:
    if c["buys"] == 0:
        return "no_purchase_found"
    return c["why"] or "transfer_in_without_price"


def walk(trades: list[dict]) -> dict[str, dict]:
    """The average-cost walk in holding cycles, per version key, over trades
    oldest first."""
    out: dict[str, dict] = {}
    for t in trades:
        k = t["key"]
        p = out.setdefault(k, {
            "open": None, "closed": [], "trades": 0, "buys": 0, "sells": 0, "transfers": 0,
            "bought_usd": Decimal(0), "bought_qty": Decimal(0), "sold_usd": Decimal(0), "sold_qty": Decimal(0),
            "in_qty": Decimal(0), "out_qty": Decimal(0), "gas": {}, "first": t.get("time"), "last": t.get("time")})
        q = _d(t["quantity"]) or Decimal(0)
        usd = _d(t.get("usd"))
        side = t["side"]
        p["trades"] += 1
        p["last"] = t.get("time")
        c = p["open"]
        if c is None:
            c = p["open"] = _cycle()
        if side == "buy":
            p["buys"] += 1
            p["bought_usd"] += usd
            p["bought_qty"] += q
            c["buys"] += 1
            c["qty"] += q
            c["cost"] += usd
            c["bought_usd"] += usd
            c["bought_qty"] += q
        elif side == "transfer_in":
            p["transfers"] += 1
            p["in_qty"] += q
            c["qty"] += q
            c["basis_known"] = False
            c["why"] = c["why"] or "transfer_in_without_price"
        else:  # sell or transfer_out
            if side == "sell":
                p["sells"] += 1
                p["sold_usd"] += usd
                p["sold_qty"] += q
                c["sells"] += 1
            else:
                p["transfers"] += 1
                p["out_qty"] += q
            if q > c["qty"]:
                c["basis_known"] = c["realized_known"] = False
                c["why"] = c["why"] or "sold_more_than_found"
                c["qty"] = Decimal(0)
            else:
                part = c["cost"] * q / c["qty"] if c["qty"] > 0 else Decimal(0)
                if side == "sell" and c["basis_known"]:
                    c["realized"] += usd - part
                elif side == "sell":
                    c["realized_known"] = False
                else:
                    c["realized_known"] = False
                    c["why"] = c["why"] or "left_without_price"
                c["cost"] -= part
                c["qty"] -= q
        g = t.get("gas")
        if g and g.get("amount"):
            amt = Decimal(g["amount"])
            c["gas"][g["symbol"]] = c["gas"].get(g["symbol"], Decimal(0)) + amt
            p["gas"][g["symbol"]] = p["gas"].get(g["symbol"], Decimal(0)) + amt
        if c["qty"] == 0:
            p["closed"].append(c)
            p["open"] = None
    return out


def _gas_usd(gas: dict, native_usd: dict) -> Decimal | None:
    total = Decimal(0)
    for sym, amt in gas.items():
        px = native_usd.get(sym)
        if px is None:
            return None
        total += amt * Decimal(str(px))
    return total


def _gas_list(gas: dict) -> list[dict]:
    return [{"symbol": s, "amount": _q(a)} for s, a in sorted(gas.items())]


def positions(trades: list[dict], held: list[dict], chain_status: dict[int, dict],
              native_usd: dict[str, float]) -> tuple[list[dict], dict]:
    """(positions, totals). `held`: wallet_view rows of stocks, ETFs and
    untyped versions (balance, value_usd, price). `chain_status`: chain_id ->
    {"status": "complete" | "partial" | "not_read" | ..., "mode": ...}.
    `native_usd`: coin symbol -> today's price."""
    walked = walk(trades)
    by_key_held = {r["key"]: r for r in held}
    first_trade = {}
    for t in trades:
        first_trade.setdefault(t["key"], t)
    keys = list(dict.fromkeys([r["key"] for r in held] + [t["key"] for t in trades]))
    rows = []
    for k in keys:
        h = by_key_held.get(k)
        w = walked.get(k)
        info = h or first_trade[k]
        cid = info.get("chain_id")
        cs = chain_status.get(cid) or {}
        balance = _d(h.get("balance")) if h else Decimal(0)
        value = _d(h.get("value_usd")) if h and h.get("value_usd") is not None else None
        o = (w or {}).get("open")
        closed = (w or {}).get("closed") or []
        known_closed = [c for c in closed if cycle_known(c)]
        left_out = [c for c in closed if not cycle_known(c)]
        row = {
            "key": k, "symbol": info.get("symbol"), "ticker": info.get("ticker"), "issuer": info.get("issuer"),
            "chain": info.get("chain"), "chain_id": cid, "name": (h or {}).get("name") or info.get("ticker"),
            "type": (h or {}).get("type"), "balance": h.get("balance") if h else "0",
            "value_usd": _f(value) if value is not None else (0.0 if not h else None),
            "quantity_from_trades": _q(o["qty"]) if o else "0",
            "cost_basis_usd": None, "avg_buy_price_usd": None, "unrealized_usd": None, "unrealized_pct": None,
            "realized_usd": None, "total_usd": None, "total_pct": None, "counted_bought_usd": None,
            "bought_usd": _f(w["bought_usd"]) if w else 0.0, "bought_quantity": _q(w["bought_qty"]) if w else "0",
            "sold_usd": _f(w["sold_usd"]) if w else 0.0, "sold_quantity": _q(w["sold_qty"]) if w else "0",
            "transferred_in": _q(w["in_qty"]) if w else "0", "transferred_out": _q(w["out_qty"]) if w else "0",
            "trades": w["trades"] if w else 0, "buys": w["buys"] if w else 0, "sells": w["sells"] if w else 0,
            "transfers": w["transfers"] if w else 0,
            "gas": _gas_list((w or {}).get("gas") or {}),
            "gas_usd": _f(_gas_usd(w["gas"], native_usd)) if w and w["gas"] else None,
            "counted_gas": [], "counted_gas_usd": None,
            "cycles_counted": 0, "cycles_left_out": len(left_out),
            "cycles_left_out_reasons": sorted({cycle_why(c) for c in left_out}),
            "first_trade": w["first"] if w else None, "last_trade": w["last"] if w else None,
            "pnl": "unknown", "reason": None, "unrealized_reason": None,
        }
        open_qty = o["qty"] if o else Decimal(0)
        reason = None
        if cs.get("status") == "not_read":
            reason = "chain_not_read"
        elif cs.get("status") != "complete":
            reason = "history_partial"
        elif not w or w["buys"] == 0:
            reason = "no_purchase_found"
        elif open_qty != balance:
            reason = "held_only_search" if cs.get("mode") == "held" and not h else "quantity_mismatch"
        elif o is not None and not cycle_known(o):
            reason = cycle_why(o)
        elif not known_closed and o is None:
            reason = cycle_why(left_out[-1]) if left_out else "no_purchase_found"
        if reason is None:
            cycles = known_closed + ([o] if o is not None else [])
            realized = sum((c["realized"] for c in cycles), Decimal(0))
            bought = sum((c["bought_usd"] for c in cycles), Decimal(0))
            gas: dict = {}
            for c in cycles:
                for s, a in c["gas"].items():
                    gas[s] = gas.get(s, Decimal(0)) + a
            row["realized_usd"] = _f(realized)
            row["counted_bought_usd"] = _f(bought)
            row["counted_gas"] = _gas_list(gas)
            gu = _gas_usd(gas, native_usd)
            row["counted_gas_usd"] = _f(gu) if gas and gu is not None else (0.0 if not gas else None)
            row["cycles_counted"] = len(cycles)
            unreal = None
            if o is None:
                unreal = Decimal(0)
            else:
                row["cost_basis_usd"] = _f(o["cost"])
                row["avg_buy_price_usd"] = _f(o["cost"] / o["qty"])
                if value is not None:
                    unreal = value - o["cost"]
                    row["unrealized_pct"] = _pct(unreal, o["cost"])
                else:
                    row["unrealized_reason"] = "no_current_value"
            if unreal is not None:
                row["unrealized_usd"] = _f(unreal)
                tot = realized + (_d(row["unrealized_usd"]) or Decimal(0))
                row["total_usd"] = _f(tot)
                row["total_pct"] = _pct(tot, bought)
                row["pnl"] = "known"
            else:
                row["pnl"] = "realized_only"
        row["reason"] = reason
        rows.append(row)
    rows.sort(key=lambda r: (r["balance"] in ("0", None), -(r["value_usd"] or 0), r["key"]))
    return rows, totals(rows, trades, native_usd)


def totals(rows: list[dict], trades: list[dict], native_usd: dict[str, float]) -> dict:
    counted = [r for r in rows if r["pnl"] == "known"]
    un = sum((_d(r["unrealized_usd"]) for r in counted), Decimal(0))
    re_ = sum((_d(r["realized_usd"]) for r in counted), Decimal(0))
    invested = sum((_d(r["counted_bought_usd"]) or Decimal(0) for r in counted), Decimal(0))
    tot = un + re_
    gas_all: dict[str, Decimal] = {}
    for t in trades:
        g = t.get("gas")
        if g and g.get("amount"):
            gas_all[g["symbol"]] = gas_all.get(g["symbol"], Decimal(0)) + Decimal(g["amount"])
    gas_counted: dict[str, Decimal] = {}
    for r in counted:
        for g in r["counted_gas"]:
            gas_counted[g["symbol"]] = gas_counted.get(g["symbol"], Decimal(0)) + Decimal(g["amount"])
    gu_all = _gas_usd(gas_all, native_usd)
    gu_counted = _gas_usd(gas_counted, native_usd)
    sides = [t["side"] for t in trades]
    # Sales and buys that sit outside the figures: in positions not counted,
    # and in the cycles a counted position leaves out.
    sells_out = sum(r["sells"] for r in rows if r["pnl"] != "known")
    buys_out = sum(r["buys"] for r in rows if r["pnl"] != "known")
    cycles_out = sum(r["cycles_left_out"] for r in counted)
    return {
        "unrealized_usd": _f(un) if counted else None,
        "realized_usd": _f(re_) if counted else None,
        "total_usd": _f(tot) if counted else None,
        "invested_usd": _f(invested) if counted else None,
        "return_pct": _pct(tot, invested) if counted else None,
        "gas_counted": _gas_list(gas_counted),
        "gas_counted_usd": (_f(gu_counted) if gu_counted is not None else None) if gas_counted else (0.0 if counted else None),
        "gas": _gas_list(gas_all),
        "gas_usd": (_f(gu_all) if gu_all is not None else None) if gas_all else 0.0,
        "all_in_usd": (_f(tot - gu_counted) if gu_counted is not None else None) if counted else None,
        "trades": len(trades),
        "buys": sides.count("buy"),
        "sells": sides.count("sell"),
        "transfers": sides.count("transfer_in") + sides.count("transfer_out"),
        "positions": len(rows),
        "positions_counted": len(counted),
        "positions_not_counted": len(rows) - len(counted),
        "sells_not_counted": sells_out,
        "buys_not_counted": buys_out,
        "cycles_left_out": cycles_out,
        "basis": ("the positions whose P/L is known, and of them the holding cycles that are known; the others are "
                  "listed with the reason"),
    }
