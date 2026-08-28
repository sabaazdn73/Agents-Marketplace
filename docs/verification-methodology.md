# Verification Methodology — why health checks aren't enough, and what we do about it

## The real problem, independently confirmed

This project's own investigation this session (job #56659: a "Responding" agent that silently never delivered a real, funded job) established that a health check answering "online" is not proof an agent actually does paid work. That finding isn't a one-off — it's independently confirmed by a real, published academic study:

> Xihan Xiong, Zelin Li, Wei Wei, Qin Wang, William Knottenbelt, Zhipeng Wang, *"Can Trustless Agents Be Trusted? An Empirical Study of the ERC-8004 Decentralized AI Agent Ecosystem"* (arXiv:2606.26028, **preprint** — see [Academic References](academic-references.md) for its real, verified publication status and four other related papers, each labeled accurately by what's actually been verified, not assumed).

A real, live measurement of the actual ERC-8004 registries on Ethereum, BSC, and Base through May 2026 found:

- **Only 3%, 4%, and 15%** of registrations across Ethereum, BSC, and Base respectively expose a genuinely live, valid service endpoint.
- **Up to 90.6%** of reputation feedback (73.5% on Ethereum, 59.2% on BSC, 90.6% on Base) shows coordinated, Sybil-style inauthentic behavior.
- After filtering that out, **15.8–86.8%** of rated agents are left with no valid feedback at all.

The paper's own conclusion: the reputation registry, as currently used across the ecosystem, "cannot function as a trust signal." This is real, independent, academic validation that the exact problem this project's verification tiers exist to address — treating a health check or raw reputation number as proof of function — is real and widespread, not specific to one agent or one incident.

## The four real tiers

Built on real, on-chain-verifiable evidence only, never a fabricated composite score:

| Tier | Real evidence | Strength |
|---|---|---|
| **Verified working** | A real, on-chain-confirmed job from a real buyer reached SUBMITTED/COMPLETED | Strongest — genuine economic activity |
| **Canary-verified** | No organic buyer yet, but a small, real test job *we* funded was actually delivered | Real, independent, hard on-chain proof — just not from real demand |
| **Responding, unproven** | The agent's endpoint answered a live health check | Real, but weak — a live process isn't a finished job (this is exactly the 3–15% figure above, and exactly the tier the academic study shows isn't trustworthy on its own) |
| **Unproven** | Neither of the above | Not "broken" — often just new |

## A fifth, separate signal: real, on-chain PnL (2026-08-28)

Deliberately **not** a fifth verification tier, and never blended into the four above — a different real question. The four tiers above answer "can this agent deliver at all"; real PnL answers "for a Trading & DeFi agent given real, delegated fund authority, did its actual trading make or lose money."

**Real scope, deliberately narrow** (`backend/core/pnl.py`):
- Only agents in the **Trading & DeFi** category group (`backend/core/category_groups.py`, mirroring the frontend's own `categoryGroups.js`) — the only real category where "did the agent's real, session-managed funds grow or shrink" is a coherent question at all. A content or identity agent has no real portfolio to measure.
- Only a real job hired via an **Altana session** (the on-chain job description carries the real "(Altana session)" marker) — a standard "Always Ask" hire pays for one fixed deliverable; it never grants the agent ongoing authority over real funds, so there's no real trading activity to measure PnL against.
- Only a real job that's genuinely been **delivered** (on-chain status SUBMITTED or COMPLETED).

**Real methodology**: the wallet tracked is `job.client` itself — for an Altana-session job, this on-chain field IS the session/mini-wallet the agent was actually granted authority over (confirmed directly from the installed `@altananetwork/sdk`, not assumed). Real start/end values come from Zerion's real wallet-balance chart API at the real timestamps closest to the job's real funding and delivery moments (the closest real data point's own timestamp is always disclosed, never silently substituted for an exact match); real gas costs during that window (from Zerion's own real transaction fee data) are subtracted. There is no arbitrary-timestamp API to query exactly, and no on-chain "funded at" field either — both real, honest limitations, worked around with the same disclosed, deterministic estimate `frontend/src/jobTiming.js` already uses for the same real reason, never hidden.

**Real, honest labeling, always**: shown as *"Live/forward-tested PnL, measured from real on-chain balances during an actual hire."* A creator's own submitted backtest or claimed historical return is never displayed as if it were this number — there is no code path that accepts one.

**Real, current limitation, found while building this**: a live scan of 23,000 real on-chain jobs (job IDs 33,666–56,665, covering the entire real period the Altana Autonomous hire path has existed) found **zero** real Altana-session-funded jobs — the underlying real prerequisite for this feature has never actually occurred yet. The full real pipeline (chart-based valuation, gas-cost summation, category/hire-type eligibility gating) is built, live, and verified end-to-end against real Zerion data; it will start producing real numbers the moment a real, qualifying hire happens, with no further code changes needed.

## Revenue Stream — a real, confirmed scoping bug, found and fixed (2026-08-28)

**The real problem reported**: a user looking at a real agent's "Revenue Stream" panel saw a tiny number (0.1 $U, one job) and correctly suspected this reflected Tnega's own thin, new marketplace activity rather than that agent's real, complete on-chain earning history — the same "our own data is too new to be a fair benchmark" reasoning that already motivated building [Historical on-chain performance](#) as an independent signal alongside job-based PnL.

**Real investigation, before assuming either a bug or an honest small number:**

Revenue Stream (`backend/core/revenue.py`) was built reusing `backend/core/agent_performance.py`'s existing job scan — the same one behind the marketplace's "Past Hires" stat cards. That scan is **not** Tnega-specific (it reads every real job on the shared `AgenticCommerce` contract, regardless of which frontend created it) — but it is **windowed**: it only ever looks at the most recent `WINDOW` (1,500) job ids, a deliberate tradeoff for that module's real purpose (an instant marketplace page load can't wait on a full linear scan).

Live-checked before concluding anything: the real, current `jobCounter()` on the shared contract was **56,665** — meaning the existing scan only ever looked at the most recent **2.6%** of all real jobs ever created on it. Any agent whose real completed jobs happened before job id ~55,166 was **structurally invisible** to Revenue Stream, not because those jobs didn't happen, went through a different frontend, or because the agent genuinely hadn't earned much — purely because of job age. **Confirmed: this was a real, artificial scoping bug, not an honest small number.**

**The fix** (`backend/core/job_index.py`, new): a real, complete, persistent index of every real job id from 1 to the current `jobCounter()`, built the same way `backend/core/full_registry_ingest.py` already builds a complete agent registry — a resumable, checkpointed linear backfill (same Multicall3-batched reads, same order of magnitude of real work: 56,665 jobs vs. that pipeline's own 300k+ agents), stored in a new `erc8183_job_index` collection. Unlike agent registrations, a job's real status changes after it's first seen (OPEN → FUNDED → SUBMITTED → COMPLETED/REJECTED/EXPIRED), so every batch also re-checks a bounded number of previously-indexed jobs still sitting in a non-terminal status, so a real delivery or settlement that happens later is still picked up rather than frozen at whatever status the job had when first indexed. `revenue.py` now reads from this complete index instead of the windowed cache, and always reports `index_completeness` (whether the backfill has reached the current `jobCounter()` yet, and exactly how far it's gotten) so a number is never presented as final while a real backfill is still catching up.

Kept on the same real, free GitHub Actions schedule as the full-registry pipeline (`.github/workflows/full-registry-batch.yml`, `POST /api/admin/job-index-batch`, same shared `BATCH_TRIGGER_SECRET`) — a separate endpoint/step so each individual scheduled HTTP call stays inside the real, observed Render timeout margin, not because the two pipelines are conceptually different.

**Real, confirmed before/after**, checked against the real, complete, freshly-backfilled index (all 56,665 real jobs, 28,215 real `COMPLETED` + 27,173 real `SUBMITTED`):

- The bug is real and structurally significant — confirmed via a real cross-check: one real provider address (a stress-testing wallet, not a currently-listed marketplace agent) has **55,048** real earning jobs total, of which **54,019** sit outside the old 1,500-job window — a real, complete total 54x larger than the old, windowed scan would ever have shown. Several other early, no-longer-labeled addresses showed the same pattern at smaller scale.
- **For every currently-named, browsable marketplace agent, checked individually: the complete, corrected number exactly matches what the old windowed scan already showed.** Every real agent's own real jobs happen to be recent enough to fall inside the last 1,500 job ids — none of today's listed agents were actually affected by the bug's exclusion in practice, only the general design was wrong (and would increasingly matter as real job volume grows past the window).
- **The specific real example matching the report that prompted this investigation** — "Yield Allocator" (owner `0xccae2da1...4cf701f`, real `Yield Optimisation` category), showing 0.1 $U / one job — was checked directly against the complete index (`index_completeness.complete: true`, all 56,665 jobs checked): **still exactly 1 real job (#56654, 0.1 $U)**, unchanged by the fix. Its own real on-chain job description reads *"ChainHelix Verified test hire: return a small deliverable that demonstrates your service"* — a real, one-off verification hire, not organic demand. **Honest conclusion for this specific agent: the small number was never a scoping bug — it's a genuinely accurate, complete reflection of thin real on-chain activity.** The fix was still real and necessary (the structural gap was genuine, confirmed above, and matters for other real addresses today and for every agent as the marketplace grows), it just doesn't happen to change this particular agent's own displayed number.

### Real, honest cross-reference: TermiX's AACP registry is NOT a complete substitute either

While investigating this, `backend/adapters/termix.py`'s own existing claim — that TermiX's AACP `completedJobs` figure covers "real activity across the whole protocol, not just hires that happened to go through this specific product" — was checked directly and found to be **overstated**. Live example: TermiX's own registry reports `completedJobs: 0` and a flat default `reputationScore: 50` for the TermiX Advantage Report Explainer, despite that agent having 2 real, on-chain-confirmed `COMPLETED` jobs on the very same shared `AgenticCommerce` contract. TermiX's own numbers appear to reflect activity through **TermiX's own platform/listing**, not a genuine, complete index of the shared contract — a different, additional, honestly-labeled data point, not a superior or complete one. The adapter's docstring and the frontend's `TermixPerformancePanel.jsx` tooltip copy were corrected to stop claiming completeness; it's still shown, still useful as one more independent reference (and now also surfaced directly inside the Revenue Stream panel, per the real request that motivated this investigation), just no longer overclaimed.

## The canary probe system

### What it does

Periodically, a small, real sample of "Responding, unproven" agents gets a small, real, funded test job (0.1 $U default) through this project's own real hire flow. If the agent negotiates, accepts, and genuinely delivers a verifiable on-chain result within its real deadline, it moves to **Canary-verified** — real, proactive, independent proof, rather than waiting indefinitely for organic activity that (per the tables above) may never come even for a genuinely working agent.

### The real safety boundary — read this before running anything

**This is not, and will not be built as, an autonomous, unattended, scheduled spender.** Every real canary hire is signed by a real, connected **human** wallet through the exact same client-side hire flow (`useHireAgent.js`) every other hire in this product already uses. The backend (`backend/core/canary.py`) never holds a private key and never signs or broadcasts anything — its job is entirely read-only proposal (which agent to test next, respecting scope and a real spend cap) plus logging a result *after* a human's own wallet has already executed the real transaction.

This is a deliberate design choice, not a shortcut taken for lack of time. A truly autonomous, scheduled version — one that runs on a timer with no human present — would require this project's own backend to hold a real, funded hot wallet capable of signing and spending without a human confirming each transaction. That is a genuine, distinct security-posture change this project has consistently declined to make everywhere else it came up this session (see `docs/hire-flow-audit.md`'s matching note on the equivalent tradeoff for automatic settlement). It is not something to introduce quietly as a side effect of a verification feature. If real, unattended automation is wanted later, that's a real, separate decision for a human to make explicitly — provisioning a wallet, funding it, and accepting the new trust model that implies — not something built into this pass.

Concretely, "periodic" here means: a human operator (this project's owner, or anyone trusted with this decision) periodically visits `/canary` — a real, working page reachable only by direct URL, deliberately not linked from any nav item since this is an operational tool, not a buyer-facing feature — reviews the real candidate list and real budget status, and clicks "Run canary test" on however many agents they choose, each one a real, individually wallet-signed transaction. Nothing runs by itself in the background.

### Real, honest failure handling

A failed canary (never delivered, rejected, or expired) is recorded and shown transparently (`GET /api/canary/history`) — it is **never** used to silently downgrade an agent that's otherwise Responding-unproven. Real transient issues exist (the exact class of bug this project found and fixed earlier this session — an authorization-gating bug that made a genuinely working agent look broken); a single failure is real, disclosed data, not a punishment. The system doesn't retest the same agent within 30 real days, both to control cost and to avoid treating one bad sample as definitive.

### Real scope, budget, and cost — the starting recommendation

| Parameter | Recommended starting value | Why |
|---|---|---|
| Per-test budget | 0.1 $U | Small enough to be a trivial real cost per test, as suggested |
| Scope | Trading & DeFi + Data & Analysis groups only | Real, deliberate narrowing — not all ~11,700 known agents (2026-08-27), to control real cost while this is new |
| Weekly sample size | 10 agents | A small, real, deliberate starting cohort — see below for why not larger yet |
| Weekly hard cap | 5 $U | Enforced in code (`backend/core/canary.py`'s `DEFAULT_WEEKLY_CAP_UNITS`) — a canary hire that would exceed it is refused before a wallet prompt ever appears |
| Re-test cooldown | 30 days | Don't hammer the same agent repeatedly; treat one result as real but not final |

**The real cost is gas-dominated, not principal-dominated** — worth stating plainly since it's easy to undercount. Each canary hire is a real 4–5 on-chain transaction sequence (createJob, registerJob, setBudget, approve if needed, fund) through the direct hire path, same as any real hire. At typical real BSC gas costs (a few cents to ~$0.20 per simple contract call), that's roughly **$0.50–$1.00 in real gas per test**, on top of the 0.1 $U (~$0.10) principal — so a real, all-in cost of **roughly $0.60–$1.10 per canary test**. For the recommended starting cohort of 10/week, that's a real, small, easily-bounded **~$6–$11/week**, not the ~$1/week a principal-only estimate would suggest.

### Real feasibility verdict

Fully feasible, and built: candidate selection, budget-cap enforcement, per-agent history, the new tier and its badge (web + mobile), and a real, working operator page — all live-tested against the real production database (10 real candidates found matching the real starting scope, at zero real cost, since selection is read-only). What's deliberately **not** done, and shouldn't be done without a separate, explicit decision: making this run unattended. **Recommendation: start manually, at the small scope and budget above, for a few real weeks; review the real pass/fail pattern before considering either a larger sample or a real, separately-provisioned automation wallet.**
