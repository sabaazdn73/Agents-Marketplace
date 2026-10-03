"""An order on Solana, prepared for the user to sign in their own wallet.

The same promise as prepare.py, with Jupiter's free public quote API in
LI.FI's place (solana_cost.py): this server picks a version, measures the
trade it is asked for at that moment, reads the wallet's balance, and mints a
signing link (sign_link.py, chain "solana"). It signs nothing, sends nothing
and holds nothing; the page opens the link, asks Jupiter again from the
browser, and every transaction is signed there by the user or not at all.

THE REFERENCE IS MEASURED AT PREPARE TIME. The EVM orders are checked against
the stored measurement, which the cost worker refreshes every cycle. Solana
versions are revisited a few hundred at a time (solana_cost.py), so a stored
figure can be older than the signing page's 30-minute limit. This module
therefore quotes the exact trade itself, now, and uses that as the reference:
the buy's paid price per token (a buy) or the route's pre-trade price per token
(a sale), with the limit set by the same rule as every order,
min(5%, max(2%, 3 x cost in whole bps)). The stored measurement, when there is
one, only decides which version to try first.

WHICH WALLET IS WHICH CHAIN. A Solana wallet (base58) prepares an order for a
Solana version, an EVM wallet (0x...) for an EVM version. A key and a wallet
of different kinds are refused, by name.

WHAT IS NOT DONE. A sale given a ticker is not resolved to the version the
wallet holds (the holdings read covers the EVM chains): the sale needs the
version's key, solana/<mint>. The token amount of a sale is in the unit the
mint's decimals give (raw / 10^decimals), the unit the cost engine and
shares_per_token use; a wallet that shows Token-2022 scaled amounts shows
that number times shares_per_token.

Refusals are returned, never raised: {"withheld_reason", "explanation"}.
"""

from __future__ import annotations

import asyncio
import re
import time
from decimal import Decimal

from . import prepare as P
from . import sign_link, solana_cost
from .cost_store import get_store
from .universe import load_universe

EXPLORER = "https://solscan.io"
PAY = {"symbol": "USDC", "mint": solana_cost.USDC_MINT, "address": solana_cost.USDC_MINT,
       "decimals": solana_cost.USDC_DECIMALS}
QUOTE_DEADLINE_S = 25.0
VIEW_CACHE_S = 60.0
VIEW_CACHE_MAX = 500
RANK_SIZES = solana_cost.MEASURED_SIZES

_SOL_KEY = re.compile(r"^solana/([1-9A-HJ-NP-Za-km-z]{32,44})$")
_SIGNATURE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{64,90}$")

RPC = None            # tests put a stand-in here; None means solana_cost.rpc_call
_view_cache: dict = {}


def _rpc():
    return RPC or solana_cost.rpc_call


def is_solana_wallet(w) -> bool:
    """A base58 address of 32 bytes. An EVM address is never one (0 and x are
    outside the alphabet)."""
    return isinstance(w, str) and not w.strip().lower().startswith("0x") and solana_cost.is_pubkey(w.strip())


def tx_url(sig: str) -> str:
    return f"{EXPLORER}/tx/{sig}"


def token_url(mint: str) -> str:
    return f"{EXPLORER}/token/{mint}"


def _rank_size(usd: float) -> int:
    return min(RANK_SIZES, key=lambda s: (abs(s - usd), s))


def _tolerance(cost_bps: float, size_usd: float, symbol: str, slot) -> dict:
    """The tolerance as prepare.tolerance() gives it, from a figure measured now."""
    b = sign_link.round_bps(max(0.0, cost_bps))
    limit = sign_link.limit_from_b(b)
    return {"limit": limit, "limit_pct": round(limit * 100, 4), "rule": P.LIMIT_RULE, "cost_ex_gas_bps": b,
            "size_usd": round(size_usd, 2),
            "basis": (f"{symbol}'s price impact on Jupiter's route for this order, measured at prepare time "
                      f"(slot {slot}): {cost_bps:.2f} bps, {b} whole")}


