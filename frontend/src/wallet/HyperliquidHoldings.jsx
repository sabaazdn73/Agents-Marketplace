// HyperliquidHoldings.jsx
//
// What the address holds on Hyperliquid, as /api/wallet/habits returns it:
// margin and positions per perp dex read, and spot balances listed but not
// priced (the route does not price them, and neither does this page).

import React from 'react';
import { Basis, Withheld, asSentence, fmtAmount, fmtCount, fmtUsd, fmtUtc } from './format';

export function HyperliquidValue({ data, compact = false }) {
  const reasons = data.reasons || {};
  const perps = data.holdings?.perps;
  if (data.account?.exists === false) {
    return (
      <section className="card p-4">
        <h2 className="text-title font-bold mb-2">Hyperliquid account</h2>
        <Withheld reasons={reasons} code="no_account" />
        <Basis>{asSentence(data.account.basis)}</Basis>
      </section>
    );
  }
  if (!perps || perps.withheld_reason) {
    return (
      <section className="card p-4">
        <h2 className="text-title font-bold mb-2">Hyperliquid account</h2>
        <Withheld reasons={reasons} code={perps?.withheld_reason || data.holdings?.withheld_reason || data.account?.withheld_reason} />
      </section>
    );
  }
  const dexes = perps.dexes || [];
  const values = dexes.map((d) => d.account_value_usd).filter((v) => v != null);
  const total = values.length ? values.reduce((a, b) => a + b, 0) : null;
  return (
    <section className="card p-4">
      <h2 className="text-title font-bold">Hyperliquid account value</h2>
      <p className={`figure ${compact ? 'text-h1' : 'text-display'} text-fg mt-1`}>{fmtUsd(total) ?? 'Not stated'}</p>
      <Basis>
        Perp margin account value, the sum over the {dexes.length} perp {dexes.length === 1 ? 'dex' : 'dexes'} read
        {dexes.length > 1 ? ` (${dexes.map((d) => `${d.dex} ${fmtUsd(d.account_value_usd) ?? 'not stated'}`).join(', ')})` : ''}.
        Spot balances are not included: they are not priced.
      </Basis>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
        {dexes.map((d) => (
          <div key={d.dex} className="p-2.5 rounded-md bg-inset border border-line min-w-0">
            <p className="text-label text-muted">Dex {d.dex}</p>
            <p className="figure text-body text-fg">{fmtUsd(d.account_value_usd) ?? 'not stated'}</p>
            <p className="text-label text-muted">withdrawable {fmtUsd(d.withdrawable_usd) ?? 'not stated'}</p>
            <p className="text-label text-muted">as of {fmtUtc(d.as_of) ?? 'not stated'}</p>
          </div>
        ))}
      </div>
      {(perps.dexes_not_read || []).map((d) => (
        <div key={d.dex} className="mt-2">
          <p className="text-label font-semibold text-fg">Dex {d.dex} not read</p>
          <Withheld reasons={reasons} code={d.withheld_reason} />
        </div>
      ))}
    </section>
  );
}

export function HyperliquidPositions({ data, layout }) {
  const reasons = data.reasons || {};
  const perps = data.holdings?.perps;
  const spot = data.holdings?.spot;
  if (data.account?.exists === false || !perps) return null;
  const dexes = perps.dexes || [];
  const count = dexes.reduce((a, d) => a + (d.positions?.length || 0), 0);
  return (
    <section className="card p-4">
      <h2 className="text-title font-bold">Hyperliquid holdings</h2>
      <p className="text-label text-muted mb-3">{perps.coverage}</p>

      <h3 className="text-label font-semibold uppercase tracking-wide text-muted mb-2">Perp positions ({fmtCount(count)})</h3>
      {count === 0 ? (
        <p className="text-body text-muted">No open positions on the {dexes.length === 1 ? 'dex' : 'dexes'} read.</p>
      ) : layout === 'mobile' ? (
        <ul className="divide-y divide-line">
          {dexes.flatMap((d) => (d.positions || []).map((p, i) => (
            <li key={`${d.dex}-${p.coin}-${i}`} className="py-2">
              <div className="flex justify-between gap-2">
                <span className="text-body font-semibold text-fg">{p.coin} <span className="text-label text-muted">{d.dex}</span></span>
                <span className="figure text-body text-fg">{fmtUsd(p.position_value_usd) ?? 'not stated'}</span>
              </div>
              <p className="text-label text-muted figure">
                size {fmtAmount(p.size)}, entry {fmtAmount(p.entry_px)}, {p.leverage != null ? `${p.leverage}x ${p.leverage_type || ''}` : 'leverage not stated'},
                unrealised {fmtUsd(p.unrealized_pnl_usd, { sign: true }) ?? 'not stated'}, liquidation {p.liquidation_px != null ? fmtAmount(p.liquidation_px) : 'not stated'}
              </p>
            </li>
          )))}
        </ul>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-body">
            <thead>
              <tr className="text-label text-muted text-left">
                <th className="font-medium py-1.5 px-1">Market</th>
                <th className="font-medium py-1.5 px-1 text-right">Size</th>
                <th className="font-medium py-1.5 px-1 text-right">Entry</th>
                <th className="font-medium py-1.5 px-1 text-right">Value</th>
                <th className="font-medium py-1.5 px-1 text-right">Unrealised</th>
                <th className="font-medium py-1.5 px-1 text-right">Leverage</th>
                <th className="font-medium py-1.5 px-1 text-right">Liquidation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {dexes.flatMap((d) => (d.positions || []).map((p, i) => (
                <tr key={`${d.dex}-${p.coin}-${i}`}>
                  <td className="py-2 px-1 font-semibold text-fg">{p.coin} <span className="text-label text-muted font-normal">{d.dex}</span></td>
                  <td className="py-2 px-1 text-right figure">{fmtAmount(p.size) ?? 'not stated'}</td>
                  <td className="py-2 px-1 text-right figure">{fmtAmount(p.entry_px) ?? 'not stated'}</td>
                  <td className="py-2 px-1 text-right figure">{fmtUsd(p.position_value_usd) ?? 'not stated'}</td>
                  <td className={`py-2 px-1 text-right figure ${p.unrealized_pnl_usd < 0 ? 'text-neg' : 'text-pos'}`}>{fmtUsd(p.unrealized_pnl_usd, { sign: true }) ?? 'not stated'}</td>
                  <td className="py-2 px-1 text-right figure">{p.leverage != null ? `${p.leverage}x ${p.leverage_type || ''}` : 'not stated'}</td>
                  <td className="py-2 px-1 text-right figure">{p.liquidation_px != null ? fmtAmount(p.liquidation_px) : 'not stated'}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="text-label font-semibold uppercase tracking-wide text-muted mt-4 mb-2">
        Spot balances{spot?.balances ? ` (${fmtCount(spot.balances.length)})` : ''}
      </h3>
      {!spot || spot.withheld_reason ? (
        <Withheld reasons={reasons} code={spot?.withheld_reason} />
      ) : spot.balances.length === 0 ? (
        <p className="text-body text-muted">No non-zero spot balances.</p>
      ) : (
        <>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {spot.balances.map((b) => (
              <li key={b.coin} className="flex justify-between gap-3 py-1.5 border-b border-line">
                <span className="text-body text-fg truncate">{b.coin}</span>
                <span className="figure text-body text-fg text-right">
                  {fmtAmount(b.total)}
                  {b.hold ? <span className="text-label text-muted"> ({fmtAmount(b.hold)} on hold)</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <Basis>{spot.note} Quantities only; no dollar value is shown for spot.</Basis>
        </>
      )}
    </section>
  );
}
