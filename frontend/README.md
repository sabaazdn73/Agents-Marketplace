# Frontend

The site at [www.tnega.app](https://www.tnega.app): Vite and React, deployed on
Vercel (`vercel.json` carries the headers, including the Content-Security-Policy
whose script hash `npm run check:csp` verifies).

## Pages

The header's pages are defined in `src/shell/productNav.js`; paths and
redirects in `src/routePaths.js`.

| Path | Code |
|---|---|
| `/` | `src/pages/Home.jsx`, `src/home/` |
| `/stocks`, `/stocks/<ticker>` | `src/pages/Stocks.jsx`, `src/stocks/`; the Buy and Sell tabs in `src/trade/` (LI.FI quote, approval and swap, signed in the user's wallet) |
| `/issuer-controls` | `src/pages/IssuerControls.jsx`, `src/controls/` |
| `/vaults` | `src/pages/Vaults.jsx`, `src/vaults/` |
| `/my-etfs` | `src/pages/MyEtfs.jsx`, `src/etfs/`, `src/baskets/` (the basket encoded in the link) |
| `/dashboard` | `src/pages/Dashboard.jsx`, `src/dashboard/`, `src/wallet/` |
| `/ai` | `src/pages/UseWithAi.jsx` |
| `/sign/<id>` | `src/sign/`: the signing page for an order prepared through MCP |
| `/docs` | `src/DocsPage.jsx`, which renders `../docs/*.md` |
| `/market`, `/chain/<view>` | Explore agents and the Hyperliquid readings (earlier work): `AgentMarketplaceApp.web.jsx` and `.mobile.jsx`, `src/chainViews/` |

The tokenized-equity API calls and their response shapes are in `src/te/api.js`.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

- `VITE_API_BASE_URL` defaults to `http://localhost:8000` (the backend run locally).
- `TE_API=https://agents-marketplace-q3k4.onrender.com npm run dev` points the
  tokenized-equity reads at the live API, in the dev server only.
- `VITE_TE_FIXTURES=1` serves recorded API answers from `src/te/fixtures/`, in
  the dev server only.
- `VITE_WALLETCONNECT_PROJECT_ID` is needed for wallet connection.

`npm run build` runs `check:chains` (contract addresses per chain) and
`check:csp` (the CSP script hash) before `vite build`. Other checks are in
`scripts/` and run with `node scripts/<name>.mjs`.
