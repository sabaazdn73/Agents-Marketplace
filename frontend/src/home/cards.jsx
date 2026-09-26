// home/cards.jsx
//
// The real UI cards: the home page's feature sections show them, and the
// product pages reuse them. Each takes the parsed answer of one endpoint
// (te/api.js documents the shapes) and returns null when the field it needs
// is missing, so no card ever draws an empty frame or a zero it did not
// measure. Both apps render these; `compact` tightens them for a phone.

import React, { useMemo, useState } from 'react';
import { Check, Copy, Pause, Snowflake, Flame, ArrowUpCircle, Globe } from 'lucide-react';
import {
  Card, CardTitle, DevTag, GroupChip, SymbolTile, Sparkline, Pills,
  fmtUsd, fmtUsd0, fmtBps, fmtPct, BigMoney,
} from '../ui/primitives';
import { hasRows } from '../te/api';

/* 02 · One stock, many tokens. GET /api/te/underlying/{T}?size=1000
 *
 * Every version renders, in three kinds of row:
 *   filled   the pool fills the whole size: ranked by cost, the cheapest in
 *            green and the dearest in red (only among filled rows);
 *   thin     the pool fills part of it: "Pool too thin for $1,000: its pool
 *            holds $x", unranked;
 *   no pool  no pool found on that chain, unranked.
 * versionRows() is the one list the card draws; pricedCount() is how many
 * of its rows have a cost, which is what a headline may count ("k different
 * bills"): a thin or missing pool has no bill at that size. */
export function versionRows(data) {
  if (!data || !hasRows(data.versions)) return [];
  // The kind follows filled_fraction: all of the size, part of it, none.
  const filled = (v) => Number.isFinite(v.cost_bps) && v.filled_fraction >= 1;
  const thin = (v) => !filled(v) && Number.isFinite(v.filled_fraction) && v.filled_fraction > 0;
  const kind = (v) => (filled(v) ? 'filled' : thin(v) ? 'thin' : 'nopool');
  const order = { filled: 0, thin: 1, nopool: 2 };
  return data.versions
    .map((v) => ({ ...v, kind: kind(v) }))
    .sort((a, b) => order[a.kind] - order[b.kind] || (a.kind === 'filled' ? a.cost_bps - b.cost_bps : 0));
}

export const pricedCount = (data) => versionRows(data).filter((r) => r.kind === 'filled').length;

