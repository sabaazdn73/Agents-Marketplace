// AgentMetrics.jsx
//
// Real, final, unified per-agent "Metrics" presentation — replaces the two
// separate sections this session built in sequence (AgentEvaluationSection,
// AgentInvestigationSection), consolidating them into ONE coherent block
// with a real, agent-nature-aware routing order, per the explicit design
// intent this was built against:
//
//   1. Agents that genuinely speak this marketplace's escrow protocol —
//      hireable directly, exactly as already built. No new logic here;
//      this file only repositions the existing "Hire this agent" block.
//   2. Agents that need a different interaction model — routed by the
//      real, evidence-based per-agent classification already built this
//      session (core/protocol_compat.py's escrow_incompatible/auth_gated/
//      different_protocol/offers_x402_alternative, all from a real, live
//      protocol probe against the agent's OWN endpoint — never a category
//      or reputation guess). See docs/agent-interaction-patterns.md and
//      docs/agent-interaction-patterns-audit.md for the full real
//      investigation and the real, ongoing marketplace-wide audit this
//      reads from.
//   3. Financial/pool/fund-management agents — real cash flow (Delivery
//      Record's cumulative $U earnings) and real profit (Financial Track
//      Record's wallet-balance PnL + independent on-chain execution
//      history), promoted to lead the metrics for this real category
//      group specifically, per the explicit instruction that this is
//      what should be shown for this agent nature.
//
// Real, deliberate ordering: the interaction-guidance block (can/should
// you hire this agent HERE, at all) now leads, before any metric —
// previously it was the LAST thing on the page, after four data panels,
// which meant a buyer had to scroll past "0 hires yet" for an agent that
// was never hireable through Tnega's escrow in the first place before
// reaching the one fact that actually explains why. Real, live-status
// guidance now also skips a real, duplicate paragraph the old
// AgentInvestigationSection's own Live Status block used to repeat
// verbatim under a different heading.
//
// Nothing underlying was rebuilt: every sub-component below
// (DeliveryRecord, FinancialTrackRecord, IndependentCorroboration,
// LiveStatusBadges, the three real CTA states) is the exact same real
// logic/hooks/endpoints AgentEvaluationSection.jsx and
// AgentInvestigationSection.jsx already had — this file is a real
// presentation-layer consolidation and reordering, not a new data
// pipeline, per the explicit "not a rebuild of any of it" instruction.
//
// Shared verbatim by web and mobile.

import React, { useState } from 'react';
import {
  Activity, Coins, TrendingUp, TrendingDown, ShieldQuestion, ShieldCheck, AlertTriangle,
  ChevronDown, Loader2, Radio, Blocks, ExternalLink, Zap, BarChart3,
} from 'lucide-react';
import { useResilientFetch } from './useResilientFetch';
import { useEscrowCompatibility, hostnameOf } from './EscrowCompatibilityWarning';
import { evaluateAgent, PRIMARY_CTA } from './agentEvaluation';
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

function X402Note({ show }) {
  if (!show) return null;
  return (
    <p className="text-[10px] text-gray-400 mt-2.5 flex items-center gap-1.5">
      <Zap size={10} className="shrink-0 text-amber-400" />
      This agent's own listing also mentions direct, pay-per-call (x402) access outside Tnega's escrow — check its own site for details.
    </p>
  );
}

