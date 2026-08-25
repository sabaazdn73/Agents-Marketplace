# Architecture

## System overview

Tnega has four real, separately-deployed pieces: a React frontend (one codebase, two responsive apps), a FastAPI backend, a MongoDB store, and a self-hosted Anvil fork for the Practice Layer. A fifth service — a real "explainer agent" listed in the marketplace itself — is an independently-deployed ERC-8004/ERC-8183 seller agent used to demonstrate the real hire flow end to end.

```mermaid
flowchart TB
    subgraph Client["Browser"]
        Web["Web app<br/>(sidebar layout)"]
        Mobile["Mobile app<br/>(bottom-nav layout)"]
    end

    subgraph Wallets["Client-side signing — no key ever leaves the browser"]
        Wagmi["wagmi / RainbowKit / Privy<br/>(direct EOA signing)"]
        Altana["Altana passkey wallet<br/>(Face ID / WebAuthn, on-chain sessions)"]
    end

    Backend["FastAPI backend<br/>Render Web Service"]
    Mongo[("MongoDB Atlas")]
    Fork["Practice fork<br/>Anvil + gateway, Render Docker service"]
    Chain["BSC mainnet (chain 56)"]
    Explainer["explainer-agent<br/>a real ERC-8004/8183 seller, Render service"]

    Client --> Wallets
    Client -- "reads: agents, status, deliverables" --> Backend
    Wallets -- "writes: hire, dispute, claim, list, buy" --> Chain
    Backend --> Mongo
    Backend -- "admin door, funding only" --> Fork
    Client -- "public door: reads + eth_sendRawTransaction" --> Fork
    Fork -. "forks live state from" .-> Chain
    Backend -- "server-side proxy (CORS)" --> Explainer
    Explainer -- "submits real deliverables to" --> Chain
```

**The one rule that shapes everything else:** reads flow through the backend (or straight to chain via a public RPC); anything that moves value is signed in the browser. The backend never holds a private key, and the Practice fork's fund-granting admin door sits behind a shared secret only the backend knows.

## Frontend

One Vite/React codebase, two real, separately-designed UIs sharing the same backend and the same core logic:

- `AgentMarketplaceApp.web.jsx` — a sidebar-navigation layout for desktop.
- `AgentMarketplaceApp.mobile.jsx` — a bottom-nav, single-column layout for mobile viewports.

`App.jsx` picks between them at a 768px breakpoint (`window.innerWidth`), and also handles a small set of standalone routes outside the tab structure — `/ecosystem`, `/status`, `/data-sources`, `/partners` — via a plain `pathname` check (no router library; see [Features](features.md) for what each page does). These are genuinely separate, deep-linkable URLs, not tabs.

Shared logic lives in plain `.js`/`.jsx` modules imported by both apps — the hire flow (`useHireAgent.js`), the Altana SDK wrapper (`altana.js`), job status + deliverable rendering (`JobStatusPanel.jsx`), notifications, wallet-portfolio enrichment, and more — so web and mobile never silently diverge on how a real transaction gets built or a real job gets read.

## Backend

A FastAPI service (`backend/server.py`) that does three real jobs:

1. **Aggregates and serves agent data.** `GET /api/agents` serves instantly from a MongoDB-backed store (`core/agent_store.py`), refreshed in the background from 8004scan + DefiLlama + a real on-chain BNB balance read — never blocking a page load on a live upstream fetch.
2. **Proxies a handful of real, CORS-blocked or archive-RPC-gated reads** that a browser can't make directly — deliverable content fetches, ERC-8183 negotiate/notify-funded calls, and the Practice fork's method-filtered RPC door.
3. **Drives the Practice Layer and the "Build Your Agent" pipeline**, both of which need server-side state (funding secrets, a running build process) a browser can't hold.

The full, current list of real routes is in [Getting Started](getting-started.md#real-backend-routes).

## Data layer

**MongoDB** (one Atlas deployment, several collections):
- `known_agents` — the durable agent store `GET /api/agents` serves from (never deleted, only upserted, so a slow/rate-limited 8004scan refresh never makes agents disappear).
- `practice_runs` — every real Practice Mode execution, keyed by wallet.
- `explainer_deliverables` — a durable mirror of the explainer-agent's own delivered content (see [Limitations](limitations.md) for why this exists — Render's free-tier disk is ephemeral, so this collection is what survives a restart).
- `future_multichain_agents` — real Ethereum-mainnet agent data collected for future multi-chain expansion, deliberately isolated from `known_agents` and never read by any live-serving route (see [Limitations](limitations.md)).

## Practice Layer

A self-hosted Anvil fork of live BSC mainnet, packaged as one public Render Docker Web Service (`anvil/Dockerfile`), so anyone can run a real hire or a real DeFi skill against real contract state with free faucet funds — zero cost, zero risk.

```mermaid
flowchart LR
    Browser -- "public door: eth_* reads + eth_sendRawTransaction" --> Gateway
    Backend -- "authenticated /admin/rpc: anvil_* cheats, funding only" --> Gateway
    Gateway["gateway.py<br/>(stdlib, method allow-list)"] --> Anvil["Anvil<br/>bound to 127.0.0.1 only"]
    Anvil -. "forked from" .-> Mainnet["BSC mainnet"]
```

Inside the container, Anvil binds `127.0.0.1:8545` only — never public. A small stdlib gateway (`anvil/gateway.py`) is the only thing on the public port, with two doors: a **public door** that forwards only safe, allow-listed methods (plain `eth_*` reads plus `eth_sendRawTransaction`), refusing any `anvil_*`/`hardhat_*`/`evm_*` admin cheat with a 403; and an **authenticated door** (`/admin/rpc`, gated on a shared-secret `X-Admin-Key`) that the backend alone uses to fund a practice wallet (native BNB via `anvil_setBalance`; ERC-20s via whale impersonation, since Anvil has no native `setErc20Balance`).

The free tier has no persistent disk, so the fork re-forks fresh from the latest real block on every restart/idle-spindown — in-fork positions reset, but that's a different, permanent record: every real practice run is written to MongoDB the moment it happens, so a user's own history survives a fork reset even though the fork's on-chain state doesn't.

## Smart contracts

Three real, independent on-chain systems Tnega reads and writes:

- **ERC-8004 identity registry** — every agent's on-chain identity.
- **ERC-8183 commerce** (Commerce / Router / Policy) — the hire/escrow kernel.
- **AgentAccessMarket** — Tnega's own contract for selling ongoing access to an agent.

Full addresses, ABIs-in-spirit, and what each function does are in [Smart Contracts](smart-contracts.md).
