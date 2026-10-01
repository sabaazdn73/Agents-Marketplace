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
//   GET /api/te/aave-v4                Aave V4 on Base: the sources and
//                                      Aave's eligibility wording, read only
//                                      when the chosen version is on Base
// Each version's Aave V4 collateral line (Base only) comes with the
// underlying read (versions[].aave_v4, aave_v4_usdc_borrow): stocks/AaveV4.jsx.
// The chosen version has three tabs, Details, Buy and Sell (?tab=). Buy and
// Sell (trade/StockTrade.jsx) quote LI.FI in the browser, on the visitor's
// click only, and only on a chain switched on in trade/tradeLive.js (every
// buy chain since 2026-10-01); on any other chain, or for a version with no
// measured pool, the tab says so and offers no control.
// Behind DATA_LIVE, like every tokenized-equity page.

import ReadError from '../te/ReadError';
import React, { useEffect, useMemo, useState } from 'react';
import { Crown } from 'lucide-react';
import { useTe, hasRows } from '../te/api';
import { DATA_LIVE } from '../dataLive';
import { CostCurveCard, Eligibility } from '../home/cards';
import { Card, CardTitle, DevTag, GroupChip, SymbolTile, fmtUsd0 } from '../ui/primitives';
import SizeStrip from '../ui/SizeStrip';
import { Breadcrumb } from '../ui/detail';
import {
  headline, tokensText, tiedWithBest, tieLine, priceText4, bpsText, depthText, blockText, refGap, stateText, measuredLine, sentence, shareRatioText,
} from '../te/costText';
import { updatePageMeta } from '../seoMeta';
import { addressUrl, parseKey } from '../trade/chains';
import StockTrade from '../trade/StockTrade';
import { GlassTabs } from '../ui/detail';
import TokenControls from '../controls/TokenControls';
import { tokenLink } from '../controls/model';
import { AaveV4Inline, AaveV4Card } from './AaveV4';

// The engine's 11 sizes (SPEC B.3). The curve's own stops win when it
// answers; these are the same numbers.
export const STOPS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];

const TABS = [{ id: 'details', label: 'Details' }, { id: 'buy', label: 'Buy' }, { id: 'sell', label: 'Sell' }];

function readQuery() {
  try {
    const p = new URLSearchParams(window.location.search);
    const tab = p.get('tab');
    return { v: p.get('v'), usd: Number(p.get('usd')), tab: TABS.some((t) => t.id === tab) ? tab : 'details' };
  } catch { return { v: null, usd: NaN, tab: 'details' }; }
}

function snap(usd) {
  if (!Number.isFinite(usd) || usd <= 0) return 1000;
  return STOPS.reduce((a, s) => (Math.abs(s - usd) < Math.abs(a - usd) ? s : a), STOPS[0]);
}

/** The address bar follows the size and the version, without a new history
 *  entry each time. */
