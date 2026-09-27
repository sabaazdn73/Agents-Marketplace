// te/fixtures.dev.js
//
// DEVELOPMENT ONLY. Answers in the shapes te/api.js documents. The cost
// reads (summary, lists, underlying, curve), the vaults and some searches
// are the backend's REAL answers, sampled (see the imports below). The rest
// (portfolio, controls by issuer, other searches) is invented, and none of
// it is a measurement. The tickers (FOO, BAR, BAZ, QUX, ...) and every
// number are made up and round, and none repeats a figure from the launch
// film or the references: a fixture that looks like the film would pass for
// it in a screenshot.
//
// The numbers reconcile the way real ones must, and checkFixtures() below
// asserts it in the console when the fixtures load:
//   positions sum to the portfolio total; every allocation tab sums to it;
//   the change percentage is change / (total - change); qty x price =
//   value; P/L = value - buy-in; and the real cost samples agree with
//   each other (see checkFixtures).
//
// Loaded only when import.meta.env.DEV is true and VITE_TE_FIXTURES=1; a
// production build drops the import, and the build check greps the bundle
// for the marker below to prove it.

export const FIXTURE_MARKER = 'TNEGA_DEV_FIXTURE_7f3a';

import T6_VAULTS from './fixtures/t6-vaults.dev.json' with { type: 'json' };
import T6_KAMINO from './fixtures/t6-vault-kamino.dev.json' with { type: 'json' };
import T6_VOLTR from './fixtures/t6-vault-voltr.dev.json' with { type: 'json' };
// T2's real search answers (scratchpad/t2_resp__api_te_search_q_*.json),
// served for the queries they were taken for.
import T2_SEARCH from './fixtures/t2-search.dev.json' with { type: 'json' };
// T3a's REAL cost answers (branch te-cost, 6a6531d), taken from its own
// routes served locally over a copy of its cost store: the summary with its
// cost counts, the stock and ETF lists (All and non-EVM; EVM answers
// byte-for-byte as All today, every measured version being EVM), NVDA, DIS,
// INTC and FXI at $1,000 (NVDA also at $10,000) and the NVDA and DIS curves.
// Same lesson as the vaults: the cost pages are built against what the
// engine serves. A path not sampled answers 404, as the API would.
import T3A from './fixtures/t3a-cost.dev.json' with { type: 'json' };
// T4a's REAL answers for the instrument page (/stocks/NVDA): NVDA at all 11
// sizes and its curve, from te-cost's own views over the same store read
// later (10:07 UTC, where T3A above is 09:46), and the issuer controls of
// every NVDA version from te-cost's controls.by_key over the universe file.
// NVDA's instrument page reads these; the home and the lists keep T3A's, so
// the two show different measurement times, each labelled with its own.
import T4A from './fixtures/t4a-stock.dev.json' with { type: 'json' };
// T7's REAL basket answers (branch te-baskets, c05df08): the curated list
// at $1,000, $10,000 and $250,000, every curated basket at all 11 sizes,
// and /api/baskets/evaluate for built baskets (legs= and b=, one with a
// pinned version) at $100, $1,000, $10,000 and $250,000, from its own
// core/te/baskets.py over the store its samples were served from; each
// served sample (scratchpad/t7/v2_*.json) is equal to its answer here. The
// 400 and 404 bodies are the served ones or the route's own text. Any
// other built basket answers 404 here, saying it is not in the fixture.
import T7 from './fixtures/t7-baskets.dev.json' with { type: 'json' };

const T = '2026-01-01T12:00:00Z';
const F = { _fixture: true, _marker: FIXTURE_MARKER, computed_at: T };
// A real sample, tagged as served from a fixture (the pages' Dev fixture tag).
const real = (b) => ({ ...b, _fixture: true, _marker: FIXTURE_MARKER });

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


// VAULTS: T6's REAL answers (branch te-vaults, samples rebuilt from its
// final code, copied from scratchpad/t6/ into te/fixtures/*.dev.json). Real
// vault names and figures, because the data is real: the pages are tested
// against what the backend serves, not against a shape we imagined (a hand
// fixture hid a missing platform_key once). Like the rest of this file,
// they load only in a dev server with VITE_TE_FIXTURES=1.
// Detail answers exist for the two vaults sampled (a nested pair: Allez USDC
// on Kamino holds part of Hubra Copilot USDC on Voltr); any other address
// answers as the API does, 404.
const BASKET_SIZES = ['100', '250', '500', '1000', '2500', '5000', '10000', '25000', '50000', '100000', '250000'];
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

