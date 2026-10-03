// sign/orderMath.js
//
// The arithmetic and rules that both families of signing order share, the
// EVM one (LI.FI, sign/order.js) and the Solana one (Jupiter,
// sign/solanaQuote.js). Plain module, no React, no imports from the site's
// build, so node can load it for the headless checks
// (scripts/solana_selfcheck.mjs). Moved here from sign/order.js,
// trade/quoteCheck.js unchanged; those files re-export them, so every
// existing import keeps working and the EVM path behaves exactly as before.

import { clockText } from '../trade/format.js';

/** "10.50" and "10.5" are one amount; "010" is "10". */
export function decimalKey(x) {
  const m = /^0*(\d*?)(?:\.(\d*?)0*)?$/.exec(String(x ?? '').trim());
  if (!m) return null;
  const int = m[1] || '0';
  return m[2] ? `${int}.${m[2]}` : int;
}

/** A reference older than this is not used to check a quote. */
export const REFERENCE_MAX_AGE_MS = 30 * 60e3;
/** A reference dated further ahead than this (clock skew allowed) is not
 *  used either. */
export const REFERENCE_MAX_AHEAD_MS = 5 * 60e3;
export const REFERENCE_MAX_GAP = 0.05;

/** The owner's rule (2026-09-29): min(5%, max(2%, 3 x our measured cost
 *  without gas at the size nearest the order)), as a fraction. */
export function limitFor(costExGasBps) {
  return Math.min(0.05, Math.max(0.02, (3 * costExGasBps) / 10000));
}

/** Why our reference cannot be used to check a quote, in words, or null.
 *  `venue` names who quoted ("LI.FI" for the EVM pages, "Jupiter" for the
 *  Solana one). */
export function referenceProblem({ vc, symbol, noun = 'order', now = Date.now(), before = false, venue = 'LI.FI' }) {
  // `before`: asked before any quote, so the words say none was asked for.
  const tail = before ? `so no quote is asked for from ${venue}` : `so ${venue}'s quote is not checked against it and is not offered for signing`;
  if (!vc || vc.reason) {
    return before
      ? `There is no measured price to check a quote against: ${vc?.reason || 'none was read'}. No quote is asked for from ${venue}.`
      : `${venue}'s quote could not be checked against our own measured price: ${vc?.reason || `none was sent with the ${noun}`}. It is not offered for signing.`;
  }
  if (vc.measuredAt != null && vc.measuredAt - now > REFERENCE_MAX_AHEAD_MS) {
    return `Our measured price for ${symbol} is dated ${clockText(vc.measuredAt)}, in the future, ${tail}.`;
  }
  if (vc.measuredAt == null || now - vc.measuredAt > REFERENCE_MAX_AGE_MS) {
    return `Our measured price for ${symbol} ${vc.measuredAt == null ? 'carries no time' : `was measured at ${clockText(vc.measuredAt)}, over 30 minutes ago`}, ${tail}. Try again once our measurement is refreshed.`;
  }
  return null;
}

/** The quote against the order, valued twice, before anything is offered
 *  for signing. Refused when:
 *    the minimum sits below the estimate by more than the order's slippage
 *    plus 0.1% for rounding;
 *    the loss exceeds the order's limit valued at EITHER price:
 *      our reference (the server's value check), or
 *      the venue's own price for the stock token (lp), so a
 *      reference nudged within the 5% agreement band cannot make a worse
 *      route pass;
 *      buy   1 - (minimum tokens x price) / dollars paid
 *      sell  1 - minimum dollars / (tokens sold x price);
 *    the value is more than 5% ABOVE what is given up at either price: that
 *    points to a wrong token, decimals or price, not a bargain. */
export function orderCheck({ side, out, outMin, amount, slippage, vc, lp }) {
  if (!(out > 0) || !(outMin > 0) || !(amount > 0) || !vc || !(vc.limit > 0) || !(vc.price > 0) || !lp || !(lp.price > 0)) return { ok: false, why: ['figures'] };
  const minRatio = outMin / out;
  const why = [];
  if (minRatio < 1 - (slippage + 0.001)) why.push('min');
  const at = (price) => {
    const valueIn = side === 'buy' ? amount : amount * price;
    const valueOut = side === 'buy' ? outMin * price : outMin;
    return { valueIn, valueOut, loss: 1 - valueOut / valueIn };
  };
  const ours = at(vc.price);
  const theirs = at(lp.price);
  if (ours.loss > vc.limit) why.push('loss');
  if (theirs.loss > vc.limit) why.push('lossLifi');
  if (-ours.loss > 0.05 || -theirs.loss > 0.05) why.push('gain');
  return {
    ok: why.length === 0, why, minRatio,
    value: { ...ours, limit: vc.limit, price: vc.price, basis: vc.basis, limitBasis: vc.limitBasis },
    lifi: { ...theirs, price: lp.price, source: lp.source },
  };
}
