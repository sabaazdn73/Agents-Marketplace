// MiniChart.jsx
//
// Small SVG chart primitives for the DeFi category panels. No charting
// library, for the same reason this repo hand-rolls its markdown parser:
// the app already ships a 4 MB bundle and OOMs on a 512Mi container, and
// these four charts need lines, bars and markers, not a plotting framework.
//
// EVERY CHART HERE DRAWS ONLY WHAT IT IS GIVEN.
// There is no sample data, no placeholder series and no interpolation
// across gaps. A chart with nothing to draw renders <ChartEmpty> with a
// stated reason instead of an empty axis, because an empty axis reads as a
// measured zero and these are financial screens.
//
// Formatting is passed in rather than guessed, so the caller decides
// whether a value is a percentage, a price or a weight.

import React, { useId, useMemo } from 'react';

const PAD = { t: 8, r: 8, b: 18, l: 34 };

/** The one thing every chart shows when it has no data. Never an axis. */
export function ChartEmpty({ reason, height = 120 }) {
  return (
    <div
      className="flex items-center justify-center text-center px-4 rounded-lg border border-dashed border-gray-200 dark:border-gray-800"
      style={{ height }}
    >
      <span className="text-[11px] opacity-50 leading-relaxed">{reason}</span>
    </div>
  );
}

export function ChartLoading({ height = 120, label = 'Loading' }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 dark:border-gray-800"
      style={{ height }}
    >
      <span className="text-[11px] opacity-40">{label}</span>
    </div>
  );
}

/**
 * Multi-series line chart over a shared numeric x axis.
 *
 * series: [{ label, color, points: [{ x, y }] }]
 * Points with a null y are treated as gaps and break the line rather than
 * being bridged, so a period with no reading does not become a straight
 * line that looks like a stable rate.
 */
export function LineChart({
  series, height = 140, width = 520,
  formatY = (v) => String(v), formatX = (v) => String(v),
  yLabel,
}) {
  const uid = useId();
  const live = (series || []).filter((s) => (s.points || []).some((p) => p.y != null));

  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of live) {
      for (const p of s.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y == null) continue;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    if (minY === maxY) { minY -= 1; maxY += 1; }   // a flat series still needs a band
    return { minX, maxX, minY, maxY };
  }, [live]);

  if (!live.length) return <ChartEmpty height={height} reason="No data to draw." />;

  const iw = width - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;
  const sx = (x) => PAD.l + (bounds.maxX === bounds.minX ? iw / 2 : ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * iw);
  const sy = (y) => PAD.t + ih - ((y - bounds.minY) / (bounds.maxY - bounds.minY)) * ih;

  // A null y ends the current path and starts a new one after the gap.
  const pathFor = (points) => {
    const out = [];
    let open = false;
    for (const p of points) {
      if (p.y == null) { open = false; continue; }
      out.push(`${open ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`);
      open = true;
    }
    return out.join(' ');
  };

  const ticks = [bounds.minY, (bounds.minY + bounds.maxY) / 2, bounds.maxY];

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 320 }}
           role="img" aria-label={yLabel || 'chart'}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={width - PAD.r} y1={sy(t)} y2={sy(t)}
                  className="stroke-gray-200 dark:stroke-gray-800" strokeWidth="1" />
            <text x={PAD.l - 5} y={sy(t) + 3} textAnchor="end"
                  className="fill-gray-400 dark:fill-gray-500" style={{ fontSize: 8 }}>
              {formatY(t)}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={height - 5} className="fill-gray-400 dark:fill-gray-500" style={{ fontSize: 8 }}>
          {formatX(bounds.minX)}
        </text>
        <text x={width - PAD.r} y={height - 5} textAnchor="end"
              className="fill-gray-400 dark:fill-gray-500" style={{ fontSize: 8 }}>
          {formatX(bounds.maxX)}
        </text>
        {live.map((s, i) => (
          <path key={`${uid}-${i}`} d={pathFor(s.points)} fill="none"
                stroke={s.color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        ))}
      </svg>
    </div>
  );
}

/** Legend rows. Kept separate so a caller can say which series are missing
 *  alongside the ones that drew. */
