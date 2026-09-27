// stocks/StockPage.jsx
//
// /stocks/:ticker?v=<key>&usd=<n>, one stock or ETF and every tokenized
// version of it (SPEC A.2). One component for both apps; `layout` changes
// the arrangement only (a table on web, one card per version on a phone).
//
// Reads, all ours (class A, and the issuer's words as class D):
//   GET /api/te/underlying/{T}?size=   the versions at the chosen size
//   GET /api/te/curve/{T}              the cost at every stop, by chain
//   GET /api/te/controls?by=key&key=   the chosen version's issuer controls,
//                                      each with its evidence
// The Buy panel (trade/TradePanel.jsx) quotes LI.FI in the browser, on the
// visitor's click only; it shows only while the `buy` section switch is on
// (home/sections.js) and only for a version on an EVM chain we can buy on.
// Behind DATA_LIVE, like every tokenized-equity page.

import React, { useEffect, useMemo, useState } from 'react';
import { Crown, ExternalLink } from 'lucide-react';
import { useTe, hasRows } from '../te/api';
import { DATA_LIVE } from '../dataLive';
import { BUY_LIVE } from '../trade/buyLive';
import { CostCurveCard, Eligibility } from '../home/cards';
import { Card, CardTitle, DevTag, GroupChip, SymbolTile, fmtUsd0 } from '../ui/primitives';
import SizeStrip from '../ui/SizeStrip';
import { Breadcrumb } from '../ui/detail';
import {
  headline, tokensText, bpsText, depthText, blockText, refGap, stateText, measuredLine, sentence, shareRatioText,
} from '../te/costText';
import { updatePageMeta } from '../seoMeta';
import { isBuyChain, addressUrl, parseKey } from '../trade/chains';
import { referencePrice } from '../trade/lifi';
import TradePanel from '../trade/TradePanel';

// The engine's 11 sizes (SPEC B.3). The curve's own stops win when it
// answers; these are the same numbers.
export const STOPS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];

function readQuery() {
  try {
    const p = new URLSearchParams(window.location.search);
    return { v: p.get('v'), usd: Number(p.get('usd')) };
  } catch { return { v: null, usd: NaN }; }
}

function snap(usd) {
  if (!Number.isFinite(usd) || usd <= 0) return 1000;
  return STOPS.reduce((a, s) => (Math.abs(s - usd) < Math.abs(a - usd) ? s : a), STOPS[0]);
}

/** The address bar follows the size and the version, without a new history
 *  entry each time. */
