// AskTnega.jsx
//
// The on-site agent, at the top of the first page a visitor meets.
//
// SHARED ON PURPOSE
// One component, rendered by both AgentMarketplaceApp.web.jsx and
// AgentMarketplaceApp.mobile.jsx, in the manner of ConnectPage.jsx and
// SiteLinks.jsx. `variant` changes type sizes and nothing else: a phone has
// less width, not less to say.
//
// WHAT IT IS
// One question in plain language, answered by POST /api/ask, which reads the
// same six tools the MCP server exposes and nothing else. This component
// renders the reply. It computes nothing, decides nothing, and adds no
// sentence of its own to the answer.
//
// WHY THE EVIDENCE IS NOT BEHIND A LINK
// The reply carries the tool calls behind it, their arguments, the coverage
// each one reported and a JSON-RPC body that reproduces it against POST /mcp.
// That list is rendered under every answer, collapsed but present, because the
// argument this site makes is that nobody should have to take a number on
// faith. An answer with no evidence under it is the one shape this component
// will not draw.
//
// THE THREE REPLIES THAT ARE NOT ANSWERS
// A refusal, a degraded turn and an unreachable endpoint each say what
// happened in their own words:
//   - the endpoint refuses (429, 400): the body still carries `answer`, and
//     that sentence is rendered exactly as an answer would be
//   - the turn ran but the model could not be reached: `answered` is false and
//     `degraded` is true, and the reply says so itself
//   - the fetch fails: this component says the endpoint could not be reached,
//     which is a third state and not an absence of measurements
// None of the three is drawn as an empty box or a spinner that never ends.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles, Send, Loader2, ChevronDown, ChevronRight, Copy, Check,
} from 'lucide-react';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';

// Questions the six tools can actually answer, so a first click lands on
// something the endpoint reads rather than on something it has to refuse.
// Each one names a dataset that /api/ask/readiness lists.
const EXAMPLES = [
  'How many agents are verified on BNB Chain, and what does verified mean here?',
  'Which tracked Hyperliquid addresses have the highest post-only rejection rate?',
  'What does the ERC-8183 job index hold, and how current is it?',
];

function toneFor(reply) {
  if (!reply) return 'border-gray-200 dark:border-gray-800';
  if (reply.answered) return 'border-emerald-500/30';
  return 'border-amber-500/30';
}

function CoverageBits({ coverage }) {
  if (!coverage || typeof coverage !== 'object') return null;
  const bits = Object.entries(coverage)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .slice(0, 6);
  if (!bits.length) return null;
  return (
    <span className="text-gray-500 dark:text-gray-500">
      {bits.map(([k, v]) => `${k} ${String(v)}`).join(', ')}
    </span>
  );
}

