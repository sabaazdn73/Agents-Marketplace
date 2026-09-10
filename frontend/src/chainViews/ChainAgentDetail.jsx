// ChainAgentDetail.jsx
//
// One agent's own page, for a chain whose agents can be hired.
//
// Modelled on the BNB Chain agent page, which was read in the browser before
// this was written rather than guessed at. That page is a real route, so it
// survives a refresh, and it carries, in order: a back link to the
// marketplace and a share link, then the agent's header with its score block,
// its live status, where its endpoint is, what it is, who owns it and what
// that wallet holds, then the hire action, then the evaluation.
//
// The same order is kept here on purpose. Someone who has looked at a BNB
// agent should not have to relearn the page on Arbitrum.
//
// What differs is only what the chain can actually answer. The BNB page shows
// an ERC-8183 delivery record and an escrow-protocol badge; neither can exist
// off BNB Chain, so instead of leaving a hole this page shows the budget
// position and the capabilities panel states, per signal, what cannot be
// checked here and why. A gap with a reason reads as honest. A gap with
// nothing reads as broken.

import React, { useEffect, useState } from 'react';
import {
  ChevronRight, Link2, Loader2, RefreshCw, Wallet, ExternalLink,
} from 'lucide-react';
import AgentAvatar from '../AgentAvatar';
import ServiceHealthBadge from '../ServiceHealthBadge';
import ChainAgentEvaluation from '../ChainAgentEvaluation';
import BudgetHirePanel from '../BudgetHirePanel';
import InteractionLine from '../InteractionLine';
import { copyShareLink } from '../shareLink';
import { normalizeChainAgent } from './normalizeChainAgent';
import { ChainCapabilities, EXPLORER_BASE } from './ChainViewShared';
import { chainName, nativeSymbol } from '../chainContracts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

/** The agent's own URL. A real path, so a refresh reopens this page rather
 *  than dropping someone back on the marketplace.
 *
 *  Deliberately NOT the BNB `/agent/<id>` shape. That resolver reads a single
 *  segment and looks it up in the fully-loaded BSC list; a chain agent needs
 *  its chain to be identified too, and reusing the same prefix would send
 *  these ids into a resolver that cannot answer them. */
export function chainAgentPath(chainId, tokenId) {
  return `/chain-agent/${chainId}/${encodeURIComponent(tokenId)}`;
}

