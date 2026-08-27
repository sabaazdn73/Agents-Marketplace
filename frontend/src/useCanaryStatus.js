// useCanaryStatus.js
//
// Real, bulk canary-verification status — GET /api/canary/status-bulk
// (backend/core/canary.py's get_canary_status_bulk()). One fetch for the
// whole marketplace, mirroring useAgentPerformanceBulk.js's own real
// retry/error-state discipline (a real fetch failure here must never be
// silently indistinguishable from "no agent has ever passed a canary
// test" — same class of gap already found and fixed in that file).
import { useState, useEffect, useCallback } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2000, 5000];

let _cached = null;

async function _fetchOnce() {
  const res = await fetch(`${API_BASE_URL}/api/canary/status-bulk`);
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  return res.json();
}

export function useCanaryStatus() {
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
      if (!cancelled) setState({ status: 'error', byOwner: null, error: lastErr?.message });
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => load(), [load]);

  return { byOwner: state.byOwner, status: state.status, retry: load };
}
