// AgentInvestigationSection.jsx
//
// Real, unified "Agent Investigation" section — replaces what used to be
// six separately-bordered, separately-captioned panels (Past Hires,
// Revenue Stream, PnL, Historical On-chain Performance, TermiX
// cross-reference) with ONE coherent system, organized into four real,
// clearly-defined parameters:
//
//   DELIVERY RECORD          — has this agent actually delivered real,
//                               paid work, and how much has it earned
//                               doing so (real hire count/completion
//                               rate + real cumulative $U earnings).
//   FINANCIAL TRACK RECORD   — for Trading & DeFi agents only: did a
//                               real hire's own funding wallet end up
//                               ahead or behind (the real, simple,
//                               primary signal), plus an optional,
//                               secondary view of the agent's own
//                               independent on-chain trading activity.
//   INDEPENDENT CORROBORATION — a real, second opinion from outside this
//                               marketplace (TermiX's own registry), plus
//                               opt-in access to the full real wallet
//                               portfolio and complete on-chain history.
//   LIVE STATUS               — is this agent's own endpoint reachable
//                               right now, and does it actually speak
//                               this marketplace's real escrow protocol.
//
// Real, deliberate correction (2026-08-28): every one of these signals
// reads from the same real blockchain (directly, or via a real indexer —
// Zerion, 8004scan, TermiX, or this project's own on-chain scans). There
// is no real, meaningful "our data" vs "real blockchain data" distinction
// to draw, and this component never implies one — every real number here
// is on-chain-derived; what differs between the four groups above is
// WHICH real, on-chain question each one answers, not how "real" the
// underlying source is.
//
// Real, always-fresh loading discipline (useResilientFetch.js): every
// real fetch here shows its last known-good real result instantly on
// re-mount, refreshes silently in the background, and retries with real
// backoff before ever surfacing an error — the same confirmedFresh
// pattern the marketplace's own agent list already uses server-side.
//
// Shared verbatim by web and mobile.

import React, { useState } from 'react';
import {
  Activity, Coins, TrendingUp, TrendingDown, ShieldQuestion, ShieldCheck, AlertTriangle,
  ChevronDown, Loader2, Radio, Wallet, Blocks,
} from 'lucide-react';
import { useResilientFetch } from './useResilientFetch';
import { useEscrowCompatibility } from './EscrowCompatibilityWarning';
import { groupForCategory } from './categoryGroups';
import { getReliabilityHint } from './agentReliability';
import AgentGuidancePanel from './AgentGuidancePanel';
import WalletPortfolioPanel from './WalletPortfolioPanel';
import OnchainHistoryPanel from './OnchainHistoryPanel';
import ServiceHealthBadge from './ServiceHealthBadge';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const FUND_PERFORMANCE_GROUP = 'trading-defi';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function fmtAmount(v, digits = 4) {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

function SectionHeader({ icon: Icon, title, hint }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon size={13} className="text-indigo-500 shrink-0" />
      <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</span>
      {hint && <span className="text-[10px] text-gray-400 font-normal normal-case" title={hint}>ⓘ</span>}
    </div>
  );
}