async def _resolve(query, u) -> dict:
    q = str(query or "").strip()
    m = _SOL_KEY.match(q)
    if m:
        rec = u.record(q, controls=False)
        if rec is None:
            return P._refuse("unknown_instrument", f"No tokenized stock in Tnega's verified universe has the key "
                                                   f"{q[:80]}. tnega_resolve turns a ticker or an address into keys.")
        if not rec.get("listed"):
            return P._refuse("not_listed", f"{rec['symbol']} at {q} is not listed: {rec.get('not_listed_reason')}.")
        return {"ticker": rec["underlying"], "key": rec["key"], "record": rec}
    if P._KEY.match(q):
        return P._refuse("wallet_chain_mismatch", f"{q} is on an EVM chain and the wallet is a Solana address. "
                                                  f"Give an EVM wallet for it, or a solana/<mint> key for this wallet.")
    if q and P._TICKER.match(q) and u.underlying(q.upper()):
        return {"ticker": q.upper()}
    return P._refuse("unknown_instrument", f"'{q[:24]}' is not a ticker or a version key Tnega lists. Give a US "
                                           f"ticker (NVDA) or solana/<mint>; tnega_resolve finds them.")


def _pay_ok(pay_with) -> dict | None:
    if pay_with in (None, ""):
        return None
    s = str(pay_with).strip()
    if s.upper() == "USDC" or s in (f"solana/{solana_cost.USDC_MINT}", solana_cost.USDC_MINT):
        return None
    return P._refuse("bad_pay_token", "A Solana order pays and receives USDC only "
                                      f"(mint {solana_cost.USDC_MINT}).")


async def _shares_per_token(ticker: str, key: str) -> tuple[float | None, str | None, str | None]:
    """(ratio, basis, measured_at) from the stored document, any age: it is
    context, not a price. (None, None, None) when there is none."""
    try:
        docs = await get_store().costs_for(ticker)
    except Exception:  # noqa: BLE001  the store, not the order
        return None, None, None
    d = next((x for x in docs if x.get("key") == key), None)
    return ((d.get("share_ratio"), d.get("share_ratio_basis"), d.get("computed_at")) if d else (None, None, None))


def _balance(symbol: str, decimals: int, raw: int, reads: dict) -> dict:
    if not reads.get("read"):
        return {"read": False, "reason": reads.get("reason") or "not read", "about": "the Solana RPC, not the wallet"}
    b = reads["balance_raw"]
    return {"read": True, "token_symbol": symbol, "balance_raw": str(b), "balance": P.fmt_units(b, decimals),
            "enough": b >= raw, "slot": reads.get("slot")}


def _quote_public(side: str, live: dict, dec_out: int, slippage: int) -> dict:
    out = {"source": "Jupiter", "quoted_at": live["quoted_at"], "price_impact_bps": round(live["impact_bps"], 2),
           "route": live["route"], "context_slot": live.get("slot"), "slippage_bps": slippage,
           "to_amount_expected_raw": str(live["out_raw"]), "to_amount_expected": P.fmt_units(live["out_raw"], dec_out)}
    if live.get("min_out_raw") is not None:
        out.update(to_amount_min_raw=str(live["min_out_raw"]), to_amount_min=P.fmt_units(live["min_out_raw"], dec_out))
    return out


# ── a buy ────────────────────────────────────────────────────────────────────

