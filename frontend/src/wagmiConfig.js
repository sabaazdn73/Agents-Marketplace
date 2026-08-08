import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { bsc, bscTestnet } from 'wagmi/chains';

// Adapted from OnChain Oversight's wagmiConfig.js: same wagmi/RainbowKit
// pattern, only the `chains` array changes. Get a free WalletConnect
// Project ID at https://cloud.walletconnect.com before running this.
//
// Defaults to bscTestnet first (per this project's security rules:
// testnet until explicitly told otherwise), bsc (mainnet) is listed
// so it's available once the project is ready to move there.

export const wagmiConfig = getDefaultConfig({
  appName: 'F2F Agents',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  chains: [bscTestnet, bsc],
  ssr: false,
});
