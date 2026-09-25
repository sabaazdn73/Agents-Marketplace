import React from 'react';
import ReactDOM from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, lightTheme, darkTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

import { installApiRetry } from './apiRetry';
import { wagmiConfig } from './wagmiConfig';
import App from './App';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';
import { SignInProvider } from './wallet/SignInProvider';
import './index.css';

// Installed before anything renders, so every backend call in the app is
// covered rather than only the ones that were remembered. GET/HEAD only --
// see apiRetry.js for why writes are deliberately excluded.
installApiRetry(import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000');

const queryClient = new QueryClient();

// The wallet modal follows the site theme. Its accent is the --accent role,
// written out because RainbowKit takes a colour string, not a CSS variable.
function ThemedRainbowKit({ children }) {
  const { dark } = useTheme();
  const theme = dark
    ? darkTheme({ accentColor: 'rgb(150, 160, 252)', accentColorForeground: 'rgb(12, 5, 30)', borderRadius: 'small' })
    : lightTheme({ accentColor: 'rgb(79, 70, 229)', accentColorForeground: 'white', borderRadius: 'small' });
  return <RainbowKitProvider theme={theme}>{children}</RainbowKitProvider>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Outermost, so every provider and page below it, including the
        wallet modal and the standalone routes, reads one theme. */}
    <ThemeProvider>
    {/* One wallet path: wagmi with RainbowKit's connect modal, for a wallet
        the visitor already has. There is no login provider; see
        docs/deferred.md for what was considered and why it is not built.

        reconnectOnMount is wagmi's default: a previously connected wallet
        is restored after a reload with no extra code here.

        SignInProvider sits inside wagmi and RainbowKit because it reads the
        connected account and opens RainbowKit's connect modal. */}
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <ThemedRainbowKit>
            <SignInProvider>
              <App />
            </SignInProvider>
          </ThemedRainbowKit>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  </React.StrictMode>
);
