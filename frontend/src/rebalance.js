// rebalance.js
//
// Works out the swaps that bring a wallet's token weights back to a target
// split. Calculation only: it decides nothing about execution and signs
// nothing. The card hands the resulting swaps to the wallet, and the person
// signs them.
//
// INTEGER THROUGHOUT
// Every amount is a bigint of the token's own base units. Weights are basis
// points, so 60% is 6000 and the set must total 10000 exactly. Nothing here
// converts to a float, because a rebalance is a set of real swaps and a
// rounding drift becomes a dust position that costs gas to clear.
//
// Values are compared in a common quote unit, which is USDT at 18 decimals
// on BSC. That is the unit the portfolio read already returns and the unit
// every swap here routes through.
//
// WHY IT ROUTES THROUGH THE QUOTE TOKEN
// A direct A to B swap is one hop and cheaper, but it needs a pool for
// every pair a target could name. Selling into USDT and buying out of it
// uses pools that reliably exist, and it makes the plan readable: sell the
// overweight, buy the underweight, with one intermediate everyone can see.
// The cost is a second hop on any pair that had a direct pool.

export const QUOTE_DECIMALS = 18;
export const QUOTE_SYMBOL = 'USDT';
export const BPS = 10000n;

// Below this, a leg is not worth a swap. Gas and slippage would eat more
// than the drift it corrects, so the plan says it left it alone.
export const MIN_LEG_QUOTE_UNITS = 10n ** 18n; // 1 USDT

export class RebalanceError extends Error {}

/** Weights must total exactly 100%. Anything else is a plan that cannot be
 *  reached, and it is better to refuse than to normalise silently and
 *  rebalance to a split the person did not ask for. */
export function validateTargets(targets) {
  if (!Array.isArray(targets) || targets.length < 2) {
    throw new RebalanceError('A rebalance needs at least two assets.');
  }
  let total = 0n;
  for (const t of targets) {
    if (!t?.address || typeof t.bps !== 'number' || !Number.isInteger(t.bps) || t.bps < 0) {
      throw new RebalanceError(`Target for ${t?.symbol || 'an asset'} is not a whole basis point value.`);
    }
    total += BigInt(t.bps);
  }
  if (total !== BPS) {
    throw new RebalanceError(
      `Weights total ${Number(total) / 100}%, and they have to total exactly 100%.`,
    );
  }
  return true;
}

/**
 * The plan.
 *
 * @param holdings [{ address, symbol, decimals, balance (bigint),
 *                    quoteValue (bigint, in QUOTE base units) }]
 * @param targets  [{ address, symbol, bps }]
 * @returns { totalQuote, legs, skipped, reachable }
 *
 * A leg is one swap. Sells come before buys in the returned order, because
 * the buys are funded by the sells and a wallet without spare quote token
 * would otherwise fail on the first buy.
 */
export function planRebalance(holdings, targets) {
  validateTargets(targets);

  const byAddress = new Map(
    holdings.map((h) => [String(h.address).toLowerCase(), h]),
  );

  let totalQuote = 0n;
  for (const h of holdings) totalQuote += BigInt(h.quoteValue ?? 0n);

  if (totalQuote === 0n) {
    return { totalQuote: 0n, legs: [], skipped: [], reachable: false,
             reason: 'This wallet holds none of the assets in the target split, so there is nothing to rebalance.' };
  }

  const legs = [];
  const skipped = [];

  for (const t of targets) {
    const key = String(t.address).toLowerCase();
    const held = byAddress.get(key);
    const current = BigInt(held?.quoteValue ?? 0n);
    // Integer division. The remainder is left where it is rather than
    // spread around, which keeps every leg exact.
    const wanted = (totalQuote * BigInt(t.bps)) / BPS;
    const delta = wanted - current;
    const size = delta < 0n ? -delta : delta;

    if (size < MIN_LEG_QUOTE_UNITS) {
      if (size > 0n) {
        skipped.push({
          symbol: t.symbol,
          driftQuote: size,
          reason: 'below the minimum worth swapping',
        });
      }
      continue;
    }

    legs.push({
      symbol: t.symbol,
      address: t.address,
      decimals: held?.decimals ?? 18,
      side: delta < 0n ? 'sell' : 'buy',
      quoteAmount: size,
      currentQuote: current,
      targetQuote: wanted,
      // The token amount is only known for a sell, where the wallet holds
      // the asset. A buy's token amount comes from the quote at execution
      // time, and guessing it here would put a number on screen that the
      // swap then contradicts.
      tokenAmount: delta < 0n && held?.balance != null && current > 0n
        ? (BigInt(held.balance) * size) / current
        : null,
    });
  }

  legs.sort((a, b) => (a.side === b.side ? 0 : a.side === 'sell' ? -1 : 1));

  const sellTotal = legs.filter((l) => l.side === 'sell')
    .reduce((s, l) => s + l.quoteAmount, 0n);
  const buyTotal = legs.filter((l) => l.side === 'buy')
    .reduce((s, l) => s + l.quoteAmount, 0n);

  return {
    totalQuote,
    legs,
    skipped,
    reachable: legs.length > 0,
    sellTotal,
    buyTotal,
    // Sells and buys are equal by construction, since both come from the
    // same total. A gap means a target was dropped for being under the
    // minimum, which is worth showing rather than hiding.
    unallocated: sellTotal > buyTotal ? sellTotal - buyTotal : 0n,
  };
}

/** Display only. Decimal string, never used for arithmetic. */
export function formatUnits(value, decimals, places = 2) {
  const v = BigInt(value ?? 0n);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = ((v % base) * (10n ** BigInt(places))) / base;
  return `${whole}.${String(frac).padStart(places, '0')}`;
}

/** Current weights, in basis points, for showing drift against target. */
export function currentWeights(holdings, totalQuote) {
  if (!totalQuote || totalQuote === 0n) return new Map();
  const out = new Map();
  for (const h of holdings) {
    out.set(
      String(h.address).toLowerCase(),
      Number((BigInt(h.quoteValue ?? 0n) * BPS) / totalQuote),
    );
  }
  return out;
}
