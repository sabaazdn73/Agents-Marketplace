// HabitCosts.jsx
//
// "What your habits cost": the measured sections of /api/wallet/habits, and
// nothing that is not in the response. No counterfactual: no "what crossing
// cost you versus making", which would need a price the order did not trade
// at.
//
// Every figure carries its window and sample count on the line beneath it,
// taken from the response rather than restated here. Every absence prints the
// route's own reason sentence through Withheld. A zero is shown only where the
// route returned a zero.

import React from 'react';
import {
  Basis, Withheld, feeWords, fmtAge, fmtAmount, fmtCount, fmtDays, fmtPct, fmtRate,
  fmtSpan, fmtUsd, fmtUtc,
} from './format';

function Section({ title, children }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0 border-t border-line first:border-t-0">
      <h3 className="text-label font-semibold uppercase tracking-wide text-muted mb-2">{title}</h3>
      {children}
    </div>
  );
}

function FeeSide({ side, value, fills, reason, token, reasons }) {
  const w = feeWords(value, token);
  return (
    <div className="min-w-0">
      <p className="text-label text-muted">{side}</p>
      {w ? (
        <>
          <p className={`figure text-title ${w.tone}`}>{w.amount}</p>
          <p className="text-label text-muted">{w.word}, {fmtCount(fills)} fills</p>
        </>
      ) : <Withheld reasons={reasons} code={reason} />}
    </div>
  );
}

function FeeToken({ row, reasons }) {
  return (
    <div className="mt-2">
      <p className="text-label font-semibold text-fg mb-1">{row.token}</p>
      <div className="grid grid-cols-2 gap-3">
        <FeeSide side="Maker" value={row.maker} fills={row.maker_fills} reason={row.maker_withheld_reason} token={row.token} reasons={reasons} />
        <FeeSide side="Taker" value={row.taker} fills={row.taker_fills} reason={row.taker_withheld_reason} token={row.token} reasons={reasons} />
      </div>
    </div>
  );
}

function Fees({ f, reasons }) {
  if (f.withheld_reason) return <Withheld reasons={reasons} code={f.withheld_reason} />;
  const w = f.window || {};
  return (
    <>
      {f.usdc ? <FeeToken row={f.usdc} reasons={reasons} /> : <Withheld reasons={reasons} code={f.usdc_withheld_reason} />}
      {(f.other_tokens || []).map((t) => <FeeToken key={t.token} row={t} reasons={reasons} />)}
      <Basis>
        {fmtCount(f.fills)} fills, {fmtUtc(w.start)} to {fmtUtc(w.end)} ({fmtSpan(w.hours)}), {w.basis}.
        {' '}{f.sign_convention} Fees in different tokens are not added together or converted.
      </Basis>
      {f.capped && f.capped_note && (
        <p className="text-label text-warn mt-1">{f.capped_note}</p>
      )}
      {f.unreadable_fills > 0 && (
        <Basis>{fmtCount(f.unreadable_fills)} fills could not be read and are not in the totals.</Basis>
      )}
      {f.builder_fee && (
        <div className="mt-2 p-2 rounded-md bg-inset border border-line">
          <p className="text-label text-fg">
            Builder fees:{' '}
            {f.builder_fee.by_token.map((b) => `${fmtAmount(b.total)} ${b.token} over ${fmtCount(b.fills)} fills`).join('; ')}
          </p>
          <Basis>{f.builder_fee.note}</Basis>
        </div>
      )}
    </>
  );
}

function TakerShare({ t, reasons }) {
  if (t.withheld_reason) return <Withheld reasons={reasons} code={t.withheld_reason} />;
  const w = t.window || {};
  return (
    <>
      <p className="figure text-h1 text-fg">{fmtPct(t.taker_share)}</p>
      <p className="text-label text-muted">of volume taken rather than made, {w.label}</p>
      <div className="grid grid-cols-2 gap-3 mt-2">
        <div><p className="text-label text-muted">Taker volume</p><p className="figure text-body text-fg">{fmtUsd(t.taker_volume_usd)}</p></div>
        <div><p className="text-label text-muted">Maker volume</p><p className="figure text-body text-fg">{fmtUsd(t.maker_volume_usd)}</p></div>
      </div>
      {(t.user_cross_rate != null || t.user_add_rate != null) && (
        <p className="text-label text-fg mt-2">
          Your fee rates now: taker {fmtRate(t.user_cross_rate) ?? 'not stated'}, maker {fmtRate(t.user_add_rate) ?? 'not stated'}.
        </p>
      )}
      <Basis>{w.days} daily rows, {fmtUtc(w.start_date, { withTime: false })} to {fmtUtc(w.end_date, { withTime: false })}; {w.basis}</Basis>
    </>
  );
}

