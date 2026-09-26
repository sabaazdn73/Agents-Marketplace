// te/fixtures.dev.js
//
// DEVELOPMENT ONLY. Invented answers in the shapes te/api.js documents, so
// the pages can be laid out before the backend serves real ones. Nothing
// here is a measurement. The tickers (FOO, BAR, BAZ, QUX, ...) and every
// number are made up and round, and none repeats a figure from the launch
// film or the references: a fixture that looks like the film would pass for
// it in a screenshot.
//
// The numbers reconcile the way real ones must, and checkFixtures() below
// asserts it in the console when the fixtures load:
//   positions sum to the portfolio total; every allocation tab sums to it;
//   the change percentage is change / (total - change); qty x price =
//   value; P/L = value - buy-in; each list row's best cost is the minimum
//   over that instrument's fully filled versions.
//
// Loaded only when import.meta.env.DEV is true and VITE_TE_FIXTURES=1; a
// production build drops the import, and the build check greps the bundle
// for the marker below to prove it.

export const FIXTURE_MARKER = 'TNEGA_DEV_FIXTURE_7f3a';

const T = '2026-01-01T12:00:00Z';
const F = { _fixture: true, _marker: FIXTURE_MARKER, computed_at: T };

// Instruments: underlying, name, type, and its versions
// [symbol, issuer, chain, group, cost_bps at $1,000 | null, filled_fraction, pool_usd].
const UNIVERSE = [
  ['FOO', 'Foo Corp (dev)', 'stock', [
    ['FOOx', 'xStocks', 'Solana', 'nonevm', 10, 1, 500000],
    ['FOOc', 'Coinbase', 'Base', 'evm', 20, 1, 300000],
    ['FOOon', 'Ondo', 'Ethereum', 'evm', 30, 1, 200000],
    ['FOO', 'Robinhood', 'Robinhood Chain', 'evm', 40, 1, 100000],
    ['FOOB', 'bStocks', 'BNB Chain', 'evm', 90, 0.4, 400],
    ['FOOx', 'xStocks', 'Arbitrum', 'evm', null, 0, null],
  ]],
  ['BAR', 'Bar Industries (dev)', 'stock', [
    ['BARx', 'xStocks', 'Solana', 'nonevm', 20, 1, 400000],
    ['BARon', 'Ondo', 'Ethereum', 'evm', 50, 1, 100000],
  ]],
  ['BAZ', 'Baz Holdings (dev)', 'stock', [
    ['BAZc', 'Coinbase', 'Base', 'evm', 30, 1, 200000],
    ['BAZ', 'Robinhood', 'Robinhood Chain', 'evm', 60, 1, 50000],
  ]],
  ['QUX', 'Qux Group (dev)', 'stock', [
    ['QUX', 'Robinhood', 'Robinhood Chain', 'evm', 40, 1, 80000],
  ]],
  ['IDXA', 'Index Fund A (dev)', 'etf', [
    ['IDXAon', 'Ondo', 'Ethereum', 'evm', 10, 1, 900000],
    ['IDXAx', 'xStocks', 'Solana', 'nonevm', 20, 1, 600000],
  ]],
  ['IDXB', 'Index Fund B (dev)', 'etf', [
    ['IDXBx', 'xStocks', 'Solana', 'nonevm', 20, 1, 300000],
  ]],
];

const PAID = 100; // price per token at $1,000, a round made-up figure
const ELIG = { text: 'Not for US persons (dev fixture)', url: 'https://example.invalid/terms', read_on: '2026-01-01' };

function version(u, [symbol, issuer, chain, group, bps, filled, pool]) {
  return {
    key: `${chain}/${symbol}`, symbol, issuer, chain, group,
    cost_bps: bps, cost_usd: bps == null ? null : bps / 10,
    paid_per_token: bps == null ? null : PAID + bps / 10,
    filled_fraction: filled, pool_usd: pool, eligibility: ELIG,
    controls: { pause: 'not paused', freeze: 'denylist', burn: 'not established', upgrade: 'upgradeable' },
  };
}

/** The lowest-cost fully filled version, the row's "best". */
function best(vs) {
  const full = vs.filter((v) => v.filled_fraction >= 1 && Number.isFinite(v.cost_bps));
  return full.reduce((a, v) => (a == null || v.cost_bps < a.cost_bps ? v : a), null);
}

