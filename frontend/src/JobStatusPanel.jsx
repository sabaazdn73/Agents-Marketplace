// JobStatusPanel.jsx
//
// Real, live ERC-8183 job status + actions — extracted 2026-08-18 from
// AltanaSessionPanel.jsx (where it was built first, single-job) so "My
// Agents" (many jobs, one per real hire) can reuse the exact same read/
// display logic instead of rebuilding it. Reads are always the same
// (getJobStatus/getDeliverable — pure on-chain reads, no wallet needed);
// the WRITE actions (dispute, claim refund) are passed in as callbacks
// rather than hardcoded, because the two real callers genuinely sign
// differently and papering over that would be dishonest:
//   - AltanaSessionPanel: an Altana passkey wallet + session (settleErc8183Job
//     via the SDK relay).
//   - My Agents (direct wagmi hires): the connected wallet signs directly
//     (writeContractAsync straight to the Policy/Commerce contracts).
// Pass onDispute/onClaimRefund only when the caller actually has a real way
// to sign that action for this job; omitting one just hides that button
// rather than rendering a dead one.
//
// Copy pass, 2026-08-19: rewritten in extremely plain language on purpose.
// Real, honest constraint this whole panel is designed around: for
// third-party marketplace agents, we have NO visibility into what they're
// doing internally until they submit a real deliverable on-chain — that's
// ERC-8183's own design, not something we're choosing to hide. So every
// status below either says plainly "there's genuinely nothing to show yet"
// or, once something real exists (a submitted deliverable), actually shows
// it — fetched and rendered in whatever real format it turns out to be,
// not just a bare link.
//
// "Live waiting" pass, 2026-08-23: the FUNDED state used to just be one
// static sentence with no sense of time passing — a real UX complaint
// ("feels like a black box"). Real, honest constraint investigated before
// building this: the on-chain job struct (erc8183.js's own ABI) has NO
// fundedAt/createdAt field, only `expiredAt` (bakes in a per-job, user-
// chosen buffer + a fixed dispute-window constant — not invertible without
// knowing that per-job buffer) and `submittedAt`. There's also no indexed
// event we can scan instead (see agent_performance.py's own docstring —
// this project already, deliberately avoids getLogs scans after real,
// repeated RPC rate-limit/archive-node pain). So a general "typical
// delivery time" average across arbitrary third-party agents genuinely
// isn't computable from what's available today — jobTiming.js's own header
// has the full investigation. What IS real and buildable: a live elapsed
// timer (jobTiming.js records the real funding moment for jobs hired
// through this browser, or an honest first-observed fallback otherwise),
// a real countdown to the actual on-chain expiredAt, faster panel-local
// polling while a FUNDED job is actually open, and a progress ESTIMATE
// only for the one agent we've genuinely measured (also in jobTiming.js) —
// never a fabricated bar for agents we have no real data on.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, ExternalLink, AlertTriangle, RefreshCw, Coins, FileText, Sparkles, Clock, Hourglass, CheckCircle2, XCircle } from 'lucide-react';
import { getJobStatus, getDeliverable } from './altana';
import { trackJob } from './notifications';
import { recordFunded, getStartEstimate, getKnownTypicalDelivery, getActivityWindow } from './jobTiming';
import { extractDeliverableText, parseLightMarkdown } from './deliverableFormat';
import AgentActivityPanel from './AgentActivityPanel';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const DELIVERABLE_FETCH_TIMEOUT_MS = 12_000;
const DELIVERABLE_MAX_CHARS = 4000; // long deliverables get truncated with a "view full" link, not a broken layout

// Panel-local fast poll, distinct from NotificationBell's app-wide 30s
// background poll — this one only runs while THIS panel is mounted, visible
// (Page Visibility API — no point hammering RPCs for a backgrounded tab),
// and the job is actually FUNDED (the only state where anything changes).
const FAST_POLL_MS = 8_000;
// Purely cosmetic re-render tick for the live elapsed/countdown/"checked Xs
// ago" numbers — no network call, that's what makes it feel alive at zero
// extra RPC cost.
const TICK_MS = 1_000;
// How long a real, detected status change stays visually flashed before
// settling into its normal steady-state look.
const FLASH_MS = 2_200;

