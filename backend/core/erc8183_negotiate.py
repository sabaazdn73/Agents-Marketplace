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

Real SSRF gap found and fixed (2026-08-27 security audit): unlike
deliverable_proxy.py (guarded from the start — see that module's own real
threat-model note), this proxy had NO host-safety validation at all. While
`service_endpoint` is resolved server-side (server.py never accepts a raw
URL from the client directly, only an owner_address), its real VALUE is
still attacker-influenced: whoever registers an agent on-chain sets it, so
a malicious registrant could point it at internal infrastructure (a cloud
metadata IP, an internal admin service) and get every real user who tries
to hire that "agent" to make this backend proxy a request there — the same
real threat deliverable_proxy.py's own docstring describes, just via
registration instead of a job's submit(). Worse here: `_jsonrpc_candidates`
below ALSO trusts a `url` field pulled out of whatever JSON the endpoint's
own `.well-known/agent-card.json` happens to return — a second,
attacker-controlled hop that could point anywhere even if the original
service_endpoint looked benign. Fixed by reusing deliverable_proxy.py's
already-proven `_is_safe_public_host` guard (DNS-resolve-time private/
loopback/link-local/reserved/multicast rejection) at BOTH hops: before the
agent-card fetch, and before trusting any `url` the card itself claims.

