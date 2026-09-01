# Verification Methodology: why health checks aren't enough, and what we do about it

> For a single, complete, table-form reference of every metric/signal this platform uses anywhere in evaluation, verification, or presentation, name, what it measures, data source, and where it's shown, see [Agent Metrics: Complete metrics & signals inventory](agent-metrics.md#complete-metrics--signals-inventory-2026-08-30). This document stays the narrative explanation of *why* each of the core signals exists and how it was built; that table is the fast, scannable index.

## The problem, independently confirmed

This project's own investigation this session (job #56659: a "Responding" agent that silently never delivered a funded job) established that a health check answering "online" is not proof an agent actually does paid work. That finding isn't a one-off; it's independently confirmed by a published academic study:

> Xihan Xiong, Zelin Li, Wei Wei, Qin Wang, William Knottenbelt, Zhipeng Wang, *"Can Trustless Agents Be Trusted? An Empirical Study of the ERC-8004 Decentralized AI Agent Ecosystem"* (arXiv:2606.26028, **preprint**; see [Academic References](academic-references.md) for its verified publication status and four other related papers, each labeled accurately by what's actually been verified, not assumed).

A live measurement of the actual ERC-8004 registries on Ethereum, BSC, and Base through May 2026 found:

- **Only 3%, 4%, and 15%** of registrations across Ethereum, BSC, and Base respectively expose a genuinely live, valid service endpoint.
- **Up to 90.6%** of reputation feedback (73.5% on Ethereum, 59.2% on BSC, 90.6% on Base) shows coordinated, Sybil-style inauthentic behavior.
- After filtering that out, **15.8-86.8%** of rated agents are left with no valid feedback at all.

The paper's own conclusion: the reputation registry, as currently used across the ecosystem, "cannot function as a trust signal." This is independent, academic validation that the exact problem this project's verification tiers exist to address, treating a health check or raw reputation number as proof of function, is widespread, not specific to one agent or one incident.

## The four tiers

Built on on-chain-verifiable evidence only, never a fabricated composite score:

| Tier | Evidence | Strength |
|---|---|---|
| **Verified working** | An on-chain-confirmed job from a buyer reached SUBMITTED/COMPLETED | Strongest: genuine economic activity |
| **Canary-verified** | No organic buyer yet, but a small test job *we* funded was actually delivered | Independent, hard on-chain proof, just not from organic demand |
| **Responding, unproven** | The agent's endpoint answered a live health check | Weak: a live process isn't a finished job (this is exactly the 3-15% figure above, and exactly the tier the academic study shows isn't trustworthy on its own) |
| **Unproven** | Neither of the above | Not "broken," often just new |

## "Verified working": a scoping bug, found and fixed (2026-08-28)

**The question investigated**: after fixing Revenue Stream's WINDOW=1,500 scoping bug (see below), did the same bug also affect the "Verified working" tier itself? Was `getVerificationTier()` (`frontend/src/agentVerification.js`) actually reading the new, complete `job_index` data, or still the old, narrow scan?

**Traced the live code path, not assumed**: `getVerificationTier()` reads `agent.jobsCompleted`/`agent.jobsSubmitted`, set by `agentRanking.js`'s `withPerformance()`, sourced from `useAgentPerformanceBulk.js`, which calls `GET /api/agents/performance/bulk`. Confirmed live that this endpoint was still calling `core/agent_performance.py`'s own `get_all_agent_performance()`, the exact same `WINDOW=1,500`-bounded scan already fixed for Revenue Stream, never wired to `core/job_index.py`'s complete index. Confirmed: yes, this was a genuine gap.

**Fixed**: added `core/job_index.py`'s `get_provider_stats()`/`get_all_provider_stats()`, a MongoDB aggregation over the complete job index, the same return shape as the functions they replace (a deliberate, minimal-risk swap). `server.py`'s `/api/agents/performance` and `/api/agents/performance/bulk` now call these instead. `core/agent_performance.py` itself, and its other internal callers (`core/pnl.py`'s `recent_job_ids`, `core/canary.py`'s candidate selection), were left untouched, a separate, not-yet-made decision, not silently changed as a side effect here. The verification bar itself is unchanged: still requires an on-chain SUBMITTED/COMPLETED job. This was never about loosening the standard, only about which data the existing standard is checked against.

**Measured before/after, checked directly, not assumed**:
- Raw provider level (every address that's ever been a provider on the shared contract, listed in the marketplace or not): **48 to 60** verified providers (+12, a meaningful 25% increase, not noise). Cross-checked: **zero** providers were lost (every provider counted verified under the old window is still counted verified under the complete index), a strict expansion, not a discrepancy.
- **Currently-listed, named marketplace agents specifically: 12 to 12, unchanged.** Every one of the 12 newly-found providers turned out to be an old/historical address that isn't currently surfaced by the marketplace's own diversified listing (`known_agents`), so the fix is correct and necessary, but doesn't currently move any visible badge on the live site. (A number from an earlier point in this project's history put this figure around 17-18; not directly comparable to either count above, since the marketplace's own diversified listing reshuffles which specific agents are surfaced as job/agent volume grows, so some organic drift between snapshots is expected on its own, separate from this fix.)
- **Concentration, worth stating plainly for context on why this doesn't move the needle further**: of the shared contract's 56,665 jobs, only **90 distinct provider addresses** have ever been a provider on any of them, and just **one** address (`0xc0d7d888d8ff8925dc95fbb16c89217718bf7c8d`) accounts for 55,048 of the 55,388 SUBMITTED/COMPLETED ("earning") jobs system-wide, **99.4%** of all delivered-job volume. **A correction worth stating plainly (2026-08-28): this address was first described here as "a stress-testing wallet"; that was wrong, and investigated properly afterward rather than left standing.** Confirmed live: it's a genuine EOA (not a smart contract; `eth_getCode` returns empty, ruling out any shared Altana Keystore/session-relay contract explanation too), has never registered an agent identity of its own, and every one of its job descriptions links to `pieverse.io`/`purr.pieverse.io`, an independently-verified web3 AI agent platform (already referenced elsewhere in this project as the LLM gateway the explainer agent itself uses). The job data is unambiguous: **32,739 distinct client wallets**, a fixed **0.01 $U** price on 55,635 of the jobs, a natural retail-shaped repeat-purchase curve (23,292 one-time buyers down to a long tail of repeat buyers, not the shape a script would produce), over a bounded ~5-week window (2026-05-20 to 2026-06-23). This is genuine, organic commercial volume from a third-party platform's own shared "provider" wallet (very likely fulfilling something like a purchasable "agent self-intro card" feature), not centralization by one bad actor, not a leaked/shared default example wallet from BNB Agent Studio's own onboarding (checked directly: no public mention of this address anywhere, and Studio's own documented default behavior generates a fresh wallet per install rather than shipping one shared key), and not test traffic. A useful reminder that "the same provider address behind almost all activity" can mean a thriving product just as easily as it can mean noise, worth checking before assuming either.

## A fifth, separate signal: on-chain PnL (2026-08-28)

Deliberately **not** a fifth verification tier, and never blended into the four above; a different question. The four tiers above answer "can this agent deliver at all"; PnL answers "for a Trading & DeFi agent given delegated fund authority, did its actual trading make or lose money."

**Scope** (`backend/core/pnl.py`):
- Only agents in the **Trading & DeFi** category group (`backend/core/category_groups.py`, mirroring the frontend's own `categoryGroups.js`), the only category where "did the funding wallet's balance grow or shrink" is a coherent question at all. A content or identity agent has no portfolio to measure.
- Only a job that's genuinely been **delivered** (on-chain status SUBMITTED or COMPLETED).

**A deliberate simplification (2026-08-28, same day as the above), superseding what this section originally said**: eligibility used to also require the on-chain job description to carry the "(Altana session)" hire-flow marker, on the theory that only a session hire delegates ongoing fund authority worth measuring. A live scan of 23,000 on-chain jobs found **zero** Altana-session-funded jobs had ever happened, meaning that restriction made this feature structurally incapable of ever showing a number, for its entire existence. Checked directly before generalizing: `job.client` is an observable wallet address for **both** hire types; for a standard "Always Ask" hire it's simply the wallet that called `createJob`/funded the job (confirmed live against job #56654); for an Altana-session hire it's the session/mini-wallet the agent was granted authority over. The question answered is the same either way, did the wallet that funded this specific hire end up with more or less than it started with, so the Altana-session restriction was dropped; category and delivery status are now the only gates.

**Methodology**: the wallet tracked is `job.client` itself, whichever hire path was used. Start/end values come from Zerion's wallet-balance chart API at the timestamps closest to the job's funding and delivery moments (the closest data point's own timestamp is always disclosed, never silently substituted for an exact match); gas costs during that window (from Zerion's own transaction fee data) are subtracted. There is no arbitrary-timestamp API to query exactly, and no on-chain "funded at" field either, both genuine limitations, worked around with the same disclosed, deterministic estimate `frontend/src/jobTiming.js` already uses for the same reason, never hidden.

**Labeling, always shown plainly**: *"Live/forward-tested PnL, measured from on-chain balances during an actual hire."* A creator's own submitted backtest or claimed historical return is never displayed as if it were this number; there is no code path that accepts one.

**Current status (checked live, 2026-08-29)**: under the broadened scope, eligible, delivered Trading & DeFi jobs now genuinely exist: **7 distinct providers** in the current job index have at least one SUBMITTED/COMPLETED job. A sample of those didn't yet produce a computed number (each hit the same separately-documented "start-time estimate isn't chronologically sane for this job" gap; see [Agent Metrics](agent-metrics.md)'s own noted limitation), so a live PnL figure isn't guaranteed to show yet for any specific agent, but the earlier "zero qualifying jobs have ever existed" finding is no longer accurate; the underlying prerequisite for this feature is happening now, not hypothetically.

## Revenue Stream: a scoping bug, found and fixed (2026-08-28)

**The problem reported**: a user looking at an agent's "Revenue Stream" panel saw a tiny number (0.1 $U, one job) and correctly suspected this reflected Tnega's own thin, new marketplace activity rather than that agent's complete on-chain earning history, the same "our own data is too new to be a fair benchmark" reasoning that already motivated building [Historical on-chain performance](#) as an independent signal alongside job-based PnL.

**Investigated before assuming either a bug or a genuinely small number:**

Revenue Stream (`backend/core/revenue.py`) was built reusing `backend/core/agent_performance.py`'s existing job scan, the same one behind the marketplace's "Past Hires" stat cards. That scan is **not** Tnega-specific (it reads every job on the shared `AgenticCommerce` contract, regardless of which frontend created it), but it is **windowed**: it only ever looks at the most recent `WINDOW` (1,500) job ids, a deliberate tradeoff for that module's own purpose (an instant marketplace page load can't wait on a full linear scan).

Checked live before concluding anything: the current `jobCounter()` on the shared contract was **56,665**, meaning the existing scan only ever looked at the most recent **2.6%** of all jobs ever created on it. Any agent whose completed jobs happened before job id ~55,166 was **structurally invisible** to Revenue Stream, not because those jobs didn't happen, went through a different frontend, or because the agent genuinely hadn't earned much, purely because of job age. **Confirmed: this was an artificial scoping bug, not a genuinely small number.**

**The fix** (`backend/core/job_index.py`, new): a complete, persistent index of every job id from 1 to the current `jobCounter()`, built the same way `backend/core/full_registry_ingest.py` already builds a complete agent registry: a resumable, checkpointed linear backfill (same Multicall3-batched reads, same order of magnitude of work: 56,665 jobs vs. that pipeline's own 300k+ agents), stored in a new `erc8183_job_index` collection. Unlike agent registrations, a job's status changes after it's first seen (OPEN, FUNDED, SUBMITTED, COMPLETED/REJECTED/EXPIRED), so every batch also re-checks a bounded number of previously-indexed jobs still sitting in a non-terminal status, so a delivery or settlement that happens later is still picked up rather than frozen at whatever status the job had when first indexed. `revenue.py` now reads from this complete index instead of the windowed cache, and always reports `index_completeness` (whether the backfill has reached the current `jobCounter()` yet, and exactly how far it's gotten) so a number is never presented as final while a backfill is still catching up.

Kept on the same free GitHub Actions schedule as the full-registry pipeline (`.github/workflows/full-registry-batch.yml`, `POST /api/admin/job-index-batch`, same shared `BATCH_TRIGGER_SECRET`), a separate endpoint/step so each individual scheduled HTTP call stays inside the observed Render timeout margin, not because the two pipelines are conceptually different.

**Confirmed before/after**, checked against the complete, freshly-backfilled index (all 56,665 jobs, 28,215 `COMPLETED` + 27,173 `SUBMITTED`):

- The bug is structurally significant, confirmed via a cross-check: one provider address (`0xc0d7d888...`, a third-party platform's own shared wallet; see the corrected investigation below, not a currently-listed marketplace agent) has **55,048** earning jobs total, of which **54,019** sit outside the old 1,500-job window, a complete total 54x larger than the old, windowed scan would ever have shown. Several other early, no-longer-labeled addresses showed the same pattern at smaller scale.
- **For every currently-named, browsable marketplace agent, checked individually: the complete, corrected number exactly matches what the old windowed scan already showed.** Every agent's own jobs happen to be recent enough to fall inside the last 1,500 job ids; none of today's listed agents were actually affected by the bug's exclusion in practice, only the general design was wrong (and would increasingly matter as job volume grows past the window).
- **The specific example matching the report that prompted this investigation**, "Yield Allocator" (owner `0xccae2da1...4cf701f`, `Yield Optimisation` category), showing 0.1 $U / one job, was checked directly against the complete index (`index_completeness.complete: true`, all 56,665 jobs checked): **still exactly 1 job (#56654, 0.1 $U)**, unchanged by the fix. Its own on-chain job description reads *"ChainHelix Verified test hire: return a small deliverable that demonstrates your service"*, a one-off verification hire, not organic demand. **Conclusion for this specific agent: the small number was never a scoping bug; it's a genuinely accurate, complete reflection of thin on-chain activity.** The fix was still necessary (the structural gap was genuine, confirmed above, and matters for other addresses today and for every agent as the marketplace grows), it just doesn't happen to change this particular agent's own displayed number.

### Cross-reference: TermiX's AACP registry is NOT a complete substitute either

While investigating this, `backend/adapters/termix.py`'s own existing claim, that TermiX's AACP `completedJobs` figure covers "activity across the whole protocol, not just hires that happened to go through this specific product," was checked directly and found to be **overstated**. Live example: TermiX's own registry reports `completedJobs: 0` and a flat default `reputationScore: 50` for the TermiX Advantage Report Explainer, despite that agent having 2 on-chain-confirmed `COMPLETED` jobs on the very same shared `AgenticCommerce` contract. TermiX's own numbers appear to reflect activity through **TermiX's own platform/listing**, not a complete index of the shared contract: a different, additional, accurately-labeled data point, not a superior or complete one. The adapter's docstring and the frontend's `TermixPerformancePanel.jsx` tooltip copy were corrected to stop claiming completeness; it's still shown, still useful as one more independent reference (and now also surfaced directly inside the Revenue Stream panel, per the request that motivated this investigation), just no longer overclaimed.

## The canary probe system

### What it does

Periodically, a small sample of "Responding, unproven" agents gets a small, funded test job (0.1 $U default) through this project's own hire flow. If the agent negotiates, accepts, and genuinely delivers a verifiable on-chain result within its deadline, it moves to **Canary-verified**, proactive, independent proof, rather than waiting indefinitely for organic activity that (per the tables above) may never come even for a genuinely working agent.

### The safety boundary: read this before running anything

**This is not, and will not be built as, an autonomous, unattended, scheduled spender.** Every canary hire is signed by a connected **human** wallet through the exact same client-side hire flow (`useHireAgent.js`) every other hire in this product already uses. The backend (`backend/core/canary.py`) never holds a private key and never signs or broadcasts anything; its job is entirely read-only proposal (which agent to test next, respecting scope and a spend cap) plus logging a result *after* a human's own wallet has already executed the transaction.

This is a deliberate design choice, not a shortcut taken for lack of time. A truly autonomous, scheduled version, one that runs on a timer with no human present, would require this project's own backend to hold a funded hot wallet capable of signing and spending without a human confirming each transaction. That is a distinct security-posture change this project has consistently declined to make everywhere else it came up this session (see `docs/hire-flow-audit.md`'s matching note on the equivalent tradeoff for automatic settlement). It is not something to introduce quietly as a side effect of a verification feature. If unattended automation is wanted later, that's a separate decision for a human to make explicitly, provisioning a wallet, funding it, and accepting the new trust model that implies, not something built into this pass.

Concretely, "periodic" here means: a human operator (this project's owner, or anyone trusted with this decision) periodically visits `/canary`, a working page reachable only by direct URL, deliberately not linked from any nav item since this is an operational tool, not a buyer-facing feature, reviews the candidate list and budget status, and clicks "Run canary test" on however many agents they choose, each one an individually wallet-signed transaction. Nothing runs by itself in the background.

### Failure handling

A failed canary (never delivered, rejected, or expired) is recorded and shown transparently (`GET /api/canary/history`); it is **never** used to silently downgrade an agent that's otherwise Responding-unproven. Transient issues exist (the exact class of bug this project found and fixed earlier this session: an authorization-gating bug that made a genuinely working agent look broken); a single failure is disclosed data, not a punishment. The system doesn't retest the same agent within 30 days, both to control cost and to avoid treating one bad sample as definitive.

### Scope, budget, and cost: the starting recommendation

| Parameter | Recommended starting value | Why |
|---|---|---|
| Per-test budget | 0.1 $U | Small enough to be a trivial cost per test, as suggested |
| Scope | Trading & DeFi + Data & Analysis groups only | A deliberate narrowing, not all ~11,700 known agents (2026-08-27), to control cost while this is new |
| Weekly sample size | 10 agents | A small, deliberate starting cohort; see below for why not larger yet |
| Weekly hard cap | 5 $U | Enforced in code (`backend/core/canary.py`'s `DEFAULT_WEEKLY_CAP_UNITS`); a canary hire that would exceed it is refused before a wallet prompt ever appears |
| Re-test cooldown | 30 days | Don't hammer the same agent repeatedly; treat one result as informative but not final |

**The cost is gas-dominated, not principal-dominated**, worth stating plainly since it's easy to undercount. Each canary hire is a 4-5 on-chain transaction sequence (createJob, registerJob, setBudget, approve if needed, fund) through the direct hire path, same as any hire. At typical BSC gas costs (a few cents to ~$0.20 per simple contract call), that's roughly **$0.50-$1.00 in gas per test**, on top of the 0.1 $U (~$0.10) principal, so an all-in cost of **roughly $0.60-$1.10 per canary test**. For the recommended starting cohort of 10/week, that's a small, easily-bounded **~$6-$11/week**, not the ~$1/week a principal-only estimate would suggest.

### Feasibility verdict

Fully feasible, and built: candidate selection, budget-cap enforcement, per-agent history, the new tier and its badge (web + mobile), and a working operator page, all live-tested against the production database (10 candidates found matching the starting scope, at zero cost, since selection is read-only). What's deliberately **not** done, and shouldn't be done without a separate, explicit decision: making this run unattended. **Recommendation: start manually, at the small scope and budget above, for a few weeks; review the pass/fail pattern before considering either a larger sample or a separately-provisioned automation wallet.**
