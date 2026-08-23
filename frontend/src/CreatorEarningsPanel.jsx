// CreatorEarningsPanel.jsx
//
// Creator dashboard, shared VERBATIM by web and mobile: real withdrawable
// earnings per token (pull-over-push withdraw), plus the creator's own listings
// with a pause/resume toggle. Earnings are fully on-chain. "Your listings" are
// the agent IDs this browser recorded when listing through the form (the
// contract has no reverse creator->agents index), so it's honestly labeled as
// "listings made from this browser".

import React, { useEffect, useState, useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { Wallet, Loader2, CheckCircle2, RefreshCw, Coins, Activity } from 'lucide-react';
import {
  MODEL, isMarketConfigured, fromRawUnits,
  useCreatorEarnings, useCreatorWrites, readAgentOffers,
} from './agentMarket';

export const MY_LISTINGS_KEY = 'aam_my_listings_v1';
const ACCENT = '#4F46E5';

export function rememberMyListing(agentId) {
  try {
    const cur = JSON.parse(localStorage.getItem(MY_LISTINGS_KEY) || '[]');
    if (!cur.includes(String(agentId))) {
      cur.push(String(agentId));
      localStorage.setItem(MY_LISTINGS_KEY, JSON.stringify(cur));
    }
  } catch { /* ignore */ }
}

export default function CreatorEarningsPanel() {
  const { isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { rows, refresh } = useCreatorEarnings();
  const { withdraw, setOfferActive, busy, error } = useCreatorWrites();
  const [listings, setListings] = useState([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [ok, setOk] = useState(null);

  const loadListings = useCallback(async () => {
    if (!isMarketConfigured() || !publicClient) { setListings([]); return; }
    let ids = [];
    try { ids = JSON.parse(localStorage.getItem(MY_LISTINGS_KEY) || '[]'); } catch { ids = []; }
    if (ids.length === 0) { setListings([]); return; }
    setLoadingListings(true);
    const out = [];
    for (const id of ids) {
      try { const offs = await readAgentOffers(publicClient, id); if (offs.length) out.push({ agentId: id, offers: offs }); } catch { /* skip */ }
    }
    setListings(out);
    setLoadingListings(false);
  }, [publicClient]);

  useEffect(() => { loadListings(); }, [loadListings]);

  if (!isMarketConfigured()) return null;

  const nonzero = rows.filter((r) => { try { return BigInt(r.balance) > 0n; } catch { return false; } });

  const onWithdraw = async (token) => {
    setOk(null);
    try { await withdraw(token); setOk('withdraw'); refresh(); } catch { /* surfaced */ }
  };
  const onToggle = async (agentId, token, active) => {
    setOk(null);
    try { await setOfferActive(agentId, token, active); loadListings(); } catch { /* surfaced */ }
  };

  return (
    <div className="mb-6 p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/30">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2"><Wallet size={15} style={{ color: ACCENT }} /><h3 className="text-sm font-bold">Your creator earnings</h3></div>
        <button onClick={() => { refresh(); loadListings(); }} className="opacity-60 hover:opacity-100" title="Refresh"><RefreshCw size={13} /></button>
      </div>

      {!isConnected ? (
        <p className="text-[11px] text-gray-500">Connect your wallet to see your withdrawable earnings and listings.</p>
      ) : (
        <>
          {/* Withdrawable earnings per token (real, on-chain, pull-over-push) */}
          {nonzero.length === 0 ? (
            <p className="text-[11px] text-gray-500">No money to withdraw yet. When someone buys your agent, your share builds up here, separately for each currency.</p>
          ) : (
            <div className="space-y-2">
              {nonzero.map((r) => (
                <div key={r.address} className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-[#1E293B] border border-gray-100 dark:border-gray-800">
                  <div className="text-sm"><span className="font-bold" style={{ color: ACCENT }}>{fromRawUnits(r.balance, 18)}</span> <span className="text-[11px] text-gray-500">{r.symbol} withdrawable</span></div>
                  <button onClick={() => onWithdraw(r.address)} disabled={busy === 'wd:' + r.address}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50 flex items-center gap-1.5" style={{ background: ACCENT }}>
                    {busy === 'wd:' + r.address ? <Loader2 size={12} className="animate-spin" /> : null} Withdraw
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Your listings (tracked from this browser) with pause/resume */}
          <div className="mt-4">
            <div className="text-[11px] font-semibold text-gray-500 mb-1.5 flex items-center gap-1.5">Your listings {loadingListings && <Loader2 size={11} className="animate-spin" />}</div>
            {listings.length === 0 ? (
              <p className="text-[11px] text-gray-400">You haven't listed anything from this device yet. When you list an agent below, it'll show up here, where you can pause or resume it anytime.</p>
            ) : (
              <div className="space-y-2">
                {listings.map((l) => (
                  <div key={l.agentId} className="p-2.5 rounded-xl bg-white dark:bg-[#1E293B] border border-gray-100 dark:border-gray-800">
                    <div className="text-xs font-bold mb-1.5">Agent #{l.agentId}</div>
                    <div className="space-y-1.5">
                      {l.offers.map((o) => (
                        <div key={o.address} className="flex items-center justify-between text-[11px]">
                          <span className="flex items-center gap-1.5">
                            {o.model === MODEL.SUBSCRIPTION ? <Activity size={11} /> : <Coins size={11} />}
                            {fromRawUnits(o.price, 18)} {o.symbol}{o.model === MODEL.SUBSCRIPTION ? ` / ${Math.round(o.period / 86400)}d` : ' one-time'}
                            <span className={o.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}>· {o.active ? 'active' : 'paused'}</span>
                          </span>
                          <button onClick={() => onToggle(l.agentId, o.address, !o.active)} disabled={busy === `of:${l.agentId}:${o.address}`}
                            className="px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 font-semibold disabled:opacity-50">
                            {busy === `of:${l.agentId}:${o.address}` ? '…' : o.active ? 'Pause' : 'Resume'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {ok === 'withdraw' && !error && <div className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> Withdrawn to your wallet.</div>}
          {error && <div className="mt-2 text-[11px] text-red-500 whitespace-pre-wrap">{error}</div>}
        </>
      )}
    </div>
  );
}
