// BuyAccessPanel.jsx
//
// Buyer-side purchase/subscribe UI for the agent detail page, shared VERBATIM
// by web and mobile. Renders only for agents that have at least one real
// on-chain offer. When a creator has priced the agent in several accepted
// tokens, the BUYER picks which token to pay with (no swap — each offer is a
// fixed price in one token). All logic is in agentMarket.js.

import React, { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, Coins, Activity } from 'lucide-react';
import { useAccount } from 'wagmi';
import {
  MODEL, isMarketConfigured, fromRawUnits,
  useOffers, useHasAccess, useBuyAccess, useFeeBps, splitByFee, buildBuyStepList,
} from './agentMarket';
import StepChecklist from './StepChecklist';

const ACCENT = '#4F46E5';

export default function BuyAccessPanel({ agentId }) {
  const { isConnected } = useAccount();
  const { offers, refresh: refreshOffers } = useOffers(agentId);
  const { access, refresh: refreshAccess } = useHasAccess(agentId);
  const { buy, busy, step, error, completedSteps, skippedSteps, stepHashes } = useBuyAccess();
  const { feeBps, feePct } = useFeeBps();
  const [sel, setSel] = useState(0);
  const [ok, setOk] = useState(false);

  useEffect(() => { if (sel > offers.length - 1) setSel(0); }, [offers.length, sel]);

  if (!isMarketConfigured() || !agentId || offers.length === 0) return null;

  const offer = offers[sel] || offers[0];
  const isSub = offer.model === MODEL.SUBSCRIPTION;
  const priceStr = fromRawUnits(offer.price, 18);
  const { fee, creatorGets } = splitByFee(offer.price, feeBps);

  const onBuy = async () => {
    setOk(false);
    try {
      await buy({ agentId, token: offer.address, native: offer.native, model: offer.model, priceRaw: offer.price });
      setOk(true); refreshAccess(); refreshOffers();
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

      {hasAccess && (
        <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mb-2">
          <CheckCircle2 size={14} /> You have access{isSub && expiryStr ? ` — expires ${expiryStr}` : ' (permanent license)'}.
        </div>
      )}

      {/* Buyer picks which accepted token to pay with (one tab per offer). */}
      {offers.length > 1 && (
        <div className="flex gap-2 mb-3">
          {offers.map((o, i) => (
            <button key={o.address} onClick={() => setSel(i)}
              className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold ${i === sel ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' : 'border-gray-200 dark:border-gray-700 text-gray-500'}`}>
              {o.symbol}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-bold text-lg" style={{ color: ACCENT }}>{priceStr} {offer.symbol}</span>
          <span className="text-[11px] text-gray-500">{isSub ? ` / ${Math.round(offer.period / 86400)} days` : ' one-time'}</span>
        </div>
        <button onClick={onBuy} disabled={!isConnected || busy || !offer.active}
          className="px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center gap-2" style={{ background: ACCENT }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {error ? 'Retry' : busy ? 'Confirm in wallet…' : isSub ? (hasAccess ? 'Renew' : 'Subscribe') : 'Buy license'}
        </button>
      </div>

      {/* Real step checklist — same buildBuyStepList/StepChecklist pattern
          as the hire flow, driven straight from useBuyAccess's own state.
          Shown once a purchase attempt has actually started. */}
      {step && (
        <div className="mt-3 p-3 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-white/50 dark:bg-black/10">
          <StepChecklist steps={buildBuyStepList({
            step, completedSteps, skippedSteps, stepHashes, error, amount: priceStr, symbol: offer.symbol,
          })} />
        </div>
      )}

      {/* Real, on-chain-sourced breakdown from the live feeBps. */}
      {feeBps != null && (
        <div className="mt-3 pt-3 border-t border-indigo-100 dark:border-indigo-500/20 text-[11px] space-y-1">
          <div className="flex justify-between"><span className="text-gray-500">Total price</span><span className="font-mono">{priceStr} {offer.symbol}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Platform fee ({feePct}%)</span><span className="font-mono">{fee != null ? fromRawUnits(fee, 18) : '—'} {offer.symbol}</span></div>
          <div className="flex justify-between font-semibold"><span className="text-gray-600 dark:text-gray-300">Creator receives</span><span className="font-mono">{creatorGets != null ? fromRawUnits(creatorGets, 18) : '—'} {offer.symbol}</span></div>
          <p className="text-[10px] text-gray-400 pt-1">The {feePct}% platform fee keeps this marketplace running (a hackathon project); everything else goes straight to the creator. This % is read live from the contract, so it's always the real current rate.</p>
        </div>
      )}

      {!offer.active && <div className="text-[11px] text-gray-400 mt-2">The creator has paused this offer.</div>}
      {!isConnected && <div className="text-[11px] text-gray-400 mt-2">Connect your wallet to purchase.</div>}
      {ok && !error && <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-2">Purchase confirmed on-chain.</div>}
      {error && <div className="text-[11px] text-red-500 mt-2 whitespace-pre-wrap">{error}</div>}
    </div>
  );
}