// ── DELIVERY RECORD ──────────────────────────────────────────────────
function DeliveryRecord({ agent, onTrySkill, escrowIncompatible }) {
  const ownerAddress = agent.ownerAddress;
  const perf = useResilientFetch(
    ownerAddress ? `${API_BASE_URL}/api/agents/performance?owner_address=${ownerAddress}` : null,
    () => fetchJson(`${API_BASE_URL}/api/agents/performance?owner_address=${ownerAddress}`),
    { enabled: !!ownerAddress },
  );
  const revenue = useResilientFetch(
    ownerAddress ? `${API_BASE_URL}/api/agents/revenue?owner_address=${ownerAddress}` : null,
    () => fetchJson(`${API_BASE_URL}/api/agents/revenue?owner_address=${ownerAddress}`),
    { enabled: !!ownerAddress },
  );

  if (!ownerAddress) return null;
  const p = perf.data;
  const r = revenue.data;

  // Real, honest first-load state — only while we have genuinely nothing
  // cached yet for either real fetch (a real re-visit shows the last
  // known-good numbers instantly instead of this).
  if (perf.status === 'loading' && !p) {
    return (
      <div>
        <SectionHeader icon={Activity} title="Delivery Record" />
        <div className="flex items-center gap-2 text-gray-400 text-xs"><Loader2 size={13} className="animate-spin" /> Checking this agent's real on-chain delivery history…</div>
      </div>
    );
  }

  if (!p || !p.hired) {
    return (
      <div>
        <SectionHeader icon={Activity} title="Delivery Record" />
        <AgentGuidancePanel agent={agent} mutedBorder="border-gray-200 dark:border-gray-800" onTrySkill={onTrySkill} />
        {p && (
          <p className="text-[10px] text-gray-400 mt-1.5">
            {escrowIncompatible
              ? "This agent doesn't operate through Tnega's on-chain escrow, so no real delivery history is expected here — see Live Status below."
              : (p.note || 'No real delivery history found for this agent yet — it may just be new.')}
          </p>
        )}
      </div>
    );
  }

  const hint = getReliabilityHint(p);
  const earned = r?.has_earnings;

  return (
    <div>
      <SectionHeader icon={Activity} title="Delivery Record" />
      <div className="p-4 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/60 dark:bg-indigo-500/5">
        <div className="grid grid-cols-3 gap-3 mb-2">
          <div title="How many times people have hired this agent"><div className="text-[10px] uppercase text-gray-500">Times Hired</div><div className="text-lg font-bold" style={{ color: '#4F46E5' }}>{p.hire_count}</div></div>
          <div title="Out of the jobs that finished, how many were successfully completed"><div className="text-[10px] uppercase text-gray-500">Success Rate</div><div className="text-lg font-bold">{p.completion_rate != null ? `${Math.round(p.completion_rate * 100)}%` : '—'}</div></div>
          <div title="Real, cumulative $U earned as a provider — this agent's complete real job history, not a recent window"><div className="text-[10px] uppercase text-gray-500">Earned</div><div className="text-lg font-bold">{earned ? `${fmtAmount(r.total_earned)} ${r.token_symbol}` : '—'}</div></div>
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400" title="Rejected means the buyer wasn't happy with the finished work. Timed out means the agent never finished before the deadline.">
          Finished {p.completed} · Rejected {p.rejected} · Missed deadline {p.expired}{p.completion_rate == null ? ' — none finished yet' : ''}. {p.note}
        </div>
        {hint && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-800 dark:text-amber-300">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>{hint.message}</span>
          </div>
        )}
        {earned && r.timeline?.length > 0 && (
          <div className="mt-3 pt-3 border-t border-indigo-100 dark:border-indigo-500/10 space-y-1 max-h-32 overflow-y-auto">
            {r.timeline.slice().reverse().slice(0, 8).map((t) => (
              <div key={t.job_id} className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                <span>Job #{t.job_id}{t.status === 'SUBMITTED' && ' · pending settlement'}</span>
                <span className="font-mono">+{fmtAmount(t.amount)} {r.token_symbol}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── FINANCIAL TRACK RECORD (Trading & DeFi only) ────────────────────
function FinancialTrackRecord({ ownerAddress, agentId, category }) {
  const [showSecondary, setShowSecondary] = useState(false);
  const eligible = groupForCategory(category) === FUND_PERFORMANCE_GROUP;
  // Real, confirmed bug fix (2026-08-28): agent_id disambiguates which
  // specific real agent this is, for the same real reason documented in
  // server.py's _resolve_agent — owner_address alone is genuinely
  // ambiguous whenever one real owner has more than one registered agent.
  const idQs = agentId ? `&agent_id=${agentId}` : '';

  const pnl = useResilientFetch(
    eligible && ownerAddress ? `${API_BASE_URL}/api/agents/pnl-summary?owner_address=${ownerAddress}${idQs}` : null,
    () => fetchJson(`${API_BASE_URL}/api/agents/pnl-summary?owner_address=${ownerAddress}${idQs}`),
    { enabled: eligible && !!ownerAddress },
  );
  const onchain = useResilientFetch(
    showSecondary && eligible && ownerAddress ? `${API_BASE_URL}/api/agents/onchain-performance?owner_address=${ownerAddress}${idQs}` : null,
    () => fetchJson(`${API_BASE_URL}/api/agents/onchain-performance?owner_address=${ownerAddress}${idQs}`),
    { enabled: showSecondary && eligible && !!ownerAddress },
  );

  if (!eligible || !ownerAddress) return null;
  const d = pnl.data;

  return (
    <div>
      <SectionHeader icon={TrendingUp} title="Financial Track Record" hint="Real on-chain balance of the hiring wallet, before vs. after — the simplest, most direct real signal for a fund-managing agent." />
      {pnl.status === 'loading' && !d ? (
        <div className="flex items-center gap-2 text-gray-400 text-xs"><Loader2 size={12} className="animate-spin" /> Checking real hire outcomes…</div>
      ) : !d || !d.jobs?.length ? (
        <p className="text-[11px] text-gray-400">{d?.reason || 'No real, delivered Trading & DeFi hires yet to measure.'}</p>
      ) : (
        <div className="p-3 rounded-xl border border-emerald-100 dark:border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-500/5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
              {d.total_pnl_usd != null && d.total_pnl_usd >= 0 ? <TrendingUp size={12} className="text-emerald-500" /> : <TrendingDown size={12} className="text-red-500" />}
              Real hiring-wallet balance change
            </span>
            {d.total_pnl_usd != null && (
              <span className={`text-sm font-mono font-bold ${d.total_pnl_usd >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                {d.total_pnl_usd >= 0 ? '+' : ''}${d.total_pnl_usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-400">
            The real wallet that funded {d.jobs.filter((j) => j.available).length > 1 ? 'these hires' : 'this hire'}, balance before vs. after — never a creator-submitted or backtested number.
          </p>
          {d.reason && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">{d.reason}</p>}
        </div>
      )}

      <button onClick={() => setShowSecondary((v) => !v)} className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
        {showSecondary ? 'Hide' : 'Show'} this agent's own independent on-chain trading activity <ChevronDown size={10} className={`transition-transform ${showSecondary ? 'rotate-180' : ''}`} />
      </button>
      {showSecondary && (
        <div className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          {onchain.status === 'loading' && !onchain.data ? (
            <div className="flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Checking…</div>
          ) : !onchain.data?.has_activity ? (
            <p className="text-gray-400">{onchain.data?.reason || 'No independent real DeFi execution activity found.'}</p>
          ) : (
            <p>{onchain.data.defi_tx_count} real DeFi transaction{onchain.data.defi_tx_count === 1 ? '' : 's'} found, independent of any hire{onchain.data.real_protocols_seen?.length > 0 && ` (${onchain.data.real_protocols_seen.join(', ')})`}. {onchain.data.pnl ? `${onchain.data.pnl.pnl_usd >= 0 ? '+' : ''}$${onchain.data.pnl.pnl_usd.toFixed(2)} over that window.` : onchain.data.pnl_reason}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── INDEPENDENT CORROBORATION ────────────────────────────────────────
function IndependentCorroboration({ ownerAddress, agentId, category }) {
  const [showMore, setShowMore] = useState(false);
  // Real, confirmed bug fix (2026-08-28) — see FinancialTrackRecord above.
  const idQs = agentId ? `&agent_id=${agentId}` : '';
  const termix = useResilientFetch(
    ownerAddress ? `${API_BASE_URL}/api/agents/termix-performance?owner_address=${ownerAddress}${idQs}` : null,
    () => fetchJson(`${API_BASE_URL}/api/agents/termix-performance?owner_address=${ownerAddress}${idQs}`),
    { enabled: !!ownerAddress },
  );

  if (!ownerAddress) return null;
  const t = termix.data;

  return (
    <div>
      <SectionHeader icon={ShieldQuestion} title="Independent Corroboration" hint="A second, real opinion from outside this marketplace — never blended into this marketplace's own numbers." />
      {termix.status === 'loading' && !t ? (
        <div className="flex items-center gap-2 text-gray-400 text-xs"><Loader2 size={12} className="animate-spin" /> Checking TermiX's real registry…</div>
      ) : t?.available ? (
        <div className="flex items-center gap-4 flex-wrap text-[11px]">
          <div title="Real completed jobs TermiX's own registry has recorded for this agent — a real, differently-scoped data point, not a complete protocol-wide total"><span className="text-base font-bold" style={{ color: '#4F46E5' }}>{t.completed_jobs}</span> <span className="text-[10px] text-gray-500 uppercase">completed (via TermiX)</span></div>
          <div title="TermiX's own real reputation score (0–100)"><span className="text-base font-bold">{t.reputation_score ?? '—'}</span> <span className="text-[10px] text-gray-500 uppercase">reputation</span></div>
        </div>
      ) : (
        <p className="text-[11px] text-gray-400">No TermiX data for this agent{t?.reason ? ` — ${t.reason}` : '.'}</p>
      )}

      <button onClick={() => setShowMore((v) => !v)} className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
        {showMore ? 'Hide' : 'Show'} full real wallet portfolio &amp; complete on-chain history <ChevronDown size={10} className={`transition-transform ${showMore ? 'rotate-180' : ''}`} />
      </button>
      {showMore && (
        <div className="mt-1.5 space-y-2">
          <WalletPortfolioPanel ownerAddress={ownerAddress} category={category} />
          <OnchainHistoryPanel ownerAddress={ownerAddress} />
        </div>
      )}
    </div>
  );
}

// ── LIVE STATUS ───────────────────────────────────────────────────────
function LiveStatus({ agent, escrowData }) {
  return (
    <div>
      <SectionHeader icon={Radio} title="Live Status" hint="Is this agent reachable right now, and does it actually speak this marketplace's real escrow protocol." />
      <div className="flex items-center gap-3 flex-wrap">
        <ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} size="md" />
        {escrowData?.escrow_incompatible ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400">
            <AlertTriangle size={10} /> Doesn't speak this marketplace's escrow protocol
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            <ShieldCheck size={10} /> Speaks this marketplace's real escrow protocol
          </span>
        )}
      </div>
      {escrowData?.escrow_incompatible && (
        <p className="text-[10px] text-gray-400 mt-1.5">See below for a real, direct link to this agent's own site instead of hiring it here.</p>
      )}
    </div>
  );
}

// ── The unified section ──────────────────────────────────────────────
export default function AgentInvestigationSection({ agent, onTrySkill }) {
  const { data: escrowData } = useEscrowCompatibility(agent.ownerAddress, agent.id);

  return (
    <div className="mt-6 space-y-5">
      <h3 className="text-sm font-bold flex items-center gap-1.5"><Blocks size={14} /> Agent Investigation</h3>
      <DeliveryRecord agent={agent} onTrySkill={onTrySkill} escrowIncompatible={escrowData?.escrow_incompatible} />
      <FinancialTrackRecord ownerAddress={agent.ownerAddress} agentId={agent.id} category={agent.category} />
      <IndependentCorroboration ownerAddress={agent.ownerAddress} agentId={agent.id} category={agent.category} />
      <LiveStatus agent={agent} escrowData={escrowData} />
    </div>
  );
}
