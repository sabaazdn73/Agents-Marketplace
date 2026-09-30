// wallet/connectChain.js
//
// The chain a wallet connects on, when a page asks for one. RainbowKit
// connects on its provider's `initialChain` if one is set; otherwise on the
// wallet's own chain if the site knows it, else on the first chain in the
// config (BNB Chain). Only the stock page's Buy and Sell tabs
// (trade/StockTrade.jsx) ask, for the chain the version is on, and only
// while the tab is on screen: everywhere else nothing is set, so connecting
// and signing in behave exactly as before.

import { useEffect, useSyncExternalStore } from 'react';

let current;
const listeners = new Set();
const set = (v) => { current = v; listeners.forEach((f) => f()); };
const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };

/** The chain asked for now, or undefined. Read by theme/ThemedRainbowKit.jsx. */
export function useConnectChain() {
  return useSyncExternalStore(subscribe, () => current, () => undefined);
}

/** Ask for `chainId` while the calling component is mounted. */
export function useAskConnectChain(chainId) {
  useEffect(() => {
    set(chainId);
    return () => { if (current === chainId) set(undefined); };
  }, [chainId]);
}
