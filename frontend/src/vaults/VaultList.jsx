// vaults/VaultList.jsx
//
// /vaults, in the layout and information order of Hyperliquid's vault list
// (owner's reference, 01-vaults-list): a total-TVL card, a search box and
// filters, then one table per venue with a sparkline column. Reads GET
// /api/vaults (T6, branch te-vaults); te/api.js documents the shape, and the
// dev fixtures are T6's real answers.
//
// WHAT EACH FIGURE IS
//   TVL        T6's figure, with its source beside it: "computed from chain"
//              (the vault's positions read on chain) or "as recorded by the
//              vault" (the vault's own total, not recomputed), when it was
//              last written, and "stale" by T6's own rule. The basis (face
//              value; USX and USDe labelled synthetic dollars) is on hover.
//   30-day     the share-price change over 30 days, read on chain, when the
//              answer carries it (return_30d); otherwise a dash. No APY from
//              any other source (owner, 2026-09-26).
//   Check      ✓ reconciles; ⚠ vault-recorded, not reconciled, or stale;
//              ? partial read (vaults/model.js).
//   Total      the rows shown, each dollar once when T6 marks one vault as
//              sitting inside another (nested_in with its tokens), and says
//              how. When the list is a page of a longer one, it says so.
// The listing rule is T6's own text, shown as served, as is its notice.

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Card, DevTag, Sparkline, fmtUsd0 } from '../ui/primitives';
import { SourceChip, shortAddr } from '../ui/detail';
import { platformKeyOf, staleOf, tvlSourceLabel, tvlTime, checkMark, tvlTotal } from './model';

export { tvlSourceLabel, checkMark };

const ROWS_PER_PAGE = 10;

/** Under a TVL figure: source, last written, stale, and the basis for
 *  hover and screen readers. */
export function TvlNote({ v, align = 'right' }) {
  const st = staleOf(v);
  return (
    <div className={`mt-0.5 flex flex-wrap gap-1 ${align === 'right' ? 'justify-end' : ''}`} title={v.tvl_basis}>
      <SourceChip title={v.tvl_basis}>{tvlSourceLabel(v.tvl_source)}</SourceChip>
      {v.token_kind === 'synthetic dollar' && <SourceChip title={v.tvl_basis}>synthetic dollar</SourceChip>}
      {tvlTime(v) && <SourceChip title={`${v.tvl_basis}${v.tvl_stale_rule ? ` (${v.tvl_stale_rule})` : ''}`}>{tvlTime(v).label} {tvlTime(v).at.slice(0, 10)}</SourceChip>}
      {st && <span className="inline-flex items-center h-5 px-1.5 rounded border border-warn/60 text-warn text-[10px] font-semibold uppercase tracking-wide" title={st}>stale</span>}
      <span className="sr-only">{v.tvl_basis}</span>
    </div>
  );
}

function PlatformLine({ p }) {
  if (!p) return null;
  return (
    <div className="px-4 text-[12px] text-muted">
      {p.text}
      {p.stale && <span className="ml-2 text-warn">Stale: {p.last_failure?.text || p.last_failure?.error || 'the latest read failed'}{p.last_failure?.at ? ` (${p.last_failure.at})` : ''}.</span>}
    </div>
  );
}

