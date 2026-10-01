// controls/TokenControls.jsx
//
// One token's issuer controls, GET /api/te/controls?by=key&key=. Shown on
// the stock page for the chosen version and at the top of /issuer-controls
// when the address names a token (?token=<key>). One component, so the two
// cannot describe the same token differently.

import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Card, CardTitle, DevTag } from '../ui/primitives';
import { sentence } from '../te/costText';
import { Cell, WhoMayHold, AddressPool, addressesIn } from './Cell';
import { dayText } from './model';
import { Tip } from '../dashboard/cards';

// The stock page listed these six before the page existed; who may hold is
// shown by the stock page beside its version, and by this card on the page.
const ROWS = [
  ['pause', 'Pause'], ['freeze', 'Freeze or denylist'], ['burn', 'Burn or seize'],
  ['upgrade', 'Upgrade'], ['mint', 'Mint'], ['allowlist', 'Allowlist'],
];

export default function TokenControls({ data, withWhoMayHold = false, compact = false, link = null, onNavigate }) {
  const d = data;
  if (!d) return null;
  const title = `Issuer controls on ${d.symbol}, ${d.chain}`;
  if (!d.controls) {
    return d.reason ? <Card><CardTitle>{title}</CardTitle><p className="text-[13px] text-muted">{sentence(d.reason)}.</p></Card> : null;
  }
  const rows = ROWS.filter(([k]) => d.controls[k]);
  const go = (e) => {
    if (!onNavigate || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate(link.href);
  };
  return (
    <AddressPool.Provider value={[...addressesIn(d.controls)]}>
    <Card>
      <CardTitle right={<DevTag data={d} />}>
        <span className="relative inline-flex items-center gap-1">
          {title}
          <Tip label="How these were read" align="left" className="!static">
            <p>Read on chain at the block or slot named in each piece of evidence (Show details){d.computed_at ? `; assembled ${dayText(d.computed_at)}` : ''}.</p>
            <p>&quot;Single key (inferred)&quot; means the holder has no code; no code does not prove it is one person. &quot;Not established&quot; means our reads did not settle it.</p>
          </Tip>
        </span>
      </CardTitle>
      <ul className="divide-y divide-line">
        {rows.map(([k, label]) => (
          <li key={k} className="py-2.5">
            <div className="grid grid-cols-[110px_1fr] gap-x-3">
              <span className="text-[13px] text-muted">{label}</span>
              <Cell c={d.controls[k]} chain={d.chain} />
            </div>
          </li>
        ))}
        {withWhoMayHold && d.controls.who_may_hold && (
          <li className="py-2.5">
            <div className="grid grid-cols-[110px_1fr] gap-x-3">
              <span className="text-[13px] text-muted">Who may hold</span>
              <WhoMayHold e={d.controls.who_may_hold} clamp={compact} />
            </div>
          </li>
        )}
      </ul>
      {d.computed_at && <p className="mt-3 pt-3 border-t border-line text-[11px] text-muted">Read on chain; assembled {dayText(d.computed_at)}.</p>}
      {link && (
        <a href={link.href} onClick={go} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg underline-offset-2 hover:underline">
          {link.label}<ArrowRight size={14} aria-hidden="true" />
        </a>
      )}
    </Card>
    </AddressPool.Provider>
  );
}
