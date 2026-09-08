// BudgetHirePanel.jsx
//
// The opt-in budget-mode hire surface: set the limits, fund it, then watch
// the agent spend.
//
// Entirely self-contained, and that is deliberate. The ERC-8183 hire flow
// in useHireAgent.js is the default and the most debugged path in this app;
// budget mode does not reach into it, share state with it, or change any of
// its steps. Selecting escrow runs exactly the code that ran before this
// file existed.
//
// The limits are presented as the buyer's protection rather than as
// optional tuning, because for this model they are the ONLY protection.
// Defaults are conservative on purpose: a short deadline, a per-draw cap
// well under the total, and a cooldown -- a buyer who accepts the defaults
// should end up with a safer budget than one who does not think about it.

import React, { useState } from 'react';
import { parseUnits } from 'viem';
import { Loader2, Wallet, AlertTriangle, ExternalLink } from 'lucide-react';
import { useBudgetActions, isBudgetEscrowConfigured, NATIVE_SENTINEL, BUDGET_ESCROW_ADDRESS } from './budgetEscrow';
import BudgetSpendView from './BudgetSpendView';
import { addNotification } from './notifications';

const HOURS = [
  { label: '6 hours', value: 6 },
  { label: '24 hours', value: 24 },
  { label: '3 days', value: 72 },
];
const COOLDOWNS = [
  { label: 'None', value: 0 },
  { label: '1 min', value: 60 },
  { label: '10 min', value: 600 },
  { label: '1 hour', value: 3600 },
];

export default function BudgetHirePanel({ agent }) {
  const { openBudget, pending, connected } = useBudgetActions();
  const [total, setTotal] = useState('0.01');
  const [maxPerDraw, setMaxPerDraw] = useState('0.002');
  const [hours, setHours] = useState(24);
  const [cooldown, setCooldown] = useState(600);
  const [budgetId, setBudgetId] = useState(null);
  const [error, setError] = useState(null);

  const agentAddress = agent?.ownerAddress || agent?.owner_address;

  if (!isBudgetEscrowConfigured()) {
    return (
      <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 text-[12px] text-amber-700 dark:text-amber-400 flex items-start gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <span>
          Budget mode isn't available yet, the escrow contract for it hasn't been deployed.
          Locked escrow (ERC-8183) works normally in the meantime.
        </span>
      </div>
    );
  }

  if (budgetId != null) {
    return <BudgetSpendView budgetId={budgetId} />;
  }

  const submit = async () => {
    setError(null);
    try {
      const totalWei = parseUnits(total || '0', 18);
      const maxWei = parseUnits(maxPerDraw || '0', 18);
      if (totalWei <= 0n) throw new Error('Enter a total budget.');
      if (maxWei > totalWei) throw new Error('The per-draw limit cannot exceed the total.');
      if (!agentAddress) throw new Error('This agent has no owner address on record.');

      const { budgetId: newId } = await openBudget({
        agent: agentAddress,
        token: NATIVE_SENTINEL,
        amount: totalWei,
        maxPerDraw: maxWei,
        deadline: Math.floor(Date.now() / 1000) + hours * 3600,
        cooldown,
      });
      // Read out of the transaction's own BudgetOpened event -- see
      // useBudgetActions. If it somehow isn't there, say so rather than
      // showing a spend view for a budget we cannot identify.
      if (newId == null) throw new Error("Funded, but couldn't read the budget id back from the transaction. Check BscScan before funding again.");
      // Budget hires produced no notification at all until now: the
      // notification calls lived only in the ERC-8183 path, so a client
      // who hired this way saw nothing in the bell.
      addNotification(
        `Budget #${newId}: ${total} BNB funded`,
        `${agent?.name || 'The agent'} can now draw up to ${maxPerDraw} BNB at a time. You can take back whatever is left at any point.`,
      );
      setBudgetId(newId);
    } catch (e) {
      setError(e.shortMessage || e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-500">Total budget (BNB)</span>
          <input
            type="number" step="0.001" min="0" value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-[10px] text-gray-500">The most you can lose.</span>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-500">Max per draw (BNB)</span>
          <input
            type="number" step="0.001" min="0" value={maxPerDraw}
            onChange={(e) => setMaxPerDraw(e.target.value)}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-[10px] text-gray-500">Caps any single transaction.</span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-500">Draws stop after</span>
          <select
            value={hours} onChange={(e) => setHours(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-sm outline-none"
          >
            {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-500">Wait between draws</span>
          <select
            value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-sm outline-none"
          >
            {COOLDOWNS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <span className="text-[10px] text-gray-500">Gives you time to notice and revoke.</span>
        </label>
      </div>

      {error && (
        <div className="text-[12px] text-red-600 dark:text-red-400 flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <button
        onClick={submit}
        disabled={!connected || pending === 'open'}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
      >
        {pending === 'open' ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}
        {!connected ? 'Connect a wallet first' : pending === 'open' ? 'Funding budget…' : `Fund ${total || '0'} BNB budget`}
      </button>

      <a
        href={`https://bscscan.com/address/${BUDGET_ESCROW_ADDRESS}`}
        target="_blank" rel="noopener noreferrer"
        className="text-[10px] text-gray-500 hover:text-indigo-500 inline-flex items-center gap-1"
      >
        Inspect the escrow contract <ExternalLink size={9} />
      </a>
    </div>
  );
}
