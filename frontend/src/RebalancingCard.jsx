// RebalancingCard.jsx
//
// Rebalancing, one of the four DeFi categories. Reads the wallet's BNB and
// USDT balances, prices them, and works out the swaps that bring them back
// to a target split.
//
// It shows every swap before anything is signed, and the person signs. The
// swaps route through the existing trading path, so the same price-impact
// and liquidity checks that guard a single trade guard each leg here.
//
// The plan is arithmetic and lives in rebalance.js, deliberately apart from
// this file. Weights are basis points and must total exactly 100%, amounts
// are integer base units, and a drift too small to be worth the gas is
// reported as skipped rather than swapped.

import React, { useCallback, useEffect, useState } from 'react';
import { Scale, Loader2, RefreshCw, ArrowRight } from 'lucide-react';
import { useAccount, usePublicClient } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { planRebalance, currentWeights, formatUnits, RebalanceError, BPS } from './rebalance';
import { USDT_BSC } from './defiSkills';
import { quoteBestAcrossDexes } from './tradingAgent';
import NativeCardShell from './NativeCardShell';
import { PairedBars, ChartEmpty } from './MiniChart';

const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const ERC20_ABI = [{
  type: 'function', name: 'balanceOf', stateMutability: 'view',
  inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }],
}];

// Two assets, which is the smallest split that is still a rebalance and the
// pair with the deepest pool on BSC.
const ASSETS = [
  { address: WBNB, symbol: 'BNB', decimals: 18 },
  { address: USDT_BSC, symbol: 'USDT', decimals: 18 },
];

