# Hire-Flow Audit — ERC-8004/ERC-8183 vs. this codebase

A root-level audit of the entire hire flow — discovery → negotiate → fund → notify → delivery → settle/dispute/refund — checked directly against the real, authoritative ERC-8004 and ERC-8183 specification text (fetched from [eips.ethereum.org](https://eips.ethereum.org/EIPS/eip-8004) and [eip-8183](https://eips.ethereum.org/EIPS/eip-8183)), not just our own code's internal assumptions. Triggered directly by a real, confirmed incident: job #56659 was silently rejected because a piece of our own code gated a protocol step on an assumption about what a seller sends, instead of implementing what a real reference seller actually requires unconditionally (see [Known Limitations](limitations.md) for that original trace). This audit exists to hunt for the rest of that bug class systematically, not wait for the next one to surface by accident.

Two real, confirmed bugs of exactly that class were found and fixed. Both are documented in full below, alongside every step of the flow checked against the real spec, deliberate (non-bug) deviations, and genuine open questions the spec itself leaves unresolved.

## Method

1. Fetched the real ERC-8004 and ERC-8183 specification text directly (not a summary written from memory).
2. Read every real file in the hire flow end to end: `frontend/src/useHireAgent.js` (direct "Always Ask" path), `frontend/src/altana.js` + `AltanaSessionPanel.jsx` (Altana "Autonomous" session path), `frontend/src/erc8183Negotiate.js` + `backend/core/erc8183_negotiate.py` (the off-chain A2A layer), `frontend/src/erc8183.js` (ABIs/addresses), `frontend/src/useJobActions.js` + `JobStatusPanel.jsx` + `MyJobsPanel.jsx` (post-hire actions), and the installed `@altananetwork/sdk`'s own real source (`node_modules/@altananetwork/sdk/dist/erc8183.js`, `signOrder.js`).
3. Cross-checked against real reference implementations: `explainer-agent/seller_core.py` + `main.py` (our own seller), and `bnb-chain/stockanalyst-agent-demo`'s real `seller_core.py`/`notify_security.py` (fetched directly, not from memory).
4. Verified real, live on-chain state where it mattered (see [Evidence](#evidence) below) rather than trusting either the code's comments or the spec's illustrative text alone.

## Step-by-step: spec vs. implementation

| Step | What ERC-8004/ERC-8183 actually requires | What this codebase does | Match? |
|---|---|---|---|
| **Discovery / identity** | ERC-8004: agent = ERC-721 `agentId` in an Identity Registry; `agentURI` resolves to a JSON registration file with `services[]` endpoints. No required negotiate/commerce coupling. | Agents indexed from 8004scan's real registry read (`backend/core/agent_store.py`); `service_endpoint` resolved from the same real on-chain data, used for health checks and the A2A calls below. | ✅ Matches — this is the standard's own model, not a custom one. |
| **Negotiate** | **Not part of ERC-8183 at all.** The EIP's own text is explicit: *"No explicit A2A negotiation protocol… Negotiation is implicit (client and provider agree on provider/budget offline or via higher-layer mechanisms)."* | We implement a real, best-effort A2A `negotiate` call (`erc8183Negotiate.js`/`erc8183_negotiate.py`) against a per-seller convention (the `bnbagent-studio` reference template's own `negotiate` skill) — never assumed universal, always falls back cleanly if a seller doesn't support it. | ✅ Consistent with the spec's own silence — this is exactly the kind of "higher-layer mechanism" the EIP anticipates, correctly treated as optional/best-effort rather than standardized. |
| **createJob** | `createJob(provider, evaluator, expiredAt, description, hook?)` — *"SHALL revert if evaluator is zero or expiredAt is not in the future."* | Both hire paths always pass a real, non-zero evaluator (`contracts.router`) and a real future `expiredAt`, padded for the real on-chain `disputeWindow` (see the real job #56611 incident this padding fixed, `useHireAgent.js`'s own comment). | ✅ Matches, both paths. |
| **setProvider** | Optional — provider may be `address(0)` at creation, assigned later. | Both hire paths always set `provider` directly at `createJob` — never uses the deferred-assignment path. | ✅ A valid, simpler subset of the spec, not a violation. |
| **setBudget / fund** | `fund() SHALL revert if job.provider == address(0)`; *"SHALL transfer job.budget from client into escrow and set status to Funded."* Provider must be set before funding. | Both paths: `setBudget` → real ERC-20 `approve` (only if the existing allowance is short) → `fund`. Direct path reads the real settlement token's decimals live rather than assuming; never funds less than a negotiated price. | ✅ Matches. Minor note: the Altana session path hardcodes `$U`'s decimals as 18 rather than reading them live — see [Deliberate deviations](#deliberate-deviations-not-bugs). |
| **notify_funded** | **Not part of ERC-8183 either** — same "no off-chain protocol specified" note applies. | Real, best-effort A2A push telling a seller "I funded job X, please deliver" — necessary in practice because a strict seller's own background sweep (see `explainer-agent/seller_core.py`) only runs as a side effect of *another* buyer's notify landing first, so a job could otherwise sit funded forever. | ⚠️ **Confirmed missing entirely on the Altana session path — Bug #1, fixed. See below.** |
| **notify_funded authorization** | N/A — not standardized. | A real EIP-712 envelope some sellers (e.g. `stockanalyst-agent`) unconditionally require. **Already fixed earlier this session** (job #56659): the gate used to check for a `success_criteria` field no real seller sends; now attached unconditionally whenever a negotiation succeeded. | ✅ Fixed prior to this audit; re-verified here as still correct and extended to the session path where possible (see Bug #1). |
| **submit** | `submit(jobId, deliverable, optParams?)` — provider-only, sets status to Submitted. | Entirely seller-side (`explainer-agent/signing.py`'s `submit_result`) — not something buyer-side code touches. Buyer-side reads the real deliverable back via `getDeliverable`/`getErc8183DeliverableUrl` (on-chain event scan). | ✅ Correctly buyer-read-only; no buyer-side write attempted here. |
| **complete / settle** | `complete(jobId, reason, optParams?)` — evaluator-only, job must be Submitted, transfers escrow to the provider. The real deployed contracts here implement this as `EvaluatorRouter.settle(jobId, evidence)`. | Originally had zero call sites anywhere in the UI (Bug #2, first fix below); that first fix itself had a real, confirmed flaw, corrected in [Correction, 2026-08-27](#correction-2026-08-27--settle-has-no-early-approval-path-its-fully-permissionless-after-the-window). Real, decisive, live-verified fact (not inferred): `settle()` has **no early-approval path at all** — it reverts for every caller, including the real buyer, until the real 7-day dispute window has fully elapsed, and becomes callable by **literally anyone** the instant it has. | ⚠️ **Bug #2 fixed, then corrected — see below.** |
| **reject (evaluator path)** | Evaluator may reject while Funded/Submitted, refunding the client. | Implemented as `Policy.dispute(jobId)`, client-callable within the real on-chain dispute window; the contract enforces the window itself. | ✅ Matches. Real, honest caveat carried over from an earlier audit: build-verified only — no funded `SUBMITTED` job under a wallet we control has been available to test the write live. |
| **reject (client path, while Open)** | Client may reject/cancel a job it created but hasn't funded yet. | **Not exposed anywhere in the UI.** | ℹ️ Not a bug — never claimed as a feature in our docs, just an unused spec capability. Noted as a real, open gap, not fixed here (see [Open questions](#open-questions--judgment-calls)). |
| **claimRefund** | `claimRefund(jobId)` — anyone may call once a Funded or Submitted job's `expiredAt` has passed; reverts otherwise. Does **not** auto-transition on its own — confirmed via a real prior investigation (job #56596: `expiredAt` passed 12+ hours earlier, status still read `FUNDED`). | Both paths expose a real, contract-enforced claim-refund action, gated in the UI only on the real on-chain `expiredAt` check (never pre-guessed). | ✅ Matches. |

## Bugs found and fixed

### Bug #1 — Altana "Autonomous" session path never negotiated or notified at all

**Not** a case of "the notify_funded fix didn't propagate to the session path" — the session path never had *either* mechanism, from the day it was built.

**Before:** `hireAgentWithSession` (`altana.js`) called the installed SDK's `hireErc8183Agent` directly with a plain string (`task: \`Hire via Tnega (Altana session): ${agent.name}\``). Confirmed by reading the SDK's real installed source (`node_modules/@altananetwork/sdk/dist/erc8183.js`): `buildHireCalls()` writes that string to the on-chain `description` **verbatim** — the exact shape that permanently killed job #56636 on the direct path before `negotiate` existed there. The SDK's `hireErc8183Agent` only performs the five on-chain calls (createJob/registerJob/setBudget/approve/fund) and returns; there is no notify_funded step anywhere in it.

**Real consequence:** any strict ERC-8183 seller — including our own `explainer-agent` — would permanently reject every hire made through Autonomous mode, exactly like job #56636. Even a lenient seller would never receive a delivery trigger, relying entirely on its own background sweep (which, per `explainer-agent/seller_core.py`'s own docstring, only runs as a side effect of *another* buyer's notify landing first).

**Why this never surfaced as a real incident:** confirmed via `docs/limitations.md`'s own prior, honest finding — a full scan of every real ERC-8183 job this marketplace has ever processed found **zero** jobs matching the Altana session path's real hire signature. No real, complete hire has gone through this path yet. This was a live, waiting-to-happen bug, not a reported incident.

**After:** `hireAgentWithSession` now negotiates first (reusing the exact same `negotiateJob`/`buildJobDescription`/`negotiatedPriceRaw` used by the direct path — no new logic, no duplication) and calls `notifyFunded` right after the atomic on-chain batch confirms, mirroring the direct path's real sequence and its "never fund less than the negotiated price" rule.

**Real, honest limitation NOT fixed** (architectural, not a code bug): a seller requiring the *stricter* EIP-712-signed notify_funded **authorization** (not just a negotiated description) — e.g. `stockanalyst-agent` — verifies that signature with plain `ecrecover` against an EOA (confirmed directly from its real `notify_security.py`). An Altana session wallet is a passkey-controlled EIP-7702 smart account; its only typed-data signing method, `client.signOrderTypedData`, produces an **ERC-1271-wrapped** signature meant for an on-chain `isValidSignature()` call — which an off-chain `ecrecover` check can never validate. There is no raw EOA key this flow could sign with instead; that is the entire point of a passkey wallet. So `notifyFunded` is now sent on this path **without** an authorization envelope — safe for sellers that don't require one (same reasoning already verified for the direct path: our own `explainer-agent` never reads that field), but a seller that unconditionally requires one will still reject the notification on this specific path. This is a genuine capability gap between the two hire paths, not something a code change here can close, and is stated plainly rather than silently glossed over.

**Verification:** `npm run build` passes; a headless SSR load of both `AgentMarketplaceApp.web.jsx` and `.mobile.jsx` (which both import `AltanaSessionPanel.jsx` → `altana.js`) renders cleanly. Not independently tested against a real, live Autonomous-mode hire against a strict seller — no funded session wallet with $U was available during this audit — flagged honestly rather than claimed as "should work."

### Bug #2 — "Approve early" (settle) was never wired to any button, on either path

`docs/README.md` states plainly: *"The agent only gets paid once it delivers and the review window passes (**or you approve early**)."* That second clause described a real contract capability (`EvaluatorRouter.settle(jobId, evidence)`) that was **never actually reachable from the UI** on either hire path.

- `altana.js` already exported a correct `settleJob(wallet, signer, jobId, 'approve')` wrapper around the SDK's real `settleErc8183Job` — but grep confirmed it had **zero call sites** anywhere in `AltanaSessionPanel.jsx` or any other component. Dead code.
- The direct-wagmi path (`useJobActions.js`) had no equivalent function at all — only `disputeDirect` and `claimRefundDirect`.
- `JobStatusPanel.jsx` (shared by both paths) had no `onApprove` prop and no button for it.

**Real consequence:** a buyer satisfied with a delivered result had no way to release payment early through the product itself — only the passive path (wait out the full dispute window, uncontested) actually worked, contradicting the docs' own claim.

**After:**
- `useJobActions.js` gained `approveDirect(jobId)` — a real `router.settle(jobId, '0x')` call via the connected wagmi wallet, same eligibility discipline as the existing `claimRefundDirect` (the contract enforces real eligibility; nothing here pre-guesses it).
- `JobStatusPanel.jsx` gained an `onApprove` prop and a real "Looks good — release payment now" button, shown alongside the existing dispute button whenever a job is `SUBMITTED`, with honest copy that this is permanent and forecloses disputing.
- Wired into both real callers: `MyJobsPanel.jsx` (direct path → `approveDirect`) and `AltanaSessionPanel.jsx` (session path → `settleJob(wallet, wallet.signer, jobId, 'approve')`, the already-correct wrapper that just needed a caller).

**Verification (at the time):** `npm run build` passes; SSR load of both app entry points passes. Same honest caveat as the existing dispute button: build-verified only, not exercised against a real, live `SUBMITTED` job under a wallet we control (none was available during this audit).

**This fix turned out to be incomplete — see the correction directly below, filed the next day after a real user reported the button "stuck/non-functional."**

### Correction, 2026-08-27 — settle() has no early-approval path; it's fully permissionless after the window

A real user reported that both "Looks good — release payment now" and "This isn't right — dispute it" appeared stuck on a delivered job. Investigated with real, live `eth_call` simulations (no gas spent, no private key needed — a genuine dry-run against the real deployed contracts) from multiple different `from` addresses against real jobs on both sides of their real dispute window, rather than guessing:

```
settle() on job #56646 (SUBMITTED, still WITHIN its 7-day window):
  from job.client   → reverts (0x17be5b7b)
  from a random addr → reverts (0x17be5b7b)   ← IDENTICAL error, both callers

settle() on job #56620 (SUBMITTED, its window had genuinely elapsed):
  from job.client        → succeeds (no revert)
  from a random, totally unrelated addr → succeeds (no revert)
  from the provider itself → succeeds (no revert)

dispute() on job #56646 (within window):
  from job.client   → succeeds
  from a random addr → reverts (0x20dbc874)   ← a DIFFERENT error — real access control

dispute() on job #56620 (window elapsed):
  from job.client   → reverts (0x09dd1236)   ← a THIRD, different error — real timing gate
  from a random addr → reverts (0x20dbc874)  ← same access-control error as before
```

Two real, decisive, now-confirmed facts (previously either wrong or merely inferred):

1. **`settle()` has no early-approval path at all.** The Bug #2 fix's own premise — that a satisfied buyer could call it early to "skip the rest of the waiting period" — was **false**. The real contract reverts with the *exact same* error for the buyer and a random unrelated address alike, before the window elapses — this is a pure timing gate, not an access-control one. There is no way for anyone, including the original buyer, to release payment before the real 7-day window is up.
2. **`settle()` genuinely is fully permissionless once the window elapses** — confirmed, not inferred. The real, live `eth_call` from a completely unrelated, random address succeeded on a real, eligible job. This resolves the open question below in the "yes, genuinely permissionless" direction, with real evidence rather than a plausible guess.

`dispute()` is the mirror image, and was already working correctly: real, client-only (a different, distinct revert for any other caller), and only valid *within* the window (a third, distinct revert once it's elapsed, even for the real client).

**Real fix:** `jobTiming.js` gained `isPastDisputeWindow(job)`, and `JobStatusPanel.jsx` now gates both buttons on real, on-chain eligibility instead of just job status — the settle/"Settle now" button only ever renders once the window has genuinely passed (when it will actually succeed, for anyone), and the dispute button only while it's still genuinely valid (so it stops rendering once it would always revert, whether or not the button will still work — a job that's already past the window can no longer be disputed even by the real buyer). A new, honest, on-brand state — "The 7-day review window passed with no dispute — this job is now eligible for settlement... anyone can do it, not just you" — appears once genuinely eligible, and `docs/README.md`'s own claim was corrected to describe what's actually real (permissionless settlement after the window, not early approval).

**Real, deliberate scope decision, not silently dropped:** the user's request also raised offering a settle action to *any* visitor, not just the original buyer's own job list, and/or a background job we run to auto-settle eligible jobs. The connected-wallet-agnostic settle call (`useJobActions.js`'s `approveDirect`) already works for any caller today wherever it's wired up — the gap is that no page currently lets a third party (who isn't the buyer) look up an arbitrary job to act on it, and a backend-run auto-settler would mean this project's own backend holding and spending from a real signing wallet, a genuine security posture change this project has deliberately avoided elsewhere (see this doc's own "no custom trust assumptions" framing). Neither was built in this pass; both are real, honest, flagged opportunities, not something quietly skipped.

## Deliberate deviations (not bugs)

- **`$U` decimals hardcoded as 18 in the Altana session path.** The direct path (`useHireAgent.js`) reads the real settlement token's `decimals()` live before every hire, never assuming. The Altana session path (`altana.js`, both before and after this audit's fix) hardcodes `1e18` for its budget conversion. `$U`'s 18 decimals are independently confirmed on-chain (`docs/smart-contracts.md`), so this is behaviorally correct today, not a live bug — but it is a real inconsistency in defensiveness between the two paths, left as-is here rather than adding an extra RPC read into an intentionally atomic, single-relay-intent session batch. Worth revisiting only if the settlement token itself ever changed.
- **`settle`/`dispute` naming vs. the EIP's illustrative `complete`/`reject`.** The real deployed BSC contracts implement the spec's abstract "evaluator completes/rejects" behavior via `EvaluatorRouter.settle()` (silence, after the real window elapses → pay the provider, permissionlessly — see the [2026-08-27 correction](#correction-2026-08-27--settle-has-no-early-approval-path-its-fully-permissionless-after-the-window) above for why this is NOT an early-approval path) and `OptimisticPolicy.dispute()` (client contests within the window → refund). This is the real, deployed implementation's own naming choice, not something this codebase introduced or could change.
- **`jobs()` vs. `getJob()`.** Our own `erc8183.js` (extracted from the `bnbagent` SDK's own ABI files) reads job state via a `jobs(uint256)` call; the installed Altana SDK's `erc8183.js` reads the same state via an explicit `getJob(uint256)`. Both are plausible, real getters for the same struct (an auto-generated public-mapping getter alongside a hand-written convenience view), each verified against its own real upstream source — not chased further here since both call sites are already independently working in production; flagged as an observation, not a defect.
- **No client-side "reject while Open" (cancel before funding).** A real spec capability neither hire path exposes. Not a bug — this was never claimed as a feature anywhere in this project's own docs — just an unused piece of the standard, noted for completeness.

## Open questions / judgment calls

- **The A2A layer (negotiate, notify_funded, and any authorization convention) is entirely unstandardized.** The ERC-8183 spec text is explicit that it defines none of this. Every assumption this codebase makes about what a seller expects is necessarily built from observed reference-implementation behavior, not a spec to conform to — which is the deep root cause of the whole "authorization-gate" bug class (job #56659, and Bug #1 above). The corrected posture, applied consistently now in both hire paths: **attach whatever real signal is available whenever the means to build it exist, rather than gating on a guess about what the counterparty specifically announced it needs.** There is no way to make this fully "correct" against a spec that deliberately leaves it open — only more consistently defensive.
- ~~Whether `settle()` is fully permissionless or requires the caller to be `job.client` specifically.~~ **Resolved, 2026-08-27 — see the correction above.** Confirmed live, not inferred: fully permissionless once the real dispute window has elapsed (any address succeeds); reverts identically for every caller, including the real client, before that point (a pure timing gate, no early-approval path exists at all).
- **A genuine, real risk worth flagging prominently, discovered while investigating Bug #2 — out of this audit's code-fixing scope, but directly adjacent to it:** our own `explainer-agent`'s real `settle` action is **operator-driven, not automated** — confirmed directly from its own `main.py`: *"`settle` (claim payment after the dispute window) is operator-driven — run `bag erc8183 settle <job_id>`; it is deliberately NOT an A2A skill."* The ERC-8183 spec's own state table lists `Submitted → Expired` (via `claimRefund()`, buyer-callable) as a real transition once the job's overall `expiredAt` passes — meaning if a real, legitimately-delivered, uncontested job's settlement is never manually run by an operator before the *overall* deadline (not just the dispute window) lapses, the buyer could technically reclaim funds for work that was genuinely delivered. This is a real, live operational dependency, not something a marketplace-side code fix can fully close on its own — but the [2026-08-27 correction](#correction-2026-08-27--settle-has-no-early-approval-path-its-fully-permissionless-after-the-window) above meaningfully mitigates it for jobs hired through this product specifically: since settlement is now confirmed genuinely permissionless, the correctly-gated "Settle now" button lets the real buyer (or, now that it's proven permissionless, anyone with the job id) settle on the operator's behalf the moment it's eligible, without waiting on a manual CLI run.

## Evidence

Real, live on-chain reads performed during this audit (BSC mainnet, via `https://bsc.rpc.blxrbdn.com`, this project's own confirmed-working RPC):

```
OptimisticPolicy.disputeWindow() = 604800 seconds (exactly 7 days)

job #56620: status=SUBMITTED  submittedAt=1787180195  expiredAt=1787788782
job #56646: status=SUBMITTED  submittedAt=1787568392  expiredAt=1788176712
job #56659: status=FUNDED     submittedAt=0            expiredAt=1788350663
job #1:     status=OPEN       submittedAt=0            expiredAt=1779446035
```

At the time of the original audit, neither #56620 nor #56646 had yet crossed its 7-day dispute window, so the original settle-gap finding (Bug #2) rested on the confirmed absence of any call site in the code, not a live stuck example. `explainer-agent/main.py`'s own settle-is-manual note (see [Open questions](#open-questions--judgment-calls)) is a direct read of its own source, not inferred.

By 2026-08-27, job #56620's real dispute window HAD elapsed (still genuinely unsettled — confirmed by re-reading its status: still `SUBMITTED`, not auto-transitioned), making a real, live permissionless-settlement test possible. Real `eth_call` simulations (BSC mainnet, same RPC, no gas spent, no private key needed — a genuine dry run against the real deployed contracts, simulate-able from ANY address without holding its key):

```
settle(56620, "0x") on EvaluatorRouter (0x51895229E12F9876011789B04f8698af06cCD6DA):
  from job.client (0x48ce74cdc366e8347f17f7187fbf2ab9240692e9)        → result 0x (succeeds)
  from a random, unrelated address (0x000...dEaD)                     → result 0x (succeeds)
  from the provider itself (0x08cef8b3ec5d33529dfe6700ccbffc97158cb5dd) → result 0x (succeeds)

settle(56646, "0x") — job #56646, still WITHIN its window at check time:
  from job.client        → execution reverted: 0x17be5b7b
  from a random address  → execution reverted: 0x17be5b7b   (identical error — a timing gate, not access control)

dispute(56646) on OptimisticPolicy (0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5) — within window:
  from job.client        → result 0x (succeeds)
  from a random address  → execution reverted: 0x20dbc874   (a DIFFERENT error — real, genuine access control)

dispute(56620) — window elapsed:
  from job.client        → execution reverted: 0x09dd1236   (a THIRD, distinct error — real timing gate, even for the real client)
  from a random address  → execution reverted: 0x20dbc874   (same access-control error as above)
```

This is the real, decisive evidence behind the [2026-08-27 correction](#correction-2026-08-27--settle-has-no-early-approval-path-its-fully-permissionless-after-the-window) above.

The incident that prompted this audit, for the record: job #56659 (hiring `stockanalyst-agent`) sat at "Payment on hold" for 1.5+ hours despite the agent's health check reporting online. Real backend log: `notify_funded not accepted: {'status':'rejected','job_id':56659,'reason':'authorization_required'}`. Root cause, confirmed by reading `stockanalyst-agent-demo`'s real `seller_core.py` directly: the authorization requirement is unconditional on the seller's side, not gated on any negotiated term — but `useHireAgent.js`'s own gate only attached the EIP-712 authorization when a negotiate response echoed back a specific `success_criteria` string this seller never sends. Fixed by attaching authorization unconditionally whenever a negotiation succeeded (see `frontend/src/useHireAgent.js`'s own inline comment for the full trace) — that fix is what this audit set out to generalize, and is the direct reason [Bug #1](#bug-1--altana-autonomous-session-path-never-negotiated-or-notified-at-all) above was worth hunting for specifically. This tier of finding (an agent responding to a health check is not proof it delivers real paid work) also directly shaped the marketplace's verification tiers — see [Features](features.md) and [Known Limitations](limitations.md#verified-working-is-real-but-a-small-minority--by-design-not-a-bug).
