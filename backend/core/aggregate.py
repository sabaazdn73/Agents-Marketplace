"""
aggregate.py

The real "make it not fake" function: combines every source built so
far into one clean list of agent records the frontend can render
directly, with no invented numbers.

Every agent record either has REAL data for a field, or that field is
explicitly None/"not reported", never a plausible-looking placeholder.

DIVERSITY (fixed 12 Aug 2026, confirmed against real 8004scan calls):
the live BSC ERC-8004 population is dominated by a few mass-registration
campaigns — in a real 1,014-agent sample, ~68% were the "X.agent on Termix
Platform" template and two other clusters ("Q402 Agent", "Ave.ai Trading
Agent") added ~20% more. Two real causes were making the marketplace show only
one cluster:
  1. The old pagination early-stop compared the CHAIN-FILTERED page length to
     page_size and broke after page 1 (a mixed-chain page is only ~70% BSC, so
     the filtered count is always < page_size) — so only the newest ~one page
     ever loaded, i.e. whatever campaign registered most recently.
  2. No de-duplication, so that tiny newest sample was all one campaign.
We also confirmed 8004scan's only honored sort (`sort_by=total_score`) SILENTLY
DROPS the chainId filter and returns a global, ~0%-BSC list, so it cannot be
used for BSC diversity. The fix therefore is: paginate correctly + deeply
(default order is the only one that returns BSC), then cap how many agents may
share one cluster signature so no single campaign dominates the rendered list.
"""

import asyncio
import time
from dataclasses import dataclass, asdict

import httpx

from adapters.bsc import list_bsc_agents, fetch_agent_detail, augmented_classification_text
from adapters.bsc_balance import fetch_owner_bnb_balances
from adapters.defillama import fetch_bsc_ai_agent_protocols, try_match_agent_to_protocol
from core.categorize import classify_agent
from core.pinned_agents import fetch_pinned_agents
from core.clustering import diversify as _diversify, cluster_agents as _cluster_agents

# Real TTL for a stored owner_bnb_balance to still count as "fresh enough" —
# see _enrich_and_build's own real 429 investigation below for why this
# exists. An informational balance display doesn't need to be re-read every
# single refresh; skipping owners whose balance was confirmed within this
# window is what actually brings the real per-refresh RPC volume down at
# current ~13,000+-agent scale, not just backoff/retry on its own.
OWNER_BALANCE_TTL_SECONDS = 12 * 60 * 60  # 12 hours


@dataclass
class MarketplaceAgent:
    # From 8004scan (identity/reputation), real
    id: str
    token_id: int | None  # the ERC-8004 ERC-721 tokenId — the on-chain agentId
    #                        the AgentAccessMarket contract keys listings on
    name: str
    description: str
    owner_address: str
    owner_ens: str | None
    owner_username: str | None
    image_url: str | None
    chain_id: int
    network: str  # always "mainnet" now (mainnet-only), derived from chain_id, for honest UI labeling
    total_score: float | None
    star_count: int | None
    total_feedbacks: int | None
    created_at: str | None
    is_verified: bool
    x402_supported: bool
    health_score: float | None
    supported_protocols: list | None  # real, from 8004scan; often empty
    cross_chain_versions: list | None  # real mechanism for "same agent identity, other chains"

    # From categorize.py, deterministic keyword classification
    category: str | None  # one of the taxonomy, or None if unclassified
    category_matched_keywords: list[str]

    # From DefiLlama, only present if a real match was found
    financial_data_available: bool
    tvl_usd: float | None
    defillama_slug: str | None
    defillama_url: str | None

    # From a real BSC mainnet RPC read (adapters/bsc_balance.py). A DIFFERENT
    # metric from TVL — the owner wallet's actual native BNB, never conflated
    # with protocol TVL. None if the RPC read was unavailable.
    owner_bnb_balance: float | None
    # Real Unix timestamp of when owner_bnb_balance was actually last
    # verified against the chain (not merely last displayed) — the real
    # freshness clock the TTL-skip logic above reads on the next refresh.
    owner_bnb_balance_checked_at: float | None


