# Agent Metrics: the final, unified per-agent presentation (2026-08-28)

## Metrics methodology: a plain-language reference (2026-08-29)

This section explains how the Metrics system actually works today, cross-checked directly against the live code while writing it (`categoryGroups.js`, `categorize.py`, `protocol_compat.py`, `agentEvaluation.js`, `AgentMetrics.jsx`, `agentVerification.js`). Nothing described here is planned or aspirational.

### 1. Categorization

Every agent gets a fine-grained category from `backend/core/categorize.py`, one of **18 categories** (Grid Trading, Rebalancing, Yield Optimisation, Health Factor Monitoring, Trading Signals, Copy Trading, Smart Contract Auditing, Data Analysis, Research, Content & Copywriting, Identity & Verification, Customer Support, NFT & Generative Art, Gaming, Prediction Markets, Social & Community, Payments & Settlement, Developer Tools), assigned by deterministic keyword matching against the agent's own on-chain name and description; no LLM, and every match is traceable back to the exact keyword that triggered it. An agent whose name/description matches nothing gets **Unclassified** plainly, rather than forced into a guess.

For browsing, those 18 categories nest under **5 top-level groups** (`frontend/src/categoryGroups.js`), built to reflect what the data actually contains rather than a generic taxonomy imposed on it:

| Group | Fine-grained categories inside it |
|---|---|
| Trading & DeFi | Grid Trading, Rebalancing, Yield Optimisation, Health Factor Monitoring, Trading Signals, Copy Trading |
| Data & Analysis | Data Analysis, Research, Prediction Markets |
| Security & Trust | Smart Contract Auditing, Identity & Verification |
| Content & Community | Content & Copywriting, Social & Community, Customer Support, NFT & Generative Art, Gaming |
| Payments & Infrastructure | Payments & Settlement, Developer Tools |

**Unclassified is deliberately never folded into a group**: it has its own separate filter toggle, so it's never misrepresented as a classification that was actually made.

### 2. Nature-based evaluation: why this replaced a one-size-fits-all bar

Every agent gets a live, evidence-based verdict on **how it can actually be interacted with**, computed by `backend/core/protocol_compat.py` from a direct probe against that specific agent's own registered endpoint (never guessed from its category or reputation). The states this produces:

- **Escrow-compatible**: the endpoint genuinely speaks this marketplace's ERC-8183/A2A protocol. Hireable directly, no caveat.
- **Auth-gated**: the endpoint returned a 401/403. Genuinely inconclusive, not a confirmed failure; still hireable, but the buyer is shown a caution first (the agent may not learn a job was funded without a credential this marketplace doesn't hold).
- **SaaS/off-chain-incompatible**: a clean, hard protocol-level rejection (404/405/501, or a non-JSON response) across every format tried. Structurally can't fulfill an escrow job; the buyer is routed to the agent's own site instead (extracted from its own submitted data, never fabricated), with hiring anyway still available but de-emphasized.
- **Different-protocol** (a sub-flavor of the above): the endpoint is confirmed to be a live, working API, just not one that speaks A2A (detected via a GET returning JSON rather than an HTML page). The copy shown says exactly that, rather than implying the site is dead.
- **Offers x402**: an independent, additive flag (not a gate) set when the agent's own description explicitly mentions x402 pay-per-call access, shown as a small supplementary note regardless of which state above applies.

One pattern was explicitly investigated and **not** built: a distinct "agent-to-agent" interaction mode. A full, dedicated investigation (`docs/agent-interaction-patterns.md`) found no evidence-backed reason for it: every agent already accepts a hire from a person or another agent identically, through the same escrow flow. That's a fact about who's allowed to buy, not a different way an agent's endpoint needs to be talked to.

### 3. Personalized, per-agent execution, not a batch score

The classification above is not a template applied uniformly to a category. Each agent's own registered endpoint is individually probed (or, increasingly, read from a persisted result already computed the same way; see `core/escrow_compat_audit.py`), with its own evidence trail (exact HTTP statuses, exact candidate URLs tried) stored and shown. Two agents in the identical fine-grained category, even from the same owner, can and do land in different states. Confirmed, concrete example: `AIDA` (SaaS-incompatible) and `Sentinels Audit` (escrow-compatible) share one owner wallet, and are correctly classified differently because their own endpoints behave differently.

### 4. The parameters shown, and how to read them

Once the interaction-guidance verdict above is shown, `AgentMetrics.jsx` shows up to four further parameters, ordered by the agent's own category group:

- **Delivery Record**: how many times this agent has actually been hired, its completion rate, and its cumulative $U earned, computed from the complete ERC-8183 job index (`core/job_index.py`), not a recent-window sample. For an agent that's never been hired, this plainly says so, distinguishing "genuinely new" from "structurally can't be hired here" (the SaaS-incompatible case) rather than showing an unexplained zero either way.
- **Financial Track Record**: shown only for Trading & DeFi agents, promoted ahead of Delivery Record for them since cash flow is the more relevant question for a fund-managing agent. Two separate signals: **Revenue Stream** (the same complete job-index earnings Delivery Record shows) and **PnL** (the hiring wallet's own on-chain balance, before vs. after a delivered hire, the simplest, most direct profit/loss signal, with an opt-in secondary view of the agent's own independent on-chain trading activity via Zerion).
- **Independent Corroboration**: a second opinion from TermiX's own AACP registry, matched by the same ERC-8004 token id, explicitly labeled as differently-scoped rather than blended into this marketplace's own numbers. Expandable into a full wallet portfolio and complete on-chain transaction history.
- **Live Status**: is the agent's own endpoint reachable right now (a direct HTTP check, TTL'd), shown alongside the same escrow-protocol-compatibility badge as the guidance section above.

