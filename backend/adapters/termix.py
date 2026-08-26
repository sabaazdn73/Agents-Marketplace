"""
termix.py

Real, independent, protocol-wide cross-reference for one agent's real track
record — TermiX's own AACP (Autonomous Agent Capital Protocol) registry,
NOT this marketplace's own data. Built 2026-08-28 directly off a real,
confirmed finding from that session's hire-flow audit research: TermiX runs
its own real, live, unauthenticated explorer API
(https://platform-backend.prod.termix.live/api/v1/explorer/agents) tracking
activity for a large real share of the same BSC ERC-8004-registered agents
this marketplace lists — confirmed via a live call that its real
`agent.agentTokenId` field is the EXACT SAME real ERC-8004 identity token id
as this project's own `token_id` for two independently checked agents
(stockanalyst-agent: 268954 on both sides; bnb-lp-quant.agent: 293054 on
both sides) — a genuine, verifiable match on the same real on-chain
identity, not a coincidence.

Real reason this exists (2026-08-28): this marketplace's OWN win-rate stat
is young and has had real bugs (the notify_funded authorization-gate bug
just fixed) that failed real jobs for reasons having nothing to do with an
agent's actual quality. Presenting only "0% on this marketplace" as if it
reflects an agent's real capability is misleading while our own sample size
is this small. TermiX's own tracked completedJobs/passRate/reputationScore
cover REAL activity across the whole protocol, not just hires that happened
to go through this specific product — a genuinely less-biased second data
point, shown honestly alongside our own, never blended into one fabricated
combined number (see AgentPerformance's own real display logic).

No documented "look up by token id" endpoint exists on TermiX's real API —
only `query`/`tag`/`minReputation`/`sort`/`page`/`pageSize` filters. So this
searches by the agent's real NAME (already on hand from our own agent_store)
and then confirms the real match by comparing `agent.agentTokenId` against
our own real on-chain `token_id` — the exact technique verified live during
the hire-flow audit for the two agents above. If TermiX has multiple
same-named results, or none at all, or the name search returns something
that doesn't match on token id, this honestly reports unavailable rather
than guessing.

Best-effort, same discipline as zerion.py: any failure (network, malformed
response, no real match) reports {"available": False, "reason": ...},
never a fabricated number.
"""

from __future__ import annotations

import time

import httpx

_BASE_URL = "https://platform-backend.prod.termix.live"

# Real, in-process cache — this is a live, third-party, unauthenticated API
# with no documented rate limit, but there's no reason to re-fetch the same
# agent's real TermiX stats on every detail-page open in a short window.
# Same pattern as zerion.py / agent_health.py elsewhere in this project.
_TTL_SECONDS = 30 * 60
_cache: dict[str, tuple[float, dict]] = {}


async def get_termix_stats(token_id, name: str | None) -> dict:
    """Real TermiX AACP stats for one agent, matched by real ERC-8004 token
    id. `token_id` should be the same real on-chain token id this
    marketplace already has for the agent; `name` is used only to narrow
    TermiX's own search (no by-id lookup exists) — the real match is always
    confirmed by token id, never by name alone (names aren't guaranteed
    unique across two independent registries).

    Returns:
      {"available": True, "completed_jobs": int, "pass_rate": float|None,
       "reputation_score": float|None, "stake": str|None}
    or, honestly, on any failure/no-match:
      {"available": False, "reason": "..."}
    """
    if token_id is None:
        return {"available": False, "reason": "no real ERC-8004 token id on record for this agent"}
    cache_key = str(token_id)
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _TTL_SECONDS:
        return cached[1]

    if not name:
        result = {"available": False, "reason": "no agent name on record to search TermiX's registry by"}
        _cache[cache_key] = (time.time(), result)
        return result

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{_BASE_URL}/api/v1/explorer/agents",
                params={"query": name, "pageSize": 10},
            )
    except httpx.HTTPError as e:
        result = {"available": False, "reason": f"couldn't reach TermiX: {e}"}
        _cache[cache_key] = (time.time(), result)
        return result

    if not resp.is_success:
        result = {"available": False, "reason": f"TermiX returned HTTP {resp.status_code}"}
        _cache[cache_key] = (time.time(), result)
        return result

    try:
        items = resp.json().get("items", []) or []
    except Exception:
        result = {"available": False, "reason": "TermiX returned an unexpected response shape"}
        _cache[cache_key] = (time.time(), result)
        return result

    # Real match, confirmed by real ERC-8004 token id — never by name alone.
    match = next(
        (it for it in items if str((it.get("agent") or {}).get("agentTokenId")) == str(token_id)),
        None,
    )
    if match is None:
        result = {"available": False, "reason": "not listed on TermiX's real registry (no agent there matches this agent's real ERC-8004 token id)"}
        _cache[cache_key] = (time.time(), result)
        return result

    def _num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    result = {
        "available": True,
        "completed_jobs": int(match.get("completedJobs") or 0),
        "pass_rate": _num(match.get("passRate")),
        "reputation_score": _num(match.get("reputationScore")),
        "stake": match.get("stake"),
    }
    _cache[cache_key] = (time.time(), result)
    return result
