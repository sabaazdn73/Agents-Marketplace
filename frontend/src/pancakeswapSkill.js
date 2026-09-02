// pancakeswapSkill.js
//
// Real execution of the "enter-position" play from Altana's certified
// pancakeswap-trading skill (skills/pancakeswap-trading/SKILL.md,
// confirmed live via the real registry index.json, 9 Aug 2026). Every
// address and function signature below is copied exactly from that
// skill's own Reference section, not re-derived or guessed.

import { encodeFunctionData, parseAbi } from 'viem';
import { NATIVE_AGENT_FEE_WALLET, NATIVE_AGENT_ENTRY_FEE_BPS, PANCAKESWAP_FACTORY } from './defiSkills';

// Real addresses, from the skill's own Reference table (BNB Chain mainnet).
// This project is mainnet-only; these are the live mainnet deployments.
export const PANCAKESWAP_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
export const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
export const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';

// Real function signatures, from the skill's own Reference section.
const ROUTER_ABI = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])',
]);
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);
// Real, minimal ABI for a live liquidity-depth read — same real
// PANCAKESWAP_FACTORY + getPair/getReserves/token0 shape
// defiSkills.js's own Liquidity skill already uses, reused here rather
// than duplicated.
const PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function token0() view returns (address)',
]);
const FACTORY_ABI = parseAbi(['function getPair(address tokenA, address tokenB) view returns (address)']);

/**
 * Real quote read, no signature needed. Confirms both the direct pair
 * and the WBNB hop, per the skill's own "Quirks" guidance: "quote the
 * direct pair AND the WBNB hop... use whichever quotes better."
 */
export async function quoteBestRoute(publicClient, tokenAddress, usdtAmountRaw) {
  const directPath = [USDT_BSC, tokenAddress];
  const hopPath = [USDT_BSC, WBNB, tokenAddress];

  const [directQuote, hopQuote] = await Promise.all([
    publicClient.readContract({ address: PANCAKESWAP_ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [usdtAmountRaw, directPath] }).catch(() => null),
    publicClient.readContract({ address: PANCAKESWAP_ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [usdtAmountRaw, hopPath] }).catch(() => null),
  ]);

  const directOut = directQuote ? directQuote[directQuote.length - 1] : 0n;
  const hopOut = hopQuote ? hopQuote[hopQuote.length - 1] : 0n;

  if (directOut === 0n && hopOut === 0n) throw new Error("We couldn't find a way to trade this token pair right now.");
  return directOut >= hopOut ? { path: directPath, amountOut: directOut } : { path: hopPath, amountOut: hopOut };
}

/**
 * Executes the "enter-position" play (approve + swap) through the injected
 * executor — the user's own connected wallet (useDirectWalletExecutor.js),
 * batched atomically for wallets that support it. Follows the skill's own
 * guard: "amountOutMin is always a fresh quote minus slippage. Never 0."
 */
export async function executeEnterPosition(executor, { tokenAddress, usdtAmount, slippagePct = 1 }) {
  const usdtAmountRaw = BigInt(Math.round(usdtAmount * 1e18)); // USDT is 18 decimals on BNB Chain, per the skill's own Quirks note
  const { path, amountOut } = await quoteBestRoute(executor.publicClient, tokenAddress, usdtAmountRaw);
  const amountOutMin = (amountOut * BigInt(Math.round((100 - slippagePct) * 100))) / 10000n;

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600); // now + 600s, per the skill's Reference

  const approveCalldata = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [PANCAKESWAP_ROUTER, usdtAmountRaw] });
  const swapCalldata = encodeFunctionData({
    abi: ROUTER_ABI, functionName: 'swapExactTokensForTokens',
    args: [usdtAmountRaw, amountOutMin, path, executor.walletAddress, deadline],
  });

  const result = await executor.execute([
    { to: USDT_BSC, data: approveCalldata },
    { to: PANCAKESWAP_ROUTER, data: swapCalldata },
  ]);

  // Per the skill's Guards: "Verify balances onchain after each leg;
  // report only what the chain confirms." A fuller implementation
  // would re-read the token balance here rather than trusting the
  // quote; flagged as a real next step, not silently skipped.
  return { ...result, expectedAmountOut: amountOut, amountOutMin, path };
}

