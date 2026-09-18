"""
ingest_check.py

Does each external API still return what the adapter reading it believes.

WHY THIS IS A SEPARATE MONITOR FROM reconcile.py
reconcile.py asks whether a published figure still matches our store. This asks
the question one step earlier: whether our store still matches the API. The two
fail differently. A source that changes a field name breaks ingestion and every
figure downstream stays perfectly self-consistent while being wrong, which is
exactly the failure reconcile.py cannot see.

WHAT A CHECK IS HERE
An invariant that must hold for the adapter's reading to mean what it says.
Not "did the endpoint return 200", which proves almost nothing, but "does the
field we key on still exist, still have that name, and still carry the range we
assume".

THE INVARIANTS ARE THE FINDINGS
Every check below encodes something this project learned by getting it wrong or
by measuring it carefully:

  8004scan's camelCase chainId is ignored and snake_case chain_id works. A live
  ingest keyed on the wrong spelling silently pulls the wrong chain.

  8004scan's is_verified is false for every record. Anything that starts
  trusting it is trusting a constant.

  Hyperliquid's historicalOrders carries `tif` and `status` on each order. The
  post-only rejection rate is a count over those two fields and nothing else,
  so a rename is the whole measurement gone.

  Hyperliquid's statusTimestamp is milliseconds. The collector divides by 1000.
  A source that switches to seconds would move every age by a factor of 1000
  without erroring.

  The HyperCore price scale is 10^(szDecimals - 6). This was shipped inverted
  once. The check reads a known market and compares against the venue's own
  mid price rather than trusting the arithmetic.

RATE BUDGET
These run on a schedule, so each check makes one request at most and none of
them paginate. A monitor that costs more than the thing it watches is a bad
trade, and several of these APIs are the project's scarcest budget.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request

OK = "ok"
BROKEN = "broken"
UNKNOWN = "unknown"

_UA = "Mozilla/5.0 (compatible; TnegaMonitor/1.0)"


def _result(name, invariant, holds, detail) -> dict:
    return {
        "name": name,
        "invariant": invariant,
        "verdict": OK if holds is True else (BROKEN if holds is False else UNKNOWN),
        "detail": detail,
        "checked_at": time.time(),
    }


def _get(url, headers=None, timeout=25):
    req = urllib.request.Request(url, headers={"user-agent": _UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _post(url, body, headers=None, timeout=25):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"user-agent": _UA, "content-type": "application/json",
                 **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def check_8004scan_chain_filter() -> dict:
    """snake_case chain_id must filter. camelCase chainId must not be trusted.

    If the camelCase form ever STARTS working, that is also worth knowing,
    because adapters/bsc.py documents a client-side guard whose reason would
    have gone away.
    """
    key = os.environ.get("SCAN_8004_API_KEY")
    if not key:
        return _result("8004scan.chain_filter", "chain_id filters, chainId does not",
                       None, "SCAN_8004_API_KEY not set.")
    try:
        snake = _get("https://api.8004scan.io/api/v1/agents?chain_id=56&limit=10",
                     {"X-API-Key": key})
    except Exception as e:  # noqa: BLE001
        return _result("8004scan.chain_filter", "chain_id filters", None,
                       f"{type(e).__name__} calling 8004scan.")
    items = snake.get("data") or snake.get("items") or []
    if not items:
        return _result("8004scan.chain_filter", "chain_id filters", None,
                       "No items returned to judge.")
    chains = {a.get("chain_id") for a in items}
    holds = chains == {56}
    return _result("8004scan.chain_filter",
                   "chain_id=56 returns only chain 56",
                   holds,
                   f"chain_ids returned: {sorted(c for c in chains if c is not None)}. "
                   "adapters/bsc.py relies on this spelling; the camelCase one is "
                   "ignored by the API and guarded client-side.")


def check_8004scan_is_verified_constant() -> dict:
    """is_verified is false for every record, so nothing may rank on it."""
    key = os.environ.get("SCAN_8004_API_KEY")
    if not key:
        return _result("8004scan.is_verified", "is_verified carries no information",
                       None, "SCAN_8004_API_KEY not set.")
    try:
        d = _get("https://api.8004scan.io/api/v1/agents?chain_id=56&limit=100",
                 {"X-API-Key": key})
    except Exception as e:  # noqa: BLE001
        return _result("8004scan.is_verified", "is_verified carries no information",
                       None, f"{type(e).__name__} calling 8004scan.")
    items = d.get("data") or d.get("items") or []
    vals = {a.get("is_verified") for a in items}
    still_constant = vals <= {False, None}
    return _result(
        "8004scan.is_verified",
        "is_verified is false or absent on every record",
        still_constant,
        f"distinct values across {len(items)} records: {sorted(str(v) for v in vals)}. "
        "If this ever becomes true for some record, the field starts carrying "
        "information and the decision not to display it should be revisited.")


def check_hyperliquid_order_fields() -> dict:
    """tif and status must exist on an order, and statusTimestamp must be ms.

    The entire post-only rejection measurement is a count over tif and status.
    """
    try:
        d = _post("https://api.hyperliquid.xyz/info",
                  {"type": "historicalOrders",
                   "user": "0x399965e15d4e61ec3529cc98b7f7ebb93b733336"})
    except Exception as e:  # noqa: BLE001
        return _result("hyperliquid.order_fields", "tif and status present", None,
                       f"{type(e).__name__} calling Hyperliquid.")
    if not isinstance(d, list) or not d:
        return _result("hyperliquid.order_fields", "tif and status present", None,
                       "No orders returned to judge.")
    row = d[0]
    order = row.get("order") or {}
    has_tif = "tif" in order
    has_status = "status" in row
    ts = row.get("statusTimestamp")
    # 13 digits is milliseconds. 10 would be seconds and would move every age
    # this project prints by a factor of 1000.
    ms = isinstance(ts, (int, float)) and ts > 1e12
    holds = has_tif and has_status and ms
    return _result(
        "hyperliquid.order_fields",
        "order.tif, status, and a millisecond statusTimestamp",
        holds,
        f"tif={has_tif} status={has_status} statusTimestamp={ts!r} "
        f"looks_like_ms={ms}. The rejection rate is a count over tif and "
        "status; the collector divides statusTimestamp by 1000.")


def check_hypercore_price_scale() -> dict:
    """The HyperCore mark price must agree with the venue's own mid.

    The scale is 10^(szDecimals - 6) and was shipped inverted once. This reads
    a real market through the deployed reader and compares against allMids,
    which is the check that would have caught it.
    """
    if not os.environ.get("HYPERCORE_READER_ADDRESS"):
        return _result("hypercore.price_scale", "mark price agrees with allMids",
                       None, "HYPERCORE_READER_ADDRESS not set.")
    try:
        from core.hyperliquid import corestate
        mids = _post("https://api.hyperliquid.xyz/info", {"type": "allMids"})
        read = corestate.read_address("0x010461c14e146ac35fe42271bdc1134ee31c703a")
    except Exception as e:  # noqa: BLE001
        return _result("hypercore.price_scale", "mark price agrees with allMids",
                       None, f"{type(e).__name__} reading HyperCore.")
    positions = (read or {}).get("positions") or []
    if not positions:
        return _result("hypercore.price_scale", "mark price agrees with allMids",
                       None, "No position to price on the markets checked.")
    worst = None
    for p in positions:
        mid = mids.get(p.get("coin"))
        if mid is None or not p.get("mark_price"):
            continue
        rel = abs(float(mid) - float(p["mark_price"])) / float(mid)
        worst = rel if worst is None else max(worst, rel)
    if worst is None:
        return _result("hypercore.price_scale", "mark price agrees with allMids",
                       None, "No coin matched between the reader and allMids.")
    # One percent. A scale error is a factor of 10 or more, never a rounding.
    return _result("hypercore.price_scale",
                   "reader mark price within 1% of the venue mid",
                   worst <= 0.01,
                   f"worst relative difference across {len(positions)} positions: "
                   f"{worst:.4%}. A wrong scale shows as a factor of ten, not a "
                   "fraction of a percent.")


def check_sourcify_live() -> dict:
    """Sourcify answers for chain 4663, which is the only verification route
    this project has there: that chain's own explorer API is behind a bot
    check and returns 403."""
    try:
        d = _get("https://sourcify.dev/server/v2/contract/4663/"
                 "0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333")
    except Exception as e:  # noqa: BLE001
        return _result("sourcify.chain_4663", "Sourcify answers for chain 4663",
                       None, f"{type(e).__name__} calling Sourcify.")
    match = d.get("match") or d.get("runtimeMatch")
    return _result("sourcify.chain_4663",
                   "Sourcify still holds a match for our escrow on 4663",
                   bool(match),
                   f"match={match!r}. This is the only verification source for "
                   "that chain, and the badge names Sourcify because that "
                   "chain's own explorer reports the contract unverified.")


def run_all() -> dict:
    checks = []
    for fn in (check_8004scan_chain_filter, check_8004scan_is_verified_constant,
               check_hyperliquid_order_fields, check_hypercore_price_scale,
               check_sourcify_live):
        try:
            checks.append(fn())
        except Exception as e:  # noqa: BLE001
            checks.append(_result(fn.__name__, "check did not complete", None,
                                  f"{type(e).__name__}: {e}"))
    counts = {OK: 0, BROKEN: 0, UNKNOWN: 0}
    for c in checks:
        counts[c["verdict"]] = counts.get(c["verdict"], 0) + 1
    return {
        "checked_at": time.time(),
        "summary": counts,
        "clear": counts[BROKEN] == 0 and counts[UNKNOWN] == 0,
        "checks": checks,
    }
