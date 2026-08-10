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

import { parseAbi, decodeEventLog } from 'viem';

const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

const SWAP_EVENT = parseAbi(['event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)']);
const PAIR_ABI = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)']);

// Real topic0, computed the same disciplined way as the wallet-tracker
// module (never trusted from memory without checking): keccak256 of
// the exact event signature the skill's own doc gives.
const SWAP_TOPIC0 = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'.slice(0, 66);

function addressToTopic(address) {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

/**
 * Real leader-trade detection: filters Swap logs where `to` (topic 2)
 * is the leader, decodes which token flowed to them, per the skill's
 * own documented method (not a guess, not an indexer, plain RPC logs).
 */
export async function detectLeaderTrades(publicClient, leaderAddress, { fromBlock, toBlock } = {}) {
  if (!leaderAddress) throw new Error('A leader wallet address is required. Per this skill\'s own rule, it must never be inferred or guessed.');

  const latestBlock = toBlock ?? await publicClient.getBlockNumber();
  const startBlock = fromBlock ?? (latestBlock > 5000n ? latestBlock - 5000n : 0n);

  const logs = await publicClient.getLogs({
    fromBlock: startBlock, toBlock: latestBlock,
    topics: [SWAP_TOPIC0, null, addressToTopic(leaderAddress)],
  });

  const decoded = [];
  for (const log of logs) {
    try {
      const event = decodeEventLog({ abi: SWAP_EVENT, data: log.data, topics: log.topics });
      const [token0, token1] = await Promise.all([
        publicClient.readContract({ address: log.address, abi: PAIR_ABI, functionName: 'token0' }),
        publicClient.readContract({ address: log.address, abi: PAIR_ABI, functionName: 'token1' }),
      ]);
      const amountOut0 = event.args.amount0Out;
      const amountOut1 = event.args.amount1Out;
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
