// etfs/BasketBreakdown.jsx
//
// What one basket costs at one size, as the baskets routes serve it
// (GET /api/baskets/{code} and /api/baskets/evaluate; te/api.js): the legs,
// the basket's cost or why there is none, the cap or why there is none, the
// wallet prompts a buy takes, and the cost at every measured size with each
// gap's own reason. One component for the curated page and the builder, in
// both apps; `compact` draws the legs as cards on a phone.
//
// Each figure is the served one, its caveat beside it or behind its (i):
//   a leg's dollars are leg_usd; when they are not themselves a measured
//     size, the leg is priced at measured_at_usd and says so on the row;
//   a leg that does not fill, or fills with no version the engine ranks,
//     says which and why, in the served words;
//   the cap reads "at least" when a limiting leg is good up to the largest
//     measured size, and names every tied leg;
//   approvals are "up to": the server does not know the wallet's allowance.

import React from 'react';
import { Card, GroupChip, SymbolTile, fmtUsd, fmtUsd0, fmtBps } from '../ui/primitives';
import { measuredLine, sentence } from '../te/costText';
import { Tip } from '../dashboard/cards';

// The engine's 11 measured sizes (SPEC B.3); the baskets routes take these only.
export const STOPS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];

const COLORS = ['bg-chart', 'bg-chart-3', 'bg-chart-4', 'bg-chart-2', 'bg-chart-5'];
const pct = (w) => `${(w / 100).toFixed(w % 100 ? 2 : 0)}%`;

const LEG_STATE = {
  filled: 'Fills',
  unfilled: 'Does not fill',
  not_ranked: 'Not ranked',
};

/** Beside a leg whose own amount is not a measured size: "priced at the
 *  $250 measured size", or, under the smallest measured size, costed from
 *  the parts measured there (the served leg_cost_basis says how). */
export function measuredNote(l) {
  if (!Number.isFinite(l.measured_at_usd)) return null;
  if (l.below_smallest_stop) return `under the smallest measured size; costed from the parts measured at ${fmtUsd0(l.measured_at_usd)}`;
  if (l.size_exact !== false) return null;
  return `priced at the ${fmtUsd0(l.measured_at_usd)} measured size`;
}

/** One leg's own cap: "$500,000", "at least $1,000,000", or why none. */
function legCap(l) {
  if (Number.isFinite(l.cap_usd)) return `${l.cap_lower_bound ? 'at least ' : ''}${fmtUsd0(l.cap_usd)}`;
  return l.cap_reason ? sentence(l.cap_reason) : null;
}

// A leg's dollars: where the leg's amount is itself a measured size, the
// engine's own measured dollars (cost_usd_measured); only where it is not
// (priced at the next size up, or costed from parts under $100) the served
// leg_cost_usd, whose basis is named beneath. Never bps x size worked out
// here.
export function legDollars(l) {
  if (l.state !== 'filled') return null;
  if (l.size_exact !== false && !l.below_smallest_stop && Number.isFinite(l.cost_usd_measured)) return { usd: l.cost_usd_measured, measured: true };
  return Number.isFinite(l.leg_cost_usd) ? { usd: l.leg_cost_usd, measured: false } : null;
}

/** A leg's dollars for display: to the cent, or two significant figures
 *  under $1 ($0.67, $0.0084); the exact served value is in the tooltip. */
export function legDollarText(usd) {
  if (!Number.isFinite(usd)) return null;
  if (Math.abs(usd) >= 1) return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Math.abs(usd) < 0.0001) return usd === 0 ? '$0.00' : 'under $0.0001';
  return `$${usd.toPrecision(2)}`;
}

function LegCost({ l }) {
  if (l.state !== 'filled' || !Number.isFinite(l.leg_cost_bps)) return null;
  const d = legDollars(l);
  return (
    <>
      <span className="text-fg">{fmtBps(l.leg_cost_bps)}</span>
      {d && <span className="block text-[11px] text-muted" title={`${d.measured ? 'measured cost' : 'cost for this leg, from the measured size'}: $${d.usd}${l.leg_cost_basis ? `\n${l.leg_cost_basis}` : ''}`}>{legDollarText(d.usd)}{d.measured ? ', measured' : ''}</span>}
      {l.leg_cost_basis && <span className="sr-only">{l.leg_cost_basis}</span>}
    </>
  );
}

function VersionCell({ l }) {
  if (l.state !== 'filled') return <span>{l.pinned && l.symbol ? `${l.symbol} on ${l.chain}, chosen by you` : 'none priced'}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span className="text-fg">{l.symbol}</span>{l.issuer} · {l.chain}<GroupChip group={l.group} />
      <span className="text-[11px]">{l.pinned ? 'chosen by you' : 'best at this size'}</span>
    </span>
  );
}

function LegState({ l }) {
  const label = LEG_STATE[l.state] || (l.state ? sentence(String(l.state).replace(/_/g, ' ')) : 'Not measured');
  if (l.state === 'filled') return <span className="text-fg">{label}</span>;
  return (
    <span>
      <span className="font-semibold text-fg">{label}</span>
      {l.reason && <span className="block text-[12px] text-muted break-words">{sentence(l.reason)}</span>}
    </span>
  );
}

