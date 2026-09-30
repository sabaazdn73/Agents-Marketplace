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

/** "Base and BNB Chain". */
export function listWords(xs) {
  if (!xs.length) return '';
  return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0];
}
