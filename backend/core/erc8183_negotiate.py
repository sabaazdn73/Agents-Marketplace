"""
erc8183_negotiate.py

Real, server-side proxy for the ERC-8183 `negotiate` A2A skill — the missing
step that caused a real, confirmed incident (2026-08-21/22): job #56636 was
funded through the marketplace's generic hire flow (a fixed plain-text
description, no negotiate step) and was then PERMANENTLY rejected by the
explainer agent's own `notify_funded` handler with "no signed quote anchored
in job description". Traced through the real SDK verification logic
(bnbagent_studio_core.erc8183.verify.verify_signed_job): a strict ERC-8183
seller requires the on-chain job description to be a Schema-v1 JobDescription
carrying a `negotiation_hash` + `provider_sig` this exact provider signed —
which only the `negotiate` skill produces. Confirmed live (2026-08-22)
against the explainer agent's real negotiate response, run through the SDK's
own `build_job_description` + `recover_quote_signer`: the reconstructed
description round-trips and recovers the correct signer address.

Why this lives server-side, not called directly from the browser: confirmed
live (2026-08-22) that the explainer agent's endpoint has NO CORS support —
a real OPTIONS preflight returned 405 with no Access-Control-Allow-Origin
header, so a direct browser fetch would be blocked outright by the browser
itself, for every marketplace agent, not just this one (no agent built for
this marketplace advertises CORS headers; that's a reasonable default for a
server meant to be called server-to-server, same reasoning documented in
core/agent_health.py for why health checks run backend-side too).

Real, honest scope: this only works for agents that (a) have a real
`service_endpoint` on record (see core/agent_health.py) and (b) actually
implement the A2A `negotiate` skill the way this SDK's seller template does.
Many marketplace agents will not — this proxy returns None cleanly in every
failure case (no endpoint, endpoint isn't a real A2A agent card, timeout,
negotiation rejected) so the caller (server.py's endpoint, then
useHireAgent.js) can fall back to the existing plain-description flow
exactly as before, rather than break hiring for agents that never supported
negotiate in the first place.
"""

from __future__ import annotations

import uuid

import httpx

_TIMEOUT = 15.0


async def _jsonrpc_candidates(service_endpoint: str, client: httpx.AsyncClient) -> list[str]:
    """Real candidate JSON-RPC URLs for `service_endpoint`'s origin, ordered
    by DEMONSTRATED reliability, not by protocol purity.

    Real, confirmed finding (2026-08-22): the agent card's own advertised
    `url` field is NOT trustworthy — live-checked against our own explainer
    agent and it reports `http://localhost:10000/` (a local-dev placeholder)
    even after correctly setting the documented AGENTCORE_RUNTIME_URL env var
    and restarting; this looks like a real bug in the installed
    `bedrock_agentcore` package's URL-override path, not a configuration
    problem on our side (out of scope to chase further here — this proxy
    just needs to not depend on it). The standard A2A convention this
    project's own agents are built on (`bedrock_agentcore.runtime.a2a`,
    confirmed by reading its source) always serves JSON-RPC at the SAME
    origin's root path "/" regardless of what the card claims — and that
    exact root was directly, successfully used for real negotiate/
    notify_funded calls against this agent. So the same-origin root is
    listed FIRST (proven reliable); the card's own `url` field is still
    tried as a fallback in case some other, differently-built marketplace
    agent advertises it correctly."""
    from urllib.parse import urlparse

    parsed = urlparse(service_endpoint)
    candidates: list[str] = []
    if parsed.scheme and parsed.netloc:
        candidates.append(f"{parsed.scheme}://{parsed.netloc}/")

    card_urls = [service_endpoint]
    if parsed.scheme and parsed.netloc:
        card_urls.append(f"{parsed.scheme}://{parsed.netloc}/.well-known/agent-card.json")
    for url in card_urls:
        try:
            resp = await client.get(url, timeout=_TIMEOUT)
            resp.raise_for_status()
            card = resp.json()
        except Exception:
            continue
        rpc_url = card.get("url")
        if isinstance(rpc_url, str) and rpc_url and rpc_url not in candidates:
            candidates.append(rpc_url)
        break  # first real card fetch that succeeds is enough

    return candidates


async def negotiate(
    service_endpoint: str, task_description: str, terms: dict
) -> dict | None:
    """Real A2A `negotiate` call against a seller agent. Returns the raw
    negotiation-result dict (the same shape `NegotiationResult.to_dict()`
    produces — request/response/negotiation_hash/provider_sig/chain_id/
    verifying_contract) on a real accepted quote, or None on ANY failure
    (no endpoint, not a real A2A agent, timeout, or a genuine rejection) —
    the caller's job is to fall back cleanly, not to distinguish why."""
    if not service_endpoint:
        return None
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        candidates = await _jsonrpc_candidates(service_endpoint, client)
        if not candidates:
            return None

        payload = {
            "jsonrpc": "2.0",
            "id": "1",
            "method": "message/send",
            "params": {
                "message": {
                    "kind": "message",
                    "messageId": str(uuid.uuid4()),
                    "role": "user",
                    "parts": [
                        {
                            "kind": "data",
                            "data": {
                                "skill": "negotiate",
                                "task_description": task_description,
                                "terms": terms,
                            },
                        }
                    ],
                }
            },
        }

        body = None
        for rpc_url in candidates:
            try:
                resp = await client.post(rpc_url, json=payload, timeout=_TIMEOUT)
                resp.raise_for_status()
                body = resp.json()
                break
            except Exception as e:
                print(f"[erc8183_negotiate] candidate {rpc_url} failed, trying next: {e}")
                continue
        if body is None:
            return None

        if "error" in body:
            print(f"[erc8183_negotiate] agent returned a JSON-RPC error: {body['error']}")
            return None

        try:
            parts = body["result"]["parts"]
            data = next(p["data"] for p in parts if p.get("kind") == "data")
        except (KeyError, IndexError, StopIteration, TypeError):
            print(f"[erc8183_negotiate] unexpected response shape: {body}")
            return None

        response = data.get("response") or {}
        if not response.get("accepted"):
            # A real, genuine rejection (e.g. malformed terms) — not a
            # transport failure. Still None: the caller falls back the same
            # way either way, and the real reason is already logged for us.
            print(f"[erc8183_negotiate] negotiation not accepted: {response}")
            return None
        return data
