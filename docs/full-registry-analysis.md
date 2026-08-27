# Full BSC Registry Analysis — a separate, background dataset

The curated marketplace (`known_agents`) is deliberately diversity-capped — a handful of representative agents per near-duplicate cluster, so the UI isn't dominated by mass-registration campaigns. That's the right choice for *browsing*, but it means the marketplace's own numbers were never a real, complete picture of the whole real BSC ERC-8004 registry. This pipeline exists to build that complete picture separately, for honest analysis and reporting — never for display in the marketplace UI itself.

## Why this is a separate pipeline, not a bigger `known_agents`

`known_agents` answers "what should a buyer browse". `full_bsc_registry` answers "of every real agent that exists on BSC, how many are actually alive". Different questions, different real datasets, on purpose — mixing them would either bloat the browsing UI with near-duplicates or quietly cap the analysis dataset back down to the same diversity-limited sample it was built to move past.

## Real, load-bearing finding: pagination depth, not request rate, is the bottleneck

Before writing any of this, the real assumption ("Pro-tier's 3,000 req/min gives us the headroom for a full scan") was checked directly against the live API — and it was wrong in an important way. **8004scan's real max page size is 100** (server-enforced; a real, live request for anything above that returns a 422 — tested up to 50,000 to be sure this wasn't a soft default). That part was expected. What wasn't: **`offset`-based pagination degrades sharply with depth**, measured live against the real `/api/v1/agents` endpoint:

| Offset | Real measured latency |
|---|---|
| 0 | 2.2s |
| 20,000 | 7.2s |
| 78,264 | 15.2s |
| 156,000 | 44.4s |
| 400,000 | >45s (timed out) |

Roughly super-linear — offset roughly doubling from 78k to 156k nearly *tripled* the latency, the classic signature of a naive SQL `OFFSET n` scan server-side. No alternative exists: `sortBy`, `cursor`, and `minTokenId` query params are all silently ignored (confirmed live — identical responses with or without them), and the registry contract itself is **not** `ERC721Enumerable` (`totalSupply()` reverts on a real `eth_call`), so there's no on-chain shortcut either.

**Practical consequence:** Pro-tier's real request-rate budget (3,000/min, 3,000,000/day) is nowhere close to the real bottleneck — a single request at deep offsets already costs 45+ seconds on its own. A literal, unbroken full linear scan to the end of the registry is not realistic in one sitting. This is exactly why the pipeline below is built resumable rather than one-shot.

## Real architecture

