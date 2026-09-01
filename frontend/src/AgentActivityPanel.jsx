// AgentActivityPanel.jsx
//
// Real "what is this agent actually doing" transparency view for a hired
// job — addresses the black-box concern directly with real, verifiable
// data instead of a trust-based summary. Shows the agent owner wallet's
// real, human-readable on-chain activity (via Zerion's real transactions
// endpoint — see backend/adapters/zerion.py's get_wallet_activity), scoped
// to the real time window of THIS specific job (from a real or best-
// estimated funding moment to the real on-chain submittedAt — see
// jobTiming.js's getActivityWindow), not the wallet's entire history.
//
// Real, honest limitation stated in the UI copy itself, not glossed over:
// this shows real on-chain activity, never the agent's actual off-chain
// code — that's not something an outside observer can ever fully verify
// for an off-chain agent. What IS real here: every transaction shown is
// independently checkable on BscScan, not just trusted from our summary.
//
// Opt-in, per-job, on-demand — the fetch only happens when a user actually
// expands this section (useAgentActivity.js's fetchActivity is called
// manually, not on mount), matching this project's established real Zerion
// rate-budget discipline. Shared by web + mobile.

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Loader2, Radar } from 'lucide-react';
import { useAgentActivity } from './useAgentActivity';

// Zerion's own real operation_type values (confirmed live against real BSC
// transactions this session) mapped to plain-language labels. Anything not
// in this map renders as-is — never hidden, just unlabeled.
const OPERATION_LABELS = {
  execute: 'Contract call',
  send: 'Sent funds',
  receive: 'Received funds',
  trade: 'Trade',
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  mint: 'Mint',
  claim: 'Claim',
  approve: 'Approval',
};

function formatMinedAt(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

const PRECISION_COPY = {
  exact: 'between when you funded this job and when it delivered',
  estimated: "in the real window we have on record for this job's funding-to-delivery time",
  approximate: "in an estimated window around this job (we don't have an exact funding time recorded, so this is based on the job's own real on-chain deadline)",
};

export default function AgentActivityPanel({ ownerAddress, window, className = '' }) {
  const [open, setOpen] = useState(false);
  const { state, fetchActivity } = useAgentActivity();

  // No real window to search (job never delivered, or genuinely no sane
  // estimate exists) — nothing honest to show, so render nothing at all
  // rather than an empty/confusing section.
  if (!window || !ownerAddress) return null;

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state.status === 'idle') {
      fetchActivity(ownerAddress, window.fromMs, window.toMs);
    }
  };

  return (
    <div className={`rounded-xl border border-gray-200 dark:border-gray-800 ${className}`}>
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-gray-700 dark:text-gray-300"
      >
        <span className="flex items-center gap-1.5"><Radar size={13} /> Agent activity</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-800 pt-2.5 space-y-2">
          <p className="text-[10px] text-gray-400 leading-relaxed">
            This shows the agent's real on-chain activity {PRECISION_COPY[window.precision]} — not its off-chain code
            (that's never independently verifiable for an off-chain agent, and we're not claiming otherwise), but
            every real payment and on-chain action here is independently checkable yourself via the BscScan links below.
          </p>
          {state.status === 'loading' && (
            <div className="flex items-center gap-2 text-gray-400 text-xs"><Loader2 size={12} className="animate-spin" /> Checking on-chain activity…</div>
          )}
          {state.status === 'error' && (
            <div className="text-xs text-gray-400">Couldn't check on-chain activity right now.</div>
          )}
          {state.status === 'ready' && state.data.available && state.data.transactions.length > 0 && (
            <ul className="space-y-1.5">
              {state.data.transactions.map((tx) => (
                <li key={tx.hash} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 font-medium">
                      {OPERATION_LABELS[tx.operation_type] || tx.operation_type || 'Activity'}
                    </span>
                    <span className="text-gray-400 truncate">{formatMinedAt(tx.mined_at)}</span>
                  </span>
                  <a
                    href={`https://bscscan.com/tx/${tx.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-indigo-500 hover:underline inline-flex items-center gap-0.5"
                  >
                    View <ExternalLink size={10} />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {state.status === 'ready' && state.data.available && state.data.transactions.length === 0 && (
            <p className="text-xs text-gray-400 leading-relaxed">
              No on-chain activity from this wallet in this job's real time window — some agents only interact
              on-chain at delivery (already shown above), not throughout the work itself. That's real information
              too, not a failed check.
            </p>
          )}
          {state.status === 'ready' && !state.data.available && (
            <p className="text-xs text-gray-400">
              Couldn't check real on-chain activity for this job{state.data.reason ? ` — ${state.data.reason}` : '.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