export function VersionsCard({ data, compact = false }) {
  const rows = versionRows(data);
  if (!rows.length) return null;
  const filled = rows.filter((r) => r.kind === 'filled');
  const lo = filled[0]?.cost_bps, hi = filled[filled.length - 1]?.cost_bps;
  const size = fmtUsd0(data.size);
  return (
    <Card>
      <CardTitle right={<DevTag data={data} />}>{data.name || data.ticker}: cost to buy {size}</CardTitle>
      <ul className="divide-y divide-line">
        {rows.map((v) => (
          <li key={v.key} className="py-2.5 flex items-center gap-3">
            <SymbolTile symbol={v.symbol} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-fg truncate">{v.symbol}</div>
              <div className="text-[12px] text-muted truncate">{v.issuer} · {v.chain}</div>
            </div>
            {!compact && <GroupChip group={v.group} />}
            {v.kind === 'filled' ? (
              <div className={`w-20 shrink-0 text-right tabular-nums text-[14px] ${filled.length > 1 && v.cost_bps === lo ? 'text-pos' : filled.length > 1 && v.cost_bps === hi ? 'text-neg' : 'text-fg'}`}>
                {fmtBps(v.cost_bps)}
              </div>
            ) : (
              <div className="w-32 shrink-0 text-right text-[11px] leading-snug text-muted">
                {v.kind === 'thin'
                  ? (Number.isFinite(v.pool_usd) ? `Pool too thin for ${size}: its pool holds ${fmtUsd0(v.pool_usd)}` : `Pool too thin for ${size}: it fills ${Math.round(v.filled_fraction * 100)}%`)
                  : `No pool found on ${v.chain}`}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* 03 · Every chain, grouped. GET /api/te/summary (chain_list) */
export function ChainsCard({ data }) {
  if (!data || !hasRows(data.chain_list)) return null;
  const groups = [['evm', 'EVM'], ['nonevm', 'Non-EVM']].map(([g, label]) => [label, data.chain_list.filter((c) => c.group === g)]).filter(([, cs]) => cs.length);
  if (!groups.length) return null;
  return (
    <Card>
      <CardTitle right={<DevTag data={data} />}>Chains we read</CardTitle>
      <div className="space-y-4">
        {groups.map(([label, cs]) => (
          <div key={label}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">{label}</div>
            <ul className="grid grid-cols-2 gap-2">
              {cs.map((c) => (
                <li key={c.name} className="flex items-center justify-between rounded bg-inset px-3 h-9 text-[13px]">
                  <span className="text-fg">{c.name}</span>
                  {Number.isFinite(c.tokens) && <span className="text-muted tabular-nums">{c.tokens} tokens</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* 04 · The real cost at your size. GET /api/te/curve/{T} */
export function CostCurveCard({ data }) {
  const stops = data?.stops;
  const [i, setI] = useState(() => (Array.isArray(stops) ? Math.max(0, stops.indexOf(10000)) : 0));
  if (!data || !hasRows(stops) || !hasRows(data.chains)) return null;
  const size = stops[Math.min(i, stops.length - 1)];
  const rows = data.chains
    .map((c) => ({ ...c, v: c.bps?.[i] }))
    .sort((a, b) => (a.v == null) - (b.v == null) || (a.v ?? 0) - (b.v ?? 0));
  const max = Math.max(...rows.map((r) => r.v || 0), 1);
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Order size</div>
          <div className="mt-1"><BigMoney value={size} className="text-[36px]" /></div>
        </div>
        <DevTag data={data} />
      </div>
      <input
        type="range" min={0} max={stops.length - 1} step={1} value={i}
        onChange={(e) => setI(Number(e.target.value))}
        aria-label="Order size" aria-valuetext={fmtUsd0(size)}
        className="w-full mt-4 accent-[rgb(var(--fg))]"
      />
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={`${r.chain}-${r.symbol}`} className="grid grid-cols-[110px_1fr_78px] items-center gap-3 text-[13px]">
            <span className="text-fg truncate">{r.chain}</span>
            {r.v == null
              ? <span className="text-muted text-[12px] col-span-2">Can&apos;t fill at this size</span>
              : (
                <>
                  <span className="h-2 rounded-full bg-inset overflow-hidden">
                    <span className="block h-full rounded-full bg-chart" style={{ width: `${(r.v / max) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-fg">{fmtBps(r.v)}</span>
                </>
              )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-muted">{data.ticker}, the lowest-cost version on each chain; measured on the pools, not quoted.</p>
    </Card>
  );
}

/* 06 · How a buy goes. No figures: the steps only. */
export function BuyStepsCard() {
  const steps = [
    ['Pick the version', 'Every token of the stock, with what each costs at your size.'],
    ['See the route', 'LI.FI finds the route in your browser; its fee is shown before you sign.'],
    ['Sign once', 'Your wallet signs the trade. The tokens go straight to it.'],
  ];
  return (
    <Card>
      <ol className="space-y-4">
        {steps.map(([h, p], n) => (
          <li key={h} className="flex gap-3">
            <span className="w-7 h-7 shrink-0 rounded-full border border-line-strong text-[12px] font-semibold flex items-center justify-center">{n + 1}</span>
            <div>
              <div className="text-[14px] font-semibold text-fg">{h}</div>
              <div className="text-[13px] text-muted">{p}</div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* 07 · A basket. GET /api/baskets/curated (one basket) */
export function BasketCard({ basket, source, onOpen }) {
  if (!basket || !hasRows(basket.legs)) return null;
  const COLORS = ['bg-chart', 'bg-chart-3', 'bg-chart-4', 'bg-chart-2', 'bg-chart-5'];
  return (
    <Card>
      <CardTitle right={<DevTag data={source} />}>{basket.name}</CardTitle>
      <div className="flex h-2 rounded-full overflow-hidden bg-inset mb-3" aria-hidden="true">
        {basket.legs.map((l, i) => <span key={l.symbol} className={COLORS[i % COLORS.length]} style={{ width: `${l.weight_bps / 100}%` }} />)}
      </div>
      <ul className="space-y-1.5 text-[13px]">
        {basket.legs.map((l, i) => (
          <li key={l.symbol} className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-sm ${COLORS[i % COLORS.length]}`} aria-hidden="true" />
            <span className="text-fg flex-1">{l.symbol}</span>
            <span className="tabular-nums text-muted">{(l.weight_bps / 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 pt-3 border-t border-line grid grid-cols-2 gap-y-1 text-[12px]">
        {Number.isFinite(basket.cost_bps_1k) && (<><dt className="text-muted">All-in to buy $1,000</dt><dd className="text-right tabular-nums text-fg">{fmtBps(basket.cost_bps_1k)}</dd></>)}
        {Number.isFinite(basket.signatures) && (<><dt className="text-muted">Signatures</dt><dd className="text-right tabular-nums text-fg">{basket.signatures}, one per stock</dd></>)}
        {Number.isFinite(basket.cap_usd) && (<><dt className="text-muted">Largest size under 1% cost</dt><dd className="text-right tabular-nums text-fg">{fmtUsd0(basket.cap_usd)}{basket.cap_leg ? `, set by ${basket.cap_leg}` : ''}</dd></>)}
      </dl>
      <p className="mt-3 text-[11px] text-muted">{source?.note || 'A fixed example basket; not a recommendation.'}</p>
      {onOpen && (
        <button type="button" onClick={onOpen} className="mt-2 text-[12px] font-semibold text-accent hover:underline">Open this basket</button>
      )}
    </Card>
  );
}

/* 08 · Vault due diligence. GET /api/vaults?limit=4
 * The five checks are the fields every vault page carries, named as fields:
 * a tick would claim a vault passed them. The chips name the platforms and
 * assets read, once each. */
const CHECKS = ['Real-world assets only', 'Audits and auditors', 'Upgrade authority, read on chain', 'Timelock on admin changes', 'What the manager can move'];
export function VaultChecksCard({ data }) {
  if (!data || !hasRows(data.vaults)) return null;
  const chips = [...new Set(data.vaults.map((v) => `${v.platform} · ${v.assets}`))].slice(0, 6);
  return (
    <Card>
      <CardTitle right={<DevTag data={data} />}>Every vault page shows</CardTitle>
      <ul className="divide-y divide-line text-[13px]">
        {CHECKS.map((c) => (
          <li key={c} className="py-2 text-fg">{c}</li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map((c) => (
          <span key={c} className="h-7 px-2.5 rounded border border-line-strong text-[12px] text-fg inline-flex items-center">{c}</span>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">Deposits happen on each venue; Tnega never holds funds.</p>
    </Card>
  );
}

/** The issuer's own words on who may hold a token, always with the link to
 *  where they are written and the date they were read. Without both, the
 *  words are not shown. */
export function Eligibility({ e }) {
  if (!e || !e.text || !e.url || !e.read_on) return <span className="text-muted">not read</span>;
  return (
    <span>
      {e.text}{' '}
      <a href={e.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-muted hover:text-fg">issuer&apos;s terms</a>
      <span className="block text-[11px] text-muted">read on {e.read_on}</span>
    </span>
  );
}

/* 09 · Issuer controls. GET /api/te/controls?by=issuer */
export function ControlsCard({ data, compact = false }) {
  if (!data || !hasRows(data.rows)) return null;
  const COLS = [['pause', 'Pause', Pause], ['freeze', 'Freeze', Snowflake], ['burn', 'Burn or seize', Flame], ['upgrade', 'Upgrade', ArrowUpCircle]];
  const rows = compact ? data.rows.slice(0, 3) : data.rows;
  return (
    <Card className="overflow-x-auto">
      <CardTitle right={<DevTag data={data} />}>Who holds each power</CardTitle>
      <table className="w-full text-[12px] min-w-[520px]">
        <thead>
          <tr className="text-muted text-left">
            <th className="font-medium pb-2 pr-3">Issuer</th>
            {COLS.map(([k, label, Icon]) => (
              <th key={k} className="font-medium pb-2 pr-3"><span className="inline-flex items-center gap-1"><Icon size={12} aria-hidden="true" />{label}</span></th>
            ))}
            <th className="font-medium pb-2"><span className="inline-flex items-center gap-1"><Globe size={12} aria-hidden="true" />Who may hold</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.programme}>
              <td className="py-2 pr-3 text-fg font-semibold">{r.issuer}<div className="font-normal text-muted">{(r.chains || []).join(', ')}</div></td>
              {COLS.map(([k]) => <td key={k} className="py-2 pr-3 text-fg">{r[k]?.text || <span className="text-muted">not established</span>}</td>)}
              <td className="py-2 text-fg"><Eligibility e={r.who_may_hold} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* 13 · Use with AI. The MCP endpoint and the install, which are real today. */
const MCP_URL = 'https://agents-marketplace-q3k4.onrender.com/mcp';
export function AiCard() {
  const [copied, setCopied] = useState(false);
  const cmd = 'npx tnega-mcp';
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* not fatal */ }
  };
  return (
    <Card>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">MCP server</div>
      <div className="mt-1 font-mono text-[13px] text-fg break-all">{MCP_URL}</div>
      <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">One command</div>
      <div className="mt-1 flex items-center justify-between gap-2 rounded bg-inset px-3 h-10">
        <code className="font-mono text-[13px] text-fg">{cmd}</code>
        <button type="button" onClick={copy} aria-label="Copy the command" className="text-muted hover:text-fg">
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <p className="mt-3 text-[12px] text-muted">No key, no account. It reads; it never signs.</p>
    </Card>
  );
}

/* Live lists · GET /api/te/list. One table for stocks and for ETFs.
 *
 * Takes the whole read state from useTe ({ data, error, loading, stale }):
 *   loading, nothing yet    renders nothing (no frame flashes in);
 *   the first read failed   renders nothing;
 *   a later read failed     the card, titled, with "Couldn't read the list";
 *   the answer has no rows  the card and its filter stay, with "No non-EVM
 *                           version listed" (or EVM, or nothing listed), so
 *                           the visitor can switch back;
 *   a filter changed        the previous rows stay, dimmed and labelled
 *                           "Updating", until the new answer replaces them. */
function emptyLine(group) {
  if (group === 'nonevm') return 'No non-EVM version listed.';
  if (group === 'evm') return 'No EVM version listed.';
  return 'Nothing listed.';
}

export function InstrumentList({ title, state, group, onGroup, onOpen, onSeeAll, compact = false }) {
  const { data, error, stale, ever } = state || {};
  // "Couldn't read" only after this list has shown rows once (a failed
  // filter change); a first read that fails renders nothing.
  if (!data && !(error && ever)) return null;
  const head = (
    <div className="px-4 pt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
        <DevTag data={data} />
        {stale && <span className="text-[11px] text-muted">Updating</span>}
      </div>
      <div className="flex items-center gap-2">
        {onGroup && !error && <Pills label="Chain group" value={group} onChange={onGroup} options={[{ id: 'all', label: 'All' }, { id: 'evm', label: 'EVM' }, { id: 'nonevm', label: 'Non-EVM' }]} />}
        {onSeeAll && <button type="button" onClick={onSeeAll} className="text-[12px] font-semibold text-accent hover:underline">See all</button>}
      </div>
    </div>
  );
  if (!data) {
    return <Card pad={false}>{head}<p className="px-4 py-5 text-[13px] text-muted">Couldn&apos;t read the list. Try again later.</p></Card>;
  }
  if (!hasRows(data.rows)) {
    return <Card pad={false}>{head}<p className="px-4 py-5 text-[13px] text-muted">{emptyLine(group)}</p></Card>;
  }
  return (
    <Card pad={false} className={stale ? 'opacity-60 transition-opacity' : ''}>
      {head}
      <table className={`w-full mt-2 text-[13px] ${compact ? 'table-fixed' : ''}`}>
        <thead>
          <tr className="text-muted text-left text-[12px]">
            <th className="font-medium px-4 py-2">Instrument</th>
            {!compact && <th className="font-medium py-2">Chain</th>}
            {!compact && <th className="font-medium py-2 text-right">Price per token</th>}
            <th className={`font-medium py-2 pr-4 text-right whitespace-nowrap ${compact ? 'w-[112px]' : 'md:pr-0'}`}>{compact ? `Cost at ${fmtUsd0(data.size || 1000)}` : `Cost to buy ${fmtUsd0(data.size || 1000)}`}</th>
            {!compact && <th className="font-medium py-2 text-right">Versions</th>}
            {!compact && <th className="font-medium px-4 py-2 text-right">7 days</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.rows.map((r) => (
            <tr key={r.best?.key || r.underlying} className={onOpen ? 'cursor-pointer hover:bg-inset/60' : ''} onClick={onOpen ? () => onOpen(r) : undefined}>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <SymbolTile symbol={r.underlying} />
                  <div className="min-w-0">
                    <div className="text-fg font-semibold truncate">{r.name}</div>
                    <div className="text-[12px] text-muted truncate">
                      <span className="inline-flex items-center h-4 px-1 mr-1 rounded bg-inset text-fg text-[11px]">{r.best?.symbol}</span>
                      {r.best?.issuer}{compact && r.best?.chain ? ` · ${r.best.chain}` : ''}
                    </div>
                  </div>
                </div>
              </td>
              {!compact && <td className="py-2.5"><div className="flex items-center gap-2 text-fg">{r.best?.chain}<GroupChip group={r.best?.group} /></div></td>}
              {!compact && <td className="py-2.5 text-right tabular-nums text-fg">{fmtUsd(r.best?.paid_per_token)}</td>}
              <td className={`py-2.5 pr-4 text-right tabular-nums ${compact ? '' : 'md:pr-0'}`}>
                <div className="text-fg">{fmtUsd(r.best?.cost_usd)}</div>
                <div className="text-[11px] text-muted">{fmtBps(r.best?.cost_bps)}</div>
              </td>
              {!compact && <td className="py-2.5 text-right text-muted tabular-nums">{r.versions}</td>}
              {!compact && <td className="px-4 py-2.5"><div className="flex justify-end"><Sparkline points={r.spark} /></div></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {data.sort === 'popular' && <p className="px-4 py-3 text-[11px] text-muted border-t border-line">Ordered by 7-day swap volume on the pools we read. Costs are the lowest-cost version, measured on its pool.</p>}
    </Card>
  );
}

/* Live lists · GET /api/vaults. */
export function VaultTable({ state, compact = false, onOpen }) {
  const { data, error, stale, ever } = state || {};
  if (!data && !(error && ever)) return null;
  if (!data || !hasRows(data.vaults)) {
    return (
      <Card>
        <div className="flex items-center justify-between gap-2"><h3 className="text-[15px] font-semibold text-fg">Vaults</h3><span className="text-[12px] text-muted">Deposits happen on each venue; Tnega never holds funds.</span></div>
        <p className="mt-3 text-[13px] text-muted">{data ? 'No qualifying vault found.' : "Couldn't read the vaults. Try again later."}</p>
      </Card>
    );
  }
  return (
    <Card pad={false} className={`overflow-x-auto ${stale ? 'opacity-60' : ''}`}>
      <div className="px-4 pt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h3 className="text-[15px] font-semibold text-fg">Vaults</h3><DevTag data={data} /></div>
        <span className="text-[12px] text-muted">Deposits happen on each venue; Tnega never holds funds.</span>
      </div>
      <table className={`w-full mt-2 text-[13px] ${compact ? '' : 'min-w-[560px]'}`}>
        <thead>
          <tr className="text-muted text-left text-[12px]">
            <th className="font-medium px-4 py-2">Vault</th>
            <th className="font-medium py-2">Manager and audits</th>
            {!compact && <th className="font-medium py-2">Assets and controls</th>}
            <th className="font-medium py-2 text-right">TVL</th>
            {!compact && <th className="font-medium px-4 py-2 text-right">Fees and lockup</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.vaults.map((v) => (
            <tr key={v.key || `${v.platform}-${v.name}`} className={onOpen ? 'cursor-pointer hover:bg-inset/60' : ''} onClick={onOpen ? () => onOpen(v) : undefined}>
              <td className="px-4 py-2.5"><div className="text-fg font-semibold">{v.name}</div><div className="text-[12px] text-muted">{v.platform} · {v.chain}</div></td>
              <td className="py-2.5 text-fg">{v.manager}<div className="text-[12px] text-muted">{v.audits}</div></td>
              {!compact && <td className="py-2.5 text-fg">{v.assets}<div className="text-[12px] text-muted">{v.controls}</div></td>}
              <td className="py-2.5 pr-4 md:pr-0 text-right tabular-nums text-fg" title={v.tvl_basis}>{fmtUsd0(v.tvl_usd)}<div className="text-[11px] text-muted">{v.tvl_source === 'computed_from_chain' ? 'computed from chain' : v.tvl_source === 'vault_recorded' ? `as recorded by the vault${v.tvl_last_written ? `, written ${String(v.tvl_last_written).slice(0, 10)}` : ''}` : ''}{v.stale ? ', stale' : ''}{v.nested_in ? ', inside another listed vault' : ''}</div><span className="sr-only">{v.tvl_basis}</span></td>
              {!compact && <td className="px-4 py-2.5 text-right text-fg">{v.fees}<div className="text-[12px] text-muted">{v.lockup}</div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export { fmtPct };
export const useSorted = (rows, key) => useMemo(() => [...(rows || [])].sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0)), [rows, key]);
