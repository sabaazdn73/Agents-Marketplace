// dashboard/portfolio.js
//
// The Dashboard's summary, derived from one answer: POST /api/wallet/holdings
// (wallet/useEquityHoldings.js; shape in te/api.js). Pure, no read of its
// own. Every dollar figure here is a sum of rows that carry a value in that
// answer, each with its own source; nothing is estimated, and a row without
// a value is counted as "not valued", never as zero.
//
// Vaults are not in the answer: the vaults Tnega lists are on Solana, and the
// Dashboard connects an EVM address, so vaults are "not checked" and never
// counted in the total or the allocation.

export const CLASSES = {
  stocks: { id: 'stocks', label: 'Stocks', empty: 'No stocks yet', fill: 'bg-cls-stocks', text: 'text-cls-stocks', tint: 'from-cls-stocks/15', ring: 'border-cls-stocks/35', ink: 'text-white' },
  etfs: { id: 'etfs', label: 'ETFs', empty: 'No ETFs yet', fill: 'bg-cls-etfs', text: 'text-cls-etfs', tint: 'from-cls-etfs/15', ring: 'border-cls-etfs/35', ink: 'text-white' },
  vaults: { id: 'vaults', label: 'Vaults', empty: 'Not checked', fill: 'bg-cls-vaults', text: 'text-cls-vaults', tint: 'from-cls-vaults/15', ring: 'border-cls-vaults/40', ink: 'text-black' },
  tokens: { id: 'tokens', label: 'Tokens', empty: 'No tokens yet', fill: 'bg-cls-tokens', text: 'text-cls-tokens', tint: 'from-cls-tokens/15', ring: 'border-cls-tokens/35', ink: 'text-black' },
  untyped: { id: 'untyped', label: 'Other listed', empty: 'None', fill: 'bg-cls-other', text: 'text-cls-other', tint: 'from-cls-other/15', ring: 'border-cls-other/40', ink: 'text-black' },
};

function total(rows) {
  const priced = rows.filter((r) => Number.isFinite(r.value_usd));
  return {
    usd: priced.length ? priced.reduce((a, r) => a + r.value_usd, 0) : null,
    rows: rows.length,
    priced: priced.length,
  };
}

/** Chains the read could not fully answer: failed ones, and read ones where
 *  some calls returned nothing. */
export function chainGaps(data) {
  const chains = data?.chains || [];
  return {
    failed: chains.filter((c) => c.status !== 'read'),
    unanswered: chains.filter((c) => c.status === 'read' && (c.versions_unanswered || c.tokens_unanswered)),
    read: chains.filter((c) => c.status === 'read'),
  };
}

export function isPartial(data) {
  if (!data) return false;
  const g = chainGaps(data);
  return data.status === 'partial' || !!data.coverage?.partial || g.failed.length > 0 || g.unanswered.length > 0;
}

/** Everything the summary cards show, from one holdings answer. */
export function derive(data) {
  if (!data) return null;
  const rows = {
    stocks: data.stocks || [],
    etfs: data.etfs || [],
    untyped: data.untyped || [],
    tokens: data.tokens || [],
  };
  const totals = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, total(v)]));
  const all = [...rows.stocks, ...rows.etfs, ...rows.untyped, ...rows.tokens];
  const overall = total(all);
  const slices = ['stocks', 'etfs', 'untyped', 'tokens']
    .filter((k) => totals[k].usd > 0)
    .map((k) => ({ id: k, label: CLASSES[k].label, usd: totals[k].usd }));
  const positions = [...all].sort((a, b) => {
    const av = Number.isFinite(a.value_usd), bv = Number.isFinite(b.value_usd);
    if (av !== bv) return av ? -1 : 1;
    return (b.value_usd || 0) - (a.value_usd || 0);
  });
  return {
    rows, totals, overall, slices, shares: shares(slices), positions,
    partial: isPartial(data), unavailable: data.status === 'unavailable', gaps: chainGaps(data),
  };
}

/** Whole-number percentages per slice that add up to exactly 100 (largest
 *  remainder), so the legend never shows 48% and 53%. */
