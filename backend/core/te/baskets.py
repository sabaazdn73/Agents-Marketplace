"""
baskets.py

Baskets ("My ETFs"): a static list of up to five underlyings with integer
weights in basis points summing to 10,000. Nothing is pooled and nothing is
stored per visitor: a curated basket is a versioned entry in
data/te/baskets.json, and a visitor's own basket travels in a link and is
decoded in the browser. This module prices either kind from the cost engine's
stored documents, with the same functions /api/te/underlying uses
(cost_views._cell and _best), so a leg's version and figures are the ones
that page serves at the same size.

The size rule. A basket of size S buys S x w / 10,000 of each leg. The engine
measures 11 sizes (cost.SIZES), so each leg is read at the smallest measured
size at or above its own amount, and says so (leg_usd, measured_at_usd,
size_exact). Nothing is interpolated between sizes. A leg under the smallest
measured size (below_smallest_stop) is costed from the measured parts at that
size: (pool cost + LI.FI fee) in bps times the leg, plus the gas and L1 fee
in dollars, which do not shrink with the amount.

A leg is one of three states: filled (priced), not_ranked (a version fills,
but none has a read share ratio, so the engine ranks none) or unfilled (no
version fills). The basket's cost is the weighted sum of its legs' costs and
exists only when every leg is filled; otherwise it is null and each leg that
is not is named with its reason. It is never computed from the remaining legs.

A leg may pin a version (k, a version key): that version is priced instead of
the best, and if it does not fill the leg says so.

The cap (SPEC C.3): per leg, S_i is the largest measured size at which the
leg's version costs at most THRESHOLD_BPS; the cap is min_i S_i / w_i,
naming the leg that sets it.

What is not served, and why: an indicative basket value, a return since
creation and a value series all need a price at an earlier time, and the
engine keeps only its latest reading per version; followers are not tracked.
Each is null with its reason.

Transport free: the routes in te/baskets_router.py only parse and hand over.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import re
import time
from pathlib import Path

from .cost import LIFI_FEE_RATE, SIZES
from .cost_views import COVERAGE_NOTE, BEST_RULE, _best, _cell, _list_doc, annotate_ref_gap

BPS = 10_000
MAX_LEGS = 5
THRESHOLD_BPS = 100          # SPEC C.3; owner decision D7, default 100 bps
DATA_FILE = Path(__file__).resolve().parents[2] / "data" / "te" / "baskets.json"
# ASCII only, matched in full: str.isdigit() and \d accept superscripts and
# other scripts' digits, and $ accepts a trailing newline.
TICKER = re.compile(r"[A-Z0-9.\-]{1,12}", re.ASCII)
CODE = re.compile(r"[a-z0-9-]{1,32}", re.ASCII)
DIGITS = re.compile(r"[0-9]{1,7}", re.ASCII)
KEY = re.compile(r"[A-Za-z0-9/]{3,80}", re.ASCII)
B64URL = re.compile(r"[A-Za-z0-9_-]{1,1024}={0,2}", re.ASCII)   # RFC 4648 section 5; padding optional
MEMO_SECONDS = 60
MAX_LEGS_PARAM = 200         # characters; five legs need at most about 95

NOT_RANKED = ("not ranked (share ratio not read): a version fills this size, but none has a read share ratio, "
              "so the engine ranks none (best_rule)")
SIZE_BASIS = ("each leg buys size x weight / 10,000; the engine measures 11 sizes, so a leg is read at the smallest "
              "measured size at or above its own amount (measured_at_usd). size_exact is true when the leg's amount "
              "is itself a measured size. A leg under the smallest measured size (below_smallest_stop) is costed "
              "from that size's measured parts: (pool cost + LI.FI fee) in bps x the leg, plus gas and the L1 fee "
              "in dollars; the pool part is the one measured at the larger size, so no smaller than the leg's own. "
              "Nothing is interpolated.")
COST_BASIS = ("the weighted sum of each leg's leg_cost_bps (sum of weight_bps x leg_cost_bps / 10,000), which is "
              "the engine's cost_bps for the leg's version at measured_at_usd, or the parts rule for a leg under "
              "the smallest measured size; includes LI.FI's published 0.25% fee. Null unless every leg is filled.")
CAP_BASIS = (f"per leg, S_i is the largest measured size at which the leg's version costs at most {THRESHOLD_BPS} "
             f"bps; the cap is min over legs of S_i x 10,000 / weight_bps, rounded down to the dollar (SPEC C.3; "
             f"the {THRESHOLD_BPS} bps threshold is owner decision D7's default). Measured at the stops only: sizes "
             "between stops are not measured. cap_lower_bound: S_i is the largest measured size, so the true "
             "figure may be higher.")
VALUE_BASIS = ("not measured: an indicative value needs a price series for each leg, and the cost engine keeps only "
               "its latest reading per version (price history is not built yet)")
RETURN_SOURCE = "none: no measured price history"
RETURN_BASIS = ("not measured: a return since creation needs each leg's price at the basket's creation, and the cost "
                "engine keeps only its latest reading per version (te_cost is replaced every refresh; price history "
                "is not built yet). No figure is shown rather than an estimated one.")
FOLLOWERS_BASIS = ("not tracked: Tnega records nothing about who buys a basket; each buyer holds the tokens in "
                   "their own wallet")


class BasketError(ValueError):
    """A request that cannot be priced; str(e) is the reason."""


class NotMeasured(Exception):
    """The cost store has nothing to price from; str(e) is why. A fact about
    this server's store, not about any basket."""


