# Agent Investigation — the unified redesign (2026-08-28)

> This page is a dated investigation record. `AgentInvestigationSection.jsx` described below was itself folded into `frontend/src/AgentMetrics.jsx` the same day, alongside `AgentEvaluationSection.jsx` — see [Agent Metrics](agent-metrics.md) for the current, live component and presentation. The four-parameter design and real data sources this page describes are still accurate; only the file/component name changed.

## The real problems this fixes

1. **False "our data vs. blockchain data" framing.** Every real signal built this session — job history, PnL, revenue, on-chain performance, TermiX cross-reference — ultimately reads from the same real blockchain, either directly (RPC) or via a real indexer (Zerion, 8004scan, TermiX). There was never a meaningful "Tnega's own data" vs "real blockchain data" distinction to draw; several panels' own copy implied one anyway. That framing has been removed from every panel's user-facing text and code comments — what differs between signals is *which* real on-chain question each one answers, never how "real" its source is.
2. **Fragmentation.** PnL, Revenue Stream, On-chain Performance, TermiX cross-reference, and the verification-tier stats were six separately-bordered, separately-captioned panels stacked on an agent's detail page, each with its own loading/error state. Consolidated into one system.

## The real, final design: four parameters, not six panels

**Agent Investigation** (`frontend/src/AgentInvestigationSection.jsx`, shared verbatim by web and mobile) — one card, four clearly-labeled groups:

| Parameter | Real question it answers | Real data source |
|---|---|---|
| **Delivery Record** | Has this agent actually delivered real, paid work, and how much has it earned doing so? | `core/job_index.py`'s complete ERC-8183 job index (`/api/agents/performance`, `/api/agents/revenue`) |
| **Financial Track Record** | (Trading & DeFi only) Did a real hire's own funding wallet end up ahead or behind? | `core/pnl.py`, real job.client wallet balance before vs. after (primary); `core/onchain_pnl.py`'s independent on-chain execution history, opt-in, secondary |
| **Independent Corroboration** | What does a source outside this marketplace say about this agent? | TermiX's own AACP registry (primary); full real wallet portfolio and complete on-chain history, opt-in |
| **Live Status** | Is this agent reachable right now, and does it speak this marketplace's real escrow protocol? | `ServiceHealthBadge` (agent_health.py) + escrow-compatibility (`protocol_compat.py`) |

Nothing underlying was rebuilt from scratch — every real endpoint this reads already existed and was already independently verified earlier this session. This is a presentation-layer consolidation, not a new data pipeline.

## Real PnL simplification

`core/pnl.py` used to require a job's on-chain description to carry the "(Altana session)" hire-flow marker — on the theory that only a session hire delegates real, ongoing fund authority worth measuring. Real, honest finding that motivated dropping this: a live scan of 23,000 real jobs found **zero** real Altana-session-funded jobs had ever happened — the feature had been completely dormant since it shipped, structurally incapable of ever showing a real number.

Checked directly before generalizing: `job.client` is a real, observable wallet address for *both* real hire types — for a standard "Always Ask" hire it's simply the real wallet that called `createJob`/funded the job (confirmed live against a real job, #56654); for an Altana-session hire it's the real session wallet. The real question — did the wallet that funded this hire end up with more or less than it started with — is coherent either way. The Altana-session restriction is now dropped; category (Trading & DeFi only) remains the sole real gate, since that's the only real category where the question is coherent at all (hiring a content-writing agent for a fixed fee isn't a PnL question — the buyer's balance drops by exactly the fee, that's just paying for a service).

## Real, always-fresh loading pattern

`frontend/src/useResilientFetch.js` — a shared hook applied throughout Agent Investigation: serves the last known-good real result instantly from a session-local cache on every mount, refreshes silently in the background, and retries with real, capped exponential backoff (up to 4 attempts) before ever surfacing an error — the same confirmedFresh discipline the marketplace's own agent list already has server-side (`server.py`'s `_cache`/`_background_refresh`). An error state is only ever shown on a real key's very first-ever fetch, after real retries are exhausted with nothing cached yet to fall back to.

## Real Live Status reliability fix

Found while reviewing this: the marketplace's own service-health check previously only ran as a side effect of the much heavier, real full-registry-backed marketplace refresh — the exact same path this session confirmed repeatedly OOM-crashes under real memory pressure (see the aggregate.py fix commits). When that heavier refresh failed partway through, health-check data silently went stale right along with it. Decoupled: a new, independent, bounded endpoint (`POST /api/admin/health-check-batch`, `core/agent_health.py`'s `check_agents_health` gained a real `limit` parameter — found live to be genuinely unbounded before this, a real risk in its own right if a large share of the store were stale at once) runs on the same 6-hour GitHub Actions schedule as a third step, keeping Live Status fresh regardless of whether the heavier refresh succeeds that cycle.

## Real, honest scope note

The category-aware evaluation framework (`docs/category-evaluation.md`) and its SaaS/off-chain-incompatible redirect behavior (`AgentEvaluationSection.jsx`) were reviewed as part of this redesign and left structurally unchanged — already a real, prominent, primary-CTA-level warning (a red banner + the real external link as the primary action + a de-emphasized "hire anyway" fallback), consistent with the money-safety priority this redesign reinforces rather than replaces.
