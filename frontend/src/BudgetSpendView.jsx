// BudgetSpendView.jsx
//
// Watch an agent spend, live, as it works.
//
// This is the whole reason the budget model exists as a product rather than
// only as plumbing. ERC-8183 emits PaymentReleased exactly once, for the
// full amount, at completion -- so a "watch it spend" view cannot be built
// on it at all. AgentBudgetEscrow emits Drawn per draw, and this renders
// that stream.
//
// Everything here is read from the chain. The remaining balance is
// recomputed from the contract's own `spent`, never accumulated locally
// from the events we happen to have seen: a missed or duplicated log would
// otherwise silently misreport how much of someone's money is left.

import React, { useEffect, useRef } from 'react';
import { Loader2, ArrowDownRight, ShieldAlert, Clock, Undo2 } from 'lucide-react';
import { formatUnits } from 'viem';
import { useBudgetRead, useDrawFeed, useBudgetActions, BUDGET_STATUS, NATIVE_SENTINEL } from './budgetEscrow';
import { addNotification } from './notifications';

function fmt(v, symbol = 'BNB') {
  if (v == null) return 'n/a';
  const n = Number(formatUnits(v, 18));
  return `${n < 0.0001 && n > 0 ? n.toExponential(2) : n.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol}`;
}

/** bytes32 -> readable text, or null when it isn't text.
 *
 * Decoded by hand rather than with Buffer: Buffer is a Node global and is
 * not defined in the browser under Vite, so using it here would have thrown
 * at runtime on the first draw that carried a memo. */
function memoText(memo) {
  if (typeof memo !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(memo) || /^0x0+$/.test(memo)) return null;
  let s = '';
  for (let i = 2; i < memo.length; i += 2) {
    const code = parseInt(memo.slice(i, i + 2), 16);
    if (code === 0) break;                 // bytes32 is zero-padded on the right
    if (code < 0x20 || code > 0x7e) return null;  // not printable ASCII: not a memo
    s += String.fromCharCode(code);
  }
  return s || null;
}

