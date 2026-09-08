import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { bsc } from 'wagmi/chains';
import { getBscTransport } from './rpcTransport';

// Adapted from OnChain Oversight's wagmiConfig.js: same wagmi/RainbowKit
// pattern, only the `chains` array changes. Get a free WalletConnect
// Project ID at https://cloud.walletconnect.com before running this.
//
// This project is MAINNET-ONLY: BSC mainnet (chain 56) is the only
// configured chain. Testnet is no longer used anywhere.

// Bug found and fixed 2026-08-29, investigating a real, live incident: a
// direct-wallet Venus Lending run failed with viem's own "Timed out while
// waiting for transaction... to be confirmed", traced back to this
// config never setting an explicit `transports` option. Without one,
// getDefaultConfig falls back to wagmi/viem's own built-in default RPC
// for BSC (a heavily-shared public endpoint) for every READ this
// app does through a connected wallet, balance checks, allowance
// checks, and critically waitForTransactionReceipt's own polling,
// completely independent of the wallet extension's own broadcast path.
// This is the exact same class of bug already found and fixed on
// the backend (core/rpc.py, 2026-08-27): a fallback silently
// defaulting to the slow, rate-limited public node instead of the same
// real, already-proven bloXroute gateway altana.js's own
// _mainnetPublicClient has used all along. Same fix here: point
// every configured chain's reads at the same endpoint.
//
// reliability upgrade (2026-09-04): that single bloXroute transport
// is now itself the same shared, bloXroute-primary/Infura-backup fallback
// transport altana.js uses, see rpcTransport.js for the failover
// logic and why this exists.

export const wagmiConfig = getDefaultConfig({
  appName: 'Tnega',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  chains: [bsc],
  transports: { [bsc.id]: getBscTransport() },
  ssr: false,
});
