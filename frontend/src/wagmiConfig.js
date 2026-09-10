import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http, fallback } from 'viem';
import { bsc, arbitrum, robinhood } from 'wagmi/chains';
import { getBscTransport } from './rpcTransport';

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

export const wagmiConfig = getDefaultConfig({
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
      http('https://arb1.arbitrum.io/rpc'),
      http('https://arbitrum.drpc.org'),
    ], { rank: false }),
    [robinhood.id]: fallback([
      http('https://rpc.mainnet.chain.robinhood.com'),
      http('https://robinhood-rpc.publicnode.com'),
    ], { rank: false }),
  },
  ssr: false,
});
