// trade/chains.js
//
// The chains a tokenized stock can be bought on from this site, what a buyer
// can pay with on each, and where a transaction is looked up. Plain module,
// no React, so the headless checks can read it.
//
// PAY-WITH TOKENS (SPEC C.1): USDC on Ethereum, Base and Arbitrum, USDT or
// USDC on BNB Chain, USDG on Robinhood Chain, USDC on HyperEVM. Each address
// was read on its own chain on 2026-09-27 (symbol() and decimals()):
//   Ethereum      USDC  6   block 26,068,112
//   Base          USDC  6   block 51,857,275
//   Arbitrum      USDC  6   block 509,359,144
//   BNB Chain     USDT  18  block 124,314,584
//   BNB Chain     USDC  18  block 124,314,585
//   Robinhood     USDG  6   block 73,857,028
//   HyperEVM      USDC  6   block 47,018,166
// Robinhood Chain pays with USDG only. The other USDC there
// (0x80e0...6ca8, 341 tokens of supply when it was read on 2026-09-25) is the
// one LI.FI priced near zero in T0's route 14, which would have bought 0.74
// NVDA for $1,000; it is never offered.
//
// A stablecoin is taken at $1 wherever a dollar figure is derived from it.
// That is an assumption, and the panel says so beside the figure.

export const BUY_CHAINS = {
  1: { name: 'Ethereum', explorer: 'https://etherscan.io', pay: [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  ] },
  8453: { name: 'Base', explorer: 'https://basescan.org', pay: [
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  ] },
  42161: { name: 'Arbitrum', explorer: 'https://arbiscan.io', pay: [
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
  ] },
  56: { name: 'BNB Chain', explorer: 'https://bscscan.com', pay: [
    { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  ] },
  4663: { name: 'Robinhood Chain', explorer: 'https://robinhoodchain.blockscout.com', pay: [
    { symbol: 'USDG', address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', decimals: 6 },
  ] },
  // HyperEVM: offered where LI.FI finds a route (T0 route 18 found one for
  // NVDAx); a version with no route says so after the quote.
  999: { name: 'HyperEVM', explorer: 'https://hyperevmscan.io', pay: [
    { symbol: 'USDC', address: '0xb88339CB7199b77E23DB6E890353E22632Ba630f', decimals: 6 },
  ] },
};

// CROSS-CHAIN PAY-WITH, only where a route was measured (SPEC C.1: "offered
// only where measured"). T0 routes 15 to 17: Arbitrum USDC to NVDA, TSLA and
// SPY on Robinhood Chain, through Symbiosis, LI.FI's estimate 37 s. Keyed by
// the chain the stock is on; each entry is a chain the buyer may pay from.
export const CROSS_CHAIN_MEASURED = {
  4663: [42161],
};

export const isBuyChain = (id) => Object.prototype.hasOwnProperty.call(BUY_CHAINS, id);

/** Every token a buyer of a stock on `chainId` may pay with: the chain's own
 *  stablecoins first, then the measured cross-chain ones. */
export function payOptions(chainId) {
  const out = [];
  for (const from of [chainId, ...(CROSS_CHAIN_MEASURED[chainId] || [])]) {
    const c = BUY_CHAINS[from];
    if (!c) continue;
    for (const t of c.pay) out.push({ ...t, chainId: from, chainName: c.name, id: `${from}:${t.address.toLowerCase()}` });
  }
  return out;
}

export const txUrl = (chainId, hash) => (BUY_CHAINS[chainId] && hash ? `${BUY_CHAINS[chainId].explorer}/tx/${hash}` : null);
export const addressUrl = (chainId, a) => (BUY_CHAINS[chainId] && a ? `${BUY_CHAINS[chainId].explorer}/address/${a}` : null);

/** "4663/0xd060..." to { chainId, address }. */
export function parseKey(key) {
  const m = /^(\d+)\/(0x[0-9a-fA-F]{40})$/.exec(key || '');
  return m ? { chainId: Number(m[1]), address: m[2] } : null;
}