const spark = (seed) => Array.from({ length: 12 }, (_, i) => 100 + ((i * seed) % 5) - 2 + i * (seed % 2 ? 1 : -0.5));

function listRow([u, name, type, raw], i) {
  const vs = raw.map((r) => version(u, r));
  const b = best(vs);
  return {
    underlying: u, name, type, versions: vs.length, eligibility: ELIG,
    best: b && { key: b.key, symbol: b.symbol, issuer: b.issuer, chain: b.chain, group: b.group, paid_per_token: b.paid_per_token, cost_usd: b.cost_usd, cost_bps: b.cost_bps },
    spark: spark(i + 1),
  };
}

function groupOf(vs, group) {
  return group === 'all' ? vs : vs.filter((v) => v.group === group);
}

// Portfolio: made-up round numbers that reconcile.
const POSITIONS = [
  // symbol, name, issuer, chain, group, type, qty, price, buy_in
  ['FOOx', 'Foo Corp (dev)', 'xStocks', 'Solana', 'nonevm', 'Stocks', 20, 150, 2800],
  ['IDXAon', 'Index Fund A (dev)', 'Ondo', 'Ethereum', 'evm', 'ETFs', 10, 400, 4100],
  ['BAZc', 'Baz Holdings (dev)', 'Coinbase', 'Base', 'evm', 'Stocks', 50, 40, 1900],
  ['QUX', 'Qux Group (dev)', 'Robinhood', 'Robinhood Chain', 'evm', 'Stocks', 5, 200, null],
];
const TOTAL = 10000;
const CHANGE = 200;

function portfolio() {
  const positions = POSITIONS.map(([symbol, name, issuer, chain, group, type, qty, price, buyIn]) => {
    const value = qty * price;
    const pl = buyIn == null ? null : value - buyIn;
    return {
      key: `${chain}/${symbol}`, symbol, name, issuer, chain, group, type, qty,
      buy_in_usd: buyIn, buy_in_reason: buyIn == null ? 'bridged in: no purchase in this wallet\'s history (dev fixture)' : undefined,
      price_usd: price, value_usd: value, pl_usd: pl, pl_pct: pl == null ? null : Math.round((pl / buyIn) * 10000) / 100,
    };
  });
  const sumBy = (k) => Object.entries(positions.reduce((a, p) => ({ ...a, [p[k]]: (a[p[k]] || 0) + p.value_usd }), {})).map(([label, usd]) => ({ label, usd }));
  const chainTab = sumBy('group').map((x) => ({ ...x, label: x.label === 'evm' ? 'EVM' : 'Non-EVM' }));
  const series = (n) => Array.from({ length: n }, (_, i) => [Date.parse(T) - (n - 1 - i) * 3600e3, TOTAL - CHANGE + (CHANGE * i) / (n - 1) + (i % 3 === 1 && i < n - 1 ? 20 : 0)]);
  const priceGain = positions.reduce((a, p) => a + (p.pl_usd || 0), 0);
  return {
    ...F, total_usd: TOTAL, change_usd: CHANGE,
    change_pct: Math.round((CHANGE / (TOTAL - CHANGE)) * 10000) / 100,
    series: { '1D': series(24), '1W': series(28), '1M': series(30), YTD: series(30), '1Y': series(30), Max: series(30) },
    positions,
    allocation: { type: sumBy('type'), chain: chainTab, issuer: sumBy('issuer') },
    performance: {
      by_year: [{ year: 2024, pct: 3 }, { year: 2025, pct: -1 }, { year: 2026, pct: 2 }],
      price_gain_usd: priceGain, dividends_usd: 50, tx_costs_usd: -30, total_return_usd: priceGain + 50 - 30,
    },
    dividends: {
      received_usd: 50, yield_ttm_pct: Math.round((50 / TOTAL) * 10000) / 100,
      by_year: [{ year: 2025, usd: 20 }, { year: 2026, usd: 30 }],
      payments: [{ date: '2026-01-01', symbol: 'IDXAon', step: '1.000 to 1.003', usd: 30 }, { date: '2025-06-01', symbol: 'FOOx', step: '1.000 to 1.002', usd: 20 }],
    },
  };
}

