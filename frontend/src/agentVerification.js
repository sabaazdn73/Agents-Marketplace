// agentVerification.js
//
// Real, honest verification tiers for the marketplace — built directly on
// this session's job #56659 finding: a health check answering "online" is
// NOT proof an agent actually delivers paid work. Three tiers, from
// strongest real evidence to weakest, never blended into one score:
//
//   VERIFIED    — at least one real on-chain job for this agent's owner has
//                  reached SUBMITTED or COMPLETED (agent_performance.py,
//                  via agentRanking.js's jobsCompleted/jobsSubmitted). Hard
//                  proof: something real was delivered.
//   RESPONDING  — no real completed/submitted job yet, but the agent's own
//                  registered endpoint answered a live health check just
//                  now (service_status === 'responding'). Real, but weak —
//                  a live process is not the same as a finished job. Must
//                  be labeled honestly as unproven, not hidden or implied
//                  equivalent to VERIFIED.
//   UNPROVEN    — neither: no real delivery, and either no endpoint or one
//                  that didn't answer. Weakest tier, not "broken" (an
//                  agent can be genuinely new), just nothing to point to
//                  yet.
//
// Deliberately NOT a 4th "not responding" tier distinct from "no endpoint"
// — both cases share the same real evidence (zero) and the same honest
// label, so splitting them would manufacture a distinction the data
// doesn't support (ServiceHealthBadge already shows the raw status
// separately for anyone who wants that detail).
//
// An agent WITH hires but zero real completed/submitted (e.g. every job
// went REJECTED/EXPIRED) correctly lands in RESPONDING or UNPROVEN, not
// VERIFIED — hireCount alone was never proof of delivery, only jobsCompleted
// /jobsSubmitted are.

export const VERIFICATION_TIER = {
  VERIFIED: 'verified',
  RESPONDING: 'responding',
  UNPROVEN: 'unproven',
};

// Lower rank sorts first — used to put real proof ahead of a live-but-unproven
// endpoint ahead of nothing at all, as the marketplace's default ordering.
const TIER_RANK = {
  [VERIFICATION_TIER.VERIFIED]: 0,
  [VERIFICATION_TIER.RESPONDING]: 1,
  [VERIFICATION_TIER.UNPROVEN]: 2,
};

export function getVerificationTier(agent) {
  const delivered = (agent.jobsCompleted ?? 0) + (agent.jobsSubmitted ?? 0);
  if (delivered > 0) return VERIFICATION_TIER.VERIFIED;
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
  [VERIFICATION_TIER.RESPONDING]: 'Responding, unproven',
  [VERIFICATION_TIER.UNPROVEN]: 'Unproven',
};

export const VERIFICATION_HINT = {
  [VERIFICATION_TIER.VERIFIED]: 'Has at least one real, on-chain-confirmed delivered job — not just a health check.',
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
