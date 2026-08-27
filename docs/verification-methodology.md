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
| Scope | Trading & DeFi + Data & Analysis groups only | Real, deliberate narrowing — not all ~1,700 known agents, to control real cost while this is new |
| Weekly sample size | 10 agents | A small, real, deliberate starting cohort — see below for why not larger yet |
| Weekly hard cap | 5 $U | Enforced in code (`backend/core/canary.py`'s `DEFAULT_WEEKLY_CAP_UNITS`) — a canary hire that would exceed it is refused before a wallet prompt ever appears |
| Re-test cooldown | 30 days | Don't hammer the same agent repeatedly; treat one result as real but not final |

**The real cost is gas-dominated, not principal-dominated** — worth stating plainly since it's easy to undercount. Each canary hire is a real 4–5 on-chain transaction sequence (createJob, registerJob, setBudget, approve if needed, fund) through the direct hire path, same as any real hire. At typical real BSC gas costs (a few cents to ~$0.20 per simple contract call), that's roughly **$0.50–$1.00 in real gas per test**, on top of the 0.1 $U (~$0.10) principal — so a real, all-in cost of **roughly $0.60–$1.10 per canary test**. For the recommended starting cohort of 10/week, that's a real, small, easily-bounded **~$6–$11/week**, not the ~$1/week a principal-only estimate would suggest.

### Real feasibility verdict

Fully feasible, and built: candidate selection, budget-cap enforcement, per-agent history, the new tier and its badge (web + mobile), and a real, working operator page — all live-tested against the real production database (10 real candidates found matching the real starting scope, at zero real cost, since selection is read-only). What's deliberately **not** done, and shouldn't be done without a separate, explicit decision: making this run unattended. **Recommendation: start manually, at the small scope and budget above, for a few real weeks; review the real pass/fail pattern before considering either a larger sample or a real, separately-provisioned automation wallet.**
