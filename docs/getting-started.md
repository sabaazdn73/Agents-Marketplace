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
| `MONGODB_URI` | Everything durable | Agent store, Practice Mode history, deliverable durability. |
| `MONGODB_DB_NAME` | Same | Defaults to `agents_marketplace` if unset. |
| `BSC_MAINNET_RPC_URL` | On-chain reads (job scans, health checks, performance stats) | Falls back to a public node if unset; a real archive-capable RPC (this project uses bloXroute) is needed for anything that scans logs. |
| `PRACTICE_RPC_URL` | Practice Layer | The Anvil fork's public, method-filtered door. |
| `PRACTICE_ADMIN_URL` | Practice Layer funding | The fork's authenticated `/admin/rpc` door. |
| `PRACTICE_ADMIN_KEY` | Practice Layer funding | Shared secret; must match the value set on the fork service. |
| `AGENT_BUILDS_ROOT` | "Build Your Agent" | Optional, has a default. |
| `BAG_BIN` | "Build Your Agent" | Optional, has a default; only needed if you're running the real `bag` CLI locally. |

For bare local dev without the Practice Layer, you can leave the `PRACTICE_*` vars empty and everything except that one feature works normally.

### Real backend routes

The full, current list of routes in `backend/server.py` (grepped directly, not from an older count):

```
GET  /api/health
GET  /api/status
GET  /api/agents
GET  /api/agents/performance
GET  /api/agents/wallet-portfolio
POST /api/agents/negotiate
POST /api/agents/notify-funded
GET  /api/market/bnb-price
GET  /api/skills-registry
GET  /api/deliverable/proxy
GET  /api/my-jobs
POST /api/build
GET  /api/build/{slug}/status
POST /api/practice/init
POST /api/practice/fund
POST /api/practice/rpc
POST /api/practice/record
GET  /api/practice/history/{wallet_address}
GET  /api/practice/stats
```

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
| `VITE_PRACTICE_RPC_URL` | Practice Mode's burner wallet | Defaults to `${VITE_API_BASE_URL}/api/practice/rpc`. |
| `VITE_MAINNET_READ_RPC` | Deliverable-URL lookup, copy-trade/wallet-tracker skills | Real `getLogs` calls; the SDK's default public RPC refuses these — this project defaults to a real, tested bloXroute endpoint. |
| `VITE_SKILL_SCAN_BLOCKS` | Copy-trade / wallet-tracker skills | How many blocks back to scan; defaults to 1000. |
| `VITE_PRIVY_APP_ID` | Passkey/email login (Privy) | Get one at dashboard.privy.io. |
| `VITE_WALLETCONNECT_PROJECT_ID` | RainbowKit wallet connections | Get one free at cloud.walletconnect.com. |

## Practice fork (Anvil)

**Local:**
```bash
anvil --fork-url <archive-capable-BSC-RPC> --host 127.0.0.1 --port 8545 --chain-id 56
PORT=8546 PRACTICE_ADMIN_KEY=<secret> python3 anvil/gateway.py
```
Point the backend's `PRACTICE_RPC_URL` at the gateway's public port.

**Deploy (Render Blueprint):** `render.yaml` defines a public Docker Web Service built from `anvil/Dockerfile`. Set `FORK_RPC_URL` (a real archive-capable BSC RPC) and `PRACTICE_ADMIN_KEY` on that service, then on the backend service set `PRACTICE_RPC_URL` to the fork service's public URL, `PRACTICE_ADMIN_URL` to `<that-url>/admin/rpc`, and the same `PRACTICE_ADMIN_KEY`.

**A real, important requirement:** `FORK_RPC_URL` must be genuinely archive-capable. A pruned public endpoint will crash Anvil with a "missing trie node" error the moment it needs older state.

## Repo structure

```
backend/
  server.py                FastAPI app — see the real route list above
  core/                     aggregate.py, categorize.py, agent_store.py, agent_health.py,
                            agent_performance.py, practice_layer.py, status_checks.py, and more
  adapters/                 bsc.py (8004scan), zerion.py, coingecko.py, bsc_balance.py,
                            multichain_agents.py, defillama.py
frontend/src/
  AgentMarketplaceApp.web.jsx / .mobile.jsx   the two real apps
  App.jsx                   platform switch + the 4 standalone routes
  altana.js                 Altana SDK wrapper — passkey wallet, sessions, hire, deliverables
  useHireAgent.js            direct-wagmi ERC-8183 hire flow
  JobStatusPanel.jsx         real job status + deliverable rendering, shared web/mobile
  EcosystemGlobePage.jsx     the /ecosystem 3D page
  StatusPage.jsx              the /status page
anvil/
  Dockerfile / gateway.py / entrypoint.sh     the Practice Layer's fork + gateway
contracts/
  src/AgentAccessMarket.sol   the real, deployed Sell Your Agent contract
explainer-agent/
  a real, separately-deployed ERC-8004/ERC-8183 seller agent
render.yaml                  Render Blueprint for the Practice fork
```
