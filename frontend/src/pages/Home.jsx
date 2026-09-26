// Home.jsx
//
// "/", following getquin.com's home (owner's reference, home-01 to home-11)
// with the launch film's content and order:
//   proof line, hero, product shot,
//   feature sections, alternating text and card: one stock many tokens (02),
//     every chain (03), the real cost (04), one signature (06), My ETFs (07),
//     vaults (08), issuer controls (09), use with AI (13),
//   the live lists: popular stocks, ETFs, curated ETFs, vaults.
// The footer is the shell's. No reviews (there are no users yet) and nothing
// about agents above the footer.
//
// EVERY FIGURE IS A READ. A section renders only when its endpoint answers
// with the rows it needs (te/api.js); two that describe a flow rather than
// a read have switches in home/sections.js. The film's numbers are never
// used: they are illustrations, not measurements.
//
// One component for both apps; `layout` changes spacing and columns only.

import React, { useCallback, useState } from 'react';
import { Layers, Network, Gauge, PenLine, PieChart, ShieldCheck, Lock, Terminal, Search, Play } from 'lucide-react';
import { useTe } from '../te/api';
import { Eyebrow, PrimaryButton, SecondaryButton, DevTag } from '../ui/primitives';
import {
  VersionsCard, ChainsCard, CostCurveCard, BuyStepsCard, BasketCard,
  VaultChecksCard, ControlsCard, AiCard, InstrumentList, VaultTable,
} from '../home/cards';
import { SECTION_LIVE, TOUR_VIDEO_URL, TOUR_POSTER_URL } from '../home/sections';
import TourModal from '../home/TourModal';

const FEATURE_TICKER = 'NVDA';

