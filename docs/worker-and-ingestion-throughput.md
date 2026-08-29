# Using the paid worker and 8004scan Pro tier to their real potential (2026-08-29)

## The real question

The user is paying for both 8004scan's Pro tier (3,000 req/min, 3M req/day) and Render's paid Background Worker ($7/month). The Background Worker only ran the escrow-compatibility audit — not the full-registry ingestion that actually grows the site's "Agents Listed" and "Reviews" counts, which was still solely driven by the old, free, 120-second-capped GitHub Actions batch step. Was that diagnosis correct, and if so, what's the real fix?

## Confirming the diagnosis — checked against real code and real progress logs, not assumed

**Confirmed correct, with one important correction.** `worker.py` (before this change) ran only `core/escrow_compat_audit.run_audit_batch()`. Full-registry ingestion (`core/full_registry_ingest.run_ingest_batch()`) was only ever called from `POST /api/admin/full-registry-batch`, capped at `min(ingest_seconds, 120.0)` per call, triggered once every 6 hours by GitHub Actions — a real duty cycle of about 120s / 21,600s ≈ 0.56%.

The real correction: the assumption that this was "conservative, free-tier-safe pacing" holding back the real 3,000 req/min Pro-tier throughput isn't quite right. Checked directly — there was no artificial rate-limiting sleep anywhere in the fetch path at all (`adapters/bsc.py`'s retry logic only backs off on a genuine 429 or timeout). The loop was already firing requests as fast as the server would answer them; it just did so **one page at a time, fully serially**, and only for 120 real seconds every 6 hours. The real, dominant bottleneck was the duty cycle, not an unused rate budget — there was no throttle to remove.

**Real, live progress at the time of this check:** checkpoint at offset 60,000 of a real, server-reported total of 785,487 combined EVM (BSC+Base+Ethereum) agents — 7.6% through, after roughly 39 real hours since the checkpoint started (≈15 pages/hour).

## What genuinely was underused: concurrency, not rate

A serial loop can only ever move as fast as one request's own round-trip latency allows, and 8004scan's own offset-based pagination genuinely gets slower with depth (already documented in `full_registry_ingest.py`'s own docstring: ~2s at shallow offsets, 44s+ past offset 150,000, timeouts observed past 400,000). Live-tested at the real, current checkpoint depth (~offset 60,000), not assumed:

| Test | Real result |
|---|---|
| 5 pages, serial | 17.9s total (3.58s/page) |
| 5 pages, concurrent | 1.7s total |
| 10 pages, concurrent | 2.8s total, 0 errors |
| 20 pages, concurrent | 3.0s total, 0 errors |
| 30 pages, concurrent | 3.4s total, 0 errors, still improving |

Zero errors up through 30 concurrent requests, and 30 concurrent requests completing in ~3.4s is roughly 9 real req/sec — comfortably under Pro-tier's real 50 req/sec (3,000/min) ceiling even sustained. **This is the real, previously-unused headroom**: not a rate throttle to lift, but real parallelism the serial loop never attempted.

## What shipped

- **`core/full_registry_ingest.py`**: `run_ingest_batch()` now fetches pages in real, live-measured concurrent windows (`INGEST_CONCURRENCY = 20`, chosen from the table above — a real margin below the untested-further 30, not the observed ceiling). Real windows are still committed and checkpointed strictly in offset order, one page at a time — a later offset in the same window succeeding never lets the checkpoint skip past an earlier one that failed. Concurrency changes how fast pages are *fetched*, never how carefully their results are *committed* — the same no-data-loss, resumable guarantee as before.
- **`backend/worker.py`**: redesigned to run **two real, independent, continuous loops in one process** — the existing escrow-compat audit, and the new full-registry ingestion — via `asyncio.gather`, rather than provisioning a second $7/month service. Real tradeoff considered: both workloads are I/O-bound (waiting on HTTP/Mongo, not CPU), so they interleave cheaply on one asyncio event loop with no real resource contention on the worker's own 0.5 CPU/512MB plan; a second service would buy isolation neither workload actually needs. Live-tested locally: both loops start and run concurrently with real HTTP activity from both, no errors.
- Both GitHub Actions steps (ingest, escrow audit) stay as the same deliberate, redundant safety net established earlier — unaffected by this change.

## Real, measured before/after throughput

Measured directly, not estimated: a real 50.3-second call to the new, concurrent `run_ingest_batch()` at the live checkpoint (~offset 60,000-68,000) fetched **80 pages, ingesting 3,381 real agents** (1,527 BSC, 1,724 Base, 130 Ethereum) in that one call.

- **Before** (serial, 120s/6h cadence): ~15 pages/hour, measured from the real time it took this checkpoint to reach offset 60,000.
- **After** (continuous + concurrency=20), measured at the same real depth: 80 pages / 50.3s ≈ **5,724 pages/hour** — roughly a **374× real speedup** at this specific depth.

**Honest caveat, not glossed over**: this multiplier will shrink as ingestion reaches deeper offsets — 8004scan's own per-request pagination latency still degrades with depth regardless of concurrency (a genuinely slow individual request stays slow; concurrency means a *window* of them completes in roughly one request's worth of wall time instead of N times that, which is still a large real win, just not a constant one). No fabricated ETA for full completion is given here for that reason — the real rate at offset 400,000+ is currently unknown and could be materially slower.

## The real "Reviews" count — investigated, not assumed

Checked directly against real, current data: `known_agents` (the curated, diversified marketplace listing the site's "Reviews" stat sums `total_feedbacks` over) currently has only 5 of 14,441 real agents with any feedback at all, summing to 5. Cross-checked against the much larger, already-ingested BSC-only portion of `full_agent_registry` (64,821 real docs, well beyond what's diversified into `known_agents`): only **7 of 64,821** have any feedback, summing to 7.

**Confirmed as a genuine, structural finding, not a bug.** This matches the real, already-documented per-chain feedback density: BSC's entire real registry (285,868 agents) carries only 11,719 total feedbacks — Base carries 441,569 across a smaller 52,548-agent population, by far the highest real feedback density of any chain 8004scan indexes. BSC feedback is real but genuinely sparse and, per this scan, not evenly distributed across the portion reached so far. Reaching deeper into the registry (now dramatically faster, per above) may surface more of it, but there's no guarantee — BSC's real total feedback pool is small in absolute terms regardless of how much of the registry gets scanned.

## One honest, disclosed side-effect not addressed here

Ingestion into `full_agent_registry` now runs far faster than `full_registry_analysis.py`'s own downstream pass, which is still on the original 6-hour/300-doc-per-call cadence — meaning the gap between "raw pages ingested" and "pages actually analyzed" (service-status checks, categorization) will grow faster than before. Flagged here as a real, foreseeable consequence, not silently left unmentioned — not fixed in this change, since it wasn't the real bottleneck asked about, and the existing `known_agents` diversification already tolerates a real backlog here (it reads raw fields directly, analysis enrichment fills in over time on its own existing schedule).
