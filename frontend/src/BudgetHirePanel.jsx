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
//
// Two settings are refused outright, with no way past them: a per-draw limit
// of zero and no wait between draws. Both are permitted by the contract and
// both are in this form's own history, BSC budgets 1 and 2 having been opened
// here with cooldown 0. A per-draw limit of zero alone is enough to let one
// transaction empty a budget, because the contract seeds lastDrawAt at
// creation, so a cooldown delays the first draw without capping its size.
//
// A third refusal, a per-draw limit above half the total, can be dismissed by
// ticking the acknowledgement it shows. That case is a budget for one fixed
// purchase, which is legitimate and which the alternatives make worse. The
// floors and the reasoning behind all three live in budgetLimits.js, and the
// check itself now also runs in useBudgetActions.openBudget so a future
// funding surface cannot miss it.

import React, { useState } from 'react';
import { parseUnits } from 'viem';
import { Loader2, Wallet, AlertTriangle, ExternalLink } from 'lucide-react';
import { useBudgetActions, useBudgetEscrowAddress, NATIVE_SENTINEL } from './budgetEscrow';
import { checkBudgetLimits, COOLDOWN_CHOICES } from './budgetLimits';
import { getBudgetHireToken } from './chainContracts';
import { budgetHiringChainIds, hiringOptionsFor, CHAIN_META, chainName, nativeSymbol, getBudgetEscrowAddress } from './chainContracts';
import ChainSwitchNotice, { switchToChain } from './ChainSwitchNotice';
import { formatDecimalString } from './budgetAmounts';
import { useBudgetModeStatus } from './budgetEscrow';
import { UndeclaredAgentWarning, BudgetModeConsequences } from './HireModePicker';
import { useSwitchChain } from 'wagmi';
import BudgetSpendView from './BudgetSpendView';
import { addNotification, getActiveWallet } from './notifications';

