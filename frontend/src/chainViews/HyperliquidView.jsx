// HyperliquidView.jsx
//
// The Hyperliquid tab, presented as an agent rather than as a table.
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
// above 90%.
//
// STRUCTURE
// ---------
// A reader arrives wanting two things: which makers are quoting and which are
// spraying, and how much the coverage so far supports. Both are answered above
// the fold by the band summary and the coverage line. Everything else is detail
// and sits inside collapsed sections.
//
// The three sections are the agent's own parts. Memory is what it has
// collected. Workspace is what it can reach. Brain does not exist yet and the
// section says what it is waiting for rather than showing a placeholder.
//
// PANEL BEHAVIOUR
// ---------------
// One open at a time, mounted on first open and never unmounted afterwards,
// collapsing hides with CSS. The rule is taken from DeFiCategoryPanels.jsx,
// which documents why: conditional rendering re-runs the panel's work on every
// reopen. It is reimplemented here rather than imported because that component
// paints its background from an inline `surface` colour, and the chain views
// carry their dark treatment in Tailwind variants instead.

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Brain, ChevronDown, Database, Info, Radio, Wifi, WifiOff,
} from 'lucide-react';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';

// The brain does not exist. This is the switch for what its section says, and
// the three cases are written now so that a negative result has somewhere to
// land. If the persistence test comes back with no signal at seconds
// resolution, this becomes 'no-signal' permanently and the section says so.
// It must never say "coming soon", and it must never carry a sample
// recommendation.
const BRAIN_STATE = 'waiting'; // 'waiting' | 'no-signal' | 'ready'

function pct(v, digits = 1) {
  if (v === null || v === undefined) return null;
  return `${(v * 100).toFixed(digits)}%`;
}

