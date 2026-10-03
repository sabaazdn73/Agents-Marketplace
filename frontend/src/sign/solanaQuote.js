// sign/solanaQuote.js
//
// Every check a Jupiter quote passes before a transaction is even built for
// it, in one pure function, the Solana counterpart of trade/quoteCheck.js.
// In order, the first failure refuses the quote:
//   1. the answer matches the request: the two mints, the exact amount in,
//      exact-in mode, the slippage asked for, no platform fee, and a route
//      that starts at the input mint and ends at the output mint;
//   2. our reference price and limit exist, are not dated in the future and
//      are under 30 minutes old (sign/orderMath.js referenceProblem);
//   3. the minimum passes (sign/orderMath.js orderCheck, the same function
//      the EVM page uses): not below the estimate by more than the order's
//      slippage plus 0.1%; not more than the order's limit under what is
//      given up, valued at our measured price; not over 5% above it.
//
// One difference from the EVM page, said where it shows: LI.FI's quote
// carries its own dollar price for the token, so the EVM page values the
// minimum at two prices (ours and LI.FI's). Jupiter's quote carries none, so
// the second price here is the quote's own estimate (outAmount): it adds the
// slippage test at that price, not an independent opinion. The one
// independent price is Tnega's measured one.
//
// Plain module: no React, no @solana/web3.js.

import { orderCheck, referenceProblem } from './orderMath.js';

const pct = (x, d = 2) => `${(x * 100).toFixed(d)}%`;
const usd = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null);

/** A raw integer string as a number of whole units. For comparing and
 *  showing; the exact amounts stay as BigInt/strings wherever they are signed. */
export function unitsOf(raw, decimals) {
  if (!/^\d+$/.test(String(raw ?? '')) || !Number.isInteger(decimals)) return null;
  const s = String(raw).padStart(decimals + 1, '0');
  const i = s.slice(0, s.length - decimals);
  const f = s.slice(s.length - decimals);
  return Number(f ? `${i}.${f}` : i);
}

/** The exact amount as text, trailing zeros trimmed, thousands separated. */
export function rawText(raw, decimals) {
  if (!/^\d+$/.test(String(raw ?? '')) || !Number.isInteger(decimals)) return null;
  const s = String(raw).padStart(decimals + 1, '0');
  const i = BigInt(s.slice(0, s.length - decimals)).toLocaleString('en-US');
  const f = s.slice(s.length - decimals).replace(/0+$/, '');
  return f ? `${i}.${f}` : i;
}

const posInt = (x) => /^[1-9]\d*$/.test(String(x ?? ''));

/** What differs between Jupiter's answer and the request: [] when nothing. */
export function quoteMismatchJup(quote, req) {
  const bad = [];
  if (!quote || typeof quote !== 'object') return ['no quote'];
  if (quote.inputMint !== req.inputMint) bad.push('the token paid');
  if (quote.outputMint !== req.outputMint) bad.push('the token received');
  if (String(quote.inAmount) !== String(req.amount)) bad.push('the amount in');
  if (quote.swapMode !== 'ExactIn') bad.push('the swap mode');
  if (Number(quote.slippageBps) !== Number(req.slippageBps)) bad.push('the slippage');
  const fee = quote.platformFee;
  if (fee && (Number(fee.feeBps) > 0 || (fee.amount != null && String(fee.amount) !== '0'))) bad.push('a platform fee');
  if (!posInt(quote.outAmount) || !posInt(quote.otherAmountThreshold)) bad.push('the amounts out');
  else if (BigInt(quote.otherAmountThreshold) > BigInt(quote.outAmount)) bad.push('the minimum above the estimate');
  const plan = Array.isArray(quote.routePlan) ? quote.routePlan : [];
  if (!plan.length) bad.push('the route');
  else {
    const swaps = plan.map((s) => s?.swapInfo || {});
    if (!swaps.some((s) => s.inputMint === req.inputMint) || !swaps.some((s) => s.outputMint === req.outputMint)) bad.push('the route’s ends');
  }
  return bad;
}

