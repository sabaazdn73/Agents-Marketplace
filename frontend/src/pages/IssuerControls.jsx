// IssuerControls.jsx
//
// /issuer-controls: who can pause, freeze, take or change the tokenized
// stocks and ETFs we list, programme by programme. The home section
// "Issuer controls" summarises what this page covers and links here, as
// does each stock page for its chosen version.
//
// Reads, all ours (class A chain reads; who may hold is class D, the issuer's
// words, linked and dated):
//   GET /api/te/controls?by=issuer         every programme, the home's read
//   GET /api/te/controls?by=key&key=<key>  one token, when ?token= names one
//
// The address carries the view, so a stock page, a shared link or Back can
// open it as it was:
//   ?token=<chainId>/<address> or solana/<mint>   that token's card under
//                                                 the picker, its programme's
//                                                 row marked. The picker
//                                                 (controls/TokenPicker.jsx)
//                                                 sets it.
//   ?issuer=<slug>&chain=<slug>&q=<text>          the filter
//
// One component for both apps. `layout` chooses a table (web) or one card
// per programme with long cells collapsed (mobile); the words are the same.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTe } from '../te/api';
import ReadError from '../te/ReadError';
import { Card, CardTitle, DevTag } from '../ui/primitives';
import { PageFrame } from './PageFrame';
import { Cell, WhoMayHold } from '../controls/Cell';
import TokenControls from '../controls/TokenControls';
import TokenPicker from '../controls/TokenPicker';
import { POWER_ICONS } from '../controls/ControlsSummary';
import { POWERS, coverage, dayText, filterOptions, rowMatches, rowAnchor, rowForToken } from '../controls/model';

const TABLE_POWERS = POWERS.filter((p) => !p.issuerWords);
const TOKEN_KEY = /^(\d{1,7}\/0x[0-9a-fA-F]{40}|solana\/[1-9A-HJ-NP-Za-km-z]{32,44})$/;

function readParams() {
  try {
    const q = new URLSearchParams(window.location.search);
    const token = q.get('token') || '';
    return {
      token: TOKEN_KEY.test(token) ? token : '',
      badToken: token && !TOKEN_KEY.test(token) ? token : '',
      issuer: q.get('issuer') || '',
      chain: q.get('chain') || '',
      text: q.get('q') || '',
    };
  } catch {
    return { token: '', badToken: '', issuer: '', chain: '', text: '' };
  }
}

/** Keep the address in step with the filter, without a new history entry. */
function writeParams({ token, issuer, chain, text }) {
  const q = new URLSearchParams();
  if (token) q.set('token', token);
  if (issuer) q.set('issuer', issuer);
  if (chain) q.set('chain', chain);
  if (text) q.set('q', text);
  const s = q.toString();
  try { window.history.replaceState(window.history.state, '', `/issuer-controls${s ? `?${s}` : ''}${window.location.hash}`); } catch { /* not fatal */ }
}