const answers = {
  '/api/te/summary': () => {
    const chain_list = [
      { name: 'Ethereum', group: 'evm', tokens: 20 }, { name: 'Base', group: 'evm', tokens: 20 },
      { name: 'BNB Chain', group: 'evm', tokens: 20 }, { name: 'Robinhood Chain', group: 'evm', tokens: 10 },
      { name: 'Arbitrum', group: 'evm', tokens: 10 }, { name: 'Solana', group: 'nonevm', tokens: 20 },
    ];
    return { ...F, tokens: chain_list.reduce((a, c) => a + c.tokens, 0), issuers: 4, chains: chain_list.length, chain_list };
  },
  '/api/te/list': (q) => {
    const type = q.get('type') || 'stock';
    const group = q.get('group') || 'all';
    const rows = UNIVERSE.filter((u) => u[2] === type)
      .map(([u, name, t, raw], i) => listRow([u, name, t, raw.filter((r) => group === 'all' || r[3] === group)], i))
      .filter((r) => r.best);
    return { ...F, size: 1000, sort: q.get('sort') || 'popular', rows: rows.slice(0, Number(q.get('limit') || 50)) };
  },
  '/api/te/search': (q) => {
    const s = (q.get('q') || '').toLowerCase();
    const all = UNIVERSE.flatMap(([u, name, , raw]) => raw.map(([symbol, issuer, chain, group]) => ({ kind: 'instrument', underlying: u, key: `${chain}/${symbol}`, symbol, name, issuer, chain, group })));
    return { ...F, results: all.filter((r) => `${r.underlying} ${r.name} ${r.symbol}`.toLowerCase().includes(s)) };
  },
  '/api/te/underlying/FOO': () => {
    const [u, name, , raw] = UNIVERSE[0];
    return { ...F, ticker: u, name, size: 1000, versions: raw.map((r) => version(u, r)) };
  },
  '/api/te/curve/FOO': () => ({
    ...F, ticker: 'FOO', stops: [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000],
    chains: [
      ['Solana', 'nonevm', 'FOOx', 'xStocks', [10, 10, 10, 10, 20, 20, 30, 40, 60, 90, null]],
      ['Base', 'evm', 'FOOc', 'Coinbase', [20, 20, 20, 20, 20, 30, 30, 30, 40, 50, 80]],
      ['Ethereum', 'evm', 'FOOon', 'Ondo', [100, 60, 40, 30, 30, 30, 40, 40, 50, 70, 100]],
      ['BNB Chain', 'evm', 'FOOB', 'bStocks', [50, 50, 60, 90, null, null, null, null, null, null, null]],
    ].map(([chain, group, symbol, issuer, bps]) => ({ chain, group, symbol, issuer, bps, pool_usd: bps.map((b) => (b == null ? 400 : 100000)) })),
  }),
  '/api/te/controls': () => ({
    ...F,
    rows: [
      ['Robinhood', 'Robinhood', ['Robinhood Chain']],
      ['bStocks', 'bStocks', ['BNB Chain']],
      ['xStocks', 'xStocks', ['Solana', 'Arbitrum']],
      ['Ondo Global Markets', 'Ondo', ['Ethereum']],
    ].map(([programme, issuer, chains], i) => ({
      programme, issuer, chains,
      pause: { text: i % 2 ? 'single key (inferred)' : '2 of 3 multisig', state: 'not paused' },
      freeze: { text: 'denylist' },
      burn: { text: i === 2 ? 'permanent delegate, 2 of 3' : 'not established' },
      upgrade: { text: i === 3 ? 'TimelockController, 1 h' : 'beacon owner' },
      who_may_hold: ELIG,
    })),
  }),
  '/api/baskets/curated': () => ({
    ...F, note: 'A fixed example basket, equal or stated weights; not a recommendation.',
    baskets: [
      { name: 'Dev basket one', code: 'dev1', legs: [['FOO', 'FOOx', 5000], ['BAR', 'BARx', 5000]].map(([ticker, symbol, weight_bps]) => ({ ticker, symbol, weight_bps })), cost_bps_1k: 20, signatures: 2, evm: 0, nonevm: 2, cap_usd: 10000, cap_leg: 'BAR' },
      { name: 'Dev basket two', code: 'dev2', legs: [['IDXA', 'IDXAon', 5000], ['BAZ', 'BAZc', 3000], ['QUX', 'QUX', 2000]].map(([ticker, symbol, weight_bps]) => ({ ticker, symbol, weight_bps })), cost_bps_1k: 30, signatures: 3, evm: 3, nonevm: 0, cap_usd: 5000, cap_leg: 'QUX' },
      { name: 'Dev basket three', code: 'dev3', legs: [['IDXB', 'IDXBx', 10000]].map(([ticker, symbol, weight_bps]) => ({ ticker, symbol, weight_bps })), cost_bps_1k: 20, signatures: 1, evm: 0, nonevm: 1, cap_usd: 20000, cap_leg: 'IDXB' },
    ],
  }),
  '/api/vaults': () => ({
    ...F,
    vaults: [
      { name: 'Dev vault A', platform: 'Kamino', chain: 'Solana', group: 'nonevm', manager: '2 of 3 multisig', audits: '2 audits', assets: 'USDC', controls: 'upgrade authority: multisig', tvl_usd: 1000000, tvl_slot: 100000000, fees: '10% performance', lockup: 'none' },
      { name: 'Dev vault B', platform: 'Kamino', chain: 'Solana', group: 'nonevm', manager: 'single key', audits: '1 audit', assets: 'USDG', controls: 'timelock: none', tvl_usd: 500000, tvl_slot: 100000000, fees: 'none', lockup: 'none' },
      { name: 'Dev vault C', platform: 'Voltr', chain: 'Solana', group: 'nonevm', manager: 'manager-reported', audits: 'none found', assets: 'USDC', controls: 'upgrade authority: single key', tvl_usd: 100000, tvl_slot: 100000000, fees: '1% management', lockup: '7 days' },
    ],
  }),
  '/api/site/portfolio': () => portfolio(),
};

