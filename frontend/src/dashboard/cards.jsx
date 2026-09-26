// dashboard/cards.jsx
//
// The Dashboard's cards, laid out like getquin's dashboard (owner's
// reference, dashboard-01 to 03): Portfolio with the big value and the
// 1D to Max chart, Positions, Dividends; Allocation, Performance by year and
// the cost breakdown on the right. All read one answer, POST
// /api/site/portfolio (te/api.js documents the shape). Each card returns
// null when its part of the answer is missing: no zero stands in for a read
// that did not happen.

import React, { useState } from 'react';
import {
  Card, CardTitle, BigMoney, Delta, DevTag, LineChart, Donut, Pills, SymbolTile,
  fmtUsd, fmtPct,
} from '../ui/primitives';
import { hasRows } from '../te/api';

const RANGES = ['1D', '1W', '1M', 'YTD', '1Y', 'Max'];

export function PortfolioCard({ data }) {
  const [range, setRange] = useState('1M');
  if (!data || !Number.isFinite(data.total_usd)) return null;
  const available = RANGES.filter((r) => hasRows(data.series?.[r]));
  const shown = available.includes(range) ? range : available[0];
  return (
    <Card>
      <CardTitle right={<DevTag data={data} />}>Portfolio</CardTitle>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <BigMoney value={data.total_usd} className="text-[44px]" />
          <div className="mt-2 text-[13px]">
            <Delta value={data.change_usd}>{data.change_usd > 0 ? '↗' : '↘'} {fmtUsd(data.change_usd)} ({fmtPct(data.change_pct)})</Delta>
          </div>
        </div>
        {available.length > 0 && <Pills label="Range" options={available} value={shown} onChange={setRange} />}
      </div>
      {shown && <div className="mt-4"><LineChart series={data.series[shown]} height={220} /></div>}
    </Card>
  );
}

