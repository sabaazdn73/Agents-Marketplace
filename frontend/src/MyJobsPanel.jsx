// MyJobsPanel.jsx
//
// "My Agents" — every hire the connected wallet paid for, under EITHER
// funding model, so a user who just completed a hire has somewhere to find
// it, see its real status, and act on it. Shared verbatim by web and mobile.
//
// TWO SOURCES, ON PURPOSE, BECAUSE THEY ARE GENUINELY DIFFERENT PLACES
// --------------------------------------------------------------------
// ERC-8183 jobs come from /api/my-jobs (a server-side Multicall3 scan,
// reasoning below). Drawable budgets are NOT in our backend at all — the
// only budget knowledge it has is core/budget_agents.py, a static registry
// of which agents can be hired that way, not an index of who funded what.
// So budgets are read straight from AgentBudgetEscrow by client address.
//
// That split is why budget hires used to vanish from this screen entirely:
// this panel asked the backend, and the backend had never heard of them.
//
// Real technical path (investigated 2026-08-18 before building, see
// backend/core/agent_performance.py's docstring): there's no client-indexed
// event any more than there's a provider-indexed one, so this reuses the
// EXACT same approach already built for agent performance — scan the
// recent-window jobs server-side (Multicall3, cached, TTL'd) and index by
// client too. A frontend-only on-chain scan was considered and rejected:
// it would mean re-running the same ~1500-job Multicall3 scan from every
// visitor's browser instead of once, server-side, shared across everyone —
// strictly worse for both the RPC budget and load time, no real upside.
//
// Per-job status/actions reuse JobStatusPanel verbatim, wired here to the
// direct wagmi path (useJobActions.js), the only real hire path this
// product has (see docs/limitations.md for why the Altana session path
// was removed 2026-09-03).

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Briefcase, ExternalLink } from 'lucide-react';
import { useAccount } from 'wagmi';
import JobStatusPanel from './JobStatusPanel';
import MyBudgetsList from './MyBudgetsList';
import { useJobActions } from './useJobActions';
import { useMyBudgets } from './budgetEscrow';
import { agentShareUrl } from './shareLink';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export default function MyJobsPanel({ accent = '#6366F1', mutedBorder = 'border-gray-200 dark:border-gray-800' }) {
  const { address, isConnected } = useAccount();
  const { disputeDirect, approveDirect, claimRefundDirect } = useJobActions();
  // Read once here and pass down, so this panel and the budget list agree
  // on how many budgets exist without enumerating the contract twice.
  const budgetState = useMyBudgets();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!isConnected || !address) { setData(null); setLoading(false); return; }
    setLoading(true); setError(null);
    fetch(`${API_BASE_URL}/api/my-jobs?client_address=${address}`)
      .then((r) => { if (!r.ok) throw new Error(`Backend returned ${r.status}`); return r.json(); })
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [address, isConnected]);

  useEffect(() => { load(); }, [load]);

  if (!isConnected) {
    return (
      <div className={`p-8 rounded-2xl border ${mutedBorder} text-center text-sm text-gray-500`}>
        Connect a wallet to see the agents you've hired.
      </div>
    );
  }
  const jobs = data?.jobs || [];
  const budgets = budgetState.budgets || [];
  // Deliberately NOT a single early return for the jobs fetch any more.
  // Budgets are read from the contract and do not depend on our backend, so
  // a backend failure -- which this endpoint has had, under the 512Mi OOM
  // (docs/memory-ceiling.md) -- must not take someone's funded budgets off
  // the screen with it. The jobs error is reported in place instead.
  const nothingAtAll =
    !loading && !error && jobs.length === 0
    && !budgetState.loading && budgets.length === 0;

  return (
    <div className="space-y-4">
      <MyBudgetsList
        loading={budgetState.loading}
        budgets={budgets}
        error={budgetState.error}
        refresh={budgetState.refresh}
        accent={accent}
        mutedBorder={mutedBorder}
      />

      {budgets.length > 0 && (jobs.length > 0 || loading || error) && (
        <div className="flex items-center gap-2 pt-1">
          <Briefcase size={13} className="text-gray-400" />
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Escrow jobs
          </h3>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
          <Loader2 size={16} className="animate-spin" /> Looking up who you've hired…
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/5 text-sm text-red-500">
          Couldn't load your escrow jobs: {error}
          {budgets.length > 0 && (
            <span className="block text-[11px] text-red-400 mt-1">
              Your funded budgets above are read from the contract and are unaffected.
            </span>
          )}
        </div>
      )}

      {nothingAtAll ? (
        <div className={`p-8 rounded-2xl border ${mutedBorder} text-center`}>
          <Briefcase size={28} className="mx-auto mb-3 text-gray-300 dark:text-gray-700" />
          <p className="text-sm text-gray-500">You haven't hired anyone yet.</p>
          <p className="text-xs text-gray-400 mt-1">Hire an agent from the Marketplace and it'll show up here.</p>
        </div>
      ) : (
        jobs.map((job) => (
          <div key={job.id} className={`rounded-2xl border ${mutedBorder} p-4`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {job.agent_name ? (
                  <a href={agentShareUrl({ id: job.agent_id })} className="font-semibold text-sm truncate hover:underline" style={{ color: accent }}>
                    {job.agent_name}
                  </a>
                ) : (
                  <span className="font-mono text-xs text-gray-500 truncate">{job.provider}</span>
                )}
              </div>
              <a href={`https://bscscan.com/address/${job.provider}`} target="_blank" rel="noreferrer" title="See this agent owner's full activity record" className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5 shrink-0">
                owner <ExternalLink size={9} />
              </a>
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5 truncate">{job.description}</div>
            <JobStatusPanel
              jobId={job.id}
              initialStatus={job.statusLabel}
              mutedBorder={mutedBorder}
              accent={accent}
              onDispute={disputeDirect}
              onApprove={approveDirect}
              onClaimRefund={claimRefundDirect}
            />
          </div>
        ))
      )}

      {data?.note && (
        <p className="text-[11px] text-gray-400 leading-relaxed pt-2">{data.note}</p>
      )}
    </div>
  );
}
