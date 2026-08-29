# Agent Metrics — the final, unified per-agent presentation (2026-08-28)

## Metrics methodology — a plain-language reference (2026-08-29)

This section explains how the Metrics system actually works today, cross-checked directly against the live code while writing it (`categoryGroups.js`, `categorize.py`, `protocol_compat.py`, `agentEvaluation.js`, `AgentMetrics.jsx`, `agentVerification.js`) — nothing described here is planned or aspirational.

### 1. Categorization

Every real agent gets a fine-grained category from `backend/core/categorize.py` — one of **18 categories** (Grid Trading, Rebalancing, Yield Optimisation, Health Factor Monitoring, Trading Signals, Copy Trading, Smart Contract Auditing, Data Analysis, Research, Content & Copywriting, Identity & Verification, Customer Support, NFT & Generative Art, Gaming, Prediction Markets, Social & Community, Payments & Settlement, Developer Tools), assigned by deterministic keyword matching against the agent's own real, on-chain name and description — no LLM, and every match is traceable back to the exact keyword that triggered it. An agent whose name/description matches nothing gets **Unclassified** honestly, rather than forced into a guess.

For browsing, those 18 categories nest under **5 top-level groups** (`frontend/src/categoryGroups.js`), built to reflect what the real data actually contains rather than a generic taxonomy imposed on it:

| Group | Fine-grained categories inside it |
|---|---|
| Trading & DeFi | Grid Trading, Rebalancing, Yield Optimisation, Health Factor Monitoring, Trading Signals, Copy Trading |
| Data & Analysis | Data Analysis, Research, Prediction Markets |
| Security & Trust | Smart Contract Auditing, Identity & Verification |
| Content & Community | Content & Copywriting, Social & Community, Customer Support, NFT & Generative Art, Gaming |
| Payments & Infrastructure | Payments & Settlement, Developer Tools |

**Unclassified is deliberately never folded into a group** — it has its own separate filter toggle, so it's never misrepresented as a real classification that was actually made.

### 2. Nature-based evaluation — why this replaced a one-size-fits-all bar

Every real agent gets a live, evidence-based verdict on **how it can actually be interacted with**, computed by `backend/core/protocol_compat.py` from a real, direct probe against that specific agent's own registered endpoint (never guessed from its category or reputation). The real states this produces:

- **Escrow-compatible** — the endpoint genuinely speaks this marketplace's ERC-8183/A2A protocol. Hireable directly, no caveat.
- **Auth-gated** — the endpoint returned a real 401/403. Genuinely inconclusive, not a confirmed failure — still hireable, but the buyer is shown a real, honest caution first (the agent may not learn a job was funded without a credential this marketplace doesn't hold).
- **SaaS/off-chain-incompatible** — a clean, hard protocol-level rejection (404/405/501, or a non-JSON response) across every real format tried. Structurally can't fulfill an escrow job; the buyer is routed to the agent's own site instead (extracted from its own real, submitted data — never fabricated), with hiring anyway still available but de-emphasized.
- **Different-protocol** (a sub-flavor of the above) — the endpoint is confirmed to be a real, live, working API, just not one that speaks A2A (detected via a real GET returning JSON rather than an HTML page). The copy shown says exactly that, rather than implying the site is dead.
- **Offers x402** — an independent, additive flag (not a gate) set when the agent's own description explicitly mentions x402 pay-per-call access, shown as a small supplementary note regardless of which state above applies.

One pattern was explicitly investigated and **not** built: a distinct "agent-to-agent" interaction mode. A full, dedicated investigation (`docs/agent-interaction-patterns.md`) found no real, evidence-backed reason for it — every real agent already accepts a hire from a person or another agent identically, through the same escrow flow; that's a fact about who's allowed to buy, not a different way an agent's endpoint needs to be talked to.

### 3. Personalized, per-agent execution — not a batch score

The classification above is not a template applied uniformly to a category. Each real agent's own registered endpoint is individually probed (or, increasingly, read from a persisted result already computed the same way — see `core/escrow_compat_audit.py`), with its own real evidence trail (exact HTTP statuses, exact candidate URLs tried) stored and shown. Two agents in the identical fine-grained category, even from the same owner, can and do land in different real states — confirmed, concrete example: `AIDA` (SaaS-incompatible) and `Sentinels Audit` (escrow-compatible) share one real owner wallet, and are correctly classified differently because their own real endpoints behave differently.

### 4. The real parameters shown, and how to read them

Once the interaction-guidance verdict above is shown, `AgentMetrics.jsx` shows up to four further real parameters, ordered by the agent's own category group:

- **Delivery Record** — how many times this agent has actually been hired, its real completion rate, and its real, cumulative $U earned — computed from the complete, real ERC-8183 job index (`core/job_index.py`), not a recent-window sample. For an agent that's never been hired, this honestly says so, distinguishing "genuinely new" from "structurally can't be hired here" (the SaaS-incompatible case) rather than showing an unexplained zero either way.
- **Financial Track Record** — shown only for Trading & DeFi agents, promoted ahead of Delivery Record for them since real cash flow is the more relevant question for a fund-managing agent. Two real, separate signals: **Revenue Stream** (the same real, complete job-index earnings Delivery Record shows) and **PnL** (the hiring wallet's own real on-chain balance, before vs. after a delivered hire — the simplest, most direct real profit/loss signal, with an opt-in secondary view of the agent's own independent on-chain trading activity via Zerion).
- **Independent Corroboration** — a real, second opinion from TermiX's own AACP registry, matched by the same real ERC-8004 token id, explicitly labeled as differently-scoped rather than blended into this marketplace's own numbers. Expandable into a real, full wallet portfolio and complete on-chain transaction history.
- **Live Status** — is the agent's own endpoint reachable right now (a real, direct HTTP check, TTL'd), shown alongside the same real escrow-protocol-compatibility badge as the guidance section above.

