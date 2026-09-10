// budgetAmounts.js
//
// One formatter for every amount of money in the budget flow, and one place
// the token symbol comes from.
//
// Both existed twice before, once in BudgetSpendView and once in
// MyBudgetsList, and both copies were wrong in the same two ways.
//
// SCIENTIFIC NOTATION. The old formatter did:
//
//     n < 0.0001 ? n.toExponential(2) : ...
//
// so a real budget rendered as "7.00e-6 BNB". Money must never be shown that
// way. Nobody reading a balance should have to move a decimal point in their
// head to find out whether they are looking at seven millionths or seven
// million, and the two are one character apart on screen.
//
// It also went through Number(formatUnits(...)) first, which is what produced
// the exponent in the first place: JavaScript switches to exponential form
// below 1e-6 on its own. This keeps the exact decimal string viem returns and
// never converts it to a float, so the displayed digits are the real ones.
//
// THE SYMBOL. The old default was `symbol = 'BNB'`, so any caller that forgot
// to pass one silently claimed the amount was in BNB. On BNB Chain that is
// invisible; on Robinhood Chain it labelled ETH as BNB. A default is exactly
// the wrong shape for this: there is no sensible fallback token, so a missing
// chain must produce no symbol rather than a plausible wrong one.

import { formatUnits, parseUnits } from 'viem';
// Explicit .js so this module can be imported by the self-check script under
// plain node, which does not do extensionless resolution. Vite accepts it too.
import { nativeSymbol } from './chainContracts.js';

/** The smallest amount shown as digits. Below this the value is real but
 *  would render as a row of zeros, so it is shown as a bound instead. */
const MIN_SHOWN = '0.00000001';
const MAX_DECIMALS = 8;

/**
 * An amount for display, plus its exact value for a tooltip.
 *
 * Returns { text, full }. `text` is what to render, `full` is every digit,
 * for a title attribute, so trimming never hides money.
 */
export function formatAmount(value, decimals = 18) {
  if (value == null) return { text: 'n/a', full: 'n/a' };

  let exact;
  try {
    exact = formatUnits(value, decimals);
  } catch {
    return { text: 'n/a', full: 'n/a' };
  }

  const negative = exact.startsWith('-');
  const unsigned = negative ? exact.slice(1) : exact;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const grouped = BigInt(intPart).toLocaleString();

  const frac = fracPart.replace(/0+$/, '');
  if (!frac) {
    const text = `${negative ? '-' : ''}${grouped}`;
    return { text, full: exact };
  }

  // Keep enough decimals to reach the first significant digit and a little
  // past it, so a small amount stays legible instead of collapsing to zero.
  const firstSignificant = frac.search(/[1-9]/);
  const keep = Math.min(MAX_DECIMALS, Math.max(6, firstSignificant + 2));
  const shown = frac.slice(0, keep).replace(/0+$/, '');

  if (!shown && intPart === '0') {
    // Real, but smaller than we are willing to print in full. Say that
    // rather than rendering 0.00000000, which reads as nothing at all.
    return { text: `< ${MIN_SHOWN}`, full: exact };
  }

  const text = `${negative ? '-' : ''}${grouped}${shown ? `.${shown}` : ''}`;
  return { text, full: exact };
}

/**
 * The token symbol for an amount in a budget.
 *
 * `chainId` is required. There is deliberately no default: a budget's token
 * is a fact about the chain it was opened on, and guessing it is how ETH came
 * to be labelled BNB.
 */
export function budgetTokenSymbol(tokenAddress, chainId, nativeSentinel) {
  // Fails loudly rather than returning something renderable. Every earlier
  // version of this had a quiet answer for a missing chain -- first 'BNB',
  // then ''. Both let a caller that forgot the chain keep working, which is
  // how the wrong symbol reached three separate surfaces one at a time.
  // A missing chain is a bug in the caller, and it should stop there.
  if (!chainId || Number.isNaN(Number(chainId))) {
    throw new Error(
      'budgetTokenSymbol needs a chainId. A budget is denominated in the gas '
      + 'token of the chain it was opened on, so there is no default and no '
      + 'fallback: guessing here is what labelled ETH as BNB.',
    );
  }
  const isNative = (tokenAddress || '').toLowerCase() === (nativeSentinel || '').toLowerCase();
  return isNative ? nativeSymbol(chainId) : 'tokens';
}

/**
 * A decimal string typed into a form, rendered the same way as an on-chain
 * amount. Exists so a form value and a contract value can never be formatted
 * by two different rules: the funded notification interpolated its raw input
 * string while every other amount went through formatAmount, which is how one
 * notification read 0.000007 and its sibling read 7.00e-6.
 */
export function formatDecimalString(input, decimals = 18) {
  if (input == null || input === '') return { text: 'n/a', full: 'n/a' };
  try {
    return formatAmount(parseUnits(String(input), decimals), decimals);
  } catch {
    return { text: String(input), full: String(input) };
  }
}

/** Amount and symbol together, with the exact value for a tooltip. */
export function formatBudgetAmount(value, { chainId, token, nativeSentinel, decimals = 18 } = {}) {
  const { text, full } = formatAmount(value, decimals);
  const symbol = budgetTokenSymbol(token, chainId, nativeSentinel);
  return {
    text: symbol ? `${text} ${symbol}` : text,
    full: symbol ? `${full} ${symbol}` : full,
  };
}
