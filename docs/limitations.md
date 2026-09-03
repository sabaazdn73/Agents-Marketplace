# Known Limitations (Honest)

This project's whole development process has run on one rule: never hide a gap. This page is that rule applied to the documentation itself.

## BSC mainnet only, by design

Every user-facing part of Tnega, the marketplace, the hire flow, Sell Your Agent, is scoped to BSC mainnet (chain 56). This is a deliberate scope decision, not an oversight, but it's worth being explicit about: agents registered on other chains ERC-8004 covers (Ethereum, Base, Arbitrum, and others) are not shown here.

This is genuinely more than groundwork now: a background pipeline (`core/full_registry_ingest.py`) continuously fetches and durably stores agent data for BSC, Ethereum, Base, Solana, Monad, Billions Network, Robinhood Chain, Celo, and Arbitrum into `full_agent_registry`, deliberately isolated from the live-serving `known_agents` collection and never read by any route the frontend calls, so this cannot leak into the current BSC-only display even accidentally. See [Full BSC Registry Analysis](full-registry-analysis.md) for the real ingestion methodology and current per-chain counts.

An earlier, separate 62-doc Ethereum snapshot (`future_multichain_agents`, a one-time pull predating the pipeline above) was deleted 2026-09-10 once confirmed redundant — every one of its agents was already present in `full_agent_registry`.