function useTicker(active) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, [active]);
}

function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatCountdown(ms) {
  if (ms <= 0) return null; // past deadline — caller shows the refund path instead
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Fetches the real deliverable URL and figures out, from what actually
 * comes back, how to show it honestly: real JSON pretty-printed, a real
 * image shown inline, real plain text as text. If the fetch itself fails,
 * that's reported honestly too, with the raw link as the fallback — never
 * silently swallowed into "no deliverable".
 *
 * Real bug fixed 2026-08-24: this used to fetch() `url` DIRECTLY from the
 * browser — confirmed live to fail on every marketplace agent built on this
 * SDK, none of which advertise CORS headers (same real gap
 * erc8183_negotiate.py's negotiate/notify_funded proxies exist for), always
 * surfacing as the generic "Failed to fetch" even when the content was
 * genuinely there (job #56646). Routed through our own backend's
 * /api/deliverable/proxy instead (see core/deliverable_proxy.py) — same
 * origin, real CORS headers, same content-type-based rendering below,
 * unchanged. The one exception: an actual IMAGE still loads via `<img
 * src={url}>` on the ORIGINAL url in DeliverableViewer below — an <img> tag
 * isn't subject to CORS the way a script-initiated fetch() read is, so it
 * needs no proxying. */
function useDeliverableContent(url) {
  const [state, setState] = useState({ status: 'idle' }); // idle|loading|json|image|text|fetch-failed
  useEffect(() => {
    if (!url) { setState({ status: 'idle' }); return; }
    let cancelled = false;
    setState({ status: 'loading' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERABLE_FETCH_TIMEOUT_MS);
    const proxyUrl = `${API_BASE_URL}/api/deliverable/proxy?url=${encodeURIComponent(url)}`;
    fetch(proxyUrl, { signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try { detail = (await res.json()).detail || detail; } catch { /* non-JSON error body */ }
          setState({ status: 'fetch-failed', error: detail });
          return;
        }
        const contentType = res.headers.get('content-type') || '';
        if (contentType.startsWith('image/')) {
          setState({ status: 'image' });
          return;
        }
        const text = await res.text();
        if (cancelled) return;
        try {
          const parsed = JSON.parse(text);
          setState({ status: 'json', content: JSON.stringify(parsed, null, 2), parsed });
        } catch {
          setState({ status: 'text', content: text });
        }
      })
      .catch((e) => {
        if (!cancelled) setState({ status: 'fetch-failed', error: e.name === 'AbortError' ? 'Timed out loading it' : (e.message || 'Could not load it') });
      })
      .finally(() => clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [url]);
  return state;
}

/** Renders one parseLightMarkdown() inline-run array (plain/bold/italic). */
function InlineRuns({ runs }) {
  return runs.map((r, i) => {
    if (r.t === 'bold') return <strong key={i}>{r.v}</strong>;
    if (r.t === 'italic') return <em key={i}>{r.v}</em>;
    return <React.Fragment key={i}>{r.v}</React.Fragment>;
  });
}

const HEADING_SIZE_CLASS = {
  1: 'text-sm font-bold',
  2: 'text-[13px] font-bold',
  3: 'text-[12px] font-semibold',
  4: 'text-[12px] font-semibold',
};

/** The polished, human-readable rendering of a deliverable's real content
 * field — headings, bold/italic, lists, simple tables, paragraphs. Nothing
 * fabricated: this only re-formats the exact real text extractDeliverableText
 * found, never rewrites or trims it (a "thinking preamble" some agents
 * include ahead of their real answer, if present, renders as-is — this is a
 * general-purpose viewer, not a curated excerpt like AdvantageReport.jsx's
 * own hand-picked one). */
export function LightMarkdown({ text }) {
  const blocks = React.useMemo(() => parseLightMarkdown(text), [text]);
  return (
    <div className="space-y-2.5 text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return (
            <div key={i} className={`${HEADING_SIZE_CLASS[b.level] || HEADING_SIZE_CLASS[4]} text-gray-900 dark:text-white mt-1 first:mt-0`}>
              <InlineRuns runs={b.inline} />
            </div>
          );
        }
        if (b.type === 'hr') return <hr key={i} className="border-gray-200 dark:border-gray-800" />;
        if (b.type === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return (
            <Tag key={i} className={`${b.ordered ? 'list-decimal' : 'list-disc'} pl-4 space-y-1`}>
              {b.items.map((it, j) => <li key={j}><InlineRuns runs={it} /></li>)}
            </Tag>
          );
        }
        if (b.type === 'table') {
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>{b.headerInline.map((h, j) => (
                    <th key={j} className="border-b border-gray-200 dark:border-gray-800 pb-1 pr-3 font-semibold text-gray-900 dark:text-white"><InlineRuns runs={h} /></th>
                  ))}</tr>
                </thead>
                <tbody>
                  {b.rows.map((row, ri) => (
                    <tr key={ri}>{row.map((c, ci) => (
                      <td key={ci} className="border-b border-gray-100 dark:border-gray-800/50 py-1 pr-3 align-top"><InlineRuns runs={c} /></td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={i}><InlineRuns runs={b.inline} /></p>;
      })}
    </div>
  );
}

/** The exact original raw content, with its own expand/collapse for long
 * output — the same rendering used both as the "no polished view available"
 * fallback and as what a polished view's "View raw" toggle reveals. Access
 * to the real, unmodified raw content is never removed, just not the
 * default when something more readable was found. */
function RawDeliverableBlock({ content, url }) {
  const [expanded, setExpanded] = useState(false);
  const full = content || '';
  const isLong = full.length > DELIVERABLE_MAX_CHARS;
  const shown = expanded || !isLong ? full : full.slice(0, DELIVERABLE_MAX_CHARS);
  return (
    <div className="space-y-1">
      <pre className="whitespace-pre-wrap break-words bg-black/5 dark:bg-white/5 rounded-lg p-2.5 text-[11px] font-mono max-h-72 overflow-y-auto">{shown}{!expanded && isLong ? '…' : ''}</pre>
      <div className="flex items-center gap-3">
        {isLong && (
          <button onClick={() => setExpanded((v) => !v)} className="text-indigo-500 hover:underline text-[10px]">
            {expanded ? 'Show less' : `Show all (${full.length.toLocaleString()} characters)`}
          </button>
        )}
        <a href={url} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline inline-flex items-center gap-1 text-[10px]">Open original <ExternalLink size={10} /></a>
      </div>
    </div>
  );
}

/** Polished view (default) + two SEPARATE, always-visible affordances:
 * "View raw" (reveals the exact original content inline, on this page) and
 * "Open original" (a real, direct link to the actual deliverable URL,
 * un-proxied, for independent/external verification). Real regression fixed
 * 2026-08-28: when this polished view was added, "Open original" ended up
 * nested INSIDE the "View raw" toggle's revealed content — before that, the
 * plain raw-content view (still real, and still what renders below when
 * there's no polished text to show) always had this link visible
 * immediately, no toggle needed. Real fix: promote it back to its own
 * always-visible link here, independent of whether "View raw" is open. */
function PolishedDeliverable({ text, raw, url }) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="space-y-2">
      <LightMarkdown text={text} />
      <div className="flex items-center gap-3 pt-1 border-t border-gray-100 dark:border-gray-800/50">
        <button onClick={() => setShowRaw((v) => !v)} className="text-indigo-500 hover:underline text-[10px]">
          {showRaw ? '− Hide raw' : '+ View raw'}
        </button>
        <a href={url} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline inline-flex items-center gap-1 text-[10px]">
          Open original <ExternalLink size={10} />
        </a>
      </div>
      {showRaw && <RawDeliverableBlock content={raw} url={url} />}
    </div>
  );
}

function DeliverableViewer({ url }) {
  const state = useDeliverableContent(url);

  if (state.status === 'loading' || state.status === 'idle') {
    return <div className="flex items-center gap-1.5 opacity-60"><Loader2 size={12} className="animate-spin" /> Getting what the agent delivered…</div>;
  }
  if (state.status === 'fetch-failed') {
    return (
      <div className="space-y-1">
        <div className="opacity-70">Couldn't load it automatically here ({state.error}) — open it directly instead:</div>
        <a href={url} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline inline-flex items-center gap-1">Open deliverable <ExternalLink size={11} /></a>
      </div>
    );
  }
  if (state.status === 'image') {
    return (
      <div className="space-y-1">
        <img src={url} alt="Delivered result" className="max-w-full rounded-lg border border-black/5 dark:border-white/10" />
        <a href={url} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline inline-flex items-center gap-1 text-[10px]">Open full size <ExternalLink size={10} /></a>
      </div>
    );
  }
  // json with a real, identifiable content field → polished by default, raw
  // available underneath. json with no such field, or plain text → the raw
  // view is the only honest representation, shown directly (nothing to
  // "polish" beyond it).
  const meaningfulText = state.status === 'json' ? extractDeliverableText(state.parsed) : null;
  if (meaningfulText) {
    return <PolishedDeliverable text={meaningfulText} raw={state.content} url={url} />;
  }
  return <RawDeliverableBlock content={state.content} url={url} />;
}

// One plain-language line per status, written for a total beginner — no
// jargon, no assuming the reader knows what "escrow" or "settlement" mean.
const STATUS_COPY = {
  OPEN: "This job has been created but not paid for yet.",
  FUNDED: "Your payment is locked and waiting. The agent hasn't finished the work yet — there's nothing to show until it does.",
  SUBMITTED: "The agent says it's done! Here's what it delivered:",
  COMPLETED: "Job finished. The agent got paid, and here's what you received:",
  REJECTED: "You disputed this delivery, and it was decided in your favor — you got your money back.",
};

// A friendlier word for the status badge next to the plain-English sentence
// above — the raw values (OPEN, FUNDED, SUBMITTED…) are the real, internal
// status names read straight from the blockchain, kept as-is for anyone who
// wants to look this job up directly; this is just what's SHOWN.
export const STATUS_DISPLAY_LABEL = {
  OPEN: 'Not paid yet',
  FUNDED: 'Payment on hold',
  SUBMITTED: 'Delivered',
  COMPLETED: 'Finished',
  REJECTED: 'Refunded',
  EXPIRED: 'Refunded',
};

export default function JobStatusPanel({
  jobId, initialStatus, mutedBorder, accent,
  onDispute, onApprove, onClaimRefund,
  agentLabel, agentLink,
}) {
  const [status, setStatus] = useState(initialStatus || null);
  const [job, setJob] = useState(null);
  // Real bug fixed 2026-08-20: this used to be a single undefined/null/string
  // value, which conflated three genuinely different real states into one —
  // "still checking", "checked and genuinely nothing there", and "the check
  // itself failed" (e.g. a real RPC error) all collapsed into the same UI
  // message, "hasn't posted a result", even when that was false. Confirmed
  // for real against job #56620: getDeliverable() was THROWING (a real
  // eth_getLogs rejection from the default RPC — see altana.js's own fix),
  // not resolving to "not found" — the blanket catch hid a real failure
  // behind a message that implied the agent simply hadn't delivered yet.
  const [deliverableState, setDeliverableState] = useState({ status: 'idle' }); // idle|loading|found|not_found|error
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // "Live waiting" state — see this file's header + jobTiming.js for the
  // real investigation behind each of these.
  const [lastCheckedAtMs, setLastCheckedAtMs] = useState(null);
  const [flashKind, setFlashKind] = useState(null); // null | 'submitted' | 'expired' — a real, just-detected change
  const prevStatusRef = useRef(initialStatus || null);
  const tickerActive = status === 'FUNDED' || flashKind != null;
  useTicker(tickerActive);

  const refresh = useCallback(async () => {
    setError(null);
    // "Checked Xs ago" should reflect that we just tried, whether or not it
    // succeeds — a failed check is still a real check, and silently NOT
    // updating this on failure would make repeated failures look like one
    // long-stale check instead of what's actually happening.
    setLastCheckedAtMs(Date.now());
    try {
      const j = await getJobStatus(jobId);
      setJob(j); setStatus(j.statusName);
      trackJob(jobId, j.statusName);

      // A real, detected change (not the initial load) — trigger the
      // visual transition once, driven by an actual state flip.
      if (prevStatusRef.current != null && prevStatusRef.current !== j.statusName) {
        if (j.statusName === 'SUBMITTED') { setFlashKind('submitted'); setTimeout(() => setFlashKind(null), FLASH_MS); }
        else if (j.statusName === 'EXPIRED') { setFlashKind('expired'); setTimeout(() => setFlashKind(null), FLASH_MS); }
      }
      prevStatusRef.current = j.statusName;

      if (j.statusName === 'SUBMITTED' || j.statusName === 'COMPLETED') {
        setDeliverableState({ status: 'loading' });
        try {
          const url = await getDeliverable(jobId);
          setDeliverableState(url ? { status: 'found', url } : { status: 'not_found' });
        } catch (e) {
          setDeliverableState({ status: 'error', error: e.message || String(e) });
        }
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Panel-local fast poll — only while a FUNDED job is actually mounted and
  // the tab is visible. Distinct from NotificationBell's slower, app-wide
  // background poll (still the fallback for jobs not currently open).
  useEffect(() => {
    if (status !== 'FUNDED') return;
    const id = setInterval(() => { if (!document.hidden) refresh(); }, FAST_POLL_MS);
    return () => clearInterval(id);
  }, [status, refresh]);

  // The real start-time estimate for the elapsed timer — computed (and, for
  // the fallback case, persisted) the moment we first see FUNDED for this
  // job, not recomputed every render/tick.
  const [startEstimate, setStartEstimate] = useState(null);
  useEffect(() => {
    if (status === 'FUNDED' && !startEstimate) setStartEstimate(getStartEstimate(jobId));
  }, [status, jobId, startEstimate]);

  const nowMs = Date.now(); // safe here — only read during a render driven by useTicker

  const handleDispute = async () => {
    if (!onDispute) return;
    setBusy(true); setError(null);
    try {
      await onDispute(jobId);
      await refresh(); // read the real status back — don't optimistically assume
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // Real, confirmed gap fixed here (full hire-flow audit, 2026-08-28): the
  // real "or you approve early" release-payment-now action was described in
  // docs/README.md but never actually offered anywhere in the product — see
  // useJobActions.js's approveDirect for the full trace. A real, permanent
  // action (moves the job straight to COMPLETED, no more dispute after),
  // so it's offered but never assumed — the contract enforces real
  // eligibility, we just surface whatever it reports back.
  const handleApprove = async () => {
    if (!onApprove) return;
    setBusy(true); setError(null);
    try {
      await onApprove(jobId);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleClaimRefund = async () => {
    if (!onClaimRefund) return;
    setBusy(true); setError(null);
    try {
      await onClaimRefund(jobId);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitted = status === 'SUBMITTED';
  const completed = status === 'COMPLETED';
  // Real condition, verified 2026-08-18 against live on-chain state (job
  // #56596: expiredAt passed 12+ hours earlier, status still read OPEN) —
  // the contract does NOT auto-transition status once expiredAt passes.
  // "EXPIRED" is a status claimRefund() itself sets; before that call, an
  // overdue job still honestly reads FUNDED. So the actionable case is
  // FUNDED-and-past-expiredAt, not the literal EXPIRED enum value (which
  // means the refund was already claimed — nothing left to do).
  const nowSec = Math.floor(Date.now() / 1000);
  const canClaimRefund = status === 'FUNDED' && job?.expiredAt != null && nowSec > Number(job.expiredAt);

  // Real time window for the "Agent activity" transparency view — null
  // (renders nothing) when there's no real, sane window to search. See
  // jobTiming.js's getActivityWindow for the full real tiering.
  const activityWindow = job ? getActivityWindow(jobId, job) : null;

  // Live-waiting numbers — all derived from real state (startEstimate,
  // job.expiredAt, lastCheckedAtMs) re-evaluated every tick, never a fake
  // incrementing counter running independently of reality.
  const elapsedMs = status === 'FUNDED' && startEstimate ? nowMs - startEstimate.atMs : null;
  const countdownMs = status === 'FUNDED' && job?.expiredAt != null ? Number(job.expiredAt) * 1000 - nowMs : null;
  const typical = status === 'FUNDED' ? getKnownTypicalDelivery(job?.provider) : null;
  // Real UX fix, 2026-08-24: a percentage bar that climbs to 100% and then
  // just sits there once elapsed time passes the typical estimate reads as
  // stuck/broken — a real user flagged exactly this. Looked at how real
  // products handle "past the estimate" for an async wait (order tracking,
  // package tracking, background job queues): none of them leave a frozen
  // percentage — they either keep updating the estimate, or drop the numeric
  // progress entirely and switch to an open-ended "still working" state
  // anchored on elapsed time, which is what reassures the user something is
  // still actually happening. `isPastTypical` below is that switch point —
  // the percentage bar only ever renders BELOW 100%; past it, the bar
  // disappears in favor of the open-ended state.
  const isPastTypical = typical && elapsedMs != null && elapsedMs >= typical.seconds * 1000;
  const progressPct = typical && elapsedMs != null && !isPastTypical ? (elapsedMs / (typical.seconds * 1000)) * 100 : null;
  const checkedSecAgo = lastCheckedAtMs != null ? Math.max(0, Math.floor((nowMs - lastCheckedAtMs) / 1000)) : null;

  // Flash styling — a real, visible transition ONLY when refresh() just
  // detected an actual change (flashKind), self-clearing after FLASH_MS.
  const flashRing = flashKind === 'submitted' ? 'ring-2 ring-emerald-400 dark:ring-emerald-500'
    : flashKind === 'expired' ? 'ring-2 ring-amber-400 dark:ring-amber-500'
    : '';

  return (
    <div className={`mt-3 p-3 rounded-xl border ${mutedBorder} text-xs space-y-2 transition-all duration-500 ${flashRing}`}>
      {flashKind && (
        <div className={`-mt-1 -mx-1 mb-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 animate-in fade-in duration-300 ${
          flashKind === 'submitted' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
        }`}>
          {flashKind === 'submitted' ? <><CheckCircle2 size={13} /> Just delivered!</> : <><XCircle size={13} /> Just expired — you can get a refund now</>}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold">Job #{String(jobId)}</span>
          {agentLabel && (
            agentLink ? <a href={agentLink} className="text-indigo-500 hover:underline">— {agentLabel}</a> : <span className="opacity-60">— {agentLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold" title={status ? `On-chain status: ${status}` : undefined} style={{ color: accent }}>{loading ? '…' : (STATUS_DISPLAY_LABEL[status] || status || 'unknown')}</span>
          <button onClick={refresh} disabled={busy} className="opacity-60 hover:opacity-100"><RefreshCw size={12} /></button>
        </div>
      </div>

      {/* One plain-English line explaining exactly where things stand, before
          anything else — except FUNDED, where the real live-ticking view
          below replaces the old static "waiting" text entirely. */}
      {status && status !== 'FUNDED' && STATUS_COPY[status] && <p className="opacity-80 leading-relaxed">{STATUS_COPY[status]}</p>}

      {status === 'FUNDED' && (
        <div className="space-y-2 pt-0.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold text-sm" style={{ color: accent }}>
              <Hourglass size={13} className="animate-pulse" /> Waiting: {elapsedMs != null ? formatElapsed(elapsedMs) : '…'}
            </span>
            {checkedSecAgo != null && (
              <span className="opacity-50 text-[10px]" title="How long ago we last checked this job's real on-chain status">Checked {checkedSecAgo}s ago</span>
            )}
          </div>
          {startEstimate && !startEstimate.precise && (
            <p className="text-[10px] opacity-40">We don't have your exact funding moment on record for this job — this counts from when we first saw it funded, so the real wait may be a bit longer.</p>
          )}

          {typical && progressPct != null && (
            <div>
              <div className="flex items-center justify-between text-[10px] opacity-60 mb-1">
                <span>Estimated progress</span>
                <span>{Math.round(progressPct)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${progressPct}%`, background: accent }} />
              </div>
              <p className="text-[10px] opacity-40 mt-1">
                Most similar jobs finish in about {formatElapsed(typical.seconds * 1000)} — an estimate from {typical.sourceLabel}, not a guarantee.
              </p>
            </div>
          )}

          {/* Past the typical estimate — the percentage bar above stops
              rendering (see isPastTypical's own comment for the real UX
              research behind this) and this open-ended state takes over
              instead. The elapsed timer and deadline countdown elsewhere in
              this panel are untouched — they stay accurate regardless. */}
          {isPastTypical && (
            <div className="flex items-start gap-1.5 text-[10px] opacity-60">
              <span className="relative flex h-2 w-2 mt-0.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: accent }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: accent }} />
              </span>
              <span>
                Still working — this is taking longer than the usual ~{formatElapsed(typical.seconds * 1000)} for this agent. The job is still valid and could deliver anytime before its deadline below.
              </span>
            </div>
          )}

          {countdownMs != null && (
            <div className="flex items-center gap-1.5 text-[11px] opacity-70" title="Time left before this job's on-chain deadline">
              <Clock size={11} />
              {countdownMs > 0
                ? <span>Deadline in {formatCountdown(countdownMs)} — after that, come back here and claim a refund yourself (it won't happen on its own)</span>
                : <span>Past its deadline — a refund is now available below</span>}
            </div>
          )}

          <p className="opacity-60 leading-relaxed pt-0.5">The agent hasn't finished the work yet — there's nothing to show until it does.</p>
        </div>
      )}

      {(submitted || completed) && (
        <div className="space-y-2 pt-1">
          {/* Real trust feature, general to any agent/any job (not
              explainer-agent-specific): a SUBMITTED/COMPLETED job's real
              output must be immediately, visually obvious — not small
              inline text a user has to hunt for or wonder whether anything
              came back at all. */}
          {deliverableState.status === 'idle' || deliverableState.status === 'loading' ? (
            <div className="flex items-center gap-1.5 opacity-60"><Loader2 size={12} className="animate-spin" /> checking for the delivered result…</div>
          ) : deliverableState.status === 'found' ? (
            <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: accent + '4D' }}>
              <div className="px-3 py-2 flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-wide" style={{ background: accent + '15', color: accent }}>
                <Sparkles size={13} /> Result
              </div>
              <div className="p-3 bg-white dark:bg-black/20">
                <DeliverableViewer url={deliverableState.url} />
              </div>
            </div>
          ) : deliverableState.status === 'error' ? (
            <div className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>Couldn't check for a result right now ({deliverableState.error}) — that's a problem on our end, not proof nothing was delivered. <button onClick={refresh} className="underline">Retry</button></span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 opacity-60"><FileText size={12} /> We can't find a result from the agent yet.</div>
          )}

          {/* Real "what is this agent actually doing" transparency view —
              see AgentActivityPanel.jsx's own docstring. Renders nothing
              when there's no real window to search. */}
          <AgentActivityPanel ownerAddress={job?.provider} window={activityWindow} />

          {submitted && onApprove && (
            <>
              <button onClick={handleApprove} disabled={busy} className="w-full py-2 rounded-lg text-xs font-semibold border disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ color: accent, borderColor: accent + '4D' }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Looks good — release payment now
              </button>
              <p className="text-[10px] opacity-50">Skips the rest of the waiting period and pays the agent immediately. Permanent — you can't dispute after this, so only do this once you're actually satisfied.</p>
            </>
          )}
          {submitted && onDispute && (
            <>
              <button onClick={handleDispute} disabled={busy} className="w-full py-2 rounded-lg text-xs font-semibold text-red-600 border border-red-500/30 disabled:opacity-50 flex items-center justify-center gap-1.5">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />} This isn't right — dispute it
              </button>
              <p className="text-[10px] opacity-50">You can only do this for a short window after the agent delivers. If that window has closed, this won't work — you'll see a message explaining why.</p>
            </>
          )}
        </div>
      )}

      {canClaimRefund && onClaimRefund && (
        <div className="space-y-1.5 pt-1">
          <p className="opacity-80 leading-relaxed">The deadline passed and the agent never delivered anything. Your money is still safe — you can get it back right now.</p>
          <button onClick={handleClaimRefund} disabled={busy} className="w-full py-2 rounded-lg text-xs font-semibold border disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ color: accent, borderColor: accent + '4D' }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Coins size={13} />} Get my money back
          </button>
        </div>
      )}

      {status === 'EXPIRED' && <p className="opacity-80 leading-relaxed">This job expired with no delivery, and the money has already been sent back to you. Nothing left to do here.</p>}
      {error && <div className="text-red-500 whitespace-pre-wrap">{error}</div>}
    </div>
  );
}
