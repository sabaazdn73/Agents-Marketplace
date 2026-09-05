// ChainViewShared.jsx
//
// Presentation shared by the non-BSC chain views: the agent card, the
// not-hireable notice, and the loading/empty/error states.
//
// These live here rather than being copied into each view, and each view
// composes them rather than passing a mode flag into one component. Adding
// a fifth chain later should mean writing a new small view module that
// reuses these, not adding another branch to an existing one.
//
// The BSC card is deliberately NOT reused here. It renders verification
// tiers, service-health badges and escrow-compatibility warnings, all of
// which depend on signals that genuinely do not exist off BSC. Reusing it
// would mean either showing those controls empty or teaching it to hide
// them per chain, and both make the honest thing harder to see.

import React from 'react';
import { Loader2, AlertTriangle, Info, ExternalLink } from 'lucide-react';

/** Block explorer per chain, so an agent is verifiable at source even
 * though this app cannot check its liveness. Only chains actually present
 * in the data are listed; anything else simply gets no link rather than a
 * guessed URL. */
const EXPLORERS = {
  1: 'https://etherscan.io/address/',
  8453: 'https://basescan.org/address/',
  42161: 'https://arbiscan.io/address/',
  42220: 'https://celoscan.io/address/',
  143: null,          // Monad: no stable public explorer wired up here yet
  4663: null,         // Robinhood Chain: same
  45056: null,        // Billions Network: same
  101: null,          // Solana: different address format, not an EVM explorer
};

export function ChainBadge({ chainName }) {
  if (!chainName) return null;
  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
      {chainName}
    </span>
  );
}

/** The single most important thing these views say. Escrow is deployed on
 * BSC only, so there is no hire path for these agents today. Stated once,
 * prominently, per view rather than implied by the absence of a button. */
export function NotHireableNotice({ label }) {
  return (
    <div className="p-3 rounded-xl border border-amber-500/25 bg-amber-500/5 text-[12px] text-amber-700 dark:text-amber-400 flex items-start gap-2 mb-4">
      <Info size={14} className="shrink-0 mt-0.5" />
      <span>
        These {label} agents can be browsed but <strong>not hired here</strong>. Tnega's
        escrow runs on BNB Smart Chain, so hiring is only available for BNB Chain agents.
        Everything below is registry data, shown for discovery.
      </span>
    </div>
  );
}

/** Says plainly that liveness was not checked, rather than leaving a gap
 * where the BSC view shows a health badge. The wording comes from the
 * backend so the UI cannot drift from what the data layer guarantees. */
export function UnverifiedStatusNote({ note }) {
  return (
    <div className="text-[11px] text-gray-600 dark:text-gray-400 flex items-start gap-1.5 mb-4">
      <AlertTriangle size={12} className="shrink-0 mt-0.5 opacity-70" />
      <span>{note || 'Live endpoint checks are BNB Chain only. No status is implied for these agents.'}</span>
    </div>
  );
}

export function ChainAgentCard({ agent, mutedBorder }) {
  const explorer = EXPLORERS[agent.chain_id];
  return (
    <div className={`bg-white dark:bg-[#1E293B] rounded-2xl border ${mutedBorder} p-4 flex flex-col gap-2`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold leading-snug">{agent.name || 'Unnamed agent'}</h3>
        <ChainBadge chainName={agent.chain_name} />
      </div>
      {agent.category && (
        <span className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">
          {agent.category}
        </span>
      )}
      <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-3">
        {agent.description || 'No description provided.'}
      </p>
      <div className="flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-500 mt-auto pt-2">
        {agent.token_id != null && <span className="font-mono">#{agent.token_id}</span>}
        {agent.total_feedbacks > 0 && <span>{agent.total_feedbacks} on-chain feedback</span>}
        {explorer && agent.owner_address && (
          <a
            href={`${explorer}${agent.owner_address}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-indigo-500 ml-auto"
          >
            Owner <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  );
}

export function ChainViewStates({ loading, error, empty, label }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" /> Loading {label} agents…
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-16 px-6">
        <p className="font-semibold mb-1">Couldn't load {label} agents</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="text-center py-16 px-6">
        <p className="font-semibold mb-1">No {label} agents stored yet</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This view fills as the background ingestion reaches that chain.
        </p>
      </div>
    );
  }
  return null;
}

export function LoadMoreButton({ hasMore, loadingMore, onClick }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center mt-5">
      <button
        onClick={onClick}
        disabled={loadingMore}
        className="text-sm font-semibold px-5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-60 flex items-center gap-2"
      >
        {loadingMore && <Loader2 size={14} className="animate-spin" />}
        {loadingMore ? 'Loading…' : 'Load more'}
      </button>
    </div>
  );
}
