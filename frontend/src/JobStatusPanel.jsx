// JobStatusPanel.jsx
//
// Real, live ERC-8183 job status + actions — extracted 2026-08-18 from
// AltanaSessionPanel.jsx (where it was built first, single-job) so "My
// Agents" (many jobs, one per real hire) can reuse the exact same read/
// display logic instead of rebuilding it. Reads are always the same
// (getJobStatus/getDeliverable — pure on-chain reads, no wallet needed);
// the WRITE actions (dispute, claim refund) are passed in as callbacks
// rather than hardcoded, because the two real callers genuinely sign
// differently and papering over that would be dishonest:
//   - AltanaSessionPanel: an Altana passkey wallet + session (settleErc8183Job
//     via the SDK relay).
//   - My Agents (direct wagmi hires): the connected wallet signs directly
//     (writeContractAsync straight to the Policy/Commerce contracts).
// Pass onDispute/onClaimRefund only when the caller actually has a real way
// to sign that action for this job; omitting one just hides that button
// rather than rendering a dead one.

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, ExternalLink, AlertTriangle, RefreshCw, Coins } from 'lucide-react';
import { getJobStatus, getDeliverable } from './altana';
import { trackJob } from './notifications';

export default function JobStatusPanel({
  jobId, initialStatus, mutedBorder, accent,
  onDispute, onClaimRefund,
  agentLabel, agentLink,
}) {
  const [status, setStatus] = useState(initialStatus || null);
  const [job, setJob] = useState(null);
  const [deliverable, setDeliverable] = useState(undefined); // undefined=unknown, null=none, string=url
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const j = await getJobStatus(jobId);
      setJob(j); setStatus(j.statusName);
      trackJob(jobId, j.statusName);
      if (j.statusName === 'SUBMITTED') {
        try { setDeliverable(await getDeliverable(jobId)); } catch { setDeliverable(null); }
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDispute = async () => {
    if (!onDispute) return;
    setBusy(true); setError(null);
    try {
      await onDispute(jobId);
      await refresh(); // read the real status back — don't optimistically assume
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleClaimRefund = async () => {
    if (!onClaimRefund) return;
    setBusy(true); setError(null);
    try {
      await onClaimRefund(jobId);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitted = status === 'SUBMITTED';
  // Real condition, verified 2026-08-18 against live on-chain state (job
  // #56596: expiredAt passed 12+ hours earlier, status still read OPEN) —
  // the contract does NOT auto-transition status once expiredAt passes.
  // "EXPIRED" is a status claimRefund() itself sets; before that call, an
  // overdue job still honestly reads FUNDED. So the actionable case is
  // FUNDED-and-past-expiredAt, not the literal EXPIRED enum value (which
  // means the refund was already claimed — nothing left to do).
  const nowSec = Math.floor(Date.now() / 1000);
  const canClaimRefund = status === 'FUNDED' && job?.expiredAt != null && nowSec > Number(job.expiredAt);

  return (
    <div className={`mt-3 p-3 rounded-xl border ${mutedBorder} text-xs space-y-2`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold">Job #{String(jobId)}</span>
          {agentLabel && (
            agentLink ? <a href={agentLink} className="text-indigo-500 hover:underline">— {agentLabel}</a> : <span className="opacity-60">— {agentLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold" style={{ color: accent }}>{loading ? '…' : (status || 'unknown')}</span>
          <button onClick={refresh} disabled={busy} className="opacity-60 hover:opacity-100"><RefreshCw size={12} /></button>
        </div>
      </div>

      {submitted && (
        <div className="space-y-2 pt-1">
          <div className="opacity-70">The provider submitted a deliverable — review it before deciding:</div>
          {deliverable === undefined ? (
            <div className="flex items-center gap-1.5 opacity-60"><Loader2 size={12} className="animate-spin" /> loading deliverable…</div>
          ) : deliverable ? (
            <a href={deliverable} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline inline-flex items-center gap-1">Open deliverable <ExternalLink size={11} /></a>
          ) : (
            <div className="opacity-60">No deliverable URL found on-chain yet.</div>
          )}
          {onDispute && (
            <>
              <button onClick={handleDispute} disabled={busy} className="w-full py-2 rounded-lg text-xs font-semibold text-red-600 border border-red-500/30 disabled:opacity-50 flex items-center justify-center gap-1.5">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />} Dispute this delivery
              </button>
              <p className="text-[10px] opacity-50">Only valid inside the on-chain dispute window; the contract reverts if it has closed.</p>
            </>
          )}
        </div>
      )}

      {canClaimRefund && onClaimRefund && (
        <div className="space-y-1.5 pt-1">
          <div className="opacity-70">Funded, but the deadline passed with no delivery — you can reclaim the escrow.</div>
          <button onClick={handleClaimRefund} disabled={busy} className="w-full py-2 rounded-lg text-xs font-semibold border disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ color: accent, borderColor: accent + '4D' }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Coins size={13} />} Claim refund
          </button>
        </div>
      )}

      {status === 'COMPLETED' && <div className="text-emerald-600 dark:text-emerald-400">Settled — payment released to the provider.</div>}
      {status === 'REJECTED' && <div className="text-emerald-600 dark:text-emerald-400">Dispute resolved in your favor — you were refunded.</div>}
      {status === 'EXPIRED' && <div className="opacity-70">Expired — refund already claimed.</div>}
      {status === 'FUNDED' && !canClaimRefund && <div className="opacity-70">Funded — awaiting the provider's delivery.</div>}
      {status === 'OPEN' && <div className="opacity-70">Created but not yet funded.</div>}
      {error && <div className="text-red-500 whitespace-pre-wrap">{error}</div>}
    </div>
  );
}
