// defiSkills.js
//
// Real execution for the lending/staking skills, addresses and function
// behavior copied exactly from each skill's own SKILL.md in Altana's public
// registry (confirmed live 9 Aug 2026). Each function follows that skill's
// own Guards verbatim, especially "verify balances changed, success of the
// transaction alone doesn't mean the operation succeeded".
//
// Execution is done through an injected `executor` ({ walletAddress,
// publicClient, execute(calls) }) so the SAME skill logic serves both the
// real Altana session path (altana.js getAltanaExecutor) and the Anvil
// practice path (practiceWallet.js getPracticeExecutor) with no branching.

import { encodeFunctionData, parseAbi } from 'viem';

export const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';

// ── Venus Lending ──
export const VENUS_VUSDT = '0xfD5840Cd36d94D7229439859C0112a4185BC0255';
const VENUS_ABI = parseAbi([
  'function mint(uint256 amount) returns (uint256)',
  'function redeemUnderlying(uint256 amount) returns (uint256)',
  'function redeem(uint256 vTokenAmount) returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]);
const ERC20_ABI = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);

export async function venusSupply(executor, { usdtAmount }) {
  const amountRaw = BigInt(Math.round(usdtAmount * 1e18)); // USDT is 18 decimals on BSC, per the skill's own note
  const approveCalldata = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [VENUS_VUSDT, amountRaw] });
  const mintCalldata = encodeFunctionData({ abi: VENUS_ABI, functionName: 'mint', args: [amountRaw] });
  // Guard from the skill: "mint returns 0 on success (Compound-style error
  // codes, it does not revert on some failures). Always verify by reading
  // balances after." This function does the calls; the caller is responsible
  // for the post-call balance check.
  return executor.execute([{ to: USDT_BSC, data: approveCalldata }, { to: VENUS_VUSDT, data: mintCalldata }]);
}

export async function venusWithdraw(executor, { usdtAmount, withdrawAll = false }) {
  if (withdrawAll) {
    // Real flow per the skill: read full vToken balance, redeem() it entirely.
    throw new Error('withdrawAll requires reading the live vUSDT balance first, wire a publicClient read before calling this with withdrawAll=true.');
  }
  const amountRaw = BigInt(Math.round(usdtAmount * 1e18));
  const calldata = encodeFunctionData({ abi: VENUS_ABI, functionName: 'redeemUnderlying', args: [amountRaw] });
  return executor.execute([{ to: VENUS_VUSDT, data: calldata }]);
}

// ── Aave V3 Lending ──
export const AAVE_POOL = '0x6807dc923806fE8Fd134338EABCA509979a7e0cB';
const AAVE_ABI = parseAbi([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
]);
const MAX_UINT256 = 2n ** 256n - 1n;

export async function aaveSupply(executor, { usdtAmount }) {
  const amountRaw = BigInt(Math.round(usdtAmount * 1e18));
  const approveCalldata = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [AAVE_POOL, amountRaw] });
  const supplyCalldata = encodeFunctionData({ abi: AAVE_ABI, functionName: 'supply', args: [USDT_BSC, amountRaw, executor.walletAddress, 0] });
  return executor.execute([{ to: USDT_BSC, data: approveCalldata }, { to: AAVE_POOL, data: supplyCalldata }]);
}

export async function aaveWithdraw(executor, { usdtAmount, withdrawAll = false }) {
  const amountRaw = withdrawAll ? MAX_UINT256 : BigInt(Math.round(usdtAmount * 1e18));
  const calldata = encodeFunctionData({ abi: AAVE_ABI, functionName: 'withdraw', args: [USDT_BSC, amountRaw, executor.walletAddress] });
  return executor.execute([{ to: AAVE_POOL, data: calldata }]);
}

// ── Lista Liquid Staking ──
export const LISTA_MANAGER = '0x1adB950d8bB3dA4bE104211D5AB038628e477fE6';
const LISTA_ABI = parseAbi(['function deposit() payable']);

export async function listaStake(executor, { bnbAmount }) {
  const amountRaw = BigInt(Math.round(bnbAmount * 1e18));
  const calldata = encodeFunctionData({ abi: LISTA_ABI, functionName: 'deposit', args: [] });
  // Real payable call, native value attached, per the skill's own note:
  // "the session must be allowed to send native value to the manager."
  return executor.execute([{ to: LISTA_MANAGER, data: calldata, value: amountRaw }]);
}

// ── PancakeSwap Liquidity ──
export const PANCAKESWAP_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function token0() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]);
const FACTORY_ABI = parseAbi(['function getPair(address tokenA, address tokenB) view returns (address)']);
const ROUTER_LIQ_ABI = parseAbi([
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256, uint256, uint256)',
  'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256, uint256)',
]);
const PANCAKESWAP_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

/** Real quote: sizes the second token to match the LIVE pool ratio,
 * per the skill's own quirk: "never assume a 50/50 or a stale ratio." */
export async function quoteLiquidityRatio(publicClient, tokenA, tokenB, amountADesired) {
  const pairAddress = await publicClient.readContract({ address: PANCAKESWAP_FACTORY, abi: FACTORY_ABI, functionName: 'getPair', args: [tokenA, tokenB] });
  if (pairAddress === '0x0000000000000000000000000000000000000000') throw new Error('No PancakeSwap V2 pair exists for this token pair.');

  const [reserves, token0] = await Promise.all([
    publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'getReserves' }),
    publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token0' }),
  ]);
  const [reserve0, reserve1] = reserves;
  const aIsToken0 = tokenA.toLowerCase() === token0.toLowerCase();
  const [reserveA, reserveB] = aIsToken0 ? [reserve0, reserve1] : [reserve1, reserve0];

  const amountBOptimal = (amountADesired * reserveB) / reserveA;
  return { pairAddress, amountBOptimal, reserveA, reserveB };
}

export async function pancakeAddLiquidity(executor, { tokenA, tokenB, amountADesired, slippagePct = 1 }) {
  const { amountBOptimal } = await quoteLiquidityRatio(executor.publicClient, tokenA, tokenB, amountADesired);

  const slippageBps = BigInt(Math.round((100 - slippagePct) * 100));
  const amountAMin = (amountADesired * slippageBps) / 10000n;
  const amountBMin = (amountBOptimal * slippageBps) / 10000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const approveA = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [PANCAKESWAP_ROUTER, amountADesired] });
  const approveB = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [PANCAKESWAP_ROUTER, amountBOptimal] });
  const addLiq = encodeFunctionData({
    abi: ROUTER_LIQ_ABI, functionName: 'addLiquidity',
    args: [tokenA, tokenB, amountADesired, amountBOptimal, amountAMin, amountBMin, executor.walletAddress, deadline],
  });

  return executor.execute([{ to: tokenA, data: approveA }, { to: tokenB, data: approveB }, { to: PANCAKESWAP_ROUTER, data: addLiq }]);
}
