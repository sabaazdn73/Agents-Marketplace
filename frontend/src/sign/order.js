// sign/order.js
//
// One signing link's order: read from our API, checked, and put in the
// shape the page draws. Plain module, no React.
//
//   GET  /api/sign/<id>        200 the order | 404 invalid | 410 expired |
//                              409 already used
//   POST /api/sign/<id>/done   {"tx": "0x..."} once the swap is sent: the
//                              server marks the link used (204)
//
// The server has already checked the link's signature and expiry. The page
// cannot check the signature (the key is the server's), but the order is in
// the id itself, so it reads it there and refuses an answer from the server
// that says anything else (idPayload, payloadMismatch). It also checks what
// it acts on: the chain is one it can switch to, the
// token paid or received is one of that chain's stablecoins in
// trade/chains.js, the wallet is an address and the amount is a positive
// decimal. An order that fails any of these is shown as invalid, and nothing
// is quoted or signed for it.

import { parseUnits } from 'viem';
import { BUY_CHAINS } from '../trade/chains';
import { units as lifiUnits } from '../trade/lifi';
import { teRead } from '../te/api';
import { isSolanaData, normaliseSolanaOrder, payloadMismatchSolana } from './solanaOrder.js';
import { decimalKey, limitFor, orderCheck, REFERENCE_MAX_AGE_MS, REFERENCE_MAX_AHEAD_MS, REFERENCE_MAX_GAP } from './orderMath.js';

// Shared with the Solana order (sign/solanaQuote.js); kept exported from here
// so every existing import of them keeps working.
export { decimalKey, limitFor, orderCheck, REFERENCE_MAX_AGE_MS, REFERENCE_MAX_AHEAD_MS, REFERENCE_MAX_GAP };

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const lc = (a) => String(a || '').toLowerCase();
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ''));
const isDecimal = (s) => /^\d+(\.\d+)?$/.test(String(s || ''));
const first = (...xs) => xs.find((x) => x !== undefined && x !== null && x !== '');
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

/** A link lasts 600 s from when it is prepared (backend sign_link.py). */
export const MAX_LINK_SECONDS = 600;
/** How far behind the signed expiry this browser's clock may run. */
export const CLOCK_SKEW_MS = 60e3;

/** GET the order. Resolves to { order } or { state, reason } with state one
 *  of 'invalid', 'expired', 'used', 'error'. */
export async function readOrder(id) {
  if (!/^[A-Za-z0-9_-]{16,1024}$/.test(id || '')) return { state: 'invalid', reason: 'The link is not in the form Tnega writes.' };
  const payload = idPayload(id);
  if (!payload) return { state: 'invalid', reason: 'The link does not carry an order Tnega can read.' };
  // The order's measured cost without gas, in whole bps, signed into the
  // link (key "b"): the only source of the price check's limit.
  if (!Number.isInteger(payload.b) || payload.b < 0) return { state: 'invalid', reason: 'The link does not carry the measured cost its price check is based on.' };
  const r = await teRead(`/api/sign/${id}`);
  if (r.data) {
    // A Solana order is read and checked by sign/solanaOrder.js; the rest of
    // this function (the link's cost, the countdown, the value check) is the
    // same for both families.
    const solana = isSolanaData(r.data);
    const n = solana ? normaliseSolanaOrder(r.data) : normaliseOrder(r.data);
    if (n.expired) return { state: 'expired' };
    if (n.error) return { state: 'invalid', reason: n.error };
    const diff = solana ? payloadMismatchSolana(payload, n.order) : payloadMismatch(payload, n.order);
    if (diff.length) return { state: 'invalid', reason: `The server's answer does not match the order in the link (${diff.join(', ')}), so nothing is offered for signing.` };
    const raw = r.data?.order || r.data;
    // The countdown. seconds_left comes unsigned, so it may only shorten the
    // link, never lengthen it: the deadline is capped at the signed expiry
    // (e) plus 60 s for a browser clock that runs behind, and no link lasts
    // over 600 s. An answer claiming more than 600 s left is not valid.
    const signedEnd = Number(payload.e) * 1000;
    if (!Number.isFinite(signedEnd)) return { state: 'invalid', reason: 'The link carries no expiry.' };
    const slRaw = raw?.seconds_left;
    const sl = slRaw == null ? null : Number(slRaw);
    if (sl != null && (!Number.isFinite(sl) || sl > MAX_LINK_SECONDS)) return { state: 'invalid', reason: `The server's answer gives this link ${slRaw} seconds left; a link lasts at most ${MAX_LINK_SECONDS} s.` };
    const deadline = sl == null
      ? Math.min(signedEnd, Date.now() + MAX_LINK_SECONDS * 1000)
      : Math.min(Date.now() + Math.max(0, sl) * 1000, signedEnd + CLOCK_SKEW_MS);
    // The expiry shown is the one signed into the link, to the second, so it
    // reads the same as the server's expires_at.
    return { order: { ...n.order, deadline, signedExpiry: signedEnd, valueCheck: readValueCheck(raw, n.order.side, payload.b) } };
  }
  if (r.status === 404) return { state: 'invalid', reason: r.body?.detail || null };
  if (r.status === 410) return { state: 'expired' };
  if (r.status === 409) return { state: 'used' };
  return { state: 'error', reason: r.error || 'The order could not be read.' };
}

