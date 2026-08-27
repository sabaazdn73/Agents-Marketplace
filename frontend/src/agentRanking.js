// agentRanking.js
//
// Real ranking logic for the marketplace's "Most hired" / "Highest success
// rate" sort options — built entirely on real, already-computed on-chain
// data (agent_performance.py, via useAgentPerformanceBulk.js). No LLM
// guessing, no fabricated composite score: these two sorts each rank by
// exactly one real number, honestly labeled. Shared by web and mobile so
// the tiering logic can't silently drift between them.
//
// Real handling for agents with zero or very few jobs (most agents right
// now — per this session's own earlier findings, the large majority have
// no real hires yet): a plain numeric sort would silently mix a genuine
// 0-hire agent in among real track records wherever a tie lands, which
// both crowds out the few agents that DO have a real history AND makes a
// brand-new agent look ranked/judged on nothing. Real fix: TWO tiers, not
// one sort — every agent with real history (by the chosen metric) ranked
// first among themselves, every agent with none listed after, in the
// marketplace's own default order (real score, the same baseline ranking
// used everywhere else) — clearly distinguished by AgentCard/table row
// (see hasRealHistory below), never silently interleaved.
//
// hireCount vs winRate treat "no real history" differently, both for real
// reasons: 0 hires genuinely means nothing has happened yet, so hireCount
// = 0 IS the no-history case. But for winRate, 0% (every resolved job
// failed) is real, meaningful, bad-but-real history — genuinely different
// from null (no job has resolved either way yet). Collapsing those two
// would hide a real bad track record inside "no data yet", the opposite
// of honest.

export function agentHasRealHistory(agent, key) {
  if (key === 'winRate') return agent.winRate != null;
  return (agent.hireCount ?? 0) > 0;
}

/** Real tiered comparator for Array.prototype.sort — every agent WITH real
 * history for `key` sorts first (best real number first); within that,
 * winRate breaks ties by hireCount (a 100% record on 1 job doesn't
 * outrank a 96% record on 50 jobs just because they'd otherwise tie on
 * the rounded real percentage). Every agent with no real history for this
 * metric sorts after, by the marketplace's own default order (real
 * score) — never scored on a metric it has no real data for. */
export function performanceComparator(key) {
  return (a, b) => {
    const aHas = agentHasRealHistory(a, key);
    const bHas = agentHasRealHistory(b, key);
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas) {
      const diff = (b[key] ?? 0) - (a[key] ?? 0);
      if (diff !== 0) return diff;
      if (key === 'winRate') {
        const hireDiff = (b.hireCount ?? 0) - (a.hireCount ?? 0);
        if (hireDiff !== 0) return hireDiff;
      }
    }
    return (b.totalScore ?? -Infinity) - (a.totalScore ?? -Infinity);
  };
}

/** Merges real bulk performance data (useAgentPerformanceBulk's byOwner)
 * onto a mapped agent list — hireCount defaults to 0 (a real, honest
 * "hasn't been hired" state, matching agent_performance.py's own
 * zero-history response), winRate stays null when nothing has resolved
 * yet (see the module docstring for why that's not the same as 0).
 *
 * jobsCompleted/jobsSubmitted are the raw real counts (not the win_rate
 * ratio) — added 2026-08-26 as the real basis for agentVerification.js's
 * "Verified working" tier, which needs to know whether a real
 * SUBMITTED/COMPLETED delivery has ever happened, not just a rate. An
 * agent with hires but zero of either (e.g. all REJECTED/EXPIRED) must
 * NOT count as verified — winRate alone can't distinguish that case from
 * "no real history yet" the way these raw counts can. */
export function withPerformance(agents, byOwner) {
  if (!byOwner) return agents.map((a) => ({ ...a, hireCount: 0, winRate: null, jobsCompleted: 0, jobsSubmitted: 0 }));
  return agents.map((a) => {
    const p = byOwner[(a.ownerAddress || '').toLowerCase()];
    return {
      ...a,
      hireCount: p?.hire_count ?? 0,
      winRate: p?.win_rate ?? null,
      jobsCompleted: p?.completed ?? 0,
      jobsSubmitted: p?.submitted ?? 0,
    };
  });
}

/** Merges real bulk canary-test data (useCanaryStatus's byOwner — see
 * backend/core/canary.py) onto a mapped agent list — the real basis for
 * agentVerification.js's "Canary-verified" tier. canaryDelivered counts
 * only real, actually-'delivered' canary tests, never 'pending'/'failed'
 * ones (see canary.py's own non-punitive-failure design). Separate pass
 * from withPerformance so a page that doesn't need canary data (nothing
 * uses it yet) doesn't have to thread a second byOwner map through. */
export function withCanaryStatus(agents, canaryByOwner) {
  if (!canaryByOwner) return agents.map((a) => ({ ...a, canaryDelivered: 0, canaryLastTestedAt: null }));
  return agents.map((a) => {
    const c = canaryByOwner[(a.ownerAddress || '').toLowerCase()];
    return {
      ...a,
      canaryDelivered: c?.delivered ?? 0,
      canaryTests: c?.tests ?? 0,
      canaryFailed: c?.failed ?? 0,
      canaryLastTestedAt: c?.last_tested_at || null,
    };
  });
}
