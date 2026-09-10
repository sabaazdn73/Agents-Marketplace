// MultiChainView.jsx
//
// Everything with stored data that has no tab of its own: Base, Celo,
// Monad and Billions Network. Base dominates it.
//
// Arbitrum and Robinhood Chain were part of this view until 2026-09-10,
// when both were given their own tabs and removed from here. A chain sits
// in exactly one view, so the tab counts stay additive and one agent cannot
// appear twice.
//
// Polygon is deliberately not represented. The Agent0 subgraph covers it,
// but this store currently holds zero Polygon agents, and listing a chain
// with nothing behind it would be a claim rather than a view.
//
// Each card names its own chain, since unlike the single-chain views a
// reader cannot infer it from the tab.

import React from 'react';
import { useChainView } from './useChainView';
import {
  ChainAgentCard, ChainViewStates, LoadMoreButton,
  NotHireableNotice, UnverifiedStatusNote,
  ChainCapabilities,
} from './ChainViewShared';

export default function MultiChainView({ mutedBorder = 'border-gray-200 dark:border-gray-800' }) {
  const { agents, label, statusNote, verifiedChains, unverifiedChains, capabilities, loading, loadingMore, hasMore, error, loadMore } =
    useChainView('multichain');

  const state = <ChainViewStates loading={loading} error={error} empty={!agents.length} label="multi-chain" />;
  if (state && (loading || error || !agents.length)) return state;

  return (
    <div>
      <NotHireableNotice label={label || 'multi-chain'} />
      <UnverifiedStatusNote note={statusNote} verifiedChains={verifiedChains} unverifiedChains={unverifiedChains} />
      <ChainCapabilities capabilities={capabilities} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((a) => <ChainAgentCard key={a.id} agent={a} mutedBorder={mutedBorder} />)}
      </div>
      <LoadMoreButton hasMore={hasMore} loadingMore={loadingMore} onClick={loadMore} />
    </div>
  );
}