const answers = {
  '/api/te/summary': () => real(T3A.summary),
  '/api/te/list': (q) => {
    // One sampled answer per type and group (limit 100 holds every row);
    // limit and offset page it the way the engine does.
    const type = q.get('type') || 'stock';
    const group = q.get('group') || 'all';
    const base = T3A.list[`${type}:${group === 'evm' ? 'all' : group}`];
    if (!base) return null;
    const limit = Number(q.get('limit') || 50);
    const offset = Number(q.get('offset') || 0);
    const total = base.rows.length;
    return real({
      ...base, group, limit, offset,
      rows: base.rows.slice(offset, offset + limit),
      next_offset: offset + limit < total ? offset + limit : null,
    });
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
  '/api/baskets/curated': (q) => {
    const size = q.get('size') || '1000';
    if (!BASKET_SIZES.includes(size)) return { __status: 400, __body: T7.errors.size.body };
    const b = T7.curated[size];
    return b ? real(b) : null;
  },
  '/api/baskets/evaluate': (q) => {
    const size = q.get('size') || '1000';
    if (!BASKET_SIZES.includes(size)) return { __status: 400, __body: T7.errors.size.body };
    const arg = q.get('b') != null ? `b=${q.get('b')}` : `legs=${q.get('legs') || ''}`;
    const e = T7.errors[`${arg}|${size}`];
    if (e) return { __status: e.status, __body: e.body };
    const b = T7.evaluate[`${arg}|${size}`];
    if (b) return real(b);
    const held = [...new Set(Object.values(T7.evaluate).map((x) => x.legs_param))].join('; ');
    return { __status: 404, __body: { error: 'not_found', reason: `this built basket is not in the dev fixture, which holds ${held}` } };
  },
  '/api/vaults': (q) => vaultList(q),
  '/api/site/portfolio': () => portfolio(),
};

/** The fixture answer for a path such as "/api/te/list?type=etf". */
export function answer(path) {
  const [p, qs] = path.split('?');
  const q = new URLSearchParams(qs || '');
  const vd = p.match(/^\/api\/vaults\/([a-z]+)\/([A-Za-z0-9]+)$/);
  if (vd) return vaultDetail(vd[1], vd[2]);
  const bd = p.match(/^\/api\/baskets\/(?!curated$|evaluate$)([a-z0-9-]+)$/);
  if (bd) {
    if (!BASKET_SIZES.includes(q.get('size') || '1000')) return { __status: 400, __body: T7.errors.size.body };
    const b = T7.detail[`${bd[1]}:${q.get('size') || 1000}`];
    return b ? real(b) : { __status: 404, __body: T7.errors.not_found.body };
  }
  const ud = p.match(/^\/api\/te\/underlying\/([A-Z0-9.-]+)$/);
  if (ud) { const k = `${ud[1]}:${q.get('size') || 1000}`; const b = T4A.underlying[k] || T3A.underlying[k]; return b ? real(b) : null; }
  const cd = p.match(/^\/api\/te\/curve\/([A-Z0-9.-]+)$/);
  if (cd) { const b = T4A.curve[cd[1]] || T3A.curve[cd[1]]; return b ? real(b) : null; }
  if (p === '/api/te/controls' && q.get('by') === 'key') { const b = T4A.controls[q.get('key')]; return b ? real(b) : null; }
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
  // The cost samples (T3a's real answers) agree with each other: a list
  // row's best is the underlying page's best at the same size, with the
  // same figures; a version whose share ratio is not read is never best;
  // the curve's $1,000 figure on a chain is the cost_bps of the version it
  // names there; the summary's cost counts add up by chain.
  for (const type of ['stock', 'etf']) {
    const l = answer(`/api/te/list?type=${type}&group=all&limit=100`);
    ok(l.rows_total === l.rows.length, `list ${type}: rows_total != rows at limit 100`);
    for (const r of l.rows) {
      ok(r.best && r.best.share_ratio != null, `list ${type} ${r.underlying}: best has no read share ratio`);
      const u = T3A.underlying[`${r.underlying}:1000`];
      if (!u) continue;
      const v = u.versions.find((x) => x.key === r.best.key);
      ok(u.best?.key === r.best.key, `${r.underlying}: list best != underlying best`);
      ok(v && v.allin_per_share === r.best.allin_per_share && v.cost_bps === r.best.cost_bps, `${r.underlying}: list figures != underlying figures`);
    }
  }
  for (const key of Object.keys(T3A.underlying)) {
    const u = T3A.underlying[key];
    for (const v of u.versions) if (!v.comparable) ok(u.best?.key !== v.key, `${key}: ${v.symbol} is best without a read share ratio`);
    const c = T3A.curve[u.ticker];
    if (!c || u.size !== 1000) continue;
    const i = c.stops.indexOf(1000);
    for (const ch of c.chains) {
      if (ch.keys[i] == null) continue;
      const v = u.versions.find((x) => x.key === ch.keys[i]);
      ok(v && v.cost_bps === ch.bps[i], `curve ${u.ticker} ${ch.chain} at $1,000 != that version's cost_bps`);
    }
  }
  // T4a's NVDA set agrees with itself: at every stop, the curve's figure on
  // a chain is the cost_bps of the version it names there, and every
  // version has its controls.
  for (const [k, u] of Object.entries(T4A.underlying)) {
    const c = T4A.curve[u.ticker];
    const i = c.stops.indexOf(u.size);
    ok(i >= 0, `T4a ${k}: size is not a curve stop`);
    for (const ch of c.chains) {
      if (ch.keys[i] == null) continue;
      const v = u.versions.find((x) => x.key === ch.keys[i]);
      ok(v && v.cost_bps === ch.bps[i], `T4a curve ${ch.chain} at ${u.size} != that version's cost_bps`);
    }
    for (const v of u.versions) ok(T4A.controls[v.key], `T4a ${v.key}: no controls sample`);
  }
  const s = answer('/api/te/summary');
  ok(s.cost.versions_with_cost === s.cost.by_chain.reduce((a, c) => a + c.versions_with_cost, 0), 'summary cost: by_chain does not sum to versions_with_cost');
  ok(s.cost.versions_with_cost <= s.versions_listed, 'summary cost: more versions with a cost than versions listed');
  const vs = ALL_VERSIONS();
  const ctl = answer('/api/te/controls').rows.map((r) => r.issuer);
  for (const i of new Set(vs.map((v) => v.issuer))) ok(ctl.includes(i), `no controls row for issuer ${i}`);
  for (const i of ctl) ok(vs.some((v) => v.issuer === i), `controls row for ${i}, which has no token`);
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
  // Baskets (T7's real answers): each list row agrees with its detail at
  // $1,000; weights sum to 10,000 in every version; the cost is the
  // weighted sum of the legs' leg_cost_bps; signatures count priced legs;
  // every tied cap leg is at the cap.
  for (const b of T7.curated['1000'].baskets) {
    const d = T7.detail[`${b.code}:1000`];
    ok(d && d.cost_bps === b.cost_bps && d.cap_usd === b.cap_usd, `basket ${b.code}: list row != detail at $1,000`);
    ok(d && d.legs.reduce((a, l) => a + l.weight_bps, 0) === 10000, `basket ${b.code}: weights do not sum to 10,000`);
    for (const c of d?.changes || []) ok(c.legs.reduce((a, l) => a + l.weight_bps, 0) === 10000, `basket ${b.code} v${c.version}: weights do not sum to 10,000`);
  }
  for (const [k, d] of [...Object.entries(T7.detail), ...Object.entries(T7.evaluate)]) {
    if (d.cost_bps != null) ok(Math.abs(d.legs.reduce((a, l) => a + l.weight_bps * l.leg_cost_bps, 0) / 10000 - d.cost_bps) < 0.001, `basket ${k}: cost_bps != weighted leg_cost_bps`);
    ok(d.signatures === d.legs.filter((l) => l.state === 'filled').length, `basket ${k}: signatures != priced legs`);
    if (d.cap_usd != null) for (const t of d.cap_legs) { const l = d.legs.find((x) => x.ticker === t); ok(l && l.cap_usd <= d.cap_usd * 1.01, `basket ${k}: cap leg ${t} not at the cap`); }
  }
  if (bad.length) bad.forEach((m) => console.error(`[dev fixture] ${m}`));
  else console.info('[dev fixture] all reconciliations hold');
  return bad.length;
}

checkFixtures();
