// UniversalSearchFallback.jsx
//
// Real, live search fallback (2026-08-29) — see docs/universal-search.md
// for the full real investigation and reasoning. The marketplace's own
// search is a plain client-side name filter over the local known_agents
// cache; when that comes up empty for input that looks like a real agent
// id or a 0x address, this component makes a real, live call
// (GET /api/search/resolve) to the authoritative source instead of
// leaving the user at a dead "no agents found". Shared verbatim by web
// and mobile.
//
// Deliberately narrow trigger: only fires for input that already looks
// like an agent id (a plain number, or 8004scan's own internal UUID) or
// an address (0x...) — mirrors the backend's own classify_query exactly,
// so an ordinary mistyped name search never triggers a live network call,
// it just falls through to the plain "no agents match" message the
// caller already shows.

import React, { useEffect, useState } from 'react';
import { Loader2, ExternalLink, Wallet, FileCode2, Coins, ShieldQuestion, Search } from 'lucide-react';
import { explorerLinkForWallet } from './altana';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const _ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const _NUMERIC_ID_RE = /^\d+$/;

/** Real, cheap, client-side mirror of the backend's own classify_query —
 * never guesses at free text, only recognizes these three structured
 * shapes, so a plain mistyped name search never fires a live call. */
function classifyQuery(raw) {
  const q = (raw || '').trim();
  if (_ADDRESS_RE.test(q)) return 'address';
  if (_UUID_RE.test(q)) return 'uuid';
  if (_NUMERIC_ID_RE.test(q)) return 'token_id';
  return 'unrecognized';
}

