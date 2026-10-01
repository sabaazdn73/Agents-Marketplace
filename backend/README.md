# Backend

FastAPI. Two processes on Render: the web service (`server.py`) answers the
site, the signing page and the MCP server; the background worker (`worker.py`)
refreshes what the web service reads. The web service makes no chain call for
the cost figures inside a request: it serves what the worker stored.

## Routes for the current product

| Route | Served from |
|---|---|
| `GET /api/te/summary`, `/api/te/search`, `/api/te/controls` | `data/te_universe.json.gz`, built by `scripts/te_build_universe.py` from chain reads (`te_api/router.py`) |
| `GET /api/te/list`, `/api/te/underlying/<ticker>`, `/api/te/curve/<ticker>`, `/api/te/status` | The cost store written by the worker (`te/router.py`, `core/te/`) |
| `GET /api/te/aave-v4` | Aave V4 Equities Hub reads on Base (`core/te/aave_v4.py`) |
| `GET /api/baskets/curated`, `/api/baskets/<code>`, `/api/baskets/evaluate` | Baskets priced from the same stored costs (`te/baskets_router.py`) |
| `GET /api/sign/<id>`, `POST /api/sign/<id>/done` | The signing page's read of an order prepared through MCP; the order is in the id, nothing is signed here (`te/sign_router.py`) |
| `POST /api/wallet/holdings` | A wallet's listed tokenized stocks and ETFs, read on chain (`te/wallet_router.py`, `core/te/holdings.py`) |
| `GET /api/vaults`, `/api/vaults/<platform>/<address>` | The vault store written by the worker (`vaults/router.py`, `core/vaults/`) |
| `POST /mcp` | The MCP server: nine tools over nine datasets (`mcp_server/`); see [docs/mcp-tools.md](../docs/mcp-tools.md) |

The other routes in `server.py` (`/api/agents/*`, `/api/chain-view/*`,
`/api/hyperliquid/*`, `/api/extension/*` and the rest) serve the earlier
agents work, the Hyperliquid readings and the Chrome extension.

## Worker loops

`worker.py` runs six loops in one process: `te_cost_loop` (the cost refresh,
only with `TE_COST_ENABLED=1`), `vaults_loop` (only with `HELIUS_API_KEY` set,
or `VAULTS_COLLECTOR_ENABLED=1`), and four for the agent registries
(`audit_loop`, `ingest_loop`, `analysis_loop`, `budget_index_loop`). The
Hyperliquid WebSocket collector is a separate service (`scripts/hl_ws_collect.py`,
in `../render.yaml`).

## Layout

| Path | What it holds |
|---|---|
| `server.py`, `worker.py` | The two entry points |
| `core/te/` | Tokenized equities: universe, pools, the swap probe and cost engine, LI.FI quotes, order preparation, signing links, holdings, Aave V4 |
| `core/vaults/` | Vault reads: Kamino, Voltr and GLAM on Solana, and the Hyperliquid evidence |
| `te/`, `te_api/`, `vaults/` | The routers above |
| `mcp_server/` | The MCP server: protocol, tools, dataset registry, response envelope |
| `core/` (other modules), `adapters/` | Agent registries, jobs, budgets, Hyperliquid, the extension's filter, rate limits |
| `data/` | Static data files served by the web service |
| `scripts/` | Selfchecks and build scripts, each with its usage in its first lines |
| `telegram_bot/` | A Telegram webhook route (`POST /api/telegram/webhook`); it answers nothing unless its token and secret are set |

## Running and checking

See [Running it locally](../README.md#running-it-locally) and
[Selfchecks](../README.md#selfchecks) in the root README. `.env.example` lists
the basic variables; keys are never committed.
