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
import { Loader2, AlertTriangle, Info, ExternalLink, CheckCircle2, XCircle } from 'lucide-react';
import ServiceHealthBadge from '../ServiceHealthBadge';
import ChainAgentEvaluation from '../ChainAgentEvaluation';

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

/** Says which chains in this view have genuinely been health-checked and
 * which have not, rather than blanket-disclaiming a view that is now
 * partly verified. Both lists come from the backend, so the UI cannot
 * drift from what the data layer actually guarantees. */
export function UnverifiedStatusNote({ note, verifiedChains = [], unverifiedChains = [] }) {
  const names = (l) => l.map((c) => c.name).join(', ');
  return (
    <div className="text-[11px] text-gray-600 dark:text-gray-400 flex items-start gap-1.5 mb-4">
      <AlertTriangle size={12} className="shrink-0 mt-0.5 opacity-70" />
      <span>
        {verifiedChains.length > 0 && (
          <><strong>{names(verifiedChains)}</strong> agents are live-checked and show a real status. </>
        )}
        {unverifiedChains.length > 0 && (
          <>{verifiedChains.length > 0 ? 'Agents on ' : ''}
          <strong>{names(unverifiedChains)}</strong> have not been checked, and no status is implied for them.</>
        )}
        {verifiedChains.length === 0 && unverifiedChains.length === 0 && (note || 'No status is implied for these agents.')}
      </span>
    </div>
  );
}

/** Human labels for the backend's signal ids. Kept here rather than sent
 * from the backend because these are UI copy, not facts about a chain --
 * the backend owns whether a signal is available and why, which is the
 * part that must not drift. */
const SIGNAL_LABELS = {
  category: 'Category classification',
  live_health: 'Live service health',
  contract_verification: 'Contract verification',
  independent_corroboration: 'Independent corroboration',
  financial_record: 'Financial record',
  escrow_compatibility: 'Escrow compatibility',
  delivery_record: 'Delivery record',
  canary_results: 'Canary test results',
};

/** What this view can and cannot show about its agents, and why.
 *
 * The chain views used to differ from BSC's by simply having less on the
 * page, which reads as "not bothered" when the real answer is usually
 * "this cannot exist here" -- ERC-8183 escrow is deployed on BNB Smart
 * Chain only, so escrow compatibility, delivery record and canary results
 * have nothing to read anywhere else. Stating that is more useful than an
 * empty section, and much more useful than a partial copy of BSC's display
 * that implies those checks ran and came back blank.
 *
 * Availability and reasons come from the backend so the UI cannot claim a
 * signal the data layer has no way to produce. */
export function ChainCapabilities({ capabilities }) {
  const signals = capabilities?.signals || [];
  if (!signals.length) return null;
  const shown = signals.filter((s) => s.available || s.partial);
  const absent = signals.filter((s) => !s.available && !s.partial);

  return (
    <details className="mb-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B]">
      <summary className="px-4 py-3 text-[12px] font-semibold cursor-pointer select-none flex items-center gap-2">
        <Info size={13} className="text-indigo-500 shrink-0" />
        What we can check on this chain
        <span className="font-normal text-gray-500">
          ({shown.length} of {signals.length} signals)
        </span>
      </summary>
      <div className="px-4 pb-4 pt-1 space-y-2.5">
        {shown.map((s) => (
          <div key={s.signal} className="flex items-start gap-2">
            <CheckCircle2 size={13} className={`shrink-0 mt-0.5 ${s.partial ? 'text-amber-500' : 'text-emerald-500'}`} />
            <div className="min-w-0">
              <div className="text-[12px] font-medium">
                {SIGNAL_LABELS[s.signal] || s.signal}
                {s.partial && <span className="ml-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">PARTIAL</span>}
              </div>
              <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">{s.detail}</p>
              {s.partial && s.missing_chains?.length > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-500 mt-0.5">
                  Not available for {s.missing_chains.map((c) => c.name).join(', ')}.
                </p>
              )}
            </div>
          </div>
        ))}
        {absent.map((s) => (
          <div key={s.signal} className="flex items-start gap-2">
            <XCircle size={13} className="shrink-0 mt-0.5 text-gray-400" />
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-gray-500">{SIGNAL_LABELS[s.signal] || s.signal}</div>
              <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed">{s.reason}</p>
            </div>
          </div>
        ))}
      </div>
    </details>
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
      {/* Rendered only when the backend marked this agent's chain as
          genuinely analysed. An unverified agent has no health fields at
          all, so there is nothing here to render even by accident. */}
      {agent.status_verified && agent.service_status && (
        <div className="flex items-center gap-1.5">
          <ServiceHealthBadge status={agent.service_status} checkedAt={agent.service_checked_at} />
        </div>
      )}
      {/* On demand, per agent. The list stays cheap -- these are calls
          against rate-limited keys, so they run only when someone actually
          asks about one agent rather than for every card rendered. */}
      <details className="mt-1">
        <summary className="text-[11px] text-indigo-600 dark:text-indigo-400 cursor-pointer hover:underline select-none">
          Evaluate this agent
        </summary>
        <div className="mt-2">
          <ChainAgentEvaluation
            chainId={agent.chain_id}
            tokenId={agent.token_id}
            ownerAddress={agent.owner_address}
          />
        </div>
      </details>

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
