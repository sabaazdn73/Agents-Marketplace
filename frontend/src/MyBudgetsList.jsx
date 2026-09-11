// MyBudgetsList.jsx
//
// The drawable-budget half of "My Agents".
//
// WHY THIS EXISTS
// ---------------
// Funding a budget used to leave no trace anywhere in the UI. My Agents
// reads /api/my-jobs, which is an ERC-8183 job scan and has no knowledge of
// AgentBudgetEscrow at all -- so a budget hire completed successfully and
// then vanished, with no way to see what happened to the money. Every hire
// belongs in one list whichever funding model paid for it.
//
// DELIBERATELY NOT AN IDENTICAL ROW
// ---------------------------------
// Budgets and escrow jobs are genuinely different instruments and rendering
// them the same way would imply a protection that budget mode does not
// offer. An escrow job holds money back until delivery; a budget lets an
// agent spend before delivering anything. So a budget row is labelled as
// one, carries its own accent, and leads with the numbers that matter for
// THIS model -- cap, drawn, remaining, deadline -- rather than a status
// word borrowed from the job vocabulary.
//
// EVERY NUMBER COMES FROM CONTRACT STATE
// --------------------------------------
// See useMyBudgets for why discovery enumerates budgetCounter instead of
// filtering BudgetOpened logs: these RPCs return incomplete log sets without
// erroring, which would make whole budgets disappear from this list. The
// per-budget figures are getBudget's own fields for the same reason. This
// list never derives a spend from logs.
//
// Expanding a row mounts BudgetSpendView verbatim -- the itemised feed, its
// log-vs-`spent` reconciliation, and the reclaim button all come from there
// rather than being written a second time.

