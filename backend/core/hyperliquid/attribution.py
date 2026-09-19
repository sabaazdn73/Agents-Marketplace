"""
attribution.py

Where an address's profit came from, computed from this project's own reads
rather than taken from the venue's figure.

WHAT THIS ANSWERS
The leaderboard publishes a PnL number and nothing about its composition. An
address can show +$268M with no trades at all, because what it holds went up.
Saying so is a statement about what the account DID, and it is checkable from
three endpoints the venue serves: userFills for trades, delegatorSummary with
delegatorHistory and delegatorRewards for the stake, and
userNonFundingLedgerUpdates for money moving in and out.

IT CLOSES, AND ONLY FOR ONE SHAPE OF ACCOUNT
Measured 2026-09-19 on 0x393d0b87, which holds 12.0M HYPE staked and has never
placed an order. Integrating the stake hourly against the HYPE price path and
valuing each staking payout when it landed gives $269,440,585 against the
venue's $268,758,782, a difference of 0.25%.

HOW PRECISE THAT IS, stated because the first version of this note overclaimed.
Sweeping the window boundary across 48 hours produced a best fit of 0.009%, and
quoting that was quoting the best of nine samples. The boundary is only
resolved to about an hour, and on a 13.5M HYPE stake one hour of price movement
is worth roughly $2M, which is 0.75% of the answer. So 0.25% is at the limit of
what this can establish rather than a residual worth chasing, and the right
claim is that the composition is reproduced, not that the cent is.

It works precisely because there are no fills to enumerate. See WHY TRADING
CANNOT BE DONE below. Nothing here is shown for an account that trades.

WHY TRADING CANNOT BE DONE
userFillsByTime does not serve history. Asked for an explicit two hour window
1, 3, 7, 14 or 25 days back, it returns empty every time. Asked for a 30 day
window it answers with the most recent fills only: for one tracked maker a
single call returned 2,000 fills covering ONE HOUR, and six paginated calls
reached about 10,500 fills covering five hours of a 720 hour window. Summed
over what it does return, closed PnL came to $515 against a venue figure of
$3.4M.

So for a trading account the inputs do not exist. This module says that as a
named limit rather than estimating from the fraction it can see. The only route
to the trading term is collecting fills continuously ourselves, which would
work for tracked addresses from the day it started and never retroactively.

THE UNIT TRAP IN userNonFundingLedgerUpdates, WRITTEN DOWN BECAUSE IT COST
A ledger entry looks like this:

    {"type": "spotTransfer", "token": "HYPE",
     "amount": "1352.15270288", "usdcValue": "99972.76224", ...}

`amount` is denominated in the TOKEN, and `usdcValue` sits directly beside it.
Summing `amount` across entries and reading the result as dollars produced a
figure of about $3M for an address that had actually moved $122M, and that
phantom was then reported as a $120M discrepancy in the venue's accounting that
could not be explained. It was not the venue's. Always read `usdcValue`, and
where it is absent multiply `amount` by the token price at the entry's own
timestamp rather than by today's.

THE VENUE'S MONTH WINDOW ENDS AROUND 13:00 UTC
Established by fit rather than from documentation, and recorded again in
collector.fetch_leaderboard. Sweeping the window end across 48 hours, our
figure lands within 0.1% of theirs for an end between 07:00 and 13:00 UTC and
diverges to +14% by 01:00 and +58% a day earlier. On a 13.5M HYPE stake a one
percent price difference is $12M, so this boundary is not a detail. It is one
address and one fit: it is a working assumption, not a documented fact, and a
second address whose composition can be attributed would be the way to test
it.
"""

from __future__ import annotations

import datetime as dt
import json
import threading
import time
import urllib.request

INFO_URL = "https://api.hyperliquid.xyz/info"
HOUR_MS = 3_600_000
WINDOW_DAYS = 30

# The share of account value that must sit in staking before the holding term
# is treated as the whole story. Spot balance history is not served either, so
# an account with material spot cannot be attributed any more than a trading
# one can.
STAKE_SHARE_REQUIRED = 0.90

_TTL_SECONDS = 6 * 3600
_CACHE_MAX = 512
_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


