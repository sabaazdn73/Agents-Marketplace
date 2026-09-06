// agentsPrefetch.js
//
// Starts the agent-list request before the marketplace mounts.
//
// The landing page exists to cover the time /api/agents takes to load. It
// only does that if the request is already in flight while someone is
// looking at the character. If the fetch waited for the click, the page
// would add its own duration to the wait instead of hiding it.
//
// So the landing page calls start() on mount and the marketplace hook
// calls consume(), which hands back the same in-flight promise rather than
// issuing a second identical request.
//
// Deliberately module-level and in-memory. No storage of any kind: this
// has to work where localStorage does not, and an in-flight promise is not
// something that could usefully be persisted anyway.
//
// Retries come free: window.fetch is wrapped at app entry (apiRetry.js), so
// a prefetch that lands during a backend restart recovers the same way any
// other GET does.

let inflight = null;

/** Begin fetching, unless it is already running. Safe to call repeatedly. */
export function startAgentsPrefetch(url) {
  if (inflight || !url) return;
  inflight = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      return res.json();
    })
    .catch((err) => {
      // A failed prefetch must not poison the marketplace's own attempt.
      // Clearing it here means consume() returns null and the hook fetches
      // normally, with its own error handling.
      inflight = null;
      throw err;
    });
}

/** The in-flight prefetch, or null if there isn't one.
 *
 * Cleared on read so a later remount does a fresh fetch rather than
 * replaying a response that may be minutes old by then. */
export function consumeAgentsPrefetch() {
  const p = inflight;
  inflight = null;
  return p;
}
