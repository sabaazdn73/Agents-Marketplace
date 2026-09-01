"""
native_staking.py

Live decision logic for Tnega's own first Native Agent, the Staking
agent. Unlike the existing Skills (frontend/src/defiSkills.js), which
are third-party protocol integrations pulled from Altana's public
registry with no Tnega-designed logic, this is genuinely Tnega's own
multi-factor comparison and recommendation across candidate protocols,
using DefiLlama's free, no-key yields API (https://yields.llama.fi/pools)
and protocols API (https://api.llama.fi/protocols), both confirmed live
2026-09-01/2026-09-02.

Deliberately scoped to the two BSC liquid-staking protocols this repo
can actually EXECUTE a stake through (verified contract addresses and
ABIs, confirmed live against BscScan's own getsourcecode/getabi
2026-09-01, not guessed):
  - Lista DAO (slisBNB): frontend/src/defiSkills.js's existing listaStake
  - Ankr (ankrBNB): added alongside this file in defiSkills.js

Deliberately NOT the other ~30 BSC liquid-staking platforms DefiLlama
tracks; recommending a protocol this codebase has no verified,
executable integration for would be a dead end for a user who then
can't act on it. Also deliberately NOT WBETH (Binance's wrapped staked
ETH): investigated 2026-09-02 and found that minting it on BSC requires
already holding BETH obtained off-chain via Binance's own ETH staking
service, not a simple single-call BSC deposit like Lista/Ankr, so real
execution feasibility for it is unresolved, not confirmed. Left as a
pending candidate, not wired in.

Decision logic (not a simple sort), confirmed by the user 2026-09-02 to
extend beyond TVL/APY with three further, genuinely-available risk
parameters, each checked live against DefiLlama's real schema rather
than assumed relevant (see docs/features.md's Native Agent Marketplace
section for the full investigation):

1. Outlier filter: DefiLlama's own per-pool `outlier` flag is checked
   first. A pool DefiLlama itself flags as an outlier is excluded from
   consideration entirely, never merely down-ranked, since that flag is
   an independent, low-cost signal this project didn't have to compute
   itself.
2. TVL, primary ranking key: a proxy for liquidity/risk, deeper,
   more-trusted pools are less likely to have undiscovered risk or
   thin-liquidity withdrawal problems. Candidates within
   _COMPARABLE_TVL_RATIO of the top TVL are treated as one comparable
   risk tier; a dominant TVL is never overridden by anything below.
3. Within a comparable-TVL tier, APY is the secondary key.
4. If APY is also tied within that tier, DefiLlama's own disclosed
   audit count (from the protocols API, already used elsewhere in this
   project, see core/aggregate.py's audit-count parsing) breaks the tie:
   more independently audited is treated as safer.
5. If still tied, pool maturity (DefiLlama's own `count` field: how many
   daily snapshots it has tracked this pool for, a real, if imperfect,
   proxy for how long it's been observed) breaks the final tie.

With only two live candidates today, steps 4 and 5 are not currently
decisive (see the real numbers below), but the algorithm is built to use
them the moment a third comparable-TVL candidate exists, rather than
bolted on cosmetically.
"""

import httpx

DEFILLAMA_YIELDS_URL = "https://yields.llama.fi/pools"
DEFILLAMA_PROTOCOLS_URL = "https://api.llama.fi/protocols"

# Verified (BscScan getsourcecode/getabi + a live eth_call for each
# protocol's own min-stake getter, 2026-09-01): the only two candidates
# this codebase can actually execute a stake through right now.
STAKING_CANDIDATES = [
    {
        "id": "lista",
        "protocol_label": "Lista DAO",
        "token_symbol": "slisBNB",
        "defillama_project": "lista-liquid-staking",
        "defillama_symbol": "SLISBNB",
        "contract_address": "0x1adB950d8bB3dA4bE104211D5AB038628e477fE6",
        "min_stake_bnb": 0.001,  # live-confirmed via minBnb()
    },
    {
        "id": "ankr",
        "protocol_label": "Ankr",
        "token_symbol": "ankrBNB",
        "defillama_project": "ankr",
        "defillama_symbol": "ANKRBNB",
        "contract_address": "0x9e347Af362059bf2E55839002c699F7A5BaFE86E",
        "min_stake_bnb": 0.1,  # live-confirmed via getMinStake()
    },
]

# Within this multiple of the top candidate's TVL still counts as
# "comparable" liquidity/risk, deliberately conservative (3x, not
# something tighter tuned to produce a particular winner).
_COMPARABLE_TVL_RATIO = 3.0


def _parse_audit_count(raw) -> int | None:
    """DefiLlama's protocols API returns `audits` as a STRING, not an
    int (confirmed live) -- defensive parse, mirrors
    core/aggregate.py's own _parse_defillama_audit_count for the same
    real field on the same real API, kept as a separate local copy since
    this module has no dependency on aggregate.py today."""
    if raw is None:
        return None
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return None


