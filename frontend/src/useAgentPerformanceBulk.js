// useAgentPerformanceBulk.js
//
// Real, marketplace-wide on-chain track record — GET /api/agents/performance/bulk
// (backend/core/agent_performance.py's get_all_agent_performance(), a bulk
// version of the same cached scan the agent detail page's "Past Hires"
// panel already reads one owner at a time). One fetch for the whole
// marketplace, not one request per agent — the real data behind the
// "Most hired" / "Highest success rate" sort options AND the "Only verified
// working" filter. Shared by web and mobile so both rank agents from the
// exact same real numbers.
//
// Real robustness gap found and fixed (2026-08-27): a real user reported
// "Only verified working" showing zero agents, even though a direct, live
// recomputation against the same production API at the same time found 17
// real verified agents — the underlying data was fine. Root cause traced
// to THIS file: on ANY fetch failure (a real, plausible trigger being this
// project's own backend cache reset on every redeploy — the first request
// after a restart has to run a fresh ~1500-job Multicall3 scan from a cold
// cache, a real window where a slow/cold RPC could plausibly time out or
// blip), the old version silently swallowed the error and left `byOwner`
// null for the rest of the page session, with NO retry and no way for the
// UI to tell "still loading" apart from "genuinely failed". `withPerformance`
// (agentRanking.js) treats a null `byOwner` as "no agent anywhere has any
// real history" — exactly why the verified-working filter would show
// zero: every agent's jobsCompleted/jobsSubmitted silently defaulted to 0,
// indistinguishable from a real empty result. Fixed with a real
// retry-with-backoff and an honest `status`, so a genuine failure can be
// shown and retried, not silently mistaken for "no verified agents exist".
import { useEffect, useState, useCallback } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2000, 5000]; // between attempts 1->2 and 2->3

let _cached = null; // a real SUCCESS is cached for the rest of the page session — a genuine failure is NEVER cached, so the next mount (or an explicit retry) tries fresh

async function _fetchOnce() {
  const res = await fetch(`${API_BASE_URL}/api/agents/performance/bulk`);
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  return res.json();
}

/** Returns { byOwner, status, retry }.
 * `status`: 'loading' | 'ready' | 'error' — real, honest state, not just
 * inferred from whether `byOwner` is null (loading and error both start
 * that way, but callers that care about the difference — e.g. showing
 * "couldn't load real verification data" instead of silently implying zero
 * verified agents exist — now can). `retry()` forces a fresh attempt. */
export function useAgentPerformanceBulk() {
  const [state, setState] = useState(() =>
    _cached ? { status: 'ready', byOwner: _cached.by_owner } : { status: 'loading', byOwner: null }
  );

  const load = useCallback(() => {
    if (_cached) { setState({ status: 'ready', byOwner: _cached.by_owner }); return () => {}; }
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));

    (async () => {
      let lastErr = null;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
        if (cancelled) return;
        try {
          const data = await _fetchOnce();
          if (cancelled) return;
          _cached = data;
          setState({ status: 'ready', byOwner: data.by_owner || {} });
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      // Real, genuine failure after real retries — surfaced honestly, not
      // silently swallowed.
      if (!cancelled) setState({ status: 'error', byOwner: null, error: lastErr?.message });
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => load(), [load]);

  return { byOwner: state.byOwner, status: state.status, retry: load };
}
