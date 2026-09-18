"""
venuerole.py

What kind of account an address is on Hyperliquid, so that a rejection rate is
not read as one person's behaviour when it is a pooled strategy's.

THE QUESTION THIS ANSWERS
A 92% post-only rejection rate means one thing for a trader and another for a
vault holding other people's deposits, or for a platform's omnibus book. The
rate is the same number and the reader's conclusion should not be.

WHAT IS IDENTIFIABLE FROM PUBLIC DATA, MEASURED RATHER THAN ASSUMED
Checked against the live info API over all 66 addresses this project has ever
polled, on 2026-09-18:

  userRole          63 "user", 2 "vault". One call per address, no key.
                    The two vaults are HLP Strategy A and HLP Strategy B,
                    holding about $3.1M and $3.0M. A vault is definitionally
                    not one trader.

  approvedBuilders  16 of 66 have approved at least one builder, 50 none.
                    This says the address submits through a front-end that
                    charges a builder fee. It is evidence of being a CUSTOMER
                    of a platform, which is the opposite of being one, and it
                    is the strongest available signal that a wallet is a person
                    using an app.

  builder per fill  DOES NOT EXIST publicly. userFills was read across 40
                    addresses with fills, 7,851 fills in total, and carries no
                    builder field of any kind: the keys are coin, px, sz, side,
                    time, startPosition, dir, closedPnl, hash, oid, crossed,
                    fee, tid, feeToken, twapId, cloid, liquidation and nothing
                    else. The only builder endpoints are approvedBuilders,
                    which takes a user, and maxBuilderFee, which takes a user
                    and a builder. Neither yields per-fill attribution for an
                    address you do not operate.

                    This is why core/hyperliquid/store.py's hl_builder_fills
                    table has always been empty and has no writer: it was
                    designed around a feed that is available to a builder for
                    its OWN fills and not to anyone else for an arbitrary
                    address.

  builder overlap   None of the 66 is itself a builder address that others have
                    approved, so none of them is a platform collecting builder
                    fees.

WHAT IS NOT IDENTIFIABLE, AND MUST THEREFORE BE SAID OUT LOUD
A custodial omnibus account. A platform holding many customers' funds in one
Hyperliquid account and submitting from it directly would return role "user"
with no approved builders, which is exactly what a single trader returns. 50 of
the 66 sit in that state and nothing public separates them.

So this module reports the two positives it can establish and the panel carries
a caveat for everything else. A caveat that appears only when we happen to know
something would be worse than useless: the case it needs to cover is the one
where we know nothing.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.request

INFO_URL = "https://api.hyperliquid.xyz/info"

# Six hours. A vault does not stop being a vault, and a builder approval is a
# deliberate act that is not undone often. The collector's own rate budget is
# the thing being protected: this runs per panel view, not per poll.
_TTL_SECONDS = 6 * 3600
_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()
_CACHE_MAX = 4096


def _info(body: dict, timeout: float = 12.0):
    req = urllib.request.Request(
        INFO_URL, data=json.dumps(body).encode(),
        headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def describe(address: str) -> dict:
    """What kind of account this is, or why that is not established.

    Never raises. A venue that will not answer is reported as unestablished,
    because "we could not check" and "it is one trader" are different
    statements and only one of them is a finding.
    """
    addr = (address or "").lower()
    now = time.time()
    with _lock:
        hit = _cache.get(addr)
        if hit and now - hit[0] < _TTL_SECONDS:
            return hit[1]

    out: dict = {"address": addr}
    try:
        role = _info({"type": "userRole", "user": addr})
        out["role"] = role.get("role") if isinstance(role, dict) else None
    except Exception:  # noqa: BLE001
        out["role"] = None
        out["withheld_reason"] = "venue_unreachable"

    if out.get("role") == "vault":
        try:
            v = _info({"type": "vaultDetails", "vaultAddress": addr}) or {}
            followers = v.get("followers") or []
            out["vault"] = {
                "name": v.get("name"),
                "followers": len(followers),
                "follower_equity_usd": sum(
                    float(f.get("vaultEquity") or 0) for f in followers),
                "leader": v.get("leader"),
            }
        except Exception:  # noqa: BLE001
            out["vault"] = None

    try:
        approved = _info({"type": "approvedBuilders", "user": addr})
        out["approved_builders"] = len(approved) if isinstance(approved, list) else 0
    except Exception:  # noqa: BLE001
        out["approved_builders"] = None

    # The sentence the panel renders. Written here, once, for the same reason
    # every withheld reason is written in the service layer: four surfaces show
    # this and only one of them should be deciding what it means.
    out["account_kind"] = _kind(out)
    with _lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.clear()
        _cache[addr] = (now, out)
    return out


def _kind(d: dict) -> dict:
    """One of three answers, and the third is the common one."""
    if d.get("role") == "vault":
        v = d.get("vault") or {}
        return {
            "kind": "vault",
            "title": "A vault, not one trader",
            "body": (
                "The venue reports this address as a vault"
                + (f", {v['name']}" if v.get("name") else "")
                + ". A vault trades a strategy with other people's deposits in "
                  "it, so what is measured here describes that strategy rather "
                  "than one person's trading."),
        }
    if d.get("role") == "user" and (d.get("approved_builders") or 0) > 0:
        n = d["approved_builders"]
        return {
            "kind": "routed",
            "title": "Submits through a front-end",
            "body": (
                f"This address has approved {n} builder"
                f"{'' if n == 1 else 's'}, which means its orders are submitted "
                "through an interface that charges a builder fee. That is what "
                "an account being operated by a person through an app looks "
                "like, rather than a platform's own book."),
        }
    if d.get("role") == "user":
        return {
            "kind": "unestablished",
            "title": "Who is behind this address is not established",
            "body": (
                "The venue reports an ordinary account with no approved "
                "builder. That is what a single trader looks like and also "
                "what a platform holding many customers in one account looks "
                "like, and nothing public separates the two. Read the rate as "
                "the behaviour of an account, not of a person."),
        }
    return {
        "kind": "unknown",
        "title": "Account type not checked",
        "body": ("The venue did not answer when asked what kind of account "
                 "this is. That is a gap here, not a finding about the "
                 "address."),
    }