async def prepare_buy(query, usd_amount, wallet, pay_with=None, max_slippage_bps=None) -> dict:
    w = wallet.strip()
    m = P._slippage(max_slippage_bps)
    if isinstance(m, dict):
        return m
    usd = P._decimal(usd_amount)
    if usd is None or not (sign_link.USD_MIN <= usd <= sign_link.USD_MAX) or usd.as_tuple().exponent < -2:
        return P._refuse("bad_amount", f"usd_amount is US dollars from {sign_link.USD_MIN} to "
                                       f"{sign_link.USD_MAX:,} with at most 2 decimal places. The cap is Tnega's, "
                                       f"for orders prepared this way.")
    bad = _pay_ok(pay_with)
    if bad:
        return bad
    u = await asyncio.to_thread(load_universe)
    r = await _resolve(query, u)
    if "withheld_reason" in r:
        return r
    ticker, want_key = r["ticker"], r.get("key")
    size = _rank_size(float(usd))
    cells, err = await P._cells(ticker, size)
    if err and not want_key:
        return err
    cells = [c for c in (cells or []) if str(c.get("key", "")).startswith("solana/")]

    candidates, not_ranked = [], []
    if want_key:
        rec = r["record"]
        c = next((x for x in cells if x["key"] == want_key), None) or {
            "key": want_key, "symbol": rec["symbol"], "issuer": rec["issuer_name"], "chain": "Solana",
            "computed_at": None}
        candidates.append(c)
    else:
        for c in cells:
            why = None
            if c.get("state") != "filled":
                why = f"no measured cost at ${size:,}: {c.get('state')}"
            elif not c.get("allin_per_share"):
                why = "its share ratio is not read, so its price per share is not comparable; shown, not ranked"
            else:
                _, paused, _ = P._controls(u, c["key"])
                if paused:
                    why = "its pause control was read as paused"
            if why:
                not_ranked.append({"key": c["key"], "symbol": c.get("symbol"), "chain": "Solana", "reason": why})
            else:
                candidates.append(c)
        if not candidates:
            return P._refuse("no_buyable_version",
                             f"No Solana version of {ticker} has a measured, comparable all-in cost at ${size:,}.",
                             size_usd=size, not_ranked=not_ranked[:12])
        candidates.sort(key=lambda c: (c["allin_per_share"], c["key"]))

    attempts, chosen, unavailable = [], None, None
    client = solana_cost.default_client()
    for c in candidates[:P.MAX_QUOTES]:
        rec = u.record(c["key"], controls=False) or {}
        if want_key:
            _, paused, pblock = P._controls(u, c["key"])
            if paused:
                return P._refuse("paused", f"{rec['symbol']}'s pause control was read as paused at slot {pblock}; a "
                                           f"transfer would fail.", controls_url=P._controls_url(c["key"]))
        live = await asyncio.to_thread(solana_cost.quote_buy, client, rec["address"], rec["decimals"], float(usd),
                                       slippage_bps=m, deadline=client.clock() + QUOTE_DEADLINE_S)
        if live["kind"] == "unavailable":
            attempts.append({"key": c["key"], "result": "unavailable", "reason": live["reason"], "sent": True})
            unavailable = (c, rec, live)
            break
        if live["kind"] != "filled":
            attempts.append({"key": c["key"], "result": live["kind"], "reason": live["reason"], "sent": True})
            continue
        tol = _tolerance(live["cost_bps"], float(usd), rec["symbol"], live.get("slot"))
        dec = rec["decimals"]
        vc = P._value_check(
            side="b", expected=Decimal(live["out_raw"]).scaleb(-dec),
            minimum=Decimal(live["min_out_raw"] or 0).scaleb(-dec), amount=usd, ref_price=round(live["paid_per_token"], 6),
            tol=tol, slippage_bps=m,
            basis=(f"Jupiter's route for this order, quoted at prepare time (slot {live.get('slot')}): the price paid "
                   f"per {rec['symbol']} without a network fee"))
        if not vc.get("ran") or not vc.get("ok"):
            attempts.append({"key": c["key"], "result": "value_check_failed", "sent": True,
                             "reason": "the value check failed: " + ("; ".join(vc.get("why") or []) or vc.get("reason", ""))})
            continue
        attempts.append({"key": c["key"], "result": "quoted", "sent": True})
        chosen = (c, rec, live, tol, vc)
        break
    if chosen is None and unavailable is None:
        return P._refuse("no_route", "Jupiter returned no usable route for the versions tried: "
                         + "; ".join(f"{a['key']}: {a['reason']}" for a in attempts) + ".",
                         attempts=attempts, size_usd=size, quotes_asked=len(attempts))

    c, rec, live = (chosen[:3] if chosen else (unavailable[0], unavailable[1], None))
    key, mint = c["key"], rec["address"]
    ctl, _, _ = P._controls(u, key)
    ratio, ratio_basis, ratio_at = await _shares_per_token(ticker, key)
    first = candidates[0]
    if want_key:
        sentence = f"{rec['symbol']} by {rec['issuer_name']} on Solana: the version asked for by key, not compared with others."
    else:
        which = ("the only version" if len(candidates) == 1 else
                 ("the lowest" if c is first else "the next-lowest")
                 + f" measured all-in cost per share among the {len(candidates)} Solana versions")
        sentence = (f"{rec['symbol']} by {rec['issuer_name']} on Solana: {which} of {ticker} with a stored, comparable "
                    f"cost at ${size:,} (measured {c.get('computed_at')}), then quoted for this order on Jupiter.")
        if c is not first:
            sentence += f" {first.get('symbol')} measured lower, and was not used: " \
                        + next((a["reason"] for a in attempts if a["key"] == first["key"]), "no route") + "."
    out = {
        "side": "buy", "chain": "solana",
        "as_of": live["quoted_at"] if live else c.get("computed_at"),
        "as_of_basis": "when Jupiter's route for this order was measured, at prepare time",
        "quotes_asked": len(attempts), "quote_source": "Jupiter",
        "chosen": {"key": key, "ticker": ticker, "name": rec.get("underlying_name"), "symbol": rec["symbol"],
                   "issuer": rec["issuer_name"], "chain": "Solana", "chain_id": None, "mint": mint, "address": mint,
                   "decimals": rec["decimals"], "url": token_url(mint),
                   "shares_per_token": ratio, "shares_per_token_basis": ratio_basis,
                   "shares_per_token_measured_at": ratio_at},
        "why": {"sentence": sentence, "size_usd": size,
                "size_basis": "Solana versions are measured at $1,000 and $10,000; the stored figure only ranks them",
                "rule": "lowest stored all-in price per share-equivalent (the size over the tokens received, over the shares per token)",
                "ranked": [P._brief(x) for x in candidates[:6]] if not want_key else [],
                "not_ranked": not_ranked[:8], "quotes": attempts},
        "rules": P.RULES,
        "assumption": "USDC is taken at $1; no Solana network fee or account rent is included",
        "controls": ctl, "controls_url": P._controls_url(key),
        "eligibility": P._eligibility(u, rec["issuer"]),
    }
    if chosen is None:
        out.update(sign_url=None, link_withheld_reason="quote_unavailable", quote_withheld_reason="unavailable",
                   quote_note=(unavailable[2]["reason"] + ". That is a fact about this call, not about the route. No "
                               "link is given: an order whose route was not quoted and checked is not one this tool "
                               "can stand behind. Ask again shortly."), partial=True)
        return out
    _, _, _, tol, vc = chosen
    raw = int((usd * 10 ** solana_cost.USDC_DECIMALS).to_integral_value())
    link_id, p = sign_link.mint(side="b", chain_id=sign_link.SOLANA, token=mint, pay=solana_cost.USDC_MINT,
                                amount=P._plain(usd), wallet=w, max_slippage_bps=m, cost_ex_gas_bps=tol["cost_ex_gas_bps"])
    reads = await asyncio.to_thread(solana_cost.wallet_token_balance, w, solana_cost.USDC_MINT, _rpc())
    out["order"] = order_fields(p, tol, round(live["paid_per_token"], 6), raw)
    out["tolerance"] = P._tol_public(tol)
    out["measured"] = {"reference_price_usd": round(live["paid_per_token"], 6), "size_usd": float(usd),
                       "slot": live.get("slot"), "measured_at": live["quoted_at"],
                       "price_impact_bps": round(live["impact_bps"], 2),
                       "basis": "Jupiter's route for this order, measured at prepare time (the price paid per token, "
                                "without a network fee)"}
    out["quote"] = _quote_public("b", live, rec["decimals"], m)
    out.update(value_check=vc, balance=_balance("USDC", solana_cost.USDC_DECIMALS, raw, reads),
               sign_url=sign_link.link(link_id), expires_at=P._iso(p["e"]))
    return out