# ── definitions ──────────────────────────────────────────────────────────────
# A leg is (ticker, weight_bps, key or None).

def parse_size(raw: str) -> int:
    if not isinstance(raw, str) or not DIGITS.fullmatch(raw) or int(raw) not in SIZES:
        raise BasketError("size must be one of the measured stops, as a whole number of dollars")
    return int(raw)


def check_legs(legs: list[tuple]) -> None:
    """Raises BasketError unless: 1 to 5 legs, each ticker well formed and
    present once, each weight an integer from 1 to 10,000, summing to 10,000."""
    if not legs:
        raise BasketError("a basket needs at least one leg")
    if len(legs) > MAX_LEGS:
        raise BasketError(f"a basket has at most {MAX_LEGS} legs; this one has {len(legs)}")
    seen = set()
    for t, w, k in legs:
        if not isinstance(t, str) or not TICKER.fullmatch(t):
            raise BasketError(f"not a ticker: {t!r}")
        if t in seen:
            raise BasketError(f"{t} appears more than once")
        seen.add(t)
        if type(w) is not int or not 1 <= w <= BPS:
            raise BasketError(f"{t}: weight must be a whole number of basis points from 1 to {BPS}")
        if k is not None and (not isinstance(k, str) or not KEY.fullmatch(k)):
            raise BasketError(f"{t}: k is not a version key")
    total = sum(w for _, w, _ in legs)
    if total != BPS:
        raise BasketError(f"weights must sum to {BPS} basis points; these sum to {total}")


def parse_legs(param: str) -> list[tuple]:
    """'NVDA:4000,TSLA:3000,...' to [(ticker, weight_bps, None)], checked."""
    if not param:
        raise BasketError("legs is required, as TICKER:weight_bps pairs separated by commas, e.g. SPY:5000,QQQ:5000")
    if len(param) > MAX_LEGS_PARAM:
        raise BasketError(f"legs is longer than {MAX_LEGS_PARAM} characters")
    parts = param.split(",")
    if len(parts) > MAX_LEGS:
        raise BasketError(f"a basket has at most {MAX_LEGS} legs; this one has {len(parts)}")
    legs = []
    for p in parts:
        t, sep, w = p.strip(" ").partition(":")
        w = w.strip(" ")
        if not sep or not DIGITS.fullmatch(w):
            raise BasketError(f"{p.strip()!r} is not TICKER:weight_bps (weight in ASCII digits)")
        legs.append((t.strip(" ").upper(), int(w), None))
    check_legs(legs)
    return legs


