"""An order, prepared for the user to sign in their own wallet.

WHAT THIS DOES AND DOES NOT DO
------------------------------
It picks a version, asks LI.FI for a route, reads the wallet's allowance and
balance, and mints a signing link (sign_link.py). It signs nothing, sends
nothing and holds nothing: the link opens tnega.app/sign/<id>, where the user
connects their own wallet, the page asks LI.FI again, and every transaction
is signed there by the user or not at all.

HOW A VERSION IS CHOSEN (a buy with a ticker)
---------------------------------------------
The same figure the site ranks by (cost_views.BEST_RULE): the all-in price per
share-equivalent, from the cost engine's stored measurement at the measured
size nearest to the order, over the versions on the chains an order can be
prepared on (buy_chains.BUY_CHAINS) that fill that size, whose share ratio is
read, that can be paid for with the token asked for, and whose pause control
was not read as paused. That is a statement of which measured figure is
lowest, at a named block, and the answer says it in those words. At most two
versions are quoted (LI.FI's keyless limit is shared by every caller of this
server): the lowest, and the next only if LI.FI finds no route for the first
or the route fails a check.

THE CHECKS ON A QUOTE, as the site's buy panel makes them (trade/lifi.js):
the answer matches the question, no step names Jupiter, and a value check:
the minimum the route enforces, priced at our own measured figure, against
what is paid. A buy uses the measured all-in price per token; a sell uses the
pool's measured pre-trade mid per token. Refused when the minimum sits below
the estimate by more than the slippage plus 0.1%, when the loss on the
minimum exceeds max(2%, 3 x our measured cost in bps), or when the value is
more than 5% above what is paid (a wrong token or wrong decimals, not a
bargain).

APPROVALS ARE EXACT. The approval an order names is the amount sent, raw, to
the contract LI.FI names (its approvalAddress), never an unlimited amount.

Refusals are returned, never raised: {"withheld_reason", "explanation"}.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import re
import time
from decimal import Decimal, InvalidOperation

from eth_abi import encode
from eth_utils import function_signature_to_4byte_selector as _sel

from . import lifi_quote, sign_link
from . import controls as te_controls
from .buy_chains import BUY_CHAINS, address_url, default_pay, pay_by_symbol, pay_symbols, pay_token
from .cost import LIFI_FEE_RATE, SIZES
from .cost_store import get_store
from .cost_views import underlying_view
from .holdings import fmt_units, holdings, read_at_block
from .universe import load_universe

RULES = "Tnega prepared this; nothing is signed until you sign each transaction in your own wallet."
MAX_QUOTES = 2
READ_DEADLINE_S = 10.0
CONTROLS_TEXT_MAX = 200
API_BASE = "https://agents-marketplace-q3k4.onrender.com"

_KEY = re.compile(r"^(\d+)/(0x[0-9a-fA-F]{40})$")
_TICKER = re.compile(r"^[A-Za-z0-9.\-]{1,12}$")
_WALLET = re.compile(r"^0x[0-9a-fA-F]{40}$")
_ALLOWANCE = _sel("allowance(address,address)")
_BALANCE = _sel("balanceOf(address)")

MIN_GAP_EXTRA = 0.001
MAX_GAIN = 0.05

# A REFERENCE HAS AN AGE LIMIT. The signing page will not check a quote
# against a measurement older than 30 minutes, so the server does not mint a
# link on one either: an order prepared on an 11-hour-old price passed the
# value check here and was then refused by the page. A measurement dated
# more than 5 minutes ahead of this server's clock is refused the same way.
REFERENCE_MAX_AGE_S = 30 * 60
REFERENCE_MAX_AHEAD_S = 5 * 60


def _now() -> float:
    return time.time()


def _stale(measured_at: str | None) -> str | None:
    """None if a reference measured at `measured_at` may be used now, else
    why not, in words."""
    if not measured_at:
        return "it carries no measurement time"
    try:
        d = dt.datetime.fromisoformat(str(measured_at).replace("Z", "+00:00"))
        # The cost engine always writes "Z"; a time without a zone is read
        # as UTC rather than as this machine's local time.
        t = (d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)).timestamp()
    except ValueError:
        return "its measurement time cannot be read"
    age = _now() - t
    if age > REFERENCE_MAX_AGE_S:
        return f"it was measured {age / 60:.0f} minutes ago ({measured_at}), over the 30-minute limit"
    if age < -REFERENCE_MAX_AHEAD_S:
        return f"it is dated {-age / 60:.0f} minutes ahead of this server's clock ({measured_at})"
    return None


def _refuse(reason: str, explanation: str, **extra) -> dict:
    return {"withheld_reason": reason, "explanation": explanation, **extra}


def nearest_size(usd: float) -> int:
    return min(SIZES, key=lambda s: (abs(s - usd), s))


# ── arguments ────────────────────────────────────────────────────────────────

def _wallet(w) -> str | dict:
    if not isinstance(w, str) or not _WALLET.match(w.strip()):
        return _refuse("bad_wallet", "wallet must be an EVM address: 0x followed by 40 hex characters.")
    w = w.strip().lower()
    if w == "0x" + "0" * 40:
        return _refuse("bad_wallet", "the zero address cannot sign anything.")
    return w


def _slippage(m) -> int | dict:
    if m is None or m == "":
        return sign_link.DEFAULT_SLIPPAGE_BPS
    # A whole number, however it arrives: 50, "50" and 50.0 (JSON clients
    # send numbers as floats) are the same answer; 50.5 is not.
    d = _decimal(m)
    n = int(d) if d is not None and d == d.to_integral_value() else None
    if n is None or not sign_link.SLIPPAGE_MIN_BPS <= n <= sign_link.SLIPPAGE_MAX_BPS:
        return _refuse("bad_slippage", f"max_slippage_bps is a whole number from {sign_link.SLIPPAGE_MIN_BPS} to "
                                       f"{sign_link.SLIPPAGE_MAX_BPS} (0.1% to 3%); the default is "
                                       f"{sign_link.DEFAULT_SLIPPAGE_BPS}.")
    return n


def _decimal(x) -> Decimal | None:
    if isinstance(x, bool) or x is None:
        return None
    try:
        d = Decimal(str(x).strip())
    except (InvalidOperation, ValueError):
        return None
    return d if d.is_finite() else None


def _plain(d: Decimal) -> str:
    s = format(d, "f")
    return s.rstrip("0").rstrip(".") if "." in s else s


def _raw(amount: Decimal, decimals: int) -> int | None:
    """The exact integer amount, or None if it has more places than the token."""
    scaled = amount.scaleb(int(decimals))
    return int(scaled) if scaled == scaled.to_integral_value() else None


def _pay_arg(arg, chain_id: int | None = None) -> tuple[str | None, int | None, str | None] | dict:
    """(symbol, chain_id, address) from a symbol ("USDC") or "chainId/0xaddr"."""
    if arg in (None, ""):
        return (None, None, None)
    s = str(arg).strip()
    m = _KEY.match(s)
    if m:
        cid, addr = int(m.group(1)), m.group(2).lower()
        t = pay_token(cid, addr) if cid in BUY_CHAINS else None
        if not t:
            return _refuse("bad_pay_token", f"{s} is not a pay token an order can use. On each chain: "
                                            + _pay_list() + ".")
        return (t["symbol"], cid, addr)
    if s.upper() in pay_symbols():
        return (s.upper(), None, None)
    return _refuse("bad_pay_token", f"'{s[:20]}' is not a pay token an order can use. Give a symbol "
                                    f"({', '.join(pay_symbols())}) or <chainId>/<address>. On each chain: "
                                    + _pay_list() + ".")


def _pay_list() -> str:
    return "; ".join(f"{c['name']} ({cid}): " + ", ".join(t["symbol"] for t in c["pay"])
                     for cid, c in BUY_CHAINS.items())


def _pay_for_chain(chain_id: int, sym: str | None, pcid: int | None, paddr: str | None) -> dict | None:
    if paddr:
        return pay_token(chain_id, paddr) if pcid == chain_id else None
    if sym:
        return pay_by_symbol(chain_id, sym)
    return default_pay(chain_id)


# ── the instrument ───────────────────────────────────────────────────────────

async def resolve(query) -> dict:
    """A ticker ("NVDA") or a version key ("8453/0x..."): {"ticker", "key"?, "record"?}."""
    q = str(query or "").strip()
    u = await asyncio.to_thread(load_universe)
    m = _KEY.match(q)
    if m or "/" in q:
        rec = u.record(f"{m.group(1)}/{m.group(2).lower()}" if m else q, controls=False)
        if rec is None:
            return _refuse("unknown_instrument", f"No tokenized stock in Tnega's verified universe has the key "
                                                 f"{q[:80]}. tnega_resolve turns a ticker or an address into keys.")
        # The chain first: a Solana or Optimism version is refused for where
        # it is, whatever else is true of it.
        if rec.get("chain") == "solana":
            return _refuse("chain_not_supported", f"{rec['symbol']} is on Solana. An order for it needs a Solana "
                                                  f"wallet (a base58 address), which is how this tool tells the two "
                                                  f"apart.")
        if rec.get("chain_id") not in BUY_CHAINS:
            return _refuse("chain_not_supported", f"{rec['symbol']} is on {rec['chain_name']}; an order can be "
                                                  f"prepared on {', '.join(c['name'] for c in BUY_CHAINS.values())} only.")
        if not rec.get("listed"):
            return _refuse("not_listed", f"{rec['symbol']} at {q} is not listed: {rec.get('not_listed_reason')}.")
        return {"ticker": rec["underlying"], "key": rec["key"], "record": rec}
    if q and _TICKER.match(q) and u.underlying(q.upper()):
        return {"ticker": q.upper()}
    return _refuse("unknown_instrument", f"'{q[:24]}' is not a ticker or a version key Tnega lists. Give a US "
                                         f"ticker (NVDA) or <chainId>/<token address>; tnega_resolve finds them.")


def _controls(u, key: str) -> tuple[dict | None, bool, int | None]:
    """(each power's state and text, paused?, the pause read's block)."""
    ctl = (te_controls.by_key(u, key) or {}).get("controls")
    if not ctl:
        return None, False, None
    out = {}
    for p in te_controls.CONTROL_KEYS:
        c = ctl.get(p)
        if not isinstance(c, dict):
            continue
        text = c.get("text") or ""
        out[p] = {"state": c.get("state"),
                  "text": text if len(text) <= CONTROLS_TEXT_MAX else text[:CONTROLS_TEXT_MAX - 1] + "…",
                  "block": (c.get("evidence") or {}).get("block_or_slot")}
    pause = ctl.get("pause") or {}
    paused = str(pause.get("state") or "").lower().startswith("paused")
    return out, paused, (pause.get("evidence") or {}).get("block_or_slot")


def _controls_url(key: str) -> str:
    return f"{API_BASE}/api/te/controls?by=key&key={key}"


def _eligibility(u, issuer_id: str) -> dict | None:
    return u.eligibility(issuer_id)


async def _cells(ticker: str, size: int) -> tuple[list[dict] | None, dict | None]:
    try:
        status, body = await underlying_view(get_store(), ticker, size)
    except Exception as e:  # noqa: BLE001  the store, not the instrument
        return None, _refuse("cost_store_unavailable", f"Tnega's cost store could not be read just now "
                                                       f"({type(e).__name__}). That is a fact about this call, not "
                                                       f"about {ticker}.")
    if status == 503:
        return None, _refuse("not_measured", "The cost worker has not written its measurements yet on this server.")
    if status == 404:
        return None, _refuse("unknown_instrument", f"{ticker} is not in the verified universe Tnega measures.")
    return body.get("versions") or [], None


def _brief(c: dict) -> dict:
    return {"key": c["key"], "symbol": c.get("symbol"), "issuer": c.get("issuer"), "chain": c.get("chain"),
            "allin_per_share": c.get("allin_per_share"), "allin_per_token": c.get("allin_per_token"),
            "cost_bps": c.get("cost_bps"), "block": c.get("block"), "measured_at": c.get("computed_at")}


# ── chain reads for the wallet ───────────────────────────────────────────────

def _wallet_reads(chain_id: int, token: str, wallet: str, spender: str | None) -> dict:
    """The wallet's balance of the token it sends, and its allowance to the
    spender, at one block. Blocking; run in a thread."""
    calls = [(token, _BALANCE + encode(["address"], [wallet]))]
    if spender:
        calls.append((token, _ALLOWANCE + encode(["address", "address"], [wallet, spender])))
    try:
        block, _ts, res = read_at_block(chain_id, calls, time.monotonic() + READ_DEADLINE_S)
    except Exception as e:  # noqa: BLE001  the endpoint, not the wallet
        from .rpcclient import public_reason
        return {"read": False, "reason": public_reason(e)}
    val = [int.from_bytes(r[:32], "big") if r and len(r) >= 32 else None for r in res]
    return {"read": True, "block": block, "balance_raw": val[0],
            "allowance_raw": val[1] if spender and len(val) > 1 else None}


def _approval(token: dict, spender: str | None, amount_raw: int, reads: dict) -> dict:
    out = {"token": token["address"], "token_symbol": token["symbol"], "spender": spender,
           "spender_basis": "LI.FI's approvalAddress in its quote", "amount_raw": str(amount_raw),
           "amount": fmt_units(amount_raw, token["decimals"]), "unlimited": False}
    if not spender:
        out["needed"] = None
        out["note"] = "no quote, so the spender is not known yet; the signing page reads it from its own quote"
    elif reads.get("read") and reads.get("allowance_raw") is not None:
        out["current_allowance_raw"] = str(reads["allowance_raw"])
        out["needed"] = reads["allowance_raw"] < amount_raw
        out["read_at_block"] = reads["block"]
    else:
        out["needed"] = None
        out["note"] = ("current allowance unknown (" + (reads.get("reason") or "not read")
                       + "); the signing page reads it again before asking for an approval")
    return out


def _balance(token: dict, amount_raw: int, reads: dict) -> dict:
    if not reads.get("read") or reads.get("balance_raw") is None:
        return {"read": False, "reason": reads.get("reason") or "not read",
                "about": "the chain endpoint, not the wallet"}
    b = reads["balance_raw"]
    return {"read": True, "token_symbol": token["symbol"], "balance_raw": str(b),
            "balance": fmt_units(b, token["decimals"]), "enough": b >= amount_raw, "block": reads["block"]}


# ── value check ──────────────────────────────────────────────────────────────

# The limit rule lives in sign_link (limit_from_b), because the link carries
# its input: the cost without gas as a whole number of bps, "b".
LIMIT_RULE = sign_link.LIMIT_RULE


def _nearest_filled(d: dict, usd_value: float) -> int | None:
    """The index of the measured size nearest the order's dollar value among
    the sizes this version filled with both a cost and a mid, or None. A
    filled cell missing either cannot serve as a reference or set a limit."""
    none = [None] * len(SIZES)
    filled = [i for i, st in enumerate(d.get("status") or []) if st == "filled" and i < len(SIZES)
              and (d.get("cost_usd") or none)[i] is not None and (d.get("mid_usd") or none)[i]]
    return min(filled, key=lambda i: (abs(SIZES[i] - usd_value), SIZES[i])) if filled else None


def tolerance(d: dict, usd_value: float) -> dict | None:
    """How far below our reference the minimum a route enforces may sit: ONE
    rule for buys and sells, and the number the signing page applies too.

        limit = min(5%, max(2%, 3 x cost_ex_gas_bps))

    cost_ex_gas_bps is the version's measured cost without gas and the L1
    fee (the pool's price impact and fees, and LI.FI's fee), over the size,
    at the measured size nearest the order's dollar value. Gas is paid by the
    wallet on top and is not taken out of the tokens a route delivers, so it
    must never widen the tolerance: at $100 on Ethereum gas alone made the
    all-in cost 543 bps and the limit 16%, where the pool's own cost was a
    few dozen bps."""
    i = _nearest_filled(d, usd_value)
    if i is None:
        return None
    size = SIZES[i]
    cost = d["cost_usd"][i]
    gas = (d.get("gas_usd") or [None] * len(SIZES))[i] or 0.0
    l1 = (d.get("gas_ctx") or {}).get("l1_fee_usd") or 0.0
    bps = max(0.0, (cost - gas - l1) / size * 1e4)
    # Rounded to the whole bps the link carries, BEFORE the limit is taken,
    # so the limit here and the one the page computes from the link agree.
    b = sign_link.round_bps(bps)
    limit = sign_link.limit_from_b(b)
    return {"limit": limit, "limit_pct": round(limit * 100, 4), "rule": LIMIT_RULE,
            "cost_ex_gas_bps": b, "size_usd": size, "index": i,
            "basis": (f"{d.get('symbol')}'s measured cost without gas or the L1 fee at ${size:,}, the measured "
                      f"size nearest ${usd_value:,.2f}: {bps:.2f} bps, {b} whole (block {d.get('block')})")}


def _value_check(*, side: str, expected: Decimal, minimum: Decimal, amount: Decimal, ref_price: float | None,
                 tol: dict | None, slippage_bps: int, basis: str) -> dict:
    """buy: amount is dollars paid, expected/minimum are tokens out, ref_price
    is our measured price per token without gas. sell: amount is tokens
    sold, expected/minimum are dollars out, ref_price is the pool's mid per
    token. tol is tolerance() for the version the reference came from."""
    if not ref_price or ref_price <= 0 or expected <= 0 or minimum <= 0 or amount <= 0:
        return {"ran": False, "reason": "no measured reference price for this version at this block"}
    if not tol:
        return {"ran": False, "reason": "no measured cost to set the tolerance from"}
    ref = Decimal(str(ref_price))
    if side == "b":
        value_in, value_out = amount, minimum * ref
    else:
        value_in, value_out = amount * ref, minimum
    loss = float(1 - value_out / value_in)
    limit = tol["limit"]
    min_ratio = float(minimum / expected)
    why = []
    if min_ratio < 1 - (slippage_bps / 10000 + MIN_GAP_EXTRA):
        why.append("the minimum sits further below the estimate than the slippage allowed")
    if loss > limit:
        why.append(f"the minimum is worth {loss * 100:.2f}% less than what is paid, over the {limit * 100:.2f}% limit")
    if -loss > MAX_GAIN:
        why.append(f"the minimum is worth {-loss * 100:.2f}% more than what is paid, which points to a wrong token "
                   f"or wrong decimals")
    return {"ran": True, "ok": not why, "why": why, "loss_on_minimum": round(loss, 5),
            "limit": limit, "limit_pct": tol["limit_pct"], "limit_rule": tol["rule"],
            "limit_basis": tol["basis"], "cost_ex_gas_bps": tol["cost_ex_gas_bps"],
            "min_over_expected": round(min_ratio, 6), "reference_price_usd": ref_price, "basis": basis}


def _tol_public(tol: dict | None) -> dict | None:
    """The tolerance as the signing page applies it: the same number."""
    return None if not tol else {k: tol[k] for k in ("limit", "limit_pct", "rule", "cost_ex_gas_bps", "size_usd", "basis")}


def _buy_reference(d: dict, usd_value: float) -> tuple[float | None, dict | None, str]:
    """(price per token without gas, tolerance, basis) for a buy of this
    version: what the pool paid out at the measured size nearest the order,
    with LI.FI's fee, and no gas or L1 fee (the wallet pays those on top)."""
    tol = tolerance(d, usd_value)
    if tol is None:
        return None, None, "no filled measured size"
    ppt = (d.get("paid_per_token") or [None] * len(SIZES))[tol["index"]]
    if not ppt:
        return None, tol, "no measured price per token"
    price = ppt * (1 + LIFI_FEE_RATE)
    return round(price, 6), tol, (f"our measured price per {d.get('symbol')} without gas at ${tol['size_usd']:,} "
                                  f"(the pool's price and fees, and LI.FI's fee), block {d.get('block')}")


