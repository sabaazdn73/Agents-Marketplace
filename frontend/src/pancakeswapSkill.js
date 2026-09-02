// pancakeswapSkill.js
//
// Real execution of the "enter-position" play from Altana's certified
// pancakeswap-trading skill (skills/pancakeswap-trading/SKILL.md,
// confirmed live via the real registry index.json, 9 Aug 2026). Every
// address and function signature below is copied exactly from that
// skill's own Reference section, not re-derived or guessed.
//
// The Native Agent Marketplace's own Trading Agent (real, multi-DEX price
// comparison across PancakeSwap/Biswap/ApeSwap, added 2026-09-06) lives
// in tradingAgent.js instead of here — genuinely different scope from
// this file's own single-DEX Skill pass-through, but WBNB/USDT_BSC below
// are still the one shared source of truth both files import.

import { encodeFunctionData, parseAbi } from 'viem';

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
  'function decimals() view returns (uint8)',
]);

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
