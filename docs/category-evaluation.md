# Category-aware evaluation: the investigation, and why it's a two-axis model, not five bespoke ones

## The starting question

Forcing every registered agent through the same "attempt an ERC-8183 escrow hire" pipeline makes agents that are natively different, SaaS/off-chain tools, data agents, DeFi execution agents, security/monitoring agents, look broken or low-performing when they were simply evaluated the wrong way for what they actually are. The ask: define a genuinely appropriate evaluation method and primary call-to-action **per category group**, based on current examples in each, not assumptions.

## What was actually checked (2026-08-28), and what it found

Live `protocol_compat.check_escrow_compatibility()` probes (the same detector already shipped for the SaaS-detection feature) were run against currently-`responding` agents sampled from every category group, plus a full census of each group's population composition. Full per-agent evidence is reproducible via `core/protocol_compat.py`; the counts below are measured, not estimated.

### Trading & DeFi (3,224 registered)
Genuinely mixed. Escrow-compatible examples: BNB LP Range Rebalancer, Yield Allocator (both `agents.chainhelix.io` agents with confirmed completed jobs). Escrow-incompatible examples: BNB Lending Guardian, two "Agent Studio" hackathon-marketplace agents (endpoint is a generic `/launch` page, not an A2A endpoint), Rook Trading Intelligence. No clean split by sub-category (Health Factor Monitoring appears on both sides).

### Data & Analysis (3,161 registered)
**A load-bearing correction to the premise this task started from**: the "explainer agent" cited as this category's working example is actually classified `Payments & Settlement`, not Data & Analysis. Checked live, not assumed.

More significantly: **100% of this group's currently-`responding` population (2,268/2,268 agents) is hosted on `evoevo.ai`**, a single bulk-registration campaign. A live sample of 6 of them came back **6/6 escrow-incompatible** (HTTP 405 on every candidate+format, same signature as AIDA). There is no currently-reachable non-`evoevo.ai` agent in this category group at all. The category's theoretical fit for a hire-and-deliver flow may still be correct in principle, but its actual, current population doesn't reflect that; it's dominated by one non-functional cluster.

### Security & Trust (137 registered)
Explicitly investigated the hypothesis that this group is more naturally evaluated by continuous uptime/liveness than one-off delivery, per the request. **Not confirmed.** Only 3 of 137 registered agents are currently reachable at all. The one working, escrow-compatible example, Sentinels Audit (`smartsentinels.net`), is itself a one-off **"submit contract source, get a structured audit report"** job (confirmed from its own live description), a textbook fit for the existing hire-and-deliver flow, not a continuous-monitoring pattern. A keyword scan of every description in this group's monitoring-adjacent language (`monitor`, `real-time`, `24/7`, `continuous`, `alert`, `watch`) found only 3/137 (2%), too weak to justify a distinct native method. **No separate evaluation method was built for this group; it uses the same escrow-delivery lens as everything else.**

### Content & Community (1,104 registered) / Payments & Infrastructure (571 registered)
Also genuinely mixed, not uniform. Content & Community: stockanalyst-agent and OptimAI Search Provider compatible; three `bitagent.io` micro-agents (Doc Digest, Brand Kit, Mood Check), SentryFin, and AIDA incompatible. Payments & Infrastructure: only 7 distinct agents are currently reachable out of 571 registered; 2/7 compatible (2U2.ai Content Agent, and the explainer agent itself), 5/7 incompatible.

One further nuance found here: **Q402 Agent** (`q402.quackai.ai`) tested escrow-incompatible (HTTP 405 on the A2A probe), but a direct GET against its plain endpoint returns a live 200 JSON response (`{"facilitator": "0x..."}`); this is a genuinely functioning payment-relay service, just one that speaks a different protocol (its path shape strongly suggests x402/HTTP-402-style relay, not ERC-8183/A2A), not a dead SaaS wrapper like AIDA. Practically the outcome for this marketplace is the same either way (can't be hired through our escrow), and the existing UI copy ("doesn't appear to operate through Tnega's on-chain escrow system") was already worded neutrally enough to not misrepresent this. No code change was needed to keep that accurate, but it's worth recording as a distinct case: "speaks a different protocol" and "speaks no protocol at all" are different situations that happen to need the same UI treatment here.

## The resulting design: two axes, not five bespoke methods

The investigation's own results argue against the original framing. Every category group contains **both** escrow-compatible and SaaS-incompatible agents; there is no clean category boundary to hang a bespoke evaluation method on. What actually varies by category, going purely off what was found:

**Axis 1, per agent, not per category: escrow-compatible vs SaaS/off-chain-incompatible.** Already built (`core/protocol_compat.py`). This is what actually determines:
- The **native evaluation lens**: escrow-compatible agents are evaluated by on-chain job-delivery history (the existing four verification tiers, Past Hires, Revenue Stream). SaaS-incompatible agents are structurally incapable of producing that history; for them, the existing reachability signal (`ServiceHealthBadge`, already built on `core/agent_health.py`) is the appropriate lens, not a "0 hires" reading that looks like failure.
- The **primary call-to-action**: "Hire Agent" for escrow-compatible agents; "Visit Website" (the agent's own disclosed link, never fabricated) for SaaS-incompatible ones, with hiring anyway still available, de-emphasized, never hidden.

**Axis 2, per category group, enrichment only, never gating the basic evaluation above:** the only category group with evidence supporting a genuinely distinct, additional evaluation surface is **Trading & DeFi**; on-chain fund performance (PnL, Historical On-chain Performance, canary testing) is a coherent question only where an agent might actually manage funds. Every other group's agents, once split by axis 1, are evaluated the same way; the investigation above found no evidence to justify inventing a bespoke method for Content & Community, Payments & Infrastructure, or Security & Trust individually.

## What shipped

- `frontend/src/agentEvaluation.js`: the shared, two-axis logic above as one small, testable module (native method, primary CTA, which enrichment panels apply), the single source of truth both web and mobile read from. Unchanged since this investigation; still the logic behind everything below.
- `frontend/src/AgentEvaluationSection.jsx` (2026-08-28): replaced the previously separate, inconsistently-shown "Hire this agent" button + `EscrowCompatibilityNotice` warning with one coherent block: the native-method explanation, the one correct primary CTA, and (for incompatible agents) the evidence plus a de-emphasized "hire anyway" fallback.
- **Superseded the same day by `frontend/src/AgentMetrics.jsx`**: the further consolidation with `AgentInvestigationSection.jsx` described in [Agent Metrics](agent-metrics.md); `AgentEvaluationSection.jsx` and `AgentInvestigationSection.jsx` no longer exist as separate files, folded into `AgentMetrics.jsx`'s own unified presentation. The two-axis logic this page describes is unchanged; only the presentation layer moved.
- The financial enrichment panels this page originally pointed to as already-built standalone components (`PnLPanel.jsx`, `OnchainPerformancePanel.jsx`, `RevenueStreamPanel.jsx`) are no longer what's actually wired in; `AgentMetrics.jsx`'s own `DeliveryRecord`/`FinancialTrackRecord` fetch the same endpoints (`/api/agents/revenue`, `/api/agents/pnl-summary`, `/api/agents/onchain-performance`) directly. Those three files still exist in the repo but are unreferenced; the current, complete description of what's shown lives in [Agent Metrics](agent-metrics.md), not here. The harder, last-chance funding-modal gate (`useHireFlowEscrowGate`) is separately unchanged by any of this, a different, still-necessary concern (safety at the moment money actually moves, not top-level presentation).
