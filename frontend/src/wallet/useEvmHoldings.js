// useEvmHoldings.js
//
// The connected address's native balance and the named tokens in evmTokens.js,
// read in the browser from each chain's public RPC provider through the
// site's existing wagmi clients (one multicall per chain for the tokens). No
// request goes to our server. The address reaches the RPC providers named in
// wagmiConfig.js, inside the request body, which docs/data-handling.md and the
// privacy page state.
//
// Each chain is read and reported on its own: a chain whose provider does not
// answer shows that sentence, and the others still show their balances.

import { useCallback, useEffect, useRef, useState } from 'react';
import { erc20Abi } from 'viem';
import { getPublicClient } from 'wagmi/actions';
import { wagmiConfig } from '../wagmiConfig';
import { EVM_CHAINS } from './evmTokens';

async function readChain(chain, address) {
  const client = getPublicClient(wagmiConfig, { chainId: chain.chainId });
  if (!client) throw new Error('no client');
  const [blockNumber, native, tokenResults] = await Promise.all([
    client.getBlockNumber(),
    client.getBalance({ address }),
    client.multicall({
      allowFailure: true,
      contracts: chain.tokens.map((t) => ({
        address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [address],
      })),
    }),
  ]);
  return {
    blockNumber,
    native: { ...chain.native, raw: native },
    tokens: chain.tokens.map((t, i) => {
      const r = tokenResults[i];
      return r && r.status === 'success'
        ? { ...t, raw: r.result, ok: true }
        : { ...t, raw: null, ok: false };
    }),
  };
}

// ONE ADDRESS'S ANSWERS, NEVER ANOTHER'S (fixed 2026-09-25, from review)
// The first version wrote each chain's answer keyed by chain id alone, so a
// read still in flight for the previous address could land after an account
// switch and put the old wallet's balances under the new one. Now every write
// carries the address it was read for and the read it belongs to, and a write
// for anything but the current address and the latest read is dropped. The
// same guard useHabits.js uses (forKey).
export function useEvmHoldings(address) {
  const key = (address || '').toLowerCase();
  const [state, setState] = useState({ forKey: key, gen: 0, byChain: {}, readAt: null });
  const current = useRef({ key, gen: 0 });

  const load = useCallback(() => {
    const gen = current.current.gen + 1;
    current.current = { key, gen };
    if (!key) { setState({ forKey: key, gen, byChain: {}, readAt: null }); return; }
    setState({
      forKey: key,
      gen,
      byChain: Object.fromEntries(EVM_CHAINS.map((c) => [c.chainId, { status: 'loading' }])),
      readAt: new Date(),
    });
    const put = (chainId, entry) => {
      if (current.current.key !== key || current.current.gen !== gen) return;
      setState((s) => (s.forKey === key && s.gen === gen
        ? { ...s, byChain: { ...s.byChain, [chainId]: { ...entry, forKey: key } } }
        : s));
    };
    EVM_CHAINS.forEach((chain) => {
      readChain(chain, address)
        .then((data) => put(chain.chainId, { status: 'ok', ...data }))
        .catch(() => put(chain.chainId, { status: 'error' }));
    });
  }, [key, address]);

  useEffect(() => { load(); }, [load]);

  // Between an account switch and the new read starting, nothing is shown
  // rather than the previous address's balances.
  const shown = state.forKey === key ? state : { byChain: {}, readAt: null };
  return { byChain: shown.byChain, readAt: shown.readAt, refresh: load };
}
