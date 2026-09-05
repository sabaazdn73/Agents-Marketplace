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

import React, { useState } from 'react';
import { useChainViewIndex } from './useChainView';
import { ChainMark } from './chainMarks';
import EthereumView from './EthereumView';
import SolanaView from './SolanaView';
import MultiChainView from './MultiChainView';

const VIEW_COMPONENTS = {
  ethereum: EthereumView,
  solana: SolanaView,
  multichain: MultiChainView,
};

export default function ChainViewTabs({ mutedBorder, children }) {
  const [active, setActive] = useState('bnb');
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
          horizontal padding, the text size and the count chip, so the strip
          gets narrower and more tabs fit without the target getting
          smaller. On md+ it relaxes back to comfortable desktop spacing. */}
      <div className="flex gap-1 sm:gap-1.5 overflow-x-auto hide-scrollbar mb-3 sm:mb-4 -mx-1 px-1">
        {tabs.map((t) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              aria-pressed={on}
              className={`shrink-0 flex items-center gap-1.5 min-h-11 px-2.5 sm:px-3.5 rounded-xl text-[13px] sm:text-sm font-semibold border transition-colors ${on
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}
            >
              <ChainMark viewId={t.id} size={13} />
              {t.label}
              {t.count != null && (
                <span className="hidden sm:inline text-[10px] font-medium opacity-60">
                  {t.count.toLocaleString()}
                </span>
              )}
              {t.coming_soon && (
                <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-500">
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
