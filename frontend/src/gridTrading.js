// gridTrading.js
//
// Builds a grid of limit orders on BSC as PancakeSwap V3 range orders, so
// every level of the grid goes on chain in one batched transaction.
//
// WHY RANGE ORDERS AND NOT A LIMIT ORDER PROTOCOL
// PancakeSwap's Orbs-based limit orders are deprecated in their own docs,
// and the replacement is described without naming a contract. A V3 range
// order needs no protocol beyond the pool itself: a concentrated liquidity
// position minted entirely on one side of the current price is a resting
// order. It fills as price crosses the band, and it earns the pool's fee
// while it waits.
//
// The property that matters here is that minting is a transaction, not a
// signed off-chain order. N transactions batch into one wallet_sendCalls
// through the EIP-5792 path this app already uses for hiring, so a grid of
// N levels costs one signature rather than N.
//
// THE TICK DIRECTION IS INVERTED ON THIS PAIR, AND IT IS NOT INTUITIVE
// Verified against the live pool rather than assumed. In the WBNB/USDT
// 0.05% pool, token0 is USDT and token1 is WBNB, so the pool's own price is
// token1/token0, which is WBNB per USDT. That is the reciprocal of the BNB
// price a person thinks in.
//
//   a HIGHER tick means more WBNB per USDT, which means BNB is CHEAPER
//
// So the two sides land where naive reading would put them backwards:
//
//   BUY BNB below spot  -> ticks ABOVE the current tick -> single-sided USDT
//   SELL BNB above spot -> ticks BELOW the current tick -> single-sided WBNB
//
// Live confirmation, 2026-09-08: current tick -66227, sqrtPriceX96 implying
// 0.0013302791 WBNB per USDT, so BNB at 751.72 USDT. 1.0001^tick reproduced
// that to within 0.0002%.
//
// WHAT THIS DOES NOT DO
// A range order fills gradually as price crosses its band, not all at once
// at a single price, and it is one directional: a filled sell does not turn
// itself back into a buy. Both are properties of the instrument. The card
// states them rather than hiding them, because a grid that silently does
// not refill would otherwise look broken.

export const BSC_CHAIN_ID = 56;

// PancakeSwap V3, all confirmed live on BSC mainnet before this was written.
export const POSITION_MANAGER = '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364';
export const V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
export const WBNB_USDT_POOL = '0x36696169C63e42cd08ce11f5deeBbCeBae652050';

// token0 and token1 are fixed by the pool, and their order is what makes the
// tick direction above what it is. Read from the pool, not assumed.
export const TOKEN0 = { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18 };
export const TOKEN1 = { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', decimals: 18 };

export const POOL_FEE = 500;        // 0.05%
export const TICK_SPACING = 10;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

// A level closer to spot than this many spacings would need both tokens,
// which is no longer a resting order. Those levels are reported as skipped
// with the reason rather than quietly moved.
export const MIN_SPACINGS_FROM_SPOT = 1;

export const MAX_LEVELS = 20;
export const MIN_LEVELS = 2;

export class GridError extends Error {}

export const POOL_ABI = [
  { type: 'function', name: 'slot0', stateMutability: 'view', inputs: [], outputs: [
    { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
    { name: 'observationIndex', type: 'uint16' }, { name: 'observationCardinality', type: 'uint16' },
    { name: 'observationCardinalityNext', type: 'uint16' }, { name: 'feeProtocol', type: 'uint32' },
    { name: 'unlocked', type: 'bool' }] },
  { type: 'function', name: 'tickSpacing', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }] },
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
];

export const POSITION_MANAGER_ABI = [{
  type: 'function', name: 'mint', stateMutability: 'payable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'token0', type: 'address' }, { name: 'token1', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'tickLower', type: 'int24' },
    { name: 'tickUpper', type: 'int24' }, { name: 'amount0Desired', type: 'uint256' },
    { name: 'amount1Desired', type: 'uint256' }, { name: 'amount0Min', type: 'uint256' },
    { name: 'amount1Min', type: 'uint256' }, { name: 'recipient', type: 'address' },
    { name: 'deadline', type: 'uint256' }] }],
  outputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'liquidity', type: 'uint128' },
            { name: 'amount0', type: 'uint256' }, { name: 'amount1', type: 'uint256' }],
}];

export const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
];

// ---------------------------------------------------------------- tick maths

/** Pool price (token1 per token0) at a tick. Display only, never a value path. */
export function tickToPoolPrice(tick) {
  return Math.pow(1.0001, tick);
}

/** The BNB price in USDT a person reads, which is the reciprocal of the
 *  pool's own price because token0 is the stablecoin. */
export function tickToBnbPrice(tick) {
  return 1 / tickToPoolPrice(tick);
}

