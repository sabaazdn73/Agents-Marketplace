# Tnega

**Live: [https://tnega.app](https://tnega.app)**

A **mainnet-only BSC** marketplace for **BNB Agent Studio** agents: discover
on-chain agents, hire them through the real **ERC-8183** job-escrow protocol,
and run ready-made **Altana Skills**.

Built for BNB Chain's "Smart Money Era" hackathon. Full documentation: **[docs/](docs/README.md)**.

> **Verification note.** Everything below is marked with how it was checked.
> ✅ = exercised live and confirmed this session (with real results shown).
> 🔷 = code verified against the real SDK/docs but not executed on-chain
> (needs a funded wallet / passkey). ⚠️ = genuine gap / TODO. Nothing here is
> an aspirational claim — if it wasn't verified, it says so.

**Live pages:** [`/status`](https://tnega.app/status) —
real, live pass/fail checks (not cached uptime history) against every
external integration this project depends on (8004scan, Zerion, CoinGecko,
the BSC RPC, the explainer-agent service, MongoDB). [`/ecosystem`](https://tnega.app/ecosystem) —
a standalone visual identity page, a rotating 3D globe sized by real, live
agent-category counts.

---

## Architecture

- **Mainnet-only.** BSC mainnet (chain 56) throughout. No testnet anywhere,
  except the optional "Build Your Agent" free trial, which uses BNB Agent
  Studio's own testnet trial (see below).
- **Two standards:** **ERC-8004** (on-chain agent identity — an ERC-721
  `agentId` + discoverable profile, gas-sponsored by MegaFuel) and **ERC-8183**
  (a trustless job-escrow protocol: `createJob → registerJob → setBudget →
  approve $U → fund`, settle after a review window, or `claimRefund` after
  expiry). Escrow/settlement token is **$U** (United Stables).
- **No backend-held keys.** All signing is client-side: either the user's
  connected wallet (wagmi/RainbowKit/Privy) or **Altana's passkey wallet SDK**
  (`@altananetwork/sdk`) with on-chain, scoped, revocable sessions. The backend
  never holds a private key.
- **Layout:** a FastAPI backend (read-only data + hire-adjacent writes) and a
  Vite/React frontend (web + a separate mobile app).

---

## Verified capabilities

### Agent discovery & categorization
- `adapters/bsc.py` reads real BSC **mainnet** agents from **8004scan**
  (`8004scan.io/api/v1/agents`, offset/limit pagination), client-side-filtered
  to chain 56. `core/categorize.py` classifies each agent by deterministic
  keyword matching into an **18-category** taxonomy (auditable, no LLM).
  `core/aggregate.py` cross-references **DefiLlama** TVL where a protocol match
  exists (honestly `null` where none does).
- Status: 🔷 code is real and, per the modules' own tested-on notes, was
  confirmed against a live 8004scan response in an earlier session. **Not
  re-called live this session** (needs `SCAN_8004_API_KEY`).

### Hiring an agent (ERC-8183)
Two real, client-signed paths:
- **Direct wagmi path** (`useHireAgent.js` + `erc8183.js`): the connected
  wallet signs `createJob → registerJob → setBudget → approve → fund`.
- **Altana session path** (`altana.js` + `AltanaSessionPanel.jsx`): create a
  passkey wallet, grant a scoped on-chain session (spend cap + expiry +
  contract allow-list), hire through it, and revoke — the Altana partner
  track's exact requirement.
- Status: 🔷 the ERC-8183 **contract addresses, ABIs, and job struct** are
  verified against the **installed `@altananetwork/sdk`** (chain 56 `commerce`
  /`router`/`policy`/`registry` match; `JOB_STATUS` matches), and the Altana
  client methods (`createPasskeyWallet`, `grantSession`, `revokeSession`,
  `hireErc8183Agent`, `fetchWithX402`) match the installed type defs. **A full
  on-chain hire was not executed** (needs a funded wallet + real $U). Known
  TODO: `decodeJobIdFromReceipt` (event decoding) is flagged unverified in the
  code.

### Ready-made Altana Skills (all 10 wired)
From the real **Altana Skills Registry**
(`raw.githubusercontent.com/altananetwork/skills/main/index.json`). Every
contract address and function signature was re-verified against each skill's
own `SKILL.md` and BscScan this session.

| Skill | Type | Status |
|---|---|---|
| PancakeSwap Trading | tx (swap) | ✅ live: 100 USDT → 0.16589 WBNB |
| PancakeSwap Liquidity | tx (add-liq) | ✅ live: 100 USDT + 0.16644 WBNB → 1.53424 LP |
| Venus Lending | tx (supply) | ✅ live: 100 USDT → 3783.39 vUSDT |
| Aave V3 Lending | tx (supply) | ✅ live: 100 USDT → 100.0 aBnbUSDT |
| Lista Staking | tx (stake) | ✅ live: 1 BNB → 0.96399 slisBNB |
| Four.meme | tx (buy-on-curve) | ✅ live: 0.05 BNB → 649,166 "Binance AI" tokens (pre-graduation token `0x54D6…4444`) |
| Copy Trade | detection-only (mirroring not connected) | ✅ live: detected a real wallet's actual swaps on mainnet |
| Wallet Tracker | read-only (detection) | ✅ live: returned a real wallet's recent swaps |
| Token Radar (DexScreener) | read-only | ✅ live: returned 20 trending BSC tokens |
| x402 API Payments | pay (real session) | 🔷 wiring verified; **live payment settlement not tested** (needs a real x402-protected URL + facilitator) |

- The six **tx** skills were each verified with **real before/after balance
  proofs** at the exact on-chain call-sequence level via `cast`, against a
  real forked copy of BSC mainnet used only for that verification pass (not
  a live product feature).
- **Copy Trade is wired detection-only (mirroring not connected)**; Wallet
  Tracker and Token Radar are read-only by design. They detect/read a wallet's
  trades from RPC logs. Copy Trade and Wallet Tracker were fixed this session (a
  viem `getLogs` filter bug) and verified live returning real data. They issue
  address-less topic `getLogs`, so they need a read RPC that permits it — set
  `VITE_MAINNET_READ_RPC` to a dRPC-class endpoint (the default public RPC
  refuses these queries). Scan depth is `VITE_SKILL_SCAN_BLOCKS` (default 1000
  blocks).

> **Removed, 2026-08-26:** this project previously also included a Practice
> Layer (a self-hosted Anvil fork of BSC mainnet, so users could try any
> agent/skill with free faucet funds). It has been fully removed — real
> user decision, given repeated free-tier infrastructure instability on
> the fork that risked giving a fake/unreliable impression outweighing its
> real trust value. See [docs/limitations.md](docs/limitations.md) for
> what's true today.

### Build Your Agent (bag CLI)
`core/agent_builder.py` shells out to the real **`bag` CLI** (`bnbagent-studio`)
to scaffold a two-layer agent (Agent layer holds the wallet+LLM; keyless
Service layer relays), edit its instruction, activate the free Pieverse LLM, and
deploy to the free ~48h platform trial.
- Status: 🔷 integrated against the real CLI. Per the module's own tested-on
  notes, an earlier session scaffolded a real project (`bag init`, ~175
  packages, throwaway testnet wallet). **Not re-run this session** (needs the
  `bag` binary + network). The `/api/build` pipeline and its status polling are
  wired and import cleanly.

---

## What's still incomplete (honest)

> **This section is superseded by [docs/limitations.md](docs/limitations.md)**,
> which reflects the project's real, current state. It's kept below, dated,
> for historical record only — several items here (the Advantage Report, the
> category-diversity gap) have since changed. See the linked doc for what's
> actually true today.

- ⚠️ **x402 live settlement** untested (see table).
- ⚠️ **On-chain hire + Altana session grant/revoke** not executed live (code
  verified vs SDK only) — still true as of 2026-08-17; no funded wallet +
  passkey + browser available to actually run it end-to-end.
- ⚠️ **Copy-trade / wallet-tracker** require a `getLogs`-capable read RPC
  (`VITE_MAINNET_READ_RPC`); they won't work on the default public RPC.
- ⚠️ **8004scan agent discovery** not re-called live this session (needs an API
  key); relies on an earlier session's confirmation.

---

## Partner-track alignment

> Full, current, honest architecture + status + partner details live in **[docs/hackathon.md](docs/hackathon.md)** (authoritative).

- **Altana** — the core of the build: passkey wallets, real on-chain sessions
  (spend cap + expiry + revocation), the 10-skill Skills Registry integration,
  x402 payments, and the ERC-8183 hire flow.
- **PancakeSwap** — `pancakeswap-trading` and `pancakeswap-liquidity` skills,
  both **verified live** on the fork.
- **AltLayer** — ERC-8004 agent identity and agent discovery via **8004scan**
  (an AltLayer product); a real data integration, not a formal partnership.
- **Binance Pay / B402 Bazaar** — real B402 Bazaar opt-in (spec-accurate
  `extensions.bazaar` blob on the x402 settle). NOT the Binance Pay Merchant API.
- **BNB Agent Studio** (BNB Chain core) — the "Build Your Agent" `bag` CLI
  pipeline and the ERC-8004/8183 standards throughout.
- **TermiX** — credited as a real, active ecosystem participant (their AACP
  protocol is what a real majority of BSC's live ERC-8004 registry actually
  registers through; we index and de-duplicate them), not a formal API
  partnership. The track's own required same-task comparison report is real
  and live today on the in-app **Advantage Report** tab — see
  [docs/hackathon.md](docs/hackathon.md#termix) for its real, current,
  honestly-labeled completion status.

---

## Setup & run

### Backend (FastAPI, Python 3.13)
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt          # fastapi, uvicorn, httpx, motor, python-dotenv, bnbagent-studio
cp .env.example .env                      # fill in real values (see below)
uvicorn server:app --reload --port 8000
```
Real backend env (`backend/.env.example`): `SCAN_8004_API_KEY`, `MONGODB_URI`,
`MONGODB_DB_NAME`. (Optional: `AGENT_BUILDS_ROOT`, `BAG_BIN` for the build
feature — both have defaults.) `bnbagent-studio` (the `bag` CLI) is only
needed for "Build Your Agent".

### Frontend (Vite + React)
```bash
cd frontend
npm install
cp .env.example .env                      # optional in local dev; defaults assume backend on :8000
npm run dev                               # or: npm run build
```
Frontend env (`frontend/.env.example`): `VITE_API_BASE_URL`,
`VITE_MAINNET_READ_RPC`, `VITE_SKILL_SCAN_BLOCKS`, `VITE_PRIVY_APP_ID`,
`VITE_WALLETCONNECT_PROJECT_ID`.

---

## Structure

```
backend/
  server.py                FastAPI app: /api/agents, /api/build/*, hire-adjacent routes
  core/
    aggregate.py           combines 8004scan + categorize + DefiLlama (mainnet-only)
    categorize.py          18-category keyword taxonomy (no LLM)
    agent_builder.py       real `bag` CLI pipeline (Build Your Agent)
    db.py                  the one shared MongoDB client
  adapters/
    bsc.py                 8004scan mainnet agent reads
    defillama.py           TVL enrichment
  requirements.txt
frontend/src/
  AgentMarketplaceApp.web.jsx / .mobile.jsx    the two apps
  altana.js                Altana SDK: passkey wallet, sessions, hire, executors
  erc8183.js / useHireAgent.js                 direct wagmi ERC-8183 hire
  AltanaSkillsPanel.jsx    the 10 Altana Skills UI
  AltanaSessionPanel.jsx   Altana session grant/hire/revoke UI
  defiSkills.js / fourMemeSkill.js / pancakeswapSkill.js   tx skills
  copyTradeSkill.js / researchSkills.js / x402Skill.js     read-only + pay skills
render.yaml                Render Blueprint for the explainer-agent service
```
