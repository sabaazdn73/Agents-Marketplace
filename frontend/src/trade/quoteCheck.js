// trade/quoteCheck.js
//
// Every check a LI.FI quote passes before anything is offered for signing,
// in one place, for the signing page (sign/SignOrderPage.jsx) and the stock
// page's Buy and Sell tabs (trade/StockTrade.jsx). In order, the first
// failure refuses the quote:
//   1. the answer matches the request (trade/lifi.js quoteMismatch): chains,
//      tokens, amount, wallet, the recipient of the route and of every step
//      at any depth, the transaction's value, and LI.FI's contract pinned
//      per chain (LIFI_DIAMONDS) as both the contract called and the
//      approval's spender;
//   2. no step names Jupiter (jupiterIn);
//   3. our reference price and limit exist, are not dated in the future, and
//      are under 30 minutes old;
//   4. LI.FI's own dollar price for the stock token exists and is within 5%
//      of ours (sign/order.js quotePrice, REFERENCE_MAX_GAP);
//   5. the minimum passes at BOTH prices (sign/order.js orderCheck).
// Plain function, no React; the words are the page's.

import { fmtUsd } from '../ui/primitives';
import { jupiterIn, quoteMismatch, quoteFacts, ROUTE_UNSUPPORTED } from './lifi';
import { orderCheck, quotePrice, REFERENCE_MAX_AGE_MS, REFERENCE_MAX_AHEAD_MS, REFERENCE_MAX_GAP } from '../sign/order';
import { rawText, clockText } from './format';

const pct = (x, d = 2) => `${(x * 100).toFixed(d)}%`;
const tok = (v, d = 4) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : null);

/** Why our reference cannot be used to check a quote, in words, or null.
 *  The stock page's tabs ask this BEFORE any request to LI.FI, so a quote
 *  that could not pass is never asked for and no address is sent. */
export function referenceProblem({ vc, symbol, noun = 'order', now = Date.now(), before = false }) {
  // `before`: asked before any quote, so the words say none was asked for.
  const tail = before ? 'so no quote is asked for from LI.FI' : "so LI.FI's quote is not checked against it and is not offered for signing";
  if (!vc || vc.reason) {
    return before
      ? `There is no measured price to check a quote against: ${vc?.reason || 'none was read'}. No quote is asked for from LI.FI.`
      : `LI.FI's quote could not be checked against our own measured price: ${vc?.reason || `none was sent with the ${noun}`}. It is not offered for signing.`;
  }
  if (vc.measuredAt != null && vc.measuredAt - now > REFERENCE_MAX_AHEAD_MS) {
    return `Our measured price for ${symbol} is dated ${clockText(vc.measuredAt)}, in the future, ${tail}.`;
  }
  if (vc.measuredAt == null || now - vc.measuredAt > REFERENCE_MAX_AGE_MS) {
    return `Our measured price for ${symbol} ${vc.measuredAt == null ? 'carries no time' : `was measured at ${clockText(vc.measuredAt)}, over 30 minutes ago`}, ${tail}. Try again once our measurement is refreshed.`;
  }
  return null;
}

/** { ok: true, facts, check, lp, gap } or { ok: false, facts, why, check? }.
 *    quote     LI.FI's answer, as it came
 *    params    the request it answers (trade/lifi.js quoteUrl's fields)
 *    side      'buy' | 'sell'
 *    amount    what is given up: dollars on a buy, tokens on a sale
 *    slippage  the fraction asked for
 *    vc        { limit, price, measuredAt, basis, limitBasis } or { reason }
 *    symbol    the stock token's symbol, for the words
 *    noun      'order' on the signing page, 'trade' on the stock page
 *    now       the time to judge the reference's age by */
export function checkQuote({ quote, params, side, amount, slippage, vc, symbol, noun = 'order', now = Date.now() }) {
  const facts = quoteFacts(quote);
  const refuse = (why, extra = {}) => ({ ok: false, facts, why, ...extra });
  const mismatch = quoteMismatch(quote, params, { side });
  if (mismatch.includes(ROUTE_UNSUPPORTED)) {
    const rest = mismatch.filter((m) => m !== ROUTE_UNSUPPORTED);
    return refuse(`This kind of LI.FI route is not supported here yet: the transaction is not one of LI.FI's swap calls this page can read, so it is not used.${rest.length ? ` It also does not match the ${noun} (${rest.join(', ')}).` : ''}`);
  }
  if (mismatch.length) return refuse(`LI.FI's answer does not match the ${noun} (${mismatch.join(', ')}), so it is not used.`);
  const jup = jupiterIn(quote);
  if (jup.length) return refuse(`This route goes through Jupiter (${jup.join(', ')}). Tnega does not use Jupiter, so the route is refused.`);

  // Our reference price and limit. Without them, or with a reference over
  // 30 minutes old, nothing is signed.
  const refProblem = referenceProblem({ vc, symbol, noun, now });
  if (refProblem) return refuse(refProblem);
  // Our reference against LI.FI's own dollar price for the token: more than
  // 5% apart means one of the two is wrong, so neither is trusted.
  const lp = quotePrice(quote, side, facts);
  if (!lp) return refuse(`LI.FI's quote carries no dollar price for ${symbol} to hold our measured price against, so it is not offered for signing.`);
  const gap = vc.price / lp.price - 1;
  if (Math.abs(gap) > REFERENCE_MAX_GAP) {
    return refuse(`Our measured price, ${fmtUsd(vc.price)} per ${symbol}, is ${pct(Math.abs(gap))} ${gap > 0 ? 'above' : 'below'} ${lp.source}, ${fmtUsd(lp.price)}. More than 5% apart, one of the two is wrong, so the quote is not offered for signing.`);
  }
  const out = facts.toAmount;
  const outMin = facts.toAmountMin;
  const check = orderCheck({ side, out, outMin, amount, slippage, vc, lp });
  if (!check.ok) {
    const lines = [];
    if (check.why.includes('figures')) lines.push('LI.FI’s answer has no amount out.');
    const outMinText = rawText(quote?.estimate?.toAmountMin, facts.toDecimals) || tok(outMin);
    const outText = rawText(quote?.estimate?.toAmount, facts.toDecimals) || tok(out);
    if (check.why.includes('min')) lines.push(`LI.FI's route guarantees at least ${outMinText} ${facts.toSymbol}, ${pct(1 - check.minRatio)} below its estimate of ${outText}: more than the ${noun}'s ${pct(slippage)} slippage plus 0.10%.`);
    if (check.why.includes('loss')) lines.push(`Valued at our measured price, the minimum is worth ${fmtUsd(check.value.valueOut)} for ${fmtUsd(check.value.valueIn)}: ${pct(check.value.loss)} less, over this ${noun}'s ${pct(check.value.limit)} limit.`);
    if (check.why.includes('lossLifi')) lines.push(`Valued at ${check.lifi.source}, ${fmtUsd(check.lifi.price)} per token, the minimum is worth ${fmtUsd(check.lifi.valueOut)} for ${fmtUsd(check.lifi.valueIn)}: ${pct(check.lifi.loss)} less, over this ${noun}'s ${pct(check.value.limit)} limit.`);
    if (check.why.includes('gain')) lines.push(`Valued at our measured price or at LI.FI's, the minimum is worth more than 5% above what is given up. That points to a wrong token, decimals or price.`);
    return refuse(`Refused. ${lines.join(' ')}`, { check });
  }
  return { ok: true, facts, check, lp, gap };
}