/** The fixture answer for a path such as "/api/te/list?type=etf". */
export function answer(path) {
  const [p, qs] = path.split('?');
  const q = new URLSearchParams(qs || '');
  const fn = answers[p];
  return fn ? fn(q) : null;
}

/** Asserts that the fixtures reconcile; logs each failure. Returns the
 *  number of failures. */
export function checkFixtures() {
  const bad = [];
  const ok = (cond, msg) => { if (!cond) bad.push(msg); };
  const near = (a, b) => Math.abs(a - b) < 0.011;
  const p = portfolio();
  const sum = (xs) => xs.reduce((a, x) => a + x, 0);
  ok(near(sum(p.positions.map((x) => x.value_usd)), p.total_usd), 'positions do not sum to the total');
  for (const [tab, parts] of Object.entries(p.allocation)) ok(near(sum(parts.map((x) => x.usd)), p.total_usd), `allocation ${tab} does not sum to the total`);
  ok(near(p.change_pct, (p.change_usd / (p.total_usd - p.change_usd)) * 100), 'change % does not match the change');
  for (const x of p.positions) {
    ok(near(x.qty * x.price_usd, x.value_usd), `${x.symbol}: qty x price != value`);
    if (x.buy_in_usd != null) ok(near(x.value_usd - x.buy_in_usd, x.pl_usd), `${x.symbol}: value - buy-in != P/L`);
  }
  for (const s of ['1D', '1W', '1M', 'YTD', '1Y', 'Max']) ok(near(p.series[s].at(-1)[1], p.total_usd), `series ${s} does not end at the total`);
  ok(near(p.performance.price_gain_usd + p.performance.dividends_usd + p.performance.tx_costs_usd, p.performance.total_return_usd), 'performance rows do not sum to the total return');
  ok(near(sum(p.dividends.by_year.map((y) => y.usd)), p.dividends.received_usd), 'dividend years do not sum to received');
  ok(near(sum(p.dividends.payments.map((y) => y.usd)), p.dividends.received_usd), 'dividend payments do not sum to received');
  for (const type of ['stock', 'etf']) for (const group of ['all', 'evm', 'nonevm']) {
    const rows = answer(`/api/te/list?type=${type}&group=${group}`).rows;
    for (const r of rows) {
      const u = UNIVERSE.find((x) => x[0] === r.underlying);
      const b = best(u[3].map((v) => version(r.underlying, v)).filter((v) => group === 'all' || v.group === group));
      ok(b && b.cost_bps === r.best.cost_bps && b.key === r.best.key, `${type}/${group} ${r.underlying}: best is not the minimum over its versions`);
    }
  }
  const s = answer('/api/te/summary');
  ok(sum(s.chain_list.map((c) => c.tokens)) === s.tokens && s.chain_list.length === s.chains, 'summary counts do not match its chain list');
  if (bad.length) bad.forEach((m) => console.error(`[dev fixture] ${m}`));
  else console.info('[dev fixture] all reconciliations hold');
  return bad.length;
}

checkFixtures();
