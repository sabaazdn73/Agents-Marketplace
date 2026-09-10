// BudgetRecord.jsx
//
// The delivery signal for chains that have no ERC-8183.
//
// DeliveryRecord.jsx shows "delivered 27 of 41 jobs it was paid for" on BNB
// Chain, built from ERC-8183 job history. Arbitrum and Robinhood Chain have
// no ERC-8183 and never will, so they showed nothing, which reads as "nobody
// has looked" rather than "here is what happened".
//
// The same fact does exist there, in AgentBudgetEscrow. A client funds a
// budget; the agent draws against it as it works. A budget funded and never
// drawn from is a client who committed money and received nothing, which is
// the same event an undelivered job records.
//
// This is deliberately NOT a percentage.
//
// There are five budgets in existence across all three chains: three on BNB
// Chain and one each on Arbitrum and Robinhood Chain. One budget is not a
// track record, and "0% delivery rate" off a single data point is a number
// wearing the costume of evidence. It would also be an accusation, because
// the one Arbitrum budget is not yet past its deadline: the agent has done
// nothing wrong by not having drawn yet.
//
// So below the backend's own threshold this renders counts and says the
// sample is too small, and the threshold comes from the API (`min_for_rate`)
// rather than being repeated here, so the card and the detail page cannot
// drift apart from each other or from the backend.
//
// A note on where the numbers come from, because the obvious source is
// wrong: they are counted from Drawn events, never from the contract's
// `spent` field. `reclaim()` sets `spent = total` before paying the client
// back, so after a reclaim `spent` reads as fully drawn whether the agent
// drew everything or nothing. The single Robinhood Chain budget is exactly
// that case. Full reasoning in backend/core/budget_index.py.

import React from 'react';
import { AlertTriangle, CheckCircle2, Wallet } from 'lucide-react';

/** Wording for the counts, kept in one place so the compact and full
 *  variants cannot describe the same numbers differently. */
function describe(rec) {
  const funded = rec.budgets_funded ?? 0;
  const drawn = rec.budgets_drawn_from ?? 0;
  const never = rec.budgets_never_drawn ?? 0;
  const b = (n) => `${n} budget${n === 1 ? '' : 's'}`;

  if (funded === 0) return null;
  if (drawn === 0) {
    return {
      tone: 'idle',
      short: `Funded ${b(funded)}, never drawn from`,
      long: `${funded === 1 ? 'One client has' : `${funded} clients have`} funded this agent through a `
        + `drawable budget. It has not drawn from ${funded === 1 ? 'it' : 'any of them'} yet.`,
    };
  }
  if (never === 0) {
    return {
      tone: 'active',
      short: `Drew from ${b(drawn)} of ${funded}`,
      long: `This agent has drawn from every budget funded for it (${drawn} of ${funded}). That records `
        + 'that it started work and took payment, not whether the result was any good.',
    };
  }
  return {
    tone: 'mixed',
    short: `Drew from ${drawn} of ${b(funded)}`,
    long: `This agent drew from ${drawn} of the ${funded} budgets funded for it. `
      + `${never === 1 ? 'One was' : `${never} were`} funded and never drawn from at all.`,
  };
}

const TONE = {
  idle: 'text-gray-600 dark:text-gray-400',
  mixed: 'text-amber-700 dark:text-amber-400',
  active: 'text-emerald-600 dark:text-emerald-500',
};

const ICON = { idle: Wallet, mixed: AlertTriangle, active: CheckCircle2 };

export default function BudgetRecord({ agent, compact = false, className = '' }) {
  // The API sends snake_case straight through; no normaliser sits between.
  const rec = agent?.budget_record || agent?.budgetRecord;
  if (!rec) return null;

  const d = describe(rec);
  if (!d) return null;

  const tooSmall = rec.sample_too_small !== false;
  const rate = rec.draw_rate;
  const Icon = ICON[d.tone];

  if (compact) {
    return (
      <div
        className={`flex items-center gap-1.5 text-[11px] ${TONE[d.tone]} ${className}`}
        title={`${d.long}${tooSmall ? ' Too few budgets so far to state this as a rate.' : ''}`}
      >
        <Icon size={12} className="shrink-0" />
        <span>{d.short}</span>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border p-4 ${d.tone === 'mixed'
      ? 'border-amber-500/30 bg-amber-500/5'
      : 'border-gray-200 dark:border-gray-800'} ${className}`}
    >
      <div className="flex items-start gap-2">
        <Icon size={14} className={`shrink-0 mt-0.5 ${TONE[d.tone]}`} />
        <div className="min-w-0">
          <p className="text-[12px] font-semibold mb-1">
            {d.short}
            {/* A percentage appears only once there is enough behind it to
                mean anything. Below the threshold the counts stand alone. */}
            {!tooSmall && rate != null && (
              <span className="ml-1.5 font-normal text-gray-500">({Math.round(rate * 100)}%)</span>
            )}
          </p>
          <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">{d.long}</p>
          {tooSmall && (
            <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed mt-1.5">
              This is too little history to be a track record, so it is shown as counts rather than a
              rate. A percentage appears once at least {rec.min_for_rate} budgets have been funded for
              this agent.
            </p>
          )}
          <p className="text-[10px] text-gray-500 mt-1.5">
            Counted from AgentBudgetEscrow draw events on chain, not from the contract's spent field,
            which a client reclaim overwrites.
          </p>
        </div>
      </div>
    </div>
  );
}
