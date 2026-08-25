# Tnega — Documentation

The single, current, honest reference for how this project fits together, what's
real, and what isn't. Where this and the older "Partner-track alignment" list in
`README.md` disagree, **this file is authoritative** (it was written after the
work it describes was actually tested).

Last verified: 2026-08-14, against the live backend and live contracts.

---

## 1. In one plain-language paragraph (zero crypto background needed)

People build useful little AI helpers ("agents") — a trading strategy, a research
routine, a summarizer. Today there's no simple, trustworthy way to *sell access*
to your own agent and get paid, without middlemen holding your money. This project
is a marketplace where a creator lists an agent **they own**, picks how buyers pay
(pay once, subscribe, or pay-per-use), and the payment is handled by a public
program on the blockchain — the buyer's money is only released to the creator on
the agreed terms, and the platform can never touch already-settled funds. A buyer
can pick which currency to pay in from a fixed short list. There's also a free
"practice mode" so anyone can try an agent's skills with fake money before spending
anything real.

---

## 2. Architecture — how the pieces connect

```
  Browser (React SPA: web + mobile builds)
    │  - wallet: Altana passkey wallet (Face ID / WebAuthn) OR wagmi/RainbowKit + Privy
    │  - ALL signing is client-side; no key ever leaves the browser
    │
    ├─(HTTPS)─▶ Backend API  (FastAPI, Render web service)
    │             https://agents-marketplace-q3k4.onrender.com
    │             - GET /api/agents          → aggregates 8004scan + DefiLlama + owner BNB
    │                                           balances, de-dupes campaigns, serves the store
    │             - GET /api/agents/performance→ real ERC-8183 on-chain job outcomes (Multicall3)
    │             - practice/* endpoints       → proxy + record for the practice fork
    │             - build/*                    → BNB Agent Studio "bag" pipeline
    │                    │
    │                    ├─▶ MongoDB Atlas   (known_agents store + practice_runs history)
    │                    │
    │                    └─▶ Practice fork    (Render Docker web service)
    │                          https://anvil-practice-fork.onrender.com
    │                          - Anvil forks live BSC mainnet, bound to 127.0.0.1
    │                          - gateway.py = public method-filtered door
    │                            + authenticated /admin/rpc (funding)
    │
    └─(direct JSON-RPC / SDK)─▶ BSC mainnet (chain 56)
                                 - ERC-8004 identity registry (agent identity)
                                 - ERC-8183 AgenticCommerce (hire/escrow)
                                 - AgentAccessMarket (this project's "Sell Your Agent" contract)
                                 - PancakeSwap / Venus / Aave / Lista / four.meme (skills)
```

Key principle: **reads flow through the backend; value-moving writes are signed in
the browser.** The backend holds no private keys. The practice fork's admin powers
(funding) sit behind a shared-secret door only the backend knows.

---

## 3. Contracts & real addresses (BSC mainnet, chain 56)

| Thing | Address | Role |
|---|---|---|
| **AgentAccessMarket** | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | This project's "Sell Your Agent" settlement contract. **Deployed + BscScan-verified this session.** |
| ERC-8004 identity registry ("AgentIdentity") | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | Every agent's on-chain identity (ERC-721). We read `ownerOf` to authorize listings. |
| ERC-8183 AgenticCommerce | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` | The hire/escrow kernel used by the "Hire" flow. |
| `$U` (United Stables) | `0xcE24439F2D9C6a2289F741120FE202248B666666` | Binance's stablecoin (18 dp). ERC-8183's payment token; accepted by AgentAccessMarket. |
| USDT (BSC-USD) | `0x55d398326f99059fF775485246999027B3197955` | Accepted by AgentAccessMarket. |
| Native BNB sentinel | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` | Represents native BNB in the whitelist (paid via `msg.value`). |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | Used to read the ERC-8183 job window in one call. |

### AgentAccessMarket — what it does
Creators sell **access** to an agent they own (the ERC-8004 identity token is
**never transferred**, so the agent keeps its identity). Access is a
non-transferable entitlement recorded as `accessExpiry[agentId][buyer]`. Three
pricing models:

1. **One-time license** — `buyOneTime(agentId, token)` → permanent access.
2. **Subscription** — `subscribe(agentId, token)` → access until an expiry,
   renewable (early renew extends; late renew restarts).
3. **Pay-per-call (x402)** — settles *off* this contract via the x402 rail
   (per-HTTP-call, straight to the creator); configured in the UI, not on-chain.

**Multi-token, fixed whitelist, no swap:** native BNB + USDT + `$U`. A creator can
price the same agent in several tokens (one offer per `(agentId, token)`); the
**buyer picks** which token. No swap logic = zero slippage/MEV risk.

**Security:** OpenZeppelin `Ownable2Step` / `ReentrancyGuard` / `SafeERC20`;
pull-over-push payouts per token; platform fee read from `feeBps` (owner-tunable,
hard-capped at 10%, future-only); `feeWallet` from an env var at deploy; `list()`
gated by the real registry `ownerOf`; no admin path can move settled funds. Fee
currently **2.5%** (read live on-chain by the UI).

