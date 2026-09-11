// AgentStudioPage.jsx
//
// The agent studio. A set of robots working on one purchase, with the work
// passing visibly between them.
//
// Two flows share the agents where they overlap. Physical goods runs
// Profile, Context, Merchant Fit, Search, Styling and QA, and hands the
// finished cart back, because Payment there needs a card partner that is
// not connected. API and services runs Intent, API Fit, Match and QA, and
// Payment is awake on the B402 rail.
//
// EVERYTHING SHOWN COMES FROM THE BACKEND
// A robot is idle, working, done, blocked or asleep because the coordinator
// said so. The page never advances a robot on a timer or guesses what a
// stage will return. When a stage is model backed and the model is not
// available, the robot shows blocked with the reason the backend gave,
// which is usually that it is waiting on the model.
//
// THE TIME IS NOT HIDDEN
// A run takes a while. Context alone has measured at 74 seconds. Rather
// than a progress bar that invents a percentage, the working robot shows
// how long it has been at it, counted from the backend's own start time.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  User, Calendar, Globe, Search as SearchIcon, Sparkles, ShieldCheck,
  CreditCard, Target, Plug, Scale, Check, X, Moon, Loader2, ExternalLink,
} from 'lucide-react';
import PayB402Page from './PayB402Page';
import './agentStudio.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const SPRITES = '/agent-hero/assets';
const POLL_MS = 1500;

const PROPS = {
  user: User, calendar: Calendar, globe: Globe, search: SearchIcon,
  sparkles: Sparkles, shield: ShieldCheck, card: CreditCard,
  target: Target, plug: Plug, scale: Scale,
};

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

function Robot({ agent, slot, elapsed }) {
  const Prop = PROPS[agent.prop] || Sparkles;
  const state = slot?.state || 'idle';
  const badge = state === 'done' ? 'done' : state === 'blocked' ? 'blocked' : state === 'asleep' ? 'asleep' : null;

  return (
    <div className="studio-agent" data-state={state} style={{ '--accent': agent.accent }}>
      <div className="studio-robot">
        <img src={`${SPRITES}/${agent.sprite}.png`} alt="" />
        <span className="studio-prop"><Prop size={12} /></span>
        {badge && (
          <span className="studio-status" data-kind={badge}>
            {badge === 'done' && <Check size={11} />}
            {badge === 'blocked' && <X size={11} />}
            {badge === 'asleep' && <Moon size={10} />}
          </span>
        )}
      </div>
      <div>
        <div className="studio-label" style={{ color: state === 'idle' ? undefined : agent.accent }}>
          {agent.label}
        </div>
        <div className="studio-sub">
          {state === 'working' && (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={9} className="animate-spin" />
              working {elapsed != null ? `${elapsed}s` : ''}
            </span>
          )}
          {state === 'idle' && agent.blurb}
          {(state === 'done' || state === 'blocked' || state === 'asleep') && (slot?.note || agent.blurb)}
        </div>
      </div>
    </div>
  );
}