class _DuplicateKey(Exception):
    pass


def _no_duplicate_keys(pairs: list[tuple]) -> dict:
    """json.loads keeps the last of two equal keys, and a browser's decoder
    may not; refusing them keeps both reading the same basket."""
    seen = {}
    for k, v in pairs:
        if k in seen:
            raise _DuplicateKey(repr(k))
        seen[k] = v
    return seen


def b_param(legs: list[tuple]) -> str:
    """The canonical link for these legs: compact JSON {v:1, legs:[{t, k?, w}]}
    in leg order, base64url without padding. Carries pinned versions."""
    obj = {"v": 1, "legs": [{"t": t, **({"k": k} if k is not None else {}), "w": w} for t, w, k in legs]}
    return base64.urlsafe_b64encode(json.dumps(obj, separators=(",", ":")).encode()).decode().rstrip("=")


def parse_b(param: str) -> list[tuple]:
    """SPEC C.3's link: base64url JSON {v:1, legs:[{t, k?, w}]}, checked."""
    if not B64URL.fullmatch(param or ""):
        raise BasketError("b must be base64url (A-Z a-z 0-9 - _, optionally padded with =), at most 1,024 characters")
    bare = param.rstrip("=")
    if len(param) != len(bare) and len(param) % 4:
        raise BasketError("b: padded base64url must be a multiple of 4 characters")
    try:
        raw = base64.urlsafe_b64decode(bare + "=" * (-len(bare) % 4))
        obj = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicate_keys)
    except _DuplicateKey as e:
        raise BasketError(f"b: key {e} appears more than once in one object") from None
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise BasketError("b does not decode to JSON") from None
    if not isinstance(obj, dict) or set(obj) != {"v", "legs"}:
        raise BasketError("b must be an object with exactly v and legs")
    if type(obj["v"]) is not int or obj["v"] != 1:
        raise BasketError("b: only v 1 is known")
    if not isinstance(obj["legs"], list):
        raise BasketError("b: legs must be a list")
    if len(obj["legs"]) > MAX_LEGS:
        raise BasketError(f"a basket has at most {MAX_LEGS} legs; this one has {len(obj['legs'])}")
    legs = []
    for x in obj["legs"]:
        if not isinstance(x, dict) or not {"t", "w"} <= set(x) <= {"t", "w", "k"}:
            raise BasketError("b: each leg is {t, w} or {t, k, w}")
        if not isinstance(x["t"], str):
            raise BasketError("b: t must be a ticker")
        legs.append((x["t"].upper() if x["t"].isascii() else x["t"], x["w"], x.get("k")))
    check_legs(legs)
    return legs


_curated: dict = {}


def load_curated() -> dict:
    """The committed curated file, checked once: every version of every
    basket passes check_legs, versions count up from 1, codes are unique."""
    if "doc" not in _curated:
        doc = json.loads(DATA_FILE.read_text())
        codes = set()
        for b in doc["baskets"]:
            if not CODE.fullmatch(b["code"]) or b["code"] in codes:
                raise BasketError(f"curated file: bad or repeated code {b['code']!r}")
            codes.add(b["code"])
            for i, c in enumerate(b["changes"]):
                if c["version"] != i + 1:
                    raise BasketError(f"curated file: {b['code']} versions must run 1, 2, ...")
                check_legs([(x["underlying"], x["weight_bps"], None) for x in c["legs"]])
        _curated["doc"] = doc
    return _curated["doc"]


def current_legs(b: dict) -> list[tuple]:
    return [(x["underlying"], x["weight_bps"], None) for x in b["changes"][-1]["legs"]]


# ── pricing ──────────────────────────────────────────────────────────────────

