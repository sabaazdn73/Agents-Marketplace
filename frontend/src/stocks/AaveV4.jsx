// stocks/AaveV4.jsx
//
// Whether a version on Base is accepted as collateral on Aave V4, as read on
// Base (GET /api/te/underlying/<T>, each version's `aave_v4`, and the body's
// `aave_v4_usdc_borrow`; the sources and Aave's eligibility wording from
// GET /api/te/aave-v4). One module for the stock page's table (web), its
// cards (phone) and the chosen version's details, so the three cannot word it
// differently.
//
// WHAT IS SHOWN, and what is not:
//   - a version outside Base (aave_v4 null or absent): nothing about Aave;
//   - not read yet on this server: "not read yet", never a zero;
//   - listed false: "not listed", with the reason in plain words;
//   - listed: "yes, max LTV X%". V4 has ONE collateral factor, so
//     liquidation starts at the same X% (no buffer), said beside the figure;
//   - the amount supplied is "supplied to the market", never "used as
//     collateral": V4 switches collateral on per user, and no total of that
//     exists to read;
//   - the USDC borrow rate is an APR (the hub's drawn rate, not compounded);
//   - every figure carries the block and time it was read, and "stale" with
//     the age when the server's latest read failed.

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Card, CardTitle } from '../ui/primitives';
import { useTe } from '../te/api';
import { DATA_LIVE } from '../dataLive';
import { Tip } from '../dashboard/cards';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null));
const pctText = (x, d = 0) => {
  const n = num(x);
  if (n == null) return null;
  return `${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 2) })}%`;
};
const tokens = (x) => {
  const n = num(x);
  return n == null ? null : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

/** "block 51,962,403, 29 Sep, 20:35 UTC". The date is always there: reads
 *  run only when someone asks, so after a quiet spell a figure can be from
 *  an earlier day. */
export function readAtText(a) {
  if (!a || a.block == null) return null;
  const b = `block ${Number(a.block).toLocaleString('en-US')}`;
  const t = a.block_time ? new Date(a.block_time) : null;
  const ok = t && !Number.isNaN(t.getTime());
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = ok ? `${t.getUTCDate()} ${MON[t.getUTCMonth()]}` : null;
  const hm = ok ? t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : null;
  return hm ? `${b}, ${day}, ${hm}` : b;
}

/** An age in people's units: minutes under 2 hours, hours under 48, then
 *  days. */
export function ageText(seconds) {
  const s = num(seconds);
  if (s == null || s < 0) return null;
  if (s < 60) return 'under a minute';
  const m = Math.round(s / 60);
  if (m < 120) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(s / 3600);
  if (h < 48) return `${h} hours`;
  const d = Math.round(s / 86400);
  return `${d} days`;
}

/** "stale: last read 11 minutes ago", only when the server says so. One age,
 *  in people's units; the server's own reason text (which carries its age in
 *  seconds) is not repeated beside it. */
export function staleText(a) {
  if (!a || a.status !== 'stale') return null;
  const age = ageText(a.age_seconds);
  return age ? `stale: last read ${age} ago` : 'stale: the latest read failed';
}

/** A server reason as the start of a sentence, ending with a full stop. */
const sentence = (t) => {
  const x = String(t || '').trim();
  if (!x) return '';
  const y = x[0].toUpperCase() + x.slice(1);
  return /[.!?]$/.test(y) ? y : `${y}.`;
};

/** Why a Base version has no Aave V4 market, in plain words. */
export function notListedText(a, symbol) {
  const r = String(a?.reason || '');
  const note = /did not answer/i.test(r) ? " (whether Aave's Equities Hub lists it was not read)"
    : /isUnderlyingListed false/i.test(r) ? ' (the Equities Hub does not list it)' : '';
  return `Read on Base: Aave V4 has no market for ${symbol}${note}.`;
}

/** "25 Sep 2026" from "2026-09-25". */
const dayText = (iso) => {
  const d = iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) : null;
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d && !Number.isNaN(d.getTime()) ? `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}` : null;
};

/** Whether there is anything about Aave to show for this version. */
export const hasAave = (v) => v && v.aave_v4 != null && typeof v.aave_v4 === 'object';

/** The one line: { text, tone } ('pos' | 'muted' | 'warn'). */
export function aaveLine(a) {
  if (!a) return null;
  if (a.read === false) {
    return { text: a.status === 'off' ? 'Collateral on Aave V4: not read on this server' : 'Collateral on Aave V4: not read yet', tone: 'muted' };
  }
  if (a.listed === false) return { text: 'Collateral on Aave V4: not listed', tone: 'muted' };
  if (a.listed && a.collateral) {
    const ltv = pctText(a.max_ltv_pct);
    const extra = a.accepts_new_collateral === false ? ' (no new collateral accepted now)' : '';
    // Neutral colour: a listing is a fact, not a gain or an approval.
    return { text: `Collateral on Aave V4: yes, max LTV ${ltv || 'not read'}${extra}`, tone: a.accepts_new_collateral === false ? 'warn' : 'fg' };
  }
  if (a.listed) return { text: 'Collateral on Aave V4: listed, not accepted as collateral', tone: 'muted' };
  return null;
}

/** For a table row or a phone card: the line, and when it was read. */
export function AaveV4Inline({ v }) {
  if (!hasAave(v)) return null;
  const a = v.aave_v4;
  const line = aaveLine(a);
  if (!line) return null;
  const when = readAtText(a);
  const stale = staleText(a);
  const tone = line.tone === 'fg' ? 'text-fg' : line.tone === 'warn' ? 'text-warn' : 'text-muted';
  return (
    <div className="mt-0.5 text-[11px] leading-snug">
      <span className={tone}>{line.text}</span>
      {when && <span className="text-muted"> · {when}</span>}
      {stale && <span className="text-warn"> · {stale}</span>}
    </div>
  );
}

