// etfs/BasketBuilder.jsx
//
// Build your own basket (SPEC A.2, C.3): up to five stocks or ETFs, whole
// percentage weights summing to 100%, priced by GET /api/baskets/evaluate
// (our cost engine; the basket is priced and forgotten, never stored). The
// basket lives in its link: ?b=<base64url JSON> (baskets/codec.js), and a
// link in the evaluate route's own ?legs= form opens here too. One
// component for both apps; `compact` for a phone.
//
// Tickers come from GET /api/te/search as the visitor types (our own
// universe). A leg may pin one version (its key, exactly as
// /api/te/underlying serves it); otherwise the engine's best version at
// the leg's size is used. The builder asks /api/baskets/evaluate with b=,
// so a pin is priced, and the share link carries it. The answer shows the same breakdown as a curated basket
// (BasketBreakdown.jsx), and, while the Buy panel is shown, the same
// one-leg-at-a-time buy (trade/BasketBuy.jsx).

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Plus, X } from 'lucide-react';
import { useTe, hasRows } from '../te/api';
import { Card, DevTag, Pills } from '../ui/primitives';
import { sentence } from '../te/costText';
import { MAX_LEGS, BPS, legsProblem, legsParam, shareUrl, encodeB } from '../baskets/codec';
import { BUY_LIVE } from '../trade/buyLive';
import BasketBreakdown, { CostAtSize, STOPS } from './BasketBreakdown';
import BasketBuy from '../trade/BasketBuy';

const stopLabel = (s) => (s >= 1000 ? `$${s / 1000}k` : `$${s}`);

function useDebounced(v, ms) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