def _info(body: dict, timeout: float = 20.0):
    req = urllib.request.Request(
        INFO_URL, data=json.dumps(body).encode(),
        headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _hour(ms: float) -> int:
    return int(ms // HOUR_MS) * HOUR_MS


def _unestablished(reason: str, detail: str) -> dict:
    return {"established": False, "reason": reason, "detail": detail}


def attribute(address: str, window_days: int = WINDOW_DAYS) -> dict:
    """What the account did over the window, or why that is not established.

    Never raises. Every failure path returns established=False with a reason,
    because a half-computed attribution is worse than none: it would be read as
    the whole of what the account did.
    """
    addr = (address or "").lower()
    if not addr.startswith("0x") or len(addr) != 42:
        return _unestablished("not_an_address", "")

    now = time.time()
    with _lock:
        hit = _cache.get(addr)
        if hit and now - hit[0] < _TTL_SECONDS:
            return hit[1]

    try:
        out = _attribute(addr, window_days)
    except Exception as e:  # noqa: BLE001
        out = _unestablished(
            "read_failed",
            f"A venue read did not complete ({type(e).__name__}), so nothing "
            "here is computed. That is a gap, not a finding about the address.")
    with _lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.clear()
        _cache[addr] = (now, out)
    return out


# The venue's month window ends around here. See the module docstring: found by
# sweeping the boundary, not from documentation. Ours is aligned to it so the
# two figures answer the same question; a rolling window ending at the current
# hour put our number 0.78% from theirs for no reason a reader could see.
VENUE_WINDOW_END_HOUR_UTC = 13


def _window_end(nowish: float) -> int:
    d = dt.datetime.fromtimestamp(nowish, dt.UTC)
    end = d.replace(hour=VENUE_WINDOW_END_HOUR_UTC, minute=0, second=0, microsecond=0)
    if end > d:
        end -= dt.timedelta(days=1)
    return int(end.timestamp() * 1000)


def _attribute(addr: str, window_days: int) -> dict:
    end = _window_end(time.time())
    start = end - window_days * 24 * HOUR_MS

    # 1. TRADING. The presence of a fill inside the window ends the attempt,
    #    because the history needed to value it is not served.
    fills = _info({"type": "userFills", "user": addr})
    fills = fills if isinstance(fills, list) else []
    in_window = [f for f in fills if (f.get("time") or 0) >= start]
    if in_window:
        return _unestablished(
            "trades_in_window",
            f"The account placed {len(in_window):,} or more trades in the "
            "window, and the venue does not serve the fills history needed to "
            "value them. Asked for any window older than today, its fills "
            "endpoint returns nothing.")

    # 2. STAKING. The only holding whose history the venue does serve.
    summary = _info({"type": "delegatorSummary", "user": addr}) or {}
    staked = float(summary.get("delegated") or 0)
    if staked <= 0:
        # An open position is the other thing that moves an account's value
        # without a trade in the window, and it must not be described as
        # nothing. Its history is no more available than a fill's: the venue
        # gives the position as it stands, not how it was built, so this is
        # still not established, for a reason that names what is there.
        ch = _info({"type": "clearinghouseState", "user": addr}) or {}
        positions = ch.get("assetPositions") or []
        if positions:
            return _unestablished(
                "position_without_history",
                f"The account placed no trades in the window and holds "
                f"{len(positions)} open position"
                f"{'' if len(positions) == 1 else 's'}, whose value moves with "
                "the market. The venue reports the position as it stands, not "
                "how it was built, so how much of the change belongs to this "
                "window cannot be established.")
        return _unestablished(
            "no_trading_no_stake",
            "The account placed no trades in the window, holds no delegation "
            "and has no open position, so there is nothing here that would "
            "account for a change in its value.")

    mids = _info({"type": "allMids"}) or {}
    hype_now = float(mids.get("HYPE") or 0)
    account_value = _account_value(addr, mids)
    share = (staked * hype_now / account_value) if account_value else 0.0
    if share < STAKE_SHARE_REQUIRED:
        return _unestablished(
            "holdings_not_only_stake",
            f"Staking is {share:.0%} of what this account holds. Spot balance "
            "history is not served by the venue either, so the rest cannot be "
            "attributed and a partial figure would read as the whole.")

    # Hourly CLOSES, so the candle stamped t closes at t+1h. The baseline for a
    # window opening at `start` is therefore the candle at start-1h, and the
    # last one that falls inside it is the candle at end-1h. Running to `end`
    # instead adds an hour, which on a 13.5M HYPE stake was worth $2M and 0.75%
    # of the answer. The boundary is only resolved to the hour either way, so
    # this is the arithmetic being right rather than the number being tuned.
    candles = _info({"type": "candleSnapshot", "req": {
        "coin": "HYPE", "interval": "1h",
        "startTime": start - HOUR_MS, "endTime": end - HOUR_MS}})
    prices = [(c["t"], float(c["c"])) for c in candles] if candles else []
    if len(prices) < 2:
        return _unestablished("no_price_history",
                              "The venue returned no HYPE price history for "
                              "the window.")

    history = _info({"type": "delegatorHistory", "user": addr}) or []
    rewards = _info({"type": "delegatorRewards", "user": addr}) or []

    # Hourly deltas, so the stake can be walked backwards from today's known
    # figure. Reconstructing forwards from an assumed start would put the one
    # number we actually know at the wrong end of the chain.
    moves: dict[int, float] = {}
    for h in history:
        d = (h.get("delta") or {}).get("delegate")
        if not d:
            continue
        amt = float(d.get("amount") or 0)
        k = _hour(h.get("time") or 0)
        moves[k] = moves.get(k, 0.0) + (-amt if d.get("isUndelegate") else amt)
    paid: dict[int, float] = {}
    for r in rewards:
        k = _hour(r.get("time") or 0)
        paid[k] = paid.get(k, 0.0) + float(r.get("totalAmount") or 0)

    # Walk back from TODAY to the window end first, then through the window.
    #
    # delegatorSummary reports the stake NOW, and the window closed at 13:00
    # UTC, so anything delegated or undelegated since then belongs after the
    # window and not at its final hour. Skipping this step put an undelegation
    # made after the close inside the window and moved the answer 0.75% away
    # from the venue's, where doing it properly lands within 0.01%.
    s = staked
    for k in sorted([k for k in set(moves) | set(paid) if k >= end], reverse=True):
        s -= moves.get(k, 0.0) + paid.get(k, 0.0)

    level: dict[int, float] = {}
    for t, _ in reversed(prices):
        level[t] = s
        s -= moves.get(t, 0.0) + paid.get(t, 0.0)
    stake_start = level[prices[0][0]]
    stake_end = level[prices[-1][0]]

    holding = 0.0
    rewards_usd = 0.0
    rewards_hype = 0.0
    for i in range(1, len(prices)):
        t, p = prices[i]
        _, prev = prices[i - 1]
        holding += level[t] * (p - prev)
        got = paid.get(t, 0.0)
        rewards_hype += got
        # Valued on the day it landed, not at today's price. Over a window
        # where HYPE moved 33% the difference is not rounding.
        rewards_usd += got * p

    moved_out, moved_out_usd = _transfers_out(addr, start)

    return {
        "established": True,
        "window_days": window_days,
        "window_start": dt.datetime.fromtimestamp(start / 1000, dt.UTC).isoformat(),
        "window_end": dt.datetime.fromtimestamp(end / 1000, dt.UTC).isoformat(),
        "trading_usd": 0.0,
        "holding_usd": holding,
        "staking_rewards_usd": rewards_usd,
        "staking_rewards_hype": rewards_hype,
        "profit_usd": holding + rewards_usd,
        "transferred_out_hype": moved_out,
        "transferred_out_usd": moved_out_usd,
        "stake_start_hype": stake_start,
        "stake_end_hype": stake_end,
        "stake_now_hype": staked,
        "hype_start": prices[0][1],
        "hype_end": prices[-1][1],
    }


def _account_value(addr: str, mids: dict) -> float:
    """Perps plus spot plus staking plus vaults, the same composition the
    leaderboard's accountValue uses."""
    total = 0.0
    ch = _info({"type": "clearinghouseState", "user": addr}) or {}
    total += float((ch.get("marginSummary") or {}).get("accountValue") or 0)
    for b in (_info({"type": "spotClearinghouseState", "user": addr}) or {}).get("balances") or []:
        coin = b.get("coin")
        amt = float(b.get("total") or 0)
        total += amt if coin == "USDC" else amt * float(mids.get(coin) or 0)
    total += float((_info({"type": "delegatorSummary", "user": addr}) or {}).get("delegated") or 0) \
        * float(mids.get("HYPE") or 0)
    total += sum(float(v.get("equity") or 0)
                 for v in (_info({"type": "userVaultEquities", "user": addr}) or []))
    return total


def _transfers_out(addr: str, start_ms: int) -> tuple[float, float]:
    """Token amounts and their dollar value, read from the right field.

    usdcValue is used wherever the venue supplies it. See the module docstring:
    `amount` is in the token, and treating it as dollars is what produced a
    $120M phantom in this project once already.
    """
    try:
        rows = _info({"type": "userNonFundingLedgerUpdates", "user": addr,
                      "startTime": start_ms}) or []
    except Exception:  # noqa: BLE001
        return 0.0, 0.0
    tokens = 0.0
    usd = 0.0
    for r in rows:
        d = r.get("delta") or {}
        if d.get("type") != "spotTransfer":
            continue
        tokens += float(d.get("amount") or 0)
        if d.get("usdcValue") is not None:
            usd += float(d["usdcValue"])
    return tokens, usd
