// ServiceHealthBadge.jsx
//
// Real, active service-liveness signal — shared VERBATIM by web and mobile.
// Backed by backend/core/agent_health.py: a real, server-side, on-chain-
// sourced (ERC-8004 tokenURI -> services[].endpoint) HTTP health-check, run
// on its own 20-minute TTL as part of the same background refresh that
// already keeps known_agents current. NOT a claim the agent makes about
// itself — a real GET we just made against its registered endpoint.
//
// Real investigation behind this (2026-08-21), stated honestly, not assumed:
// 8004scan's own API has no endpoint/service field at all for any agent we
// checked (confirmed live, despite the installed SDK's docstring claiming
// one) — the only real source is the on-chain ERC-721 tokenURI() read. A
// full-production run first showed a 38% "unknown" rate (couldn't even
// resolve the metadata), traced to 126/127 of those sharing ONE metadata
// host (metadata.evoevo.ai, a large single campaign) overloaded by our own
// concurrent checks, not a genuine per-agent problem — every one of them
// resolved instantly once checked in isolation. Fixed with a retry+backoff
// (see agent_health.py's own comment). Real HTTP health-checks themselves
// (once an endpoint IS found) proved reliable in testing, including
// correctly surviving a real Render free-tier cold start via a second,
// longer-timeout retry — that's the basis for using an actual checkmark
// for "responding", distinct from both the 8004scan "Verified" badge and
// the on-chain "Passkey-verified" badge (see PasskeyBadge.jsx): three
// separate, real signals, never conflated.
//
// Visually: ONLY "responding" gets the checkmark. The other states are
// deliberately less prominent — consistent with the top-of-page explainer
// (ServiceHealthExplainer, below): no checkmark just means "not confirmed
// responding right now", not "confirmed broken".

import React from 'react';
import { CheckCircle2, WifiOff, MinusCircle, Info } from 'lucide-react';

// Numeric rank for the existing generic numeric sort (`(av - bv) * mult`
// in AgentMarketplaceApp.*.jsx) — plug service health into that same
// mechanism rather than building a parallel one.
export const SERVICE_STATUS_RANK = {
  responding: 3,
  not_responding: 1,
  no_endpoint: 0,
  unknown: -1,
};

export function serviceRank(status) {
  return status in SERVICE_STATUS_RANK ? SERVICE_STATUS_RANK[status] : -1;
}

function timeAgo(unixSeconds) {
  if (!unixSeconds) return null;
  const s = Math.floor(Date.now() / 1000 - unixSeconds);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// User-facing copy audit (2026-08-22): rewritten so someone with zero
// crypto background can read every tooltip/label here and understand it —
// no "endpoint", "health-check", or "real"-as-hedge language left in.
const LIMITATION_NOTE =
  "This just means we contacted it and it answered — it's turned on and working right now. " +
  "It doesn't promise the work it does will be good, only that someone's there.";

/** Per-agent badge — cards, table rows, and the detail header. Renders
 * nothing for 'unknown' or a never-checked agent, on purpose: we don't have
 * a confident answer either way, and a badge implying otherwise would be
 * misleading (see the top-of-page note for why no checkmark ≠ "broken"). */
export default function ServiceHealthBadge({ status, checkedAt, size = 'sm', className = '' }) {
  if (!status || status === 'unknown') return null;

  const sizePx = size === 'md' ? 13 : 11;
  const textCls = size === 'md' ? 'text-[11px]' : 'text-[10px]';
  const when = timeAgo(checkedAt);

  if (status === 'responding') {
    return (
      <span
        title={`We checked${when ? ` ${when}` : ''} and it answered. ${LIMITATION_NOTE}`}
        className={`inline-flex items-center gap-1 ${textCls} font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 ${className}`}
      >
        <CheckCircle2 size={sizePx} /> Online now
      </span>
    );
  }
  if (status === 'not_responding') {
    return (
      <span
        title={`We tried to reach this agent${when ? ` ${when}` : ''} and got no answer. It might just be waking up from being idle — this doesn't mean it's gone for good.`}
        className={`inline-flex items-center gap-1 ${textCls} font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 ${className}`}
      >
        <WifiOff size={sizePx} /> Not answering right now
      </span>
    );
  }
  if (status === 'no_endpoint') {
    return (
      <span
        title="This agent hasn't told us how to check on it. That's not necessarily bad — we just have no way to confirm it's running yet."
        className={`inline-flex items-center gap-1 ${textCls} font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 ${className}`}
      >
        <MinusCircle size={sizePx} /> Can't check yet
      </span>
    );
  }
  return null;
}

/** Short, plain-language, top-of-marketplace note — not a per-agent tooltip
 * (the badge already carries one), a one-time page-level explanation kept
 * brief on purpose. */
export function ServiceHealthExplainer({ className = '' }) {
  return (
    <div className={`flex items-start gap-2 text-[11px] text-emerald-800 dark:text-emerald-300 p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-500/5 border border-emerald-100 dark:border-emerald-500/20 ${className}`}>
      <Info size={13} className="shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
      <span>
        <CheckCircle2 size={11} className="inline -mt-0.5 mr-0.5 text-emerald-600 dark:text-emerald-400" />
        <strong> "Online now"</strong> next to an agent means we just tried reaching it and it answered — so it's
        actually turned on right now, not just listed here. No checkmark doesn't mean it's broken; it might
        just not have answered yet, or we haven't checked recently. Either way, this only tells you it's
        switched on — not whether the work it does is any good.
      </span>
    </div>
  );
}
