// TermixPerformancePanel.jsx
//
// Real, independent track record for one agent — from TermiX's own real
// AACP registry, matched by the same real ERC-8004 token id (see
// backend/adapters/termix.py's own docstring for the full real
// investigation). Deliberately its own section, never blended into this
// marketplace's own "On this marketplace" numbers: two real, separately-
// sourced signals, honestly labeled, shown side by side rather than merged
// into one fabricated combined score. Shared by web + mobile.
//
// Real, honest correction (2026-08-28): this used to be captioned as
// "protocol-wide" / "not limited to hires through this marketplace" — that
// claim didn't survive a direct check (TermiX's own registry reports
// completedJobs: 0 for a real agent independently confirmed to have 2 real
// on-chain COMPLETED jobs on the same shared AgenticCommerce contract).
// TermiX's own numbers appear scoped to activity through TermiX's OWN
// platform, not a genuine complete index of the shared contract — still a
// real, useful, independent second opinion, just captioned accurately now.

import React from 'react';
import { Loader2 } from 'lucide-react';
import { useTermixPerformance } from './useTermixPerformance';

export default function TermixPerformancePanel({ ownerAddress, className = '' }) {
  const termix = useTermixPerformance(ownerAddress);
  if (termix.status === 'idle') return null;

  return (
    <div className={`p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/30 ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
        Via TermiX's own registry
      </div>
      {termix.status === 'loading' && (
        <div className="flex items-center gap-2 text-gray-400 text-xs">
          <Loader2 size={12} className="animate-spin" /> Checking TermiX's real registry…
        </div>
      )}
      {termix.status === 'error' && (
        <div className="text-xs text-gray-400">Couldn't check TermiX's registry right now.</div>
      )}
      {termix.status === 'ready' && termix.data.available && (
        <div className="flex items-center gap-4 flex-wrap">
          <div title="Completed jobs TermiX has recorded for this agent through TermiX's own platform: an independent, separately-scoped signal, not a complete protocol-wide total">
            <span className="text-lg font-bold" style={{ color: '#4F46E5' }}>{termix.data.completed_jobs}</span>{' '}
            <span className="text-[10px] text-gray-500 uppercase">completed jobs</span>
          </div>
          <div title="Share of this agent's TermiX-tracked jobs that passed">
            <span className="text-lg font-bold">{termix.data.pass_rate != null ? `${Math.round(termix.data.pass_rate * 100)}%` : '—'}</span>{' '}
            <span className="text-[10px] text-gray-500 uppercase">pass rate</span>
          </div>
          <div title="TermiX's own reputation score for this agent (0–100 scale)">
            <span className="text-lg font-bold">{termix.data.reputation_score ?? '—'}</span>{' '}
            <span className="text-[10px] text-gray-500 uppercase">reputation</span>
          </div>
        </div>
      )}
      {termix.status === 'ready' && !termix.data.available && (
        <p className="text-xs text-gray-400">
          No TermiX data for this agent{termix.data.reason ? ` — ${termix.data.reason}` : '.'}
        </p>
      )}
    </div>
  );
}
