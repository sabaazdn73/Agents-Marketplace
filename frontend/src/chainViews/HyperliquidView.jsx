// HyperliquidView.jsx
//
// The Hyperliquid tab. Shared by web and mobile, like every other chain view.
//
// WHY THIS IS NOT SHAPED LIKE THE OTHER CHAIN VIEWS
// -------------------------------------------------
// Every other tab lists ERC-8004 agents and asks whether they deliver work
// they were paid for. Hyperliquid has no such registry. Its agents are
// market-making bots, and the same question asked of a bot is whether it
// rests orders on the book at all.
//
// The measurement is post-only rejection. A maker sends an ALO order, and the
// matching engine refuses any that would cross rather than resting it. A
// refused order never reaches the book, provides no liquidity, and leaves no
// trace in fills. Across the tracked makers the rate runs from under 1% to
// above 90%, and none of the Hyperliquid analytics tools surveyed separate
// the two cases.
//
// WHY THE COVERAGE BANNER COMES FIRST
// -----------------------------------
// historicalOrders serves only the 2,000 most recent records per address and
// ignores startTime and endTime, so this cannot be backfilled. The window
// starts when collection started. Rates are withheld below five polls for an
// address while the counts stay visible, the same threshold already used for
// budget records.
//
// STYLING
// -------
// Uses the chain views' own idiom rather than its own: bg-white with
// dark:bg-[#1E293B] on cards, the mutedBorder passed in by ChainViewTabs, and
// the tinted-border callout shape from HireabilityNotice. Every colour has a
// dark variant. An earlier version of this file had none, and rendered a white
// page inside a dark shell.

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Clock, Info } from 'lucide-react';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';

function pct(v, digits = 1) {
  if (v === null || v === undefined) return null;
  return `${(v * 100).toFixed(digits)}%`;
}

function short(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

/** Plain definitions, in the register the interaction line on an agent card
 *  uses. Each says what the number is and what it is not. */
const DEFINITIONS = [
  {
    term: 'Post-only rejection rate',
    text: 'Of the orders a maker asked to rest on the book without trading, the '
        + 'share the exchange refused because they would have traded immediately. '
        + 'A refused order never reaches the book, so it provides no liquidity.',
  },
  {
    term: 'Cancel to fill',
    text: 'How many orders a maker withdrew for every one that traded. Refusals '
        + 'are left out of this number. Counting them in inflates the ratio, '
        + 'which is the common way to get it wrong.',
  },
  {
    term: 'Effective fill rate',
    text: 'The share of everything a maker submitted that ended in a trade. It '
        + 'counts every order, including the ones that were refused.',
  },
];

function Card({ children, mutedBorder, className = '' }) {
  return (
    <div className={`bg-white dark:bg-[#1E293B] rounded-2xl border ${mutedBorder || 'border-gray-200 dark:border-gray-800'} ${className}`}>
      {children}
    </div>
  );
}

function SectionHeading({ title, note }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
      {note && (
        <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed mt-0.5">{note}</p>
      )}
    </div>
  );
}

function Th({ children, align = 'right' }) {
  return (
    <th className={`px-3 py-2 text-${align} text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-500 whitespace-nowrap`}>
      {children}
    </th>
  );
}

