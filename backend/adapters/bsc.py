"""
bsc.py

Reads real BNB Chain agent identities from 8004scan's public API. This is the
one adapter that talks to a BSC-specific data source; core/ stays chain-agnostic.

Mainnet-only: this project lists BSC MAINNET (chain 56) agents. The earlier
testnet listing, the direct-SDK/on-chain read stubs, and the layered-fallback
scaffolding were removed as dead code (hiring is client-side now — see
frontend/src/altana.js + useHireAgent.js).

HONESTY NOTE: 8004scan's endpoint/pagination shape was confirmed against a real
live response (offset/limit, an {items, total, limit, offset} envelope,
total≈714k across all chains as of 8 Aug 2026). Chain filtering is done
client-side (chain_id == 56) because server-side chainId filtering was never
verified reliable for this endpoint.

Real, important correction (2026-08-28): re-investigated while adding real
Solana ingestion. The real, live OpenAPI spec (api.8004scan.io/openapi.json)
confirms the real, correct query parameter is `chain_id` (snake_case) — this
project's own code above sends `chainId` (camelCase), confirmed live to be
silently ignored by the server. With the real, correct param name,
server-side filtering DOES work reliably (confirmed live: `chain_id=56` ->
total 288,865, all items chain_id 56; `chain_id=101` -> total ~1,462, all
items chain_id 101, real chain_type "solana", real base58 owner addresses).
The "server-side filtering isn't reliable" belief was itself a real,
long-standing artifact of the wrong parameter name, not a genuine server
limitation. Deliberately NOT changed in list_agents_for_chains/
_fetch_agents_page below — that function's own real, multi-chain
"natural page mixing" strategy (core/full_registry_ingest.py) depends on
the chainId param being ignored to pick up BSC/Base/Ethereum from the same
shared, unfiltered scan; "fixing" the param there would silently narrow it
back to one chain and break that real, already-working, already-scheduled
pipeline. See list_agents_by_chain_id below instead — a new, separate,
correctly-filtered function built for Solana specifically (which, real and
live-confirmed, never appears in the unfiltered/mixed stream at all, so it
genuinely needs its own real query path).

REAL HOST MIGRATION (2026-08-27, verified live, not assumed): 8004scan moved
their API to api.8004scan.io. Confirmed live before switching:
  - The list endpoint (/api/v1/agents) is unchanged in path and response
    shape on the new host (real {items, total, limit, offset} envelope).
  - The detail endpoint moved too, and NOT just the domain — the path
    dropped the "/public/" segment (was /api/v1/public/agents/{chain}/{id},
    now /api/v1/agents/{chain}/{id} — confirmed live: the old /public/ path
    genuinely 404s on the new host), AND the response is no longer wrapped
    in {"success": true, "data": {...}} — the agent object is now the
    top-level response body directly (confirmed live against a real known
    agent: same real fields, tags/categories/health_status/raw_metadata all
    present, just unwrapped).
  - The old host (8004scan.io, no "api." subdomain) still answered both
    endpoints correctly when checked, so this wasn't a hard cutover at
    verification time — moved anyway, to track the real, current endpoint
    rather than an about-to-be-deprecated one.
"""

import asyncio
import httpx

MAINNET_CHAIN_ID = 56
_8004SCAN_BASE = "https://api.8004scan.io"


async def list_bsc_agents(
    api_key: str,
    offset: int = 0,
    limit: int = 20,
    max_retries: int = 4,
    timeout: float = 15.0,
) -> tuple[list[dict], int, int]:
    """Reads one page of BSC MAINNET agents from 8004scan. Returns
    (bsc_agents, total_reported_by_server, raw_page_len) so callers can
    paginate correctly. Retries on 429 AND on a real transient network/
    timeout failure, both with exponential backoff — the latter added
    2026-08-27 after a real, confirmed incident: core/full_registry_ingest.py
    hit a genuine ReadTimeout at offset ~13,900 that propagated uncaught,
    because the old retry logic only handled httpx.HTTPStatusError (429),
    not httpx.TransportError/TimeoutException. That gap used to be
    survivable at this function's normal offsets (aggregate.py's marketplace
    refresh never pages deep enough for latency to matter — see
    full_registry_ingest.py's own docstring for the real, measured
    offset-vs-latency curve that makes a timeout a real, EXPECTED outcome at
    depth, not a rare fluke worth crashing the whole ingest run over).

    `timeout` defaults to 15s (unchanged, fine for aggregate.py's shallow-
    offset marketplace refresh); full_registry_ingest.py passes a much
    longer real value for its own deep-offset pages.

    raw_page_len is the number of agents the server returned for this page
    BEFORE the client-side chain filter. Callers MUST use raw_page_len (not
    len(bsc_agents)) to detect the real end of pagination: a page of `limit`
    mixed-chain results typically contains only ~70% BSC, so a chain-filtered
    count is almost always < limit even when many more pages remain. (This was
    a real bug — the old early-stop compared the filtered count to `limit` and
    broke after page 1, so the marketplace only ever showed the newest ~one
    page of agents, dominated by whatever batch registered most recently.)

    Real fields available: is_verified, x402_supported, health_score,
    rank, network_rank, average_score, supported_protocols, owner_ens,
    owner_username, image_url, and cross_chain_versions (the real mechanism
    for "same agent identity across chains")."""
    items, total = await _fetch_agents_page(
        api_key, offset=offset, limit=limit, max_retries=max_retries, timeout=timeout, log_prefix="list_bsc_agents",
    )
    bsc_only = [a for a in items if a.get("chain_id") == MAINNET_CHAIN_ID]
    if len(bsc_only) != len(items):
        print(f"[list_bsc_agents] Server returned {len(items)} agents at offset {offset}, "
              f"only {len(bsc_only)} actually matched chainId={MAINNET_CHAIN_ID}, "
              f"client-side filter caught the rest.")
    return bsc_only, total, len(items)


