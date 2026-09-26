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

import T6_VAULTS from './fixtures/t6-vaults.dev.json' with { type: 'json' };
import T6_KAMINO from './fixtures/t6-vault-kamino.dev.json' with { type: 'json' };
import T6_VOLTR from './fixtures/t6-vault-voltr.dev.json' with { type: 'json' };
// T2's real answers (scratchpad/t2_resp__api_te_search_q_*.json and its
// summary): the search answers are served for the queries they were taken
// for; the real summary replaces the made-up one when
// VITE_TE_REAL_SUMMARY=1, for checking the proof line against it (the
// made-up lists then no longer reconcile with it, so checkFixtures skips the
// summary checks in that mode).
import T2_SEARCH from './fixtures/t2-search.dev.json' with { type: 'json' };
import T2_SUMMARY from './fixtures/t2-summary.dev.json' with { type: 'json' };
const REAL_SUMMARY = typeof import.meta.env !== 'undefined' && import.meta.env.VITE_TE_REAL_SUMMARY === '1';

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
    ['FOOon', 'Ondo', 'BNB Chain', 'evm', 90, 0.4, 400],
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

// Every version in the universe, once.
const ALL_VERSIONS = () => UNIVERSE.flatMap(([u, , , raw]) => raw.map((r) => version(u, r)));
const CHAIN_GROUP = (chain) => ALL_VERSIONS().find((v) => v.chain === chain)?.group;

/** The summary is counted from UNIVERSE, so it cannot disagree with the
 *  lists: tokens = versions, issuers and chains = the distinct ones. */
function summary() {
  const vs = ALL_VERSIONS();
  const chains = [...new Set(vs.map((v) => v.chain))];
  const chain_list = chains.map((name) => ({ name, group: CHAIN_GROUP(name), tokens: vs.filter((v) => v.chain === name).length }));
  const withPool = vs.filter((v) => v.filled_fraction >= 1 && Number.isFinite(v.cost_bps)).length;
  return { ...F, underlyings: UNIVERSE.length, versions_listed: vs.length, versions_with_pool: withPool, tokens: vs.length, issuers: new Set(vs.map((v) => v.issuer)).size, chains: chains.length, chain_list };
}

// The slider's stops (SPEC §A.1 #4) and how cost grows with size, a made-up
// shape. At $1,000 the multiplier is 1, so the curve's $1,000 column is the
// versions card's cost exactly.
const STOPS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];
const SHAPE = [1.5, 1.3, 1.1, 1, 1.1, 1.2, 1.3, 1.5, 1.8, 2.2, 3];

/** The largest size a version can take: a thin pool fills filled_fraction
 *  of $1,000; a filled pool takes up to half its depth (made-up rule). */
const capacity = (v) => (v.filled_fraction >= 1 ? v.pool_usd / 2 : v.filled_fraction > 0 ? v.filled_fraction * 1000 : 0);

/** The curve, per chain: that chain's lowest-cost version at $1,000, with a
 *  cost at every stop it can fill and null beyond. A chain whose versions
 *  have no pool at all is left out, as it is from the cost card. */
function curve(ticker) {
  const [u, , , raw] = UNIVERSE.find((x) => x[0] === ticker);
  const vs = raw.map((r) => version(u, r)).filter((v) => v.filled_fraction > 0);
  const byChain = {};
  for (const v of vs) {
    const cur = byChain[v.chain];
    const rank = (x) => (x.filled_fraction >= 1 ? x.cost_bps : Infinity);
    if (!cur || rank(v) < rank(cur)) byChain[v.chain] = v;
  }
  const chains = Object.values(byChain).map((v) => ({
    chain: v.chain, group: v.group, symbol: v.symbol, issuer: v.issuer, filled_fraction: v.filled_fraction,
    bps: STOPS.map((s, i) => (s <= capacity(v) && Number.isFinite(v.cost_bps) ? Math.round(v.cost_bps * SHAPE[i] * 10) / 10 : null)),
    pool_usd: STOPS.map(() => v.pool_usd),
  }));
  return { ...F, ticker, stops: STOPS, chains };
}


