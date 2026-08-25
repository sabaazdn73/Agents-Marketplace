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
//
// Real "does this agent's owner wallet actually do what it claims" signal
// (added 2026-08-24), for the DeFi-specific categories only — the original
// four categorize.py calls out as "the hackathon's suggested DeFi examples"
// (Rebalancing, Grid Trading, Yield Optimisation, Health Factor Monitoring),
// not the full 18-category taxonomy: a "Content & Copywriting" agent's
// wallet holding no DeFi positions is neither expected nor meaningful, so
// this signal only renders where a real DeFi position would actually be
// relevant evidence. Costs ZERO extra Zerion requests — the SAME
// no_filter positions call already returns real DeFi/protocol positions
// (position_type != "wallet", real protocol name) alongside plain token
// balances; this is purely a different way of presenting data already
// fetched for the button above, confirmed by reading the real response
// shape, not assumed.
//
// Verified against real agents already in this marketplace, not synthetic
// data: of 17 real owner wallets across the four DeFi categories, 16 had
// zero real DeFi positions and one (positioncrew-yield-optimizer.agent, a
// real "Yield Optimisation" agent) genuinely held real Venus Protocol
// deposit/loan/reward positions plus a Gomble Games reward position — both
// real states below are drawn from that real investigation, not invented.

import React, { useState } from 'react';
import { Wallet, Loader2, ChevronDown, ShieldCheck, CircleDashed } from 'lucide-react';
import { DATA_SOURCES } from './dataSources';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// Reuses dataSources.js's Zerion entry (single source of truth for the
// logo URL, real fix already applied there — see that file's comment) so
// this stays correct automatically if that URL ever needs to change again.
const ZERION_LOGO = DATA_SOURCES.find((s) => s.name === 'Zerion')?.logo;

function ZerionLogo() {
  const [failed, setFailed] = useState(false);
  if (!ZERION_LOGO || failed) return null;
  return <img src={ZERION_LOGO} alt="" width={12} height={12} onError={() => setFailed(true)} className="rounded-sm shrink-0" />;
}

// The real, original "DeFi-specific" categories — see categorize.py's own
// comment: "Original DeFi-specific set (hackathon's named examples)". Kept
// deliberately narrow rather than the full 18-category taxonomy — this
// signal is only meaningful where a real DeFi position would actually be
// relevant evidence one way or the other.
const DEFI_CATEGORIES = new Set(['Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring']);

/** Groups the real DeFi/protocol positions (position_type != "wallet") by
 * their real protocol name, e.g. {"Venus": ["deposit","loan","reward"]}. */
function groupDefiPositions(positions) {
  const byProtocol = {};
  for (const p of positions) {
    if (!p.position_type || p.position_type === 'wallet') continue;
    const key = p.protocol || 'Unknown protocol';
    if (!byProtocol[key]) byProtocol[key] = [];
    if (!byProtocol[key].includes(p.position_type)) byProtocol[key].push(p.position_type);
  }
  return byProtocol;
}

function DefiMatchSignal({ positions }) {
  const grouped = groupDefiPositions(positions);
  const protocols = Object.keys(grouped);

  if (protocols.length === 0) {
    return (
      <div className="mb-3 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 flex items-start gap-2">
        <CircleDashed size={13} className="text-gray-400 shrink-0 mt-0.5" />
        <span className="text-[11px] text-gray-500 dark:text-gray-400">No real DeFi activity found on this wallet. That's not necessarily a red flag — the agent may simply use a different wallet for its own funds.</span>
      </div>
    );
  }

  const summary = protocols.map((proto) => `${proto} (${grouped[proto].join(', ')})`).join(', ');
  return (
    <div className="mb-3 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 flex items-start gap-2">
      <ShieldCheck size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
      <span className="text-[11px] text-emerald-800 dark:text-emerald-300">This agent's owner wallet holds real DeFi positions: {summary}.</span>
    </div>
  );
}

export default function WalletPortfolioPanel({ ownerAddress, category }) {
  const [state, setState] = useState({ status: 'idle' }); // idle | loading | ready | error
  const isDefiCategory = DEFI_CATEGORIES.has(category);

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
        <Wallet size={12} /> {isDefiCategory ? 'Check real wallet activity' : 'Check full wallet portfolio'} <ChevronDown size={12} />
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
      {isDefiCategory && <DefiMatchSignal positions={positions} />}
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
      <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1.5">
        <ZerionLogo />
        Real data from Zerion, checked just now — every priced token this wallet holds on BNB Chain, not just BNB.
      </p>
    </div>
  );
}
