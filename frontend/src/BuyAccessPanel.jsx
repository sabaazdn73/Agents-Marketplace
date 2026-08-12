// BuyAccessPanel.jsx
//
// Buyer-side purchase/subscribe UI for the agent detail page, shared VERBATIM
// by web and mobile. Renders only for agents that have a real on-chain listing
// (so it stays out of the way for the ~all agents that aren't listed for direct
// sale). All logic is in agentMarket.js.

import React, { useState } from 'react';
import { CheckCircle2, Loader2, Coins, Activity } from 'lucide-react';
import { useAccount } from 'wagmi';
import {
  MODEL, isMarketConfigured, fromRawUnits,
  useListing, useHasAccess, useBuyAccess, useFeeBps, splitByFee,
} from './agentMarket';

const ACCENT = '#4F46E5';

export default function BuyAccessPanel({ agentId }) {
  const { isConnected } = useAccount();
  const { listing, refresh: refreshListing } = useListing(agentId);
  const { access, refresh: refreshAccess } = useHasAccess(agentId);
  const { buy, busy, step, error } = useBuyAccess();
  const { feeBps, feePct } = useFeeBps();
  const [ok, setOk] = useState(false);

  // Nothing to show unless the contract is live AND this agent is actually listed.
  if (!isMarketConfigured() || !agentId || !listing || !listing.exists) return null;

  const isSub = listing.model === MODEL.SUBSCRIPTION;
  const priceStr = fromRawUnits(listing.price, 18);
  // Real breakdown from the LIVE on-chain feeBps — never estimated/hardcoded.
  const { fee, creatorGets } = splitByFee(listing.price, feeBps);

  const onBuy = async () => {
    setOk(false);
    try {
      await buy({ agentId, model: listing.model, priceRaw: listing.price });
      setOk(true);
      refreshAccess(); refreshListing();
    } catch { /* surfaced via hook */ }
  };

  const hasAccess = access?.hasAccess;
  const expiryStr = access?.expiry && access.expiry < 2_000_000_000_000
    ? new Date(access.expiry * 1000).toLocaleDateString() : null;

  return (
    <div className="mt-6 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/50 dark:bg-indigo-500/5">
      <div className="flex items-center gap-2 mb-2">
        {isSub ? <Activity size={15} style={{ color: ACCENT }} /> : <Coins size={15} style={{ color: ACCENT }} />}
        <h3 className="text-sm font-bold">{isSub ? 'Subscribe to this agent' : 'Buy access to this agent'}</h3>
      </div>

      {hasAccess ? (
        <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mb-2">
          <CheckCircle2 size={14} /> You have access{isSub && expiryStr ? ` — renews/expires ${expiryStr}` : ' (permanent license)'}.
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-bold text-lg" style={{ color: ACCENT }}>{priceStr} $U</span>
          <span className="text-[11px] text-gray-500">{isSub ? ` / ${Math.round(listing.period / 86400)} days` : ' one-time'}</span>
        </div>
        <button onClick={onBuy} disabled={!isConnected || busy || !listing.active}
          className="px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center gap-2" style={{ background: ACCENT }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {step === 'approving' ? 'Approving…' : step === 'buying' ? 'Confirming…' : isSub ? (hasAccess ? 'Renew' : 'Subscribe') : 'Buy license'}
        </button>
      </div>

      {/* Real, on-chain-sourced price breakdown (from live feeBps). */}
      {feeBps != null && (
        <div className="mt-3 pt-3 border-t border-indigo-100 dark:border-indigo-500/20 text-[11px] space-y-1">
          <div className="flex justify-between"><span className="text-gray-500">Total price</span><span className="font-mono">{priceStr} $U</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Platform fee ({feePct}%)</span><span className="font-mono">{fee != null ? fromRawUnits(fee, 18) : '—'} $U</span></div>
          <div className="flex justify-between font-semibold"><span className="text-gray-600 dark:text-gray-300">Creator receives</span><span className="font-mono">{creatorGets != null ? fromRawUnits(creatorGets, 18) : '—'} $U</span></div>
          <p className="text-[10px] text-gray-400 pt-1">The {feePct}% platform fee keeps this marketplace running (a hackathon project); everything else goes straight to the creator. This % is read live from the contract, so it's always the real current rate.</p>
        </div>
      )}

      {!listing.active && <div className="text-[11px] text-gray-400 mt-2">The creator has paused sales for this listing.</div>}
      {!isConnected && <div className="text-[11px] text-gray-400 mt-2">Connect your wallet to purchase.</div>}
      {ok && !error && <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-2">Purchase confirmed on-chain.</div>}
      {error && <div className="text-[11px] text-red-500 mt-2 whitespace-pre-wrap">{error}</div>}
    </div>
  );
}
