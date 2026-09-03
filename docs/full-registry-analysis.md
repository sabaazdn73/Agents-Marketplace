# Full Agent Registry Analysis: a separate, background, multi-chain dataset

The curated marketplace previously drew from `known_agents`, a small, live-fetched, diversity-capped snapshot. This pipeline builds a much larger, continuously-growing dataset separately, for analysis and reporting, and, as of 2026-08-28, also as the live marketplace's own background-refreshed source (see [Wiring into the live marketplace](#wiring-into-the-live-marketplace-2026-08-28) below), never a one-off report divorced from the product.

## Two corrections, acted on (2026-08-28)

1. **Feedback is non-trivial in aggregate; an earlier "feedback doesn't exist" framing was wrong.** 8004scan's own live `/networks` page reports **557,074+ feedbacks platform-wide**, including **11,719 feedbacks on BSC** and **441,569 on Base** (Base's feedback *density*, feedbacks per agent, is roughly 200x BSC's). The earlier claim ("zero feedback exists for any BSC agent") came from this project's own small, diversity-capped sample genuinely finding none; a correct result from that sample, but wrongly generalized into a platform-wide claim. See [Feedback distribution](#feedback-distribution) below for what the much larger full-registry sample actually shows, and [Known Limitations](limitations.md) for the corrected page.
2. **Solana is supported by 8004scan; an earlier "ERC-8004 is EVM-only" claim was wrong**, and so was the follow-up claim that ingesting it needs a separate Solana RPC integration. A 5,000-record sample that never queried Solana's own separate program concluded, wrongly, that ERC-8004 was EVM-only. 8004scan's `/networks` page shows **1,465 Solana agents** and 9,932 feedbacks, described there via a genuinely different technical structure (an Agent Registry Program `8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ` and ATOM Engine Program `AToMw53aiPQ8j7iHVb4fGt6nzUNxUhcPc3tbPBZuzVVb`). That description is accurate about Solana's own on-chain structure, but this project wrongly assumed it meant 8004scan's own REST API couldn't reach it either, and never actually tested that. Confirmed live (2026-08-28): the exact same `/api/v1/agents` REST endpoint used for the EVM chains already indexes Solana too, filtered with the correct `chain_id=101` param. The bug was that this project's own code was sending the wrong param name, `chainId` camelCase instead of `chain_id` snake_case; see [Solana ingestion](#solana-ingestion-a-dedicated-path-not-a-separate-rpc-integration-2026-08-28) below for the full correction.

## Why this is a separate pipeline, not a bigger `known_agents`, and the relationship between the two numbers

`known_agents` answers "what should a buyer browse." `full_agent_registry` answers "of every agent that exists on the chains we ingest, how many have we actually found so far." Different questions, different datasets, on purpose; mixing them would either bloat the browsing UI with near-duplicates or quietly cap the analysis dataset back down to the same diversity-limited sample it was built to move past.

**The precise relationship, worth referencing directly rather than assuming** (a live example, 2026-08-27): `full_agent_registry` held **63,291 BSC-tagged docs** and `known_agents` showed **13,847** at the same moment: two genuinely different numbers, not a bug.

- `full_agent_registry` is the **raw, deduplicated-by-nothing ingested pool**: every agent this pipeline's offset scan has reached so far, one document per on-chain registration, chain-tagged, growing with every ingestion run. It's never displayed directly.
- `known_agents` is a **smaller, deliberately diversified projection of it**: `core/aggregate.py`'s `get_agents_from_full_registry()` reads `full_agent_registry`'s current BSC-tagged contents, runs the multi-signal clustering pass (see below) to cap near-duplicate/mass-registered agents, and upserts the result into `known_agents` on each background refresh (`server.py`'s `_refresh_into_store`). `known_agents` also accumulates across refreshes (never deletes) and is re-diversified again on every read, so it isn't a fixed snapshot either.

So `known_agents` is not "capped at ~14k" in any hard sense; it's diversification applied to whatever `full_agent_registry` currently holds, which itself is still growing toward the ~285,868-agent BSC total (see current progress below). As `full_agent_registry` grows, `known_agents` grows with it after diversification. The two numbers will never be equal by design (diversification always reduces the raw count), but the gap between them narrowing over time, with both numbers climbing, is the expected signal that the pipeline is working, not stalled.

## Load-bearing finding: pagination depth, not request rate, is the bottleneck

Before writing any of this, the assumption ("Pro-tier's 3,000 req/min gives us the headroom for a full scan") was checked directly against the live API, and it was wrong in an important way. **8004scan's max page size is 100** (server-enforced; a request for anything above that returns a 422, tested up to 50,000 to be sure this wasn't a soft default). That part was expected. What wasn't: **`offset`-based pagination degrades sharply with depth**, measured live against the `/api/v1/agents` endpoint:

| Offset | Measured latency |
|---|---|
| 0 | 2.2s |
| 20,000 | 7.2s |
| 78,264 | 15.2s |
| 156,000 | 44.4s |
| 400,000 | >45s (timed out) |

Roughly super-linear: offset roughly doubling from 78k to 156k nearly *tripled* the latency, the classic signature of a naive SQL `OFFSET n` scan server-side. No alternative exists: `sortBy`, `cursor`, and `minTokenId` query params are all silently ignored (confirmed live: identical responses with or without them), and the registry contract itself is **not** `ERC721Enumerable` (`totalSupply()` reverts on a live `eth_call`), so there's no on-chain shortcut either.

**Practical consequence:** Pro-tier's request-rate budget (3,000/min, 3,000,000/day) is nowhere close to the actual bottleneck; a single request at deep offsets already costs 45+ seconds on its own. A literal, unbroken full linear scan to the end of the registry is not realistic in one sitting. This is why the pipeline below is built resumable rather than one-shot.

## Architecture

- **`backend/core/full_registry_ingest.py`**: resumable, **multi-chain** ingestion (extended 2026-08-28 to cover Base alongside BSC; see below). Checkpoints progress (`full_registry_ingest_progress`, one doc, `next_offset`/`total_ingested`/`started_at`/`completed_at`) in MongoDB after every page, so a batch can stop at a time budget and the next run picks up exactly where it left off, never skipping or re-doing a page on a clean stop. A mid-page failure leaves the checkpoint at the last *successful* offset.
- **`backend/core/full_registry_analysis.py`**: resumable analysis. Pulls agents that haven't been health-checked yet, reuses the *exact same* logic already used for the curated marketplace (`core/agent_health.py`'s `check_agents_health`, `core/categorize.py`'s `classify_agent`) rather than a separate, parallel implementation, and writes `service_status`/`category` back onto each doc. Also here: `compute_feedback_distribution()`, the investigation behind the feedback correction above.
- **`backend/core/clustering.py`**: the principled multi-signal deduplication pipeline (replaces the old single-heuristic version; see [Clustering methodology](#clustering-methodology-2026-08-28) below).
- **`backend/scripts/full_registry_scan.py`**: the runnable CLI: `ingest --minutes N [--restart]`, `analyze --minutes N`, `status`. Not a web route; this is long-running batch work, not something a request/response cycle should drive.
- **MongoDB collections**: `full_agent_registry` (one doc per agent, keyed by 8004scan's own `id`, tagged by its own `chain_id`; renamed from `full_bsc_registry` on 2026-08-28 when Base was added, with the ~40,184 BSC docs already ingested preserved, not discarded) and `full_registry_ingest_progress` (the single, now-multi-chain checkpoint doc, `_id: "multi_chain_evm"`). Both fully separate from the legacy `known_agents` collection.

## Multi-chain extension: Base added (2026-08-28)

Official per-chain figures, confirmed live from 8004scan's own `/networks` page (not the API, which has no per-chain stats endpoint):

| Chain | Agents | Feedbacks | Feedback density |
|---|---|---|---|
| Ethereum | 30,922 | 3,300 | 0.11/agent |
| **BSC** | 285,868 | 11,719 | 0.04/agent |
| **Base** | 52,548 | **441,569** | **8.4/agent** |
| Solana | 1,465 | 9,932 | 6.8/agent (dedicated ingestion path; see below. Same REST API, not a separate RPC integration) |

Base's feedback density is roughly 200x BSC's, by far the most feedback-active chain of the ones this pipeline can reach. Added to the ingestion scope alongside BSC.

**Efficiency insight that shaped the implementation:** a single raw page from 8004scan's listing API already contains a mix of chains (BSC's own share of a given page has been observed anywhere from 16% to 92% depending on offset). Rather than running two separate full linear scans (one per chain) that would each re-read the exact same pages, `adapters/bsc.py` gained `list_agents_for_chains()`, a generalization of the existing `list_bsc_agents()` that keeps agents matching any of a set of target chain ids from the same requests. One unified pass now captures both BSC and Base agents together. The checkpoint was reset to offset 0 for one fresh, combined pass; the shallow end of the latency curve above is the cheap part, so re-covering it once more to also pick up Base agents already scanned-but-discarded the first time is a worthwhile, bounded cost.

## Ethereum added to the same pipeline (2026-08-27)

A gap found and fixed: Ethereum's per-chain figures (30,922 agents, above) were already known when Base was added, but Ethereum was deliberately left out of `TARGET_CHAIN_IDS` at the time. Its only data lived in a genuinely separate, one-time collection (`future_multichain_agents`), confirmed live, not assumed: all 62 docs in it share the exact same `fetched_at` timestamp (`2026-08-25T12:29:29Z`), written by an older, different mechanism, never touched by this pipeline's own checkpoint/resume machinery and never refreshed since. That made Ethereum's coverage genuinely stale in a way BSC's and Base's isn't, since only they were on a repeatable ingest+analyze cycle.

Fixed the same way Base was added: `TARGET_CHAIN_IDS` extended to `{1, 56, 8453}`, checkpoint reset to offset 0 for one fresh combined pass (same cost/benefit reasoning as the Base addition: the shallow end of the latency curve is cheap, and Ethereum agents in the already-scanned range were being silently discarded under the old 2-chain filter). The same zero-marginal-cost efficiency insight applies again: every raw page this pipeline already reads for BSC/Base may also contain Ethereum agents, so adding a third chain_id to the same filter costs no additional API calls. Verified immediately after the change: a 15-page test batch captured `{56: 1374, 8453: 39, 1: 3}`, genuine Ethereum agents flowing into `full_agent_registry` from the very first batch. `future_multichain_agents` was kept in place as historical data for a while after this, no longer the only source for Ethereum — then deleted 2026-09-10 once confirmed every one of its 62 docs already existed in `full_agent_registry`, as part of a real, safe-data cleanup that reclaimed space on a MongoDB Atlas free-tier cluster that had hit its 512MB quota.

## Solana ingestion: a dedicated path, not a separate RPC integration (2026-08-28)

This section previously said Solana "genuinely does not fit this pipeline's shape" and would need a dedicated `adapters/solana.py` reading Solana program accounts directly via Solana RPC; scoped out entirely, not built. **That was wrong, and was never actually tested against 8004scan's own API before being written.**

Confirmed live: 8004scan's own `/api/v1/agents` REST endpoint, the exact same one already used for BSC/Base/Ethereum, already indexes Solana. The bug was a parameter name, not a missing integration: this project's code sent `chainId` (camelCase), which 8004scan's server silently ignores; the correct param, confirmed against 8004scan's own live OpenAPI spec, is `chain_id` (snake_case). Filtered correctly, `chain_id=101` returns valid Solana data: `total: 1462`, `chain_type: "solana"`, base58 owner addresses (e.g. `Aed6MTmMetXMmJR4inuWQUo157xtEijqbGGWuyzNGRxg`), and the Solana program address (`8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ`) in each doc's `contract_address` field.

What's genuinely different from Base/Ethereum, confirmed via a live scan (~700 items sampled across offsets 0-300,000 of the default, unfiltered listing): Solana items **never** appear in that shared, unfiltered stream, no matter how deep the scan goes. So unlike Base/Ethereum (which ride along for free in pages already being fetched for BSC), Solana can't just be added to `TARGET_CHAIN_IDS`; that would silently ingest nothing. It genuinely needs its own separately-filtered query.

Built accordingly, live-verified, not just planned:

- **`adapters/bsc.py`**: new `list_agents_by_chain_id()`, a correctly server-side-filtered fetch (`chain_id` param). The existing `chainId`-sending functions were deliberately left unchanged; the EVM page-mixing strategy actually depends on that param being ignored.
- **`core/full_registry_ingest.py`**: new `run_solana_ingest_batch()` / `get_solana_progress()`, the same resumable/checkpointed discipline as the EVM path, its own progress doc (`solana_mainnet`), writing into the same `full_agent_registry` collection Base and Ethereum already share.
- **`server.py`**: new `POST /api/admin/solana-registry-batch`, the same secret-gated pattern as the sibling batch endpoints, wired into the same 6-hour GitHub Actions schedule as a 4th step.

Live result: a single bounded batch call ingested all **1,462** Solana agents in **28.8 seconds**, confirmed present in `full_agent_registry` immediately after (`chain_id: 101` count = 1,462). Not surfaced on the live BSC-only marketplace; `core/aggregate.py`'s display path still filters strictly to `chain_id == 56`, unchanged by this work.

## Feedback distribution

Re-investigated with the much larger full-registry dataset rather than the small curated sample that produced the original, wrongly-generalized "zero feedback" finding. Current result:

| Chain | Agents sampled | Agents with any feedback | Feedback found |
|---|---|---|---|
| BSC | 40,333 | 5 | 5 (max 1 on any single agent) |
| Base | 8,914 | 2 | 2 (max 1 on any single agent) |

**Decisive finding: feedback is real but extremely concentrated, not spread thin evenly.** If BSC's 11,719 platform-wide feedbacks (per 8004scan's own `/networks` figures) were evenly distributed, a sample of 40,333 agents (about 14% of BSC's 285,868 total) should show roughly 1,650 feedbacks. It shows 5. Same story for Base, even more starkly: a sample of 8,914 agents (about 17% of Base's 52,548) should show roughly 74,900 feedbacks at the official average density; it shows 2. This means feedback is heavily concentrated on a subset of agents that this pipeline's current offset range (0-39,700 of the raw listing, roughly the first 5% of the full ~782,000-agent registry) simply hasn't reached yet, not that feedback doesn't exist, and not that it's evenly thin. Pinpointing exactly where it concentrates needs the ingestion to reach deeper into the registry, which, per the pagination-depth finding above, takes sustained, resumed runs over time, not one session. This file will be updated with the concentration pattern once data from a deeper range is in.

## Field inventory: everything 8004scan's rich detail endpoint returns

A live call to `GET /api/v1/agents/{chainId}/{tokenId}` (the per-agent detail surface, distinct from the list endpoint) against a known agent returned every one of the following top-level groups (not an exhaustive dump repeated here; see the response itself for exact values, this is the field *menu*):

- **Identity**: `id`, `agent_id`, `token_id`, `chain_id`, `chain_type`, `contract_address`, `is_testnet`, `name`, `description`, `agent_type`, `image_url`, `tags`, `categories`, `ens`, `did`
- **Ownership**: `owner_id`, `owner_address`, `owner_ens`, `owner_username`, `owner_avatar_url`, `owner_publisher_tier`, `owner_certified_name`, `creator_address`, `agent_wallet`
- **Services**: `services.a2a.{endpoint,version,skills}`, `services.web.endpoint`, `a2a_endpoint`, `a2a_version`, `mcp_server`, `mcp_version`, `agent_url`, `supported_protocols`, `x402_supported`, `supported_trust_models`
- **Scores (top-level, quick-reference)**: `total_score`, `quality_score`, `popularity_score`, `activity_score`, `wallet_score`, `freshness_score`, `metadata_completeness_score`, `rank`, `network_rank`
- **Scores (full breakdown, `scores.breakdown.*`)**: a genuinely rich scoring engine, per-dimension (`service`, `momentum`, `publisher`, `compliance`, `engagement`) scores/weights/details, including global-context numbers (`engagement.details.global_max`: platform-wide `max_chats`/`max_stars`/`max_views`/`max_feedbacks` (292,236) /`total_agents` (794,364, mainnet+testnet) /`mainnet_agents` (475,684) /`agents_with_feedbacks` (154,610), a genuinely useful, independent platform-wide feedback-coverage figure, about 32.5% of mainnet agents having at least one feedback platform-wide, an additional data point alongside the per-chain investigation above), a `leaderboard_policy` (merit/proof/support scores, `evidence_tier`, `integrity_tier`, `discoverability_tier`)
- **Health**: `is_endpoint_verified`, `endpoint_verified_at/_domain/_error`, `is_active`, `health_status.{services.*, owner_wallet, overall_status}` (per-service `status`/`message`/`latency_ms`/`checked_at`/`domain_verified`), `health_score`, `health_checked_at`
- **On-chain provenance**: `created_block_number`, `created_tx_hash`
- **Reputation**: `total_feedbacks`, `total_validations`, `successful_validations`, `average_score`
- **Raw metadata**: `raw_metadata.onchain[]` (key/value/decoded), `raw_metadata.offchain_uri`, `raw_metadata.offchain_content.{name,type,image,services[],description,registrations[],supportedTrust[]}`, `parse_status.{status,errors,warnings,info,last_parsed_at}`
- **Timestamps**: `created_at`, `updated_at`, `scores.last_scored_at`

Worth noting: several of these (the full `scores.breakdown` tree, `health_status` detail, `raw_metadata`) are only available from this per-agent detail call, not the list endpoint used for bulk ingestion; pulling them for all ~782,000 agents would mean one detail call per agent, a materially larger request budget than the bulk listing pass. Not done for the full registry in this pass; used selectively (already, via `adapters.bsc.fetch_agent_detail`) for the existing marketplace's own richer-data reclassification of Unclassified agents.

## Sponsor/partner API check for additional agent data

Beyond 8004scan, Zerion, CoinGecko, and TermiX (already integrated; see [Integrations](integrations.md)), checked whether other hackathon partners expose additional agent-relevant data:

- **PancakeSwap**: a live, keyless public API exists (`api.pancakeswap.info/api/v2/*`, tokens/pairs by reserves, no key required). Usable, but not agent-registry-aware: it's a general token/pair pricing and liquidity API, the same category of data DefiLlama (already integrated) already provides. Using it would need a currently-nonexistent mapping from "this agent" to "its own token's PancakeSwap pair," which nothing in 8004scan's own data establishes. Usable in principle, not meaningfully additive without building that mapping layer first.
- **AltLayer**: confirmed directly against their own docs: AltLayer's other products are rollup/restaking infrastructure (Restaked Rollup Framework, VITAL/MACH/SQUAD, a RaaS Launchpad). 8004scan (already fully integrated) IS their agent-discovery product; there is no separate, additional AltLayer agent API.
- **Altana**: confirmed directly against their own docs: no public directory/leaderboard/cross-agent-analytics API exists, only wallet/session-scoped functions (`grantSession`, `execute`, `balances`, hiring), all already integrated. A plain negative result.

## Clustering methodology (2026-08-28)

A correctly-identified methodological weakness in the original diversity cap: it collapsed agents purely on a description-template match (`core/aggregate.py`'s old `_cluster_signature`/`_diversify`), useful as a first pass, but risking silently hiding genuinely distinct agents that merely share a description template, and, worse if used alone, a shared owner wallet, which says nothing about whether two agents are actually the same thing.

**Explicit requirement this was rebuilt to satisfy: a wallet legitimately running several different agents must never be collapsed just because they share an owner; only genuine template/boilerplate duplication should be.**

New design (`backend/core/clustering.py`): two agents are only treated as duplicates of each other if **both** hold:
1. Their description-template signature matches (the blocking key, necessary, kept from the original approach, but no longer sufficient alone).
2. At least one further corroborating signal also agrees: the exact same registered service endpoint, registration timestamps within a 10-minute window (the same registration burst), or the same owner address, **as one signal among several, never alone**.

Implemented as a Union-Find (disjoint-set) clustering over agents that share a blocking-key bucket, not a flat dictionary bucket, so a chain of pairwise-corroborated agents ends up in one cluster even without every pair in it directly corroborating each other.

**Live validation before shipping** (20,000 BSC agents from `full_agent_registry`): the old blocking-key-only approach found 1,504 distinct buckets; the new multi-signal version found **4,095 clusters**, meaningfully more, meaning the new pipeline correctly recognizes distinctions the old one would have silently merged. Directly verified the exact scenario this was built for: an owner address with 8 agents in the sample split into **5 separate clusters**: one cluster for 3 agents sharing an exact "EvoEvo... creative challenger" template, a second for 2 agents sharing an exact "Smart-contrat audits..." template, and 3 more genuinely standalone (each a near-duplicate-but-not-quite of the audit template, differing by typos, "Samrt-contrat" vs "Smart-contrat" vs "Smart-contract", that the exact-match blocking key doesn't catch). The shared owner alone never caused a merge; only matching templates did.

**A limitation, not glossed over:** the blocking key is exact-text-match, not fuzzy; the three typo-variant agents just mentioned are near-duplicate examples that this version does NOT recognize as duplicates of each other, since "Samrt-contrat" and "Smart-contract" normalize to different strings. This is a gap, but a safe one to leave for now: it fails toward under-merging (treating a near-duplicate as distinct) rather than over-merging (treating a distinct agent as a duplicate), the safer direction given the explicit requirement above. A future improvement would add a fuzzy/edit-distance pre-check within each rough bucket.

**Re-verification of the whole pipeline after wiring the new clustering in**: `core/aggregate.py`'s `get_marketplace_agents()` (the live-fetch path) ran end to end against the live 8004scan API with the new clustering and returned 480 diversified agents at `max_offset=2000`, more than the old clustering returned at `max_offset=5000` (150, per this project's own earlier measurement), consistent with the new approach correctly preserving more genuine diversity rather than over-collapsing it.

## Wiring into the live marketplace (2026-08-28)

An architecture change: the marketplace's `/api/agents` route already had a proven "serve instantly from cache, refresh silently in the background" mechanism (`server.py`'s `_refresh_into_store`/`_background_refresh`, `_cache` with a 60-minute TTL, `BackgroundTasks`); this was never rebuilt, only re-pointed. `core/aggregate.py` gained `get_agents_from_full_registry()`: it reads the current contents of `full_agent_registry` (the background ingestion pipeline's own, continuously-growing dataset) instead of running a fresh, live, paginated 8004scan fetch, applies the same multi-signal clustering, and runs the result through the exact same enrichment tail (DefiLlama TVL, owner BNB balance, richer-data reclassification, factored into a shared `_enrich_and_build` helper so the live-fetch and full-registry-backed paths can never quietly drift apart) as the original live-fetch path.

`server.py`'s `_refresh_into_store` now tries the full-registry-backed path first, falling back to the original live 8004scan fetch only if `full_agent_registry` doesn't yet have at least 5,000 BSC agents (a deliberate degrade for a freshly-deployed instance, not a silent regression) or the read itself fails. Everything downstream, the `known_agents` upsert, the health-check pass, the response shape, the existing cache/TTL/background-refresh mechanics, is completely unchanged; only where the raw candidate pool comes from is different. This means the marketplace's displayed list can now be diversified from tens of thousands of already-ingested agents instead of whatever a single live fetch's own `max_offset` could reach, while still serving every request instantly from cache and never blocking a user on a live fetch.

**A bounded-cost fix made while wiring this in:** the richer-data reclassification sub-pass (one per-agent detail call for each still-Unclassified agent after the cheap classifier) was tuned for the live-fetch path's much smaller diversified set. Verified live that, unbounded, it made a full-registry-backed refresh take minutes instead of seconds against the much larger diversified set this new path can produce; capped to a bounded 300 agents per refresh cycle, with the rest keeping the cheap classifier's result for that cycle and getting a fresh chance on the next one, the same "eventually consistent, never blocking" philosophy as the rest of this refresh mechanism.

## A scope note on "verification"

The marketplace's "Verified working" tier means an on-chain-confirmed job through *this specific marketplace*. That's structurally near-meaningless for most of the full registry, which has never been hired through Tnega at all; reporting it here would be accurate (and correctly near-zero) but wouldn't answer a useful question. What this pipeline actually reports instead is simpler: does each agent's own registered endpoint respond right now, the same independent `service_status` signal already used everywhere else in this project. That's "alive" here; it is never conflated with "has confirmed paid work somewhere."

## Recommended refresh schedule: now actually wired to a scheduler (2026-08-28)

- **Ingestion**: incremental progress every 6 hours via the scheduler below; a full re-pass (`ingest --restart`) is still a manual, occasional decision (new agents register continuously, but resetting the checkpoint is a deliberate act, not something the scheduler does on its own).
- **Analysis**: also runs on the same 6-hour trigger; `core/agent_health.py`'s own 20-minute TTL means running it much more often wouldn't make additional progress anyway, so folding it into the same cheap, bounded call as ingestion is enough.
- **Fix shipped**: Render Cron Jobs are still a paid-plan feature (see below; this project's `render.yaml` only defines `type: web` services), so this doesn't use Render for scheduling. Instead: `backend/server.py`'s `POST /api/admin/full-registry-batch` (`X-Batch-Secret`-gated, the one deliberate exception to this project's normal "every route is public" pattern, since this one can trigger backend work and 8004scan quota use) runs one bounded ingest batch plus one bounded analysis batch, and `.github/workflows/full-registry-batch.yml` calls it every 6 hours via GitHub Actions' own scheduled workflows, genuinely free for this repository (confirmed live: this repo is public, and GitHub's own docs state Actions usage is free for standard runners on public repos, no minute cap). Setup: a `BATCH_TRIGGER_SECRET` value must be set identically as a GitHub Actions repository secret and as an env var on the Render backend service (the "Agents-Marketplace" service, `https://agents-marketplace-q3k4.onrender.com`); the workflow refuses to run without it, and the endpoint refuses every call without it configured. The script above (`scripts/full_registry_scan.py`) still works unchanged for a manual, longer, foreground run whenever that's preferred over the scheduled bounded batches.
- **Update (2026-08-29):** ingestion and analysis both also now run continuously on the paid Render Background Worker (`backend/worker.py`); see the dedicated section below for why, and for the guarantee this exists to provide. The 6-hour GitHub Actions cadence above stays in place as a deliberate, redundant safety net alongside the worker, not replaced by it, the same reasoning already established for the escrow-compat-audit step.

## Evaluation coverage guarantee: every ingested agent gets fully evaluated, in bounded time (2026-08-29)

**The non-negotiable requirement this section documents:** every agent that lands in `full_agent_registry` must go through every evaluation step this project has built for it, not eventually-maybe, not silently left behind as ingestion speeds up. This is checked and enforced by code, not left as an informal expectation.

### The complete mapping: every evaluation step, and its scope

| Step | What it does | Applies to | Coupled to ingestion? |
|---|---|---|---|
| **Categorization** (`core/categorize.py`) | Deterministic, keyword-based classification. Cheap, synchronous, no network. | Every `full_agent_registry` doc | Runs inside the same analysis batch as health-check (below) |
| **Health/liveness check** (`core/agent_health.py`) | Live on-chain `tokenURI` read + HTTP reachability check against the agent's own registered endpoint. | Every `full_agent_registry` doc | Yes; see below |
| **Escrow-compatibility audit** (`core/protocol_compat.py` / `core/escrow_compat_audit.py`) | Live multi-format A2A/ERC-8183 protocol probe. | `known_agents` only (the curated, diversified subset actually displayed/hireable in the marketplace), **deliberately not the full registry** | No; independent continuous loop, own scope |

**Why escrow-compat-audit is deliberately scoped to `known_agents` and not the full registry: a decision, not an oversight.** Its whole purpose is warning a buyer before they fund a job with an agent that can't actually receive it, a question that only matters for an agent someone could actually try to hire through this marketplace. Extending it to the full registry (785,000+ agents across BSC/Base/Ethereum, most of which are never surfaced or reachable through this BSC-only marketplace at all) would mean roughly 54x the live HTTP probe volume against endpoints with zero user-facing consequence if left unaudited. Confirmed with the user directly (2026-08-29) rather than assumed either way: keep it scoped to `known_agents`, where it already runs continuously with full coverage of that population.

Categorization and health-check are a different story: that data genuinely determines which agents even get considered for `known_agents`' own diversification, so leaving them behind ingestion speed would be a structural gap, not just an incomplete "nice to have" metric.

### The capacity math (measured, not guessed)

Live-measured 2026-08-29, at the same time the ingestion concurrency fix above was built:

- **Ingestion** (concurrent, `INGEST_CONCURRENCY = 20`): 3,381 agents in 50.3s, about **~242,000 agents/hour** at the depth measured.
- **Analysis** (health-check + categorization, existing `_CONCURRENCY = 12` in `agent_health.py`, unchanged): 300 agents in 18.8s, about **~57,600 agents/hour**.

**A severe capacity mismatch, confirmed.** Ingestion alone can run roughly 4x faster than analysis alone. Run both at their own unconstrained maximum speed and the ingested-but-unanalyzed backlog grows without bound: exactly the outcome this requirement exists to prevent.

### The fix: a bounded-backlog guarantee, not a hope that throughput happens to match

`backend/worker.py`'s ingestion loop checks the live unanalyzed backlog (`core/full_registry_analysis.get_unanalyzed_backlog()`) before every batch:

- **Pauses** ingestion once the backlog reaches **25,000** agents.
- **Resumes** only once the analysis loop (now also running continuously in the same worker) brings it back down to **15,000** or below (a hysteresis band, so the two loops don't flap pause/resume right at one boundary value).
- At analysis's own measured throughput, a 25,000-agent backlog is a bounded worst case of about **26 minutes** to clear, not an unbounded, silently growing gap.

Live-verified, not just designed: on first deploy with this change, the live backlog was already 37,822 (above the pause threshold); the worker correctly paused ingestion immediately, made zero live calls to 8004scan while paused, and the analysis loop kept making measured progress (300 agents per batch) until the backlog dropped back under the resume threshold.

### Ongoing visibility, never a hidden gap

`core/full_registry_analysis.compute_full_registry_stats()` (already existed) returns the live `total_ingested` vs `total_analyzed` counts at any time; the backlog is always `total_ingested - total_analyzed`, checkable live, never inferred or hidden. The worker's own logs additionally report the live backlog value on every ingestion batch it runs.

### What wasn't changed, and why

`agent_health.py`'s own internal concurrency (`_CONCURRENCY = 12`) was deliberately left as-is rather than raised to close the throughput gap directly. It's tuned to be polite to hundreds of different, arbitrary third-party agent hosts plus one shared public IPFS gateway (`ipfs.io`) that many agents' `tokenURI`s resolve through, a genuinely different concern from `INGEST_CONCURRENCY`'s own tuning against one paid, dedicated-capacity API this project has explicit, purchased headroom on. The bounded-backlog pause/resume mechanism above is the load-bearing guarantee; raising analysis concurrency further is a separate, identified lever for more raw throughput later, not required for the correctness guarantee this section documents.

## Render Workflows evaluated as a replacement for this manual pipeline (2026-08-27)

Live-verified against Render's own current docs (not assumed): this pipeline's pain point is exactly what Render Workflows is built for: automatic checkpointed resume after a crash, per-task retry logic, and massively parallel execution, instead of the current manual `full_registry_scan ingest`/`analyze` invocations this project has been running by hand in the background.

**Pricing, quoted directly from Render's own docs ([Intro to Workflows](https://render.com/docs/workflows), [Limits & Pricing for Workflows](https://render.com/docs/workflows-limits)):**

- **No free tier or free allowance at all**: unlike Render's free web services (which spin down but cost $0), a Workflow service has a quoted **$1/month minimum**, billed per second of actual task compute on top of that.
- Per-hour compute rates by instance type: `starter` $0.05/hr, `standard` (default) $0.20/hr, `2c-4g` $0.40/hr, `2c-8g` $0.70/hr, `4c-8g` $1.00/hr, `4c-16g` $1.50/hr; the `flex` instance type bills by actual CPU/RAM used ($0.20/CPU-hour + $0.05/GB-hour), capped at $0.40/hour if it constantly uses its full 1 CPU / 4 GB allocation.
- Task-state retention (the input arguments/return values Render keeps for checkpointed resume) is billed separately at **$0.25/GB-month** beyond 30 days.
- Render's own blog additionally confirms Workflows is moving to "active-compute pricing, expanded concurrency, and paid task state storage" on September 1: getting more explicitly paid, not less, going forward.

**Recommendation: do not adopt.** This is a genuinely paid product with no free tier, which fails this project's own standing "no paid/unknown-cost infrastructure without an explicit decision" rule the same way Render Cron Jobs already did above. Not because it wouldn't help (it genuinely would: automatic resume-after-crash is exactly the gap the current manual restart process has), but because adopting it would be an ongoing cost decision this project hasn't been asked to make. Noted here as a concrete future option if that decision is ever made explicitly: the migration would be straightforward, since `core/full_registry_ingest.py`'s `run_ingest_batch()` and `core/full_registry_analysis.py`'s batch functions are already written as bounded, resumable units that map naturally onto Workflow tasks.

## Current findings (updated 2026-08-28, partial, multi-chain)

Ingestion now covers a contiguous offset range past **44,700** of 8004scan's raw multi-chain listing (~782,629 total agents across every chain it indexes, as reported live at the time), multi-chain since the 2026-08-28 extension (see above). Current split: **40,333 BSC** + **8,989 Base** agents ingested (49,322 total docs in `full_agent_registry`). This is a genuine, representative sample, not the full registry (see coverage caveat below), but already ~29x larger than the curated marketplace's own old diversity-capped ~1,700, and, as of this same day, the marketplace's own live source (see [Wiring into the live marketplace](#wiring-into-the-live-marketplace-2026-08-28)).

Analysis (health-check + categorization) is being rebuilt after the bug described below wiped an earlier, larger pass; the last complete analysis run (before the wipe, on the BSC-only ingestion) found: **22,800 analyzed, 17,102 responding (75.0%)**, 5,612 no-endpoint (24.6%), 86 unknown (0.4%), zero not-responding. Category breakdown of that analyzed slice: dominated by **Unclassified** (~72%), then **Research**, **Gaming**, **Trading Signals**, **Payments & Settlement**, **Smart Contract Auditing**, consistent with the curated marketplace's own experience that most of the raw registry doesn't cleanly match a keyword category. A trend observed in that run: the responding rate climbed steadily with depth (~36% in the earliest offsets checked, up to 75% by offset ~79,500), not chased down to a confirmed root cause. A plausible explanation is that registrations aren't evenly distributed (campaign batches, some long abandoned, cluster differently at different offsets), stated as an observation, not a proven cause.

### Coverage caveat: how partial this is

- The offset range covered so far is a small fraction of the ~782,629 raw multi-chain total, not the whole registry.
- The BSC-vs-other-chain mix inside the range covered varies a lot by offset (this project's own spot-sampling has seen BSC's share swing anywhere from 16% to 92%); extrapolating a single ratio to estimate the true full BSC total carries real uncertainty and is not repeated here as a fixed number. See the live `by_chain` breakdown above instead of an extrapolation.
- Given the measured pagination-depth degradation, reaching the true end of the registry will take many more separate runs over an extended period. This file is updated as that progress accumulates, not re-promised as complete before it is.

### Bugs found and fixed during this pipeline's operation

1. **Timeout/retry gap (2026-08-27).** The first ingestion attempt died partway (offset ~13,900) with an uncaught, empty-message error. `adapters/bsc.py`'s `list_bsc_agents` hardcoded a 15-second timeout internally (fine for the marketplace's own shallow-offset refresh, never updated for this module's much deeper offsets) and its retry logic only handled HTTP 429; a genuine `httpx.TimeoutException`/`TransportError` (an *expected* outcome at depth per the latency curve above, not a rare fluke) propagated straight through, uncaught. Fixed: a configurable `timeout` parameter (this module passes a generous 90s) and retries on transient network/timeout errors too, with exponential backoff. Verified directly: the very next run completed its full 30-minute budget with zero failures.
2. **Analysis-wiping write (2026-08-28).** Found while extending to Base: `run_ingest_batch`'s `bulk_write` used `ReplaceOne` on each agent's full document, meaning any re-ingestion of an already-analyzed agent (which the multi-chain migration's own checkpoint reset triggered immediately) silently **overwrote** its `service_status`/`category` fields with the fresh raw-listing data alone, resetting analysis progress back to zero (confirmed live: `total_analyzed` dropped from 17,418 to 0 the moment the reset re-touched that offset range). Fixed: switched to `UpdateOne` with `$set`, a merge of the fresh raw fields that never touches fields the raw listing response doesn't include in the first place (the analysis fields survive re-ingestion). Analysis is being rebuilt as of this writing; the pre-wipe numbers above are reported as the last complete result, labeled as such rather than silently discarded.