function LegsTable({ legs }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] min-w-[900px]">
        <thead>
          <tr className="text-muted text-left text-[12px]">
            <th className="font-medium py-1.5">Leg</th>
            <th className="font-medium py-1.5">Version · chain</th>
            <th className="font-medium py-1.5 text-right">Weight</th>
            <th className="font-medium py-1.5 text-right pl-3">Amount</th>
            <th className="font-medium py-1.5 text-right pl-3">Leg cost (vs pool mid)</th>
            <th className="font-medium py-1.5 text-right pl-3">Basket under 1% up to</th>
            <th className="font-medium py-1.5 pl-4">State</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {legs.map((l, i) => (
            <tr key={l.ticker} className="align-top">
              <td className="py-2"><span className="inline-flex items-center gap-2 text-fg font-semibold"><span className={`w-2 h-2 rounded-sm ${COLORS[i % COLORS.length]}`} aria-hidden="true" /><SymbolTile size="sm" underlying={l.ticker} />{l.ticker}</span></td>
              <td className="py-2 text-muted"><VersionCell l={l} /></td>
              <td className="py-2 text-right tabular-nums text-fg">{pct(l.weight_bps)}</td>
              <td className="py-2 text-right tabular-nums pl-3">
                <span className="text-fg">{fmtUsd0(l.leg_usd)}</span>
                {measuredNote(l) && <span className="block text-[11px] text-muted whitespace-nowrap">{measuredNote(l)}</span>}
              </td>
              <td className="py-2 text-right tabular-nums pl-3"><LegCost l={l} /></td>
              <td className="py-2 text-right tabular-nums pl-3 text-[12px] text-muted max-w-[200px]">{legCap(l)}</td>
              <td className="py-2 pl-4 max-w-[320px]"><LegState l={l} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegCards({ legs }) {
  return (
    <ul className="divide-y divide-line">
      {legs.map((l, i) => (
        <li key={l.ticker} className="py-2.5 text-[13px]">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-fg font-semibold"><span className={`w-2 h-2 rounded-sm ${COLORS[i % COLORS.length]}`} aria-hidden="true" /><SymbolTile size="sm" underlying={l.ticker} />{l.ticker} · {pct(l.weight_bps)}</span>
            <span className="text-right tabular-nums">
              <span className="text-fg">{fmtUsd0(l.leg_usd)}</span>
              {l.state === 'filled' && Number.isFinite(l.leg_cost_bps) && <span className="block text-[11px] text-muted">{fmtBps(l.leg_cost_bps)}</span>}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] text-muted"><VersionCell l={l} /></div>
          {l.leg_cost_basis && <div className="text-[11px] text-muted">{l.leg_cost_basis}</div>}
          {legCap(l) && <div className="text-[11px] text-muted">Basket under 1% up to, by this leg: {legCap(l)}</div>}
          {measuredNote(l) && <div className="text-[11px] text-muted">{sentence(measuredNote(l))}</div>}
          <div className="mt-0.5 text-[12px]"><LegState l={l} /></div>
        </li>
      ))}
    </ul>
  );
}

/** The cap in words: "$200,000, set by QQQ" or "at least $1,000,000, set
 *  by NVDA, MSFT, AAPL and GOOGL", or the served reason there is none. */
export function capText(b) {
  const names = (b.cap_legs && b.cap_legs.length ? b.cap_legs : b.cap_leg ? [b.cap_leg] : []);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  if (Number.isFinite(b.cap_usd)) {
    return `${b.cap_lower_bound ? 'at least ' : ''}${fmtUsd0(b.cap_usd)}${list ? `, set by ${list}${names.length > 1 ? ' (tied)' : ''}` : ''}`;
  }
  return b.cap_reason ? sentence(b.cap_reason) : null;
}

// Signatures and chain switches are two counts, as served: a chain switch
// is a wallet prompt too, but no total of the two is served, so none is
// added up here.
function Prompts({ b }) {
  const p = b.prompts;
  if (!p) return null;
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  return (
    <div>
      <div className="text-fg">
        Up to {n(p.signatures_up_to, 'signature', 'signatures')}: {n(p.swaps, 'swap', 'swaps')}
        {p.approvals_up_to ? `, and up to ${n(p.approvals_up_to, 'approval', 'approvals')} where the allowance is short` : ''}, one leg at a time.
      </div>
      {Number.isFinite(p.chain_switches) && (
        <div className="text-fg">{n(p.chain_switches, 'chain switch', 'chain switches')}, plus one if your wallet starts on another chain.</div>
      )}
      {p.partial && hasMissing(p) && <div className="text-[12px] text-warn">Counted without {p.missing.join(', ')}: no priced version at this size.</div>}
      {p.basis && <span className="inline-flex align-middle"><Tip label="How this is counted" align="left"><span className="block">{sentence(p.basis)}</span></Tip></span>}
    </div>
  );
}
const hasMissing = (p) => Array.isArray(p.missing) && p.missing.length > 0;

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[minmax(0,38%)_1fr] gap-x-3 py-2 text-[13px] border-b border-line last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** The cost at each measured size; a gap names its own served reason. */
export function CostAtSize({ c, size }) {
  if (!c?.stops?.length) return <p className="text-[13px] text-muted">Not measured for this basket.</p>;
  return (
    <div>
      <table className="w-full text-[13px]">
        <thead><tr className="text-muted text-left text-[12px]"><th className="font-medium py-1.5">Basket size</th><th className="font-medium py-1.5 text-right">Cost (vs pool mid)</th></tr></thead>
        <tbody className="divide-y divide-line">{c.stops.map((s, i) => (
          <tr key={s} className={s === size ? 'bg-inset/60' : ''}>
            <td className="py-2 text-fg tabular-nums align-top">{fmtUsd0(s)}</td>
            <td className="py-2 text-right tabular-nums">
              {c.bps[i] == null
                ? <span className="text-muted text-[12px]">{sentence(c.null_reason?.[i]) || 'No figure at this size'}</span>
                : <span className="text-fg">{fmtBps(c.bps[i])}</span>}
            </td>
          </tr>
        ))}</tbody>
      </table>
      {c.basis && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">How each size is measured <Tip label="About the sizes" align="left"><span className="block">{sentence(c.basis)}</span></Tip></p>}
    </div>
  );
}

export default function BasketBreakdown({ b, compact = false }) {
  if (!b || !Array.isArray(b.legs)) return null;
  const measured = measuredLine(b.computed_at, b.legs.map((l) => l.us_market_open));
  const unfilled = Array.isArray(b.unfilled_legs) ? b.unfilled_legs : [];
  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-[15px] font-semibold text-fg mb-2 flex items-center gap-1.5">
          The legs at {fmtUsd0(b.size)}
          {b.size_exact === false && (
            <Tip label="About the leg amounts" align="left">
              <span className="block">Some legs&apos; amounts are not measured sizes; each of those is priced at the next measured size up, as its row says. Nothing is interpolated.</span>
            </Tip>
          )}
        </h3>
        {compact ? <LegCards legs={b.legs} /> : <LegsTable legs={b.legs} />}
      </Card>
      <Card>
        <div className="flex items-center gap-1.5 mb-1 text-[15px] font-semibold text-fg">
          Cost and size
          {(b.size_basis || b.cap_basis || measured) && (
            <Tip label="How these are measured" align="left">
              {b.size_basis && <span className="block">{sentence(b.size_basis)}</span>}
              {b.cap_basis && <span className="block">{sentence(b.cap_basis)}</span>}
              {measured && <span className="block">Simulated on the pools, not quoted. {measured}</span>}
            </Tip>
          )}
        </div>
        <dl>
          <Row label={`Cost to buy ${fmtUsd0(b.size)}`}>
            {Number.isFinite(b.cost_bps)
              ? <span className="text-fg inline-flex flex-wrap items-center gap-1.5">{fmtBps(b.cost_bps)}{Number.isFinite(b.cost_usd) ? `, ${fmtUsd(b.cost_usd)}` : ''}
                <Tip label="About this cost" align="left"><span className="block">Fees and price impact against each pool&apos;s own price{b.lifi_fee_included ? ', with LI.FI’s 0.25% fee' : ''}.</span></Tip>
              </span>
              : <span className="text-fg">{sentence(String(b.cost_reason || '').replace(/; see unfilled_legs$/, '')) || 'Not measured'}</span>}
            {unfilled.length > 0 && !unfilled.every((u) => String(b.cost_reason || '').includes(u.reason)) && (
              <ul className="mt-1 space-y-0.5 text-[12px] text-muted">
                {unfilled.map((u) => <li key={u.ticker}><span className="text-fg">{u.ticker}</span> at {fmtUsd0(u.measured_at_usd)}: {u.reason}</li>)}
              </ul>
            )}
          </Row>
          <Row label={`Largest basket under ${Number.isFinite(b.threshold_bps) ? `${b.threshold_bps} bps` : '1%'}`}>
            <span className="text-fg">{capText(b) || 'Not measured'}</span>
            {b.cap_lower_bound && <span className="inline-flex align-middle ml-1.5"><Tip label="About “at least”" align="left"><span className="block">&quot;At least&quot;: a limiting leg is under the threshold even at the largest size measured.</span></Tip></span>}
          </Row>
          <Row label="Signatures and chain switches"><Prompts b={b} /></Row>
          {Array.isArray(b.by_chain) && b.by_chain.length > 0 && (
            <Row label="By chain">
              <ul className="space-y-0.5">
                {b.by_chain.map((c) => (
                  <li key={c.chain_id} className="flex flex-wrap items-center gap-x-2 text-fg">
                    {c.chain}<GroupChip group={c.group} /><span className="text-muted">{c.legs.join(', ')}: {c.swaps} swap{c.swaps === 1 ? '' : 's'}{c.approvals_up_to ? `, up to ${c.approvals_up_to} approval${c.approvals_up_to === 1 ? '' : 's'}` : ''}</span>
                  </li>
                ))}
              </ul>
            </Row>
          )}
        </dl>
      </Card>
    </div>
  );
}
