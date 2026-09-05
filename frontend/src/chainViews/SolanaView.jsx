// SolanaView.jsx
//
// Solana is marked Coming Soon deliberately, and the distinction matters:
// the data is real and already ingested (~1,465 agents), but Solana is not
// an EVM chain. None of this project's on-chain reads, escrow, wallet
// connection or signing paths apply to it, so presenting the agents as if
// they behaved like the EVM views would overstate what the app can do.
//
// It still shows real counts and a sample rather than an empty promise,
// so the claim is checkable rather than aspirational.

import React from 'react';
import { Clock } from 'lucide-react';
import { useChainView } from './useChainView';
import { ChainAgentCard, ChainViewStates, UnverifiedStatusNote } from './ChainViewShared';

const PREVIEW_COUNT = 6;

export default function SolanaView({ mutedBorder = 'border-gray-200 dark:border-gray-800' }) {
  const { agents, statusNote, loading, error } = useChainView('solana');

  const state = <ChainViewStates loading={loading} error={error} empty={false} label="Solana" />;
  if (state && (loading || error)) return state;

  return (
    <div>
      <div className="p-4 rounded-xl border border-indigo-500/25 bg-indigo-500/5 mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Clock size={15} className="text-indigo-500" />
          <span className="font-semibold text-sm">Solana — coming soon</span>
        </div>
        <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">
          These agents are already indexed and stored. Solana is not an EVM chain, so
          this app's wallet connection, on-chain reads and escrow do not apply to it
          yet — which is why this is a preview rather than a browsable view. A sample
          of what is stored is shown below.
        </p>
      </div>
      <UnverifiedStatusNote note={statusNote} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 opacity-75">
        {agents.slice(0, PREVIEW_COUNT).map((a) => (
          <ChainAgentCard key={a.id} agent={a} mutedBorder={mutedBorder} />
        ))}
      </div>
    </div>
  );
}
