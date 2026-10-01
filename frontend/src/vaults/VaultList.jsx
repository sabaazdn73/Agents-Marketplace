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
//              answer carries it (return_30d). No APY from any other source
//              (owner, 2026-09-26).
//   Columns    30-day change, Age and the 30-day line show only when at
//              least one listed vault carries the figure (return_30d,
//              age_days, series). None does yet: the collector keeps its
//              latest read, not a history, so a column of dashes would say
//              nothing. Each appears on its own once the answer carries it.
//   Check      ✓ reconciles; ⚠ vault-recorded, not reconciled, or stale;
//              ? partial read (vaults/model.js).
//   Total      the rows shown, each dollar once when T6 marks one vault as
//              sitting inside another (nested_in with its tokens), and says
//              how. When the list is a page of a longer one, it says so.
// The listing rule is T6's own text, shown as served, as is its notice.

import ReadError from '../te/ReadError';
import React, { useMemo, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { Tip } from '../dashboard/cards';
import { Card, DevTag, Sparkline, fmtUsd0 } from '../ui/primitives';
import { SourceChip, shortAddr } from '../ui/detail';
import { platformKeyOf, staleOf, staleRuleWords, tvlSourceLabel, tvlTime, checkMark, tvlTotal } from './model';

export { tvlSourceLabel, checkMark };

const ROWS_PER_PAGE = 10;

/** Under a TVL figure: source, last written, stale, and the basis for
 *  hover and screen readers. */
export function TvlNote({ v, align = 'right' }) {
  const st = staleOf(v);
  const time = tvlTime(v);
  const src = v.tvl_source === 'computed_from_chain' ? 'chain' : v.tvl_source === 'vault_recorded' ? 'vault record' : null;
  const hover = [tvlSourceLabel(v.tvl_source), time && `${time.label} ${time.at}`, v.tvl_basis, staleRuleWords(v)].filter(Boolean).join(' · ');
  return (
    <div className={`mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted ${align === 'right' ? 'justify-end' : ''}`} title={hover}>
      <span>{[src, time && time.at.slice(0, 10)].filter(Boolean).join(' · ')}</span>
      {v.token_kind === 'synthetic dollar' && <SourceChip title={v.tvl_basis}>synthetic dollar</SourceChip>}
      {st && <span className="inline-flex items-center h-5 px-1.5 rounded border border-warn/60 text-warn text-[10px] font-semibold uppercase tracking-wide" title={st}>stale</span>}
      <span className="sr-only">{hover}</span>
    </div>
  );
}

/** A venue's served line (how many of its accounts were read and listed)
 *  sits behind the (i) beside its name; a stale read stays on the face. */
function PlatformTip({ p }) {
  if (!p?.text) return null;
  return <Tip label={`About ${p.platform}`} align="left"><span className="block">{p.text}</span></Tip>;
}

function PlatformStale({ p }) {
  if (!p?.stale) return null;
  return (
    <div className="px-4 text-[12px] text-warn">
      Stale: {p.last_failure?.text || p.last_failure?.error || 'the latest read failed'}{p.last_failure?.at ? ` (${p.last_failure.at})` : ''}.
    </div>
  );
}

// The table's columns, widths in percent. A column whose figure no listed
// vault carries is left out, and the widths are shared out again, so every
// venue's table still lines up with the others.
function tableColumns(cols) {
  const all = [
    ['vault', 22], ['manager', 24], ['asset', 7], cols.r30 && ['r30', 10],
    ['tvl', 15], cols.age && ['age', 8], ['check', 5], cols.spark && ['spark', 9],
  ].filter(Boolean);
  const sum = all.reduce((a, [, w]) => a + w, 0);
  return all.map(([k, w]) => [k, (w / sum) * 100]);
}

// Nesting in the words of the served nesting_note (and the vault page):
// the vault inside another "has part of its funds in" it; the vault that
// holds the other's deposit "includes funds placed by" it.
export function nestingLines(v, nameOf) {
  return [
    ...(v.nested_in || []).map((n) => `Part of its funds sit in ${n.name || nameOf(n.address)}`),
    ...(v.contains_nested || []).map((n) => `Includes funds placed by ${n.name || nameOf(n.address)}`),
  ];
}

/** A phone's list: one card per vault, the name and TVL on the first line,
 *  so the figure is never cut off (getquin's mobile lists). */
function VenueCards({ rows, onOpen, nestedName }) {
  return (
    <ul className="mt-2 divide-y divide-line">
      {rows.map((v) => {
        const c = checkMark(v);
        return (
          <li key={v.key}>
            <button type="button" onClick={() => onOpen(v)} className="w-full text-left px-4 py-3 hover:bg-inset/60">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] text-fg font-semibold flex items-center gap-1.5">
                    <span title={c.label} aria-label={c.label}>{c.mark}</span>
                    <span className="truncate">{v.name}</span>
                  </div>
                  <div className="text-[12px] text-muted"><span className="font-mono">{shortAddr(v.address)}</span> · {v.chain}{v.token_symbol || v.tvl_symbol ? ` · ${v.token_symbol || v.tvl_symbol}` : ''}</div>
                </div>
                <div className="shrink-0 max-w-[48%] text-right" title={v.tvl_basis}>
                  <div className="text-[14px] tabular-nums text-fg">{fmtUsd0(v.tvl_usd)}</div>
                  <TvlNote v={v} />
                </div>
              </div>
              {v.manager && <div className="mt-1 text-[12px] text-muted truncate">Manager: {v.manager}</div>}
              {nestingLines(v, nestedName).map((l) => <div key={l} className="text-[11px] text-muted">{l}</div>)}
              {(v.notes || []).length > 0 && <div className="text-[11px] text-warn line-clamp-2">{v.notes[0]}{v.notes.length > 1 ? ` (+${v.notes.length - 1} more)` : ''}</div>}
              {v.lends_against && <div className="text-[11px] text-muted line-clamp-2">Lends against: {v.lends_against}</div>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function VenueTable({ p, rows, onOpen, compact, nestedName, cols }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const view = rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);
  return (
    <div className="mt-6 first:mt-2">
      <h3 className="px-4 text-[15px] font-semibold text-fg flex items-center gap-1.5">
        {p.platform}<span className="text-[12px] font-normal text-muted">{rows.length}</span><PlatformTip p={p} />
      </h3>
      <PlatformStale p={p} />
      {compact ? <VenueCards rows={view} onOpen={onOpen} nestedName={nestedName} /> : (
      <div className="overflow-x-auto">
        {/* Fixed widths, so every venue's table lines up with the others. */}
        <table className={`w-full mt-2 text-[13px] ${compact ? '' : 'table-fixed min-w-[900px]'}`}>
          {!compact && (
            <colgroup>
              {tableColumns(cols).map(([k, w]) => <col key={k} style={{ width: `${w}%` }} />)}
            </colgroup>
          )}
          <thead>
            <tr className="text-muted text-left text-[12px]">
              <th className="font-medium px-4 py-2">Vault</th>
              {!compact && <th className="font-medium py-2">Admin / manager</th>}
              {!compact && <th className="font-medium py-2">Asset</th>}
              {!compact && cols.r30 && <th className="font-medium py-2 text-right" title="Share price change over 30 days, read on chain">30-day change</th>}
              <th className="font-medium py-2 text-right pr-4 md:pr-0">TVL</th>
              {!compact && cols.age && <th className="font-medium py-2 text-right">Age (days)</th>}
              {!compact && <th className="font-medium py-2 text-center">Check</th>}
              {!compact && cols.spark && <th className="font-medium px-4 py-2 text-right">30 days</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {view.map((v) => {
              const c = checkMark(v);
              const r = v.return_30d?.pct;
              return (
                <tr key={v.key} className="cursor-pointer hover:bg-inset/60" onClick={() => onOpen(v)}>
                  <td className="px-4 py-2.5">
                    <div className="text-fg font-semibold flex items-center gap-1.5">
                      {/* On a phone the check column is gone; its mark rides with the name. */}
                      {compact && <span title={c.label} aria-label={c.label}>{c.mark}</span>}
                      <span className="truncate">{v.name}</span>
                    </div>
                    <div className="text-[12px] text-muted font-mono">{shortAddr(v.address)}{compact ? ` · ${v.chain}` : ''}</div>
                    {nestingLines(v, nestedName).map((l) => <div key={l} className="text-[11px] text-muted">{l}</div>)}
                    {/* What the stablecoin is lent against: one line here, in
                        full on hover and on the vault's page. */}
                    {(v.notes || []).length > 0 && <div className="text-[11px] text-warn truncate max-w-[320px]" title={v.notes.join('\n')}>{v.notes[0]}{v.notes.length > 1 ? ` (+${v.notes.length - 1} more)` : ''}</div>}
                    {v.lends_against && <div className="text-[11px] text-muted truncate max-w-[320px]" title={`${v.lends_against}\n\nCollateral names as each token's own metadata declares them.`}>Lends against: {v.lends_against}</div>}
                  </td>
                  {!compact && (
                    <td className="py-2.5 text-fg">
                      <div className="truncate" title={v.manager}>{v.manager}</div>
                      {v.curator?.name && <div className="text-[11px] text-muted truncate" title={v.curator.basis}>Curator: {v.curator.name}</div>}
                    </td>
                  )}
                  {!compact && <td className="py-2.5 text-fg">{v.token_symbol || v.tvl_symbol}</td>}
                  {!compact && cols.r30 && (
                    <td className="py-2.5 text-right tabular-nums" title={v.return_30d?.basis || 'Not measured for this vault'}>
                      {Number.isFinite(r) ? <span className={r > 0 ? 'text-pos' : r < 0 ? 'text-neg' : 'text-fg'}>{r > 0 ? '+' : ''}{r.toFixed(2)}%</span> : <span className="text-muted">–</span>}
                    </td>
                  )}
                  <td className="py-2.5 text-right pr-4 md:pr-0" title={v.tvl_basis}>
                    <div className="tabular-nums text-fg">{fmtUsd0(v.tvl_usd)}</div>
                    <TvlNote v={v} />
                  </td>
                  {!compact && cols.age && <td className="py-2.5 text-right tabular-nums text-fg">{Number.isFinite(v.age_days) ? v.age_days : <span className="text-muted">–</span>}</td>}
                  {!compact && <td className="py-2.5 text-center text-fg" title={c.label} aria-label={c.label}>{c.mark}</td>}
                  {!compact && cols.spark && <td className="px-4 py-2.5"><div className="flex justify-end"><Sparkline points={v.series?.share_price?.map((pt) => pt[1])} width={72} height={24} /></div></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
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
    if (state?.error) return <ReadError error={state.error} body={state.errorBody} what="the vaults" />;
    return null;
  }

  const filtering = filtered.length !== vaults.length;
  const tot = tvlTotal(filtering ? filtered : vaults);
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
  // Over every listed vault, not only the filtered ones, so a column does not
  // come and go as the visitor types in the search box.
  const cols = {
    r30: vaults.some((v) => Number.isFinite(v.return_30d?.pct)),
    age: vaults.some((v) => Number.isFinite(v.age_days)),
    spark: vaults.some((v) => (v.series?.share_price || []).length >= 2),
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className={`grid gap-4 ${compact ? 'grid-cols-2' : 'grid-cols-3'}`}>
        <Card className={`min-w-0 ${compact ? 'col-span-2' : ''}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[13px] text-muted">
              Total value locked
              <Tip label="About this total" align="left">
                <span className="block">
                  {filtering
                    ? (filtered.length === 1 ? 'The one vault matching your filter' : `Sum of the ${filtered.length} vaults matching your filter`)
                    : `Sum of the ${vaults.length} vaults shown${truncated ? `, the first ${vaults.length} of ${data.total}` : ''}`}: {tot.bySource.computed_from_chain || 0} computed from chain reads, {tot.bySource.vault_recorded || 0} as the vault records it.
                </span>
                {tot.nested > 0 && <span className="block">Each dollar once: {fmtUsd0(tot.nested)} held by {tot.nestedRows === 1 ? 'one vault' : `${tot.nestedRows} vaults`} inside another listed vault is counted in that vault only.</span>}
                {tot.stale > 0 && <span className="block">{tot.stale} {tot.stale === 1 ? 'is' : 'are'} stale.</span>}
                <span className="block">Tokens at 1 USD each, face value. As of {data.as_of}.</span>
              </Tip>
            </div>
            <DevTag data={data} />
          </div>
          <div className="mt-2 text-[32px] font-semibold tracking-[-0.02em] tabular-nums text-fg leading-none">{fmtUsd0(tot.total)}</div>
          <div className="mt-2 text-[12px] text-muted">{filtering ? `${filtered.length} matching` : `${vaults.length} vaults`} · as of {String(data.as_of || '').slice(0, 10)}</div>
        </Card>
        <Card className="min-w-0">
          <div className="text-[13px] text-muted">Vaults listed</div>
          <div className="mt-2 text-[28px] font-semibold tabular-nums text-fg leading-none">{truncated ? `${vaults.length} of ${data.total}` : vaults.length}</div>
          <div className="mt-2 text-[12px] text-muted">{chains.join(', ')}</div>
        </Card>
        <Card className="min-w-0">
          <div className="text-[13px] text-muted">Venues with a listed vault</div>
          <div className="mt-2 text-[28px] font-semibold tabular-nums text-fg leading-none">{listed.length}<span className="text-[15px] font-medium text-muted"> of {platforms.length} read</span></div>
          <div className="mt-2 text-[12px] text-muted truncate" title={listed.map((p) => p.platform).join(', ')}>{listed.map((p) => p.platform).join(', ')}</div>
        </Card>
      </div>

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
          <VenueTable key={p.platform_key} p={p} rows={filtered.filter((v) => platformKeyOf(v) === p.platform_key)} onOpen={open} compact={compact} nestedName={nestedName} cols={cols} />
        )) : <p className="px-4 pb-4 text-[13px] text-muted">No listed vault matches.</p>}
        <div className="h-3" />
      </Card>

      {data.partial && data.missing?.length > 0 && (
        <Card className="border-warn/50"><ul className="text-[13px] text-fg space-y-1">{data.missing.map((m) => <li key={m}>{m}</li>)}</ul></Card>
      )}

      {/* The listing rule, the venues with nothing listed and every
          published exclusion, as served: one card, folded until opened. */}
      <details className="group bg-surface border border-line rounded-xl">
        <summary className="list-none cursor-pointer flex items-center justify-between gap-3 p-4 text-[15px] font-semibold text-fg">
          <span>Listing rule and exclusions</span>
          <ChevronDown size={16} aria-hidden="true" className="text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-4 pb-4 space-y-6">
      <div>
        <h3 className="text-[14px] font-semibold text-fg">How a vault is listed</h3>
        <p className="mt-2 text-[13px] text-muted leading-relaxed">{data.rule}</p>
        {data.notice && <p className="mt-2 text-[12px] text-muted">{data.notice}</p>}
        {/* T6's deposits_note repeats the notice when the notice already
            speaks of deposits; show it only when it adds something. */}
        {data.deposits_note && !/deposit/i.test(data.notice || '') && <p className="mt-1 text-[12px] text-muted">{data.deposits_note}</p>}
      </div>

      {nonePlatforms.length > 0 && (
        <div>
          <h3 className="text-[14px] font-semibold text-fg">Venues with nothing listed</h3>
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
        </div>
      )}

      <div>
        <div><h3 className="text-[14px] font-semibold text-fg">Published exclusions</h3>
          <p className="mt-1 text-[12px] text-muted">Every vault account read and not listed, by reason.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full mt-2 text-[13px]">
            <thead><tr className="text-muted text-left text-[12px]"><th className="font-medium pr-4 py-2">Venue</th><th className="font-medium py-2">Reason</th><th className="font-medium pl-4 py-2 text-right">Vaults</th></tr></thead>
            <tbody className="divide-y divide-line">
              {platforms.flatMap((p) => (p.excluded || []).map((x) => (
                <tr key={`${p.platform_key}-${x.reason}`}><td className="pr-4 py-2 text-fg">{p.platform}</td><td className="py-2 text-fg">{x.reason}</td><td className="pl-4 py-2 text-right tabular-nums text-fg">{x.count}</td></tr>
              )))}
            </tbody>
          </table>
        </div>
        {platforms.some((p) => p.named_exclusions?.length) && (
          <div className="pt-4">
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
      </div>
        </div>
      </details>
    </div>
  );
}