def order_fields(p: dict, tol: dict, reference_price: float | None, raw: int) -> dict:
    """The order as the signing page and the caller read it. One definition,
    for prepare's answer and GET /api/sign/{id}."""
    buy = p["s"] == "b"
    return {"side": "buy" if buy else "sell", "chain": "solana", "mint": p["t"], "pay_mint": p["p"],
            "amount": p["a"], "amount_unit": "usd" if buy else "tokens", "slippage_bps": p["m"], "wallet": p["w"],
            "expires_at": P._iso(p["e"]), "from_amount_raw": str(raw),
            "pay_token": {"role": "pay" if buy else "receive", **PAY},
            "reference_price_usd": reference_price, "limit": tol["limit"] if tol else None,
            "limit_pct": tol["limit_pct"] if tol else None, "cost_ex_gas_bps": p["b"]}


# ── a sale ───────────────────────────────────────────────────────────────────

async def prepare_sell(query, token_amount, wallet, receive=None, max_slippage_bps=None) -> dict:
    w = wallet.strip()
    m = P._slippage(max_slippage_bps)
    if isinstance(m, dict):
        return m
    amt = P._decimal(token_amount)
    if amt is None or amt <= 0 or amt.as_tuple().exponent < -18 or sign_link.amount_ok("s", P._plain(amt)):
        return P._refuse("bad_amount", "token_amount is the number of tokens to sell: above zero, a plain decimal "
                                       "with at most 18 decimal places and fewer than 19 whole digits.")
    bad = _pay_ok(receive)
    if bad:
        return bad
    u = await asyncio.to_thread(load_universe)
    r = await _resolve(query, u)
    if "withheld_reason" in r:
        return r
    if not r.get("key"):
        t = r["ticker"]
        vs = [v for v in u.versions(t, controls=False) if v.get("chain") == "solana" and v.get("listed")]
        return P._refuse("version_key_needed", f"A sale on Solana needs the version's key; the holdings read covers the "
                                               f"EVM chains. Solana versions of {t}: "
                                               + (", ".join(f"{v['symbol']} {v['key']}" for v in vs[:6]) or "none listed") + ".")
    rec, key = r["record"], r["key"]
    mint, dec = rec["address"], rec["decimals"]
    raw = P._raw(amt, dec)
    if raw is None:
        return P._refuse("bad_amount", f"{rec['symbol']} has {dec} decimals; token_amount has more places.")
    ctl, paused, pblock = P._controls(u, key)
    if paused:
        return P._refuse("paused", f"{rec['symbol']}'s pause control was read as paused at slot {pblock}; a transfer "
                                   f"would fail.", controls_url=P._controls_url(key))
    reads = await asyncio.to_thread(solana_cost.wallet_token_balance, w, mint, _rpc())
    if reads.get("read") and reads["balance_raw"] < raw:
        return P._refuse("insufficient_balance", f"{w} holds {P.fmt_units(reads['balance_raw'], dec)} {rec['symbol']} "
                                                 f"at slot {reads.get('slot')}; the order is for {P._plain(amt)}.")
    client = solana_cost.default_client()
    live = await asyncio.to_thread(solana_cost.quote_sell, client, mint, dec, amt, slippage_bps=m,
                                   deadline=client.clock() + QUOTE_DEADLINE_S)
    ratio, ratio_basis, ratio_at = await _shares_per_token(rec["underlying"], key)
    attempt = {"key": key, "result": live["kind"], "sent": True}
    base = {
        "side": "sell", "chain": "solana", "quote_source": "Jupiter",
        "as_of": live.get("quoted_at"),
        "as_of_basis": "when Jupiter's route for this order was measured, at prepare time",
        "quotes_asked": 1,
        "chosen": {"key": key, "ticker": rec["underlying"], "name": rec.get("underlying_name"), "symbol": rec["symbol"],
                   "issuer": rec["issuer_name"], "chain": "Solana", "chain_id": None, "mint": mint, "address": mint,
                   "decimals": dec, "url": token_url(mint), "shares_per_token": ratio,
                   "shares_per_token_basis": ratio_basis, "shares_per_token_measured_at": ratio_at},
        "why": {"sentence": f"{rec['symbol']} on Solana: the version asked for by key.", "quotes": [attempt]},
        "controls": ctl, "controls_url": P._controls_url(key),
        "eligibility": P._eligibility(u, rec["issuer"]),
        "rules": P.RULES, "assumption": "the USDC received is taken at $1; no Solana network fee is included",
    }
    if live["kind"] == "unavailable":
        return {**base, "quote": None, "sign_url": None, "link_withheld_reason": "quote_unavailable",
                "quote_withheld_reason": "unavailable",
                "quote_note": live["reason"] + ". That is a fact about this call, not about the route. No link is given.",
                "partial": True}
    if live["kind"] != "filled":
        return P._refuse("no_route", f"Jupiter returned no usable route to sell {rec['symbol']} for USDC: "
                                     f"{live['reason']}.", quotes_asked=1)
    tol = _tolerance(live["cost_bps"], live["out_usd"], rec["symbol"], live.get("slot"))
    vc = P._value_check(side="s", expected=Decimal(live["out_raw"]).scaleb(-solana_cost.USDC_DECIMALS),
                        minimum=Decimal(live["min_out_raw"] or 0).scaleb(-solana_cost.USDC_DECIMALS), amount=amt,
                        ref_price=round(live["mid_usd"], 6), tol=tol, slippage_bps=m,
                        basis=(f"the pre-trade price per {rec['symbol']} of Jupiter's route for this order, quoted at "
                               f"prepare time (slot {live.get('slot')})"))
    if not vc.get("ran") or not vc.get("ok"):
        return P._refuse("value_check_failed", f"Jupiter's route to sell {rec['symbol']} fails the value check: "
                         + ("; ".join(vc.get("why") or []) or vc.get("reason", "it could not run")) + ".",
                         value_check=vc, quotes_asked=1)
    link_id, p = sign_link.mint(side="s", chain_id=sign_link.SOLANA, token=mint, pay=solana_cost.USDC_MINT,
                                amount=P._plain(amt), wallet=w, max_slippage_bps=m, cost_ex_gas_bps=tol["cost_ex_gas_bps"])
    out = {**base, "order": order_fields(p, tol, round(live["mid_usd"], 6), raw), "tolerance": P._tol_public(tol),
           "measured": {"reference_price_usd": round(live["mid_usd"], 6), "slot": live.get("slot"),
                        "measured_at": live["quoted_at"], "price_impact_bps": round(live["impact_bps"], 2),
                        "basis": "the pre-trade price per token of Jupiter's route for this order, measured at prepare time"},
           "quote": _quote_public("s", live, solana_cost.USDC_DECIMALS, m), "value_check": vc,
           "balance": _balance(rec["symbol"], dec, raw, reads),
           "sign_url": sign_link.link(link_id), "expires_at": P._iso(p["e"])}
    return out


