// DeliveryRecord.jsx
//
// What happened to the jobs this provider was actually paid for.
//
// The number this exists for: across the 13 agents in this marketplace that
// will quote a price, 41 jobs have been funded. 27 produced something. 13
// were paid and produced nothing, and 12 of those are past their own deadline
// by a median of 49 days. Marketplace-wide the same query finds 289
// expired-undelivered jobs across 54 providers.
//
// Somebody about to fund the fourteenth job should be told that before they
// sign, not after. Nothing else on the card says it: a verification tier says
// an agent has delivered at least once, a hire count says it was chosen, and
// neither distinguishes a provider that finishes from one that takes payment
// and stops.
//
// Rules this follows.
//
// It never shows a rate for a provider nobody has funded. Zero of zero is not
// a zero delivery rate, and rendering 0% for an unhired agent would be an
// accusation the data does not support. `deliveryRate` arrives as null in
// that case and this renders nothing at all.
//
// A funded job whose deadline has not passed is not counted as stuck. It is
// money committed and not yet due, which is a different thing from money
// taken and abandoned, and only the second is worth warning about.

import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/** Colour follows the evidence rather than a fixed threshold: anything with
 *  expired undelivered jobs is amber regardless of rate, because the absolute
 *  count is what a buyer is exposed to. */
function tone(rate, stuck) {
  if (stuck > 0) return 'text-amber-700 dark:text-amber-400';
  if (rate >= 0.9) return 'text-emerald-600 dark:text-emerald-500';
  return 'text-gray-600 dark:text-gray-400';
}

export default function DeliveryRecord({ agent, compact = false, className = '' }) {
  const rate = agent?.deliveryRate;
  const everFunded = agent?.everFunded ?? 0;
  // Nothing was ever paid for, so there is nothing to report. Silence is the
  // honest output here, not a zero.
  if (rate == null || everFunded === 0) return null;

  const delivered = agent.delivered ?? 0;
  const stuck = agent.fundedExpired ?? 0;
  const oldest = agent.oldestStuckDays;
  const pct = Math.round(rate * 100);

  const title = stuck > 0
    ? `${stuck} job${stuck === 1 ? '' : 's'} funded and never delivered, past deadline`
      + (oldest ? `, the oldest by ${oldest} days` : '')
    : `${delivered} of ${everFunded} funded jobs produced something`;

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 text-[11px] ${tone(rate, stuck)} ${className}`} title={title}>
        {stuck > 0
          ? <AlertTriangle size={12} className="shrink-0" />
          : <CheckCircle2 size={12} className="shrink-0" />}
        <span>
          Delivered {delivered} of {everFunded} paid job{everFunded === 1 ? '' : 's'}
          {stuck > 0 && <span className="font-semibold"> · {stuck} taken and never delivered</span>}
        </span>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border p-4 ${stuck > 0
      ? 'border-amber-500/30 bg-amber-500/5'
      : 'border-gray-200 dark:border-gray-800'} ${className}`}
    >
      <div className="flex items-start gap-2">
        {stuck > 0
          ? <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          : <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />}
        <div className="min-w-0">
          <p className="text-[12px] font-semibold mb-1">
            Delivered {delivered} of {everFunded} job{everFunded === 1 ? '' : 's'} it was paid for
            <span className="ml-1.5 font-normal text-gray-500">({pct}%)</span>
          </p>
          {stuck > 0 ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
              {stuck} job{stuck === 1 ? ' was' : 's were'} funded and never delivered, and
              {stuck === 1 ? ' its' : ' their'} deadline{stuck === 1 ? ' has' : 's have'} passed
              {oldest ? `, the oldest ${oldest} days ago` : ''}. Money in an expired job does not
              arrive later. The client has to reclaim it.
            </p>
          ) : (
            <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
              Every job this provider was paid for produced something. That counts delivery, not
              whether the result was any good.
            </p>
          )}
          <p className="text-[10px] text-gray-500 mt-1.5">
            Counted from ERC-8183 jobs on chain. Open jobs are excluded: they were never funded.
          </p>
        </div>
      </div>
    </div>
  );
}
