// ArbitrumView.jsx
//
// Arbitrum gets its own tab because it is one of the few non-BSC chains
// this project has genuinely analysed. 42161 is in ANALYSIS_CHAIN_IDS, so
// its agents carry a live service_status, an explorer-backed contract
// check, Zerion corroboration, DefiLlama coverage and an owner balance
// read from our own RPC. Nine of the thirteen evaluation signals are
// available here, against one on an unanalysed chain.
//
// It was previously folded into Multi-Chain, where its verified signals sat
// beside unverified chains and neither could be read clearly. Promoted
// 2026-09-10, and removed from Multi-Chain at the same time so no agent
// appears under two tabs.
//
// Hireable since 2026-09-10, through budgets. AgentBudgetEscrow is deployed
// and Arbiscan-verified on this chain, so a client can fund a budget and the
// agent can draw against it. ERC-8183 escrow hiring remains BNB Chain only,
// because that contract is Altana's rather than ours, which is a property of
// the protocol rather than something pending here. The view states both.

//
// Uses the HIREABLE theme (HireableChainView): the BNB Chain card design with
// an action on it and numbered pages. That is the rule now, not a one-off --
// a chain switches to this theme when its agents become hireable, and back to
// the read-only listing if that ever stops being true.
import React from 'react';
import { useChainView } from './useChainView';
import HireableChainView from './HireableChainView';

export default function ArbitrumView({ mutedBorder = 'border-gray-200 dark:border-gray-800' }) {
  const view = useChainView('arbitrum');
  return <HireableChainView view={view} label={view.label || 'Arbitrum'} />;
}