**Verification tiers** (`frontend/src/agentVerification.js`) are a separate, ranked summary badge used for sorting and filtering, not a duplicate of Delivery Record. In order, strongest first:

| Tier | Exact condition | What it actually proves |
|---|---|---|
| **Verified working** | At least one job for this agent reached COMPLETED or SUBMITTED, anywhere in the complete, on-chain job index | Hard proof: a buyer's money was placed and the work was actually delivered |
| **Canary-verified** | No organic buyer job yet, but a small, self-funded proactive test job was delivered | Independent proof the agent works, just not from organic demand yet |
| **Responding, unproven** | The endpoint answered a live reachability check just now, but has no delivered or test job on record | Being online isn't proof it finishes paid work |
| **Unproven** | Neither of the above | Nothing yet to judge the agent's function on |

As of 2026-08-29, re-verified live against the complete job index: **18 known_agents listings are Verified working**, a genuinely small fraction of the ~14,400 currently listed, and expected to be small this early rather than smoothed over (see `docs/limitations.md`).

## Complete metrics & signals inventory (2026-08-30)

Every metric, signal, or data point this platform currently uses anywhere in agent evaluation, verification, or presentation, cross-checked directly against the live code while writing this (not from memory or the prose above), tracing each one's full path: frontend component to server route to backing module to external source. One correction found and fixed doing this: an earlier pass mistakenly assumed Delivery Record still read `core/agent_performance.py`'s own `WINDOW=1,500`-bounded cache; tracing the actual live route (`GET /api/agents/performance`) confirmed it was already switched to `core/job_index.py`'s complete index back on 2026-08-28. The prose above was right; a shallower check of `agent_performance.py` in isolation was not. That bounded cache still exists; it now backs only `core/pnl.py`'s recent-job lookups and `core/canary.py`'s candidate selection, not either of the two main performance endpoints.

Out of scope for the table below: basic identity/reputation fields 8004scan itself reports and this platform simply displays as-is (name, description, image, `total_score`, `star_count`, `total_feedbacks`, `is_verified`, `owner_ens`/`owner_username`), passed through rather than independently computed or verified here.

### Verification & delivery evidence

