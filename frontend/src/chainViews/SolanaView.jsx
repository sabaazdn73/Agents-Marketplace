// SolanaView.jsx
//
// Solana is marked Coming Soon deliberately, and the distinction matters:
// the data is and already ingested (~1,465 agents), but Solana is not
// an EVM chain. None of this project's on-chain reads, escrow, wallet
// connection or signing paths apply to it, so presenting the agents as if
// they behaved like the EVM views would overstate what the app can do.
//
// It still shows counts and a sample rather than an empty promise,
// so the claim is checkable rather than aspirational.
//
// The Behaviour Study lives here rather than in the sidebar. It analyses one
// arbitrage bot on Solana, so it belongs to this chain rather than to the
// marketplace as a whole, and a top-level tab implied the latter. It is
// collapsed by default: the tab's job is the agent preview above it, and a
// long analysis unfurled on load would bury that.

import React, { useState } from 'react';
import { Clock, FlaskConical, ChevronDown } from 'lucide-react';
import BehaviourStudy from '../BehaviourStudy';
import { useChainView } from './useChainView';
import { ChainAgentCard, ChainViewStates, UnverifiedStatusNote, ChainCapabilities } from './ChainViewShared';

const PREVIEW_COUNT = 6;

export default function SolanaView({ mutedBorder = 'border-gray-200 dark:border-gray-800' }) {
  const { agents, statusNote, verifiedChains, unverifiedChains, capabilities, loading, error } = useChainView('solana');
  const [studyOpen, setStudyOpen] = useState(false);

  const state = <ChainViewStates loading={loading} error={error} empty={false} label="Solana" />;
  if (state && (loading || error)) return state;

  return (
    <div>
      <div className="p-4 rounded-xl border border-indigo-500/25 bg-indigo-500/5 mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Clock size={15} className="text-indigo-500" />
          <span className="font-semibold text-sm">Solana, coming soon</span>
        </div>
        <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">
          These agents are already indexed and stored. Solana is not an EVM chain, so
          this app's wallet connection, on-chain reads and escrow do not apply to it
          yet, which is why this is a preview rather than a browsable view. A sample
          of what is stored is shown below.
        </p>
      </div>
      <UnverifiedStatusNote note={statusNote} verifiedChains={verifiedChains} unverifiedChains={unverifiedChains} />
      <ChainCapabilities capabilities={capabilities} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 opacity-75">
        {agents.slice(0, PREVIEW_COUNT).map((a) => (
          <ChainAgentCard key={a.id} agent={a} mutedBorder={mutedBorder} />
        ))}
      </div>

      {/* The behaviour study. Solana-specific, so it sits inside the Solana
          tab instead of the sidebar, and collapsed so it does not displace
          the preview above. */}
      <div className="mt-6 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-[#1E293B]">
        <button
          type="button"
          onClick={() => setStudyOpen((v) => !v)}
          aria-expanded={studyOpen}
          className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <FlaskConical size={16} className="text-indigo-500 shrink-0" />
            <span className="min-w-0">
              <span className="block font-bold text-sm">Behaviour Study</span>
              <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                Measuring on-chain behaviour from public transaction data, worked through on one
                arbitrage bot on Solana. It is a bot and not an agent: it runs a fixed rule and
                decides nothing.
              </span>
            </span>
          </span>
          <ChevronDown
            size={16}
            className={`shrink-0 text-gray-400 transition-transform ${studyOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {studyOpen && (
          <div className="px-5 pb-5 pt-1 border-t border-gray-200 dark:border-gray-800">
            <BehaviourStudy />
          </div>
        )}
      </div>
    </div>
  );
}
