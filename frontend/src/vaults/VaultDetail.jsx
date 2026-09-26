// vaults/VaultDetail.jsx
//
// /vaults/<platform>/<address>, in the layout and information order of
// Hyperliquid's vault page (owner's reference, 02 and 04): breadcrumb, name
// and address, Withdraw and Deposit at the top right; four stat cards (TVL,
// 30-day change, your position, age); left, About / Due diligence / Your
// position; right, the chart with Share price / TVL and a range; along the
// bottom, Holdings and Controls. The reference's Activity, Deposits &
// withdrawals and Depositors tabs join when T6 serves those reads; a tab
// with nothing to show is not drawn.
//
// Reads GET /api/vaults/{platform}/{address} (T6). Every figure carries its
// source in words; a part the answer does not carry is left out, and a tab
// with nothing in it is not drawn. Deposit and Withdraw open the panel that
// ends in a link to the venue (DepositPanel.jsx): nothing is signed here.

import React, { useCallback, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useTe } from '../te/api';
import { DATA_LIVE } from '../dataLive';
import { Card, DevTag, LineChart, Pills, PrimaryButton, SecondaryButton, fmtUsd0 } from '../ui/primitives';
import { Breadcrumb, CopyAddress, StatCard, SourceChip, TabbedCard, Field, provText, shortAddr } from '../ui/detail';
import { tvlSourceLabel } from './VaultList';
import { explorerUrl } from './venues';
import DepositPanel from './DepositPanel';

const RANGES = [['7', '7D'], ['30', '30D'], ['all', 'All']];

function ExtLink({ href, children }) {
  if (!href) return <span>{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg break-all">{children}<ExternalLink size={11} aria-hidden="true" className="inline ml-1 align-baseline" /></a>;
}

function Chart({ v }) {
  const [tab, setTab] = useState('share_price');
  const [range, setRange] = useState('30');
  const s = v.series || {};
  const tabs = [['share_price', 'Share price'], ['tvl', 'TVL']].filter(([k]) => s[k]?.length > 1);
  if (!tabs.length) return null;
  const cur = tabs.find(([k]) => k === tab) ? tab : tabs[0][0];
  const all = s[cur];
  const cut = range === 'all' ? all : all.slice(-Number(range) - 1);
  return (
    <Card pad={false} className="min-w-0">
      <div className="flex items-end justify-between gap-2 border-b border-line px-4">
        <div role="tablist" className="flex gap-5 text-[13px]">
          {tabs.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={cur === k} onClick={() => setTab(k)}
              className={`py-3 -mb-px border-b-2 ${cur === k ? 'border-fg text-fg font-semibold' : 'border-transparent text-muted hover:text-fg'}`}>{l}</button>
          ))}
        </div>
        <div className="py-2"><Pills label="Range" value={range} onChange={setRange} options={RANGES.map(([id, label]) => ({ id, label }))} /></div>
      </div>
      <div className="p-4">
        <LineChart series={cut} height={230} />
        <p className="mt-2 text-[11px] text-muted">{cur === 'share_price' ? 'Share price, read on chain at each point.' : `TVL, ${v.tvl?.basis || 'as the answer states it'}.`}</p>
      </div>
    </Card>
  );
}

