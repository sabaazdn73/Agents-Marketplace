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

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, ExternalLink, AlertTriangle, RefreshCw, Coins, FileText, Sparkles } from 'lucide-react';
import { getJobStatus, getDeliverable } from './altana';
import { trackJob } from './notifications';

const DELIVERABLE_FETCH_TIMEOUT_MS = 12_000;
const DELIVERABLE_MAX_CHARS = 4000; // long deliverables get truncated with a "view full" link, not a broken layout

/** Fetches the real deliverable URL and figures out, from what actually
 * comes back, how to show it honestly: real JSON pretty-printed, a real
 * image shown inline, real plain text as text. If the fetch itself fails
 * (very possible — it's an arbitrary third-party URL and many hosts block
 * cross-origin fetches), that's reported honestly too, with the raw link
 * as the fallback — never silently swallowed into "no deliverable". */
function useDeliverableContent(url) {
  const [state, setState] = useState({ status: 'idle' }); // idle|loading|json|image|text|fetch-failed
  useEffect(() => {
    if (!url) { setState({ status: 'idle' }); return; }
    let cancelled = false;
    setState({ status: 'loading' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERABLE_FETCH_TIMEOUT_MS);
    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.startsWith('image/')) {
          setState({ status: 'image' });
          return;
        }
        const text = await res.text();
        if (cancelled) return;
        try {
          const parsed = JSON.parse(text);
          setState({ status: 'json', content: JSON.stringify(parsed, null, 2) });
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

function DeliverableViewer({ url }) {
  const state = useDeliverableContent(url);
  const [expanded, setExpanded] = useState(false);

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
  // json or text
  const full = state.content || '';
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

// One plain-language line per status, written for a total beginner — no
// jargon, no assuming the reader knows what "escrow" or "settlement" mean.
const STATUS_COPY = {
  OPEN: "This job has been created but not paid for yet.",
  FUNDED: "Your payment is locked and waiting. The agent hasn't finished the work yet — there's nothing to show until it does.",
  SUBMITTED: "The agent says it's done! Here's what it delivered:",
  COMPLETED: "Job finished. The agent got paid, and here's what you received:",
  REJECTED: "You disputed this delivery, and it was decided in your favor — you got your money back.",
};

export default function JobStatusPanel({
  jobId, initialStatus, mutedBorder, accent,
  onDispute, onClaimRefund,
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

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const j = await getJobStatus(jobId);
      setJob(j); setStatus(j.statusName);
      trackJob(jobId, j.statusName);
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

  return (
    <div className={`mt-3 p-3 rounded-xl border ${mutedBorder} text-xs space-y-2`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold">Job #{String(jobId)}</span>
          {agentLabel && (
            agentLink ? <a href={agentLink} className="text-indigo-500 hover:underline">— {agentLabel}</a> : <span className="opacity-60">— {agentLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold" style={{ color: accent }}>{loading ? '…' : (status || 'unknown')}</span>
          <button onClick={refresh} disabled={busy} className="opacity-60 hover:opacity-100"><RefreshCw size={12} /></button>
        </div>
      </div>

      {/* One plain-English line explaining exactly where things stand, before anything else. */}
      {status && STATUS_COPY[status] && <p className="opacity-80 leading-relaxed">{STATUS_COPY[status]}</p>}

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
              <span>Couldn't check for a result right now ({deliverableState.error}) — this is a real read failure, not necessarily "nothing delivered". <button onClick={refresh} className="underline">Retry</button></span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 opacity-60"><FileText size={12} /> The agent hasn't posted a result we can find on-chain yet.</div>
          )}
          {submitted && onDispute && (
            <>
              <button onClick={handleDispute} disabled={busy} className="w-full py-2 rounded-lg text-xs font-semibold text-red-600 border border-red-500/30 disabled:opacity-50 flex items-center justify-center gap-1.5">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />} This isn't right — dispute it
              </button>
              <p className="text-[10px] opacity-50">You can only do this for a short window after the agent delivers. If that window has closed, the button above won't work — the contract will say so.</p>
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