function useSearchFallback(query) {
  const kind = classifyQuery(query);
  const [state, setState] = useState({ status: 'idle' });

  useEffect(() => {
    if (kind === 'unrecognized') { setState({ status: 'idle' }); return undefined; }
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`${API_BASE_URL}/api/search/resolve?q=${encodeURIComponent(query.trim())}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setState({ status: 'ready', data }); })
      .catch((e) => { if (!cancelled) setState({ status: 'error', message: e.message || String(e) }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind]);

  return { kind, ...state };
}

function Card({ mutedBorder, children }) {
  return <div className={`rounded-2xl border p-5 ${mutedBorder}`}>{children}</div>;
}

function OpenAgentButton({ agent, accent, onOpenAgent }) {
  if (!agent || !onOpenAgent) return null;
  return (
    <button
      onClick={() => onOpenAgent(agent)}
      className="mt-3 px-4 py-2 rounded-xl text-xs font-semibold text-white"
      style={{ background: accent }}
    >
      Open this agent
    </button>
  );
}

/** `agentsWithPerf`: the already-fetched, full local agent list — used to
 * resolve a real, local hit back to the FULL agent object this app's own
 * detail view expects (the search endpoint's own response is a compact
 * summary, not the enriched shape agentsWithPerf carries). `onOpenAgent`:
 * open the real detail view for a resolved local agent, same as clicking
 * its card normally would. */
export default function UniversalSearchFallback({ query, agentsWithPerf, onOpenAgent, accent, mutedBorder, darkMode, plainEmptyMessage }) {
  const { kind, status, data, message } = useSearchFallback(query);

  // Real, plain fallback — input that doesn't look like an id/address at
  // all (an ordinary mistyped name) never triggers a live call, but still
  // gets a real, honest message instead of a silent empty grid.
  if (kind === 'unrecognized') {
    return plainEmptyMessage ? (
      <Card mutedBorder={mutedBorder}>
        <div className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-300">
          <Search size={18} className="text-gray-400 shrink-0 mt-0.5" />
          <div>{plainEmptyMessage}</div>
        </div>
      </Card>
    ) : null;
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <Card mutedBorder={mutedBorder}>
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Not in our list yet — checking live against the real, authoritative source…
        </div>
      </Card>
    );
  }

  if (status === 'error') {
    return (
      <Card mutedBorder={mutedBorder}>
        <div className="text-sm text-red-600 dark:text-red-400">Couldn't complete a live check right now: {message}. Try again shortly.</div>
      </Card>
    );
  }

  // status === 'ready' from here on.
  if (!data.found) {
    return (
      <Card mutedBorder={mutedBorder}>
        <div className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-300">
          <ShieldQuestion size={18} className="text-gray-400 shrink-0 mt-0.5" />
          <div>{data.reason}</div>
        </div>
      </Card>
    );
  }

  // A real agent id/UUID that IS in our local index, just not matched by
  // the name-text filter (e.g. searched by id, not name) — resolve to the
  // full local object and offer to open it directly, no extra network call.
  if ((data.input_kind === 'token_id' || data.input_kind === 'uuid') && data.source === 'local') {
    const full = (agentsWithPerf || []).find((a) => a.id === data.agent?.id);
    return (
      <Card mutedBorder={mutedBorder}>
        <div className="flex items-start gap-2.5">
          <Search size={18} className="text-indigo-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold text-gray-900 dark:text-white">{data.agent?.name || 'This agent'}</div>
            <p className="text-gray-500 dark:text-gray-400 mt-0.5">Found by id in our own list — not matched by name search, but it's here.</p>
            <OpenAgentButton agent={full} accent={accent} onOpenAgent={onOpenAgent} />
          </div>
        </div>
      </Card>
    );
  }

  // A real, live, confirmed ERC-8004 agent — just not in our curated
  // marketplace listing (a brand-new registration, or filtered out by
  // this marketplace's own diversity limits).
  if (data.input_kind === 'token_id' && data.source === 'live_8004scan') {
    const a = data.agent || {};
    return (
      <Card mutedBorder={mutedBorder}>
        <div className="flex items-start gap-2.5">
          <Search size={18} className="text-indigo-500 shrink-0 mt-0.5" />
          <div className="text-sm flex-1">
            <div className="font-semibold text-gray-900 dark:text-white">{a.name || `Agent #${a.token_id}`}</div>
            {a.description && <p className="text-gray-600 dark:text-gray-300 mt-1">{a.description}</p>}
            <div className="mt-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300">
              Real, confirmed live against 8004scan's own registry — this agent just isn't in our curated marketplace listing yet.
            </div>
            {a.owner_address && (
              <a href={explorerLinkForWallet(a.owner_address)} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                Owner's real address on BscScan <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // A real, live 0x address the local search didn't recognize by name.
  if (data.input_kind === 'address') {
    if (data.registered_agent_owner) {
      const fulls = (data.agents || []).map((a) => (agentsWithPerf || []).find((x) => x.id === a.id)).filter(Boolean);
      return (
        <Card mutedBorder={mutedBorder}>
          <div className="flex items-start gap-2.5">
            <Wallet size={18} className="text-indigo-500 shrink-0 mt-0.5" />
            <div className="text-sm flex-1">
              <div className="font-semibold text-gray-900 dark:text-white">{data.reason}</div>
              <div className="mt-2 space-y-2">
                {(data.agents || []).map((a, i) => (
                  <div key={a.id} className={`flex items-center justify-between p-2.5 rounded-lg border ${mutedBorder}`}>
                    <span className="text-xs">{a.name || `Agent ${a.id}`}</span>
                    {fulls[i] && <OpenAgentButton agent={fulls[i]} accent={accent} onOpenAgent={onOpenAgent} />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      );
    }

    if (data.address_kind === 'wallet') {
      return (
        <Card mutedBorder={mutedBorder}>
          <div className="flex items-start gap-2.5">
            <Wallet size={18} className="text-gray-400 shrink-0 mt-0.5" />
            <div className="text-sm flex-1">
              <div className="font-semibold text-gray-900 dark:text-white">A real wallet — not a registered agent</div>
              <p className="text-gray-500 dark:text-gray-400 mt-0.5">{data.reason}</p>
              <div className="mt-2 text-xs space-y-1">
                {data.bnb_balance != null && <div><span className="opacity-60">Real BNB balance:</span> <span className="font-mono font-semibold">{data.bnb_balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} BNB</span></div>}
                {data.transaction_count != null && <div><span className="opacity-60">Real transaction count:</span> <span className="font-mono font-semibold">{data.transaction_count.toLocaleString()}</span></div>}
              </div>
              <a href={explorerLinkForWallet(query.trim())} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                Full activity on BscScan <ExternalLink size={11} />
              </a>
            </div>
          </div>
        </Card>
      );
    }

    // Contract.
    const Icon = data.contract_identity === 'token' ? Coins : FileCode2;
    return (
      <Card mutedBorder={mutedBorder}>
        <div className="flex items-start gap-2.5">
          <Icon size={18} className="text-gray-400 shrink-0 mt-0.5" />
          <div className="text-sm flex-1">
            <div className="font-semibold text-gray-900 dark:text-white">
              {data.contract_identity === 'token'
                ? (data.token_name || data.token_symbol || 'A real token contract')
                : (data.contract_identity || 'A real, unidentified smart contract')}
            </div>
            <p className="text-gray-500 dark:text-gray-400 mt-0.5">{data.reason}</p>
            {data.contract_identity === 'token' && (
              <div className="mt-2 text-xs space-y-1">
                {data.token_symbol && <div><span className="opacity-60">Symbol:</span> <span className="font-mono font-semibold">{data.token_symbol}</span></div>}
                {data.token_decimals != null && <div><span className="opacity-60">Decimals:</span> <span className="font-mono font-semibold">{data.token_decimals}</span></div>}
              </div>
            )}
            <a href={explorerLinkForWallet(query.trim())} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
              View this contract on BscScan <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </Card>
    );
  }

  return null;
}
