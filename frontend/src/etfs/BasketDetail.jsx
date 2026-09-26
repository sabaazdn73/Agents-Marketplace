// etfs/BasketDetail.jsx
//
// /my-etfs/<code>: a public basket, in the same page shape as a vault
// (owner's reference, README-vaults.md §B), with a different model:
//   Creator in place of the leader, Followers in place of depositors, and
//   "Buy this basket" in place of Deposit.
//   A basket is a static list of up to five tokens and weights. Each
//   follower buys the tokens into their own wallet: one signature per token,
//   plus a separate approval where a token needs one (SPEC.md C.3: legs run
//   one prompt each, grouped by chain; there is no single signature across
//   chains, so the page does not claim one).
//   There is no pooled account, no discretion, no lock-up and no profit
//   share, and nothing trades in a follower's wallet without their signature.
// Stat cards: basket value (indicative), return since creation, your
// holding, followers. Tabs: About / Composition / Real cost at your size /
// Your holding. Bottom tabs: Composition, Changes (each weight edit with its
// version), Followers.
//
// Reads GET /api/baskets/{code} (te/api.js). "Buy this basket" shows only
// once the buy flow works end to end (home/sections.js, `buy`).

import React from 'react';
import { useTe } from '../te/api';
import { DATA_LIVE } from '../dataLive';
import { SECTION_LIVE } from '../home/sections';
import { Card, DevTag, LineChart, PrimaryButton, GroupChip, fmtUsd, fmtBps } from '../ui/primitives';
import { Breadcrumb, CopyAddress, StatCard, SourceChip, TabbedCard, Field, shortAddr } from '../ui/detail';

const COLORS = ['bg-chart', 'bg-chart-3', 'bg-chart-4', 'bg-chart-2', 'bg-chart-5'];

