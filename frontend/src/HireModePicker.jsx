// HireModePicker.jsx
//
// Lets a buyer choose between the two funding models, and states what the
// choice costs them.
//
// Escrow is the DEFAULT and stays selected unless someone deliberately
// picks otherwise. That is not a UI preference, it is the safer model: it
// protects the buyer, and it is the working, heavily-debugged path. Budget
// mode is opt-in because it is a reduction in buyer protection.
//
// The hard rule this component exists to honour: a buyer choosing the
// budget model must understand they are trading protection for capability
// BEFORE they choose, stated plainly and at the point of decision -- not
// buried in a tooltip, a docs page, or a warning they meet after paying.
// So the downside is on the card itself, in the same size text as the
// upside, and the revoke race is spelled out rather than described as
// "funds can be recovered at any time", which would read as a guarantee it
// is not.

import React from 'react';
import { Lock, Wallet, AlertTriangle, Check } from 'lucide-react';

export const HIRE_MODE = { ESCROW: 'escrow', BUDGET: 'budget' };

const MODES = [
  {
    id: HIRE_MODE.ESCROW,
    title: 'Locked escrow',
    subtitle: 'ERC-8183 · recommended',
    icon: Lock,
    good: [
      'Your money is locked until the agent delivers.',
      'The agent cannot touch it before then.',
      'A dispute window applies before payment settles.',
    ],
    cost: 'The agent cannot spend anything while working, so this does not suit agents that must buy something to do the job.',
  },
  {
    id: HIRE_MODE.BUDGET,
    title: 'Spending budget',
    subtitle: 'for agents that must spend to work',
    icon: Wallet,
    good: [
      'The agent can draw funds as it works, up to a cap you set.',
      'You watch every draw happen live, as it happens.',
      'Per-draw limit, cooldown and deadline are enforced on-chain.',
    ],
    cost: 'You give up escrow protection. The agent can spend up to your cap without delivering anything, and the cap is your only structural protection.',
  },
];

export default function HireModePicker({ value, onChange, budgetAvailable, budgetDeclared, disabledReason }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
        How you pay
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {MODES.map((m) => {
          const Icon = m.icon;
          const isBudget = m.id === HIRE_MODE.BUDGET;
          const unavailable = isBudget && !budgetAvailable;
          const on = value === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => !unavailable && onChange(m.id)}
              disabled={unavailable}
              aria-pressed={on}
              className={`text-left p-3.5 rounded-xl border transition-colors ${
                on
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-white/5'
              } ${unavailable ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Icon size={15} className={on ? 'text-indigo-500' : 'text-gray-400'} />
                <span className="text-sm font-bold">{m.title}</span>
                {on && <Check size={13} className="text-indigo-500 ml-auto" />}
              </div>
              <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-2">
                {m.subtitle}
              </div>
              <ul className="space-y-1 mb-2">
                {m.good.map((g) => (
                  <li key={g} className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                    {g}
                  </li>
                ))}
              </ul>
              {/* Same weight as the upside above it, deliberately. */}
              <div className="text-[11px] text-amber-700 dark:text-amber-500 leading-relaxed flex items-start gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>{m.cost}</span>
              </div>
              {unavailable && (
                <div className="text-[10px] text-gray-500 mt-2">
                  {disabledReason || 'Not available yet.'}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {value === HIRE_MODE.BUDGET && !budgetDeclared && <UndeclaredAgentWarning />}
      {value === HIRE_MODE.BUDGET && <BudgetModeConsequences />}
    </div>
  );
}

/** Shown when the agent has not told us it implements draw().
 *
 * This replaced a hard block. The contract puts no restriction on who can
 * be named as the agent, so blocking undeclared agents was our judgement
 * imposed on the client, and it shut out the agents the model exists for:
 * ones that need funds mid-job but had not registered with us. The failure
 * it guarded against is also recoverable, not permanent, which is what
 * makes a warning the proportionate response.
 *
 * Deliberately specific. A generic "proceed at your own risk" gets clicked
 * past; what a client needs is the mechanic (nothing is spent if
 * the agent never draws), the remedy (reclaim, any time), and the
 * next step (ask the developer, here is the spec). */
function UndeclaredAgentWarning() {
  return (
    <div className="mt-3 p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
        <div className="text-[11px] text-gray-700 dark:text-gray-300 leading-relaxed">
          <p className="font-bold text-amber-700 dark:text-amber-400 mb-1">
            This agent hasn't said it supports budgets
          </p>
          <p className="mb-1.5">
            You can still fund one. If the agent doesn't know how to draw from it, nothing gets
            spent and the money stays where it is until you take it back. You can reclaim the
            full amount at any time, so the risk here is a budget sitting unused, not a budget
            being lost.
          </p>
          <p>
            If you want to check first, ask the agent's developer whether it calls{' '}
            <code className="font-mono text-[10px]">draw()</code> on Tnega's budget escrow. The{' '}
            <a
              href="/docs/budget-integration" target="_blank" rel="noreferrer"
              className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
            >
              integration guide
            </a>{' '}
            is what they'd need.
          </p>
        </div>
      </div>
    </div>
  );
}

/** The detail a buyer needs BEFORE funding a budget, not after.
 *
 * The revoke race is stated explicitly. It is tempting to write "you can
 * take your money back at any time", which is what the contract enables --
 * but it would be a false guarantee: revoke and a draw are two
 * transactions competing for the same block, and whichever is mined first
 * wins. A buyer who believes revoke is instant and absolute would be
 * surprised in exactly the moment they could least afford it. */
function BudgetModeConsequences() {
  return (
    <div className="mt-3 p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={14} className="text-amber-500 shrink-0" />
        <span className="text-[12px] font-bold text-amber-700 dark:text-amber-400">
          What you are agreeing to
        </span>
      </div>
      <ul className="space-y-1.5 text-[11px] text-gray-700 dark:text-gray-300 leading-relaxed">
        <li>
          <strong>The agent can spend without delivering.</strong> Unlike escrow, funds are
          not held back until the work is done. Everything the agent draws is gone whether
          or not you ever receive anything.
        </li>
        <li>
          <strong>Your cap is the limit.</strong> Set the total, the per-draw maximum
          and the deadline to amounts you would accept losing outright.
        </li>
        <li>
          <strong>Revoking is not instant.</strong> You can take back the unspent remainder
          at any time, but your revoke and the agent's next draw are two competing
          transactions, whichever is mined first wins. If a draw lands in the same block,
          that money is already spent.
        </li>
        <li>
          <strong>No dispute process.</strong> There is no delivery to dispute and no
          arbitration. If the agent spends badly, your recourse is to revoke the remainder.
        </li>
      </ul>
    </div>
  );
}
