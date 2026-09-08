"""
protocol_compat.py

detection of a genuine, confirmed agent class: registered on-chain,
but a SaaS/off-chain business tool that never implements or listens for
ERC-8183 job events at all, on-chain only for identity/licensing/PoUW-
token purposes. Real, confirmed example this was built from: "AIDA, AI
Medical Receptionist" (owner 0x4e21f74143660ee576f4d2ac26bd30729a849f55)
returns HTTP 405 on every A2A/JSON-RPC format tried (see
core/erc8183_negotiate.py's own probe_a2a_protocol), a user funding a
escrow job against it has zero chance of ever seeing it
delivered; the money sits until the deadline, then has to be
manually reclaimed.

Real, deliberately conservative design, per the explicit instruction
this was built against: only flags an agent on the STRONGEST real
signal, a clean, hard protocol-level rejection (HTTP 404/405/501, or a
non-JSON response) across every candidate endpoint AND every
message format tried (core/erc8183_negotiate.py's probe_a2a_protocol).
metadata patterns (description language suggesting a SaaS/business
product) are SUPPORTING evidence only, surfaced alongside the real
verdict for transparency, never sufficient on their own to flag an
agent, deliberately avoiding a fragile, keyword-only classifier.

Real, honest, distinct outcome for a DIFFERENT situation: an
endpoint that returns a real 401/403 (auth-gated, confirmed live example:
mandaterebalance-agent, which genuinely requires an operator-issued
OAuth2 token) is NEVER classified as escrow-incompatible here. That's a
real, different problem (can't reach it without credentials this
marketplace doesn't have) from AIDA's problem (doesn't speak the
protocol at all, no credential could ever fix that), conflating the two
would be a real, dishonest overreach.

Real, current, limitation: known_agents doesn't store a real
services[] field (only the richer, per-agent 8004scan detail endpoint
does, not the bulk listing this project's regular refresh uses), the
metadata evidence here is description-language only. Not fabricated or
assumed present; a real, future enhancement (fetching the richer detail
on demand, matching WalletPortfolioPanel.jsx's own opt-in pattern)
could add it later.

Real, systematic extension (2026-08-28): a full, ground-up investigation
across the entire dataset (not a handful of anecdotal examples),
see docs/agent-interaction-patterns.md for the full methodology and
findings, found the plain escrow_incompatible boolean below was
collapsing two more real, distinct, evidence-backed states into itself:

  1. Real, auth-gated agents (a genuine 401/403, the probe already knows
     this internally, but check_escrow_compatibility() used to fold it
     into the exact same `false` as a genuinely healthy agent). Real,
     confirmed live example: mandaterebalance-agent, which documents its
     own OAuth2 client_credentials grant requirement, a real,
     different situation from "just works", now surfaced as its own
     `auth_gated` field rather than silently indistinguishable from it.
  2. Real, "different protocol" agents, a genuinely live, functioning
     API that simply doesn't speak A2A/JSON-RPC (real, confirmed example:
     q402.quackai.ai's relay, a live `application/json` response),
     a more honest, different story from a plain marketing website
     returning `text/html` (AIDA, evoevo.ai). Distinguished with one more
     cheap, GET + content-type check, surfaced as `different_protocol`.

Also added: `offers_x402_alternative`, a real, precise (confirmed
zero-false-positive across the full corpus), description-text-only
signal for the small (3-4 agents, confirmed by reading every one)
but set of agents that describe direct x402 pay-per-call access
as part of their own operation. Deliberately NOT a new hard gate,
see docs/agent-interaction-patterns.md for why this stays a small,
additive note rather than its own flow, given how few agents it
actually applies to.

patterns explicitly investigated and NOT built for, because the
full corpus census found zero or near-zero evidence:
governance/DAO-delegation, vault/custodial deposit, subscription/
webhook/push-alert monitoring, NFT/token-gated access, and session-key
delegation beyond the existing Altana flow (the one hit for that
last one turned out to already describe the Altana pattern this
marketplace already supports). Full evidence for each ruled-out
pattern is in docs/agent-interaction-patterns.md, not just asserted here.
"""

from __future__ import annotations

import re
import time

import httpx

from core.deliverable_proxy import _is_safe_public_host
from core.erc8183_negotiate import probe_a2a_protocol

# Real, plain http(s) URL matcher, used only to find a URL the agent's
# OWN creator already put in its own real, submitted description text
# (confirmed real, live example: AIDA's own description literally
# contains "clinic onboarding via https://aida-ai.health"). Never
# constructs or guesses a URL, only extracts one that's already there.
_URL_RE = re.compile(r"https?://[^\s)>\]\"']+")