async def fetch_staking_pool_data() -> dict[str, dict]:
    """Live TVL/APY/outlier/maturity for each candidate above (from the
    yields API), plus each candidate's disclosed audit count (from the
    protocols API, matched by the same `defillama_project` slug both
    APIs happen to share for these two protocols), keyed by candidate
    id. A candidate DefiLlama doesn't currently return data for is
    simply absent from the result (never fabricated); the caller decides
    how to handle that."""
    async with httpx.AsyncClient(timeout=15) as client:
        pools_resp, protocols_resp = await client.get(DEFILLAMA_YIELDS_URL), await client.get(DEFILLAMA_PROTOCOLS_URL)
        pools_resp.raise_for_status()
        protocols_resp.raise_for_status()
        pools = pools_resp.json().get("data", [])
        protocols = protocols_resp.json()

    protocols_by_slug = {p.get("slug"): p for p in protocols if p.get("slug")}

    by_id: dict[str, dict] = {}
    for candidate in STAKING_CANDIDATES:
        match = next(
            (
                p for p in pools
                if p.get("chain") == "BSC"
                and p.get("project") == candidate["defillama_project"]
                and p.get("symbol") == candidate["defillama_symbol"]
            ),
            None,
        )
        if not match:
            continue
        protocol = protocols_by_slug.get(candidate["defillama_project"])
        by_id[candidate["id"]] = {
            "apy": match.get("apy"),
            "tvl_usd": match.get("tvlUsd"),
            "pool_id": match.get("pool"),
            "outlier": bool(match.get("outlier")),
            "days_tracked": match.get("count"),
            "audit_count": _parse_audit_count(protocol.get("audits")) if protocol else None,
        }
    return by_id


def pick_best_staking_candidate(live_data: dict[str, dict]) -> tuple[dict | None, str, list[dict]]:
    """Multi-factor decision, see this module's own docstring for the
    full five-step waterfall (outlier filter, TVL, APY, audit count,
    pool maturity). Returns (recommended_candidate_or_None,
    reasoning_string, ranked_list); ranked_list is every non-outlier
    candidate with live data, highest TVL first, each carrying its own
    apy/tvl_usd/audit_count/days_tracked so the UI can show the full
    comparison, not just the winner."""
    ranked = []
    excluded_outliers = []
    for candidate in STAKING_CANDIDATES:
        data = live_data.get(candidate["id"])
        if not data or data.get("tvl_usd") is None:
            continue
        merged = {**candidate, **data}
        if merged["outlier"]:
            excluded_outliers.append(merged)
            continue
        ranked.append(merged)

    if not ranked:
        if excluded_outliers:
            names = ", ".join(c["protocol_label"] for c in excluded_outliers)
            return None, f"No candidate available: DefiLlama flags {names} as an outlier pool right now.", []
        return None, "No live data available for any candidate right now.", []

    ranked.sort(key=lambda c: c["tvl_usd"], reverse=True)
    top = ranked[0]
    comparable = [c for c in ranked if c["tvl_usd"] >= top["tvl_usd"] / _COMPARABLE_TVL_RATIO]

    if len(comparable) > 1:
        max_apy = max((c["apy"] or 0) for c in comparable)
        apy_tied = [c for c in comparable if (c["apy"] or 0) == max_apy]
        if len(apy_tied) > 1:
            max_audits = max((c["audit_count"] or 0) for c in apy_tied)
            audit_tied = [c for c in apy_tied if (c["audit_count"] or 0) == max_audits]
            if len(audit_tied) > 1:
                best = max(audit_tied, key=lambda c: (c["days_tracked"] or 0))
                reasoning = (
                    f"{best['protocol_label']} selected: {len(comparable)} candidates tied on liquidity, APY "
                    f"({max_apy:.2f}%), and audit count ({max_audits}), so pool maturity decided it, "
                    f"{best['days_tracked']} days tracked vs the others'."
                )
            else:
                best = audit_tied[0]
                reasoning = (
                    f"{best['protocol_label']} selected: {len(apy_tied)} candidates tied on liquidity and APY "
                    f"({max_apy:.2f}%), so disclosed audit count decided it, {best['audit_count']} vs the others'."
                )
        else:
            best = apy_tied[0]
            others = ", ".join(
                f"{c['protocol_label']} {c['apy']:.2f}%" for c in comparable if c["id"] != best["id"]
            )
            reasoning = (
                f"{best['protocol_label']} selected: {len(comparable)} candidates have comparable liquidity "
                f"(each within {_COMPARABLE_TVL_RATIO:.0f}x of the top TVL, ${top['tvl_usd']:,.0f}), "
                f"so current APY decided it, {best['apy']:.2f}% vs {others}."
            )
    else:
        best = top
        runner_up = ranked[1] if len(ranked) > 1 else None
        if runner_up:
            reasoning = (
                f"{best['protocol_label']} selected: ${best['tvl_usd']:,.0f} TVL vs "
                f"{runner_up['protocol_label']}'s ${runner_up['tvl_usd']:,.0f}. Liquidity isn't "
                f"comparable (used as the primary risk proxy), so APY "
                f"({best['apy']:.2f}% vs {runner_up['apy']:.2f}%) wasn't decisive."
            )
        else:
            reasoning = f"{best['protocol_label']} selected: the only candidate with live data right now."

    if excluded_outliers:
        names = ", ".join(c["protocol_label"] for c in excluded_outliers)
        reasoning += f" ({names} excluded: DefiLlama flags it as an outlier pool.)"

    return best, reasoning, ranked