Real, multi-format retry (2026-08-27), from a real, live investigation
against 3 genuinely different agents: this used to send exactly one real
message shape — a `{"kind": "data", "data": skill_data}` part — and give
up on anything else. Real, confirmed live findings that made this
insufficient: OnyxOracle's real endpoint (app.singularry.org/api/a2a) is a
genuinely working A2A server that rejects a `data` part outright
("Only text parts are accepted by this endpoint") but returns a real
HTTP 200 for the exact same skill_data wrapped in a `{"kind": "text",
"text": json.dumps(skill_data)}` part instead; AIDA's registered endpoint
doesn't implement A2A JSON-RPC at all (a real 405 on POST, not a format
problem); mandaterebalance-agent requires an OAuth2 Bearer token only its
own operator can issue (a real 401, also not a format problem). `data` and
`text` are the two real, spec-defined A2A Part kinds relevant to a skill
call (the third, `file`, doesn't apply here) — not a guess, and not
extended further than what's actually been observed live. Now tries both
shapes, in order, against each real candidate URL, and logs which one (if
any) got a genuine, structured acknowledgment — never fabricating success
for a reply that merely returned 200 without actually confirming it
understood the request (see _extract_structured_reply below for exactly
what counts as "genuine").
"""

from __future__ import annotations

import json
import uuid

import httpx

from core.deliverable_proxy import _is_safe_public_host

_TIMEOUT = 15.0

# Real, spec-defined A2A message Part "kind" values relevant to a skill
# call — see module docstring for why only these two, and why not more.
_PART_SHAPES = ("data", "text")


def _is_safe_url(url: str) -> bool:
    """Real, shared guard for any URL this module is about to fetch —
    scheme + resolved-host safety, same standard as deliverable_proxy.py."""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    return _is_safe_public_host(parsed.hostname)


async def _jsonrpc_candidates(service_endpoint: str, client: httpx.AsyncClient) -> list[str]:
    """Real candidate JSON-RPC URLs for `service_endpoint`, ordered by
    DEMONSTRATED reliability across the real, live agents this has
    actually been tested against — not by protocol purity.

    Real gap found and fixed (2026-08-27): this used to NEVER try
    `service_endpoint` itself as a direct POST target — only a same-origin
    root guess (tuned to our own explainer agent's own specific bug, see
    below) and whatever URL a fetched agent-card happened to claim. Real,
    live, confirmed miss: OnyxOracle's actual registered service_endpoint
    (app.singularry.org/api/a2a) IS the real, correct, directly-POSTable
    JSON-RPC target — a real, live POST there succeeds — but it was never
    even attempted, because it isn't the same-origin root and its own
    agent-card fetch didn't hand back a matching `url`. The standard A2A
    expectation is that the registered endpoint just works directly; our
    own agent's same-origin-root quirk (below) is real but was one agent's
    specific bug, not the general case, now confirmed by a second real
    agent that behaves the standard way instead. `service_endpoint` itself
    is now tried FIRST for that reason.

    Real, confirmed finding (2026-08-22), kept as a fallback: the agent
    card's own advertised `url` field is NOT trustworthy — live-checked
    against our own explainer agent and it reports `http://localhost:10000/`
    (a local-dev placeholder) even after correctly setting the documented
    AGENTCORE_RUNTIME_URL env var and restarting; this looks like a real
    bug in the installed `bedrock_agentcore` package's URL-override path,
    not a configuration problem on our side. That project's own real A2A
    convention (`bedrock_agentcore.runtime.a2a`, confirmed by reading its
    source) serves JSON-RPC at the SAME origin's root path "/" regardless
    of what the card claims — kept as the second real candidate."""
    from urllib.parse import urlparse

    parsed = urlparse(service_endpoint)
    candidates: list[str] = []
    if _is_safe_url(service_endpoint):
        candidates.append(service_endpoint)

    same_origin = f"{parsed.scheme}://{parsed.netloc}/" if parsed.scheme and parsed.netloc else None
    if same_origin and same_origin not in candidates and _is_safe_url(same_origin):
        candidates.append(same_origin)

    card_urls = [service_endpoint]
    if parsed.scheme and parsed.netloc:
        card_urls.append(f"{parsed.scheme}://{parsed.netloc}/.well-known/agent-card.json")
    for url in card_urls:
        # Real SSRF guard, first hop — see module docstring.
        if not _is_safe_url(url):
            continue
        try:
            resp = await client.get(url, timeout=_TIMEOUT, follow_redirects=False)
            resp.raise_for_status()
            card = resp.json()
        except Exception:
            continue
        rpc_url = card.get("url")
        # Real SSRF guard, second hop — the card's own claimed `url` is
        # JUST as attacker-controlled as service_endpoint itself (see
        # module docstring), so it gets the exact same real check before
        # ever being added as something we'll later POST to.
        if isinstance(rpc_url, str) and rpc_url and rpc_url not in candidates and _is_safe_url(rpc_url):
            candidates.append(rpc_url)
        break  # first real card fetch that succeeds is enough

    return candidates


def _build_payload(skill_data: dict, shape: str) -> dict:
    """Real, spec-defined A2A message envelope, varying only the Part
    `kind` — see module docstring for why exactly these two shapes."""
    if shape == "data":
        part = {"kind": "data", "data": skill_data}
    elif shape == "text":
        # Real, live-confirmed alternative (OnyxOracle): the same real
        # skill_data, JSON-stringified into a plain text part instead of a
        # structured data part.
        part = {"kind": "text", "text": json.dumps(skill_data)}
    else:
        raise ValueError(f"unknown A2A part shape: {shape}")
    return {
        "jsonrpc": "2.0",
        "id": "1",
        "method": "message/send",
        "params": {
            "message": {
                "kind": "message",
                "messageId": str(uuid.uuid4()),
                "role": "user",
                "parts": [part],
            }
        },
    }


def _extract_structured_reply(body: dict) -> dict | None:
    """Real, honest extraction — deliberately conservative. Returns
    something only when the reply is GENUINELY structured: a real
    `data`-kind part (used as-is, the strict/original contract), or a real
    `text`-kind part whose own content happens to be valid, parseable JSON
    (some agents that insist on text parts still reply with real JSON
    inside one). A real, live, generic-sounding text reply that ISN'T
    valid JSON (confirmed live: OnyxOracle's own identity/capability blurb,
    sent back regardless of what we asked) returns None here — the whole
    point of this function is to never treat "the HTTP call succeeded" as
    "the agent genuinely acknowledged this specific request", which would
    be fabricating success where none occurred."""
    try:
        parts = body["result"]["parts"]
    except (KeyError, TypeError):
        return None
    for p in parts:
        if p.get("kind") == "data" and isinstance(p.get("data"), dict):
            return p["data"]
    for p in parts:
        if p.get("kind") == "text" and isinstance(p.get("text"), str):
            try:
                parsed = json.loads(p["text"])
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(parsed, dict):
                return parsed
    return None


async def _call_skill(service_endpoint: str, skill_data: dict) -> tuple[dict, str] | None:
    """Shared A2A `message/send` plumbing for both `negotiate` and
    `notify_funded`: resolve the real JSON-RPC candidates, and for EACH
    one, try every real known message shape (_PART_SHAPES) in order —
    real, multi-format retry (2026-08-27), not giving up after one fixed
    shape. Returns (data, shape) on the first genuine, structured reply
    (see _extract_structured_reply), logging exactly which real
    candidate+shape combination worked — or None if every real combination
    was tried and none produced a genuine acknowledgment (no endpoint, not
    a real A2A agent, timeout, auth rejection, or a real reply we can't
    honestly parse as structured). Callers apply their own skill-specific
    acceptance check on the result."""
    if not service_endpoint:
        return None
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        candidates = await _jsonrpc_candidates(service_endpoint, client)
        if not candidates:
            return None

        for rpc_url in candidates:
            # Real, defense-in-depth SSRF guard — candidates are already
            # filtered in _jsonrpc_candidates above, but re-checking here
            # too means this loop is safe even if a future change ever
            # adds a candidate through a different path.
            if not _is_safe_url(rpc_url):
                print(f"[erc8183_negotiate] candidate {rpc_url} failed the real host-safety check, skipping")
                continue

            for shape in _PART_SHAPES:
                payload = _build_payload(skill_data, shape)
                try:
                    resp = await client.post(rpc_url, json=payload, timeout=_TIMEOUT, follow_redirects=False)
                    resp.raise_for_status()
                    body = resp.json()
                except Exception as e:
                    print(f"[erc8183_negotiate] {rpc_url} ({shape} part) failed, trying next real format: {e}")
                    continue

                if "error" in body:
                    print(f"[erc8183_negotiate] {rpc_url} ({shape} part): real JSON-RPC error, trying next real format: {body['error']}")
                    continue

                data = _extract_structured_reply(body)
                if data is not None:
                    print(f"[erc8183_negotiate] {rpc_url} ({shape} part): genuine, structured reply received — using this real format")
                    return data, shape

                print(f"[erc8183_negotiate] {rpc_url} ({shape} part): real HTTP 200 but no genuine structured reply "
                      f"(not treated as acceptance): {json.dumps(body)[:300]}")

        return None


async def negotiate(
    service_endpoint: str, task_description: str, terms: dict
) -> dict | None:
    """Real A2A `negotiate` call against a seller agent. Returns the raw
    negotiation-result dict (the same shape `NegotiationResult.to_dict()`
    produces — request/response/negotiation_hash/provider_sig/chain_id/
    verifying_contract) on a real accepted quote, or None on ANY failure
    (no endpoint, not a real A2A agent, timeout, or a genuine rejection) —
    the caller's job is to fall back cleanly, not to distinguish why."""
    result = await _call_skill(service_endpoint, {
        "skill": "negotiate",
        "task_description": task_description,
        "terms": terms,
    })
    if result is None:
        return None
    data, shape = result

    response = data.get("response") or {}
    if not response.get("accepted"):
        # A real, genuine rejection (e.g. malformed terms) — not a
        # transport failure. Still None: the caller falls back the same
        # way either way, and the real reason is already logged for us.
        print(f"[erc8183_negotiate] negotiation not accepted (real {shape}-part reply): {response}")
        return None
    print(f"[erc8183_negotiate] negotiation accepted via a real {shape}-part message")
    return data


async def notify_funded(service_endpoint: str, job_id: int, authorization: dict | None = None) -> dict | None:
    """Real A2A `notify_funded` push: "I funded job X — please deliver."

    Real, confirmed gap (2026-08-24): this marketplace's own hire flow
    (useHireAgent.js) creates + funds the on-chain job but never sent this
    notification — confirmed live against job #56646, which sat funded with
    zero delivery activity in the seller's own logs until this call was sent
    manually. A strict ERC-8183 seller (like our own explainer agent) has no
    other trigger to start work: its background "sweep" for missed funded
    jobs only runs as a side effect of ANOTHER buyer's notify_funded landing
    first (see explainer-agent/seller_core.py's own docstring) — with no
    other buyer ever notifying, a job funded through this marketplace could
    sit forever.

    Best-effort by design, same as `negotiate`: returns None only on a
    TRANSPORT failure (no endpoint, unreachable, malformed reply) — the
    caller must NEVER treat that None as the hire itself failing, the job
    is already funded on-chain regardless. Unlike `negotiate`, a REAL reply
    from the agent (accepted OR rejected) is returned as-is rather than
    collapsed to None — a rejection reason (e.g. "authorization_required",
    "caller_not_job_client") is real, useful signal for the caller/frontend
    to surface, not something to swallow.

    `authorization` (optional): a real, EIP-712-signed envelope for sellers
    that require one — real, confirmed example (2026-08-24): the live
    `stockanalyst-agent` (bnb-chain/stockanalyst-agent-demo pattern)
    unconditionally rejects notify_funded with "authorization_required"
    unless this exact dict is present: {"context": <json string>,
    "expires_at": <int>, "nonce": "0x"+64 hex, "signature": 130 hex (with
    or without "0x")} — verified against that project's real
    notify_security.py (server-side EIP-712 recovery + expected-client
    check). The signature must be produced client-side by the JOB'S OWN
    CLIENT WALLET (only the frontend, with the connected wallet, can sign
    it — this function only forwards an already-built envelope, never
    builds or signs one itself)."""
    skill_data = {"skill": "notify_funded", "job_id": job_id}
    if authorization is not None:
        skill_data["authorization"] = authorization
    result = await _call_skill(service_endpoint, skill_data)
    if result is None:
        return None
    data, shape = result
    if data.get("status") != "accepted":
        print(f"[erc8183_negotiate] notify_funded not accepted (real {shape}-part reply): {data}")
    else:
        print(f"[erc8183_negotiate] notify_funded accepted via a real {shape}-part message")
    return data
