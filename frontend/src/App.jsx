import React, { useState, useEffect } from 'react';
import { useReconnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import AgentMarketplaceApp from './AgentMarketplaceApp.web.jsx';
import AgentMarketplaceMobileApp from './AgentMarketplaceApp.mobile.jsx';

const MOBILE_BREAKPOINT = 768; // matches Tailwind's `md` breakpoint

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return isMobile;
}

// Real fix, 2026-08-18: WagmiProvider's reconnectOnMount is set to false
// (main.jsx) specifically to stop wagmi from touching window.ethereum at
// the same React-mount tick Privy's own SDK independently probes it — that
// simultaneous double-touch was the real cause of the double MetaMask
// prompt on connect (see main.jsx's comment for the full trace). But
// reconnectOnMount is ALSO the only thing that restores a previously-
// connected wagmi wallet after a page refresh, so turning it off entirely
// silently broke that persistence as a side effect — not a separate bug,
// the documented behavior of that flag.
//
// Real fix: don't leave it off. Trigger the same reconnect manually, once,
// but sequenced to run only after Privy's own `ready` has settled instead
// of at the same mount tick RainbowKit fires it automatically — same end
// result (the wallet comes back after a refresh), the two systems just
// never touch window.ethereum in the same instant. wagmi's reconnect()
// uses eth_accounts for an injected connector (a silent, non-prompting
// read of already-authorized accounts, not eth_requestAccounts), so
// staggering it doesn't introduce a prompt of its own to worry about.
function useStaggeredWalletReconnect() {
  const { ready } = usePrivy();
  const { reconnect } = useReconnect();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!ready || done) return;
    setDone(true);
    reconnect();
  }, [ready, done, reconnect]);
}

export default function App() {
  const isMobile = useIsMobile();
  useStaggeredWalletReconnect();
  // Genuinely different components, not one component with responsive
  // CSS, per the earlier design requirement (mobile is its own
  // information architecture, not a shrunk desktop grid).
  return isMobile ? <AgentMarketplaceMobileApp /> : <AgentMarketplaceApp />;
}