# ── the signing page's read of a Solana link ─────────────────────────────────

def _cache_put(tag: str, value: dict) -> None:
    now = time.monotonic()
    for k in [k for k, (t, _v) in _view_cache.items() if now - t > VIEW_CACHE_S]:
        del _view_cache[k]
    while len(_view_cache) >= VIEW_CACHE_MAX:
        del _view_cache[min(_view_cache, key=lambda k: _view_cache[k][0])]
    _view_cache[tag] = (now, value)


async def _reference(p: dict, rec: dict) -> tuple[dict | None, str | None]:
    """(reference, why not): the price the page checks Jupiter's route against,
    measured now for this order (cached a minute per link), else the stored
    measurement if it is fresh enough, else none."""
    tag = f"{p['n']}:{p['a']}:{p['s']}"
    hit = _view_cache.get(tag)
    if hit and time.monotonic() - hit[0] < VIEW_CACHE_S:
        return hit[1], None
    client = solana_cost.default_client()
    dec = rec["decimals"]
    if p["s"] == "b":
        live = await asyncio.to_thread(solana_cost.quote_buy, client, p["t"], dec, float(p["a"]), slippage_bps=p["m"],
                                       deadline=client.clock() + QUOTE_DEADLINE_S)
        price = live.get("paid_per_token")
        basis = "Jupiter's route for this order, measured when the page was opened: the price paid per token without a network fee"
        compare = "the route's minimum tokens out x reference_price_usd against the dollars paid"
    else:
        live = await asyncio.to_thread(solana_cost.quote_sell, client, p["t"], dec, Decimal(p["a"]), slippage_bps=p["m"],
                                       deadline=client.clock() + QUOTE_DEADLINE_S)
        price = live.get("mid_usd")
        basis = "the pre-trade price per token of Jupiter's route for this order, measured when the page was opened"
        compare = "the route's minimum dollars out against tokens sold x reference_price_usd"
    if live["kind"] == "filled" and price:
        ref = {"price_usd": round(price, 6), "basis": basis, "compare": compare, "measured_at": live["quoted_at"],
               "slot": live.get("slot"), "price_impact_bps": round(live["impact_bps"], 2)}
        _cache_put(tag, ref)
        return ref, None
    return None, f"Jupiter could not be measured just now: {live.get('reason')}"


