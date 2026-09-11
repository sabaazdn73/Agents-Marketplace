// GridTradingCard.jsx
//
// Grid Trading, the fourth DeFi category. You set a price range, a number of
// levels and a size per level, see every order that will be placed, and sign
// once. The orders go on chain as PancakeSwap V3 range orders.
//
// One signature rather than N is the whole point, and it comes from the
// EIP-5792 path this app already uses for hiring. A wallet that cannot batch
// still works: the same calls are signed one after another, which is more
// signatures and the same result. That fallback is stated on the card rather
// than discovered at signing time.
//
// The maths lives in gridTrading.js, deliberately apart from this file, and
// is verified against the live pool. See that file for why the tick
// direction is inverted on this pair.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Grid3x3, Loader2, RefreshCw, ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAccount, usePublicClient, useConfig } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { getCapabilities, sendCalls, waitForCallsStatus, writeContract, waitForTransactionReceipt } from 'wagmi/actions';
import { bsc } from 'wagmi/chains';
import NativeCardShell from './NativeCardShell';
import { MarkerAxis, ChartLegend } from './MiniChart';
import {
  WBNB_USDT_POOL, POOL_ABI, POSITION_MANAGER, TOKEN0, TOKEN1, ERC20_ABI,
  buildGrid, buildGridCalls, tickToBnbPrice, formatUnits, parseUnits,
  GridError, MIN_LEVELS, MAX_LEVELS,
} from './gridTrading';

const RECEIPT_TIMEOUT_MS = 180_000;

function Field({ label, value, onChange, suffix, disabled }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider opacity-50">{label}</span>
      <div className="flex items-center gap-1 mt-0.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          inputMode="decimal"
          className="w-full bg-transparent border rounded-lg px-2 py-1.5 text-xs font-mono border-gray-300/40 dark:border-gray-700/60 focus:outline-none focus:border-indigo-400 disabled:opacity-40"
        />
        {suffix && <span className="text-[10px] opacity-50 shrink-0">{suffix}</span>}
      </div>
    </label>
  );
}

