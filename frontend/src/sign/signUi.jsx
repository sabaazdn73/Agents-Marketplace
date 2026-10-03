// sign/signUi.jsx
//
// The small pieces of the signing page that the EVM order
// (SignOrderPage.jsx) and the Solana order (SolanaOrderView.jsx) draw the
// same way: a row of the order, an outside link, the two buttons, a step of
// the wallet list, and the figures' formatting. Moved out of SignOrderPage.jsx
// unchanged, so the two cannot drift.

import React from 'react';
import { Check, ExternalLink } from 'lucide-react';

export const tok = (v, d = 4) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : null);
export const pct = (x, d = 2) => `${(x * 100).toFixed(d)}%`;
export const amountText = (s) => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 8 }) : s;
};
export const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[minmax(0,38%)_1fr] gap-x-3 py-2 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-fg min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function Ext({ href, children, mono = false }) {
  if (!href) return <span className={mono ? 'font-mono' : ''}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 hover:text-fg break-all ${mono ? 'font-mono' : ''}`}>
      {children}<ExternalLink size={11} aria-hidden="true" className="inline ml-1 align-baseline" />
    </a>
  );
}

export const btn = 'h-10 px-4 rounded bg-accent text-accent-fg text-[13px] font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2';
export const btn2 = 'h-10 px-4 rounded border border-line-strong text-fg text-[13px] font-semibold hover:bg-inset disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2';

export const ASK_AGAIN = 'Ask your assistant to prepare a new order.';

export function Step({ n, done, active, title, children }) {
  return (
    <li className="flex gap-3 py-3">
      <span aria-hidden="true" className={`mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[12px] font-semibold ${done ? 'bg-pos text-page' : active ? 'bg-accent text-accent-fg' : 'border border-line-strong text-muted'}`}>
        {done ? <Check size={13} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[14px] font-semibold ${active || done ? 'text-fg' : 'text-muted'}`}>{title}</div>
        {children && <div className="mt-1 text-[13px] text-muted">{children}</div>}
      </div>
    </li>
  );
}

