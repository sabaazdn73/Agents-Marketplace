// fourMemeSkill.js
//
// Real execution for Four.meme's bonding-curve trading, addresses and
// function behavior copied exactly from the skill's own SKILL.md.
//
// Execution goes through an injected `executor` ({ walletAddress,
// publicClient, execute(calls) }) — the real Altana session path.

import { encodeFunctionData, parseAbi } from 'viem';

export const TOKEN_MANAGER_2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
export const TOKEN_MANAGER_HELPER_3 = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';

const HELPER_ABI = parseAbi([
  'function getTokenInfo(address token) view returns (uint256 version, address tokenManager, address quote, uint256 lastPrice, uint256 tradingFeeRate, uint256 minTradingFee, uint256 launchTime, uint256 offers, uint256 maxOffers, uint256 funds, uint256 maxFunds, bool liquidityAdded)',
  'function tryBuy(address token, uint256 amount, uint256 funds) view returns (address tokenManager, address quote, uint256 estimatedAmount, uint256 estimatedCost, uint256 estimatedFee, uint256 amountMsgValue, uint256 amountApproval, uint256 amountFunds)',
  'function trySell(address token, uint256 amount) view returns (address tokenManager, address quote, uint256 funds, uint256 fee)',
]);
const MANAGER_ABI = parseAbi([
  'function buyTokenAMAP(address token, uint256 funds, uint256 minAmount) payable',
  'function sellToken(address token, uint256 amount, uint256 minFunds)',
]);
const ERC20_ABI = parseAbi(['function approve(address spender, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)']);

/** Real graduation check, must happen before any curve write per the
 * skill's Guards: "Check liquidityAdded before any curve write." */
export async function getCurveStatus(publicClient, tokenAddress) {
  const info = await publicClient.readContract({ address: TOKEN_MANAGER_HELPER_3, abi: HELPER_ABI, functionName: 'getTokenInfo', args: [tokenAddress] });
  return {
    liquidityAdded: info[11],
    funds: info[9], maxFunds: info[10],
    progressPct: info[10] > 0n ? Number((info[9] * 10000n) / info[10]) / 100 : 0,
    lastPrice: info[3],
  };
}

export async function buyOnCurve(executor, { tokenAddress, bnbToSpend, slippagePct = 3 }) {
  const status = await getCurveStatus(executor.publicClient, tokenAddress);
  if (status.liquidityAdded) throw new Error("This token has already moved to full trading on PancakeSwap — use the PancakeSwap Trading skill for it instead.");

  const fundsRaw = BigInt(Math.round(bnbToSpend * 1e18));

  const quote = await executor.publicClient.readContract({ address: TOKEN_MANAGER_HELPER_3, abi: HELPER_ABI, functionName: 'tryBuy', args: [tokenAddress, 0n, fundsRaw] });
  const [, , estimatedAmount, , , amountMsgValue] = quote;
  const minAmount = (estimatedAmount * BigInt(Math.round((100 - slippagePct) * 100))) / 10000n;

  const calldata = encodeFunctionData({ abi: MANAGER_ABI, functionName: 'buyTokenAMAP', args: [tokenAddress, fundsRaw, minAmount] });
  return executor.execute([{ to: TOKEN_MANAGER_2, data: calldata, value: amountMsgValue }]);
}

export async function sellOnCurve(executor, { tokenAddress, tokenAmount, slippagePct = 3 }) {
  const status = await getCurveStatus(executor.publicClient, tokenAddress);
  if (status.liquidityAdded) throw new Error("This token has already moved to full trading on PancakeSwap — use the PancakeSwap Trading skill for it instead.");

  const amountRaw = BigInt(Math.round(tokenAmount * 1e18));

  const quote = await executor.publicClient.readContract({ address: TOKEN_MANAGER_HELPER_3, abi: HELPER_ABI, functionName: 'trySell', args: [tokenAddress, amountRaw] });
  const [, , funds] = quote;
  const minFunds = (funds * BigInt(Math.round((100 - slippagePct) * 100))) / 10000n;

  const approveCalldata = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [TOKEN_MANAGER_2, amountRaw] });
  const sellCalldata = encodeFunctionData({ abi: MANAGER_ABI, functionName: 'sellToken', args: [tokenAddress, amountRaw, minFunds] });

  return executor.execute([{ to: tokenAddress, data: approveCalldata }, { to: TOKEN_MANAGER_2, data: sellCalldata }]);
}
