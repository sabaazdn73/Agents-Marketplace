// ChainChooser.jsx
//
// The first screen of the marketplace: which chain, before which agent.
//
// WHY THIS IS NOT A TAB STRIP WITH BIGGER BUTTONS
// The chain tabs above the listing are a control for changing your mind. They
// are small, they sit in a row, and they are drawn to be ignored once you are
// reading the grid, which is right for what they do. Picking a chain in the
// first place is a different act: it decides what the whole page is about, and
// the chains are not interchangeable. Two of them cannot be hired on at all,
// one is not an agent registry, and their sizes differ by four orders of
// magnitude. A strip of eight equal chips says none of that.
//
// So each chain gets a card carrying the two things that actually separate
// them: how many agents are there, and what you can do with one. That is the
// information a person needs to make the choice, and it is already in
// /api/chain-views, which the strip was throwing away.
//
// NOTHING BELOW CHANGES THE EXISTING LAYOUT
// This renders instead of the strip-and-view, once, and then gets out of the
// way permanently. ChainViewTabs is untouched in every other respect, which
// matters because the BNB path through it is the original marketplace.

import React from 'react';
import { ChainMark } from './chainMarks';

// What you can do on a chain once you are there, from the hire_paths the
// index already publishes. Ordered from most to least capable so the phrasing
// degrades rather than branching.
function capability(view) {
  if (view.kind === 'venue') {
    return 'Order-book measurements, not an agent registry';
  }
  // No coming_soon branch. It used to read "Indexing not started here yet",
  // which the browser showed sitting directly under "1,490 agents" on Solana:
  // the flag means hiring is not wired up there, not that nothing is indexed.
  // The Soon chip in the corner already carries the flag, and the line below
  // describes what you can do, which is the thing the flag is actually about.
  //
  // NOT LOADED IS NOT "NO HIRING PATH", caught in the browser 2026-09-19.
  //
  // ChainViewTabs falls back to a static list while the index loads, and that
  // list carries ids and labels only. Reading a missing hire_paths as an empty
  // one made every card say "no hiring path here yet", including BNB Chain,
  // which is the one chain where both paths work. The backend cold-starts
  // often, so that was not a rare frame: it was the first thing a visitor saw
  // whenever the index was slow, and it was false about every chain at once.
  //
  // An absent field says nothing here, and the card omits the line.
  const paths = view.hire_paths;
  if (!paths) return null;
  const budget = paths.budget && paths.budget.available;
  const escrow = paths.escrow && paths.escrow.available;
  if (budget && escrow) return 'Hire by escrow or from a funded budget';
  if (budget) return 'Hire from a funded budget';
  if (escrow) return 'Hire with payment held in escrow';
  return 'Browse and verify; no hiring path here yet';
}

function countLabel(view) {
  if (view.kind === 'venue') return null;
  if (view.count == null) return null;
  if (view.count === 0) return view.coming_soon ? null : 'No agents indexed';
  return `${view.count.toLocaleString()} agent${view.count === 1 ? '' : 's'}`;
}

export default function ChainChooser({ views, onChoose, onSkip, skipLabel }) {
  return (
    <div className="py-2 sm:py-6">
      <div className="max-w-3xl">
        <h2 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          Which chain?
        </h2>
        <p className="text-[13px] sm:text-sm leading-relaxed text-gray-600 dark:text-gray-400 mt-1.5">
          Agents are registered per chain, and what you can do with one depends on
          where it lives. Pick where to look and the rest of the page follows. You
          can change it at any time from the row of tabs that replaces this.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3 mt-4 sm:mt-6">
        {views.map((v) => {
          const count = countLabel(v);
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onChoose(v.id)}
              // The whole card is the target, so the tap area is the card and
              // there is no minimum to argue about. text-left because a card
              // of centred sentences reads as a poster rather than a list of
              // options.
              className="group text-left rounded-2xl border border-gray-200 dark:border-gray-800
                         bg-white dark:bg-white/[0.02] p-3.5 sm:p-4
                         hover:border-indigo-400 dark:hover:border-indigo-500/60
                         hover:bg-indigo-50/40 dark:hover:bg-indigo-500/[0.06]
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
                         transition-colors"
            >
              <div className="flex items-center gap-2">
                <ChainMark viewId={v.id} size={18} />
                <span className="text-[15px] font-bold text-gray-900 dark:text-gray-100 truncate">
                  {v.label}
                </span>
                {v.coming_soon && (
                  <span className="ml-auto shrink-0 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-500">
                    Soon
                  </span>
                )}
              </div>
              {count && (
                <div className="text-[13px] font-semibold tabular-nums text-gray-700 dark:text-gray-300 mt-2">
                  {count}
                </div>
              )}
              {capability(v) && (
                <div className="text-[12px] leading-snug text-gray-500 dark:text-gray-400 mt-1">
                  {capability(v)}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* The way out for someone who did not come here to choose. A person who
          does not know the chains cannot make this decision, and making them
          guess before seeing anything would be worse than the filter this
          replaces. */}
      <button
        type="button"
        onClick={onSkip}
        className="mt-4 sm:mt-5 text-[12px] text-gray-500 dark:text-gray-400 underline underline-offset-2 hover:text-gray-700 dark:hover:text-gray-200"
      >
        {skipLabel}
      </button>
    </div>
  );
}
