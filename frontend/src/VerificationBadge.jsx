// VerificationBadge.jsx
//
// Real, per-agent verification-tier badge, shared VERBATIM by web
// and mobile. Built directly on the job #56659 finding (2026-08-26): an
// agent answering a health check is not proof it delivers paid work.
// See agentVerification.js for the tier logic and the reasoning behind
// each tier's copy, this file is display-only, no logic of its own.
//
// Visual weight is deliberately unequal: VERIFIED gets a solid, confident
// badge; RESPONDING gets a but visibly lighter one (openly hedged
// copy, not just a paler color); UNPROVEN renders nothing on the card
// itself (same "don't imply a confident negative" principle
// ServiceHealthBadge already uses for its own unknown/no-endpoint states),
// its absence of a badge IS the signal, and the explainer below
// says so explicitly rather than leaving it unstated.

import React from 'react';
import { ShieldCheck, ShieldHalf, Radio } from 'lucide-react';
import { VERIFICATION_TIER, getVerificationTier, VERIFICATION_LABEL, VERIFICATION_HINT, VERIFIED_MEANING } from './agentVerification';

export default function VerificationBadge({ agent, size = 'sm', className = '' }) {
  const tier = getVerificationTier(agent);
  const sizePx = size === 'md' ? 13 : 11;
  const textCls = size === 'md' ? 'text-[11px]' : 'text-[10px]';

  if (tier === VERIFICATION_TIER.VERIFIED) {
    return (
      <span
        title={VERIFICATION_HINT[tier]}
        className={`inline-flex items-center gap-1 ${textCls} font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 ${className}`}
      >
        <ShieldCheck size={sizePx} /> {VERIFICATION_LABEL[tier]}
      </span>
    );
  }
  if (tier === VERIFICATION_TIER.CANARY_VERIFIED) {
    return (
      <span
        title={VERIFICATION_HINT[tier]}
        className={`inline-flex items-center gap-1 ${textCls} font-semibold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-400 ${className}`}
      >
        <ShieldHalf size={sizePx} /> {VERIFICATION_LABEL[tier]}
      </span>
    );
  }
  if (tier === VERIFICATION_TIER.RESPONDING) {
    return (
      <span
        title={VERIFICATION_HINT[tier]}
        className={`inline-flex items-center gap-1 ${textCls} font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 ${className}`}
      >
        <Radio size={sizePx} /> {VERIFICATION_LABEL[tier]}
      </span>
    );
  }
 // UNPROVEN and UNCHECKED both show no badge, for the same reason and with
 // one difference worth keeping in mind. UNPROVEN means we checked and got
 // nothing, UNCHECKED means we never checked; neither is evidence the agent is
 // broken, and a badge here would read as an accusation in both cases. The
 // distinction is carried by the tier divider and the explainer rather than by
 // a mark on the row, because a row is not where a reader can absorb it.
 return null;
}

/** tier-section header, dropped into the grid/table wherever the
 * tier changes across an already tier-sorted list (see
 * withVerificationTierFirst in agentVerification.js). Text states the real
 * count so it reads as a tally, not decoration. */
export function VerificationTierDivider({ tier, count, className = '' }) {
  return (
    <div className={`flex items-center gap-3 ${className}`} title={VERIFICATION_HINT[tier]}>
      {/* No whitespace-nowrap. Measured rather than assumed: at 11px with
          tracking-wider (0.05em), "BUYER-FUNDED, MARKED DELIVERED (32)" is
          248px, 261px with a four-digit count, against 140px for the label it
          replaced. Usable width inside normal padding at 390px is roughly 326
          to 334px, and the rule beside the label is flex-1 and shrinks to
          zero, so 248px does still fit on one line. The label nearly doubling
          is the reason to look; it is not a reason to claim an overflow that
          was not measured.

          It comes off anyway, because of what the failure would look like if
          the fit were ever lost: the wrapper is overflow-hidden, so a label
          too wide for the row is silently clipped rather than scrollable.
          Wrapping converts that into a second line, which is visible and
          harmless. The table view is reached by a user toggle rather than a
          breakpoint, so this row can be on screen at 390px. */}
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {VERIFICATION_LABEL[tier]} ({count})
      </span>
      <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
    </div>
  );
}

/** One-time, page-level explainer, same role/placement as
 * ServiceHealthExplainer, kept brief and separate rather than merged into
 * it since these are two distinct signals. */
export function VerificationExplainer({ className = '' }) {
  return (
    <div className={`flex items-start gap-2 text-[11px] text-indigo-800 dark:text-indigo-300 p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/20 ${className}`}>
      <ShieldCheck size={13} className="shrink-0 mt-0.5 text-indigo-600 dark:text-indigo-400" />
      <span>
        <strong>"Buyer-funded, marked delivered"</strong> is the top tier. {VERIFIED_MEANING} Jobs an operator
        funds for its own agent still count as activity and never as proof of demand. <strong>"Canary-verified"</strong> means no
        buyer job yet, but a small test job we funded ourselves was delivered. That proves delivery works,
        though the demand was ours. <strong>"Responding, unproven"</strong> means its endpoint answered just
        now but no delivery has been confirmed. Agents with none of these aren't marked broken. There is
        simply nothing yet to judge them on.
      </span>
    </div>
  );
}