def leg_stop(size: int, weight_bps: int) -> int:
    """The smallest measured size at or above size x weight / 10,000 (exact
    integer comparison; the leg never exceeds the basket size, itself a stop)."""
    need = size * weight_bps
    return next(s for s in SIZES if s * BPS >= need)


def _why_not(cells: list[dict], stop: int) -> tuple[str, str]:
    """(state, reason) for a leg with no ranked version at this size."""
    st = {c["state"] for c in cells}
    if not cells:
        return "unfilled", "does not fill: no version of this underlying is measured"
    if "filled" in st:
        return "not_ranked", NOT_RANKED
    if "partial" in st:
        take = max(c.get("pool_usd") or 0 for c in cells if c["state"] == "partial")
        return "unfilled", f"does not fill: partial fill, the deepest pool takes about ${take:,.0f} of ${stop:,}"
    if "failed" in st:
        return "unfilled", "does not fill: every quote failed at the refresh block"
    return "unfilled", "does not fill: no quotable pool (" + ", ".join(sorted(st)) + ")"


def _figures(c: dict) -> dict:
    return {"key": c["key"], "symbol": c["symbol"], "issuer": c["issuer"], "chain": c["chain"],
            "chain_id": c["chain_id"], "group": c["group"], "ranked": bool(c.get("comparable")),
            "cost_bps": c["cost_bps"], "cost_usd_measured": c["cost_usd"], "cost_parts": c.get("cost_parts"),
            "allin_per_share": c.get("allin_per_share"), "allin_per_token": c.get("allin_per_token"),
            "paid_per_token": c.get("paid_per_token"), "block": c.get("block"),
            "computed_at": c.get("computed_at"), "us_market_open": c.get("us_market_open"), "reason": None}


def resolve(docs: list[dict], stop: int, pin: str | None = None) -> dict:
    """The leg's version at one measured size: the pinned one, or the best by
    the engine's own rule."""
    if pin is not None:
        d = next(x for x in docs if x["key"] == pin)
        c = _cell(d, stop)
        if c["state"] == "filled":
            return {"state": "filled", "pinned": True, **_figures(c)}
        why = c.get("reason") or c["state"]
        return {"state": "unfilled", "pinned": True, "key": pin, "symbol": d["symbol"], "chain": d["chain"],
                "reason": f"does not fill: the chosen version ({d['symbol']} on {d['chain']}) is {c['state']} "
                          f"at ${stop:,}: {why}"}
    cells = [_cell(d, stop) for d in docs]
    b = _best(cells)
    if b:
        return {"state": "filled", "pinned": False, **_figures(b)}
    state, reason = _why_not(cells, stop)
    return {"state": state, "pinned": False, "reason": reason}


def leg_cap(docs: list[dict], pin: str | None) -> tuple[int | None, str | None]:
    """(S_i, None), or (None, why): the largest measured size whose version
    costs at most THRESHOLD_BPS."""
    rs = [(s, resolve(docs, s, pin)) for s in SIZES]
    ok = [s for s, r in rs if r["state"] == "filled" and r["cost_bps"] is not None and r["cost_bps"] <= THRESHOLD_BPS]
    if ok:
        return ok[-1], None
    states = {r["state"] for _, r in rs}
    if "filled" in states:
        return None, f"no measured size at or under {THRESHOLD_BPS} bps"
    if "not_ranked" in states:
        return None, "not ranked (share ratio not read) at any measured size where a version fills"
    return None, "does not fill at any measured size"


