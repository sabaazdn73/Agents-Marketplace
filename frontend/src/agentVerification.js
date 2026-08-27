// agentVerification.js
//
// Real, honest verification tiers for the marketplace — built directly on
// this session's job #56659 finding: a health check answering "online" is
// NOT proof an agent actually delivers paid work. Four tiers, from
// strongest real evidence to weakest, never blended into one score:
//
//   VERIFIED         — at least one real on-chain job for this agent's
//                       owner, from a REAL PAYING BUYER, has reached
//                       SUBMITTED or COMPLETED (agent_performance.py, via
//                       agentRanking.js's jobsCompleted/jobsSubmitted).
//                       The strongest real evidence: genuine economic
//                       activity, not just a test.
//   CANARY_VERIFIED   — no organic buyer job yet, but a real, small,
//                       proactive test hire WE funded ourselves (see
//                       backend/core/canary.py, docs/verification-
//                       methodology.md) reached a real delivered result.
//                       Real, independent, hard on-chain proof — just not
//                       from organic demand, so ranked below VERIFIED, not
//                       equal to it.
//   RESPONDING        — no real delivered job of either kind yet, but the
//                       agent's own registered endpoint answered a live
//                       health check just now (service_status ===
//                       'responding'). Real, but weak — a live process is
//                       not the same as a finished job.
//   UNPROVEN          — none of the above: no real delivery, and either no
//                       endpoint or one that didn't answer. Not "broken"
//                       (an agent can be genuinely new), just nothing yet
//                       to point to.
//
// Deliberately NOT a 5th "not responding" tier distinct from "no endpoint"
// — both cases share the same real evidence (zero) and the same honest
// label, so splitting them would manufacture a distinction the data
// doesn't support (ServiceHealthBadge already shows the raw status
// separately for anyone who wants that detail).
//
// An agent WITH hires but zero real completed/submitted (e.g. every job
// went REJECTED/EXPIRED) correctly lands in RESPONDING or UNPROVEN, not
// VERIFIED — hireCount alone was never proof of delivery, only jobsCompleted
// /jobsSubmitted are. Same discipline for canary tests: canaryDelivered
// counts only real 'delivered' results, never 'pending'/'failed' ones — a
// failed canary test is surfaced honestly (see docs/verification-
// methodology.md's non-punitive design) but never counted as proof.

export const VERIFICATION_TIER = {
  VERIFIED: 'verified',
  CANARY_VERIFIED: 'canary_verified',
  RESPONDING: 'responding',
  UNPROVEN: 'unproven',
};

// Lower rank sorts first — used to put the strongest real proof ahead of
// weaker-but-still-real signals ahead of nothing at all, as the
// marketplace's default ordering.
const TIER_RANK = {
  [VERIFICATION_TIER.VERIFIED]: 0,
  [VERIFICATION_TIER.CANARY_VERIFIED]: 1,
  [VERIFICATION_TIER.RESPONDING]: 2,
  [VERIFICATION_TIER.UNPROVEN]: 3,
};

export function getVerificationTier(agent) {
  const delivered = (agent.jobsCompleted ?? 0) + (agent.jobsSubmitted ?? 0);
  if (delivered > 0) return VERIFICATION_TIER.VERIFIED;
  if ((agent.canaryDelivered ?? 0) > 0) return VERIFICATION_TIER.CANARY_VERIFIED;
  if (agent.serviceStatus === 'responding') return VERIFICATION_TIER.RESPONDING;
  return VERIFICATION_TIER.UNPROVEN;
}

export function verificationTierRank(agent) {
  return TIER_RANK[getVerificationTier(agent)];
}

// Real, honest copy per tier — never implies more certainty than the tier's
// own evidence supports. Shared by web + mobile.
export const VERIFICATION_LABEL = {
  [VERIFICATION_TIER.VERIFIED]: 'Verified working',
  [VERIFICATION_TIER.CANARY_VERIFIED]: 'Canary-verified',
  [VERIFICATION_TIER.RESPONDING]: 'Responding, unproven',
  [VERIFICATION_TIER.UNPROVEN]: 'Unproven',
};

export const VERIFICATION_HINT = {
  [VERIFICATION_TIER.VERIFIED]: 'Has at least one real, on-chain-confirmed delivered job from a real buyer — not just a health check.',
  [VERIFICATION_TIER.CANARY_VERIFIED]: 'No organic buyer job yet, but a small, real proactive test job we funded ourselves was actually delivered — real, independent proof, just not from real demand yet.',
  [VERIFICATION_TIER.RESPONDING]: "Endpoint online just now, but no confirmed completed or submitted jobs yet — being online isn't proof it finishes paid work.",
  [VERIFICATION_TIER.UNPROVEN]: "No confirmed delivered job and no endpoint currently responding — nothing yet to judge this agent's real function on.",
};

/** Tier-first comparator: VERIFIED before RESPONDING before UNPROVEN, ties
 * broken by the given secondary comparator (e.g. performanceComparator or
 * the marketplace's own default numeric sort). Wrapping rather than
 * replacing an existing comparator so this composes with every sort option,
 * not just one. */
export function withVerificationTierFirst(secondaryComparator) {
  return (a, b) => {
    const diff = verificationTierRank(a) - verificationTierRank(b);
    if (diff !== 0) return diff;
    return secondaryComparator(a, b);
  };
}
