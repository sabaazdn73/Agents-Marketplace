// EthereumView.jsx
//
// Ethereum gets its own view rather than being folded into Multi-Chain:
// it is a major ecosystem in its own right and the largest non-BSC set
// this project stores (~28,400 agents), so grouping it with much smaller
// chains would misrepresent both.
//
// Owns only its own framing. Data access and shared presentation come
// from useChainView / ChainViewShared, so this file stays small enough
// that changing Ethereum's view means reading Ethereum's view.

import React from 'react';
import { useChainView } from './useChainView';
import {
  ChainAgentCard, ChainViewStates, LoadMoreButton,
  NotHireableNotice, UnverifiedStatusNote,
} from './ChainViewShared';

export default function EthereumView({ mutedBorder = 'border-gray-200 dark:border-gray-800' }) {
  const { agents, label, statusNote, loading, loadingMore, hasMore, error, loadMore } =
    useChainView('ethereum');

  const state = <ChainViewStates loading={loading} error={error} empty={!agents.length} label="Ethereum" />;
  if (state && (loading || error || !agents.length)) return state;

  return (
    <div>
      <NotHireableNotice label={label || 'Ethereum'} />
      <UnverifiedStatusNote note={statusNote} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((a) => <ChainAgentCard key={a.id} agent={a} mutedBorder={mutedBorder} />)}
      </div>
      <LoadMoreButton hasMore={hasMore} loadingMore={loadingMore} onClick={loadMore} />
    </div>
  );
}
