# Agents Marketplace (AAM)

A **mainnet-only BSC** marketplace for **BNB Agent Studio** agents: discover
on-chain agents, hire them through the real **ERC-8183** job-escrow protocol,
and run ready-made **Altana Skills** — with a **Practice Layer** (a live BSC
fork) to try anything for free before spending real money.

Built for BNB Chain's "Smart Money Era" hackathon.

> **Verification note.** Everything below is marked with how it was checked.
> ✅ = exercised live and confirmed this session (with real results shown).
> 🔷 = code verified against the real SDK/docs but not executed on-chain
> (needs a funded wallet / passkey). ⚠️ = genuine gap / TODO. Nothing here is
> an aspirational claim — if it wasn't verified, it says so.

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
- **Layout:** a FastAPI backend (read-only data + the Practice Layer proxy) and
  a Vite/React frontend (web + a separate mobile app). A single Docker service
  hosts the Anvil practice fork.

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

- The six **tx** skills were each executed on the Practice fork with **real
  before/after balance proofs**. (Five were driven at the exact on-chain
  call-sequence level via `cast`; **Venus** was additionally run through the
  actual React UI end-to-end — the same executor → proxy → Anvil path the other
  five share.)
- **Copy Trade is wired detection-only (mirroring not connected)**; Wallet
  Tracker and Token Radar are read-only by design. They detect/read a wallet's
  trades from RPC logs. Copy Trade and Wallet Tracker were fixed this session (a
  viem `getLogs` filter bug) and verified live returning real data. They issue
  address-less topic `getLogs`, so they need a read RPC that permits it — set
  `VITE_MAINNET_READ_RPC` to a dRPC-class endpoint (the default public RPC
  refuses these queries). Scan depth is `VITE_SKILL_SCAN_BLOCKS` (default 1000
  blocks).

### Practice Layer (the "try before you spend" fork)
A **self-hosted Anvil fork of live BSC mainnet**, so users can run any
agent/skill with free faucet funds against real contracts/liquidity, at zero
cost and zero risk. Every practice run is **permanently recorded in MongoDB**,
keyed by wallet address, and viewable in-app (`AltanaSkillsPanel` history
panel).

**Deployment & security model** — packaged as **one public Docker Web Service**
(Render free tier). Inside the container:
- **Anvil** binds `127.0.0.1:8545` only (never public).
- A tiny stdlib gateway (`anvil/gateway.py`) is the only thing on the public
  port, with two doors:
  - **Public door** (`/`): forwards to Anvil **only** for allow-listed safe
    methods (`eth_*`, `eth_sendRawTransaction`). Admin cheats
    (`anvil_*`/`hardhat_*`/`evm_*`) are **refused (403)**.
  - **Authenticated door** (`/admin/rpc`): requires `X-Admin-Key` (shared
    secret, constant-time compare); forwards **anvil_\* cheats unfiltered**.
    Only the backend knows the key — this is how funding runs.
- Funding: native BNB via `anvil_setBalance`; ERC-20 via **whale impersonation**
  (`anvil_impersonateAccount` a Binance hot wallet → transfer), since Anvil has
  no `setErc20Balance`.

Status: ✅ **verified live this session** — the Docker image builds and runs;
the public door refuses `anvil_setBalance` (403) while the authenticated door
funds successfully (real +1000 USDT delta on-chain); a full run through the
**real React UI** (Practice Mode toggle → Venus supply) landed on-chain and
recorded to MongoDB with zero console errors; funding, persistence across
calls, and the Mongo record→history round-trip all confirmed.

⚠️ **Free-tier caveats (honest):** no persistent disk → the fork **re-forks
fresh on every restart/idle-spin-down** (in-fork positions reset; the MongoDB
history is unaffected). One **shared** fork for all users (griefable, fake
money). ~512 MB RAM → possible OOM under load. `FORK_RPC_URL` **must be an
archive-capable BSC RPC** (e.g. dRPC) — pruned public endpoints crash Anvil
with "missing trie node".

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

- ⚠️ **Agent Advantage Report (TermiX track) — NOT real yet.** The web app's
  "Advantage Report" tab currently shows **hardcoded placeholder numbers**
  (`ADVANTAGE_REPORT` in `AgentMarketplaceApp.web.jsx`), not measured data. The
  real requirement — run ≥3 real tasks with and without an agent and compare
  time/cost/quality, with outputs attached — **has not been done**. (The
  backend validator that once checked this was removed as unused; it needs
  rebuilding around real task data.) Treat this tab as a mockup until real runs
  replace the placeholders.
