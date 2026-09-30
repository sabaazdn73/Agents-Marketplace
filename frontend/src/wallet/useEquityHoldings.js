// useEquityHoldings.js
//
// POST /api/wallet/holdings for the connected address: the listed tokenized
// stocks and ETFs it holds on Ethereum, Base, Arbitrum, BNB Chain, Robinhood
// Chain and HyperEVM, read on chain by our server (backend/core/te/
// holdings.py, the reader behind the MCP tool tnega_wallet_holdings, shaped by
// core/te/wallet_view.py). The response shape is in te/api.js.
//
// THE ADDRESS GOES IN THE BODY, NEVER THE URL, as for /api/wallet/habits: a
// URL lands in access logs. See docs/data-handling.md and the privacy page.
//
// The server reads a limited number of new wallets a minute across everyone
// and answers 429 with Retry-After when it cannot. This hook asks once per
// address, again only when the visitor presses "Read again", and on a 429
// shows the route's sentence and the wait without retrying by itself. An
// answer is kept for the session for 60 seconds, the server's own cache time.

import { useCallback, useEffect, useRef, useState } from 'react';
import { HEADERS_TIMEOUT_KEY } from '../apiRetry';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const SESSION_TTL_MS = 60 * 1000;
// An uncached read takes about 3 s and stops at the server's 10.5 s deadline;
// the transport's 8 s default for the first byte would cut it short.
const HEADERS_MS = 15000;
const memo = new Map(); // lowercased address -> { at, data }
const pending = new Map(); // lowercased address -> the one request in flight for it

function readHoldings(key) {
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/wallet/holdings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: key }),
        credentials: 'omit',
        cache: 'no-store',
        [HEADERS_TIMEOUT_KEY]: HEADERS_MS,
      });
      let body = null;
      try { body = await r.json(); } catch { body = null; }
      if (r.status === 429) {
        const header = Number(r.headers.get('Retry-After'));
        const seconds = Number.isFinite(header) && header > 0 ? header
          : (Number(body?.retry_after_seconds) || 60);
        return {
          status: 'busy',
          detail: body?.detail || 'The server is reading other wallets.',
          retryAt: Date.now() + seconds * 1000,
          forKey: key,
        };
      }
      if (!r.ok || !body) {
        return {
          status: 'error',
          detail: (body && typeof body.detail === 'string' && body.detail) || `The server answered ${r.status}.`,
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

// The same guard as useHabits.js: an answer is written only while its address
// and load are still the latest, so a late answer for a previous wallet never
// shows under the current one.
export function useEquityHoldings(address) {
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
    setState({ status: 'loading', forKey: key });
    const next = await readHoldings(key);
    if (isLatest()) setState(next);
  }, [key]);

  useEffect(() => { load(); }, [load]);

  const current = state.forKey === key ? state : { status: key ? 'loading' : 'idle', forKey: key };
  return { ...current, refresh: () => load({ force: true }) };
}
