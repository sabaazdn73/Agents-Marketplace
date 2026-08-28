// RevenueStreamPanel.jsx
//
// Real "Revenue Stream" — how much an agent has actually, verifiably
// earned as a real ERC-8183 provider, over time. See
// backend/core/revenue.py's own module docstring for the full real
// methodology: reuses the exact same on-chain job scan
// AgentMarketplaceApp's own "Past Hires" stats already fetch (zero extra
// RPC scan on the backend), sums real SUBMITTED/COMPLETED job budgets
// into a real chronological timeline, and shows the real ERC-8183
// settlement token's own symbol — read live on the backend, never
// hardcoded or guessed here.
//
// Deliberately NOT gated to Trading & DeFi — unlike PnLPanel.jsx and
// OnchainPerformancePanel.jsx (both DeFi-specific questions: "did this
// agent's real portfolio grow"), earning $U for a delivered job is a
// real, universal concept across every category. Shown for any agent
// with a real owner_address, same as the existing "Past Hires" stats
// block right above it.
//
// Auto-fetched on mount (like AgentPerformance's own "Past Hires" fetch
// right above this) — this is a real, free, already-cached backend RPC
// read, not a Zerion call, so there's no quota reason to make it opt-in.
//
// Real, honest, always-visible zero-state per the explicit real
// requirement this was built against: an agent with no real settled jobs
// shows "$0 earned yet" plainly, never hidden and never a blank/
// misleading state. Shared verbatim by web and mobile.

import React, { useEffect, useState } from 'react';
import { Coins, Loader2, TrendingUp } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

function fmtAmount(v) {
  if (v == null) return '—';
  // Real token amounts here are typically small (this marketplace's real
  // jobs so far run ~0.1–few $U) — up to 4 real decimals so a real, small
  // per-job amount doesn't round away to "0".
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmtDate(unixSeconds) {
  if (!unixSeconds) return 'date unknown';
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Real, dependency-free cumulative-earnings sparkline — this project has
// no charting library installed anywhere (checked before building this;
// PnLPanel.jsx's own "LineChart" import is just a lucide icon, not a real
// chart), and pulling one in for a single small inline visual isn't worth
// the real bundle-size cost (this app's build already warns about large
// chunks). A plain SVG polyline over the real, already-computed
// running_total values is enough to show a real growth trend at a glance.
function RevenueSparkline({ timeline }) {
  if (timeline.length < 2) return null;
  const width = 260;
  const height = 48;
  const pad = 4;
  const maxTotal = timeline[timeline.length - 1].running_total || 1;
  const points = timeline.map((t, i) => {
    const x = pad + (i / (timeline.length - 1)) * (width - pad * 2);
    const y = height - pad - (t.running_total / maxTotal) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="mt-1 mb-2">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.75" className="text-indigo-500" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function RevenueStreamPanel({ ownerAddress }) {
  const [state, setState] = useState({ status: 'loading' }); // loading | ready | error

  const load = () => {
    setState({ status: 'loading' });
    fetch(`${API_BASE_URL}/api/agents/revenue?owner_address=${ownerAddress}`)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((body) => setState({ status: 'ready', data: body }))
      .catch((e) => setState({ status: 'error', message: e.message || String(e) }));
  };

  useEffect(() => {
    if (!ownerAddress) { setState({ status: 'ready', data: null }); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerAddress]);

  if (!ownerAddress) return null;

  if (state.status === 'loading') {
    return (
      <div className="mt-3 flex items-center gap-2 text-gray-400 text-xs">
        <Loader2 size={13} className="animate-spin" /> Looking up this agent's real earnings…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
        Couldn't look up this agent's real revenue right now.
        <button onClick={load} className="text-indigo-500 hover:underline font-medium">Try again</button>
      </div>
    );
  }

  const { data } = state;

  if (!data || !data.has_earnings) {
    return (
      <div className="mt-3 p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
        <h3 className="text-sm font-bold mb-1 flex items-center gap-1.5"><Coins size={14} /> Revenue Stream</h3>
        <p className="text-[11px] text-gray-400">
          {data?.reason || 'No real completed jobs yet — $0 earned so far.'}
        </p>
      </div>
    );
  }

  const { total_earned, token_symbol, timeline, jobs_counted, scanned_window } = data;

  return (
    <div className="mt-3 p-4 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/40 dark:bg-indigo-500/5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-bold flex items-center gap-1.5"><Coins size={14} className="text-indigo-500" /> Revenue Stream</h3>
        <span className="font-mono text-lg font-bold text-indigo-600 dark:text-indigo-400">
          {fmtAmount(total_earned)} <span className="text-xs font-semibold">{token_symbol}</span>
        </span>
      </div>
      <p className="text-[10px] text-gray-400 mb-1">
        Real, verifiably earned as a provider — {jobs_counted} real delivered job{jobs_counted === 1 ? '' : 's'} (SUBMITTED or COMPLETED), based on the last {scanned_window} jobs across the whole marketplace.
      </p>

      <RevenueSparkline timeline={timeline} />

      <div className="space-y-1 max-h-40 overflow-y-auto">
        {timeline.slice().reverse().map((t) => (
          <div key={t.job_id} className="flex items-center justify-between text-[11px] py-1 border-t border-indigo-100/60 dark:border-indigo-500/10 first:border-t-0">
            <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              Job #{t.job_id} <span className="text-[10px] text-gray-400">· {fmtDate(t.submitted_at)}</span>
              {t.status === 'SUBMITTED' && (
                <span className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400" title="Delivered, not yet formally settled — an un-disputed delivery auto-resolves to completed after the review window">pending settlement</span>
              )}
            </span>
            <span className="font-mono text-gray-600 dark:text-gray-300 shrink-0">
              +{fmtAmount(t.amount)} {token_symbol} <span className="text-gray-400">→ {fmtAmount(t.running_total)}</span>
            </span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
        <TrendingUp size={10} /> Real on-chain job budgets, in the real settlement token ({token_symbol}) — no USD conversion applied.
      </p>
    </div>
  );
}
