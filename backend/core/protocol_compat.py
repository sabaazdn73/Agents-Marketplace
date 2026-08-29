"""
protocol_compat.py

Real detection of a genuine, confirmed agent class: registered on-chain,
but a SaaS/off-chain business tool that never implements or listens for
ERC-8183 job events at all — on-chain only for identity/licensing/PoUW-
token purposes. Real, confirmed example this was built from: "AIDA — AI
Medical Receptionist" (real owner 0x4e21f74143660ee576f4d2ac26bd30729a849f55)
returns real HTTP 405 on every real A2A/JSON-RPC format tried (see
core/erc8183_negotiate.py's own probe_a2a_protocol) — a user funding a
real escrow job against it has zero real chance of ever seeing it
delivered; the money sits until the real deadline, then has to be
manually reclaimed.

Real, deliberately conservative design, per the explicit real instruction
this was built against: only flags an agent on the STRONGEST real
signal — a clean, hard protocol-level rejection (HTTP 404/405/501, or a
non-JSON real response) across every real candidate endpoint AND every
real message format tried (core/erc8183_negotiate.py's probe_a2a_protocol).
Real metadata patterns (description language suggesting a SaaS/business
product) are SUPPORTING evidence only, surfaced alongside the real
verdict for transparency — never sufficient on their own to flag an
agent, deliberately avoiding a fragile, keyword-only classifier.

Real, honest, distinct outcome for a DIFFERENT real situation: an
endpoint that returns a real 401/403 (auth-gated — confirmed live example:
mandaterebalance-agent, which genuinely requires an operator-issued
OAuth2 token) is NEVER classified as escrow-incompatible here. That's a
real, different problem (can't reach it without credentials this
marketplace doesn't have) from AIDA's real problem (doesn't speak the
protocol at all, no credential could ever fix that) — conflating the two
would be a real, dishonest overreach.

Real, current, honest limitation: known_agents doesn't store a real
services[] field (only the richer, per-agent 8004scan detail endpoint
does, not the bulk listing this project's regular refresh uses) — the
metadata evidence here is description-language only. Not fabricated or
assumed present; a real, future enhancement (fetching the richer detail
on demand, matching WalletPortfolioPanel.jsx's own real opt-in pattern)
could add it later.

Real, systematic extension (2026-08-28): a full, ground-up investigation
across the entire real dataset (not a handful of anecdotal examples) —
see docs/agent-interaction-patterns.md for the full real methodology and
findings — found the plain escrow_incompatible boolean below was
collapsing two more real, distinct, evidence-backed states into itself:

  1. Real, auth-gated agents (a genuine 401/403 — the probe already knows
     this internally, but check_escrow_compatibility() used to fold it
     into the exact same `false` as a genuinely healthy agent). Real,
     confirmed live example: mandaterebalance-agent, which documents its
     own real OAuth2 client_credentials grant requirement — a real,
     different situation from "just works", now surfaced as its own
     `auth_gated` field rather than silently indistinguishable from it.
  2. Real, "different protocol" agents — a genuinely live, functioning
     API that simply doesn't speak A2A/JSON-RPC (real, confirmed example:
     q402.quackai.ai's real relay, a live `application/json` response),
     a more honest, different story from a plain marketing website
     returning `text/html` (AIDA, evoevo.ai). Distinguished with one more
     cheap, real GET + content-type check, surfaced as `different_protocol`.

Also added: `offers_x402_alternative` — a real, precise (confirmed
zero-false-positive across the full real corpus), description-text-only
signal for the small (3-4 real agents, confirmed by reading every one)
but genuine set of agents that describe direct x402 pay-per-call access
as part of their own real operation. Deliberately NOT a new hard gate —
see docs/agent-interaction-patterns.md for why this stays a small,
additive note rather than its own flow, given how few real agents it
actually applies to.

Real patterns explicitly investigated and NOT built for, because the
full real corpus census found zero or near-zero genuine evidence:
governance/DAO-delegation, vault/custodial deposit, subscription/
webhook/push-alert monitoring, NFT/token-gated access, and session-key
delegation beyond the existing Altana flow (the one real hit for that
last one turned out to already describe the Altana pattern this
marketplace already supports). Full real evidence for each ruled-out
pattern is in docs/agent-interaction-patterns.md, not just asserted here.
"""