/** The order the id carries: base64url of the payload's JSON followed by a
 *  12-byte signature, which is dropped here. null if it cannot be read. */
export function idPayload(id) {
  try {
    const b64 = id.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (id.length % 4)) % 4);
    const bin = atob(b64);
    if (bin.length <= 12) return null;
    const bytes = Uint8Array.from(bin.slice(0, -12), (ch) => ch.charCodeAt(0));
    const p = JSON.parse(new TextDecoder().decode(bytes));
    return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
  } catch { return null; }
}

/** Where the server's order differs from the one in the id: [] when none. */
export function payloadMismatch(p, order) {
  const bad = [];
  const side = p.s === 'b' ? 'buy' : p.s === 's' ? 'sell' : null;
  if (side !== order.side) bad.push('buy or sell');
  if (Number(p.c) !== order.chainId) bad.push('the chain');
  if (lc(p.t) !== lc(order.token.address)) bad.push('the token');
  if (lc(p.p) !== lc(order.pay.address)) bad.push('the stablecoin');
  if (decimalKey(p.a) == null || decimalKey(p.a) !== decimalKey(order.amount)) bad.push('the amount');
  if (lc(p.w) !== lc(order.wallet)) bad.push('the wallet');
  if (Number(p.m) !== order.slippageBps) bad.push('the slippage');
  if (Number.isFinite(Number(p.e)) && Math.round(order.expiresAt / 1000) !== Number(p.e)) bad.push('the expiry');
  return bad;
}

/** Report the swap's hash, so the page does not offer the link again.
 *  Best effort: whatever this answers, it says nothing about the
 *  transaction itself, which the page follows through LI.FI's status. */
