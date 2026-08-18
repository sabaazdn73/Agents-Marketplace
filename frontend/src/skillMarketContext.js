// skillMarketContext.js
//
// Real market context for a Practice Mode run, scoped honestly per skill
// type — built 2026-08-19. Every function here either returns REAL data
// from a real, verified-live source, or throws/returns null so the caller
// can say so honestly. Nothing here is invented or extrapolated.
//
// Real sources, verified live before building this:
//   - PancakeSwap trading/liquidity: a REAL price-over-time chart. The real
//     pair address is computed from the PancakeSwap V2 Factory (the same
//     getPair() pattern defiSkills.js already uses for quoteLiquidityRatio),
//     then fed to GeckoTerminal's public OHLCV endpoint — verified live
//     against the real WBNB/USDT pair, real hourly candles returned, no API
//     key needed.
//   - Venus / Aave lending: NOT a trade price, so no chart. The real
//     CURRENT supply rate instead (Venus's exchangeRateStored/
//     supplyRatePerBlock; Aave's getReserveData().currentLiquidityRate —
//     both verified live). No historical rate-over-time source exists that
//     we have real access to, so history is honestly not shown, not faked.
//   - Lista staking: same real-current-rate-only treatment — the real
//     slisBNB:BNB exchange rate from getTotalPooledBnb() / slisBNB's own
//     totalSupply() (verified live, real rate ~1.0376 at write time).
//   - Four.meme: pre-graduation bonding-curve tokens have NO PancakeSwap
//     pool yet, so GeckoTerminal/DexScreener genuinely have nothing to
//     show — real current curve price/progress only (reuses the existing
//     getCurveStatus, no new code needed), with an honest note about why
//     there's no chart.

import { parseAbi } from 'viem';
import { getCurveStatus } from './fourMemeSkill';

export const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const PANCAKESWAP_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const FACTORY_ABI = parseAbi(['function getPair(address tokenA, address tokenB) view returns (address)']);

const VENUS_VUSDT = '0xfD5840Cd36d94D7229439859C0112a4185BC0255';
const VENUS_ABI = parseAbi([
  'function exchangeRateStored() view returns (uint256)',
  'function supplyRatePerBlock() view returns (uint256)',
]);

const AAVE_POOL = '0x6807dc923806fE8Fd134338EABCA509979a7e0cB';
// Real Aave V3 ReserveData struct shape (aave-v3-core's DataTypes.ReserveData) —
// only decoding the fields we actually use; currentLiquidityRate is a RAY
// (1e27-scaled) per-second rate, standard across every Aave V3 market.
const AAVE_POOL_ABI = parseAbi([
  'function getReserveData(address asset) view returns (uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)',
]);

const LISTA_MANAGER = '0x1adB950d8bB3dA4bE104211D5AB038628e477fE6';
const LISTA_ABI = parseAbi(['function getTotalPooledBnb() view returns (uint256)']);
const SLISBNB = '0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B'; // real address, confirmed via a live DexScreener lookup
const ERC20_SUPPLY_ABI = parseAbi(['function totalSupply() view returns (uint256)']);

/** Real price-over-time for a token, quoted against USDT (or whatever
 * `against` is) — the real PancakeSwap V2 pair, real GeckoTerminal OHLCV.
 * Returns null (not a fabricated flat line) if no real pool exists yet. */
export async function getPancakeswapPriceHistory(publicClient, tokenAddress, { against = USDT_BSC, timeframe = 'hour', limit = 24 } = {}) {
  const pairAddress = await publicClient.readContract({
    address: PANCAKESWAP_FACTORY, abi: FACTORY_ABI, functionName: 'getPair',
    args: [tokenAddress, against],
  });
  if (!pairAddress || pairAddress === '0x0000000000000000000000000000000000000000') {
    return null; // real answer: no PancakeSwap V2 pool for this pair
  }
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/bsc/pools/${pairAddress}/ohlcv/${timeframe}?limit=${limit}`);
  if (!res.ok) return null; // GeckoTerminal doesn't index this pool — honest null, not a guess
  const body = await res.json();
  const rows = body?.data?.attributes?.ohlcv_list || [];
  if (rows.length === 0) return null;
  // [timestamp, open, high, low, close, volume] — oldest first for a left-to-right chart
  const points = rows.map(([t, , , , close]) => ({ t: t * 1000, close: Number(close) })).reverse();
  return { pairAddress, points };
}

/** Real current Venus supply rate. Per-block rate converted to an
 * approximate real APY using BSC's real ~0.75s block time (matches this
 * project's own earlier live-measured block-time findings) — an
 * approximation of a real on-chain number, not an invented one. */
export async function getVenusCurrentRate(publicClient) {
  const [exchangeRate, ratePerBlock] = await Promise.all([
    publicClient.readContract({ address: VENUS_VUSDT, abi: VENUS_ABI, functionName: 'exchangeRateStored' }),
    publicClient.readContract({ address: VENUS_VUSDT, abi: VENUS_ABI, functionName: 'supplyRatePerBlock' }),
  ]);
  const blocksPerYear = Math.floor((365 * 24 * 60 * 60) / 0.75);
  const ratePerBlockNum = Number(ratePerBlock) / 1e18;
  const apy = (Math.pow(1 + ratePerBlockNum, blocksPerYear) - 1) * 100;
  return { apyPct: apy, exchangeRate: Number(exchangeRate) / 1e18 };
}

/** Real current Aave supply rate — currentLiquidityRate is a RAY (1e27) per-second rate. */
export async function getAaveCurrentRate(publicClient) {
  const data = await publicClient.readContract({ address: AAVE_POOL, abi: AAVE_POOL_ABI, functionName: 'getReserveData', args: [USDT_BSC] });
  const currentLiquidityRateRay = data[2]; // currentLiquidityRate
  const apy = (Number(currentLiquidityRateRay) / 1e27) * 100;
  return { apyPct: apy };
}

/** Real current Lista liquid-staking exchange rate (slisBNB:BNB) — the
 * standard liquid-staking computation: total real BNB pooled, divided by
 * total real slisBNB shares outstanding. */
export async function getListaCurrentRate(publicClient) {
  const [pooled, supply] = await Promise.all([
    publicClient.readContract({ address: LISTA_MANAGER, abi: LISTA_ABI, functionName: 'getTotalPooledBnb' }),
    publicClient.readContract({ address: SLISBNB, abi: ERC20_SUPPLY_ABI, functionName: 'totalSupply' }),
  ]);
  if (supply === 0n) return null;
  return { bnbPerSlisBnb: Number(pooled) / Number(supply) };
}

/** Real current four.meme bonding-curve price/progress — reuses the
 * existing, already-verified getCurveStatus. No historical chart: these
 * tokens have no PancakeSwap pool until graduation, so no aggregator has
 * price history for them — an honest limitation, not a missing feature. */
export async function getFourMemeCurrentStatus(publicClient, tokenAddress) {
  return getCurveStatus(publicClient, tokenAddress);
}

/** Which skill ids get which kind of real market context — the mapping
 * PracticeRunMarketContext.jsx dispatches on. */
export const MARKET_CONTEXT_KIND = {
  'pancakeswap-trading': 'chart',
  'pancakeswap-liquidity': 'chart',
  'venus-lending': 'rate',
  'aave-v3-lending': 'rate',
  'lista-staking': 'rate',
  'four-meme': 'curve',
};
