# Known Limitations

This project's whole development process has run on one rule: never hide a gap. This page is that rule applied to the documentation itself.

## Chain scope: no longer BSC only, but not uniform either

Superseded 2026-09-10. This section used to say that every user-facing part of Tnega was scoped to BSC mainnet and that agents on other chains were not shown. Both halves are now out of date, and the current position is more specific than either.

What is shown: agents from Ethereum, Solana, Arbitrum, Robinhood Chain and Monad each have a chain view of their own. Base is held in the store and kept ingested and analysed, but is deliberately surfaced nowhere: no tab, not inside another tab, and not counted in any user-facing total. Celo and Billions Network were deleted on 2026-09-11. See [Narrowing to six chains](chain-removal-2026-09-11.md). They are read straight from `full_agent_registry` on demand, never through the BSC serving cache.

What can be hired, and how, depends on the path:

| Path | Contract | Chains | Whose |
|---|---|---|---|
| Budget hiring | AgentBudgetEscrow | BNB Chain, Arbitrum, Robinhood Chain | Ours |
| Escrow hiring | ERC-8183 AgenticCommerce | BNB Chain only | Altana's, not ours to deploy |

Sell Your Agent stays BNB Chain only: AgentAccessMarket is deployed there and nowhere else.

A chain's UI follows from that table. A chain whose agents can be hired uses the marketplace theme: the BNB Chain card, with an avatar, the score and stars block, an action on the card, and numbered pages. A chain that is read only uses the listing theme: a thinner card, no action, and a load-more control. The two are meant to look different, because a card carrying a hire button is making a promise the app can keep. When a chain becomes hireable it switches themes, and the switch is driven by the backend reporting a hire path for it rather than by a per-chain branch in the UI.

The marketplace theme is the whole BNB experience, not just the card: category tabs with counts over the whole view, numbered pages, and an agent's own page at its own URL, with a back link to the marketplace, a refresh that re-reads the agent without leaving the page, and a share link. What differs per chain is only what that chain can answer, and the agent page states each absence with its reason rather than leaving a gap.

What can be evaluated also varies by chain, and the per-chain view says so on its face rather than leaving gaps. BNB Chain has all thirteen evaluation signals. Arbitrum and Robinhood Chain have nine, missing only the four that depend on ERC-8183 or on the Agent0 subgraph, both of which are BSC-only as a property of those systems rather than as unfinished work here. Chains with no analysis have one.

This is more than groundwork now: a background pipeline (`core/full_registry_ingest.py`) continuously fetches and durably stores agent data for BSC, Ethereum, Base, Solana, Monad, Robinhood Chain and Arbitrum into `full_agent_registry`, deliberately isolated from the live-serving `known_agents` collection and never read by any route the frontend calls, so this cannot leak into the cached BSC serving path even accidentally. See [Full BSC Registry Analysis](full-registry-analysis.md) for the ingestion methodology and current per-chain counts.

An earlier, separate 62-doc Ethereum snapshot (`future_multichain_agents`, a one-time pull predating the pipeline above) was deleted 2026-09-10 once confirmed redundant, every one of its agents was already present in `full_agent_registry`.