function writeQuery(v, usd, tab) {
  try {
    const p = new URLSearchParams(window.location.search);
    if (v) p.set('v', v); else p.delete('v');
    p.set('usd', String(usd));
    if (tab && tab !== 'details') p.set('tab', tab); else p.delete('tab');
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${p.toString()}${window.location.hash}`);
  } catch { /* not fatal */ }
}

// The crown is the served best (data.best), which is also the version the
// page opens on. When another version rounds to the same cent, both show
// four decimals, so the reader can see which is lower, and the crowned one
// says what it is ranked by.
function Figures({ v, best, tied }) {
  const h = headline(v);
  if (!h) return null;
  return (
    <>
      <div className="flex items-center justify-end gap-1 text-fg font-semibold">
        {best && <Crown size={13} className="text-pos" aria-label="Lowest all-in price per share at this size" />}
        {tied ? priceText4(v.allin_per_share) : h.value}
      </div>
      <div className="text-[11px] text-muted whitespace-nowrap">{h.unit}</div>
      {best && <div className="text-[11px] text-pos whitespace-nowrap">lowest per share{tied ? ', tied to the cent' : ''}</div>}
    </>
  );
}

function TieNote({ data, size }) {
  const line = tieLine(tiedWithBest(data.versions, data.best?.key), size);
  return line ? <p className="px-4 pt-2 text-[12px] text-fg">{line}</p> : null;
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

function VersionsTable({ data, size, selected, onSelect }) {
  const bestKey = data.best?.key;
  const tied = new Set(tiedWithBest(data.versions, bestKey).map((x) => x.key));
  return (
    <Card pad={false} className="overflow-x-auto">
      <div className="px-4 pt-4 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-fg">Every version at {fmtUsd0(size)}</h2>
        <DevTag data={data} />
      </div>
      <TieNote data={data} size={size} />
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
                    <SymbolTile symbol={v.symbol} underlying={data.ticker} issuer={v.issuer} />
                    <div className="min-w-0">
                      <div className="text-fg font-semibold">{v.symbol}</div>
                      <div className="text-[12px] text-muted">{v.issuer_name || v.issuer}</div>
                      <AaveV4Inline v={v} />
                    </div>
                  </div>
                </td>
                <td className="py-2.5"><div className="flex items-center gap-2 text-fg whitespace-nowrap">{v.chain}<GroupChip group={v.group} /></div></td>
                <td className="py-2.5 text-right tabular-nums align-top pt-3">{v.state === 'filled' && <Figures v={v} best={v.key === bestKey} tied={tied.has(v.key)} />}</td>
                <td className="py-2.5 pl-4 text-right tabular-nums text-fg">{v.state === 'filled' && typeof v.tokens_per_1000 === 'number' ? v.tokens_per_1000.toFixed(4) : ''}</td>
                <td className="py-2.5 pl-4 text-right tabular-nums text-muted">{v.state === 'filled' ? bpsText(v.cost_bps) : ''}</td>
                <td className="py-2.5 pl-4 text-right tabular-nums text-muted">{typeof v.pool_usd === 'number' ? fmtUsd0(v.pool_usd) : ''}</td>
                <td className="py-2.5 pl-4 align-top pt-3"><StateCell v={v} size={size} /></td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button type="button" onClick={() => onSelect(v.key)} aria-pressed={on}
                    className="h-8 px-3 rounded text-[12px] font-semibold border border-line-strong text-fg hover:bg-inset">
                    Details
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
  const tied = new Set(tiedWithBest(data.versions, bestKey).map((x) => x.key));
  return (
    <Card pad={false}>
      <div className="px-4 pt-4 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-fg">Every version at {fmtUsd0(size)}</h2>
        <DevTag data={data} />
      </div>
      <TieNote data={data} size={size} />
      <ul className="mt-2 divide-y divide-line">
        {data.versions.map((v) => {
          const on = v.key === selected;
          const parts = v.state === 'filled' ? [tokensText(v.tokens_per_1000), bpsText(v.cost_bps), depthText(v.pool_usd)].filter(Boolean) : [];
          return (
            <li key={v.key} className={`px-4 py-3 ${on ? 'bg-inset/60' : ''}`}>
              <div className="flex items-start gap-3">
                <SymbolTile symbol={v.symbol} underlying={data.ticker} issuer={v.issuer} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-fg">{v.symbol}</div>
                  <div className="text-[12px] text-muted flex items-center gap-1.5 flex-wrap">{v.issuer_name || v.issuer} · {v.chain}<GroupChip group={v.group} /></div>
                </div>
                <div className="text-right tabular-nums text-[14px]">{v.state === 'filled' && <Figures v={v} best={v.key === bestKey} tied={tied.has(v.key)} />}</div>
              </div>
              <div className="pl-12 mt-1">
                {parts.length > 0 && <div className="text-[12px] text-muted">{parts.join(' · ')}</div>}
                <AaveV4Inline v={v} />
                <StateCell v={v} size={size} />
                <button type="button" onClick={() => onSelect(v.key)} aria-pressed={on}
                  className="mt-2 h-9 px-3 rounded text-[12px] font-semibold border border-line-strong text-fg">
                  Details
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

function SelectedVersion({ v, data, size, tab, onTab, ticker, onNavigate }) {
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
      <GlassTabs label={`${v.symbol}: details, buy or sell`} tabs={TABS} value={tab} onChange={onTab}>
        {tab === 'details' && (
          <div className="space-y-4">
            <Card>
              <CardTitle>Who may hold {v.symbol}</CardTitle>
              <div className="text-[13px] text-fg"><Eligibility e={elig} /></div>
              <p className="mt-2 text-[11px] text-muted">The issuer&apos;s own words, linked and dated. Shown, not enforced: Tnega does not check who you are.</p>
            </Card>
            {/* The same card /issuer-controls shows for ?token=, with the link to
                that token's row among every issuer's. */}
            <AaveV4Card v={v} borrow={data?.aave_v4_usdc_borrow} />
            <TokenControls data={controls.data} onNavigate={onNavigate}
              link={{ href: tokenLink(v.key), label: 'Compare with every issuer' }} />
          </div>
        )}
        {tab !== 'details' && <StockTrade v={v} ticker={ticker} side={tab} size={size} />}
      </GlassTabs>
    </div>
  );
}

export default function StockPage({ ticker, layout = 'web', onNavigate }) {
  const mobile = layout === 'mobile';
  const T = String(ticker || '').toUpperCase();
  const initial = useMemo(readQuery, []);
  const [size, setSize] = useState(() => snap(initial.usd));
  const [selected, setSelected] = useState(initial.v || null);
  const [tab, setTab] = useState(initial.tab);
  const u = useTe(DATA_LIVE && T ? `/api/te/underlying/${encodeURIComponent(T)}?size=${size}` : null, { keep: true });
  const curve = useTe(DATA_LIVE && T ? `/api/te/curve/${encodeURIComponent(T)}` : null).data;
  const data = u.data;
  const stops = hasRows(curve?.stops) ? curve.stops : STOPS;

  const versions = hasRows(data?.versions) ? data.versions : [];
  const current = versions.find((v) => v.key === selected) || versions.find((v) => v.key === data?.best?.key) || versions[0] || null;

  useEffect(() => { writeQuery(current?.key || selected, size, tab); }, [current?.key, selected, size, tab]);
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
          <SymbolTile underlying={T} />
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
          u.error === 'HTTP 404'
            ? <Card><p className="text-[13px] text-muted">No measured answer for {T} at {fmtUsd0(size)}.</p></Card>
            : <ReadError error={u.error} body={u.errorBody} what={`${T}'s versions`} />
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
          {current && !u.stale && <SelectedVersion key={current.key} v={current} data={data} size={size} tab={tab} onTab={setTab} ticker={T} onNavigate={onNavigate} />}
        </div>
      </div>
    </div>
  );
}