export default function BudgetSpendView({ budgetId, onRevoked }) {
  const { budget, drawable, loading, error, refresh } = useBudgetRead(budgetId);
  const { draws, accountedFor, scanned } = useDrawFeed(budgetId);
  const { reclaim, pending } = useBudgetActions();

  // One notification per draw, raised from the same feed the list renders.
  // Deduped on `spent`, the contract's running total, which is unique per
  // draw -- so a refetch or an overlapping watch window cannot announce the
  // same spend twice. Only draws seen while this view is mounted notify;
  // backfilled history does not, since telling someone about spending from
  // last week the moment they open a panel would be noise.
  //
  // Declared HERE, above the early returns below, because hooks must run in
  // the same order on every render. Placing it after them crashed the
  // component the moment it went from loading to loaded.
  const announced = useRef(null);
  useEffect(() => {
    if (!draws.length) return;
    if (announced.current === null) { announced.current = new Set(draws.map((d) => String(d.spent))); return; }
    const sym = budget?.token?.toLowerCase() === NATIVE_SENTINEL.toLowerCase() ? 'BNB' : 'tokens';
    for (const d of draws) {
      const key = String(d.spent);
      if (announced.current.has(key)) continue;
      announced.current.add(key);
      const m = memoText(d.memo);
      addNotification(
        `Budget #${String(budgetId)}: ${fmt(d.amount, sym)} drawn`,
        `${m ? `For ${m}. ` : ''}${fmt(d.remaining, sym)} left of your budget.`,
      );
    }
  }, [draws, budgetId, budget]);


  if (loading && !budget) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" /> Reading budget #{String(budgetId)}…
      </div>
    );
  }
  if (error) {
    return <div className="text-sm text-red-600 dark:text-red-400 py-4">Couldn't read this budget: {error}</div>;
  }
  if (!budget) return null;

  const symbol = budget.token?.toLowerCase() === NATIVE_SENTINEL.toLowerCase() ? 'BNB' : 'tokens';
  const total = budget.total;
  const spent = budget.spent;
  const remaining = total - spent;
  const pct = total > 0n ? Number((spent * 100n) / total) : 0;
  const status = BUDGET_STATUS[budget.status] || 'UNKNOWN';
  const isOpen = status === 'OPEN';
  // On a reclaimed budget the contract sets spent = total, as the
  // effects-before-interaction write that makes a double reclaim
  // impossible. So `spent` there is NOT "the amount drawn" -- most of it is
  // the remainder that went back to the client. Anything that reads spent
  // as spending has to exclude this case or it will report money as gone
  // when it was returned.
  const reclaimed = status === 'RECLAIMED';
  const deadline = Number(budget.deadline) * 1000;
  const expired = Date.now() > deadline;
  // While nothing has been drawn, lastDrawAt is the creation time (the
  // contract seeds it there so a cooldown applies before the first draw).
  const openedAt = Number(budget.lastDrawAt) * 1000;
  const idleHours = Math.floor((Date.now() - openedAt) / 3_600_000);

  const doRevoke = async () => {
    const returned = remaining;
    await reclaim(budgetId);
 await refresh(); // on-chain state, never optimistic
    addNotification(
      `Budget #${String(budgetId)}: ${fmt(returned, symbol)} returned`,
      'You took back the unspent remainder. The agent can no longer draw from this budget.',
    );
    onRevoked?.();
  };

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-bold">Budget #{String(budgetId)}</div>
          <div className="text-[11px] text-gray-500">
            {status === 'OPEN' && !expired && 'Agent can draw'}
            {status === 'OPEN' && expired && 'Deadline passed, no further draws'}
            {status === 'CLOSED' && 'Closed by the agent'}
            {status === 'RECLAIMED' && 'Remainder returned to you'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold tabular-nums">{fmt(remaining, symbol)}</div>
          <div className="text-[10px] text-gray-500">left of {fmt(total, symbol)}</div>
        </div>
      </div>

      {/* Spent vs remaining, from the contract's own `spent`. */}
      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-1">
        <div className="h-full bg-amber-500 transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-gray-500 mb-3">
        <span>{reclaimed ? 'Closed, unspent remainder returned to you' : `${fmt(spent, symbol)} spent (${pct}%)`}</span>
        {isOpen && !expired && <span>up to {fmt(drawable, symbol)} in the next draw</span>}
      </div>

      {isOpen && (
        <div className="flex items-center gap-2 mb-3 text-[11px] text-gray-500">
          <Clock size={11} className="shrink-0" />
          <span>
            {expired ? 'Deadline passed' : `Draws stop ${new Date(deadline).toLocaleString()}`}
          </span>
        </div>
      )}

      {/* Idle and expired budgets, surfaced rather than left for the client
          to notice.
          Budget mode can now be used with an agent that never declared
          support for it, so "funded, and nothing ever happened" is a state
 that can genuinely occur. Nothing is lost when it does, but only
          if somebody reclaims, and nobody should have to remember to check.

          `lastDrawAt` is set when the budget is created and only moves on a
          draw, so while spent is 0 it is exactly the time the budget was
          opened. One hour is the threshold: long enough that a working
          agent has had a fair chance to make its first draw, short enough
          that an idle budget is caught the same day. */}
      {isOpen && expired && remaining > 0n && (
        <div className="mb-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            <strong>The deadline has passed and {fmt(remaining, symbol)} is still here.</strong>{' '}
            No further draws can be made. Take it back below.
          </p>
        </div>
      )}
      {isOpen && !expired && spent === 0n && idleHours >= 1 && (
        <div className="mb-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            <strong>Nothing drawn in {idleHours < 24 ? `${idleHours} hours` : `${Math.floor(idleHours / 24)} days`}.</strong>{' '}
            The agent may not support drawable budgets, or may not have started. Your full
            {' '}{fmt(total, symbol)} is untouched and you can take it back below at any time.
          </p>
        </div>
      )}

      {/* The live stream. */}
      {/* The itemised feed is best-effort; `spent` above is not. These RPCs
          return incomplete log ranges without erroring (see useDrawFeed),
          so rather than trust the feed we reconcile it against the
          contract's own `spent` and say plainly when draws are missing.
          The one thing this must never do is claim nothing was drawn while
          the balance directly above says otherwise. */}
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
        Spending activity {draws.length > 0 && `(${draws.length})`}
      </div>
      {draws.length === 0 ? (
        spent > 0n && !reclaimed ? (
          <p className="text-[11px] text-amber-700 dark:text-amber-500 py-2">
            {fmt(spent, symbol)} has been drawn from this budget, but the itemised list
            couldn't be loaded from the network right now. The balance above is read
            straight from the contract and is correct.
          </p>
        ) : reclaimed ? (
          <p className="text-[11px] text-gray-500 py-2">
            This budget is closed and the remainder was returned. Any draws made before that
            couldn't be loaded from the network.
          </p>
        ) : (
          <p className="text-[11px] text-gray-500 py-2">
            {scanned ? 'Nothing drawn yet.' : 'Checking for activity…'} Draws appear here as they happen on-chain.
          </p>
        )
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {draws.map((d, i) => {
            const m = memoText(d.memo);
            return (
              <div key={`${d.spent}-${i}`} className="flex items-start gap-2 text-[11px]">
                <ArrowDownRight size={12} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="font-medium tabular-nums">{fmt(d.amount, symbol)}</span>
                  {m && <span className="text-gray-500"> · {m}</span>}
                </div>
                <span className="text-gray-400 tabular-nums shrink-0">
                  {fmt(d.remaining, symbol)} left
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Detected, not guessed: what the visible draws add up to, against
 what the contract says was spent. */}
      {draws.length > 0 && !reclaimed && accountedFor < spent && (
        <p className="text-[11px] text-amber-700 dark:text-amber-500 mt-2">
          Showing {fmt(accountedFor, symbol)} of the {fmt(spent, symbol)} drawn. Earlier draws
          aren't listed here, the network didn't return them, but they are counted in the
          balance above.
        </p>
      )}

      {/* Revoke, with the race stated at the point of action rather than
          only in the pre-hire explainer -- this is where a buyer is most
          likely to believe it is instant. */}
      {status !== 'RECLAIMED' && remaining > 0n && (
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={doRevoke}
            disabled={pending === 'reclaim'}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-semibold border border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 disabled:opacity-60"
          >
            {pending === 'reclaim' ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
            {pending === 'reclaim' ? 'Revoking…' : `Take back ${fmt(remaining, symbol)}`}
          </button>
          <p className="text-[10px] text-gray-500 mt-1.5 flex items-start gap-1.5">
            <ShieldAlert size={10} className="shrink-0 mt-0.5" />
            <span>
              Returns everything not yet drawn. If the agent's next draw is mined before
              your revoke, that amount goes first, the two transactions compete.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
