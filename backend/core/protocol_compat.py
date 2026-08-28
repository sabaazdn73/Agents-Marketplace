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
"""

from __future__ import annotations

import re
import time

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

# Real, plain-language markers of a SaaS/business-product description,
# confirmed against AIDA's own real, live description text ("clinic
# onboarding", real €/mo pricing tiers) — kept small and literal, not a
# broad keyword net, since this is explicitly SUPPORTING evidence only
# (see module docstring), never what triggers a flag on its own.
_SAAS_LANGUAGE_MARKERS = (
    "clinic", "clinics", "monthly plan", "subscription", "onboarding",
    "€/mo", "/mo)", "$/mo", "pricing (", "saas",
)


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
        nothing usable."""
    cache_key = service_endpoint or ""
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _TTL_SECONDS:
        probe = cached[1]
    else:
        probe = await probe_a2a_protocol(service_endpoint)
        _cache[cache_key] = (time.time(), probe)

    evidence = [f"Protocol probe: {e}" for e in probe["evidence"]]
    meta = _metadata_evidence(description)
    if meta:
        evidence += [f"Supporting only: {e}" for e in meta]

    incompatible = probe["protocol_detected"] is False
    return {
        "escrow_incompatible": incompatible,
        "confidence": "high" if incompatible else None,
        "evidence": evidence,
        "external_link": _extract_real_external_link(service_endpoint, description),
    }