# ── the order ────────────────────────────────────────────────────────────────

def _quoted(facts: dict, to_decimals: int) -> dict:
    exp = int(facts["to_amount_expected_raw"]) if str(facts["to_amount_expected_raw"]).isdigit() else None
    mn = int(facts["to_amount_min_raw"]) if str(facts["to_amount_min_raw"]).isdigit() else None
    return {**facts,
            "to_amount_expected": fmt_units(exp, to_decimals) if exp is not None else None,
            "to_amount_min": fmt_units(mn, to_decimals) if mn is not None else None}


def _iso(t: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def _sent(q: dict) -> bool:
    """Whether a request reached LI.FI: a quote refused by this server's own
    budget was never sent."""
    return bool(q.get("ok")) or q.get("kind") != "budget"


def _unavailable_note(q: dict) -> str:
    return (q["reason"] + ". That is a fact about this call, not about the route. No link is given: an order "
            "whose route was not quoted and checked is not one this tool can stand behind. Ask again shortly.")


def _order_price(side: str, amount: Decimal, quoted: dict, symbol: str) -> dict | None:
    """What this order pays per token (buy) or receives per token (sell),
    from the LI.FI quote: the amount and LI.FI's gas estimate over the tokens
    expected. Beside the stored measurement, never instead of it."""
    try:
        tokens = Decimal(quoted["to_amount_expected"]) if side == "b" else amount
        gas = Decimal(str(quoted.get("gas_usd") or 0))
        if side == "b":
            v = (amount + gas) / tokens
            basis = (f"from the LI.FI quote: (the ${_plain(amount)} paid + LI.FI's gas estimate ${gas}) / the "
                     f"{quoted['to_amount_expected']} {symbol} it expects")
        else:
            usd = Decimal(quoted["to_amount_expected"])
            v = (usd - gas) / tokens
            basis = (f"from the LI.FI quote: (the {quoted['to_amount_expected']} expected - LI.FI's gas estimate "
                     f"${gas}) / the {_plain(amount)} {symbol} sold")
    except (InvalidOperation, ZeroDivisionError, TypeError, KeyError):
        return None
    return {"value_usd": round(float(v), 6), "basis": basis, "pay_token_at": "$1, an assumption"}


async def prepare_buy(query, usd_amount, wallet, pay_with=None, max_slippage_bps=None) -> dict:
    from . import prepare_solana
    if prepare_solana.is_solana_wallet(wallet):
        return await prepare_solana.prepare_buy(query, usd_amount, wallet, pay_with, max_slippage_bps)
    w = _wallet(wallet)
    if isinstance(w, dict):
        return w
    m = _slippage(max_slippage_bps)
    if isinstance(m, dict):
        return m
    usd = _decimal(usd_amount)
    if usd is None or not (sign_link.USD_MIN <= usd <= sign_link.USD_MAX) or usd.as_tuple().exponent < -2:
        return _refuse("bad_amount", f"usd_amount is US dollars from {sign_link.USD_MIN} to "
                                     f"{sign_link.USD_MAX:,} with at most 2 decimal places. The cap is Tnega's, "
                                     f"for orders prepared this way.")
    pay = _pay_arg(pay_with)
    if isinstance(pay, dict):
        return pay
    sym, pcid, paddr = pay
    r = await resolve(query)
    if "withheld_reason" in r:
        return r
    ticker, want_key = r["ticker"], r.get("key")
    size = nearest_size(float(usd))
    cells, err = await _cells(ticker, size)
    if err:
        return err
    u = await asyncio.to_thread(load_universe)
    try:
        docs = await get_store().costs_for(ticker)
    except Exception as e:  # noqa: BLE001  the store, not the instrument
        return _refuse("cost_store_unavailable", f"Tnega's cost store could not be read just now "
                                                 f"({type(e).__name__}). That is a fact about this call, not about "
                                                 f"{ticker}.")

    # Every version on the chains an order can be prepared on, each either a
    # candidate or with the reason it is not one.
    candidates, not_ranked = [], []
    for c in cells:
        cid = c.get("chain_id")
        if cid not in BUY_CHAINS or (want_key and c["key"] != want_key):
            continue
        why = None
        if c.get("state") != "filled":
            why = f"no measured cost at ${size:,}: {c.get('state')}"
        elif not want_key and not c.get("allin_per_share"):
            why = "its share ratio is not read, so its price per share is not comparable; shown, not ranked"
        elif not c.get("allin_per_token"):
            why = f"no measured all-in price at ${size:,}"
        elif _pay_for_chain(cid, sym, pcid, paddr) is None:
            why = f"cannot be paid with {sym or paddr} on {c.get('chain')}"
        else:
            _, paused, _ = _controls(u, c["key"])
            if paused:
                why = "its pause control was read as paused"
            else:
                old_ = _stale(c.get("computed_at"))
                if old_:
                    why = "reference_stale: " + old_
        if why:
            not_ranked.append({"key": c["key"], "symbol": c.get("symbol"), "chain": c.get("chain"), "reason": why})
        else:
            candidates.append(c)
    stale = [x for x in not_ranked if x["reason"].startswith("reference_stale: ")]
    if not candidates and stale:
        # Every version that could be bought is measured too long ago: no
        # link on a stale price. The cost worker refreshes every cycle.
        return _refuse("reference_stale",
                       f"No link is made: the measured price of every version that could be bought is stale "
                       f"({stale[0]['symbol']} on {stale[0]['chain']}: {stale[0]['reason'][17:]}). Ask again once "
                       f"the cost worker has measured it again.", size_usd=size, not_ranked=not_ranked[:12])
    if want_key and not candidates:
        reason = not_ranked[0]["reason"] if not_ranked else "no stored measurement for it"
        return _refuse("not_buyable", f"{want_key} cannot be prepared: {reason}.", size_usd=size)
    if not candidates:
        return _refuse("no_buyable_version",
                       f"No version of {ticker} on {', '.join(c['name'] for c in BUY_CHAINS.values())} has a "
                       f"measured, comparable all-in cost at ${size:,}"
                       + (f" and can be paid with {sym or paddr}" if (sym or paddr) else "") + ".",
                       size_usd=size, not_ranked=not_ranked[:12])
    candidates.sort(key=lambda c: (c.get("allin_per_share") or c.get("allin_per_token"), c["key"]))

    # At most MAX_QUOTES versions are tried. A version is passed over when
    # LI.FI has no route, refuses the request, or the route fails a check;
    # when LI.FI cannot be asked or does not answer, the trying stops.
    attempts, chosen, got, unavailable = [], None, None, None
    for c in candidates[:MAX_QUOTES]:
        cid = c["chain_id"]
        ptok = _pay_for_chain(cid, sym, pcid, paddr)
        token_addr = c["key"].split("/", 1)[1]
        raw = _raw(usd, ptok["decimals"])
        params = lifi_quote.request_params(chain_id=cid, from_token=ptok["address"], to_token=token_addr,
                                           from_amount_raw=raw, wallet=w, slippage_bps=m)
        q = await lifi_quote.quote(params)
        if not q["ok"]:
            attempts.append({"key": c["key"], "result": q["kind"], "reason": q["reason"], "sent": _sent(q)})
            if q["kind"] in lifi_quote.UNAVAILABLE:
                unavailable = (c, ptok, raw, q)
                break
            continue
        # Checked here as well as in lifi_quote.quote, so that no quote is
        # used unchecked whichever way it arrived.
        why = lifi_quote.refusal(q["quote"], params)
        if why:
            attempts.append({"key": c["key"], "result": "refused", "reason": why, "sent": True})
            continue
        facts = lifi_quote.facts(q["quote"], q["quoted_at"])
        rec = u.record(c["key"], controls=False) or {}
        dec = int(facts["to_decimals"] or rec.get("decimals") or 18)
        quoted = _quoted(facts, dec)
        doc = next((d for d in docs if d.get("key") == c["key"]), {})
        ref_price, tol, ref_basis = _buy_reference(doc, float(usd))
        vc = _value_check(side="b", expected=Decimal(quoted["to_amount_expected"] or "0"),
                          minimum=Decimal(quoted["to_amount_min"] or "0"), amount=usd,
                          ref_price=ref_price, tol=tol, slippage_bps=m, basis=ref_basis)
        if not vc.get("ran"):
            attempts.append({"key": c["key"], "result": "no_reference_price", "sent": True,
                             "reason": "the value check could not run: " + vc.get("reason", "")})
            continue
        if not vc.get("ok"):
            attempts.append({"key": c["key"], "result": "value_check_failed", "sent": True,
                             "reason": "the value check failed: " + "; ".join(vc["why"])})
            continue
        attempts.append({"key": c["key"], "result": "quoted", "sent": True})
        chosen, got = (c, ptok, raw, quoted), vc
        break
    asked = sum(1 for a in attempts if a["sent"])
    if chosen is None and unavailable is None:
        return _refuse("no_route", "LI.FI returned no usable route for the versions tried: "
                       + "; ".join(f"{a['key']}: {a['reason']}" for a in attempts) + ".",
                       attempts=attempts, size_usd=size)

    c, ptok, raw, quoted = chosen if chosen else unavailable[:3] + (None,)
    cid, key = c["chain_id"], c["key"]
    rec = u.record(key, controls=False) or {}
    ctl, _, _ = _controls(u, key)

    first = candidates[0]
    if want_key:
        sentence = f"{c.get('symbol')} by {c.get('issuer')} on {c.get('chain')}: the version asked for by key, not compared with others."
    else:
        where = f"on {c.get('chain')}" if pcid else "on the chains an order can be prepared on"
        which = ("the only version" if len(candidates) == 1 else
                 ("the lowest" if c is first else "the next-lowest")
                 + f" measured all-in cost per share among the {len(candidates)} versions")
        sentence = (f"{c.get('symbol')} by {c.get('issuer')} on {c.get('chain')}: {which} of {ticker} with a "
                    f"measured, comparable cost at ${size:,} that can be paid with {ptok['symbol']} {where} "
                    f"(block {c.get('block')}, measured {c.get('computed_at')}).")
        if c is not first:
            sentence += f" {first.get('symbol')} on {first.get('chain')} measured lower, and was not used: " \
                        + next((a["reason"] for a in attempts if a["key"] == first["key"]), "no route") + "."
    out = {
        "side": "buy",
        "as_of": c.get("computed_at"),
        "as_of_basis": "when the cost the version was chosen by was measured; the quote's own time is quote.quoted_at",
        "quotes_asked": asked,
        "chosen": {"key": key, "ticker": ticker, "name": rec.get("underlying_name"), "symbol": c.get("symbol"),
                   "issuer": c.get("issuer"), "chain": c.get("chain"), "chain_id": cid, "address": key.split("/", 1)[1],
                   "decimals": rec.get("decimals"), "url": address_url(cid, key.split("/", 1)[1])},
        "order": {"pay_token": ptok, "amount_usd": _plain(usd), "from_amount_raw": str(raw), "wallet": w,
                  "max_slippage_bps": m},
        "why": {"sentence": sentence, "size_usd": size,
                "size_basis": f"the measured size nearest to ${_plain(usd)}; costs are measured at {', '.join(f'${s:,}' for s in SIZES[:5])} and up",
                "rule": "lowest measured all-in price per share-equivalent (the size, gas, the L1 fee and LI.FI's fee, over the tokens received, over the shares per token)",
                "ranked": [_brief(x) for x in candidates[:6]],
                "not_ranked": not_ranked[:8],
                **({"not_ranked_more": len(not_ranked) - 8} if len(not_ranked) > 8 else {}),
                "quotes": attempts},
        "tolerance": _tol_public(got.get("limit") and tolerance(
            next((d for d in docs if d.get("key") == key), {}), float(usd))) if got else None,
        "measured": {"allin_per_token": c.get("allin_per_token"), "size_usd": size, "block": c.get("block"),
                     "measured_at": c.get("computed_at"),
                     "basis": "Tnega's stored measurement on the version's pool at this size"},
        "quote": quoted,
        "controls": ctl, "controls_url": _controls_url(key),
        "eligibility": _eligibility(u, c.get("issuer_id") or rec.get("issuer")),
        "rules": RULES,
        "assumption": "the pay token is taken at $1",
    }
    if chosen is None:
        # LI.FI could not be asked or did not answer. The version is named,
        # and no link is minted.
        out.update(sign_url=None, link_withheld_reason="quote_unavailable",
                   quote_withheld_reason=unavailable[3]["kind"], quote_note=_unavailable_note(unavailable[3]),
                   partial=True)
        return out
    spender = quoted.get("approval_address")
    reads = await asyncio.to_thread(_wallet_reads, cid, ptok["address"], w, spender)
    link_id, p = sign_link.mint(side="b", chain_id=cid, token=key.split("/", 1)[1], pay=ptok["address"],
                                amount=_plain(usd), wallet=w, max_slippage_bps=m,
                                cost_ex_gas_bps=got["cost_ex_gas_bps"])
    out["order_allin_per_token"] = _order_price("b", usd, quoted, c.get("symbol"))
    out.update(value_check=got, approval=_approval(ptok, spender, raw, reads), balance=_balance(ptok, raw, reads),
               sign_url=sign_link.link(link_id), expires_at=_iso(p["e"]))
    return out


def _mid_near(d: dict, usd_value: float) -> tuple[float, int] | None:
    """(mid per token, index) at the filled size nearest usd_value."""
    i = _nearest_filled(d, usd_value)
    mids = d.get("mid_usd") or []
    return (mids[i], i) if i is not None and i < len(mids) and mids[i] else None


async def _sell_reference(ticker: str, key: str, symbol: str, amount: Decimal = Decimal(1)) -> tuple[dict | None, str | None]:
    """The price a sale of `amount` tokens is checked against, per token,
    from Tnega's own measurements, with the tolerance for it: this version's
    pool mid at the filled size nearest the sale's dollar value; else another
    version of the same stock, per share, through this version's read share
    ratio, with that version's tolerance. (reference, None) or (None, why)."""
    try:
        docs = await get_store().costs_for(ticker)
    except Exception as e:  # noqa: BLE001  the store, not the version
        return None, f"Tnega's cost store could not be read just now ({type(e).__name__})"
    own = next((d for d in docs if d.get("key") == key), None)

    def near(d: dict, per_token_scale: float) -> tuple[float, dict] | None:
        # Two passes: a first price to learn the sale's dollar value, then
        # the mid and tolerance at the size nearest that value.
        first = _mid_near(d, 1000)
        if not first:
            return None
        value = float(amount) * first[0] * per_token_scale
        r = _mid_near(d, value)
        tol = tolerance(d, value)
        if not r or not tol:
            return None
        return r[0], tol

    if own:
        got = near(own, 1.0)
        if got:
            mid, tol = got
            return {"price_usd": mid, "tolerance": tol, "measured_at": own.get("computed_at"),
                    "basis": f"the pool's measured pre-trade mid per {symbol} at ${tol['size_usd']:,}, block "
                             f"{own.get('block')}"}, None
    ratio = own.get("share_ratio") if own and own.get("comparable") else None
    if not ratio:
        return None, (f"{symbol} has no measured pool price at any size"
                      + ("" if own else " (no stored measurement)")
                      + ", and its shares per token are not read, so no other version's price can stand in")
    others = [d for d in docs if d.get("key") != key and d.get("comparable") and d.get("share_ratio")
              and d.get("venue") != "jupiter" and _mid_near(d, 1000)]
    if not others:
        return None, f"no version of {ticker} has a measured pool price with a read share ratio"
    d = max(others, key=lambda x: (x.get("pool_usd") or 0, x["key"]))
    scale = ratio / d["share_ratio"]
    got = near(d, scale)
    if not got:
        return None, f"no version of {ticker} has a measured pool price with a read share ratio"
    mid, tol = got
    return {"price_usd": round(mid * scale, 6), "tolerance": tol, "measured_at": d.get("computed_at"),
            "basis": (f"{symbol} has no measured pool price; {d.get('symbol')} on {d.get('chain')}'s measured pool "
                      f"mid per share (${tol['size_usd']:,}, block {d.get('block')}) x {symbol}'s {ratio} shares "
                      f"per token")}, None


async def prepare_sell(query, token_amount, wallet, receive=None, max_slippage_bps=None) -> dict:
    from . import prepare_solana
    if prepare_solana.is_solana_wallet(wallet):
        return await prepare_solana.prepare_sell(query, token_amount, wallet, receive, max_slippage_bps)
    w = _wallet(wallet)
    if isinstance(w, dict):
        return w
    m = _slippage(max_slippage_bps)
    if isinstance(m, dict):
        return m
    amt = _decimal(token_amount)
    if amt is None or amt <= 0 or amt.as_tuple().exponent < -18 or sign_link.amount_ok("s", _plain(amt)):
        return _refuse("bad_amount", "token_amount is the number of tokens to sell: above zero, a plain decimal "
                                     "with at most 18 decimal places and fewer than 19 whole digits.")
    rc = _pay_arg(receive)
    if isinstance(rc, dict):
        return rc
    sym, pcid, paddr = rc
    r = await resolve(query)
    if "withheld_reason" in r:
        return r
    ticker, key = r["ticker"], r.get("key")
    u = await asyncio.to_thread(load_universe)
    held_note = None
    if not key:
        try:
            h = await holdings(w)
        except Exception as e:  # noqa: BLE001  the endpoints, not the wallet
            return _refuse("holdings_unavailable", f"The wallet's balances could not be read just now "
                                                   f"({type(e).__name__}). Give the version key to sell instead.")
        mine = [x for x in h["holdings"] if x["ticker"] == ticker]
        failed = h["coverage"]["chains_failed"]
        named = ", ".join(f["chain"] + " (" + f["reason"] + ")" for f in failed)
        if h.get("status") == "unavailable":
            return _refuse("chains_unavailable", f"No chain could be read just now ({named}). That is a fact about "
                                                 f"this call, not about the wallet. Try again, or give the version key.")
        if not mine:
            if failed:
                return _refuse("not_held_on_chains_read",
                               f"{w} holds no listed version of {ticker} on {', '.join(h['coverage']['chains_read'])}. "
                               f"Not read: {named}, so it may hold one there.",
                               chains_read=h["coverage"]["chains_read"])
            return _refuse("not_held", f"{w} holds no listed version of {ticker} on any of the six chains, all of "
                                       f"which were read.", chains_read=h["coverage"]["chains_read"])
        mine.sort(key=lambda x: (-Decimal(x["balance"]), x["key"]))
        key = mine[0]["key"]
        if len(mine) > 1:
            held_note = (f"the wallet holds {len(mine)} versions of {ticker}; the largest balance was chosen: "
                         + ", ".join(f"{x['symbol']} on {x['chain']} {x['balance']}" for x in mine[:4]))
    rec = u.record(key, controls=False)
    cid = rec["chain_id"]
    token = {"symbol": rec["symbol"], "address": rec["address"].lower(), "decimals": rec["decimals"]}
    raw = _raw(amt, rec["decimals"])
    if raw is None:
        return _refuse("bad_amount", f"{rec['symbol']} has {rec['decimals']} decimals; token_amount has more places.")
    rtok = _pay_for_chain(cid, sym, pcid, paddr)
    if rtok is None:
        return _refuse("bad_pay_token", f"{sym or paddr} cannot be received on {rec['chain_name']}. There: "
                                        + ", ".join(t["symbol"] for t in BUY_CHAINS[cid]["pay"]) + ".")
    ctl, paused, pblock = _controls(u, key)
    if paused:
        return _refuse("paused", f"{rec['symbol']}'s pause control was read as paused at block {pblock}; a transfer "
                                 f"would fail.", controls_url=_controls_url(key))
    # The reference first: without one no quote can be checked, so none is
    # asked for and no link is given.
    ref, no_ref = await _sell_reference(ticker, key, rec["symbol"], amt)
    if ref is None:
        return _refuse("no_reference_price", f"No sale of {rec['symbol']} can be checked: {no_ref}. Tnega gives no "
                                             f"link for a route it cannot check against its own measurement.")
    old_ = _stale(ref.get("measured_at"))
    if old_:
        return _refuse("reference_stale", f"No link is made for this sale: the price it would be checked against "
                                          f"is stale, {old_}. Ask again once the cost worker has measured it again.")

    reads0 = await asyncio.to_thread(_wallet_reads, cid, token["address"], w, None)
    if reads0.get("read") and reads0.get("balance_raw") is not None and reads0["balance_raw"] < raw:
        return _refuse("insufficient_balance", f"{w} holds {fmt_units(reads0['balance_raw'], rec['decimals'])} "
                                               f"{rec['symbol']} at block {reads0['block']}; the order is for "
                                               f"{_plain(amt)}.")
    params = lifi_quote.request_params(chain_id=cid, from_token=token["address"], to_token=rtok["address"],
                                       from_amount_raw=raw, wallet=w, slippage_bps=m)
    q = await lifi_quote.quote(params)
    attempt = {"key": key, "result": "quoted" if q["ok"] else q["kind"], "sent": _sent(q)}
    base = {
        "side": "sell",
        "as_of": ref.get("measured_at"),
        "as_of_basis": "when the reference price the sale is checked against was measured; the quote's own time "
                       "is quote.quoted_at",
        "quotes_asked": 1 if attempt["sent"] else 0,
        "chosen": {"key": key, "ticker": ticker, "name": rec.get("underlying_name"), "symbol": rec["symbol"],
                   "issuer": rec["issuer_name"], "chain": rec["chain_name"], "chain_id": cid,
                   "address": token["address"], "decimals": rec["decimals"], "url": address_url(cid, token["address"])},
        "order": {"receive_token": rtok, "token_amount": _plain(amt), "from_amount_raw": str(raw), "wallet": w,
                  "max_slippage_bps": m},
        "why": {"sentence": (f"{rec['symbol']} on {rec['chain_name']}: " + (held_note or (
            "the version asked for by key" if r.get("key") else f"the one version of {ticker} this wallet holds")) + "."),
            "quotes": [attempt]},
        "measured": {"reference_price_usd": ref["price_usd"], "basis": ref["basis"], "measured_at": ref.get("measured_at")},
        "tolerance": _tol_public(ref.get("tolerance")),
        "controls": ctl, "controls_url": _controls_url(key),
        "eligibility": _eligibility(u, rec["issuer"]),
        "rules": RULES,
        "assumption": "the stablecoin received is taken at $1",
    }
    if not q["ok"]:
        if q["kind"] in lifi_quote.UNAVAILABLE:
            return {**base, "quote": None, "sign_url": None, "link_withheld_reason": "quote_unavailable",
                    "quote_withheld_reason": q["kind"], "quote_note": _unavailable_note(q), "partial": True}
        return _refuse("no_route", f"LI.FI returned no usable route to sell {rec['symbol']} for "
                                   f"{rtok['symbol']} on {rec['chain_name']}: {q['reason']}.", quotes_asked=base["quotes_asked"])
    why = lifi_quote.refusal(q["quote"], params)
    if why:
        return _refuse("no_route", f"LI.FI's route to sell {rec['symbol']} cannot be used: {why}.",
                       quotes_asked=base["quotes_asked"])
    quoted = _quoted(lifi_quote.facts(q["quote"], q["quoted_at"]), rtok["decimals"])
    vc = _value_check(side="s", expected=Decimal(quoted["to_amount_expected"] or "0"),
                      minimum=Decimal(quoted["to_amount_min"] or "0"), amount=amt, ref_price=ref["price_usd"],
                      tol=ref.get("tolerance"), slippage_bps=m, basis=ref["basis"])
    if not vc.get("ran") or not vc.get("ok"):
        return _refuse("value_check_failed", f"LI.FI's route to sell {rec['symbol']} fails the value check: "
                       + ("; ".join(vc.get("why") or []) or vc.get("reason", "it could not run")) + ".",
                       value_check=vc, quotes_asked=base["quotes_asked"])
    spender = quoted.get("approval_address")
    reads = await asyncio.to_thread(_wallet_reads, cid, token["address"], w, spender)
    link_id, p = sign_link.mint(side="s", chain_id=cid, token=token["address"], pay=rtok["address"],
                                amount=_plain(amt), wallet=w, max_slippage_bps=m,
                                cost_ex_gas_bps=vc["cost_ex_gas_bps"])
    return {**base, "quote": quoted, "order_usd_per_token": _order_price("s", amt, quoted, rec["symbol"]),
            "value_check": vc, "approval": _approval(token, spender, raw, reads),
            "balance": _balance(token, raw, reads),
            "sign_url": sign_link.link(link_id), "expires_at": _iso(p["e"])}


# ── the signing page's read of a link ────────────────────────────────────────

async def order_view(link_id: str) -> tuple[int, dict]:
    """GET /api/sign/{id}: (status, body). No quote here; the page asks LI.FI
    from the browser, as the site's buy panel does."""
    d = sign_link.decode(link_id)
    if d.status == "invalid":
        return 404, {"reason": "invalid"}
    # Expired first: an expired link is expired whether or not a hash was
    # reported for it.
    if d.status == "expired":
        return 410, {"reason": "expired", "expired_at": _iso(d.payload["e"])}
    if sign_link.is_used(link_id):
        return 409, {"reason": "used"}
    p = d.payload
    if p["c"] == sign_link.SOLANA:
        from . import prepare_solana
        return await prepare_solana.order_view(link_id, d)
    u = await asyncio.to_thread(load_universe)
    key = f"{p['c']}/{p['t']}"
    rec = u.record(key, controls=False)
    if rec is None or not rec.get("listed"):
        return 404, {"reason": "invalid"}
    ptok = pay_token(p["c"], p["p"])
    side = "buy" if p["s"] == "b" else "sell"
    amount = Decimal(p["a"])
    raw = _raw(amount, ptok["decimals"] if side == "buy" else rec["decimals"])
    if raw is None:
        return 404, {"reason": "invalid"}
    # THE CHECK THE PAGE APPLIES: the same reference price and the same
    # tolerance the order was prepared with (tolerance(), one rule for both
    # sides, the limit from the link's "b"), and the same 30-minute age
    # limit on the reference (_stale), so the page and the server refuse the
    # same routes.
    sell_ref, check, sr = None, None, None
    if side == "sell":
        sr, why = await _sell_reference(rec["underlying"], key, rec["symbol"], amount)
    # `reference` is this version's own cost cell, at the size the check
    # uses: a buy's nearest measured size; a sale's is the size its
    # reference was taken at (1,000 when there is none to agree with).
    ref_size = (nearest_size(float(amount)) if side == "buy"
                else (sr["tolerance"]["size_usd"] if sr else 1000))
    cells, err = await _cells(rec["underlying"], ref_size)
    cell = next((c for c in cells or [] if c["key"] == key), None)
    reference, ref_reason = None, None
    if cell and cell.get("state") == "filled":
        reference = {k: cell.get(k) for k in ("state", "symbol", "allin_per_token", "allin_per_share", "cost_bps",
                                              "mid_usd", "block", "computed_at")}
        reference["size_usd"] = ref_size
    else:
        ref_reason = (err or {}).get("explanation") or (f"no measured cost for this version at ${ref_size:,}: "
                                                        f"{cell.get('state')}" if cell
                                                        else "no stored measurement for this version")
    if side == "sell":
        sell_ref = ({k: v for k, v in sr.items() if k != "tolerance"} if sr else {"price_usd": None, "reason": why})
        if sr:
            check = {"reference_price_usd": sr["price_usd"], "reference_basis": sr["basis"],
                     "compare": "the route's minimum dollars out against tokens sold x reference_price_usd",
                     **_tol_public(sr["tolerance"])}
    else:
        try:
            docs = await get_store().costs_for(rec["underlying"])
        except Exception:  # noqa: BLE001  the store: the page then has no check to apply, and says so
            docs = []
        doc = next((x for x in docs if x.get("key") == key), None)
        price, tol, basis = _buy_reference(doc, float(amount)) if doc else (None, None, "no stored measurement")
        if price and tol:
            check = {"reference_price_usd": price, "reference_basis": basis,
                     "compare": "the route's minimum tokens out x reference_price_usd against the dollars paid",
                     **_tol_public(tol)}
    if check is not None:
        # The limit is the one the order was prepared with: from the signed
        # "b", not from whatever the store says now, so the page (which
        # reads "b" from the id) and this view give the same number.
        now_b = check.get("cost_ex_gas_bps")
        lim = sign_link.limit_from_b(p["b"])
        check.update(limit=lim, limit_pct=round(lim * 100, 4), cost_ex_gas_bps=p["b"],
                     basis=f"b = {p['b']} bps, the cost without gas signed into this link when it was prepared"
                           + (f"; the stored measurement now gives {now_b}" if now_b != p["b"] else ""))
    if check is None:
        check = {"limit": None, "reason": "no measured reference for this version; the page cannot check a route "
                                          "and does not offer signing"}
    ctl, _, _ = _controls(u, key)
    c = BUY_CHAINS[p["c"]]
    return 200, {
        "status": "ok", "side": side,
        "chain": {"id": p["c"], "name": c["name"], "explorer": c["explorer"]},
        "token": {"key": key, "address": rec["address"].lower(), "symbol": rec["symbol"], "ticker": rec["underlying"],
                  "name": rec.get("underlying_name"), "issuer": rec["issuer_name"], "decimals": rec["decimals"],
                  "url": address_url(p["c"], rec["address"])},
        "pay_token": {"role": "pay" if side == "buy" else "receive", **ptok},
        "amount": {"usd": p["a"]} if side == "buy" else {"tokens": p["a"]},
        "from_amount_raw": str(raw),
        "wallet": p["w"], "max_slippage_bps": p["m"], "slippage": p["m"] / 10000,
        "expires_at": _iso(p["e"]), "seconds_left": d.seconds_left,
        "reference": reference, "reference_reason": ref_reason,
        **({"sell_reference": sell_ref} if side == "sell" else {}),
        "value_check": check,
        "controls": ctl, "controls_url": _controls_url(key),
        "eligibility": _eligibility(u, rec["issuer"]),
        "lifi": {"deny_exchanges": "jupiter", "fee": "LI.FI's published 0.25% fee, included in its quote"},
        "rules": RULES,
    }


def mark_done(link_id: str, tx) -> tuple[int, dict | None]:
    """POST /api/sign/{id}/done: (status, body or None for 204). "Used"
    means a transaction hash was reported for the link; the hash is checked
    for its shape only, never on chain. An expired link is not marked."""
    d = sign_link.decode(link_id)
    if d.status == "invalid":
        return 404, {"reason": "invalid"}
    if d.status == "expired":
        return 410, {"reason": "expired", "expired_at": _iso(d.payload["e"])}
    if d.payload["c"] == sign_link.SOLANA:
        from . import prepare_solana
        if not prepare_solana.valid_signature(tx):
            return 400, {"reason": "bad_tx", "explanation": "tx is a Solana transaction signature: base58, 87 or 88 characters"}
        sign_link.mark_used(link_id, d.payload["e"])
        return 204, None
    if not isinstance(tx, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", tx):
        return 400, {"reason": "bad_tx", "explanation": "tx is a transaction hash: 0x followed by 64 hex characters"}
    sign_link.mark_used(link_id, d.payload["e"])
    return 204, None