**Correction (2026-08-28), itself now superseded by the above:** an earlier version of this page claimed Solana wasn't planned because ERC-8004 was "an EVM-only standard" and a sample of 5,000 records all showed `chain_type: "evm"`. That conclusion was wrong; the sample never queried Solana's own separate program. Solana IS supported by 8004scan, with **1,465 agents** and 9,932 feedbacks (confirmed live from 8004scan's own `/networks` page), via a genuinely different technical structure: an **Agent Registry Program** (`8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ`) and **ATOM Engine Program** (`AToMw53aiPQ8j7iHVb4fGt6nzUNxUhcPc3tbPBZuzVVb`), not the same chainId-based REST pagination the EVM chains use, which is exactly why the earlier sample never surfaced it. Solana is indexed now, the same way every other non-BSC chain listed above is.

## Altana passkey-session hiring: removed 2026-09-03

The marketplace hire flow, the Skills panel's transaction skills, and the Staking Native Agent used to each offer a second wallet option alongside the user's own connected wallet: an Altana passkey-session wallet ("Autonomous" mode) with an on-chain spend cap and contract allow-list, letting an agent act without a signature on every step. It was fully built, its on-chain call shapes were verified against the installed SDK, and its passkey/KeyStore mechanics were verified by reading the SDK source directly.

It was removed after a decisive check: a complete scan of every ERC-8183 job this marketplace's kernel has ever processed (56,667 jobs, not a sample) found **zero** jobs of any status, ever, matching that path's hire-description marker. Not "never completed", never even attempted end to end, in this project's entire real history. This project's own real Skill successes are all recorded via the direct-wallet path specifically (see the Advantage Report entry in [Features](features.md#advantage-report)). Working code that has never once been exercised by a real user isn't a real, confirmed feature, so it was removed rather than kept as decoration: the marketplace hire flow, the Skills panel, and the Staking agent now all run only through the user's own connected wallet (plus, since 2026-09-02, a confirmed-fixed EIP-5792 atomic-batch path for wallets that support it, MetaMask included).

Altana itself was **not** removed. It still powers the Skills Registry (the list of Skills itself is sourced from Altana's own public GitHub registry), the x402-payments Skill (which genuinely needs Altana's own facilitator infrastructure and has no direct-wallet equivalent), wallet creation/recovery, and the on-chain passkey-secured-wallet badge shown on some agent listings, all of which have real, independent evidence of working. Only the spend-capped session/"Autonomous" execution path was removed, specifically because it didn't.

## Domain-move consequence for existing passkeys (if any)

This project moved from an earlier Vercel subdomain to `tnega.app`. WebAuthn passkeys are cryptographically scoped to the domain (`rpId`) they were created under, by the browser/OS itself, not by anything this codebase controls. A passkey created under an old domain will not be discoverable under a new one, and the account isn't recoverable through that passkey afterward. There is no code fix for this; it's how WebAuthn is designed to work. Still relevant to the passkey wallets that remain (Skills Registry recovery, x402), even though the marketplace hire flow's own use of Altana passkeys was removed.

## CoinGecko rate-limiting on shared infrastructure

The BNB/USD price feature depends on CoinGecko's free, anonymous API tier, which is IP-scoped. This project's Render deployment shares an outbound IP range with other tenants, and does genuinely get rate-limited (`HTTP 429`) at times as a result, visible on [`/status`](https://tnega.app/status) when it happens rather than silently failing. This is a structural limitation of using a free, shared-infrastructure tier, not a bug that can be "fixed" without either a paid CoinGecko plan (against this project's own no-paid-infrastructure rule) or dedicated infrastructure.

## BscScan: configured but not wired for data

A BscScan API key is present in this project's configuration, but was deliberately never wired into any live feature: BscScan's legacy API is deprecated, and the current, unified Etherscan API requires a **paid plan for BSC coverage specifically** (confirmed live: the same key works fine against Ethereum's free tier, isolating this as a BSC-specific paid gate). BscScan is used only as a block-explorer link target in the UI, never as a data source.

## Practice Mode: removed

This project previously included a Practice Layer: a self-hosted Anvil fork of live BSC mainnet, so users could try any agent/Skill with free faucet funds before spending anything. It was fully removed 2026-08-26, a deliberate product decision, not an oversight: the fork ran on Render's free tier with no persistent disk, re-forking fresh (and occasionally landing in a genuinely unreliable state) on every restart or idle spin-down, and that repeated infrastructure instability risked giving an unreliable impression that outweighed the trust value of a "try before you spend" sandbox. Every Skill still runs for real, with a user-set spending limit; see [Features](features.md#altana-skills).

## Platform-wide zeros that are accurate, not bugs

**is_verified** reads zero across the entire live marketplace: zero agents are marked verified anywhere in 8004scan's registry, across every chain it indexes, a genuine, platform-wide state confirmed by direct sampling, not a wiring gap on this project's side.

**reviews, correction (2026-08-28):** an earlier version of this page claimed "zero feedback exists for any BSC agent." That was a finding from this project's own small, diversity-capped `known_agents` sample (~1,700 agents), but it was wrongly generalized to "BSC has no feedback," which isn't true. 8004scan's own `/networks` page reports **11,719 feedbacks on BSC** (out of 285,868 BSC agents). Re-checked directly against the much larger full-registry dataset (see [Full BSC Registry Analysis](full-registry-analysis.md)): sparse, but real, roughly 0.04 feedbacks per agent on average platform-wide for BSC, about 200x lower density than Base (441,569 feedbacks / 52,548 agents, about 8.4/agent). A small, diversity-capped sample of BSC specifically catching zero feedback is a plausible outcome of that sparsity, not a detection bug, but "BSC has no feedback" was still the wrong way to state it, and is corrected here.

## "Verified working" is a small minority, by design, not a bug

Of ~11,700 named agents (2026-08-27, up sharply from the ~1,700 this figure was originally written against; the marketplace now draws from the full, continuously-growing registry rather than a small diversity-capped snapshot; see [Full Agent Registry Analysis](full-registry-analysis.md)), only **18** currently qualify as "Verified working" (see [Features](features.md)): an on-chain job that reached SUBMITTED or COMPLETED for that agent's owner. That's genuinely a small fraction, and it's meant to be read that way rather than smoothed over: this platform indexes every ERC-8004-registered agent on BSC, most of which have never been hired through this marketplace (or possibly at all) yet, so a thin track record is the current state, not a detection gap. The bar was deliberately kept at "a confirmed delivery" rather than lowered to include health-check-only agents in the same tier; see the job #56659 investigation (2026-08-26) for why a responding endpoint isn't trustworthy proof of function on its own. Expect this number to grow as more hires complete; it is not artificially capped.

This isn't a Tnega-specific gap: an independent academic study of the actual live ERC-8004 registries (Xiong et al., arXiv:2606.26028) found only 3-15% of registrations across Ethereum/BSC/Base expose a genuinely live endpoint at all, and up to 90.6% of on-chain reputation feedback shows coordinated Sybil behavior. See [Verification Methodology](verification-methodology.md) for the full citation, the four-tier system this drives, and the human-triggered "canary probe" system built to proactively test a small sample of unproven agents rather than only ever waiting on organic activity.

## DeFi-specific category representation: thin, but real and improving

The four DeFi-specific categories `core/categorize.py` was originally built around (Rebalancing, Grid Trading, Yield Optimisation, Health Factor Monitoring) are genuinely thin in the live registry relative to the marketplace's ~1,500 total agents; most agents fall into broader categories (Research, Trading Signals, Smart Contract Auditing) instead. This was a harder gap earlier in this project's life (Grid Trading specifically had zero matching agents in the sample available at the time). Checked fresh: all four now have genuine, non-zero representation (Grid Trading included), helped in part by later re-classifying previously-Unclassified agents against 8004scan's richer per-agent data once Pro-tier access made that affordable to do for every refresh. Still thin, not claimed as solved, just no longer a hard zero.

## x402 pay-per-call: configuration only

The x402 pay-per-call pricing model on AgentAccessMarket saves a creator's configuration (including a spec-accurate B402 Bazaar discovery blob), but wiring a creator's actual endpoint as a live x402 resource is the creator's own deployment step outside this project's control. Settlement through this path has not been exercised end to end.

## Zerion: a confirmed coverage gap

Tnega's own bStock tokens (tokenized equities, built on BEP-8056 rather than plain BEP-20) are not recognized by Zerion's API, confirmed via a decisive "fungible not found" response rather than assumed. This affects only the (currently unbuilt) idea of showing bStock portfolio value via Zerion, not the live wallet-portfolio feature, which works correctly for the tokens Zerion does support.