export function readChainAgentRoute(pathname = window.location.pathname) {
  const m = pathname.match(/^\/chain-agent\/(\d+)\/([^/?#]+)/);
  return m ? { chainId: Number(m[1]), tokenId: decodeURIComponent(m[2]) } : null;
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800/50 p-4 text-center" title={hint}>
      <span className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</span>
      <span className="font-bold text-lg text-gray-900 dark:text-white">
        {value ?? <span className="text-gray-400 font-normal text-base">n/a</span>}
      </span>
    </div>
  );
}

export default function ChainAgentDetail({ chainId, tokenId, onBack }) {
  const [state, setState] = useState({ loading: true, agent: null, error: null });
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true); else setState((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(`${API_BASE_URL}/api/chain-agent/${chainId}/${tokenId}`);
      if (!res.ok) throw new Error(res.status === 404 ? 'This agent is not in our store.' : `HTTP ${res.status}`);
      const d = await res.json();
      setState({ loading: false, agent: d, error: null });
    } catch (e) {
      setState({ loading: false, agent: null, error: e.message });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [chainId, tokenId]);

  const onShare = async () => {
    const ok = await copyShareLink(`${window.location.origin}${chainAgentPath(chainId, tokenId)}`);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  };

  if (state.loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" /> Loading agent…
      </div>
    );
  }

  if (state.error || !state.agent) {
    return (
      <div className="max-w-3xl mx-auto mt-4 text-center py-20">
        <p className="font-semibold mb-1">Couldn&apos;t load this agent</p>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">{state.error}</p>
        <button onClick={onBack} className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          Back to Marketplace
        </button>
      </div>
    );
  }

  const raw = state.agent;
  const a = normalizeChainAgent(raw);
  const explorer = EXPLORER_BASE[chainId];
  const symbol = nativeSymbol(chainId);

  return (
    <div className="max-w-3xl mx-auto mt-4">
      {/* Back and share, the same two controls in the same two corners as the
          BNB agent page. Refresh sits with them because this page is the one
          place a live status is worth re-reading without losing your place. */}
      <div className="flex items-center justify-between mb-6 gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ChevronRight size={16} className="rotate-180" /> Back to Marketplace
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            title="Re-read this agent without leaving the page"
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={onShare} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
            <Link2 size={14} /> {copied ? 'Link copied!' : 'Share this agent'}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-[#1E293B] rounded-3xl p-8 border border-gray-200 dark:border-gray-800 shadow-xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-4 min-w-0">
            <AgentAvatar agent={a} size={56} />
            <div className="min-w-0">
              <h2 className="text-2xl font-bold break-words">{a.name || 'Unnamed agent'}</h2>
              <span className="text-[11px] text-indigo-500 uppercase font-semibold tracking-wider">
                {a.category || 'Unclassified'}
              </span>
            </div>
          </div>
          <span className="shrink-0 text-[10px] font-medium px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {chainName(chainId)}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Score" value={a.totalScore != null ? a.totalScore.toFixed(1) : null}
                hint="How trustworthy this agent looks, based on past feedback" />
          <Stat label="Stars" value={a.starCount} hint="How many people rated this agent" />
          <Stat label="On-chain feedback" value={a.totalFeedbacks} hint="Feedback entries recorded on chain" />
          <Stat label="Funds" value={null}
                hint="Funds under management comes from the DefiLlama enrichment that runs over the BNB serving collection. DefiLlama covers this chain, but the per-agent figure has not been computed here yet." />
        </div>

        {a.serviceStatus && a.serviceStatus !== 'unknown' && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <ServiceHealthBadge status={a.serviceStatus} checkedAt={a.serviceCheckedAt} />
          </div>
        )}

        {raw.service_endpoint && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-5 break-all">
            Where we check on it: <span className="font-mono">{raw.service_endpoint}</span>
          </p>
        )}

        {/* Same sentence as the card, from the same component, with the
            second line kept here because there is room for it. */}
        <InteractionLine interaction={raw.interaction} className="mb-5" />

        <h3 className="font-bold mb-2">About</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
          {a.strategy || 'No description provided.'}
        </p>

        <h3 className="font-bold mb-2">Who owns this agent</h3>
        {a.ownerAddress ? (
          <>
            {explorer ? (
              <a href={`${explorer}${a.ownerAddress}`} target="_blank" rel="noopener noreferrer"
                 className="text-sm font-mono text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 break-all">
                {a.ownerAddress} <ExternalLink size={11} className="shrink-0" />
              </a>
            ) : (
              <span className="text-sm font-mono break-all">{a.ownerAddress}</span>
            )}
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 mb-6">
              This is the agent creator&apos;s wallet ID. A public account number anyone can look up.
              Its balance and history are read live in the evaluation below.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500 mb-6">No owner address on record for this agent.</p>
        )}

        <h3 className="font-bold mb-1 flex items-center gap-2"><Wallet size={15} /> Hire this agent</h3>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
          Hiring here funds a budget in {symbol} on {chainName(chainId)}, and the agent draws
          against it as it works. You can revoke the remainder at any time.
        </p>
        <BudgetHirePanel agent={a} requiredChainId={chainId} />

        <div className="mt-8">
          <h3 className="font-bold mb-3">How this agent evaluates</h3>
          <ChainAgentEvaluation chainId={chainId} tokenId={tokenId} ownerAddress={a.ownerAddress} />
        </div>

        <div className="mt-6">
          <ChainCapabilities capabilities={raw.capabilities} />
        </div>
      </div>
    </div>
  );
}
