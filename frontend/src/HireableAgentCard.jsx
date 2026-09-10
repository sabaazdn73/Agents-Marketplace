// HireableAgentCard.jsx
//
// The marketplace card for a chain whose agents can actually be hired.
//
// This is the BNB Chain card design, and it is deliberately the design a
// chain adopts the moment hiring becomes possible on it. Before that a chain
// is a read-only listing and uses the thinner card in
// chainViews/ChainViewShared.jsx. There are two themes on purpose and the
// difference between them means something: a card with a hire button on it is
// making a promise the app can keep.
//
// Same structure as the BNB card, in the same order: avatar, category, name,
// chain badge, health badge, the three-stat block, a track-record line, the
// description, then the action.
//
// Where a slot cannot be filled on this chain it renders a reason rather than
// a blank. A dash with no explanation reads as broken; a dash that says why
// reads as honest. What can and cannot be filled per chain is worked out in
// chainViews/normalizeChainAgent.js, which is also where the reasoning for
// each omission is written down.

import React from 'react';
import AgentAvatar from './AgentAvatar';
import ServiceHealthBadge from './ServiceHealthBadge';
import InteractionLine from './InteractionLine';

/** One cell of the three-stat block. `unavailableReason` turns the dash into
 *  something a reader can act on, via the title attribute. */
function Stat({ label, value, hint, unavailableReason, bordered }) {
  const known = value !== null && value !== undefined;
  return (
    <div
      className={`text-center ${bordered ? 'border-l border-gray-200 dark:border-gray-700' : ''}`}
      title={known ? hint : unavailableReason || hint}
    >
      <span className="block text-[10px] text-gray-500 uppercase mb-1">{label}</span>
      <span className="font-bold text-sm text-gray-900 dark:text-white">
        {known ? value : <span className="text-gray-400 font-normal">-</span>}
      </span>
    </div>
  );
}

export default function HireableAgentCard({
  agent,
  explorerUrl = null,
  onOpen = null,
}) {
  const score = agent.totalScore != null ? agent.totalScore.toFixed(1) : null;

  return (
    <div className="bg-white dark:bg-[#1E293B] rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow flex flex-col overflow-hidden">
      <div
        className={`p-6 flex-1 ${onOpen ? 'cursor-pointer' : ''}`}
        onClick={onOpen ? () => onOpen(agent) : undefined}
      >
        <div className="flex justify-between items-start mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <AgentAvatar agent={agent} size={40} />
            <div className="min-w-0">
              <span className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider mb-1 block truncate">
                {agent.category || 'Unclassified'}
              </span>
              <h3 className="text-lg font-bold leading-snug break-words">
                {agent.name || 'Unnamed agent'}
              </h3>
            </div>
          </div>
          <span className="shrink-0 text-[10px] font-medium px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {agent.network}
          </span>
        </div>

        {agent.serviceStatus && agent.serviceStatus !== 'unknown' && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} />
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 p-3 mb-5 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800/50">
          <Stat
            label="Score"
            value={score}
            hint="How trustworthy this agent looks, based on past feedback"
          />
          <Stat
            label="Stars"
            value={agent.starCount}
            hint="How many people rated this agent"
            bordered
          />
          <Stat
            label="Funds"
            value={null}
            unavailableReason={
              'Funds under management comes from the DefiLlama enrichment, which runs over the '
              + 'BNB Chain serving collection. DefiLlama does cover this chain, but the per-agent '
              + 'figure has not been computed here yet.'
            }
            bordered
          />
        </div>

        {/* The BNB card shows an ERC-8183 hire record here. That contract is
            BNB Chain only, so on other chains this states the budget position
            instead, which is the hire path that genuinely exists here. */}
        <div
          className="mb-4 text-[11px] text-gray-500 dark:text-gray-400"
          title={
            'Hiring on this chain runs through AgentBudgetEscrow. The ERC-8183 job history shown '
            + 'on BNB Chain cannot exist here, because that contract is deployed on BNB Chain only.'
          }
        >
          <span className="text-gray-400 dark:text-gray-500">No budget history yet</span>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-3">
          {agent.strategy || 'No description provided.'}
        </p>

        {/* How someone actually uses this agent. On the card the second line
            is suppressed: one sentence is the point here, and the agent's own
            page carries the rest. */}
        <InteractionLine interaction={agent.interaction} showDetail={false} className="mt-3" />

        <div className="flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-500 mt-4">
          {agent.tokenId != null && <span className="font-mono">#{agent.tokenId}</span>}
          {agent.totalFeedbacks > 0 && <span>{agent.totalFeedbacks} on-chain feedback</span>}
          {explorerUrl && agent.ownerAddress && (
            <a
              href={`${explorerUrl}${agent.ownerAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 hover:text-indigo-500 ml-auto"
            >
              Owner
            </a>
          )}
        </div>
      </div>

      {/* The action, in its own footer band, matching the BNB card.
          It NAVIGATES to the agent's own page rather than opening a hire
          panel inside the card. The panel used to expand here, which put a
          funding form inside a grid cell: amount fields, draw limits and the
          chain-switch step all had to fit in a column beside two other
          agents. Hiring is a decision that deserves the whole page, and it is
          the same page a click on the agent itself opens, so a card now has
          one destination rather than two different behaviours. */}
      <div className="p-5 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-800">
        <button
          type="button"
          onClick={onOpen ? () => onOpen(agent) : undefined}
          disabled={!onOpen}
          className="block w-full text-center py-3 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 transition-all shadow-sm disabled:opacity-50"
        >
          Hire this agent
        </button>
      </div>
    </div>
  );
}
