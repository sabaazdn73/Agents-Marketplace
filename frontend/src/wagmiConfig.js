import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { bsc } from 'wagmi/chains';

// Adapted from OnChain Oversight's wagmiConfig.js: same wagmi/RainbowKit
// pattern, only the `chains` array changes. Get a free WalletConnect
// Project ID at https://cloud.walletconnect.com before running this.
//
// This project is MAINNET-ONLY: BSC mainnet (chain 56) is the only
// configured chain. Testnet is no longer used anywhere.

export const wagmiConfig = getDefaultConfig({
  appName: 'F2F Agents',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  chains: [bsc],
  ssr: false,
});