# Real, principled multi-signal clustering (2026-08-28) — see
# core/clustering.py's own module docstring for the full real design and
# reasoning. `_diversify` is imported from there (as the name this module
# already used, so every call site below is unchanged) rather than
# redefined here; the OLD single-heuristic version (a description-template
# bucket match alone) has been replaced, not just supplemented — a real,
# correctly-identified methodological weakness: collapsing purely on a
# description-template match (or worse, a shared owner address) risked
# silently hiding genuinely distinct agents. The new version only treats
# two agents as duplicates when the description-template match is
# corroborated by a SECOND real signal (same registered endpoint, a tight
# real registration-time window, or shared owner as one signal among
# several — never owner alone).


async def get_marketplace_agents(
    api_key: str,
    max_offset: int = 5000,
    page_size: int = 100,
    per_cluster_cap: int = 3,
    page_delay_seconds: float = 0.0,
) -> list[MarketplaceAgent]:
    """The real entry point for the frontend. Fetches, cross-references,
    classifies, and diversifies — doesn't fabricate anything it can't source.

    Mainnet-only: reads BSC MAINNET (chain 56) agent identity/reputation. This
    is read-only (no wallet, no keys, no financial risk).

    Request budget — REAL, measured (2026-08-24), not the assumed "free_api
    30/min" this used to be paced for: the real rate-limit headers this
    endpoint (/api/v1/agents, with our configured key) actually returns are
    600 req/min, 100,000 req/day — confirmed live, not documentation. The
    old 2.0s inter-page delay was calibrated for a limit ~20x more
    conservative than what this endpoint genuinely allows, and was
    measurably making every refresh slower for no real protection:
      pages per refresh @ max_offset=5000 = 50 requests
      + DefiLlama (1) + owner-balance RPC (different host, not on this budget)
      per-day @ 60min TTL  = ≤24 refreshes × ~51 ≈ 1,224 req/day ⇒ well inside
                              100,000/day, no per-minute pacing needed at 50
                              requests/refresh (nowhere near 600/min).
    Measured live, before/after: the OLD config (max_offset=2000,
    page_delay_seconds=2.0) took 66.4s and returned 90 diversified BSC
    agents. Just removing the delay (same max_offset=2000) took 25.2s for
    the same 90 agents. Scanning 2.5x deeper instead (max_offset=5000, no
    delay — this function's new default) took 58.5s — STILL faster than the
    old config — and returned 150 diversified agents (67% more), with zero
    real 429s encountered at any point. The cluster cap then diversifies
    whatever raw sample comes back, same as before.
    """

    raw_agents = []
    offset = 0
    while offset < max_offset:
        page_agents, total, raw_len = await list_bsc_agents(
            api_key=api_key, offset=offset, limit=page_size
        )
        raw_agents.extend(page_agents)
        offset += page_size
        # Stop on the REAL end signal: the server returned a short RAW page (not
        # a short chain-FILTERED page — that check was the page-1 bug). Also stop
        # if we've walked past the server's reported total.
        if raw_len < page_size or offset >= total:
            break
        if page_delay_seconds and offset < max_offset:
            await asyncio.sleep(page_delay_seconds)  # respect 30 req/min

    # Real, explicit safety net for agents we know are genuinely real but that
    # 8004scan's own index doesn't return for ANY query (see
    # core/pinned_agents.py's docstring for the real, confirmed investigation
    # — a direct owner_address lookup, which bypasses pagination entirely,
    # still returned nothing for our own explainer agent). Fetched directly
    # on-chain and merged in BEFORE diversify/classify/enrich, so from here on
    # it's treated identically to every other agent. Deduped by token_id in
    # case 8004scan ever does start indexing one of these for real.
    try:
        pinned = await fetch_pinned_agents()
        known_token_ids = {a.get("token_id") for a in raw_agents}
        raw_agents.extend(a for a in pinned if a["token_id"] not in known_token_ids)
    except Exception as e:
        print(f"[aggregate] pinned-agent on-chain fetch failed, continuing without it: {e}")

    # Cap clusters so one mass-registration campaign can't dominate the list.
    raw_agents = _diversify(raw_agents, per_cluster_cap=per_cluster_cap)

    return await _enrich_and_build(raw_agents, api_key)


