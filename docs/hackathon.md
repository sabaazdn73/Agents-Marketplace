# Hackathon Submission Context

Built for BNB Chain's **"Smart Money Era"** hackathon. This page is for judges' reference: the tracks and partners this project engages with, and honestly, how.

The same attribution is live in-app at [`/partners`](https://tnega.app/partners).

## BNB Chain / BNB Agent Studio

The platform this project is built *for*. Every transaction runs on BSC mainnet (chain 56); no testnet deployment anywhere user-facing. The "Build Your Agent" flow drives BNB Agent Studio's `bag` CLI pipeline directly, and the two BNB-Chain-originated agent-economy standards, **ERC-8004** (identity) and **ERC-8183** (commerce), run through the entire product, not just one feature.

## TermiX

Credited as an active ecosystem participant: **TermiX's AACP** (Autonomous Agent Capital Protocol) is the identity/commerce protocol a large share of the agents actually registered in this marketplace use; a measured majority of BSC's live ERC-8004 registry is TermiX-originated agents. Tnega indexes and de-duplicates them like any other agent (a necessary step: without de-duplication, one mass-registration campaign can dominate the whole marketplace listing). This is a data relationship, not a formal API partnership or an integration TermiX built for this project specifically.

The track's own rubric separately asks for a same-task comparison report (an agent hired through this marketplace vs. doing the same task by hand, with time/cost/quality and outputs attached, at least one task from trading/stock/security). That report is live today, on the in-app **Advantage Report** tab; see [Features](features.md#advantage-report) for its current, plainly-labeled status (all 3 tasks complete; the manual comparison for Task 2 is explicitly labeled an estimate rather than an independently timed measurement, never blurred together with the agent's own block-timestamp-measured number).

## PancakeSwap

Real, at the skill level: two of the ten Altana Skills this project ships (`pancakeswap-trading`, `pancakeswap-liquidity`) interact directly with live PancakeSwap contracts, verified with checked before/after balance changes. The Native Agent Marketplace's own Trading Agent reuses the same real router contract for spot buys, with Tnega's own added risk-signal logic on top. A technical integration, not a formal partnership.

## Altana

The most extensive integration in this project: `@altananetwork/sdk` powers passkey wallet creation/recovery, the full ten-skill Skills Registry, x402 payments, and the on-chain passkey-secured-wallet badge. Its spend-capped session/"Autonomous" execution path was removed 2026-09-03 after a decisive check found it had never been used by a real, completed transaction; see the note in [Known Limitations](limitations.md#altana-passkey-session-hiring-removed-2026-09-03) for the full finding.

## AltLayer (8004scan)

Credited for building **8004scan**, the ERC-8004 registry indexer this project's entire agent-discovery layer is built on; every agent listed in Tnega comes from a live 8004scan query. See [Integrations](integrations.md#8004scan).

## What was deliberately not built

In the same spirit as the rest of this documentation: two things considered and explicitly not pursued, stated plainly rather than left unmentioned.

- **The Binance Pay Merchant API** (QR/deeplink checkout): a **B402 Bazaar** opt-in was built instead (a spec-accurate discovery blob attached to x402 settlements, matched field-for-field against Binance's own B402 Bazaar documentation), which is the lighter-weight, more relevant integration for an agent-to-agent commerce product. The heavier Merchant API checkout flow was a deliberate scope decision, not an oversight.
- **Paid infrastructure of any kind.** This project runs entirely on free tiers (Render, MongoDB Atlas free tier, free API keys) as a standing rule. Every limitation this creates, CoinGecko rate-limiting, BscScan's paid-only BSC coverage, is documented plainly in [Known Limitations](limitations.md) rather than hidden.