import React, { useState } from 'react';
import { Loader2, Wallet, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { BUDGET_STATUS, NATIVE_SENTINEL } from './budgetEscrow';
import { chainName } from './chainContracts';
// Both used below and neither was imported: formatAmount at lines 47 and
// 53, budgetTokenSymbol at 123. Latent ReferenceErrors that could not fire
// while readBudgetsOnChain returned an empty array on every chain because
// of a shadowed variable, so this list never rendered a row. Fixing that
// shadow made it render for the first time and these took the whole
// My Agents tab down with a blank white screen.
import { formatAmount, budgetTokenSymbol } from './budgetAmounts';
import BudgetSpendView from './BudgetSpendView';

// Every amount in this component goes through the shared formatter. The local
// copy that used to live here defaulted the symbol to 'BNB' and switched to
// exponential notation below 0.0001, so a real budget rendered "7.00e-6 BNB"
// on Robinhood Chain: wrong unit, and a number nobody should have to decode.
// See budgetAmounts.js.
function fmt(v, symbol) {
  const { text } = formatAmount(v);
  return symbol ? `${text} ${symbol}` : text;
}

/** The exact value, for a title attribute, so trimming never hides money. */
function fmtFull(v, symbol) {
  const { full } = formatAmount(v);
  return symbol ? `${full} ${symbol}` : full;
}

function shortAddr(a) {
  return typeof a === 'string' && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '';
}

/** Status word plus the colour it should carry. Separate from the job
 *  vocabulary on purpose -- a budget is never "delivered" or "disputed". */
function statusChip(status, expired) {
  if (status === 'RECLAIMED') return { label: 'Reclaimed', cls: 'bg-gray-500/10 text-gray-500' };
  if (status === 'CLOSED') return { label: 'Closed by agent', cls: 'bg-gray-500/10 text-gray-500' };
  if (status === 'OPEN' && expired) return { label: 'Expired', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-500' };
  if (status === 'OPEN') return { label: 'Active', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-500' };
  return { label: status, cls: 'bg-gray-500/10 text-gray-500' };
}

// The useMyBudgets result is passed IN rather than called here, so the
// parent can use the same one budget read to decide its own empty state.
// Calling the hook in both places would mean two enumerations of the whole
// contract for one render.
export default function MyBudgetsList({
  loading, budgets = [], error, refresh,
  accent = '#6366F1', mutedBorder = 'border-gray-200 dark:border-gray-800',
}) {
  const [openId, setOpenId] = useState(null);
  // Budgets are read from the escrow on the wallet's current chain, so that
  // chain is the one every amount on this list is denominated in.
  // No wallet-chain gate here any more. This used to return null when the
  // escrow was not deployed on whatever chain the wallet pointed at, which
  // hid every budget on every other chain along with it. Discovery is now
  // chain-independent, so this list is too.

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 text-sm py-4 justify-center">
        <Loader2 size={14} className="animate-spin" /> Checking your funded budgets…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-[12px] text-amber-700 dark:text-amber-500 flex items-start gap-2">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        <span>
          Couldn't read your budgets from the contract: {error}. Your escrow jobs below are
          unaffected, and nothing here means a budget is lost, this is a read failing, not a balance.
        </span>
      </div>
    );
  }

  if (budgets.length === 0) return null;   // nothing funded: no empty section

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Wallet size={13} style={{ color: accent }} />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Spending budgets
        </h3>
        <span className="text-[10px] text-gray-400">({budgets.length})</span>
      </div>

      {budgets.map((b) => {
        const id = b.id;
        // The budget's OWN chain, not the wallet's. A row can now be on a
        // different chain from the one the wallet is pointing at.
        const symbol = budgetTokenSymbol(b.token, b.chainId, NATIVE_SENTINEL);
        const status = BUDGET_STATUS[b.status] || 'UNKNOWN';
        const reclaimed = status === 'RECLAIMED';
        const total = b.total;
        const spent = b.spent;
        const remaining = total - spent;
        const deadlineMs = Number(b.deadline) * 1000;
        const expired = Date.now() > deadlineMs;
        const chip = statusChip(status, expired);
        const isOpenRow = openId === String(id);

        return (
          <div key={String(id)} className={`rounded-2xl border ${mutedBorder} overflow-hidden`}>
            <button
              type="button"
              onClick={() => setOpenId(isOpenRow ? null : String(id))}
              className="w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              aria-expanded={isOpenRow}
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  {isOpenRow
                    ? <ChevronDown size={14} className="text-gray-400 shrink-0" />
                    : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                  {/* Which chain this budget is on. Load-bearing now that
                      one wallet can hold budgets on three chains at once:
                      without it two rows showing different tokens look like
                      a bug rather than two chains. */}
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                    {chainName(b.chainId)}
                  </span>
                  {/* The funding model, stated on the row itself. */}
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
                    style={{ backgroundColor: `${accent}1A`, color: accent }}
                  >
                    Budget
                  </span>
                  <span className="text-sm font-semibold truncate">Budget #{String(id)}</span>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${chip.cls}`}>
                  {chip.label}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 pl-6">
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">Cap</div>
                  <div className="text-[13px] font-semibold tabular-nums">{fmt(total, symbol)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">
                    {reclaimed ? 'Returned' : 'Drawn'}
                  </div>
                  {/* On a RECLAIMED budget the contract sets spent = total as
                      the effects-before-interaction write that blocks a double
                      reclaim. Reading that as "drawn" would report returned
 money as gone, so this row says what happened. */}
                  <div className="text-[13px] font-semibold tabular-nums">
                    {reclaimed ? fmt(total, symbol) : fmt(spent, symbol)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">Remaining</div>
                  <div className="text-[13px] font-semibold tabular-nums">
                    {reclaimed ? ',' : fmt(remaining, symbol)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 mt-2 pl-6 text-[10px] text-gray-400">
                <span>Agent {shortAddr(b.agent)}</span>
                <span>
                  {reclaimed
                    ? 'Remainder returned to you'
                    : `${expired ? 'Deadline passed' : 'Deadline'} ${new Date(deadlineMs).toLocaleDateString()}`}
                </span>
              </div>
            </button>

            {isOpenRow && (
              <div className={`border-t ${mutedBorder} p-4`}>
                {/* The whole spend view, including reclaim and the feed's
                    reconciliation against the contract's own `spent`. */}
                <BudgetSpendView budgetId={id} onRevoked={refresh} chainId={b.chainId} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