def price_leg(docs: list[dict], t: str, w: int, k: str | None, size: int) -> dict:
    stop = leg_stop(size, w)
    leg_usd = size * w / BPS
    r = resolve(docs, stop, k)
    row = {"ticker": t, "symbol": r.get("symbol") or t, "weight_bps": w, "leg_usd": leg_usd,
           "measured_at_usd": stop, "size_exact": stop * BPS == size * w,
           "below_smallest_stop": leg_usd < SIZES[0], **r, "leg_cost_usd": None, "leg_cost_bps": None}
    if r["state"] == "filled":
        if row["below_smallest_stop"]:
            p = r["cost_parts"]
            fixed = p["gas_usd"] + (p.get("l1_fee_usd") or 0)
            usd = (p["pool_usd"] / stop + LIFI_FEE_RATE) * leg_usd + fixed
            row["leg_cost_basis"] = (f"parts measured at ${stop:,}: pool {p['pool_usd'] / stop * BPS:.2f} bps and "
                                     f"LI.FI {LIFI_FEE_RATE * BPS:.0f} bps of ${leg_usd:,.2f}, plus gas and L1 fee "
                                     f"${fixed:.4f}")
        else:
            usd = r["cost_bps"] * leg_usd / BPS
            row["leg_cost_basis"] = f"cost_bps measured at ${stop:,}"
        row["leg_cost_usd"] = round(usd, 6)
        row["leg_cost_bps"] = round(usd / leg_usd * BPS, 4)
        row["_bps"] = usd / leg_usd * BPS        # unrounded, removed before serving
    return row


def _basket_cost(rows: list[dict], size: int) -> tuple[float | None, float | None]:
    if any(x["state"] != "filled" for x in rows):
        return None, None
    return (round(sum(x["weight_bps"] * x["_bps"] for x in rows) / BPS, 4),
            round(sum(x["weight_bps"] * x["_bps"] for x in rows) * size / BPS / BPS, 4))


def _missing_text(rows: list[dict]) -> str:
    return "; ".join(f"{x['ticker']}: {x['reason']}" for x in rows if x["state"] != "filled")


def breakdown(legs: list[tuple], docs_by_t: dict[str, list[dict]], size: int, with_curve: bool = False) -> dict:
    """The cost breakdown of one basket at one size, from the stored docs."""
    caps = {t: leg_cap(docs_by_t[t], k) for t, _, k in legs}
    rows = []
    for t, w, k in legs:
        row = price_leg(docs_by_t[t], t, w, k, size)
        s_i, why = caps[t]
        row.update(cap_stop_usd=s_i, cap_usd=(s_i * BPS) // w if s_i is not None else None,
                   cap_lower_bound=s_i == SIZES[-1], cap_reason=why)
        rows.append(row)

    cost_bps, cost_usd = _basket_cost(rows, size)
    filled = [x for x in rows if x["state"] == "filled"]
    missing = [{"ticker": x["ticker"], "state": x["state"], "measured_at_usd": x["measured_at_usd"],
                "reason": x["reason"]} for x in rows if x["state"] != "filled"]

    # Legs by chain, EVM first, chains with more legs first, then by name.
    groups: dict[tuple, dict] = {}
    for x in filled:
        g = groups.setdefault((x["group"], x["chain_id"]), {"chain": x["chain"], "chain_id": x["chain_id"],
                                                             "group": x["group"], "legs": []})
        g["legs"].append(x["ticker"])
    by_chain = sorted(groups.values(), key=lambda g: (g["group"] != "evm", -len(g["legs"]), g["chain"]))
    for g in by_chain:
        g["swaps"] = len(g["legs"])
        g["approvals_up_to"] = len(g["legs"]) if g["group"] == "evm" else 0
    evm = sum(1 for x in filled if x["group"] == "evm")
    switches = max(0, len(by_chain) - 1)
    if by_chain:
        basis = (f"{len(filled)} swap signature(s), one per priced leg, plus up to {evm} approval(s), each a separate "
                 f"prompt where the wallet's allowance is too low (not known to the server; Solana has no approval). "
                 f"The priced legs sit on {len(by_chain)} chain(s) ({', '.join(g['chain'] for g in by_chain)}), "
                 f"bought EVM first, grouped by chain, so {switches} chain switch(es) once the wallet is on "
                 f"{by_chain[0]['chain']}; a wallet that starts on another chain needs one more, not counted here.")
    else:
        basis = "no leg is priced at this size, so there is nothing to sign"
    prompts = {"swaps": len(filled), "approvals_up_to": evm, "signatures_up_to": len(filled) + evm,
               "chain_switches": switches, "basis": basis}
    if missing:
        prompts["partial"] = True
        prompts["missing"] = [x["ticker"] for x in missing]

    if all(x["cap_usd"] is not None for x in rows):
        cap = min(x["cap_usd"] for x in rows)
        cap_legs = [x["ticker"] for x in rows if x["cap_usd"] <= cap * 1.01]
        cap_body = {"cap_usd": cap, "cap_leg": cap_legs[0], "cap_legs": cap_legs,
                    # only a limiting leg's S_i can hold the cap down
                    "cap_lower_bound": any(x["cap_lower_bound"] for x in rows if x["ticker"] in cap_legs),
                    "cap_reason": None}
    else:
        no = [x for x in rows if x["cap_usd"] is None]
        cap_body = {"cap_usd": None, "cap_leg": None, "cap_legs": [x["ticker"] for x in no], "cap_lower_bound": False,
                    "cap_reason": "no cap (never computed from the remaining legs): "
                                  + "; ".join(f"{x['ticker']}: {x['cap_reason']}" for x in no)}

    for x in rows:
        x.pop("_bps", None)
    body = {
        "size": size, "legs": rows, "complete": not missing,
        "cost_bps": cost_bps, "cost_usd": cost_usd,
        "cost_reason": None if not missing else "no basket cost at this size: " + _missing_text(rows),
        "unfilled_legs": missing, "size_exact": all(x["size_exact"] for x in rows),
        "signatures": len(filled), "legs_unresolved": len(missing),
        "evm": evm, "nonevm": len(filled) - evm,
        "by_chain": by_chain, "prompts": prompts, **cap_body, "threshold_bps": THRESHOLD_BPS,
        "computed_at": max((x.get("computed_at") or "" for x in filled), default=None) or None,
        "blocks": [{"chain_id": c, "block": n}
                   for c, n in sorted({(x["chain_id"], x["block"]) for x in filled if x.get("block")})],
    }
    if with_curve:
        bps, why = [], []
        for s in SIZES:
            rs = [price_leg(docs_by_t[t], t, w, k, s) for t, w, k in legs]
            v = _basket_cost(rs, s)[0]
            bps.append(v)
            why.append(None if v is not None else _missing_text(rs))
        body["cost_at_size"] = {"stops": list(SIZES), "bps": bps, "null_reason": why, "basis": COST_BASIS}
    return body


