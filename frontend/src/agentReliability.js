// agentReliability.js
//
// A real, data-driven "reliability hint" for an agent's real ERC-8183 job
// history — purely computed from the same data GET /api/agents/performance
// already returns (agent_performance.py's real on-chain scan). No LLM
// guessing, no fabricated risk score: just the real EXPIRED/settled ratio,
// stated plainly so the user can judge for themselves. Shared by web and
// mobile so the threshold logic can't silently drift between them.
//
// Real thresholds, and why:
//
// MIN_SETTLED_FOR_HINT = 3 — a ratio needs a few real data points before it
// means anything. 1 of 1 expired is a real outcome but not a real PATTERN —
// it could be one disclosed, one-off infra blip (this project's own Task 3
// explainer agent hit exactly that this session: real RPC/hosting bugs on
// the free tier, nothing wrong with the agent's own logic). 3 settled jobs
// is the smallest sample where "most of them failed" starts to say
// something real about the agent, not just bad luck once.
//
// EXPIRED_RATIO_THRESHOLD = 0.4 (40%) — meaningfully worse than occasional
// real-world hiccups. Below this, ordinary unreliability; at or above it,
// a real, disclosed pattern worth surfacing plainly rather than staying
// silent about.
//
// Real, honest caveat carried over from this session's own investigation:
// a job's on-chain status only flips to EXPIRED once its raw expiredAt
// timestamp passes (not the moment it practically became undeliverable) —
// so this hint can lag a real failure by as much as the real dispute
// window (currently ~7 days on this deployment). It's a real, disclosed
// signal, just not an instant one.

export const MIN_SETTLED_FOR_HINT = 3;
export const EXPIRED_RATIO_THRESHOLD = 0.4;

/** Returns a real reliability hint object ({ expired, settled, message }),
 * or null when there isn't enough real settled history to say anything
 * meaningful, or the real ratio doesn't clear the threshold. `perf` is the
 * exact object GET /api/agents/performance returns. */
export function getReliabilityHint(perf) {
  if (!perf || !perf.hired) return null;
  const expired = perf.expired || 0;
  const settled = perf.settled ?? ((perf.completed || 0) + (perf.rejected || 0) + expired);
  if (settled < MIN_SETTLED_FOR_HINT) return null;
  if (expired / settled < EXPIRED_RATIO_THRESHOLD) return null;
  return {
    expired,
    settled,
    message: `This agent has a history of not delivering — ${expired} of ${settled} recent settled jobs expired without a result.`,
  };
}
