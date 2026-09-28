// Home.jsx
//
// "/", following getquin.com's home (owner's reference, home-01 to home-11)
// with the launch film's content and order:
//   proof line, hero, product shot (the popular list, framed),
//   feature sections, alternating text and card: one stock many tokens (02),
//     every chain (03), the real cost (04), the buy (06), My ETFs (07),
//     vaults (08), issuer controls (09, a summary; the table is on
//     /issuer-controls), use with AI (13),
//   the live lists: tokenized ETFs, curated ETFs, vaults.
// The footer is the shell's. No reviews (there are no users yet) and nothing
// about agents above the footer.
//
// EVERY FIGURE IS A READ. A feature section renders only when its endpoint
// answers with the rows it needs (te/api.js). Two sections describe a flow
// rather than a read and have switches (home/sections.js). The film's
// numbers are never used: they are illustrations, not measurements.
// A link or button leads only to a page that is live (shell/productNav.js).
//
// One component for both apps; `layout` changes spacing and columns only.

import ReadError from '../te/ReadError';
import React, { useCallback, useState } from 'react';
import { Layers, Network, Gauge, PenLine, PieChart, ShieldCheck, Lock, Terminal, Search, Play } from 'lucide-react';
import { useTe, VAULT_LIST_HEADERS_MS } from '../te/api';
import { Eyebrow, PrimaryButton, SecondaryButton, DevTag } from '../ui/primitives';
import {
  VersionsCard, pricedCount, ChainsCard, CostCurveCard, BuyStepsCard, BasketCard,
  VaultChecksCard, AiCard, InstrumentList, VaultTable,
} from '../home/cards';
import { SECTION_LIVE, TOUR_VIDEO_URL, TOUR_POSTER_URL, FEATURE_TICKER } from '../home/sections';
import { isLive } from '../shell/productNav';
import { DATA_LIVE } from '../dataLive';
import TourModal from '../home/TourModal';
import ControlsSummary from '../controls/ControlsSummary';
import { platformKeyOf } from '../vaults/model';

// Film still 01's stocks, and vaults; each chip opens that stock's page (SPEC
// A.1 section 1), Vaults the vault list.
const CHIPS = ['NVDA', 'TSLA', 'SPY', 'QQQ', 'GLD'];

function Feature({ layout, icon, label, title, text, cta, card, flip }) {
  if (!card || !title) return null;
  const mobile = layout === 'mobile';
  return (
    <section className={mobile ? 'px-4 py-12' : 'py-24'}>
      <div className={mobile ? 'space-y-6' : 'grid grid-cols-2 gap-16 items-center'}>
        <div className={!mobile && flip ? 'order-2' : ''}>
          <Eyebrow icon={icon}>{label}</Eyebrow>
          <h2 className={`${mobile ? 'text-[32px]' : 'text-[44px]'} font-bold leading-[1.08] tracking-[-0.02em] text-fg max-w-[520px]`}>{title}</h2>
          {text && <p className="mt-5 text-[15px] leading-relaxed text-muted max-w-[460px]">{text}</p>}
          {cta && <div className="mt-7">{cta}</div>}
        </div>
        <div className={!mobile && flip ? 'order-1' : ''}>{card}</div>
      </div>
    </section>
  );
}