export function shares(slices) {
  const sum = slices.reduce((a, s) => a + s.usd, 0);
  if (!(sum > 0)) return {};
  const raw = slices.map((s) => ({ id: s.id, exact: (s.usd / sum) * 100 }));
  const out = Object.fromEntries(raw.map((r) => [r.id, Math.floor(r.exact)]));
  let left = 100 - Object.values(out).reduce((a, v) => a + v, 0);
  [...raw].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))
    .forEach((r) => { if (left > 0) { out[r.id] += 1; left -= 1; } });
  return out;
}

/** The legend's text for one class: its whole-number share, except that a
 *  class with a value above zero never reads "0%" — under half a percent it
 *  reads "<1%". The other shares keep their largest-remainder rounding, so
 *  the numbers shown still add up to 100. */
export function shareText(share, usd) {
  const n = share ?? 0;
  if (n === 0 && usd > 0) return '<1%';
  return `${n}%`;
}

// LARGE AMOUNTS. From a million up, a figure is shown in compact notation
// with one decimal ($12.7M, $12.7B, $1.2T) so it fits its box at any width;
// the exact figure goes in the hover. Below a million nothing changes.
export const COMPACT_FROM = 1e6;
const UNITS = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M']];

/** "12.7B" for a number of a million or more, else null. Rounded to one
 *  decimal, half up; a value that rounds up to 1,000 of a unit moves to the
 *  next unit (999.96M is 1.0B). Past the trillions it stays in T. */
export function compactNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) < COMPACT_FROM) return null;
  const a = Math.abs(n);
  let i = UNITS.findIndex(([u]) => a >= u);
  let r = Math.round((a / UNITS[i][0]) * 10) / 10;
  if (r >= 1000 && i > 0) { i -= 1; r = Math.round((a / UNITS[i][0]) * 10) / 10; }
  const body = r.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${n < 0 ? '-' : ''}${body}${UNITS[i][1]}`;
}

/** "$12.7B" from a million dollars up, else null. */
export function compactUsd(v) {
  const c = compactNumber(v);
  return c == null ? null : (c.startsWith('-') ? `-$${c.slice(1)}` : `$${c}`);
}

/** The exact dollar figure, to the cent: "$12,716,140,365.33". */
export function exactUsd(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "Base and BNB Chain". */
export function listWords(xs) {
  if (!xs.length) return '';
  return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0];
}

// ── P/L (POST /api/wallet/trades; shape in te/api.js) ──────────────────────

/** The trades answer's positions by version key. */
export function pnlByKey(trades) {
  return Object.fromEntries((trades?.positions || []).map((p) => [p.key, p]));
}

/** "+$1.20", "−$0.01", "$0.00": a signed dollar figure, to the cent, compact
 *  from a million up. */
export function signedUsd(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  const c = compactUsd(Math.abs(v));
  const body = c || `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const cents = Math.round(Math.abs(v) * 100);
  if (cents === 0 && !c) return body;
  return `${v < 0 ? '−' : '+'}${body}`;
}

/** "+18.18%", "−0.26%". */
export function signedPct(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  const body = `${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  return v === 0 ? body : `${v < 0 ? '−' : '+'}${body}`;
}

/** A price per token: cents from $1 up, four significant digits below. */
export function priceUsd(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${v.toLocaleString('en-US', { maximumSignificantDigits: 4 })}`;
}

/** Green for a gain, red for a loss, muted for none. */
export function toneOf(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.round(v * 100) === 0) return 'text-muted';
  return v > 0 ? 'text-pos' : 'text-neg';
}

/** The trade read's chains: still being read, not read at all, failed. */
export function tradeGaps(trades) {
  const chains = trades?.chains || [];
  return {
    reading: chains.filter((c) => c.status === 'partial' || c.status === 'not_started'),
    notRead: chains.filter((c) => c.status === 'not_read'),
    failed: chains.filter((c) => c.status === 'failed'),
    gapped: chains.filter((c) => c.status === 'complete' && c.round_trip_ranges_not_searched > 0),
  };
}
