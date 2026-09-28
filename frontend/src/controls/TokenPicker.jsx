// controls/TokenPicker.jsx
//
// "Check a token" on /issuer-controls: type a ticker or a token symbol,
// pick the stock, then the version (issuer and chain). Choosing one calls
// onPick(key), and the page shows that token's controls (?token=<key>).
//
// Reads: GET /api/te/search?q=&versions=all (te/api.js), which returns each
// matching underlying with every listed version of it. A server without
// versions=all answers without them; the open stock then reads
// GET /api/te/underlying/<T> for its EVM versions, adds the versions a
// symbol search matched, and says how many of its versions that is. A
// symbol match (NVDAx) puts the versions it matched first. Nothing is
// fetched until two characters are typed, and a query waits 300 ms for
// typing to stop.

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

const listed = (vs) => (vs || []).filter((v) => v && v.key && v.listed !== false);

/** One result's versions, by chain, the ones the search matched first. From
 *  all_versions when the server sends it; otherwise from the underlying's
 *  own read (its EVM versions) plus the versions a symbol search matched. */
function Versions({ r, current, onPick, btn }) {
  const u = useTe(r.partial ? `/api/te/underlying/${encodeURIComponent(r.underlying)}?size=1000` : null);
  let versions;
  if (!r.partial) versions = listed(r.all_versions);
  else {
    const seen = new Map();
    for (const v of listed(r.matched_versions)) seen.set(v.key, v);
    for (const v of listed(u.data?.versions)) if (!seen.has(v.key)) seen.set(v.key, { key: v.key, symbol: v.symbol, issuer: v.issuer_name || v.issuer, chain: v.chain });
    versions = [...seen.values()];
  }
  const matched = new Set(listed(r.matched_versions).map((v) => v.key));
  const ordered = [...versions.filter((v) => matched.has(v.key)), ...versions.filter((v) => !matched.has(v.key))];
  const missing = Number.isFinite(r.versions) && versions.length < r.versions && !(r.partial && u.loading);
  return (
    <div className="px-3 pb-3 space-y-2">
      {r.partial && u.loading && !versions.length && <p className="text-[12px] text-muted">Reading its versions...</p>}
      {r.partial && u.error && !versions.length && <ReadError error={u.error} body={u.errorBody} what={`the versions of ${r.underlying}`} />}
      {missing && (
        <p className="text-[12px] text-muted">
          {versions.length} of its {r.versions} versions are listed here.{' '}
          <a href={`/stocks/${encodeURIComponent(r.underlying)}`} className="underline underline-offset-2 hover:text-fg">Every version of {r.underlying}</a> is on its stock page.
        </p>
      )}
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
  );
}

export default function TokenPicker({ onPick, current = null, mobile = false }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(null);
  const q = useDebounced(text.trim(), 300);
  const read = useTe(q.length >= 2 ? `/api/te/search?q=${encodeURIComponent(q)}&versions=all&limit=6` : null, { keep: true });
  // all_versions comes with versions=all. A server that predates it answers
  // without; the open result then reads its versions from
  // /api/te/underlying/<T> instead (Versions, below).
  const results = (read.data?.results || []).filter((r) => r.kind === 'instrument')
    .map((r) => ({ ...r, partial: !Array.isArray(r.all_versions) }));
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
          placeholder="NVDAx, AAPL, SPYon..." aria-label="Ticker or token symbol"
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
            return (
              <li key={r.underlying} className="rounded border border-line">
                <button type="button" onClick={() => setOpen(isOpen ? null : r.underlying)} aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-inset rounded">
                  <span className="min-w-0">
                    <span className="text-[14px] font-semibold text-fg">{r.underlying}</span>
                    <span className="ml-2 text-[13px] text-muted">{r.name}</span>
                  </span>
                  {Number.isFinite(r.versions) && <span className="shrink-0 text-[12px] text-muted tabular-nums">{r.versions} {r.versions === 1 ? 'version' : 'versions'}</span>}
                </button>
                {isOpen && <Versions r={r} current={current} onPick={onPick} btn={btn} />}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