function Feature({ layout, icon, label, title, text, cta, card, flip }) {
  if (!card) return null;
  const mobile = layout === 'mobile';
  return (
    <section className={mobile ? 'px-4 py-12' : 'py-24'}>
      <div className={mobile ? 'space-y-6' : 'grid grid-cols-2 gap-16 items-center'}>
        <div className={!mobile && flip ? 'order-2' : ''}>
          <Eyebrow icon={icon}>{label}</Eyebrow>
          <h2 className={`${mobile ? 'text-[32px]' : 'text-[44px]'} font-bold leading-[1.08] tracking-[-0.02em] text-fg max-w-[520px]`}>{title}</h2>
          <p className="mt-5 text-[15px] leading-relaxed text-muted max-w-[460px]">{text}</p>
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
  const summary = useTe('/api/te/summary').data;
  const versions = useTe(`/api/te/underlying/${FEATURE_TICKER}?size=1000`).data;
  const curve = useTe(`/api/te/curve/${FEATURE_TICKER}`).data;
  const baskets = useTe('/api/baskets/curated').data;
  const vaults = useTe('/api/vaults?limit=4').data;
  const controls = useTe('/api/te/controls?by=issuer').data;
  const [stockGroup, setStockGroup] = useState('all');
  const [etfGroup, setEtfGroup] = useState('all');
  const stocks = useTe(`/api/te/list?type=stock&group=${stockGroup}&limit=6&sort=popular`).data;
  const etfs = useTe(`/api/te/list?type=etf&group=${etfGroup}&limit=6&sort=popular`).data;
  const [q, setQ] = useState('');
  const [tour, setTour] = useState(false);
  const closeTour = useCallback(() => setTour(false), []);

  const counts = summary && [summary.tokens, summary.issuers, summary.chains].every(Number.isFinite) ? summary : null;
  const k = versions?.versions?.length;
  const firstBasket = baskets?.baskets?.[0];
  const wrap = mobile ? '' : 'max-w-[1040px] mx-auto';
  const openRow = (r) => go(`/stocks?q=${encodeURIComponent(r.underlying)}`);

  return (
    <div className={mobile ? '' : 'px-6'}>
      {/* HERO, home-01. The proof line renders only with all three counts. */}
      <section className={`text-center ${mobile ? 'px-4 pt-10 pb-8' : 'pt-16 pb-12'}`}>
        {counts && (
          <p className="text-[14px] text-muted flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span><span className="text-fg font-semibold tabular-nums">{counts.tokens.toLocaleString('en-US')}</span> tokenized equities measured</span>
            <span aria-hidden="true" className="text-line-strong">|</span>
            <span><span className="text-fg font-semibold tabular-nums">{counts.issuers}</span> issuers</span>
            <span aria-hidden="true" className="text-line-strong">|</span>
            <span><span className="text-fg font-semibold tabular-nums">{counts.chains}</span> chains</span>
            <DevTag data={summary} />
          </p>
        )}
        <h1 className={`${mobile ? 'text-[40px]' : 'text-[64px]'} mt-6 font-bold leading-[1.02] tracking-[-0.03em] text-fg`}>
          Wealth, borderless.
        </h1>
        <p className={`mt-5 ${mobile ? 'text-[16px]' : 'text-[18px]'} text-muted max-w-[560px] mx-auto`}>
          Every tokenized equity, and what it really costs to buy.
        </p>
        <form
          role="search"
          onSubmit={(e) => { e.preventDefault(); go(q.trim() ? `/stocks?q=${encodeURIComponent(q.trim())}` : '/stocks'); }}
          className="mt-8 mx-auto max-w-[520px] h-11 flex items-center gap-2 px-3.5 rounded bg-field text-fg"
        >
          <Search size={17} className="text-muted shrink-0" aria-hidden="true" />
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search a stock, ETF or vault" aria-label="Search a stock, ETF or vault"
            className="flex-1 min-w-0 bg-transparent text-[14px] placeholder:text-muted outline-none"
          />
        </form>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <PrimaryButton onClick={() => go('/stocks')}>Start</PrimaryButton>
          {TOUR_VIDEO_URL && (
            <SecondaryButton onClick={() => setTour(true)}><Play size={14} aria-hidden="true" />Watch the tour</SecondaryButton>
          )}
        </div>
      </section>

      {/* PRODUCT SHOT, home-02: the real lists and the real cost card, framed.
          Renders only when both have data. */}
      {stocks?.rows?.length > 0 && versions?.versions?.length > 0 && (
        <section className={mobile ? 'px-4 pb-6' : `${wrap} pb-8`}>
          <div className={mobile ? '' : 'rounded-md border border-line bg-page p-4'}>
            <div className={mobile ? 'space-y-3' : 'grid grid-cols-12 gap-4'}>
              <div className={mobile ? '' : 'col-span-8'}><InstrumentList title="Popular tokenized stocks" data={stocks} compact /></div>
              <div className={mobile ? '' : 'col-span-4'}><VersionsCard data={versions} compact /></div>
            </div>
          </div>
        </section>
      )}

      <div className={wrap}>
        <Feature layout={layout} icon={Layers} label="One stock, many tokens"
          title={k > 1 ? `${k} tokens. ${k} different bills.` : null}
          text="The same share, issued as separate tokens by different issuers on different chains. Here is what $1,000 of each costs to buy."
          cta={<PrimaryButton onClick={() => go(`/stocks?q=${FEATURE_TICKER}`)}>See every version</PrimaryButton>}
          card={k > 1 ? <VersionsCard data={versions} /> : null} />

        <Feature layout={layout} icon={Network} label="EVM and non-EVM" flip
          title="Every issuer. Every chain. One screen."
          text={counts ? `${counts.issuers} issuers on ${counts.chains} chains, grouped EVM and non-EVM, in one list.` : ''}
          cta={<PrimaryButton onClick={() => go('/stocks')}>Browse the list</PrimaryButton>}
          card={counts ? <ChainsCard data={summary} /> : null} />

        <Feature layout={layout} icon={Gauge} label="The real cost"
          title="The price you see isn't the price you pay."
          text="Spread, slippage, depth and fees, measured on the pools at your order size."
          cta={<PrimaryButton onClick={() => go(`/stocks?q=${FEATURE_TICKER}`)}>Try your size</PrimaryButton>}
          card={curve?.chains?.length ? <CostCurveCard data={curve} /> : null} />

        {SECTION_LIVE.buy && (
          <Feature layout={layout} icon={PenLine} label="Buy" flip
            title="No account. One signature."
            text="Tnega finds the route. Your wallet signs. Your funds never pass through us."
            cta={<PrimaryButton onClick={() => go('/stocks')}>Pick a stock</PrimaryButton>}
            card={<BuyStepsCard />} />
        )}

        <Feature layout={layout} icon={PieChart} label="My ETFs"
          title="Your ETF. Your rules. No fee from us."
          text="Up to five stocks, your weights, one shareable link, sized to real liquidity."
          cta={<PrimaryButton onClick={() => go('/my-etfs')}>Build one</PrimaryButton>}
          card={firstBasket ? <BasketCard basket={firstBasket} source={baskets} /> : null} />

        <Feature layout={layout} icon={ShieldCheck} label="Vaults" flip
          title="Vaults, checked on chain before you trust them."
          text="Who controls the money and what it holds, read on chain."
          cta={<PrimaryButton onClick={() => go('/vaults')}>See the vaults</PrimaryButton>}
          card={vaults?.vaults?.length ? <VaultChecksCard data={vaults} /> : null} />

        <Feature layout={layout} icon={Lock} label="Issuer controls"
          title="Who can freeze your stock? Now you know."
          text="Pause, freeze, burn, upgrade and who may hold it, for every token we list."
          cta={<PrimaryButton onClick={() => go('/stocks')}>Check a token</PrimaryButton>}
          card={controls?.rows?.length ? <ControlsCard data={controls} compact={mobile} /> : null} />

        {SECTION_LIVE.ai && (
          <Feature layout={layout} icon={Terminal} label="Use with AI" flip
            title="Your AI asks Tnega. You sign."
            text="Point your assistant at Tnega's MCP server. It can search, measure the cost and build a basket. Every buy opens in your wallet."
            cta={<PrimaryButton onClick={() => go('/ai')}>Connect your AI</PrimaryButton>}
            card={<AiCard />} />
        )}

        {/* THE LIVE LISTS. Each renders only with rows. */}
        {(stocks?.rows?.length || etfs?.rows?.length || baskets?.baskets?.length || vaults?.vaults?.length) ? (
          <section className={mobile ? 'px-4 py-10 space-y-4' : 'py-20 space-y-6'}>
            <h2 className={`${mobile ? 'text-[28px]' : 'text-[40px]'} font-bold tracking-[-0.02em] text-fg`}>Live now</h2>
            <InstrumentList title="Popular tokenized stocks" data={stocks} group={stockGroup} onGroup={setStockGroup} onOpen={openRow} onSeeAll={() => go('/stocks')} compact={mobile} />
            <InstrumentList title="Tokenized ETFs" data={etfs} group={etfGroup} onGroup={setEtfGroup} onOpen={openRow} onSeeAll={() => go('/stocks')} compact={mobile} />
            {baskets?.baskets?.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[15px] font-semibold text-fg">Curated ETFs</h3>
                  {baskets.note && <span className="text-[12px] text-muted">{baskets.note}</span>}
                </div>
                <div className={mobile ? 'space-y-3' : 'grid grid-cols-3 gap-4'}>
                  {baskets.baskets.slice(0, 3).map((b) => <BasketCard key={b.code || b.name} basket={b} source={baskets} onOpen={() => go(`/my-etfs?b=${encodeURIComponent(b.code)}`)} />)}
                </div>
              </div>
            )}
            <VaultTable data={vaults} compact={mobile} />
          </section>
        ) : null}
      </div>

      {tour && TOUR_VIDEO_URL && <TourModal src={TOUR_VIDEO_URL} poster={TOUR_POSTER_URL} onClose={closeTour} />}
    </div>
  );
}
