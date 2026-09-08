// healthFactor.js
//
// Reads a wallet's lending position health on BSC, from Venus and Aave.
// Read only. Nothing here signs, approves or spends.
//
// THE TWO PROTOCOLS DO NOT REPORT THE SAME THING
// Aave v3 exposes a health factor directly from getUserAccountData, scaled
// by 1e18, along with the liquidation threshold in basis points. Below 1.0
// a position can be liquidated.
//
// Venus has no health factor function. Its Comptroller exposes
// getAccountLiquidity, which returns an error code, a liquidity figure and
// a shortfall figure, both in 1e18 scaled USD. Liquidity is headroom before
// liquidation and shortfall is how far past it a position already is. One
// of the two is always zero.
//
// So this module reports what each protocol actually returns. Turning
// Venus's liquidity into a health-factor-looking number would mean
// inventing a denominator, and a fabricated ratio on a liquidation screen
// is the wrong place to be approximately right.
//
// NO DEBT IS NOT ZERO HEALTH
// Aave returns type(uint256).max for the health factor when a wallet has no
// borrowings. Rendering that as a number, or worse falling back to zero,
// would tell someone with no debt that they are about to be liquidated.
// It is reported as "no borrowings" instead.

export const BSC_CHAIN_ID = 56;

// Aave v3 Pool on BSC. Same address defiSkills.js already supplies to.
export const AAVE_POOL = '0x6807dc923806fE8Fd134338EABCA509979a7e0cB';
// Venus Unitroller, the proxy every Comptroller call goes through.
export const VENUS_COMPTROLLER = '0xfD36E2c2a6789Db23113685031d7F16329158384';

// Aave v3 prices its base currency in USD with 8 decimals.
export const AAVE_BASE_DECIMALS = 8;
// Health factor and Venus liquidity are both 1e18 scaled.
export const WAD = 10n ** 18n;
// type(uint256).max, what Aave returns when there is nothing borrowed.
export const UINT256_MAX = (2n ** 256n) - 1n;

export const AAVE_POOL_ABI = [{
  type: 'function', name: 'getUserAccountData', stateMutability: 'view',
  inputs: [{ name: 'user', type: 'address' }],
  outputs: [
    { name: 'totalCollateralBase', type: 'uint256' },
    { name: 'totalDebtBase', type: 'uint256' },
    { name: 'availableBorrowsBase', type: 'uint256' },
    { name: 'currentLiquidationThreshold', type: 'uint256' },
    { name: 'ltv', type: 'uint256' },
    { name: 'healthFactor', type: 'uint256' },
  ],
}];

export const VENUS_COMPTROLLER_ABI = [{
  type: 'function', name: 'getAccountLiquidity', stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [
    { name: 'error', type: 'uint256' },
    { name: 'liquidity', type: 'uint256' },
    { name: 'shortfall', type: 'uint256' },
  ],
}];

/** Scaled integer to a display string, without floats in the maths. */
export function fromScaled(value, decimals, places = 2) {
  if (value == null) return null;
  const v = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = ((v % base) * (10n ** BigInt(places))) / base;
  return `${whole}.${String(frac).padStart(places, '0')}`;
}

/** How worried to be. Aave's own liquidation point is 1.0. */
export function riskBand(healthFactor) {
  if (healthFactor == null) return null;
  const hf = Number(healthFactor);
  if (hf < 1) return { key: 'liquidatable', label: 'Liquidatable now', tone: 'red' };
  if (hf < 1.1) return { key: 'critical', label: 'Critical', tone: 'red' };
  if (hf < 1.5) return { key: 'tight', label: 'Tight', tone: 'amber' };
  if (hf < 2) return { key: 'ok', label: 'Comfortable', tone: 'emerald' };
  return { key: 'safe', label: 'Safe', tone: 'emerald' };
}

export async function readAave(publicClient, address) {
  const r = await publicClient.readContract({
    address: AAVE_POOL, abi: AAVE_POOL_ABI,
    functionName: 'getUserAccountData', args: [address],
  });
  const [collateral, debt, available, threshold, ltv, hf] = r;
  const hasDebt = BigInt(debt) > 0n && BigInt(hf) !== UINT256_MAX;
  return {
    protocol: 'Aave v3',
    hasPosition: BigInt(collateral) > 0n || BigInt(debt) > 0n,
    hasDebt,
    collateralUsd: fromScaled(collateral, AAVE_BASE_DECIMALS),
    debtUsd: fromScaled(debt, AAVE_BASE_DECIMALS),
    availableUsd: fromScaled(available, AAVE_BASE_DECIMALS),
    // Basis points from the contract, shown as a percentage.
    liquidationThresholdPct: Number(threshold) / 100,
    ltvPct: Number(ltv) / 100,
    healthFactor: hasDebt ? fromScaled(hf, 18) : null,
  };
}

export async function readVenus(publicClient, address) {
  const r = await publicClient.readContract({
    address: VENUS_COMPTROLLER, abi: VENUS_COMPTROLLER_ABI,
    functionName: 'getAccountLiquidity', args: [address],
  });
  const [err, liquidity, shortfall] = r;
  return {
    protocol: 'Venus',
    // A non-zero error code means the Comptroller could not price the
    // account, which is not the same as the account being empty.
    errorCode: Number(err),
    hasPosition: BigInt(liquidity) > 0n || BigInt(shortfall) > 0n,
    liquidityUsd: fromScaled(liquidity, 18),
    shortfallUsd: fromScaled(shortfall, 18),
    liquidatable: BigInt(shortfall) > 0n,
  };
}

/** Both protocols, each reported on its own terms. A failure on one does
 *  not hide the other, since a wallet may only use one of them. */
export async function readPositions(publicClient, address) {
  const [aave, venus] = await Promise.allSettled([
    readAave(publicClient, address),
    readVenus(publicClient, address),
  ]);
  return {
    aave: aave.status === 'fulfilled' ? aave.value : { protocol: 'Aave v3', error: String(aave.reason?.shortMessage || aave.reason?.message || aave.reason) },
    venus: venus.status === 'fulfilled' ? venus.value : { protocol: 'Venus', error: String(venus.reason?.shortMessage || venus.reason?.message || venus.reason) },
  };
}