export default function Home({ layout = 'web', onNavigate }) {
  const mobile = layout === 'mobile';
  const go = (to) => onNavigate?.(to);
  const stocksLive = isLive('stocks');
  // A call to action only where its page is live.
  const cta = (id, label, to) => (isLive(id) ? <PrimaryButton onClick={() => go(to)}>{label}</PrimaryButton> : null);

  // Nothing is fetched until the endpoints serve real data (dataLive.js):
  // before then, the home is the hero and the footer, with no request that
  // can only fail.
  const te = (p) => (DATA_LIVE ? p : null);
  const summaryRead = useTe(te('/api/te/summary'));
  const summary = summaryRead.data;
  const versions = useTe(te(`/api/te/underlying/${FEATURE_TICKER}?size=1000`)).data;
  const curve = useTe(te(`/api/te/curve/${FEATURE_TICKER}`)).data;
  const baskets = useTe(te('/api/baskets/curated'));
  const vaults = useTe(te('/api/vaults?limit=4'), { headersTimeoutMs: VAULT_LIST_HEADERS_MS });
  const controls = useTe(te('/api/te/controls?by=issuer')).data;
  const [stockGroup, setStockGroup] = useState('all');
  const [etfGroup, setEtfGroup] = useState('all');
  const stocks = useTe(te(`/api/te/list?type=stock&group=${stockGroup}&limit=6&sort=popular`), { keep: true });
  const etfs = useTe(te(`/api/te/list?type=etf&group=${etfGroup}&limit=6&sort=popular`), { keep: true });
  const [q, setQ] = useState('');
  const [tour, setTour] = useState(false);
  const closeTour = useCallback(() => setTour(false), []);

  const counts = summary && [summary.issuers, summary.chains].every(Number.isFinite) ? summary : null;
  const k = pricedCount(versions);
  const firstBasket = baskets.data?.baskets?.[0];
  const wrap = mobile ? '' : 'max-w-[1040px] mx-auto';
  const openRow = stocksLive ? (r) => go(`/stocks/${encodeURIComponent(r.underlying)}`) : undefined;
  const seeAll = stocksLive ? () => go('/stocks') : undefined;

  // The proof line names only what is served, each part dropped when its
  // field is absent. summary.tokens is issuer-by-chain versions (most with
  // no pool), so it is never called "equities measured". A measured cost is
  // the cost engine's count (summary.cost.versions_with_cost: versions whose
  // best pool fills a $1,000 buy); without it, T2's versions_with_pool is
  // only a pool found, and says so.
  const measuredCost = summary?.cost?.versions_with_cost;
  const proof = summary ? [
    [summary.underlyings, 'stocks and ETFs'],
    Number.isFinite(measuredCost)
      ? [measuredCost, 'tokenized versions with a measured cost']
      : [summary.versions_with_pool, 'tokenized versions with a pool found'],
    [summary.issuers, 'issuers'],
    [summary.chains, 'chains'],
  ].filter(([n]) => Number.isFinite(n)).map(([n, label]) => [n.toLocaleString('en-US'), label]) : null;

  return (
    <div className={mobile ? '' : 'px-6'}>
      {/* HERO, home-01: the proof line (only with all three counts), a
          two-line headline, one line under it, search, Start now. */}
      <section className={`text-center ${mobile ? 'px-4 pt-10 pb-8' : 'pt-16 pb-12'}`}>
        {proof?.length > 0 && (
          <p className="text-[14px] text-muted flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            {proof.map(([n, label], i) => (
              <span key={label} className="inline-flex items-center gap-4">
                {i > 0 && <span aria-hidden="true" className="hidden sm:inline text-line-strong">|</span>}
                <span><span className="text-fg font-semibold tabular-nums">{n}</span> {label}</span>
              </span>
            ))}
            <DevTag data={summary} />
          </p>
        )}
        <h1 className={`${mobile ? 'text-[44px]' : 'text-[68px]'} mt-6 font-bold leading-[1.02] tracking-[-0.03em] text-fg`}>
          Wealth,<br />borderless.
        </h1>
        <p className={`mt-5 ${mobile ? 'text-[16px]' : 'text-[18px]'} text-muted max-w-[560px] mx-auto`}>
          Every tokenized equity, and what it really costs to buy.
        </p>
        {stocksLive && (
          <>
            <form
              role="search"
              onSubmit={(e) => { e.preventDefault(); go(q.trim() ? `/stocks?q=${encodeURIComponent(q.trim())}` : '/stocks'); }}
              className="mt-8 mx-auto max-w-[520px] h-11 flex items-center gap-2 px-3.5 rounded bg-field text-fg border border-line-strong focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-page"
            >
              <Search size={17} className="text-muted shrink-0" aria-hidden="true" />
              <input
                type="search" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search a stock or ETF" aria-label="Search a stock or ETF"
                className="flex-1 min-w-0 bg-transparent text-[14px] placeholder:text-muted outline-none"
              />
            </form>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {CHIPS.map((t) => (
                <button key={t} type="button" onClick={() => go(`/stocks/${t}`)} className="h-8 px-3 rounded border border-line-strong text-[12px] font-semibold text-fg hover:bg-inset">{t}</button>
              ))}
              {isLive('vaults') && <button type="button" onClick={() => go('/vaults')} className="h-8 px-3 rounded border border-line-strong text-[12px] font-semibold text-fg hover:bg-inset">Vaults</button>}
            </div>
          </>
        )}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <PrimaryButton onClick={() => go(stocksLive ? '/stocks' : '/signin')}>Start now</PrimaryButton>
          {TOUR_VIDEO_URL && (
            <SecondaryButton onClick={() => setTour(true)}><Play size={14} aria-hidden="true" />Watch the tour</SecondaryButton>
          )}
        </div>
      </section>

      {/* PRODUCT SHOT, home-02: the live popular list, framed. It is the
          page's popular-stocks list; nothing below repeats it. */}
      {(stocks.data || (stocks.error && stocks.ever)) && (
        <section className={mobile ? 'px-4 pb-6' : `${wrap} pb-8`}>
          <div className={mobile ? '' : 'rounded border border-line bg-page p-4'}>
            <InstrumentList title="Tokenized stocks" state={stocks} group={stockGroup} onGroup={setStockGroup} onOpen={openRow} onSeeAll={seeAll} compact={mobile} universe={summary?.underlyings} />
          </div>
        </section>
      )}

      {/* The features below draw only with data; when the service cannot be
          read they would all vanish without a word, so one notice says so. */}
      {!summary && summaryRead.error && (
        <div className={`${wrap} ${mobile ? 'px-4' : ''} mb-6`}>
          <ReadError error={summaryRead.error} body={summaryRead.errorBody} what="the live counts, costs, lists and vaults on this page" />
        </div>
      )}
      <div className={wrap}>
        <Feature layout={layout} icon={Layers} label="One stock, many tokens"
          title={k > 1 ? `${k} tokens. ${k} different bills.` : null}
          text="The same share, issued as separate tokens by different issuers on different chains. Here is what $1,000 of each costs to buy."
          cta={cta('stocks', 'See every version', `/stocks/${FEATURE_TICKER}`)}
          card={k > 1 ? <VersionsCard data={versions} /> : null} />

        <Feature layout={layout} icon={Network} label="EVM and non-EVM" flip
          title="Every issuer. Every chain. One screen."
          text={counts ? `${counts.issuers} issuers on ${counts.chains} chains, grouped EVM and non-EVM, in one list.` : ''}
          cta={cta('stocks', 'Browse the list', '/stocks')}
          card={counts ? <ChainsCard data={summary} /> : null} />

        <Feature layout={layout} icon={Gauge} label="The real cost"
          title="The price you see isn't the price you pay."
          text="Spread, slippage, depth and fees, measured on the pools at your order size."
          cta={cta('stocks', 'Try your size', `/stocks/${FEATURE_TICKER}?usd=10000`)}
          card={curve?.chains?.length ? <CostCurveCard data={curve} /> : null} />

        {SECTION_LIVE.buy && (
          <Feature layout={layout} icon={PenLine} label="Buy" flip
            title="No account. Your wallet signs."
            text="Tnega finds the route. Your wallet signs an approval for the exact amount, then one signature for the swap. Your funds never pass through us."
            cta={cta('stocks', 'Pick a stock', '/stocks')}
            card={<BuyStepsCard />} />
        )}

        <Feature layout={layout} icon={PieChart} label="My ETFs"
          title="Your ETF. Your rules. No fee from us."
          text="Up to five stocks, your weights, one shareable link, sized to real liquidity."
          cta={cta('my-etfs', 'Build one', '/my-etfs#build')}
          card={firstBasket ? <BasketCard basket={firstBasket} source={baskets.data} /> : null} />

        <Feature layout={layout} icon={ShieldCheck} label="Vaults" flip
          title="Vaults, checked on chain before you trust them."
          text="Who controls the money, what it lends and against what, read on chain."
          cta={cta('vaults', 'See the vaults', '/vaults')}
          card={vaults.data?.vaults?.length ? <VaultChecksCard data={vaults.data} /> : null} />

        <Feature layout={layout} icon={Lock} label="Issuer controls"
          title="Who can freeze your stock? Now you know."
          text="Pause, freeze, burn, upgrade and who may hold it, for every token we list."
          cta={isLive('issuer-controls') ? (
            <PrimaryButton as="a" href="/issuer-controls" onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault(); go('/issuer-controls');
            }}>Check a token</PrimaryButton>
          ) : null}
          card={controls?.rows?.length ? <ControlsSummary data={controls} onOpen={isLive('issuer-controls') ? go : undefined} /> : null} />

        {SECTION_LIVE.ai && (
          <Feature layout={layout} icon={Terminal} label="Use with AI" flip
            title="Your AI asks Tnega. You sign."
            text="Point your assistant at Tnega's MCP server. It can search, measure the cost and build a basket. Every buy opens in your wallet."
            cta={cta('ai', 'Connect your AI', '/ai')}
            card={<AiCard />} />
        )}

        {/* THE LIVE LISTS. Each keeps its card on an empty filter and says so
            when its read failed (home/cards.jsx). */}
        {(etfs.data || baskets.data || vaults.data || ((etfs.error && etfs.ever) || (baskets.error && baskets.ever) || (vaults.error && vaults.ever))) && (
          <section className={mobile ? 'px-4 py-10 space-y-4' : 'py-20 space-y-6'}>
            {/* "Live now" only over lists that answered; a failed read is
                not live. */}
            {(etfs.data?.rows?.length || baskets.data?.baskets?.length || vaults.data?.vaults?.length) ? (
              <h2 className={`${mobile ? 'text-[28px]' : 'text-[40px]'} font-bold tracking-[-0.02em] text-fg`}>Live now</h2>
            ) : null}
            <InstrumentList title="Tokenized ETFs" state={etfs} group={etfGroup} onGroup={setEtfGroup} onOpen={openRow} onSeeAll={seeAll} compact={mobile} universe={summary?.underlyings} />
            {baskets.data?.baskets?.length > 0 ? (
              <div>
                <h3 className="text-[15px] font-semibold text-fg mb-3">Curated ETFs</h3>
                <div className={mobile ? 'space-y-3' : 'grid grid-cols-3 gap-4'}>
                  {baskets.data.baskets.slice(0, 3).map((b) => (
                    <BasketCard key={b.code || b.name} basket={b} source={baskets.data} onOpen={isLive('my-etfs') ? () => go(`/my-etfs/${encodeURIComponent(b.code)}`) : undefined} />
                  ))}
                </div>
              </div>
            ) : baskets.error && baskets.ever ? (
              <div className="bg-surface border border-line rounded p-4">
                <h3 className="text-[15px] font-semibold text-fg">Curated ETFs</h3>
                <p className="mt-3 text-[13px] text-muted">Couldn&apos;t read the baskets. Try again later.</p>
              </div>
            ) : null}
            <VaultTable state={vaults} compact={mobile} onOpen={isLive('vaults') ? (v) => go(`/vaults/${platformKeyOf(v)}/${v.address}`) : undefined} />
          </section>
        )}
      </div>

      {tour && TOUR_VIDEO_URL && <TourModal src={TOUR_VIDEO_URL} poster={TOUR_POSTER_URL} onClose={closeTour} />}
    </div>
  );
}