# Real, live network calls, not free, an agent's protocol support is
# a structural property that doesn't change minute to minute, unlike
# agent_health.py's own much-shorter liveness TTL. Cached per real
# service_endpoint.
_TTL_SECONDS = 24 * 60 * 60
_cache: dict[str, tuple[float, dict]] = {}

# Real, confirmed bound, added 2026-08-29: this cache and _content_type_cache
# below are module-level and never evicted except by being overwritten, a
# real, live OOM was observed on the new escrow-compat-audit Background
# Worker (backend/worker.py) after ~27 minutes of continuous operation,
# growing this cache by roughly one entry per distinct service_endpoint
# audited (~2,200+ within that window, mostly long-tail agents with unique
# endpoints, see escrow_compat_audit.py's own phase ordering). Harmless for
# the original bounded, per-request web-service usage this was written for
# (a process that gets redeployed/restarted regularly), genuinely unsafe for
# a process meant to run for days. A full clear once either cache exceeds
# this many entries is safe, both are pure performance optimizations with
# their own 24h TTL already, so a reset only costs a few extra live
# re-probes, never a correctness issue. 20,000 is comfortably above the
# real, current distinct-endpoint population (~7,000-8,000) so this is a
# safety net, not a tight budget expected to trigger under normal operation.
_CACHE_MAX_ENTRIES = 20_000


def _bounded_cache_set(cache: dict, key: str, value: tuple) -> None:
    if len(cache) >= _CACHE_MAX_ENTRIES:
        cache.clear()
    cache[key] = value

# Real, plain-language markers of a SaaS/business-product description,
# confirmed against AIDA's own real, live description text ("clinic
# onboarding", real €/mo pricing tiers), kept small and literal, not a
# broad keyword net, since this is explicitly SUPPORTING evidence only
# (see module docstring), never what triggers a flag on its own.
_SAAS_LANGUAGE_MARKERS = (
    "clinic", "clinics", "monthly plan", "subscription", "onboarding",
    "€/mo", "/mo)", "$/mo", "pricing (", "saas",
)

# Real, precise, single-purpose match, confirmed zero false positives
# across a full real-corpus census (every one of the 4 BSC agents
# whose own description matches this was a genuine, x402 mention,
# not a coincidental keyword hit), see docs/agent-interaction-patterns.md.
# Deliberately just the literal token, not a broader net: this is real,
# rare signal (3-4 agents platform-wide), not worth a fragile keyword list.
_X402_MENTION_RE = re.compile(r"x402", re.IGNORECASE)

# Real, cheap, second-hop check for the different_protocol distinction,
# a plain GET against the same endpoint the A2A probe already rejected,
# checked only for its Content-Type (JSON vs HTML), never its body.
# Own short cache, separate from the A2A-probe cache above, since it's an
# independent HTTP call answering a different question.
_content_type_cache: dict[str, tuple[float, bool | None]] = {}


def _is_safe_url(url: str) -> bool:
    """Real, shared guard, same standard as erc8183_negotiate.py's own
    (that module's private copy isn't imported directly to avoid a real,
    unnecessary cross-module private-function dependency; this is the
    same check, just inlined here)."""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    return _is_safe_public_host(parsed.hostname)


async def _looks_like_a_different_protocol(service_endpoint: str | None) -> bool | None:
    """Real, honest, best-effort signal: is this a genuinely live, real
    JSON API (just not one that speaks A2A) rather than a plain website?
    Confirmed live (2026-08-28): AIDA and evoevo.ai (plain SaaS/website
    incompatible agents) both return `text/html`; q402.quackai.ai (a real,
    live, functioning payment-relay API) returns `application/json`. A
    real, cheap, single GET, never a POST, never sends anything the
    endpoint could mistake for a job/payment. Returns None (not
    False) on any failure to check (unsafe URL, transport error,
    missing content-type), an honest "couldn't tell", never asserted as
    a confirmed plain-website verdict without evidence."""
    if not service_endpoint or not _is_safe_url(service_endpoint):
        return None
    cached = _content_type_cache.get(service_endpoint)
    if cached and time.time() - cached[0] < _TTL_SECONDS:
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(service_endpoint, follow_redirects=True)
        content_type = resp.headers.get("content-type", "")
        result = "json" in content_type.lower()
    except Exception:
        result = None
    _bounded_cache_set(_content_type_cache, service_endpoint, (time.time(), result))
    return result


