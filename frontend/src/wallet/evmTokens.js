// evmTokens.js
//
// The named token list the wallet page reads on each EVM chain, beside the
// chain's native coin. The page says exactly these, and says that any other
// token the address holds is not read. It is a short list on purpose: a token
// list long enough to look complete would invite reading it as complete.
//
// Every address below was read on its own chain on 2026-09-25 by calling
// symbol(), name() and decimals() (and totalSupply(), to check it is a token
// in wide use rather than a namesake):
//
//   BNB Chain, block 123,932,916
//     USDT  Tether USD                   18 decimals
//     USDC  USD Coin                     18
//     USD1  World Liberty Financial USD  18
//     U     United Stables               18  (this project's $U settlement token)
//   Arbitrum One, block 508,734,602
//     USDC  USD Coin (Circle native)      6
//     USD₮0 USD₮0                          6
//   Robinhood Chain, block 72,155,401
//     USDG  Global Dollar                  6
//     USDe  USDe                          18
//
// Left out on purpose: a USDC on Robinhood Chain (0x80e0...6ca8) whose whole
// supply was 341 tokens at that block. A token that small is not one of the
// chain's major stables, and listing it would suggest it is.
//
// Prices: none of these is priced here. A stablecoin's dollar value is a
// claim about its peg, and this project has no price source for them. The
// only price the page shows is BNB's: the on-chain BNB/USD average the backend
// reads from the PancakeSwap v3 WBNB/USDT pool, labelled as such beside it.

import { bsc, arbitrum, robinhood } from 'wagmi/chains';

export const EVM_CHAINS = [
  {
    chainId: bsc.id,
    name: 'BNB Chain',
    native: { symbol: 'BNB', decimals: 18 },
    tokens: [
      { symbol: 'USDT', name: 'Tether USD', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      { symbol: 'USDC', name: 'USD Coin', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
      { symbol: 'USD1', name: 'World Liberty Financial USD', address: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d', decimals: 18 },
      { symbol: 'U', name: 'United Stables', address: '0xcE24439F2D9C6a2289F741120FE202248B666666', decimals: 18 },
    ],
  },
  {
    chainId: arbitrum.id,
    name: 'Arbitrum',
    native: { symbol: 'ETH', decimals: 18 },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
      { symbol: 'USD₮0', name: 'USD₮0', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    ],
  },
  {
    chainId: robinhood.id,
    name: 'Robinhood Chain',
    native: { symbol: 'ETH', decimals: 18 },
    tokens: [
      { symbol: 'USDG', name: 'Global Dollar', address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', decimals: 6 },
      { symbol: 'USDe', name: 'USDe', address: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', decimals: 18 },
    ],
  },
];

/** "BNB, USDT, USDC, USD1 and U" for one chain, for the coverage sentence. */
export function coverageList(chain) {
  const names = [chain.native.symbol, ...chain.tokens.map((t) => t.symbol)];
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
}