# ── the reads (async; one list document and one read per distinct underlying) ─

async def _load(store, legs: list[tuple]) -> tuple[dict, dict[str, list[dict]]]:
    ld = await _list_doc(store)
    if not ld:
        raise NotMeasured("the cost worker has not written a list yet")
    tickers = [t for t, _, _ in legs]
    rows = {r["u"] for r in ld["rows"]}
    unmeasured = set(ld.get("tickers_without_measured_pool") or [])
    unknown = [t for t in tickers if t not in rows and t not in unmeasured]
    if unknown:
        raise BasketError(f"not in the verified universe we measure: {', '.join(unknown)}")
    measured = [t for t in dict.fromkeys(tickers) if t in rows]
    got = await asyncio.gather(*(store.costs_for(t) for t in measured))
    docs_by_t = {t: [] for t in tickers}
    for t, ds in zip(measured, got):
        annotate_ref_gap(ds)
        docs_by_t[t] = ds
    for t, _, k in legs:
        if k is not None and not any(d["key"] == k for d in docs_by_t[t]):
            raise BasketError(f"{t}: {k} is not a measured version of {t}")
    return ld, docs_by_t


def _envelope(ld: dict) -> dict:
    return {"best_rule": BEST_RULE, "size_basis": SIZE_BASIS, "cost_basis": COST_BASIS, "cap_basis": CAP_BASIS,
            "lifi_fee_included": True, "coverage": COVERAGE_NOTE, "engine_computed_at": ld.get("computed_at"),
            "source": "Tnega's cost engine (our own pool measurements); no third-party quote"}


