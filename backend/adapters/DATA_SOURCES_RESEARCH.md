# BNB Agent Data Sources — Full Research, 8 Aug 2026

## The core problem this research solves
ERC-8004 (8004scan) gives IDENTITY + REPUTATION (name, description, score,
feedback count). It has NO financial performance fields (no TVL, win rate,
drawdown). Most of the 200k+ registered agents are experimental/generic,
not real financial products. To build a genuinely informative marketplace
(not fabricated numbers), real financial data has to come from elsewhere,
cross-referenced against identity data, not invented.

## Confirmed, usable sources (in priority order)

### 1. 8004scan.io — identity & reputation (PRIMARY, already integrated)
- Free anonymous tier: 10 req/min, no key needed to start
- Real OpenAPI spec: https://8004scan.io/api/v1/public/docs/openapi.json
- Fields: name, description, chain_id, owner_address, total_score,
  star_count, total_feedbacks, created_at
- KNOWN BUG (confirmed via live test): chainId query param does not
  reliably filter server-side, always filter client-side too (already
  fixed in bsc.py's list_bsc_agents)
- Official AltLayer product, directly endorsed by BNB Chain's own
  announcements

### 2. DefiLlama — REAL financial data (NEW, this is the missing piece)
- Free, no-auth API: https://api.llama.fi/protocols
- Confirmed real response shape: [{name, slug, tvl, chainTvls, change_1h,
  change_1d, change_7d, category, chains, ...}]
- Has a dedicated "AI Agents" category, filterable by chain including BSC:
  https://defillama.com/protocols/ai-agents (BSC is one of the listed chains)
- This is the industry-standard source for TVL, most other sites cite
  DefiLlama under the hood
- IMPORTANT DISTINCTION: DefiLlama tracks AI-agent-branded DeFi PROTOCOLS
  (real financial products with real TVL, e.g. "JPOW AI"), a DIFFERENT
  population from individually-registered ERC-8004 agent IDENTITIES.
  Most small/experimental 8004scan agents will NOT appear here. Only
  cross-reference when both sources agree on the same real project,
  don't force a match.

### 3. 8k4 Protocol — larger BSC coverage, API unverified
- Claims 44,020 indexed BSC agents (vs. much less seen live from 8004scan)
- No public API schema found as of this research, don't guess it
- Worth revisiting if 8004scan's real coverage proves too thin, ask in
  ERC-8004 Telegram (t.me/ERC8004) for their real docs

### 4. Agent Arena (agentarena.site) — alternate multi-chain indexer
- 22,000+ agents across 16 EVM chains + Solana
- Has a machine-readable skill doc: agentarena.site/skill.md
- x402-gated queries ($0.001 USDC/query), a real cost per lookup, unlike
  8004scan/DefiLlama's free tiers, use only if the free sources prove
  insufficient

### 5. Agent0 SDK Subgraph — GraphQL alternative
- Multi-chain GraphQL subgraph indexing ERC-8004 registries, mentioned
  directly in BNB Chain's own official AI agent solutions page
- github.com/agent0lab/subgraph
- Worth trying if REST-based 8004scan coverage feels incomplete for a
  specific query pattern GraphQL would handle better

### 6. Direct on-chain read — the ultimate fallback
- Real, confirmed Identity Registry ABI (register/ownerOf/getMetadata),
  from the official erc-8004-contracts repo
- BNB Chain mainnet address confirmed: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
- Independent of any indexer's uptime or completeness, the ground truth,
  but slower and needs to be built (event log parsing for AgentRegistered)

## Liveness checking — "is this agent still active"
Two real, complementary approaches, neither is in 8004scan's own data:
1. On-chain recency: does the agent's owner_address show recent
   transaction activity? (via the same Blockscout-style tooling used in
   OnChain Oversight, or BscScan's API)
2. Endpoint liveness: ERC-8004's registration schema requires an
   agent-card.json at a well-known URL per agent (services[] array in
   the registration). A simple HTTP HEAD/GET request to that URL,
   timing out gracefully, is a real, direct "is this thing actually
   running" signal, independent of any indexer.

## BNB Agent Studio itself
bnbagent-studio (pip install bnbagent-studio) is BNB Chain's own agent
scaffolding tool. Agents built through it get uniform metadata (since
Studio controls the deployment), likely a HIGHER-QUALITY subset worth
weighting/flagging distinctly if identifiable (e.g. via a Studio-specific
metadata tag, not yet confirmed whether one exists).

## Recommended layered fetch order for the marketplace
1. 8004scan for identity list (already built, working)
2. For each agent found: try a DefiLlama slug match (by name similarity)
   to enrich with real TVL if it exists, most won't match, that's honest
   and expected, not a bug
3. Liveness check via agent-card.json HTTP ping (best-effort, don't block
   the whole page on slow/dead endpoints, show status async)
4. Category classification via the existing categorize.py keyword matcher