function VenueTable({ p, rows, onOpen, compact, nestedName }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const view = rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);
  return (
    <div className="mt-6 first:mt-2">
      <h3 className="px-4 text-[15px] font-semibold text-fg">{p.platform}</h3>
      <div className="mt-1"><PlatformLine p={p} /></div>
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
              {!compact && <th className="font-medium py-2">Admin / manager</th>}
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
              const parent = (v.nested_in || [])[0];
              return (
                <tr key={v.key} className="cursor-pointer hover:bg-inset/60" onClick={() => onOpen(v)}>
                  <td className="px-4 py-2.5">
                    <div className="text-fg font-semibold flex items-center gap-1.5">
                      {/* On a phone the check column is gone; its mark rides with the name. */}
                      {compact && <span title={c.label} aria-label={c.label}>{c.mark}</span>}
                      <span className="truncate">{v.name}</span>
                    </div>
                    <div className="text-[12px] text-muted font-mono">{shortAddr(v.address)}{compact ? ` · ${v.chain}` : ''}</div>
                    {parent && <div className="text-[11px] text-muted">Partly inside {parent.name || nestedName(parent.address)}</div>}
                    {(v.contains_nested || []).length > 0 && <div className="text-[11px] text-muted">Holds part of {v.contains_nested.map((n) => n.name || shortAddr(n.address)).join(', ')}</div>}
                    {/* What the stablecoin is lent against: one line here, in
                        full on hover and on the vault's page. */}
                    {v.lends_against && <div className="text-[11px] text-muted truncate max-w-[320px]" title={`${v.lends_against}\n\nCollateral names as each token's own metadata declares them.`}>Lends against: {v.lends_against}</div>}
                  </td>
                  {!compact && (
                    <td className="py-2.5 text-fg">
                      <div className="truncate" title={v.manager}>{v.manager}</div>
                      {v.curator?.name && <div className="text-[11px] text-muted truncate" title={v.curator.basis}>Curator: {v.curator.name}</div>}
                    </td>
                  )}
                  {!compact && <td className="py-2.5 text-fg">{v.token_symbol || v.tvl_symbol}</td>}
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
                  {!compact && <td className="px-4 py-2.5"><div className="flex justify-end"><Sparkline points={v.series?.share_price?.map((pt) => pt[1])} width={72} height={24} /></div></td>}
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

  const vaults = useMemo(() => data?.vaults || [], [data]);
  const filtered = useMemo(() => vaults.filter((v) => {
    const s = q.trim().toLowerCase();
    if (s && !`${v.name} ${v.address} ${v.manager}`.toLowerCase().includes(s)) return false;
    if (venue !== 'all' && platformKeyOf(v) !== venue) return false;
    if (chain !== 'all' && v.chain !== chain) return false;
    if (equity && !v.holds_tokenized_equity) return false;
    return true;
  }), [vaults, q, venue, chain, equity]);

  if (!data) {
    if (state?.error && state?.ever) return <Card><p className="text-[13px] text-muted">Couldn&apos;t read the vaults. Try again later.</p></Card>;
    return null;
  }

  const tot = tvlTotal(vaults);
  const platforms = data.platforms || [];
  const listed = platforms.filter((p) => p.status === 'listed');
  const shownPlatforms = listed.filter((p) => filtered.some((v) => platformKeyOf(v) === p.platform_key));
  const nonePlatforms = platforms.filter((p) => p.status !== 'listed');
  const chains = [...new Set(vaults.map((v) => v.chain))];
  const anyEquity = vaults.some((v) => v.holds_tokenized_equity);
  const byAddr = Object.fromEntries(vaults.map((v) => [v.address, v.name]));
  const nestedName = (a) => byAddr[a] || shortAddr(a);
  const open = (v) => onNavigate?.(`/vaults/${platformKeyOf(v)}/${v.address}`);
  const truncated = Number.isFinite(data.total) && data.total > vaults.length;

  return (
    <div className="space-y-4 md:space-y-6">
      <Card className="max-w-[460px]">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] text-muted">Total value locked, listed vaults</div>
          <DevTag data={data} />
        </div>
        <div className="mt-1 text-[32px] font-light tabular-nums text-fg">{fmtUsd0(tot.total)}</div>
        <div className="mt-1 text-[11px] text-muted leading-relaxed">
          Sum of the {vaults.length} vaults shown{truncated ? `, the first ${vaults.length} of ${data.total}` : ''}: {tot.bySource.computed_from_chain || 0} computed from chain reads, {tot.bySource.vault_recorded || 0} as the vault records it.
          {tot.nested > 0 ? ` Each dollar once: ${fmtUsd0(tot.nested)} held by ${tot.nestedRows === 1 ? 'one vault' : `${tot.nestedRows} vaults`} inside another listed vault is counted in that vault only.` : ''}
          {tot.stale ? ` ${tot.stale} ${tot.stale === 1 ? 'is' : 'are'} stale.` : ''} Tokens at 1 USD each, face value. As of {data.as_of}.
        </div>
      </Card>

      <Card pad={false}>
        <div className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-[220px] max-w-[420px] h-9 flex items-center gap-2 px-3 rounded bg-field border border-line-strong focus-within:ring-2 focus-within:ring-accent">
            <Search size={15} className="text-muted shrink-0" aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by vault, address or admin" aria-label="Search by vault, address or admin"
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
        {shownPlatforms.length ? shownPlatforms.map((p) => (
          <VenueTable key={p.platform_key} p={p} rows={filtered.filter((v) => platformKeyOf(v) === p.platform_key)} onOpen={open} compact={compact} nestedName={nestedName} />
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
        {data.deposits_note && data.deposits_note !== data.notice && <p className="mt-1 text-[12px] text-muted">{data.deposits_note}</p>}
      </Card>

      {nonePlatforms.length > 0 && (
        <Card>
          <h2 className="text-[15px] font-semibold text-fg">Venues with nothing listed</h2>
          {data.statuses && <p className="mt-1 text-[12px] text-muted">Nothing qualifies: {data.statuses.none_qualifying}{data.statuses.read_failed ? `. Read failed: ${data.statuses.read_failed}` : ''}.</p>}
          <ul className="mt-2 divide-y divide-line">
            {nonePlatforms.map((p) => (
              <li key={p.platform_key} className="py-3">
                <div className="text-[13px] font-semibold text-fg">{p.platform} <span className="font-normal text-muted">· {p.chain}{p.status === 'read_failed' ? ' · read failed' : ''}</span></div>
                <p className="mt-1 text-[13px] text-muted leading-relaxed">{p.text}</p>
                {p.stale && <p className="mt-1 text-[12px] text-warn">Stale: {p.last_failure?.text || p.last_failure?.error || 'the latest read failed'}.</p>}
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
                  {x.name
                    ? <><span className="text-fg">{x.name}</span> <span className="text-muted font-mono text-[12px]">({p.platform}, {shortAddr(x.address)})</span></>
                    : <><span className="text-fg font-mono text-[12px]" title={x.address}>{shortAddr(x.address)}</span> <span className="text-muted">({p.platform})</span></>}
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