_memo: dict = {}


def _memoised(key):
    hit = _memo.get(key)
    return hit[1] if hit and time.monotonic() - hit[0] < MEMO_SECONDS else None


def _curated_card(b: dict, br: dict, bps_1k: float | None) -> dict:
    return {"code": b["code"], "name": b["name"], "version": b["changes"][-1]["version"],
            "created_at": b["created_at"], "legs": br["legs"], "cost_bps": br["cost_bps"],
            "cost_bps_1k": bps_1k, **{k: br[k] for k in (
                "cost_usd", "cost_reason", "complete", "unfilled_legs", "size_exact", "signatures",
                "legs_unresolved", "evm", "nonevm", "by_chain", "prompts", "cap_usd", "cap_leg", "cap_legs",
                "cap_lower_bound", "cap_reason", "computed_at", "blocks")}}


async def curated_list(store, size: int) -> dict:
    hit = _memoised(("list", size))
    if hit:
        return hit
    doc = load_curated()
    all_legs = list({t: (t, w, k) for b in doc["baskets"] for t, w, k in current_legs(b)}.values())
    ld, docs_by_t = await _load(store, all_legs)
    baskets = []
    for b in doc["baskets"]:
        legs = current_legs(b)
        br = breakdown(legs, docs_by_t, size)
        bps_1k = br["cost_bps"] if size == 1000 else breakdown(legs, docs_by_t, 1000)["cost_bps"]
        baskets.append(_curated_card(b, br, bps_1k))
    body = {"note": doc["note"], "creator": doc["creator"], "size": size, "file_version": doc["file_version"],
            "selection_rule": doc["selection_rule"], "baskets": baskets, **_envelope(ld),
            "computed_at": max((x["computed_at"] or "" for x in baskets), default=None) or None}
    _memo[("list", size)] = (time.monotonic(), body)
    return body


async def curated_detail(store, code: str, size: int) -> dict | None:
    hit = _memoised(("detail", code, size))
    if hit:
        return hit
    doc = load_curated()
    b = next((x for x in doc["baskets"] if x["code"] == code), None)
    if b is None:
        return None
    legs = current_legs(b)
    ld, docs_by_t = await _load(store, legs)
    br = breakdown(legs, docs_by_t, size, with_curve=True)
    body = {"code": b["code"], "name": b["name"], "creator": doc["creator"], "creator_kind": "curated",
            "created_at": b["created_at"], "version": b["changes"][-1]["version"], "description": b["description"],
            "note": doc["note"],
            **br,
            "value_usd_indicative": None, "value_basis": VALUE_BASIS,
            "return_since_creation_pct": None, "return_source": RETURN_SOURCE, "return_basis": RETURN_BASIS,
            "series": None,
            "followers_count": None, "followers": None, "followers_basis": FOLLOWERS_BASIS,
            "changes": [{"version": c["version"], "at": c["at"], "note": c.get("note"),
                         "legs": [{"ticker": x["underlying"], "weight_bps": x["weight_bps"]} for x in c["legs"]]}
                        for c in reversed(b["changes"])],
            "changes_basis": "each change is a new version of the weights; a leg names an underlying, not a token "
                             "version, which is chosen at read time by best_rule",
            **_envelope(ld)}
    _memo[("detail", code, size)] = (time.monotonic(), body)
    return body


async def evaluate(store, legs: list[tuple], size: int) -> dict:
    ld, docs_by_t = await _load(store, legs)
    br = breakdown(legs, docs_by_t, size, with_curve=True)
    return {"legs_param": ",".join(f"{t}:{w}" for t, w, _ in legs),
            "legs_param_basis": "tickers and weights only; a pinned version (k) is carried by b_param",
            "b_param": b_param(legs),
            "pinned": {t: k for t, _, k in legs if k is not None} or None,
            "stored": False, "stored_basis": "nothing about this basket is stored; the link carries it",
            **br, **_envelope(ld)}