async def order_view(link_id: str, d) -> tuple[int, dict]:
    """GET /api/sign/{id} for a Solana link already decoded (status ok, not
    used): (status, body)."""
    p = d.payload
    u = await asyncio.to_thread(load_universe)
    key = f"solana/{p['t']}"
    rec = u.record(key, controls=False)
    if rec is None or not rec.get("listed"):
        return 404, {"reason": "invalid"}
    buy = p["s"] == "b"
    dec = solana_cost.USDC_DECIMALS if buy else rec["decimals"]
    raw = P._raw(Decimal(p["a"]), dec)
    if raw is None:
        return 404, {"reason": "invalid"}
    ref, why = await _reference(p, rec)
    lim = sign_link.limit_from_b(p["b"])
    if ref:
        check = {"reference_price_usd": ref["price_usd"], "reference_basis": ref["basis"], "compare": ref["compare"],
                 "limit": lim, "limit_pct": round(lim * 100, 4), "rule": P.LIMIT_RULE, "cost_ex_gas_bps": p["b"],
                 "basis": f"b = {p['b']} bps, the cost without a network fee signed into this link when it was prepared"}
        reference = {"price_usd": ref["price_usd"], "measured_at": ref["measured_at"], "slot": ref["slot"],
                     "price_impact_bps": ref["price_impact_bps"]}
    else:
        check = {"limit": None, "reason": "no measured reference for this order; the page cannot check a route and "
                                          "does not offer signing"}
        reference = None
    tol = {"limit": lim, "limit_pct": round(lim * 100, 4)}
    ctl, _, _ = P._controls(u, key)
    ratio, ratio_basis, _at = await _shares_per_token(rec["underlying"], key)
    body = {
        "status": "ok", **order_fields(p, tol, ref["price_usd"] if ref else None, raw),
        "slippage": p["m"] / 10000, "seconds_left": d.seconds_left,
        "token": {"key": key, "mint": rec["address"], "address": rec["address"], "symbol": rec["symbol"],
                  "ticker": rec["underlying"], "name": rec.get("underlying_name"), "issuer": rec["issuer_name"],
                  "decimals": rec["decimals"], "url": token_url(rec["address"]),
                  "shares_per_token": ratio, "shares_per_token_basis": ratio_basis},
        "reference": reference, "reference_reason": why,
        "value_check": check,
        "quote_api": {"source": "Jupiter", "url": solana_cost.quote_url(),
                      "note": "the page asks Jupiter again from the browser, with from_amount_raw and slippage_bps, "
                              "and refuses a route that fails value_check"},
        "explorer": {"name": "Solscan", "tx": EXPLORER + "/tx/"},
        "controls": ctl, "controls_url": P._controls_url(key),
        "eligibility": P._eligibility(u, rec["issuer"]),
        "rules": P.RULES,
    }
    return 200, body


def valid_signature(tx) -> bool:
    """A Solana transaction signature: base58 of 64 bytes (87 or 88 characters)."""
    if not isinstance(tx, str) or not _SIGNATURE.match(tx):
        return False
    b = solana_cost.b58_decode(tx)
    return b is not None and len(b) == 64
