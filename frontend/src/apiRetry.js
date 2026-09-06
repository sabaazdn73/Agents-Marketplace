// apiRetry.js
//
// Retries transient backend failures once, at the transport layer, for
// every call in the app.
//
// WHY THIS IS GLOBAL RATHER THAN PER-CALL
// ---------------------------------------
// The backend is OOM-killed by its 512Mi cap roughly 0.4 times an hour and
// restarts in seconds (docs/memory-ceiling.md). Any request that lands in
// one of those windows fails. The agent list was given its own retry after
// the marketplace rendered "Couldn't load the agent list" with every count
// at 0; the next report named a different endpoint, /api/my-jobs, showing
// "Couldn't load your hires". That was predictable: 21 files call the
// backend and only 6 went through the resilient helper, so fixing them one
// at a time would have meant waiting for each to be reported.
//
// Patching fetch once covers every call site, including ones added later,
// which is the point. A per-call fix has to be remembered; this does not.
//
// WHAT IT DELIBERATELY DOES NOT RETRY
// -----------------------------------
// Only idempotent requests. GET and HEAD are safe to repeat; POST is not,
// and this app POSTs to /api/agents/negotiate and /api/agents/notify-funded
// during a hire. Retrying a write that actually succeeded but whose
// response was lost would duplicate a real action against someone's money,
// which is far worse than the error message this exists to prevent.
//
// It also only retries OUR backend. Third-party endpoints have their own
// rate limits and budgets, and silently tripling a request against a
// metered key would be its own bug.
//
// Retried: network-level failures (the "Failed to fetch" case, which is
// what a mid-restart connection produces) and 502/503/504, which is what a
// proxy in front of a restarting service returns. Not 4xx, and not 500: a
// 500 is the backend answering with a real error, and hiding it behind
// retries would make a genuine bug look like slowness.

const RETRY_DELAYS_MS = [1200, 3500, 9000];   // 4 attempts, ~14s total
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRYABLE_METHODS = new Set(['GET', 'HEAD']);

let installed = false;

/** Wraps window.fetch. Safe to call more than once; only the first wins. */
export function installApiRetry(apiBaseUrl) {
  if (installed || typeof window === 'undefined' || !window.fetch) return;
  installed = true;

  const base = (apiBaseUrl || '').replace(/\/+$/, '');
  const nativeFetch = window.fetch.bind(window);

  const isOurApi = (input) => {
    try {
      const url = typeof input === 'string' ? input : (input?.url ?? '');
      if (!url) return false;
      if (base && url.startsWith(base)) return true;
      // Same-origin /api/... covers a deployment where the frontend and
      // backend share a host and API_BASE_URL is empty.
      return !base && url.startsWith('/api/');
    } catch {
      return false;
    }
  };

  const methodOf = (input, init) => {
    const m = init?.method || (typeof input === 'object' ? input?.method : null) || 'GET';
    return String(m).toUpperCase();
  };

  window.fetch = async (input, init) => {
    if (!isOurApi(input) || !RETRYABLE_METHODS.has(methodOf(input, init))) {
      return nativeFetch(input, init);
    }
    // An aborted request is the caller changing its mind, not a failure.
    if (init?.signal?.aborted) return nativeFetch(input, init);

    let lastError;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await nativeFetch(input, init);
        if (!RETRYABLE_STATUS.has(res.status)) return res;
        lastError = new Error(`HTTP ${res.status}`);
      } catch (err) {
        if (err?.name === 'AbortError') throw err;   // caller cancelled
        lastError = err;
      }
      const wait = RETRY_DELAYS_MS[attempt];
      if (wait == null) break;
      await new Promise((r) => setTimeout(r, wait));
      if (init?.signal?.aborted) throw lastError;
    }
    throw lastError;
  };
}
