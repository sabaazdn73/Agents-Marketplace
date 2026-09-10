// ArbitrumView.jsx
//
// Arbitrum gets its own tab because it is one of the few non-BSC chains
// this project has genuinely analysed. 42161 is in ANALYSIS_CHAIN_IDS, so
// its agents carry a live service_status, an explorer-backed contract
// check, Zerion corroboration, DefiLlama coverage and an owner balance
// read from our own RPC. Eight of the twelve evaluation signals are
// available here, against one on an unanalysed chain.
//
// It was previously folded into Multi-Chain, where its verified signals sat
// beside unverified chains and neither could be read clearly. Promoted
// 2026-09-10, and removed from Multi-Chain at the same time so no agent
// appears under two tabs.
//
// Still not hireable: ERC-8183 escrow is deployed on BNB Chain only, which
// is a property of the protocol rather than something pending here.

import React from 'react';
import { useChainView } from './useChainView';
import {
  ChainAgentCard, ChainViewStates, LoadMoreButton,
  NotHireableNotice, UnverifiedStatusNote,
  ChainCapabilities,
} from './ChainViewShared';

export default function ArbitrumView({ mutedBorder = 'border-gray-200 dark:border-gray-800' }) {
  const { agents, label, statusNote, verifiedChains, unverifiedChains, capabilities, loading, loadingMore, hasMore, error, loadMore } =
    useChainView('arbitrum');

  const state = <ChainViewStates loading={loading} error={error} empty={!agents.length} label="Arbitrum" />;
  if (state && (loading || error || !agents.length)) return state;

  return (
    <div>
      <NotHireableNotice label={label || 'Arbitrum'} />
      <UnverifiedStatusNote note={statusNote} verifiedChains={verifiedChains} unverifiedChains={unverifiedChains} />
      <ChainCapabilities capabilities={capabilities} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((a) => <ChainAgentCard key={a.id} agent={a} mutedBorder={mutedBorder} />)}
      </div>
      <LoadMoreButton hasMore={hasMore} loadingMore={loadingMore} onClick={loadMore} />
    </div>
  );
}