function DueDiligence({ v }) {
  const m = v.manager || {};
  const c = v.controls || {};
  const programs = c.upgrade?.programs || [];
  return (
    <div>
      <Field label="Who controls the money" prov={provText(m)}>
        {m.vault_admin ? <div>Vault admin: {m.vault_admin.text}</div> : m.text}
        {m.allocation_admin && <div>Allocation admin: {m.allocation_admin.text}</div>}
        {m.pending_admin && <div>Pending admin: {m.pending_admin.text}</div>}
      </Field>
      {(c.global_admin || c.market_owners?.length) && (
        <Field label="Other admin keys" prov={provText(c)}>
          {c.global_admin && <div>Global admin: {c.global_admin.text}</div>}
          {c.market_owners?.length > 0 && <div>Market owners: {c.market_owners.join('; ')}</div>}
        </Field>
      )}
      {programs.length > 0 && (
        <Field label="Upgradeability" prov={provText({ class: 'A', slot: programs[0].slot })}>
          {programs.map((p) => <div key={p.program}>{shortAddr(p.program)}: {p.state}{p.authority_detail?.text ? `, by ${p.authority_detail.text}` : ''}</div>)}
        </Field>
      )}
      {c.pause?.text && <Field label="Pause" prov={provText(c.pause)}>{c.pause.text}</Field>}
      {v.lockup?.text && <Field label="Lock-up" prov={provText(v.lockup)}>{v.lockup.text}</Field>}
      {v.fees?.text && <Field label="Fees" prov={provText(v.fees)}>{v.fees.text}</Field>}
      {v.assets?.text && <Field label="What it holds" prov={provText(v.assets)}>{v.assets.text}</Field>}
      {v.powers?.rows?.length > 0 && (
        <Field label="What each role can do" prov={provText(v.powers)}>
          {v.powers.rows.map(([role, what]) => <div key={role} className="mt-1"><span className="font-semibold">{role}:</span> {what}</div>)}
          {v.powers.moves && <div className="mt-1 text-muted">{v.powers.moves}</div>}
        </Field>
      )}
      {v.audits?.text && (
        <Field label="Audits" prov={v.audits.read_on ? `From the audit page, read ${v.audits.read_on}` : null}>
          <ExtLink href={v.audits.url}>{v.audits.text}</ExtLink>
          {v.audits.note && <div className="mt-1 text-muted">{v.audits.note}</div>}
        </Field>
      )}
    </div>
  );
}

function About({ v }) {
  return (
    <div>
      <Field label="Curator">{v.manager?.text}</Field>
      <Field label="Venue and chain">{v.platform} · {v.chain}</Field>
      <Field label="Vault">
        <ExtLink href={explorerUrl(v.chain, v.address)}><span className="font-mono">{v.address}</span></ExtLink>
      </Field>
      {v.program && <Field label="Program"><ExtLink href={explorerUrl(v.chain, v.program)}><span className="font-mono">{v.program}</span></ExtLink></Field>}
      {v.token?.mint && <Field label={`Deposit token, ${v.token.symbol}`}><ExtLink href={explorerUrl(v.chain, v.token.mint)}><span className="font-mono">{v.token.mint}</span></ExtLink></Field>}
      {v.read_at && <Field label="Read at">{v.read_at}</Field>}
    </div>
  );
}

