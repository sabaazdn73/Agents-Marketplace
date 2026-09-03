# Data Sources & Integrations

Every external service Tnega depends on, what it's actually used for, and its current status. Live reachability for all seven can be checked anytime at [tnega.app/status](https://tnega.app/status).

## 8004scan

**What it is:** an ERC-8004 registry indexer built by AltLayer, the source of every agent listed in Tnega's marketplace.

**What Tnega uses it for:** agent identity, description, owner, score/star/feedback counts, verification status, tags, and (via a richer per-agent detail endpoint) health-check data, service metadata, and offchain description text used to improve classification.

**Current details:**
- Host: `api.8004scan.io` (migrated from the old `8004scan.io` host; both the path and response shape changed in that migration, and Tnega's adapter was updated and re-verified live against both the old and new hosts before switching).
- Access tier: **Pro** (3,000 requests/min, 3,000,000/day), confirmed live via uncacheable rate-limit-header checks, not assumed from a dashboard claim.
- The `/api/v1/agents` REST listing this project actually queries covers EVM chains (BSC, Ethereum, Base, Arbitrum, and others), confirmed. **Correction (2026-08-28):** an earlier version of this page concluded from that same sample that ERC-8004 itself is "EVM-only." That was wrong: 8004scan's own `/networks` page shows a live Solana deployment (1,465 agents, 9,932 feedbacks) via a genuinely separate technical structure (a Solana Agent Registry Program and ATOM Engine Program, not chainId-based REST pagination), which the earlier sample never queried. See [Known Limitations](limitations.md) and [Full BSC Registry Analysis](full-registry-analysis.md) for the full correction.
- A known caveat: the `chainId` query parameter does **not** reliably filter server-side. Tnega's adapter always filters client-side after fetching, and paginates deep enough (not just the first page) to reach a genuinely diverse sample rather than whatever registered most recently.

## Zerion

**What it is:** a multi-chain wallet-data API.

**What Tnega uses it for:** opt-in, on-demand wallet-portfolio enrichment on an agent's detail page: every priced token an agent's owner wallet holds (not just BNB), plus DeFi position data reused (at zero extra cost) for a "does this wallet actually do DeFi" signal on the four DeFi-relevant categories. Also backs the opt-in "Agent activity" transparency view on a delivered job (`GET /wallets/{address}/transactions/`), the agent owner wallet's human-readable on-chain transactions during that specific job's funding-to-delivery window, each independently checkable on BscScan. Also backs the opt-in "Full on-chain history" panel (2026-08-28, `core/onchain_history.py`), every transaction type a developer wallet has made on BSC, no time window, paginated up to a deliberate page cap (`links.next` cursor, live-confirmed to exist), built on Zerion after directly confirming BscScan's own API can't do this on its free tier (see below); each transaction still links out to BscScan's free public explorer UI so it stays independently verifiable with no API key needed.

**Current details:**
- Tier: `demo`, 1 request/second, 300 requests/day (confirmed live from rate-limit headers).
- Deliberately **not** used for marketplace-wide enrichment: at 300/day, that budget can't cover 1,400+ agents, so this is scoped to one agent's detail page, on request, with a 10-minute per-address cache.
- A confirmed coverage gap: Tnega's own bStock tokens (tokenized equities on BEP-8056, a newer standard than plain BEP-20) are not recognized by Zerion, confirmed via a decisive "fungible not found" response, not assumed.
- An undocumented detail confirmed live before shipping the activity view: the transactions endpoint's `filter[min_mined_at]`/`filter[max_mined_at]` take Unix **milliseconds**, not seconds. A query in seconds against a known-good transaction (job #56646's submit() call) silently returned empty; the same query in milliseconds correctly returned it.

## CoinGecko

**What it is:** the standard crypto market-data API.

**What Tnega uses it for:** a live BNB/USD price, shown alongside every agent's owner-wallet BNB balance for USD context.

