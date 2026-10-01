// stocks/CostByChain.jsx
//
// The stock page's "cost by chain" card, GET /api/te/curve/{T}: the order
// size, a slider over the engine's stops, and per chain the best ranked
// version's cost in bps at that size, with its symbol and depth. The same
// figures as the home page's card (home/cards.jsx CostCurveCard, which the
// home page keeps), short on the face: what the bars are and when they were
// measured sit behind the (i), and in the guide (/guide#costs).

import React, { useState } from 'react';
import { Card, DevTag, BigMoney, fmtBps, fmtUsd0 } from '../ui/primitives';
import { hasRows } from '../te/api';
import { depthText, measuredLine, sentence } from '../te/costText';
import { Tip } from '../dashboard/cards';

const CHAIN_STATE = {
  no_pool: 'no pool found', not_searched: 'not searched', too_thin: 'pool too thin',
  not_a_venue: 'not a venue', held: 'held back', failed: 'quote failed', mixed: 'no quotable pool',
};

export default function CostByChain({ data, size: sizeProp = null, onSize = null }) {
  const stops = data?.stops;
  const [own, setOwn] = useState(() => (Array.isArray(stops) ? Math.max(0, stops.indexOf(10000)) : 0));
  if (!data || !hasRows(stops) || !(hasRows(data.chains) || hasRows(data.chains_without_pool))) return null;
  const held = sizeProp != null ? stops.indexOf(sizeProp) : -1;
  const i = held >= 0 ? held : own;
  const setI = (n) => { if (held >= 0 && onSize) onSize(stops[n]); else setOwn(n); };
  const at = Math.min(i, stops.length - 1);
  const size = stops[at];
  const rows = (data.chains || [])
    .map((c) => ({ ...c, v: c.bps?.[at], why: c.null_reason?.[at], depth: c.pool_usd?.[at], who: c.symbols?.[at] || c.symbol }))
    .sort((a, b) => (a.v == null) - (b.v == null) || (a.v ?? 0) - (b.v ?? 0));
  const max = Math.max(...rows.map((r) => r.v || 0), 1);
  const without = data.chains_without_pool || [];
  const measured = measuredLine(data.computed_at);
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="relative flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Order size
            <Tip label="What the bars show" align="left" className="!static">
              <p>{data.ticker}: per chain, the best ranked version at this size, and its cost in bps (fees and price impact against the pool&apos;s own price).{data.lifi_fee_included ? ' Includes LI.FI’s 0.25% fee.' : ''}</p>
              <p>Simulated on the pools, not quoted.{measured ? ` ${measured}` : ''}</p>
            </Tip>
          </div>
          <div className="mt-1"><BigMoney value={size} className="text-[36px]" /></div>
        </div>
        <DevTag data={data} />
      </div>
      <input
        type="range" min={0} max={stops.length - 1} step={1} value={at}
        onChange={(e) => setI(Number(e.target.value))}
        aria-label="Order size" aria-valuetext={fmtUsd0(size)}
        className="w-full mt-4 accent-[rgb(var(--fg))]"
      />
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={`${r.chain}-${r.chain_id}`} className="grid grid-cols-[110px_1fr_78px] items-center gap-x-3 text-[13px]">
            <span className="text-fg truncate">{r.chain}</span>
            {r.v == null
              ? <span className="text-muted text-[12px] col-span-2">{sentence(r.why) || 'No figure at this size'}</span>
              : (
                <>
                  <span className="h-2 rounded-full bg-inset overflow-hidden">
                    <span className="block h-full rounded-full bg-chart" style={{ width: `${(r.v / max) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-fg">{fmtBps(r.v)}</span>
                  <span className="col-start-2 col-span-2 text-[11px] text-muted truncate">{[r.who, depthText(r.depth)].filter(Boolean).join(' · ')}</span>
                </>
              )}
          </li>
        ))}
      </ul>
      {without.length > 0 && (
        <details className="mt-3 pt-3 border-t border-line text-[12px]">
          <summary className="cursor-pointer text-muted hover:text-fg">
            {without.map((c) => `${c.chain}: ${CHAIN_STATE[c.state] || c.state}`).join(' · ')}
          </summary>
          <ul className="mt-2 space-y-2 text-muted">
            {without.map((c) => (
              <li key={c.chain_id}>
                <span className="text-fg">{c.chain}</span> ({(c.symbols || []).join(', ')}): {(c.reasons || []).map(sentence).join('; ')}
              </li>
            ))}
          </ul>
        </details>
      )}
      {measured && <p className="mt-3 text-[11px] text-muted">{measured}</p>}
    </Card>
  );
}
