// sign/signWagmi.js
//
// The signing page's own wagmi config: the six chains an order can be on
// (trade/chains.js BUY_CHAINS), and nothing else. Created when the signing
// page's code loads, which happens only on /sign/<id> (App.jsx loads it
// lazily), so every other page keeps the site's config (wagmiConfig.js)
// exactly as it is, with its Buy switch off.
//
// The same public endpoints the site's config names for each chain, read
// from wagmiConfig.js so the two cannot drift. Ethereum is configured without
// its ENS resolver (mainnetNoEns): RainbowKit would otherwise look up the
// connected address's ENS name on Ethereum at every connect.
//
// Its own storage key, so a wallet connected here and one connected on the
// rest of the site are remembered separately and neither reconnects the
// other.

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { createStorage } from 'wagmi';
import { http } from 'viem';
import { bsc, arbitrum, robinhood, base, hyperEvm } from 'wagmi/chains';
import { getBscTransport } from '../rpcTransport';
import {
  mainnetNoEns, tolerantLocalStorage, ARBITRUM_RPCS, ROBINHOOD_RPCS, ETHEREUM_RPCS, HYPEREVM_RPCS,
  BASE_READ_RPCS, manyTransport, secondOpinionClient,
} from '../wagmiConfig';
import { BUY_CHAINS } from '../trade/chains';

const CHAINS = [mainnetNoEns, base, arbitrum, bsc, robinhood, hyperEvm];

// A chain added to BUY_CHAINS without a line here would let an order name a
// chain the wallet cannot be switched to; the page refuses such an order.
export const SIGN_CHAIN_IDS = CHAINS.map((c) => c.id).filter((id) => Object.prototype.hasOwnProperty.call(BUY_CHAINS, id));

// Base's endpoint list (five, in order), the fallback transport and the
// second-opinion read client are the site's own (wagmiConfig.js), shared so
// the signing page and the stock page's Buy and Sell tabs read Base the same
// way.
export const SIGN_BASE_RPCS = BASE_READ_RPCS;
const many = manyTransport;
export { secondOpinionClient };

export const signWagmiConfig = getDefaultConfig({
  storage: createStorage({ storage: tolerantLocalStorage(), key: 'tnega-sign' }),
  appName: 'Tnega',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  chains: CHAINS,
  transports: {
    [mainnetNoEns.id]: many(ETHEREUM_RPCS),
    [base.id]: many(SIGN_BASE_RPCS),
    [arbitrum.id]: many(ARBITRUM_RPCS),
    [bsc.id]: getBscTransport(),
    [robinhood.id]: many(ROBINHOOD_RPCS),
    [hyperEvm.id]: http(HYPEREVM_RPCS[0]),
  },
  ssr: false,
});
