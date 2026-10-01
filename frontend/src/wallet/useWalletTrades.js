// useWalletTrades.js
//
// POST /api/wallet/trades for the connected address: its buys and sells of
// listed tokenized stocks and ETFs, read on chain by our server
// (backend/core/te/trades.py), and the P/L per position and for the
// portfolio by average cost (core/te/pnl.py). The response shape is in
// te/api.js.
//
// The address goes in the body, never the URL, as for /api/wallet/holdings.
//
// A first read of a wallet's history can take several steps: each request
// reads for at most about 14 s and answers what it has, with `continues`
// true while there is more. This hook asks again by itself while the answer
// says so and the read is moving (`progress` grows: ranges settled,
// receipts and block times read; a poll that only re-reads the head does not
// count), and shows each
// answer as it comes. It stops after STALL_ROUNDS answers in a row with no
// progress, or after MAX_READ_MS in all. On a 429 it shows the route's
// sentence and the wait, then asks again by itself once the Retry-After time
// has passed (the server limits how fast one wallet's read goes). A complete
// answer is kept for the session for two minutes, the server's own time
// before it reads new blocks.

import { useCallback, useEffect, useRef, useState } from 'react';
import { HEADERS_TIMEOUT_KEY } from '../apiRetry';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const SESSION_TTL_MS = 120 * 1000;
// The holdings read (up to about 10.5 s) and one trade step (about 14 s).
const HEADERS_MS = 32000;
const MAX_READ_MS = 15 * 60 * 1000;
const STALL_ROUNDS = 3;
const ROUND_PAUSE_MS = 1500;
const memo = new Map(); // lowercased address -> { at, data }

async function readTrades(key) {
  try {
    const r = await fetch(`${API_BASE_URL}/api/wallet/trades`, {
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
      const seconds = Number.isFinite(header) && header > 0 ? header : (Number(body?.retry_after_seconds) || 60);
      return { status: 'busy', detail: body?.detail || 'The server is reading other wallets.', retryAt: Date.now() + seconds * 1000 };
    }
    if (!r.ok || !body) {
      return { status: 'error', detail: (body && typeof body.detail === 'string' && body.detail) || `The server answered ${r.status}.` };
    }
    return { status: 'ok', data: body };
  } catch {
    return { status: 'error', detail: 'The server did not answer. Nothing was read.' };
  }
}

const sleep = (ms) => new Promise((res) => { setTimeout(res, ms); });

export function useWalletTrades(address) {
  const key = (address || '').toLowerCase();
  const [state, setState] = useState(() => {
    const hit = key && memo.get(key);
    return hit && Date.now() - hit.at < SESSION_TTL_MS
      ? { status: 'ok', data: hit.data, forKey: key, reading: false }
      : { status: key ? 'loading' : 'idle', forKey: key, reading: !!key };
  });
  const latest = useRef({ key, seq: 0 });

  const load = useCallback(async ({ force = false } = {}) => {
    const seq = latest.current.seq + 1;
    latest.current = { key, seq };
    const isLatest = () => latest.current.key === key && latest.current.seq === seq;
    if (!key) { setState({ status: 'idle', forKey: key, reading: false }); return; }
    const hit = memo.get(key);
    if (!force && hit && Date.now() - hit.at < SESSION_TTL_MS) {
      setState({ status: 'ok', data: hit.data, forKey: key, reading: false });
      return;
    }
    setState((s) => (s.forKey === key && s.data
      ? { ...s, reading: true }
      : { status: 'loading', forKey: key, reading: true }));
    const started = Date.now();
    let lastProgress = -1;
    let stalls = 0;
    while (Date.now() - started < MAX_READ_MS) {
      // eslint-disable-next-line no-await-in-loop
      const next = await readTrades(key);
      if (!isLatest()) return;
      if (next.status === 'busy') {
        const wait = Math.max(1000, next.retryAt - Date.now());
        if (Date.now() - started + wait > MAX_READ_MS) {
          setState((s) => (s.forKey === key && s.data ? { ...s, reading: false, stopped: next } : { ...next, forKey: key, reading: false }));
          return;
        }
        setState((s) => (s.forKey === key && s.data ? { ...s, reading: true, waiting: next } : { ...next, forKey: key, reading: true }));
        // eslint-disable-next-line no-await-in-loop
        await sleep(wait);
        if (!isLatest()) return;
        continue;
      }
      if (next.status !== 'ok') {
        setState((s) => (s.forKey === key && s.data
          ? { ...s, reading: false, stopped: next }
          : { ...next, forKey: key, reading: false }));
        return;
      }
      const more = !!next.data.continues;
      const progress = Number(next.data.progress) || 0;
      stalls = progress > lastProgress ? 0 : stalls + 1;
      lastProgress = Math.max(lastProgress, progress);
      const going = more && stalls < STALL_ROUNDS && Date.now() - started < MAX_READ_MS;
      if (!more) memo.set(key, { at: Date.now(), data: next.data });
      setState({ status: 'ok', data: next.data, forKey: key, reading: going });
      if (!going) return;
      // eslint-disable-next-line no-await-in-loop
      await sleep(ROUND_PAUSE_MS);
      if (!isLatest()) return;
    }
    setState((s) => (s.forKey === key ? { ...s, reading: false } : s));
  }, [key]);

  useEffect(() => { load(); }, [load]);

  const current = state.forKey === key ? state : { status: key ? 'loading' : 'idle', forKey: key, reading: !!key };
  return { ...current, refresh: () => load({ force: true }) };
}
