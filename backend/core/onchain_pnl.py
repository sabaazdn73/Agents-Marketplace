"""
onchain_pnl.py

Real, standalone "Historical on-chain performance" signal for a Trading &
DeFi agent — deliberately independent of whether a real job ever went
through Tnega's own hire flow. Real reframing (2026-08-28) of the
narrower core/pnl.py: that module only ever looks at real, Tnega-flow
Altana-session jobs; this one looks directly at the agent's own real,
independent on-chain execution history — real trades/rebalances/deposits
it has genuinely executed, on its own wallet, for anyone, whether or not
that ever happened through this marketplace.

Real, deliberate scope, same discipline as core/pnl.py:
  - Only Trading & DeFi category-group agents (core/category_groups.py) —
    same real reasoning: a content/identity agent has no real portfolio
    to measure this against.
  - The real "operating wallet" checked is, in order: the agent's own
    registered `agent_wallet` field from the richer 8004scan per-agent
    detail record (adapters/bsc.py's fetch_agent_detail — real, live,
    Pro-tier, cheap), IF it discloses one genuinely DISTINCT from
    owner_address; otherwise owner_address itself.
    Real, honest, live-checked finding (2026-08-28, 60 real Trading & DeFi
    agents sampled across every non-"Trading Signals" sub-category):
    every single one had agent_wallet == owner_address. No real agent in
    this dataset currently discloses a distinct operating address. The
    richer check is still performed every time (not hardcoded away) in
    case a future agent's real metadata ever does disclose one.
  - "Real activity" = real, Zerion-indexed BSC transactions that BOTH (a)
    have an `operation_type` that could represent on-chain DeFi execution
    (`trade`, `mint`, `burn`, `deposit`, `withdraw`, `execute`, `claim`,
    `bid` — the real, documented Zerion enum, confirmed live against
    developers.zerion.io 2026-08-28) AND (b) carry a real, Zerion-
    confirmed `protocol_name` (adapters/zerion.py's
    `acts[].application_metadata.name`) — i.e. Zerion itself has matched
    the called contract to an actual known real protocol.

    Real, important, live-caught correction (2026-08-28): (a) ALONE is
    NOT enough — confirmed live, several real Trading & DeFi agents'
    wallets showed `mint`/`execute` transactions that were NOT real DeFi
    at all: this project's OWN ERC-8004 identity-registry
    self-registration (`mint`, sent_to the real registry contract every
    registered agent's owner wallet calls once), and real calls to OTHER
    platforms' own generic escrow/action-router contracts (confirmed via
    a real BscScan getsourcecode lookup: `TermixEscrow`,
    `EvoUserActionRouter`, `DICheckIn` — a job-escrow contract, a generic
    user-action router, and what looks like a daily check-in/loyalty
    contract, none of them a real DeFi protocol). None of those carried a
    real Zerion `protocol_name` — Zerion's own real classification
    genuinely couldn't match them to anything, which is exactly the real
    signal used here to exclude them. Requiring a confirmed
    `protocol_name` cut the real "has real activity" rate on the 60-agent
    live census this module was validated against roughly in half — see
    this project's own report for the exact real, corrected numbers.
    Deliberately excludes `approve`, `receive`, `send`, `revoke`,
    `deploy`, `delegate`, `revoke_delegation` regardless of protocol —
    real transaction types, but none of them is evidence a trade/
    rebalance/deposit/withdrawal actually executed.

Real, deliberate scope decision on raw event scanning: the ideal-sounding
approach floated was direct on-chain event scanning (e.g. real PancakeSwap
V3 Mint/Burn/Swap logs, which do index sender/recipient and so COULD in
principle be queried by wallet). Investigated, not built: this project's
only real BSC RPC access is a single public node (core/rpc.py) with no
confirmed real eth_getLogs support at the block-range depth a wallet's
full trading history would need, and BSCSCAN_API_KEY is real but
confirmed (adapters/bsc_balance.py) to NOT cover BSC at all on Etherscan's
V2 API. There's no real, working indexer this project has for raw log
scanning across a wallet's full history within a live request. Zerion's
own real transaction-history API (already integrated, no block-range
limitation, real operation_type classification) is the real, working
substitute used here — an indexed history, not raw logs, but real and
live, with the same honest-failure discipline as the rest of this
project.

Real, honest attribution-confidence labeling, always surfaced:
  - `"high"` — the wallet checked is this agent's own owner_address, on
    record from its real on-chain ERC-8004 registration, and the
    activity found is exactly what real DeFi execution looks like (see
    the operation_type filtering above).
  - `"unconfirmed"` — reserved for a real, future case this module is
    honestly wired for but has never actually hit yet: a genuinely
    distinct agent_wallet disclosed in metadata that ISN'T also the
    registration owner. Real proof it's declared as this agent's wallet
    by its own creator, but one more hop removed from the immutable
    on-chain identity record itself — labeled at a lower confidence
    tier for exactly that reason, the moment it's ever actually found.

Real window, honestly bounded: Zerion's own real transaction list is
capped at 50 real results per real call and returns most-recent-first
(confirmed live) — there is no real "this wallet's very first ever
transaction" API available to this project. So the real window used here
is: the real span from the OLDEST DeFi-execution transaction actually
returned in that most-recent real page, to now — always labeled
"based on the most recent N real transactions", NEVER claimed to be this
wallet's full real history when more than 50 real transactions exist.
"""

