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
import { readPositions, riskBand, BSC_CHAIN_ID } from './healthFactor';
import NativeCardShell from './NativeCardShell';
import { MarkerAxis, ChartEmpty, ChartLegend } from './MiniChart';

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
  // Pinned to BSC, not left to follow the wallet.
  //
  // Venus's Comptroller and the Aave v3 Pool in healthFactor.js exist on BNB
  // Chain and nowhere else. A bare usePublicClient() returns a client for
  // whatever chain the wallet happens to be on, so once someone switched to
  // Arbitrum or Robinhood -- which the marketplace gives them tabs for --
  // both reads hit addresses with no contract at them and came back with
  //   The contract function "getUserAccountData" returned no data ("0x")
  // which reads as a broken agent rather than as the wrong network.
  //
  // Safe to pin because this card is read only. It signs nothing, so there
  // is no transaction that could be sent to a chain the user did not pick,
  // and no reason to make them switch networks to read a balance.
  const publicClient = usePublicClient({ chainId: BSC_CHAIN_ID });
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
  // "No positions" is a claim, and it may only be made when both reads
  // actually returned. readPositions settles each protocol separately, so a
  // failed read leaves hasPosition undefined, which is falsy, which used to
  // put the reassuring line "This wallet has no lending positions on Venus
  // or Aave, so there is nothing to liquidate" directly above two error
  // messages saying nothing had been read at all.
  //
  // On a liquidation screen that is the dangerous direction to be wrong in:
  // it tells someone whose position is close to the edge that they have
  // nothing to worry about, at the moment the tool has in fact failed to
  // look. Not knowing is now reported as not knowing.
  const aaveOk = aave && !aave.error;
  const venusOk = venus && !venus.error;
  const bothRead = aaveOk && venusOk;
  const neitherRead = aave?.error && venus?.error;

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
          {bothRead && !anyPosition && (
            <div className="flex items-start gap-2 text-xs py-1">
              <ShieldCheck size={14} className="text-emerald-500 shrink-0 mt-0.5" />
              <span className="opacity-70">
                This wallet has no lending positions on Venus or Aave, so there is nothing to
                liquidate and no health factor to report.
              </span>
            </div>
          )}

          {neitherRead && (
            <div className="flex items-start gap-2 text-xs py-1">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <span className="opacity-70">
                Neither protocol could be read, so this says nothing about whether the wallet
                has a position. The reason from each is below.
              </span>
            </div>
          )}

          {!neitherRead && (aave?.error || venus?.error) && (
            <div className="flex items-start gap-2 text-xs py-1">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <span className="opacity-70">
                {aave?.error ? 'Aave' : 'Venus'} could not be read, so only the
                {aave?.error ? ' Venus ' : ' Aave '}
                side below is a complete answer.
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
                  <>
                    {/* The distance between the position and liquidation,
                        drawn. Both numbers come from getUserAccountData;
                        nothing here is derived. */}
                    <div className="mt-2">
                      <MarkerAxis
                        height={72}
                        min={0}
                        max={Math.max(2.5, Number(aave.healthFactor) * 1.25)}
                        highlight={1}
                        formatX={(v) => v.toFixed(2)}
                        markers={[{
                          x: Number(aave.healthFactor),
                          side: 'up',
                          color: band?.tone === 'red' ? '#EF4444' : band?.tone === 'amber' ? '#F59E0B' : '#10B981',
                        }]}
                      />
                      <ChartLegend items={[
                        { label: `health factor ${aave.healthFactor}`, color: band?.tone === 'red' ? '#EF4444' : band?.tone === 'amber' ? '#F59E0B' : '#10B981' },
                        { label: 'liquidation at 1.00', color: '#111827' },
                      ]} />
                    </div>
                    <p className="text-[10px] opacity-50 mt-1.5 leading-relaxed">
                      Below 1.00 the position can be liquidated by anyone.
                    </p>
                  </>
                )}
                {aave.hasPosition && !aave.hasDebt && (
                  <ChartEmpty height={56} reason="Nothing borrowed, so there is no distance to liquidation to draw." />
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
                {/* Deliberately NOT a health factor axis. Venus publishes
                    headroom and shortfall, and one of the two is always
                    zero, so this draws that pair on its own USD scale.
                    Putting Venus on the Aave axis would mean inventing a
                    denominator, which is the thing healthFactor.js exists
                    to avoid. */}
                {venus.hasPosition ? (
                  <div className="mt-2">
                    <MarkerAxis
                      height={72}
                      min={0}
                      max={Math.max(Number(venus.liquidityUsd), Number(venus.shortfallUsd), 1) * 1.25}
                      highlight={0}
                      formatX={(v) => `$${v.toFixed(0)}`}
                      markers={[
                        ...(Number(venus.liquidityUsd) > 0
                          ? [{ x: Number(venus.liquidityUsd), side: 'up', color: '#10B981' }] : []),
                        ...(Number(venus.shortfallUsd) > 0
                          ? [{ x: Number(venus.shortfallUsd), side: 'down', color: '#EF4444' }] : []),
                      ]}
                    />
                    <ChartLegend items={[
                      { label: `headroom $${venus.liquidityUsd}`, color: '#10B981' },
                      { label: `shortfall $${venus.shortfallUsd}`, color: '#EF4444' },
                    ]} />
                  </div>
                ) : (
                  <ChartEmpty height={56} reason="No Venus position, so there is no headroom or shortfall to draw." />
                )}
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
