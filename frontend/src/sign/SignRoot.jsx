// sign/SignRoot.jsx
//
// The providers for a page load that opens a signing link (/sign/<id>),
// used by main.jsx IN PLACE OF the site's: wagmi with the signing page's own
// config (signWagmi.js, the six buy chains), React Query and RainbowKit.
//
// In place of, not inside. Nested inside the site's providers, a second
// WagmiProvider with a different config sent RainbowKit's connect modal into
// an endless re-render (React error 185) as soon as the browser had an
// EIP-6963 wallet announcing itself, found in the headless run of
// 2026-09-29. One wagmi config per page load avoids that, and leaves every
// other page load with the site's config exactly as it is.
//
// There is no SignInProvider here: nothing on the signing page reads the
// site's sign-in, and it must not clear or write the site's sign-in proofs
// for a wallet connected only to sign one order.
//
// Moving between a signing link and a site page inside one page load
// reloads the page (App.jsx, AppRoutes), so each tree only ever draws its
// own pages.

import React from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import ThemedRainbowKit from '../theme/ThemedRainbowKit';
import { signWagmiConfig } from './signWagmi';

export default function SignRoot({ queryClient, children }) {
  return (
    <WagmiProvider config={signWagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ThemedRainbowKit>{children}</ThemedRainbowKit>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