Correction (2026-08-28), itself now superseded by the above: an earlier version of this page claimed Solana wasn't planned because ERC-8004 was "an EVM-only standard" and a sample of 5,000 records all showed `chain_type: "evm"`. That conclusion was wrong; the sample never queried Solana's own separate program. Solana IS supported by 8004scan, with 1,465 agents and 9,932 feedbacks (confirmed live from 8004scan's own `/networks` page), via a different technical structure: an Agent Registry Program (`8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ`) and ATOM Engine Program (`AToMw53aiPQ8j7iHVb4fGt6nzUNxUhcPc3tbPBZuzVVb`), not the same chainId-based REST pagination the EVM chains use, which is exactly why the earlier sample never surfaced it. Solana is indexed now, the same way every other non-BSC chain listed above is.

## Altana passkey-session hiring: removed 2026-09-03

The marketplace hire flow, the Skills panel's transaction skills, and the Staking Native Agent used to each offer a second wallet option alongside the user's own connected wallet: an Altana passkey-session wallet ("Autonomous" mode) with an on-chain spend cap and contract allow-list, letting an agent act without a signature on every step. It was fully built, its on-chain call shapes were verified against the installed SDK, and its passkey/KeyStore mechanics were verified by reading the SDK source directly.

It was removed after a decisive check: a complete scan of every ERC-8183 job this marketplace's kernel has ever processed (56,667 jobs, not a sample) found zero jobs of any status, ever, matching that path's hire-description marker. Not "never completed", never even attempted end to end, in this project's entire history. This project's own Skill successes are all recorded via the direct-wallet path specifically (see the Advantage Report entry in [Features](features.md#advantage-report)). Working code that has never once been exercised by a user isn't a confirmed feature, so it was removed rather than kept as decoration: the marketplace hire flow, the Skills panel, and the Staking agent now all run only through the user's own connected wallet (plus, since 2026-09-02, a confirmed-fixed EIP-5792 atomic-batch path for wallets that support it, MetaMask included).

Altana itself was not removed. It still powers the Skills Registry (the list of Skills itself is sourced from Altana's own public GitHub registry), the x402-payments Skill (which needs Altana's own facilitator infrastructure and has no direct-wallet equivalent), wallet creation/recovery, and the on-chain passkey-secured-wallet badge shown on some agent listings, all of which have independent evidence of working. Only the spend-capped session/"Autonomous" execution path was removed, specifically because it didn't.

## Domain-move consequence for existing passkeys (if any)

This project moved from an earlier Vercel subdomain to `tnega.app`. WebAuthn passkeys are cryptographically scoped to the domain (`rpId`) they were created under, by the browser/OS itself, not by anything this codebase controls. A passkey created under an old domain will not be discoverable under a new one, and the account isn't recoverable through that passkey afterward. There is no code fix for this; it's how WebAuthn is designed to work. Still relevant to the passkey wallets that remain (Skills Registry recovery, x402), even though the marketplace hire flow's own use of Altana passkeys was removed.

## CoinGecko rate-limiting on shared infrastructure

The BNB/USD price feature depends on CoinGecko's free, anonymous API tier, which is IP-scoped. This project's Render deployment shares an outbound IP range with other tenants, and does get rate-limited (`HTTP 429`) at times as a result, visible on [`/status`](https://tnega.app/status) when it happens rather than silently failing. This is a structural limitation of using a free, shared-infrastructure tier, not a bug that can be "fixed" without either a paid CoinGecko plan (against this project's own no-paid-infrastructure rule) or dedicated infrastructure.

## BscScan: configured but not wired for data

A BscScan API key is present in this project's configuration, but was deliberately never wired into any live feature: BscScan's legacy API is deprecated, and the current, unified Etherscan API requires a paid plan for BSC coverage specifically (confirmed live: the same key works fine against Ethereum's free tier, isolating this as a BSC-specific paid gate). BscScan is used only as a block-explorer link target in the UI, never as a data source.

## Practice Mode: removed

This project previously included a Practice Layer: a self-hosted Anvil fork of live BSC mainnet, so users could try any agent/Skill with free faucet funds before spending anything. It was fully removed 2026-08-26, a deliberate product decision, not an oversight: the fork ran on Render's free tier with no persistent disk, re-forking fresh (and occasionally landing in a unreliable state) on every restart or idle spin-down, and that repeated infrastructure instability risked giving an unreliable impression that outweighed the trust value of a "try before you spend" sandbox. Every Skill still runs for real, with a user-set spending limit; see [Features](features.md#altana-skills).

## Platform-wide zeros that are accurate, not bugs

is_verified reads zero across the entire live marketplace: zero agents are marked verified anywhere in 8004scan's registry, across every chain it indexes, a platform-wide state confirmed by direct sampling, not a wiring gap on this project's side.

reviews, correction (2026-08-28): an earlier version of this page claimed "zero feedback exists for any BSC agent." That was a finding from this project's own small, diversity-capped `known_agents` sample (~1,700 agents), but it was wrongly generalized to "BSC has no feedback," which isn't true. 8004scan's own `/networks` page reports 11,719 feedbacks on BSC (out of 285,868 BSC agents). Re-checked directly against the much larger full-registry dataset (see [Full BSC Registry Analysis](full-registry-analysis.md)): sparse, but roughly 0.04 feedbacks per agent on average platform-wide for BSC, about 200x lower density than Base (441,569 feedbacks / 52,548 agents, about 8.4/agent). A small, diversity-capped sample of BSC specifically catching zero feedback is a plausible outcome of that sparsity, not a detection bug, but "BSC has no feedback" was still the wrong way to state it, and is corrected here.

## "Verified working" is a small minority, by design, not a bug

Of ~11,700 named agents (2026-08-27, up sharply from the ~1,700 this figure was originally written against; the marketplace now draws from the full, continuously-growing registry rather than a small diversity-capped snapshot; see [Full Agent Registry Analysis](full-registry-analysis.md)), only 18 currently qualify as "Verified working" (see [Features](features.md)): an on-chain job that reached SUBMITTED or COMPLETED for that agent's owner. That's a small fraction, and it's meant to be read that way rather than smoothed over: this platform indexes every ERC-8004-registered agent on BSC, most of which have never been hired through this marketplace (or possibly at all) yet, so a thin track record is the current state, not a detection gap. The bar was deliberately kept at "a confirmed delivery" rather than lowered to include health-check-only agents in the same tier; see the job #56659 investigation (2026-08-26) for why a responding endpoint isn't trustworthy proof of function on its own. Expect this number to grow as more hires complete; it is not artificially capped.

This isn't a Tnega-specific gap: an independent academic study of the live ERC-8004 registries (Xiong et al. arXiv:2606.26028) found only 3-15% of registrations across Ethereum/BSC/Base expose a live endpoint at all, and up to 90.6% of on-chain reputation feedback shows coordinated Sybil behavior. See [Verification Methodology](verification-methodology.md) for the full citation, the four-tier system this drives, and the human-triggered "canary probe" system built to proactively test a small sample of unproven agents rather than only ever waiting on organic activity.

## DeFi-specific category representation: thin, but and improving

The four DeFi-specific categories `core/categorize.py` was originally built around (Rebalancing, Grid Trading, Yield Optimisation, Health Factor Monitoring) are thin in the live registry relative to the marketplace's ~1,500 total agents; most agents fall into broader categories (Research, Trading Signals, Smart Contract Auditing) instead. This was a harder gap earlier in this project's life (Grid Trading specifically had zero matching agents in the sample available at the time). Checked fresh: all four now have non-zero representation (Grid Trading included), helped in part by later re-classifying previously-Unclassified agents against 8004scan's richer per-agent data once Pro-tier access made that affordable to do for every refresh. Still thin, not claimed as solved, just no longer a hard zero.

## x402 pay-per-call: configuration only

The x402 pay-per-call pricing model on AgentAccessMarket saves a creator's configuration (including a spec-accurate B402 Bazaar discovery blob), but wiring a creator's endpoint as a live x402 resource is the creator's own deployment step outside this project's control. Settlement through this path has not been exercised end to end.

## Zerion: a confirmed coverage gap

Tnega's own bStock tokens (tokenized equities, built on BEP-8056 rather than plain BEP-20) are not recognized by Zerion's API, confirmed via a decisive "fungible not found" response rather than assumed. This affects only the (currently unbuilt) idea of showing bStock portfolio value via Zerion, not the live wallet-portfolio feature, which works correctly for the tokens Zerion does support.

## ~9,100 working BSC agents missing, because 8004scan never indexed them

**Deferred deliberately until after hackathon judging.** Re-ingesting them is
a large write, and a large write during the judging window is risk with no
upside. Pick this up once judging closes.

Confirmed 2026-09-10 while auditing whether a deletion bug had destroyed data
(it had not — see [Deletion Audit](deletion-audit-2026-09-10.md)). BSC holds
154,695 agents across token ids 0–334,250, leaving 179,558 absent. Most of
that absence is correct: those agents registered no service endpoint and were
deliberately deleted, and sampling 200 of them found 199 with genuinely no
endpoint and none with a live one.

But roughly **9,100 of the absent agents do have a working service endpoint
today**. They are concentrated in contiguous blocks that 8004scan never
indexed: only 3% of ids in those blocks are known to the source, against 100%
of a stored control. They never entered the pipeline, so nothing deleted
them — this is a gap in the data source, not damage.

The distortion is worse than the raw count suggests. These are agents *with*
endpoints, so the missing population is disproportionately the working end of
the registry, and every registry-wide proportion computed here is measured
against a store that is missing them.

Recovering them does not need 8004scan. The ERC-8004 registry is the
authority and `tokenURI` resolves for every one of them, so they can be
ingested straight from chain, the same way the health check already reads
them. Roughly 7 MB at ~0.76 KB per document, against 55.1 MB of headroom as
of 2026-09-10.

## `unknown` collapses several different failures into one word

Our health check has one status, `unknown`, for every case where an agent's
metadata could not be resolved. A dead metadata host, a six second timeout, a
gateway returning 500 and a response that was not JSON all land in the same
bucket, so a reader cannot tell a permanent problem from a momentary one.

Measured on Ethereum, 2026-09-10, sampling 300 agents sitting at `unknown`:
45.7% resolved cleanly on a re-check, 37.3% failed to connect to their
metadata host, 8.0% had a tokenURI that was raw JSON rather than a URI, 4.7%
returned a body that was not JSON, and the rest were 404s, timeouts and
protocol errors. One dead publisher host, `agents.exquisite.land`, accounted
for 29.5% of a 600-agent sample on its own.

Trust8004 ([trust8004.xyz](https://trust8004.xyz)) does this better. Its
agent records carry `metadataStatus` with values of available, partial or
unavailable, alongside `metadataReasonCode` and `metadataReasonDetail`. That
separates a dead host from a timeout from a malformed document, which is
information we currently throw away.

Worth borrowing regardless of whether that indexer is ever integrated. The
re-queue fix of 2026-09-10 means an `unknown` is now retried rather than
settled, which removes the staleness, but it does not make the word carry
more meaning than it did.

## Trust8004 as a third registry source, not yet integrated

Deliberately deferred until after judging closes.

Trust8004 indexes 31 chains including every chain this project ingests except,
as far as could be confirmed, Robinhood Chain. Its free tier covers discovery
and per-agent lookup: `/api/v1/catalog/agents` and
`/api/v1/catalog/agents/{chainId}:{agentId}`. Search, bulk access, enriched
profiles and trust scores are pay-per-call in USDC over x402, and
`/api/v1/agents` returns HTTP 402 accordingly.

Checked against 25 Ethereum agents this project could not resolve: all 25 were
present with matching ids, 18 carried an endpoint we do not have, and its own
`metadataStatus` reported 8 available, 3 partial and 14 unavailable. So it
resolves some of what we cannot, and is honest about the rest.

If added, it should go in the same shape as
[The Graph Integration](thegraph-integration.md): a coverage fallback beside
the existing sources rather than a replacement for any of them.
