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
// collected. Workspace is what it can reach. Brain holds one measured result
// about the shape of the live feed's refusals, bounded by
// docs/hyperliquid-brain-spec.md, which decides what it may and may not say.
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
  AlertTriangle, Brain, ChevronDown, Database, ExternalLink, Info, Radio, Wifi, WifiOff,
} from 'lucide-react';
import { CHROME_EXTENSION_URL, CHROME_EXTENSION_NAME } from '../extensionLink';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';

// This is the switch for what the Brain section says. The three cases were
// written before the test ran so that a negative result had somewhere to land,
// and the negative case stays in the file now that the result came back
// positive: if the coefficient ever falls under three standard errors from
// zero for the whole set, the section reverts to 'no-signal' and that copy is
// used unchanged. It must never say "coming soon", and it must never carry a
// sample recommendation.
const BRAIN_STATE = 'ready'; // 'waiting' | 'no-signal' | 'ready'

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
    // Added 2026-09-18. A reader seeing 0.2% will reach for "this one is
    // better", and the number does not say that. The rate is a measure of
    // order behaviour, not of outcome, which is true by construction and
    // needs no data to assert.
    //
    // The second half now names a number. The venue's leaderboard carries
    // PnL, and joined against these rates the correlation is +0.013 by
    // Pearson and +0.118 by rank. An earlier version of this comment refused
    // to state that as a finding, on the grounds that the file's month PnL
    // exceeded its allTime PnL on 51.3% of rows and a correlation against a
    // measure that noisy is pulled toward zero regardless. That objection was
    // withdrawn on 2026-09-18: PnL is signed, and 87.9% of those rows simply
    // have a negative allTime figure. Checked against the venue's own
    // portfolio endpoint the file agrees to a median 0.17% of account value.
    // What limits the claim now is n, which is 30, not the source.
    // See collector.fetch_leaderboard.
    term: 'What the rate does not say',
    text: 'Whether the maker is any good, or making money. A low rate means its '
        + 'quotes reach the book, which is what quoting looks like, not a score. '
        + 'The tracked set contains addresses that quote cleanly and lose, and '
        + 'addresses that are refused constantly and gain. That is not an '
        + 'impression: across the 30 makers here that also appear on the '
        + 'venue\u2019s leaderboard, the correlation between this rate and their '
        + '30-day return is +0.013, which is no relationship at all. Nothing on '
        + 'this page measures profit, and a low rate should not be read as a '
        + 'proxy for it.',
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

/** The history behind one rate, drawn beside it.
 *
 *  WHY IT IS HERE AND NOT ON A VIEW OF ITS OWN
 *  A rate without its history is what this table previously invited a reader
 *  to misread: 0.27% could have been 0.27% all week or 40% yesterday, and
 *  nothing on the page distinguished them. The line belongs in the cell next
 *  to the number, because that is where the misreading happens.
 *
 *  A NULL IS A BREAK, NOT A FLOOR
 *  An hour in which the address posted no post-only orders comes back as null
 *  and the path stops there rather than dropping to the baseline. A maker
 *  that quit quoting for an hour did not achieve a 0% rejection rate, and a
 *  line that dips to zero says exactly that. The gaps are visible as gaps.
 *
 *  SCALED PER ROW, AND THAT IS SAID OUT LOUD
 *  Each line is scaled to its own maximum, so height compares a maker with
 *  itself over time and NOT with the maker above it. A shared scale would
 *  flatten every row against the one address at 95%. The tooltip carries the
 *  range so the shape is readable rather than merely decorative.
 */
function RateSparkline({ series }) {
  if (!series || !Array.isArray(series.rates) || series.rates.length < 2) return null;
  const rates = series.rates;
  const known = rates.filter((r) => r !== null && r !== undefined);
  if (known.length < 2) return null;

  const W = 84;
  const H = 20;
  const max = Math.max(...known);
  const min = Math.min(...known);
  const span = max - min || max || 1;
  const x = (i) => (i / (rates.length - 1)) * W;
  const y = (r) => H - 1 - ((r - min) / span) * (H - 2);

  // One path per unbroken run, so a gap leaves a gap.
  const runs = [];
  let run = [];
  rates.forEach((r, i) => {
    if (r === null || r === undefined) { if (run.length > 1) runs.push(run); run = []; return; }
    run.push(`${x(i).toFixed(1)},${y(r).toFixed(1)}`);
  });
  if (run.length > 1) runs.push(run);
  if (!runs.length) return null;

  const hours = rates.length;
  const title = `${hours} hours, ${pct(min)} to ${pct(max)}. `
    + `${rates.length - known.length} hour(s) with no post-only orders are drawn as gaps, not as zero. `
    + 'Scaled to this address only.';

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="inline-block align-middle"
         role="img" aria-label={title}><title>{title}</title>
      {runs.map((pts, i) => (
        <polyline key={i} points={pts.join(' ')} fill="none"
                  stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"
                  strokeLinecap="round" opacity="0.75" />
      ))}
    </svg>
  );
}

