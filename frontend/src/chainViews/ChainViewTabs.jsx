// ChainViewTabs.jsx
//
// The one integration point between the chain views and the existing
// marketplace. Everything else about these views lives in its own module.
//
// Deliberately shaped so the host renders BSC exactly as it always has.
// This component does NOT own the BNB view: it renders the tab strip, and
// when the active tab is `bnb` it renders `children` (the existing,
// heavily-debugged BSC marketplace) untouched. That keeps the working path
// working by construction rather than by care, which was the explicit
// requirement -- add alongside, do not restructure what already works.
//
// Web and mobile both use this, so a chain view cannot silently exist on
// one and not the other.

import React, { useState, useEffect } from 'react';
import { useChainViewIndex } from './useChainView';
import { ChainMark } from './chainMarks';
import EthereumView from './EthereumView';
import SolanaView from './SolanaView';
import HyperliquidView from './HyperliquidView';
import ArbitrumView from './ArbitrumView';
import RobinhoodView from './RobinhoodView';
import MonadView from './MonadView';

// Which tab owns a given chain id. Needed so that landing directly on an
// agent's own URL opens that agent's chain rather than the default tab.
//
// Bug found in the browser 2026-09-10: /chain-agent/42161/734 opened the BNB
// tab. The route was read inside HireableChainView, which only mounts once
// its tab is active, so on a cold load nothing ever looked at the URL and the
// agent page could not survive a refresh. The lesson is that the tab strip is
// part of the routing, not just a control above it.
const CHAIN_TO_VIEW = {
  42161: 'arbitrum',
  4663: 'robinhood',
};

// Drawn before the index arrives. Order matches core/chain_views.py's VIEWS,
// which is what the backend returns; a mismatch would make the strip reorder
// itself as it loads.
const FALLBACK_TABS = [
  { id: 'hyperliquid', label: 'Hyperliquid', count: null, coming_soon: false, kind: 'venue' },
  { id: 'bnb', label: 'BNB Chain', count: null, coming_soon: false },
  { id: 'ethereum', label: 'Ethereum', count: null, coming_soon: false },
  { id: 'solana', label: 'Solana', count: null, coming_soon: true },
  { id: 'arbitrum', label: 'Arbitrum', count: null, coming_soon: false },
  { id: 'robinhood', label: 'Robinhood Chain', count: null, coming_soon: false },
  { id: 'monad', label: 'Monad', count: null, coming_soon: false },
];