export default function GridTradingCard({ accent, surface, mutedBorder, bare = false }) {
  const { address, isConnected } = useAccount();
  // Pinned to BSC, matching the writes below.
  //
  // The pool, the position manager and both tokens are PancakeSwap V3 on BNB
  // Chain. sendCalls and writeContract already pass chainId: bsc.id, so the
  // transactions were always going to BSC while a bare usePublicClient() read
  // whatever chain the wallet was on. That split is the bad state: the pool
  // read fails on the wrong chain, so the card shows a broken price while the
  // buttons underneath would still have transacted correctly on BSC.
  //
  // Reading and writing now name the same chain in the same file.
  const publicClient = usePublicClient({ chainId: bsc.id });
  const config = useConfig();

  const [pool, setPool] = useState({ loading: false, tick: null, error: null });
  const [canBatch, setCanBatch] = useState(null);
  const [allowances, setAllowances] = useState({ usdt: 0n, wbnb: 0n });

  const [low, setLow] = useState('650');
  const [high, setHigh] = useState('850');
  const [levels, setLevels] = useState('6');
  const [buySize, setBuySize] = useState('25');
  const [sellSize, setSellSize] = useState('0.03');

  const [submit, setSubmit] = useState({ busy: false, error: null, done: null });

  // One read of the pool, held. Re-runs only when the wallet's client
  // changes, never because a panel opened or closed.
  const loadPool = useCallback(async () => {
    if (!publicClient) return;
    setPool((s) => ({ ...s, loading: true, error: null }));
    try {
      const slot0 = await publicClient.readContract({
        address: WBNB_USDT_POOL, abi: POOL_ABI, functionName: 'slot0',
      });
      setPool({ loading: false, tick: Number(slot0[1]), error: null });
    } catch (e) {
      setPool({ loading: false, tick: null, error: e.shortMessage || e.message });
    }
  }, [publicClient]);

  useEffect(() => { loadPool(); }, [loadPool]);

  useEffect(() => {
    if (!isConnected || !address || !publicClient) { setAllowances({ usdt: 0n, wbnb: 0n }); return; }
    let cancelled = false;
    (async () => {
      try {
        const [u, w] = await Promise.all([
          publicClient.readContract({ address: TOKEN0.address, abi: ERC20_ABI, functionName: 'allowance', args: [address, POSITION_MANAGER] }),
          publicClient.readContract({ address: TOKEN1.address, abi: ERC20_ABI, functionName: 'allowance', args: [address, POSITION_MANAGER] }),
        ]);
        if (!cancelled) setAllowances({ usdt: BigInt(u), wbnb: BigInt(w) });
      } catch { /* an allowance read failing just means both approvals are offered */ }
    })();
    return () => { cancelled = true; };
  }, [address, isConnected, publicClient]);

  // Same capability check the hire flow uses, and the same honest fallback:
  // anything other than an explicit yes counts as no.
  useEffect(() => {
    if (!isConnected || !address) { setCanBatch(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const caps = await getCapabilities(config, { account: address, chainId: bsc.id });
        const s = caps?.atomic?.status;
        if (!cancelled) setCanBatch(s === 'supported' || s === 'ready');
      } catch {
        if (!cancelled) setCanBatch(false);
      }
    })();
    return () => { cancelled = true; };
  }, [address, isConnected, config]);

  const plan = useMemo(() => {
    if (pool.tick == null) return null;
    try {
      const g = buildGrid({
        lowPrice: Number(low), highPrice: Number(high), levels: Number(levels),
        currentTick: pool.tick,
        usdtPerBuy: parseUnits(buySize || '0', TOKEN0.decimals),
        wbnbPerSell: parseUnits(sellSize || '0', TOKEN1.decimals),
      });
      return { ok: true, ...g };
    } catch (e) {
      return { ok: false, error: e instanceof GridError ? e.message : String(e) };
    }
  }, [low, high, levels, buySize, sellSize, pool.tick]);

  const place = useCallback(async () => {
    if (!plan?.ok || !address) return;
    setSubmit({ busy: true, error: null, done: null });
    try {
      const calls = buildGridCalls({
        orders: plan.orders, totals: plan.totals, recipient: address, allowances,
      });
      if (canBatch) {
        const { id } = await sendCalls(config, { chainId: bsc.id, calls });
        const res = await waitForCallsStatus(config, { id, timeout: RECEIPT_TIMEOUT_MS });
        if (res.status !== 'success') {
          throw new Error(`The batch did not confirm (status: ${res.status}). Some calls may have landed, depending on your wallet's atomicity guarantee.`);
        }
        setSubmit({ busy: false, error: null, done: { batched: true, count: calls.length } });
      } else {
        // No EIP-5792. The same calls, in the same order, one signature
        // each. Approvals come first, so a stop partway never leaves a mint
        // that cannot pay for itself.
        let placed = 0;
        for (const c of calls) {
          const hash = await writeContract(config, {
            chainId: bsc.id, address: c.to, abi: c.abi,
            functionName: c.functionName, args: c.args,
          });
          await waitForTransactionReceipt(config, { hash, timeout: RECEIPT_TIMEOUT_MS });
          placed += 1;
        }
        setSubmit({ busy: false, error: null, done: { batched: false, count: placed } });
      }
    } catch (e) {
      setSubmit({ busy: false, error: e.shortMessage || e.message || String(e), done: null });
    }
  }, [plan, address, allowances, canBatch, config]);

  const spot = pool.tick != null ? tickToBnbPrice(pool.tick) : null;

  return (
    <NativeCardShell
      bare={bare} icon={Grid3x3} title="Grid Trading"
      accent={accent} surface={surface} mutedBorder={mutedBorder}
      blurb="Places a grid of limit orders across a range, in one signature, as range orders that earn fees while they wait."
    >
      {pool.loading && (
        <div className="flex items-center gap-2 text-xs opacity-60 py-4">
          <Loader2 size={14} className="animate-spin" /> Reading the WBNB/USDT pool...
        </div>
      )}

      {pool.error && (
        <div className="space-y-2 py-2">
          <p className="text-xs text-red-500">Could not read the pool: {pool.error}</p>
          <button onClick={loadPool} className="text-xs font-semibold underline" style={{ color: accent }}>Try again</button>
        </div>
      )}

      {pool.tick != null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="opacity-60">BNB spot, from the pool</span>
            <span className="font-mono font-semibold">{spot.toFixed(2)} USDT</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Low price" value={low} onChange={setLow} suffix="USDT" disabled={submit.busy} />
            <Field label="High price" value={high} onChange={setHigh} suffix="USDT" disabled={submit.busy} />
            <Field label="Levels" value={levels} onChange={setLevels} suffix={`${MIN_LEVELS}-${MAX_LEVELS}`} disabled={submit.busy} />
            <div />
            <Field label="Per buy" value={buySize} onChange={setBuySize} suffix="USDT" disabled={submit.busy} />
            <Field label="Per sell" value={sellSize} onChange={setSellSize} suffix="BNB" disabled={submit.busy} />
          </div>

          {plan && !plan.ok && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {plan.error}
            </p>
          )}

          {plan?.ok && (
            <>
              {/* Where the orders sit relative to spot. Every value here
                  comes from the plan and from the pool's own slot0 read;
                  nothing is computed in the chart. */}
              <div>
                <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">
                  Your grid against the live pool price
                </p>
                <MarkerAxis
                  min={Math.min(plan.spot, ...plan.orders.map((o) => o.priceLow)) * 0.995}
                  max={Math.max(plan.spot, ...plan.orders.map((o) => o.priceHigh)) * 1.005}
                  highlight={plan.spot}
                  formatX={(v) => v.toFixed(0)}
                  markers={plan.orders.map((o) => ({
                    x: o.side === 'sell' ? o.priceHigh : o.priceLow,
                    side: o.side === 'sell' ? 'up' : 'down',
                    color: o.side === 'sell' ? '#10B981' : '#6366F1',
                  }))}
                />
                <ChartLegend items={[
                  { label: `${plan.totals.sells} sell, above spot`, color: '#10B981' },
                  { label: `${plan.totals.buys} buy, below spot`, color: '#6366F1' },
                  { label: `spot ${plan.spot.toFixed(2)} USDT`, color: '#111827' },
                ]} />
              </div>

              <div className="rounded-xl border border-gray-200/60 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800/60">
                {plan.orders.map((o) => (
                  <div key={`${o.tickLower}:${o.tickUpper}`} className="flex items-center justify-between px-2.5 py-1.5">
                    <span className={`flex items-center gap-1 text-[11px] font-semibold ${o.side === 'sell' ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'}`}>
                      {o.side === 'sell' ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                      {o.side === 'sell' ? 'Sell' : 'Buy'}
                    </span>
                    <span className="text-[11px] font-mono opacity-70">
                      {o.priceLow.toFixed(2)} to {o.priceHigh.toFixed(2)}
                    </span>
                    <span className="text-[11px] font-mono">
                      {o.side === 'sell'
                        ? `${formatUnits(o.amount1, 18, 4)} BNB`
                        : `${formatUnits(o.amount0, 18, 2)} USDT`}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-[11px] opacity-70">
                <span>{plan.totals.sells} sell, {plan.totals.buys} buy</span>
                <span className="font-mono">
                  {formatUnits(plan.totals.usdt, 18, 2)} USDT + {formatUnits(plan.totals.wbnb, 18, 4)} BNB
                </span>
              </div>

              {plan.skipped.length > 0 && (
                <p className="text-[10px] opacity-50 leading-relaxed">
                  {plan.skipped.length} level(s) left out: {plan.skipped[0].reason}.
                </p>
              )}

              {!isConnected && (
                <ConnectButton.Custom>
                  {({ openConnectModal }) => (
                    <button onClick={openConnectModal} className="text-xs font-semibold underline" style={{ color: accent }}>
                      Connect a wallet to place this grid
                    </button>
                  )}
                </ConnectButton.Custom>
              )}

              {isConnected && !submit.done && (
                <button
                  onClick={place}
                  disabled={submit.busy}
                  className="w-full rounded-xl py-2 text-xs font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: accent }}
                >
                  {submit.busy && <Loader2 size={13} className="animate-spin" />}
                  {submit.busy
                    ? 'Waiting for the wallet...'
                    : canBatch === false
                      ? `Place ${plan.orders.length} orders, one signature each`
                      : `Place ${plan.orders.length} orders in one signature`}
                </button>
              )}

              {isConnected && canBatch === false && !submit.done && (
                <p className="text-[10px] opacity-50 leading-relaxed">
                  This wallet does not support batched transactions, so each order is signed
                  separately. The grid is the same either way.
                </p>
              )}

              {submit.error && (
                <p className="text-xs text-red-500 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {submit.error}
                </p>
              )}

              {submit.done && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-start gap-1.5">
                  <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                  {submit.done.count} call(s) confirmed{submit.done.batched ? ' in one batch' : ' one at a time'}.
                  The orders are resting as positions on PancakeSwap V3.
                </p>
              )}
            </>
          )}

          <div className="pt-1 border-t border-gray-100 dark:border-gray-800/60 space-y-1">
            <p className="text-[10px] opacity-50 leading-relaxed">
              These are range orders, so each one fills gradually as the price crosses its band
              rather than all at once at a single price.
            </p>
            <p className="text-[10px] opacity-50 leading-relaxed">
              They are one directional. A sell that fills becomes USDT and stays there; it does
              not turn itself back into a buy. Placing the grid again is what resets it.
            </p>
            <p className="text-[10px] opacity-50 leading-relaxed">
              While an order waits it is liquidity in the 0.05% pool, so it earns the pool fee.
            </p>
          </div>

          <button onClick={loadPool} className="flex items-center gap-1.5 text-[11px] opacity-60 hover:opacity-100">
            <RefreshCw size={11} /> Read the pool again
          </button>
        </div>
      )}
    </NativeCardShell>
  );
}
