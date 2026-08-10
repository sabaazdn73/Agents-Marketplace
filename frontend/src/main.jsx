import React from 'react';
import ReactDOM from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { PrivyProvider } from '@privy-io/react-auth';
import { bsc } from 'wagmi/chains';
import '@rainbow-me/rainbowkit/styles.css';

import { wagmiConfig } from './wagmiConfig';
import App from './App';
import './index.css';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Two independent providers for the hybrid wallet flow:
        - PrivyProvider: Face ID / email login, creates an embedded wallet
        - WagmiProvider + RainbowKitProvider: direct wallet-connect for
          crypto-native users (MetaMask, Trust Wallet, WalletConnect)
        Both target the same chain (bsc mainnet — this project is
        mainnet-only), a user picks ONE path per session via the connect
        modal, they aren't stacked. */}
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'passkey'],
        defaultChain: bsc,
        supportedChains: [bsc],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
      }}
    >
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider>
            <App />
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </PrivyProvider>
  </React.StrictMode>
);