**Verification tiers** (`frontend/src/agentVerification.js`) are a separate, real, ranked summary badge used for sorting and filtering, not a duplicate of Delivery Record. In order, strongest first:

| Tier | Real, exact condition | What it actually proves |
|---|---|---|
| **Verified working** | At least one real job for this agent reached COMPLETED or SUBMITTED, anywhere in the complete, on-chain job index | Hard proof — a real buyer's money was placed and the work was actually delivered |
| **Canary-verified** | No organic buyer job yet, but a small, real, self-funded proactive test job was delivered | Real, independent proof the agent works, just not from real demand yet |
| **Responding, unproven** | The endpoint answered a live reachability check just now, but has no delivered or test job on record | Being online isn't proof it finishes paid work |
| **Unproven** | Neither of the above | Nothing yet to judge the agent's real function on |

As of 2026-08-29, re-verified live against the complete job index: **18 real known_agents listings are Verified working** — a genuinely small fraction of the ~14,400 currently listed, and expected to be small this early rather than smoothed over (see `docs/limitations.md`).


## The real design intent this was built against

Three real agent natures, three real needs — never one generic bar:

1. **Speaks this marketplace's real escrow protocol** — hireable directly, exactly as already built.
2. **Needs a different real interaction model** — routed by the real, evidence-based per-agent classification (`core/protocol_compat.py`), never a category or reputation guess.
3. **Financial/pool/fund-management agents** — the real content that matters is real cash flow and real profit, not a generic delivery count.

## What changed, and why

Before this pass, these lived as two separate sections, stacked back to back: `AgentEvaluationSection.jsx` (the interaction-guidance/primary-CTA block) rendered *after* `AgentInvestigationSection.jsx` (the four-parameter metrics block). That ordering was backwards — a buyer had to scroll past "0 hires yet" for an agent that was never hireable through Tnega's escrow in the first place before reaching the one fact that actually explains why.

**`AgentMetrics.jsx`** (new, replaces both files) fixes the order and consolidates the presentation into one real, coherent section:

1. **Interaction guidance leads** — hire / hire-with-caution / visit-website, exactly the same real logic as before, just first.
2. **Real, agent-nature-aware metric order**:
   - Fund-management agents (`groupForCategory === 'trading-defi'`): **Financial Track Record** (real wallet-balance PnL + independent on-chain execution history) is promoted ahead of Delivery Record — real cash flow and profit lead, per the explicit design intent.
   - Every other agent: **Delivery Record** (real hire count, completion rate, cumulative $U earned) leads instead; Financial Track Record is a real no-op for these (gated on the same category check) so it's simply never rendered, not shown empty.
   - **Independent Corroboration** (TermiX + opt-in wallet portfolio/history) and **Live Status** (reachability + protocol-compatibility badge) follow for every agent, unchanged.
