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
  return { ...F, tokens: vs.length, issuers: new Set(vs.map((v) => v.issuer)).size, chains: chains.length, chain_list };
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


// VAULTS, in T6's shape (branch te-vaults, GET /api/vaults and
// /api/vaults/{platform}/{address}), with made-up names, addresses and round
// figures. The two venues with listed vaults, one venue with none, and each
// kind of TVL source are all represented.
const DAY = 86400e3;
const addr = (n) => `DevVau1t${String(n).padStart(3, '0')}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 44);
const VAULTS = [
  // key, name, platform, platform_key, tvl, source, 30-day change %, age days, holds tokenized equity
  [1, 'Dev Stable One', 'Kamino', 'kamino', 3000000, 'computed_from_chain', 0.4, 400, false],
  [2, 'Dev Stable Two', 'Kamino', 'kamino', 2000000, 'computed_from_chain', 0.3, 200, false],
  [3, 'Dev Stock Basket', 'Kamino', 'kamino', 1000000, 'computed_from_chain', 0.6, 90, true],
  [4, 'Dev Lending Pool', 'Voltr', 'voltr', 1500000, 'vault_recorded', 0.5, 120, false],
  [5, 'Dev Nested Pool', 'Kamino', 'kamino', 500000, 'computed_from_chain', 0.2, 60, false],
];
// Vault 5 sits inside vault 1 (its dollars are in vault 1's TVL); vault 4's
// latest read failed, so it carries the previous read, marked stale.
const NESTED = { 5: 1 };
const STALE = new Set([4]);
function vaultRow([n, name, platform, platform_key, tvl, source, ret, age, rwa]) {
  const series = (base, step) => Array.from({ length: 31 }, (_, i) => [Date.parse(T) - (30 - i) * DAY, Math.round((base + step * i) * 10000) / 10000]);
  return {
    key: `${platform_key}/${addr(n)}`, name, platform, platform_key, chain: 'Solana', group: 'nonevm', address: addr(n),
    manager: n % 2 ? 'Vault admin: 2 of 3 multisig, 1 h timelock' : 'Vault admin: single key (inferred)',
    audits: `${platform} audits (dev fixture, read 2026-01-01)`,
    assets: rwa ? 'Tokenized stocks and USDC (dev fixture)' : 'USDC, lent into 2 markets (dev fixture)',
    controls: 'Upgrade: 3 of 5 multisig, 24 h timelock (dev fixture)',
    fees: '10% performance, 0% management', lockup: 'No lock-up field; withdrawals limited by available liquidity',
    tvl_usd: tvl, tvl_amount: tvl, tvl_symbol: 'USDC', tvl_slot: 100000000,
    tvl_source: source,
    tvl_basis: source === 'computed_from_chain' ? 'computed from the vault\'s positions read on chain (dev fixture)' : 'the vault\'s own recorded total, not recomputed (dev fixture)',
    tvl_reconciliation: source === 'computed_from_chain' ? 'reconciles (dev fixture)' : 'recorded by the vault, not reconciled (dev fixture)',
    tvl_partial: false, tvl_last_written: source === 'vault_recorded' ? '2026-01-01T00:00Z' : null,
    provenance: {
      manager: { class: 'A', slot: 100000000 }, assets: { class: 'A', slot: 100000000 }, controls: { class: 'A', slot: 100000000 },
      fees: { class: 'A', slot: 100000000 }, lockup: { class: 'A', slot: 100000000 },
      audits: { class: 'D', url: 'https://example.invalid/audits', read_on: '2026-01-01' },
      tvl: { class: 'A', slot: 100000000, source },
    },
    read_at: T,
    return_30d: { pct: ret, basis: 'share price change over 30 days, read on chain (dev fixture)', from: '2025-12-02', to: '2026-01-01' },
    series: { share_price: series(1, ret / 100 / 30), tvl: series(tvl * 0.9, tvl * 0.1 / 30) },
    age_days: age, holds_tokenized_equity: rwa,
    nested_in: NESTED[n] ? `${platform_key}/${addr(NESTED[n])}` : undefined,
    stale: STALE.has(n) || undefined,
  };
}
const PLATFORMS = [
  { platform: 'Kamino', platform_key: 'kamino', chain: 'Solana', group: 'nonevm', status: 'listed', listed: 4, as_of: '2026-01-01', read_at: T,
    text: '4 listed of 11 vault accounts read on chain; 7 not listed, by reason below.', discovered: 11, slot: 100000000,
    excluded: [{ reason: 'empty or under 1,000 tokens', count: 4 }, { reason: 'deposit token is not a stablecoin (crypto or LST)', count: 2 }, { reason: 'named as a test, staging or demo vault', count: 1 }],
    named_exclusions: [{ address: addr(90), name: 'Dev Off-chain Fund', reason: 'off-chain structure (dev fixture)' }],
    upgrade: { text: '3 of 5 multisig, 24 h timelock', class: 'A', slot: 100000000 } },
  { platform: 'Voltr', platform_key: 'voltr', chain: 'Solana', group: 'nonevm', status: 'listed', listed: 1, as_of: '2026-01-01', read_at: T,
    text: '1 listed of 5 vault accounts read on chain; 4 not listed, by reason below.', discovered: 5, slot: 100000000,
    excluded: [{ reason: 'places funds with Drift (excluded by the owner\'s rule)', count: 2 }, { reason: 'empty or under 1,000 tokens', count: 2 }],
    named_exclusions: [], upgrade: { text: '2 of 3 multisig, no timelock', class: 'A', slot: 100000000 } },
  { platform: 'GLAM', platform_key: 'glam', chain: 'Solana', group: 'nonevm', status: 'none_qualifying', listed: 0, as_of: '2026-01-01', read_at: T,
    text: 'No qualifying vault found as of 2026-01-01: 6 GLAM vault accounts read on chain, none qualifies (dev fixture).', reason_class: 'A',
    excluded: [{ reason: 'base asset is not a stablecoin', count: 4 }, { reason: 'named as a test, staging or demo vault', count: 2 }], named_exclusions: [], discovered: 6 },
  { platform: 'Hyperliquid', platform_key: 'hyperliquid', chain: 'Hyperliquid', group: 'nonevm', status: 'none_qualifying', listed: 0, as_of: '2026-01-01', read_at: null,
    text: 'No qualifying vault found as of 2026-01-01: none holds a real-world asset (dev fixture).', reason_class: 'D',
    sources: ['https://example.invalid/docs'], sources_read_on: '2026-01-01' },
];
function vaultList() {
  const vaults = VAULTS.map(vaultRow);
  return {
    ...F, as_of: '2026-01-01', read_only: true, deposits: 'off',
    notice: 'Read-only: deposits are off. We describe each vault as its chain state and its operator\'s documents show it. Nothing here is advice.',
    rule: 'Listed when: the deposit token is on the stablecoin list (by mint address); every position the vault holds is read on chain; the name is not a test, staging or demo name; and it holds at least 1,000 tokens. (dev fixture)',
    order: 'platform, then name; no ranking', platform: null, total: vaults.length, count: vaults.length, offset: 0, limit: 100,
    vaults, platforms: PLATFORMS,
  };
}
function vaultDetail(platformKey, address) {
  const row = vaultList().vaults.find((v) => v.platform_key === platformKey && v.address === address);
  if (!row) return null;
  return {
    ...F, kind: 'vault', platform: row.platform, platform_key: row.platform_key, chain: row.chain, group: row.group,
    address: row.address, program: 'DevProgram1111111111111111111111111111111111'.slice(0, 44), name: row.name,
    token: { mint: 'DevMint11111111111111111111111111111111111111'.slice(0, 44), symbol: 'USDC', decimals: 6 },
    tvl: { usd: row.tvl_usd, amount: row.tvl_amount, symbol: 'USDC', slot: row.tvl_slot, source: row.tvl_source, basis: row.tvl_basis, reconciliation: row.tvl_reconciliation, partial: false },
    fees: { text: row.fees, class: 'A', slot: 100000000, performance_bps: 1000, management_bps: 0 },
    lockup: { text: row.lockup, class: 'A', slot: 100000000 },
    manager: { text: row.manager, class: 'A', slot: 100000000,
      vault_admin: { kind: 'squads_v4', address: addr(50), text: '2 of 3 multisig, 1 h timelock' },
      allocation_admin: { kind: 'single_key', address: addr(51), text: 'single key (inferred)' } },
    assets: { text: row.assets, class: 'A', slot: 100000000, allocations: [
      { reserve: addr(60), lending_market: addr(61), market_owner_text: '3 of 5 multisig, 12 h timelock', target_weight: 600000, value_tokens: row.tvl_usd * 0.6 },
      { reserve: addr(62), lending_market: addr(63), market_owner_text: '3 of 5 multisig, 12 h timelock', target_weight: 400000, value_tokens: row.tvl_usd * 0.4 },
    ] },
    controls: { class: 'A', slot: 100000000, admin: '2 of 3 multisig, 1 h timelock', allocation_admin: 'single key (inferred)',
      global_admin: { text: '3 of 5 multisig, no timelock' }, market_owners: ['3 of 5 multisig, 12 h timelock'],
      pause: { text: 'No pause field (dev fixture)', class: 'D' },
      upgrade: { programs: [{ program: 'DevProgram1111111111111111111111111111111111'.slice(0, 44), state: 'upgradeable', authority: addr(70), last_deploy_slot: 90000000, slot: 100000000, authority_detail: { text: '3 of 5 multisig, 24 h timelock' } }] } },
    audits: { text: row.audits, class: 'D', url: 'https://example.invalid/audits', read_on: '2026-01-01', entries: [{ auditor: 'Dev Auditor A', date_as_stated: '1 Jan 2025', scope: 'vault program' }] },
    powers: { class: 'D', source: 'https://example.invalid/source', read_on: '2026-01-01', rows: [['vault admin', 'adds markets, sets fees (dev fixture)'], ['allocation admin', 'changes weights of markets already added (dev fixture)']], moves: 'No handler moves deposits to an arbitrary account (dev fixture).' },
    read_at: T, row, notice: vaultList().notice,
    return_30d: row.return_30d, series: row.series, age_days: row.age_days,
  };
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
    return_since_creation_pct: 6, followers_count: 3, series,
    cost_at_size: { stops: [100, 1000, 10000], bps: [30, b.cost_bps_1k, 40] },
    changes: [
      { version: 2, at: '2025-12-15', legs, note: 'weights rebalanced (dev fixture)' },
      { version: 1, at: '2025-12-01', legs: legs.map((l) => ({ ...l, weight_bps: Math.round(10000 / legs.length) })), note: 'created' },
    ],
    followers: [{ address: addr(81), since: '2025-12-02' }, { address: addr(82), since: '2025-12-10' }, { address: addr(83), since: '2025-12-20' }],
  };
}

const answers = {
  '/api/te/summary': () => summary(),
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
  '/api/vaults': () => vaultList(),
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
  const s = answer('/api/te/summary');
  ok(sum(s.chain_list.map((c) => c.tokens)) === s.tokens && s.chain_list.length === s.chains, 'summary counts do not match its chain list');
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
  // Vaults: the list and each detail agree; the platforms' listed counts
  // match the rows; a basket's weights sum to 10,000 at every version.
  const vl = answer('/api/vaults');
  const counted = vl.vaults.filter((v) => !v.nested_in);
  ok(near(counted.reduce((a, v) => a + v.tvl_usd, 0), 7500000), 'vaults: the total counts a nested vault twice');
  for (const v of vl.vaults.filter((x) => x.nested_in)) ok(vl.vaults.some((x) => x.key === v.nested_in), `vault ${v.name}: nested_in names no listed vault`);
  for (const p of vl.platforms) ok((p.listed || 0) === vl.vaults.filter((v) => v.platform_key === p.platform_key).length, `vaults: ${p.platform} listed count != its rows`);
  for (const v of vl.vaults) {
    const d = answer(`/api/vaults/${v.platform_key}/${v.address}`);
    ok(d && d.tvl.usd === v.tvl_usd && d.name === v.name, `vault ${v.name}: detail disagrees with the list`);
    ok(near(d.assets.allocations.reduce((a, x) => a + x.value_tokens, 0), v.tvl_usd), `vault ${v.name}: holdings do not sum to TVL`);
    ok(near(v.series.tvl.at(-1)[1], v.tvl_usd), `vault ${v.name}: TVL series does not end at TVL`);
  }
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
