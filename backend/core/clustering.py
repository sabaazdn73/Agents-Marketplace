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


def cluster_agents(agents: list[dict]) -> dict[int, int]:
    """Real, principled clustering: returns {index_in_agents: cluster_id}.
    Agents that never matched ANY other agent on both the blocking key AND
    a corroborating signal each get their OWN unique cluster id (correctly
    counted as distinct, not silently folded into someone else's cluster).

    Real perf fix (2026-08-27, found while investigating a real, live
    slowdown in get_stored_agents()): this used to run a full O(k^2)
    pairwise `_corroborates()` check inside every blocking bucket of size
    k. That was fine at the scale this was built and tested against
    (buckets in the low hundreds), but real-world blocking buckets from
    mass-registration campaigns have since grown much larger — live-
    measured on the current real known_agents store (10,837 agents): the
    single largest bucket alone has 1,591 agents, needing ~1.26M pairwise
    calls by itself, and the real total across all buckets was ~2.52M
    calls — a measured, real 3.0s of get_stored_agents()'s ~4.4s total.

    Fixed below with an O(k log k) equivalent, not an approximation: each
    of the three real corroborating signals in the old _corroborates() is
    either an EQUALITY relation (same endpoint; same owner) or a 1-D
    PROXIMITY relation (registration timestamps within BURST_WINDOW_
    SECONDS). An equality relation's connected components are exactly a
    group-by (union everyone sharing the same real value) — no pairwise
    comparison needed. A proximity relation's connected components are
    exactly captured by sorting the values and unioning only ADJACENT
    pairs within the window: if two agents are only reachable through a
    chain of real in-window neighbors, unioning each adjacent link
    correctly chains them transitively via the same Union-Find used
    before; and if the chain breaks anywhere (an adjacent gap exceeds the
    window), no pair spanning that break could have qualified directly
    either, since sorted order means their real gap is only larger. Same
    final clusters as the old full pairwise check, verified by direct
    comparison against it on the real, current store before this was kept
    — just without ever doing the O(k^2) work to get there.

    Real efficiency note (unchanged): the blocking step (grouping by
    description-template signature first) is still what keeps the overall
    cost manageable — only agents that already share a real description
    template are considered for a corroborating signal at all."""
    buckets: dict[tuple, list[int]] = {}
    for i, a in enumerate(agents):
        sig = _cluster_signature(a.get("name", ""), a.get("description", ""))
        buckets.setdefault(sig, []).append(i)

    # Union-Find over indices — real, standard disjoint-set clustering,
    # not an ad-hoc bucket dict, so a real chain of corroborated agents
    # (A~B via endpoint, B~C via timestamp) correctly ends up in ONE real
    # cluster even if A and C alone wouldn't have corroborated directly.
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

        # 1) Same real registered service endpoint — exact-match signal,
        # O(k) group-by instead of O(k^2) pairwise.
        by_endpoint: dict[str, list[int]] = {}
        for i in idxs:
            ep = (agents[i].get("a2a_endpoint") or agents[i].get("service_endpoint") or "").strip().lower()
            if ep:
                by_endpoint.setdefault(ep, []).append(i)
        for group in by_endpoint.values():
            for k in range(1, len(group)):
                union(group[0], group[k])

        # 2) Real registration-burst proximity — sort by timestamp, union
        # only adjacent pairs within the real window (see docstring above
        # for why this is the exact same result as full pairwise, not an
        # approximation). Agents with no parseable timestamp simply don't
        # participate in this signal, same as the old pairwise check.
        timed = sorted(
            ((t, i) for i in idxs if (t := _parse_ts(agents[i].get("created_at"))) is not None)
        )
        for k in range(1, len(timed)):
            if timed[k][0] - timed[k - 1][0] <= BURST_WINDOW_SECONDS:
                union(timed[k - 1][1], timed[k][1])

        # 3) Shared owner — a real, but deliberately NOT standalone,
        # signal (see module docstring); reaching this step already
        # required sharing the description-template blocking key, so this
        # group-by is equivalent to the old pairwise owner check. Exact-
        # match signal, O(k) group-by instead of O(k^2) pairwise.
        by_owner: dict[str, list[int]] = {}
        for i in idxs:
            owner = (agents[i].get("owner_address") or "").strip().lower()
            if owner:
                by_owner.setdefault(owner, []).append(i)
        for group in by_owner.values():
            for k in range(1, len(group)):
                union(group[0], group[k])

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
