// HireableChainView.jsx
//
// The page layout a chain gets once its agents can actually be hired.
//
// There are two chain themes and the difference between them is meant to be
// visible. A read-only chain is a listing: thin cards, no action, and an
// open-ended "load more" that suits browsing a set nobody is going to act on.
// A hireable chain is a marketplace, so it takes the BNB Chain shape: the
// full card with an action on it, a count of what you are looking at, and
// numbered pages.
//
// Numbered pages rather than "load more" is the part that carries the most
// meaning. "Load more" is a browsing control; it has no sense of position and
// no end. Once someone is choosing an agent to pay, being able to say "page 7
// of 59" and come back to it is the difference between a catalogue and a feed.
//
// Adding the next hireable chain should mean adding it to
// chainContracts.js and letting the backend report budget hiring for it. This
// component is not chain-specific and takes no per-chain branches.

import React, { useEffect, useState } from 'react';
import Pagination from '../Pagination';
import HireableAgentCard from '../HireableAgentCard';
import { normalizeChainAgents } from './normalizeChainAgent';
import { ChainCapabilities, ChainViewStates, EXPLORER_BASE } from './ChainViewShared';
import ChainAgentDetail, { chainAgentPath, readChainAgentRoute } from './ChainAgentDetail';

export default function HireableChainView({ view, label }) {
  // Which agent's own page is open, read from the URL rather than held only
  // in state. That is what makes a refresh land back on the agent instead of
  // the marketplace, and what makes the page shareable.
  const [route, setRoute] = useState(() => readChainAgentRoute());
  useEffect(() => {
    const onPop = () => setRoute(readChainAgentRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function openAgent(agent) {
    const path = chainAgentPath(agent.chainId, agent.tokenId);
    window.history.pushState({}, '', path);
    setRoute({ chainId: agent.chainId, tokenId: String(agent.tokenId) });
    window.scrollTo({ top: 0 });
  }

  function backToMarketplace() {
    window.history.pushState({}, '', '/market');
    setRoute(null);
    window.scrollTo({ top: 0 });
  }

  const {
    agents, capabilities, total, page, goToPage, pageSize, loading, error,
    category, setCategory, categories,
  } = view;

  // The agent page takes over the whole view, the way BNB's does, rather
  // than opening in a panel beside the grid.
  if (route) {
    return (
      <ChainAgentDetail
        chainId={route.chainId}
        tokenId={route.tokenId}
        onBack={backToMarketplace}
      />
    );
  }

  const rows = normalizeChainAgents(agents);
  const pageCount = total && pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = total ? Math.min(page * pageSize, total) : 0;

  // Category tabs, the same control the BNB marketplace carries. Counts come
  // from the backend over the whole view, so a tab says how many agents it
  // holds rather than how many happen to be on this page.
  const tabs = [
    { category: 'All', count: null },
    ...categories.filter((c) => c.count > 0),
  ];

  const chips = tabs.length > 1 && (
    <div className="flex flex-wrap gap-2 mb-4">
      {tabs.map((c) => {
        const active = (category || 'All') === c.category;
        return (
          <button
            key={c.category}
            type="button"
            onClick={() => setCategory(c.category)}
            className={`min-h-[44px] px-4 rounded-full text-[12px] font-semibold transition-colors ${
              active
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'bg-white dark:bg-[#1E293B] text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            {c.category}
            {c.count != null && (
              <span className={`ml-1.5 font-normal ${active ? 'opacity-70' : 'text-gray-400'}`}>
                {c.count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  // The chips stay on screen while a category loads or comes back empty.
  // Without that, choosing a category with no agents would replace the whole
  // control with an empty state and leave no way back to All.
  if (loading || error || !agents.length) {
    return (
      <div>
        {chips}
        <ChainViewStates loading={loading} error={error} empty={!agents.length} label={label} />
      </div>
    );
  }

  return (
    <div>
      {/* No hireability banner and no "agents are live-checked" line here.
          Both were removed 2026-09-10: on a chain where hiring works, a
          standing paragraph explaining that hiring works is noise above the
          thing it describes, and every card already carries a hire button and
          its own status badge. Nothing was lost -- the capabilities panel
          below still states, per signal, what can be checked here and why
          anything absent is absent, which is where a reader goes when they
          want that rather than having it repeated on every page load.

          The read-only theme keeps both notices, because there the absence of
          a hire button is the whole point and needs saying. */}
      <ChainCapabilities capabilities={capabilities} />

      {chips}

      {/* Position in the set, the same line the BNB marketplace carries. An
          en dash separates the range: this read "1,24 of 1,403" on the BNB
          page for a long time, where a comma reads as a thousands separator
          rather than a range. */}
      {total != null && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
          Showing {first.toLocaleString()}&ndash;{last.toLocaleString()} of {total.toLocaleString()} agents
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {rows.map((a) => (
          <HireableAgentCard
            key={a.id}
            agent={a}
            explorerUrl={EXPLORER_BASE[a.chainId] || null}
            onOpen={openAgent}
          />
        ))}
      </div>

      <Pagination page={page} pageCount={pageCount} onChange={goToPage} />
    </div>
  );
}
