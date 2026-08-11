// AltanaSessionPanel.jsx
//
// The real, in-product UI for the Altana partner track's exact
// requirement: "agents on their own Altana wallets, sessions with
// real spend caps and expiries registered onchain, and revocation
// the user can see in the product." Every action here is a real,
// on-chain Altana SDK call, nothing simulated.

import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Loader2, ExternalLink, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  getOrCreateAltanaWallet, grantMarketplaceSession, revokeMarketplaceSession,
  hireAgentWithSession, explorerLinkForWallet, ALTANA_EXPLORER_URL,
  getJobStatus, getDeliverable, disputeJob,
} from './altana';
import { addNotification, trackJob } from './notifications';

// Live ERC-8183 job status + the real dispute path. Reads getErc8183Job (and
// getErc8183DeliverableUrl when SUBMITTED) on-chain; if the job is SUBMITTED
// and still inside the dispute window, offers "Dispute this delivery" which
// calls the real Policy.dispute — then re-reads the REAL status (never assumes
// success). The contract enforces the exact window and reverts if it's closed;
// we surface that error rather than pre-judging it in the UI.
function JobStatusPanel({ wallet, jobId, initialStatus, mutedBorder, accent }) {
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
    setBusy(true); setError(null);
    try {
      await disputeJob(wallet, wallet.signer, jobId);
      addNotification(`Job #${jobId} disputed`, 'You contested the delivery; awaiting the on-chain verdict.');
      await refresh(); // read the real status back — don't optimistically assume
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitted = status === 'SUBMITTED';
  return (
    <div className={`mt-3 p-3 rounded-xl border ${mutedBorder} text-xs space-y-2`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">Job #{String(jobId)}</span>
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
          <button onClick={handleDispute} disabled={busy} className="w-full py-2 rounded-lg text-xs font-semibold text-red-600 border border-red-500/30 disabled:opacity-50 flex items-center justify-center gap-1.5">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />} Dispute this delivery
          </button>
          <p className="text-[10px] opacity-50">Only valid inside the on-chain dispute window; the contract reverts if it has closed.</p>
        </div>
      )}
      {status === 'COMPLETED' && <div className="text-emerald-600 dark:text-emerald-400">Settled — payment released to the provider.</div>}
      {status === 'REJECTED' && <div className="text-emerald-600 dark:text-emerald-400">Dispute resolved in your favor — you were refunded.</div>}
      {status === 'EXPIRED' && <div className="opacity-70">Expired with no settlement — you can reclaim the escrow (claimRefund).</div>}
      {error && <div className="text-red-500 whitespace-pre-wrap">{error}</div>}
    </div>
  );
}

const SESSION_STORAGE_KEY = 'altana-marketplace-session-v1';