export async function markDone(id, tx) {
  try {
    const r = await fetch(`${API_BASE_URL}/api/sign/${id}/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx }),
    });
    if (r.ok) return { ok: true };
    // 410: the link expired before the hash was reported; nothing recorded.
    return r.status === 410 ? { expired: true, error: 'HTTP 410' } : { error: `HTTP ${r.status}` };
  } catch (e) {
    return { error: e?.message || 'network error' };
  }
}

/** The server's answer, in the page's shape, or { error }. Accepts the
 *  enriched fields by name and falls back to the link's own short keys
 *  (s, c, t, p, a, w, e, m). */
export function normaliseOrder(data) {
  const o = obj(data?.order || data);
  const tokenObj = obj(o.token);
  const payObj = obj(first(o.pay, o.pay_token, o.receive));
  const sideRaw = lc(first(o.side, o.s));
  const side = sideRaw === 's' || sideRaw === 'sell' ? 'sell' : sideRaw === 'b' || sideRaw === 'buy' ? 'buy' : null;
  const chainId = Number(first(o.chain_id, o.chainId, obj(o.chain).id, o.c));
  const tokenAddr = first(tokenObj.address, o.token_address, typeof o.token === 'string' ? o.token : null, o.t);
  const payAddr = first(payObj.address, o.pay_address, typeof o.pay === 'string' ? o.pay : null, o.p);
  // {"usd": "10"} on a buy, {"tokens": "0.5"} on a sell; a bare string in
  // the link's own short form.
  const amountObj = obj(o.amount);
  const amount = String(first(amountObj.usd, amountObj.tokens, typeof o.amount === 'string' || typeof o.amount === 'number' ? o.amount : null, o.a, '') ?? '');
  const serverRaw = first(o.from_amount_raw) ?? null;
  const wallet = first(o.wallet, o.w);
  const expiresRaw = first(o.expires_at, o.e);
  const expiresAt = typeof expiresRaw === 'number' ? expiresRaw * (expiresRaw < 1e12 ? 1000 : 1) : Date.parse(expiresRaw);
  const secondsLeft = Number(o.seconds_left);
  const slippageBps = Number(first(o.max_slippage_bps, o.slippage_bps, o.m, 50));

  if (!side) return { error: 'The order does not say whether it buys or sells.' };
  const chain = BUY_CHAINS[chainId];
  if (!chain) return { error: `The order names chain ${Number.isFinite(chainId) ? chainId : '(none)'}, which is not one this page can sign on.` };
  if (!isAddr(tokenAddr)) return { error: 'The order has no token address.' };
  const pay = chain.pay.find((x) => lc(x.address) === lc(payAddr));
  if (!pay) return { error: `The order pays with a token that is not one of ${chain.name}'s stablecoins on this site.` };
  if (lc(tokenAddr) === lc(pay.address)) return { error: 'The order names the same token on both sides.' };
  if (!isAddr(wallet)) return { error: 'The order has no wallet address.' };
  if (!isDecimal(amount) || !(Number(amount) > 0)) return { error: 'The order has no amount.' };
  if (!Number.isFinite(slippageBps) || slippageBps <= 0 || slippageBps > 300) return { error: 'The order names a slippage this page does not accept (above 3%, the most Tnega prepares).' };
  if (!Number.isFinite(expiresAt)) return { error: 'The order has no expiry.' };

  if (serverRaw != null && !/^\d+$/.test(String(serverRaw))) return { error: 'The order\u2019s exact amount is not a whole number of units.' };
  const tokenDecimals = Number(first(tokenObj.decimals, o.token_decimals));
  const payDecimalsServer = Number(payObj.decimals);
  const order = {
    side,
    chainId,
    chainName: first(o.chain_name, typeof o.chain === 'string' ? o.chain : null, obj(o.chain).name, chain.name),
    key: `${chainId}/${lc(tokenAddr)}`,
    token: {
      address: tokenAddr,
      symbol: first(tokenObj.symbol, o.symbol, o.token_symbol) || null,
      name: first(tokenObj.name, o.name, o.token_name) || null,
      ticker: first(tokenObj.ticker, o.ticker, o.underlying) || null,
      issuer: first(tokenObj.issuer_name, tokenObj.issuer, o.issuer_name, o.issuer) || null,
      decimals: Number.isInteger(tokenDecimals) && tokenDecimals >= 0 && tokenDecimals <= 36 ? tokenDecimals : null,
    },
    // The stablecoin's symbol and decimals are trade/chains.js's, read on
    // its chain, not the server's.
    pay: { ...pay, chainId, chainName: chain.name },
    // What the server says the stablecoin's decimals are; the page reads
    // them on chain and refuses the order if the two differ.
    payDecimalsServer: Number.isInteger(payDecimalsServer) ? payDecimalsServer : null,
    amount,
    // The server's exact amount in the smallest unit. The page works out its
    // own (rawAmount) and refuses the order if the two differ.
    serverRaw: serverRaw != null ? String(serverRaw) : null,
    wallet,
    slippageBps,
    slippage: slippageBps / 10000,
    expiresAt,
    signedExpiry: expiresAt,
    // The server's count, when it sends one, is used against this browser's
    // clock: the two clocks need not agree.
    // Replaced by readOrder with a deadline capped at the signed expiry.
    deadline: Number.isFinite(secondsLeft) ? Math.min(Date.now() + secondsLeft * 1000, expiresAt) : expiresAt,
    controls: data?.controls && typeof data.controls === 'object' ? data.controls : (o.controls && typeof o.controls === 'object' ? o.controls : null),
    eligibility: first(o.eligibility, data?.eligibility) || null,
    // Filled in by readOrder with the cost signed into the link; without
    // it there is no check, so nothing can be signed.
    valueCheck: readValueCheck(o, side, undefined),
  };
  return { order };
}

/** The exact amount the wallet parts with, in the token's smallest unit.
 *  A buy pays `amount` dollars in the stablecoin, taken at $1; a sell parts
 *  with `amount` tokens. null while the token's decimals are unknown. */
export function rawAmount(order, tokenDecimals, payDecimals = order.pay.decimals) {
  try {
    const d = order.side === 'buy' ? payDecimals : tokenDecimals;
    if (!Number.isInteger(d)) return null;
    return parseUnits(order.amount, d);
  } catch { return null; }
}

/** Decimals read on chain against what the order says. [] when they agree;
 *  otherwise the tokens that disagree, in words. Nothing is quoted until
 *  both are read (chain.token / chain.pay not null). */
export function decimalsMismatch(order, chain) {
  const bad = [];
  if (order.token.decimals != null && chain.token !== order.token.decimals) bad.push(`${order.token.symbol || 'the stock token'} has ${chain.token} decimals on chain, the order says ${order.token.decimals}`);
  if (order.token.decimals == null) bad.push('the order does not state the stock token\'s decimals');
  if (chain.pay !== order.pay.decimals) bad.push(`${order.pay.symbol} has ${chain.pay} decimals on chain, this site's list says ${order.pay.decimals}`);
  if (order.payDecimalsServer != null && chain.pay !== order.payDecimalsServer) bad.push(`${order.pay.symbol} has ${chain.pay} decimals on chain, the order says ${order.payDecimalsServer}`);
  return bad;
}

/** Does the server's exact amount, when it sends one, equal the page's? */
export function rawAgrees(order, raw) {
  return order.serverRaw == null || raw == null || String(raw) === order.serverRaw;
}

/** LI.FI's /quote parameters for the order. The quote is asked for the
 *  order's wallet, so it can be read before any wallet is connected. */
export function quoteParams(order, raw) {
  if (raw == null) return null;
  const buy = order.side === 'buy';
  return {
    fromChain: order.chainId,
    toChain: order.chainId,
    fromToken: buy ? order.pay.address : order.token.address,
    toToken: buy ? order.token.address : order.pay.address,
    fromAmount: raw.toString(),
    fromAddress: order.wallet,
    slippage: order.slippage,
  };
}

/** The server's value check for the order (GET /api/sign value_check),
 *  with the time its reference was measured:
 *    limit       a fraction: min(5%, max(2%, 3 x our cost without gas at the
 *                size nearest the order)), the owner's rule, the same on both
 *                sides, worked out by the server;
 *    price       the reference price per token: a buy's is our measured
 *                price without gas; a sale's is the pool's measured mid (or
 *                another version's, per share);
 *    measuredAt  when that reference was measured (the buy's cost cell, the
 *                sale's sell_reference).
 *  { reason } when the server gives no limit or no reference: then nothing
 *  is offered for signing. */
export function readValueCheck(o, side, signedCostBps) {
  const vc = obj(o.value_check);
  const limit = Number(vc.limit);
  const price = Number(vc.reference_price_usd);
  if (vc.limit == null || vc.reference_price_usd == null) return { reason: vc.reason || o.reference_reason || obj(o.sell_reference).reason || 'the server sent no measured price and limit to check a quote against' };
  if (!(price > 0) || !Number.isFinite(price)) return { reason: 'the server sent a reference price that is not a positive number' };
  // The limit is worked out here, by the owner's rule, from the cost SIGNED
  // into the link (b), never from the answer. The answer's cost must be that
  // same number (a number, not text) and its limit the one the rule gives:
  // nothing in the unsigned answer can widen the check.
  if (!Number.isInteger(signedCostBps) || signedCostBps < 0) return { reason: 'the link carries no signed measured cost to work the limit out from' };
  const cost = signedCostBps;
  if (typeof vc.cost_ex_gas_bps !== 'number' || vc.cost_ex_gas_bps !== cost) return { reason: `the server's measured cost (${JSON.stringify(vc.cost_ex_gas_bps ?? null)} bps) is not the ${cost} bps signed into the link` };
  const ours = limitFor(cost);
  if (!Number.isFinite(limit) || Math.abs(limit - ours) > 1e-9) return { reason: `the server's limit (${Number.isFinite(limit) ? `${(limit * 100).toFixed(2)}%` : 'not a number'}) is not the one the rule gives for a measured cost of ${cost} bps (${(ours * 100).toFixed(2)}%)` };
  // A Solana order's reference (sign/solanaOrder.js) names its time measured_at.
  const at = side === 'sell' ? first(obj(o.sell_reference).measured_at, obj(o.reference).computed_at, obj(o.reference).measured_at) : first(obj(o.reference).computed_at, obj(o.sell_reference).measured_at, obj(o.reference).measured_at);
  const measuredAt = Date.parse(at);
  return {
    limit, price,
    basis: vc.reference_basis || null,
    limitBasis: vc.basis || null,
    rule: vc.rule || null,
    measuredAt: Number.isFinite(measuredAt) ? measuredAt : null,
  };
}

/** LI.FI's own dollar price per stock token, from the quote: the token's
 *  priceUSD, else the quote's dollar value over its token amount. With the
 *  source named, for the page to say which one disagreed. null if neither. */
export function quotePrice(quote, side, facts) {
  const a = quote?.action || {};
  const e = quote?.estimate || {};
  const tokenSide = side === 'buy' ? a.toToken : a.fromToken;
  const p = Number(tokenSide?.priceUSD);
  if (p > 0 && Number.isFinite(p)) return { price: p, source: `LI.FI's price for ${tokenSide.symbol || 'the token'} (priceUSD)` };
  const usd = Number(side === 'buy' ? e.toAmountUSD : e.fromAmountUSD);
  const units = side === 'buy' ? facts?.toAmount : lifiUnits(a.fromAmount, Number(a.fromToken?.decimals));
  if (usd > 0 && units > 0) return { price: usd / units, source: `LI.FI's dollar value of the quote (${side === 'buy' ? 'toAmountUSD' : 'fromAmountUSD'}) over its token amount` };
  return null;
}