function short(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

const BAND_COPY = {
  quoting: {
    label: 'Quoting',
    blurb: 'Under 5% refused. Their orders reach the book.',
    tone: 'text-emerald-700 dark:text-emerald-400 border-emerald-500/25 bg-emerald-500/5',
  },
  mixed: {
    label: 'Mixed',
    blurb: 'Between 5% and 50% refused.',
    tone: 'text-amber-700 dark:text-amber-400 border-amber-500/25 bg-amber-500/5',
  },
  spraying: {
    label: 'Spraying',
    blurb: 'Over half refused. Most of what they send never rests.',
    tone: 'text-rose-700 dark:text-rose-400 border-rose-500/25 bg-rose-500/5',
  },
  unknown: {
    label: 'Not enough yet',
    blurb: 'Fewer than five polls so far, so no rate is shown.',
    tone: 'text-gray-600 dark:text-gray-400 border-gray-300/40 dark:border-gray-700 bg-gray-500/5',
  },
};

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

/** One open at a time, mounted once, hidden with CSS. See the note at the top
 *  of this file for where the rule comes from and why it matters. */
function Sections({ sections, mutedBorder }) {
  const [openKey, setOpenKey] = useState(sections[0]?.key ?? null);
  const [mounted, setMounted] = useState(
    () => new Set(sections[0]?.key ? [sections[0].key] : []),
  );
  const toggle = useCallback((key) => {
    setMounted((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    setOpenKey((prev) => (prev === key ? null : key));
  }, []);

  return (
    <div className="space-y-2">
      {sections.map(({ key, title, icon: Icon, note, badge, badgeTone, render }) => {
        const isOpen = openKey === key;
        return (
          <Card key={key} mutedBorder={mutedBorder} className="overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-expanded={isOpen}
              aria-controls={`hl-panel-${key}`}
              className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                {Icon && (
                  <span className="p-1.5 rounded-lg shrink-0 bg-[#97FCE4]/20">
                    <Icon size={15} className="text-[#0B7A66] dark:text-[#97FCE4]" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block font-bold text-sm text-gray-900 dark:text-gray-100">{title}</span>
                  {note && (
                    <span className="block text-[11px] text-gray-500 dark:text-gray-500 truncate">{note}</span>
                  )}
                </span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {badge && (
                  <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border ${badgeTone}`}>
                    {badge}
                  </span>
                )}
                <ChevronDown size={16} className={`opacity-50 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>
            {mounted.has(key) && (
              <div
                id={`hl-panel-${key}`}
                hidden={!isOpen}
                className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-gray-800/60 max-h-[62vh] overflow-y-auto"
              >
                {render()}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function ScrollTable({ mutedBorder, head, children }) {
  return (
    <div className={`overflow-x-auto rounded-xl border ${mutedBorder || 'border-gray-200 dark:border-gray-800'} mt-2`}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100 dark:border-gray-800">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function SourceRow({ icon: Icon, name, what, status, tone }) {
  return (
    <div className="flex items-start gap-2.5 py-2.5 border-b border-gray-100 dark:border-gray-800/60 last:border-0">
      <Icon size={15} className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-600" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{name}</span>
          <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border ${tone}`}>{status}</span>
        </div>
        <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400 mt-0.5">{what}</p>
      </div>
    </div>
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
  const ws = data.ws_coverage || {};
  const bands = data.bands || {};
  const makers = data.makers || [];
  const markets = data.markets || [];
  const statuses = data.statuses || [];
  const thin = (cov.hours_covered || 0) < 24;
  const wsLive = (ws.updates || 0) > 0;

  return (
    <div className="space-y-5">

      {/* The agent itself. */}
      <Card mutedBorder={mutedBorder} className="p-4 sm:p-5">
        <div className="flex items-start gap-4 sm:gap-5">
          <img
            src="/hypurr-agent.png"
            alt="Hypurr, Hyperliquid's mascot, shown as this tab's agent"
            width={560} height={623}
            className="w-20 sm:w-28 h-auto shrink-0 select-none pointer-events-none"
            loading="eager"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">
                The market maker watcher
              </h2>
              <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border border-[#97FCE4]/40 bg-[#97FCE4]/10 text-[#0B7A66] dark:text-[#97FCE4]">
                Hyperliquid
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-400 mt-1.5">
              It watches the 50 busiest traders on Hyperliquid and checks whether the orders
              they send actually make it onto the order book. Some of them place orders the
              exchange turns away almost every time, which looks like activity but adds
              nothing for anyone trying to trade.
            </p>
            <p className="text-[12px] leading-relaxed text-gray-500 dark:text-gray-500 mt-1.5">
              It reports what it has seen. It does not give advice, and it does not know
              whether any of these traders make money.
            </p>
          </div>
        </div>
      </Card>

      {/* Question one, at a glance. */}
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-2">
          What the tracked makers are doing
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {['quoting', 'mixed', 'spraying', 'unknown'].map((k) => {
            const c = BAND_COPY[k];
            return (
              <div key={k} className={`rounded-xl border p-3 ${c.tone}`}>
                <div className="text-2xl font-bold tabular-nums leading-none">{bands[k] ?? 0}</div>
                <div className="text-[12px] font-semibold mt-1">{c.label}</div>
                <div className="text-[11px] leading-snug opacity-80 mt-0.5">{c.blurb}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Question two, at a glance. */}
      <div className="p-3 rounded-xl border border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-400 text-[12px] flex items-start gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <div className="min-w-0 leading-relaxed">
          <span className="font-semibold">
            {thin ? 'How much to trust this yet: not much.' : 'Coverage'}
          </span>{' '}
          {cov.hours_covered ?? 0} hours of observation, {(cov.polls ?? 0).toLocaleString()} polls
          across {cov.addresses ?? 0} makers.
          {' '}Hyperliquid serves only the 2,000 most recent orders per address and cannot be asked
          for older ones, so this history begins when collection began and grows from there.
          {cov.polls_with_gap > 0 && (
            <> {cov.polls_with_gap} polls had a gap, meaning orders happened between two polls that
            no poll saw. Those count as missing rather than as zero.</>
          )}
        </div>
      </div>

      <Sections
        mutedBorder={mutedBorder}
        sections={[
          {
            key: 'memory',
            title: 'Memory',
            icon: Database,
            note: 'What it has collected so far',
            badge: `${(cov.orders_observed ?? 0).toLocaleString()} orders`,
            badgeTone: 'border-[#97FCE4]/40 bg-[#97FCE4]/10 text-[#0B7A66] dark:text-[#97FCE4]',
            render: () => (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    ['Orders seen', (cov.orders_observed ?? 0).toLocaleString()],
                    ['Polls', (cov.polls ?? 0).toLocaleString()],
                    ['Makers', cov.addresses ?? 0],
                    ['Polls with a gap', cov.polls_with_gap ?? 0],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-gray-200 dark:border-gray-800 p-2.5">
                      <div className="text-[15px] font-bold tabular-nums text-gray-900 dark:text-gray-100">{v}</div>
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-500 mt-0.5">{k}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">By market</h4>
                  <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">
                    Pooled across every tracked maker. A high rate means the book is moving faster
                    than makers can quote it.
                  </p>
                  <ScrollTable mutedBorder={mutedBorder} head={<>
                    <Th align="left">Market</Th><Th>Post-only</Th><Th>Refused</Th><Th>Rate</Th><Th>Makers</Th>
                  </>}>
                    {markets.map((m) => (
                      <tr key={m.coin} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                        <Td align="left" strong>{m.coin}</Td>
                        <Td>{m.alo_total.toLocaleString()}</Td>
                        <Td>{m.alo_rejected.toLocaleString()}</Td>
                        <Td strong>{pct(m.post_only_rejection_rate) ?? 'n/a'}</Td>
                        <Td>{m.makers}</Td>
                      </tr>
                    ))}
                  </ScrollTable>
                </div>

                <div>
                  <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">By maker</h4>
                  <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">
                    The 50 highest-volume addresses. Below roughly this rank the median address
                    posts no resting orders at all, so there is nothing of this kind to measure.
                  </p>
                  <ScrollTable mutedBorder={mutedBorder} head={<>
                    <Th align="left">Address</Th><Th>Post-only</Th><Th>Refused</Th>
                    <Th>Rejection rate</Th><Th>Cancel / fill</Th><Th>Fill rate</Th><Th>Polls</Th>
                  </>}>
                    {makers.map((m) => (
                      <tr key={m.address} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                        <td className="px-3 py-2 text-left whitespace-nowrap">
                          <a href={`https://app.hyperliquid.xyz/explorer/address/${m.address}`}
                             target="_blank" rel="noreferrer"
                             className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">
                            {short(m.address)}
                          </a>
                        </td>
                        <Td>{m.alo_total.toLocaleString()}</Td>
                        <Td>{m.alo_rejected.toLocaleString()}</Td>
                        <Td strong>
                          {m.enough_data ? (pct(m.post_only_rejection_rate) ?? 'n/a')
                            : <span className="font-normal text-gray-400 dark:text-gray-600">not enough yet</span>}
                        </Td>
                        <Td>{m.cancel_to_fill != null ? m.cancel_to_fill.toFixed(1) : 'n/a'}</Td>
                        <Td>{pct(m.effective_fill_rate) ?? 'n/a'}</Td>
                        <Td className="text-gray-400 dark:text-gray-600">{m.polls}</Td>
                      </tr>
                    ))}
                  </ScrollTable>
                </div>

                <div>
                  <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
                    Why the obvious query finds almost nothing
                  </h4>
                  <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">
                    Hyperliquid reports outcomes as distinct typed statuses. A plain
                    <code className="mx-1 rounded bg-gray-100 dark:bg-gray-800 px-1 text-[11px]">rejected</code>
                    status exists but covers a minority of refusals, so asking only for it misses
                    every post-only rejection.
                  </p>
                  <ScrollTable mutedBorder={mutedBorder} head={<>
                    <Th align="left">Status</Th><Th>Count</Th><Th>Share</Th><Th align="right"> </Th>
                  </>}>
                    {statuses.map((s) => (
                      <tr key={s.status} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                        <td className="px-3 py-2 font-mono text-[11px] text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {s.status}
                        </td>
                        <Td>{s.n.toLocaleString()}</Td>
                        <Td className="text-gray-500 dark:text-gray-500">{pct(s.share, 1)}</Td>
                        <td className="px-3 py-2 text-right">
                          {s.is_rejection && (
                            <span className="rounded-full border border-amber-500/25 bg-amber-500/5 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
                              never reached the book
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </ScrollTable>
                </div>

                <div className="pt-1">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <Info size={14} className="text-gray-500 dark:text-gray-500" />
                    <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">What these numbers mean</h4>
                  </div>
                  <dl className="space-y-2">
                    {DEFINITIONS.map((d) => (
                      <div key={d.term}>
                        <dt className="text-[12px] font-semibold text-gray-800 dark:text-gray-200">{d.term}</dt>
                        <dd className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">{d.text}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            ),
          },
          {
            key: 'workspace',
            title: 'Workspace',
            icon: Radio,
            note: 'What it can reach',
            badge: wsLive ? 'Two feeds live' : 'One feed live',
            badgeTone: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
            render: () => (
              <div className="pt-2">
                <SourceRow
                  icon={Database} name="Info endpoint" status="Connected"
                  tone="border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                  what={`Order history for any address, polled every 15 minutes. It serves the
                         2,000 most recent records and ignores any date range asked of it, so it
                         cannot be used to fill in the past. ${(cov.polls ?? 0).toLocaleString()}
                         polls so far.`}
                />
                <SourceRow
                  icon={wsLive ? Wifi : WifiOff} name="Order updates feed"
                  status={wsLive ? 'Streaming' : 'Idle'}
                  tone={wsLive
                    ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                    : 'border-gray-300/40 dark:border-gray-700 bg-gray-500/5 text-gray-600 dark:text-gray-400'}
                  what={`A live stream of every order outcome, bucketed into ${ws.bucket_seconds ?? 10}
                         second windows. It watches ${ws.addresses ?? 0} of the makers, which is the
                         most the exchange allows from one connection point, and has recorded
                         ${(ws.updates ?? 0).toLocaleString()} outcomes over
                         ${ws.hours_covered ?? 0} hours. This feed leaves out the field that says
                         whether an order was post-only, so its totals answer a narrower question
                         than the ones above and are never added to them.`}
                />
                <SourceRow
                  icon={Database} name="Reservoir historical archive" status="Not connected"
                  tone="border-gray-300/40 dark:border-gray-700 bg-gray-500/5 text-gray-600 dark:text-gray-400"
                  what="Order book snapshots and price history going back to July 2025, which is
                        the only source here that can describe the past rather than the present.
                        It is published on requester-pays storage, so reaching it needs billing
                        credentials this project does not have yet."
                />
              </div>
            ),
          },
          {
            key: 'brain',
            title: 'Brain',
            icon: Brain,
            note: 'Not built',
            badge: BRAIN_STATE === 'no-signal' ? 'Ruled out' : 'Empty',
            badgeTone: 'border-gray-300/40 dark:border-gray-700 bg-gray-500/5 text-gray-600 dark:text-gray-400',
            render: () => (
              <div className="pt-3 pb-1">
                <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-5 text-center">
                  <Brain size={22} className="mx-auto text-gray-300 dark:text-gray-700" />
                  {BRAIN_STATE === 'waiting' && (
                    <>
                      <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-300 mt-2">
                        There is nothing here yet, and that is deliberate.
                      </p>
                      <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400 mt-1.5 max-w-xl mx-auto">
                        For this agent to suggest anything, one thing has to be true: what happened
                        a moment ago has to tell you something about what happens next. That is
                        being tested now on the live feed, over a full night of data.
                      </p>
                      <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400 mt-1.5 max-w-xl mx-auto">
                        The first attempt, on the slower fifteen-minute data, found the opposite of
                        what a recommendation would need. A suggestion built on that would be worse
                        than no suggestion, so none is shown until the faster data settles it.
                      </p>
                    </>
                  )}
                  {BRAIN_STATE === 'no-signal' && (
                    <>
                      <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-300 mt-2">
                        Tested, and there is nothing to recommend.
                      </p>
                      <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400 mt-1.5 max-w-xl mx-auto">
                        What happened a moment ago does not predict what happens next, at any
                        resolution measured. This section stays empty because the data does not
                        support advice, not because the work is unfinished.
                      </p>
                    </>
                  )}
                </div>
              </div>
            ),
          },
        ]}
      />

      <div className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-500">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>
          This tab measures whether orders reach the book. It does not measure whether a maker is
          profitable, and a low rejection rate is not a recommendation.
        </span>
      </div>
    </div>
  );
}