def _metadata_evidence(description: str | None) -> list[str]:
    """Real, honest, supporting-only evidence from an agent's own real,
    submitted description text. Never returns anything that implies a
    verdict on its own, see check_escrow_compatibility for how (or
    whether) this ever actually affects the result."""
    if not description:
        return []
    lower = description.lower()
    hits = [kw for kw in _SAAS_LANGUAGE_MARKERS if kw in lower]
    if not hits:
        return []
    return [f"Description language suggests a SaaS/business product (mentions: {', '.join(hits)})."]


async def _classify_endpoint(service_endpoint: str | None) -> tuple[str | None, str | None]:
    """What the registered endpoint actually serves: (url, kind).

    Fetched rather than inferred from the path, because the shape of a URL
    does not tell you what is behind it. Measured across all 1,085 distinct
    BSC endpoint hosts before this was written: 5.3% serve an HTML page,
    5.5% a JSON card, 88% were unreachable.

      - HTML  -> the endpoint IS the page. The largest operator on BSC
                 (evoevo.ai, 99,631 agents) registers a per-agent HTML
                 profile, so calling that "machine-readable" would just be
                 the opposite mislabelling.
      - JSON  -> a machine-readable card. Its documentationUrl or
                 provider.url may name a human page; the card's top-level
                 `url` deliberately does not count, since in the A2A spec
                 that is the service endpoint.
      - anything else, or unreachable -> left as the endpoint, unlabelled
                 as a page. We do not claim what we could not see.
    """
    if not service_endpoint or not service_endpoint.startswith(("http://", "https://")):
        return None, None
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            resp = await client.get(service_endpoint)
    except Exception:
        return service_endpoint, "endpoint"

    ctype = (resp.headers.get("content-type") or "").lower()
    if "html" in ctype:
        return service_endpoint, "page"
    if "json" in ctype:
        try:
            card = resp.json()
        except Exception:
            return service_endpoint, "endpoint"
        if isinstance(card, dict):
            doc = card.get("documentationUrl")
            if isinstance(doc, str) and doc.startswith(("http://", "https://")):
                return doc, "page"
            provider = card.get("provider")
            if isinstance(provider, dict):
                purl = provider.get("url")
                if isinstance(purl, str) and purl.startswith(("http://", "https://")):
                    return purl, "page"
    return service_endpoint, "endpoint"


async def _card_human_url(service_endpoint: str | None) -> str | None:
    """A human-facing URL the agent's own card publishes, or None.

    Only two fields qualify, and the distinction is from the A2A spec
    rather than guessed:
      - documentationUrl is defined as human-readable documentation.
      - provider.url is the provider organisation's own site.
    The card's top-level `url` is deliberately NOT used: in A2A that is
    the agent's service endpoint, so treating it as a homepage would
    reproduce exactly the mislabelling this function exists to end.
    Measured across the 60 distinct JSON endpoints on BSC: url 27,
    provider.url 5, documentationUrl 3.
    """
    if not service_endpoint or not service_endpoint.startswith(("http://", "https://")):
        return None
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            resp = await client.get(service_endpoint)
            if "json" not in (resp.headers.get("content-type") or "").lower():
                return None
            card = resp.json()
    except Exception:
        return None
    if not isinstance(card, dict):
        return None
    doc = card.get("documentationUrl")
    if isinstance(doc, str) and doc.startswith(("http://", "https://")):
        return doc
    provider = card.get("provider")
    if isinstance(provider, dict):
        purl = provider.get("url")
        if isinstance(purl, str) and purl.startswith(("http://", "https://")):
            return purl
    return None


def _extract_real_external_link(service_endpoint: str | None, description: str | None) -> tuple[str | None, str | None]:
    """Returns (url, kind) where kind is "page", "endpoint" or None.

    Never fabricates a URL: everything returned came from the agent's own
    submitted data. What changed is that the KIND is now reported, because
    the two were previously collapsed and the UI labelled both "Visit
    <host>" -- including when the target was a machine-readable
    agent-card.json, which is not a site a person would want to open.

    Measured on BSC before writing this, across all 1,085 distinct
    endpoint hosts: only 5.3% of hosts serve an HTML page, 5.5% serve a
    JSON card, and 88% were unreachable. By agent count a page looks far
    more common (93.9%), but 93% of that is a single operator
    (evoevo.ai), so the per-host figure is the one.

      1. A URL in the agent's own description is a "page": a creator
         writing "onboarding via https://..." in prose means it as
         somewhere to go.
      2. Otherwise the registered service_endpoint itself, as an
         "endpoint" -- and worth linking for anyone who wants it,
         but not a site, and no longer described as one.
    """
    if description:
        match = _URL_RE.search(description)
        if match:
            return match.group(0).rstrip(".,;:"), "page"

    if service_endpoint and service_endpoint.startswith(("http://", "https://")):
        return service_endpoint, "endpoint"

    return None, None