from __future__ import annotations

import os
import time
from datetime import datetime

import httpx

from core import category_groups
from adapters import zerion
from adapters.bsc import fetch_agent_detail

PNL_ELIGIBLE_GROUP = "trading-defi"

# Real, documented Zerion operation_type values that represent actual
# on-chain DeFi EXECUTION — confirmed live against developers.zerion.io
# (2026-08-28), not guessed. See module docstring for what's excluded and
# why.
_DEFI_EXECUTION_OP_TYPES = {"trade", "mint", "burn", "deposit", "withdraw", "execute", "claim", "bid"}

_MAX_TX_PAGE = 50  # Zerion's own real, confirmed page size (adapters/zerion.py's get_wallet_activity)

_CHART_PERIOD_COVERAGE_SECONDS = {
    "day": 24 * 3600,
    "week": 7 * 24 * 3600,
    "month": 30 * 24 * 3600,
    "3months": 90 * 24 * 3600,
    "6months": 180 * 24 * 3600,
    "year": 365 * 24 * 3600,
}
_MAX_POINT_GAP_MULTIPLIER = 2  # same real, honest tolerance discipline as core/pnl.py


def is_onchain_pnl_eligible(category: str | None) -> tuple[bool, str | None]:
    """Real, honest eligibility check — category only. Deliberately NO
    hire-flow requirement at all: that's the entire real point of this
    reframing versus core/pnl.py."""
    group = category_groups.group_for_category(category)
    if group != PNL_ELIGIBLE_GROUP:
        return False, "Not a Trading & DeFi agent — real on-chain performance isn't a coherent measure for this category of work."
    return True, None


def _parse_ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


async def _resolve_operating_wallet(owner_address: str, token_id, api_key: str | None) -> dict:
    """Real, best-effort attempt at a distinct, disclosed operating
    wallet from the agent's own richer 8004scan metadata; falls back to
    owner_address honestly when there's nothing more specific (which is,
    confirmed live, every real case checked so far — see module
    docstring)."""
    if token_id and api_key:
        try:
            async with httpx.AsyncClient() as client:
                detail = await fetch_agent_detail(client, api_key, int(token_id))
        except Exception:
            detail = None
        if detail:
            agent_wallet = (detail.get("agent_wallet") or "").lower()
            if agent_wallet and agent_wallet.startswith("0x") and agent_wallet != (owner_address or "").lower():
                return {
                    "wallet": agent_wallet,
                    "confidence": "unconfirmed",
                    "source": ("A distinct operating wallet disclosed in this agent's own registered metadata "
                               "(agent_wallet), different from its owner_address."),
                }
    return {
        "wallet": owner_address,
        "confidence": "high" if owner_address else None,
        "source": ("This agent's own on-chain registration owner_address — no distinct operating wallet is "
                    "disclosed in its metadata."),
    }