const HOURS = [
  { label: '6 hours', value: 6 },
  { label: '24 hours', value: 24 },
  { label: '3 days', value: 72 },
];
// The wait-between-draws options come from budgetLimits.js, which has no
// "None". The option used to be here and used to be first in the list.

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
  // Dismissal of the one refusal that can be dismissed. Reset whenever either
  // amount changes, so an acknowledgement made about one pair of numbers can
  // never carry over to a different pair the client has since typed.
  const [ackSingleDraw, setAckSingleDraw] = useState(false);

  const agentAddress = agent?.ownerAddress || agent?.owner_address;
  // Whether THIS agent has said it implements draw(). Checked here rather
  // than in the BNB hire flow, because this panel is what takes the money and
  // it renders on every chain the escrow is deployed to.
  const budgetMode = useBudgetModeStatus(agentAddress);

  // Parsed at render rather than inside submit, so the settings can be judged
  // while someone is still typing them and the refusal can sit next to the
  // field it is about instead of appearing after a press.
  //
  // A half-typed number is a parse error, not a refusal. It renders as an
  // empty budget, which the check below already has a sentence for.
  let totalWei = 0n;
  let maxWei = 0n;
  try { totalWei = parseUnits(total || '0', 18); } catch { totalWei = 0n; }
  try { maxWei = parseUnits(maxPerDraw || '0', 18); } catch { maxWei = 0n; }
  const refusal = checkBudgetLimits({
    totalWei, maxPerDrawWei: maxWei, cooldownSeconds: cooldown,
    acknowledgedSingleDraw: ackSingleDraw,
  });

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
    const owner = getActiveWallet(); // filed under the wallet that started this, see notifications.js
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

      // Checked again here, not only in the disabled state of the button. The
      // button is the courtesy; this is the one that cannot be got past.
      if (refusal) throw new Error(refusal.message);
      if (!agentAddress) throw new Error('This agent has no owner address on record.');

      const fundedText = `${formatDecimalString(total).text} ${nativeLabel}`;
      const perDrawText = `${formatDecimalString(maxPerDraw).text} ${nativeLabel}`;

      const { budgetId: newId } = await openBudget({
        agent: agentAddress,
        // The token this chain's contract accepts, not a constant. The
        // constant was why every Ethereum budget reverted.
        token: getBudgetHireToken(chainId) || NATIVE_SENTINEL,
        amount: totalWei,
        maxPerDraw: maxWei,
        deadline: Math.floor(Date.now() / 1000) + hours * 3600,
        cooldown,
        // The same decision the form made, restated for the guard that
        // now sits in useBudgetActions rather than only here.
        acknowledgedSingleDraw: ackSingleDraw,
      });
      // Read out of the transaction's own BudgetOpened event -- see
      // useBudgetActions. If it somehow isn't there, say so rather than
      // showing a spend view for a budget we cannot identify.
      // Named the wrong explorer on every chain but BNB. The budget is open
      // either way; only the id could not be read back.
      if (newId == null) {
        const ex = CHAIN_META[budgetChainId]?.explorer;
        // Notify BEFORE throwing. The money is committed whether or not we
        // could read the id, and the bell is where someone looks later to
        // find out what happened to it.
        addNotification(
          `${fundedText} funded, budget id unknown`,
          `${agent?.name || 'The agent'} was funded, but the budget id could not be read back. `
          + 'The budget is open. Do not fund again; find it under your budgets.',
          owner,
        );
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
        owner,
      );
      setBudgetId(newId);
    } catch (e) {
      // A hire that fails AFTER the funding transaction is sent is the case
      // that most needs a notification, and until now it was the only case
      // that produced none: the notification sat at the end of the happy
      // path, so a receipt that timed out took it down with it even though
      // the money had already left the wallet. waitForReceiptOrAsk marks
      // those errors with `moneyMoved` and carries the hash on them.
      if (e?.moneyMoved) {
        const ex = CHAIN_META[budgetChainId]?.explorer;
        addNotification(
          `Funding sent, not yet confirmed`,
          `Your funding transaction for ${agent?.name || 'the agent'} was sent but we could not `
          + 'confirm it in time. It may still confirm. Do not fund again before checking'
          + (ex && e.hash ? `: ${ex}/tx/${e.hash}` : '.'),
          owner,
        );
      }
      setError(e.shortMessage || e.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* Shown ABOVE the amount fields on purpose. It is information someone
          needs before deciding how much to commit, not a footnote under the
          button they have already pressed. */}
      <WhatABudgetIs />

      {/* Moved here from HireModePicker on the same argument that moved
          UndeclaredAgentWarning: it lived in the picker, which only the BNB
          hire flow mounts, so the one surface that funds a budget on
          Arbitrum, Ethereum and Robinhood Chain showed none of it. The panel
          that takes the money is the surface that has to carry it. */}
      <BudgetModeConsequences />

      {budgetMode.declared === false && <UndeclaredAgentWarning />}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-500">Total budget ({nativeLabel})</span>
          <input
            type="number" step="0.001" min="0" value={total}
            onChange={(e) => { setTotal(e.target.value); setAckSingleDraw(false); }}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-[10px] text-gray-500">The most you can lose.</span>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-500">Max per draw ({nativeLabel})</span>
          <input
            type="number" step="0.001" min="0.000000000000000001" value={maxPerDraw}
            onChange={(e) => { setMaxPerDraw(e.target.value); setAckSingleDraw(false); }}
            aria-invalid={refusal?.field === 'maxPerDraw' || undefined}
            className={`mt-1 w-full px-3 py-2.5 rounded-xl border bg-white dark:bg-[#0F172A] text-sm outline-none focus:ring-2 ${
              refusal?.field === 'maxPerDraw'
                ? 'border-red-400 dark:border-red-500 focus:ring-red-500'
                : 'border-gray-200 dark:border-gray-700 focus:ring-indigo-500'
            }`}
          />
          <span className="text-[10px] text-gray-500">Caps any single transaction. Half the total at most.</span>
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
            {COOLDOWN_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <span className="text-[10px] text-gray-500">Your review window. Nothing can be drawn during it.</span>
        </label>
      </div>

      {/* The refusal, next to the fields rather than after the press. It says
          what the setting would allow, because "invalid" tells nobody
          anything about their money. */}
      {refusal && (
        <div className="space-y-2">
          <div className="text-[12px] text-red-600 dark:text-red-400 flex items-start gap-1.5 leading-relaxed">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {refusal.message}
          </div>

          {/* The one refusal a client may dismiss. It is a checkbox rather
              than a second button because the sentence is the point: they
              are agreeing to a specific mechanic, not clicking past a
              warning. Unchecking is always available, and changing either
              amount clears it. */}
          {refusal.acknowledgeable && (
            <label className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 cursor-pointer">
              <input
                type="checkbox"
                checked={ackSingleDraw}
                onChange={(e) => setAckSingleDraw(e.target.checked)}
                className="mt-0.5 shrink-0 accent-amber-600"
              />
              <span className="text-[11px] text-gray-700 dark:text-gray-300 leading-relaxed">
                {refusal.acknowledgement}
              </span>
            </label>
          )}
        </div>
      )}

      {error && (
        <div className="text-[12px] text-red-600 dark:text-red-400 flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <button
        onClick={submit}
        disabled={!connected || pending === 'open' || switching || !!refusal}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
      >
        {(pending === 'open' || switching) ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}
        {!connected ? 'Connect a wallet first'
          : switching ? `Switching to ${chainName(requiredChainId)}…`
          : pending === 'open' ? 'Funding budget…'
          // A disabled button with an unchanged label reads as broken. It
          // names the setting instead, and the sentence above says why.
          : refusal ? `Adjust the ${refusal.field === 'cooldown' ? 'wait between draws'
            : refusal.field === 'maxPerDraw' ? 'per-draw limit' : 'total'} to continue`
          : `Fund ${formatDecimalString(total || '0').text} ${nativeLabel} budget`}
      </button>

      <a
        href={`${CHAIN_META[budgetChainId]?.explorer || ''}/address/${getBudgetEscrowAddress(budgetChainId)}`}
        target="_blank" rel="noopener noreferrer"
        className="text-[10px] text-gray-500 hover:text-indigo-500 inline-flex items-center gap-1"
      >
        {/* Named "the escrow contract" until now, in the footer link
            directly under the Fund button, contradicting the panel's own
            opening line. The contract's name is AgentBudgetEscrow, so the
            link names the contract rather than describing it as an escrow. */}
        Inspect the AgentBudgetEscrow contract <ExternalLink size={9} />
      </a>
    </div>
  );
}

/**
 * What a budget is, in the words the owner asked for, above the fields that
 * decide how much of it there will be.
 *
 * The register is the one the rest of the site uses: a statement of the
 * instrument, then the three things that are absent, then where to go for the
 * alternative. It is not a banner and it does not ask anyone to confirm
 * anything, because this is a usable feature and the point is that a client
 * knows what they are buying, not that they are discouraged from buying it.
 *
 * The three absences are the specific ones, not a general disclaimer. Each is
 * a property of the deployed contract: draw() takes an amount and a memo and
 * checks no deliverable; there is no submit(), no dispute(), no window and no
 * evaluator anywhere in the source; and reclaim() recovers total - spent, so
 * what is drawn is drawn.
 */
function WhatABudgetIs() {
  return (
    <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-white/5">
      <div className="flex items-center gap-2 mb-1.5">
        <Wallet size={13} className="text-gray-500 shrink-0" />
        <span className="text-[12px] font-bold">This is a spending mechanism, not an escrow</span>
      </div>
      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed mb-2">
        Funding a budget gives the agent permission to take money from it while it works.
        It buys no delivery protection. Specifically:
      </p>
      <ul className="space-y-1 text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed mb-2">
        <li>No deliverable is required to draw. The contract checks the limits you set and
        nothing else, so a draw can happen before anything is produced, or instead of it.</li>
        <li>There is no dispute and no window to raise one in. No arbitration, no evaluator,
        no review period before money moves.</li>
        <li>Money already drawn cannot be recovered. Taking the budget back returns what is
        left, and only that.</li>
      </ul>
      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
        If the agent does not need to spend money to do your job, hire it through locked
        escrow instead, where payment settles on delivery and a dispute window applies.
      </p>
    </div>
  );
}
