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

import React from 'react';
import Pagination from '../Pagination';
import HireableAgentCard from '../HireableAgentCard';
import { normalizeChainAgents } from './normalizeChainAgent';
import {
  HireabilityNotice, UnverifiedStatusNote, ChainCapabilities,
  ChainViewStates, EXPLORER_BASE,
} from './ChainViewShared';

export default function HireableChainView({ view, label }) {
  const {
    agents, statusNote, verifiedChains, unverifiedChains, capabilities,
    hire_paths: hirePaths, total, page, goToPage, pageSize,
    loading, error,
  } = view;

  const rows = normalizeChainAgents(agents);
  const pageCount = total && pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = total ? Math.min(page * pageSize, total) : 0;

  const state = <ChainViewStates loading={loading} error={error} empty={!agents.length} label={label} />;
  if (loading || error || !agents.length) return state;

  return (
    <div>
      <HireabilityNotice label={label} hirePaths={hirePaths} />
      <UnverifiedStatusNote note={statusNote} verifiedChains={verifiedChains} unverifiedChains={unverifiedChains} />
      <ChainCapabilities capabilities={capabilities} />

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
          />
        ))}
      </div>

      <Pagination page={page} pageCount={pageCount} onChange={goToPage} />
    </div>
  );
}