- ⚠️ **x402 live settlement** untested (see table).
- ⚠️ **On-chain hire + Altana session grant/revoke** not executed live (code
  verified vs SDK only).
- ⚠️ **Copy-trade / wallet-tracker** require a `getLogs`-capable read RPC
  (`VITE_MAINNET_READ_RPC`); they won't work on the default public RPC.
- ⚠️ **8004scan agent discovery** not re-called live this session (needs an API
  key); relies on an earlier session's confirmation.

---

## Partner-track alignment

- **Altana** — the core of the build: passkey wallets, real on-chain sessions
  (spend cap + expiry + revocation), the 10-skill Skills Registry integration,
  x402 payments, and the ERC-8183 hire flow.
- **PancakeSwap** — `pancakeswap-trading` and `pancakeswap-liquidity` skills,
  both **verified live** on the fork.
- **AltLayer** — ERC-8004 agent identity and agent discovery via **8004scan**.
- **TermiX** — the Agent Advantage Report (measurement). ⚠️ **incomplete** —
  currently placeholder data (see above).
- **BNB Agent Studio** (BNB Chain core) — the "Build Your Agent" `bag` CLI
  pipeline and the ERC-8004/8183 standards throughout.

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
`MONGODB_DB_NAME`, and the Practice Layer vars `PRACTICE_RPC_URL` /
`PRACTICE_ADMIN_URL` / `PRACTICE_ADMIN_KEY`. (Optional: `AGENT_BUILDS_ROOT`,
`BAG_BIN` for the build feature — both have defaults.) `bnbagent-studio` (the
`bag` CLI) is only needed for "Build Your Agent".

### Frontend (Vite + React)
```bash
cd frontend
npm install
cp .env.example .env                      # optional in local dev; defaults assume backend on :8000
npm run dev                               # or: npm run build
```
Frontend env (`frontend/.env.example`): `VITE_API_BASE_URL`,
`VITE_PRACTICE_RPC_URL`, `VITE_MAINNET_READ_RPC`, `VITE_SKILL_SCAN_BLOCKS`,
`VITE_PRIVY_APP_ID`, `VITE_WALLETCONNECT_PROJECT_ID`.

### Practice fork (Anvil)
- **Local:** run `anvil --fork-url <archive-BSC-RPC> --host 127.0.0.1 --port
  8545 --chain-id 56`, then `PORT=8546 PRACTICE_ADMIN_KEY=<secret> python3
  anvil/gateway.py`. Point the backend's `PRACTICE_RPC_URL` at the gateway.
- **Deploy (Render Blueprint):** `render.yaml` defines a public Docker **Web
  Service** from `anvil/Dockerfile`. Set `FORK_RPC_URL` (archive BSC RPC, e.g.
  dRPC) and `PRACTICE_ADMIN_KEY`. Then on the backend set `PRACTICE_RPC_URL` =
  the service's public URL, `PRACTICE_ADMIN_URL` = `<url>/admin/rpc`, and the
  same `PRACTICE_ADMIN_KEY`.

---

## Structure

```
backend/
  server.py                FastAPI app: /api/agents, /api/practice/*, /api/build/*
  core/
    aggregate.py           combines 8004scan + categorize + DefiLlama (mainnet-only)
    categorize.py          18-category keyword taxonomy (no LLM)
    agent_builder.py       real `bag` CLI pipeline (Build Your Agent)
    practice_layer.py      Anvil-fork funding (admin door) + MongoDB history
  adapters/
    bsc.py                 8004scan mainnet agent reads
    defillama.py           TVL enrichment
  requirements.txt
anvil/
  Dockerfile               foundry + python3, one public Web Service
  gateway.py               public-filtered + authenticated-admin RPC gateway
  entrypoint.sh            starts Anvil (localhost) + gateway (public port)
frontend/src/
  AgentMarketplaceApp.web.jsx / .mobile.jsx    the two apps
  altana.js                Altana SDK: passkey wallet, sessions, hire, executors
  erc8183.js / useHireAgent.js                 direct wagmi ERC-8183 hire
  AltanaSkillsPanel.jsx    the 10 skills UI + Practice Mode + history viewer
  AltanaSessionPanel.jsx   Altana session grant/hire/revoke UI
  practiceWallet.js        practice burner wallet + executor
  defiSkills.js / fourMemeSkill.js / pancakeswapSkill.js   tx skills
  copyTradeSkill.js / researchSkills.js / x402Skill.js     read-only + pay skills
render.yaml                Render Blueprint for the Anvil practice fork
```