function Intro({ mobile }) {
  return (
    <Card>
      <CardTitle>What each power means for you</CardTitle>
      <p className="text-[14px] leading-relaxed text-muted max-w-[760px]">
        A tokenized stock is a token an issuer controls through its contract. The powers below decide what can happen to your
        tokens without your signature. For each programme we read the contract on chain: whether the power exists, who holds it
        (one key, a multisig and how many of its signers must agree, a timelock and its delay) and the block or slot of the read.
      </p>
      <ul className={`mt-4 grid gap-3 ${mobile ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3'}`}>
        {POWERS.map((p) => {
          const Icon = POWER_ICONS[p.key];
          return (
            <li key={p.key} className="rounded border border-line p-3">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 shrink-0 rounded border border-line-strong flex items-center justify-center text-fg"><Icon size={14} aria-hidden="true" /></span>
                <span className="text-[14px] font-semibold text-fg">{p.label}</span>
              </div>
              <p className="mt-2 text-[13px] font-medium text-fg">{p.ask}</p>
              <p className="mt-1 text-[13px] leading-snug text-muted">{p.means}</p>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[13px] leading-relaxed text-muted max-w-[760px]">
        Why it matters: who holds a power decides how quickly it can be used. One key can act alone; a multisig needs the stated
        number of its signers to agree; a timelock makes a change wait for its delay, which gives holders time to see it coming.
        These are readings of what the contracts allow, not a rating and not a recommendation.
      </p>
    </Card>
  );
}

function Filters({ rows, f, setF, shown, mobile }) {
  const { issuers, chains } = useMemo(() => filterOptions(rows), [rows]);
  const sel = 'h-9 rounded border border-line-strong bg-field text-fg text-[13px] px-2';
  const any = f.issuer || f.chain || f.text;
  return (
    <div className={`flex ${mobile ? 'flex-col items-stretch' : 'flex-wrap items-center'} gap-2`}>
      <label className={`h-9 flex items-center gap-2 px-3 rounded bg-field border border-line-strong focus-within:ring-2 focus-within:ring-accent ${mobile ? '' : 'w-[260px]'}`}>
        <Search size={15} className="text-muted shrink-0" aria-hidden="true" />
        <input
          type="search" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })}
          placeholder="Search an issuer or chain" aria-label="Search an issuer or chain"
          className="flex-1 min-w-0 bg-transparent text-[13px] text-fg placeholder:text-muted outline-none"
        />
      </label>
      <div className="flex gap-2">
        <select aria-label="Issuer" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} className={`${sel} ${mobile ? 'flex-1' : ''}`}>
          <option value="">All issuers</option>
          {issuers.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
        <select aria-label="Chain" value={f.chain} onChange={(e) => setF({ ...f, chain: e.target.value })} className={`${sel} ${mobile ? 'flex-1' : ''}`}>
          <option value="">All chains</option>
          {chains.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <span className="text-[12px] text-muted tabular-nums">
        {shown} of {rows.length} programmes
        {any && (
          <button type="button" onClick={() => setF({ issuer: '', chain: '', text: '' })} className="ml-2 inline-flex items-center gap-1 text-fg underline underline-offset-2">
            <X size={12} aria-hidden="true" />Clear
          </button>
        )}
      </span>
    </div>
  );
}

function ProgrammeHead({ r }) {
  return (
    <div className="min-w-0">
      <div className="text-[14px] font-semibold text-fg">{r.issuer}</div>
      <div className="text-[12px] text-muted break-words">{r.programme}</div>
      <div className="mt-1 text-[12px] text-fg">{(r.chains || []).join(', ')}</div>
      {Number.isFinite(r.tokens) && <div className="text-[12px] text-muted tabular-nums">{r.tokens.toLocaleString('en-US')} listed {r.tokens === 1 ? 'token' : 'tokens'}</div>}
    </div>
  );
}

// One chain name, or the list when the programme spans several: an address
// that holds a power on each then links to each chain's explorer.
const oneChain = (r) => ((r.chains || []).length === 1 ? r.chains[0] : r.chains || []);

function ControlsTable({ rows, marked }) {
  return (
    <Card pad={false} className="overflow-x-auto">
      <table className="w-full min-w-[1100px] table-fixed text-left align-top">
        <colgroup>
          <col style={{ width: '15%' }} />
          {TABLE_POWERS.map((p) => <col key={p.key} style={{ width: '17%' }} />)}
          <col style={{ width: '17%' }} />
        </colgroup>
        <thead>
          <tr className="text-[12px] text-muted border-b border-line">
            <th scope="col" className="font-medium px-4 py-3">Issuer and chains</th>
            {[...TABLE_POWERS, POWERS.find((p) => p.issuerWords)].map((p) => {
              const Icon = POWER_ICONS[p.key];
              return (
                <th key={p.key} scope="col" className="font-medium px-3 py-3">
                  <span className="inline-flex items-center gap-1 text-fg"><Icon size={12} aria-hidden="true" />{p.label}</span>
                  <span className="block font-normal">{p.ask}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const on = marked === rowAnchor(r);
            return (
              <tr key={rowAnchor(r)} id={rowAnchor(r)} className={`align-top scroll-mt-24 ${on ? 'bg-inset' : ''}`}>
                <th scope="row" className={`px-4 py-3 font-normal ${on ? 'border-l-2 border-accent' : ''}`}>
                  <ProgrammeHead r={r} />
                  {on && <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-fg">Your token&apos;s programme</div>}
                </th>
                {TABLE_POWERS.map((p) => (
                  <td key={p.key} className="px-3 py-3"><Cell c={r[p.key]} chain={oneChain(r)} /></td>
                ))}
                <td className="px-3 py-3"><WhoMayHold e={r.who_may_hold} clamp /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function ControlsCards({ rows, marked }) {
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const on = marked === rowAnchor(r);
        return (
          <Card key={rowAnchor(r)} id={rowAnchor(r)} className={`scroll-mt-20 ${on ? 'ring-2 ring-accent' : ''}`}>
            <ProgrammeHead r={r} />
            {on && <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-fg">Your token&apos;s programme</div>}
            <dl className="mt-3 divide-y divide-line">
              {TABLE_POWERS.map((p) => (
                <div key={p.key} className="py-2.5">
                  <dt className="text-[12px] text-muted">{p.label}: {p.ask.charAt(0).toLowerCase() + p.ask.slice(1)}</dt>
                  <dd className="mt-0.5"><Cell c={r[p.key]} chain={oneChain(r)} holders={false} /></dd>
                </div>
              ))}
              <div className="py-2.5">
                <dt className="text-[12px] text-muted">Who may hold: who is allowed to own it?</dt>
                <dd className="mt-0.5"><WhoMayHold e={r.who_may_hold} clamp /></dd>
              </div>
            </dl>
          </Card>
        );
      })}
    </div>
  );
}

function SourceNote({ data }) {
  const src = data?.source || {};
  const asOf = dayText(data?.computed_at);
  return (
    <div className="text-[12px] leading-relaxed text-muted space-y-1 max-w-[860px]">
      {asOf && <p className="text-fg">Read on chain, as of {asOf}.{src.reads ? ` ${src.reads.charAt(0).toUpperCase()}${src.reads.slice(1)}.` : ''}</p>}
      {src.class && <p>Source classes: {src.class}. Each evidence line names what was read and how.</p>}
      {data?.scope && <p>Scope: {data.scope}.</p>}
      <p>&quot;Single key (inferred)&quot; means the holder address has no code; no code does not prove it is one person. &quot;Not established&quot; means our reads did not settle it; it does not mean the power is absent.</p>
    </div>
  );
}

export default function IssuerControls({ layout = 'web', onNavigate }) {
  const mobile = layout === 'mobile';
  const [params, setParams] = useState(readParams);
  const [f, setFState] = useState({ issuer: params.issuer, chain: params.chain, text: params.text });
  const setF = (next) => { setFState(next); writeParams({ token: params.token, ...next }); };

  useEffect(() => {
    const onPop = () => { const p = readParams(); setParams(p); setFState({ issuer: p.issuer, chain: p.chain, text: p.text }); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const all = useTe('/api/te/controls?by=issuer');
  const tok = useTe(params.token ? `/api/te/controls?by=key&key=${encodeURIComponent(params.token)}` : null);
  const rows = useMemo(() => (Array.isArray(all.data?.rows) ? all.data.rows : []), [all.data]);
  const shown = rows.filter((r) => rowMatches(r, f));
  const tokenRow = rowForToken(rows, tok.data);
  const marked = tokenRow ? rowAnchor(tokenRow) : null;
  const cov = coverage(all.data);

  // Open at the token's card when the address names one.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !params.token || !tok.data) return;
    scrolled.current = true;
    requestAnimationFrame(() => document.getElementById('your-token')?.scrollIntoView({ block: 'start' }));
  }, [params.token, tok.data]);

  const pickToken = (key) => {
    scrolled.current = false;
    const p = { ...params, token: key, badToken: '' };
    setParams(p);
    writeParams({ token: key, ...f });
  };

  const clearToken = () => {
    scrolled.current = false;
    const p = { ...params, token: '', badToken: '' };
    setParams(p);
    writeParams({ token: '', ...f });
  };

  const sub = cov
    ? `Pause, freeze, burn or seize, upgrade and who may hold: ${cov.issuers.length} issuers, ${cov.tokens != null ? `${cov.tokens.toLocaleString('en-US')} listed tokens, ` : ''}${cov.chains} chains.`
    : 'Pause, freeze, burn or seize, upgrade and who may hold, for every token we list.';

  return (
    <PageFrame layout={layout} title="Issuer controls" sub={sub} right={<DevTag data={all.data} />}>
      <TokenPicker onPick={pickToken} current={params.token || null} mobile={mobile} />

      {params.badToken && (
        <Card><p className="text-[13px] text-muted">The link names a token as &quot;{params.badToken}&quot;, which is not a token key (chain id and address, or solana and the mint).</p></Card>
      )}
      {params.token && (tok.data || tok.error) && (
        <div id="your-token" className="scroll-mt-24 space-y-2">
          {tok.data ? (
            <TokenControls data={tok.data} withWhoMayHold compact={mobile} />
          ) : (
            <ReadError error={tok.error} body={tok.errorBody} what={`the controls of ${params.token}`} />
          )}
          <button type="button" onClick={clearToken} className="text-[12px] text-muted underline underline-offset-2 hover:text-fg">Show every programme without this token</button>
        </div>
      )}

      <Intro mobile={mobile} />

      {all.error && !rows.length && <ReadError error={all.error} body={all.errorBody} what="the issuer controls" />}

      {rows.length > 0 && (
        <section aria-labelledby="programmes" className="space-y-3">
          <h2 id="programmes" className="text-[18px] font-semibold text-fg">Who holds each power, by issuer and chain</h2>
          <Filters rows={rows} f={f} setF={setF} shown={shown.length} mobile={mobile} />
          {shown.length === 0
            ? <Card><p className="text-[13px] text-muted">No programme matches this filter.</p></Card>
            : mobile ? <ControlsCards rows={shown} marked={marked} /> : <ControlsTable rows={shown} marked={marked} />}
          <SourceNote data={all.data} />
        </section>
      )}
    </PageFrame>
  );
}
