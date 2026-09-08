# Getting Started (Local Development)

Current setup steps for this exact codebase, verified against the source, not a generic template.

## Backend (FastAPI, Python 3.13)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env # fill in values, see below
uvicorn server:app --reload --port 8000
```

### Backend environment variables

The values read by `backend/server.py` and its `core`/`adapters` modules (`os.environ.get(...)`, grepped directly from the source, not copied from an older doc):

| Variable | Required for | Notes |
|---|---|---|
| `SCAN_8004_API_KEY` | Agent discovery | 8004scan API key. Get one at 8004scan.io/developers. |
| `ZERION_API_KEY` | Opt-in wallet portfolio enrichment | Free `demo` tier is enough (300 req/day). |
| `MONGODB_URI` | Everything durable | Agent store, job timing, deliverable durability. |
| `MONGODB_DB_NAME` | Same | Defaults to `agents_marketplace` if unset. |
| `BSC_MAINNET_RPC_URL` | On-chain reads (job scans, health checks, performance stats) | Falls back to a public node if unset; an archive-capable RPC (this project uses bloXroute) is needed for anything that scans logs. |
| `INFURA_API_KEY` | Automatic RPC backup only | Optional. `core/rpc.py`'s `rpc_post()` tries the primary above first, falling back to Infura's BSC endpoint only on a primary failure, never as a second primary. Without it, every on-chain read still works exactly as before, just with no backup. |
| `THEGRAPH_API_KEY` | The Graph registry fallback | The Agent0 subgraph source. Without it `adapters/thegraph.py` raises rather than degrading, so the second registry source is simply unavailable. See [The Graph Integration](thegraph-integration.md). |
| `BSCSCAN_API_KEY` | Contract source verification lookups | Optional. |
| `AGENT_BUILDS_ROOT` | "Build Your Agent" | Optional, has a default. |
| `BAG_BIN` | "Build Your Agent" | Optional, has a default; only needed if you're running the `bag` CLI locally. |
| `BATCH_TRIGGER_SECRET` | The six `/api/admin/*-batch` routes | Checked against the `X-Batch-Secret` header. Without it those routes cannot be triggered. |
| `FIRST_VISIT_SALT` | First-visit detection | Falls back to a fixed string in source if unset, which removes the protection the hashing exists to provide. See [Data Handling](data-handling.md#personal-data). |
| `PLATFORM_FEE_WALLET` | Contract deployment scripts | Not read by the running server. See [AgentBudgetEscrow Go-Live](budget-escrow-golive.md). |
| `REFERENCE_AGENT_ADDRESS` | Escrow compatibility audit | Optional. Currently unset in production. |

Commerce and studio variables, read by `core/commerce/` and
`core/b402.py`. All optional: the pipeline is deliberately useful with none
of them set, degrading rather than failing. See
[The Agent Studio](agent-studio.md) and [Payment Rails](payment-rails.md).

| Variable | Required for | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Model-backed studio agents | Without it the model layer returns a degraded result saying what it would have asked, rather than fabricating an answer. |
| `ANTHROPIC_API_KEY` | Same, if the provider is switched | Only read when `COMMERCE_MODEL_PROVIDER` selects Anthropic. |
| `COMMERCE_MODEL_PROVIDER` | Choosing the provider | Defaults to `gemini`. |
| `COMMERCE_MODEL` | Pinning the model | Defaults to `gemini-3.7-flash`, pinned rather than a moving alias. |
| `OC_API_KEY`, `OC_SECRET_KEY` | The B402 rail | Backend only. The secret key signs every request and must never reach a browser or a frontend bundle. |
| `CROSSMINT_API_KEY` | The Crossmint rail | A production key. Order writes are still gated by the flag below. |
| `CROSSMINT_ENV` | Crossmint base URL | Production or staging. |
| `CROSSMINT_PAYMENT_METHOD` | Crossmint settlement | No default. Unset means the rail refuses rather than guessing a method. |
| `COMMERCE_ALLOW_REAL_ORDERS` | Placing an order that spends money | Off by default. Quoting and cart building work without it; only the order write is gated. |
| `COMMERCE_HANDOFF_BASE_URL` | A hosted checkout page for the handoff rail | Optional. Without it, a multi-merchant cart lists each item's own link. |
| `PAYBOX_PAY_TO`, `PAYBOX_PUBLIC_BASE_URL` | The Pay.B402 surface | Optional. |

The spend ceiling is deliberately not on this list. It lives in
`core/commerce/limits.py` as a source constant, because an environment
variable can be raised by a deploy config while a constant has to be edited
and committed. See
[Payment Rails](payment-rails.md#the-hard-spend-cap).

### Backend routes

The full, current list of routes in `backend/server.py`, 57 of them, generated from the source rather than maintained by hand (2026-09-08). An earlier version of this section listed 34 and predated the studio, commerce, Pay.B402, chain-view, token-risk and per-agent evaluation routes.

```
GET  /api/market/bnb-price
GET  /api/agents
GET  /api/search/resolve
GET  /api/full-registry-progress
GET  /api/health
GET  /api/status
POST /api/admin/full-registry-batch
POST /api/admin/job-index-batch
POST /api/admin/health-check-batch
POST /api/admin/solana-registry-batch
POST /api/admin/multichain-registry-batch
POST /api/admin/escrow-compat-audit-batch
GET  /api/skills-registry
POST /api/build
GET  /api/build/{slug}/status
GET  /api/agents/performance
GET  /api/agents/revenue
GET  /api/agents/performance/bulk
GET  /api/agents/wallet-portfolio
GET  /api/agents/activity
GET  /api/agents/pnl
GET  /api/agents/pnl-summary
GET  /api/agents/onchain-performance
GET  /api/agents/onchain-history
GET  /api/canary/candidates
GET  /api/canary/budget-status
GET  /api/canary/status-bulk
GET  /api/canary/history
POST /api/canary/record
POST /api/canary/check-pending
GET  /api/agents/termix-performance
POST /api/agents/negotiate
POST /api/agents/notify-funded
GET  /api/agents/escrow-compatibility
GET  /api/agents/{agent_id}/quality-center
GET  /api/agents/{agent_id}/contract-verification
GET  /api/native-agents/staking/recommendation
GET  /api/deliverable/proxy
GET  /api/my-jobs
GET  /api/paybox/readiness
POST /api/paybox/sessions
GET  /api/paybox/sessions/{session_id}
POST /api/paybox/sessions/{session_id}/pay
GET  /api/studio/flows
POST /api/studio/runs
POST /api/studio/runs/{run_id}/answers
GET  /api/studio/runs/{run_id}
GET  /api/paybox/selfcheck
GET  /api/token-risk/{contract_address}
GET  /api/agents/{agent_id}
GET  /api/chain-views
GET  /api/chain-view/{view}
GET  /api/first-visit
GET  /api/budget-mode/status
GET  /api/chain-agent/{chain_id}/{token_id}/evaluation
GET  /api/commerce/readiness
POST /api/commerce/run
```

The six `/api/admin/*-batch` routes are secret-gated: the `X-Batch-Secret` header is checked against `BATCH_TRIGGER_SECRET`. See [Full Registry Analysis](full-registry-analysis.md) for what each one does. They run on a 6-hour GitHub Actions schedule; full-registry ingestion, full-registry analysis and escrow-compatibility auditing additionally run continuously on a Render Background Worker (`backend/worker.py`, three concurrent loops in one process), kept deliberately redundant with the scheduled steps rather than replacing them. `GET /api/full-registry-progress` gives a live, public snapshot of all of it at any time.

The studio and commerce routes are documented in [The Agent Studio](agent-studio.md#how-a-run-works). `GET /api/paybox/selfcheck` and `GET /api/commerce/readiness` both report live rail state and never return a credential.

## Frontend (Vite + React)

```bash
cd frontend
npm install
cp .env.example .env    # optional in local dev; defaults assume backend on :8000
npm run dev             # or: npm run build
```

### Frontend environment variables

Grepped directly from `import.meta.env.VITE_*` usage across `frontend/src`:

| Variable | Used for | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | Every `/api/*` call | Defaults to `http://localhost:8000`. |
| `VITE_AGENT_MARKET_ADDRESS` | Sell Your Agent / Creator Earnings | Defaults to the deployed `AgentAccessMarket` address. |
| `VITE_MOBILE_URL` | The "open on your phone" QR code | Defaults to the page's own origin. |
| `VITE_MAINNET_READ_RPC` | Every on-chain read the frontend makes (connected-wallet reads via wagmiConfig.js, deliverable-URL lookup, copy-trade/wallet-tracker skills, all via `rpcTransport.js`) | Defaults to a tested bloXroute endpoint; the SDK's default public RPC refuses the `getLogs` calls the read-only skills need. |
| `VITE_INFURA_API_KEY` | Automatic RPC backup only | Optional. `rpcTransport.js`'s `getBscTransport()` tries the primary above first (viem's `fallback()`, in order, never ranked), falling back to Infura's BSC endpoint only on a primary failure. Without it, every read still works exactly as before, just with no backup. |
| `VITE_SKILL_SCAN_BLOCKS` | Copy-trade / wallet-tracker skills | How many blocks back to scan; defaults to 1000. |
| `VITE_PRIVY_APP_ID` | Passkey/email login (Privy) | Get one at dashboard.privy.io. |
| `VITE_WALLETCONNECT_PROJECT_ID` | RainbowKit wallet connections | Get one free at cloud.walletconnect.com. |
| `VITE_BUDGET_ESCROW_ADDRESS` | Drawable budgets | The deployed `AgentBudgetEscrow` address. Currently unset in production, so the budget surface falls back to its default. See [Drawable Budgets](budget-integration.md). |

Everything prefixed `VITE_` is compiled into the browser bundle and is
therefore public. Nothing secret belongs in this table. `VITE_INFURA_API_KEY`
is the one to be aware of: it is a live credential and it ships to the browser, which
is a property of the Vite prefix rather than a mistake in the code, but it
means the key should be one that is rate-limited and disposable rather than
shared with anything else.

Backend credentials never appear here. `OC_SECRET_KEY` in particular signs
every B402 request and must never be given a `VITE_` prefix or referenced from
`frontend/src`.

## Repo structure

```
backend/
  server.py                FastAPI app: see the route list above
  core/                     aggregate.py, categorize.py, agent_store.py, agent_health.py,
                            agent_performance.py, db.py, status_checks.py, and more
  adapters/                 bsc.py (8004scan), zerion.py, coingecko.py, bsc_balance.py,
                            multichain_agents.py, defillama.py
frontend/src/
  AgentMarketplaceApp.web.jsx / .mobile.jsx   the two apps
  App.jsx                   platform switch + the standalone routes (/ecosystem, /status,
                            /data-sources, /partners, /docs) + the main app's own tab routes
  altana.js                 Altana SDK wrapper: passkey wallet, sessions, deliverables
  useHireAgent.js            direct-wagmi ERC-8183 hire flow
  JobStatusPanel.jsx         job status + deliverable rendering, shared web/mobile
  EcosystemGlobePage.jsx     the /ecosystem 3D page
  StatusPage.jsx              the /status page
contracts/
  src/AgentAccessMarket.sol   the deployed Sell Your Agent contract
explainer-agent/
  an independently-deployed ERC-8004/ERC-8183 seller agent
render.yaml                  Render Blueprint for the explainer-agent service
```