export default function AltanaSessionPanel({ accent, surface, mutedBorder, darkMode, agent }) {
  const [wallet, setWallet] = useState(null);
  const [session, setSession] = useState(null);
  const [spendCap, setSpendCap] = useState(5);
  const [expiryHours, setExpiryHours] = useState(24);
  const [step, setStep] = useState(null); // null | 'creating_wallet' | 'granting' | 'hiring' | 'revoking' | 'error'
  const [error, setError] = useState(null);
  const [hireResult, setHireResult] = useState(null);

  // Real persisted session, matching the docs' explicit requirement to
  // "persist the Session object verbatim" for byte-exact execute later.
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved, (k, v) => (typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));
        setSession(parsed);
      } catch { /* corrupt/incompatible saved session, ignore, user re-grants */ }
    }
  }, []);

  const persistSession = (s) => {
    setSession(s);
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s, (k, v) => (typeof v === 'bigint' ? `${v}n` : v)));
  };

  const handleCreateWalletAndSession = async () => {
    setError(null);
    try {
      setStep('creating_wallet');
      const w = await getOrCreateAltanaWallet();
      setWallet(w);

      setStep('granting');
      const s = await grantMarketplaceSession(w, w.signer, { spendCapUnits: Number(spendCap), expiryHours: Number(expiryHours) });
      persistSession(s);
      setStep(null);
    } catch (e) {
      setStep('error');
      setError(e.message || String(e));
    }
  };

  const handleHire = async () => {
    if (!session || !agent?.ownerAddress) return;
    setError(null);
    setStep('hiring');
    try {
      const result = await hireAgentWithSession(session, {
        providerAddress: agent.ownerAddress,
        task: `Hire via Agents Marketplace (Altana session): ${agent.name}`,
        budgetUnits: Number(spendCap),
      });
      setHireResult(result);
      addNotification(`Job #${result.jobId} funded`, `You hired ${agent.name}. The job is now funded on-chain.`);
      trackJob(result.jobId, 'FUNDED');
      setStep(null);
    } catch (e) {
      setStep('error');
      setError(e.message || String(e));
    }
  };

  const handleRevoke = async () => {
    if (!wallet || !session) return;
    setError(null);
    setStep('revoking');
    try {
      await revokeMarketplaceSession(wallet, wallet.signer, session);
      setSession(null);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      setStep(null);
    } catch (e) {
      setStep('error');
      setError(e.message || String(e));
    }
  };

  return (
    <div className={`rounded-2xl border p-5 ${mutedBorder}`} style={{ background: surface }}>
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck size={16} style={{ color: accent }} />
        <span className="text-xs font-bold uppercase tracking-wide opacity-70">Altana Session (real, on-chain)</span>
      </div>

      {!session ? (
        <div className="space-y-3">
          <p className="text-xs opacity-60">
            This creates a real, passkey-secured Altana wallet and a genuine on-chain
            session with a real spend cap and expiry, revocable anytime, visible on the
            Altana Explorer.
          </p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] uppercase opacity-50 block mb-1">Daily Cap ($U)</label>
              <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)}
                disabled={!!step} className={`w-full p-2 rounded-lg border text-sm outline-none disabled:opacity-50 ${mutedBorder} ${darkMode ? 'bg-[#0F172A]' : 'bg-white'}`} />
            </div>
            <div className="flex-1">
              <label className="text-[10px] uppercase opacity-50 block mb-1">Expiry (hours)</label>
              <input type="number" value={expiryHours} onChange={(e) => setExpiryHours(e.target.value)}
                disabled={!!step} className={`w-full p-2 rounded-lg border text-sm outline-none disabled:opacity-50 ${mutedBorder} ${darkMode ? 'bg-[#0F172A]' : 'bg-white'}`} />
            </div>
          </div>
          <button onClick={handleCreateWalletAndSession} disabled={!!step && step !== 'error'}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
            {step === 'creating_wallet' ? 'Creating passkey wallet (biometric prompt)...' : step === 'granting' ? 'Granting session on-chain...' : 'Create Altana Wallet + Session'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className={`p-3 rounded-xl border ${mutedBorder} text-xs`}>
            <div className="flex justify-between mb-1"><span className="opacity-50">Wallet</span><span className="font-mono">{wallet?.address?.slice(0, 8)}...{wallet?.address?.slice(-6)}</span></div>
            <div className="flex justify-between mb-1"><span className="opacity-50">Spend cap</span><span className="font-semibold">{spendCap} $U / day</span></div>
            <div className="flex justify-between"><span className="opacity-50">Expires</span><span className="font-semibold">{new Date(session.expiry * 1000).toLocaleString()}</span></div>
          </div>

          <a href={explorerLinkForWallet(wallet?.address)} target="_blank" rel="noreferrer" className="text-xs underline flex items-center gap-1 opacity-70 hover:opacity-100">
            View on Altana Explorer <ExternalLink size={11} />
          </a>

          {agent && (
            <button onClick={handleHire} disabled={!!step && step !== 'error'}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
              {step === 'hiring' ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
              Hire {agent.name} through this session
            </button>
          )}

          {hireResult && (
            <>
              <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-xs">
                Job #{hireResult.jobId?.toString()} funded.
              </div>
              <JobStatusPanel wallet={wallet} jobId={hireResult.jobId} initialStatus="FUNDED" mutedBorder={mutedBorder} accent={accent} />
            </>
          )}

          <button onClick={handleRevoke} disabled={!!step && step !== 'error'}
            className="w-full py-2 rounded-xl text-xs font-semibold text-red-500 border border-red-500/30 disabled:opacity-50 flex items-center justify-center gap-1">
            <XCircle size={13} /> {step === 'revoking' ? 'Revoking on-chain...' : 'Revoke Session'}
          </button>
        </div>
      )}

      {step === 'error' && error && (
        <div className="mt-3 p-3 rounded-xl border border-red-500/30 bg-red-500/5 text-xs text-red-500 whitespace-pre-wrap">{error}</div>
      )}
    </div>
  );
}