function Funding({ f, reasons }) {
  const w = f.window || {};
  const coverage = (
    <div className={`mb-2 p-2 rounded-md border ${f.partial ? 'border-warn/40 bg-warn/10' : 'border-line bg-inset'}`}>
      <p className="text-label font-semibold text-fg">
        Covers {fmtDays(w.covered_days) ?? 'no time'} of the {w.requested_days} days asked for
      </p>
      <p className="text-label text-muted">{fmtUtc(w.covered_from)} to {fmtUtc(w.covered_to)}, {w.basis}.</p>
      {f.partial && (
        <>
          {f.missing && <p className="text-label text-warn mt-1">{f.missing}</p>}
          <Withheld reasons={reasons} code={f.partial_reason} className="mt-1" />
        </>
      )}
    </div>
  );
  if (f.withheld_reason && !w.covered_from) return <Withheld reasons={reasons} code={f.withheld_reason} />;
  return (
    <>
      {coverage}
      {f.withheld_reason ? <Withheld reasons={reasons} code={f.withheld_reason} /> : (
        <>
          <p className={`figure text-h1 ${f.net_usdc < 0 ? 'text-fg' : 'text-pos'}`}>
            {f.net_usdc < 0 ? `${fmtAmount(Math.abs(f.net_usdc))} USDC paid, net` : `${fmtAmount(f.net_usdc)} USDC received, net`}
          </p>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div><p className="text-label text-muted">Paid</p><p className="figure text-body text-fg">{fmtAmount(f.paid_usdc)} USDC</p></div>
            <div><p className="text-label text-muted">Received</p><p className="figure text-body text-fg">{fmtAmount(f.received_usdc)} USDC</p></div>
          </div>
          <Basis>{fmtCount(f.rows)} funding payments over {f.pages} pages read. {f.sign_convention}</Basis>
        </>
      )}
    </>
  );
}

const BAND_WORDS = {
  quoting: 'quoting: most post-only orders rest on the book',
  mixed: 'mixed',
  spraying: 'spraying: most post-only orders are refused',
};

function PostOnly({ p, reasons }) {
  const w = p.window || {};
  return (
    <>
      {p.withheld_reason ? <Withheld reasons={reasons} code={p.withheld_reason} /> : (
        <>
          <p className="figure text-h1 text-fg">{fmtPct(p.rejection_rate, 2)}</p>
          <p className="text-label text-muted">
            of post-only orders refused by the venue{p.band ? `, band ${BAND_WORDS[p.band] || p.band}` : ''}
          </p>
          <Basis>{fmtCount(p.alo_rejected)} refused of {fmtCount(p.alo_total)} post-only orders.</Basis>
        </>
      )}
      {p.label && <Basis>{p.label}</Basis>}
      {w.newest_record_age_seconds != null && (
        <Basis>Newest order {fmtAge(w.newest_record_age_seconds)} old.{p.capped ? ` Capped at the venue's ${fmtCount(p.cap)} most recent records.` : ''}</Basis>
      )}
      {p.age_rule?.older_than_tracked_limit && <Basis>{p.age_rule.note}</Basis>}
    </>
  );
}

function CancelsPerFill({ p, reasons }) {
  const code = p.cancels_per_fill_withheld_reason;
  if (code || p.cancels_per_fill == null) return <Withheld reasons={reasons} code={code || p.withheld_reason} />;
  return (
    <>
      <p className="figure text-h1 text-fg">{p.cancels_per_fill.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
      <p className="text-label text-muted">cancels for every filled order</p>
      <Basis>{fmtCount(p.cancels)} cancels and {fmtCount(p.filled)} fills in the same {fmtCount(p.orders)} order records.</Basis>
    </>
  );
}

export default function HabitCosts({ data, who }) {
  const reasons = data.reasons || {};
  const codes = ['fees', 'taker_share', 'funding', 'post_only'].map((k) => data[k]?.withheld_reason || null);
  const sharedReason = codes.every((c) => c && c === codes[0]) && data.post_only?.window == null ? codes[0] : null;
  return (
    <section className="card p-4" aria-labelledby="habits-title">
      <h2 id="habits-title" className="text-title font-bold">What {who === 'your wallet' ? 'your' : "this address's"} habits cost</h2>
      <p className="text-label text-muted mt-0.5 mb-4">
        Measured from the venue&apos;s public record for this address on Hyperliquid. Nothing here is an estimate.
      </p>
      {/* One reason for every section (no account on the venue, for one) is
          said once, naming the sections it covers, rather than five times. */}
      {/* With no account on the venue, the Hyperliquid account card already
          prints the route's sentence; this card points to it rather than
          printing the same sentence a second time. */}
      {sharedReason === 'no_account' && data.account?.exists === false ? (
        <p className="text-label text-muted">
          Nothing to measure, for the reason given under Hyperliquid account. This covers fees paid, taker share, funding, post-only rejection and cancels per fill.
        </p>
      ) : sharedReason ? (
        <>
          <Withheld reasons={reasons} code={sharedReason} />
          <p className="text-label text-muted mt-2">This applies to fees paid, taker share, funding, post-only rejection and cancels per fill.</p>
        </>
      ) : (
      <>
      <Section title="Fees paid"><Fees f={data.fees || {}} reasons={reasons} /></Section>
      <Section title="Taker share"><TakerShare t={data.taker_share || {}} reasons={reasons} /></Section>
      <Section title="Funding"><Funding f={data.funding || {}} reasons={reasons} /></Section>
      <Section title="Post-only rejection"><PostOnly p={data.post_only || {}} reasons={reasons} /></Section>
      <Section title="Cancels per fill"><CancelsPerFill p={data.post_only || {}} reasons={reasons} /></Section>
      </>
      )}
    </section>
  );
}
