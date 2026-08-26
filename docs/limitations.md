# Known Limitations (Honest)

This project's whole development process has run on one rule: never hide a real gap. This page is that rule applied to the documentation itself.

## BSC mainnet only, by design

Every user-facing part of Tnega — the marketplace, the hire flow, Sell Your Agent — is scoped to BSC mainnet (chain 56). This is a deliberate scope decision, not an oversight, but it's worth being explicit about: agents registered on other chains ERC-8004 covers (Ethereum, Base, Arbitrum, and others) are not shown here.

Real groundwork exists for expanding this: a separate background job fetches and durably stores real Ethereum-mainnet agent data (62 real agents at time of writing) into its own MongoDB collection, `future_multichain_agents` — deliberately isolated from the live-serving `known_agents` collection and never read by any route the frontend calls, so this cannot leak into the current BSC-only display even accidentally. It's a real, verified starting point for future multi-chain work, not yet a feature.

**Solana is not planned** — a real, direct check (5,000 sampled records across 8004scan's full registry, no chain filter) found `chain_type` was `"evm"` on every single one. ERC-8004 is an EVM-only standard; there is no non-EVM registry to index.

## Altana passkey-session hiring — built and correct, but never used by a real completed hire

The direct-wagmi hire path has real, confirmed usage. The Altana passkey-session path is fully built, its on-chain call shapes are verified against the installed SDK, and its passkey/KeyStore mechanics are verified by reading the real SDK source — but a real, complete scan of every ERC-8183 job this marketplace's kernel has ever processed (all of them, not a sample) found **zero** jobs whose description matches this path's real hire signature. That means no real, funded hire has gone through this specific flow yet, only the direct-wagmi path.

This doesn't mean the code doesn't work — it means it hasn't yet been exercised by a real transaction, which is a meaningfully different, more honest claim than "verified."

## Domain-move consequence for existing passkeys (if any)

This project moved from an earlier Vercel subdomain to `tnega.app`. WebAuthn passkeys are cryptographically scoped to the domain (`rpId`) they were created under, by the browser/OS itself — not by anything this codebase controls. Combined with the point above (no real completed hire has used this path yet), real exposure here is effectively nil, but it's a genuine, permanent characteristic of passkey-based wallets worth stating plainly: a passkey created under an old domain will not be discoverable under a new one, and the account isn't recoverable through that passkey afterward. There is no code fix for this — it's how WebAuthn is designed to work.

## CoinGecko rate-limiting on shared infrastructure

The BNB/USD price feature depends on CoinGecko's free, anonymous API tier, which is IP-scoped. This project's Render deployment shares an outbound IP range with other tenants, and does genuinely get rate-limited (`HTTP 429`) at times as a result — visible honestly on [`/status`](https://tnega.app/status) when it happens rather than silently failing. This is a real, structural limitation of using a free, shared-infrastructure tier, not a bug that can be "fixed" without either a paid CoinGecko plan (against this project's own no-paid-infrastructure rule) or dedicated infrastructure.

## BscScan — configured but not wired for real data

A real BscScan API key is present in this project's configuration, but was deliberately never wired into any live feature: BscScan's legacy API is deprecated, and the current, unified Etherscan API requires a **paid plan for BSC coverage specifically** (confirmed live — the same key works fine against Ethereum's free tier, isolating this as a BSC-specific paid gate). BscScan is used only as a real block-explorer link target in the UI, never as a data source.

## Practice Mode — removed

This project previously included a Practice Layer: a self-hosted Anvil fork of live BSC mainnet, so users could try any agent/Skill with free faucet funds before spending anything real. It was fully removed 2026-08-26 — a real, deliberate product decision, not an oversight: the fork ran on Render's free tier with no persistent disk, re-forking fresh (and occasionally landing in a genuinely unreliable state) on every restart or idle spin-down, and that repeated infrastructure instability risked giving a fake/unreliable impression that outweighed the real trust value of a "try before you spend" sandbox. Every real Skill still runs for real, with a real, user-set spending limit — see [Features](features.md#altana-skills).

## Platform-wide zeros that are honest, not bugs

Two stats currently read as zero across the entire live marketplace: **is_verified** (zero real agents are marked verified anywhere in 8004scan's registry, across every chain it indexes — a genuine, platform-wide state, confirmed by direct sampling, not a wiring gap on this project's side) and **reviews** (zero real feedback exists for any BSC agent specifically — real feedback does exist elsewhere in 8004scan's registry, on a different chain, just not on BSC yet). Both are reported as real, honest zeros rather than forced into showing something.

## DeFi-specific category representation — thin, but real and improving

The four DeFi-specific categories `core/categorize.py` was originally built around (Rebalancing, Grid Trading, Yield Optimisation, Health Factor Monitoring) are genuinely thin in the live registry relative to the marketplace's ~1,500 total agents — most real agents fall into broader categories (Research, Trading Signals, Smart Contract Auditing) instead. This was a harder, real gap earlier in this project's life (Grid Trading specifically had zero matching real agents in the sample available at the time). Checked fresh: all four now have genuine, non-zero real representation (Grid Trading included), helped in part by later re-classifying previously-Unclassified agents against 8004scan's richer per-agent data once Pro-tier access made that affordable to do for every refresh. Still real, still thin — not claimed as solved, just no longer a hard zero.

## x402 pay-per-call — configuration only

The x402 pay-per-call pricing model on AgentAccessMarket saves a creator's configuration (including a spec-accurate B402 Bazaar discovery blob), but wiring a creator's actual endpoint as a live x402 resource is the creator's own deployment step outside this project's control. Real settlement through this path has not been exercised end to end.

## Zerion — a real, confirmed coverage gap

Tnega's own bStock tokens (tokenized equities, built on BEP-8056 rather than plain BEP-20) are not recognized by Zerion's API — confirmed via a real, decisive "fungible not found" response rather than assumed. This affects only the (currently unbuilt) idea of showing bStock portfolio value via Zerion, not the live wallet-portfolio feature, which works correctly for the tokens Zerion does support.