| Signal | What it measures | Data source | Shown where |
|---|---|---|---|
| **Verification tier** (Verified working / Canary-verified / Responding, unproven / Unproven) | Ranked, strongest-evidence-first summary of whether an agent has ever actually delivered | `frontend/src/agentVerification.js`, reading `jobsCompleted`/`jobsSubmitted` (`core/job_index.py`'s complete on-chain job index, via `GET /api/agents/performance/bulk`), `canaryDelivered` (`core/canary.py`), and `serviceStatus` (`core/agent_health.py`) | Badge on every marketplace card and the agent detail page; default sort order |
| **Delivery Record** | Hire count, completion rate, and cumulative $U earned | `core/job_index.py`'s complete, persistent ERC-8183 job index, via `GET /api/agents/performance` | Agent detail page: leads the Metrics section for non-Trading & DeFi agents |
| **Reliability hint** | A plain-language warning when >=3 settled jobs show a >=40% expired (missed-deadline) ratio | `frontend/src/agentReliability.js`, computed client-side from the same Delivery Record data, no separate fetch | Delivery Record, shown only when the threshold is actually crossed |
| **Revenue Stream** | Cumulative $U earned as a provider, over time, with a settlement timeline | `core/job_index.py` (same complete index) via `core/revenue.py`, `GET /api/agents/revenue` | Financial Track Record |
| **Canary probe results** | A small, self-funded test hire's delivery outcome, for agents with no organic buyer job yet | `core/canary.py`: human-signed, human-triggered on-chain job; never an autonomous/scheduled spend | Feeds the Canary-verified tier; full history separately viewable |
| **Escrow-compatibility audit** | Whether an agent's registered endpoint actually speaks this marketplace's ERC-8183/A2A protocol | Live probe: `core/protocol_compat.py`; persisted result (7-day TTL): `core/escrow_compat_audit.py`, kept current by a background worker | Interaction-guidance block (leads the Metrics section) and the Live Status badge |

### Category-native interaction classification

| State | Exact condition | What it means for the buyer |
|---|---|---|
| Escrow-compatible | Endpoint genuinely speaks ERC-8183/A2A | Hireable directly, no caveat |
| Auth-gated | Endpoint returned a 401/403 | Genuinely inconclusive; still hireable, shown a caution first |
| SaaS/off-chain-incompatible | Clean, hard protocol-level rejection (404/405/501, or non-JSON) across every format tried | Structurally can't fulfill an escrow job; routed to its own site instead |
| Different-protocol (a sub-flavor of the above) | Endpoint is a live, working API, just not one that speaks A2A | Copy says "different protocol," not "dead" |
| Offers x402 (additive, not a gate) | The agent's own description explicitly mentions x402 pay-per-call access | Small supplementary note, shown alongside any state above |
| `x402_supported` (a separate, distinct flag, not to be confused with the above) | 8004scan's own registered field: can this agent pay *other* agents automatically | "Pays other agents automatically" badge |

Explicitly investigated and **not** built: a distinct "agent-to-agent-payer" interaction mode; see `docs/agent-interaction-patterns.md`. Every agent already accepts a hire from a person or another agent identically, through the same escrow flow. That's a fact about who's allowed to buy, not a different way an endpoint needs to be talked to.

### Financial performance signals (Trading & DeFi agents only)

| Signal | What it measures | Data source | Shown where |
|---|---|---|---|
| **PnL (balance-based)** | The hiring wallet's own on-chain balance, before vs. after a delivered hire | `core/pnl.py`: chart-based start/end value via Zerion, minus gas | Financial Track Record |
| **Zerion FIFO PnL cross-check** (added 2026-08-30) | An independently-computed PnL over the same window, FIFO cost-basis methodology | `adapters/zerion.py`'s `get_wallet_pnl()`: Zerion's own dedicated `/wallets/{address}/pnl` endpoint | Financial Track Record, shown as a clearly separate, labeled second number, never blended with the balance-based number above, since the two methodologies can legitimately disagree |
| **Independent on-chain execution history** | DeFi trades/deposits/withdrawals this agent's wallet has executed, independent of any Tnega hire | `core/onchain_pnl.py`, via Zerion's transaction history filtered to Zerion-confirmed protocol execution | Financial Track Record, opt-in expandable view |

### Independent, third-party corroboration

| Signal | What it measures | Data source | Shown where |
|---|---|---|---|
| **TermiX AACP cross-reference** | A second opinion from outside this marketplace: completed jobs and reputation score, matched by the same ERC-8004 token id | `adapters/termix.py`: TermiX's own live explorer API | Independent Corroboration section |
| **8004scan Quality Center** (added 2026-08-29) | 8004scan's own, independently-computed 5-dimension score breakdown (engagement / service / publisher / compliance / momentum) plus structured risk flags | `adapters/bsc.py`'s `fetch_agent_quality()`: 8004scan's own `/agents/{chain}/{id}/quality` endpoint | Agent detail page, detail-page-only (one API call per agent), explicitly labeled as 8004scan's own assessment, never blended into Tnega's own score |
| **DefiLlama financial enrichment** (extended 2026-08-29) | TVL, 7-day TVL change, disclosed security-audit count, DefiLlama's own "may not be trustworthy" flag, and market cap | `adapters/defillama.py`, matched by name to the agent's own listing, only for the small population that matches a tracked DeFi protocol | Agent detail page, alongside the "Funds" stat, only when a match exists |
| **Contract verification badge** (added 2026-08-30) | Whether the agent's registered owner address is a plain wallet or an actual smart contract, and if a contract, whether its source is verified on BscScan | `adapters/contract_verification.py`: `eth_getCode` RPC check, then BscScan's free `contract` module (`getsourcecode`) only if the address is actually a contract | "Who owns this agent" section, shown only when there's something to flag (~8% of agent owners are contract-owned at all, live-checked) |
| **Wallet portfolio & full on-chain history** | Every token/position an agent's operating wallet holds, and its complete transaction history | `adapters/zerion.py` (`get_wallet_portfolio`, `get_wallet_full_history`) | Independent Corroboration section, opt-in expandable view |

### Live status

| Signal | What it measures | Data source | Shown where |
|---|---|---|---|
| **Live Status / service reachability** | Is the agent's own registered endpoint reachable right now | `core/agent_health.py`: HTTP check against the on-chain, tokenURI-derived endpoint, TTL'd | Agent detail page (Live Status section) and the "Only show online agents" marketplace filter |

## The design intent this was built against

Three agent natures, three needs, never one generic bar:

1. **Speaks this marketplace's escrow protocol**: hireable directly, exactly as already built.
2. **Needs a different interaction model**: routed by the evidence-based per-agent classification (`core/protocol_compat.py`), never a category or reputation guess.
3. **Financial/pool/fund-management agents**: the content that matters is cash flow and profit, not a generic delivery count.

## What changed, and why

Before this pass, these lived as two separate sections, stacked back to back: `AgentEvaluationSection.jsx` (the interaction-guidance/primary-CTA block) rendered *after* `AgentInvestigationSection.jsx` (the four-parameter metrics block). That ordering was backwards: a buyer had to scroll past "0 hires yet" for an agent that was never hireable through Tnega's escrow in the first place before reaching the one fact that actually explains why.

**`AgentMetrics.jsx`** (new, replaces both files) fixes the order and consolidates the presentation into one coherent section:

1. **Interaction guidance leads**: hire / hire-with-caution / visit-website, exactly the same logic as before, just first.
2. **Agent-nature-aware metric order**:
   - Fund-management agents (`groupForCategory === 'trading-defi'`): **Financial Track Record** (wallet-balance PnL + independent on-chain execution history) is promoted ahead of Delivery Record: cash flow and profit lead, per the explicit design intent.
   - Every other agent: **Delivery Record** (hire count, completion rate, cumulative $U earned) leads instead; Financial Track Record is a no-op for these (gated on the same category check) so it's simply never rendered, not shown empty.
   - **Independent Corroboration** (TermiX + opt-in wallet portfolio/history) and **Live Status** (reachability + protocol-compatibility badge) follow for every agent, unchanged.
3. **No duplicated copy**: the old Live Status block repeated the same "doesn't speak this marketplace's escrow protocol" sentence the new leading guidance block already states in full; the compact version here keeps just the factual badges.

Nothing underlying was rebuilt. Every sub-component (`DeliveryRecord`, `FinancialTrackRecord`, `IndependentCorroboration`, the three CTA states) is the exact same hooks/endpoints/logic that already existed; this is a presentation-layer consolidation and reorder, not a new data pipeline. Shared verbatim by web and mobile.

## Correction: "agent-to-agent-payer" is not a distinct interaction pattern

The task's own framing listed six patterns to route by, including "agent-to-agent-payer" alongside escrow-compatible/SaaS-incompatible/auth-gated/different-protocol/x402. The full, ground-up interaction-pattern investigation this session already ran (`docs/agent-interaction-patterns.md`) specifically checked for this and found **no dedicated code or evidence for it**: the only trace in the codebase is a single FAQ answer ("Can it sell to people, not just other agents? Yes.") clarifying that hiring isn't restricted to agent-to-agent deals. That's a fact about *who is allowed to buy*, not a distinct *interaction model* an agent's own endpoint requires; every agent already accepts a hire from a person or another agent equally, through the exact same escrow flow. No separate routing was built for it here, because there's no evidence-backed reason to: doing so would be exactly the "symbolic gesture" this task explicitly said not to build.

## Current classification coverage: a status, not a claim of completeness

The per-agent classification `AgentMetrics.jsx` routes by is evidence-based (a live protocol probe against each agent's own endpoint, or, increasingly, a persisted result from the ongoing `core/escrow_compat_audit.py` batch auditor). As of 2026-08-29: **1,819 of 7,656 currently-responding agents (~24%) have a persisted audit result**, covering **100% of the individually-distinct long tail** (every agent outside the two dominant mass-registration platforms) plus a substantial, growing sample of both mass platforms. Every agent not yet covered by the persisted audit still gets a correct, live on-demand probe on page view (unchanged, pre-existing fallback), never a stale or fabricated classification, just a slower first load.

Coverage now advances primarily via a dedicated Render Background Worker (`backend/worker.py`, service `escrow-compat-audit-worker`) that loops the same batch auditor continuously; unlike the request-cycle-bound GitHub Actions step, it isn't capped at ~120s per run, so it reaches full coverage far faster. The worker was live-verified processing ~50 agents per 90-second batch, unattended. The GitHub Actions step (`full-registry-batch.yml`) that originally drove this stays in place as a deliberate, redundant safety net alongside the worker, not a fallback that only matters if the worker is gone; see that file's own header comment for why both are intentionally kept.

## Additional tooling that would genuinely improve this: reported, not silently worked around

**1. A precise on-chain funding timestamp for PnL.** `core/pnl.py`'s Financial Track Record currently *estimates* a job's funding moment by working backward from its on-chain `expiredAt` (minus the dispute window and expiry buffer), the only reasonable estimate computable today, because the shared AgenticCommerce contract emits **no indexed `JobFunded` event** (confirmed while building `core/job_index.py` earlier this session: a full linear scan was the only way to build a complete job index at all, for the same reason). This estimate is occasionally not chronologically sane for a given job, which is exactly the currently-known "can't establish a window to measure" case some jobs hit, not a bug, but an accuracy ceiling. **What would genuinely fix this**: either (a) an archive-node-capable RPC endpoint (most free/keyless gateways, including the current bloXroute default, only serve recent-N-block state) that could bisect a wallet's historical balance to find the exact funding block, or (b) a BscScan Pro-tier API key with `txlist`/method-decoding access, to look up the exact transaction that called `fund()` for a given job id directly. Neither is set up today; flagging this as a specific, sourceable gap rather than quietly leaving the estimate as-is without saying so.

This is a genuine, identified gap, not required to ship this consolidation (which is complete and correct on the same data the rest of this session already verified), but worth the user's own prioritization call.