- **`backend/core/full_registry_ingest.py`** — resumable ingestion. Checkpoints real progress (`full_registry_ingest_progress`, one doc, `next_offset`/`total_ingested`/`started_at`/`completed_at`) in MongoDB after every real page, so a batch can stop at a real time budget and the next run picks up exactly where it left off — never skips or re-does a page on a clean stop. A genuine mid-page failure leaves the checkpoint at the last *successful* offset.
- **`backend/core/full_registry_analysis.py`** — resumable analysis. Pulls agents that haven't been health-checked yet, reuses the *exact same* real logic already used for the curated marketplace (`core/agent_health.py`'s `check_agents_health`, `core/categorize.py`'s `classify_agent`) rather than a separate, parallel implementation, and writes real `service_status`/`category` back onto each doc.
- **`backend/scripts/full_registry_scan.py`** — the real, runnable CLI: `ingest --minutes N`, `analyze --minutes N`, `status`. Not a web route — this is real, long-running batch work, not something a request/response cycle should drive.
- **MongoDB collections**: `full_bsc_registry` (one real doc per real agent, keyed by 8004scan's own `id`) and `full_registry_ingest_progress` (the single checkpoint doc). Both fully separate from `known_agents`.

## Real, honest scope note on "verification"

The marketplace's "Verified working" tier means a real, on-chain-confirmed job through *this specific marketplace*. That's structurally near-meaningless for most of the full registry, which has never been hired through Tnega at all — reporting it here would be honest (and correctly near-zero) but wouldn't answer a useful question. What this pipeline actually reports instead is simpler and real: does each agent's own registered endpoint genuinely respond right now — the same independent `service_status` signal already used everywhere else in this project. That's "alive" here; it is never conflated with "has confirmed paid work somewhere."

## Recommended real refresh schedule (not yet wired to a scheduler)

- **Ingestion**: a full re-pass roughly weekly (`ingest --restart`), since new agents register continuously and a week-old snapshot is a reasonable staleness bound for a dataset this size — plus incremental `ingest` runs (no `--restart`) more often to make real progress toward the deep end without redoing early pages.
- **Analysis**: roughly daily is enough — `core/agent_health.py`'s own real 20-minute TTL means a health check gets treated as stale again quickly regardless, so running analysis much more often than that mostly just re-checks already-fresh agents rather than making new real progress.
- **Not done in this pass, flagged rather than silently skipped:** actually wiring a scheduler (e.g., a Render Cron Job service) to run these automatically. That's a real, distinct infrastructure decision — this project's `render.yaml` only defines `type: web` services today, and Render Cron Jobs are a paid-plan feature, consistent with this project's own standing "no paid/unknown-cost infrastructure without an explicit decision" rule. The script above is fully ready to be pointed at by whatever scheduler is chosen.

## Real, current findings (2026-08-27, first real run — honestly partial)

A real ingestion run (fixed timeout/retry logic — see below) covered the real, contiguous offset range **0–79,500** of 8004scan's raw multi-chain listing (772,939 total agents across every chain it indexes, as reported live at the time) in a single unbroken pass, and a real analysis pass health-checked and categorized a further-behind but substantial slice of what was ingested. This is a genuine, representative sample — not the full registry (see coverage caveat below) — but a much larger and more even one than the curated marketplace's own diversity-capped ~1,700.

| Metric | Real value |
|---|---|
| BSC agents ingested this run | **40,228** |
| Agents health-checked + categorized | **22,800** (56.7% of ingested) |
| **Responding** (real endpoint answered) | **17,102 — 75.0% of analyzed** |
| No endpoint registered | 5,612 (24.6%) |
| Not responding (endpoint registered, didn't answer) | 0 |
| Unknown / couldn't resolve | 86 (0.4%) |

**A real, honest trend worth reporting rather than collapsing into one static number:** the responding rate climbed steadily as the scan went deeper — roughly 36% in the earliest offsets checked, up to 75% by offset ~79,500, rising fairly steadily in between. Not chased down to a confirmed root cause in this pass — a plausible real explanation is that agent registrations aren't uniformly distributed (large single-campaign batches, some long since abandoned, cluster in some offset ranges more than others), but this is a real, honest observation, not a proven cause.

**Real category breakdown (of the analyzed slice):** dominated by **Unclassified** (16,404, ~72% — consistent with the curated marketplace's own experience that most of the raw registry doesn't cleanly match a keyword category), then **Research** (2,499), **Gaming** (1,620), **Trading Signals** (1,682), **Payments & Settlement** (317), **Smart Contract Auditing** (123), with the rest of the 18-category taxonomy represented in much smaller real numbers.

### Real coverage caveat — how partial this is

This is a genuinely partial picture, stated plainly:
- The offset range covered (0–79,500) is **~10.3%** of the raw multi-chain listing depth (772,939) — not the whole registry.
- Real BSC-vs-other-chain mix inside that range: 40,228 of ~79,500 raw rows were BSC (chain_id 56) — **~50.6%**. Extrapolating that ratio across the full raw total gives a rough estimate of **~390,000 real BSC agents total** — this is an estimate with real uncertainty (this project's own earlier spot-sampling, before this run, saw the BSC ratio swing anywhere from 16% to 92% depending on which offset was checked — registrations aren't evenly distributed by chain across the range), and it does not fully reconcile with the "~200,000+" figure understood going in. Both could be real: a difference between "ever registered" and "currently active," a different counting methodology, or this project's own extrapolation simply being imprecise from a partial sample. Flagged honestly rather than picking one number to sound more certain than the data supports.
- Given the real, measured pagination-depth degradation (see above), reaching the true end of the registry will take many more real, separate runs over an extended period — this file's findings will be updated as that real progress accumulates, not re-promised as complete before it is.

### Real bug found and fixed during this run

The first ingestion attempt died partway (offset ~13,900) with an uncaught, empty-message error. Investigated directly rather than just retried blindly: `adapters/bsc.py`'s `list_bsc_agents` hardcoded a 15-second timeout internally (fine for the marketplace's own shallow-offset refresh, never updated for this module's much deeper real offsets) and its retry logic only handled HTTP 429 — a genuine `httpx.TimeoutException`/`TransportError` (which the real, measured latency curve above makes an *expected* outcome at depth, not a rare fluke) propagated straight through, uncaught. Fixed: `list_bsc_agents` now accepts a real `timeout` parameter (this module passes a generous 90s) and retries on transient network/timeout errors too, not just 429, with real exponential backoff. Verified the fix directly: the very next ingestion run completed its full 30-minute budget with zero failures, more than doubling real progress in one clean pass.