3. **No duplicated copy** — the old Live Status block repeated the same "doesn't speak this marketplace's escrow protocol" sentence the new leading guidance block already states in full; the compact version here keeps just the factual badges.

Nothing underlying was rebuilt. Every sub-component (`DeliveryRecord`, `FinancialTrackRecord`, `IndependentCorroboration`, the three real CTA states) is the exact same real hooks/endpoints/logic that already existed — this is a presentation-layer consolidation and reorder, not a new data pipeline. Shared verbatim by web and mobile.

## Honest correction: "agent-to-agent-payer" is not a real, distinct interaction pattern

The task's own framing listed six patterns to route by, including "agent-to-agent-payer" alongside escrow-compatible/SaaS-incompatible/auth-gated/different-protocol/x402. The full, ground-up interaction-pattern investigation this session already ran (`docs/agent-interaction-patterns.md`) specifically checked for this and found **no real, dedicated code or evidence for it** — the only trace in the codebase is a single FAQ answer ("Can it sell to people, not just other agents? Yes.") clarifying that hiring isn't restricted to agent-to-agent deals. That's a fact about *who is allowed to buy*, not a distinct *interaction model* an agent's own real endpoint requires — every real agent already accepts a hire from a person or another agent equally, through the exact same escrow flow. No separate routing was built for it here, because there's no real, evidence-backed reason to: doing so would be exactly the "symbolic gesture" this task explicitly said not to build.

## Real, current classification coverage — an honest status, not a claim of completeness

The per-agent classification `AgentMetrics.jsx` routes by is real and evidence-based (a live protocol probe against each agent's own endpoint, or — increasingly — a persisted result from the real, ongoing `core/escrow_compat_audit.py` batch auditor). As of this pass: **228 of 6,846 currently-responding agents (3.3%) have a persisted audit result**, covering **100% of the real, individually-distinct long tail** (every agent outside the two dominant mass-registration platforms) plus a substantial, growing sample of both mass platforms. A second, real ~25-minute batch was run alongside this build to push coverage further. Every agent not yet covered by the persisted audit still gets a correct, real, live on-demand probe on page view (unchanged, pre-existing fallback) — never a stale or fabricated classification, just a slower first load. Full marketplace-wide coverage continues via the scheduled GitHub Actions batch (every 6 hours) until it reaches 100%.

## Real, additional tooling that would genuinely improve this — reported, not silently worked around

**1. Faster path to full classification coverage.** The scheduled batch step is capped at a real 120s per run (Render's own observed request-timeout zone — see `full-registry-batch.yml`'s own docstring), which at real, measured throughput covers roughly 150-250 agents per 6-hour tick. Reaching the remaining ~6,600, mostly-`evoevo.ai` agents at that cadence is realistically a matter of days to a couple of weeks, not hours. If faster full coverage matters, the concrete lever is a **dedicated, longer-running worker** (a Render background worker or a manually-triggered `workflow_dispatch` run left going for an hour) rather than the request-cycle-bound batch endpoint — I can build that if wanted, but didn't add it unprompted since it's a real, new piece of infrastructure, not a tuning change.

**2. A precise, real on-chain funding timestamp for PnL.** `core/pnl.py`'s Financial Track Record currently *estimates* a job's real funding moment by working backward from its on-chain `expiredAt` (minus the dispute window and expiry buffer) — the only honest estimate computable today, because the shared AgenticCommerce contract emits **no indexed `JobFunded` event** (confirmed while building `core/job_index.py` earlier this session: a full linear scan was the only way to build a complete job index at all, for the same real reason). This estimate is occasionally not chronologically sane for a given job, which is exactly the real, currently-honest "can't establish a real window to measure" case some jobs hit — not a bug, but a real accuracy ceiling. **What would genuinely fix this**: either (a) an archive-node-capable RPC endpoint (most free/keyless gateways, including the current bloXroute default, only serve recent-N-block state) that could bisect a wallet's real historical balance to find the exact funding block, or (b) a BscScan Pro-tier API key with `txlist`/method-decoding access, to look up the real, exact transaction that called `fund()` for a given job id directly. Neither is set up today; I'm flagging this as a specific, real, sourceable gap rather than quietly leaving the estimate as-is without saying so.

Both are genuine, identified gaps — not required to ship this consolidation (which is complete and correct on the same real data the rest of this session already verified), but worth the user's own prioritization call.
