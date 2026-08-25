# Hackathon Submission Context

Built for BNB Chain's **"Smart Money Era"** hackathon. This page is for judges' reference — the real tracks and partners this project engages with, and honestly, how.

The same attribution is live in-app at [`/partners`](https://tnega.app/partners).

## BNB Chain / BNB Agent Studio

The platform this project is built *for*. Every real transaction runs on BSC mainnet (chain 56) — no testnet deployment anywhere user-facing. The "Build Your Agent" flow drives BNB Agent Studio's real `bag` CLI pipeline directly, and the two BNB-Chain-originated agent-economy standards, **ERC-8004** (identity) and **ERC-8183** (commerce), run through the entire product, not just one feature.

## TermiX

Credited as a real, active ecosystem participant: **TermiX's AACP** (Autonomous Agent Capital Protocol) is the real identity/commerce protocol a large share of the agents actually registered in this marketplace use — a real, measured majority of BSC's live ERC-8004 registry is TermiX-originated agents. Tnega indexes and de-duplicates them like any other real agent (a real, necessary step — without de-duplication, one mass-registration campaign can dominate the whole marketplace listing). This is a real data relationship, not a formal API partnership or an integration TermiX built for this project specifically.

The track's own rubric separately asks for a real, same-task comparison report (an agent hired through this marketplace vs. doing the same task by hand, with time/cost/quality and real outputs attached, at least one task from trading/stock/security). That report is real and live today, on the in-app **Advantage Report** tab — see [Features](features.md#advantage-report) for its real, current, honestly-labeled status (2 of 3 tasks complete; the third is genuinely blocked on an external data provider, stated as such rather than hidden or estimated).

## PancakeSwap

Real, at the skill level: two of the ten Altana Skills this project ships (`pancakeswap-trading`, `pancakeswap-liquidity`) interact directly with real, live PancakeSwap contracts, and were executed on the Practice fork with real, verified before/after balance changes. A technical integration, not a formal partnership.

## Altana

The most extensive real integration in this project — `@altananetwork/sdk` powers the passkey wallet, on-chain scoped/revocable sessions, the full ten-skill Skills Registry, x402 payments, and the Altana-session hire path. See [Core Concepts](core-concepts.md#altana-sessions-account-abstraction-layer) and the honest note on real usage in [Known Limitations](limitations.md#altana-passkey-session-hiring--built-and-correct-but-never-used-by-a-real-completed-hire).

## AltLayer (8004scan)

Credited for building **8004scan**, the real ERC-8004 registry indexer this project's entire agent-discovery layer is built on — every agent listed in Tnega comes from a real, live 8004scan query. See [Integrations](integrations.md#8004scan).

## What was deliberately not built

In the same spirit as the rest of this documentation: two things considered and explicitly not pursued, stated honestly rather than left unmentioned.

- **The Binance Pay Merchant API** (QR/deeplink checkout) — a real **B402 Bazaar** opt-in was built instead (a spec-accurate discovery blob attached to x402 settlements, matched field-for-field against Binance's own real B402 Bazaar documentation), which is the lighter-weight, more relevant integration for an agent-to-agent commerce product. The heavier Merchant API checkout flow was a deliberate scope decision, not an oversight.
- **Paid infrastructure of any kind.** This project runs entirely on free tiers (Render, MongoDB Atlas free tier, free API keys) as a standing rule. Every real limitation this creates — CoinGecko rate-limiting, BscScan's paid-only BSC coverage, the Practice fork's ephemeral disk — is documented plainly in [Known Limitations](limitations.md) rather than hidden.