// ── 1 & 2: REAL INTERACTION GUIDANCE (leads the section) ──────────────
// The real, per-agent, evidence-based routing: hireable here (group 1),
// hireable-with-a-real-caveat, or genuinely a different interaction model
// (group 2). Exactly the same real logic agentEvaluation.js/
// protocol_compat.py already compute — this only changes WHERE it renders.
function InteractionGuidance({ agent, evaluation, escrowData, onHire }) {
  const [showEvidence, setShowEvidence] = useState(false);

  if (evaluation.primaryCta === PRIMARY_CTA.HIRE) {
    return (
      <div>
        <p className="text-[10px] text-gray-400 mb-2 flex items-center gap-1.5">
          <ShieldCheck size={11} className="text-indigo-400 shrink-0" />
          Evaluated by real, on-chain job delivery — you pay through Tnega's escrow, and funds are only released once this agent actually delivers.
        </p>
        <button onClick={() => onHire(agent)} className="w-full py-4 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/25 transition-all text-sm tracking-wide">
          Hire this agent →
        </button>
        <X402Note show={evaluation.offersX402Alternative} />
      </div>
    );
  }

  if (evaluation.primaryCta === PRIMARY_CTA.HIRE_CAUTION) {
    return (
      <div>
        <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 mb-3">
          <div className="flex items-start gap-2.5">
            <ShieldQuestion size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              <p className="font-semibold mb-1">This agent's endpoint required credentials we don't have.</p>
              <p>We tested this agent's registered endpoint directly, and it requires an access credential (an API key or token) this marketplace doesn't hold. That's not a sign it's broken, but it may mean the agent never learns a job was funded without one. Some agents document a public way to get one (check the evidence below); others don't.</p>
              {escrowData?.evidence?.length > 0 && (
                <button onClick={() => setShowEvidence((v) => !v)} className="flex items-center gap-1 mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline">
                  {showEvidence ? 'Hide' : 'Show'} what we checked <ChevronDown size={11} className={`transition-transform ${showEvidence ? 'rotate-180' : ''}`} />
                </button>
              )}
              {showEvidence && (
                <ul className="mt-2 space-y-1 font-mono text-[10px] text-amber-700/80 dark:text-amber-400/80 break-all">
                  {escrowData.evidence.map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
        <button onClick={() => onHire(agent)} className="w-full py-4 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/25 transition-all text-sm tracking-wide">
          Hire this agent anyway →
        </button>
        <X402Note show={evaluation.offersX402Alternative} />
      </div>
    );
  }

  // Confirmed a different real interaction model — group 2.
  return (
    <div>
      <div className="p-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 mb-3">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="text-xs text-red-800 dark:text-red-300 leading-relaxed">
            <p className="font-semibold mb-1">This agent doesn't appear to operate through Tnega's on-chain escrow system.</p>
            {evaluation.differentProtocol ? (
              <p>We tested this agent's registered endpoint directly: it's a live, working service, just one that speaks a different protocol, not ERC-8183/A2A. If you fund a job here, no one may be listening for it in the shape this marketplace sends. Your payment would sit on hold until the deadline, with no way for this agent to actually deliver through Tnega specifically.</p>
            ) : (
              <p>We tested this agent's registered endpoint directly, and it rejected every job-protocol (ERC-8183/A2A) format we tried. If you fund a job here, no one may be listening for it. Your payment would sit on hold until the deadline, with no way for this agent to actually deliver.</p>
            )}
            {escrowData?.evidence?.length > 0 && (
              <button onClick={() => setShowEvidence((v) => !v)} className="flex items-center gap-1 mt-2 text-[11px] font-semibold text-red-700 dark:text-red-400 hover:underline">
                {showEvidence ? 'Hide' : 'Show'} what we checked <ChevronDown size={11} className={`transition-transform ${showEvidence ? 'rotate-180' : ''}`} />
              </button>
            )}
            {showEvidence && (
              <ul className="mt-2 space-y-1 font-mono text-[10px] text-red-700/80 dark:text-red-400/80 break-all">
                {escrowData.evidence.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            )}
          </div>
        </div>
      </div>

      {escrowData?.external_link ? (
        <a
          href={escrowData.external_link} target="_blank" rel="noreferrer"
          className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/25 transition-all text-sm tracking-wide"
        >
          Visit {hostnameOf(escrowData.external_link)} <ExternalLink size={15} />
        </a>
      ) : (
        <p className="text-xs text-gray-400 text-center">This agent's own registered data doesn't list an external site either.</p>
      )}

      <button onClick={() => onHire(agent)} className="w-full mt-2 py-2.5 rounded-xl text-[11px] font-semibold text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        Hire anyway through Tnega's escrow (not recommended) →
      </button>
      <X402Note show={evaluation.offersX402Alternative} />
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

  if (perf.status === 'loading' && !p) {
    return (
      <div>
        <SectionHeader icon={Activity} title="Delivery Record" />
        <div className="flex items-center gap-2 text-gray-400 text-xs"><Loader2 size={13} className="animate-spin" /> Checking this agent's on-chain delivery history…</div>
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
              ? "This agent doesn't operate through Tnega's on-chain escrow, so no real delivery history is expected here — see the guidance above."
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
          <div title="Cumulative $U earned as a provider: this agent's complete job history, not a recent window"><div className="text-[10px] uppercase text-gray-500">Earned</div><div className="text-lg font-bold">{earned ? `${fmtAmount(r.total_earned)} ${r.token_symbol}` : '—'}</div></div>
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

// ── 3: FINANCIAL TRACK RECORD (Trading & DeFi / fund-management only) ──
// Real cash flow (Delivery Record's Earned figure, shown alongside) and
// real profit — the explicit real content this agent nature should lead
// with, per the design intent this was built against.
function FinancialTrackRecord({ ownerAddress, agentId, category }) {
  const [showSecondary, setShowSecondary] = useState(false);
  const eligible = groupForCategory(category) === FUND_PERFORMANCE_GROUP;
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
        <div className="flex items-center gap-2 text-gray-400 text-xs"><Loader2 size={12} className="animate-spin" /> Checking hire outcomes…</div>
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
            <p>{onchain.data.defi_tx_count} real DeFi transaction{onchain.data.defi_tx_count === 1 ? '' : 's'} found, independent of any hire{onchain.data.real_protocols_seen?.length > 0 && ` (${onchain.data.real_protocols_seen.join(', ')})`}. {onchain.data.pnl ? `${onchain.data.pnl.pnl_usd >= 0 ? '+' : ''}$${onchain.data.pnl.pnl_usd.toFixed(2)} over that window.` : onchain.data.pnl_reason}
              {/* Real, independent second PnL number (2026-08-30) — Zerion's
                  own dedicated FIFO cost-basis calculation over the same
                  window, deliberately shown separate rather than blended
                  into the number above (different real methodology, can
                  legitimately disagree). */}
              {onchain.data.zerion_pnl?.available && (
                <> {' '}(Zerion's own FIFO-based number: {onchain.data.zerion_pnl.total_pnl_usd >= 0 ? '+' : ''}${onchain.data.zerion_pnl.total_pnl_usd.toFixed(2)})</>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── INDEPENDENT CORROBORATION ────────────────────────────────────────
function IndependentCorroboration({ ownerAddress, agentId, category }) {
  const [showMore, setShowMore] = useState(false);
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
        <div className="flex items-center gap-2 text-gray-400 text-xs"><Loader2 size={12} className="animate-spin" /> Checking TermiX's registry…</div>
      ) : t?.available ? (
        <div className="flex items-center gap-4 flex-wrap text-[11px]">
          <div title="Completed jobs TermiX's own registry has recorded for this agent: a differently-scoped data point, not a complete protocol-wide total"><span className="text-base font-bold" style={{ color: '#4F46E5' }}>{t.completed_jobs}</span> <span className="text-[10px] text-gray-500 uppercase">completed (via TermiX)</span></div>
          <div title="TermiX's own reputation score (0–100)"><span className="text-base font-bold">{t.reputation_score ?? '—'}</span> <span className="text-[10px] text-gray-500 uppercase">reputation</span></div>
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

// ── LIVE STATUS (compact — the interaction guidance above already
// explains WHAT the protocol-compatibility finding means; this stays a
// short, factual badge row, not a second copy of the same paragraph) ──
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
    </div>
  );
}

// ── The unified section ──────────────────────────────────────────────
export default function AgentMetrics({ agent, onHire, onTrySkill }) {
  const { data: escrowData } = useEscrowCompatibility(agent.ownerAddress, agent.id);
  const evaluation = evaluateAgent({
    escrowIncompatible: escrowData?.escrow_incompatible,
    authGated: escrowData?.auth_gated,
    differentProtocol: escrowData?.different_protocol,
    offersX402Alternative: escrowData?.offers_x402_alternative,
    category: agent.category,
  });
  const isFundManagement = groupForCategory(agent.category) === FUND_PERFORMANCE_GROUP;

  return (
    <div className="mt-6 space-y-5">
      <h3 className="text-sm font-bold flex items-center gap-1.5"><Blocks size={14} /> Metrics</h3>

      <InteractionGuidance agent={agent} evaluation={evaluation} escrowData={escrowData} onHire={onHire} />

      {/* Real, agent-nature-aware order: a fund-management agent leads
          with its real cash flow/profit (group 3's own explicit real
          content, FinancialTrackRecord promoted ahead of Delivery Record);
          every other agent's FinancialTrackRecord is a real no-op (it
          gates on the same category check and renders nothing) so it's
          only ever placed here, never duplicated. See module header. */}
      {isFundManagement && (
        <FinancialTrackRecord ownerAddress={agent.ownerAddress} agentId={agent.id} category={agent.category} />
      )}
      <DeliveryRecord agent={agent} onTrySkill={onTrySkill} escrowIncompatible={escrowData?.escrow_incompatible} />
      <IndependentCorroboration ownerAddress={agent.ownerAddress} agentId={agent.id} category={agent.category} />
      <LiveStatus agent={agent} escrowData={escrowData} />
    </div>
  );
}
