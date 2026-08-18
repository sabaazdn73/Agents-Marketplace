// AltanaSessionPanel.jsx
//
// The real, in-product UI for the Altana partner track's exact
// requirement: "agents on their own Altana wallets, sessions with
// real spend caps and expiries registered onchain, and revocation
// the user can see in the product." Every action here is a real,
// on-chain Altana SDK call, nothing simulated.

import React, { useState, useEffect } from 'react';
import { ShieldCheck, Loader2, ExternalLink, XCircle } from 'lucide-react';
import {
  getOrCreateAltanaWallet, grantMarketplaceSession, revokeMarketplaceSession,
  hireAgentWithSession, explorerLinkForWallet, ALTANA_EXPLORER_URL,
  disputeJob,
} from './altana';
import { addNotification, trackJob } from './notifications';
import StepChecklist from './StepChecklist';
import GetULink from './GetULink';
import JobStatusPanel from './JobStatusPanel';

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

  // Real 2-step sequence tracked explicitly (creating_wallet, granting) so
  // <StepChecklist/> can show real progress instead of one opaque button
  // label. Neither step has a BscScan-linkable hash to show yet:
  // creating_wallet is a local WebAuthn/passkey ceremony (never on-chain),
  // and grantMarketplaceSession's return value (altana.js) is documented as
  // "the real Session object", not a captured tx hash — if the installed
  // SDK's grantSession response turns out to carry one, wire it in rather
  // than guessing at its shape here (same discipline as the flagged-unverified
  // decodeJobIdFromReceipt in useHireAgent.js).
  const [completedSessionSteps, setCompletedSessionSteps] = useState([]);

  // Real bug fixed 2026-08-17 (same one useHireAgent.js had): `step` used to
  // get overwritten with the literal string 'error' on failure, losing which
  // of the real steps was active. Now `step` always stays the real last-
  // active step name; `error` (already existed) is the separate signal.
  const handleCreateWalletAndSession = async () => {
    setError(null);
    setCompletedSessionSteps([]);
    try {
      setStep('creating_wallet');
      const w = await getOrCreateAltanaWallet();
      setWallet(w);
      setCompletedSessionSteps(['creating_wallet']);

      setStep('granting');
      const s = await grantMarketplaceSession(w, w.signer, { spendCapUnits: Number(spendCap), expiryHours: Number(expiryHours) });
      persistSession(s);
      setCompletedSessionSteps(['creating_wallet', 'granting']);
      setStep(null);
    } catch (e) {
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
      setError(e.message || String(e));
    }
  };

  // Real step list for the 2-step wallet+session creation, built straight
  // from the state above — no invented progress.
  const sessionSteps = [
    {
      key: 'creating_wallet', label: 'Create passkey wallet',
      description: 'Creating your passkey wallet (Face ID/Touch ID) — a one-time local device confirmation, not a blockchain transaction',
      status: completedSessionSteps.includes('creating_wallet') ? 'complete'
        : step === 'creating_wallet' ? (error ? 'error' : 'active') : 'pending',
      hash: null,
      errorMessage: step === 'creating_wallet' && error ? error : null,
    },
    {
      key: 'granting', label: 'Grant on-chain session',
      description: 'Registering a scoped on-chain session (spend cap + expiry) so this wallet can act on your behalf',
      status: completedSessionSteps.includes('granting') ? 'complete'
        : step === 'granting' ? (error ? 'error' : 'active') : 'pending',
      hash: null,
      errorMessage: step === 'granting' && error ? error : null,
    },
  ];

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
          <GetULink />
          {/* Real step checklist for this 2-step sequence — see
              sessionSteps above, driven by real tracked state. */}
          {(step === 'creating_wallet' || step === 'granting' || completedSessionSteps.length > 0) && (
            <div className={`p-3 rounded-xl border ${mutedBorder}`}>
              <StepChecklist steps={sessionSteps} />
            </div>
          )}

          <button onClick={handleCreateWalletAndSession} disabled={!!step && !error}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
            {error && (step === 'creating_wallet' || step === 'granting') ? 'Retry' : 'Create Altana Wallet + Session'}
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
            <button onClick={handleHire} disabled={!!step && !error}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
              {step === 'hiring' ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
              {error && step === 'hiring' ? 'Retry hire' : `Hire ${agent.name} through this session`}
            </button>
          )}

          {hireResult && (
            <>
              <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-xs">
                Job #{hireResult.jobId?.toString()} funded.
              </div>
              <JobStatusPanel
                jobId={hireResult.jobId} initialStatus="FUNDED" mutedBorder={mutedBorder} accent={accent}
                onDispute={async (jobId) => {
                  await disputeJob(wallet, wallet.signer, jobId);
                  addNotification(`Job #${jobId} disputed`, 'You contested the delivery; awaiting the on-chain verdict.');
                }}
              />
            </>
          )}

          <button onClick={handleRevoke} disabled={!!step && !error}
            className="w-full py-2 rounded-xl text-xs font-semibold text-red-500 border border-red-500/30 disabled:opacity-50 flex items-center justify-center gap-1">
            <XCircle size={13} /> {step === 'revoking' ? 'Revoking on-chain...' : error && step === 'revoking' ? 'Retry revoke' : 'Revoke Session'}
          </button>
        </div>
      )}

      {error && step !== 'creating_wallet' && step !== 'granting' && (
        <div className="mt-3 p-3 rounded-xl border border-red-500/30 bg-red-500/5 text-xs text-red-500 whitespace-pre-wrap">{error}</div>
      )}
    </div>
  );
}