/** 30-day volume, the venue's figure, formatted short. */
function vol(v) {
  if (v === null || v === undefined) return 'n/a';
  const n = Number(v);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

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

// ---------------------------------------------------------------------------
// The Brain section
// ---------------------------------------------------------------------------
//
// What it may claim is set by docs/hyperliquid-brain-spec.md, which was
// written from the stored series. The short version, because a later editor
// will read this file before that document: the section may describe the
// behaviour of a measured series, and it may not describe the future of
// anything the reader owns. No sentence here names the reader's order, the
// reader's timing or the reader's position, none projects a rate forward, and
// the coefficient never appears without the window it was measured in.
//
// Everything the section renders arrives in the overview response under
// `brain`. Nothing is typed in. A measurement written into a component cannot
// go stale, and this one is known to move: the same coefficient came out at
// +0.36, +0.26 and +0.16 in three windows two days apart. If the endpoint
// omits a field, the figure that needed it is not drawn.
//
// The shape the endpoint has to return, field for field from section 5 of the
// specification:
//
//   brain: {
//     window_start, window_end      ISO 8601 UTC
//     window_hours                  number
//     bucket_seconds                int
//     min_updates_per_bucket        int
//     addresses_measured            int
//     addresses_watched             int
//     addresses_not_watched         int, optional
//     usable_buckets_min, usable_buckets_max   int
//     pairs_min                     int
//     standard_error                { min, max }, per address, 1/sqrt(pairs)
//     lag_seconds                   int, the lag the headline figure shows
//     median_r1                     number, median of the per-address values
//     denominator                   string
//     statistic                     string
//     excluded                      string[]
//     withheld_reason               string or null
//     decay                         [{ lag_seconds, median_r1, pairs_min }]
//     addresses                     [{ address, usable_buckets, pairs, r1,
//                                      standard_error, mean_ratio,
//                                      withheld_reason }]
//     denominator_control           { median_r1, addresses_higher,
//                                     addresses_total }, optional
//     magnitude_range               { min, max, windows }, optional
//     over_dispersion               { median, min, max, convention }, optional
//   }

// How old the measured window may be before the section changes what it says.
//
// THESE TWO NUMBERS ARE POLICY, NOT MEASUREMENT. Nothing in the data measures
// how long the clustering result survives. The only evidence on that question
// is that the coefficient moved from +0.16 to +0.36 across three windows
// inside two days, which says it moves, not how fast it decays. A later reader
// should not mistake either boundary for a finding.
//
// Age is taken from the end of the measured window, never from the last poll
// or the last bucket written. A collector that is running now says nothing
// about whether the window being quoted is current, which is the same lesson
// recorded above MAX_RECORD_AGE_SECONDS in the backend service.
const BRAIN_DATED_AFTER_SECONDS = 48 * 3600;
const BRAIN_WITHHELD_AFTER_SECONDS = 14 * 24 * 3600;

// A figure that arrives without these is not drawn. This is the rule the REST
// side already holds, and there is no reason for this section to hold a
// weaker one.
const BRAIN_REQUIRED_FIELDS = [
  'window_start', 'window_end', 'window_hours', 'bucket_seconds',
  'min_updates_per_bucket', 'addresses_measured', 'addresses_watched',
  'usable_buckets_min', 'usable_buckets_max', 'pairs_min', 'standard_error',
  'lag_seconds', 'median_r1', 'denominator', 'statistic', 'excluded',
  'withheld_reason',
];

// The denominator, carried in the label at every point of use rather than in a
// tooltip. It is not the denominator the rest of this tab uses: the feed omits
// the field that says whether an order was post-only, so this counts every
// order update of any kind. The two are never differenced, summed or put in
// one row, and the band names above (quoting, mixed, spraying) were fitted on
// the post-only denominator and do not apply here.
const WS_DENOMINATOR_LABEL = 'refused, as a share of all order updates';

const BRAIN_REASON_COPY = {
  not_watched:
    'Not on the live feed. The clustering result covers the addresses that '
    + 'were, and says nothing about this one in either direction.',
  no_buckets_yet:
    'On the feed, but no order updates have been recorded for it yet.',
  too_few_buckets:
    'Too few usable windows to form the pairs a coefficient is computed from, '
    + 'so none was computed.',
  no_complete_window:
    'No stretch where every window carries a coverage row, so silence in it '
    + 'cannot be told apart from a dropped subscription.',
  stale_window:
    'The window it was measured in is old enough that showing it as current '
    + 'would be showing an assumption as a measurement.',
  not_significant:
    'Measured, and the value sits under three standard errors from zero, so '
    + 'no value is shown for it.',
};

function missingBrainFields(b) {
  if (!b || typeof b !== 'object') return BRAIN_REQUIRED_FIELDS;
  return BRAIN_REQUIRED_FIELDS.filter((f) => {
    if (!(f in b)) return true;
    // withheld_reason is null in the ordinary case, so absence of a value is
    // not absence of the field.
    if (f === 'withheld_reason') return false;
    if (f === 'standard_error') {
      return !b[f] || !Number.isFinite(b[f].min) || !Number.isFinite(b[f].max);
    }
    if (f === 'excluded') return !Array.isArray(b[f]) || b[f].length === 0;
    return b[f] === null || b[f] === undefined;
  });
}

// Section 2.4 of the specification: a word in place of a bare coefficient,
// because the magnitude moved between windows while the direction held. This
// mapping is a presentation convention and not a finding.
function strengthWord(r1, se) {
  if (!Number.isFinite(r1) || !Number.isFinite(se) || se <= 0) return null;
  // Under three standard errors from zero the section withholds the word
  // rather than reaching for the weakest one.
  if (r1 <= 0 || r1 < 3 * se) return null;
  if (r1 < 0.20) return 'slight';
  if (r1 <= 0.45) return 'moderate';
  return 'strong';
}

function signed(v, digits = 3) {
  if (!Number.isFinite(v)) return null;
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
}

function lagText(seconds) {
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const m = seconds / 60;
  const shown = Number.isInteger(m) ? m : m.toFixed(1);
  return `${shown} minute${Number(shown) === 1 ? '' : 's'}`;
}

function utcStamp(iso) {
  if (!iso) return '';
  return `${String(iso).replace('T', ' ').replace(/(\.\d+)?Z?$/, '')}Z`;
}

function utcDate(iso) {
  return iso ? String(iso).slice(0, 10) : '';
}


function usd(v) {
  if (!Number.isFinite(v)) return 'n/a';
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 4 : 2 })}`;
}

function signedUsd(v) {
  if (!Number.isFinite(v)) return 'n/a';
  const sign = v < 0 ? '−' : '+';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** A rough age, for a status word rather than a measurement. Deliberately
 *  coarse: the point is "this stopped a while ago", not the exact minute. */
function relAge(seconds) {
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function brainAgeSeconds(windowEnd) {
  const t = Date.parse(windowEnd);
  return Number.isFinite(t) ? (Date.now() - t) / 1000 : null;
}

function FieldList({ rows }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 border-b border-gray-100 dark:border-gray-800/60 py-1">
          <dt className="text-[11px] font-mono text-gray-500 dark:text-gray-500 shrink-0">{k}</dt>
          <dd className="text-[11px] text-right text-gray-700 dark:text-gray-300 tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The negative result, kept in the file and used unchanged if the coefficient
 *  ever falls under three standard errors from zero for the whole set. */
function BrainNoSignal() {
  return (
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
  );
}

function BrainReady({ brain, mutedBorder }) {
  const b = brain;
  const age = brainAgeSeconds(b.window_end);
  const dated = age !== null && age > BRAIN_DATED_AFTER_SECONDS;
  // The largest of the per-address standard errors, so the significance test
  // behind the word is the one the thinnest address would have had to pass.
  const word = strengthWord(b.median_r1, b.standard_error.max);
  const decay = Array.isArray(b.decay) ? b.decay : [];
  const rows = Array.isArray(b.addresses) ? b.addresses : [];
  // Read off the rows rather than written into the sentence. The set the
  // endpoint returns changes with the watch list, and a count typed in here
  // would keep reading as a measurement after it stopped being one.
  const withheldCount = rows.filter((r) => r.withheld_reason).length;
  const ratios = rows.map((r) => r.mean_ratio).filter((x) => Number.isFinite(x));
  const ratioSpread = ratios.length > 1
    ? `${pct(Math.min(...ratios))} to ${pct(Math.max(...ratios))}`
    : null;
  // The longest gap whose median clears three standard errors at that gap.
  // Null when none does, and the heading then claims nothing about distance.
  const lastClear = [...decay].reverse().find(
    (d) => Number.isFinite(d.standard_error)
      && Math.abs(d.median_r1) >= 3 * d.standard_error) || null;
  const ctl = b.denominator_control;
  const disp = b.over_dispersion;
  const mag = b.magnitude_range;

  return (
    <div className="pt-3 space-y-5">

      {/* The window dates are in the first sentence a reader meets, not in a
          tooltip, because the result is one window and nothing else. */}
      {dated && (
        <p className="text-[12px] leading-relaxed rounded-xl border border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-400 p-3">
          Measured over {b.window_hours} hours on {utcDate(b.window_start)} and not
          re-measured since. What follows describes that window. Whether it still
          describes the feed today has not been tested.
        </p>
      )}

      <div>
        <h4 className="text-[14px] font-bold text-gray-900 dark:text-gray-100">
          {dated
            ? 'Refusals arrived in stretches rather than at random.'
            : 'Refusals arrive in stretches rather than at random.'}
        </h4>
        <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400 mt-1">
          Measured over {b.window_hours} hours on {utcDate(b.window_start)}.{' '}
          {b.addresses_measured} addresses, {b.usable_buckets_min.toLocaleString()} to{' '}
          {b.usable_buckets_max.toLocaleString()} {b.bucket_seconds}-second windows each.
        </p>
        <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400 mt-1.5">
          When one {b.bucket_seconds}-second window {dated ? 'was refusing' : 'is refusing'} more
          than that address usually {dated ? 'did' : 'does'}, the next one{' '}
          {dated ? 'tended' : 'tends'} to as well.
        </p>
      </div>

      {/* The figure, with the window, the pair count and the standard error
          beside it rather than in a tooltip. A number alone here would assert
          a stability across windows that has not been measured, which is why
          the word leads and the value follows it. */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
        <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-500">
          How much one {b.bucket_seconds}-second window repeats in the next, at a gap of {lagText(b.lag_seconds)}
        </div>
        <div className="flex items-baseline gap-2 flex-wrap mt-1">
          <span className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {word || 'not shown at this window'}
          </span>
          <span className="text-[12px] tabular-nums text-gray-600 dark:text-gray-400">
            median of {b.addresses_measured} within-address values, {signed(b.median_r1)}
          </span>
        </div>
        <div className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-500 mt-1.5">
          {b.statistic}. Lag {b.lag_seconds} seconds. At least {b.pairs_min.toLocaleString()} contiguous
          pairs per address, standard error {b.standard_error.min.toFixed(4)} to{' '}
          {b.standard_error.max.toFixed(4)}, one per address and never pooled. Window{' '}
          {utcStamp(b.window_start)} to {utcStamp(b.window_end)}. The quantity counted is{' '}
          {WS_DENOMINATOR_LABEL}.
        </div>
        {word && (
          <div className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">
            The word describes the correlation between one window and the next. It is not a
            recommendation.
          </div>
        )}
      </div>

      {decay.length > 0 && (
        <div>
          {/* The heading names the longest gap whose median clears three
              standard errors AT THAT GAP, not the longest row in the table.
              A decay row has its own pair count and its own error: at 30
              minutes the thinnest address has fewer pairs than at 10 seconds,
              so the bar is higher there and the median can fail it. Reading
              "still visible at 30 minutes" off the last row asserted at the
              weakest point of the table exactly what the word "slight" is
              withheld for at the strongest one. */}
          <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
            The effect fades with distance: strongest at {lagText(decay[0].lag_seconds)}
            {lastClear
              ? `, still visible at ${lagText(lastClear.lag_seconds)}`
              : ''}
            .
          </h4>
          <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">
            Each row is the median of the {b.addresses_measured} within-address values at that gap,
            over the same window, with the standard error at that gap beside it. A row describes
            pairs that were observed. It is not a length of time a value holds for. A row marked
            under three standard errors is shown and not read as an effect: it is a measurement
            that came back too small to tell from zero, which is not the same as a zero.
          </p>
          <ScrollTable mutedBorder={mutedBorder} head={<>
            <Th align="left">Gap between the two windows</Th>
            <Th>Median across {b.addresses_measured}</Th>
            <Th>SE at that gap</Th>
            <Th>Smallest pair count</Th>
            <Th>Clearing 3 SE</Th>
          </>}>
            {decay.map((d) => {
              const clears = Number.isFinite(d.standard_error)
                && Math.abs(d.median_r1) >= 3 * d.standard_error;
              return (
                <tr key={d.lag_seconds} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                  <Td align="left" strong>{lagText(d.lag_seconds)}</Td>
                  <Td strong={clears} className={clears ? '' : 'text-gray-400 dark:text-gray-600'}>
                    {signed(d.median_r1)}
                    {clears ? '' : ' (under 3 SE)'}
                  </Td>
                  <Td className="text-gray-400 dark:text-gray-600">
                    {Number.isFinite(d.standard_error) ? d.standard_error.toFixed(4) : 'not recorded'}
                  </Td>
                  <Td className="text-gray-400 dark:text-gray-600">{(d.pairs_min ?? 0).toLocaleString()}</Td>
                  <Td className="text-gray-400 dark:text-gray-600">
                    {Number.isFinite(d.addresses_significant)
                      ? `${d.addresses_significant} of ${d.addresses_total}`
                      : 'not recorded'}
                  </Td>
                </tr>
              );
            })}
          </ScrollTable>
        </div>
      )}

      {rows.length > 0 && (
        <div>
          <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
            Address by address
          </h4>
          <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">
            Every address that was on the feed for this window, including{' '}
            {withheldCount > 0
              ? `the ${withheldCount === 1 ? 'one' : withheldCount} no figure could be computed for`
              : 'any no figure could be computed for'}
            . The {b.addresses_measured} are not pooled into a single series
            {ratioSpread
              ? `: their refused shares run from ${ratioSpread}, and pooling`
              : ': pooling'}
            {' '}would mix the difference between addresses into a figure about each address&apos;s
            own series.
          </p>
          <ScrollTable mutedBorder={mutedBorder} head={<>
            <Th align="left">Address</Th>
            <Th>Usable {b.bucket_seconds}s windows</Th>
            <Th>Pairs</Th>
            <Th>At {lagText(b.lag_seconds)}</Th>
            <Th>Standard error</Th>
            {/* The denominator rides in the column label rather than in a
                tooltip, so it wraps rather than widening the table past the
                right side of the panel and taking its own values with it. */}
            <Th>
              <span className="inline-block whitespace-normal w-32 leading-tight">
                Refused, as a share of all order updates
              </span>
            </Th>
          </>}>
            {rows.map((r) => {
              const reason = r.withheld_reason;
              return (
                <tr key={r.address} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0 align-top">
                  <td className="px-3 py-2 text-left whitespace-nowrap">
                    <a href={`https://app.hyperliquid.xyz/explorer/address/${r.address}`}
                       target="_blank" rel="noreferrer"
                       className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">
                      {short(r.address)}
                    </a>
                  </td>
                  <Td>{Number.isFinite(r.usable_buckets) ? r.usable_buckets.toLocaleString() : 'not recorded'}</Td>
                  <Td>{Number.isFinite(r.pairs) ? r.pairs.toLocaleString() : 'not recorded'}</Td>
                  {reason ? (
                    <td colSpan={3} className="px-3 py-2 text-left text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                      <span className="font-mono text-[10px] text-gray-500 dark:text-gray-500">{reason}</span>
                      {': '}
                      {BRAIN_REASON_COPY[reason] || 'No value is shown for this address.'}
                    </td>
                  ) : (
                    <>
                      <Td strong>{signed(r.r1)}</Td>
                      <Td>{Number.isFinite(r.standard_error) ? r.standard_error.toFixed(4) : 'not recorded'}</Td>
                      <Td className="font-mono">
                        {Number.isFinite(r.mean_ratio) ? r.mean_ratio.toFixed(4) : 'not recorded'}
                      </Td>
                    </>
                  )}
                </tr>
              );
            })}
          </ScrollTable>
        </div>
      )}

      <div className="space-y-2">
        {/* What the response carries about the control is a median and a
            count. It carries no per-address value, so no sentence here may
            describe one: the earlier wording said the remaining address was
            level, which was true of the window it was written in and was not
            in the payload. The count says how many the comparison holds at,
            and the rest of the sentence says only that it is not all of
            them. */}
        {ctl && Number.isFinite(ctl.median_r1) && (
          <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
            This was tested on order volume as well, and volume clusters more than the refused
            share does, so the clustering is not only an effect of how busy the address is. That
            holds at {ctl.addresses_higher} of {ctl.addresses_total} addresses and at the median,
            {' '}{signed(ctl.median_r1)} against {signed(b.median_r1)}.
            {ctl.addresses_higher < ctl.addresses_total
              ? ctl.addresses_total - ctl.addresses_higher === 1
                ? ' At the remaining address volume is not the more persistent of the two, so the'
                  + ' comparison is not unanimous and is not cited as though it were.'
                : ` At the remaining ${ctl.addresses_total - ctl.addresses_higher} addresses volume`
                  + ' is not the more persistent of the two, so the comparison is not unanimous and'
                  + ' is not cited as though it were.'
              : ''}
          </p>
        )}

        {/* "Every address" is checked against the count the endpoint sends
            rather than asserted. The multiple is computed per address and an
            address can fail to produce one, so the population behind the word
            travels with it, and the word itself is only used when the smallest
            multiple is above the floor. */}
        {disp && Number.isFinite(disp.median) && (
          <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
            The variation between windows is larger than counting noise alone would produce:{' '}
            {disp.min > 1
              ? `all ${disp.addresses ?? b.addresses_measured} addresses the multiple was computed`
                + ' for exceed the binomial floor'
              : `${disp.addresses ?? b.addresses_measured} addresses have a multiple against the`
                + ' binomial floor, and not all of them exceed it'}
            , by {disp.median.toFixed(1)} times at the median and
            from {disp.min.toFixed(2)} to {disp.max.toFixed(1)} times across the set, with the floor
            taken as {disp.convention}. The multiple moves with that convention, so it is reported
            with it rather than on its own.
            {Number.isFinite(disp.addresses) && Number.isFinite(disp.addresses_total)
              && disp.addresses < disp.addresses_total
              ? ` No multiple could be computed for ${disp.addresses_total - disp.addresses} of`
                + ` the ${disp.addresses_total}, and those are not counted either way.`
              : ''}
          </p>
        )}

        {/* Two branches, because one window and several windows support
            different sentences. The endpoint sends `magnitude_range` only
            when it has measured more than one complete window, and with one
            window there is no evidence here about how much the coefficient
            moves, only the general reason not to treat it as fixed. */}
        <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
          {mag && Number.isFinite(mag.min) && Number.isFinite(mag.max)
            ? `Direction only. The size of the effect differed between the ${mag.windows} windows `
              + `measured, from ${signed(mag.min, 2)} to ${signed(mag.max, 2)}, so no number here `
              + 'should be read as a constant.'
            : 'Direction only. This is one window, and it has not been measured against another '
              + 'one here, so nothing above should be read as a constant.'}
        </p>

        <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
          This describes the {b.addresses_measured} addresses on the live feed over one window,{' '}
          {utcDate(b.window_start)}. It does not describe the venue, and it does not describe any
          single order.
        </p>
      </div>

      {/* An address that was never on the feed is the ordinary case: the feed
          reaches ten addresses and the tab tracks fifty. That absence must not
          be drawn as a zero, a dash or an empty cell, any of which reads as a
          low rate. */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
        <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
          The addresses this says nothing about
        </h4>
        <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400 mt-1">
          The exchange permits a bounded number of subscriptions from one connection point.{' '}
          {b.addresses_watched} were used
          {Number.isFinite(b.addresses_not_watched)
            ? `, so the other ${b.addresses_not_watched} tracked addresses were never listened to`
            : ', and the rest of the tracked addresses were never listened to'}
          . That is a statement about the collector and not a fault of those addresses. The
          clustering result covers the {b.addresses_measured} addresses that were on the feed, and
          says nothing about the others in either direction.
        </p>
      </div>

      <div>
        <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
          What is left out of these figures
        </h4>
        <ul className="mt-1 space-y-1">
          {b.excluded.map((e) => (
            <li key={e} className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400 flex gap-2">
              <span aria-hidden="true" className="text-gray-400 dark:text-gray-600">·</span>
              <span>{e}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1.5">
          Each line is something dropped before the figures were computed. None of it was counted
          as a zero.
        </p>
      </div>

      <div>
        <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
          What travels with every number above
        </h4>
        <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed mb-1.5">
          Rendered here in full. A figure missing any of these is not drawn at all. The pair count
          and standard error below are the headline figure&apos;s, at a gap of{' '}
          {lagText(b.lag_seconds)}; every row of the decay table carries its own, because a longer
          gap has fewer pairs and a wider error than this one.
        </p>
        <FieldList rows={[
          ['window_start', utcStamp(b.window_start)],
          ['window_end', utcStamp(b.window_end)],
          ['window_hours', b.window_hours],
          ['bucket_seconds', b.bucket_seconds],
          ['min_updates_per_bucket', b.min_updates_per_bucket],
          ['addresses_measured', b.addresses_measured],
          ['addresses_watched', b.addresses_watched],
          ['usable_buckets_min', b.usable_buckets_min.toLocaleString()],
          ['usable_buckets_max', b.usable_buckets_max.toLocaleString()],
          ['pairs_min', b.pairs_min.toLocaleString()],
          ['standard_error', `${b.standard_error.min.toFixed(4)} to ${b.standard_error.max.toFixed(4)}, per address`],
          ['lag_seconds', b.lag_seconds],
          ['denominator', b.denominator],
          ['statistic', b.statistic],
          ['excluded', `${b.excluded.length} listed above`],
          ['withheld_reason', b.withheld_reason || 'none'],
        ]} />
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// On chain now
// ---------------------------------------------------------------------------
//
// The refusal rate this tab is built on is measured over hours of polling. This
// is where the same addresses stand at one HyperCore block, read through a
// contract this project deployed on HyperEVM. The pairing is the whole reason
// the section exists: a refusal rate is a fact about an attempt to quote, and a
// position is what that attempt was for, and nothing else shows them together.
//
// THE TWO CLOCKS ARE NEVER MERGED. Each row carries the age of the measurement
// behind its rate and the block behind its position, and no figure is computed
// across them. A ratio of one to the other would be a number about nothing.
function CoreSection({ core, state, mutedBorder }) {
  if (state === 'loading') {
    return (
      <p className="text-[12px] text-gray-500 dark:text-gray-500 py-2">
        Reading HyperCore through the contract on HyperEVM…
      </p>
    );
  }
  if (state === 'failed' || !core) {
    return (
      <p className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-400 py-2">
        The on-chain read did not answer. That is a failed request to HyperEVM, not a
        statement about any address: the rejection rates above are unaffected and were
        measured from a different source.
      </p>
    );
  }
  if (!core.served) {
    return (
      <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400 py-2">
        No reader contract is configured, so nothing was read from HyperCore. The
        rejection rates above do not depend on it.
      </p>
    );
  }

  const rows = core.rows || [];
  const markets = (core.markets_checked || []).join(', ');

  return (
    <div className="pt-3 space-y-4">
      <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
        Each maker that currently carries a rejection rate, with where it stands on
        HyperCore right now. The rate is measured over hours of polling; the position is
        one block old. They are shown in one row and never combined into one figure.
      </p>

      <ScrollTable mutedBorder={mutedBorder} head={<>
        <Th align="left">Address</Th>
        <Th>Refused, over hours</Th>
        <Th>Position, this block</Th>
        <Th>Entry</Th>
        <Th>Mark</Th>
        <Th>Unrealised</Th>
      </>}>
        {rows.map((r) => {
          const c = r.core || {};
          const positions = c.positions || [];
          const p = positions[0] || null;
          return (
            <tr key={r.address} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0 align-top">
              <td className="px-3 py-2 text-left whitespace-nowrap">
                <a href={`https://app.hyperliquid.xyz/explorer/address/${r.address}`}
                   target="_blank" rel="noreferrer"
                   className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">
                  {short(r.address)}
                </a>
              </td>
              <Td strong>{pct(r.post_only_rejection_rate)}</Td>
              {p ? (
                <>
                  <Td strong className={p.side === 'short'
                    ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                    {p.side === 'short' ? 'Short' : 'Long'}{' '}
                    {Math.abs(p.size).toLocaleString(undefined, { maximumFractionDigits: 4 })} {p.coin}
                  </Td>
                  <Td>{usd(p.entry_price)}</Td>
                  <Td>{usd(p.mark_price)}</Td>
                  <Td strong className={(p.unrealised_usd ?? 0) < 0
                    ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                    {signedUsd(p.unrealised_usd)}
                  </Td>
                </>
              ) : (
                <td colSpan={4} className="px-3 py-2 text-left text-[11px] leading-relaxed text-gray-500 dark:text-gray-500">
                  {c.account_found
                    ? `An account exists, with no position on ${markets}.`
                    : `Nothing found on ${markets}. Not the same as flat: an account that `
                      + 'closed out and withdrew everything reads exactly like one that never existed.'}
                </td>
              )}
            </tr>
          );
        })}
      </ScrollTable>

      <div className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-500 space-y-1">
        <p>
          Read through <a
            href={`https://hyperevmscan.io/address/${core.reader}`}
            target="_blank" rel="noreferrer"
            className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline">
            {short(core.reader)}
          </a>, a contract on HyperEVM, chain {core.chain_id}, which reads HyperCore's own
          precompiles. Its source is verified.
        </p>
        <p>
          {core.makers_read} of {core.makers_rated} rated makers were read, on {markets} only.
          A maker with no rejection rate is not listed here: half a pairing is not a reading.
        </p>
        <p>
          Sizes and prices come back in the asset's own scale and are converted by
          10<sup>(szDecimals − 6)</sup>. Unrealised is mark minus entry, times size, and is
          not a realised result.
        </p>
      </div>
    </div>
  );
}

function BrainSection({ brain, mutedBorder }) {
  if (BRAIN_STATE === 'waiting') {
    return (
      <div className="pt-3 pb-1">
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-5 text-center">
          <Brain size={22} className="mx-auto text-gray-300 dark:text-gray-700" />
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
        </div>
      </div>
    );
  }

  if (BRAIN_STATE === 'no-signal') {
    return (
      <div className="pt-3 pb-1">
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-5 text-center">
          <Brain size={22} className="mx-auto text-gray-300 dark:text-gray-700" />
          <BrainNoSignal />
        </div>
      </div>
    );
  }

  const missing = missingBrainFields(brain);
  if (missing.length) {
    // Not a reading of no clustering. The fields that have to travel with a
    // figure did not arrive, so no figure is drawn and the gap is named.
    return (
      <div className="pt-3 pb-1">
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-5 text-center">
          <Brain size={22} className="mx-auto text-gray-300 dark:text-gray-700" />
          <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-300 mt-2">
            The clustering result is not being served right now.
          </p>
          <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400 mt-1.5 max-w-xl mx-auto">
            This is not a reading of no clustering. A figure here is shown only with the window it
            was measured in, the pair count behind it and its standard error.{' '}
            {brain
              ? (
                <>
                  The response left out{' '}
                  <span className="font-mono text-[11px]">{missing.join(', ')}</span>, so nothing is
                  drawn in place of them.
                </>
              )
              : 'The response carried no measured window at all, so there is nothing here to draw.'}
          </p>
        </div>
      </div>
    );
  }

  // A null result keeps its place in this design. If the coefficient falls
  // under three standard errors from zero for the whole set, the negative copy
  // is what the section shows, unchanged.
  if (brain.withheld_reason === 'not_significant') {
    return (
      <div className="pt-3 pb-1">
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-5 text-center">
          <Brain size={22} className="mx-auto text-gray-300 dark:text-gray-700" />
          <BrainNoSignal />
        </div>
      </div>
    );
  }

  const age = brainAgeSeconds(brain.window_end);
  const stale = brain.withheld_reason === 'stale_window'
    || (age !== null && age > BRAIN_WITHHELD_AFTER_SECONDS);

  if (stale) {
    return (
      <div className="pt-3 pb-1">
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-5 text-center">
          <Brain size={22} className="mx-auto text-gray-300 dark:text-gray-700" />
          <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-300 mt-2">
            Nothing is shown here until the test is run again.
          </p>
          <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400 mt-1.5 max-w-xl mx-auto">
            The clustering result came from one window, {utcDate(brain.window_start)}, and has not
            been re-measured since. It is old enough that presenting it as current would be
            presenting an assumption as a measurement.
          </p>
        </div>
      </div>
    );
  }

  return <BrainReady brain={brain} mutedBorder={mutedBorder} />;
}

export default function HyperliquidView({ mutedBorder }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // The on-chain read is fetched separately and drawn when it arrives. It is
  // about five seconds of eth_calls against HyperEVM, and the overview is
  // already the slowest thing this tab asks for; putting them in one request
  // would let a slow chain delay the rate the page is actually about.
  const [core, setCore] = useState(null);
  const [coreState, setCoreState] = useState('loading'); // loading | ready | failed

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/hyperliquid/overview`)
      .then((r) => {
        if (!r.ok) throw new Error(`Backend returned ${r.status}`);
        return r.json();
      })
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });

    fetch(`${API_BASE_URL}/api/hyperliquid/core`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) { setCore(d); setCoreState('ready'); } })
      .catch(() => { if (!cancelled) setCoreState('failed'); });
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
  // WHETHER THE SECOND FEED IS LIVE, and it must be able to say no.
  //
  // This was `(ws.updates || 0) > 0`, an all-time sum of every order update
  // ever recorded, currently 70,048,426. It can never return to zero, so the
  // badge read "Streaming" for three hours after the collector died on
  // 2026-09-17 and would have read it forever. The instrument that exists to
  // report an outage could not report one.
  //
  // Age of the newest coverage row instead. WS_LIVE_AFTER_SECONDS IS POLICY,
  // NOT MEASUREMENT: the collector writes a coverage row every ten seconds
  // for every watched address, so ten minutes is forty missed writes, chosen
  // to be slow enough that a restart does not flicker and fast enough that a
  // dead night is visible in the morning.
  const WS_LIVE_AFTER_SECONDS = 600;
  const wsLastBucketAge = ws.coverage_last_bucket
    ? (Date.now() - Date.parse(ws.coverage_last_bucket)) / 1000
    : null;
  const wsLive = wsLastBucketAge !== null && wsLastBucketAge <= WS_LIVE_AFTER_SECONDS;

  // The Brain section's figures, exactly as the endpoint sent them. The
  // component decides what may be drawn, never what the values are.
  const brain = data.brain || null;
  const brainMissing = missingBrainFields(brain);
  const brainServed = BRAIN_STATE === 'ready' && brainMissing.length === 0;
  const brainAge = brainServed ? brainAgeSeconds(brain.window_end) : null;
  const brainStale = brainServed && (brain.withheld_reason === 'stale_window'
    || (brainAge !== null && brainAge > BRAIN_WITHHELD_AFTER_SECONDS));
  const brainNull = brainServed && brain.withheld_reason === 'not_significant';
  const brainShown = brainServed && !brainStale && !brainNull;

  // The badge says which of the four states the on-chain read is in, so a
  // reader knows whether an empty section is a failure, an absence of a
  // contract, or an answer.
  let coreBadge = 'Reading';
  let coreNote = 'Asking HyperEVM';
  if (coreState === 'failed') {
    coreBadge = 'Unavailable';
    coreNote = 'HyperEVM did not answer';
  } else if (coreState === 'ready' && core && !core.served) {
    coreBadge = 'No reader';
    coreNote = 'No contract configured';
  } else if (coreState === 'ready' && core) {
    const withPos = (core.rows || []).filter(
      (r) => ((r.core || {}).positions || []).length).length;
    coreBadge = 'Live';
    coreNote = `${withPos} of ${core.makers_read} holding a position`;
  }

  let brainBadge = 'Empty';
  let brainNote = 'Not built';
  if (BRAIN_STATE === 'no-signal' || brainNull) {
    brainBadge = 'Ruled out';
    brainNote = 'Tested, and nothing to recommend';
  } else if (BRAIN_STATE === 'ready' && !brainServed) {
    brainBadge = 'Not served';
    brainNote = 'No figures came back for this section';
  } else if (brainStale) {
    brainBadge = 'Withheld';
    brainNote = `One window, ${utcDate(brain.window_start)}, not re-measured since`;
  } else if (brainShown) {
    brainBadge = 'Measured';
    brainNote = `One window, ${utcDate(brain.window_start)}, ${brain.addresses_measured} addresses`;
  }

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
          across {cov.addresses_tracked ?? cov.addresses ?? 0} makers in the current set
          {Number.isFinite(cov.addresses) && Number.isFinite(cov.addresses_tracked)
            && cov.addresses > cov.addresses_tracked
            ? `, and ${cov.addresses} that have been polled at some point. The set is chosen on
               recent trading activity, so the other ${cov.addresses - cov.addresses_tracked} are
               not being polled now and what is stored for them stopped ageing when they left it`
            : ''}.
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
            badge: `${(cov.orders_observed ?? 0).toLocaleString()} orders, all time`,
            badgeTone: 'border-[#97FCE4]/40 bg-[#97FCE4]/10 text-[#0B7A66] dark:text-[#97FCE4]',
            render: () => (
              <div className="space-y-4 pt-2">
                {/* THESE ARE TOTALS SINCE COLLECTION BEGAN, and they say so.
                    They are not filtered to the addresses being polled now,
                    because a historical total is a legitimate thing to publish
                    and filtering one changes what it counts. What was wrong
                    was publishing them unlabelled beside figures that describe
                    now: "Makers 66" sat thirty lines under "31 makers in the
                    current set" and above a market table whose largest maker
                    count is 23, so one screen carried three different answers
                    to the same word. Each tile now carries its own period. */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    ['Orders recorded', (cov.orders_observed ?? 0).toLocaleString(), 'all time'],
                    ['Polls', (cov.polls ?? 0).toLocaleString(), 'all time'],
                    ['Addresses ever polled', cov.addresses ?? 0,
                      `${cov.addresses_tracked ?? 0} in the set now`],
                    ['Polls with a gap', cov.polls_with_gap ?? 0, 'all time'],
                  ].map(([k, v, period]) => (
                    <div key={k} className="rounded-xl border border-gray-200 dark:border-gray-800 p-2.5">
                      <div className="text-[15px] font-bold tabular-nums text-gray-900 dark:text-gray-100">{v}</div>
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-500 mt-0.5">{k}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-600 mt-0.5">{period}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">By market</h4>
                  {/* The distribution, not one number. A pooled rate on a book
                      where two addresses place most of the quotes is a
                      statement about those two: BTC pools to 57% while the
                      median of its makers is under half a percent and fifteen
                      of twenty-three sit under one percent. The pooled figure
                      is still here, named for what it is, in its own column at
                      the end. */}
                  <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">
                    The typical maker on each book, and the spread around it. The median is across
                    the addresses currently being polled, one value each and never pooled. The last
                    column pools every post-only order on the book instead, which is a different
                    question and answers it differently wherever a few addresses place most of the
                    quotes.
                  </p>
                  <ScrollTable mutedBorder={mutedBorder} head={<>
                    <Th align="left">Market</Th>
                    <Th>Median maker</Th>
                    <Th>Spread</Th>
                    <Th>Under 1%</Th>
                    <Th>Over 50%</Th>
                    <Th>Makers</Th>
                    <Th>All orders pooled</Th>
                  </>}>
                    {markets.map((m) => (
                      <tr key={m.coin} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                        <Td align="left" strong>{m.coin}</Td>
                        <Td strong>{pct(m.median_rejection_rate) ?? 'n/a'}</Td>
                        <Td className="text-gray-500 dark:text-gray-500">
                          {m.rate_min != null && m.rate_max != null
                            ? `${pct(m.rate_min, 2)} to ${pct(m.rate_max, 1)}`
                            : 'n/a'}
                        </Td>
                        <Td>{m.makers_under_one_percent ?? 0} of {m.makers}</Td>
                        <Td className={m.makers_over_half ? 'text-amber-600 dark:text-amber-400' : ''}>
                          {m.makers_over_half ?? 0}
                        </Td>
                        <Td>{m.makers}</Td>
                        <Td className="text-gray-500 dark:text-gray-500">
                          {pct(m.pooled_rejection_rate) ?? 'n/a'}
                        </Td>
                      </tr>
                    ))}
                  </ScrollTable>
                  <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1.5">
                    Where those two columns disagree sharply, a few addresses are placing most of
                    the quotes. On BTC the pooled figure moves by tens of points if either of two
                    addresses leaves the polled set, which happens when the set is rebuilt, so it
                    describes those addresses rather than the book.
                  </p>
                </div>

                <div>
                  <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">By maker</h4>
                  <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">
                    Chosen by the venue's own 30-day volume ranking, not by us, and ordered here
                    with the addresses currently being polled first. Below roughly this rank the
                    median address posts no resting orders at all, so there is nothing of this kind
                    to measure. Everything measured about them below is ours.
                  </p>
                  {/* The caveat these rows need, added 2026-09-18.

                      Some platforms route perps through this venue, so a row
                      here can be an account holding many customers rather than
                      one trader, and a 92% rejection rate means something
                      different for each. Checked against the venue's own API
                      across all 66 addresses ever polled: userRole reports two
                      of them as vaults, and approvedBuilders reports 16 as
                      submitting through a front-end, which is what a person
                      using an app looks like. The remaining 48 return an
                      ordinary account with no approved builder, which is what
                      a single trader looks like AND what a custodial account
                      holding many customers looks like. Nothing public
                      separates those two.

                      There is no per-fill builder attribution to fall back on:
                      userFills carries no builder field at all, read across
                      7,851 fills from 40 addresses. So this is a caveat rather
                      than a column. */}
                  <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed mt-1">
                    A row is an address, not a person. The rows marked Vault trade a strategy
                    with other people&apos;s deposits in it, so their rate describes that strategy.
                    Sixteen of the addresses ever polled submit through a front-end that charges a
                    builder fee, which is what a person using an app looks like. Every other row
                    returns an ordinary account, which is what a single trader looks like and also
                    what a platform holding many customers in one account looks like. The venue
                    publishes nothing that separates those two, so read an unmarked rate as the
                    behaviour of an account.
                  </p>
                  <ScrollTable mutedBorder={mutedBorder} head={<>
                    <Th align="left">Address</Th><Th>30d volume</Th><Th>Post-only</Th>
                    <Th>Refused</Th><Th>Rejection rate</Th><Th>Last 48h</Th>
                    <Th>Cancel / fill</Th><Th>Fill rate</Th><Th>Polls</Th>
                  </>}>
                    {makers.map((m) => (
                      <tr key={m.address} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                        <td className="px-3 py-2 text-left whitespace-nowrap">
                          <a href={`https://app.hyperliquid.xyz/explorer/address/${m.address}`}
                             target="_blank" rel="noreferrer"
                             className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">
                            {short(m.address)}
                          </a>
                          {/* The venue reports these as vaults. The caveat
                              below the table says some rows may be pooled
                              accounts rather than one trader; naming the two
                              it knows about is the difference between a
                              caveat and a disclosure. */}
                          {m.account_role === 'vault' && (
                            <span
                              title={`${m.vault_name || 'A vault'}: this address trades a strategy with other people's deposits in it, so the rate beside it describes that strategy rather than one person's trading.`}
                              className="ml-2 inline-block align-middle text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                            >
                              Vault{m.vault_name ? ` · ${m.vault_name}` : ''}
                            </span>
                          )}
                        </td>
                        {/* The venue's own 30-day figure, which orders this
                            table and was previously sent to the browser and
                            never shown. Volume is cumulative and unsigned, so
                            month never exceeds allTime, and it does not on any
                            of the 46,171 rows. The same test applied to PnL
                            proves nothing, because PnL is signed. */}
                        <Td className="text-gray-500 dark:text-gray-400"
                            title="The venue's own 30-day volume, from its public leaderboard. This is what chose these addresses and what orders this table.">
                          {vol(m.month_volume)}
                        </Td>
                        <Td>{m.alo_total.toLocaleString()}</Td>
                        <Td>{m.alo_rejected.toLocaleString()}</Td>
                        <Td strong>
                          {m.enough_data ? (pct(m.post_only_rejection_rate) ?? 'n/a')
                            : <span className="font-normal text-gray-400 dark:text-gray-600">not enough yet</span>}
                        </Td>
                        {/* A WITHHELD RATE STAYS WITHHELD, INCLUDING AS A PICTURE
                            The first version drew this whenever a series
                            existed, so 0x856c, whose rate is withheld as
                            stale_data, showed n/a in the cell beside a line of
                            hourly rates. That is the withheld figure published
                            at finer resolution, which is the same failure this
                            tab exists to avoid, rotated ninety degrees. If the
                            pooled rate is not trustworthy enough to print, the
                            hours composing it are not trustworthy enough to
                            draw. */}
                        <Td className="text-indigo-500 dark:text-indigo-400">
                          {m.enough_data && m.post_only_rejection_rate != null
                            ? <RateSparkline series={(data.rate_series || {})[m.address]} />
                            : null}
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
                    status exists on the venue and does not appear in the table below at all: none
                    of the addresses being polled now has produced one. Asking only for it would
                    find nothing here, and would miss every post-only rejection.
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
                  status={wsLive ? 'Streaming'
                    : wsLastBucketAge === null ? 'Never recorded'
                      : `Last wrote ${relAge(wsLastBucketAge)} ago`}
                  tone={wsLive
                    ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                    : 'border-gray-300/40 dark:border-gray-700 bg-gray-500/5 text-gray-600 dark:text-gray-400'}
                  what={`A live stream of every order outcome, bucketed into ${ws.bucket_seconds ?? 10}
                         second windows. It watches up to ${ws.watch_cap ?? 10} addresses at once,
                         which is what the exchange allows from one connection point, and
                         ${ws.addresses ?? 0} have produced rows across every run so far. It has
                         recorded ${(ws.updates ?? 0).toLocaleString()} outcomes over
                         ${ws.hours_covered ?? 0} hours of collection, spread across
                         ${ws.hours_span ?? 0} hours of clock. This feed leaves out the field that
                         says whether an order was post-only, so its totals answer a narrower
                         question than the ones above and are never added to them.`}
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
            note: brainNote,
            badge: brainBadge,
            badgeTone: 'border-gray-300/40 dark:border-gray-700 bg-gray-500/5 text-gray-600 dark:text-gray-400',
            render: () => <BrainSection brain={brain} mutedBorder={mutedBorder} />,
          },
          {
            key: 'core',
            title: 'On chain now',
            icon: Radio,
            note: coreNote,
            badge: coreBadge,
            badgeTone: 'border-gray-300/40 dark:border-gray-700 bg-gray-500/5 text-gray-600 dark:text-gray-400',
            render: () => <CoreSection core={core} state={coreState} mutedBorder={mutedBorder} />,
          },
        ]}
      />

      {/* The same measurement, where a reader is already looking at an
          address. The listing is published, so this is the store link to the
          item itself: the URL lives in ../extensionLink.js, which is the one
          place to correct it, and the Connect tab is where its state is said
          in words. */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/5 p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
          <span className="font-semibold text-gray-900 dark:text-gray-100">{CHROME_EXTENSION_NAME}</span>
          {' '}puts this measurement on the address page itself, at app.hyperliquid.xyz. It reads the
          address out of the URL and stores nothing.
        </div>
        <a
          href={CHROME_EXTENSION_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
        >
          Chrome Web Store <ExternalLink size={12} />
        </a>
      </div>

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
