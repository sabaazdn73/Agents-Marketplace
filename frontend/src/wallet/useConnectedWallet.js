// useConnectedWallet.js
//
// The one answer to "which wallet is this visitor using". Everything that
// needs the connected address (the headers, the notification bell, My Agents,
// the sign-in state) reads it here rather than asking wagmi, or anything
// else, for itself.
//
// There used to be two sources: wagmi for a browser wallet, and Privy for an
// email or passkey account with a wallet Privy created. Each caller merged the
// two slightly differently. Privy is gone, so there is one source, and this
// hook is where a second one would have to be added if one ever came back.

import { useAccount } from 'wagmi';

export function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null;
}

export function useConnectedWallet() {
  const { address, isConnected, chainId, status } = useAccount();
  const connected = !!(isConnected && address);
  return {
    address: connected ? address : null,
    isConnected: connected,
    chainId: connected ? chainId : undefined,
    // wagmi's own status, for the brief 'reconnecting' state after a reload.
    status,
  };
}