/** { ok: true, facts, check } or { ok: false, why, facts?, check? }.
 *    quote          Jupiter's answer, as it came
 *    req            the request it answers (sign/jupiter.js quoteRequest)
 *    side           'buy' | 'sell'
 *    amount         what is given up: dollars on a buy, tokens on a sale
 *    slippage       the fraction asked for
 *    vc             { limit, price, measuredAt, basis, limitBasis } or { reason }
 *    symbol         the stock token's symbol, for the words
 *    tokenDecimals  the stock token's decimals, read on chain
 *    payDecimals    USDC's decimals (6)
 *    now            the time to judge the reference's age by */
export function checkJupiterQuote({ quote, req, side, amount, slippage, vc, symbol, tokenDecimals, payDecimals = 6, now = Date.now(), noun = 'order' }) {
  const outDecimals = side === 'buy' ? tokenDecimals : payDecimals;
  const facts = quote && typeof quote === 'object' ? {
    out: unitsOf(quote.outAmount, outDecimals),
    outMin: unitsOf(quote.otherAmountThreshold, outDecimals),
    outRaw: String(quote.outAmount ?? ''),
    outMinRaw: String(quote.otherAmountThreshold ?? ''),
    outDecimals,
    outSymbol: side === 'buy' ? symbol : 'USDC',
    routes: [...new Set((Array.isArray(quote.routePlan) ? quote.routePlan : []).map((s) => s?.swapInfo?.label).filter(Boolean))],
    steps: Array.isArray(quote.routePlan) ? quote.routePlan.length : 0,
    priceImpactPct: quote.priceImpactPct != null && Number.isFinite(Number(quote.priceImpactPct)) ? Number(quote.priceImpactPct) : null,
  } : null;
  const refuse = (why, extra = {}) => ({ ok: false, facts, why, ...extra });

  const mismatch = quoteMismatchJup(quote, req);
  if (mismatch.length) return refuse(`Jupiter's answer does not match the ${noun} (${mismatch.join(', ')}), so it is not used.`);

  const refProblem = referenceProblem({ vc, symbol, noun, now, venue: 'Jupiter' });
  if (refProblem) return refuse(refProblem);

  const { out, outMin } = facts;
  // Jupiter carries no dollar price of its own: its second price is the
  // quote's own estimate. Buy: dollars paid over tokens estimated. Sell:
  // dollars estimated over tokens sold.
  const lpPrice = side === 'buy' ? (out > 0 ? amount / out : null) : (amount > 0 ? out / amount : null);
  const lp = lpPrice > 0 ? { price: lpPrice, source: 'Jupiter’s own estimate for this quote' } : null;
  const check = orderCheck({ side, out, outMin, amount, slippage, vc, lp });
  if (!check.ok) {
    const lines = [];
    if (check.why.includes('figures')) lines.push('Jupiter’s answer has no usable amount out.');
    if (check.why.includes('min')) lines.push(`Jupiter's route guarantees at least ${rawText(quote.otherAmountThreshold, outDecimals)} ${facts.outSymbol}, ${pct(1 - check.minRatio)} below its estimate of ${rawText(quote.outAmount, outDecimals)}: more than the ${noun}'s ${pct(slippage)} slippage plus 0.10%.`);
    if (check.why.includes('loss')) lines.push(`Valued at our measured price, the minimum is worth ${usd(check.value.valueOut)} for ${usd(check.value.valueIn)}: ${pct(check.value.loss)} less, over this ${noun}'s ${pct(check.value.limit)} limit.`);
    if (check.why.includes('lossLifi')) lines.push(`Valued at ${check.lifi.source}, the minimum is worth ${usd(check.lifi.valueOut)} for ${usd(check.lifi.valueIn)}: ${pct(check.lifi.loss)} less, over this ${noun}'s ${pct(check.value.limit)} limit.`);
    if (check.why.includes('gain')) lines.push('Valued at our measured price, the minimum is worth more than 5% above what is given up. That points to a wrong token, decimals or price.');
    return refuse(`Refused. ${lines.join(' ')}`, { check });
  }
  return { ok: true, facts, check, lp };
}
