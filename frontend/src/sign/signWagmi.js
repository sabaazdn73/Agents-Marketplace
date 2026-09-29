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
import { http, fallback, createPublicClient } from 'viem';
import { bsc, arbitrum, robinhood, base, hyperEvm } from 'wagmi/chains';
import { getBscTransport } from '../rpcTransport';
import {
  mainnetNoEns, tolerantLocalStorage, ARBITRUM_RPCS, ROBINHOOD_RPCS, ETHEREUM_RPCS, HYPEREVM_RPCS,
} from '../wagmiConfig';
import { BUY_CHAINS } from '../trade/chains';

const CHAINS = [mainnetNoEns, base, arbitrum, bsc, robinhood, hyperEvm];

// A chain added to BUY_CHAINS without a line here would let an order name a
// chain the wallet cannot be switched to; the page refuses such an order.
export const SIGN_CHAIN_IDS = CHAINS.map((c) => c.id).filter((id) => Object.prototype.hasOwnProperty.call(BUY_CHAINS, id));

// BASE, WITH MORE THAN TWO ENDPOINTS. mainnet.base.org answers 429 ("rate
// limited") under load, and the signing page reads Base more than any other
// page (decimals, balance, allowance, the allowance again after an
// approval). Each endpoint below answered eth_blockNumber and eth_call from
// a browser page on https://www.tnega.app, with CORS, on 2026-09-29
// (scratchpad check base_rpcs.py). Not kept: base.llamarpc.com (no CORS
// answer) and base.meowrpc.com (429 on eth_call at the time).
// The site's own config (wagmiConfig.js) reads Base only while its Buy switch
// is on, which it is not, so it is left as it is.
export const SIGN_BASE_RPCS = [
  'https://mainnet.base.org',
  'https://base-rpc.publicnode.com',
  'https://base.drpc.org',
  'https://1rpc.io/base',
  'https://base-mainnet.public.blastapi.io',
];

// Each endpoint is asked once (retryCount 0 on the http transport); a 429 or
// a failure moves the request to the next endpoint in order. When every
// endpoint has failed, the whole list is tried again, up to 3 more times,
// waiting 500 ms, 1 s, then 2 s (viem's fallback backs off exponentially
// from retryDelay). In order, not ranked: the first endpoint is tried first
// and the others only see traffic when it fails.
const many = (urls) => fallback(urls.map((u) => http(u, { retryCount: 0 })), { rank: false, retryCount: 3, retryDelay: 500 });

// A second opinion: a read client for one chain whose endpoint list starts
// at the SECOND endpoint (the first goes last), so a value the usual first
// endpoint answered is checked against another. BNB Chain keeps its one
// transport (rpcTransport.js); there the second read goes the same way.
const RPC_LISTS = {
  [mainnetNoEns.id]: ETHEREUM_RPCS, [base.id]: SIGN_BASE_RPCS, [arbitrum.id]: ARBITRUM_RPCS,
  [robinhood.id]: ROBINHOOD_RPCS, [hyperEvm.id]: HYPEREVM_RPCS,
};
export function secondOpinionClient(chainId) {
  const chain = CHAINS.find((c) => c.id === chainId);
  if (!chain) return null;
  const urls = RPC_LISTS[chainId];
  const transport = urls && urls.length > 1 ? many([...urls.slice(1), urls[0]]) : chainId === bsc.id ? getBscTransport() : many(urls || []);
  return createPublicClient({ chain, transport });
}

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
