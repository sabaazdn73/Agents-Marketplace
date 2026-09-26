// vaults/VaultList.jsx
//
// /vaults, in the layout and information order of Hyperliquid's vault list
// (owner's reference, 01-vaults-list): a total-TVL card, a search box and
// filters, then one table per venue with a sparkline column. Reads GET
// /api/vaults (T6, branch te-vaults); te/api.js documents the shape.
//
// WHAT EACH FIGURE IS
//   TVL        the vault's own figure from T6, with its source beside it:
//              "chain" when computed from the vault's positions read on
//              chain, "vault-recorded" when it is the total the vault itself
//              recorded (not recomputed by us). Stablecoins at 1 USD.
//   30-day     the change in the vault's share price over 30 days, read on
//              chain, when the answer carries it (return_30d); otherwise a
//              dash. No APY from any other source is shown (owner, 26 Sep).
//   Check      ✓ the TVL reconciles with the vault's records; ⚠ the TVL is
//              the vault's own record, not reconciled; ? partial read.
// The listing rule (the answer's `rule`) is shown on the page, and every
// venue with nothing listed says why, as do the published exclusions.

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Card, DevTag, Sparkline, fmtUsd0 } from '../ui/primitives';
import { SourceChip, shortAddr } from '../ui/detail';

const ROWS_PER_PAGE = 10;

export function tvlSourceLabel(src) {
  return src === 'computed_from_chain' ? 'computed from chain' : src === 'vault_recorded' ? 'as recorded by the vault' : null;
}

/** Under a TVL figure: its source, when the vault last wrote it (for a
 *  vault-recorded total), whether this read is stale, and the full basis
 *  (face value, synthetic dollars and so on) on hover and for screen
 *  readers. */
export function TvlNote({ v, align = 'right' }) {
  return (
    <div className={`mt-0.5 flex flex-wrap gap-1 ${align === 'right' ? 'justify-end' : ''}`} title={v.tvl_basis}>
      <SourceChip title={v.tvl_basis}>{tvlSourceLabel(v.tvl_source)}</SourceChip>
      {v.tvl_last_written && <SourceChip title={v.tvl_basis}>written {String(v.tvl_last_written).slice(0, 10)}</SourceChip>}
      {v.stale && <span className="inline-flex items-center h-5 px-1.5 rounded border border-warn/60 text-warn text-[10px] font-semibold uppercase tracking-wide" title="The latest read of this vault failed; these are the previous read's figures">stale</span>}
      <span className="sr-only">{v.tvl_basis}</span>
    </div>
  );
}

export function checkMark(v) {
  if (v.tvl_partial) return { mark: '?', label: 'Partial read: some positions could not be valued' };
  if (v.tvl_source === 'computed_from_chain' && /^reconciles/.test(v.tvl_reconciliation || '')) return { mark: '✓', label: v.tvl_reconciliation };
  return { mark: '⚠', label: v.tvl_reconciliation || 'Not reconciled' };
}