// VAULTS: T6's REAL answers (branch te-vaults, samples rebuilt from its
// final code, copied from scratchpad/t6/ into te/fixtures/*.dev.json). Real
// vault names and figures, because the data is real: the pages are tested
// against what the backend serves, not against a shape we imagined (a hand
// fixture hid a missing platform_key once). Like the rest of this file,
// they load only in a dev server with VITE_TE_FIXTURES=1.
// Detail answers exist for the two vaults sampled (a nested pair: Allez USDC
// on Kamino holds part of Hubra Copilot USDC on Voltr); any other address
// answers as the API does, 404.
const DAY = 86400e3;
const addr = (n) => `DevAddr${String(n).padStart(3, '0')}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 44);
const T6_DETAILS = [T6_KAMINO, T6_VOLTR];
const vaultPlatformKey = (v) => v.platform_key || String(v.key || '').split('/')[0];
function vaultList(q) {
  const limit = Math.min(100, Number(q?.get('limit') || 24));
  const vaults = T6_VAULTS.vaults.slice(0, limit);
  return { ...T6_VAULTS, _fixture: true, _marker: FIXTURE_MARKER, limit, count: vaults.length, vaults };
}
function vaultDetail(platformKey, address) {
  const d = T6_DETAILS.find((x) => (x.platform_key || vaultPlatformKey(x.row)) === platformKey && x.address === address);
  return d ? { ...d, _fixture: true, _marker: FIXTURE_MARKER } : null;
}

// A public basket, /api/baskets/{code}. Made-up legs and round numbers; the
// weights sum to 10,000 and the changes are versioned.
function basketDetail(code) {
  const b = answer('/api/baskets/curated').baskets.find((x) => x.code === code);
  if (!b) return null;
  const legs = b.legs.map((l) => {
    const u = UNIVERSE.find((x) => x[0] === l.ticker);
    const v = u[3].find((r) => r[0] === l.symbol) || u[3][0];
    return { ...l, issuer: v[1], chain: v[2], group: v[3] };
  });
  const series = Array.from({ length: 31 }, (_, i) => [Date.parse(T) - (30 - i) * DAY, 1000 + i * 2]);
  return {
    ...F, code, name: b.name, creator: addr(80), created_at: '2025-12-01', version: 2,
    description: 'A made-up basket for laying out the page (dev fixture).',
    legs, value_usd_indicative: 1060, value_basis: 'one unit priced at each leg\'s pool mid (dev fixture)',
    return_since_creation_pct: 6, return_source: 'pool mids', return_basis: 'value at each leg\'s pool mid now against at creation, weights as created (dev fixture)', followers_count: 3, series,
    cost_at_size: { stops: [100, 1000, 10000], bps: [30, b.cost_bps_1k, 40] },
    changes: [
      { version: 2, at: '2025-12-15', legs, note: 'weights rebalanced (dev fixture)' },
      { version: 1, at: '2025-12-01', legs: legs.map((l) => ({ ...l, weight_bps: Math.round(10000 / legs.length) })), note: 'created' },
    ],
    followers: [{ address: addr(81), since: '2025-12-02' }, { address: addr(82), since: '2025-12-10' }, { address: addr(83), since: '2025-12-20' }],
  };
}

const answers = {
  '/api/te/summary': () => (REAL_SUMMARY ? { ...T2_SUMMARY, _fixture: true, _marker: FIXTURE_MARKER } : summary()),
  '/api/te/list': (q) => {
    const type = q.get('type') || 'stock';
    const group = q.get('group') || 'all';
    const rows = UNIVERSE.filter((u) => u[2] === type)
      .map(([u, name, t, raw], i) => listRow([u, name, t, raw.filter((r) => group === 'all' || r[3] === group)], i))
      .filter((r) => r.best);
    return { ...F, size: 1000, sort: q.get('sort') || 'popular', rows: rows.slice(0, Number(q.get('limit') || 50)) };
  },
  '/api/te/search': (q) => {
    // T2's real answer when there is one for this query; otherwise a
    // made-up answer in T2's shape over the made-up universe.
    const term = (q.get('q') || '').trim().toLowerCase();
    if (T2_SEARCH[term]) return { ...T2_SEARCH[term], _fixture: true, _marker: FIXTURE_MARKER };
    const coverage = { instruments: 'every listed token (dev fixture)', vaults: null, vaults_reason: 'no vault is searched (dev fixture)' };
    if (!term) return { ...F, q: '', coverage, results: [], reason: 'empty query' };
    const results = UNIVERSE.map(([u, name, type, raw]) => {
      const vs = raw.map((r) => version(u, r));
      const byTicker = u.toLowerCase() === term || name.toLowerCase().includes(term);
      const matched = vs.filter((v) => v.symbol.toLowerCase() === term);
      if (!byTicker && !matched.length) return null;
      const out = { kind: 'instrument', underlying: u, symbol: u, name, type, versions: vs.length,
        issuers: [...new Set(vs.map((v) => v.issuer))], chains: [...new Set(vs.map((v) => v.chain))], groups: [...new Set(vs.map((v) => v.group))],
        match: byTicker ? (u.toLowerCase() === term ? 'ticker' : 'name') : 'symbol' };
      if (matched.length) out.matched_versions = matched.map((v) => ({ key: v.key, symbol: v.symbol, issuer: v.issuer, chain: v.chain, group: v.group, address: 'DevAddr', listed: true }));
      return out;
    }).filter(Boolean);
    const unlisted_matches = term === 'foo' ? [{ underlying: 'FOOHK', symbol: 'FOOHK', name: 'Foo Corp Hong Kong (dev)', reason: 'Excluded: Hong Kong listing (dev fixture)' }] : [];
    return { ...F, q: term, coverage, results, total_matches: results.length, unlisted_matches };
  },
  '/api/te/underlying/FOO': () => {
    const [u, name, , raw] = UNIVERSE[0];
    return { ...F, ticker: u, name, size: 1000, versions: raw.map((r) => version(u, r)) };
  },
  '/api/te/curve/FOO': () => curve('FOO'),
  '/api/te/controls': () => ({
    ...F,
    rows: [
      ['Robinhood', 'Robinhood', ['Robinhood Chain']],
      ['xStocks', 'xStocks', ['Solana', 'Arbitrum']],
      ['Ondo Global Markets', 'Ondo', ['Ethereum', 'BNB Chain']],
      ['Coinbase', 'Coinbase', ['Base']],
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
  '/api/vaults': (q) => vaultList(q),
  '/api/site/portfolio': () => portfolio(),
};

/** The fixture answer for a path such as "/api/te/list?type=etf". */
export function answer(path) {
  const [p, qs] = path.split('?');
  const q = new URLSearchParams(qs || '');
  const vd = p.match(/^\/api\/vaults\/([a-z]+)\/([A-Za-z0-9]+)$/);
  if (vd) return vaultDetail(vd[1], vd[2]);
  const bd = p.match(/^\/api\/baskets\/(?!curated$)([a-z0-9]+)$/);
  if (bd) return basketDetail(bd[1]);
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
  const s = REAL_SUMMARY ? summary() : answer('/api/te/summary');
  ok(sum(s.chain_list.map((c) => c.tokens)) === s.tokens && s.chain_list.length === s.chains, 'summary counts do not match its chain list');
  ok(s.underlyings === UNIVERSE.length && s.versions_listed === s.tokens && s.versions_with_pool <= s.versions_listed, 'summary underlyings / versions do not match the universe');
  const vs = ALL_VERSIONS();
  ok(s.tokens === vs.length, 'summary tokens != versions in the universe');
  ok(s.issuers === new Set(vs.map((v) => v.issuer)).size, 'summary issuers != issuers in the universe');
  for (const c of s.chain_list) ok(c.tokens === vs.filter((v) => v.chain === c.name).length, `summary ${c.name} count != its versions`);
  const ctl = answer('/api/te/controls').rows.map((r) => r.issuer);
  for (const i of new Set(vs.map((v) => v.issuer))) ok(ctl.includes(i), `no controls row for issuer ${i}`);
  for (const i of ctl) ok(vs.some((v) => v.issuer === i), `controls row for ${i}, which has no token`);
  // The curve and the versions card describe the same pools.
  const und = answer('/api/te/underlying/FOO');
  const cv = answer('/api/te/curve/FOO');
  const at1k = cv.stops.indexOf(und.size);
  ok(at1k >= 0, 'curve has no stop at the versions card size');
  for (const c of cv.chains) {
    const onChain = und.versions.filter((v) => v.chain === c.chain);
    const filled = onChain.filter((v) => v.filled_fraction >= 1 && Number.isFinite(v.cost_bps));
    const cheapest = filled.reduce((a, v) => (!a || v.cost_bps < a.cost_bps ? v : a), null);
    if (cheapest) {
      ok(c.bps[at1k] === cheapest.cost_bps, `curve ${c.chain} at $1,000 != versions card cost`);
      ok(c.pool_usd[at1k] === cheapest.pool_usd, `curve ${c.chain} pool != versions card pool`);
    } else {
      const thin = onChain.find((v) => v.filled_fraction > 0 && v.filled_fraction < 1);
      ok(thin && c.bps[at1k] === null, `curve ${c.chain} should be unfillable at $1,000, as the versions card is thin`);
      ok(thin && c.pool_usd[at1k] === thin.pool_usd, `curve ${c.chain} pool != versions card pool (thin)`);
    }
  }
  for (const v of und.versions.filter((x) => !(x.filled_fraction > 0))) ok(!cv.chains.some((c) => c.chain === v.chain && c.symbol === v.symbol), `curve lists ${v.chain}, which has no pool`);
  // Vaults (T6's real answers): each platform's listed count matches its
  // rows; each sampled detail agrees with its list row; every nesting link
  // names a listed vault, both ways, with the same token amount.
  const vl = answer('/api/vaults?limit=100');
  for (const p of vl.platforms) ok((p.listed || 0) === vl.vaults.filter((v) => vaultPlatformKey(v) === p.platform_key).length, `vaults: ${p.platform} listed count != its rows`);
  ok(vl.count === vl.vaults.length && vl.total >= vl.count, 'vaults: count/total disagree with the rows');
  for (const d of T6_DETAILS) {
    const row = vl.vaults.find((v) => v.address === d.address);
    ok(row && row.tvl_usd === d.tvl.usd && row.name === d.name, `vault ${d.name}: detail disagrees with the list`);
  }
  for (const v of vl.vaults) for (const n of v.nested_in || []) {
    const parent = vl.vaults.find((x) => x.address === n.address);
    ok(parent, `vault ${v.name}: nested_in names no listed vault`);
    ok(parent && (parent.contains_nested || []).some((c) => c.address === v.address && c.tokens === n.tokens), `vault ${v.name}: its parent does not list it with the same amount`);
  }
  for (const p of vl.platforms) for (const x of p.named_exclusions || []) ok(!vl.vaults.some((v) => v.address === x.address), `vaults: ${x.address} is both listed and excluded`);
  for (const b of answer('/api/baskets/curated').baskets) {
    const d = answer(`/api/baskets/${b.code}`);
    ok(d && d.legs.reduce((a, l) => a + l.weight_bps, 0) === 10000, `basket ${b.code}: weights do not sum to 10,000`);
    for (const c of d.changes) ok(Math.abs(c.legs.reduce((a, l) => a + l.weight_bps, 0) - 10000) <= c.legs.length, `basket ${b.code} v${c.version}: weights do not sum to 10,000`);
  }
  if (bad.length) bad.forEach((m) => console.error(`[dev fixture] ${m}`));
  else console.info('[dev fixture] all reconciliations hold');
  return bad.length;
}

checkFixtures();
