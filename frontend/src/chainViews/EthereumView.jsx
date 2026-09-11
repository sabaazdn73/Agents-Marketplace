// EthereumView.jsx
//
// Ethereum gets its own view rather than being folded into anything else: it
// is a major ecosystem and the largest non-BSC set this project stores, so
// grouping it with much smaller chains would misrepresent both.
//
// PARITY WITH ARBITRUM AND ROBINHOOD, WITHOUT WAITING FOR THE DEPLOY
// -----------------------------------------------------------------
// Those two use the hireable theme: the BNB Chain card with an action on it,
// a count, and numbered pages. Ethereum gets exactly the same theme the
// moment AgentBudgetEscrow exists here, and the switch is automatic rather
// than a second edit to this file.
//
// It is driven off isBudgetHiringAvailable(1), which reads
// chainContracts.js's BUDGET_ESCROW_BY_CHAIN. That map is the feature flag,
// so deploying and adding one line there flips this view over. Nothing here
// needs touching, and nothing here hardcodes an address.
//
// The switch is deliberate rather than just showing the hireable theme now.
// HireableChainView drops the hireability banner on purpose, because on a
// chain where hiring works a paragraph explaining that hiring works is noise
// above the thing it describes. On a chain where it does NOT work, that same
// layout would put a hire action on every card that cannot complete. So until
// the escrow is live, Ethereum stays on the read-only listing, which is the
// honest presentation of a set you can browse but not yet act on.
//
// BEING ACCURATE ABOUT THE POPULATION
// -----------------------------------
// 30,779 agents are stored for Ethereum and 812 of them answer. That gap is
// not a rounding detail, it is most of the tab, so EthereumPopulationNote
// states it on the page rather than leaving a visitor to infer a catalogue
// that is not there. The numbers are read live from the same capabilities
// payload the rest of the view uses, and fall back to nothing rather than to
// a stale constant if the backend does not send them.

import React from 'react';
import { Info } from 'lucide-react';
import { useChainView } from './useChainView';
import { isBudgetHiringAvailable } from '../chainContracts';
import HireableChainView from './HireableChainView';
import {
  ChainAgentCard, ChainViewStates, LoadMoreButton,
  HireabilityNotice, UnverifiedStatusNote,
  ChainCapabilities,
} from './ChainViewShared';

const ETHEREUM_CHAIN_ID = 1;

/** What the catalogue actually contains, stated up front.
 *
 *  Counts come from the view payload. If the backend has not sent a
 *  breakdown this renders nothing at all, because an approximate claim about
 *  how much of a catalogue is reachable is worse than no claim. */
export function EthereumPopulationNote({ statusCounts, total }) {
  if (!statusCounts || !total) return null;
  const responding = statusCounts.responding || 0;
  const noEndpoint = (statusCounts.unknown || 0) + (statusCounts.no_endpoint || 0);
  const notResponding = statusCounts.not_responding || 0;
  if (!responding && !noEndpoint) return null;

  return (
    <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30 text-[12px] flex items-start gap-2 mb-4">
      <Info size={14} className="shrink-0 mt-0.5 text-gray-400" />
      <div className="min-w-0 space-y-1 text-gray-600 dark:text-gray-300">
        <p>
          <span className="font-semibold">
            {responding.toLocaleString()} of {total.toLocaleString()} Ethereum agents answer.
          </span>{' '}
          {noEndpoint.toLocaleString()} publish no service endpoint at all, so there is nothing to
          call and nothing to check.
          {notResponding > 0 && ` ${notResponding.toLocaleString()} publish one that does not respond.`}
        </p>
        <p className="text-gray-500 dark:text-gray-400">
          Registration on Ethereum costs a mint and nothing more, so most of this set was never a
          working service. The filters below act on what is stored; the responding count is what is
          actually reachable.
        </p>
      </div>
    </div>
  );
}

export default function EthereumView({ mutedBorder = 'border-gray-200 dark:border-gray-800' }) {
  const view = useChainView('ethereum');

  // Parity switch. One condition, no per-chain branching inside the shared
  // components, and it needs no edit here when the escrow lands.
  //
  // The population note is rendered on BOTH branches on purpose. It is true
  // whether or not the escrow is live, and it matters more once it is: a
  // hireable theme puts a hire button on every card, which is exactly when a
  // visitor is most likely to read 30,779 as the size of the catalogue. The
  // note sits above HireableChainView rather than inside it so the shared
  // component stays chain-agnostic.
  if (isBudgetHiringAvailable(ETHEREUM_CHAIN_ID)) {
    return (
      <div>
        <EthereumPopulationNote statusCounts={view.statusCounts} total={view.total} />
        <HireableChainView view={view} label={view.label || 'Ethereum'} />
      </div>
    );
  }

  const {
    agents, label, statusNote, hire_paths: hirePaths, verifiedChains, unverifiedChains,
    capabilities, statusCounts, total, loading, loadingMore, hasMore, error, loadMore,
  } = view;

  const state = <ChainViewStates loading={loading} error={error} empty={!agents.length} label="Ethereum" />;
  if (state && (loading || error || !agents.length)) return state;

  return (
    <div>
      <HireabilityNotice label={label} hirePaths={hirePaths} />
      <EthereumPopulationNote statusCounts={statusCounts} total={total} />
      <UnverifiedStatusNote note={statusNote} verifiedChains={verifiedChains} unverifiedChains={unverifiedChains} />
      <ChainCapabilities capabilities={capabilities} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((a) => <ChainAgentCard key={a.id} agent={a} mutedBorder={mutedBorder} />)}
      </div>
      <LoadMoreButton hasMore={hasMore} loadingMore={loadingMore} onClick={loadMore} />
    </div>
  );
}
