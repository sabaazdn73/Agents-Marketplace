// WalletConfirmStep.jsx
//
// Real, shared "is this the wallet I think it is" checkpoint — added
// 2026-08-28, the direct fix for a real, confirmed UX gap: a user with
// several identically-labeled saved passkeys had no way to tell a real,
// previously-funded wallet apart from a real, empty, orphaned one without
// a doomed real attempt first (see docs/venus-skill-revert-investigation.md
// for the full incident this traces back to).
//
// Real, deliberate placement: shown right after a real wallet is recovered
// or created, BEFORE the caller proceeds to grant a session or sign
// anything — a genuine pause, not decorative info shown while the flow
// silently continues behind it. The user must explicitly continue.
//
// Shared verbatim by web and mobile, by AltanaSkillsPanel.jsx (x402
// payments), NativeAgentMarketplace.jsx, and every direct-wallet flow —
// one component, not several copies that could drift.

import React from 'react';
import { AlertTriangle, Wallet, ExternalLink } from 'lucide-react';
import { explorerLinkForWallet } from './altana';

export default function WalletConfirmStep({ snapshot, onContinue, onTryDifferent, continueLabel = 'Continue' }) {
  if (!snapshot) return null;
  const { address, bnb, usdt, isEmpty } = snapshot;

  return (
    <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/60 dark:bg-indigo-500/5 space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
        <Wallet size={13} /> Is this the right wallet?
      </div>

      <div className="text-xs space-y-1">
        <div className="flex justify-between items-center">
          <span className="opacity-60">Address</span>
          <a href={explorerLinkForWallet(address)} target="_blank" rel="noreferrer" title={address}
            className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
            {address.slice(0, 8)}...{address.slice(-6)} <ExternalLink size={10} />
          </a>
        </div>
        <div className="flex justify-between"><span className="opacity-60">BNB balance</span><span className="font-mono font-semibold">{bnb.toLocaleString(undefined, { maximumFractionDigits: 5 })} BNB</span></div>
        <div className="flex justify-between"><span className="opacity-60">USDT balance</span><span className="font-mono font-semibold">{usdt.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</span></div>
      </div>

      {isEmpty && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-800 dark:text-amber-300 space-y-2">
          <div className="flex items-start gap-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <p>This wallet is currently empty. If you were expecting funds here, you may have picked a different saved passkey than the one you funded before. If this is intentional (a fresh wallet), here's this wallet's address to fund: <span className="font-mono break-all">{address}</span></p>
          </div>
          {onTryDifferent && (
            <button onClick={onTryDifferent} className="w-full py-1.5 rounded-lg text-[11px] font-semibold border border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10">
              Try a different saved passkey instead
            </button>
          )}
        </div>
      )}

      <button onClick={onContinue} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700">
        {isEmpty ? `${continueLabel} with this empty wallet anyway` : continueLabel}
      </button>
    </div>
  );
}