function EvidenceRow({ step }) {
  const [copied, setCopied] = useState(false);
  const args = step.arguments && Object.keys(step.arguments).length
    ? JSON.stringify(step.arguments)
    : 'no arguments';

  const copy = () => {
    try {
      navigator.clipboard.writeText(JSON.stringify(step.replay, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) { /* a browser that refuses the clipboard is not an error state */ }
  };

  return (
    <li className="py-2 border-b border-gray-100 dark:border-gray-800/60 last:border-0">
      <div className="flex items-start gap-2 flex-wrap">
        <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
          {step.tool}
        </span>
        <span className="font-mono text-[11px] text-gray-500 dark:text-gray-500 break-all">
          {args}
        </span>
        {step.replay && (
          <button
            onClick={copy}
            className="ml-auto flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-900 dark:hover:text-white"
            title="Copy the JSON-RPC body that reproduces this call against /mcp"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'copied' : 'copy the call'}
          </button>
        )}
      </div>
      <div className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400 mt-0.5">
        {step.measured || 'no description returned'}
        {Number.isFinite(step.rows) ? `. ${step.rows} rows` : ''}
        {step.withheld_reason
          ? `. Withheld: ${step.withheld_reason}`
          : ''}
      </div>
      <div className="text-[11px] mt-0.5"><CoverageBits coverage={step.coverage} /></div>
      {Array.isArray(step.caveats) && step.caveats.map((c) => (
        <div key={c} className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">{c}</div>
      ))}
    </li>
  );
}

export default function AskTnega({ variant = 'web', className = '' }) {
  const [state, setState] = useState('checking'); // checking | ready | absent | unreachable
  const [readiness, setReadiness] = useState(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [reply, setReply] = useState(null);
  const [error, setError] = useState(null);
  const [openEvidence, setOpenEvidence] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/ask/readiness`);
        if (!live) return;
        if (res.status === 404) { setState('absent'); return; }
        if (!res.ok) { setState('unreachable'); return; }
        setReadiness(await res.json());
        setState('ready');
      } catch (e) {
        if (live) setState('unreachable');
      }
    })();
    return () => { live = false; };
  }, []);

  const ask = useCallback(async (text) => {
    const q = (text ?? question).trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    setReply(null);
    setOpenEvidence(false);
    try {
      const res = await fetch(`${API_BASE_URL}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      // A refusal carries its sentence in `answer` like an answer does, so
      // there is one reader for both and no status-code branch that ends in
      // an empty box.
      const body = await res.json().catch(() => null);
      if (body && typeof body.answer === 'string') setReply(body);
      else setError(`The endpoint replied ${res.status} with nothing to read.`);
    } catch (e) {
      setError('The endpoint could not be reached from this browser. '
        + 'That is a failed request, not an absence of measurements: the same '
        + 'figures are served at /api and over MCP at /mcp.');
    } finally {
      setAsking(false);
    }
  }, [question, asking]);

  if (state === 'checking' || state === 'absent' || state === 'unreachable') {
    // Nothing is drawn while the check is in flight, and nothing is drawn if
    // the route is not deployed: a box that cannot answer is worse than no box
    // at the top of the page. The Connect tab is where the endpoint's state is
    // reported in words.
    return null;
  }

  const small = variant === 'mobile';
  const evidence = Array.isArray(reply?.evidence) ? reply.evidence : [];

  return (
    <div className={`bg-white dark:bg-[#1E293B] rounded-2xl border ${toneFor(reply)} shadow-sm p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-1">
        <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <Sparkles size={15} />
        </div>
        <h2 className={`font-bold ${small ? 'text-[14px]' : 'text-[15px]'}`}>
          Ask this site what it has measured
        </h2>
      </div>
      <p className={`${small ? 'text-[11px]' : 'text-[12px]'} leading-relaxed text-gray-600 dark:text-gray-400 mb-3`}>
        One question, answered from the same six tools the MCP server exposes and
        from nothing else. Every answer arrives with the calls behind it, so it can
        be checked rather than believed. It states a reason instead of a number
        where there is nothing to state.
      </p>

      <div className="flex gap-2 items-stretch">
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
          maxLength={readiness?.bounds?.question_chars_max || 500}
          placeholder="What do you want to know?"
          aria-label="Ask a question about what this site has measured"
          className={`flex-1 min-w-0 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] ${small ? 'text-[12px]' : 'text-[13px]'} outline-none focus:border-indigo-400`}
        />
        <button
          onClick={() => ask()}
          disabled={asking || !question.trim()}
          className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white text-[12px] font-semibold flex items-center gap-1.5 shrink-0"
        >
          {asking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {asking ? 'Reading' : 'Ask'}
        </button>
      </div>

      {!reply && !asking && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              onClick={() => { setQuestion(e); ask(e); }}
              className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-left"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Readiness reports what the last turn did, not only that a key is
          set. When the last one failed, the box still works and says so
          first: a question that is about to be refused should be refused
          before it is typed, not after. */}
      {readiness?.answering === false && !reply && !asking && (
        <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400 mt-2">
          The last question asked here was not answered
          {readiness?.recent_turns?.last_failure
            ? `: ${readiness.recent_turns.last_failure.replace(/_/g, ' ')}`
            : ''}
          . Asking is still worth a try, and the reply will say what happened either way.
        </p>
      )}

      {asking && (
        <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-2">
          Reading the datasets. A turn is capped at{' '}
          {readiness?.bounds?.tool_calls_max ?? 4} tool calls and{' '}
          {Math.round(readiness?.bounds?.turn_deadline_seconds ?? 75)} seconds, so this
          ends either way.
        </p>
      )}

      {error && (
        <p className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-400 mt-3">
          {error}
        </p>
      )}

      {reply && (
        <div className="mt-3">
          <p className={`${small ? 'text-[12px]' : 'text-[13px]'} leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap`}>
            {reply.answer}
          </p>

          {/* The state of the turn, in the reply's own terms. `degraded` and
              `answered` are separate fields because a turn that read the data
              and could not reach the model is not the same as one that read
              nothing. */}
          {(!reply.answered || reply.degraded) && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5">
              {reply.answered
                ? 'This answer is partial: part of the turn did not complete.'
                : 'No answer was given, and nothing was guessed in its place.'}
              {Array.isArray(reply.guards) && reply.guards.length
                ? ` (${reply.guards.join(', ')})`
                : ''}
            </p>
          )}

          {evidence.length > 0 ? (
            <div className="mt-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-white/[0.02] p-2.5">
              <button
                onClick={() => setOpenEvidence((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                {openEvidence ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                What it read: {evidence.length} {evidence.length === 1 ? 'call' : 'calls'}
              </button>
              {openEvidence && (
                <ul className="mt-1.5">
                  {evidence.map((s) => <EvidenceRow key={`${s.step}-${s.tool}`} step={s} />)}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-2">
              No datasets were read for this reply.
            </p>
          )}

          <button
            onClick={() => { setReply(null); setQuestion(''); inputRef.current?.focus(); }}
            className="text-[11px] text-gray-500 hover:text-gray-900 dark:hover:text-white mt-2"
          >
            Ask something else
          </button>
        </div>
      )}
    </div>
  );
}
