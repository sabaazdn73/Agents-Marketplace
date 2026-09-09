// YieldHistoryChart.jsx
//
// APR over time for the four BSC protocols the Yield agent can execute
// against, drawn from DefiLlama's own historical series.
//
// It fetches once on mount and holds the result. The panel it lives in is
// never unmounted once opened (see DeFiCategoryPanels.jsx), so this does not
// refetch when a panel is collapsed and reopened.
//
// A protocol whose history is unavailable is named in the legend as missing
// rather than dropped silently or drawn as a flat line at zero.

import React, { useEffect, useState } from 'react';
import { LineChart, ChartLegend, ChartLoading, ChartEmpty } from './MiniChart';
import {
  fetchYieldHistory, projectAtCurrentRates, projectionAsOf, RANGE_DAYS,
} from './yieldHistory';

const fmtPct = (v) => `${v.toFixed(2)}%`;
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function YieldHistoryChart({ accent }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchYieldHistory({ signal: ctrl.signal });
        if (!cancelled) setState({ loading: false, data, error: null });
      } catch (e) {
        if (e?.name === 'AbortError') return;
        if (!cancelled) setState({ loading: false, data: null, error: e.message || String(e) });
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, []);

  const { loading, data, error } = state;

  if (loading) return <ChartLoading label="Reading DefiLlama history..." />;
  if (error) return <ChartEmpty reason={`Could not reach DefiLlama: ${error}`} />;
  if (!data || !data.series.length) {
    return <ChartEmpty reason="DefiLlama returned no history for any of the four protocols." />;
  }

  const projection = projectAtCurrentRates(data.series, 1000);

  return (
    <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800/60">
      <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1.5">
        APR, last {RANGE_DAYS} days
      </p>
      <LineChart
        series={data.series}
        formatY={fmtPct}
        formatX={fmtDate}
        yLabel="APR over time by protocol"
      />
      <ChartLegend
        items={[
          ...data.series.map((s) => ({
            label: s.label, color: s.color,
            value: s.latest != null ? fmtPct(s.latest) : null,
          })),
          ...data.missing.map((m) => ({ label: m.label, color: '#999', missing: true })),
        ]}
      />

      {projection.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">
            1,000 U held for a year, projected at today's rates
          </p>
          <div className="space-y-0.5">
            {projection.map((p) => (
              <div key={p.key} className="flex items-center justify-between text-[11px]">
                <span className="inline-flex items-center gap-1.5 opacity-70">
                  <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                  {p.label}
                </span>
                <span className="font-mono">
                  {p.yearEnd.toFixed(2)} U
                  <span className="opacity-50"> (+{p.gain.toFixed(2)})</span>
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] opacity-40 mt-1.5 leading-relaxed">
            A projection at the rates shown above as of {projectionAsOf()}, not a forecast.
            It assumes each rate holds for a year, which none of them will.
          </p>
        </div>
      )}

      <p className="text-[10px] opacity-40 mt-2">
        Source: DefiLlama historical yields, read live in your browser.
      </p>
    </div>
  );
}
