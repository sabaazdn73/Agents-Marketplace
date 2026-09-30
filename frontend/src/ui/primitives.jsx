// ui/primitives.jsx
//
// The small pieces every new page is built from, following getquin's
// dashboard (owner's reference, README-design.md): a card on #212122 with a
// 1px border, radius 4 and 16px padding; big light numbers with small
// decimals; a white (dark) or black (light) main button and an outlined
// secondary one; an icon-and-label eyebrow over a bold headline. One set for
// both apps, so web and mobile cannot draw them differently.

import React from 'react';
import { ArrowRight } from 'lucide-react';
import LOGOS from '../te/logos.json';

/** `pad` false drops the 16px padding, for a card whose table runs edge to
 *  edge and pads its own cells. */
export function Card({ as: Tag = 'section', pad = true, className = '', children, ...rest }) {
  return (
    <Tag className={`bg-surface border border-line rounded ${pad ? 'p-4' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function CardTitle({ children, right = null, className = '' }) {
  return (
    <div className={`flex items-center justify-between gap-3 mb-3 ${className}`}>
      <h3 className="min-w-0 text-[15px] font-semibold text-fg">{children}</h3>
      {right}
    </div>
  );
}

/** Main action: white on dark, black on light (the accent is the foreground). */
export function PrimaryButton({ as: Tag = 'button', arrow = true, className = '', children, ...rest }) {
  return (
    <Tag
      className={`inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded bg-accent text-accent-fg text-[13px] font-semibold hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-page focus-visible:ring-accent ${className}`}
      {...(Tag === 'button' ? { type: 'button' } : {})}
      {...rest}
    >
      {children}
      {arrow && <ArrowRight size={15} aria-hidden="true" />}
    </Tag>
  );
}

/** Secondary action: outlined. */
export function SecondaryButton({ as: Tag = 'button', className = '', children, ...rest }) {
  return (
    <Tag
      className={`inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded border border-line-strong text-fg text-[13px] font-semibold hover:bg-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
      {...(Tag === 'button' ? { type: 'button' } : {})}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** getquin's section label: a small outlined icon box, then a word or two. */
export function Eyebrow({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      {Icon && (
        <span className="w-8 h-8 rounded border border-line-strong flex items-center justify-center text-fg">
          <Icon size={16} aria-hidden="true" />
        </span>
      )}
      <span className="text-[14px] text-muted">{children}</span>
    </div>
  );
}

const usd0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** A money figure the getquin way: large and light, the cents small.
 *  `value` null or not finite renders nothing: no invented zero. */
export function BigMoney({ value, className = 'text-[40px]', currency = '$' }) {
  if (value == null || !Number.isFinite(value)) return null;
  const neg = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100).toString().padStart(2, '0');
  return (
    <span className={`font-light tabular-nums leading-none tracking-[-0.01em] ${className}`}>
      {neg ? '−' : ''}{currency}{usd0.format(whole)}<span className="text-[0.45em] align-baseline">.{cents === '100' ? '99' : cents}</span>
    </span>
  );
}

const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtUsd = (v) => (v == null || !Number.isFinite(v) ? null : usd2.format(v));
export const fmtUsd0 = (v) => (v == null || !Number.isFinite(v) ? null : `$${usd0.format(v)}`);
export const fmtPct = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
export const fmtBps = (v) => (v == null || !Number.isFinite(v) ? null : `${v.toFixed(1)} bps`);

/** Green for a gain, red for a loss, muted for none. */
export function Delta({ value, children }) {
  if (value == null || !Number.isFinite(value)) return null;
  const cls = value > 0 ? 'text-pos' : value < 0 ? 'text-neg' : 'text-muted';
  return <span className={`tabular-nums ${cls}`}>{children}</span>;
}

/** Marks anything drawn from te/fixtures.dev.js, so a dev screenshot cannot
 *  pass for a measurement. Renders nothing for real data. */
export function DevTag({ data }) {
  if (!data || !data._fixture) return null;
  return (
    <span className="inline-flex shrink-0 whitespace-nowrap items-center h-5 px-1.5 rounded border border-warn/60 text-warn text-[10px] font-semibold uppercase tracking-wide">
      Dev fixture
    </span>
  );
}

/** A small line from a list of numbers. Colour follows the first-to-last
 *  change. Fewer than two points renders nothing. */
export function Sparkline({ points, width = 96, height = 28 }) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1)) * width},${height - ((p - min) / span) * (height - 2) - 1}`).join(' ');
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="block">
      <path d={d} fill="none" strokeWidth="1.5" className={up ? 'stroke-pos' : 'stroke-neg'} />
    </svg>
  );
}

/** A value line over time: [[t, v]]. Gain green, loss red, getquin style,
 *  with a dotted baseline at the first value. */
export function LineChart({ series, height = 200 }) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const W = 1000, H = height;
  const vs = series.map((p) => p[1]);
  const min = Math.min(...vs), max = Math.max(...vs);
  const span = max - min || 1;
  const x = (i) => (i / (series.length - 1)) * W;
  const y = (v) => H - ((v - min) / span) * (H - 16) - 8;
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[1])}`).join(' ');
  const up = vs[vs.length - 1] >= vs[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full block" style={{ height }} aria-hidden="true">
      <line x1="0" x2={W} y1={y(vs[0])} y2={y(vs[0])} strokeDasharray="4 6" strokeWidth="1" className="stroke-chart-baseline" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" strokeWidth="2" className={up ? 'stroke-pos' : 'stroke-neg'} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const DONUT = ['text-chart-2', 'text-chart', 'text-chart-3', 'text-chart-4', 'text-chart-5'];

/** The allocation ring, in the logo blue family. [{label, usd}]. */
export function Donut({ parts, size = 200, centerLabel, centerValue }) {
  const total = (parts || []).reduce((a, p) => a + (Number.isFinite(p.usd) ? p.usd : 0), 0);
  if (!(total > 0)) return null;
  const r = 42, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90" aria-hidden="true">
          {parts.map((p, i) => {
            const frac = p.usd / total;
            const seg = Math.max(0, frac * C - 1);
            const el = (
              <circle key={p.label} cx="50" cy="50" r={r} fill="none" strokeWidth="12"
                stroke="currentColor" className={DONUT[i % DONUT.length]}
                strokeDasharray={`${seg} ${C - seg}`} strokeDashoffset={-acc * C} />
            );
            acc += frac;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerLabel && <span className="text-[12px] text-muted">{centerLabel}</span>}
          {centerValue}
        </div>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2 text-muted">
            <span className={`w-2.5 h-2.5 rounded-sm bg-current ${DONUT[i % DONUT.length]}`} aria-hidden="true" />
            <span className="text-fg">{p.label}</span>
            <span className="tabular-nums">{((p.usd / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A segmented pill row (1D 1W 1M, All EVM non-EVM). */
export function Pills({ options, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="glass-bar">
      {options.map((o) => {
        const id = typeof o === 'string' ? o : o.id;
        const text = typeof o === 'string' ? o : o.label;
        const on = id === value;
        return (
          <button key={id} type="button" role="tab" aria-selected={on} onClick={() => onChange(id)}
            className={`glass-tab h-8 px-3 text-[12px] tabular-nums ${on ? 'font-semibold' : 'font-medium'}`}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** EVM or non-EVM, as a small chip. */
export function GroupChip({ group }) {
  if (group !== 'evm' && group !== 'nonevm') return null;
  return (
    <span className="inline-flex items-center h-5 px-1.5 rounded bg-inset text-muted text-[10px] font-semibold uppercase tracking-wide">
      {group === 'evm' ? 'EVM' : 'Non-EVM'}
    </span>
  );
}

// The logos this site serves itself (scripts/build_logos.py writes them to
// public/logos/ and this index): `v`, token images an issuer publishes for
// its own versions (xStocks only), keyed by token symbol; `u`, company logos
// from Wikimedia Commons, keyed by ticker. Every one is a file on this site,
// so a visitor's browser calls no logo host. Sources and licences:
// public/logos/sources.json, listed on the Data sources page.
const LOGO_V = new Set(LOGOS.v);
const LOGO_U = new Set(LOGOS.u);

/** Which logo file stands for this instrument, or null. A version shows its
 *  issuer's own token image when the issuer publishes one; otherwise, and for
 *  a stock as a whole, the company's logo. */
export function logoFor({ symbol, underlying, issuer }) {
  if (symbol && /xstocks/i.test(issuer || '') && LOGO_V.has(symbol)) return `/logos/v/${symbol}.webp`;
  const t = underlying || symbol;
  return t && LOGO_U.has(t) ? `/logos/${t}.webp` : null;
}

const TILE = { md: 'w-9 h-9 text-[11px]', sm: 'w-5 h-5 text-[8px]' };

/** The instrument's logo, or a two-letter circle when there is none (or it
 *  fails to load). `underlying` is the stock's ticker, `symbol` the token's,
 *  `issuer` the version's issuer; pass what the row knows. */
export function SymbolTile({ symbol, underlying, issuer, size = 'md' }) {
  const [failed, setFailed] = React.useState(false);
  const src = failed ? null : logoFor({ symbol, underlying, issuer });
  if (src) {
    return (
      <img src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setFailed(true)}
        className={`${TILE[size]} shrink-0 rounded-[6px] border border-line object-cover`} />
    );
  }
  const t = String(underlying || symbol || '?').slice(0, 2).toUpperCase();
  return (
    <span className={`${TILE[size]} shrink-0 rounded-full bg-inset text-fg font-semibold flex items-center justify-center`} aria-hidden="true">
      {t}
    </span>
  );
}