export function ChartLegend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1 text-[10px]">
          <span className="w-2 h-2 rounded-full shrink-0"
                style={{ background: it.missing ? 'transparent' : it.color,
                         border: it.missing ? '1px dashed currentColor' : 'none' }} />
          <span className={it.missing ? 'opacity-40' : 'opacity-70'}>
            {it.label}{it.value != null ? ` ${it.value}` : ''}{it.missing ? ' (no data)' : ''}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * A horizontal number line with markers on it. Used for the grid levels
 * against spot, and for a health factor against its liquidation threshold.
 *
 * markers: [{ x, label, color, side }]
 */
export function MarkerAxis({ markers, min, max, height = 92, width = 520, formatX = (v) => String(v), highlight }) {
  if (!markers || !markers.length || min == null || max == null || max <= min) {
    return <ChartEmpty height={height} reason="Nothing to place on the axis yet." />;
  }
  const iw = width - PAD.l - PAD.r;
  const mid = height / 2;
  const sx = (x) => PAD.l + ((Math.min(Math.max(x, min), max) - min) / (max - min)) * iw;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 320 }} role="img">
        <line x1={PAD.l} x2={width - PAD.r} y1={mid} y2={mid}
              className="stroke-gray-300 dark:stroke-gray-700" strokeWidth="1" />
        {highlight != null && (
          <g>
            <line x1={sx(highlight)} x2={sx(highlight)} y1={PAD.t} y2={height - PAD.b}
                  className="stroke-gray-900 dark:stroke-white" strokeWidth="1.4" strokeDasharray="3 2" />
            <text x={sx(highlight)} y={PAD.t - 1} textAnchor="middle"
                  className="fill-gray-900 dark:fill-white" style={{ fontSize: 8, fontWeight: 700 }}>
              {formatX(highlight)}
            </text>
          </g>
        )}
        {markers.map((m, i) => {
          const y = m.side === 'up' ? mid - 12 : mid + 12;
          return (
            <g key={i}>
              <line x1={sx(m.x)} x2={sx(m.x)} y1={mid} y2={y} stroke={m.color} strokeWidth="1.4" />
              <circle cx={sx(m.x)} cy={y} r="3" fill={m.color} />
            </g>
          );
        })}
        <text x={PAD.l} y={height - 4} className="fill-gray-400 dark:fill-gray-500" style={{ fontSize: 8 }}>
          {formatX(min)}
        </text>
        <text x={width - PAD.r} y={height - 4} textAnchor="end"
              className="fill-gray-400 dark:fill-gray-500" style={{ fontSize: 8 }}>
          {formatX(max)}
        </text>
      </svg>
    </div>
  );
}

/**
 * Paired bars, one pair per row. Used for current weight against target
 * weight so the drift is the visible thing.
 *
 * rows: [{ label, a, b }] where a and b are on the same scale.
 */
export function PairedBars({ rows, height = 120, width = 520, aLabel, bLabel, aColor, bColor, formatV = (v) => String(v) }) {
  if (!rows || !rows.length) {
    return <ChartEmpty height={height} reason="No holdings to compare." />;
  }
  const max = Math.max(...rows.flatMap((r) => [r.a, r.b]), 1);
  const rowH = 26;
  const h = Math.max(height, rows.length * rowH + 24);
  const barW = width - PAD.l - PAD.r - 60;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${h}`} className="w-full" style={{ minWidth: 320 }} role="img">
        {rows.map((r, i) => {
          const y = 14 + i * rowH;
          return (
            <g key={r.label}>
              <text x={0} y={y + 9} className="fill-gray-500 dark:fill-gray-400" style={{ fontSize: 9 }}>{r.label}</text>
              <rect x={PAD.l} y={y} width={Math.max(1, (r.a / max) * barW)} height="7" rx="2" fill={aColor} />
              <rect x={PAD.l} y={y + 9} width={Math.max(1, (r.b / max) * barW)} height="7" rx="2" fill={bColor} opacity="0.55" />
              <text x={PAD.l + barW + 6} y={y + 12} className="fill-gray-500 dark:fill-gray-400" style={{ fontSize: 8 }}>
                {formatV(r.a)} / {formatV(r.b)}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartLegend items={[{ label: aLabel, color: aColor }, { label: bLabel, color: bColor }]} />
    </div>
  );
}