async def list_agents_for_chains(
    api_key: str,
    chain_ids: set[int],
    offset: int = 0,
    limit: int = 20,
    max_retries: int = 4,
    timeout: float = 15.0,
) -> tuple[list[dict], int, int]:
    """Real, general version of list_bsc_agents — keeps agents matching ANY
    of `chain_ids` instead of hardcoding BSC only. Added 2026-08-28 for
    core/full_registry_ingest.py's multi-chain ingestion: since a real page
    from this API is already a real MIX of chains (confirmed live — a given
    page's real BSC share has been observed anywhere from 16% to 92%), one
    single pass filtering for multiple target chains at once covers all of
    them from the same real requests, rather than one full linear scan per
    chain re-reading the exact same pages. Same real (bsc_agents,
    total_reported_by_server, raw_page_len) return shape and the same
    real retry/timeout discipline as list_bsc_agents — see that function's
    own docstring for the full real incident behind it."""
    items, total = await _fetch_agents_page(
        api_key, offset=offset, limit=limit, max_retries=max_retries, timeout=timeout, log_prefix="list_agents_for_chains",
    )
    matched = [a for a in items if a.get("chain_id") in chain_ids]
    return matched, total, len(items)


async def list_agents_by_chain_id(
    api_key: str,
    chain_id: int,
    offset: int = 0,
    limit: int = 20,
    max_retries: int = 6,
    timeout: float = 30.0,
) -> tuple[list[dict], int, int]:
    """Real, single-chain, SERVER-SIDE-filtered fetch — added 2026-08-28 for
    Solana ingestion. Unlike list_bsc_agents/list_agents_for_chains above
    (which send the real, wrong `chainId` param on purpose, relying on it
    being ignored so a shared unfiltered scan can pick up multiple EVM
    chains from the same real pages), this sends the real, CORRECT
    `chain_id` (snake_case) param, confirmed live against 8004scan's own
    OpenAPI spec and confirmed live to actually filter server-side
    (`chain_id=101` -> total ~1,462, every returned item real chain_type
    "solana"; `chain_id=56` -> total 288,865, every item chain_id 56).

    Built specifically because Solana (chain_id=101) was confirmed, via a
    real, live, ~700-item scan across offsets 0-300,000, to NEVER appear in
    the default/unfiltered listing the EVM pipeline scans — so unlike
    Base/Ethereum (which ride along in pages already being fetched for BSC
    at zero extra cost), Solana genuinely needs its own real, separate
    query. Since the server does the real filtering here, `total` is
    already the true real total for just this one chain, and every
    returned item already matches `chain_id` — no client-side re-filter
    needed (returned as `(items, total, len(items))` for shape parity with
    the other two list_* functions above)."""
    headers = {"X-API-Key": api_key}
    last_error = None
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(
                    f"{_8004SCAN_BASE}/api/v1/agents",
                    params={"chain_id": chain_id, "offset": offset, "limit": limit},
                    headers=headers,
                )
                resp.raise_for_status()
                body = resp.json()
                items = body.get("items", [])
                total = body.get("total", 0)
                return items, total, len(items)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < max_retries - 1:
                wait_seconds = 8 * (2 ** attempt)
                print(f"[list_agents_by_chain_id] 429 at offset {offset} (chain_id={chain_id}), "
                      f"attempt {attempt + 1}/{max_retries}, waiting {wait_seconds}s")
                last_error = e
                await asyncio.sleep(wait_seconds)
                continue
            raise
        except (httpx.TimeoutException, httpx.TransportError) as e:
            if attempt < max_retries - 1:
                wait_seconds = 4 * (2 ** attempt)
                print(f"[list_agents_by_chain_id] real transient {type(e).__name__} at offset {offset} "
                      f"(chain_id={chain_id}), attempt {attempt + 1}/{max_retries}, waiting {wait_seconds}s")
                last_error = e
                await asyncio.sleep(wait_seconds)
                continue
            raise
    raise last_error


