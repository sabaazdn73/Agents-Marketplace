// Stocks.jsx
//
// /stocks, Stocks & ETFs. The two live lists from GET /api/te/list, each
// with the All, EVM and non-EVM filter, and search over GET /api/te/search
// when the address carries ?q= (the header search and the home search land
// here). Each list renders only with rows (te/api.js). The instrument page
// and its buy panel arrive with their data and the buy flow (SPEC T3a, T4a).

import React, { useState } from 'react';
import { useTe, hasRows } from '../te/api';
import { InstrumentList } from '../home/cards';
import { Card, DevTag, GroupChip, SymbolTile } from '../ui/primitives';
import { PageFrame } from './PageFrame';

// Search results in T2's shape: one row per underlying, with its issuers
// and chains, and the versions that matched (by symbol or address), each
// with its own key and symbol, listed or not and why. Matches that are not
// listed at all come after, with their reason. Vaults are named as searched
// only when the answer's coverage says so.
function SearchResults({ q, data }) {
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
              <div className="flex items-center gap-3">
                <SymbolTile symbol={r.underlying || r.symbol} />
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
              </div>
              {hasRows(r.matched_versions) && (
                <ul className="mt-2 ml-12 space-y-1 text-[12px]">
                  {r.matched_versions.map((m) => (
                    <li key={m.key} className="flex flex-wrap items-center gap-x-2">
                      <span className="text-fg font-semibold">{m.symbol}</span>
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

export default function Stocks({ layout = 'web', query = '', onNavigate }) {
  const mobile = layout === 'mobile';
  const q = (query || '').trim();
  const [sg, setSg] = useState('all');
  const [eg, setEg] = useState('all');
  const search = useTe(q ? `/api/te/search?q=${encodeURIComponent(q)}` : null).data;
  const stocks = useTe(`/api/te/list?type=stock&group=${sg}&limit=100&sort=popular`, { keep: true });
  const etfs = useTe(`/api/te/list?type=etf&group=${eg}&limit=100&sort=popular`, { keep: true });
  const open = (r) => onNavigate?.(`/stocks?q=${encodeURIComponent(r.underlying)}`);
  return (
    <PageFrame layout={layout} title="Stocks & ETFs">
      <SearchResults q={q} data={search} />
      <InstrumentList title="Tokenized stocks" state={stocks} group={sg} onGroup={setSg} onOpen={open} compact={mobile} />
      <InstrumentList title="Tokenized ETFs" state={etfs} group={eg} onGroup={setEg} onOpen={open} compact={mobile} />
    </PageFrame>
  );
}
