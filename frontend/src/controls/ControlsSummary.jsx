// controls/ControlsSummary.jsx
//
// The home section "Issuer controls" (09), right side: what the page
// /issuer-controls covers, not the data itself. One line per power in plain
// words, the issuers covered, how many tokens on how many chains, and the
// date of the read. No addresses, role names or blocks: those are on the
// page, one click away. Both apps render it; it is short enough for a phone
// as it is.
//
// Every figure comes from GET /api/te/controls?by=issuer (controls/model.js
// coverage()). Without rows it renders nothing.

import React from 'react';
import { Pause, Snowflake, Flame, ArrowUpCircle, Globe, ArrowRight } from 'lucide-react';
import { Card, CardTitle, DevTag } from '../ui/primitives';
import { POWERS, coverage } from './model';

export const POWER_ICONS = { pause: Pause, freeze: Snowflake, burn: Flame, upgrade: ArrowUpCircle, who_may_hold: Globe };

export default function ControlsSummary({ data, href = '/issuer-controls', onOpen }) {
  const cov = coverage(data);
  if (!cov) return null;
  const open = (e) => {
    if (!onOpen || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(href);
  };
  return (
    <Card>
      <CardTitle right={<DevTag data={data} />}>What we read for every token</CardTitle>
      <ul className="divide-y divide-line">
        {POWERS.map((p) => {
          const Icon = POWER_ICONS[p.key];
          return (
            <li key={p.key} className="py-2.5 flex items-start gap-3">
              <span className="mt-0.5 w-7 h-7 shrink-0 rounded border border-line-strong flex items-center justify-center text-fg">
                <Icon size={14} aria-hidden="true" />
              </span>
              <div className="min-w-0 text-[13px] leading-snug">
                <span className="font-semibold text-fg">{p.label}</span>
                <span className="text-muted">: {p.ask.charAt(0).toLowerCase() + p.ask.slice(1)}</span>
                {p.issuerWords && <span className="block text-[12px] text-muted">From the issuer&apos;s own terms, linked and dated; not a chain read.</span>}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 pt-3 border-t border-line space-y-1 text-[13px] leading-snug">
        {cov.issuers.length > 0 && (
          <p><span className="text-muted">Issuers: </span><span className="text-fg">{cov.issuers.join(', ')}</span></p>
        )}
        {Number.isFinite(cov.tokens) && (
          <p className="text-fg">
            <span className="font-semibold tabular-nums">{cov.tokens.toLocaleString('en-US')}</span> listed tokens on{' '}
            <span className="font-semibold tabular-nums">{cov.chains}</span> {cov.chains === 1 ? 'chain' : 'chains'}
          </p>
        )}
        {cov.asOf && <p className="text-[12px] text-muted">Pause, freeze, burn and upgrade read on chain, as of {cov.asOf}.</p>}
      </div>
      <a
        href={href}
        onClick={open}
        className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg underline-offset-2 hover:underline"
      >
        Read more<ArrowRight size={14} aria-hidden="true" />
      </a>
    </Card>
  );
}