function writeQuery(v, usd) {
  try {
    const p = new URLSearchParams(window.location.search);
    if (v) p.set('v', v); else p.delete('v');
    p.set('usd', String(usd));
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${p.toString()}${window.location.hash}`);
  } catch { /* not fatal */ }
}

function Figures({ v, best }) {
  const h = headline(v);
  if (!h) return null;
  return (
    <>
      <div className="flex items-center justify-end gap-1 text-fg font-semibold">
        {best && <Crown size={13} className="text-pos" aria-label="Lowest all-in price per share at this size" />}
        {h.value}
      </div>
      <div className="text-[11px] text-muted whitespace-nowrap">{h.unit}</div>
    </>
  );
}

function StateCell({ v, size }) {
  if (v.state === 'filled') {
    const gap = refGap(v);
    return (
      <div className="text-[12px]">
        <span className="text-fg">Fills {fmtUsd0(size)}</span>
        {v.comparable === false && <span className="block text-muted">Not ranked: {v.share_ratio_basis || 'share ratio not read'}</span>}
        {gap && <span className="block text-warn" title={gap.basis || undefined}>{gap.text}</span>}
      </div>
    );
  }
  const st = stateText(v, size);
  return st.reason ? (
    <details className="text-[12px]">
      <summary className="cursor-pointer font-semibold text-fg">{st.label}</summary>
      <p className="mt-1 text-muted break-words max-w-[420px]">{sentence(st.reason)}</p>
    </details>
  ) : <span className="text-[12px] font-semibold text-fg">{st.label}</span>;
}

// A Buy button only where a quote can be checked: the Buy panel is shown
// (trade/buyLive.js), the version is on an EVM chain we can buy on, and it
// fills this size on our own measurement, so its measured all-in price per
// token is what LI.FI's answer is held against (trade/lifi.js
// referencePrice). Every other row opens the same details without a Buy.
const buyable = (v) => BUY_LIVE && v.group === 'evm' && isBuyChain(v.chain_id) && !!referencePrice(v);

function VersionsTable({ data, size, selected, onSelect }) {
  const bestKey = data.best?.key;
  return (
    <Card pad={false} className="overflow-x-auto">
      <div className="px-4 pt-4 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-fg">Every version at {fmtUsd0(size)}</h2>
        <DevTag data={data} />
      </div>
      <table className="w-full mt-2 text-[13px] min-w-[900px]">
        <thead>
          <tr className="text-muted text-left text-[12px]">
            <th className="font-medium px-4 py-2">Version</th>
            <th className="font-medium py-2">Chain</th>
            <th className="font-medium py-2 text-right">Per share, all-in</th>
            <th className="font-medium py-2 pl-4 text-right">Tokens per $1,000</th>
            <th className="font-medium py-2 pl-4 text-right">Cost (vs pool mid)</th>
            <th className="font-medium py-2 pl-4 text-right">Depth ±2%</th>
            <th className="font-medium py-2 pl-4">State</th>
            <th className="font-medium px-4 py-2"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.versions.map((v) => {
            const on = v.key === selected;
            return (
              <tr key={v.key} className={on ? 'bg-inset/60' : ''}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <SymbolTile symbol={v.symbol} />
                    <div className="min-w-0">
                      <div className="text-fg font-semibold">{v.symbol}</div>
                      <div className="text-[12px] text-muted">{v.issuer_name || v.issuer}</div>
                    </div>
                  </div>
                </td>
                <td className="py-2.5"><div className="flex items-center gap-2 text-fg whitespace-nowrap">{v.chain}<GroupChip group={v.group} /></div></td>
                <td className="py-2.5 text-right tabular-nums align-top pt-3">{v.state === 'filled' && <Figures v={v} best={v.key === bestKey} />}</td>
                <td className="py-2.5 pl-4 text-right tabular-nums text-fg">{v.state === 'filled' && typeof v.tokens_per_1000 === 'number' ? v.tokens_per_1000.toFixed(4) : ''}</td>
                <td className="py-2.5 pl-4 text-right tabular-nums text-muted">{v.state === 'filled' ? bpsText(v.cost_bps) : ''}</td>
                <td className="py-2.5 pl-4 text-right tabular-nums text-muted">{typeof v.pool_usd === 'number' ? fmtUsd0(v.pool_usd) : ''}</td>
                <td className="py-2.5 pl-4 align-top pt-3"><StateCell v={v} size={size} /></td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button type="button" onClick={() => onSelect(v.key)} aria-pressed={on}
                    className={`h-8 px-3 rounded text-[12px] font-semibold ${buyable(v) ? 'bg-accent text-accent-fg hover:opacity-90' : 'border border-line-strong text-fg hover:bg-inset'}`}>
                    {buyable(v) ? 'Buy' : 'Details'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Footnote data={data} size={size} />
    </Card>
  );
}

function VersionCards({ data, size, selected, onSelect }) {
  const bestKey = data.best?.key;
  return (
    <Card pad={false}>
      <div className="px-4 pt-4 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-fg">Every version at {fmtUsd0(size)}</h2>
        <DevTag data={data} />
      </div>
      <ul className="mt-2 divide-y divide-line">
        {data.versions.map((v) => {
          const on = v.key === selected;
          const parts = v.state === 'filled' ? [tokensText(v.tokens_per_1000), bpsText(v.cost_bps), depthText(v.pool_usd)].filter(Boolean) : [];
          return (
            <li key={v.key} className={`px-4 py-3 ${on ? 'bg-inset/60' : ''}`}>
              <div className="flex items-start gap-3">
                <SymbolTile symbol={v.symbol} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-fg">{v.symbol}</div>
                  <div className="text-[12px] text-muted flex items-center gap-1.5 flex-wrap">{v.issuer_name || v.issuer} · {v.chain}<GroupChip group={v.group} /></div>
                </div>
                <div className="text-right tabular-nums text-[14px]">{v.state === 'filled' && <Figures v={v} best={v.key === bestKey} />}</div>
              </div>
              <div className="pl-12 mt-1">
                {parts.length > 0 && <div className="text-[12px] text-muted">{parts.join(' · ')}</div>}
                <StateCell v={v} size={size} />
                <button type="button" onClick={() => onSelect(v.key)} aria-pressed={on}
                  className={`mt-2 h-9 px-3 rounded text-[12px] font-semibold ${buyable(v) ? 'bg-accent text-accent-fg' : 'border border-line-strong text-fg'}`}>
                  {buyable(v) ? 'Buy' : 'Details'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <Footnote data={data} size={size} />
    </Card>
  );
}

function Footnote({ data, size }) {
  const measured = measuredLine(data.computed_at, data.versions.map((v) => v.us_market_open));
  return (
    <div className="px-4 py-3 border-t border-line space-y-1 text-[11px] leading-snug text-muted">
      <p>The crown marks the lowest all-in price per share among versions that fill {fmtUsd0(size)} and whose share ratio is read. All-in is the size, gas, the L1 fee{data.lifi_fee_included ? ' and LI.FI’s 0.25% fee' : ''}, over the tokens received, over the shares per token.</p>
      <p>Cost in bps is fees and price impact against each pool&apos;s own price, so it does not rank one version against another. Depth is the smaller side of the pool within ±2% of its price.</p>
      {measured && <p>Simulated on the pools, not quoted. {measured}</p>}
    </div>
  );
}

const CONTROL_ROWS = [
  ['pause', 'Pause'], ['freeze', 'Freeze or denylist'], ['burn', 'Burn or seize'],
  ['upgrade', 'Upgrade'], ['mint', 'Mint'], ['allowlist', 'Allowlist'],
];

function Evidence({ e, chainId }) {
  if (!e) return null;
  const at = e.block_or_slot != null ? `${e.unit || 'block'} ${Number(e.block_or_slot).toLocaleString('en-US')}` : e.unit === 'source' ? 'verified source' : null;
  const addr = /^0x[0-9a-fA-F]{40}$/.test(e.address || '') ? e.address : null;
  return (
    <li className="break-words">
      {addr ? <a href={addressUrl(chainId, addr)} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-2 hover:text-fg">{addr}</a> : <span>{e.address}</span>}
      {at ? `, ${at}` : ''}{e.method ? `: ${e.method}` : ''}
      {e.url && <> (<a href={e.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">document<ExternalLink size={10} aria-hidden="true" className="inline ml-0.5" /></a>)</>}
    </li>
  );
}

function ControlsCard({ state, v }) {
  const d = state.data;
  if (!d || !d.controls) {
    if (d?.reason) return <Card><CardTitle>Issuer controls</CardTitle><p className="text-[13px] text-muted">{sentence(d.reason)}.</p></Card>;
    return null;
  }
  const chainId = parseKey(v.key)?.chainId;
  const rows = CONTROL_ROWS.filter(([k]) => d.controls[k]);
  return (
    <Card>
      <CardTitle right={<DevTag data={d} />}>Issuer controls on {v.symbol}, {v.chain}</CardTitle>
      <ul className="divide-y divide-line">
        {rows.map(([k, label]) => {
          const c = d.controls[k];
          const evidence = [c.evidence, c.holder?.evidence].filter(Boolean);
          return (
            <li key={k} className="py-2.5 text-[13px]">
              <div className="grid grid-cols-[120px_1fr] gap-x-3">
                <span className="text-muted">{label}</span>
                <div className="min-w-0">
                  <div className="text-fg break-words">{c.text || c.state || 'not established'}</div>
                  {c.detail && <div className="mt-0.5 text-[12px] text-muted break-words">{sentence(c.detail)}</div>}
                  {c.upgrade_path?.text && <div className="mt-0.5 text-[12px] text-muted break-words">Upgrade path: {c.upgrade_path.text}</div>}
                  {c.capability_note && <div className="mt-0.5 text-[12px] text-muted">{sentence(c.capability_note)}</div>}
                  {evidence.length > 0 && (
                    <details className="mt-1 text-[12px] text-muted">
                      <summary className="cursor-pointer hover:text-fg">Evidence</summary>
                      <ul className="mt-1 space-y-1">{evidence.map((e, i) => <Evidence key={i} e={e} chainId={chainId} />)}</ul>
                    </details>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 pt-3 border-t border-line text-[11px] text-muted">
        Read on chain at the block named in each piece of evidence{d.computed_at ? `; assembled ${d.computed_at.slice(0, 10)}` : ''}. &quot;Single key (inferred)&quot; means the holder has no code; no code does not prove it is one person.
      </p>
    </Card>
  );
}

function SelectedVersion({ v, data, size, compact }) {
  const controls = useTe(DATA_LIVE && v ? `/api/te/controls?by=key&key=${encodeURIComponent(v.key)}` : null);
  if (!v) return null;
  const elig = v.eligibility || controls.data?.controls?.who_may_hold;
  return (
    <div className="space-y-4">
      <h2 className="text-[18px] font-semibold text-fg">{v.symbol} on {v.chain}, from {v.issuer_name || v.issuer}</h2>
      <div className="text-[12px] text-muted break-all">
        Token <a href={addressUrl(v.chain_id, parseKey(v.key)?.address)} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-2 hover:text-fg">{parseKey(v.key)?.address}</a>
        {' · '}{shareRatioText(v)}{blockText(v.block) ? ` · ${blockText(v.block)}` : ''}
      </div>
      {buyable(v) && <TradePanel v={v} size={size} compact={compact} />}
      {/* The Buy panel carries these words beside its checkbox; without it
          they stand on their own. */}
      {!buyable(v) && (
        <Card>
          <CardTitle>Who may hold {v.symbol}</CardTitle>
          <div className="text-[13px] text-fg"><Eligibility e={elig} /></div>
          <p className="mt-2 text-[11px] text-muted">The issuer&apos;s own words, linked and dated. Shown, not enforced: Tnega does not check who you are.</p>
        </Card>
      )}
      <ControlsCard state={controls} v={v} />
    </div>
  );
}

export default function StockPage({ ticker, layout = 'web', onNavigate }) {
  const mobile = layout === 'mobile';
  const T = String(ticker || '').toUpperCase();
  const initial = useMemo(readQuery, []);
  const [size, setSize] = useState(() => snap(initial.usd));
  const [selected, setSelected] = useState(initial.v || null);
  const u = useTe(DATA_LIVE && T ? `/api/te/underlying/${encodeURIComponent(T)}?size=${size}` : null, { keep: true });
  const curve = useTe(DATA_LIVE && T ? `/api/te/curve/${encodeURIComponent(T)}` : null).data;
  const data = u.data;
  const stops = hasRows(curve?.stops) ? curve.stops : STOPS;

  const versions = hasRows(data?.versions) ? data.versions : [];
  const current = versions.find((v) => v.key === selected) || versions.find((v) => v.key === data?.best?.key) || versions[0] || null;

  useEffect(() => { writeQuery(current?.key || selected, size); }, [current?.key, selected, size]);
  useEffect(() => {
    if (!data?.name) return;
    updatePageMeta({
      title: `${data.name} (${T}), every tokenized version`,
      description: `Every tokenized ${T} we list: issuer, chain, the all-in price per share at your size, depth, issuer controls and who may hold each.`,
      path: `/stocks/${T}`,
    });
  }, [data?.name, T]);

  const pick = (key) => {
    setSelected(key);
    requestAnimationFrame(() => document.getElementById('selected-version')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const failed = !data && u.error && !u.loading;
  return (
    <div className={mobile ? 'px-4 pt-5 pb-6' : 'w-full'}>
      <Breadcrumb parent="Stocks & ETFs" parentPath="/stocks" name={data?.name || T} onNavigate={onNavigate} />
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <SymbolTile symbol={T} />
          <div>
            <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-fg leading-tight">{data?.name || T}</h1>
            <div className="text-[13px] text-muted">
              {T}{data?.type ? ` · ${data.type === 'etf' ? 'ETF' : 'Stock'}` : ''}
              {versions.length ? ` · ${versions.length} tokenized version${versions.length === 1 ? '' : 's'}` : ''}
            </div>
          </div>
        </div>
      </div>

      <SizeStrip className="mt-4" ariaLabel="Order size" stops={stops} value={size} onChange={setSize} />
      {u.stale && <p className="mt-1 text-[11px] text-muted">Updating to {fmtUsd0(size)}</p>}

      <div className={`mt-4 ${mobile ? 'space-y-4' : 'space-y-6'}`}>
        {failed && (
          <Card><p className="text-[13px] text-muted">{u.error === 'HTTP 404' ? `No measured answer for ${T} at ${fmtUsd0(size)}.` : `Couldn't read ${T}. Try again later.`}</p></Card>
        )}
        {versions.length > 0 && (
          <div className={u.stale ? 'opacity-60 transition-opacity' : ''}>
            {mobile
              ? <VersionCards data={data} size={size} selected={current?.key} onSelect={pick} />
              : <VersionsTable data={data} size={size} selected={current?.key} onSelect={pick} />}
          </div>
        )}
        {curve && <CostCurveCard data={curve} size={size} onSize={setSize} />}
        <div id="selected-version" className="scroll-mt-20">
          {current && !u.stale && <SelectedVersion key={current.key} v={current} data={data} size={size} compact={mobile} />}
        </div>
      </div>
    </div>
  );
}