function TickerField({ value, onPick, label }) {
  const [q, setQ] = useState(value || '');
  const [focus, setFocus] = useState(false);
  useEffect(() => { setQ(value || ''); }, [value]);
  const term = useDebounced(q.trim(), 300);
  const search = useTe(focus && term.length >= 1 && term.toUpperCase() !== value ? `/api/te/search?q=${encodeURIComponent(term)}` : null).data;
  const results = (search?.results || []).filter((r) => r.kind === 'instrument' && r.underlying).slice(0, 6);
  return (
    <div className="relative flex-1 min-w-0">
      <input
        value={q} aria-label={label} placeholder="Ticker or name"
        onChange={(e) => { setQ(e.target.value); onPick(e.target.value.trim().toUpperCase()); }}
        onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
        className="w-full h-9 px-3 rounded border border-line-strong bg-transparent text-[13px] text-fg uppercase placeholder:normal-case placeholder:text-muted outline-none focus:border-fg"
      />
      {focus && results.length > 0 && (
        <ul className="absolute z-10 left-0 right-0 mt-1 rounded border border-line bg-surface shadow-sm max-h-60 overflow-y-auto">
          {results.map((r) => (
            <li key={r.underlying}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(r.underlying); setQ(r.underlying); setFocus(false); }}
                className="w-full text-left px-3 py-2 text-[13px] hover:bg-inset">
                <span className="font-semibold text-fg">{r.underlying}</span> <span className="text-muted">{r.name}{r.type ? ` · ${r.type === 'etf' ? 'ETF' : 'stock'}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A link that did not validate still fills the rows, so the visitor can fix it.
/** Which version a leg buys: the engine's best at each size (default), or
 *  one pinned version, listed from /api/te/underlying at $1,000. */
function VersionPick({ t, k, onPick, label }) {
  const ok = /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(t || '');
  const u = useTe(ok ? `/api/te/underlying/${encodeURIComponent(t)}?size=1000` : null).data;
  const versions = u?.versions || [];
  if (!ok || (!versions.length && !k)) return null;
  return (
    <select value={k || ''} onChange={(e) => onPick(e.target.value || undefined)} aria-label={label}
      className="w-full h-8 px-2 rounded border border-line bg-surface text-[12px] text-muted">
      <option value="">Version: the best at each size (engine)</option>
      {k && !versions.some((v) => v.key === k) && <option value={k}>Version: {k} (from the link)</option>}
      {versions.map((v) => (
        <option key={v.key} value={v.key}>Version: {v.symbol} on {v.chain}{v.state !== 'filled' ? ` (at $1,000: ${v.state.replace(/_/g, ' ')})` : ''}</option>
      ))}
    </select>
  );
}

const toRows = (legs) => (legs || []).slice(0, MAX_LEGS).map((l) => ({ t: l.t || '', k: l.k, pct: Number.isFinite(l.w) ? l.w / 100 : 0 }));

export default function BasketBuilder({ initialLegs = null, initialSize = 1000, linkError = null, compact = false }) {
  const [rows, setRows] = useState(() => (initialLegs?.length ? toRows(initialLegs) : [{ t: '', pct: 50 }, { t: '', pct: 50 }]));
  const [size, setSize] = useState(STOPS.includes(initialSize) ? initialSize : 1000);
  // What was last asked of the evaluate route; the link opens with its legs.
  const [asked, setAsked] = useState(() => (initialLegs?.length && !linkError ? { legs: initialLegs, size: STOPS.includes(initialSize) ? initialSize : 1000 } : null));
  const [copied, setCopied] = useState(false);

  const legs = useMemo(() => rows.map((r) => ({ t: (r.t || '').toUpperCase(), k: r.k, w: Math.round(Number(r.pct) * 100) })), [rows]);
  const total = rows.reduce((a, r) => a + (Number(r.pct) || 0), 0);
  const wholePct = rows.every((r) => Number.isInteger(Number(r.pct)));
  const problem = !wholePct ? 'weights are whole percentages' : legsProblem(legs);

  const res = useTe(asked ? `/api/baskets/evaluate?b=${encodeB(asked.legs)}&size=${asked.size}` : null, { keep: true });
  const b = res.data;

  // A new ticker drops the leg's pinned version, which belongs to the old one.
  const set = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, ...(patch.t != null && patch.t !== r.t ? { k: undefined } : {}) } : r)));
  const add = () => setRows((rs) => (rs.length >= MAX_LEGS ? rs : [...rs, { t: '', pct: 0 }]));
  const remove = (i) => setRows((rs) => rs.filter((_, j) => j !== i));
  const even = () => setRows((rs) => {
    const n = rs.length;
    const base = Math.floor(100 / n);
    return rs.map((r, j) => ({ ...r, pct: base + (j < 100 - base * n ? 1 : 0) }));
  });

  const evaluate = () => {
    if (problem) return;
    setAsked({ legs, size });
    try { window.history.replaceState(window.history.state, '', `/my-etfs?b=${encodeB(legs)}${size !== 1000 ? `&size=${size}` : ''}#build`); } catch { /* not fatal */ }
  };
  const onSize = (s) => {
    setSize(s);
    if (asked) setAsked({ legs: asked.legs, size: s });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl(asked.legs, asked.size, b?.b_param)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* not fatal */ }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-[15px] font-semibold text-fg">Build your own</h2>
          <span className="text-[12px] text-muted">Up to {MAX_LEGS} stocks or ETFs, whole-percent weights summing to 100%. Priced by our cost engine; nothing is stored.</span>
        </div>
        {linkError && <p role="alert" className="mb-3 text-[13px] text-warn">{linkError}</p>}
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-2">
              <div className="flex-1 min-w-0 space-y-1">
                <TickerField value={r.t} label={`Leg ${i + 1} ticker`} onPick={(t) => set(i, { t })} />
                <VersionPick t={r.t} k={r.k} label={`Leg ${i + 1} version`} onPick={(k) => set(i, { k })} />
              </div>
              <label className="flex items-center gap-1 text-[13px] text-muted">
                <input type="number" inputMode="numeric" min={1} max={100} step={1} value={r.pct} aria-label={`Leg ${i + 1} weight, percent`}
                  onChange={(e) => set(i, { pct: e.target.value === '' ? '' : Number(e.target.value) })}
                  className="w-16 h-9 px-2 rounded border border-line-strong bg-transparent text-right text-fg tabular-nums outline-none focus:border-fg" />
                %
              </label>
              <button type="button" onClick={() => remove(i)} disabled={rows.length <= 1} aria-label={`Remove leg ${i + 1}`} className="h-9 w-9 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-inset disabled:opacity-30">
                <X size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          <button type="button" onClick={add} disabled={rows.length >= MAX_LEGS} className="inline-flex items-center gap-1 text-accent hover:underline disabled:opacity-40 disabled:no-underline"><Plus size={14} aria-hidden="true" />Add a leg</button>
          <button type="button" onClick={even} className="text-accent hover:underline">Split evenly</button>
          <span className={`ml-auto tabular-nums ${total === 100 ? 'text-muted' : 'text-warn'}`}>Total {Number.isFinite(total) ? total : 0}%</span>
        </div>
        <div className="mt-3 overflow-x-auto"><Pills label="Basket size" value={size} onChange={onSize} options={STOPS.map((s) => ({ id: s, label: stopLabel(s) }))} /></div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={evaluate} disabled={!!problem} className="h-10 px-4 rounded bg-accent text-accent-fg text-[13px] font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">Price this basket</button>
          {problem && <span className="text-[12px] text-muted">{sentence(problem)}.</span>}
        </div>
        <p className="mt-2 text-[11px] text-muted">Weights are stored in the link as basis points (100% = {BPS.toLocaleString('en-US')}).</p>
      </Card>

      {asked && !b && res.error && (
        <Card><p role="alert" className="text-[13px] text-warn">{res.errorBody?.reason ? `${sentence(res.errorBody.reason)}.` : `Couldn't price this basket (${res.error}). Try again later.`}</p></Card>
      )}
      {asked && b && (
        <div className={`space-y-4 ${res.stale ? 'opacity-60' : ''}`}>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px] text-muted">Your basket, priced at {`$${b.size.toLocaleString('en-US')}`}{b.stored === false ? '; not stored' : ''}. <DevTag data={b} /></div>
              <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-line-strong text-[12px] font-semibold text-fg hover:bg-inset">
                {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copied ? 'Link copied' : 'Copy the link'}
              </button>
            </div>
            {b.stored_basis && <p className="mt-1 text-[11px] text-muted">{sentence(b.stored_basis)}</p>}
          </Card>
          <BasketBreakdown b={b} compact={compact} />
          {hasRows(b.cost_at_size?.stops) && <Card><h3 className="text-[15px] font-semibold text-fg mb-2">Cost at every measured size</h3><CostAtSize c={b.cost_at_size} size={b.size} /></Card>}
          {BUY_LIVE && <BasketBuy b={b} runId={`b:${legsParam(asked.legs)}:${b.size}`} />}
          <p className="text-[12px] text-muted">A basket you built; not a recommendation.</p>
        </div>
      )}
    </div>
  );
}
