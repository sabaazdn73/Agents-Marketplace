// HyperliquidView.jsx
//
// The Hyperliquid tab. Shared by web and mobile, like every other chain view.
//
// WHY THIS LOOKS NOTHING LIKE THE OTHER CHAIN VIEWS
// -------------------------------------------------
// Every other tab lists ERC-8004 agents and asks whether they deliver work
// they were paid for. Hyperliquid has no such registry. Its agents are
// market-making bots, and the same question asked of a bot is: it claims to
// make markets, does it actually rest orders on the book?
//
// The signal is post-only rejection. A maker sends an ALO order, and the
// matching engine refuses any that would cross rather than resting it. A
// rejected order never reaches the book, so it provides no liquidity and
// leaves no trace in fills. Measured across six comparable top-volume makers,
// the rate ran from 0.5% to 92.1%. A bot at 92% is spraying orders that never
// rest. Nothing in the Hyperliquid tooling ecosystem separates the two.
//
// WHY THE COVERAGE BANNER IS NOT OPTIONAL
// ---------------------------------------
// historicalOrders returns only the 2,000 most recent records and ignores
// startTime and endTime, so this data cannot be backfilled. Collection began
// 2026-09-15. On day one the tab holds hours, not history, and it says so
// before it shows a single rate. Rates are withheld entirely below five polls
// for an address, the same threshold discipline used for budget records: a
// number from one or two observations is a number pretending to be evidence.

import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Clock, Info } from 'lucide-react';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';

function pct(v, digits = 1) {
  if (v === null || v === undefined) return null;
  return `${(v * 100).toFixed(digits)}%`;
}

