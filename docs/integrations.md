# Data Sources & Integrations

Every external service Tnega depends on, what it's used for, and its current status. Live reachability for all seven can be checked anytime at [tnega.app/status](https://tnega.app/status).

## 8004scan

What it is: an ERC-8004 registry indexer built by AltLayer, the source of every agent listed in Tnega's house.

What Tnega uses it for: agent identity, description, owner, score/star/feedback counts, verification status, tags, and (via a richer per-agent detail endpoint) health-check data, service metadata, and offchain description text used to improve classification.

Current details:
- Host: `api.8004scan.io` (migrated from the old `8004scan.io` host; both the path and response shape changed in that migration, and Tnega's adapter was updated and re-verified live against both the old and new hosts before switching).
- Access tier: Pro (3,000 requests/min, 3,000,000/day), confirmed live via uncacheable rate-limit-header checks, not assumed from a dashboard claim.
- The `/api/v1/agents` REST listing this project queries covers EVM chains (BSC, Ethereum, Base, Arbitrum, and others), confirmed. Correction (2026-08-28): an earlier version of this page concluded from that same sample that ERC-8004 itself is "EVM-only." That was wrong: 8004scan's own `/networks` page shows a live Solana deployment (1,465 agents, 9,932 feedbacks) via a separate technical structure (a Solana Agent Registry Program and ATOM Engine Program, not chainId-based REST pagination), which the earlier sample never queried. See [Known Limitations](limitations.md) and [Full BSC Registry Analysis](full-registry-analysis.md) for the full correction.
- A known caveat: the `chainId` query parameter does not reliably filter server-side. Tnega's adapter always filters client-side after fetching, and paginates deep enough (not just the first page) to reach a diverse sample rather than whatever registered most recently.

## Zerion

What it is: a multi-chain wallet-data API.

What Tnega uses it for: opt-in, on-demand wallet-portfolio enrichment on an agent's detail page: every priced token an agent's owner wallet holds (not just BNB), plus DeFi position data reused (at zero extra cost) for a "does this wallet do DeFi" signal on the four DeFi-relevant categories. Also backs the opt-in "Agent activity" transparency view on a delivered job (`GET /wallets/{address}/transactions/`), the agent owner wallet's human-readable on-chain transactions during that specific job's funding-to-delivery window, each independently checkable on BscScan. Also backs the opt-in "Full on-chain history" panel (2026-08-28, `core/onchain_history.py`), every transaction type a developer wallet has made on BSC, no time window, paginated up to a deliberate page cap (`links.next` cursor, live-confirmed to exist), built on Zerion after directly confirming BscScan's own API can't do this on its free tier (see below); each transaction still links out to BscScan's free public explorer UI so it stays independently verifiable with no API key needed.

Current details:
- Tier: `demo`, 1 request/second, 300 requests/day (confirmed live from rate-limit headers).
- Deliberately not used for house-wide enrichment: at 300/day, that budget can't cover 1,400+ agents, so this is scoped to one agent's detail page, on request, with a 10-minute per-address cache.
- Terms, as the owner decided them on 2026-09-25: Zerion data may be shown in Tnega's own frontend, which the API licence allows. It is never stored beyond a short in-memory cache (10 minutes, at most 256 entries per cache, gone on restart), and nothing Zerion-sourced goes through MCP or any public API unless Zerion agrees in writing. The key stays on the server. Every backend response carrying Zerion data, and only those, has `source: "via the Zerion API"`, and the site says "Data via the Zerion API. Tnega is not a Zerion app." on the seven panels that show it.
- The routes that serve Zerion data answer only requests from the site's own origin and are left out of the published API schema. See [Data handling](data-handling.md#zerion-data-site-only).
- A confirmed coverage gap, in two halves that are sourced separately. Half one: two tokenized-equity tokens on BSC, Binance's bStock NVDAB (`0x02fca66c1d1afb4e2a7884261eb00f63598a7436`) and TSLAB (`0x5b1910eaad6450e50f816082aa078c41f10c292f`), are not recognized by Zerion, confirmed via a decisive "fungible not found" response, not assumed. That response is evidence about Zerion's coverage, and about nothing else. Half two, a separate read: on chain, 2026-09-24, both tokens expose the ERC-8056 scaled-UI-amount interface rather than plain BEP-20 (`uiMultiplier()`, `newUIMultiplier()`, `effectiveAt()`, `balanceOfUI(address)`, `totalSupplyUI()`, `toUIAmount(uint256)` and `fromUIAmount(uint256)` each answer with a value and no revert), both as beacon proxies over beacon `0x156d6dce9a4f6139a3406f1f021f1a4880de93a3` and implementation `0xcfed6c4679297ea4889f8183bc057b4a86c64e46`. Correction (2026-09-24): this bullet used to call them "Tnega's own bStock tokens" and to give the standard as fact on the strength of Zerion's failure alone. They are Binance's (neither address appears anywhere in this repository; this project only ever read a wallet balance for them), and the standard was a hedged guess until those reads. See [Known Limitations](limitations.md).
- An undocumented detail confirmed live before shipping the activity view: the transactions endpoint's `filter[min_mined_at]`/`filter[max_mined_at]` take Unix milliseconds, not seconds. A query in seconds against a known-good transaction (job #56646's submit() call) silently returned empty; the same query in milliseconds correctly returned it.

