// controls/Cell.jsx
//
// One power of one programme (or one token), as served by
// GET /api/te/controls: the headline and who holds it always show; what
// the contract does, the upgrade path, the simulation and the evidence sit
// under "Show details". Used by the page's table, its phone cards and the
// one-token card (controls/TokenControls.jsx), so all three say the same.
//
// Nothing here is worked out: each line is a served field, shown as served.
// An address becomes a link to the chain's explorer when the chain is known
// (controls/model.js explorerUrl).

import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { sentence } from '../te/costText';
import { splitCell, explorerUrl, atText } from './model';

const linkCls = 'underline underline-offset-2 hover:text-fg';

function Addr({ chain, address, children }) {
  const url = explorerUrl(chain, address);
  const label = children || address;
  if (!url) return <span className="font-mono break-all">{label}</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className={`font-mono break-all ${linkCls}`}>{label}</a>;
}

const plural = (n, one, many) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** The holder lines of a cell: per chain when the programme's chains
 *  differ, otherwise the served text after the headline. */
export function CellHolders({ c, className = '' }) {
  if (!c) return null;
  const variants = Array.isArray(c.variants) && c.variants.length > 1 ? c.variants : null;
  if (variants) {
    return (
      <ul className={`space-y-1 ${className}`}>
        {variants.map((v, i) => {
          const rest = v.holder?.text || splitCell(v).rest || (v.state !== c.state ? v.text : null);
          return (
            <li key={i} className="break-words">
              <span className="text-fg">{(v.chains || []).join(', ')}</span>
              {Number.isFinite(v.tokens) && <span> ({plural(v.tokens, 'token', 'tokens')})</span>}
              {v.state && v.state !== c.state && <span>: {v.state}</span>}
              {rest && <span>: {(() => {
                // The served text shortens the holder's address; link it to
                // the full one on the chain's explorer when there is one.
                const url = (v.chains || []).length === 1 ? explorerUrl(v.chains[0], v.holder?.address) : null;
                return url ? <a href={url} target="_blank" rel="noopener noreferrer" className={linkCls}>{rest}</a> : rest;
              })()}</span>}
            </li>
          );
        })}
      </ul>
    );
  }
  const { rest } = splitCell(c);
  return rest ? <p className={`break-words ${className}`}>{rest}</p> : null;
}

function Holder({ h, chain }) {
  if (!h) return null;
  if (h.roles && typeof h.roles === 'object') {
    return (
      <ul className="space-y-1">
        {Object.entries(h.roles).map(([role, r]) => (
          <li key={role} className="break-words">
            <span className="font-mono text-fg">{role}</span>
            {Number.isFinite(r?.count) && <span>, {plural(r.count, 'member', 'members')}</span>}
            {(r?.members || []).map((m) => (
              <span key={m.address} className="block pl-3">
                {m.kind ? `${m.kind}: ` : ''}<Addr chain={chain} address={m.address} />
              </span>
            ))}
          </li>
        ))}
      </ul>
    );
  }
  const facts = [
    h.kind,
    Number.isFinite(h.threshold) && Number.isFinite(h.owners) ? `${h.threshold} of ${h.owners} signers` : null,
    Number.isFinite(h.time_lock_s) ? `time lock ${h.time_lock_s} s` : null,
    Number.isFinite(h.min_delay_s) ? `minimum delay ${h.min_delay_s.toLocaleString('en-US')} s` : null,
  ].filter(Boolean);
  return (
    <div className="break-words">
      {facts.length > 0 && <span>{facts.join(', ')}</span>}
      {h.address && <span className="block"><Addr chain={chain} address={h.address} /></span>}
      {h.multisig && <span className="block">multisig <Addr chain={chain} address={h.multisig} /></span>}
      {typeof h.owner === 'string' && <span className="block">owner <Addr chain={chain} address={h.owner} /></span>}
      {h.owner && typeof h.owner === 'object' && <div className="mt-1 pl-3">owned by: <Holder h={h.owner} chain={chain} /></div>}
    </div>
  );
}

function EvidenceItem({ e }) {
  if (!e) return null;
  const at = atText(e);
  return (
    <li className="break-words">
      {e.chain && <span className="text-fg">{e.chain}: </span>}
      {e.address && <Addr chain={e.chain} address={e.address} />}
      {at ? `, ${at}` : ''}
      {e.method ? `. ${sentence(e.method)}` : ''}
      {e.url && <> (<a href={e.url} target="_blank" rel="noopener noreferrer" className={linkCls}>document<ExternalLink size={10} aria-hidden="true" className="inline ml-0.5" /></a>)</>}
    </li>
  );
}

function Simulation({ s, chain }) {
  if (!s) return null;
  return (
    <div className="space-y-1 break-words">
      <p>
        {s.calldata_decoded || 'Simulated call'}
        {s.token && <> on <Addr chain={chain} address={s.token} /></>}
        {Number.isFinite(s.block) && <>, block {s.block.toLocaleString('en-US')}</>}
      </p>
      {Array.isArray(s.calls) && (
        <ul className="space-y-0.5 pl-3">
          {s.calls.map((c, i) => (
            <li key={i}>
              from <Addr chain={chain} address={c.from} />: {c.error ? `reverted (${c.error.message || 'error'})` : `returned ${c.result}`}
            </li>
          ))}
        </ul>
      )}
      {s.reading && <p>{s.reading}</p>}
    </div>
  );
}