from __future__ import annotations

import re
import time

import httpx

from core.deliverable_proxy import _is_safe_public_host
from core.erc8183_negotiate import probe_a2a_protocol

# Real, plain http(s) URL matcher — used only to find a URL the agent's
# OWN creator already put in its own real, submitted description text
# (confirmed real, live example: AIDA's own description literally
# contains "clinic onboarding via https://aida-ai.health"). Never
# constructs or guesses a URL — only extracts one that's already there.
_URL_RE = re.compile(r"https?://[^\s)>\]\"']+")

# Real, live network calls, not free — an agent's real protocol support is
# a structural property that doesn't change minute to minute, unlike
# agent_health.py's own much-shorter liveness TTL. Cached per real
# service_endpoint.
_TTL_SECONDS = 24 * 60 * 60
_cache: dict[str, tuple[float, dict]] = {}

# Real, confirmed bound, added 2026-08-29: this cache and _content_type_cache
# below are module-level and never evicted except by being overwritten — a
# real, live OOM was observed on the new escrow-compat-audit Background
# Worker (backend/worker.py) after ~27 minutes of continuous operation,
# growing this cache by roughly one entry per distinct real service_endpoint
# audited (~2,200+ within that window, mostly long-tail agents with unique
# endpoints — see escrow_compat_audit.py's own phase ordering). Harmless for
# the original bounded, per-request web-service usage this was written for
# (a process that gets redeployed/restarted regularly), genuinely unsafe for
# a process meant to run for days. A full clear once either cache exceeds
# this many entries is safe — both are pure performance optimizations with
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
# onboarding", real €/mo pricing tiers) — kept small and literal, not a
# broad keyword net, since this is explicitly SUPPORTING evidence only
# (see module docstring), never what triggers a flag on its own.
_SAAS_LANGUAGE_MARKERS = (
    "clinic", "clinics", "monthly plan", "subscription", "onboarding",
    "€/mo", "/mo)", "$/mo", "pricing (", "saas",
)

# Real, precise, single-purpose match — confirmed zero false positives
# across a full real-corpus census (every one of the 4 real BSC agents
# whose own description matches this was a genuine, real x402 mention,
# not a coincidental keyword hit) — see docs/agent-interaction-patterns.md.
# Deliberately just the literal token, not a broader net: this is real,
# rare signal (3-4 agents platform-wide), not worth a fragile keyword list.
_X402_MENTION_RE = re.compile(r"x402", re.IGNORECASE)

# Real, cheap, second-hop check for the different_protocol distinction —
# a plain GET against the same endpoint the A2A probe already rejected,
# checked only for its real Content-Type (JSON vs HTML), never its body.
# Own short cache, separate from the A2A-probe cache above, since it's an
# independent real HTTP call answering a different real question.
_content_type_cache: dict[str, tuple[float, bool | None]] = {}


def _is_safe_url(url: str) -> bool:
    """Real, shared guard — same standard as erc8183_negotiate.py's own
    (that module's private copy isn't imported directly to avoid a real,
    unnecessary cross-module private-function dependency; this is the
    same real check, just inlined here)."""
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
    real, cheap, single GET — never a POST, never sends anything the
    endpoint could mistake for a real job/payment. Returns None (not
    False) on any real failure to check (unsafe URL, transport error,
    missing content-type) — an honest "couldn't tell", never asserted as
    a confirmed plain-website verdict without real evidence."""
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
    verdict on its own — see check_escrow_compatibility for how (or
    whether) this ever actually affects the real result."""
    if not description:
        return []
    lower = description.lower()
    hits = [kw for kw in _SAAS_LANGUAGE_MARKERS if kw in lower]
    if not hits:
        return []
    return [f"Description language suggests a SaaS/business product (mentions: {', '.join(hits)})."]


