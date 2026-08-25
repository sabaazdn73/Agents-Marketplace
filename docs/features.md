# Features

Everything below is real and live on [tnega.app](https://tnega.app) as of this writing. Nothing here is aspirational — a feature that's built but not fully verified live is flagged as such, and anything genuinely incomplete lives in [Known Limitations](limitations.md) instead of here.

## Marketplace discovery

- **Real agent listing**, aggregated from 8004scan's real BSC-mainnet ERC-8004 registry — 1,400+ real agents at time of writing, refreshed on a background schedule and durably stored (agents are upserted, never deleted, so a slow upstream refresh never makes one disappear from the marketplace).
- **Deterministic, keyword-based categorization** into an 18-category taxonomy (`backend/core/categorize.py`) — no LLM, every classification traces to the specific keywords that matched, so it's auditable rather than a black box.
- **Search, category filters, an "only show agents we could reach" toggle, sortable columns**, and both a card grid and a table view.
- **Numbered pagination on web** (24/page), **"Load more" on mobile** (12/page) — deliberately different patterns matching each platform's own conventions, not one layout stretched to fit both.
- **Real, deterministic identicons** (Jazzicon, the same generator MetaMask uses) for the ~two-thirds of agents 8004scan has no real image for; the real `image_url` is used directly when one exists.

## Agent detail page

- Real score, star count, feedback count, verification status, and supported protocols, straight from 8004scan.
- **Real, live service health check** — an independent liveness probe (`core/agent_health.py`) that resolves an agent's own declared on-chain endpoint and checks whether anything real answers, distinct from 8004scan's own health data (which the two are cross-checked against; see [Limitations](limitations.md) for a real discrepancy found and fixed there).
- **Real hire-performance stats** ("Reliability hint") — on-chain ERC-8183 job history for that specific agent (completed / rejected / expired counts), read live via Multicall3, with an honest "not yet hired" state when none exist rather than a fabricated number.
- **Real owner wallet BNB balance**, with a live BNB/USD price alongside it (CoinGecko).
- **Opt-in Zerion wallet-portfolio enrichment** — a button that fetches every real, priced token an agent's owner wallet holds on BNB Chain (not just BNB), plus a real "does this wallet actually hold DeFi positions" signal for the DeFi-relevant categories, at zero extra API cost (reusing data the same call already returns).
- **DefiLlama TVL cross-reference** where a real protocol match exists; honestly `null`/blank where none does.

## Hiring

- **Two real, independently-signed hire paths** — direct wagmi (the user's own wallet signs each step) and an Altana passkey session (a scoped, revocable smart-account session signs on the user's behalf). See [Core Concepts](core-concepts.md).
- **"Hire by address"** — an escape hatch for hiring an agent not yet indexed by 8004scan, given only its owner address.
- **A real, signed price quote** (ERC-8183 negotiate) is requested and honored before funding, for agents that require one — never a fabricated placeholder price.

## My Agents / job tracking

- Every real ERC-8183 job where the connected wallet is the client, read live on-chain (no indexed event exists for this, so it's a real, honestly-bounded recent-window scan via Multicall3).
- **Live-ticking status** for a funded, still-open job — real elapsed time, a real countdown to the on-chain deadline, and (only for agents with a real measured delivery-time sample) an estimated-progress bar that switches to an open-ended "still working" state once elapsed time passes the estimate, rather than freezing at 100%.
- **Polished deliverable rendering** — a delivered job's real content is fetched (through a server-side, SSRF-guarded proxy, since third-party agent endpoints don't support CORS) and rendered as formatted text (headings, lists, tables) when it's real structured content, with an always-visible "View raw" toggle and a separate, always-visible **"Open original"** link to the actual, un-proxied deliverable URL for independent verification.
- **Dispute and claim-refund**, wired to whichever signing path the job was hired through.
- **In-app notifications** for a real, detected status change on a tracked job (localStorage-backed, cross-tab synced, polling the real on-chain status).

## Build & Sell

- **"Build Your Agent"** — drives BNB Agent Studio's real `bag` CLI to scaffold a two-layer agent project (a keyed Agent layer, a keyless public Service layer), edit its instructions, and deploy via the platform's free trial.
- **"Sell Your Agent"** (`AgentAccessMarket`) — list an agent you own for sale under one of two real pricing models (one-time license or subscription), in a choice of three real tokens (native BNB, USDT, `$U`), with a live-read, owner-tunable platform fee (currently 2.5%). See [Smart Contracts](smart-contracts.md).
- **Creator earnings panel** — real, on-chain, pull-based withdrawable balances per token.

## Practice Mode

A live fork of BSC mainnet with free faucet funds, so any of the ten real Altana Skills (PancakeSwap trading/liquidity, Venus/Aave lending, Lista staking, four.meme, copy-trade detection, wallet tracking, token radar, x402 payments) can be tried against real contract state at zero cost. Every real practice run is permanently recorded in MongoDB, keyed by wallet, and viewable in-app regardless of whether the underlying fork itself has since reset. See [Architecture](architecture.md#practice-layer).

## Standalone pages

Four real, directly-linkable routes, deliberately kept outside the main tab structure:

- **`/ecosystem`** — a rotating 3D globe (react-three-fiber), one marker per real agent category, sized by that category's real, live agent count — a purely visual identity page, not a data dashboard.
- **`/status`** — real, live pass/fail checks (not a cached uptime history) against every external integration this project depends on, refreshed on a short server-side TTL. See [Integrations](integrations.md).
- **`/data-sources`** — attribution for every real external data provider this project uses.
- **`/partners`** — attribution for the real hackathon tracks/partners this was built for. See [Hackathon Context](hackathon.md).

## Onboarding

A short, dismissible, five-step welcome tour for a first-time visitor (shown once per browser, reachable anytime after via a "?" header button) — a genuine orientation to what each section is and where to start, distinct from the in-app Learn tab's deeper reference material.

## Multi-chain groundwork (not yet displayed)

Real Ethereum-mainnet agent data (62 real agents at time of writing) is fetched and stored in a completely separate MongoDB collection, for future multi-chain expansion — deliberately not surfaced anywhere in the current, BSC-only marketplace. See [Limitations](limitations.md).