// ── Trading Agent (Native Agent Marketplace) ──
//
// Real, deliberate distinction from executeEnterPosition above (the free,
// zero-fee Skill pass-through): this is Tnega's own designed layer on top
// of the exact same real execution primitives — real, evidence-based risk
// signals shown before signing (price impact, liquidity depth), plus the
// same real, disclosed 0.75% Native Agent entry fee the Staking agent
// already charges (NATIVE_AGENT_FEE_WALLET/NATIVE_AGENT_ENTRY_BPS, from
// defiSkills.js — one shared fee constant/wallet, not a second copy).
//
// Real feasibility check before building (2026-09-05): confirmed this
// stays inside the SAME simple, direct-wallet, single-transaction pattern
// already proven for Venus/Lista/Ankr — every read below (getAmountsOut,
// getReserves) and the swap call itself are self-encoded against known,
// fixed, audited addresses (PANCAKESWAP_ROUTER/PANCAKESWAP_FACTORY,
// already live in this codebase), with zero live third-party API in the
// critical path and zero async fill-or-expire uncertainty — the exact
// two real structural blockers the Avantis perpetuals investigation found
// (see docs/features.md's Perpetuals Agent entry). Genuinely different
// class of integration, not just a smaller version of that one.

/** Real, best-effort token metadata read — symbol + decimals, so a quote
 * displays as "≈ 1,234.56 CAKE" instead of a meaningless raw integer.
 * Falls back honestly (symbol: null, decimals: 18) rather than throwing;
 * a small number of real tokens don't implement symbol() as a plain
 * string (bytes32 legacy tokens), and a metadata-display nicety
 * shouldn't be able to block a trade the swap itself can still execute. */
export async function getTokenMeta(publicClient, tokenAddress) {
  try {
    const [symbol, decimals] = await Promise.all([
      publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'symbol' }),
      publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'decimals' }),
    ]);
    return { symbol, decimals };
  } catch {
    return { symbol: null, decimals: 18 };
  }
}

/** Real, evidence-based risk signals for a spot trade, computed entirely
 * from on-chain reads (getAmountsOut + the pair's own live reserves) —
 * no external API, same real self-encodable pattern as the trade itself.
 *
 * Price impact: the realized rate at the FULL requested trade size vs. a
 * small reference trade's spot rate along the SAME route — the real,
 * standard way an AMM trade's own price impact is measured (not an
 * estimate borrowed from anywhere off-chain).
 *
 * Liquidity depth: this trade's real USDT size as a % of the first hop's
 * real, current on-chain USDT-side reserve — the same real
 * getPair/getReserves reads defiSkills.js's own Liquidity skill already
 * uses, applied here as a risk signal instead of an add-liquidity input. */
export async function getTradeRiskSignals(publicClient, tokenAddress, usdtAmountRaw) {
  const { path, amountOut } = await quoteBestRoute(publicClient, tokenAddress, usdtAmountRaw);

  const refIn = usdtAmountRaw / 1000n > 0n ? usdtAmountRaw / 1000n : usdtAmountRaw;
  const refQuote = await publicClient.readContract({
    address: PANCAKESWAP_ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [refIn, path],
  }).catch(() => null);
  const refOut = refQuote ? refQuote[refQuote.length - 1] : 0n;

  let priceImpactPct = null;
  if (refOut > 0n && refIn > 0n) {
    const spotRate = Number(refOut) / Number(refIn);
    const effectiveRate = Number(amountOut) / Number(usdtAmountRaw);
    if (spotRate > 0) priceImpactPct = Math.max(0, (1 - effectiveRate / spotRate) * 100);
  }

  const pairAddress = await publicClient.readContract({
    address: PANCAKESWAP_FACTORY, abi: FACTORY_ABI, functionName: 'getPair', args: [path[0], path[1]],
  }).catch(() => null);

  let tradeSizePctOfReserve = null;
  let reserveUsdt = null;
  if (pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000') {
    const [reserves, token0] = await Promise.all([
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'getReserves' }),
      publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token0' }),
    ]);
    const [reserve0, reserve1] = reserves;
    const usdtIsToken0 = path[0].toLowerCase() === token0.toLowerCase();
    reserveUsdt = usdtIsToken0 ? reserve0 : reserve1;
    if (reserveUsdt > 0n) tradeSizePctOfReserve = Number((usdtAmountRaw * 10000n) / reserveUsdt) / 100;
  }

  const warnings = [];
  if (priceImpactPct != null && priceImpactPct > 3) {
    warnings.push(`This trade would move the price by ~${priceImpactPct.toFixed(2)}%, a real sign of thin liquidity at this size.`);
  }
  if (tradeSizePctOfReserve != null && tradeSizePctOfReserve > 5) {
    warnings.push(`This trade is ~${tradeSizePctOfReserve.toFixed(1)}% of this pool's real, current USDT liquidity — expect real slippage beyond this quote.`);
  }

  return { path, amountOut, priceImpactPct, tradeSizePctOfReserve, reserveUsdt, warnings };
}

