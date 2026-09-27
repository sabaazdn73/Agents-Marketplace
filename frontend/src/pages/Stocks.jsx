// Stocks.jsx
//
// /stocks, Stocks & ETFs. The two live lists from GET /api/te/list, each
// with the All, EVM and non-EVM filter, and search over GET /api/te/search
// when the address carries ?q= (the header search and the home search land
// here). Each list renders only with rows (te/api.js) and pages through
// rows_total, 25 at a time. Every list row and every search result opens
// the instrument page, /stocks/<ticker> (stocks/StockPage.jsx), which this
// component renders when the path names a ticker; a matched version opens
// it with that version chosen (?v=<key>).

import ReadError from '../te/ReadError';
import React, { useState } from 'react';
import { useTe, hasRows } from '../te/api';
import { InstrumentList } from '../home/cards';
import { Card, DevTag, GroupChip, SymbolTile } from '../ui/primitives';
import { PageFrame } from './PageFrame';
import StockPage from '../stocks/StockPage';

// Search results in T2's shape: one row per underlying, with its issuers
// and chains, and the versions that matched (by symbol or address), each
// with its own key and symbol, listed or not and why. Matches that are not
// listed at all come after, with their reason. Vaults are named as searched
// only when the answer's coverage says so.
const stockPath = (t, key) => `/stocks/${encodeURIComponent(t)}${key ? `?v=${encodeURIComponent(key)}` : ''}`;

function SearchResults({ q, data, onNavigate }) {
  if (!q || !data || !Array.isArray(data.results)) return null;
  const unlisted = Array.isArray(data.unlisted_matches) ? data.unlisted_matches : [];
  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-[15px] font-semibold text-fg">Results for &ldquo;{q}&rdquo;</h2>
        <DevTag data={data} />
      </div>
      <p className="text-[12px] text-muted mb-2">
        Searched: stocks and ETFs{data.coverage?.vaults ? ', and vaults' : ''}.
        {data.coverage && !data.coverage.vaults ? ' Vaults are not searched here.' : ''}
      </p>
      {hasRows(data.results) ? (
        <ul className="divide-y divide-line">
          {data.results.map((r) => (
            <li key={`${r.kind}-${r.underlying || r.symbol}`} className="py-3">
              <a href={stockPath(r.underlying || r.symbol)} onClick={(e) => { if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); onNavigate(stockPath(r.underlying || r.symbol)); }}
                className="flex items-center gap-3 rounded hover:bg-inset/60 -mx-1 px-1">
                <SymbolTile underlying={r.underlying} symbol={r.symbol} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-fg truncate">{r.name}</div>
                  <div className="text-[12px] text-muted truncate">
                    {r.underlying}{r.type ? ` · ${r.type === 'etf' ? 'ETF' : 'stock'}` : ''}
                    {Number.isFinite(r.versions) ? ` · ${r.versions} version${r.versions === 1 ? '' : 's'}` : ''}
                    {r.issuer ? ` · ${r.issuer}` : r.issuers?.length ? ` · ${r.issuers.join(', ')}` : ''}
                  </div>
                  {(r.chain || r.chains?.length) && <div className="text-[12px] text-muted truncate">{r.chain || r.chains.join(', ')}</div>}
                </div>
                {(r.groups || []).map((g) => <GroupChip key={g} group={g} />)}
              </a>
              {hasRows(r.matched_versions) && (
                <ul className="mt-2 ml-12 space-y-1 text-[12px]">
                  {r.matched_versions.map((m) => (
                    <li key={m.key} className="flex flex-wrap items-center gap-x-2">
                      {m.listed === false
                        ? <span className="text-fg font-semibold">{m.symbol}</span>
                        : <a href={stockPath(r.underlying || r.symbol, m.key)} onClick={(e) => { if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); onNavigate(stockPath(r.underlying || r.symbol, m.key)); }} className="text-fg font-semibold underline underline-offset-2 hover:text-accent">{m.symbol}</a>}
                      <span className="text-muted">{m.issuer} · {m.chain}</span>
                      {m.listed === false && <span className="text-warn">not listed{m.not_listed_reason ? `: ${m.not_listed_reason}` : ''}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">{data.reason ? `No results: ${data.reason}.` : 'No stock or ETF we list matches that.'}</p>
      )}
      {unlisted.length > 0 && (
        <div className="mt-3 pt-3 border-t border-line">
          <h3 className="text-[13px] font-semibold text-fg">Found, not listed</h3>
          <ul className="mt-1 space-y-1 text-[12px]">
            {unlisted.map((u, i) => (
              <li key={`${u.symbol || u.underlying || i}`}>
                <span className="text-fg">{u.name || u.symbol || u.underlying}</span>
                {(u.issuer || u.chain) && <span className="text-muted"> · {[u.issuer, u.chain].filter(Boolean).join(' · ')}</span>}
                {u.reason && <span className="text-muted"> · {u.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// Rows per page of each list.
const PAGE = 25;

export default function Stocks({ layout = 'web', path = '/stocks', query = '', onNavigate }) {
  const detail = (path || '').split('#')[0].match(/^\/stocks\/([A-Za-z0-9][A-Za-z0-9.-]{0,14})$/);
  if (detail) return <StockPage key={detail[1].toUpperCase()} ticker={detail[1]} layout={layout} onNavigate={onNavigate} />;
  return <StockList layout={layout} query={query} onNavigate={onNavigate} />;
}

function StockList({ layout, query, onNavigate }) {
  const mobile = layout === 'mobile';
  const q = (query || '').trim();
  // Each list pages on its own: the group and the offset go into the read,
  // and a new group starts again at the first page.
  const [sg, setSg] = useState('all');
  const [eg, setEg] = useState('all');
  const [so, setSo] = useState(0);
  const [eo, setEo] = useState(0);
  const searchRead = useTe(q ? `/api/te/search?q=${encodeURIComponent(q)}` : null);
  const search = searchRead.data;
  // The universe count the lists' counts are set against (CountsLine).
  const summary = useTe('/api/te/summary').data;
  const stocks = useTe(`/api/te/list?type=stock&group=${sg}&limit=${PAGE}&sort=popular&offset=${so}`, { keep: true });
  const etfs = useTe(`/api/te/list?type=etf&group=${eg}&limit=${PAGE}&sort=popular&offset=${eo}`, { keep: true });
  const groupS = (g) => { setSg(g); setSo(0); };
  const groupE = (g) => { setEg(g); setEo(0); };
  const open = (r) => onNavigate?.(stockPath(r.underlying));
  return (
    <PageFrame layout={layout} title="Stocks & ETFs">
      {q && !search && searchRead.error && <ReadError error={searchRead.error} body={searchRead.errorBody} what={`the results for "${q}"`} />}
      <SearchResults q={q} data={search} onNavigate={onNavigate} />
      <InstrumentList title="Tokenized stocks" state={stocks} group={sg} onGroup={groupS} onOffset={setSo} onOpen={open} compact={mobile} universe={summary?.underlyings} />
      <InstrumentList title="Tokenized ETFs" state={etfs} group={eg} onGroup={groupE} onOffset={setEo} onOpen={open} compact={mobile} universe={summary?.underlyings} />
    </PageFrame>
  );
}
