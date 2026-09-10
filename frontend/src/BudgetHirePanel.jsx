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
import { useBudgetActions, useBudgetEscrowAddress, NATIVE_SENTINEL } from './budgetEscrow';
import { budgetHiringChainIds, hiringOptionsFor, CHAIN_META, chainName, nativeSymbol, getBudgetEscrowAddress } from './chainContracts';
import ChainSwitchNotice, { switchToChain } from './ChainSwitchNotice';
import { formatDecimalString } from './budgetAmounts';
import { useBudgetModeStatus } from './budgetEscrow';
import { UndeclaredAgentWarning } from './HireModePicker';
import { useSwitchChain } from 'wagmi';
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

export default function BudgetHirePanel({ agent, requiredChainId = null }) {
  const { openBudget, pending, connected } = useBudgetActions();
  const { switchChainAsync } = useSwitchChain();
  const [switching, setSwitching] = useState(false);
  // Address, availability and the native-token label all come from the chain
  // the wallet is on. Nothing here assumes BNB or BSC any more.
  const { chainId, address: escrowAddress, configured } = useBudgetEscrowAddress();
  // The budget is opened on the AGENT's chain, so every token label has to
  // name that chain's gas token, not the one the wallet happens to be on.
  // Caught in the browser: a Robinhood Chain agent read "Total budget (BNB)"
  // while the wallet sat on BSC. The amount would have been correct, since
  // the switch happens before funding, but the label was naming the wrong
  // asset at the moment someone decides how much to commit.
  const budgetChainId = requiredChainId ? Number(requiredChainId) : chainId;
  const nativeLabel = nativeSymbol(budgetChainId);
  const [total, setTotal] = useState('0.01');
  const [maxPerDraw, setMaxPerDraw] = useState('0.002');
  const [hours, setHours] = useState(24);
  const [cooldown, setCooldown] = useState(600);
  const [budgetId, setBudgetId] = useState(null);
  const [error, setError] = useState(null);

  const agentAddress = agent?.ownerAddress || agent?.owner_address;
  // Whether THIS agent has said it implements draw(). Checked here rather
  // than in the BNB hire flow, because this panel is what takes the money and
  // it renders on every chain the escrow is deployed to.
  const budgetMode = useBudgetModeStatus(agentAddress);

  // Budget hiring is available wherever AgentBudgetEscrow is deployed, which
  // is now three chains rather than one. Where it is not, say which chain the
  // wallet is on and offer to move -- rather than the old blanket "not
  // deployed yet", which is no longer true anywhere it is shown.
  // Hiring an agent on another chain used to stop here with a notice and a
  // "switch first" button. That was a worse experience than BNB Chain's,
  // where hiring is one action, so the switch now happens as part of
  // funding: fill the form, press the button, and the wallet is asked to
  // move to the agent's chain before the budget is opened.
  //
  // Switching still cannot be skipped. A budget opened on the wrong chain
  // would pay the wrong native token to an address that means nothing there,
  // and nothing would revert to tell anyone.

  if (!configured) {
    const opts = hiringOptionsFor(chainId);
    return (
      <ChainSwitchNotice
        currentChainId={chainId}
        targetChainIds={budgetHiringChainIds()}
        actionLabel="Budget hiring"
        reason={`${opts.budget.reason} ${
          opts.escrow.available
            ? 'Escrow hiring (ERC-8183) does work here.'
            : ''
        }`.trim()}
      />
    );
  }

  if (budgetId != null) {
    return <BudgetSpendView budgetId={budgetId} chainId={budgetChainId} />;
  }

  const submit = async () => {
    setError(null);
    try {
      // Move to the agent's chain first, if we are not on it. Errors from
      // here are surfaced as they are: switchToChain already turns a refusal
      // or an unknown chain into a sentence, and it offers to ADD the chain
      // rather than telling anyone to go and do it by hand.
      if (requiredChainId && Number(requiredChainId) !== Number(chainId)) {
        setSwitching(true);
        try {
          await switchToChain(switchChainAsync, requiredChainId);
        } finally {
          setSwitching(false);
        }
      }

      const totalWei = parseUnits(total || '0', 18);
      const maxWei = parseUnits(maxPerDraw || '0', 18);
      if (totalWei <= 0n) throw new Error('Enter a total budget.');
      if (maxWei > totalWei) throw new Error('The per-draw limit cannot exceed the total.');
      if (!agentAddress) throw new Error('This agent has no owner address on record.');

      const fundedText = `${formatDecimalString(total).text} ${nativeLabel}`;
      const perDrawText = `${formatDecimalString(maxPerDraw).text} ${nativeLabel}`;

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
      // Named the wrong explorer on every chain but BNB. The budget is open
      // either way; only the id could not be read back.
      if (newId == null) {
        const ex = CHAIN_META[budgetChainId]?.explorer;
        throw new Error(
          'Funded successfully, but we could not read the budget id back from the transaction. '
          + 'Your budget IS open, so do not fund again'
          + (ex ? `. Check ${ex}/address/${getBudgetEscrowAddress(budgetChainId)}` : '.'),
        );
      }
      // Budget hires produced no notification at all until now: the
      // notification calls lived only in the ERC-8183 path, so a client
      // who hired this way saw nothing in the bell.
      addNotification(
        // Both the symbol and the numbers come from the shared helpers.
        // This line used to interpolate the raw form strings next to a
        // hardcoded BNB, so it was wrong in the unit and formatted by a
        // different rule from every other amount in the flow.
        `Budget #${newId}: ${fundedText} funded`,
        `${agent?.name || 'The agent'} can now draw up to ${perDrawText} at a time. You can take back whatever is left at any point.`,
      );
      setBudgetId(newId);
    } catch (e) {
      setError(e.shortMessage || e.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* Shown ABOVE the amount fields on purpose. It is information someone
          needs before deciding how much to commit, not a footnote under the
          button they have already pressed. */}
      {budgetMode.declared === false && <UndeclaredAgentWarning />}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-500">Total budget ({nativeLabel})</span>
          <input
            type="number" step="0.001" min="0" value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-[10px] text-gray-500">The most you can lose.</span>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-500">Max per draw ({nativeLabel})</span>
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
        disabled={!connected || pending === 'open' || switching}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
      >
        {(pending === 'open' || switching) ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}
        {!connected ? 'Connect a wallet first'
          : switching ? `Switching to ${chainName(requiredChainId)}…`
          : pending === 'open' ? 'Funding budget…'
          : `Fund ${formatDecimalString(total || '0').text} ${nativeLabel} budget`}
      </button>

      <a
        href={`${CHAIN_META[budgetChainId]?.explorer || ''}/address/${getBudgetEscrowAddress(budgetChainId)}`}
        target="_blank" rel="noopener noreferrer"
        className="text-[10px] text-gray-500 hover:text-indigo-500 inline-flex items-center gap-1"
      >
        Inspect the escrow contract <ExternalLink size={9} />
      </a>
    </div>
  );
}