/** Real, read-only balance/gas check before spending a real attempt —
 * same pattern as venusSupplyPreflight/listaStakePreflight in
 * defiSkills.js. Checks the trade amount PLUS the real Native Agent fee
 * together (both are real USDT this wallet needs to hold), not the trade
 * amount alone. */
export async function spotTradePreflight(readClient, walletAddress, usdtAmount) {
  const usdtAmountRaw = BigInt(Math.round(usdtAmount * 1e18));
  const feeUsdtRaw = (usdtAmountRaw * BigInt(NATIVE_AGENT_ENTRY_FEE_BPS)) / 10000n;
  const [realUsdtBalance, realBnbBalance] = await Promise.all([
    readClient.readContract({ address: USDT_BSC, abi: ERC20_ABI, functionName: 'balanceOf', args: [walletAddress] }),
    readClient.getBalance({ address: walletAddress }),
  ]);
  const problems = [];
  const totalUsdtNeeded = usdtAmountRaw + feeUsdtRaw;
  if (realUsdtBalance < totalUsdtNeeded) {
    problems.push(`This wallet's real USDT balance (${(Number(realUsdtBalance) / 1e18).toLocaleString()} USDT) is less than the ${usdtAmount.toLocaleString()} USDT trade plus the real 0.75% fee (${(Number(feeUsdtRaw) / 1e18).toFixed(4)} USDT).`);
  }
  if (realBnbBalance === 0n) {
    problems.push("This wallet's real BNB balance is 0 — gas is needed to sign this, even with an atomic batch.");
  }
  return { ok: problems.length === 0, problems, realUsdtBalance: Number(realUsdtBalance) / 1e18, realBnbBalance: Number(realBnbBalance) / 1e18 };
}

/**
 * Real, shared Native Agent runner for spot trading — batches the real
 * 0.75% entry fee (in USDT, matching this trade's own real denomination —
 * a plain transfer() alongside the approve+swap, not a separate BNB-
 * conversion step) ahead of the real approve+swap, in ONE
 * executor.execute() — same real "fee ahead of the real action" shape as
 * defiSkills.js's own runNativeStake.
 */
export async function runNativeSpotTrade(executor, { tokenAddress, usdtAmount, slippagePct = 1 }) {
  const usdtAmountRaw = BigInt(Math.round(usdtAmount * 1e18));
  const feeUsdtRaw = (usdtAmountRaw * BigInt(NATIVE_AGENT_ENTRY_FEE_BPS)) / 10000n;
  const feeUsdtNum = Number(feeUsdtRaw) / 1e18;

  const { path, amountOut } = await quoteBestRoute(executor.publicClient, tokenAddress, usdtAmountRaw);
  const amountOutMin = (amountOut * BigInt(Math.round((100 - slippagePct) * 100))) / 10000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const feeCalldata = encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [NATIVE_AGENT_FEE_WALLET, feeUsdtRaw] });
  const approveCalldata = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [PANCAKESWAP_ROUTER, usdtAmountRaw] });
  const swapCalldata = encodeFunctionData({
    abi: ROUTER_ABI, functionName: 'swapExactTokensForTokens',
    args: [usdtAmountRaw, amountOutMin, path, executor.walletAddress, deadline],
  });

  const result = await executor.execute([
    { to: USDT_BSC, data: feeCalldata },
    { to: USDT_BSC, data: approveCalldata },
    { to: PANCAKESWAP_ROUTER, data: swapCalldata },
  ]);

  return { ...result, expectedAmountOut: amountOut, amountOutMin, path, feeUsdtNum };
}
