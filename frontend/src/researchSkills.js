// researchSkills.js
//
// The two read-only skills: no Altana session needed at all, per
// their own SKILL.md ("session permits no onchain calls"). Real
// public endpoints, exactly as documented.

// ── DexScreener Token Radar ──
export async function getTrendingBscTokens() {
  const res = await fetch('https://api.geckoterminal.com/api/v2/networks/bsc/trending_pools');
  if (!res.ok) throw new Error(`GeckoTerminal returned ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((p) => ({
    name: p.attributes?.name,
    priceUsd: p.attributes?.base_token_price_usd,
    liquidityUsd: p.attributes?.reserve_in_usd,
    volume24h: p.attributes?.volume_usd?.h24,
    priceChange24h: p.attributes?.price_change_percentage?.h24,
  }));
}

export async function searchToken(query) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`DexScreener returned ${res.status}`);
  const data = await res.json();
  return (data.pairs || []).filter((p) => p.chainId === 'bsc');
}

// Honest risk screen, exactly the heuristics the skill's own doc lists,
// not a guarantee: "Neither source proves a token is safe."
export function screenTokenRisk(pair) {
  const flags = [];
  const liquidityUsd = Number(pair.liquidity?.usd || 0);
  const ageMinutes = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 60000 : Infinity;
  const buys = pair.txns?.h24?.buys || 0;
  const sells = pair.txns?.h24?.sells || 0;

  if (liquidityUsd < 100000) flags.push('Liquidity under $100k, thin pool, easy to move');
  if (ageMinutes < 60 && sells === 0 && buys > 5) flags.push('Very new, one-sided buying, classic honeypot shape');
  if (pair.volume?.h24 > liquidityUsd * 10) flags.push('Volume far exceeds liquidity, possible wash-trade shape');

  return { flags, liquidityUsd, ageMinutes: Math.round(ageMinutes), buys, sells };
}

// ── Wallet Tracker ──
// Real PancakeSwap V2 pair Swap event topic0, computed from the
// documented signature: Swap(address,uint256,uint256,uint256,uint256,address)
const SWAP_EVENT_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

export async function getRecentWalletSwaps(publicClient, walletAddress, { blockWindow = 5000n } = {}) {
  const latestBlock = await publicClient.getBlockNumber();
  const fromBlock = latestBlock > blockWindow ? latestBlock - blockWindow : 0n;

  // Real approach per the skill: filter Swap logs where `to` (the
  // 3rd indexed topic per the event signature) matches the wallet,
  // pair addresses discovered from the log's own `address` field,
  // no hardcoded pair list needed.
  const logs = await publicClient.getLogs({
    fromBlock, toBlock: latestBlock,
    topics: [SWAP_EVENT_TOPIC, null, `0x${'0'.repeat(24)}${walletAddress.slice(2).toLowerCase()}`],
  });

  return {
    windowBlocks: { from: fromBlock.toString(), to: latestBlock.toString() },
    swapCount: logs.length,
    pairsInvolved: [...new Set(logs.map((l) => l.address))],
  };
}