function Td({ children, align = 'right', strong = false, className = '' }) {
  return (
    <td className={`px-3 py-2 text-${align} text-[12px] whitespace-nowrap tabular-nums ${
      strong ? 'font-semibold text-gray-900 dark:text-gray-100'
             : 'text-gray-600 dark:text-gray-400'} ${className}`}>
      {children}
    </td>
  );
}

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
    return (
      <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
        Loading Hyperliquid data…
      </div>
    );
  }

  if (error) {
    // An outage must read as "we cannot tell you", never as an empty dataset
    // that would look like zero rejections.
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Hyperliquid data is unavailable right now.
        </p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">{error}</p>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
          This is not a reading of zero. The store could not be reached.
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
    <div className="space-y-5">
      {/* Coverage first, in the callout shape the chain views already use. */}
      <div className="p-3 rounded-xl border border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-400 text-[12px] flex items-start gap-2">
        <Clock size={14} className="shrink-0 mt-0.5" />
        <div className="min-w-0 leading-relaxed">
          <span className="font-semibold">
            {thin ? 'This is hours of observation, not a track record.'
                  : 'Collection window'}
          </span>{' '}
          {cov.hours_covered ?? 0} hours, {(cov.polls ?? 0).toLocaleString()} polls across{' '}
          {cov.addresses ?? 0} makers, {(cov.orders_observed ?? 0).toLocaleString()} orders seen.
          {' '}Hyperliquid serves only the 2,000 most recent orders per address and cannot be
          asked for older ones, so this history begins when collection began. Rates are withheld
          until an address has at least {cov.min_polls_for_rate ?? 5} polls.
          {cov.polls_with_gap > 0 && (
            <> {cov.polls_with_gap} polls had a coverage gap, meaning orders happened between two
            polls that no poll saw. Those count as missing rather than as zero.</>
          )}
        </div>
      </div>

      {/* Per market. Usable from the first hour because it pools across makers. */}
      <div>
        <SectionHeading
          title="Post-only rejection by market"
          note="Pooled across every tracked maker. A high rate means the book is moving faster than makers can quote it, and their resting orders are being refused."
        />
        <Card mutedBorder={mutedBorder} className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <Th align="left">Market</Th>
                <Th>Post-only orders</Th>
                <Th>Refused</Th>
                <Th>Rate</Th>
                <Th>Makers</Th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => (
                <tr key={m.coin} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                  <Td align="left" strong className="font-sans">{m.coin}</Td>
                  <Td>{m.alo_total.toLocaleString()}</Td>
                  <Td>{m.alo_rejected.toLocaleString()}</Td>
                  <Td strong>{pct(m.post_only_rejection_rate) ?? 'n/a'}</Td>
                  <Td>{m.makers}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Per maker. */}
      <div>
        <SectionHeading
          title="Makers"
          note="The 50 highest-volume addresses on Hyperliquid. Below roughly this rank the median address posts no resting orders at all, so there is nothing of this kind to measure."
        />
        <Card mutedBorder={mutedBorder} className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <Th align="left">Address</Th>
                <Th>Post-only seen</Th>
                <Th>Refused</Th>
                <Th>Rejection rate</Th>
                <Th>Cancel / fill</Th>
                <Th>Fill rate</Th>
                <Th>Polls</Th>
              </tr>
            </thead>
            <tbody>
              {makers.map((m) => (
                <tr key={m.address} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                  <td className="px-3 py-2 text-left whitespace-nowrap">
                    <a
                      href={`https://app.hyperliquid.xyz/explorer/address/${m.address}`}
                      target="_blank" rel="noreferrer"
                      className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
                    >{short(m.address)}</a>
                  </td>
                  <Td>{m.alo_total.toLocaleString()}</Td>
                  <Td>{m.alo_rejected.toLocaleString()}</Td>
                  <Td strong>
                    {m.enough_data
                      ? (pct(m.post_only_rejection_rate) ?? 'n/a')
                      : <span className="font-normal text-gray-400 dark:text-gray-600">not enough yet</span>}
                  </Td>
                  <Td>{m.cancel_to_fill != null ? m.cancel_to_fill.toFixed(1) : 'n/a'}</Td>
                  <Td>{pct(m.effective_fill_rate) ?? 'n/a'}</Td>
                  <Td className="text-gray-400 dark:text-gray-600">{m.polls}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* The typed statuses, which are the evidence behind the tab. */}
      <Card mutedBorder={mutedBorder} className="p-4">
        <details>
          <summary className="cursor-pointer text-sm font-bold text-gray-900 dark:text-gray-100">
            Why the obvious query finds almost nothing
          </summary>
          <p className="mt-2 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
            Hyperliquid reports order outcomes as distinct typed statuses. A plain
            <code className="mx-1 rounded bg-gray-100 dark:bg-gray-800 px-1 text-[11px]">rejected</code>
            status exists but covers a minority of refusals, so asking only for it misses every
            post-only rejection. The breakdown of what has been observed:
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full">
              <tbody>
                {statuses.map((s) => (
                  <tr key={s.status} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-gray-700 dark:text-gray-300">
                      {s.status}
                    </td>
                    <Td>{s.n.toLocaleString()}</Td>
                    <Td className="text-gray-500 dark:text-gray-500">{pct(s.share, 1)}</Td>
                    <td className="py-1.5 text-right">
                      {s.is_rejection && (
                        <span className="rounded-full border border-amber-500/25 bg-amber-500/5 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
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
      </Card>

      {/* Definitions. */}
      <Card mutedBorder={mutedBorder} className="p-4">
        <div className="mb-2 flex items-center gap-1.5">
          <Info size={14} className="text-gray-500 dark:text-gray-500" />
          <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">What these numbers mean</h4>
        </div>
        <dl className="space-y-2.5">
          {DEFINITIONS.map((d) => (
            <div key={d.term}>
              <dt className="text-[12px] font-semibold text-gray-800 dark:text-gray-200">{d.term}</dt>
              <dd className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">{d.text}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-500">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>
          This tab measures whether orders reach the book. It does not measure whether a maker is
          profitable, and a low rejection rate is not a recommendation. There is no agent here; if
          one is built it will be named as one.
        </span>
      </div>
    </div>
  );
}