function Weights({ legs }) {
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-inset mb-3" aria-hidden="true">
        {legs.map((l, i) => <span key={l.symbol} className={COLORS[i % COLORS.length]} style={{ width: `${l.weight_bps / 100}%` }} />)}
      </div>
      <table className="w-full text-[13px]">
        <thead><tr className="text-muted text-left text-[12px]"><th className="font-medium py-1.5">Token</th><th className="font-medium py-1.5">Issuer · chain</th><th className="font-medium py-1.5 text-right">Weight</th></tr></thead>
        <tbody className="divide-y divide-line">{legs.map((l, i) => (
          <tr key={`${l.symbol}-${l.chain}`}>
            <td className="py-2"><span className="inline-flex items-center gap-2 text-fg"><span className={`w-2 h-2 rounded-sm ${COLORS[i % COLORS.length]}`} aria-hidden="true" />{l.symbol}</span></td>
            <td className="py-2 text-muted"><span className="inline-flex items-center gap-2">{l.issuer} · {l.chain}<GroupChip group={l.group} /></span></td>
            <td className="py-2 text-right tabular-nums text-fg">{(l.weight_bps / 100).toFixed(0)}%</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function CostAtSize({ c }) {
  if (!c?.stops?.length) return <p className="text-[13px] text-muted">Not measured for this basket.</p>;
  return (
    <table className="w-full text-[13px]">
      <thead><tr className="text-muted text-left text-[12px]"><th className="font-medium py-1.5">Size</th><th className="font-medium py-1.5 text-right">All-in cost</th></tr></thead>
      <tbody className="divide-y divide-line">{c.stops.map((s, i) => (
        <tr key={s}><td className="py-2 text-fg tabular-nums">${s.toLocaleString('en-US')}</td><td className="py-2 text-right tabular-nums text-fg">{c.bps[i] == null ? <span className="text-muted">Can&apos;t fill at this size</span> : fmtBps(c.bps[i])}</td></tr>
      ))}</tbody>
    </table>
  );
}

export default function BasketDetail({ code, layout = 'web', onNavigate }) {
  const mobile = layout === 'mobile';
  const { data: b, error } = useTe(DATA_LIVE ? `/api/baskets/${code}` : null);
  if (!b) {
    if (error) return <Card><p className="text-[13px] text-muted">{error === 'HTTP 404' ? 'No basket with that code.' : "Couldn't read this basket. Try again later."}</p></Card>;
    return null;
  }
  const r = b.return_since_creation_pct;
  const note = 'A static list of tokens and weights. Each follower buys the tokens into their own wallet: one signature per token, plus an approval where a token needs one. No pooled funds, no lock-up, no profit share.';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Breadcrumb parent="My ETFs" parentPath="/my-etfs" name={b.name} onNavigate={onNavigate} />
          <h1 className={`${mobile ? 'text-[28px]' : 'text-[36px]'} mt-2 font-bold tracking-[-0.02em] text-fg`}>{b.name}</h1>
          <div className="mt-1 flex items-center gap-3 text-[13px] text-muted">Version {b.version}<DevTag data={b} /></div>
        </div>
        {SECTION_LIVE.buy && <PrimaryButton onClick={() => onNavigate?.('/stocks')}>Buy this basket</PrimaryButton>}
      </div>

      <div className={`grid gap-4 ${mobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
        <StatCard label="Basket value" note="Not measured"
          value={Number.isFinite(b.value_usd_indicative) ? <span className="text-[28px] font-light tabular-nums text-fg" title={b.value_basis}>{fmtUsd(b.value_usd_indicative)}</span> : null}
          chip={Number.isFinite(b.value_usd_indicative) ? <SourceChip title={b.value_basis}>indicative</SourceChip> : null} />
        <StatCard label="Return since creation" note="Not measured"
          value={Number.isFinite(r) ? <span className={`text-[28px] font-light tabular-nums ${r > 0 ? 'text-pos' : r < 0 ? 'text-neg' : 'text-fg'}`} title={b.return_basis}>{r > 0 ? '+' : ''}{r.toFixed(2)}%</span> : null}
          chip={Number.isFinite(r) ? <SourceChip title={b.return_basis}>{b.return_source || 'indicative'}</SourceChip> : null} />
        <StatCard label="Your holding" value={null} note="Not read for this basket" />
        <StatCard label="Followers" note="Not counted"
          value={Number.isFinite(b.followers_count) ? <span className="text-[28px] font-light tabular-nums text-fg">{b.followers_count}</span> : null} />
      </div>

      <div className={mobile ? 'space-y-4' : `grid gap-4 ${b.series?.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} items-start`}>
        <TabbedCard tabs={[
          { id: 'about', label: 'About', render: () => (
            <div>
              <Field label="Creator"><CopyAddress address={b.creator} /></Field>
              {b.created_at && <Field label="Created">{b.created_at}</Field>}
              {b.description && <Field label="Description">{b.description}</Field>}
              <Field label="How following works">{note}</Field>
            </div>
          ) },
          { id: 'composition', label: 'Composition', render: () => <Weights legs={b.legs} /> },
          { id: 'cost', label: 'Real cost at your size', render: () => <CostAtSize c={b.cost_at_size} /> },
          { id: 'you', label: 'Your holding', render: () => <p className="text-[13px] text-muted">Your holding is the tokens in your own wallet; it is not read here.</p> },
        ]} />
        {b.series?.length > 1 && (
          <Card>
            <div className="text-[13px] text-muted mb-2">Basket value, indicative</div>
            <LineChart series={b.series} height={230} />
            {b.value_basis && <p className="mt-2 text-[11px] text-muted">{b.value_basis}</p>}
          </Card>
        )}
      </div>

      <TabbedCard tabs={[
        { id: 'composition', label: 'Composition', count: b.legs.length, render: () => <Weights legs={b.legs} /> },
        { id: 'changes', label: 'Changes', count: b.changes?.length, show: b.changes?.length > 0, render: () => (
          <ul className="divide-y divide-line">{b.changes.map((c) => (
            <li key={c.version} className="py-3">
              <div className="text-[13px] text-fg font-semibold">Version {c.version} <span className="font-normal text-muted">· {c.at}{c.note ? ` · ${c.note}` : ''}</span></div>
              <div className="mt-1 text-[13px] text-muted">{c.legs.map((l) => `${l.symbol} ${(l.weight_bps / 100).toFixed(0)}%`).join(' · ')}</div>
            </li>
          ))}</ul>
        ) },
        { id: 'followers', label: 'Followers', count: b.followers?.length, show: b.followers?.length > 0, render: () => (
          <table className="w-full text-[13px]">
            <thead><tr className="text-muted text-left text-[12px]"><th className="font-medium py-1.5">Follower</th><th className="font-medium py-1.5 text-right">Since</th></tr></thead>
            <tbody className="divide-y divide-line">{b.followers.map((f) => (
              <tr key={f.address}><td className="py-2 font-mono text-fg">{f.address === b.creator ? 'Creator' : shortAddr(f.address)}</td><td className="py-2 text-right text-muted tabular-nums">{f.since}</td></tr>
            ))}</tbody>
          </table>
        ) },
      ]} />
      <p className="text-[12px] text-muted">{note} Not a recommendation.</p>
    </div>
  );
}
