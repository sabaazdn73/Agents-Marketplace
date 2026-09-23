// agentVerification.js
//
// Real, verification tiers for the marketplace, built directly on
// this session's job #56659 finding: a health check answering "online" is
// NOT proof an agent delivers paid work. Five tiers, from
// strongest evidence to weakest, never blended into one score. The last two
// separate what we looked at from what we never reached, which is the whole
// point of having five rather than four:
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
//   UNPROVEN, no delivery, and we PROBED the agent and found
//                       nothing to point to: its registered endpoint did not
//                       answer (service_status === 'not_responding'), or it
//                       registered no endpoint at all ('no_endpoint'). A
//                       finding about the agent. Not "broken", an agent can
//                       be new or half set up, but we did look.
//   UNCHECKED, no delivery and NO HEALTH CHECK ON RECORD. Either
//                       no stored status at all, or 'unknown', which is this
//                       pipeline failing to resolve the agent's metadata
//                       rather than the agent failing to answer. A statement
//                       about our coverage, never evidence about the agent.
//
// WHY UNCHECKED EXISTS, ADDED 2026-09-23
// This comment used to say the opposite, and the reasoning is preserved here
// because it was wrong in an instructive way. It read: deliberately NOT a 5th
// tier distinct from "no endpoint", because both cases share the same evidence
// (zero) and the same label, so splitting them would manufacture a distinction
// the data doesn't support.
//
// The case that dominates shares no evidence at all, which is a different
// thing from zero evidence. Measured on the served store that day: of the
// 14,340 agents in UNPROVEN, 14,165 had never been health-checked, against 4
// whose endpoint did not answer and 2 with nothing registered. So the tier's
// own definition above, "no endpoint or one that didn't answer", was untrue of
// 98.8% of the agents it described. Store-wide it was 39,245 never checked of
// 39,999 held.
//
// It was not a harmless imprecision. Agents from that bucket were drawn at
// random and probed outside this pipeline, reading tokenURI from the identity
// registry and resolving metadata through a gateway that was answering rather
// than through ipfs.io, which was returning 429. Two samples, as a funnel
// rather than a ratio, because the losses before the probe are the part a bare
// ratio hides:
//
//              drawn  tokenURI read  resolved  probed  answered
//   seed 11      120            120       120     120       120
//   seed 77      400            400       397     397       397
//   total        520            520       517     517       517
//
// So: 517 of 520 drawn, the 3 lost to HTTP errors from an agent's own metadata
// host before any probe happened, and zero agents found not responding.
//
// Worth stating because it looks inconsistent with a separate sample of the
// 181 agents stored at 'unknown', where 88 could not be resolved at all. That
// is composition rather than method. This sample is drawn from the
// never-checked population, which is 396 of 400 and 117 of 120 HTTP tokenURIs,
// so an IPFS gateway is barely in its path; the 'unknown' population is by
// construction the IPFS-dependent slice, which is exactly where a refusing
// gateway does its damage. Neither sample contained a demonstrably down agent.
//
// The tier was reporting our own coverage as though it were a property of the
// agents, and it moved whenever a shared public IPFS gateway rate-limited us.
// backend/core/agent_health.py had modelled this correctly all along and says
// in its own docstring that conflating 'unknown' with 'not_responding' would be
// a false negative against agents that are probably fine; the distinction was
// computed, stored, and then discarded at the one place a count is published.
//
// backend/core/monitors/liveness_probe.py is this probe, committed, so the
// next version of this figure comes with a funnel and a control rather than
// from somebody's scratch directory.
//
// This is the same rule the rest of the project already follows: an absence
// says which absence it is (core/interaction_summary.py separates no_endpoint,
// not_responding and unchecked and attaches a basis; core/job_index.py refuses
// to collapse a missing deliverable into the zero word).
//
// ServiceHealthBadge still shows the raw status for anyone who wants the
// underlying state, and that remains the place for finer detail than a tier.
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
  // Added 2026-09-23. Additive: every id above kept its spelling and its
  // meaning, so existing filters, the marketplace URL and the MCP datasets are
  // unaffected. UNPROVEN is simply smaller now, because the agents nobody ever
  // probed moved out of it and into their own name.
  UNCHECKED: 'unchecked',
};

// Lower rank sorts first, used to put the strongest proof ahead of
// weaker-but-still-signals ahead of nothing at all, as the
// marketplace's default ordering.
const TIER_RANK = {
  [VERIFICATION_TIER.VERIFIED]: 0,
  [VERIFICATION_TIER.CANARY_VERIFIED]: 1,
  [VERIFICATION_TIER.RESPONDING]: 2,
  [VERIFICATION_TIER.UNPROVEN]: 3,
  // Last, below UNPROVEN. An agent we probed and found nothing on is a weaker
  // prospect than one we never got to, but it is a FINDING, and sorting an
  // admission of no coverage above it would present our own gap as evidence.
  [VERIFICATION_TIER.UNCHECKED]: 4,
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
  // Probed and found nothing, versus never established. See the UNCHECKED
  // block at the top of this file for what merging these two cost.
  if (agent.serviceStatus === 'not_responding'
      || agent.serviceStatus === 'no_endpoint') return VERIFICATION_TIER.UNPROVEN;
  return VERIFICATION_TIER.UNCHECKED;
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
  [VERIFICATION_TIER.UNPROVEN]: 'Checked, no answer',
  [VERIFICATION_TIER.UNCHECKED]: 'Not checked yet',
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
 [VERIFICATION_TIER.UNPROVEN]: "We checked this agent's registered endpoint and got nothing back, or it registered no endpoint at all. No confirmed delivered job either. This is something we looked at.",
  [VERIFICATION_TIER.UNCHECKED]: "We have not checked this agent yet, so we are not saying anything about it. Most agents here are in this state: the health pass reaches a few hundred a day, and sometimes resolving an agent's metadata fails on our side rather than theirs. It is not a mark against the agent.",
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