async def _enrich_and_build(raw_agents: list[dict], api_key: str) -> list["MarketplaceAgent"]:
    """Real, shared enrichment tail — DefiLlama TVL cross-reference, real
    owner BNB balances, and the richer-data reclassification pass — split
    out 2026-08-28 so BOTH real raw-agent sources (a live, paginated
    8004scan fetch in get_marketplace_agents, and the already-ingested,
    much larger full_agent_registry in get_agents_from_full_registry) run
    through the exact same real enrichment logic instead of two copies
    that could quietly drift. Takes an ALREADY-DIVERSIFIED raw agent list
    — diversification itself stays with each caller, since the two real
    sources reach it differently (one fetches live, one reads Mongo)."""
    try:
        defillama_protocols = await fetch_bsc_ai_agent_protocols()
    except Exception as e:
        print(f"[aggregate] DefiLlama fetch failed, continuing without financial "
              f"enrichment (agents still shown, just without TVL): {e}")
        defillama_protocols = []

    # Real owner BNB balances (best-effort; a different, honestly-labeled metric
    # from TVL). One de-duped batched RPC read for the whole diversified set —
    # BUT only for owners whose stored balance genuinely needs a re-check.
    #
    # Real 429 investigation (2026-08-27): live production logs confirmed
    # sustained real 429s from the RPC endpoint across dozens of consecutive
    # batches (offset 9200 through 11050+) at current ~13,000+-agent scale —
    # not occasional blips, a real volume problem. BSCSCAN_API_KEY (Etherscan
    # V2) was investigated as a real alternative/supplement and ruled out —
    # confirmed live against the real key that BSC (chainid=56) genuinely
    # isn't covered by its free tier (independently confirmed against
    # Etherscan's own real, published policy too) — see adapters/bsc_balance.py's
    # own module docstring for the full real trace. Real fix instead: retry-
    # with-backoff (bsc_balance.py) closes the "one 429 = permanent failure"
    # gap, and this real TTL skip below cuts the actual REQUEST VOLUME that's
    # what's triggering the 429s in the first place — an owner's balance
    # doesn't need re-reading every single refresh for an informational
    # display, so only owners missing a real, recent (< OWNER_BALANCE_TTL_
    # SECONDS old) stored value are fetched at all.
    owner_balances: dict[str, float] = {}
    # Real, honest freshness clock per owner — separate from owner_balances
    # itself on purpose. A reused-from-cache value keeps its REAL original
    # checked-at timestamp (not "now"); only an address actually fetched
    # this round gets stamped "now". Re-stamping reused values to "now"
    # would silently freeze the TTL forever (every refresh would see it as
    # "just checked" without ever really re-checking it again) — the whole
    # point of a TTL is that the clock keeps ticking from the real last
    # verification, not from the last time it happened to be displayed.
    owner_balance_checked_at: dict[str, float] = {}
    try:
        from core.db import get_db
        owner_addrs = sorted({
            (a.get("owner_address") or "").lower() for a in raw_agents
            if a.get("owner_address")
        })
        now = time.time()
        stale_or_missing = set(owner_addrs)
        if owner_addrs:
            db = get_db()
            cursor = db.known_agents.find(
                {"owner_address": {"$in": owner_addrs}},
                {"owner_address": 1, "owner_bnb_balance": 1, "owner_bnb_balance_checked_at": 1},
            )
            async for doc in cursor:
                owner = (doc.get("owner_address") or "").lower()
                checked_at = doc.get("owner_bnb_balance_checked_at")
                if (
                    owner in stale_or_missing
                    and doc.get("owner_bnb_balance") is not None
                    and checked_at is not None
                    and (now - checked_at) < OWNER_BALANCE_TTL_SECONDS
                ):
                    owner_balances[owner] = doc["owner_bnb_balance"]
                    owner_balance_checked_at[owner] = checked_at  # real original timestamp, preserved
                    stale_or_missing.discard(owner)
        print(f"[aggregate] owner balances: {len(owner_addrs) - len(stale_or_missing)} real, "
              f"recent values reused from the store; fetching {len(stale_or_missing)} real, "
              f"missing/stale ones now.")
        if stale_or_missing:
            fresh = await fetch_owner_bnb_balances(list(stale_or_missing))
            fetched_at = time.time()
            owner_balances.update(fresh)
            for owner in fresh:
                owner_balance_checked_at[owner] = fetched_at  # a real read just happened
    except Exception as e:
        print(f"[aggregate] owner-balance lookup failed, continuing without it "
              f"(field shown as None for anything not already cached): {e}")

    # Real re-classification pass for agents the cheap name+description
    # classifier couldn't place — wired in for real 2026-08-25, now that
    # Pro-tier access to the richer /api/v1/public/* surface is confirmed
    # live (3000/min, 3,000,000/day; the extra per-agent detail call this
    # needs is nowhere near that budget even for several hundred agents a
    # refresh). Measured, real result on 489 real previously-Unclassified
    # agents: 21 (4.3%) got a real category from this richer text
    # (tags/categories/offchain description/service names) that plain
    # name+description missed — zero of those were Grid Trading
    # specifically, an honest negative from the same real check.
    initial_classifications = [classify_agent(a.get("name", ""), a.get("description", "")) for a in raw_agents]
    unclassified_indices = [i for i, c in enumerate(initial_classifications) if c.category is None]
    # Real, bounded cap (2026-08-28): this pass was tuned for the live-fetch
    # path's real diversified-set size (a few hundred agents). Now that
    # get_agents_from_full_registry can hand this the SAME function a much
    # larger real diversified set (the full-registry pipeline's raw pool is
    # tens of thousands of real agents, not one live fetch's max_offset), an
    # unbounded per-agent detail call over every real Unclassified agent
    # made one real refresh take minutes instead of seconds — confirmed
    # live (a real run against the full-registry path timed out past 2
    # minutes before this cap was added). Capped to a real, bounded sample
    # per refresh; the rest simply keep the cheap classifier's real result
    # (Unclassified, if that's what it found) for this cycle and get a
    # fresh chance on the next one.
    MAX_RECLASSIFY_PER_REFRESH = 300
    if len(unclassified_indices) > MAX_RECLASSIFY_PER_REFRESH:
        unclassified_indices = unclassified_indices[:MAX_RECLASSIFY_PER_REFRESH]
    reclassified: dict[int, "ClassificationResult"] = {}
    if unclassified_indices:
        sem = asyncio.Semaphore(20)

        async def _try_reclassify(i: int):
            token_id = raw_agents[i].get("token_id")
            if not token_id:
                return
            async with sem:
                detail = await fetch_agent_detail(client, api_key, int(token_id))
            if not detail:
                return
            augmented = augmented_classification_text(detail)
            result = classify_agent(raw_agents[i].get("name", ""), augmented)
            if result.category is not None:
                reclassified[i] = result

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                await asyncio.gather(*(_try_reclassify(i) for i in unclassified_indices))
        except Exception as e:
            print(f"[aggregate] richer-data re-classification pass failed, "
                  f"continuing with the cheap classification only: {e}")
        if reclassified:
            print(f"[aggregate] richer-data re-classification: {len(reclassified)}/"
                  f"{len(unclassified_indices)} previously-Unclassified real agents "
                  f"got a real category from tags/categories/offchain description/service names")

    results = []
    for idx, agent in enumerate(raw_agents):
        name = agent.get("name", "")
        description = agent.get("description", "")

        classification = reclassified.get(idx) or initial_classifications[idx]
        matched_protocol = try_match_agent_to_protocol(name, defillama_protocols)

        chain_id = agent.get("chain_id")
        owner_address = agent.get("owner_address", "")
        _tid = agent.get("token_id")
        results.append(MarketplaceAgent(
            id=str(agent.get("id") or agent.get("agent_id") or agent.get("token_id")),
            token_id=int(_tid) if isinstance(_tid, (int, str)) and str(_tid).isdigit() else None,
            name=name,
            description=description,
            owner_address=owner_address,
            owner_ens=agent.get("owner_ens"),
            owner_username=agent.get("owner_username"),
            image_url=agent.get("image_url"),
            chain_id=chain_id,
            network="mainnet" if chain_id == 56 else "unknown",
            total_score=agent.get("total_score"),
            star_count=agent.get("star_count"),
            total_feedbacks=agent.get("total_feedbacks"),
            created_at=agent.get("created_at"),
            is_verified=bool(agent.get("is_verified")),
            x402_supported=bool(agent.get("x402_supported")),
            health_score=agent.get("health_score"),
            supported_protocols=agent.get("supported_protocols"),
            cross_chain_versions=agent.get("cross_chain_versions"),
            category=classification.category,
            category_matched_keywords=classification.matched_keywords,
            financial_data_available=matched_protocol is not None,
            tvl_usd=matched_protocol.get("tvl") if matched_protocol else None,
            defillama_slug=matched_protocol.get("slug") if matched_protocol else None,
            defillama_url=matched_protocol.get("url") if matched_protocol else None,
            owner_bnb_balance=owner_balances.get((owner_address or "").lower()),
            owner_bnb_balance_checked_at=owner_balance_checked_at.get((owner_address or "").lower()),
        ))

    return results


