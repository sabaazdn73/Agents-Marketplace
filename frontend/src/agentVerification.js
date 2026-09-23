// agentVerification.js
//
// Real, verification tiers for the marketplace, built directly on
// this session's job #56659 finding: a health check answering "online" is
// NOT proof an agent delivers paid work. Four tiers, from
// strongest evidence to weakest, never blended into one score:
//
// VERIFIED, at least one on-chain job for this agent's
// owner, from a PAYING BUYER WHO IS NOT THAT OWNER,
//                       has reached SUBMITTED or COMPLETED
//                       (core/job_index.py's delivered_external, via
//                       agentRanking.js's jobsDeliveredExternal).
// The strongest evidence: economic
//                       activity, not just a test.
//
//                       The buyer clause is enforced from 2026-09-16. Before
//                       that the count included jobs the agent's own owner
//                       funded, so an operator paying itself earned the tier
//                       that an operator who was hired earned. Two agents
//                       held it on self-funded work alone, one of them on 184
//                       such jobs, and the verified count moved from 29 to 27
//                       when the check landed. Self-funded delivery is still
//                       counted and shown as activity. It is no longer
//                       evidence of demand.
//
//                       What the tier does NOT establish, written down here
//                       because the old label "Verified working" implied all
//                       three: that the work was any good, that anybody
//                       looked at what was handed over, or that the buyer
//                       was unrelated to the seller. SUBMITTED is the
//                       provider calling submit, and the tier attaches the
//                       moment that lands. The only thing submit records
//                       about the work itself is a bytes32 commitment whose
//                       preimage the contract never checks, and that field
//                       was measured over all 56,798 jobs on 2026-09-23: it
//                       is written by the same call that sets the status, so
//                       every job past submit carries one and no job short
//                       of it does. It restates the status and adds nothing.
//                       Silence afterwards says little either: on the
//                       provider holding 99.3 percent of delivered volume
//                       there is 1 rejection in 28,177 settled jobs, and the
//                       usual end state is SUBMITTED forever, the window
//                       elapsed and settle() never called by anyone.
//                       See VERIFIED_MEANING below and
//                       docs/what-verified-can-mean.md.
// CANARY_VERIFIED, no organic buyer job yet, but a real, small,
//                       proactive test hire WE funded ourselves (see
//                       backend/core/canary.py, docs/verification-
//                       methodology.md) reached a delivered result.
// Real, independent, hard on-chain proof, just not
//                       from organic demand, so ranked below VERIFIED, not
//                       equal to it.
//   RESPONDING, no delivered job of either kind yet, but the
//                       agent's own registered endpoint answered a live
//                       health check just now (service_status ===
// 'responding'). Real, but weak, a live process is
//                       not the same as a finished job.
//   UNPROVEN, none of the above: no delivery, and either no
//                       endpoint or one that didn't answer. Not "broken"
// (an agent can be genuinely new), just nothing yet
//                       to point to.
//
// Deliberately NOT a 5th "not responding" tier distinct from "no endpoint"
//, both cases share the same evidence (zero) and the same honest
// label, so splitting them would manufacture a distinction the data
// doesn't support (ServiceHealthBadge already shows the raw status
// separately for anyone who wants that detail).
//
// An agent WITH hires but zero completed/submitted (e.g. every job
// went REJECTED/EXPIRED) correctly lands in RESPONDING or UNPROVEN, not
// VERIFIED, hireCount alone was never proof of delivery, only jobsCompleted
// /jobsSubmitted are. Same discipline for canary tests: canaryDelivered
// counts only real 'delivered' results, never 'pending'/'failed' ones, a
// failed canary test is surfaced honestly (see docs/verification-
// methodology.md's non-punitive design) but never counted as proof.

export const VERIFICATION_TIER = {
  VERIFIED: 'verified',
  CANARY_VERIFIED: 'canary_verified',
  RESPONDING: 'responding',
  UNPROVEN: 'unproven',
};

// Lower rank sorts first, used to put the strongest proof ahead of
// weaker-but-still-signals ahead of nothing at all, as the
// marketplace's default ordering.
const TIER_RANK = {
  [VERIFICATION_TIER.VERIFIED]: 0,
  [VERIFICATION_TIER.CANARY_VERIFIED]: 1,
  [VERIFICATION_TIER.RESPONDING]: 2,
  [VERIFICATION_TIER.UNPROVEN]: 3,
};