### ERC-8004 / ERC-8183 flow (the "Hire" path, distinct from AgentAccessMarket)
- **ERC-8004** = identity. Each agent is an ERC-721 in the registry with a
  discoverable profile. We read it for identity, ownership, and (via 8004scan)
  reputation/score.
- **ERC-8183** = commerce/escrow. Hiring creates a real job: `createJob →
  registerJob → setBudget → approve $U → fund`, all wallet-signed client-side, then
  the provider submits a deliverable, and settlement releases escrow (or the client
  disputes within the window, or reclaims via `claimRefund` after expiry).
- Per-agent "Real Hire Performance" on the detail page reads these jobs on-chain
  (scanning the most recent 1,500 via Multicall3) and reports real completion stats
  — or an honest "not yet hired" when none exist.

---

## 4. API endpoints (live audit, 2026-08-14)

All 11 routes in `backend/server.py`, tested against the live backend with real
requests. Full pass/fail table is in **[§6 Verified vs not](#6-verified-this-session-vs-built-but-not-live-verified)**.
The only failure is `/api/practice/fund` (a config mismatch, not a code bug).

---

## 5. What problem this solves (a bit more, still plain)

- **For creators / freelancers:** turn your own expertise or strategy into an agent
  (described in plain English — no code) and sell access to *your own clients* under
  a pricing model you choose, with the money handled by neutral on-chain rules.
- **For buyers:** discover and hire agents, try skills risk-free in practice mode,
  pay in the currency you prefer, and see exactly what fee the platform takes
  (shown live, read from the contract).

---

## 6. Verified this session vs built-but-not-live-verified

Pulled honestly from what was actually run, not intentions.

### ✅ Verified working (real requests / real chain / real DB)
- **AgentAccessMarket**: deployed to BSC mainnet (`0x9dbA8EbB…1333`), **BscScan
  source-verified**, 12 fork tests passing across all three tokens (one-time,
  subscription, buyer token-choice, native-value guards, whitelist enforcement).
  On-chain reads confirmed live (owner, feeWallet, feeBps=250, all three tokens
  accepted). A scripted deploy+purchase on the Anvil fork showed the correct
  97.5%/2.5% split.
- **Live API endpoints** (10 of 11 fully pass):

  | Endpoint | Method | Result | Notes |
  |---|---|---|---|
  | `/api/health` | GET | ✅ 200 `{"ok":true}` | Ops liveness probe; not called by the frontend (not dead). |
  | `/api/agents` | GET | ✅ 200, 87 agents | **Fixed 2026-08-17**: was blocking the response on the full live 8004scan refresh (~65-90s cold, measured). Now always serves instantly from the known_agents store/in-memory cache (measured: ~1.0s on a freshly-deployed instance with a cold in-memory cache); the live refresh runs as a background task instead. |
  | `/api/agents/performance` | GET | ✅ 200 | Real ERC-8183 on-chain read (job_counter ~56,592). |
  | `/api/practice/stats` | GET | ✅ 200 | Real Mongo aggregation (7 runs, 6 skills). |
  | `/api/practice/history/{wallet}` | GET | ✅ 200 | Real persisted rows. |
  | `/api/practice/init` | POST | ✅ 200 | chain 56, live block; first call after idle → cold-start 502 then works. |
  | `/api/practice/rpc` | POST | ✅ 200 / ✅ 403 | `eth_chainId`→`0x38`; blocked `anvil_setBalance`→403 (allow-list works). |
  | `/api/practice/record` | POST | ✅ 200 | Verified write→read round-trip (test row written + deleted). |
  | `/api/build` | POST | ✅ 200 | Returns a slug; pipeline advances to `scaffolding`. |
  | `/api/build/{slug}/status` | GET | ✅ 200 / ✅ 404 | Real step; unknown slug → 404. |
  | `/api/practice/fund` | POST | ❌ **502** | See gap below. |

- **Practice-layer skill executions** (real, on the Anvil fork, in MongoDB): 7 runs
  across `venus-lending`, `aave-v3-lending`, `lista-staking`, `pancakeswap-liquidity`,
  `pancakeswap-trading`, `four-meme`.
- **Live platform-fee display**: UI reads `feeBps` live (2.5%); verified it tracks
  on-chain changes (fork test: 250→500 reflected instantly).
- **Practice fork infra**: Anvil + gateway deployed on Render; `/health` 200,
  public door `eth_chainId`→`0x38`, admin door correctly 401s without the key.

### ⚠️ Built but NOT live-verified end-to-end (honest gaps)
- **`/api/practice/fund` is broken live**: the live backend's `PRACTICE_ADMIN_KEY`
  does **not** match the fork's. Proven precisely: the fork's `/admin/rpc` accepts
  the value in `backend/.env` (200) but the live backend gets 401. **Fix (config
  only):** set the live backend service's `PRACTICE_ADMIN_KEY` to the same value as
  the fork service. Until then, practice *funding* fails (reads/records still work).
- **`/api/build` full completion**: kickoff verified (returns slug, reaches
  `scaffolding`), but a full multi-minute deploy (AgentCore/`bag`) was not waited
  out this session.
- **B402 Bazaar indexing**: the `extensions.bazaar` blob is built to the documented
  spec and unit-shape-verified, but nothing has been *indexed live* yet — that needs
  a running x402 merchant endpoint emitting a real settle carrying the blob.
- **x402 pay-per-call (model 3)**: the UI saves the config + Bazaar blob; wiring a
  creator's endpoint as an actual x402 resource is the creator's own deploy step.
- **AgentAccessMarket audit**: no independent third-party audit. Self-tested only.
- **Practice fork durability**: free-tier, ephemeral — the fork re-forks fresh on
  every restart/idle-spindown (positions reset). Permanent history lives in MongoDB
  and is unaffected.

---

## 7. Partner alignment (what we ACTUALLY built — no overclaiming)

- **BNB Chain / BNB Agent Studio** — the platform this is built *for*. Everything is
  mainnet-only BSC (chain 56). The "Build Your Agent" flow drives BNB Agent Studio's
  real `bag` CLI pipeline (`backend/core/agent_builder.py`: `bag init` → wallet →
  LLM → deploy), and ERC-8004 identity + ERC-8183 commerce (the BNB agent-economy
  standards) run throughout. **Real, and the build endpoint was live this session.**
- **Binance Pay / B402 Bazaar** — we built the real **B402 Bazaar opt-in**: a
  spec-accurate `paymentPayload.extensions.bazaar` blob attached to the x402 V2
  settle call so x402-listed agents can be discovered. Source: the live Binance docs
  (`developers.binance.com/docs/onchainpay-x402/b402-bazaar`), matched field-for-field
  to the CDP x402 Bazaar extension. **We deliberately did NOT build** the heavier
  Binance Pay Merchant API (QR/deeplink checkout). Honest limit: the blob is built
  but not yet indexed live (§6).
- **Altana** — the session/skills layer, and the most extensive integration
  (`@altananetwork/sdk`, ~60+ references): passkey wallets, real on-chain sessions
  with spend caps + expiry + revocation, the Skills Registry, x402 payments, and the
  ERC-8183 hire flow. Skills were executed for real on the practice fork. **Real.**
- **PancakeSwap** — real, at the **skill** level: `pancakeswap-trading` and
  `pancakeswap-liquidity` skills interact with real PancakeSwap contracts and were
  **executed live on the fork**. A technical integration, not a formal partnership.
- **AltLayer** — via **8004scan** (an AltLayer product), which is our ERC-8004 agent
  **identity + reputation + discovery** data source (`GET /api/agents` aggregates it).
  A real data integration; not a formal partnership.
- **TermiX** — honest correction to the older README: **there is no TermiX
  integration.** TermiX is simply the single largest source of ERC-8004 agents in the
  live 8004scan registry (~68% of BSC agents are "X.agent on Termix Platform"). We
  **consume and de-duplicate** those agents so one mass-registration campaign can't
  dominate the marketplace (`backend/core/aggregate.py`). That's data handling, not a
  partnership — and it is *not* the "Advantage Report" (which is now real
  practice-layer stats, unrelated to TermiX).

---

## 8. What needs a decision / action from you

1. ~~**Fix practice funding** (config): set the live backend's `PRACTICE_ADMIN_KEY`
   to match the fork's.~~ **The auth mismatch is fixed** (confirmed 2026-08-17: no
   more 401). But funding is **broken again for a different reason** — live
   `anvil_setBalance` calls are failing with a "Temporary internal error" from
   `FORK_RPC_URL` (dRPC free tier), reproduced twice with fresh trace IDs. Only an
   upstream RPC account/plan decision fixes this (retry later / upgrade the dRPC
   plan) — not something fixable by editing our code.
2. **B402 Bazaar** goes from "built" to "indexed" only once a real x402 merchant
   endpoint emits a settle carrying the blob — decide if/when to stand one up.
3. **TermiX track's required Agent Advantage Report doesn't exist yet**
   (confirmed against the live rubric 2026-08-17): ≥3 real tasks run both ways
   (with our marketplace's agent vs. without), time/cost/quality per task, real
   outputs attached, ≥1 task from trading/stock/security. This needs real task
   runs decided and executed, not just more code — needs your input on which 3
   tasks to run.
4. **Grid Trading has zero real agents** in the currently-served set (main-track
   "equal depth across all four categories" requirement). `core/categorize.py`'s
   keyword rules exist but aren't matching real 8004scan listings — worth
   either broadening the keywords or accepting this as a real data-availability
   limit of the current registry sample.
3. **Audit** before promoting significant real-money volume through AgentAccessMarket.