/** The tick for a BNB price in USDT. Inverse of the above, so it inherits
 *  the same inversion: a higher BNB price is a lower tick. */
export function bnbPriceToTick(bnbPrice) {
  if (!(bnbPrice > 0)) throw new GridError('Price must be above zero.');
  return Math.log(1 / bnbPrice) / Math.log(1.0001);
}

/** Snap to the pool's tick spacing. Ticks off the spacing are rejected by
 *  the pool, so this is not cosmetic. */
export function alignTick(tick, spacing = TICK_SPACING, mode = 'nearest') {
  const s = spacing;
  const q = tick / s;
  const n = mode === 'down' ? Math.floor(q) : mode === 'up' ? Math.ceil(q) : Math.round(q);
  const aligned = n * s;
  return Math.max(MIN_TICK + (MIN_TICK % s ? s + (MIN_TICK % s) : 0), Math.min(MAX_TICK - (MAX_TICK % s), aligned));
}

// ------------------------------------------------------- single-sided amounts

const Q96 = 2n ** 96n;

/** sqrt(1.0001^tick) * 2^96, as a bigint, via the float form then scaled.
 *  Precision here only decides the displayed estimate and the min-amount
 *  floor, never the tokens moved: the pool computes the true amounts from
 *  the ticks themselves. */
export function sqrtRatioAtTick(tick) {
  const ratio = Math.pow(1.0001, tick / 2);
  return BigInt(Math.floor(ratio * Number(Q96)));
}

/** Liquidity obtainable from an amount of token0 across a band that sits
 *  entirely above the current tick. */
export function liquidityForAmount0(sqrtA, sqrtB, amount0) {
  const [lo, hi] = sqrtA < sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA];
  if (hi === lo) return 0n;
  return (amount0 * lo * hi) / (Q96 * (hi - lo));
}

/** Liquidity obtainable from an amount of token1 across a band that sits
 *  entirely below the current tick. */
export function liquidityForAmount1(sqrtA, sqrtB, amount1) {
  const [lo, hi] = sqrtA < sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA];
  if (hi === lo) return 0n;
  return (amount1 * Q96) / (hi - lo);
}

// ---------------------------------------------------------------- the grid

/**
 * Work out every order in the grid.
 *
 * @param lowPrice     lowest BNB price in the range, in USDT
 * @param highPrice    highest BNB price in the range, in USDT
 * @param levels       how many orders to place
 * @param currentTick  the pool's live tick, from slot0
 * @param usdtPerBuy   USDT committed to each buy level, base units
 * @param wbnbPerSell  WBNB committed to each sell level, base units
 *
 * Returns { orders, skipped, totals }. Nothing here signs or sends.
 */
export function buildGrid({ lowPrice, highPrice, levels, currentTick, usdtPerBuy, wbnbPerSell }) {
  if (!Number.isInteger(levels) || levels < MIN_LEVELS || levels > MAX_LEVELS) {
    throw new GridError(`Levels must be a whole number between ${MIN_LEVELS} and ${MAX_LEVELS}.`);
  }
  if (!(lowPrice > 0) || !(highPrice > 0)) throw new GridError('Both prices must be above zero.');
  if (highPrice <= lowPrice) throw new GridError('The high price has to be above the low price.');

  const spot = tickToBnbPrice(currentTick);
  if (lowPrice >= spot && highPrice >= spot) {
    // Every level would be a sell. Allowed, but worth naming.
  }

  const orders = [];
  const skipped = [];
  const usedTicks = new Set();

  for (let i = 0; i < levels; i++) {
    // Even spacing in price, endpoints included.
    const price = lowPrice + ((highPrice - lowPrice) * i) / (levels - 1);
    const side = price < spot ? 'buy' : 'sell';

    // One tick-spacing band per level. The band is placed on the far side
    // of the level from spot, so the whole band stays single sided.
    const raw = bnbPriceToTick(price);
    let tickLower;
    let tickUpper;
    if (side === 'buy') {
      // Buys sit above the current tick.
      tickLower = alignTick(raw, TICK_SPACING, 'up');
      tickUpper = tickLower + TICK_SPACING;
    } else {
      // Sells sit below the current tick.
      tickUpper = alignTick(raw, TICK_SPACING, 'down');
      tickLower = tickUpper - TICK_SPACING;
    }

    const gap = MIN_SPACINGS_FROM_SPOT * TICK_SPACING;
    const straddles = side === 'buy'
      ? tickLower <= currentTick + gap
      : tickUpper >= currentTick - gap;
    if (straddles) {
      skipped.push({
        price, side,
        reason: 'too close to the current price to rest on one side, so it would be a swap rather than an order',
      });
      continue;
    }

    const key = `${tickLower}:${tickUpper}`;
    if (usedTicks.has(key)) {
      skipped.push({ price, side, reason: 'another level already occupies this tick band' });
      continue;
    }
    usedTicks.add(key);

    const sqrtA = sqrtRatioAtTick(tickLower);
    const sqrtB = sqrtRatioAtTick(tickUpper);
    const amount0 = side === 'buy' ? BigInt(usdtPerBuy) : 0n;
    const amount1 = side === 'sell' ? BigInt(wbnbPerSell) : 0n;
    const liquidity = side === 'buy'
      ? liquidityForAmount0(sqrtA, sqrtB, amount0)
      : liquidityForAmount1(sqrtA, sqrtB, amount1);

    orders.push({
      index: orders.length,
      side,
      price,
      priceLow: tickToBnbPrice(tickUpper),   // higher tick is the lower BNB price
      priceHigh: tickToBnbPrice(tickLower),
      tickLower,
      tickUpper,
      amount0,
      amount1,
      liquidity,
    });
  }

  // Sells first, then buys, each ordered outward from spot. That is the
  // order a person reads a grid in.
  orders.sort((a, b) => (a.side === b.side ? b.price - a.price : a.side === 'sell' ? -1 : 1));
  orders.forEach((o, i) => { o.index = i; });

  const totals = {
    usdt: orders.reduce((s, o) => s + o.amount0, 0n),
    wbnb: orders.reduce((s, o) => s + o.amount1, 0n),
    buys: orders.filter((o) => o.side === 'buy').length,
    sells: orders.filter((o) => o.side === 'sell').length,
  };

  if (!orders.length) {
    throw new GridError(
      'Every level fell too close to the current price to rest as an order. Widen the range.',
    );
  }

  return { orders, skipped, totals, spot };
}

