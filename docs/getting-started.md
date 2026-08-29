# Getting Started (Local Development)

Real, current setup steps for this exact codebase — verified against the actual source, not a generic template.

## Backend (FastAPI, Python 3.13)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # fill in real values, see below
uvicorn server:app --reload --port 8000
```

### Real backend environment variables

The values actually read by `backend/server.py` and its `core`/`adapters` modules (`os.environ.get(...)`, grepped directly from the source, not copied from an older doc):

| Variable | Required for | Notes |
|---|---|---|
| `SCAN_8004_API_KEY` | Agent discovery | 8004scan API key. Get one at 8004scan.io/developers. |
| `ZERION_API_KEY` | Opt-in wallet portfolio enrichment | Free `demo` tier is enough (300 req/day). |
| `MONGODB_URI` | Everything durable | Agent store, job timing, deliverable durability. |
| `MONGODB_DB_NAME` | Same | Defaults to `agents_marketplace` if unset. |
| `BSC_MAINNET_RPC_URL` | On-chain reads (job scans, health checks, performance stats) | Falls back to a public node if unset; a real archive-capable RPC (this project uses bloXroute) is needed for anything that scans logs. |
| `AGENT_BUILDS_ROOT` | "Build Your Agent" | Optional, has a default. |
| `BAG_BIN` | "Build Your Agent" | Optional, has a default; only needed if you're running the real `bag` CLI locally. |

### Real backend routes

The full, current list of routes in `backend/server.py` (2026-08-29 audit — grepped directly via `@app.get`/`@app.post`, not from an older count; the previous version of this table predated the PnL/revenue/on-chain-performance/escrow-compatibility routes and every `/api/admin/*-batch` endpoint below):

```
GET  /api/health
GET  /api/status
GET  /api/agents
GET  /api/agents/activity
GET  /api/agents/performance
GET  /api/agents/performance/bulk
GET  /api/agents/termix-performance
GET  /api/agents/onchain-performance
GET  /api/agents/onchain-history
GET  /api/agents/pnl
GET  /api/agents/pnl-summary
GET  /api/agents/revenue
GET  /api/agents/escrow-compatibility
GET  /api/agents/wallet-portfolio
POST /api/agents/negotiate
POST /api/agents/notify-funded
GET  /api/market/bnb-price
GET  /api/skills-registry
GET  /api/deliverable/proxy
GET  /api/my-jobs
POST /api/build
GET  /api/build/{slug}/status
GET  /api/canary/candidates
GET  /api/canary/budget-status
GET  /api/canary/status-bulk
GET  /api/canary/history
POST /api/canary/record
POST /api/canary/check-pending
POST /api/admin/full-registry-batch
POST /api/admin/job-index-batch
POST /api/admin/health-check-batch
POST /api/admin/solana-registry-batch
POST /api/admin/escrow-compat-audit-batch
```

The five `/api/admin/*-batch` routes are secret-gated (`X-Batch-Secret` header checked against `BATCH_TRIGGER_SECRET`) — see `full-registry-analysis.md` for what each one does and how they're triggered (GitHub Actions on a schedule, plus a dedicated Render Background Worker for the escrow-compatibility one specifically).

## Frontend (Vite + React)

```bash
cd frontend
npm install
cp .env.example .env    # optional in local dev; defaults assume backend on :8000
npm run dev             # or: npm run build
```

### Real frontend environment variables

Grepped directly from `import.meta.env.VITE_*` usage across `frontend/src`:

| Variable | Used for | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | Every `/api/*` call | Defaults to `http://localhost:8000`. |
| `VITE_AGENT_MARKET_ADDRESS` | Sell Your Agent / Creator Earnings | Defaults to the real deployed `AgentAccessMarket` address. |
| `VITE_MOBILE_URL` | The "open on your phone" QR code | Defaults to the page's own origin. |
| `VITE_MAINNET_READ_RPC` | Deliverable-URL lookup, copy-trade/wallet-tracker skills | Real `getLogs` calls; the SDK's default public RPC refuses these — this project defaults to a real, tested bloXroute endpoint. |
| `VITE_SKILL_SCAN_BLOCKS` | Copy-trade / wallet-tracker skills | How many blocks back to scan; defaults to 1000. |
| `VITE_PRIVY_APP_ID` | Passkey/email login (Privy) | Get one at dashboard.privy.io. |
| `VITE_WALLETCONNECT_PROJECT_ID` | RainbowKit wallet connections | Get one free at cloud.walletconnect.com. |

## Repo structure

```
backend/
  server.py                FastAPI app — see the real route list above
  core/                     aggregate.py, categorize.py, agent_store.py, agent_health.py,
                            agent_performance.py, db.py, status_checks.py, and more
  adapters/                 bsc.py (8004scan), zerion.py, coingecko.py, bsc_balance.py,
                            multichain_agents.py, defillama.py
frontend/src/
  AgentMarketplaceApp.web.jsx / .mobile.jsx   the two real apps
  App.jsx                   platform switch + the standalone routes (/ecosystem, /status,
                            /data-sources, /partners, /docs) + the main app's own tab routes
  altana.js                 Altana SDK wrapper — passkey wallet, sessions, hire, deliverables
  useHireAgent.js            direct-wagmi ERC-8183 hire flow
  JobStatusPanel.jsx         real job status + deliverable rendering, shared web/mobile
  EcosystemGlobePage.jsx     the /ecosystem 3D page
  StatusPage.jsx              the /status page
contracts/
  src/AgentAccessMarket.sol   the real, deployed Sell Your Agent contract
explainer-agent/
  a real, separately-deployed ERC-8004/ERC-8183 seller agent
render.yaml                  Render Blueprint for the explainer-agent service
```