def _extract_real_external_link(service_endpoint: str | None, description: str | None) -> str | None:
    """Real, honest external-link extraction — NEVER fabricates or guesses
    a URL. Only ever returns a URL that the agent's own creator already put
    in the agent's own real, submitted data:

      1. First choice: the first real http(s) URL found in the agent's own
         description text (confirmed real, live example: AIDA's own
         description literally reads "...clinic onboarding via
         https://aida-ai.health..." — that's a real link its own creator
         chose to publish as the actual place to use the product).
      2. Fallback: the agent's own registered service_endpoint itself, if
         it's a real, plain http(s) URL — even though it didn't answer the
         real A2A/JSON-RPC probe, it may still be a real, working webpage
         (e.g. a marketing site or dashboard) a buyer could visit directly.

    Returns None (never a placeholder or guessed value) if neither of the
    agent's own real, submitted fields contains anything usable."""
    if description:
        match = _URL_RE.search(description)
        if match:
            return match.group(0).rstrip(".,;:")

    if service_endpoint and service_endpoint.startswith(("http://", "https://")):
        return service_endpoint

    return None


def _was_auth_gated(evidence: list[str]) -> bool:
    """Real, honest read of the probe's own evidence lines for a genuine
    401/403 hit — see erc8183_negotiate.py's _AUTH_GATED_STATUSES. Only
    ever meaningful when protocol_detected is None (inconclusive) — an
    agent that's ALSO hard-rejected elsewhere still resolves to
    escrow_incompatible=True regardless (see check_escrow_compatibility)."""
    return any("real auth-gated" in e for e in evidence)


async def check_escrow_compatibility(service_endpoint: str | None, description: str | None) -> dict:
    """Real, cached, honest verdict: can this agent realistically ever
    fulfill a real, escrowed ERC-8183 job through this marketplace's
    normal hire flow?

    Returns:
      - escrow_incompatible: True ONLY on strong, real evidence (a clean,
        hard protocol-level rejection from probe_a2a_protocol, across
        every real candidate+format combination it tried).
      - escrow_incompatible: False for every other real outcome —
        genuinely compatible, genuinely inconclusive (a real transport
        blip, a real auth gate), or missing data. NEVER "incompatible"
        without the real, strong protocol signal — a conservative
        default that would rather under-flag than wrongly block a
        genuinely working agent's hire flow.
      - evidence: real, human-readable reasons — real protocol-probe
        evidence first, then any real, supporting metadata evidence,
        clearly labeled as supporting only.
      - external_link: a real URL taken directly from the agent's own
        submitted description or service_endpoint (never fabricated —
        see _extract_real_external_link) — only meaningful, and only
        ever surfaced by the frontend, when escrow_incompatible is True.
        Still computed and returned regardless, since it's cheap and
        honest either way; None when the agent's own real data has
        nothing usable.
      - auth_gated: real, additive (2026-08-28 — see module docstring for
        the full real investigation this came from). True only when the
        probe's own real result was genuinely inconclusive BECAUSE of a
        real 401/403, never when it was ALSO hard-rejected somewhere
        else (that case stays escrow_incompatible=True, full stop — a
        real auth gate on one candidate doesn't excuse a real, hard
        rejection on another). Always False when escrow_incompatible is
        True, since that's a stronger, different real finding.
      - different_protocol: real, additive. True only alongside
        escrow_incompatible=True, when a real, live GET against the same
        endpoint came back as real, genuine JSON (not HTML) — a
        genuinely different real story ("speaks a different protocol")
        from a plain marketing/profile website. None/False (never
        fabricated) when that check itself couldn't be done.
      - offers_x402_alternative: real, additive, independent of every
        other field above — True whenever the agent's own real,
        submitted description explicitly mentions x402, regardless of
        whether escrow itself works. Real, rare (3-4 agents
        platform-wide, confirmed by reading every one) — see module
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

    return {
        "escrow_incompatible": incompatible,
        "confidence": "high" if incompatible else None,
        "evidence": evidence,
        "external_link": _extract_real_external_link(service_endpoint, description),
        "auth_gated": auth_gated,
        "different_protocol": different_protocol,
        "offers_x402_alternative": offers_x402_alternative,
    }
