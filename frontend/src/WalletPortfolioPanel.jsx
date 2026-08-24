// WalletPortfolioPanel.jsx
//
// Real, OPT-IN wallet portfolio enrichment for the agent detail page —
// every real token an agent's owner wallet holds on BSC, with real USD
// values (via Zerion, see backend/adapters/zerion.py). Shared verbatim by
// web and mobile.
//
// Deliberately opt-in (a button, not auto-fetched on page load): our real,
// measured Zerion tier is 300 requests/day — nowhere near enough to enrich
// every agent card on every page view, so this only ever spends one of
// those requests when someone actually opens one specific agent's detail
// page and asks to see more. The free, unlimited native-BNB balance next to
// this button (bsc_balance.py, already shown for every agent) stays exactly
// as the default — this only supplements it on request.

import React, { useState } from 'react';
import { Wallet, Loader2, ChevronDown } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export default function WalletPortfolioPanel({ ownerAddress }) {
  const [state, setState] = useState({ status: 'idle' }); // idle | loading | ready | error

  const load = async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch(`${API_BASE_URL}/api/agents/wallet-portfolio?owner_address=${ownerAddress}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!body.available) {
        setState({ status: 'error', message: body.reason || "couldn't load it right now" });
        return;
      }
      setState({ status: 'ready', data: body });
    } catch (e) {
      setState({ status: 'error', message: e.message || String(e) });
    }
  };

  if (!ownerAddress) return null;

  if (state.status === 'idle') {
    return (
      <button
        onClick={load}
        className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
      >
        <Wallet size={12} /> Check full wallet portfolio <ChevronDown size={12} />
      </button>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="mt-2 flex items-center justify-center gap-1.5 py-2 text-[11px] text-gray-400">
        <Loader2 size={12} className="animate-spin" /> Checking every token this wallet holds…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mt-2 flex items-center justify-between gap-2 py-2 px-3 rounded-xl text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-800/40">
        <span>Couldn't check the full portfolio right now ({state.message}).</span>
        <button onClick={load} className="text-indigo-500 hover:underline shrink-0">Retry</button>
      </div>
    );
  }

  // ready
  const { total_usd_value: totalUsd, positions } = state.data;
  return (
    <div className="mt-2 p-3 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/40 dark:bg-indigo-500/5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Full wallet portfolio</span>
        <span className="text-[11px] font-mono font-semibold">${totalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
      </div>
      {positions.length === 0 ? (
        <p className="text-[11px] text-gray-400">No priced tokens found in this wallet on BSC right now.</p>
      ) : (
        <div className="space-y-1">
          {positions.map((p, i) => (
            <div key={i} className="flex items-center justify-between text-[11px]">
              <span className="text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                {p.symbol || '?'}
                {p.position_type && p.position_type !== 'wallet' && (
                  <span className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300">{p.position_type}</span>
                )}
              </span>
              <span className="font-mono text-gray-500 dark:text-gray-400">
                {p.usd_value != null ? `$${p.usd_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-gray-400 mt-2">Real data from Zerion, checked just now — every priced token this wallet holds on BNB Chain, not just BNB.</p>
    </div>
  );
}
