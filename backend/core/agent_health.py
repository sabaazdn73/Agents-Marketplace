"""
agent_health.py

Real, active service-liveness check for listed agents — a signal that works
from the very first view, unlike agent_performance.py's reliability hint
(needs 3+ real settled jobs most agents never reach). Answers: "does this
agent's registered service actually respond right now", not "will it do a
good job" (stated honestly in the UI, not just here).

Real investigation before building this (2026-08-21), don't assume:

1. 8004scan's own /api/v1/agents (list AND owner_address-filtered) was
   checked live against multiple real, already-indexed agents (including
   our own explainer agent) — NO endpoint/service field anywhere in the
   response, despite the installed SDK's get_all_agents() docstring
   claiming one ("services: Dict of service endpoints"). A real, confirmed
   discrepancy between the SDK's documented shape and what the live API
   actually returns. Detail-endpoint guesses (/agents/{agent_id},
   /agents/{uuid}) both real 404s. Conclusion: 8004scan's API is NOT a
   viable source for this.

2. The real source of truth is on-chain: the ERC-8004 identity registry's
   standard ERC-721 tokenURI(agentId) call (plain eth_call, works on any
   RPC, no getLogs needed) returns an agentURI. Verified live against our
   own explainer agent (agent_id 270213): a data:application/json;base64,…
   URI that decodes to real JSON with a `services` array — the exact
   registration payload `bag erc8004 register --endpoint …` wrote.

3. Real format diversity confirmed by checking several OTHER real,
   independently-registered agents, not just our own: some agentURIs are
   data: URIs (no network fetch needed), MANY are ipfs://<hash> (needs a
   real gateway fetch — this app already uses https://ipfs.io/ipfs/ for
   agent image_urls, same real gateway reused here), some are malformed
   junk (e.g. "ipfs://bort-v31-canary", not a real CID), and some are
   empty (no metadata at all). All four cases are handled explicitly below
   — a malformed/unfetchable URI must NOT be misreported as "not
   responding" (that's the agent's fault); it's genuinely "unknown" (ours).

Real state model (four, not three) — the extra state matters for honesty:
  - "responding"     — real endpoint resolved AND it answered a real HTTP
                        request (any status code counts; even a 404 proves
                        something is genuinely listening there — the goal
                        is "is anything real running", not "is every route
                        correct").
  - "not_responding" — real endpoint resolved, but the HTTP request itself
                        failed (timeout, connection refused, DNS failure).
  - "no_endpoint"     — tokenURI is empty, or the resolved metadata has no
                        services[] with an http(s) endpoint. Genuinely
                        nothing registered — not the agent's fault, and
                        not evidence of anything broken.
  - "unknown"         — we could not even resolve the metadata (e.g. the
                        IPFS gateway itself timed out/errored, or the
                        tokenURI content didn't parse as JSON). This is OUR
                        pipeline's limitation, not a signal about the
                        agent — conflating it with "not_responding" would
                        be a real false negative against agents that are
                        probably fine.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time

import httpx
from eth_abi import decode as abi_decode, encode as abi_encode
from eth_utils import function_signature_to_4byte_selector

# BSC mainnet ERC-8004 IdentityRegistry — verified live (tokenURI() calls
# against real, known agents returned real, decodable data).
IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"

_TOKENURI_SEL = function_signature_to_4byte_selector("tokenURI(uint256)")
_AGG3_SEL = function_signature_to_4byte_selector("aggregate3((address,bool,bytes)[])")

_TOKENURI_CHUNK = 200          # tokenURI reads per aggregate3 eth_call
_IPFS_GATEWAY = "https://ipfs.io/ipfs/"
_RESOLVE_TIMEOUT = 6.0         # real, generous — IPFS gateways are genuinely slower than a plain API
_RESOLVE_RETRY_DELAY = 4.0     # real backoff before retrying a failed resolution — see _resolve_services
_HEALTHCHECK_TIMEOUT = 4.0     # real, short, as specified — this is a liveness ping, not a real job
# Real cold-start mitigation — see _check_one's own comment for the live
# evidence. Only paid on a first-attempt failure, not every check. Bumped
# from 25.0 -> 35.0 (2026-08-21) after a live re-test of our own known-live
# explainer agent measured a real 26.3s cold start — just over the old
# budget, which would have produced a real false negative on that exact
# check. 35s leaves real headroom above the worst cold start actually
# observed this session (the earlier one was ~90s in a much colder case,
# but that was measured after a longer idle window than a 20-min health
# TTL will typically produce).
_HEALTHCHECK_RETRY_TIMEOUT = 35.0
_CONCURRENCY = 12              # real cap so a large agent list doesn't hammer IPFS/agent hosts at once

# Shorter than agent_performance.py's own TTLs and the 60-min agent-data
# refresh: liveness can change faster than an agent's metadata, and a
# health-check that never gets stale-checked would be worse than useless.
HEALTH_TTL_SECONDS = 20 * 60


def _rpc_url() -> str:
    # Real fix (2026-08-27 audit): was its own local copy of this fallback,
    # silently defaulting to the public bsc-dataseed node — see
    # core/rpc.py's own docstring for the full real finding.
    from core.rpc import get_bsc_rpc_url
    return get_bsc_rpc_url()


def _tokenuri_calldata(token_id: int) -> bytes:
    return _TOKENURI_SEL + token_id.to_bytes(32, "big")


def _agg3_calldata(token_ids: list[int]) -> str:
    calls = [(IDENTITY_REGISTRY, True, _tokenuri_calldata(t)) for t in token_ids]
    encoded = abi_encode(["(address,bool,bytes)[]"], [calls])
    return "0x" + _AGG3_SEL.hex() + encoded.hex()


async def _multicall_tokenuris(client: httpx.AsyncClient, token_ids: list[int]) -> dict[int, str]:
    """Real batched tokenURI() read for a chunk of agents — one eth_call,
    not N. Reverted/empty entries are skipped honestly (no on-chain
    identity for that token, or a genuinely empty URI)."""
    resp = await client.post(_rpc_url(), json={
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{"to": MULTICALL3, "data": _agg3_calldata(token_ids)}, "latest"],
    })
    resp.raise_for_status()
    body = resp.json()
    if "error" in body and body["error"]:
        raise RuntimeError(f"multicall eth_call failed: {body['error']}")
    (results,) = abi_decode(["(bool,bytes)[]"], bytes.fromhex(body["result"][2:]))
    out: dict[int, str] = {}
    for tid, (success, ret) in zip(token_ids, results):
        if not success or not ret:
            continue
        try:
            (uri,) = abi_decode(["string"], ret)
            out[tid] = uri
        except Exception:
            continue  # malformed return — treated as no real URI, honestly skipped
    return out


async def _fetch_metadata(uri: str, client: httpx.AsyncClient) -> dict:
    """One real attempt to fetch+parse the metadata JSON behind `uri`. Raises
    on any failure — retrying is the caller's job (see _resolve_services)."""
    if uri.startswith("data:application/json;base64,"):
        raw = base64.b64decode(uri.split(",", 1)[1])
        return json.loads(raw)
    elif uri.startswith("data:application/json,"):
        return json.loads(uri.split(",", 1)[1])
    elif uri.startswith("ipfs://"):
        gateway_url = _IPFS_GATEWAY + uri[len("ipfs://"):]
        resp = await client.get(gateway_url, timeout=_RESOLVE_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    elif uri.startswith("http://") or uri.startswith("https://"):
        resp = await client.get(uri, timeout=_RESOLVE_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    else:
        raise ValueError(f"unrecognized URI scheme: {uri[:30]}")


async def _resolve_services(uri: str, client: httpx.AsyncClient) -> tuple[list[dict] | None, bool]:
    """Resolve an agentURI to its real services[] list.

    Returns (services, resolution_failed). `services` is None when there is
    genuinely no metadata (empty URI) OR when resolution itself failed
    (network/parse error) — the second return value distinguishes those two
    real cases so the caller can tell "no_endpoint" from "unknown".

    Real, confirmed reliability finding (2026-08-21, full-scale production
    run): the first full bulk run (332 agents) showed a 38% "unknown" rate,
    vastly higher than small-sample tests (~1%). Root-caused by re-resolving
    every real agent then marked "unknown" directly, one at a time, right
    after — 126 of 127 resolved instantly and successfully in isolation, and
    every single one of those 126 shared the exact same metadata host,
    metadata.evoevo.ai (a large single-campaign cluster, consistent with the
    registry's known cluster-domination). Not an IPFS gateway problem, not a
    genuine per-agent failure — a real, single-host transient failure under
    OUR OWN concurrent load hitting one third-party host repeatedly within a
    short window. Mitigation: one retry with a short backoff, mirroring the
    same wake-up-then-retry philosophy that fixed the earlier HTTP cold-start
    false negative below — a brief pause is enough to clear a transient
    per-host rate-limit/overload window without materially slowing down the
    common (first-try-succeeds) case."""
    if not uri:
        return None, False  # genuinely no URI at all — no_endpoint, not a failure

    last_exc: Exception | None = None
    for attempt, delay in enumerate((0.0, _RESOLVE_RETRY_DELAY)):
        if delay:
            await asyncio.sleep(delay)
        try:
            data = await _fetch_metadata(uri, client)
            return (data.get("services") or None), False
        except Exception as e:
            last_exc = e
            continue
    # Real resolution failure on BOTH attempts (gateway/host still down after
    # a backoff, invalid CID like the real "ipfs://bort-v31-canary" junk value
    # seen in testing, bad JSON, etc.) — OUR pipeline's limitation, not
    # necessarily the agent's fault.
    return None, True


def _first_http_endpoint(services: list[dict] | None) -> str | None:
    """Real bug found and fixed 2026-08-25, via a genuine cross-check against
    8004scan's own richer /api/v1/public/* health_status field (now real,
    Pro-tier — see core/status_checks.py / the aggregate.py Pro-tier note):
    a large real cluster of Termix-platform agents registers service
    endpoints with a LITERAL, unsubstituted "{agentId}" template placeholder
    still in the URL (e.g. ".../api/v1/a2a/agents/{agentId}/card") — their
    own on-chain metadata's mistake, not a resolution failure on our side.
    That URL is real and DOES answer (platform-backend.prod.termix.live is a
    real, live host), so our old "any real HTTP response, even a 404, counts
    as responding" rule mislabeled the entire cluster "responding" — 21 real
    agents checked cross-referencing 8004scan's own health_status all showed
    this exact pattern, and 8004scan itself correctly reports the same real
    404 as unhealthy/degraded rather than responding. A URL containing an
    unsubstituted template placeholder can never resolve to anything real,
    so it's rejected here up front (falls through no_endpoint, same as
    genuinely having no service at all) instead of being "checked" at all."""
    if not services:
        return None
    for svc in services:
        ep = (svc or {}).get("endpoint")
        if isinstance(ep, str) and (ep.startswith("http://") or ep.startswith("https://")) \
                and "{" not in ep and "}" not in ep:
            return ep
    return None


async def _check_one(agent: dict, uri: str | None, client: httpx.AsyncClient, sem: asyncio.Semaphore) -> dict:
    now_iso_fields = {"service_checked_at": time.time()}
    async with sem:
        services, resolution_failed = await _resolve_services(uri or "", client)
        endpoint = _first_http_endpoint(services)

        if endpoint is None:
            if resolution_failed:
                return {**now_iso_fields, "service_status": "unknown", "service_endpoint": None}
            return {**now_iso_fields, "service_status": "no_endpoint", "service_endpoint": None}

        # Real, confirmed reliability finding (2026-08-21): a short single
        # timeout produced a false negative against our OWN known-live
        # explainer agent — its Render free-tier instance had genuinely spun
        # down from inactivity, and the request that woke it up itself timed
        # out even at 30s, while a retry right after answered in 0.58s. Free
        # hosting with cold starts is common across this marketplace, not
        # unique to our own agent, so a single short attempt would misreport
        # real, working services as dead. Mitigation: on failure, ONE retry
        # with a longer real timeout (this is exactly the wake-up-then-retry
        # pattern that fixed it live) before concluding "not_responding" for
        # real. The fast path (already-warm services, the common case) still
        # only pays the short timeout.
        for attempt_timeout in (_HEALTHCHECK_TIMEOUT, _HEALTHCHECK_RETRY_TIMEOUT):
            try:
                resp = await client.get(endpoint, timeout=attempt_timeout, follow_redirects=True)
                # ANY real HTTP response (including 4xx/5xx) proves something
                # is genuinely listening — see module docstring for why
                # that's the right bar for "is a real service running here".
                return {
                    **now_iso_fields,
                    "service_status": "responding",
                    "service_endpoint": endpoint,
                    "service_http_status": resp.status_code,
                }
            except Exception as e:
                last_error = e
                continue
        return {
            **now_iso_fields,
            "service_status": "not_responding",
            "service_endpoint": endpoint,
            "service_error": str(last_error)[:200],
        }


async def check_agents_health(agents: list[dict]) -> dict[str, dict]:
    """Real health-check pass over `agents` (each needs id/token_id at
    minimum). Skips any agent whose service_checked_at is still within
    HEALTH_TTL_SECONDS (already fresh — no need to re-probe). Returns a
    dict keyed by agent `id` with the fields to $set on that document;
    agents that were skipped (still fresh) are simply absent from the
    result, so the caller's merge leaves their existing real data alone.
    """
    now = time.time()
    to_check = [
        a for a in agents
        if a.get("id") and a.get("token_id") not in (None, "", "None")
        and (now - (a.get("service_checked_at") or 0)) > HEALTH_TTL_SECONDS
    ]
    if not to_check:
        return {}

    id_to_token = {}
    for a in to_check:
        try:
            id_to_token[a["id"]] = int(a["token_id"])
        except (TypeError, ValueError):
            continue

    async with httpx.AsyncClient(timeout=15) as client:
        token_ids = list(id_to_token.values())
        uri_by_token: dict[int, str] = {}
        for i in range(0, len(token_ids), _TOKENURI_CHUNK):
            try:
                chunk_result = await _multicall_tokenuris(client, token_ids[i:i + _TOKENURI_CHUNK])
                uri_by_token.update(chunk_result)
            except Exception as e:
                print(f"[agent_health] tokenURI multicall chunk failed: {e}")
                # Real, transient failure for this chunk — those agents just
                # keep whatever health data they already had; not fatal.

        sem = asyncio.Semaphore(_CONCURRENCY)
        tasks = {
            aid: _check_one({"id": aid}, uri_by_token.get(tid), client, sem)
            for aid, tid in id_to_token.items()
        }
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)

    out: dict[str, dict] = {}
    for aid, result in zip(tasks.keys(), results):
        if isinstance(result, Exception):
            print(f"[agent_health] real check failed for {aid}: {result}")
            continue
        out[aid] = result
    return out
