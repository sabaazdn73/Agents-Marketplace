import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'viem';
import { bsc } from 'wagmi/chains';

// Adapted from OnChain Oversight's wagmiConfig.js: same wagmi/RainbowKit
// pattern, only the `chains` array changes. Get a free WalletConnect
// Project ID at https://cloud.walletconnect.com before running this.
//
// This project is MAINNET-ONLY: BSC mainnet (chain 56) is the only
// configured chain. Testnet is no longer used anywhere.

// Bug found and fixed 2026-08-29, investigating a real, live incident: a
// direct-wallet Venus Lending run failed with viem's own "Timed out while
// waiting for transaction... to be confirmed" — traced back to this
// config never setting an explicit `transports` option. Without one,
// getDefaultConfig falls back to wagmi/viem's own built-in default RPC
// for BSC (a heavily-shared public endpoint) for every real READ this
// app does through a connected wallet — balance checks, allowance
// checks, and critically waitForTransactionReceipt's own real polling —
// completely independent of the wallet extension's own broadcast path.
// This is the exact same real class of bug already found and fixed on
// the backend (core/rpc.py, 2026-08-27): a real fallback silently
// defaulting to the slow, rate-limited public node instead of the same
// real, already-proven bloXroute gateway altana.js's own
// _mainnetPublicClient has used all along. Same real fix here: point
// every configured chain's real reads at the same real endpoint, with
// the same real VITE_MAINNET_READ_RPC override support.
const MAINNET_READ_RPC = import.meta.env?.VITE_MAINNET_READ_RPC || 'https://bsc.rpc.blxrbdn.com';

export const wagmiConfig = getDefaultConfig({
  appName: 'Tnega',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  chains: [bsc],
  transports: { [bsc.id]: http(MAINNET_READ_RPC) },
  ssr: false,
});