function Sub({ title, children }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/** Everything under "Show details". `chain` is the programme's one chain,
 *  when it has one, for the explorer links of role holders. */
export function CellDetails({ c, chain = null, withHolders = false }) {
  if (!c) return null;
  // A token's own answer (by=key) carries its evidence without a chain; the
  // chain is the token's, passed in, so every address still links to its
  // explorer, as the stock page's card did before it was shared. A
  // programme's evidence names its chain on each item and keeps it.
  const withChain = (e) => (e && !e.chain && chain ? { ...e, chain } : e);
  const evidence = [].concat(c.evidence || [], c.holder?.evidence ? [c.holder.evidence] : []).filter(Boolean).map(withChain);
  const variants = Array.isArray(c.variants) && c.variants.length > 1 ? c.variants : null;
  const parts = [
    withHolders && (splitCell(c).rest || variants) && <Sub key="r" title="Held by"><CellHolders c={c} /></Sub>,
    c.detail && <Sub key="d" title="What the contract does"><p className="break-words">{sentence(c.detail)}</p></Sub>,
    c.capability_note && <Sub key="n" title="Note"><p className="break-words">{sentence(c.capability_note)}</p></Sub>,
    (c.pattern || c.beacon || c.varies_across_tokens) && (
      <Sub key="p" title="Contract">
        <p className="break-words">
          {c.pattern}
          {c.beacon && <>{c.pattern ? ', ' : ''}beacon <Addr chain={chain} address={c.beacon} /></>}
          {Array.isArray(c.varies_across_tokens) && c.varies_across_tokens.length > 0 && <>; varies across tokens: {c.varies_across_tokens.join(', ')}</>}
        </p>
      </Sub>
    ),
    variants
      ? <Sub key="h" title="Who holds it, by chain">
          <ul className="space-y-2">
            {variants.map((v, i) => (
              <li key={i}>
                <span className="text-fg">{(v.chains || []).join(', ')}</span>
                <Holder h={v.holder} chain={(v.chains || []).length === 1 ? v.chains[0] : null} />
              </li>
            ))}
          </ul>
        </Sub>
      : c.holder && <Sub key="h" title="Who holds it"><Holder h={c.holder} chain={chain} /></Sub>,
    c.upgrade_path?.text && (
      <Sub key="u" title="Upgrade path">
        <p className="break-words">{sentence(c.upgrade_path.text)}</p>
      </Sub>
    ),
    c.simulation && <Sub key="s" title="Simulation (eth_call, nothing broadcast)"><Simulation s={c.simulation} chain={chain} /></Sub>,
    evidence.length > 0 && (
      <Sub key="e" title="Evidence">
        <ul className="space-y-1">{evidence.map((e, i) => <EvidenceItem key={i} e={e} />)}</ul>
      </Sub>
    ),
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <details className="mt-1.5 text-[12px] leading-snug text-muted group">
      <summary className="cursor-pointer select-none text-fg underline underline-offset-2 hover:opacity-80 list-none [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Show details</span>
        <span className="hidden group-open:inline">Hide details</span>
      </summary>
      <div className="mt-2 space-y-2.5">{parts}</div>
    </details>
  );
}

/** One power as a block: headline, holders, then the details. With
 *  `holders` false (phone cards) the holder lines move under "Show
 *  details", so each card stays short until opened. */
export function Cell({ c, chain = null, holders = true }) {
  if (!c) return <span className="text-muted">not established</span>;
  const { head } = splitCell(c);
  return (
    <div className="min-w-0 text-[13px] leading-snug">
      <div className="text-fg break-words">{head ? sentence(head) : 'not established'}</div>
      {holders && <CellHolders c={c} className="mt-0.5 text-[12px] text-muted" />}
      <CellDetails c={c} chain={chain} withHolders={!holders} />
    </div>
  );
}

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'document'; } };

/** Who may hold: the issuer's words, the link and the date, or "not read".
 *  `clamp` shows three lines with "Show all" (phone cards). */
export function WhoMayHold({ e, clamp = false }) {
  const [open, setOpen] = useState(false);
  if (!e || !e.text || !e.url || !e.read_on) return <span className="text-muted text-[13px]">not read</span>;
  const also = Array.isArray(e.also) ? e.also : [];
  const long = clamp && e.text.length > 160;
  return (
    <div className="min-w-0 text-[13px] leading-snug">
      <p className={`text-fg break-words ${long && !open ? 'line-clamp-3' : ''}`}>{e.text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-0.5 text-[12px] text-fg underline underline-offset-2">
          {open ? 'Show less' : 'Show all of it'}
        </button>
      )}
      <p className="mt-0.5 text-[12px] text-muted">
        The issuer&apos;s words, not a chain read: <a href={e.url} target="_blank" rel="noopener noreferrer" className={linkCls}>issuer&apos;s terms</a>, read on {e.read_on}
        {also.length > 0 && <>; also {also.map((u, i) => <React.Fragment key={u}>{i > 0 ? ', ' : ''}<a href={u} target="_blank" rel="noopener noreferrer" className={linkCls}>{host(u)}</a></React.Fragment>)}</>}
      </p>
    </div>
  );
}