function VenueTable({ platform, rows, onOpen, compact, nestedName }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const view = rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);
  return (
    <div className="mt-6 first:mt-2">
      <h3 className="px-4 text-[15px] font-semibold text-fg">{platform}</h3>
      <div className="overflow-x-auto">
        {/* Fixed widths, so every venue's table lines up with the others. */}
        <table className={`w-full mt-2 text-[13px] ${compact ? '' : 'table-fixed min-w-[900px]'}`}>
          {!compact && (
            <colgroup>
              <col style={{ width: '22%' }} /><col style={{ width: '24%' }} /><col style={{ width: '7%' }} /><col style={{ width: '10%' }} />
              <col style={{ width: '15%' }} /><col style={{ width: '8%' }} /><col style={{ width: '5%' }} /><col style={{ width: '9%' }} />
            </colgroup>
          )}
          <thead>
            <tr className="text-muted text-left text-[12px]">
              <th className="font-medium px-4 py-2">Vault</th>
              {!compact && <th className="font-medium py-2">Curator</th>}
              {!compact && <th className="font-medium py-2">Asset</th>}
              {!compact && <th className="font-medium py-2 text-right" title="Share price change over 30 days, read on chain">30-day change</th>}
              <th className="font-medium py-2 text-right pr-4 md:pr-0">TVL</th>
              {!compact && <th className="font-medium py-2 text-right">Age (days)</th>}
              {!compact && <th className="font-medium py-2 text-center">Check</th>}
              {!compact && <th className="font-medium px-4 py-2 text-right">30 days</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {view.map((v) => {
              const c = checkMark(v);
              const r = v.return_30d?.pct;
              return (
                <tr key={v.key} className="cursor-pointer hover:bg-inset/60" onClick={() => onOpen(v)}>
                  <td className="px-4 py-2.5">
                    <div className="text-fg font-semibold">{v.name}</div>
                    <div className="text-[12px] text-muted font-mono">{shortAddr(v.address)}{compact ? ` · ${v.chain}` : ''}</div>
                    {v.nested_in && <div className="text-[11px] text-muted">Inside {nestedName(v.nested_in)}</div>}
                  </td>
                  {!compact && <td className="py-2.5 text-fg max-w-[220px]"><div className="truncate" title={v.manager}>{v.manager}</div></td>}
                  {!compact && <td className="py-2.5 text-fg">{v.tvl_symbol}</td>}
                  {!compact && (
                    <td className="py-2.5 text-right tabular-nums" title={v.return_30d?.basis || 'Not measured for this vault'}>
                      {Number.isFinite(r) ? <span className={r > 0 ? 'text-pos' : r < 0 ? 'text-neg' : 'text-fg'}>{r > 0 ? '+' : ''}{r.toFixed(2)}%</span> : <span className="text-muted">–</span>}
                    </td>
                  )}
                  <td className="py-2.5 text-right pr-4 md:pr-0" title={v.tvl_basis}>
                    <div className="tabular-nums text-fg">{fmtUsd0(v.tvl_usd)}</div>
                    <TvlNote v={v} />
                  </td>
                  {!compact && <td className="py-2.5 text-right tabular-nums text-fg">{Number.isFinite(v.age_days) ? v.age_days : <span className="text-muted">–</span>}</td>}
                  {!compact && <td className="py-2.5 text-center text-fg" title={c.label} aria-label={c.label}>{c.mark}</td>}
                  {!compact && <td className="px-4 py-2.5"><div className="flex justify-end"><Sparkline points={v.series?.share_price?.map((p) => p[1])} width={72} height={24} /></div></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="px-4 py-2 flex items-center justify-end gap-3 text-[12px] text-muted">
          <span>{page * ROWS_PER_PAGE + 1}–{Math.min(rows.length, (page + 1) * ROWS_PER_PAGE)} of {rows.length}</span>
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="h-7 px-2 rounded border border-line-strong disabled:opacity-40">Previous</button>
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="h-7 px-2 rounded border border-line-strong disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="inline-flex items-center gap-2 text-[12px] text-muted">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-9 px-2 rounded bg-field border border-line-strong text-fg text-[13px] focus:outline-none focus:ring-2 focus:ring-accent">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export default function VaultList({ state, layout = 'web', onNavigate }) {
  const compact = layout === 'mobile';
  const data = state?.data;
  const [q, setQ] = useState('');
  const [venue, setVenue] = useState('all');
  const [chain, setChain] = useState('all');
  const [equity, setEquity] = useState(false);

  const vaults = data?.vaults || [];
  const filtered = useMemo(() => vaults.filter((v) => {
    const s = q.trim().toLowerCase();
    if (s && !`${v.name} ${v.address} ${v.manager}`.toLowerCase().includes(s)) return false;
    if (venue !== 'all' && v.platform_key !== venue) return false;
    if (chain !== 'all' && v.chain !== chain) return false;
    if (equity && !v.holds_tokenized_equity) return false;
    return true;
  }), [vaults, q, venue, chain, equity]);

  if (!data) {
    if (state?.error && state?.ever) return <Card><p className="text-[13px] text-muted">Couldn&apos;t read the vaults. Try again later.</p></Card>;
    return null;
  }

  // Each dollar once: a vault nested in another listed vault is already in
  // that vault's TVL, so it is not added again.
  const counted = vaults.filter((v) => !v.nested_in);
  const nested = vaults.length - counted.length;
  const total = counted.reduce((a, v) => a + (Number.isFinite(v.tvl_usd) ? v.tvl_usd : 0), 0);
  const bySource = counted.reduce((a, v) => ({ ...a, [v.tvl_source]: (a[v.tvl_source] || 0) + 1 }), {});
  const stale = vaults.filter((v) => v.stale).length;
  const byKey = Object.fromEntries(vaults.map((v) => [v.key, v.name]));
  const nestedName = (k) => byKey[k] || shortAddr(k.split('/')[1]);
  const platforms = data.platforms || [];
  const listedPlatforms = platforms.filter((p) => filtered.some((v) => v.platform_key === p.platform_key));
  const nonePlatforms = platforms.filter((p) => p.status !== 'listed');
  const chains = [...new Set(vaults.map((v) => v.chain))];
  const anyEquity = vaults.some((v) => v.holds_tokenized_equity);
  const open = (v) => onNavigate?.(`/vaults/${v.platform_key}/${v.address}`);

  return (
    <div className="space-y-4 md:space-y-6">
      <Card className="max-w-[420px]">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] text-muted">Total value locked, listed vaults</div>
          <DevTag data={data} />
        </div>
        <div className="mt-1 text-[32px] font-light tabular-nums text-fg">{fmtUsd0(total)}</div>
        <div className="mt-1 text-[11px] text-muted">
          Sum of {counted.length} vaults, each dollar once: {bySource.computed_from_chain || 0} computed from chain reads, {bySource.vault_recorded || 0} as the vault records it.{nested ? ` ${nested} vault${nested > 1 ? 's' : ''} inside another listed vault ${nested > 1 ? 'are' : 'is'} not added again.` : ''}{stale ? ` ${stale} from an earlier read (stale).` : ''} Stablecoins at 1 USD per token, face value. As of {data.as_of}.
        </div>
      </Card>

      <Card pad={false}>
        <div className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-[220px] max-w-[420px] h-9 flex items-center gap-2 px-3 rounded bg-field border border-line-strong focus-within:ring-2 focus-within:ring-accent">
            <Search size={15} className="text-muted shrink-0" aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by vault, address or curator" aria-label="Search by vault, address or curator"
              className="flex-1 min-w-0 bg-transparent text-[13px] text-fg placeholder:text-muted outline-none" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select label="Venue" value={venue} onChange={setVenue} options={[['all', 'All venues'], ...platforms.map((p) => [p.platform_key, p.platform])]} />
            <Select label="Chain" value={chain} onChange={setChain} options={[['all', 'All chains'], ...chains.map((c) => [c, c])]} />
            {anyEquity && (
              <label className="inline-flex items-center gap-2 h-9 px-2 text-[13px] text-fg">
                <input type="checkbox" checked={equity} onChange={(e) => setEquity(e.target.checked)} /> Holds tokenized stocks
              </label>
            )}
          </div>
        </div>
        {listedPlatforms.length ? listedPlatforms.map((p) => (
          <VenueTable key={p.platform_key} platform={p.platform} rows={filtered.filter((v) => v.platform_key === p.platform_key)} onOpen={open} compact={compact} nestedName={nestedName} />
        )) : <p className="px-4 pb-4 text-[13px] text-muted">No listed vault matches.</p>}
        <div className="h-3" />
      </Card>

      {data.partial && data.missing?.length > 0 && (
        <Card className="border-warn/50"><ul className="text-[13px] text-fg space-y-1">{data.missing.map((m) => <li key={m}>{m}</li>)}</ul></Card>
      )}

      <Card>
        <h2 className="text-[15px] font-semibold text-fg">How a vault is listed</h2>
        <p className="mt-2 text-[13px] text-muted leading-relaxed">{data.rule}</p>
        {data.notice && <p className="mt-2 text-[12px] text-muted">{data.notice}</p>}
      </Card>

      {nonePlatforms.length > 0 && (
        <Card>
          <h2 className="text-[15px] font-semibold text-fg">Venues with nothing listed</h2>
          <ul className="mt-2 divide-y divide-line">
            {nonePlatforms.map((p) => (
              <li key={p.platform_key} className="py-3">
                <div className="text-[13px] font-semibold text-fg">{p.platform} <span className="font-normal text-muted">· {p.chain}</span></div>
                <p className="mt-1 text-[13px] text-muted leading-relaxed">{p.text}</p>
                {p.sources?.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted">
                    Sources{p.sources_read_on ? `, read ${p.sources_read_on}` : ''}: {p.sources.map((u, i) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">{i ? ', ' : ''}{u.replace(/^https?:\/\//, '')}</a>)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card pad={false}>
        <div className="p-4 pb-0"><h2 className="text-[15px] font-semibold text-fg">Published exclusions</h2>
          <p className="mt-1 text-[13px] text-muted">Every vault account read on chain that is not listed, by reason.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full mt-2 text-[13px]">
            <thead><tr className="text-muted text-left text-[12px]"><th className="font-medium px-4 py-2">Venue</th><th className="font-medium py-2">Reason</th><th className="font-medium px-4 py-2 text-right">Vaults</th></tr></thead>
            <tbody className="divide-y divide-line">
              {platforms.flatMap((p) => (p.excluded || []).map((x) => (
                <tr key={`${p.platform_key}-${x.reason}`}><td className="px-4 py-2 text-fg">{p.platform}</td><td className="py-2 text-fg">{x.reason}</td><td className="px-4 py-2 text-right tabular-nums text-fg">{x.count}</td></tr>
              )))}
            </tbody>
          </table>
        </div>
        {platforms.some((p) => p.named_exclusions?.length) && (
          <div className="p-4">
            <h3 className="text-[13px] font-semibold text-fg">Named exclusions</h3>
            <ul className="mt-2 space-y-2 text-[13px]">
              {platforms.flatMap((p) => (p.named_exclusions || []).map((x) => (
                <li key={`${p.platform_key}-${x.address}`}>
                  <span className="text-fg">{x.name || shortAddr(x.address)}</span> <span className="text-muted font-mono text-[12px]">({p.platform}, {shortAddr(x.address)})</span>
                  <div className="text-muted">{x.reason}</div>
                </li>
              )))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
