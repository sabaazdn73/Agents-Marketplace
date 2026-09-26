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

function SearchResults({ q, data }) {
  if (!q || !data || !Array.isArray(data.results)) return null;
  return (
    <Card>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-[15px] font-semibold text-fg">Results for &ldquo;{q}&rdquo;</h2>
        <DevTag data={data} />
      </div>
      {hasRows(data.results) ? (
        <ul className="divide-y divide-line">
          {data.results.map((r) => (
            <li key={`${r.kind}-${r.key || r.symbol}-${r.chain || r.platform}`} className="py-2.5 flex items-center gap-3">
              <SymbolTile symbol={r.underlying || r.symbol} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-fg truncate">{r.name}</div>
                <div className="text-[12px] text-muted truncate">{r.symbol}{r.issuer ? ` · ${r.issuer}` : ''}{r.chain ? ` · ${r.chain}` : ''}{r.platform ? ` · ${r.platform}` : ''}</div>
              </div>
              <GroupChip group={r.group} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">No stock, ETF or vault we list matches that.</p>
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
  const stocks = useTe(`/api/te/list?type=stock&group=${sg}&limit=100&sort=popular`).data;
  const etfs = useTe(`/api/te/list?type=etf&group=${eg}&limit=100&sort=popular`).data;
  const open = (r) => onNavigate?.(`/stocks?q=${encodeURIComponent(r.underlying)}`);
  return (
    <PageFrame layout={layout} title="Stocks & ETFs">
      <SearchResults q={q} data={search} />
      <InstrumentList title="Tokenized stocks" data={stocks} group={sg} onGroup={setSg} onOpen={open} compact={mobile} />
      <InstrumentList title="Tokenized ETFs" data={etfs} group={eg} onGroup={setEg} onOpen={open} compact={mobile} />
    </PageFrame>
  );
}
