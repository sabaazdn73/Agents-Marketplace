// copyTradeSkill.js
//
// Real leader-detection for the Copy Trade skill, real RPC log reads,
// exactly the events/logic the skill's own SKILL.md documents.
// Execution itself reuses the already-built pancakeswapSkill.js
// (the skill's own doc: "execution... the same PancakeSwap trading
// session as the pancakeswap-trading skill"), not duplicated here.
//
// HONEST GUARD, matching the skill's own non-negotiable rule: "The
// leader wallet is required... Never infer, guess, derive, or
// discover one." This module refuses to run without an explicit
// leaderAddress, exactly as instructed.

import { parseAbi, parseAbiItem } from 'viem';

const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

// The real PancakeSwap V2 Swap event, as a typed AbiEvent so viem can both
// FILTER by it (topic0) + the indexed `to`, and decode each matching log.
const SWAP_EVENT = parseAbiItem('event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)');
const PAIR_ABI = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)']);

// How many blocks back to scan by default. 1000 (~50 min of BSC) is served by
// dRPC's address-less getLogs; bump via VITE_SKILL_SCAN_BLOCKS on a read RPC
// that permits a wider range.
export const SCAN_BLOCKS = BigInt(import.meta.env?.VITE_SKILL_SCAN_BLOCKS || 1000);

/**
 * Real leader-trade detection: filters Swap logs where the indexed `to` is
 * the leader, and reads which token flowed to them, per the skill's own
 * documented method (plain RPC logs, no indexer).
 *
 * NOTE: viem's getLogs has NO raw `topics` param — you filter with a typed
 * `event` + `args` (a passed `topics` array is silently ignored, which made an
 * earlier version return everything / error on restrictive RPCs — caught by a
 * live run). Scanning by topic across all pairs needs an RPC that permits
 * address-less getLogs.
 */
export async function detectLeaderTrades(publicClient, leaderAddress, { fromBlock, toBlock } = {}) {
  if (!leaderAddress) throw new Error('Enter the wallet address you want to copy trades from.');

  const latestBlock = toBlock ?? await publicClient.getBlockNumber();
  // Default scan depth is SCAN_BLOCKS (VITE_SKILL_SCAN_BLOCKS, default 1000).
  const startBlock = fromBlock ?? (latestBlock > SCAN_BLOCKS ? latestBlock - SCAN_BLOCKS : 0n);

  const logs = await publicClient.getLogs({
    event: SWAP_EVENT,
    args: { to: leaderAddress },
    fromBlock: startBlock, toBlock: latestBlock,
  });

  const decoded = [];
  for (const log of logs) {
    try {
      const [token0, token1] = await Promise.all([
        publicClient.readContract({ address: log.address, abi: PAIR_ABI, functionName: 'token0' }),
        publicClient.readContract({ address: log.address, abi: PAIR_ABI, functionName: 'token1' }),
      ]);
      const amountOut0 = log.args.amount0Out;
      const amountOut1 = log.args.amount1Out;
      const tokenReceived = amountOut0 > 0n ? token0 : token1;
      const amountReceived = amountOut0 > 0n ? amountOut0 : amountOut1;
      const isSell = tokenReceived.toLowerCase() === USDT_BSC.toLowerCase() || tokenReceived.toLowerCase() === WBNB.toLowerCase();

      decoded.push({ txHash: log.transactionHash, pairAddress: log.address, tokenReceived, amountReceived, side: isSell ? 'sell' : 'buy' });
    } catch { /* a log that doesn't decode cleanly is skipped, not guessed at */ }
  }

  return decoded;
}

/** Real, hard-capped sizing, per the skill's own Guards: "Never exceed
 * the per-trade max... never let cumulative spend cross the total budget." */
export function sizeMirrorTrade({ leaderProportionalSize, perTradeMax, budgetRemaining }) {
  return Math.min(leaderProportionalSize, perTradeMax, budgetRemaining);
}
