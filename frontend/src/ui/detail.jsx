// ui/detail.jsx
//
// The shape a vault page and a public basket page share, following the
// layout and information order of Hyperliquid's vault pages (owner's
// reference, ~/Desktop/Tnega-design-reference/hyperliquid-vaults/): a
// breadcrumb, a big name and a short address, the action buttons at the top
// right, four stat cards, a tabbed card on the left and a chart on the right,
// then tabbed tables along the bottom. Drawn in Tnega's own tokens only.

import React, { useState } from 'react';
import { Copy, Check, ChevronRight } from 'lucide-react';
import { Card } from './primitives';

export const shortAddr = (a) => (a && a.length > 14 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a || '');

export function CopyAddress({ address, className = '' }) {
  const [done, setDone] = useState(false);
  if (!address) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* not fatal */ }
  };
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[13px] text-muted ${className}`}>
      <span title={address}>{shortAddr(address)}</span>
      <button type="button" onClick={copy} aria-label="Copy the address" className="hover:text-fg">
        {done ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>
    </span>
  );
}

export function Breadcrumb({ parent, parentPath, name, onNavigate }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[13px] text-muted">
      <a href={parentPath} onClick={(e) => { if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); onNavigate(parentPath); }} className="hover:text-fg">{parent}</a>
      <ChevronRight size={13} aria-hidden="true" />
      <span className="text-fg truncate">{name}</span>
    </nav>
  );
}

/** One of the four stat cards. `value` null shows a dash and `note` says
 *  why, so an unread figure never looks like a zero. */
export function StatCard({ label, value, chip = null, note = null }) {
  return (
    <Card className="min-w-0">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
        {value == null ? <span className="text-[28px] font-light text-muted" title={note || undefined}>–</span> : value}
        {chip}
      </div>
      {note && value == null && <div className="mt-1 text-[11px] text-muted">{note}</div>}
    </Card>
  );
}

/** A small source chip beside a figure: where it comes from, in words. */
export function SourceChip({ children, title }) {
  return (
    <span title={title} className="inline-flex shrink-0 items-center h-5 px-1.5 rounded bg-inset text-muted text-[10px] font-semibold uppercase tracking-wide">
      {children}
    </span>
  );
}

/** Tabs across the top of a card, as an ARIA tablist: arrow keys, Home and
 *  End move between tabs; each tab controls its panel. Tabs whose `show` is
 *  false are left out, so a tab never opens onto nothing. */
let tabSeq = 0;
export function TabbedCard({ tabs, right = null, className = '', pad = true }) {
  const shown = tabs.filter((t) => t.show !== false);
  const [cur, setCur] = useState(shown[0]?.id);
  const [uid] = useState(() => `tabs${++tabSeq}`);
  if (!shown.length) return null;
  const active = shown.find((t) => t.id === cur) || shown[0];
  const onKey = (e) => {
    const i = shown.findIndex((t) => t.id === active.id);
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % shown.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + shown.length) % shown.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = shown.length - 1;
    if (n === null) return;
    e.preventDefault();
    setCur(shown[n].id);
    document.getElementById(`${uid}-tab-${shown[n].id}`)?.focus();
  };
  return (
    <Card pad={false} className={`min-w-0 ${className}`}>
      <div className="flex items-end justify-between gap-2 border-b border-line px-4 overflow-x-auto">
        <div role="tablist" className="flex gap-5 text-[13px]" onKeyDown={onKey}>
          {shown.map((t) => {
            const on = active.id === t.id;
            return (
              <button key={t.id} id={`${uid}-tab-${t.id}`} type="button" role="tab" aria-selected={on}
                aria-controls={`${uid}-panel-${t.id}`} tabIndex={on ? 0 : -1} onClick={() => setCur(t.id)}
                className={`py-3 -mb-px border-b-2 whitespace-nowrap ${on ? 'border-fg text-fg font-semibold' : 'border-transparent text-muted hover:text-fg'}`}>
                {t.label}{Number.isFinite(t.count) ? ` (${t.count})` : ''}
              </button>
            );
          })}
        </div>
        {right && <div className="py-2">{right(active.id)}</div>}
      </div>
      <div id={`${uid}-panel-${active.id}`} role="tabpanel" aria-labelledby={`${uid}-tab-${active.id}`} tabIndex={0}
        className={`${pad ? 'p-4' : ''} focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}>
        {active.render()}
      </div>
    </Card>
  );
}

/** A label and its value, one row, with an optional provenance line. */
export function Field({ label, children, prov = null }) {
  return (
    <div className="py-2.5 border-b border-line last:border-b-0">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-0.5 text-[13px] text-fg break-words">{children}</div>
      {prov && <div className="mt-0.5 text-[11px] text-muted">{prov}</div>}
    </div>
  );
}

/** Provenance in words: class A is read on chain (with its slot or block),
 *  class D is a document (linked, with the date it was read). */
export function provText(p) {
  if (!p) return null;
  const slot = p.slot ? `, slot ${Number(p.slot).toLocaleString('en-US')}` : '';
  // T6 qualifies a class in words, e.g. "A (positions as recorded by the
  // vault)": the account was read on chain, but what it states is the
  // vault's own record.
  const qual = String(p.class || '').match(/^A \((.+)\)$/);
  if (qual) return `Read on chain${slot}; ${qual[1]}`;
  if (p.class === 'A') return `Read on chain${slot}`;
  if (p.class === 'D') return p.read_on ? `From the operator's documents, read ${p.read_on}` : "From the operator's documents";
  return null;
}
