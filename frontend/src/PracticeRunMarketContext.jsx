// PracticeRunMarketContext.jsx
//
// Real market context for one Practice Mode run — see skillMarketContext.js
// for the real, per-skill-type data sources and the honest reasoning behind
// what is and isn't shown for each. This component just fetches (via that
// module) and renders: a real price chart for trading/liquidity skills, a
// real current rate for lending/staking skills, or a real current
// bonding-curve price for four.meme — never a fabricated trend where a real
// one doesn't exist.
//
// A tiny hand-rolled SVG line, not a charting library — no chart package is
// installed in this project, and pulling one in for a single sparkline-style
// line felt like the wrong tradeoff for what's needed here.

import React, { useState, useEffect } from 'react';
import { Loader2, TrendingUp, Percent, Activity } from 'lucide-react';
import { getMainnetReadClient } from './altana';
import {
  getPancakeswapPriceHistory, getVenusCurrentRate, getAaveCurrentRate,
  getListaCurrentRate, getFourMemeCurrentStatus, MARKET_CONTEXT_KIND,
} from './skillMarketContext';

function Sparkline({ points, accent }) {
  if (!points || points.length < 2) return null;
  // Fixed-size viewBox coordinate math, but the SVG itself scales to
  // whatever real width its container gives it (width="100%") — fixed at
  // exactly 280px, this genuinely overflowed narrower mobile screens
  // (~320-375px wide minus real padding); percentage width fixes that for
  // both platforms, not just a mobile-specific patch.
  const w = 280, h = 56, pad = 4;
  const closes = points.map((p) => p.close);
  const min = Math.min(...closes), max = Math.max(...closes);
  const range = max - min || max || 1;
  const x = (i) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v) => pad + (1 - (v - min) / range) * (h - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join(' ');
  const up = closes[closes.length - 1] >= closes[0];
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
      <path d={path} fill="none" stroke={up ? '#10B981' : '#EF4444'} strokeWidth="1.75" />
    </svg>
  );
}

function ChartContext({ tokenAddress, secondToken, accent }) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = getMainnetReadClient();
        const result = secondToken
          ? await getPancakeswapPriceHistory(client, tokenAddress, { against: secondToken })
          : await getPancakeswapPriceHistory(client, tokenAddress);
        if (!cancelled) setState(result ? { status: 'ok', ...result } : { status: 'no-pool' });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: e.message || String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [tokenAddress, secondToken]);

  if (state.status === 'loading') return <div className="flex items-center gap-1.5 text-[11px] opacity-60"><Loader2 size={11} className="animate-spin" /> Loading the price chart for this token…</div>;
  if (state.status === 'no-pool') return <p className="text-[11px] opacity-60">This token isn't trading anywhere yet, so there's no price chart to show.</p>;
  if (state.status === 'error') return <p className="text-[11px] opacity-50">Couldn't load a price chart right now ({state.message}).</p>;

  const first = state.points[0].close, last = state.points[state.points.length - 1].close;
  const pctChange = first ? ((last - first) / first) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] opacity-60 flex items-center gap-1"><TrendingUp size={11} /> Market price around when you made this practice trade</span>
        <span className={`text-[11px] font-semibold ${pctChange >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{pctChange >= 0 ? '+' : ''}{pctChange.toFixed(2)}% (24h)</span>
      </div>
      <Sparkline points={state.points} accent={accent} />
    </div>
  );
}

function RateContext({ skillId }) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = getMainnetReadClient();
        let result;
        if (skillId === 'venus-lending') result = await getVenusCurrentRate(client);
        else if (skillId === 'aave-v3-lending') result = await getAaveCurrentRate(client);
        else if (skillId === 'lista-staking') result = await getListaCurrentRate(client);
        if (!cancelled) setState(result ? { status: 'ok', ...result } : { status: 'unavailable' });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: e.message || String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [skillId]);

  if (state.status === 'loading') return <div className="flex items-center gap-1.5 text-[11px] opacity-60"><Loader2 size={11} className="animate-spin" /> Checking the current rate…</div>;
  if (state.status === 'error' || state.status === 'unavailable') return <p className="text-[11px] opacity-50">Couldn't check the current rate right now{state.message ? ` (${state.message})` : ''}.</p>;

  return (
    <div className="text-[11px] space-y-1">
      <div className="flex items-center gap-1.5 opacity-60"><Percent size={11} /> Current rate, checked just now (we don't have a history of past rates to show)</div>
      {'apyPct' in state && <div className="font-semibold" style={{ fontSize: 13 }}>{state.apyPct.toFixed(2)}% per year</div>}
      {'bnbPerSlisBnb' in state && <div className="font-semibold" style={{ fontSize: 13 }}>1 slisBNB = {state.bnbPerSlisBnb.toFixed(4)} BNB</div>}
      <p className="opacity-50">This isn't a trade price — it's the actual interest rate (or exchange rate) this practice position is earning right now, checked live.</p>
    </div>
  );
}

function CurveContext({ tokenAddress }) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = getMainnetReadClient();
        const result = await getFourMemeCurrentStatus(client, tokenAddress);
        if (!cancelled) setState({ status: 'ok', ...result });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: e.message || String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [tokenAddress]);

  if (state.status === 'loading') return <div className="flex items-center gap-1.5 text-[11px] opacity-60"><Loader2 size={11} className="animate-spin" /> Checking the current price…</div>;
  if (state.status === 'error') return <p className="text-[11px] opacity-50">Couldn't check the current price right now ({state.message}).</p>;

  return (
    <div className="text-[11px] space-y-1">
      <div className="flex items-center gap-1.5 opacity-60"><Activity size={11} /> Current price, checked just now</div>
      <div className="font-semibold" style={{ fontSize: 13 }}>{state.progressPct.toFixed(1)}% of the way to being tradeable on PancakeSwap</div>
      <p className="opacity-50">This token isn't listed on an exchange yet, so there's no price history to chart — this progress number is the best real signal we have for it right now.</p>
    </div>
  );
}

/** inputs is the real, saved practice_runs.result.inputs for this run —
 * the actual form values submitted, verbatim. */
export default function PracticeRunMarketContext({ skillId, inputs, accent }) {
  const kind = MARKET_CONTEXT_KIND[skillId];
  if (!kind || !inputs) return null;

  if (kind === 'chart') {
    const tokenAddress = skillId === 'pancakeswap-liquidity'
      ? (inputs.tokenA?.toLowerCase() === '0x55d398326f99059ff775485246999027b3197955' ? inputs.tokenB : inputs.tokenA)
      : inputs.token;
    if (!tokenAddress) return null;
    return <ChartContext tokenAddress={tokenAddress} accent={accent} />;
  }
  if (kind === 'rate') return <RateContext skillId={skillId} />;
  if (kind === 'curve') {
    if (!inputs.token) return null;
    return <CurveContext tokenAddress={inputs.token} />;
  }
  return null;
}