## PancakeSwap v3 pool (BNB/USD)

What it is: the WBNB/USDT pool at the 0.01% fee tier on PancakeSwap v3, BNB Chain, `0x172fcd41e0913e95784454622d1c3724f546f849`. Read through the same RPC layer as every other on-chain read (bloXroute, with Infura as backup). No API, no key and no licence: it is public chain state.

What Tnega uses it for: the BNB/USD price shown beside an agent owner's BNB balance, served by `GET /api/market/bnb-price`. It is a 30-minute time-weighted average from the pool's own `observe()`, labelled "USD via USDT (BSC-USD)", because USDT is taken at one dollar. Each response carries the pool, fee tier, block and window it rests on.

Current details:
- Chosen over its three sibling pools because it is the deepest across price bands, not only at the current tick: moving its price 0.5% takes about $437k against about $313k in the 0.05% pool, and 2% takes about $1.39M against $1.26M (measured by the supervising review at block ~123,964,4xx). It also has the largest observation ring, 4,500 against 900.
- A ring of 4,500 covers at least 4,500 seconds, since a pool records at most one observation per second, so the 1,800-second window is always inside it. How much more it covers depends on trading activity: 28,957 seconds on the first read on 2026-09-25, 12,445 seconds at block 123,965,911 the same day.
- A failed read returns `usd: null` with a reason, never an older price. Cached in memory for 30 seconds.
- Replaced CoinGecko's free API on 2026-09-25. See [CoinGecko Removed, BNB/USD on Chain](coingecko-removal-2026-09-25.md).

## BscScan / bloXroute / Infura (BSC RPC)

What Tnega reads BSC mainnet through: a bloXroute public RPC endpoint (`bsc.rpc.blxrbdn.com`), chosen after directly testing eight other free/keyless public RPCs against three use cases (a deliverable-URL lookup, copy-trade detection, wallet-tracking); bloXroute's was the only one that worked end to end on all three. Most free public BSC RPCs refuse `eth_getLogs` beyond a very shallow, non-archive window.

