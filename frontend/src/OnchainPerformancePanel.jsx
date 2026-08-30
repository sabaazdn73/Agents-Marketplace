// OnchainPerformancePanel.jsx
//
// Real, standalone "Historical on-chain performance" signal for a Trading
// & DeFi agent — see backend/core/onchain_pnl.py's own module docstring
// for the full real methodology. Deliberately INDEPENDENT of PnLPanel.jsx
// (which only ever looks at real jobs hired through Tnega's own Altana-
// session flow): this one looks directly at the agent's own real,
// on-chain execution history — real trades/rebalances/deposits it has
// genuinely executed, on its own wallet, whether or not that ever
// happened through this marketplace. Shown alongside PnLPanel, never
// merged into it — two real, honestly-distinct questions ("has this
// agent ever actually traded, anywhere" vs "how did a Tnega-hired session
// specifically do"). Shared verbatim by web and mobile.
//
// Deliberately opt-in (a button, not auto-fetched), same real reason as
// PnLPanel.jsx/WalletPortfolioPanel.jsx: Zerion's real, measured tier is
// 300 requests/day, and a single real check here can cost up to 3 real
// Zerion calls (activity + portfolio + chart) — only spent when someone
// actually opens this agent's detail page and asks.
//
// Real, honest attribution-confidence labeling, always shown — see
// backend/core/onchain_pnl.py's own module docstring for exactly what
// "high" vs "unconfirmed" means. Never presented as a certain number
// without that label alongside it.

import React, { useState } from 'react';
import { History, Loader2, ChevronDown, TrendingUp, TrendingDown, ShieldCheck, ShieldQuestion, AlertTriangle } from 'lucide-react';
import { groupForCategory } from './categoryGroups';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const PNL_ELIGIBLE_GROUP = 'trading-defi';

function fmtUsd(v) {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function ConfidenceBadge({ confidence }) {
  if (confidence === 'high') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
        <ShieldCheck size={10} /> High confidence
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400">
      <ShieldQuestion size={10} /> Unconfirmed attribution
    </span>
  );
}

export default function OnchainPerformancePanel({ ownerAddress, category }) {
  const [state, setState] = useState({ status: 'idle' }); // idle | loading | ready | error

  const load = async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch(`${API_BASE_URL}/api/agents/onchain-performance?owner_address=${ownerAddress}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setState({ status: 'ready', data: body });
    } catch (e) {
      setState({ status: 'error', message: e.message || String(e) });
    }
  };

  // Real, same gating pattern as PnLPanel.jsx — this section doesn't
  // exist at all outside Trading & DeFi. The backend independently
  // re-checks this same real eligibility, never trusted from the client
  // alone.
  if (!ownerAddress || groupForCategory(category) !== PNL_ELIGIBLE_GROUP) {
    return null;
  }

  if (state.status === 'idle') {
    return (
      <button
        onClick={load}
        className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
      >
        <History size={12} /> Check real, independent on-chain history <ChevronDown size={12} />
      </button>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="mt-2 flex items-center justify-center gap-1.5 py-2 text-[11px] text-gray-400">
        <Loader2 size={12} className="animate-spin" /> Scanning this agent's own real on-chain history…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mt-2 flex items-center justify-between gap-2 py-2 px-3 rounded-xl text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-800/40">
        <span>Couldn't check real on-chain history right now ({state.message}).</span>
        <button onClick={load} className="text-indigo-500 hover:underline shrink-0">Retry</button>
      </div>
    );
  }

  // ready
  const { data } = state;
  if (!data.applicable) {
    return <p className="mt-2 text-[11px] text-gray-400">{data.reason}</p>;
  }

  if (!data.has_activity) {
    return (
      <div className="mt-2 p-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
        <p className="text-[11px] text-gray-400">{data.reason || "No real, attributable on-chain execution history found for this agent yet."}</p>
      </div>
    );
  }

  const pnl = data.pnl;
  const positive = pnl && pnl.pnl_usd >= 0;

  return (
    <div className="mt-2 p-3 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/40 dark:bg-indigo-500/5">
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
          <History size={12} className="text-indigo-500" /> Historical on-chain performance
        </span>
        <ConfidenceBadge confidence={data.attribution_confidence} />
      </div>

      <p className="text-[10px] text-gray-400 mb-2">{data.wallet_source}</p>

      {/* Real, honest, always-truthful evidence line — never implies more
          history than what was actually checked. */}
      <p className="text-[11px] text-gray-600 dark:text-gray-300 mb-2">
        Found <strong>{data.defi_tx_count}</strong> real, on-chain DeFi transaction{data.defi_tx_count === 1 ? '' : 's'} on
        {data.defi_protocols?.length > 0 && <> real {data.defi_protocols.join(', ')}</>} — independent of whether it happened through Tnega.
        {data.window_capped_at_50_most_recent_transactions && ' (based on the most recent 50 real transactions on this wallet — it may have real history beyond that.)'}
      </p>

      {data.defi_positions?.length > 0 && (
        <div className="mb-2 p-2 rounded-lg bg-white/60 dark:bg-white/5 border border-indigo-100 dark:border-indigo-500/10">
          <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Real, current DeFi positions:</p>
          {data.defi_positions.map((p, i) => (
            <div key={i} className="flex items-center justify-between text-[11px]">
              <span className="text-gray-600 dark:text-gray-300">{p.symbol || '?'} <span className="text-[9px] uppercase text-gray-400">({p.position_type}{p.protocol ? ` · ${p.protocol}` : ''})</span></span>
              <span className="font-mono text-gray-500 dark:text-gray-400">{p.usd_value != null ? `$${p.usd_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}</span>
            </div>
          ))}
        </div>
      )}

      {pnl ? (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-indigo-100 dark:border-indigo-500/10">
          <span className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
            {positive ? <TrendingUp size={12} className="text-emerald-500" /> : <TrendingDown size={12} className="text-red-500" />}
            real ${pnl.start_value_usd?.toFixed(2)} → ${pnl.end_value_usd?.toFixed(2)}
            {pnl.gas_usd > 0 && <> · gas −${pnl.gas_usd.toFixed(2)}{!pnl.gas_complete && '+'}</>}
          </span>
          <span className={`font-mono text-sm font-bold shrink-0 ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
            {fmtUsd(pnl.pnl_usd)}
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-1.5 pt-2 border-t border-indigo-100 dark:border-indigo-500/10">
          <AlertTriangle size={11} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[10px] text-gray-400">{data.pnl_reason || "Found real activity, but couldn't compute a real value change for it yet."}</p>
        </div>
      )}

      {/* Real, independent second PnL signal (2026-08-30) — Zerion's own
          dedicated FIFO cost-basis calculation over the same real window,
          deliberately shown SEPARATE from the number above rather than
          replacing it: the two use genuinely different real methodologies
          and can legitimately disagree for a wallet with real in-window
          trading — showing both, clearly labeled, is more honest than
          picking one. */}
      {data.zerion_pnl?.available && (
        <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t border-dashed border-indigo-100 dark:border-indigo-500/10">
          <span className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1" title={data.zerion_pnl.methodology}>
            Zerion's own PnL (FIFO cost basis) — a second, independent number
          </span>
          <span className={`font-mono text-sm font-bold shrink-0 ${data.zerion_pnl.total_pnl_usd >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
            {fmtUsd(data.zerion_pnl.total_pnl_usd)}
          </span>
        </div>
      )}
    </div>
  );
}