export default function AgentStudioPage({ accent = '#6366F1' }) {
  const reduced = usePrefersReducedMotion();
  const [flows, setFlows] = useState(null);
  const [flow, setFlow] = useState('physical');
  const [request, setRequest] = useState('');
  const [run, setRun] = useState(null);
  const [starting, setStarting] = useState(false);
  const [answers, setAnswers] = useState({});
  const [sending, setSending] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/studio/flows`)
      .then((r) => r.json())
      .then(setFlows)
      .catch((e) => setError(e.message));
    return () => clearTimeout(timer.current);
  }, []);

  const poll = useCallback(async (runId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/studio/runs/${runId}`);
      if (!res.ok) throw new Error(`Run not found (${res.status}).`);
      const data = await res.json();
      setRun(data);
      if (!data.finished) timer.current = setTimeout(() => poll(runId), POLL_MS);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const sendAnswers = async () => {
    if (!run?.pending) return;
    setSending(true); setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/studio/runs/${run.run_id}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Could not send the answers.');
      setAnswers({});
      setRun(data);
      poll(data.run_id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  // A rate limited stage is retried by answering with nothing, which
  // resumes the same agent without changing anything it already knows.
  const retryStage = async () => {
    if (!run) return;
    setSending(true); setError(null);
    try {
      // /retry, not /answers. A stage killed by a model outage asks no
      // question, so it leaves `pending` empty, and /answers reads that as a
      // run with nothing to resume: it returned 200 with the run unchanged
      // and this button did nothing in exactly the case it exists for.
      const res = await fetch(`${API_BASE_URL}/api/studio/runs/${run.run_id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Could not retry.');
      setRun(data);
      poll(data.run_id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const start = async () => {
    setError(null); setRun(null); setStarting(true);
    clearTimeout(timer.current);
    try {
      const res = await fetch(`${API_BASE_URL}/api/studio/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow, request }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Could not start the run.');
      setRun(data);
      poll(data.run_id);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const spec = flows?.flows?.find((f) => f.key === flow);
  const agents = run?.agents || spec?.agents || [];
  const slots = run?.state || {};
  const handoff = run?.handoff;

  const placeholder = flow === 'physical'
    ? 'A wool coat for Oslo in December, size M, budget 200 USD, I am in London. Paste product links and the agents will read them.'
    : 'I need to turn text into speech for a podcast, budget 1 U per call.';

  return (
    <div className={`agent-studio space-y-5 ${reduced ? 'reduced' : ''}`}>
      <div>
        <h1 className="text-2xl font-bold mb-1">Agent studio</h1>
        <p className="text-sm text-gray-500 max-w-2xl leading-relaxed">
          A set of agents working on one purchase, passing what they find to each other.
          Each does one job, so when a result is wrong you can see which one produced it.
        </p>
      </div>

      {/* Flow choice. Not two tabs. */}
      <div className="flex gap-2">
        {(flows?.flows || [{ key: 'physical', label: 'Physical goods' }, { key: 'api', label: 'API and services' }])
          .map((f) => (
            <button
              key={f.key}
              onClick={() => { setFlow(f.key); setRun(null); setError(null); clearTimeout(timer.current); }}
              className={`px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors ${
                flow === f.key
                  ? 'border-transparent text-white'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
              style={flow === f.key ? { backgroundColor: accent } : undefined}
            >
              {f.label}
            </button>
          ))}
      </div>

      {flow === 'physical' && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] text-amber-700 dark:text-amber-500 leading-relaxed">
          The agents read product links you paste. They cannot browse shops on their own:
          retailers block automated requests, and the search quota this key has does not cover it.
          If an agent cannot find something it says so rather than making a list up.
        </div>
      )}

      {flow === 'api' && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-[12px] text-emerald-700 dark:text-emerald-500 leading-relaxed">
          These services are found in the B402 directory and settle in $U on BNB Chain.
          API Fit reports how many it actually found, including none.
        </div>
      )}

      {/* The robots. */}
      <div className="studio-track">
        {agents.map((a, i) => (
          <React.Fragment key={a.key}>
            {i > 0 && (
              <div
                className="studio-link"
                data-active={handoff && handoff.to === a.key ? 'true' : 'false'}
                style={{ '--accent': a.accent }}
              >
                {handoff && handoff.to === a.key && <span className="studio-token" />}
              </div>
            )}
            <Robot
              agent={a}
              slot={slots[a.key]}
              elapsed={run?.current === a.key ? run?.current_elapsed_s : null}
            />
          </React.Fragment>
        ))}
      </div>

      {handoff && !run?.finished && (
        <div className="text-[11px] text-gray-500">
          Passing {handoff.label} to {agents.find((a) => a.key === handoff.to)?.label}
        </div>
      )}

      {/* Ask. */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
        <label className="block text-[10px] uppercase tracking-wide text-gray-400" htmlFor="studio-request">
          What do you need
        </label>
        <textarea
          id="studio-request"
          rows={3}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-sm leading-relaxed"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={start}
            disabled={starting || !request.trim() || (run && !run.finished)}
            className="text-sm font-semibold text-white px-4 py-2 rounded-lg disabled:opacity-60"
            style={{ backgroundColor: accent }}
          >
            {run && !run.finished ? 'Agents are working…' : starting ? 'Starting…' : 'Start the agents'}
          </button>
          {run && (
            <span className="text-[11px] text-gray-400">
              {run.finished ? 'Finished' : 'Running'} after {run.total_elapsed_s}s
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          A run takes a while. Context alone has measured at 74 seconds, so watching which robot is
          working is more use than a bar that guesses.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* The waiting agent's questions, answerable in place. */}
      {run?.pending && (
        <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-4 space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">
            {agents.find((a) => a.key === run.pending.agent)?.label || run.pending.agent} needs an answer
          </h2>
          {run.pending.questions.map((q) => (
            <div key={q.id}>
              <label className="block text-[12px] mb-1" htmlFor={`q-${q.id}`}>{q.label}</label>
              <input
                id={`q-${q.id}`}
                value={answers[q.id] || ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                placeholder={q.placeholder || ''}
                inputMode={q.kind === 'number' ? 'decimal' : 'text'}
                className="w-full max-w-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-sm"
              />
            </div>
          ))}
          <button
            onClick={sendAnswers}
            disabled={sending || !run.pending.questions.some((q) => (answers[q.id] || '').trim())}
            className="text-sm font-semibold text-white px-4 py-2 rounded-lg disabled:opacity-60"
            style={{ backgroundColor: accent }}
          >
            {sending ? 'Sending…' : 'Answer and carry on'}
          </button>
          <p className="text-[11px] text-gray-400">
            Only this agent runs again. The ones before it keep what they already worked out.
          </p>
        </div>
      )}

      {/* A transient provider error is temporary, so it offers a retry rather
          than ending. This used to match only the rate-limit wording, which
          left the other half of the taxonomy with no way forward: a 503 says
          "is busy", never "rate limited", so a run killed by provider load
          ended with a dead end. Both are retryable and both are offered. */}
      {run?.finished && /rate limited|is busy|RESOURCE_EXHAUSTED|UNAVAILABLE|429|503/i.test(
        run.stages?.[run.stages.length - 1]?.note || '') && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <div className="text-[12px] text-amber-700 dark:text-amber-500">
            The model is {/is busy|UNAVAILABLE|503/i.test(run.stages?.[run.stages.length - 1]?.note || '')
              ? 'busy' : 'rate limited'}. That is temporary, not a failure of the run.
          </div>
          <button
            onClick={retryStage}
            disabled={sending}
            className="text-sm font-medium px-3.5 py-1.5 rounded-lg border border-amber-500/40 text-amber-700 dark:text-amber-500 disabled:opacity-60"
          >
            {sending ? 'Retrying…' : 'Try that agent again'}
          </button>
        </div>
      )}

      {/* Payment, folded in from the old Pay.B402 tab. Same endpoints, same
          server held requirements, same signing. Only its home changed. */}
      {flow === 'api' && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800">
          <button
            onClick={() => setShowPay((v) => !v)}
            className="w-full flex items-center justify-between p-4 text-left"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Payment agent, B402 on BNB Chain
            </span>
            <span className="text-[11px] text-gray-400">
              {showPay || run?.current === 'payment' ? 'Hide' : 'Show rail check and pay'}
            </span>
          </button>
          {(showPay || run?.current === 'payment') && (
            <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800 pt-4">
              <PayB402Page accent={accent} embedded />
            </div>
          )}
        </div>
      )}

      {/* What each agent actually returned. */}
      {run?.stages?.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
            What each agent reported
          </h2>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {run.stages.map((s, i) => (
              <div key={`${s.stage}-${i}`} className="py-2 flex items-start gap-2.5">
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                  s.status === 'ok'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-500'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
                }`}>
                  {s.status}
                </span>
                <div className="min-w-0">
                  <div className="text-[12px] font-medium">{s.stage} <span className="text-gray-400 font-normal">{Math.round(s.duration_ms)}ms</span></div>
                  <div className="text-[11px] text-gray-500 leading-relaxed">{s.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {run?.result?.kind === 'cart' && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <h2 className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-500 mb-2">
            Your cart, {run.result.total?.display}
          </h2>
          <p className="text-[11px] text-gray-500 mb-2">
            Payment is asleep in this flow, so each item is linked for you to buy yourself.
          </p>
          <ul className="space-y-1.5">
            {run.result.lines.map((ln) => (
              <li key={ln.url} className="text-[12px]">
                <a href={ln.url} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline">
                  {ln.title} <ExternalLink size={10} />
                </a>
                <span className="text-gray-500 font-mono ml-2">{ln.price?.display}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {run?.result?.kind === 'service' && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-[12px]">
          <h2 className="font-semibold text-emerald-700 dark:text-emerald-500 mb-2">Chosen service</h2>
          {(run.result.selection || []).map((sel) => (
            <div key={sel.url} className="mb-2">
              <a href={sel.url} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline break-all">
                {sel.url} <ExternalLink size={10} />
              </a>
              <span className="text-gray-500 font-mono ml-2">{sel.price?.display}</span>
            </div>
          ))}
          <p className="text-[11px] text-gray-500 leading-relaxed">
            {run.result.settled
              ? 'Settled on BNB Chain.'
              : 'Payment picked the B402 rail. Settling needs a signature from your own wallet, which this backend cannot produce, so finish it on the Pay.B402 tab.'}
          </p>
        </div>
      )}

      {run?.error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] text-amber-700 dark:text-amber-500">
          {run.error}
        </div>
      )}
    </div>
  );
}
