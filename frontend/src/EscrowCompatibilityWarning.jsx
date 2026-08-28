// EscrowCompatibilityWarning.jsx
//
// Real, conservative warning for a real, confirmed agent class: registered
// on-chain, but a SaaS/off-chain business tool that never implements or
// listens for ERC-8183 job events at all (real, confirmed example: "AIDA —
// AI Medical Receptionist" — a real HTTP 405 on every real A2A/JSON-RPC
// format tried). Funding a real escrow job against one of these agents has
// zero real chance of ever being delivered — the money just sits on hold
// until the real deadline. See backend/core/protocol_compat.py for the
// full real detection methodology (a real, live protocol probe against the
// agent's own registered endpoint, conservatively combined with
// supporting-only metadata evidence from its own submitted description —
// never category or reputation alone, and never a hard verdict from
// keyword matching by itself).
//
// Deliberately AUTO-FETCHED (unlike WalletPortfolioPanel.jsx's opt-in
// button) — this probe costs no Zerion quota, and the whole point is to
// warn a buyer BEFORE they open the funding flow, not only if they
// remember to ask. Shared verbatim by web and mobile; used in two real
// places:
//   1. EscrowCompatibilityNotice below — real, standalone warning content
//      (headline/body/evidence/external link). As of the real
//      category-aware evaluation generalization (2026-08-28), the agent
//      detail page no longer renders this directly — it's folded into
//      AgentEvaluationSection.jsx's own unified native-method/primary-CTA
//      block instead, so a buyer sees ONE coherent section, not two
//      separate, back-to-back ones. The component itself stays exported
//      and unchanged in case anywhere else ever wants the same standalone
//      warning.
//   2. The actual funding modal (useHireFlowEscrowGate) — the real,
//      last-chance placement, right before real money moves on-chain.
//      Requires an explicit acknowledgment checkbox before the real fund
//      button is enabled, rather than hard-blocking it outright: this is
//      real, evidence-based detection, not infallible, so a buyer who has
//      their own reason to proceed still can — just never as the default,
//      accidental, one-click path. Unchanged by this generalization — a
//      different, still-necessary concern (safety at the moment money
//      actually moves), not top-level presentation.
//
// Never hides the agent from the registry/marketplace listing — per the
// real, explicit scope this was built to: "don't hide these agents
// entirely, just prevent the specific 'fund an escrow job that can never
// complete' failure mode." This only ever touches the hire/fund flow.

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, ChevronDown } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// Real, session-local memo only — the backend (core/protocol_compat.py)
// already keeps its own real 24h cache; this just avoids a redundant
// round trip when both the detail page and the funding modal mount for
// the same agent back to back in one visit.
const _cache = new Map();

export function useEscrowCompatibility(ownerAddress) {
  const [state, setState] = useState(() =>
    ownerAddress && _cache.has(ownerAddress) ? { status: 'ready', data: _cache.get(ownerAddress) } : { status: 'idle' }
  );

  useEffect(() => {
    if (!ownerAddress) { setState({ status: 'idle' }); return undefined; }
    if (_cache.has(ownerAddress)) { setState({ status: 'ready', data: _cache.get(ownerAddress) }); return undefined; }
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`${API_BASE_URL}/api/agents/escrow-compatibility?owner_address=${ownerAddress}`)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((body) => {
        if (cancelled) return;
        _cache.set(ownerAddress, body);
        setState({ status: 'ready', data: body });
      })
      .catch((e) => { if (!cancelled) setState({ status: 'error', message: e.message || String(e) }); });
    return () => { cancelled = true; };
  }, [ownerAddress]);

  return state;
}

// Exported (2026-08-28) — reused by AgentEvaluationSection.jsx, which
// folds this file's own warning content into the new, unified evaluation
// section rather than duplicating the same hostname-extraction logic.
export function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

const WARNING_HEADLINE = "This agent doesn't appear to operate through Tnega's on-chain escrow system.";
const WARNING_BODY = "We tested this agent's real, registered endpoint directly, and it rejected every real job-protocol (ERC-8183/A2A) format we tried. If you fund a job here, there's a real chance no one is listening for it — your payment would sit on hold until the deadline, with no way for this agent to actually deliver.";

/** Supplementary warning for the agent detail page — sits next to the real
 * "Hire this agent" button, never replaces it (the detail page still lets
 * a buyer proceed to the funding modal; the real, harder gate lives there
 * instead — see useHireFlowEscrowGate below). */
export function EscrowCompatibilityNotice({ ownerAddress }) {
  const { status, data } = useEscrowCompatibility(ownerAddress);
  const [showEvidence, setShowEvidence] = useState(false);
  if (status !== 'ready' || !data?.escrow_incompatible) return null;

  return (
    <div className="mt-4 p-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div className="text-xs text-red-800 dark:text-red-300 leading-relaxed">
          <p className="font-semibold mb-1">{WARNING_HEADLINE}</p>
          <p>{WARNING_BODY}</p>
          {data.external_link && (
            <a href={data.external_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-2 font-semibold hover:underline">
              This agent's own listed site: {hostnameOf(data.external_link)} <ExternalLink size={11} />
            </a>
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
  );
}

/** The real, harder gate — used inside the actual funding modal, right
 * before money moves on-chain. When this agent is flagged, returns
 * `blocked: true` until the buyer explicitly checks an acknowledgment box
 * (never a silent, un-skippable hard block — this is real, evidence-based
 * detection, not infallible — but never the default, accidental path
 * either). `node` is the warning JSX to render above the fund controls;
 * null when the agent isn't flagged. */
export function useHireFlowEscrowGate(ownerAddress) {
  const { status, data } = useEscrowCompatibility(ownerAddress);
  const [acknowledged, setAcknowledged] = useState(false);
  const flagged = status === 'ready' && !!data?.escrow_incompatible;

  // Real, deliberate reset — a fresh agent (or reopening the modal for a
  // different one) must never inherit a previous agent's acknowledgment.
  useEffect(() => { setAcknowledged(false); }, [ownerAddress]);

  if (!flagged) return { blocked: false, node: null };

  const node = (
    <div className="mb-6 p-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div className="text-xs text-red-800 dark:text-red-300 leading-relaxed">
          <p className="font-semibold mb-1">Before you fund this job: {WARNING_HEADLINE.charAt(0).toLowerCase() + WARNING_HEADLINE.slice(1)}</p>
          <p>{WARNING_BODY}</p>
          {data.external_link && (
            <a href={data.external_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-2 font-semibold hover:underline">
              Try this agent's own listed site instead: {hostnameOf(data.external_link)} <ExternalLink size={11} />
            </a>
          )}
          <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="accent-red-600" />
            <span className="text-[11px] font-semibold">I understand, and want to fund this job anyway.</span>
          </label>
        </div>
      </div>
    </div>
  );

  return { blocked: !acknowledged, node };
}
