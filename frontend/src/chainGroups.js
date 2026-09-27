// chainGroups.js
//
// Chains are grouped two ways and no more: EVM and non-EVM. There are no
// per-chain sections or tabs on the product pages (owner, 2026-09-25).
//
// HyperEVM (chain 999) is EVM. Non-EVM is Solana and HyperCore, Hyperliquid's
// own order-book chain. A numeric EVM chain id is EVM, and so is a chain named
// in EVM_NAMES. Anything else is 'unknown', not EVM by default: a chain this
// file has never heard of could be either, and filing it under EVM would put
// it in the wrong group without anyone deciding so.

export const CHAIN_GROUPS = [
  { id: 'evm', label: 'EVM', note: 'Ethereum-compatible chains, HyperEVM included' },
  { id: 'non-evm', label: 'Non-EVM', note: 'Solana and Hyperliquid (HyperCore)' },
];

const NON_EVM = new Set(['solana', 'hypercore', 'hyperliquid']);
const EVM_NAMES = new Set([
  'ethereum', 'bsc', 'bnb', 'bnb chain', 'arbitrum', 'base', 'optimism',
  'polygon', 'avalanche', 'hyperevm', 'robinhood', 'robinhood chain', 'monad',
]);

/** 'evm', 'non-evm' or 'unknown' for a chain id (a positive integer) or a
 *  chain name. */
export function chainGroup(chain) {
  if (typeof chain === 'number') return Number.isInteger(chain) && chain > 0 ? 'evm' : 'unknown';
  const name = String(chain ?? '').trim().toLowerCase();
  if (/^\d+$/.test(name) && Number(name) > 0) return 'evm';
  if (NON_EVM.has(name)) return 'non-evm';
  if (EVM_NAMES.has(name)) return 'evm';
  return 'unknown';
}
