// stocks/StockList.jsx
//
// One list of /stocks (Stocks & ETFs): tokenized stocks or tokenized ETFs,
// GET /api/te/list, with the All, EVM and non-EVM filter and paging. The
// same rows and columns as the home page's list (home/cards.jsx
// InstrumentList, which the home page keeps), short on the face like the
// Dashboard: the title, one muted count, the table, and the measured time.
// What the counts count, how a row is chosen and the order sit behind the
// (i) beside the title and the time, with the figures of this answer; the
// general explanation is in the guide (guide/stocks.jsx, /guide#stocks).

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, DevTag, GroupChip, SymbolTile, Sparkline, Pills, fmtUsd, fmtUsd0 } from '../ui/primitives';
import { hasRows } from '../te/api';
import ReadError from '../te/ReadError';
import { headline, tokensText, bpsText, refGap, measuredLine, sentence } from '../te/costText';
import { Tip } from '../dashboard/cards';

const NOUN = { stock: ['stock', 'stocks'], etf: ['ETF', 'ETFs'] };

function emptyLine(data, group) {
  if (data?.group_note) return `${sentence(data.group_note)}.`;
  if (group === 'nonevm') return 'No non-EVM version listed.';
  if (group === 'evm') return 'No EVM version listed.';
  return 'Nothing listed.';
}

/** The counts of this answer, worked out exactly as the home list does:
 *  rows_total ranked, rows_not_ranked filled but not ranked, and
 *  rows_without_filled_version, set against the universe. */
function counts(data, group, universe) {
  const size = fmtUsd0(data.size || 1000);
  const [one, many] = NOUN[data.type] || ['underlying', 'underlyings'];
  const other = data.type === 'etf' ? 'stocks' : data.type === 'stock' ? 'ETFs' : null;
  const nr = data.rows_not_ranked;
  const notRanked = nr && nr.count > 0 && group !== 'nonevm' ? nr : null;
  const unfilled = Number.isFinite(data.rows_without_filled_version) && group !== 'nonevm' ? data.rows_without_filled_version : null;
  if (!Number.isFinite(data.rows_total)) return null;
  const measured = data.rows_total + (notRanked?.count || 0) + (unfilled || 0);
  const rest = Number.isFinite(universe) && group !== 'nonevm' ? universe - measured : null;
  return { size, one, many, other, notRanked, unfilled, measured, rest, n: data.rows_total };
}

/** "63 stocks ranked at $1,000", with the rest of the counts in the (i). */
function CountsLine({ data, group, universe }) {
  const c = counts(data, group, universe);
  if (!c) return null;
  const { size, one, many, other, notRanked, unfilled, measured, rest, n } = c;
  return (
    <div className="relative px-4 pt-1 flex items-center gap-1 text-[12px] text-muted">
      <span><span className="text-fg tabular-nums">{n.toLocaleString('en-US')}</span> {n === 1 ? one : many} ranked at {size}</span>
      <Tip label="What these counts cover" align="left" className="!static">
        <p className="text-fg">{n.toLocaleString('en-US')} {n === 1 ? one : many} fill {size} and are ranked.</p>
        {notRanked && <p>{notRanked.count} more {notRanked.count === 1 ? 'fills' : 'fill'} but {notRanked.count === 1 ? "isn't" : "aren't"} ranked: {notRanked.count === 1 ? 'its' : 'their'} share ratio isn&apos;t read ({notRanked.underlyings.join(', ')}{notRanked.count > notRanked.underlyings.length ? ` and ${notRanked.count - notRanked.underlyings.length} more` : ''}).</p>}
        {unfilled ? <p>{unfilled.toLocaleString('en-US')} more have no version that fills {size}.</p> : null}
        <p>
          These counts cover only the {many} with at least one EVM version our cost engine reads, with or without a pool
          {rest != null && rest >= 0
            ? <>: {measured.toLocaleString('en-US')} of the {universe.toLocaleString('en-US')} stocks and ETFs Tnega lists across all chains. The other {rest.toLocaleString('en-US')} ({universe.toLocaleString('en-US')} minus {measured.toLocaleString('en-US')}, worked out on this page from the served counts) are {other ? `the ${other} (counted in their own list) and ` : ''}the stocks and ETFs with no EVM version the engine reads.</>
            : '.'}
        </p>
      </Tip>
    </div>
  );
}

/** The measured time, and how the list is ordered and chosen in the (i). */
function ListFooter({ data }) {
  const size = fmtUsd0(data.size || 1000);
  const noSpark = data.rows?.length && data.rows.every((r) => !hasRows(r.spark)) ? data.rows.find((r) => r.spark_reason)?.spark_reason : null;
  const measured = measuredLine(data.computed_at, (data.rows || []).map((r) => r.best?.us_market_open));
  const lines = [
    data.sort_reason ? `Order: ${data.sort_reason}.` : data.sort === 'cost1k' ? `Ordered by cost to buy ${size}.` : null,
    `Each row is the version with the lowest all-in price per share that fills ${size}. Cost in bps is fees and price impact against the pool's own price.${data.lifi_fee_included ? ' Includes LI.FI’s 0.25% fee.' : ''}`,
    noSpark ? `7-day prices: ${noSpark}.` : null,
  ].filter(Boolean);
  return (
    <div className="relative px-4 py-3 border-t border-line flex items-center gap-1 text-[11px] text-muted">
      <span>{measured || 'Simulated on the pools.'}</span>
      <Tip label="How this list is ordered" align="left" className="!static">
        {lines.map((l) => <p key={l}>{l}</p>)}
      </Tip>
    </div>
  );
}