function Row({ label, tip = null, children }) {
  return (
    <div className="grid grid-cols-[minmax(0,38%)_1fr] gap-x-3 py-2 text-[13px]">
      <dt className="relative text-muted flex items-start gap-1">{label}{tip && <Tip label={`About ${label.toLowerCase()}`} align="left" className="!static">{tip}</Tip>}</dt>
      <dd className="text-fg min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Ext({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">
      {children}<ExternalLink size={11} aria-hidden="true" className="inline ml-1 align-baseline" />
    </a>
  );
}

/** The chosen version's details. `borrow` is the body's aave_v4_usdc_borrow. */
export function AaveV4Card({ v, borrow }) {
  const show = hasAave(v);
  // The sources and Aave's own eligibility wording: read only for a Base
  // version, once per page.
  // Not before the first read: the route answers 503 until there is one.
  const snap = useTe(DATA_LIVE && show && v.aave_v4.read !== false ? '/api/te/aave-v4' : null);
  if (!show) return null;
  const a = v.aave_v4;
  const line = aaveLine(a);
  const s = snap.data?.snapshot || null;
  const elig = s?.eligibility;
  const src = s?.sources?.addresses;
  const when = readAtText(a);
  const stale = staleText(a);
  const b = borrow && borrow.read !== false ? borrow : null;
  const listed = a.listed === true;

  return (
    <Card>
      <CardTitle>{`${v.symbol} on Aave V4 (Base)`}</CardTitle>
      <p className={`text-[14px] font-semibold ${line?.tone === 'warn' ? 'text-warn' : 'text-fg'}`}>{line?.text}</p>
      {a.read === false && <p className="mt-1 text-[12px] text-muted">{sentence(a.reason || 'Aave V4 on Base has not been read on this server yet')} No figure is shown until it is read.</p>}
      {a.listed === false && <p className="mt-1 text-[12px] text-muted">{notListedText(a, v.symbol)}</p>}

      {listed && (
        <dl className="mt-2 divide-y divide-line border-t border-line">
          <Row label="Collateral factor" tip={<>
            {pctText(a.max_ltv_pct) && <p>Borrowing is allowed up to {pctText(a.max_ltv_pct)} of the collateral&apos;s value; liquidation starts at the same {pctText(a.liquidation_threshold_pct ?? a.max_ltv_pct)}: V4 has one collateral factor, so there is no buffer between the two.</p>}
            <p>A position keeps the factor stored at its last health-checked action; the one shown is the reserve&apos;s current one.</p>
          </>}>
            {pctText(a.max_ltv_pct) ? `Max LTV ${pctText(a.max_ltv_pct)}; liquidation at ${pctText(a.liquidation_threshold_pct ?? a.max_ltv_pct)} (no buffer)` : 'not read'}
          </Row>
          <Row label="Supplied to the market" tip={<p>What is supplied to the market. V4 turns collateral on per user, so no market-wide collateral total exists to read.</p>}>
            {tokens(a.supplied_tokens) != null ? `${tokens(a.supplied_tokens)} ${v.symbol}` : 'not read'}
            {num(a.add_cap_tokens) != null && <> of a {tokens(a.add_cap_tokens)} {v.symbol} cap{pctText(a.add_cap_used_pct, 1) ? ` (${pctText(a.add_cap_used_pct, 1)} used)` : ''}</>}
          </Row>
          {(a.paused || a.frozen || a.halted) && (
            <Row label="State"><span className="text-warn">{[a.paused && 'paused', a.frozen && 'frozen', a.halted && 'halted'].filter(Boolean).join(', ')}</span></Row>
          )}
        </dl>
      )}

      {listed && (
        <dl className="divide-y divide-line border-b border-line">
          <Row label="USDC borrow rate" tip={<p>The hub&apos;s drawn rate, not compounded. A borrower pays it times one plus a risk premium that depends on the collateral.</p>}>
            {b && num(b.borrow_apr_pct) != null
              ? <>{pctText(b.borrow_apr_pct, 2)} APR{num(b.utilization_pct) != null ? ` (utilization ${pctText(b.utilization_pct, 1)})` : ''}</>
              : borrow?.read === false ? 'not read yet' : 'not read'}
            {b && readAtText(b) && b.block !== a.block && <span className="block text-[12px] text-muted">Read at {readAtText(b)}.</span>}
          </Row>
        </dl>
      )}

      <div className="mt-3 space-y-1 text-[12px] text-muted">
        {when && <p>Read on Base at {when}.{stale && <span className="text-warn"> {sentence(stale)} {/^the latest read failed/i.test(String(a.status_reason || ''))
          ? 'The latest read failed, so these are the last figures read.'
          : 'Older than the 10-minute refresh; a new read has been started.'}</span>}</p>}
        {listed && elig?.text && elig?.url && (
          <p>
            Who {v.symbol} is offered to, in Aave&apos;s words: &ldquo;{elig.text}&rdquo;{' '}
            (<Ext href={elig.url}>Aave</Ext>{dayText(elig.published) ? `, ${dayText(elig.published)}` : ''}). Not enforced by Tnega.
          </p>
        )}
        {src?.url && (
          <p>
            Sources: <Ext href={src.url}>{src.file || 'the address book'} at {src.commit}</Ext>{src.read_on ? `, read ${src.read_on}` : ''}; figures read on chain.
          </p>
        )}
      </div>
    </Card>
  );
}
