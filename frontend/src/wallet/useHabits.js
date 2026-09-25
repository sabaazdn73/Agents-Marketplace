// useHabits.js
//
// POST /api/wallet/habits for the connected address. The route reads the
// address's public record on Hyperliquid and returns holdings and what its
// habits cost, measured (backend/core/hyperliquid/wallet_habits.py).
//
// THE ADDRESS GOES IN THE BODY, NEVER THE URL
// A URL, query string included, lands in access logs. See
// docs/data-handling.md.
//
// ONE NEW WALLET A MINUTE, ACROSS ALL VISITORS
// The owner's decision: the route reads one uncached wallet at a time and
// answers 429 with Retry-After when it cannot. So this hook:
//   - asks once when the page opens for an address, and again only when the
//     visitor presses refresh;
//   - on a 429, shows the route's own sentence and the wait, and does not
//     retry by itself. The retry button stays disabled until Retry-After has
//     passed; there is no loop and no timer that fires a request;
//   - keeps the answer for the session (five minutes, the route's own cache
//     time), so moving between tabs does not spend the budget again.

import { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const SESSION_TTL_MS = 5 * 60 * 1000;
const memo = new Map(); // lowercased address -> { at, data }
const pending = new Map(); // lowercased address -> the one request in flight for it

// One request per address at a time, shared by every caller: a second load for
// an address already being read waits for that read instead of spending the
// budget again. Resolves to the state the answer should produce; never throws.
function readHabits(key) {
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/wallet/habits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: key }),
        credentials: 'omit',
        cache: 'no-store',
      });
      let body = null;
      try { body = await r.json(); } catch { body = null; }
      if (r.status === 429) {
        const header = Number(r.headers.get('Retry-After'));
        const seconds = Number.isFinite(header) && header > 0 ? header
          : (Number(body?.retry_after_seconds) || 60);
        return {
          status: 'busy',
          detail: body?.detail || 'The server is reading another wallet.',
          reason: body?.reason || null,
          retryAt: Date.now() + seconds * 1000,
          forKey: key,
        };
      }
      if (!r.ok) {
        return {
          status: 'error',
          httpStatus: r.status,
          detail: (body && typeof body.detail === 'string' && body.detail)
            || `The server answered ${r.status}.`,
          forKey: key,
        };
      }
      const at = Date.now();
      memo.set(key, { at, data: body });
      return { status: 'ok', data: body, fetchedAt: at, forKey: key };
    } catch {
      return { status: 'error', detail: 'The server did not answer. Nothing was read.', forKey: key };
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, p);
  return p;
}

// A LATE ANSWER NEVER REPLACES A NEWER ONE (fixed 2026-09-25, from review)
// Before, an answer for address A that arrived after the page had moved to B,
// and after B's own answer, replaced B's state; the page then showed "loading"
// for B with nothing left in flight to end it. Now each load records the
// address and a sequence number, and its answer is written only if both are
// still the latest. An answer for a stale address is still kept in the session
// cache for that address, so going back to it costs nothing.
export function useHabits(address) {
  const key = (address || '').toLowerCase();
  const [state, setState] = useState(() => {
    const hit = key && memo.get(key);
    return hit && Date.now() - hit.at < SESSION_TTL_MS
      ? { status: 'ok', data: hit.data, fetchedAt: hit.at, forKey: key }
      : { status: key ? 'loading' : 'idle', forKey: key };
  });
  const latest = useRef({ key, seq: 0 });

  const load = useCallback(async ({ force = false } = {}) => {
    const seq = latest.current.seq + 1;
    latest.current = { key, seq };
    const isLatest = () => latest.current.key === key && latest.current.seq === seq;
    if (!key) { setState({ status: 'idle', forKey: key }); return; }
    const hit = memo.get(key);
    if (!force && hit && Date.now() - hit.at < SESSION_TTL_MS) {
      setState({ status: 'ok', data: hit.data, fetchedAt: hit.at, forKey: key });
      return;
    }
    setState((s) => ({ status: 'loading', data: s.forKey === key ? s.data : undefined, forKey: key }));
    const next = await readHabits(key);
    if (isLatest()) setState(next);
  }, [key]);

  // Once per address. Not on a timer.
  useEffect(() => { load(); }, [load]);

  // An answer is only ever shown for the address it was read for. Between an
  // account switch and the new read starting, the previous answer is hidden.
  const current = state.forKey === key ? state : { status: key ? 'loading' : 'idle', forKey: key };
  return { ...current, refresh: () => load({ force: true }) };
}
