// HealthFactorCard.jsx
//
// Health Factor Monitoring, one of the four DeFi categories this project is
// judged against. Read only: it reads the connected wallet's lending
// positions on Venus and Aave and reports how close they are to
// liquidation. It signs nothing and spends nothing, so no fee applies.
//
// The two protocols report different things and this card says so rather
// than flattening them into one number. Aave gives a health factor and a
// liquidation threshold. Venus gives liquidity and shortfall, and has no
// health factor at all. See healthFactor.js for why nothing is invented to
// make the two look alike.
//
// A wallet with no borrowings is not a wallet at risk. Aave returns
// type(uint256).max in that case, and this shows "no borrowings" rather
// than a number, because a zero on a liquidation screen reads as danger.

import React, { useCallback, useEffect, useState } from 'react';
import { HeartPulse, Loader2, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useAccount, usePublicClient } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { readPositions, riskBand } from './healthFactor';
import NativeCardShell from './NativeCardShell';

const TONE = {
  red: 'text-red-600 dark:text-red-400',
  amber: 'text-amber-600 dark:text-amber-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
};

function Line({ label, value, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[11px] opacity-60">{label}</span>
      <span className={`text-[11px] font-mono ${tone ? TONE[tone] : ''}`}>{value}</span>
    </div>
  );
}

export default function HealthFactorCard({ accent, surface, mutedBorder, bare = false }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [state, setState] = useState({ loading: false, data: null, error: null });

  const load = useCallback(async () => {
    if (!isConnected || !address || !publicClient) {
      setState({ loading: false, data: null, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ loading: false, data: await readPositions(publicClient, address), error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: e.shortMessage || e.message });
    }
  }, [address, isConnected, publicClient]);

  useEffect(() => { load(); }, [load]);

  const { loading, data, error } = state;
  const aave = data?.aave;
  const venus = data?.venus;
  const band = aave?.healthFactor ? riskBand(aave.healthFactor) : null;
  const anyPosition = aave?.hasPosition || venus?.hasPosition;

  return (
    <NativeCardShell
      bare={bare} icon={HeartPulse} title="Health Factor Monitoring"
      accent={accent} surface={surface} mutedBorder={mutedBorder}
      blurb="Reads your lending positions on Venus and Aave and shows how close they are to liquidation. Read only, so it never signs or spends anything."
    >

      {!isConnected && (
        <div className="space-y-2">
          <p className="text-xs opacity-60">Connect a wallet to read its positions.</p>
          <ConnectButton.Custom>
            {({ openConnectModal }) => (
              <button onClick={openConnectModal} className="text-xs font-semibold underline" style={{ color: accent }}>
                Connect a wallet
              </button>
            )}
          </ConnectButton.Custom>
        </div>
      )}

      {isConnected && loading && (
        <div className="flex items-center gap-2 text-xs opacity-60 py-4">
          <Loader2 size={14} className="animate-spin" /> Reading Venus and Aave...
        </div>
      )}

      {isConnected && error && (
        <div className="py-3 space-y-2">
          <div className="text-xs text-red-500">{error}</div>
          <button onClick={load} className="text-xs font-semibold underline" style={{ color: accent }}>Try again</button>
        </div>
      )}

      {isConnected && data && !loading && (
        <div className="space-y-3">
          {!anyPosition && (
            <div className="flex items-start gap-2 text-xs py-1">
              <ShieldCheck size={14} className="text-emerald-500 shrink-0 mt-0.5" />
              <span className="opacity-70">
                This wallet has no lending positions on Venus or Aave, so there is nothing to
                liquidate and no health factor to report.
              </span>
            </div>
          )}

          {/* Aave */}
          <div className="rounded-xl border border-gray-200/60 dark:border-gray-800 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold">Aave v3</span>
              {band && (
                <span className={`text-[10px] font-bold uppercase ${TONE[band.tone]}`}>{band.label}</span>
              )}
            </div>
            {aave?.error && <div className="text-[11px] text-red-500">{aave.error}</div>}
            {aave && !aave.error && (
              <>
                {aave.hasDebt ? (
                  <Line label="Health factor" value={aave.healthFactor} tone={band?.tone} />
                ) : (
                  <Line label="Health factor" value="no borrowings" />
                )}
                <Line label="Collateral" value={`$${aave.collateralUsd}`} />
                <Line label="Borrowed" value={`$${aave.debtUsd}`} />
                {aave.hasPosition && (
                  <Line label="Liquidation threshold" value={`${aave.liquidationThresholdPct}%`} />
                )}
                {aave.hasDebt && (
                  <p className="text-[10px] opacity-50 mt-1.5 leading-relaxed">
                    Below 1.00 the position can be liquidated by anyone.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Venus */}
          <div className="rounded-xl border border-gray-200/60 dark:border-gray-800 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold">Venus</span>
              {venus?.liquidatable && (
                <span className="text-[10px] font-bold uppercase text-red-600 dark:text-red-400">Shortfall</span>
              )}
            </div>
            {venus?.error && <div className="text-[11px] text-red-500">{venus.error}</div>}
            {venus && !venus.error && (
              <>
                {venus.errorCode !== 0 && (
                  <div className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 mb-1">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                    <span>The Comptroller returned error code {venus.errorCode}, so this reading is not reliable.</span>
                  </div>
                )}
                <Line label="Borrowing headroom" value={`$${venus.liquidityUsd}`} />
                <Line
                  label="Shortfall"
                  value={`$${venus.shortfallUsd}`}
                  tone={venus.liquidatable ? 'red' : undefined}
                />
                <p className="text-[10px] opacity-50 mt-1.5 leading-relaxed">
                  Venus has no health factor. It reports headroom before liquidation, or a
                  shortfall once past it, so those are shown instead of a number it does not
                  publish.
                </p>
              </>
            )}
          </div>

          <button onClick={load} className="flex items-center gap-1.5 text-[11px] opacity-60 hover:opacity-100">
            <RefreshCw size={11} /> Read again
          </button>
        </div>
      )}
    </NativeCardShell>
  );
}