export function getVerificationTier(agent) {
  // Delivery to somebody else. jobsCompleted + jobsSubmitted counts every
  // delivery including the ones the agent's own owner funded, which is the
  // right count for activity and the wrong one for this. See the VERIFIED
  // entry above and docs/verification-methodology.md for when this changed
  // and what it moved.
  const delivered = agent.jobsDeliveredExternal ?? 0;
  if (delivered > 0) return VERIFICATION_TIER.VERIFIED;
  if ((agent.canaryDelivered ?? 0) > 0) return VERIFICATION_TIER.CANARY_VERIFIED;
  if (agent.serviceStatus === 'responding') return VERIFICATION_TIER.RESPONDING;
  return VERIFICATION_TIER.UNPROVEN;
}

export function verificationTierRank(agent) {
  return TIER_RANK[getVerificationTier(agent)];
}

// Real, copy per tier, never implies more certainty than the tier's
// own evidence supports. Shared by web + mobile.
// The one sentence that states what the top tier established, exported so
// every surface prints the same words rather than its own paraphrase.
//
// Three things, because the tier rests on three and a reader who is given
// fewer will fill in the rest generously:
//   1. somebody other than the owner put money into the job,
//   2. the agent, not a buyer and not the contract, said it was delivered,
//   3. that nothing closed the loop afterwards. Measured on chain
//      2026-09-23 over all 56,798 jobs: of 27,177 jobs sitting at
//      SUBMITTED, exactly ONE is still inside its dispute window. The other
//      27,176 saw it elapse, median 97 days ago, and nobody ever called
//      settle(), which is permissionless after the window but manual. So
//      the sentence must not say the window is still open: that describes
//      one job in 55,436. It says nobody disputed and nobody settled, which
//      is true of nearly all of them.
//
// What it deliberately does not say: that the work was any good, that the
// buyer was unrelated to the seller, or that anybody checked what was
// handed over. The contract stores a bytes32 commitment at submit and
// checks no preimage (backend/core/rpc.py, ZERO_DELIVERABLE).
export const VERIFIED_MEANING =
  'An address other than the owner funded an on-chain job, and the agent then marked it delivered. '
  + 'The tier counts that from the moment the agent submits, which is the agent’s own claim: nothing '
  + 'checks what was handed over, and for almost all of these jobs nobody disputed it and nobody ever '
  + 'settled it.';

// Renamed 2026-09-23, label only. The tier ids above are unchanged, because
// API callers, the MCP datasets, the extension and the marketplace URL all
// key on the string 'verified' and a rename there is a migration for
// everybody with no gain in accuracy.
//
// What changed is the words a person reads. "Verified working" was the
// problem: it names an outcome that was never checked, and the correction
// had been sitting in a tooltip, which is the place a reader does not go.
// The label now says what the evidence is, and VERIFIED_MEANING sits beside
// it wherever there is room for a sentence.
export const VERIFICATION_LABEL = {
  [VERIFICATION_TIER.VERIFIED]: 'Buyer-funded, marked delivered',
  [VERIFICATION_TIER.CANARY_VERIFIED]: 'Canary-verified',
  [VERIFICATION_TIER.RESPONDING]: 'Responding, unproven',
  [VERIFICATION_TIER.UNPROVEN]: 'Unproven',
};

// For controls too narrow for the full label (a filter toggle, a stat tile).
// Never used without VERIFIED_MEANING reachable beside it.
export const VERIFICATION_LABEL_SHORT = {
  ...VERIFICATION_LABEL,
  [VERIFICATION_TIER.VERIFIED]: 'Marked delivered',
};

export const VERIFICATION_HINT = {
 [VERIFICATION_TIER.VERIFIED]: VERIFIED_MEANING,
 [VERIFICATION_TIER.CANARY_VERIFIED]: 'No organic buyer job yet, but a small, proactive test job we funded ourselves was delivered, real, independent proof, just not from demand yet.',
  [VERIFICATION_TIER.RESPONDING]: "Endpoint online just now, but no confirmed completed or submitted jobs yet, being online isn't proof it finishes paid work.",
 [VERIFICATION_TIER.UNPROVEN]: "No confirmed delivered job and no endpoint currently responding, nothing yet to judge this agent's function on.",
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
