// MonadView.jsx
//
// Monad's own tab, promoted out of the Multi-Chain view on 2026-09-11 when
// that view was removed. It had been browse-only and outside the analysis
// scope; it is now analysed like every other chain with a tab, so its agents
// carry a real service_status rather than having their health fields
// stripped.
//
// The promotion was not assumed to be safe because other chains had been
// fine. Verified first, same three checks as Arbitrum and Robinhood Chain
// before it: eth_chainId returned 143, the ERC-8004 registry at
// 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 holds the same 130 bytes it
// does elsewhere, and tokenURI resolved for 10 of 10 stored agents. A
// failover (monad.drpc.org) was confirmed against the primary rather than
// taken from a list.
//
// Monad is NOT in the deletion scope. That stays BNB Chain alone.

import React from 'react';
import { useChainView } from './useChainView';
import {
  ChainAgentCard, ChainViewStates, LoadMoreButton,
  HireabilityNotice, UnverifiedStatusNote,
  ChainCapabilities,
} from './ChainViewShared';

export default function MonadView({ mutedBorder = 'border-gray-200 dark:border-gray-800' }) {
  const { agents, label, statusNote, hire_paths: hirePaths, verifiedChains, unverifiedChains, capabilities, loading, loadingMore, hasMore, error, loadMore } =
    useChainView('monad');

  const state = <ChainViewStates loading={loading} error={error} empty={!agents.length} label="Monad" />;
  if (state && (loading || error || !agents.length)) return state;

  return (
    <div>
      <HireabilityNotice label={label} hirePaths={hirePaths} />
      <UnverifiedStatusNote note={statusNote} verifiedChains={verifiedChains} unverifiedChains={unverifiedChains} />
      <ChainCapabilities capabilities={capabilities} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((a) => <ChainAgentCard key={a.id} agent={a} mutedBorder={mutedBorder} />)}
      </div>
      <LoadMoreButton hasMore={hasMore} loadingMore={loadingMore} onClick={loadMore} />
    </div>
  );
}