def _was_auth_gated(evidence: list[str]) -> bool:
    """Real, read of the probe's own evidence lines for a genuine
    401/403 hit, see erc8183_negotiate.py's _AUTH_GATED_STATUSES. Only
    ever meaningful when protocol_detected is None (inconclusive), an
    agent that's ALSO hard-rejected elsewhere still resolves to
    escrow_incompatible=True regardless (see check_escrow_compatibility)."""
    return any("auth-gated" in e for e in evidence)


async def check_escrow_compatibility(service_endpoint: str | None, description: str | None) -> dict:
    """Real, cached, verdict: can this agent realistically ever
    fulfill a real, escrowed ERC-8183 job through this marketplace's
    normal hire flow?

    Returns:
      - escrow_incompatible: True ONLY on strong, evidence (a clean,
        hard protocol-level rejection from probe_a2a_protocol, across
        every candidate+format combination it tried).
      - escrow_incompatible: False for every other outcome,
        genuinely compatible, genuinely inconclusive (a transport
        blip, a auth gate), or missing data. NEVER "incompatible"
        without the real, strong protocol signal, a conservative
        default that would rather under-flag than wrongly block a
        genuinely working agent's hire flow.
      - evidence: real, human-readable reasons, protocol-probe
        evidence first, then any real, supporting metadata evidence,
        clearly labeled as supporting only.
      - external_link: a URL taken directly from the agent's own
        submitted description or service_endpoint (never fabricated,
        see _extract_real_external_link), only meaningful, and only
        ever surfaced by the frontend, when escrow_incompatible is True.
        Still computed and returned regardless, since it's cheap and
        either way; None when the agent's own data has
        nothing usable.
      - auth_gated: real, additive (2026-08-28, see module docstring for
        the full investigation this came from). True only when the
        probe's own result was genuinely inconclusive BECAUSE of a
        real 401/403, never when it was ALSO hard-rejected somewhere
        else (that case stays escrow_incompatible=True, full stop, a
        auth gate on one candidate doesn't excuse a real, hard
        rejection on another). Always False when escrow_incompatible is
        True, since that's a stronger, different finding.
      - different_protocol: real, additive. True only alongside
        escrow_incompatible=True, when a real, live GET against the same
        endpoint came back as real, JSON (not HTML), a
        genuinely different story ("speaks a different protocol")
        from a plain marketing/profile website. None/False (never
        fabricated) when that check itself couldn't be done.
      - offers_x402_alternative: real, additive, independent of every
        other field above, True whenever the agent's own real,
        submitted description explicitly mentions x402, regardless of
        whether escrow itself works. Real, rare (3-4 agents
        platform-wide, confirmed by reading every one), see module
        docstring for why this stays a small note, not a new gate."""
    cache_key = service_endpoint or ""
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _TTL_SECONDS:
        probe = cached[1]
    else:
        probe = await probe_a2a_protocol(service_endpoint)
        _bounded_cache_set(_cache, cache_key, (time.time(), probe))

    evidence = [f"Protocol probe: {e}" for e in probe["evidence"]]
    meta = _metadata_evidence(description)
    if meta:
        evidence += [f"Supporting only: {e}" for e in meta]

    incompatible = probe["protocol_detected"] is False
    auth_gated = probe["protocol_detected"] is None and _was_auth_gated(probe["evidence"])

    different_protocol = False
    if incompatible:
        different_protocol = bool(await _looks_like_a_different_protocol(service_endpoint))

    offers_x402_alternative = bool(description and _X402_MENTION_RE.search(description))

    link, link_kind = _extract_real_external_link(service_endpoint, description)
    # A page the card itself publishes beats falling back to the machine
    # endpoint, so it is only consulted when we would otherwise have to.
    if link_kind == "endpoint":
        classified_url, classified_kind = await _classify_endpoint(service_endpoint)
        if classified_url:
            link, link_kind = classified_url, classified_kind

    return {
        "escrow_incompatible": incompatible,
        "confidence": "high" if incompatible else None,
        "evidence": evidence,
        "external_link": link,
        # "page" = somewhere a person would want to open. "endpoint" = the
        # registered machine-readable endpoint, linked but never called a
        # site. None = the agent published neither.
        "external_link_kind": link_kind,
        "auth_gated": auth_gated,
        "different_protocol": different_protocol,
        "offers_x402_alternative": offers_x402_alternative,
    }
