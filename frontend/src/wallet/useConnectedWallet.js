// useConnectedWallet.js
//
// The one answer to "which wallet is this visitor using". Everything that
// needs the connected address (the headers, the notification bell, My Agents,
// the sign-in state) reads it here rather than asking wagmi, or anything
// else, for itself.
//
// There is one source, wagmi, for an EVM wallet the visitor already has. A
// wallet of another chain family (a Solana wallet, planned for phase 5) will
// be a separate hook, so this one's callers only ever receive an EVM address.

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