// ---------------------------------------------------------------- the calls

/**
 * The call list for the grid, approvals first, then one mint per order.
 *
 * Shaped for wagmi's sendCalls, and equally usable one at a time by a wallet
 * with no EIP-5792 support. The order is what makes both paths safe: an
 * approval always precedes the mints that spend against it.
 *
 * `slippageBps` only sets the amountMin floors. A single-sided mint should
 * consume its whole input, but the pool decides the exact split, and a floor
 * of zero would let a mis-specified band silently take almost nothing.
 */
export function buildGridCalls({ orders, totals, recipient, deadlineSeconds, allowances, slippageBps = 100 }) {
  if (!recipient) throw new GridError('A recipient address is required.');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + (deadlineSeconds || 1800));
  const calls = [];

  const needUsdt = totals.usdt > 0n && BigInt(allowances?.usdt ?? 0n) < totals.usdt;
  const needWbnb = totals.wbnb > 0n && BigInt(allowances?.wbnb ?? 0n) < totals.wbnb;

  if (needUsdt) {
    calls.push({
      to: TOKEN0.address, abi: ERC20_ABI, functionName: 'approve',
      args: [POSITION_MANAGER, totals.usdt],
      _label: `Approve ${TOKEN0.symbol} for the position manager`,
    });
  }
  if (needWbnb) {
    calls.push({
      to: TOKEN1.address, abi: ERC20_ABI, functionName: 'approve',
      args: [POSITION_MANAGER, totals.wbnb],
      _label: `Approve ${TOKEN1.symbol} for the position manager`,
    });
  }

  const floor = (v) => (v === 0n ? 0n : (v * BigInt(10000 - slippageBps)) / 10000n);

  for (const o of orders) {
    calls.push({
      to: POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'mint',
      args: [{
        token0: TOKEN0.address,
        token1: TOKEN1.address,
        fee: POOL_FEE,
        tickLower: o.tickLower,
        tickUpper: o.tickUpper,
        amount0Desired: o.amount0,
        amount1Desired: o.amount1,
        amount0Min: floor(o.amount0),
        amount1Min: floor(o.amount1),
        recipient,
        deadline,
      }],
      _label: o.side === 'buy'
        ? `Buy BNB near ${o.priceLow.toFixed(2)} USDT`
        : `Sell BNB near ${o.priceHigh.toFixed(2)} USDT`,
    });
  }

  return calls;
}

/** Display only. Base units to a decimal string, no floats in the maths. */
export function formatUnits(value, decimals = 18, places = 4) {
  const v = BigInt(value ?? 0n);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = ((v % base) * 10n ** BigInt(places)) / base;
  return `${whole}.${String(frac).padStart(places, '0')}`;
}

/** Decimal string to base units, integer only. */
export function parseUnits(text, decimals = 18) {
  const s = String(text ?? '').trim();
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') throw new GridError('Enter a number.');
  const [w, f = ''] = s.split('.');
  if (f.length > decimals) throw new GridError(`At most ${decimals} decimal places.`);
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}
