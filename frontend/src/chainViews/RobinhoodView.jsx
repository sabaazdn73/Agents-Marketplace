// RobinhoodView.jsx
//
// Robinhood Chain, with the data that exists and nothing implied past it.
//
// Analysed and hireable since 2026-09-10, so this view now says roughly what
// the Arbitrum one does. The registry deployment and an RPC were verified on
// the chain itself, all 190 stored agents were health-checked, and
// AgentBudgetEscrow was deployed and Sourcify-verified here, so budgets can
// be opened against these agents.
//
// Nine of the thirteen evaluation signals are available. Zerion indexes this
// chain as "robinhood", DefiLlama carries it as "Robinhood Chain", 8004scan
// scores its agents, and Binance's token data is as deep here as on BSC.
//
// The contract check runs through Sourcify rather than an explorer API: the
// Blockscout instance sits behind a Cloudflare interstitial and returns 403
// to a client. The human-facing explorer pages work, so the owner link is a
// real one; only the programmatic route had to change.
//
// ERC-8183 escrow hiring is not available and will not be: that contract is
// Altana's and exists on BNB Chain only. The view states that rather than
// implying it is pending.
//
// One thing the capabilities block gets right that an earlier version did
// not: Robinhood Chain IS EVM. It was being told otherwise until
// 2026-09-10, because is_evm was derived from the explorer allowlist rather
// than from the chain. See core/chain_capabilities.py.

//
// Uses the HIREABLE theme (HireableChainView), same as Arbitrum: the BNB
// Chain card design with an action on it and numbered pages, adopted because
// AgentBudgetEscrow is deployed here and these agents can genuinely be hired.
import React from 'react';
import { useChainView } from './useChainView';
import HireableChainView from './HireableChainView';

export default function RobinhoodView({ mutedBorder = 'border-gray-200 dark:border-gray-800' }) {
  const view = useChainView('robinhood');
  return <HireableChainView view={view} label={view.label || 'Robinhood Chain'} />;
}
