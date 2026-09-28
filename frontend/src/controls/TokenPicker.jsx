// controls/TokenPicker.jsx
//
// "Check a token" on /issuer-controls: type a ticker or a token symbol,
// pick the stock, then the version (issuer and chain). Choosing one calls
// onPick(key), and the page shows that token's controls (?token=<key>).
//
// One read: GET /api/te/search?q=&versions=all (te/api.js), which returns
// each matching underlying with every listed version of it. A symbol match
// (NVDAx) puts the versions it matched first. Nothing is fetched until two
// characters are typed, and a query waits 300 ms for typing to stop.

import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useTe } from '../te/api';
import ReadError from '../te/ReadError';
import { Card, CardTitle } from '../ui/primitives';

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Versions grouped by chain, in the served order. */
function byChain(versions) {
  const out = [];
  for (const v of versions) {
    let g = out.find((x) => x.chain === v.chain);
    if (!g) { g = { chain: v.chain, versions: [] }; out.push(g); }
    g.versions.push(v);
  }
  return out;
}

export default function TokenPicker({ onPick, current = null, mobile = false }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(null);
  const q = useDebounced(text.trim(), 300);
  const read = useTe(q.length >= 2 ? `/api/te/search?q=${encodeURIComponent(q)}&versions=all&limit=6` : null, { keep: true });
  const results = (read.data?.results || []).filter((r) => r.kind === 'instrument' && Array.isArray(r.all_versions));
  // One result opens by itself; a new query closes the previous choice.
  useEffect(() => { setOpen(results.length === 1 ? results[0].underlying : null); }, [read.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const btn = 'text-left rounded border px-3 py-2 text-[13px] hover:bg-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  return (
    <Card id="check">
      <CardTitle>Check a token</CardTitle>
      <p className="text-[13px] text-muted mb-3">Type a ticker or a token symbol, then pick the issuer and chain.</p>
      <label className={`h-10 flex items-center gap-2 px-3 rounded bg-field border border-line-strong focus-within:ring-2 focus-within:ring-accent ${mobile ? '' : 'max-w-[420px]'}`}>
        <Search size={15} className="text-muted shrink-0" aria-hidden="true" />
        <input
          type="search" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="NVDA, AAPLx, SPYon..." aria-label="Ticker or token symbol"
          autoComplete="off" spellCheck={false}
          className="flex-1 min-w-0 bg-transparent text-[14px] text-fg placeholder:text-muted outline-none"
        />
      </label>

      {q.length >= 2 && read.error && !read.data && <div className="mt-3"><ReadError error={read.error} body={read.errorBody} what="the search" /></div>}
      {q.length >= 2 && read.data && !read.stale && results.length === 0 && (
        <p className="mt-3 text-[13px] text-muted">{read.data.reason ? `${read.data.reason.charAt(0).toUpperCase()}${read.data.reason.slice(1)}.` : `No listed stock or ETF matches "${q}".`}</p>
      )}

      {results.length > 0 && q.length >= 2 && (
        <ul className={`mt-3 space-y-2 ${read.stale ? 'opacity-60' : ''}`} aria-live="polite">
          {results.map((r) => {
            const isOpen = open === r.underlying;
            const matched = new Set((r.matched_versions || []).map((v) => v.key));
            const ordered = matched.size ? [...r.all_versions.filter((v) => matched.has(v.key)), ...r.all_versions.filter((v) => !matched.has(v.key))] : r.all_versions;
            return (
              <li key={r.underlying} className="rounded border border-line">
                <button type="button" onClick={() => setOpen(isOpen ? null : r.underlying)} aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-inset rounded">
                  <span className="min-w-0">
                    <span className="text-[14px] font-semibold text-fg">{r.underlying}</span>
                    <span className="ml-2 text-[13px] text-muted">{r.name}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-muted tabular-nums">{r.all_versions.length} {r.all_versions.length === 1 ? 'version' : 'versions'}</span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-2">
                    {byChain(ordered).map((g) => (
                      <div key={g.chain}>
                        <div className="text-[12px] text-muted mb-1">{g.chain}</div>
                        <div className="flex flex-wrap gap-2">
                          {g.versions.map((v) => {
                            const on = current === v.key;
                            return (
                              <button key={v.key} type="button" onClick={() => onPick(v.key)} aria-pressed={on}
                                className={`${btn} ${on ? 'border-accent bg-inset' : matched.has(v.key) ? 'border-line-strong' : 'border-line'}`}>
                                <span className="font-semibold text-fg">{v.symbol}</span>
                                <span className="text-muted"> · {v.issuer}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
