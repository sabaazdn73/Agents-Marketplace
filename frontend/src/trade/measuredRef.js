// trade/measuredRef.js
//
// The reference price and the limit a quote on the stock page's Buy and Sell
// tabs is checked against, worked out in the browser from our own stored
// measurements (GET /api/te/underlying/<T>?size=<s>), by the same rules the
// server applies to an order prepared through the MCP server
// (backend/core/te/prepare.py tolerance(), _buy_reference, _sell_reference):
//
//   size   the measured size nearest the trade's dollar value among the sizes
//          this version FILLED with both a cost and a pool mid (ties go to
//          the smaller size, as nearest_size does);
//   bps    max(0, (cost_usd - gas_usd - l1_fee_usd) / size x 10,000), the
//          measured cost without gas or the L1 fee, rounded half up to a
//          whole number (sign_link.round_bps);
//   limit  min(5%, max(2%, 3 x bps / 10,000)) (sign/order.js limitFor);
//   buy    price per token = the measured paid_per_token at that size x
//          1.0025 (LI.FI's 0.25% fee), no gas: what the pool paid out;
//   sell   price per token = the pool's measured pre-trade mid at the size
//          nearest the sale's dollar value, found in two passes as the server
//          does (a first mid at the size nearest $1,000 gives the value);
//   time   the version's computed_at at that size: over 30 minutes old, or
//          more than 5 minutes ahead, and nothing is signed (quoteCheck.js).
//
// WHY IN THE BROWSER, NOT A NEW ENDPOINT: /api/te/underlying already serves
// every figure the rule needs (cost_usd, cost_parts.gas_usd,
// cost_parts.l1_fee_usd, paid_per_token, mid_usd, computed_at), per version
// and size, so the page reads the numbers the server's rule reads and applies
// the same arithmetic in the same order. A new endpoint would have to be
// deployed before the tabs could run against the live API.
//
// THE TABS' LIMIT IS CAPPED AT 2% (owner, 2026-09-30). The answer this is
// worked out from is not signed, so a changed answer could raise the rule's
// result to 5%. Until a signed reference exists, the tabs use the smaller of
// the rule's result and 2%, the rule's floor: TAB_LIMIT_CAP. The rule's own
// result is kept (ruleLimit) and shown beside it. The signing page is not
// capped: its limit is tied to the cost signed into the link.
//
// One difference, on the side of refusing: when a version has no measured
// pool mid of its own, the server may price a sale through another version
// of the same stock and the share ratios; the Sell tab does not, and offers
// no sale for that version.

import { teRead } from '../te/api';
import { limitFor } from '../sign/order';

export const SIZES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];
const LIFI_FEE_RATE = 0.0025;
export const TAB_LIMIT_CAP = 0.02;
// A read of one size is used again for a minute, not longer: the reference's
// own time is checked anyway.
const CACHE_MS = 60e3;
const cache = new Map();

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Sizes from nearest to farthest from `usd`; a tie goes to the smaller. */
export function sizesByDistance(usd) {
  return [...SIZES].sort((a, b) => (Math.abs(a - usd) - Math.abs(b - usd)) || (a - b));
}

/** Half up, as sign_link.round_bps (Decimal quantize ROUND_HALF_UP). */
export function roundBps(bps) {
  // Math.round is half up for a positive number, on the exact double.
  return Math.round(bps);
}

/** The version's cell at one size, or { error }. */
async function readCell(ticker, key, size) {
  const k = `${ticker}:${size}`;
  const hit = cache.get(k);
  let body = hit && Date.now() - hit.at < CACHE_MS ? hit.body : null;
  if (!body) {
    const r = await teRead(`/api/te/underlying/${encodeURIComponent(ticker)}?size=${size}`);
    if (!r.data) return { error: r.error || 'not read' };
    body = r.data;
    cache.set(k, { at: Date.now(), body });
  }
  const cell = (body.versions || []).find((v) => v.key === key);
  return cell ? { cell } : { error: 'this version is not in the answer' };
}

