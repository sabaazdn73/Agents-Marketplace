import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { createStorage } from 'wagmi';
import { http, fallback } from 'viem';
import { bsc, arbitrum, robinhood } from 'wagmi/chains';
import { getBscTransport, MAINNET_READ_RPC, HAS_BSC_BACKUP } from './rpcTransport';

// Adapted from OnChain Oversight's wagmiConfig.js: same wagmi/RainbowKit
// pattern, only the `chains` array changes. Get a free WalletConnect
// Project ID at https://cloud.walletconnect.com before running this.
//
// This project is MAINNET-ONLY. No testnet is configured anywhere, so no
// testnet value is reachable from a production path.
//
// Bug found and fixed 2026-09-10, from a real report: a user with Arbitrum
// already in MetaMask was told "your wallet doesn't know about Arbitrum yet".
// The chain list here was the cause, and the wallet was never asked.
//
// wagmi's connector does `config.chains.find(x => x.id === chainId)` BEFORE
// it calls the wallet, and throws if the chain is missing. With `chains:
// [bsc]`, a switch to 42161 failed inside our own app without a single
// request reaching MetaMask. What made it read as a wallet problem is that
// viem gives the SwitchChainError class a static `code = 4902`, the same code
// MetaMask uses for "this chain has not been added" -- so an app-side
// configuration error arrived wearing the wallet's error code.
//
// The lesson worth keeping: a chain must be listed here before any part of
// the app can switch to it. Adding a deployment to chainContracts.js is not
// enough on its own.

// Bug found and fixed 2026-08-29, investigating a real, live incident: a
// direct-wallet Venus Lending run failed with viem's own "Timed out while
// waiting for transaction... to be confirmed", traced back to this
// config never setting an explicit `transports` option. Without one,
// getDefaultConfig falls back to wagmi/viem's own built-in default RPC
// for BSC (a heavily-shared public endpoint) for every READ this
// app does through a connected wallet, balance checks, allowance
// checks, and critically waitForTransactionReceipt's own polling,
// completely independent of the wallet extension's own broadcast path.
// This is the exact same class of bug already found and fixed on
// the backend (core/rpc.py, 2026-08-27): a fallback silently
// defaulting to the slow, rate-limited public node instead of the same
// real, already-proven bloXroute gateway altana.js's own
// _mainnetPublicClient has used all along. Same fix here: point
// every configured chain's reads at the same endpoint.
//
// reliability upgrade (2026-09-04): that single bloXroute transport
// is now itself the same shared, bloXroute-primary/Infura-backup fallback
// transport altana.js uses, see rpcTransport.js for the failover
// logic and why this exists.

const ARBITRUM_RPCS = ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.drpc.org'];
const ROBINHOOD_RPCS = ['https://rpc.mainnet.chain.robinhood.com', 'https://robinhood-rpc.publicnode.com'];
const host = (url) => { try { return new URL(url).host; } catch { return url; } };

// Who receives a read on each chain, named for people rather than for code.
// Built from the same URLs the transports below use, so the name on screen
// cannot drift from where the request actually goes. Read by the sign-in
// modal, which has to say who checks a contract wallet's signature.
export const RPC_PROVIDER_NAMES = {
  [bsc.id]: `${host(MAINNET_READ_RPC).includes('blxrbdn') ? `bloXroute (${host(MAINNET_READ_RPC)})` : host(MAINNET_READ_RPC)}${HAS_BSC_BACKUP ? ', with Infura as a backup' : ''}`,
  [arbitrum.id]: `Arbitrum's public endpoint (${host(ARBITRUM_RPCS[0])}), with dRPC as a backup`,
  [robinhood.id]: `Robinhood Chain's public endpoint (${host(ROBINHOOD_RPCS[0])}), with PublicNode as a backup`,
};

// wagmi's storage, with the store's absence survived rather than thrown.
//
// wagmi's default storage reads window.localStorage when the config is
// created, which is at import, before anything renders. In a browser with site
// data blocked that read throws a SecurityError, and the whole site failed to
// mount: a blank page, for the visitor least likely to be tracked. Found
// 2026-09-25 by loading every route with localStorage throwing on access.
// Every touch of the store is now inside a try, and a blocked store behaves as
// an empty one: nothing is remembered between loads, and everything else works.
function tolerantLocalStorage() {
  let store = null;
  try {
    store = typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    store = null;
  }
  return {
    getItem: (key) => { try { return store ? store.getItem(key) : null; } catch { return null; } },
    setItem: (key, value) => { try { if (store) store.setItem(key, value); } catch { /* blocked or full */ } },
    removeItem: (key) => { try { if (store) store.removeItem(key); } catch { /* blocked */ } },
  };
}

export const wagmiConfig = getDefaultConfig({
  storage: createStorage({ storage: tolerantLocalStorage() }),
  appName: 'Tnega',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  // Every chain the app can switch to. bsc for hiring and Sell Your Agent,
  // arbitrum and robinhood because AgentBudgetEscrow is deployed on both and
  // a budget there has to be opened on that chain.
  chains: [bsc, arbitrum, robinhood],
  transports: {
    [bsc.id]: getBscTransport(),
    // These two get a plain single-URL transport rather than the shared
    // bloXroute/Infura fallback, which is BSC-specific. Arbitrum's public
    // endpoint is the one the backend already uses; Robinhood's is the only
    // one that answers, which core/rpc.py records in full.
    // Both get a fallback rather than a single URL. Reported live
    // 2026-09-10: a budget opened on Arbitrum showed "Timed out while
    // waiting for transaction to be confirmed" while the transaction had
    // been mined and the escrow was holding the funds. The transaction was
    // never the problem; polling the receipt on a rate-limited public
    // endpoint was. This is the same failure, and the same fix, as the
    // 2026-08-29 incident recorded above.
    //
    // In-order, not ranked: the primary is always tried first and the
    // backup only sees traffic when it genuinely fails.
    // The backup was CHOSEN by testing the thing that failed, not by
    // picking a name off a list. publicnode's Arbitrum endpoint tracks the
    // head correctly but returned no receipt for the very transaction this
    // incident was about, which makes it useless as a backup here. drpc was
    // at the same block height and did serve that receipt.
    [arbitrum.id]: fallback([
      http(ARBITRUM_RPCS[0]),
      http(ARBITRUM_RPCS[1]),
    ], { rank: false }),
    [robinhood.id]: fallback([
      http(ROBINHOOD_RPCS[0]),
      http(ROBINHOOD_RPCS[1]),
    ], { rank: false }),
  },
  ssr: false,
});