function short(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

/** Plain-language definition, in the same register as the interaction line on
 *  an agent card. Each says what the number is and what it is not. */
const DEFINITIONS = [
  {
    term: 'Post-only rejection rate',
    text: 'Of the orders this maker asked to rest on the book without trading, '
        + 'the share the exchange refused because they would have traded '
        + 'immediately. A rejected order never reaches the book, so it provides '
        + 'no liquidity to anyone.',
  },
  {
    term: 'Cancel to fill',
    text: 'How many orders this maker withdrew for every one that traded. '
        + 'Rejections are deliberately left out of this number. Counting them '
        + 'in is the common error, and it inflates the ratio.',
  },
  {
    term: 'Effective fill rate',
    text: 'The share of everything this maker submitted that ended in a trade. '
        + 'It counts every order, including the ones that were refused.',
  },
];

export default function HyperliquidView({ mutedBorder }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/hyperliquid/overview`)
      .then((r) => {
        if (!r.ok) throw new Error(`Backend returned ${r.status}`);
        return r.json();
      })
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-400">Loading Hyperliquid data…</div>;
  }
  if (error) {
    // An outage must read as "we cannot tell you", never as an empty dataset
    // that would look like zero rejections.
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-gray-500">Hyperliquid data is unavailable right now.</p>
        <p className="mt-1 text-xs text-gray-400">{error}</p>
        <p className="mt-2 text-xs text-gray-400">
          This is not a reading of zero. It means the store could not be reached.
        </p>
      </div>
    );
  }

  const cov = data.coverage || {};
  const makers = data.makers || [];
  const markets = data.markets || [];
  const statuses = data.statuses || [];
  const thin = (cov.hours_covered || 0) < 24;

  return (
    <div className="space-y-6">
      {/* Coverage first, deliberately. */}
      <div className={`rounded-xl border ${mutedBorder || 'border-gray-200'} bg-amber-50/60 p-4`}>
        <div className="flex items-start gap-2">
          <Clock size={15} className="mt-0.5 shrink-0 text-amber-700" />
          <div className="text-[13px] leading-relaxed text-amber-900">
            <span className="font-semibold">
              {thin ? 'This dataset is hours old, not a track record.' : 'Collection window'}
            </span>{' '}
            {cov.hours_covered ?? 0} hours of observation, {(cov.polls ?? 0).toLocaleString()} polls
            across {cov.addresses ?? 0} makers, {(cov.orders_observed ?? 0).toLocaleString()} orders seen.
            {' '}Hyperliquid only serves the 2,000 most recent orders per address and cannot be
            asked for older ones, so this history starts when the collector started and grows
            from there. Rates are withheld until an address has at least {cov.min_polls_for_rate ?? 5} polls.
            {cov.polls_with_gap > 0 && (
              <> {cov.polls_with_gap} polls had a coverage gap, meaning orders happened between
              two polls that no poll saw. Those are counted as missing rather than as zero.</>
            )}
          </div>
        </div>
      </div>

      {/* Per-market view: usable on day one because it pools across makers. */}
      <div>
        <h3 className="mb-1 text-sm font-semibold text-gray-800">Post-only rejection by market</h3>
        <p className="mb-3 text-xs text-gray-500">
          Pooled across every tracked maker. A high rate means the book is moving faster than
          makers can quote it, and their resting orders are being refused.
        </p>
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Market</th>
                <th className="px-3 py-2 text-right font-semibold">Post-only orders</th>
                <th className="px-3 py-2 text-right font-semibold">Rejected</th>
                <th className="px-3 py-2 text-right font-semibold">Rate</th>
                <th className="px-3 py-2 text-right font-semibold">Makers</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => (
                <tr key={m.coin} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-800">{m.coin}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {m.alo_total.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {m.alo_rejected.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">
                    {pct(m.post_only_rejection_rate) ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{m.makers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-maker view. */}
      <div>
        <h3 className="mb-1 text-sm font-semibold text-gray-800">Makers</h3>
        <p className="mb-3 text-xs text-gray-500">
          The 50 highest-volume addresses on Hyperliquid. Below roughly this rank, the median
          address posts no resting orders at all, so there is nothing of this kind to measure.
        </p>
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Address</th>
                <th className="px-3 py-2 text-right font-semibold">Post-only seen</th>
                <th className="px-3 py-2 text-right font-semibold">Rejected</th>
                <th className="px-3 py-2 text-right font-semibold">Rejection rate</th>
                <th className="px-3 py-2 text-right font-semibold">Cancel / fill</th>
                <th className="px-3 py-2 text-right font-semibold">Fill rate</th>
                <th className="px-3 py-2 text-right font-semibold">Polls</th>
              </tr>
            </thead>
            <tbody>
              {makers.map((m) => (
                <tr key={m.address} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <a
                      href={`https://app.hyperliquid.xyz/explorer/address/${m.address}`}
                      target="_blank" rel="noreferrer"
                      className="font-mono text-[12px] text-indigo-600 hover:underline"
                    >{short(m.address)}</a>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {m.alo_total.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {m.alo_rejected.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">
                    {m.enough_data
                      ? (pct(m.post_only_rejection_rate) ?? '—')
                      : <span className="font-normal text-gray-400">not enough yet</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {m.cancel_to_fill != null ? m.cancel_to_fill.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {pct(m.effective_fill_rate) ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-400">{m.polls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* The typed statuses, which are the evidence for the whole tab. */}
      <details className="rounded-xl border border-gray-200 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-800">
          Why the obvious query finds nothing
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-gray-600">
          Hyperliquid reports order outcomes as distinct typed statuses. There is a plain
          <code className="mx-1 rounded bg-gray-100 px-1">rejected</code> status, but it covers a
          minority of refusals. Asking only for it misses every post-only rejection, which is the
          signal this tab exists for. The full breakdown of what has actually been observed:
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {statuses.map((s) => (
                <tr key={s.status} className="border-t border-gray-100">
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-gray-700">{s.status}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-gray-600">
                    {s.n.toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-gray-500">
                    {pct(s.share, 1)}
                  </td>
                  <td className="py-1.5 text-right">
                    {s.is_rejection && (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                        never reached the book
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* Definitions, in the register the agent cards use. */}
      <div className="rounded-xl border border-gray-200 p-4">
        <div className="mb-2 flex items-center gap-1.5">
          <Info size={14} className="text-gray-500" />
          <h4 className="text-sm font-semibold text-gray-800">What these numbers mean</h4>
        </div>
        <dl className="space-y-2.5">
          {DEFINITIONS.map((d) => (
            <div key={d.term}>
              <dt className="text-[13px] font-semibold text-gray-800">{d.term}</dt>
              <dd className="text-xs leading-relaxed text-gray-600">{d.text}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-500">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>
          This tab measures whether orders reach the book. It does not measure whether a maker is
          profitable, and a low rejection rate is not a recommendation. There is no agent here yet:
          when one exists it will be named as one.
        </span>
      </div>
    </div>
  );
}
