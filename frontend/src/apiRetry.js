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
// during a hire. Retrying a write that succeeded but whose
// response was lost would duplicate a action against someone's money,
// which is far worse than the error message this exists to prevent.
//
// It also only retries OUR backend. Third-party endpoints have their own
// rate limits and budgets, and silently tripling a request against a
// metered key would be its own bug.
//
// Retried: network-level failures (the "Failed to fetch" case, which is
// what a mid-restart connection produces) and 502/503/504, which is what a
// proxy in front of a restarting service returns. Not 4xx, and not 500: a
// 500 is the backend answering with an error, and hiding it behind
// retries would make a bug look like slowness.

const RETRY_DELAYS_MS = [1200, 3500, 9000];   // 4 attempts, ~14s total
// A STALLED API. Without a limit, a request to an API that took the
// connection and never answered waited for the browser's own (minutes), and
// the page showed its heading with nothing under it. Two limits, because
// the two waits are different:
//   HEADERS_TIMEOUT_MS  until the response headers arrive. A server that
//                       has not started answering by then is stalled; the
//                       attempt is retried once (a Render restart can take
//                       the first), then the page's notice shows: ~8 + 1.2
//                       + 8, about 17 s.
//   BODY_TIMEOUT_MS     for the body once the headers are in. A phone on a
//                       slow network can take many seconds to receive the
//                       vault list (92.7 KB raw, about 10 KB as sent, Brotli-compressed; measured
//                       2026-09-27), so this is generous, and
//                       it is not retried: the server did answer.
// The body is read here, under its own limit, and handed on as a fresh
// Response, so the caller never waits on an unbounded stream.
// A refused connection still takes the retries, ~14 s.
const HEADERS_TIMEOUT_MS = 8000;
const BODY_TIMEOUT_MS = 20000;
const HEADER_TIMEOUT_RETRIES = 1;

// A caller may give one endpoint a longer header limit, through the fetch
// init key HEADERS_TIMEOUT_KEY (fetch ignores keys it does not know): the
// vault list takes 6 to 7 s to its first byte live, too close to 8 s.
export const HEADERS_TIMEOUT_KEY = 'tnegaHeadersTimeoutMs';

// The limit that fired is in the message, so the notice names the right
// number of seconds (te/ReadError.jsx reads it).
function timeoutError(kind, ms) {
  const e = new Error(kind === 'body'
    ? `answer not finished within ${ms / 1000} s`
    : `no answer within ${ms / 1000} s, twice`);
  e.name = 'TimeoutError';
  return e;
}

// What a caller's cancel looks like, whenever it happens, including during
// the wait between two attempts.
function abortError() {
  try { return new DOMException('The request was cancelled.', 'AbortError'); } catch {
    const e = new Error('The request was cancelled.'); e.name = 'AbortError'; return e;
  }
}
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

    const headersMs = Number(init?.[HEADERS_TIMEOUT_KEY]) > 0 ? Number(init[HEADERS_TIMEOUT_KEY]) : HEADERS_TIMEOUT_MS;
    let lastError;
    let headerTimeouts = 0;
    for (let attempt = 0; ; attempt++) {
      // The caller's own signal still cancels; the limits are added to it.
      const timer = new AbortController();
      let phase = 'headers';
      let t = setTimeout(() => timer.abort(), headersMs);
      const signals = [timer.signal, init?.signal].filter(Boolean);
      const signal = signals.length > 1 && typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : timer.signal;
      if (signals.length > 1 && typeof AbortSignal.any !== 'function') init.signal.addEventListener('abort', () => timer.abort(), { once: true });
      try {
        const { [HEADERS_TIMEOUT_KEY]: _unused, ...rest } = init || {};
        const res = await nativeFetch(input, { ...rest, signal });
        clearTimeout(t);
        if (!RETRYABLE_STATUS.has(res.status)) {
          phase = 'body';
          t = setTimeout(() => timer.abort(), BODY_TIMEOUT_MS);
          const body = await res.arrayBuffer();
          clearTimeout(t);
          return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
        }
        lastError = new Error(`HTTP ${res.status}`);
      } catch (err) {
        clearTimeout(t);
        if (init?.signal?.aborted) throw abortError();   // caller cancelled
        if (timer.signal.aborted) {
          if (phase === 'body') throw timeoutError('body', BODY_TIMEOUT_MS);
          headerTimeouts += 1;
          if (headerTimeouts > HEADER_TIMEOUT_RETRIES) throw timeoutError('headers', headersMs);
          lastError = timeoutError('headers', headersMs);
        } else {
          lastError = err;
        }
      }
      const wait = RETRY_DELAYS_MS[attempt];
      if (wait == null) break;
      // The wait itself ends early, with an AbortError, if the caller cancels.
      await new Promise((resolve, reject) => {
        const w = setTimeout(() => { init?.signal?.removeEventListener?.('abort', onAbort); resolve(); }, wait);
        function onAbort() { clearTimeout(w); reject(abortError()); }
        init?.signal?.addEventListener?.('abort', onAbort, { once: true });
      });
    }
    throw lastError;
  };
}
