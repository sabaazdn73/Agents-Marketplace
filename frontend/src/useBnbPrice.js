// useBnbPrice.js
//
// BNB/USD for the dollar value shown beside a BNB balance, from
// /api/market/bnb-price. Since 2026-09-25 the backend reads it on BNB Chain
// itself: the 30-minute time-weighted average of the PancakeSwap v3 WBNB/USDT
// pool, labelled "USD via USDT (BSC-USD)", with the block it was read at and
// the window (backend/core/bnb_usd.py). It used to come from CoinGecko's free
// API, whose terms do not cover this site; that source and its credit are
// gone.
//
// useBnbQuote() keeps the whole answer (label, block, window, pool), so the
// page can say what the figure is beside it. It is null while loading and when
// the backend withholds a price; nothing is ever substituted.
//
// ONLY A LABELLED ANSWER IS SHOWN AS DOLLARS
// A backend deployed before the on-chain price answers {"usd": N} with no
// label, and that N is CoinGecko's number. labelledBnbUsd() returns the price
// only when the answer carries its label, so a page shows a dollar value only
// beside the sentence that says what it is; otherwise it shows the BNB
// quantity alone.
import { useEffect, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// REFRESHING, AND NEVER LOOPING (fixed 2026-09-25, from review)
// The first version fetched once per page session and never cleared its
// pending promise, so one withheld answer hid the dollar value for the whole
// session, and a good price was kept for as long as the tab stayed open.
// Now:
//   - a good price is refreshed every REFRESH_MS (the backend's own cache
//     time), and only while the page is visible;
//   - a withheld answer or a network failure is retried once, after
//     WITHHELD_RETRY_MS, and after that falls back to the REFRESH_MS cadence;
//   - one timer and one request at a time, whatever the number of components
//     using the price, so nothing can spin;
//   - a hidden tab fetches nothing; coming back to it refreshes a stale price.
// A withheld answer never replaces the last good price: that price stays on
// screen, labelled with the block it was read at, which says how old it is.
const REFRESH_MS = 60 * 1000;
const WITHHELD_RETRY_MS = 15 * 1000;

let _cached = null;      // the last good quote
let _fetchedAt = 0;      // when it arrived
let _inflight = null;    // the one request in flight, if any
let _timer = null;       // the one scheduled fetch, if any
let _retriedWithheld = false;
let _visibilityHooked = false;
const _listeners = new Set();

function isHidden() {
  return typeof document !== 'undefined' && document.hidden;
}

function schedule(ms) {
  clearTimeout(_timer);
  _timer = null;
  if (!_listeners.size) return;
  _timer = setTimeout(() => {
    _timer = null;
    if (_listeners.size && !isHidden()) fetchQuote();
    // Hidden: do nothing now; the visibility handler picks it up on return.
  }, ms);
}

function onWithheld() {
  if (!_retriedWithheld) {
    _retriedWithheld = true;
    schedule(WITHHELD_RETRY_MS);
  } else {
    schedule(REFRESH_MS);
  }
}

function fetchQuote() {
  if (_inflight) return _inflight;
  _inflight = fetch(`${API_BASE_URL}/api/market/bnb-price`)
    .then((r) => r.json())
    .then((d) => {
      if (d && typeof d.usd === 'number') {
        _cached = d;
        _fetchedAt = Date.now();
        _retriedWithheld = false;
        _listeners.forEach((f) => f(d));
        schedule(REFRESH_MS);
      } else {
        onWithheld();
      }
    })
    .catch(() => onWithheld())
    .finally(() => { _inflight = null; });
  return _inflight;
}

function hookVisibility() {
  if (_visibilityHooked || typeof document === 'undefined') return;
  _visibilityHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (!isHidden() && _listeners.size && Date.now() - _fetchedAt >= REFRESH_MS) fetchQuote();
  });
}

export function useBnbQuote() {
  const [quote, setQuote] = useState(_cached);
  useEffect(() => {
    hookVisibility();
    _listeners.add(setQuote);
    if (_cached) setQuote(_cached);
    if (!_cached || Date.now() - _fetchedAt >= REFRESH_MS) fetchQuote();
    else if (!_timer && !_inflight) schedule(REFRESH_MS - (Date.now() - _fetchedAt));
    return () => {
      _listeners.delete(setQuote);
      if (!_listeners.size) { clearTimeout(_timer); _timer = null; }
    };
  }, []);
  return quote;
}

/** The BNB/USD price, only when the answer says it is the on-chain average
 *  (carries a label). Null otherwise, and the page shows BNB alone. */
export function labelledBnbUsd(q) {
  return q && q.label && typeof q.usd === 'number' ? q.usd : null;
}

/** The line that says what the dollar figure is: "Priced with the on-chain
 *  BNB/USD average (PancakeSwap v3, 30 minutes, block 123,961,543), USD via
 *  USDT (BSC-USD)". Null when the answer carries no label (an older
 *  deployment that returns the number alone), and then no dollar value is
 *  shown either (labelledBnbUsd). */
export function bnbQuoteSource(q) {
  if (labelledBnbUsd(q) == null) return null;
  const parts = [
    q.source?.venue || null,
    q.window_seconds ? `${Math.round(q.window_seconds / 60)} minutes` : null,
    q.block?.number != null ? `block ${Number(q.block.number).toLocaleString()}` : null,
  ].filter(Boolean);
  return `Priced with the on-chain BNB/USD average${parts.length ? ` (${parts.join(', ')})` : ''}, ${q.label}`;
}

/** Formats a BNB amount with its live USD equivalent, e.g.
 * "1.23 BNB (≈ $854.36)". Falls back to plain BNB (no parenthetical) when
 * the price isn't available yet, never a fabricated/stale-looking
 * number. */
export function formatBnbWithUsd(bnbAmount, usdPrice) {
  const bnbText = `${bnbAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} BNB`;
  if (usdPrice == null) return bnbText;
  const usdValue = bnbAmount * usdPrice;
  return `${bnbText} (≈ $${usdValue.toLocaleString(undefined, { maximumFractionDigits: usdValue >= 100 ? 0 : 2 })})`;
}
