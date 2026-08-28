// AgentEvaluationSection.jsx
//
// Real, unified "how this agent is evaluated, and what to do about it"
// section for the agent detail page — replaces what used to be two
// separately-rendered pieces (a generic "Hire this agent" button always
// shown, plus a separate EscrowCompatibilityNotice warning bolted on next
// to it) with ONE coherent block. Built from a real, live investigation
// across every category group (docs/category-evaluation.md) that found
// the deciding factor isn't category — it's the already-built, per-agent
// escrow-compatibility signal (core/protocol_compat.py). See
// agentEvaluation.js for the small, shared, two-axis logic this reads.
//
// Real, honest behavior:
//   - Still loading / unknown / genuinely compatible -> the real,
//     ordinary escrow-delivery lens: "Hire this agent" is the primary
//     action, exactly as before. Conservative default (never treats an
//     agent as incompatible without the real, strong protocol signal).
//   - Real, auth-gated (2026-08-28, from the full interaction-pattern
//     investigation — see docs/agent-interaction-patterns.md): a genuine
//     401/403, not a hard protocol rejection. "Hire" stays the real,
//     honest primary action, but with a real, distinct amber caution
//     first — this evidence is genuinely inconclusive, not confirmed
//     broken, so it's never treated as harshly as confirmed-incompatible.
//   - Confirmed escrow-incompatible -> the real native-method explanation
//     (folded in from EscrowCompatibilityWarning.jsx's own warning
//     content, not duplicated logic) with "Visit Website" as the primary
//     action when the agent's own real, submitted data has a link (never
//     fabricated), and hiring anyway still available as a real, de-
//     emphasized fallback — never hidden, never blocked outright. Copy
//     honestly distinguishes a real "different protocol" agent (a real,
//     live JSON API, just not A2A) from a plain non-functional website.
//   - offersX402Alternative (real, additive, independent of the above):
//     a small, low-key note when the agent's own description says it
//     also offers direct x402 pay-per-call access — real but rare, never
//     its own gate.
//
// Shared verbatim by web and mobile. Does NOT touch the actual funding
// modal's own last-chance gate (useHireFlowEscrowGate) beyond the same
// real auth-gated caution added there too — see that module.

import React, { useState } from 'react';
import { AlertTriangle, ExternalLink, ChevronDown, ShieldCheck, ShieldQuestion, Radio, Zap } from 'lucide-react';
import { useEscrowCompatibility, hostnameOf } from './EscrowCompatibilityWarning';
import { evaluateAgent, PRIMARY_CTA } from './agentEvaluation';

function X402Note({ show }) {
  if (!show) return null;
  return (
    <p className="text-[10px] text-gray-400 mt-2.5 flex items-center gap-1.5">
      <Zap size={10} className="shrink-0 text-amber-400" />
      This agent's own listing also mentions direct, pay-per-call (x402) access outside Tnega's escrow — check its own site for details.
    </p>
  );
}

export default function AgentEvaluationSection({ agent, onHire }) {
  const { status, data } = useEscrowCompatibility(agent.ownerAddress, agent.id);
  const [showEvidence, setShowEvidence] = useState(false);
  const evaluation = evaluateAgent({
    escrowIncompatible: data?.escrow_incompatible,
    authGated: data?.auth_gated,
    differentProtocol: data?.different_protocol,
    offersX402Alternative: data?.offers_x402_alternative,
    category: agent.category,
  });

  // Real, ordinary case — still loading, unknown, or genuinely compatible.
  // Exactly the same real primary action this page has always had.
  if (evaluation.primaryCta === PRIMARY_CTA.HIRE) {
    return (
      <div className="mt-6">
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

  // Real, auth-gated — genuinely inconclusive, not confirmed broken.
  if (evaluation.primaryCta === PRIMARY_CTA.HIRE_CAUTION) {
    return (
      <div className="mt-6">
        <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 mb-3">
          <div className="flex items-start gap-2.5">
            <ShieldQuestion size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              <p className="font-semibold mb-1">This agent's endpoint required credentials we don't have.</p>
              <p>We tested this agent's real, registered endpoint directly, and it genuinely requires an access credential (an API key or token) this marketplace doesn't hold — not a sign it's broken, but a real, honest reason it may not learn a job was funded without one. Some agents document a public way to get one (check the evidence below); others don't.</p>
              {data.evidence?.length > 0 && (
                <button onClick={() => setShowEvidence((v) => !v)} className="flex items-center gap-1 mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline">
                  {showEvidence ? 'Hide' : 'Show'} what we checked <ChevronDown size={11} className={`transition-transform ${showEvidence ? 'rotate-180' : ''}`} />
                </button>
              )}
              {showEvidence && (
                <ul className="mt-2 space-y-1 font-mono text-[10px] text-amber-700/80 dark:text-amber-400/80 break-all">
                  {data.evidence.map((e, i) => <li key={i}>• {e}</li>)}
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

  // Confirmed escrow-incompatible.
  return (
    <div className="mt-6">
      <div className="p-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 mb-3">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="text-xs text-red-800 dark:text-red-300 leading-relaxed">
            <p className="font-semibold mb-1">This agent doesn't appear to operate through Tnega's on-chain escrow system.</p>
            {evaluation.differentProtocol ? (
              <p>We tested this agent's real, registered endpoint directly — it's a real, live, working service, just one that speaks a different protocol, not ERC-8183/A2A. If you fund a job here, there's a real chance no one is listening for it in the shape this marketplace sends — your payment would sit on hold until the deadline, with no way for this agent to actually deliver through Tnega specifically.</p>
            ) : (
              <p>We tested this agent's real, registered endpoint directly, and it rejected every real job-protocol (ERC-8183/A2A) format we tried. If you fund a job here, there's a real chance no one is listening for it — your payment would sit on hold until the deadline, with no way for this agent to actually deliver.</p>
            )}
            {data.evidence?.length > 0 && (
              <button onClick={() => setShowEvidence((v) => !v)} className="flex items-center gap-1 mt-2 text-[11px] font-semibold text-red-700 dark:text-red-400 hover:underline">
                {showEvidence ? 'Hide' : 'Show'} what we checked <ChevronDown size={11} className={`transition-transform ${showEvidence ? 'rotate-180' : ''}`} />
              </button>
            )}
            {showEvidence && (
              <ul className="mt-2 space-y-1 font-mono text-[10px] text-red-700/80 dark:text-red-400/80 break-all">
                {data.evidence.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            )}
          </div>
        </div>
      </div>

      {data.external_link ? (
        <a
          href={data.external_link} target="_blank" rel="noreferrer"
          className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/25 transition-all text-sm tracking-wide"
        >
          Visit {hostnameOf(data.external_link)} <ExternalLink size={15} />
        </a>
      ) : (
        <p className="text-xs text-gray-400 text-center">This agent's own registered data doesn't list an external site either.</p>
      )}

      <button onClick={() => onHire(agent)} className="w-full mt-2 py-2.5 rounded-xl text-[11px] font-semibold text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        Hire anyway through Tnega's escrow (not recommended) →
      </button>

      <p className="text-[10px] text-gray-400 mt-2.5 flex items-center gap-1.5">
        <Radio size={10} className="shrink-0" /> We evaluate this class of agent by whether its own site is reachable, not by on-chain job delivery — see the status badge above.
      </p>
      <X402Note show={evaluation.offersX402Alternative} />
    </div>
  );
}