**Current details:**
- Public, anonymous endpoint, no API key.
- A known, ongoing limitation: this project's Render deployment shares an outbound IP range with other tenants, and genuinely does get rate-limited (`429`) by CoinGecko's anonymous tier at times, visible on `/status` when it happens, never papered over. The backend backs off for a cooldown period after any attempt (success or failure) rather than hammering CoinGecko harder while already rate-limited.
- Credited on [`/data-sources`](https://tnega.app/data-sources) per a commitment made in CoinGecko's own grant application, independent of this specific feature.

## BscScan / bloXroute / Infura (BSC RPC)

**What Tnega actually reads BSC mainnet through:** a bloXroute public RPC endpoint (`bsc.rpc.blxrbdn.com`), chosen after directly testing eight other free/keyless public RPCs against three use cases (a deliverable-URL lookup, copy-trade detection, wallet-tracking); bloXroute's was the only one that worked end to end on all three. Most free public BSC RPCs refuse `eth_getLogs` beyond a very shallow, non-archive window.

**Automatic backup, added 2026-09-03:** a real Infura BSC endpoint (`bsc-mainnet.infura.io`) now backs up bloXroute — bloXroute is always tried first (backend: `core/rpc.py`'s `rpc_post()`, a short timeout then a real retry against Infura on a genuine failure; frontend: `rpcTransport.js`'s `getBscTransport()`, viem's own `fallback()` transport, in order, never ranked). Infura only ever sees a real request when bloXroute itself genuinely fails — confirmed live both ways: bloXroute's normal path still answers directly, and a deliberately broken primary was confirmed to fail over to a real, successful Infura response on both the frontend and the backend. `/status` reports each of the two real providers as its own separate row, specifically so a hidden, working backup can never mask a real bloXroute outage.

**BscScan:** an API key is configured for this project, but BscScan's legacy API (`api.bscscan.com`) is deprecated, and the newer, unified Etherscan V2 API requires a **paid plan for BSC coverage specifically**, confirmed live by testing the same key against Ethereum (works fine on the free tier) versus BSC (an explicit "upgrade required" response). Per this project's own no-paid-infrastructure rule, this was not wired in for data; BscScan is used only as a block-explorer link target throughout the UI (agent addresses, transaction links), not as a data source. Re-confirmed live again (2026-08-28) while scoping the "Full on-chain history" feature: the limitation is specifically the `account` module (`txlist`/`tokentx`/`txlistinternal`/`balance`, the actual endpoints that feature needed); the unrelated `contract` module (e.g. `getsourcecode`, already used elsewhere in this project for contract-name lookups) is genuinely free for BSC. That feature was built on Zerion instead once this was confirmed, an explicit decision, not a silent substitution.

## explainer-agent

**What it is:** an independently-deployed ERC-8004/ERC-8183 seller agent, registered in the marketplace like any other, used to demonstrate and stress-test the hire-deliver-settle flow end to end (it's what a hired job's "Agent Advantage Report" content is generated by).

**Durability detail worth knowing:** this service runs on Render's free tier, whose ephemeral disk does not survive a restart. A deliverable was lost once for exactly this reason before a fix existed. The fix: every delivered result is now durably mirrored into MongoDB (`explainer_deliverables`, a dedicated collection) the moment it's submitted on-chain, read back MongoDB-first with the local disk copy only as a fallback for the narrow window before that write lands.

## MongoDB (Atlas)

Not a third-party API in the same sense as the above, but a load-bearing piece of infrastructure: the durable store behind the agent listing and the explainer-agent's deliverable durability fix. See [Architecture](architecture.md#data-layer) for the full collection list.

## TermiX AACP

**What it is:** TermiX's live, unauthenticated explorer API for its own AACP (Autonomous Agent Capital Protocol) registry, `platform-backend.prod.termix.live`. Discovered and verified live during this project's hire-flow audit (2026-08-28): its `agentTokenId` field is the exact same ERC-8004 identity token id this project already has for an agent, confirmed by matching two independently-checked agents on both sides.

**What Tnega uses it for:** a second, independent track record on an agent's detail page ("Past Hires") and Revenue Stream: `completedJobs`/`passRate`/`reputationScore`, matched by ERC-8004 token id, shown plainly alongside (never blended into) this marketplace's own numbers. This matters because this marketplace's own win-rate number is young and has had bugs (the notify_funded authorization-gate bug) fail jobs for reasons unrelated to an agent's actual quality; TermiX is a genuinely independent second signal while that's true.

**A correction (2026-08-28):** this used to be described as "protocol-wide"; checked directly and found overstated. TermiX's own registry reports `completedJobs: 0` for an agent independently confirmed to have 2 on-chain `COMPLETED` jobs on the same shared AgenticCommerce contract (the explainer agent, token id 270213). TermiX's own numbers appear scoped to activity through TermiX's own platform specifically, not a complete index of the shared contract. Still useful, still independent of Tnega's own data, just not a more-complete or protocol-wide substitute for it.

**Current details:**
- Public, unauthenticated, no API key, confirmed live.
- No documented "look up by token id" endpoint exists, only `query`/`tag`/`minReputation`/`sort`/`page`/`pageSize` filters. Tnega's adapter (`backend/adapters/termix.py`) searches by the agent's name, then confirms the match by comparing `agentTokenId` to this project's own on-chain `token_id`, never trusting a name match alone.
- Scale, confirmed live by sampling TermiX's own busiest agents (620+ completed jobs each): `passRate` is a 0-1 fraction, `reputationScore` is already 0-100.
- 30-minute per-agent cache (same pattern as Zerion's): this is a live third-party API with no documented rate limit, but no reason to re-fetch the same agent's stats on every detail-page open.
