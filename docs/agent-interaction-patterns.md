# Agent interaction patterns — a real, ground-up investigation (2026-08-28)

## Why this exists

Two real interaction-pattern distinctions had been added so far, each reactively, from a single real example that happened to surface: escrow-incompatible SaaS tools (from AIDA) and a passing FAQ note that hiring isn't agent-to-agent-only (from bnbagent). Neither came from a systematic look at the real, full dataset. This is that systematic look: every real category group (including Unclassified), every real registration style (individually-built vs mass-registered-template), real live probing of real endpoints — not descriptions read in isolation, and nothing built for a pattern without confirmed real examples behind it.

## Method

1. Censused the full real BSC dataset (`full_agent_registry`, chain_id 56 — **64,821 real agents**, the same pool the live marketplace diversifies from) by category, service reachability, and structured fields (`x402_supported`, `supported_protocols`) already present on each real 8004scan record.
2. Ran a full-corpus regex census (not a sample — every one of the 64,821 real descriptions) for ten hypothesized patterns explicitly named in the task: per-call/oracle payment, subscription/alerting, governance/DAO-delegation, vault/custodial deposit, session-key delegation beyond Altana, NFT/token-gated access, plus MCP as a structurally distinct protocol.
3. For the real, reachable population, mapped **every distinct real hosting domain** (not just a sample of agents) — 23 distinct domains cover all 22,921 currently-`responding` agents. Two of those 23 domains alone (`evoevo.ai`, `q402.quackai.ai`) account for 22,870 agents (99.8% of everything reachable) — both real, mass-registered platforms, not thousands of independent projects. That leaves a real, genuinely diverse long tail of exactly **51 individually-built agents across the other 21 domains** — small enough to read and probe in full, not by sample.
4. Live-probed a real, random 20-agent sample of the dominant `evoevo.ai` cluster, plus every ambiguous or previously-untested endpoint in the 51-agent long tail, using the existing multi-format A2A probe (`core/erc8183_negotiate.py`'s `probe_a2a_protocol` — the same real candidate-discovery and `data`/`text` part-shape retry the live hire flow itself depends on), not description text.

## What the full census found

### The dominant real fact: most of the marketplace has no live service to interact with at all

**41,900 of 64,821 real BSC agents (64.6%) have no `service_endpoint` on record at all** — pure on-chain identity registrations, nothing to probe, nothing to hire, nothing to visit. This is already handled correctly (`ServiceHealthBadge` / `service_status: "no_endpoint"`) — no design change needed, but it's the real, honest baseline every other number below should be read against: interaction-pattern nuance only ever matters for the remaining 35.4%.

### The second-dominant real fact: reachability is itself concentrated in two mass platforms

Of the 22,921 agents that **are** currently reachable, **21,458 (93.6%) are `evoevo.ai`** — a real, live-confirmed AI-persona/chat web platform (Next.js-rendered HTML profile pages at `/agent/detail?id=…`, not a JSON-RPC or A2A surface of any kind) — and **1,412 (6.2%) are `q402.quackai.ai`** — a real, shared payment-relay endpoint mass-registered by 1,749 distinct owner wallets pointing at the exact same 6 underlying real endpoints. Together these two platforms are **99.8% of every reachable agent** and, worked back through diversification, **43.4% of the entire live, curated marketplace** (`known_agents`: 6,275 of 14,441 real listed agents are `evoevo.ai` alone). This dwarfs the handful of anecdotal cases (AIDA, bnbagent) that motivated the original two ad-hoc categories — the SaaS/off-chain-incompatible pattern isn't a rare edge case, it's close to half of what a real visitor actually browses.

A real, live-random 20-agent sample of `evoevo.ai` came back **20/20 escrow-incompatible** (clean HTTP 405 on every real candidate+format) — confirmed, not assumed, at the scale that actually matters. `q402.quackai.ai` was already confirmed incompatible via the same probe in the prior category-evaluation.md investigation, reconfirmed here.

### The real, individually-built long tail: 51 agents, read and probed in full

Everything outside those two platforms — 51 real agents across 21 other real domains — was read individually (full description) and, for every previously-untested endpoint, live-probed. This is a full census of that population, not a sample. Real breakdown:

| Real pattern | Real count (of the 51) | Real examples |
|---|---|---|
| Escrow-compatible, works normally | ~30 | `agents.chainhelix.io` cluster, `agent.brainonbnb.com` cluster, `bnb-agent-market.vercel.app`'s RangeKeeper/GridRunner/HealthGuard, the `.../172-104-171-139.nip.io` cluster, most of `api.bortagent.xyz` |
| SaaS/off-chain, hard protocol rejection | ~6 | AIDA, Sentinels Prediction, Yield Compass / GridMaster Ops (Agent Studio hackathon `/launch` pages), `bnb-agent-market`'s YieldRouter |
| Different protocol (real, live, JSON API — just not A2A) | 1 confirmed here, plus the whole Q402 cluster above | Q402 relay (`{"facilitator": "0x…"}`) |
| Auth/credential-gated (real 401/403, not a protocol failure) | 2 | `mandaterebalance-agent` (documents its own real OAuth2 `client_credentials` grant), OptimAI Search Provider (403, no public credential path documented) |
| Genuine x402 pay-per-call, described as such by the agent itself | 3 reachable (+1 unreachable) | Rook Trading Intelligence (x402-primary, "72 x402 endpoints"), 2U2.ai Content Agent (dual x402 + job), stockanalyst-agent (dual ERC-8183 escrow + x402 async) |
| Real dev/test/throwaway registrations (technically live, not a real product) | ~9 | `api.bortagent.xyz`'s one-word entries ("premium", "ala", "alpha", "hook", "flap", "bort578", two "Untitled Agent"s, "deepliar") — all one real developer's own iteration, all technically escrow-compatible |

### Hypothesized patterns explicitly checked and honestly ruled out — zero or near-zero real evidence

Per the explicit instruction not to design for a hypothetical category without confirmed real examples, these were checked directly against the full real corpus and **not built for**:

- **Governance/DAO-delegation** — 28 real description matches, but reading every one: almost all are either the literal string `"…on Termix Platform"` with "DAO" only appearing as part of the agent's own brand name (e.g. `OmegaRock-DAO.agent`), or generic reasoning-persona boilerplate that discusses governance as a topic, never an agent that itself requires a token-delegation action. **Zero real agents found that actually require delegating governance tokens to interact with them.**
- **Vault/custodial deposit** — 32 real matches, same real shape: the word "Vault" is part of a mass-registered agent's own brand name (`Bond-Vault.agent`, `Synth-Vault.agent`, …, all `"…on Termix Platform"` with no other real description), not a description of a real deposit-required interaction. **Zero real agents found that require depositing funds into a vault/contract as their actual interaction model.**
- **Subscription/webhook/push-alert** — 1 real match platform-wide (broader and more thorough than the category-evaluation.md investigation's earlier 137-agent, single-group check, which also found this weak). **Not a real, distinct pattern in this dataset.**
- **NFT/token-gated access** — 0 real matches. **Not present.**
- **Session-key/delegation beyond the existing Altana flow** — 1 real match (`bnb-lp-quant.agent`, "runs…from client session keys"), and reading it, this describes exactly the Altana session pattern the marketplace **already supports** — a confirmation the existing flow covers it, not a gap.
- **MCP as a materially distinct interaction requirement** — 1,776 agents carry an `MCP` protocol tag, but tracing the real, distinct endpoints behind them: 1,412 are the already-covered Q402 relay, and the rest are agents (Singularry, BNB Lending Guardian, BNB Yield Optimizer, Sentinels Audit) that **also** speak A2A and are already escrow-compatible through the existing flow. No real agent was found where MCP was the only way in.

## The real, resulting design — three genuine additions, not a rebuild

The existing two-axis model (`docs/category-evaluation.md`) — escrow-compatible vs. SaaS-incompatible, decided per agent by a live protocol probe, category only ever gating which *extra* panels apply — was already structurally correct. This investigation found no real evidence for a different axis. What it found instead: **the existing binary was hiding two more real, distinct states inside it**, both with real (if smaller) evidence behind them, and one real prevalence correction big enough to change how the dominant case should be worded.

1. **Auth-gated is real, and was previously invisible.** `core/protocol_compat.py`'s probe already distinguishes a 401/403 from a hard rejection internally (`erc8183_negotiate.probe_a2a_protocol`'s `protocol_detected: None` + auth-gated evidence) — but `check_escrow_compatibility()` collapsed that straight into the same `escrow_incompatible: false` as a genuinely healthy agent. A user sees the exact same plain "Hire this agent" button for `mandaterebalance-agent` (which documents that it will silently never receive the automatic funded-notification without a credential this marketplace doesn't have) as for an agent that just works. New, additive field: `auth_gated: bool`. New UI treatment: a real, distinct amber caution — "Hire" stays the primary action (real evidence here is inconclusive, not a hard rejection — never silently reclassified as broken), but the buyer is told plainly, before funding, that this agent may not learn its job was funded without a credential this marketplace doesn't have.

2. **"Different protocol" and "no protocol at all" are both real, and were being said identically.** `q402.quackai.ai` is a real, live, functioning JSON API — just not one that speaks A2A — a structurally different, more honest story than `evoevo.ai`'s plain HTML profile pages or AIDA's marketing site. Distinguished with one more cheap, real signal: a plain GET against the endpoint, checked for a JSON vs. HTML `content-type` (confirmed live: AIDA and evoevo.ai both return `text/html`; Q402 returns `application/json`). New field: `different_protocol: bool`. New copy: "operates over a different protocol, not that it's unreachable or broken" instead of the generic "rejected every format we tried" — a real, more accurate story for this specific real sub-case, applied generally by what was actually observed rather than by naming any one platform in code.

3. **x402 as a genuine additional option is real, but rare — an additive note, not a new gate.** Only 3 real, live agents (plus one unreachable) describe x402 as part of their own real operation, confirmed by reading every one — this is not common enough to justify a new primary flow, and two of the three already work fine through the existing escrow path anyway (dual-mode). New field: `offers_x402_alternative: bool`, set from the agent's own description explicitly mentioning "x402" (a precise, zero-false-positive signal across the full real corpus — every real hit checked was a genuine, real x402 mention, no keyword-net guessing). New UI: a small, low-key supplementary note shown alongside whatever the primary action already is — never its own gate, never replacing "Hire" or "Visit Website".

4. **Real dev/test registrations were considered and deliberately NOT built for.** The `api.bortagent.xyz` one-word entries are real, but flagging "looks like a test agent" from a name/description alone is exactly the fragile, subjective keyword-net this project has repeatedly avoided elsewhere. The existing Delivery Record (0 real hires) already gives an honest, evidence-based signal for these — no new code.

5. **No design change for the 64.6%-of-everything "no service at all" state** — already correctly and honestly shown by the existing `ServiceHealthBadge`.

## What shipped

- `backend/core/protocol_compat.py` — `check_escrow_compatibility()` gained three new, additive real fields (`auth_gated`, `different_protocol`, `offers_x402_alternative`) alongside the existing `escrow_incompatible`/`evidence`/`external_link`, all computed from real, live evidence (the existing probe's own internal auth/rejection distinction, one new lightweight content-type GET, and a precise description-text check) — no existing field's meaning changed, nothing that reads only the old fields breaks.
- `frontend/src/agentEvaluation.js` — a new `PRIMARY_CTA.HIRE_CAUTION` state for auth-gated agents, and pass-through of `differentProtocol`/`offersX402Alternative` for the UI layer to render honestly.
- `frontend/src/AgentEvaluationSection.jsx` — a third, amber, non-blocking caution state for auth-gated agents (distinct from both the ordinary green "Hire" state and the red incompatible state); honest, evidence-specific copy swap for the different-protocol sub-case; a small x402 supplementary note shown wherever the real evidence supports it. Shared verbatim by web and mobile, same as before.
- `frontend/src/EscrowCompatibilityWarning.jsx` — `useHireFlowEscrowGate` (the last-chance funding-modal gate) gained the same real, non-blocking auth-gated caution, right before money actually moves — consistent with the explicit "default to the most cautious real action" instruction, without a hard checkbox gate on evidence this project has always treated as genuinely inconclusive rather than a confirmed failure.
