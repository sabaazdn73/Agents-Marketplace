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


def roles_for(addresses: list[str], budget_seconds: float = 6.0) -> dict[str, dict]:
    """The account kind for a list of addresses, for the maker table.

    Only userRole is called here, not the three calls `describe` makes. The
    table needs one thing: which rows are vaults. approvedBuilders is a
    per-address reading that belongs on a panel a reader has opened, not a
    column on fifty rows, and asking for it here would triple the venue calls
    to say something the table has no room for.

    CONCURRENT, AND ON A BUDGET
    Fifty calls run one after another took 36 seconds on a cold cache, measured,
    which is a page load nobody would wait through even once every six hours.
    They are independent lookups against an endpoint that answers in well under
    a second, so they run in a small pool. The budget is a second bound on top:
    when it is spent, the addresses not yet answered are simply left unlabelled
    and the next request picks them up from the cache the finished ones filled.

    An unlabelled row is the correct degradation. The table's caveat already
    says of every row that who is behind it is not established, so a missing
    label understates rather than misleads.
    """
    import concurrent.futures

    out: dict[str, dict] = {}
    now = time.time()
    todo: list[str] = []
    for a in addresses:
        addr = (a or "").lower()
        if not addr:
            continue
        with _lock:
            hit = _cache.get(f"role:{addr}")
        if hit and now - hit[0] < _TTL_SECONDS:
            out[addr] = hit[1]
        else:
            todo.append(addr)

    if not todo:
        return out

    def one(addr: str):
        try:
            r = _info({"type": "userRole", "user": addr}, timeout=6.0)
            rec = {"role": r.get("role") if isinstance(r, dict) else None}
        except Exception:  # noqa: BLE001
            return addr, None          # not cached, so a later call retries
        if rec["role"] == "vault":
            try:
                v = _info({"type": "vaultDetails", "vaultAddress": addr},
                          timeout=6.0) or {}
                rec["vault_name"] = v.get("name")
            except Exception:  # noqa: BLE001
                rec["vault_name"] = None
        return addr, rec

    # Eight at a time. The venue publishes a per-IP request budget and this is
    # one page build every six hours, so the pool is sized for latency rather
    # than against a limit.
    # The pool is shut down with cancel_futures rather than left to a `with`
    # block. A context manager waits for everything already running on exit, so
    # an earlier version broke out of the loop at the deadline and then blocked
    # anyway: measured 9.8 seconds against a 6 second budget. The budget now
    # bounds what it says it bounds. Work already in flight still has to finish,
    # which is one call, not fifty.
    deadline = time.time() + budget_seconds
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=8)
    try:
        futures = [pool.submit(one, a) for a in todo]
        for fut in concurrent.futures.as_completed(futures):
            try:
                addr, rec = fut.result()
            except Exception:  # noqa: BLE001
                continue
            if rec is not None:
                out[addr] = rec
                with _lock:
                    if len(_cache) >= _CACHE_MAX:
                        _cache.clear()
                    _cache[f"role:{addr}"] = (time.time(), rec)
            if time.time() > deadline:
                break
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return out


def holdings(address: str) -> dict:
    """What this address holds on the venue, for an address with no rate.

    WHY THIS EXISTS
    When an address has no post-only orders the panel says only that nothing
    was measured, which is true and tells a reader nothing about why. Two
    cheap reads say a great deal more: whether there is a perp account at all,
    and whether the HYPE is staked.

    WHAT IS MEASURED HERE AND WHAT IS NOT
    Every figure below is a direct read. The delegated amount, the perp
    account value, the open position count and the spot balance count are all
    one API call each and are facts.

    The characterisation a reader will reach for is not. "It delegates, so it
    is a staker rather than a trader" fails on this project's own data:
    checked across 28 tracked addresses on 2026-09-18, 15 hold BOTH a
    delegation and a live perp account, and the single largest delegator,
    101,815 HYPE, is an active maker carrying a published rejection rate.
    Delegating HYPE is something most participants here do; it is not an
    alternative to trading.

    The obvious second idea does not work either. userNonFundingLedgerUpdates
    looks like it would show what an address spends its time doing, and it
    does not: across three addresses of very different kinds the only delta
    types it ever returned were deposit, withdraw, send, spotTransfer,
    subAccountTransfer, accountClassTransfer and cStakingTransfer. No order
    and no fill appears in it, so an address that trades heavily and one that
    never trades look the same in that endpoint. It is not consulted here.

    So this returns the holdings and refuses to name the account. The panel
    says what was read and says plainly what it does not establish.
    """
    addr = (address or "").lower()
    now = time.time()
    key = f"holdings:{addr}"
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _TTL_SECONDS:
            return hit[1]

    out: dict = {"address": addr}
    try:
        d = _info({"type": "delegatorSummary", "user": addr}, timeout=8.0) or {}
        out["hype_delegated"] = float(d.get("delegated") or 0)
    except Exception:  # noqa: BLE001
        out["hype_delegated"] = None
    try:
        c = _info({"type": "clearinghouseState", "user": addr}, timeout=8.0) or {}
        out["perp_account_value_usd"] = float(
            (c.get("marginSummary") or {}).get("accountValue") or 0)
        out["open_positions"] = len(c.get("assetPositions") or [])
    except Exception:  # noqa: BLE001
        out["perp_account_value_usd"] = None
        out["open_positions"] = None
    try:
        s = _info({"type": "spotClearinghouseState", "user": addr}, timeout=8.0) or {}
        out["spot_balances"] = len(s.get("balances") or [])
    except Exception:  # noqa: BLE001
        out["spot_balances"] = None

    if out.get("hype_delegated") is None and out.get("perp_account_value_usd") is None:
        out["withheld_reason"] = "venue_unreachable"
    out["note"] = (
        "These are direct reads of what the account holds. They do not say "
        "what it is for. Of 28 tracked addresses checked, 15 hold both a "
        "delegation and a perp account, and the largest delegator of all is "
        "an active maker with a rejection rate on this page, so a delegation "
        "is not evidence that an address does not trade.")
    with _lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.clear()
        _cache[key] = (now, out)
    return out
