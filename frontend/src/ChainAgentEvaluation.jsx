// ChainAgentEvaluation.jsx
//
// The evaluation for a non-BSC agent, from the sources verified to
// work on its chain.
//
// These views used to be thin because only BSC's sources were wired up, not
// because the data was missing. Most of that gap was unused capability:
// 8004scan's Quality Center answers on every chain (it was assumed BSC-only
// and is not), Zerion covers all six, owner balances come free from the RPC
// we already run, and contract verification works through Etherscan V2's
// chainid. Only the ERC-8183 signals are genuinely BSC-exclusive, because
// that contract exists on chains 56 and 97 and nowhere else.
//
// Loaded on demand, per agent. Each source is rendered independently and
// reports its own availability, because "we couldn't read this" and "this
// agent scored nothing" are completely different statements and the
// Quality Center endpoint returns intermittent 500s. A failure must never
// be drawn as a zero the agent didn't earn.

import React, { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldAlert, Wallet, Gauge, AlertTriangle, Info } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const SEVERITY = {
  high: 'text-red-600 dark:text-red-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-gray-500',
};

export default function ChainAgentEvaluation({ chainId, tokenId, ownerAddress }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    if (chainId == null || tokenId == null) return undefined;
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    const q = ownerAddress ? `?owner=${encodeURIComponent(ownerAddress)}` : '';
    fetch(`${API_BASE_URL}/api/chain-agent/${chainId}/${tokenId}/evaluation${q}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) setState({ loading: false, data: d, error: null }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, data: null, error: e.message }); });
    return () => { cancelled = true; };
  }, [chainId, tokenId, ownerAddress]);

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-[12px] text-gray-500">
        <Loader2 size={13} className="animate-spin" /> Checking this agent across every source that covers its chain…
      </div>
    );
  }
  if (state.error) {
    return <div className="py-3 text-[12px] text-gray-500">Couldn't load the evaluation ({state.error}).</div>;
  }

  const d = state.data;
  if (!d) return null;
  const { quality, balance, portfolio, verification } = d;

  return (
    <div className="space-y-3">
      {/* Quality Center, the biggest single addition for non-BSC agents. */}
      <Section icon={Gauge} title="Quality score" sub="8004scan's own independent scoring">
        {!quality.available ? (
          <Unavailable reason={quality.reason} />
        ) : !quality.scored ? (
          <p className="text-[11px] text-gray-500">
            8004scan hasn't scored this agent yet. That's not a low score, it's no score, and it
            says nothing about the agent either way.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-xl font-bold tabular-nums">{Number(quality.total_score).toFixed(1)}</span>
              <span className="text-[10px] text-gray-500">/ 100</span>
            </div>
            <div className="space-y-1">
              {quality.dimensions.filter((x) => x.score != null).map((x) => (
                <div key={x.key} className="flex items-center gap-2">
                  <span className="text-[11px] w-24 shrink-0 text-gray-600 dark:text-gray-400">{x.label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, x.score)}%` }} />
                  </div>
                  <span className="text-[10px] tabular-nums w-8 text-right text-gray-500">{Math.round(x.score)}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {quality.available && quality.risk_flags?.length > 0 && (
          <div className="mt-2.5 space-y-1">
            {quality.risk_flags.map((f) => (
              <div key={f.id} className="flex items-start gap-1.5">
                <AlertTriangle size={10} className={`shrink-0 mt-[3px] ${SEVERITY[f.severity] || SEVERITY.low}`} />
                <span className="text-[11px] text-gray-600 dark:text-gray-400">
                  <span className="font-medium">{f.title}</span>, {f.description}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={Wallet} title="Owner wallet" sub="read from this chain directly">
        <div className="space-y-1 text-[11px]">
          {balance.available ? (
            <Row label="Native balance" value={`${Number(balance.balance).toFixed(6)} ${balance.symbol}`} />
          ) : <Unavailable reason={balance.reason} />}
          {portfolio?.available ? (
            <Row
              label="Portfolio on this chain"
              value={`$${Number(portfolio.total_usd_value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              hint={`${(portfolio.positions || []).length} position(s), via Zerion`}
            />
          ) : <Unavailable reason={portfolio?.reason} />}
        </div>
      </Section>

      <Section icon={verification?.verified ? ShieldCheck : ShieldAlert} title="Owner address" sub="checked on this chain's own explorer">
        {verification?.is_contract === null ? (
          <Unavailable reason={verification?.reason} />
        ) : verification?.is_contract === false ? (
          <p className="text-[11px] text-gray-600 dark:text-gray-400">A plain wallet, not a contract.</p>
        ) : verification?.verified === true ? (
          <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
            Verified contract{verification.contract_name ? `: ${verification.contract_name}` : ''}
            {verification.is_proxy ? ' (proxy)' : ''}. Its source can be read on the explorer.
          </p>
        ) : verification?.verified === false ? (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            This owner operates through an <strong>unverified</strong> contract, its behaviour can't be
            independently audited.
          </p>
        ) : <Unavailable reason={verification?.reason} />}
      </Section>

      {/* Stated, not omitted. An absent escrow section would read as an
          oversight; the reason is a property of the protocol. */}
      {!d.erc8183_applicable && (
        <div className="flex items-start gap-1.5 text-[11px] text-gray-500 pt-1">
          <Info size={11} className="shrink-0 mt-0.5" />
          <span>
            Escrow compatibility, delivery record and canary results aren't shown: they all read from
            the ERC-8183 contract, which is deployed on BNB Smart Chain only.
            {!d.graph_applicable && ' Subgraph provenance is BNB-only for the same kind of reason, the Agent0 subgraph indexes that chain alone.'}
          </span>
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, sub, children }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={12} className="text-indigo-500 shrink-0" />
        <span className="text-[12px] font-semibold">{title}</span>
        <span className="text-[10px] text-gray-400">· {sub}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, hint }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
      <span className="text-right">
        <span className="font-medium tabular-nums">{value}</span>
        {hint && <span className="block text-[10px] text-gray-400">{hint}</span>}
      </span>
    </div>
  );
}

/** "We couldn't read this", deliberately distinct from a zero or an
 *  absence, since the sources behind this view fail intermittently. */
function Unavailable({ reason }) {
  return (
    <p className="text-[11px] text-gray-500">
      Couldn't read this right now{reason ? ` (${reason})` : ''}. Nothing is implied about the agent.
    </p>
  );
}
