// MyJobsPanel.jsx
//
// "My Agents" — every real ERC-8183 job where the connected wallet is the
// CLIENT, so a user who just completed a real hire has somewhere to find
// it, see its real status, and act on it. Shared verbatim by web and mobile.
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
// Per-job status/actions reuse JobStatusPanel verbatim (the same component
// AltanaSessionPanel uses) — only the write actions differ, wired here to
// the DIRECT wagmi path (useJobActions.js) since these are direct-hire jobs,
// not Altana-session jobs.

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Briefcase, ExternalLink } from 'lucide-react';
import { useAccount } from 'wagmi';
import JobStatusPanel from './JobStatusPanel';
import { useJobActions } from './useJobActions';
import { agentShareUrl } from './shareLink';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export default function MyJobsPanel({ accent = '#6366F1', mutedBorder = 'border-gray-200 dark:border-gray-800' }) {
  const { address, isConnected } = useAccount();
  const { disputeDirect, claimRefundDirect } = useJobActions();
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
        Connect a wallet to see the real jobs you've hired through this marketplace.
      </div>
    );
  }
  if (loading) {
    return <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center"><Loader2 size={16} className="animate-spin" /> Reading your real on-chain jobs…</div>;
  }
  if (error) {
    return <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/5 text-sm text-red-500">Couldn't load your jobs: {error}</div>;
  }

  const jobs = data?.jobs || [];

  return (
    <div className="space-y-4">
      {jobs.length === 0 ? (
        <div className={`p-8 rounded-2xl border ${mutedBorder} text-center`}>
          <Briefcase size={28} className="mx-auto mb-3 text-gray-300 dark:text-gray-700" />
          <p className="text-sm text-gray-500">No real ERC-8183 jobs found for this wallet yet.</p>
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
              <a href={`https://bscscan.com/address/${job.provider}`} target="_blank" rel="noreferrer" className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5 shrink-0">
                provider <ExternalLink size={9} />
              </a>
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5 truncate">{job.description}</div>
            <JobStatusPanel
              jobId={job.id}
              initialStatus={job.statusLabel}
              mutedBorder={mutedBorder}
              accent={accent}
              onDispute={disputeDirect}
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