// A cell the rule may use: filled, with a cost and a pool mid.
const usable = (c) => c?.state === 'filled' && num(c.cost_usd) != null && !!num(c.mid_usd);
// States with no measurement at any size: stop looking.
const FINAL = (c) => c && !['filled', 'partial', 'failed'].includes(c.state);

/** The cell at the filled size nearest `usd`: { cell, size } or { reason }. */
async function nearestFilled(ticker, key, usd) {
  for (const size of sizesByDistance(usd)) {
    // Each size is one read; the nearest usually answers.
    const r = await readCell(ticker, key, size);
    if (r.error) return { reason: `our measurement could not be read (${r.error})` };
    if (usable(r.cell)) return { cell: r.cell, size };
    if (FINAL(r.cell)) return { reason: r.cell.reason || `no measured fill for this version (${r.cell.state})` };
  }
  return { reason: 'no measured size filled for this version' };
}

/** tolerance() for a cell at its size. */
export function toleranceOf(cell, size, symbol) {
  const cost = cell.cost_usd;
  const gas = num(cell.cost_parts?.gas_usd) || 0.0;
  const l1 = num(cell.cost_parts?.l1_fee_usd) || 0.0;
  const bps = Math.max(0.0, (cost - gas - l1) / size * 1e4);
  const b = roundBps(bps);
  const ruleLimit = limitFor(b);
  const limit = Math.min(ruleLimit, TAB_LIMIT_CAP);
  return {
    limit, ruleLimit, costExGasBps: b, size,
    basis: `${symbol}'s measured cost without gas or the L1 fee at $${size.toLocaleString('en-US')}: ${bps.toFixed(2)} bps, ${b} whole (block ${cell.block})`,
  };
}

const measured = (cell) => {
  const t = Date.parse(cell.computed_at);
  return Number.isFinite(t) ? t : null;
};

/** A buy of `usd` dollars of the version `key`: the value check's input in
 *  the shape sign/order.js orderCheck takes, or { reason }. */
export async function buyReference({ ticker, key, symbol, usd }) {
  if (!(usd > 0)) return { reason: 'no amount' };
  const n = await nearestFilled(ticker, key, usd);
  if (!n.cell) return { reason: n.reason };
  const tol = toleranceOf(n.cell, n.size, symbol);
  const ppt = num(n.cell.paid_per_token);
  if (!ppt) return { reason: 'no measured price per token' };
  const price = Math.round(ppt * (1 + LIFI_FEE_RATE) * 1e6) / 1e6;
  return {
    limit: tol.limit, ruleLimit: tol.ruleLimit, price, measuredAt: measured(n.cell), costExGasBps: tol.costExGasBps, size: n.size,
    basis: `our measured price per ${symbol} without gas at $${n.size.toLocaleString('en-US')} (the pool's price and fees, and LI.FI's fee), block ${n.cell.block}`,
    limitBasis: tol.basis,
  };
}

/** A sale of `tokens` of the version `key`, or { reason }. */
export async function sellReference({ ticker, key, symbol, tokens }) {
  if (!(tokens > 0)) return { reason: 'no amount' };
  const first = await nearestFilled(ticker, key, 1000);
  if (!first.cell) return { reason: `${symbol} has no measured pool price of its own (${first.reason})` };
  const value = tokens * first.cell.mid_usd;
  const n = await nearestFilled(ticker, key, value);
  if (!n.cell) return { reason: `${symbol} has no measured pool price near $${value.toFixed(2)} (${n.reason})` };
  const tol = toleranceOf(n.cell, n.size, symbol);
  return {
    limit: tol.limit, ruleLimit: tol.ruleLimit, price: n.cell.mid_usd, measuredAt: measured(n.cell), costExGasBps: tol.costExGasBps, size: n.size,
    basis: `the pool's measured pre-trade mid per ${symbol} at $${n.size.toLocaleString('en-US')}, block ${n.cell.block}`,
    limitBasis: tol.basis,
  };
}