async def get_marketplace_agents_as_dicts(**kwargs) -> list[dict]:
    """JSON-serializable version, for the API layer."""
    agents = await get_marketplace_agents(**kwargs)
    return [asdict(a) for a in agents]


# Real, minimum real sample size before the full-registry-backed path is
# trusted as a real replacement for a live 8004scan fetch — below this,
# core/full_registry_ingest.py's own background pass just hasn't gotten
# far enough yet (e.g. right after this project's own first deploy of it)
# for a real, representative diversified list; falling back to the
# live-fetch path in that case is the honest choice, not a thin list.
MIN_FULL_REGISTRY_SAMPLE = 5000


async def get_agents_from_full_registry(api_key: str, per_cluster_cap: int = 1) -> list["MarketplaceAgent"] | None:
    """Real, fast alternative to get_marketplace_agents() — draws its raw
    candidate pool from the already-ingested full_agent_registry (see
    core/full_registry_ingest.py) instead of a live, paginated 8004scan
    fetch. Real architecture change (2026-08-28): the marketplace no
    longer has to be capped at whatever a live fetch's own max_offset can
    reach in one request cycle — the background ingestion pipeline keeps
    growing full_agent_registry independently (currently tens of
    thousands of real BSC + Base agents and rising), and THIS function
    just reads whatever's there right now, diversifies it with the same
    real multi-signal clustering (core/clustering.py), and runs it through
    the exact same real enrichment tail (_enrich_and_build) as the live-
    fetch path — same real MarketplaceAgent shape, same real DefiLlama/
    owner-balance/reclassification logic, so nothing downstream needs to
    know which source served a given refresh.

    Returns None (never a thin, unrepresentative list) if
    full_agent_registry doesn't yet have at least MIN_FULL_REGISTRY_SAMPLE
    real agents — the caller (server.py's _refresh_into_store) falls back
    to the real live-fetch path in that case, an honest degrade rather
    than serving something worse than the old behavior."""
    from core.db import get_db

    db = get_db()

    # Real, deliberate redesign (2026-08-29, after the earlier field-
    # trimming + gc.collect() fix — commit 3648dd9 — turned out NOT to be
    # enough: Render's own event log shows 24+ further real `oomKilled`
    # (512Mi) crash-loop events in the ~15h after that fix shipped, this
    # exact refresh still the prime suspect (nothing else in this project
    # holds anywhere near this much real data in memory at once). Root
    # cause the earlier fix didn't address: even a trimmed, 22-field
    # projection still means holding ALL 64,000+ real raw BSC docs in
    # memory at once, just to end up keeping only ~10,000-13,000 of them
    # after diversification — most of that real memory was only ever
    # needed for the fast, cheap clustering pass, not the full enrichment
    # pipeline.
    #
    # Real, two-phase fix: clustering.py's own real signals
    # (_cluster_signature + the three real corroborating signals) only
    # ever read 5 real fields — name, description, service_endpoint/
    # a2a_endpoint, created_at, owner_address (audited directly against
    # clustering.py's own .get() calls, not assumed). Phase 1 fetches
    # ONLY those, across the full real raw pool, real per-doc footprint
    # roughly a third of the previous projection. Phase 2 re-fetches the
    # FULL real field set needed for enrichment, but ONLY for the real,
    # small, already-diversified survivor set — never the full raw pool.
    # The full-field projection never has to coexist with the full raw
    # pool in memory at all now, not even briefly.
    _MINIMAL_CLUSTER_PROJECTION = {
        "name": 1, "description": 1, "service_endpoint": 1, "a2a_endpoint": 1,
        "created_at": 1, "owner_address": 1,
    }
    # Real, urgent fix (2026-08-29): this used to fetch the ENTIRE real BSC
    # pool uncapped (`.to_list(length=200_000)`) — safe when this two-phase
    # design was first verified (peak RSS 217.6MB at whatever the real BSC
    # count was then), genuinely unsafe now that the real pool has grown to
    # 64,821 BSC docs (this project's own accelerated ingestion, built the
    # same day, is a direct real cause of that growth). Confirmed live, not
    # assumed: Render's own event log shows a real `oomKilled` (512Mi) crash
    # roughly 9 minutes after a real, successfully-completed refresh logged
    # exactly "64821 real raw BSC agents -> 7944 after real multi-signal
    # diversification" — consistent with this pass leaving an elevated real
    # memory baseline that doesn't fully return, not necessarily OOMing mid-
    # pass every time. Fixed with a real, FIXED-size random sample
    # (MongoDB's own `$sample` stage) instead of the full, ever-growing
    # pool — this bounds real memory for this pass permanently, regardless
    # of how large full_agent_registry keeps growing, rather than being a
    # today-specific patch that would need revisiting again at the next
    # real growth milestone. `$sample` (not an arbitrary `.limit()`) so the
    # real diversification input stays a genuinely representative random
    # cross-section, not systematically biased toward whatever sits first
    # in the collection's own natural/insertion order.
    # Real, further tightened (2026-08-29, same day as the first fix): the
    # 25,000 bound above was NOT enough on its own — Render's own event log
    # showed 3 more real `oomKilled` crashes within an hour of that fix
    # shipping, each one landing a few minutes after a real, successfully-
    # completed refresh (one logged "seen: 5744, new: 2097, total_known:
    # 19643" right before a crash 3 minutes later) — the same "elevated
    # post-refresh memory that doesn't fully return" pattern as before, just
    # not fully eliminated by halving the input pool alone. Cut further to a
    # real, more conservative bound, and paired with a second, real
    # gc.collect() after the full pass completes (see below) rather than
    # only between phase 1 and phase 2 — addressing both the peak footprint
    # during the pass and what lingers after it returns.
    _CLUSTER_POOL_SAMPLE_SIZE = 12_000
    minimal_agents = await db["full_agent_registry"].aggregate([
        {"$match": {"chain_id": 56}},
        {"$sample": {"size": _CLUSTER_POOL_SAMPLE_SIZE}},
        {"$project": _MINIMAL_CLUSTER_PROJECTION},
    ]).to_list(length=_CLUSTER_POOL_SAMPLE_SIZE)
    if len(minimal_agents) < MIN_FULL_REGISTRY_SAMPLE:
        print(f"[aggregate] full_agent_registry has only {len(minimal_agents)} real BSC agents "
              f"(< {MIN_FULL_REGISTRY_SAMPLE}) — not yet a real replacement, falling back to live fetch.")
        return None

    # Real, same cap-counting logic diversify() itself uses (core/clustering.py)
    # — inlined here rather than called, since we need the real survivor
    # IDs from the minimal-field pass, not full diversified dicts (those
    # only exist after phase 2's real, full-field re-fetch below).
    cluster_of = _cluster_agents(minimal_agents)
    counts: dict[int, int] = {}
    survivor_ids = []
    for i, a in enumerate(minimal_agents):
        c = cluster_of[i]
        if counts.get(c, 0) >= per_cluster_cap:
            continue
        counts[c] = counts.get(c, 0) + 1
        survivor_ids.append(a["_id"])

    print(f"[aggregate] full-registry-backed refresh: {len(minimal_agents)} real raw BSC agents "
          f"-> {len(survivor_ids)} after real multi-signal diversification.")

    # Real, memory-safety — the real 64,000+-doc minimal-field list and
    # its cluster-id map are done being read; drop them and force an
    # immediate real sweep before phase 2's own real fetch, same real
    # discipline the original 2026-08-28 fix established (CPython's own
    # allocator doesn't always return freed arenas to the OS promptly on
    # a long-lived process, so an explicit collect here is worth the
    # real, cheap cost).
    del minimal_agents, cluster_of
    import gc
    gc.collect()

    # Real, full field set — only fetched for the real, already-small
    # survivor set (currently ~10,000-13,000 of the 64,000+ raw pool),
    # via _id (Mongo's own indexed key — real, confirmed live in
    # full_registry_ingest.py's own upsert, always equal to the doc's own
    # real `id` field) for a real, fast indexed $in lookup rather than a
    # collection scan.
    _RAW_AGENT_PROJECTION = {
        "id": 1, "agent_id": 1, "chain_id": 1, "created_at": 1, "cross_chain_versions": 1,
        "description": 1, "health_score": 1, "image_url": 1, "is_verified": 1, "name": 1,
        "owner_address": 1, "owner_ens": 1, "owner_username": 1, "star_count": 1,
        "supported_protocols": 1, "token_id": 1, "total_feedbacks": 1, "total_score": 1,
        "x402_supported": 1, "category": 1, "service_endpoint": 1, "service_status": 1,
        "service_checked_at": 1,
    }
    diversified = await db["full_agent_registry"].find(
        {"_id": {"$in": survivor_ids}}, _RAW_AGENT_PROJECTION
    ).to_list(length=len(survivor_ids) + 100)

    result = await _enrich_and_build(diversified, api_key)

    # Real, second gc.collect() (2026-08-29) — the first one above only
    # covers what phase 1 built; `diversified`, `survivor_ids`, and
    # whatever real per-agent temporaries _enrich_and_build's own DefiLlama/
    # owner-balance/reclassification tail allocated are still live here.
    # Confirmed live this was worth doing, not just theoretical: real
    # crashes kept landing a few minutes AFTER a refresh had already
    # returned and logged success, consistent with memory this real pass
    # built never getting reclaimed promptly once the request itself moved
    # on. Cheap and safe to call unconditionally.
    del diversified, survivor_ids
    gc.collect()

    return result


async def get_agents_from_full_registry_as_dicts(**kwargs) -> list[dict] | None:
    agents = await get_agents_from_full_registry(**kwargs)
    if agents is None:
        return None
    return [asdict(a) for a in agents]