export default function VaultDetail({ platform, address, layout = 'web', onNavigate }) {
  const mobile = layout === 'mobile';
  const { data: v, error } = useTe(DATA_LIVE ? `/api/vaults/${platform}/${address}` : null);
  const [panel, setPanel] = useState(null);
  const close = useCallback(() => setPanel(null), []);
  if (!v) {
    if (error) return <Card><p className="text-[13px] text-muted">{error === 'HTTP 404' ? 'No listed vault at that address on that venue.' : "Couldn't read this vault. Try again later."}</p></Card>;
    return null;
  }
  const t = v.tvl || {};
  const r = v.return_30d;
  const allocations = v.assets?.allocations || [];
  const programs = v.controls?.upgrade?.programs || [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Breadcrumb parent="Vaults" parentPath="/vaults" name={v.name} onNavigate={onNavigate} />
          <h1 className={`${mobile ? 'text-[28px]' : 'text-[36px]'} mt-2 font-bold tracking-[-0.02em] text-fg`}>{v.name}</h1>
          <div className="mt-1 flex items-center gap-3"><CopyAddress address={v.address} /><DevTag data={v} /></div>
        </div>
        <div className="flex gap-2">
          <SecondaryButton onClick={() => setPanel('withdraw')}>Withdraw</SecondaryButton>
          <PrimaryButton arrow={false} onClick={() => setPanel('deposit')}>Deposit</PrimaryButton>
        </div>
      </div>

      <div className={`grid gap-4 ${mobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
        <StatCard label="TVL" value={Number.isFinite(t.usd) ? <span className="text-[28px] font-light tabular-nums text-fg" title={t.basis}>{fmtUsd0(t.usd)}</span> : null}
          chip={<>
            <SourceChip title={t.basis}>{tvlSourceLabel(t.source)}</SourceChip>
            {(v.row?.tvl_last_written) && <SourceChip title={t.basis}>written {String(v.row.tvl_last_written).slice(0, 10)}</SourceChip>}
            {(v.stale || v.row?.stale) && <span className="inline-flex items-center h-5 px-1.5 rounded border border-warn/60 text-warn text-[10px] font-semibold uppercase" title="The latest read of this vault failed; these are the previous read's figures">stale</span>}
          </>} note="Not read" />
        <StatCard label="30-day change" note="Not measured for this vault"
          value={Number.isFinite(r?.pct) ? <span className={`text-[28px] font-light tabular-nums ${r.pct > 0 ? 'text-pos' : r.pct < 0 ? 'text-neg' : 'text-fg'}`} title={r.basis}>{r.pct > 0 ? '+' : ''}{r.pct.toFixed(2)}%</span> : null}
          chip={Number.isFinite(r?.pct) ? <SourceChip title={r.basis}>share price, chain</SourceChip> : null} />
        <StatCard label="Your position" value={null} note="Not read for this vault" />
        <StatCard label="Age (days)" value={Number.isFinite(v.age_days) ? <span className="text-[28px] font-light tabular-nums text-fg">{v.age_days}</span> : null} note="Not read" />
      </div>

      {t.basis && (
        <p className="text-[12px] text-muted">
          TVL basis: {t.basis}{t.reconciliation ? `. ${t.reconciliation}` : ''}{t.slot ? `. Slot ${Number(t.slot).toLocaleString('en-US')}` : ''}.
          {v.row?.nested_in ? ' This vault sits inside another listed vault, so its dollars are part of that vault\'s TVL too.' : ''}
        </p>
      )}

      <div className={mobile ? 'space-y-4' : `grid gap-4 ${v.series ? 'grid-cols-2' : 'grid-cols-1'} items-start`}>
        <TabbedCard tabs={[
          { id: 'about', label: 'About', render: () => <About v={v} /> },
          { id: 'dd', label: 'Due diligence', render: () => <DueDiligence v={v} /> },
          { id: 'you', label: 'Your position', render: () => <p className="text-[13px] text-muted">Your share of this vault is not read here. Your wallet on {v.platform} shows it.</p> },
        ]} />
        <Chart v={v} />
      </div>

      <TabbedCard pad={false} tabs={[
        { id: 'holdings', label: 'Holdings', count: allocations.length, show: allocations.length > 0, render: () => (
          <div className="overflow-x-auto"><table className="w-full text-[13px]">
            <thead><tr className="text-muted text-left text-[12px]"><th className="font-medium px-4 py-2">Reserve</th>{!mobile && <th className="font-medium py-2">Market</th>}{!mobile && <th className="font-medium py-2">Market owner</th>}<th className="font-medium px-4 py-2 text-right">Value ({v.token?.symbol || t.symbol})</th></tr></thead>
            <tbody className="divide-y divide-line">{allocations.map((a) => (
              <tr key={a.reserve}><td className="px-4 py-2 font-mono text-fg">{shortAddr(a.reserve)}</td>{!mobile && <td className="py-2 font-mono text-muted">{shortAddr(a.lending_market)}</td>}{!mobile && <td className="py-2 text-fg">{a.market_owner_text}</td>}<td className="px-4 py-2 text-right tabular-nums text-fg">{Number(a.value_tokens).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td></tr>
            ))}</tbody></table>
            <p className="px-4 py-2 text-[11px] text-muted">{provText(v.assets)}.</p></div>
        ) },
        { id: 'controls', label: 'Controls', count: programs.length, show: programs.length > 0, render: () => (
          <div className="overflow-x-auto"><table className="w-full text-[13px]">
            <thead><tr className="text-muted text-left text-[12px]"><th className="font-medium px-4 py-2">Program</th><th className="font-medium py-2">State</th><th className="font-medium py-2">Upgrade authority</th><th className="font-medium px-4 py-2 text-right">Last deploy slot</th></tr></thead>
            <tbody className="divide-y divide-line">{programs.map((p) => (
              <tr key={p.program}><td className="px-4 py-2 font-mono text-fg">{shortAddr(p.program)}</td><td className="py-2 text-fg">{p.state}</td><td className="py-2 text-fg">{p.authority_detail?.text || shortAddr(p.authority)}</td><td className="px-4 py-2 text-right tabular-nums text-fg">{p.last_deploy_slot ? Number(p.last_deploy_slot).toLocaleString('en-US') : '–'}</td></tr>
            ))}</tbody></table></div>
        ) },
      ]} />

      {v.notice && <p className="text-[12px] text-muted">{v.notice}</p>}
      {panel && <DepositPanel vault={v} mode={panel} onClose={close} />}
    </div>
  );
}