function Pager({ data, onOffset }) {
  const total = data.rows_total;
  if (!Number.isFinite(total) || !data.rows?.length) return null;
  const from = (data.offset || 0) + 1;
  const to = (data.offset || 0) + data.rows.length;
  const fillsAt = fmtUsd0(data.size || 1000);
  if (!data.offset && data.next_offset == null) return <span className="text-[12px] text-muted tabular-nums">{total.toLocaleString('en-US')} ranked at {fillsAt}</span>;
  const prev = data.offset > 0 ? Math.max(0, data.offset - (data.limit || data.rows.length)) : null;
  const btn = 'h-8 w-8 inline-flex items-center justify-center rounded border border-line-strong text-fg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-inset';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-muted tabular-nums">{from.toLocaleString('en-US')}–{to.toLocaleString('en-US')} of {total.toLocaleString('en-US')}</span>
      <button type="button" className={btn} disabled={prev == null} onClick={() => onOffset(prev)} aria-label="Previous page"><ChevronLeft size={15} aria-hidden="true" /></button>
      <button type="button" className={btn} disabled={data.next_offset == null} onClick={() => onOffset(data.next_offset)} aria-label="Next page"><ChevronRight size={15} aria-hidden="true" /></button>
    </div>
  );
}

function RowPrice({ b }) {
  const h = headline(b || {});
  const gap = refGap(b || {});
  return (
    <>
      <div className="text-fg font-semibold">{h?.value}</div>
      <div className="text-[11px] text-muted whitespace-nowrap">{tokensText(b?.tokens_per_1000)}</div>
      {gap && <div className="text-[11px] text-warn" title={gap.basis || undefined}>{gap.text}</div>}
    </>
  );
}

export default function StockList({ title, state, group, onGroup, onOpen, onOffset, compact = false, universe = null }) {
  const { data, error, errorBody, stale } = state || {};
  if (!data && !error) return null;
  const head = (
    <div className="px-4 pt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[16px] font-semibold text-fg">{title}</h2>
        <DevTag data={data} />
        {stale && <span className="text-[11px] text-muted">Updating</span>}
      </div>
      {onGroup && !error && <Pills label="Chain group" value={group} onChange={onGroup} options={[{ id: 'all', label: 'All' }, { id: 'evm', label: 'EVM' }, { id: 'nonevm', label: 'Non-EVM' }]} />}
    </div>
  );
  if (!data) {
    return <Card pad={false}>{head}<div className="px-4 py-5"><ReadError bare error={error} body={errorBody} what={`the list of ${title.replace(/^Tokenized /, 'tokenized ')}`} /></div></Card>;
  }
  if (!hasRows(data.rows)) {
    return <Card pad={false}>{head}<CountsLine data={data} group={group} universe={universe} /><p className="px-4 py-5 text-[13px] text-muted">{emptyLine(data, group)}</p><ListFooter data={data} /></Card>;
  }
  const size = fmtUsd0(data.size || 1000);
  const spark = data.rows.some((r) => hasRows(r.spark));
  return (
    <Card pad={false} className={stale ? 'opacity-60 transition-opacity' : ''}>
      {head}
      <CountsLine data={data} group={group} universe={universe} />
      <table className={`w-full mt-2 text-[13px] ${compact ? 'table-fixed' : ''}`}>
        <thead>
          <tr className="text-muted text-left text-[12px]">
            <th className="font-medium px-4 py-2">Instrument</th>
            {!compact && <th className="font-medium py-2">Chain</th>}
            <th className={`font-medium py-2 text-right ${compact ? 'pr-4 w-[156px]' : ''}`}>Per share, all-in</th>
            {!compact && <th className="font-medium py-2 pl-4 text-right whitespace-nowrap">Cost to buy {size}</th>}
            {!compact && <th className={`font-medium py-2 text-right ${spark ? '' : 'pr-4'}`}>Versions</th>}
            {!compact && spark && <th className="font-medium px-4 py-2 text-right">7 days</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.rows.map((r) => (
            <tr key={r.best?.key || r.underlying} className={onOpen ? 'cursor-pointer hover:bg-inset/60' : ''} onClick={onOpen ? () => onOpen(r) : undefined}>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <SymbolTile underlying={r.underlying} />
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
              <td className={`py-2.5 text-right tabular-nums align-top pt-3 ${compact ? 'pr-4' : ''}`}>
                <RowPrice b={r.best} />
                {compact && <div className="text-[11px] text-muted">{bpsText(r.best?.cost_bps)}</div>}
              </td>
              {!compact && (
                <td className="py-2.5 pl-4 text-right tabular-nums align-top pt-3">
                  <div className="text-fg">{fmtUsd(r.best?.cost_usd)}</div>
                  <div className="text-[11px] text-muted">{bpsText(r.best?.cost_bps)}</div>
                </td>
              )}
              {!compact && <td className={`py-2.5 text-right text-muted tabular-nums ${spark ? '' : 'pr-4'}`}>{r.versions}</td>}
              {!compact && spark && <td className="px-4 py-2.5"><div className="flex justify-end"><Sparkline points={r.spark} /></div></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {onOffset && <div className="px-4 py-3 border-t border-line flex justify-end"><Pager data={data} onOffset={onOffset} /></div>}
      <ListFooter data={data} />
    </Card>
  );
}