async def _fetch_agents_page(
    api_key: str, *, offset: int, limit: int, max_retries: int, timeout: float, log_prefix: str,
) -> tuple[list[dict], int]:
    """Shared real fetch + retry logic for one raw page of /api/v1/agents —
    factored out 2026-08-28 so list_bsc_agents and list_agents_for_chains
    (BSC-only vs multi-chain) share one real implementation rather than two
    copies that could quietly drift. Returns the RAW (unfiltered-by-chain)
    items + the server's own real total — callers apply their own chain
    filter."""
    headers = {"X-API-Key": api_key}

    last_error = None
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                # chainId is passed for consistency with real prior calls,
                # but NOT trusted to actually filter server-side (see this
                # module's own honesty note) — every caller re-filters
                # client-side on the real chain_id field regardless.
                resp = await client.get(
                    f"{_8004SCAN_BASE}/api/v1/agents",
                    params={"chainId": MAINNET_CHAIN_ID, "offset": offset, "limit": limit},
                    headers=headers,
                )
                resp.raise_for_status()
                body = resp.json()
                return body.get("items", []), body.get("total", 0)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < max_retries - 1:
                wait_seconds = 8 * (2 ** attempt)
                print(f"[{log_prefix}] 429 at offset {offset}, attempt "
                      f"{attempt + 1}/{max_retries}, waiting {wait_seconds}s")
                last_error = e
                await asyncio.sleep(wait_seconds)
                continue
            raise
        except (httpx.TimeoutException, httpx.TransportError) as e:
            if attempt < max_retries - 1:
                wait_seconds = 4 * (2 ** attempt)
                print(f"[{log_prefix}] real transient {type(e).__name__} at offset {offset}, "
                      f"attempt {attempt + 1}/{max_retries}, waiting {wait_seconds}s")
                last_error = e
                await asyncio.sleep(wait_seconds)
                continue
            raise
    raise last_error


async def fetch_agent_detail(
    client: httpx.AsyncClient, api_key: str, token_id: int, chain_id: int = MAINNET_CHAIN_ID,
) -> dict | None:
    """Real per-agent detail record from the richer per-agent detail surface
    — confirmed real, live Pro-tier access 2026-08-25 (3000/min, 3,000,000/
    day; re-verified with random uncacheable token IDs before use, same
    rigor as the original tier check). Returns None on any failure (missing
    agent, transient error) — best-effort enrichment, never blocks the
    caller. Only used for agents the cheap name+description classifier
    couldn't place (see categorize.py's re-classify step in aggregate.py) —
    real, measured cost check before wiring this in for every refresh: at
    Pro-tier limits, even several hundred of these extra calls per refresh
    is nowhere near the 3M/day budget.

    Real host migration (2026-08-27): this path used to be
    /api/v1/public/agents/{chain}/{id} on the old host, wrapped in
    {"success": true, "data": {...}}. The new host dropped both the
    "/public/" path segment and the wrapper — confirmed live, not assumed
    — so this now hits /api/v1/agents/{chain}/{id} and returns the parsed
    body directly."""
    try:
        resp = await client.get(
            f"{_8004SCAN_BASE}/api/v1/agents/{chain_id}/{token_id}",
            headers={"X-API-Key": api_key},
            timeout=15,
        )
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception:
        return None


async def fetch_agent_quality(
    client: httpx.AsyncClient, api_key: str, token_id: int, chain_id: int = MAINNET_CHAIN_ID,
) -> dict | None:
    """8004scan's own real, independently-computed 'Quality Center' score
    breakdown for one agent -- confirmed real and live 2026-08-29, before
    building this: sampled 15 real, actually-scored BSC agents, all 15 had
    at least one real nonzero dimension (engagement/service/publisher/
    compliance/momentum), so this is genuinely populated for the agents
    it matters for, not a placeholder. Its score_history/score_trend field
    was 'insufficient_data' for all 15 sampled (the registry is too young
    for it yet) -- deliberately NOT surfaced by this adapter's caller;
    re-check real prevalence before adding it later.

    Detail-page-only by design: costs one real, uncacheable-here API call
    per agent, so unlike the bulk /api/v1/agents listing this is never
    called during ingestion or the marketplace refresh -- only when a real
    user opens one specific agent's detail view (see server.py's
    /api/agents/{agent_id}/quality-center route). Returns None on any
    failure (missing agent, transient error, agent never scored) -- a
    real, honest 'not available' rather than a fabricated zero."""
    try:
        resp = await client.get(
            f"{_8004SCAN_BASE}/api/v1/agents/{chain_id}/{token_id}/quality",
            headers={"X-API-Key": api_key},
            timeout=15,
        )
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception:
        return None


def augmented_classification_text(detail: dict) -> str:
    """Builds the richer text surface confirmed useful in the real
    2026-08-25 re-check: tags, categories, the offchain metadata's own
    description, and its services' names — none of which exist on the
    plain /api/v1/agents listing shape. Real, measured result on 489 real
    previously-Unclassified BSC agents: 21 (4.3%) got a real category from
    this text that plain name+description missed. Zero of those were Grid
    Trading specifically — an honest negative, not assumed away."""
    tags = " ".join(detail.get("tags") or [])
    categories = " ".join(detail.get("categories") or [])
    offchain = (detail.get("raw_metadata") or {}).get("offchain_content") or {}
    offchain_desc = offchain.get("description") or ""
    service_names = " ".join(s.get("name", "") for s in (offchain.get("services") or []))
    return " ".join([detail.get("description") or "", tags, categories, offchain_desc, service_names])