export function PositionsCard({ data, compact = false }) {
  if (!data || !hasRows(data.positions)) return null;
  return (
    <Card pad={false}>
      <div className="px-4 pt-4"><CardTitle right={<DevTag data={data} />}>Positions</CardTitle></div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-muted text-left text-[12px]">
            <th className="font-medium px-4 pb-2">Title</th>
            {!compact && <th className="font-medium pb-2 text-right">Buy-in</th>}
            <th className="font-medium pb-2 text-right">Position</th>
            <th className="font-medium px-4 pb-2 text-right">P/L</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.positions.map((p) => (
            <tr key={p.key}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <SymbolTile symbol={p.symbol} />
                  <div className="min-w-0">
                    <div className="text-fg font-semibold truncate">{p.name}</div>
                    <div className="text-[12px] text-muted flex items-center gap-1.5">
                      {p.symbol}
                      {Number.isFinite(p.qty) && <span className="h-4 px-1 rounded bg-inset text-fg text-[11px] inline-flex items-center">x{p.qty}</span>}
                      {!compact && <span className="truncate">{p.issuer} · {p.chain}</span>}
                    </div>
                  </div>
                </div>
              </td>
              {!compact && (
                <td className="py-3 text-right tabular-nums" title={p.buy_in_usd == null ? p.buy_in_reason || undefined : undefined}>
                  <div className="text-fg">{p.buy_in_usd == null ? '–' : fmtUsd(p.buy_in_usd)}</div>
                  <div className="text-[12px] text-muted">{fmtUsd(p.price_usd)}</div>
                </td>
              )}
              <td className="py-3 text-right tabular-nums text-fg">{fmtUsd(p.value_usd)}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {p.pl_usd == null ? <span className="text-muted" title={p.buy_in_reason || undefined}>–</span> : (
                  <Delta value={p.pl_usd}>
                    <div>{p.pl_usd > 0 ? '+' : ''}{fmtUsd(p.pl_usd)}</div>
                    <div className="text-[12px]">{fmtPct(p.pl_pct)}</div>
                  </Delta>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const TABS = [['type', 'Type'], ['chain', 'Chain'], ['issuer', 'Issuer']];

export function AllocationCard({ data }) {
  const tabs = TABS.filter(([k]) => hasRows(data?.allocation?.[k]));
  const [tab, setTab] = useState('type');
  if (!data || !tabs.length) return null;
  const cur = tabs.find(([k]) => k === tab) ? tab : tabs[0][0];
  return (
    <Card>
      <CardTitle right={<DevTag data={data} />}>Allocation</CardTitle>
      <div className="mb-4 border-b border-line flex gap-4 text-[13px]">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={cur === k}
            className={`pb-2 -mb-px border-b-2 ${cur === k ? 'border-fg text-fg font-semibold' : 'border-transparent text-muted hover:text-fg'}`}>{label}</button>
        ))}
      </div>
      <Donut parts={data.allocation[cur]} centerLabel="Total" centerValue={Number.isFinite(data.total_usd) ? <BigMoney value={data.total_usd} className="text-[22px]" /> : null} />
    </Card>
  );
}

export function PerformanceCard({ data }) {
  const perf = data?.performance;
  if (!perf) return null;
  const years = hasRows(perf.by_year) ? perf.by_year : [];
  const max = Math.max(1, ...years.map((y) => Math.abs(y.pct)));
  const rows = [
    ['Price gain', perf.price_gain_usd],
    ['Dividends', perf.dividends_usd],
    ['Transaction costs', perf.tx_costs_usd],
  ].filter(([, v]) => Number.isFinite(v));
  if (!years.length && !rows.length && !Number.isFinite(perf.total_return_usd)) return null;
  return (
    <Card>
      <CardTitle right={<DevTag data={data} />}>Performance</CardTitle>
      {years.length > 0 && (
        <div className="flex items-stretch gap-3 h-[140px] mb-2" aria-label="Return by year">
          {years.map((y) => (
            <div key={y.year} className="flex-1 flex flex-col items-center">
              <div className="flex-1 w-full flex flex-col justify-center relative">
                <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-line-strong/50" aria-hidden="true" />
                <div className="h-1/2 flex items-end justify-center">{y.pct > 0 && <span className="w-full max-w-[40px] bg-pos rounded-sm" style={{ height: `${(y.pct / max) * 100}%` }} />}</div>
                <div className="h-1/2 flex items-start justify-center">{y.pct < 0 && <span className="w-full max-w-[40px] bg-neg rounded-sm" style={{ height: `${(-y.pct / max) * 100}%` }} />}</div>
              </div>
              <span className="mt-1 text-[11px] text-muted tabular-nums">{y.year}</span>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <dl className="mt-3 space-y-2 text-[13px]">
          <div className="text-[14px] font-semibold text-fg">Breakdown</div>
          {rows.map(([label, v]) => (
            <div key={label} className="flex justify-between"><dt className="text-muted">{label}</dt><dd className="tabular-nums"><Delta value={v}>{fmtUsd(v)}</Delta></dd></div>
          ))}
        </dl>
      )}
      {Number.isFinite(perf.total_return_usd) && (
        <div className="mt-4 pt-3 border-t border-line flex justify-between text-[15px] font-semibold">
          <span className="text-fg">Total return</span>
          <Delta value={perf.total_return_usd}>{fmtUsd(perf.total_return_usd)}</Delta>
        </div>
      )}
    </Card>
  );
}

export function DividendsCard({ data }) {
  const d = data?.dividends;
  if (!d || (!Number.isFinite(d.received_usd) && !hasRows(d.payments))) return null;
  const years = hasRows(d.by_year) ? d.by_year : [];
  const max = Math.max(1, ...years.map((y) => y.usd));
  return (
    <Card>
      <CardTitle right={<DevTag data={data} />}>Dividends <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-muted">from multiplier changes</span></CardTitle>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {Number.isFinite(d.received_usd) && <div className="rounded border border-line p-3"><div className="text-[12px] text-muted">Received</div><div className="mt-1 text-[15px] tabular-nums text-fg">{fmtUsd(d.received_usd)}</div></div>}
        {Number.isFinite(d.yield_ttm_pct) && <div className="rounded border border-line p-3"><div className="text-[12px] text-muted">Yield, trailing 12 months</div><div className="mt-1 text-[15px] tabular-nums text-fg">{d.yield_ttm_pct.toFixed(2)}%</div></div>}
      </div>
      {years.length > 0 && (
        <div className="flex items-end gap-4 h-[110px] mb-4">
          {years.map((y) => (
            <div key={y.year} className="flex-1 flex flex-col items-center justify-end h-full">
              <span className="w-full max-w-[64px] bg-chart rounded-sm" style={{ height: `${(y.usd / max) * 80}%` }} />
              <span className="mt-1 text-[11px] text-muted tabular-nums">{y.year}</span>
              <span className="text-[12px] text-fg tabular-nums">{fmtUsd(y.usd)}</span>
            </div>
          ))}
        </div>
      )}
      {hasRows(d.payments) && (
        <table className="w-full text-[13px]">
          <thead><tr className="text-muted text-left text-[12px]"><th className="font-medium pb-2">Date</th><th className="font-medium pb-2">Token</th><th className="font-medium pb-2">Multiplier</th><th className="font-medium pb-2 text-right">Value</th></tr></thead>
          <tbody className="divide-y divide-line">
            {d.payments.map((p) => (
              <tr key={`${p.date}-${p.symbol}`}><td className="py-2 text-muted tabular-nums">{p.date}</td><td className="py-2 text-fg">{p.symbol}</td><td className="py-2 text-muted tabular-nums">{p.step}</td><td className="py-2 text-right tabular-nums text-fg">{fmtUsd(p.usd)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-[11px] text-muted">Value added by multiplier increases while held, priced at the pool. The issuer describes these as reinvested distributions (its terms).</p>
    </Card>
  );
}
