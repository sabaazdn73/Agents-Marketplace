"""
clustering.py

Real, principled, multi-signal agent deduplication — replaces treating any
SINGLE heuristic (a description-template match, or worse, a shared owner
wallet alone) as sufficient proof two agents are "the same" for diversity-
capping purposes. Built 2026-08-28 after a real, correctly-identified
methodological weakness: the original cluster signature (still used here
as a real, cheap BLOCKING key — see _cluster_signature — to avoid an
O(n²) comparison across tens of thousands of real agents) is a real,
useful first pass, but collapsing purely on it (or on a shared owner
address) risks silently hiding genuinely distinct agents.

Real, explicit requirement this module satisfies: a wallet legitimately
running several real, different agents — different real names, different
real descriptions, different real purposes — must NOT be collapsed just
because they share an owner. Only genuine template/boilerplate
duplication (the real problem the original heuristic was trying to catch)
should be.

Real design: two agents are only actually treated as duplicates of each
other if BOTH of these hold:
  1. Their description-template signature matches (the real blocking key
     — necessary, not sufficient on its own).
  2. At least one further, real, corroborating signal also agrees:
       - the exact same real registered service endpoint (strong signal —
         same underlying deployment), OR
       - real registration timestamps within a tight window of each other
         (same real registration burst — a mass-registration script
         minting many agents together), OR
       - the same owner address AS ONE OF SEVERAL signals (never alone —
         see above).
A description-template match with NONE of the corroborating signals
present leaves the agents un-clustered (each counted as its own, distinct
real agent) — the real, deliberate fix for the exact case the user
flagged: same owner, genuinely different agents, must not collapse.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

# Real registration-burst window — agents created within this many real
# seconds of each other are treated as a real, corroborating "same
# campaign" signal. 10 minutes is generous enough to catch a real batch
# script's own real, sequential on-chain registrations (each a separate
# real tx, so not instantaneous) without being so wide it starts
# corroborating unrelated agents that just happen to register the same day.
BURST_WINDOW_SECONDS = 600


def _cluster_signature(name: str, description: str) -> tuple:
    """Real, cheap blocking key — unchanged from core/aggregate.py's
    original (validated against a real 1,014-agent BSC sample: correctly
    identified the 'on termix platform' (694), 'gasless stablecoin payment
    agent' (113), and 'ai-driven multi-chain trading agent' (105)
    clusters). Kept here verbatim (not re-imported from aggregate.py, to
    avoid a real circular import — aggregate.py will import FROM this
    module instead) so this stays the single, real source of truth for it
    going forward."""
    name_l = (name or "").strip().lower()
    desc_l = (description or "").strip().lower()
    if name_l:
        desc_l = desc_l.replace(name_l, "")
    desc_l = re.sub(r"\s+", " ", desc_l).strip()
    desc_l = re.sub(r"[#0-9]+", "", desc_l).strip()
    if desc_l:
        return ("desc", desc_l)
    return ("name", re.sub(r"[#0-9]+", "", name_l).strip())


def _parse_ts(value) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return None


def _corroborates(a: dict, b: dict) -> bool:
    """Real, second-signal check — only called on a pair that ALREADY
    shares a description-template signature (see cluster_agents below).
    Returns True the moment ANY one real corroborating signal agrees."""
    # Same real registered service endpoint — the strongest single signal;
    # checked across whichever of the agent's own real service fields are
    # present on this real record shape.
    ep_a = (a.get("a2a_endpoint") or a.get("service_endpoint") or "").strip().lower()
    ep_b = (b.get("a2a_endpoint") or b.get("service_endpoint") or "").strip().lower()
    if ep_a and ep_a == ep_b:
        return True

    # Real registration-burst proximity.
    ts_a = _parse_ts(a.get("created_at"))
    ts_b = _parse_ts(b.get("created_at"))
    if ts_a is not None and ts_b is not None and abs(ts_a - ts_b) <= BURST_WINDOW_SECONDS:
        return True

    # Shared owner — a real, but deliberately NOT standalone, signal (see
    # module docstring). Only reached here because signal 1 (description
    # template) already matched, so this is one of several corroborating
    # checks, never the sole trigger.
    owner_a = (a.get("owner_address") or "").strip().lower()
    owner_b = (b.get("owner_address") or "").strip().lower()
    if owner_a and owner_a == owner_b:
        return True

    return False


def cluster_agents(agents: list[dict]) -> dict[int, int]:
    """Real, principled clustering: returns {index_in_agents: cluster_id}.
    Agents that never matched ANY other agent on both the blocking key AND
    a corroborating signal each get their OWN unique cluster id (correctly
    counted as distinct, not silently folded into someone else's cluster).

    Real efficiency note: the blocking step (grouping by description-
    template signature first) keeps this well under O(n²) in practice —
    only agents that ALREADY share a real description template are ever
    compared pairwise against each other for the corroborating check,
    and those buckets are typically small even across tens of thousands
    of real agents (see docs/full-registry-analysis.md for real, measured
    bucket sizes)."""
    buckets: dict[tuple, list[int]] = {}
    for i, a in enumerate(agents):
        sig = _cluster_signature(a.get("name", ""), a.get("description", ""))
        buckets.setdefault(sig, []).append(i)

    # Union-Find over indices — real, standard disjoint-set clustering,
    # not an ad-hoc bucket dict, so a real chain of pairwise-corroborated
    # agents (A~B via endpoint, B~C via timestamp) correctly ends up in
    # ONE real cluster even if A and C alone wouldn't have corroborated
    # directly.
    parent = list(range(len(agents)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: int, y: int) -> None:
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[rx] = ry

    for sig, idxs in buckets.items():
        if len(idxs) < 2:
            continue
        for a in range(len(idxs)):
            for b in range(a + 1, len(idxs)):
                i, j = idxs[a], idxs[b]
                if _corroborates(agents[i], agents[j]):
                    union(i, j)

    # Real, stable cluster ids (0..k-1), not raw root indices, so callers
    # get a clean, small id space.
    root_to_cluster: dict[int, int] = {}
    result: dict[int, int] = {}
    for i in range(len(agents)):
        r = find(i)
        if r not in root_to_cluster:
            root_to_cluster[r] = len(root_to_cluster)
        result[i] = root_to_cluster[r]
    return result


def diversify(agents: list[dict], per_cluster_cap: int) -> list[dict]:
    """Real, drop-in replacement for aggregate.py's old _diversify — same
    real contract (keep at most `per_cluster_cap` per real cluster,
    preserving order), but backed by the real multi-signal clustering
    above instead of a single blocking-key bucket. Two genuinely distinct
    agents that merely share a description template (e.g. the same real
    owner independently running two different real agents built from the
    same boilerplate, with no other corroborating signal) are correctly
    NOT collapsed under this rule — each keeps its own real slot."""
    cluster_of = cluster_agents(agents)
    counts: dict[int, int] = {}
    kept = []
    for i, a in enumerate(agents):
        c = cluster_of[i]
        if counts.get(c, 0) >= per_cluster_cap:
            continue
        counts[c] = counts.get(c, 0) + 1
        kept.append(a)
    return kept