// Two shapes of URL can decide which tab opens.
//
// /chain-agent/<chainId>/<id> is one agent's own page and names its chain by
// number, which is the case the comment above CHAIN_TO_VIEW describes.
//
// /chain/<view> names a view directly. That is what an outside link needs: the
// Chrome extension's panel sits on one Hyperliquid address and its footer
// points here, so a reader can see that address next to the rest of the
// tracked set. Without it the tab had no address at all and could only be
// reached by clicking it.
//
// Unknown view ids are ignored rather than trusted, and App.jsx already
// resolves any path it does not recognise to the marketplace, so a stale or
// mistyped link lands on the marketplace instead of on nothing.
function viewFromLocation() {
  const path = window.location.pathname;
  const direct = path.match(/^\/chain\/([a-z-]+)\/?$/);
  if (direct && FALLBACK_TABS.some((t) => t.id === direct[1])) return direct[1];
  const m = path.match(/^\/chain-agent\/(\d+)\//);
  return m ? CHAIN_TO_VIEW[Number(m[1])] || null : null;
}

const VIEW_COMPONENTS = {
  ethereum: EthereumView,
  // First tab. Not a registry view: see HyperliquidView's own header for
  // why it renders its own component instead of an agent grid.
  hyperliquid: HyperliquidView,
  solana: SolanaView,
  arbitrum: ArbitrumView,
  robinhood: RobinhoodView,
  monad: MonadView,
};

// Shorter labels for narrow screens. Only where the full label is long
// enough to cost a meaningful share of the strip: the width problem with
// six tabs is mostly label text, not padding, so trimming two long names
// buys more room than tightening every tab would. The full label is still
// rendered from sm up, and the accessible name is always the full one.
const SHORT_LABELS = {
  robinhood: 'Robinhood',
};

// Counts are context, not the point of the tab, so they are rendered
// compactly: "155K" rather than "154,695". Six exact counts cost roughly a
// fifth of the strip's width for digits nobody reads at a glance, and the
// exact figure is on the view itself once a tab is open.
const compactCount = (n) =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export default function ChainViewTabs({ mutedBorder, children }) {
  const [active, setActive] = useState(() => viewFromLocation() || 'bnb');

  // Keep the tab in step with back/forward, so returning to an agent's URL
  // reopens its chain rather than leaving the strip pointing elsewhere.
  useEffect(() => {
    const onPop = () => {
      const v = viewFromLocation();
      if (v) setActive(v);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const { views, loading } = useChainViewIndex();

  // Until the index loads, render the known chains without their counts. The
  // marketplace must never be gated on a call that only exists to draw extra
  // tabs, which is why there is a fallback at all.
  //
  // It used to fall back to BNB Chain alone, and that was wrong in a way that
  // cost a bug report. The backend is OOM-killed roughly every two hours
  // (docs/memory-ceiling.md) and cold-starts afterwards, so this branch is
  // reached often, not rarely. During it every other chain vanished from the
  // strip and the page looked like a deploy that had lost six tabs. A reader
  // cannot tell that state apart from a broken release.
  //
  // The ids and labels are static and already known to the client; only the
  // counts and the hire flags come from the backend. So the fallback now
  // draws the full strip and omits what it does not yet know, which degrades
  // to a missing count rather than to a missing chain.
  const tabs = loading || !views.length ? FALLBACK_TABS : views;

  const Active = VIEW_COMPONENTS[active];

  return (
    <div>
      {/* Sizing note. The tabs were too large on phones, but the tap area
          cannot simply shrink: 44x44pt (iOS HIG) / 48x48dp (Android) is the
          floor. Those pull against each other, so this is solved with
          layout rather than by undercutting the minimum.

          The button keeps min-h-11 (44px) at every breakpoint -- the tap
          area is never reduced. What shrinks on small screens is the
          horizontal padding, the text size, the mark, the count chip and
          two of the labels, so the strip gets narrower and more tabs fit
          without the target getting smaller. On md+ it relaxes back to
          comfortable desktop spacing.

          Tightened again 2026-09-10 when Arbitrum and Robinhood Chain took
          their own tabs and the strip went from four to six. The count moved
          from sm+ to md+ and the Soon chip to sm+, because on a phone those
          two are the least useful characters in the strip and the most
          expensive: the chain name is what a person is looking for. */}
      {/* Scrolls on a phone, wraps from sm up. Six tabs do not fit one row
          at every desktop width either, and a clipped last tab reads as
          broken rather than as scrollable, so above the phone breakpoint
          the strip wraps to a second row instead of running off the edge.
          Both behaviours keep the 44px target untouched. */}
      <div className="flex gap-1 sm:gap-1.5 overflow-x-auto sm:overflow-visible sm:flex-wrap hide-scrollbar mb-3 sm:mb-4 -mx-1 px-1">
        {tabs.map((t) => {
          const on = active === t.id;
          const short = SHORT_LABELS[t.id];
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              aria-pressed={on}
              // The accessible name stays the full label even where the
              // visible text is shortened, so the tab is announced as
              // "Robinhood Chain" rather than "Robinhood".
              aria-label={t.label}
              className={`shrink-0 flex items-center gap-1 sm:gap-1.5 min-h-11 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-semibold border transition-colors ${on
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}
            >
              <ChainMark viewId={t.id} size={12} />
              {short ? (
                <>
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                </>
              ) : t.label}
              {/* A venue view has no agent registry, so its count is structurally
                  zero. Rendering 0 next to Hyperliquid would read as an empty
                  chain rather than a different kind of tab. */}
              {t.count != null && t.kind !== 'venue' && (
                <span className="hidden md:inline text-[10px] font-medium opacity-60">
                  {compactCount(t.count)}
                </span>
              )}
              {t.coming_soon && (
                <span className="hidden sm:inline text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-500">
                  Soon
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active === 'bnb' ? children : (Active ? <Active mutedBorder={mutedBorder} /> : children)}
    </div>
  );
}
