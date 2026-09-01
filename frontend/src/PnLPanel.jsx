// PnLPanel.jsx
//
// Real, on-chain-balance Profit & Loss for a Trading & DeFi agent's own
// real, Altana-session-managed jobs — see backend/core/pnl.py's own module
// docstring for the full real methodology (Zerion real balance charts at
// job start/end, minus real gas costs). Shared verbatim by web and mobile.
//
// Deliberately opt-in (a button, not auto-fetched), same real reason as
// WalletPortfolioPanel.jsx: Zerion's real, measured tier is 300
// requests/day, and this can cost several real requests per agent (a
// chart + a fee lookup per real qualifying job, up to
// MAX_JOBS_PER_SUMMARY of them) — only spent when someone actually opens
// this agent's detail page and asks.
//
// Real, deliberate label, per the explicit real requirement this was
// built against: this is "Live/Forward-tested PnL, measured from real
// on-chain balances during an actual hire" — a creator's own claimed
// backtest or historical return is NEVER shown here, and never could be;
// there is no code path in this component that accepts or renders
// anything a creator submitted. Every number on screen traces to a real
// Zerion API response for a real, specific, already-completed job.

import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Loader2, ChevronDown, LineChart, AlertTriangle } from 'lucide-react';
import { groupForCategory } from './categoryGroups';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// The one, real category group PnL is a coherent question for — reuses
// categoryGroups.js's own real grouping (never a separately-hardcoded
// category list here, which would be a real, avoidable third copy of the
// same mapping already shared once between the frontend's own filter
// chips and backend/core/category_groups.py).
const PNL_ELIGIBLE_GROUP = 'trading-defi';

function fmtUsd(v) {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function JobRow({ job }) {
  if (!job.available) {
    return (
      <div className="flex items-start gap-2 text-[11px] py-1.5 border-t border-gray-100 dark:border-gray-800 first:border-t-0">
        <AlertTriangle size={11} className="text-gray-400 shrink-0 mt-0.5" />
        <span className="text-gray-400">Job #{job.job_id}: {job.reason}</span>
      </div>
    );
  }
  const positive = job.pnl_usd >= 0;
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] py-1.5 border-t border-gray-100 dark:border-gray-800 first:border-t-0">
      <span className="text-gray-500 dark:text-gray-400">
        Job #{job.job_id} · real {job.start_value_usd != null ? `$${job.start_value_usd.toFixed(2)}` : '—'} → {job.end_value_usd != null ? `$${job.end_value_usd.toFixed(2)}` : '—'}
        {job.gas_usd > 0 && <> · gas −${job.gas_usd.toFixed(2)}{!job.gas_complete && '+'}</>}
      </span>
      <span className={`font-mono font-semibold shrink-0 ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
        {fmtUsd(job.pnl_usd)}
      </span>
    </div>
  );
}

export default function PnLPanel({ ownerAddress, category }) {
  const [state, setState] = useState({ status: 'idle' }); // idle | loading | ready | error

  const load = async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch(`${API_BASE_URL}/api/agents/pnl-summary?owner_address=${ownerAddress}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setState({ status: 'ready', data: body });
    } catch (e) {
      setState({ status: 'error', message: e.message || String(e) });
    }
  };

  // Real, requirement-#1 gate: this section doesn't exist at all for a
  // category where real PnL isn't a coherent question — no button, no
  // placeholder, nothing to click on by mistake. The backend re-checks
  // this same real eligibility independently (never trusts this
  // client-side check alone), but gating here too means an agent this
  // clearly doesn't apply to never even shows the option.
  if (!ownerAddress || groupForCategory(category) !== PNL_ELIGIBLE_GROUP) {
    return null;
  }

  if (state.status === 'idle') {
    return (
      <button
        onClick={load}
        className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
      >
        <LineChart size={12} /> Check on-chain PnL <ChevronDown size={12} />
      </button>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="mt-2 flex items-center justify-center gap-1.5 py-2 text-[11px] text-gray-400">
        <Loader2 size={12} className="animate-spin" /> Comparing real on-chain balances…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mt-2 flex items-center justify-between gap-2 py-2 px-3 rounded-xl text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-800/40">
        <span>Couldn't check real PnL right now ({state.message}).</span>
        <button onClick={load} className="text-indigo-500 hover:underline shrink-0">Retry</button>
      </div>
    );
  }

  // ready
  const { data } = state;
  if (!data.applicable) {
    // Real, honest edge case: the backend's own eligibility check
    // disagreed with the client-side one above (e.g. a category rename
    // this component's own gate hasn't been updated for) — say so
    // plainly rather than showing a broken panel.
    return <p className="mt-2 text-[11px] text-gray-400">{data.reason}</p>;
  }

  if (!data.jobs || data.jobs.length === 0) {
    return (
      <div className="mt-2 p-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
        <p className="text-[11px] text-gray-400">{data.reason || 'No real, PnL-eligible jobs found for this agent yet.'}</p>
      </div>
    );
  }

  const positive = data.total_pnl_usd != null && data.total_pnl_usd >= 0;
  return (
    <div className="mt-2 p-3 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/40 dark:bg-indigo-500/5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
          {positive ? <TrendingUp size={12} className="text-emerald-500" /> : <TrendingDown size={12} className="text-red-500" />}
          Live PnL, real on-chain jobs
        </span>
        {data.total_pnl_usd != null && (
          <span className={`text-sm font-mono font-bold ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
            {fmtUsd(data.total_pnl_usd)}
          </span>
        )}
      </div>
      {/* The one, real, required label — see this file's own header. */}
      <p className="text-[10px] text-gray-400 mb-2">
        Live/forward-tested PnL, measured from real on-chain balances during {data.jobs.filter((j) => j.available).length > 1 ? 'actual hires' : 'an actual hire'} —
        never a creator-submitted or backtested number.
      </p>
      <div>
        {data.jobs.map((j) => <JobRow key={j.job_id} job={j} />)}
      </div>
      {data.reason && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2">{data.reason}</p>}
    </div>
  );
}
