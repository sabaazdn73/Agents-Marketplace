# Tnega

Live: [https://www.tnega.app](https://www.tnega.app) · Docs: [docs/](docs/README.md), also on the site at [/docs](https://www.tnega.app/docs)

Tnega lists the tokenized versions of stocks and ETFs across chains and
measures what each one costs to buy. The same share is issued as separate
tokens by different issuers on different chains, each in its own pools with its
own depth and fees. Tnega simulates the purchase on each version's pools at a
range of order sizes and shows the results side by side.

Tnega never holds funds or a user's keys and never signs a transaction. A purchase or a sale is signed
by the user, in their own wallet, or nothing happens. Everything on the site is
a measurement, not a recommendation. Tnega is in its proof-of-concept phase and
is not yet commercial.

As of 1 October 2026 at 14:51 UTC, the live API's `/api/te/summary` reported
1,378 stocks and ETFs in 7,279 tokenized versions, from 5 issuers (xStocks,
Ondo, Robinhood, bStocks and Coinbase) on 7 chains (Ethereum, Base, Arbitrum,
BNB Chain, Robinhood Chain, HyperEVM and Solana; universe read on 26 September
2026), and 118 versions with a measured cost to buy $1,000 (cost records up to
14:48 UTC). These figures move; the site and the API carry the current ones.

## What is on the site

| Page | What it shows |
|---|---|
| [Stocks & ETFs](https://www.tnega.app/stocks) (`/stocks`, `/stocks/<ticker>`) | Every version of a stock or ETF and, where a pool was measured, its all-in price per share at sizes from $100 to $250,000 (only EVM versions are measured; Solana versions are listed): pool price, price impact, network fee, L1 fee where there is one, and LI.FI's 0.25% fee. A stock's page has Details, Buy and Sell tabs; Buy and Sell are on for Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and HyperEVM, quoted by LI.FI in the browser and signed in the user's wallet. A version with no measured pool price is refused; on 1 Oct 2026 at 14:49 UTC no Arbitrum or HyperEVM version had one, so none can be bought or sold there yet (`/api/te/summary` `cost.by_chain`). For Base versions, whether the Aave V4 Equities Hub accepts the token as collateral and at what maximum LTV, read on chain at a stated block. [Docs](docs/stocks-and-etfs.md) |
| [Issuer controls](https://www.tnega.app/issuer-controls) | Who can pause, freeze, burn or seize, upgrade or mint each token, read from the contract with the block it was read at; who may hold it, in the issuer's own words, linked and dated. [Docs](docs/issuer-controls.md) |
| [Vaults](https://www.tnega.app/vaults) | Vaults that take a stablecoin deposit, with their admin, timelock, what they lend against and total value, from chain reads. Deposits happen on each vault's own venue. [Docs](docs/vaults.md) |
| [My ETFs](https://www.tnega.app/my-etfs) | Baskets of up to five stocks or ETFs priced by the same cost engine, shared as a link; nothing is stored. [Docs](docs/my-etfs.md) |
| [Dashboard](https://www.tnega.app/dashboard) | What a connected wallet holds on six EVM chains: total, allocation by class and every position, read on chain. [Docs](docs/dashboard.md) |
| [Use with AI](https://www.tnega.app/ai) | The MCP server: nine tools that read every measurement above and prepare a buy or sale for the user to sign on a `tnega.app/sign/…` page. [Docs](docs/use-with-ai.md), [step by step](docs/buy-with-your-assistant.md) |

## How it is built

- **Frontend**: Vite and React in [`frontend/`](frontend/README.md), deployed on
  Vercel. Wallet connection through wagmi and RainbowKit; trade routes from
  LI.FI, requested by the browser.
- **Backend**: FastAPI in [`backend/`](backend/README.md), on Render as a web
  service (`server.py`: the REST API under `/api/*` and the MCP server at
  `POST /mcp`) and a background worker (`worker.py`: the cost refresh, the
  vault reads and the agent-registry loops). Stores are MongoDB and, for the
  Hyperliquid series, CockroachDB.
- **Data**: chain reads come first. Costs are swaps simulated on each pool by
  the `TnegaSwapProbe` contract inside `eth_call` at a pinned block on public
  RPC endpoints; it is never deployed and nothing is sent. Issuer controls,
  supply and Aave V4 collateral are chain reads; eligibility is the issuer's own
  terms, linked and dated. Vaults are read on Solana through Helius. LI.FI
  supplies the quote at buying time. Every source is listed in
  [Data sources](docs/data-sources.md) and on the site's
  [Data sources page](https://www.tnega.app/data-sources).
- **MCP server**: `https://agents-marketplace-q3k4.onrender.com/mcp`, JSON-RPC
  over POST, no key. `npx tnega-mcp` adds it to a client
  ([mcp/npm](mcp/npm/README.md)). Tools and datasets:
  [MCP tools](docs/mcp-tools.md).

## Repository

| Path | What it holds |
|---|---|
| [`frontend/`](frontend/README.md) | The site (Vite, React); also the docs viewer, which renders `docs/*.md` |
| [`backend/`](backend/README.md) | API, MCP server, worker loops, selfcheck scripts and the static data files |
| [`contracts/`](contracts/README.md) | Solidity (Foundry): the swap probe used by the cost engine, and the contracts of the earlier agents work |
| [`docs/`](docs/README.md) | The documentation shown at `/docs`; earlier pages are kept under Archive in [`docs/SUMMARY.md`](docs/SUMMARY.md) |
| [`mcp/`](mcp/) | The npm package `tnega-mcp` ([`mcp/npm/`](mcp/npm/README.md)) and the design notes written before the MCP server was built ([`DESIGN.md`](mcp/DESIGN.md), [`TOKENIZED-EQUITIES.md`](mcp/TOKENIZED-EQUITIES.md)) |
| [`extension/`](extension/) | The Chrome extension (Manifest V3) |
| [`extension-store/`](extension-store/) | The extension's store listing, screenshots and `build.py`, which packages it |
| [`test/`](test/) | Standalone Node and Python checks for the extension's practice-mode simulator and two agent measurements |
| [`explainer-agent/`](explainer-agent/README.md) | Earlier work: a BNB Agent Studio seller agent; see its README |
| [`reference-agent/`](reference-agent/README.md) | Earlier work: the reference drawer for drawable budgets; see its README |
| [`render.yaml`](render.yaml) | Render Blueprint for two standalone services (the explainer agent and the Hyperliquid WebSocket collector); the API web service and the worker are configured on Render directly |

## Running it locally

Backend (from `backend/`):

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
cp .env.example .env
./venv/bin/uvicorn server:app --reload --port 8000
./venv/bin/python worker.py        # the background loops, in a second shell
```

The API reads MongoDB through `MONGODB_URI` and `MONGODB_DB_NAME`. The
tokenized-equity cost store can be a local folder instead
(`TE_COST_STORE=file:<dir>`), and the vault store a local file
(`VAULTS_STORE_FILE=<file>`). The worker's cost refresh runs only with
`TE_COST_ENABLED=1`, and the vault reads only with `HELIUS_API_KEY` set (or
`VAULTS_COLLECTOR_ENABLED=1`). Other variables the code reads include
`LIFI_API_KEY`, `SIGN_LINK_SECRET`, `QUICKNODE_ENDPOINT` and `QUICKNODE_TOKEN`;
`backend/.env.example` lists the basic set. Keys are never committed.

Frontend (from `frontend/`):

```bash
npm install
cp .env.example .env
npm run dev
```

`VITE_API_BASE_URL` defaults to `http://localhost:8000`. To read the
tokenized-equity data from the live API in a dev server instead, start it with
`TE_API=https://agents-marketplace-q3k4.onrender.com npm run dev`. Wallet
connection needs `VITE_WALLETCONNECT_PROJECT_ID`. `npm run build` runs two
selfchecks (`check:chains`, `check:csp`) before `vite build`.

Extension: load `extension/` unpacked in Chrome, or package it with
`python3 extension-store/build.py --out <folder>`.

Contracts (from `contracts/`): see [contracts/README.md](contracts/README.md).

## Selfchecks

The backend's checks are scripts in `backend/scripts/`, run from `backend/`,
each with its usage in its first lines. The main ones:

| Script | Checks |
|---|---|
| `mcp_selfcheck.py` | The MCP surface: tool descriptions, the response envelope and caps, and each dataset (`MCP_SELFCHECK_SKIP` skips named datasets) |
| `te_universe_selfcheck.py` | The tokenized-equity universe file against its definition and, unless `--no-chain`, against the chain |
| `te_cost_selfcheck.py` | The cost engine and the probe bytecode's hashes (`--fresh` for new quotes) |
| `baskets_selfcheck.py` | Basket pricing from stored costs |
| `sign_selfcheck.py` | The order path: signing links, prepared orders, the signing page's routes and the MCP order tools (offline; `--live` adds one LI.FI quote) |
| `wallet_holdings_selfcheck.py` | `POST /api/wallet/holdings` on recorded chain answers (`--live` on the chains) |
| `aave_v4_selfcheck.py` | The Aave V4 collateral reads on Base |
| `vaults_list_selfcheck.py`, `vaults_selfcheck.py` | The cached vault list against the uncached one; one stored vault re-read on chain |
| `rate_limit_selfcheck.py`, `body_cap_selfcheck.py` | Request limits |

For example: `TE_COST_STORE=file:<dir> ./venv/bin/python scripts/baskets_selfcheck.py`.

## Earlier work

Tnega started as a marketplace for on-chain agents on BNB Chain. Those parts
are still live, reached from the site's footer rather than its main
navigation, and are not the product's focus:

- **Explore agents** ([`/market`](https://www.tnega.app/market)): the ERC-8004
  agent registries read on BNB Chain, Ethereum, Solana, Arbitrum, Robinhood
  Chain and Monad, with hiring through ERC-8183 escrow on BNB Chain or a funded
  budget (AgentBudgetEscrow) on BNB Chain, Arbitrum and Robinhood Chain.
  [Docs](docs/onchain-agents.md), [deployed contracts](docs/deployments.md).
- **Hyperliquid order-book readings**
  ([`/chain/hyperliquid`](https://www.tnega.app/chain/hyperliquid)): how often
  post-only orders are refused instead of resting, per market and per maker.
  The footer marks the WebSocket collector as suspended since 19 September
  2026. [Docs](docs/hyperliquid-order-book.md).
- **Chrome extension**
  ([Chrome Web Store](https://chromewebstore.google.com/detail/tnega/dimmedbfoejeemojaenbknpcmjgomipk)):
  a panel with these readings on Hyperliquid, 8004scan and seven block
  explorers, and a practice mode on Hyperliquid's trading pages that places
  pretend trades against Hyperliquid's live public prices; no order is sent.
  [Docs](docs/hyperliquid-extension.md).

Pages describing the earlier work as it was when written (agent studio, native
agents, budgets and escrow, hackathon entries) are under Archive in
[`docs/SUMMARY.md`](docs/SUMMARY.md); [`ETHGLOBAL-ONLINE-2026.md`](ETHGLOBAL-ONLINE-2026.md)
is the milestone timeline written for that entry.

## Licence and notices

MIT, see [LICENSE](LICENSE). Third-party dependencies and their terms are in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Data sources and their terms
are described in [docs/data-sources.md](docs/data-sources.md).
