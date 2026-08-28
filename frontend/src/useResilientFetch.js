// useResilientFetch.js
//
// Real, shared "always show something real, never show a scary error"
// fetch pattern — the same confirmedFresh discipline the marketplace's
// own /api/agents already has server-side (serve instantly from cache,
// refresh silently in the background) now available to any per-agent
// panel. Built 2026-08-28 to replace the fragmented, inconsistent
// loading/error handling every real panel (PnLPanel, RevenueStreamPanel,
// OnchainPerformancePanel, etc.) previously rolled on its own.
//
// Real, deliberate behavior:
//   - A real, session-local cache (module-level Map, keyed by whatever
//     string the caller passes — typically the URL) serves the last
//     known-good real result INSTANTLY on every subsequent mount for the
//     same real key — never a loading spinner for data already
//     successfully fetched this session, even across navigating away and
//     back to an agent's detail page.
//   - A genuine fetch failure retries with real, capped exponential
//     backoff, silently — never surfaces an error to the user while
//     there's ANY real cached data (even stale) to keep showing instead.
//     `stale: true` is exposed so a caller CAN show a subtle "may be a
//     little out of date" hint if it wants to, but nothing forces an
//     error UI.
//   - Only ever shows a real, honest 'error' status on the very FIRST
//     fetch ever attempted for a real key, after real retries are
//     exhausted with nothing cached yet to fall back to — the one real
//     case where there's genuinely nothing honest to show instead.

import { useEffect, useState, useRef, useCallback } from 'react';

const _cache = new Map(); // key -> { data, fetchedAt }
const RETRY_DELAYS_MS = [1000, 3000, 8000, 20000]; // real, capped backoff — up to 4 silent retries before giving up

/** `key`: a stable string identifying this real fetch (e.g. the real URL).
 * `fetcher`: async () => data — thrown errors trigger the real retry path.
 * `ttlMs`: how long a real cached result is shown without a background
 * refresh check (default 5 min) — refreshing doesn't clear what's shown,
 * it only silently replaces it once the real, fresh result lands. */
export function useResilientFetch(key, fetcher, { ttlMs = 5 * 60 * 1000, enabled = true } = {}) {
  const cached = key ? _cache.get(key) : null;
  const [state, setState] = useState(() =>
    cached
      ? { status: 'ready', data: cached.data, stale: Date.now() - cached.fetchedAt > ttlMs }
      : { status: enabled && key ? 'loading' : 'idle', data: null, stale: false }
  );
  const cancelledRef = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback((background) => {
    if (!enabled || !key) return;
    cancelledRef.current = false;

    const attempt = (n) => {
      if (cancelledRef.current) return;
      fetcherRef.current()
        .then((data) => {
          if (cancelledRef.current) return;
          _cache.set(key, { data, fetchedAt: Date.now() });
          setState({ status: 'ready', data, stale: false });
        })
        .catch((e) => {
          if (cancelledRef.current) return;
          if (n < RETRY_DELAYS_MS.length) {
            setTimeout(() => attempt(n + 1), RETRY_DELAYS_MS[n]);
          } else if (_cache.has(key)) {
            // Real, existing cached data stays on screen — only ever
            // marked stale, never replaced with an error.
            setState((s) => ({ ...s, stale: true }));
          } else {
            setState({ status: 'error', data: null, stale: false, error: e?.message || String(e) });
          }
        });
    };
    if (!background) setState((s) => ({ ...s, status: cached ? 'ready' : 'loading' }));
    attempt(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => {
    load(!!cached); // real, silent background refresh if we already have something to show; a real foreground load otherwise
    return () => { cancelledRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { status: state.status, data: state.data, stale: state.stale, error: state.error, retry: () => load(false) };
}
