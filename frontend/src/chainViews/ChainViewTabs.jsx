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
import ArbitrumView from './ArbitrumView';
import RobinhoodView from './RobinhoodView';
import MultiChainView from './MultiChainView';

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

function viewFromLocation() {
  const m = window.location.pathname.match(/^\/chain-agent\/(\d+)\//);
  return m ? CHAIN_TO_VIEW[Number(m[1])] || null : null;
}

const VIEW_COMPONENTS = {
  ethereum: EthereumView,
  solana: SolanaView,
  arbitrum: ArbitrumView,
  robinhood: RobinhoodView,
  multichain: MultiChainView,
};

// Shorter labels for narrow screens. Only where the full label is long
// enough to cost a meaningful share of the strip: the width problem with
// six tabs is mostly label text, not padding, so trimming two long names
// buys more room than tightening every tab would. The full label is still
// rendered from sm up, and the accessible name is always the full one.
const SHORT_LABELS = {
  robinhood: 'Robinhood',
  multichain: 'Multi',
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

  // Until the index loads, render BSC alone. The marketplace must never be
  // gated on a call that only exists to draw extra tabs.
  const tabs = loading || !views.length
    ? [{ id: 'bnb', label: 'BNB Chain', count: null, coming_soon: false }]
    : views;

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
              {t.count != null && (
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