def _pick_chart_period(window_seconds: float) -> str | None:
    for period, coverage in _CHART_PERIOD_COVERAGE_SECONDS.items():
        if window_seconds <= coverage * 0.9:
            return period
    return None  # real window wider than even "year" — an honest "can't size a chart for this" outcome


async def get_historical_onchain_performance(
    owner_address: str, category: str | None, token_id=None, api_key: str | None = None,
) -> dict:
    """The real, main entry point — a standalone signal, deliberately
    independent of core/pnl.py's Tnega-hire-scoped one. Always returns a
    real, honest result:
      - `applicable=False` — wrong category, nothing to show.
      - `applicable=True, has_activity=False` — right category, but no
        real, attributable DeFi-execution transactions found on the
        resolved wallet (an honest negative, not an error).
      - `applicable=True, has_activity=True` — real evidence found; a
        real `pnl` sub-result when a real value could be computed
        (`None` with `pnl_reason` set when it honestly couldn't).
    `attribution_confidence` and `wallet_source` are always included once
    a wallet is resolved — see module docstring for what each really
    means."""
    eligible, reason = is_onchain_pnl_eligible(category)
    if not eligible:
        return {"applicable": False, "has_activity": False, "reason": reason}

    resolved = await _resolve_operating_wallet(owner_address, token_id, api_key or os.environ.get("SCAN_8004_API_KEY"))
    wallet = resolved["wallet"]
    if not wallet:
        return {"applicable": True, "has_activity": False, "reason": "No real owner/operating wallet on record for this agent."}

    now_ms = int(time.time() * 1000)
    activity = await zerion.get_wallet_activity(wallet, 0, now_ms)
    if not activity.get("available"):
        return {
            "applicable": True, "has_activity": False,
            "reason": f"Real on-chain activity check unavailable right now: {activity.get('reason')}",
            "wallet": wallet, "attribution_confidence": resolved["confidence"], "wallet_source": resolved["source"],
        }

    txs = activity.get("transactions", [])
    # Real, both-conditions filter — see module docstring's live-caught
    # correction: operation_type alone is NOT sufficient, a real,
    # Zerion-confirmed protocol_name is required too.
    defi_txs = [
        t for t in txs
        if t.get("operation_type") in _DEFI_EXECUTION_OP_TYPES and t.get("mined_at") and t.get("protocol_name")
    ]
    op_counts: dict[str, int] = {}
    protocols_seen: set[str] = set()
    for t in defi_txs:
        op_counts[t["operation_type"]] = op_counts.get(t["operation_type"], 0) + 1
        protocols_seen.add(t["protocol_name"])

    base = {
        "wallet": wallet, "attribution_confidence": resolved["confidence"], "wallet_source": resolved["source"],
        "transactions_checked": len(txs),
    }

    if not defi_txs:
        return {
            **base, "applicable": True, "has_activity": False,
            "reason": ("No real, Zerion-confirmed DeFi protocol execution (trades, deposits, withdrawals, LP "
                       "mint/burn, claims against a real, recognized protocol) found on this agent's real "
                       "operating wallet, in its most recent real on-chain transaction history. (Other, "
                       "unrecognized contract calls may exist on this wallet — self-registration, other "
                       "platforms' own escrow/action contracts, etc. — but aren't counted as DeFi evidence; "
                       "see core/onchain_pnl.py's own module docstring for why.)"),
        }

    # Real corroborating evidence, best-effort — current real DeFi
    # protocol positions (already the same real data WalletPortfolioPanel
    # surfaces), never required for has_activity, just extra real context.
    portfolio = await zerion.get_wallet_portfolio(wallet)
    defi_positions = []
    if portfolio.get("available"):
        defi_positions = [p for p in portfolio["positions"] if p.get("position_type") and p["position_type"] != "wallet"]

    oldest_ts = min(_parse_ts(t["mined_at"]) for t in defi_txs)
    now_ts = now_ms / 1000
    window_seconds = now_ts - oldest_ts

    result = {
        **base, "applicable": True, "has_activity": True,
        "defi_tx_count": len(defi_txs), "defi_tx_types": op_counts,
        "defi_protocols": sorted(protocols_seen),
        "defi_positions": defi_positions,
        "window_capped_at_50_most_recent_transactions": len(txs) >= _MAX_TX_PAGE,
        "oldest_defi_tx_ts": int(oldest_ts),
    }

    # Real, independent second PnL signal (2026-08-30) — Zerion's own
    # dedicated, FIFO-cost-basis PnL endpoint, over the SAME real window as
    # the chart-based calculation below. Deliberately kept SEPARATE from
    # `result["pnl"]` rather than replacing it: the two use genuinely
    # different real methodologies (FIFO trade-matching here vs.
    # portfolio-value-at-two-points below), can legitimately disagree for a
    # wallet with real in-window trading, and showing both, clearly
    # labeled, is more scientifically honest than silently picking one.
    # Never blocks or degrades the rest of this function — a failure here
    # just leaves zerion_pnl unavailable, same honest-failure discipline as
    # everything else in this module.
    result["zerion_pnl"] = await zerion.get_wallet_pnl(wallet, since_ms=int(oldest_ts * 1000), till_ms=now_ms)

    # Real, best-effort PnL over that real window — same real methodology
    # as core/pnl.py (chart-based start/end value, minus real gas), just
    # windowed by the agent's own real activity instead of a Tnega job's
    # funding/delivery timestamps. A real, honest miss here still returns
    # has_activity=True with the real evidence above — the PnL number is
    # a bonus, not a requirement for this signal to be worth showing.
    period = _pick_chart_period(window_seconds)
    if period is None:
        result["pnl"] = None
        result["pnl_reason"] = (f"This agent's real DeFi activity spans {window_seconds / 86400:.0f} real days — "
                                 f"wider than any real chart period this project currently supports (up to 1 year).")
        return result

    chart = await zerion.get_wallet_chart(wallet, period)
    if not chart.get("available"):
        result["pnl"] = None
        result["pnl_reason"] = f"Real portfolio history unavailable from Zerion: {chart.get('reason')}"
        return result

    points = chart["points"]
    if len(points) < 2:
        result["pnl"] = None
        result["pnl_reason"] = "Not enough real chart data points to compute a real value change."
        return result

    def _nearest(pts, target_ts):
        return min(pts, key=lambda p: abs(p[0] - target_ts))

    start_point = _nearest(points, oldest_ts)
    end_point = _nearest(points, now_ts)
    point_spacing = points[1][0] - points[0][0]
    max_gap = point_spacing * _MAX_POINT_GAP_MULTIPLIER
    start_gap = abs(start_point[0] - oldest_ts)
    end_gap = abs(end_point[0] - now_ts)
    if start_gap > max_gap or end_gap > max_gap:
        result["pnl"] = None
        result["pnl_reason"] = (f"The closest real Zerion data points are too far from this window's real "
                                 f"start/end to trust (real gaps: {start_gap / 60:.0f}m / {end_gap / 60:.0f}m "
                                 f"against this period's own real {point_spacing / 60:.0f}m resolution).")
        return result

    # Real gas cost, scoped to this real window only (mined_at >=
    # oldest_ts) — the up-to-50 returned transactions can extend further
    # back than the oldest DeFi-execution one; summing every one of them
    # would over-count gas relative to this window.
    gas_usd = 0.0
    gas_complete = True
    for t in txs:
        ts = _parse_ts(t["mined_at"]) if t.get("mined_at") else None
        if ts is None or ts < oldest_ts:
            continue
        fee = t.get("fee_usd")
        if isinstance(fee, (int, float)):
            gas_usd += fee
        else:
            gas_complete = False

    start_value = start_point[1]
    end_value = end_point[1]
    pnl_usd = end_value - start_value - gas_usd
    result["pnl"] = {
        "pnl_usd": round(pnl_usd, 2), "start_value_usd": round(start_value, 2), "end_value_usd": round(end_value, 2),
        "gas_usd": round(gas_usd, 2), "gas_complete": gas_complete,
        "real_start_point_ts": int(start_point[0]), "real_end_point_ts": int(end_point[0]),
        "chart_period_used": period,
        "window_start_precision": ("the oldest real DeFi-execution transaction actually found, capped at the "
                                    "50 most recent real transactions on this wallet"),
    }
    return result
