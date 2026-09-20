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

import datetime as _dt
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
    except Exception as e:  # noqa: BLE001
        out["role"] = None
        # Named rather than lumped, because the common one is a rate limit and
        # not an outage. Measured 2026-09-19: 25 userRole calls with no pause
        # returned 14 HTTP 429s. roles_for runs eight at a time over fifty
        # addresses, so this path is ordinary traffic, not an edge case, which
        # is what makes everything downstream of it worth getting right.
        out["withheld_reason"] = (
            "venue_rate_limited"
            if getattr(e, "code", None) == 429 else "venue_unreachable")

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
        # None means NOT READ. It does not mean zero, and _kind must not let it
        # become zero: the sentence downstream used to assert "no approved
        # builder" on the strength of a call that failed.
        out["approved_builders"] = None

    # API AGENT APPROVALS. A READING, NOT A CHARACTERISATION.
    #
    # extraAgents is per-address and shaped exactly like approvedBuilders, and
    # it is a different fact: across 30 tracked makers, 20 have an agent and no
    # builder, 8 have both, 2 have neither. The builder check misses two thirds
    # of the addresses that have approved an agent.
    #
    # WHAT IT DOES NOT SAY, measured 2026-09-19 before deciding the wording.
    # It is tempting to read an agent approval as "this account is automated
    # rather than manual". The data does not support that sentence. By volume
    # rank band, 24 addresses each: 46% of ranks 1-200 have one, 54% of
    # 200-1,000, 50% of 1,000-5,000, 38% of 5,000-20,000. That is a coin flip
    # across the whole active population with no gradient. Front-ends create
    # agents too: "Mobile QR" is the venue's own app pairing and
    # "pear-pair-trade" is a third-party one, both observed in the sample.
    #
    # AND IT IS CURRENT STATE WITH AN EXPIRY. Every approval carries
    # validUntil, and across 65 of them the horizon ran 8 to 178 days. An
    # account whose approval lapsed is indistinguishable here from one that
    # never had one, which is also why the bottom rank band reads 0%: that band
    # has no addresses that traded this month at all.
    #
    # So the panel gets the count and the expiry, and no adjective.
    try:
        agents = _info({"type": "extraAgents", "user": addr})
        agents = agents if isinstance(agents, list) else []
        out["agent_approvals"] = len(agents)
        expiries = [a.get("validUntil") for a in agents
                    if isinstance(a.get("validUntil"), (int, float))]
        out["agent_approval_expires_at"] = (min(expiries) / 1000.0
                                            if expiries else None)
    except Exception:  # noqa: BLE001
        # None means NOT READ, the same rule approved_builders follows. It must
        # never become zero, because "has no agent approval" is a claim.
        out["agent_approvals"] = None
        out["agent_approval_expires_at"] = None

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
    """What kind of account this is, or which part of that was not read.

    AN ABSENCE IS NEVER A FINDING, corrected 2026-09-19
    This function had three branches and produced false statements in two
    situations, both of them ordinary rather than rare.

    The venue answers `{"role": "missing"}` for an address it has never seen.
    Nothing here handled that, so it fell through to the last branch and the
    panel said "The venue did not answer when asked what kind of account this
    is". The venue answered, clearly and usefully, and the reader was told the
    lookup had failed. That is an answer reported as an absence, and it cost
    the panel the single most useful thing it could say on an empty address:
    that there is no account here at all.

    The reverse error sat one branch above it. `approved_builders` is None when
    that call fails, `(x or 0) > 0` reads None as zero, and the fall-through
    branch asserts "an ordinary account with no approved builder". A call that
    failed was being published as a fact about somebody's address. With the
    builder lookup returning 429 under ordinary load, that was not hypothetical.

    So every branch below states only what was actually read, and the ambiguity
    sentence, which is the one that carries weight, is reached only when the
    venue answered, said there is an account, and the builder lookup succeeded.
    """
    # Nothing was read. Said first so no later branch can be reached on the
    # strength of a missing value.
    reason = d.get("withheld_reason")
    if d.get("role") is None:
        rate = reason == "venue_rate_limited"
        return {
            "kind": "unknown",
            "title": "Account type not checked",
            "body": ("The venue limited our requests when asked what kind of "
                     "account this is, so it was not read."
                     if rate else
                     "The venue did not answer when asked what kind of account "
                     "this is.")
            + " That is a gap here, not a finding about the address.",
        }

    # The venue answered, and what it said is that it has no record. This is a
    # reading, not a failure to read.
    if d.get("role") == "missing":
        return {
            "kind": "no_account",
            "title": "No account on this venue",
            "body": ("The venue reports no record of this address on "
                     "Hyperliquid. It has not opened an account here, so there "
                     "is nothing for this panel to measure. That is the venue's "
                     "answer, not a lookup that failed."),
        }

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
    if d.get("role") in ("user", "agent", "subAccount"):
        named = ({"agent": "an API wallet acting for another account",
                  "subAccount": "a sub-account of another account"}
                 .get(d.get("role")))
        # The builder lookup failed, so half of what this branch would say was
        # never read. Say the half that was.
        if d.get("approved_builders") is None:
            return {
                "kind": "partly_checked",
                "title": "Account type only partly checked",
                "body": (
                    f"The venue reports {named or 'an ordinary account'}. "
                    "Whether it submits through a front-end was not read, so "
                    "nothing here says either way."),
            }
        if d["approved_builders"] > 0:
            n = d["approved_builders"]
            return {
                "kind": "routed",
                "title": "Submits through a front-end",
                "body": (
                    f"This address has approved {n} builder"
                    f"{'' if n == 1 else 's'}, which means its orders are "
                    "submitted through an interface that charges a builder "
                    "fee. That is what an account being operated by a person "
                    "through an app looks like, rather than a platform's own "
                    "book."),
            }
        if named:
            return {
                "kind": "delegated",
                "title": ("An API wallet" if d["role"] == "agent"
                          else "A sub-account"),
                "body": (f"The venue reports this address as {named}, with no "
                         "approved builder. What is measured here belongs to "
                         "whatever controls it rather than to this address on "
                         "its own."),
            }
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

    # A role the venue has added since this was written. Name it rather than
    # pretending the lookup failed.
    return {
        "kind": "unknown",
        "title": "Account type not recognised",
        "body": (f"The venue reports this address as \"{d.get('role')}\", which "
                 "this project does not have a reading for. That is a gap "
                 "here, not a finding about the address."),
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

    IF YOU DO READ userNonFundingLedgerUpdates, READ usdcValue AND NOT amount.
    An entry looks like:

        {"type": "spotTransfer", "token": "HYPE",
         "amount": "1352.15270288", "usdcValue": "99972.76224", ...}

    `amount` is denominated in the TOKEN and `usdcValue` sits directly beside
    it. On 2026-09-19 this project summed `amount` across a month of entries
    and read the total as dollars: about $3M for an address that had actually
    moved $122M of HYPE. The missing $119M was then written up as a
    discrepancy in the venue's own accounting that could not be explained. It
    was not the venue's, it was a unit error, and it survived review because
    the number it produced was plausible on its own. Where usdcValue is absent,
    multiply by the token price at the entry's timestamp rather than today's.

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

    # WHICH READS FAILED, not just whether all of them did.
    #
    # The withheld_reason below fires only when BOTH the delegation and the
    # perp account are unreadable. A partial failure produced no flag at all,
    # and holdingsLines skips a line whose value is None, so one failed call
    # turned into a shorter list that looked complete: a reader saw "What this
    # account holds" with the staking line quietly missing and no way to tell
    # an address that stakes nothing from one whose staking could not be read.
    # Same defect as the account block above, one step further down.
    not_read = [name for name, ok in (
        ("staking", out.get("hype_delegated") is not None),
        ("the perp account", out.get("perp_account_value_usd") is not None),
        ("spot balances", out.get("spot_balances") is not None),
    ) if not ok]
    if not_read:
        out["not_read"] = not_read
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


# ── The whole-set summary, so a page never hardcodes these counts ───────────
#
# WHY THIS EXISTS
# The Hyperliquid tab used to carry a sentence reading "Sixteen of the
# addresses ever polled submit through a front-end". It was measured once, by
# hand, over 66 addresses. Within days the set was 68 and the answer was 17
# vaults-and-builders apart from what the page said, while the page went on
# saying sixteen. A number written into copy has no way of being wrong out
# loud: nothing checks it, and nobody is watching the clock on it.
#
# So the counts are read from the venue and the page renders whatever comes
# back, including the part that did not answer.
_SUMMARY_TTL_SECONDS = 6 * 3600
_summary_cache: dict = {}


def role_summary(addresses: list[str], budget_seconds: float = 240.0,
                 stagger_seconds: float = 0.25) -> dict:
    """How many of these addresses are vaults, routed, or plain, from the venue.

    EVERY BUCKET IS REPORTED, INCLUDING THE ONE THAT MEANS "WE DO NOT KNOW".
    `unanswered` is addresses whose userRole did not come back, and
    `builders_unread` is addresses whose role is known but whose builder list
    was not read. Folding either into "ordinary" would turn a failed lookup
    into a finding about an account, which is the defect this module exists to
    avoid. A caller must be able to say how many it could not check.
    """
    import concurrent.futures

    addrs = sorted({(a or "").lower() for a in addresses if a})
    key = f"{len(addrs)}:{hash(tuple(addrs))}"
    now = time.time()
    hit = _summary_cache.get(key)
    if hit and now - hit[0] < _SUMMARY_TTL_SECONDS:
        return hit[1]

    described: dict[str, dict] = {}
    deadline = now + budget_seconds

    # PACED, BECAUSE THE VENUE RATE-LIMITS.
    # Eight workers with no gap answered 6 of 68 and reported the other 62 as
    # unanswered: truthful, and useless. 25 calls with no pause had already
    # been measured returning 14 HTTP 429s. Three workers with a short stagger
    # between starts stays under it. This runs in the background where nobody
    # is waiting, so slower is free.
    def paced(index_and_addr):
        i, a = index_and_addr
        time.sleep(i * stagger_seconds)
        return a, describe(a)

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(paced, (i, a)) for i, a in enumerate(addrs)]
        for fut in concurrent.futures.as_completed(futures):
            if time.time() > deadline:
                break
            try:
                a, d = fut.result()
                described[a] = d
            except Exception:  # noqa: BLE001
                pass

    vaults = routed = ordinary = unanswered = builders_unread = 0
    for a in addrs:
        d = described.get(a)
        if not d or d.get("role") is None:
            unanswered += 1
            continue
        if d.get("role") == "vault":
            vaults += 1
            continue
        nb = d.get("approved_builders")
        if nb is None:
            builders_unread += 1
        elif nb > 0:
            routed += 1
        else:
            ordinary += 1

    out = {
        "addresses": len(addrs),
        "vaults": vaults,
        "routed": routed,
        "ordinary": ordinary,
        "unanswered": unanswered,
        "builders_unread": builders_unread,
        "checked": len(addrs) - unanswered,
        "measured_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
    }
    _summary_cache[key] = (now, out)
    return out
