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
        mainnet-only). They are NOT bridged via @privy-io/wagmi (that
        would need wagmiConfig.js rebuilt around Privy's own createConfig,
        a bigger change than this fix). Real bug found 2026-08-17: plain
        wagmi's WagmiProvider defaults reconnectOnMount to true, so on
        every mount it silently tries to reconnect/re-verify the
        previously-authorized injected connector AT THE SAME TIME Privy's
        own SDK is independently probing window.ethereum for its
        embeddedWallets.createOnLogin check — two uncoordinated systems
        touching the same injected provider is exactly what Privy's own
        docs (docs.privy.io/wallets/connectors/ethereum/integrations/wagmi)
        say their bridged WagmiProvider sets reconnectOnMount=false to
        avoid. Disabling it here (without the full bridge) removes that
        race: a returning user just clicks "Connect a wallet" again
        instead of it silently firing on mount. */}
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
      <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider>
            <App />
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </PrivyProvider>
  </React.StrictMode>
);