Automatic backup, added 2026-09-03: a Infura BSC endpoint (`bsc-mainnet.infura.io`) now backs up bloXroute, bloXroute is always tried first (backend: `core/rpc.py`'s `rpc_post()`, a short timeout then a retry against Infura on a failure; frontend: `rpcTransport.js`'s `getBscTransport()`, viem's own `fallback()` transport, in order, never ranked). Infura only ever sees a request when bloXroute itself fails, confirmed live both ways: bloXroute's normal path still answers directly, and a deliberately broken primary was confirmed to fail over to a real, successful Infura response on both the frontend and the backend. `/status` reports each of the two providers as its own separate row, specifically so a hidden, working backup can never mask a bloXroute outage.

BscScan: an API key is configured for this project, but BscScan's legacy API (`api.bscscan.com`) is deprecated, and the newer, unified Etherscan V2 API requires a paid plan for BSC coverage specifically, confirmed live by testing the same key against Ethereum (works fine on the free tier) versus BSC (an explicit "upgrade required" response). Per this project's own no-paid-infrastructure rule, this was not wired in for data; BscScan is used only as a block-explorer link target throughout the UI (agent addresses, transaction links), not as a data source. Re-confirmed live again (2026-08-28) while scoping the "Full on-chain history" feature: the limitation is specifically the `account` module (`txlist`/`tokentx`/`txlistinternal`/`balance`, the endpoints that feature needed); the unrelated `contract` module (e.g. `getsourcecode`, already used elsewhere in this project for contract-name lookups) is free for BSC. That feature was built on Zerion instead once this was confirmed, an explicit decision, not a silent substitution.

## explainer-agent

What it is: an independently-deployed ERC-8004/ERC-8183 seller agent, registered in the house like any other, used to demonstrate and stress-test the hire-deliver-settle flow end to end (it's what a hired job's "Agent Advantage Report" content is generated by).

Durability detail worth knowing: this service runs on Render's free tier, whose ephemeral disk does not survive a restart. A deliverable was lost once for exactly this reason before a fix existed. The fix: every delivered result is now durably mirrored into MongoDB (`explainer_deliverables`, a dedicated collection) the moment it's submitted on-chain, read back MongoDB-first with the local disk copy only as a fallback for the narrow window before that write lands.

## MongoDB (Atlas)

Not a third-party API in the same sense as the above, but a load-bearing piece of infrastructure: the durable store behind the agent listing and the explainer-agent's deliverable durability fix. See [Architecture](architecture.md#data-layer) for the full collection list.

## TermiX AACP

What it is: TermiX's live, unauthenticated explorer API for its own AACP (Autonomous Agent Capital Protocol) registry, `platform-backend.prod.termix.live`. Discovered and verified live during this project's hire-flow audit (2026-08-28): its `agentTokenId` field is the exact same ERC-8004 identity token id this project already has for an agent, confirmed by matching two independently-checked agents on both sides.

What Tnega uses it for: a second, independent track record on an agent's detail page ("Past Hires") and Revenue Stream: `completedJobs`/`passRate`/`reputationScore`, matched by ERC-8004 token id, shown plainly alongside (never blended into) this house's own numbers. This matters because this house's own win-rate number is young and has had bugs (the notify_funded authorization-gate bug) fail jobs for reasons unrelated to an agent's quality; TermiX is a independent second signal while that's true.

A correction (2026-08-28): this used to be described as "protocol-wide"; checked directly and found overstated. TermiX's own registry reports `completedJobs: 0` for an agent independently confirmed to have 2 on-chain `COMPLETED` jobs on the same shared AgenticCommerce contract (the explainer agent, token id 270213). TermiX's own numbers appear scoped to activity through TermiX's own platform specifically, not a complete index of the shared contract. Still useful, still independent of Tnega's own data, just not a more-complete or protocol-wide substitute for it.

Current details:
- Public, unauthenticated, no API key, confirmed live.
- No documented "look up by token id" endpoint exists, only `query`/`tag`/`minReputation`/`sort`/`page`/`pageSize` filters. Tnega's adapter (`backend/adapters/termix.py`) searches by the agent's name, then confirms the match by comparing `agentTokenId` to this project's own on-chain `token_id`, never trusting a name match alone.
- Scale, confirmed live by sampling TermiX's own busiest agents (620+ completed jobs each): `passRate` is a 0-1 fraction, `reputationScore` is already 0-100.
- 30-minute per-agent cache (same pattern as Zerion's): this is a live third-party API with no documented rate limit, but no reason to re-fetch the same agent's stats on every detail-page open.

## CockroachDB

Connected and verified, holding nothing yet. `core/cockroach.py` opens it, and
nothing else reads or writes it.

The part worth recording is the TLS decision. The connection string carries
`sslmode=verify-full` and names no root certificate, which works on a laptop
because libpq silently picks up `~/.postgresql/root.crt`. A deployed container
has no such file, and libpq does not fall back to the system trust store when
one is absent, so `verify-full` fails there outright.

`sslmode=require` would have fixed it and was not taken: it encrypts and
verifies nothing, so anything able to answer for that hostname gets the cluster
password. The local certificate turned out to contain ISRG Root X1 and X2,
which are Let's Encrypt's public roots and already in every standard CA bundle,
so there was nothing worth shipping as a secret either. The fix keeps
`verify-full` and points `sslrootcert` at certifi, which is a pinned dependency
and cannot be missing from the container.

`build_dsn` raises rather than repairing a DSN that asks for anything weaker,
because a downgrade should be a deployment error someone sees.

## Dune

Used for published analysis, not by the live site. It is the source behind the
[on-chain behaviour study](behaviour-analysis.md), which needs a complete
transaction table that no free explorer API provides for the chains involved.

Nothing in the serving path depends on it, and an outage would not affect the
house.

## Smithery

An MCP server registry, evaluated as a possible catalogue source and not
integrated. The evaluation is recorded here because the result is useful either
way: 14,042 servers, 76.6% reporting a deployment, `useCount` populated as a
real usage signal, and declared tool lists with JSON schemas, all of which the
ERC-8004 registry lacks.

What stopped it being an obvious win is acquisition rather than quality. Plain
listing is capped at an offset of 500, its pages overlap, and unrecognised
filters fail silently by returning exactly 100 rather than erroring. It also
has no payment primitive, so a Smithery server is something you call rather
than something you hire, and it does not replace what this project does.