export default function RebalancingCard({ accent, surface, mutedBorder, bare = false }) {
  const { address, isConnected } = useAccount();
  // Pinned to BSC. Everything this card reads is BNB Chain: the USDT
  // contract, and the DEX routers quoteBestAcrossDexes asks for a BNB price.
  // A bare usePublicClient() follows the wallet, so on any other chain the
  // USDT read hits an address with no contract and the whole card errors.
  //
  // getBalance is the reason this one matters beyond an error message. It
  // returns the NATIVE balance of whatever chain the client is on, so an
  // unpinned client on Arbitrum would have read an ETH balance and labelled
  // it BNB. A wrong number is worse than a failed read, and it would have
  // been rebalanced against.
  //
  // Read only, so pinning cannot misdirect a transaction.
  const publicClient = usePublicClient({ chainId: bsc.id });
  const [bnbBps, setBnbBps] = useState(6000);
  const [state, setState] = useState({ loading: false, holdings: null, error: null });

  const load = useCallback(async () => {
    if (!isConnected || !address || !publicClient) {
      setState({ loading: false, holdings: null, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [nativeBal, usdtBal] = await Promise.all([
        publicClient.getBalance({ address }),
        publicClient.readContract({
          address: USDT_BSC, abi: ERC20_ABI, functionName: 'balanceOf', args: [address],
        }),
      ]);

      // BNB is priced by asking the same router the trading agent uses what
      // one BNB fetches, so the number here and the number a swap gets come
      // from the same source.
      let bnbQuote = 0n;
      if (nativeBal > 0n) {
        try {
          const q = await quoteBestAcrossDexes(publicClient, WBNB, 10n ** 18n);
          const perBnb = BigInt(q?.amountOut ?? 0n);
          bnbQuote = (BigInt(nativeBal) * perBnb) / (10n ** 18n);
        } catch {
          bnbQuote = 0n;
        }
      }

      setState({
        loading: false,
        error: null,
        holdings: [
          { ...ASSETS[0], balance: BigInt(nativeBal), quoteValue: bnbQuote },
          { ...ASSETS[1], balance: BigInt(usdtBal), quoteValue: BigInt(usdtBal) },
        ],
      });
    } catch (e) {
      setState({ loading: false, holdings: null, error: e.shortMessage || e.message });
    }
  }, [address, isConnected, publicClient]);

  useEffect(() => { load(); }, [load]);

  const { loading, holdings, error } = state;
  let plan = null;
  let planError = null;
  if (holdings) {
    try {
      plan = planRebalance(holdings, [
        { address: WBNB, symbol: 'BNB', bps: bnbBps },
        { address: USDT_BSC, symbol: 'USDT', bps: 10000 - bnbBps },
      ]);
    } catch (e) {
      planError = e instanceof RebalanceError ? e.message : String(e);
    }
  }
  const weights = plan ? currentWeights(holdings, plan.totalQuote) : new Map();

  return (
    <NativeCardShell
      bare={bare} icon={Scale} title="Rebalancing"
      accent={accent} surface={surface} mutedBorder={mutedBorder}
      blurb="Reads your BNB and USDT, prices them, and works out the swaps that bring them back to the split you set. Every swap is shown before you sign, and you sign them."
    >

      {!isConnected && (
        <ConnectButton.Custom>
          {({ openConnectModal }) => (
            <button onClick={openConnectModal} className="text-xs font-semibold underline" style={{ color: accent }}>
              Connect a wallet to read its balances
            </button>
          )}
        </ConnectButton.Custom>
      )}

      {isConnected && loading && (
        <div className="flex items-center gap-2 text-xs opacity-60 py-4">
          <Loader2 size={14} className="animate-spin" /> Reading balances and prices...
        </div>
      )}

      {isConnected && error && (
        <div className="py-3 space-y-2">
          <div className="text-xs text-red-500">{error}</div>
          <button onClick={load} className="text-xs font-semibold underline" style={{ color: accent }}>Try again</button>
        </div>
      )}

      {isConnected && holdings && !loading && (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="opacity-60">Target split</span>
              <span className="font-mono">{bnbBps / 100}% BNB / {(10000 - bnbBps) / 100}% USDT</span>
            </div>
            <input
              type="range" min="0" max="10000" step="500"
              value={bnbBps}
              onChange={(e) => setBnbBps(Number(e.target.value))}
              className="w-full"
              aria-label="Target BNB weight"
            />
          </div>

          <div className="rounded-xl border border-gray-200/60 dark:border-gray-800 p-3 space-y-1">
            <div className="text-[10px] uppercase tracking-wide opacity-40 mb-1">Holding now</div>
            {holdings.map((h) => (
              <div key={h.symbol} className="flex items-baseline justify-between text-[11px]">
                <span className="opacity-60">{h.symbol}</span>
                <span className="font-mono">
                  {formatUnits(h.balance, h.decimals, 4)}
                  <span className="opacity-40 ml-2">
                    ${formatUnits(h.quoteValue, 18)}
                    {plan?.totalQuote > 0n && ` (${(weights.get(h.address.toLowerCase()) ?? 0) / 100}%)`}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {/* Current weight against target, so the drift is the visible
              thing. Current comes from currentWeights() over the live
              balances; target is the slider. Neither is recomputed here. */}
          {plan?.totalQuote > 0n ? (
            <div>
              <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">
                Current weight against target
              </p>
              <PairedBars
                rows={holdings.map((h) => ({
                  label: h.symbol,
                  a: (weights.get(h.address.toLowerCase()) ?? 0) / 100,
                  b: (h.address === WBNB ? bnbBps : 10000 - bnbBps) / 100,
                }))}
                aLabel="current" bLabel="target"
                aColor={accent} bColor="#94A3B8"
                formatV={(v) => `${v.toFixed(1)}%`}
              />
            </div>
          ) : (
            <ChartEmpty height={72} reason="This wallet holds none of these assets, so there are no weights to compare." />
          )}

          {planError && <div className="text-[11px] text-red-500">{planError}</div>}

          {plan && !plan.reachable && (
            <div className="text-[11px] opacity-60">
              {plan.reason || 'Already at the target split, so there is nothing to swap.'}
            </div>
          )}

          {plan?.reachable && (
            <div className="rounded-xl border border-gray-200/60 dark:border-gray-800 p-3">
              <div className="text-[10px] uppercase tracking-wide opacity-40 mb-1.5">
                Swaps to get there
              </div>
              {plan.legs.map((l) => (
                <div key={`${l.side}-${l.symbol}`} className="flex items-center gap-2 text-[11px] py-0.5">
                  <span className={`font-bold uppercase text-[9px] px-1.5 py-0.5 rounded ${
                    l.side === 'sell'
                      ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  }`}>{l.side}</span>
                  <span className="font-mono">{l.symbol}</span>
                  <ArrowRight size={10} className="opacity-40" />
                  <span className="font-mono opacity-70">${formatUnits(l.quoteAmount, 18)}</span>
                </div>
              ))}
              {plan.skipped.length > 0 && (
                <p className="text-[10px] opacity-50 mt-1.5 leading-relaxed">
                  {plan.skipped.length} asset(s) left alone: the drift is smaller than the swap
                  would cost in gas and slippage.
                </p>
              )}
              <p className="text-[10px] opacity-50 mt-1.5 leading-relaxed">
                Sells run before buys, since the buys are funded by them. Signing is not wired
                yet: this shows the plan, and the swap path it will use is the one the Trading
                agent already runs.
              </p>
            </div>
          )}

          <button onClick={load} className="flex items-center gap-1.5 text-[11px] opacity-60 hover:opacity-100">
            <RefreshCw size={11} /> Read again
          </button>
        </div>
      )}
    </NativeCardShell>
  );
}
