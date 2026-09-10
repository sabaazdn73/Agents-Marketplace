// RobinhoodView.jsx
//
// Robinhood Chain, with the data that exists and nothing implied past it.
//
// The agents are real and stored. What is missing is the analysis: 4663 is
// absent from ANALYSIS_CHAIN_IDS, from NATIVE_RPC_CHAINS and from the
// explorer list, because this project has no registry address or RPC
// configured for the chain yet. So the backend strips every health field
// per agent, the chain lands in unverifiedChains, and the capabilities
// block names each missing signal with its reason.
//
// This view therefore renders exactly the same components as the others and
// says less, which is the intended outcome. It is deliberately NOT marked
// coming soon: that flag would hide agents that genuinely exist, when the
// gap is in the evaluation rather than in the data.
//
// One thing the capabilities block gets right that an earlier version did
// not: Robinhood Chain IS EVM. It was being told otherwise until
// 2026-09-10, because is_evm was derived from the explorer allowlist rather
// than from the chain. See core/chain_capabilities.py.

import React from 'react';
import { useChainView } from './useChainView';
import {
  ChainAgentCard, ChainViewStates, LoadMoreButton,
  NotHireableNotice, UnverifiedStatusNote,
  ChainCapabilities,
} from './ChainViewShared';

export default function RobinhoodView({ mutedBorder = 'border-gray-200 dark:border-gray-800' }) {
  const { agents, label, statusNote, verifiedChains, unverifiedChains, capabilities, loading, loadingMore, hasMore, error, loadMore } =
    useChainView('robinhood');

  const state = <ChainViewStates loading={loading} error={error} empty={!agents.length} label="Robinhood Chain" />;
  if (state && (loading || error || !agents.length)) return state;

  return (
    <div>
      <NotHireableNotice label={label || 'Robinhood Chain'} />
      <UnverifiedStatusNote note={statusNote} verifiedChains={verifiedChains} unverifiedChains={unverifiedChains} />
      <ChainCapabilities capabilities={capabilities} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((a) => <ChainAgentCard key={a.id} agent={a} mutedBorder={mutedBorder} />)}
      </div>
      <LoadMoreButton hasMore={hasMore} loadingMore={loadingMore} onClick={loadMore} />
    </div>
  );
}
