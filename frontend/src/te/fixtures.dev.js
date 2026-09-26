// te/fixtures.dev.js
//
// DEVELOPMENT ONLY. Invented answers in the shapes te/api.js documents, so
// the pages can be laid out before the backend serves real ones. Nothing
// here is a measurement: every number is made up. Loaded only when
// import.meta.env.DEV is true and VITE_TE_FIXTURES=1; a production build
// drops the import, and the build check greps the bundle for the marker
// below to prove it.

export const FIXTURE_MARKER = 'TNEGA_DEV_FIXTURE_7f3a';

const T = '2026-09-26T12:00:00Z';
const F = { _fixture: true, _marker: FIXTURE_MARKER, computed_at: T };

const spark = (seed) => Array.from({ length: 24 }, (_, i) => 100 + Math.sin(i / 3 + seed) * 4 + i * 0.3 * (seed % 2 ? 1 : -0.5));

const ROWS_STOCK = [
  ['NVDA', 'NVIDIA', 'NVDAx', 'xStocks', 'Solana', 'nonevm', 5],
  ['TSLA', 'Tesla', 'TSLAon', 'Ondo', 'Ethereum', 'evm', 4],
  ['AAPL', 'Apple', 'AAPLc', 'Coinbase', 'Base', 'evm', 4],
  ['MSFT', 'Microsoft', 'MSFTx', 'xStocks', 'Arbitrum', 'evm', 3],
  ['GOOGL', 'Alphabet', 'GOOGLB', 'bStocks', 'BNB Chain', 'evm', 3],
  ['META', 'Meta Platforms', 'META', 'Robinhood', 'Robinhood Chain', 'evm', 3],
];
const ROWS_ETF = [
  ['SPY', 'SPDR S&P 500 ETF', 'SPYon', 'Ondo', 'Ethereum', 'evm', 3],
  ['QQQ', 'Invesco QQQ', 'QQQx', 'xStocks', 'Solana', 'nonevm', 3],
  ['GLD', 'SPDR Gold Shares', 'GLDx', 'xStocks', 'Solana', 'nonevm', 2],
  ['IVV', 'iShares Core S&P 500', 'IVVon', 'Ondo', 'BNB Chain', 'evm', 2],
];
const row = ([u, name, sym, iss, chain, group, versions], i, type) => ({
  underlying: u, name, type, versions,
  eligibility: iss === 'Robinhood' ? 'Not for US persons' : 'Outside the US only',
  best: {
    key: `${chain}/${sym}`, symbol: sym, issuer: iss, chain, group,
    paid_per_token: 100 + i * 37.5, cost_usd: 2.1 + i * 0.7, cost_bps: 21 + i * 7,
  },
  spark: spark(i + 1),
});

const VERSIONS = [
  ['NVDAc', 'Coinbase', 'Base', 'evm', 12],
  ['NVDAx', 'xStocks', 'Solana', 'nonevm', 18],
  ['NVDAx', 'xStocks', 'Arbitrum', 'evm', 31],
  ['NVDA', 'Robinhood', 'Robinhood Chain', 'evm', 43],
  ['NVDAon', 'Ondo', 'Ethereum', 'evm', 65],
  ['NVDAB', 'bStocks', 'BNB Chain', 'evm', 109],
];

const STOPS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];
const CURVE = [
  ['Solana', 'nonevm', 'NVDAx', 'xStocks', [9, 10, 12, 14, 18, 24, 31, 44, 60, 82, null]],
  ['Base', 'evm', 'NVDAc', 'Coinbase', [22, 22, 23, 23, 24, 25, 26, 28, 31, 36, 52]],
  ['Arbitrum', 'evm', 'NVDAx', 'xStocks', [30, 30, 31, 31, 33, 35, 38, 45, 56, 70, 110]],
  ['Ethereum', 'evm', 'NVDAon', 'Ondo', [140, 72, 45, 33, 30, 31, 34, 42, 55, 78, 120]],
  ['BNB Chain', 'evm', 'NVDAB', 'bStocks', [40, 41, 43, 47, 55, 66, 80, 104, null, null, null]],
];

const answers = {
  '/api/te/summary': () => ({
    ...F, tokens: 214, issuers: 5, chains: 7,
    chain_list: [
      { name: 'Ethereum', group: 'evm', tokens: 48 }, { name: 'Arbitrum', group: 'evm', tokens: 31 },
      { name: 'Base', group: 'evm', tokens: 10 }, { name: 'BNB Chain', group: 'evm', tokens: 40 },
      { name: 'Robinhood Chain', group: 'evm', tokens: 22 }, { name: 'HyperEVM', group: 'evm', tokens: 6 },
      { name: 'Solana', group: 'nonevm', tokens: 57 },
    ],
  }),
  '/api/te/list': (q) => {
    const type = q.get('type') || 'stock';
    const group = q.get('group') || 'all';
    const src = type === 'etf' ? ROWS_ETF : ROWS_STOCK;
    let rows = src.map((r, i) => row(r, i, type));
    if (group !== 'all') rows = rows.filter((r) => r.best.group === group);
    return { ...F, size: 1000, sort: q.get('sort') || 'popular', rows: rows.slice(0, Number(q.get('limit') || 50)) };
  },
  '/api/te/search': (q) => {
    const s = (q.get('q') || '').toLowerCase();
    const all = [...ROWS_STOCK, ...ROWS_ETF].map(([u, name, sym, iss, chain, group]) => ({ kind: 'instrument', underlying: u, symbol: sym, name, issuer: iss, chain, group }));
    return { ...F, results: all.filter((r) => `${r.underlying} ${r.name} ${r.symbol}`.toLowerCase().includes(s)) };
  },
  '/api/te/underlying/NVDA': () => ({
    ...F, ticker: 'NVDA', name: 'NVIDIA', size: 1000,
    versions: VERSIONS.map(([symbol, issuer, chain, group, bps], i) => ({
      key: `${chain}/${symbol}`, symbol, issuer, chain, group,
      cost_bps: bps, cost_usd: bps / 10, paid_per_token: 181.4 + bps / 100,
      filled_fraction: 1, pool_usd: 400000 - i * 50000,
      eligibility: issuer === 'Robinhood' ? 'Not for US persons' : 'Outside the US only',
      controls: { pause: 'not paused', freeze: 'denylist', burn: 'not established', upgrade: 'upgradeable' },
    })),
  }),
  '/api/te/curve/NVDA': () => ({
    ...F, ticker: 'NVDA', stops: STOPS,
    chains: CURVE.map(([chain, group, symbol, issuer, bps]) => ({ chain, group, symbol, issuer, bps, pool_usd: bps.map(() => 400000) })),
  }),
  '/api/te/controls': () => ({
    ...F,
    rows: [
      ['Robinhood', 'Robinhood', ['Robinhood Chain']],
      ['bStocks', 'bStocks', ['BNB Chain']],
      ['xStocks', 'xStocks', ['Solana', 'Arbitrum', 'Ethereum']],
      ['Ondo Global Markets', 'Ondo', ['Ethereum', 'BNB Chain', 'HyperEVM']],
      ['Coinbase', 'Coinbase', ['Base']],
    ].map(([programme, issuer, chains], i) => ({
      programme, issuer, chains,
      pause: { text: i % 2 ? 'single key (inferred)' : '2 of 4 multisig', state: 'not paused' },
      freeze: { text: i === 2 ? '2 of 4 multisig' : 'denylist' },
      burn: { text: i === 2 ? 'permanent delegate, 2 of 3' : 'not established' },
      upgrade: { text: i === 3 ? 'TimelockController, 2 h' : 'beacon owner' },
      who_may_hold: { text: 'Not for US persons', url: 'https://example.invalid/terms', read_on: '2026-09-20' },
    })),
  }),
  '/api/baskets/curated': () => ({
    ...F, note: 'A fixed example basket, equal or stated weights; not a recommendation.',
    baskets: [
      { name: 'US mega-cap tech', code: 'dev1', legs: [['NVDA', 'NVDAx', 4000], ['TSLA', 'TSLAx', 2000], ['SPY', 'SPYon', 2000], ['AAPL', 'AAPLc', 1000], ['GLD', 'GLDx', 1000]].map(([ticker, symbol, weight_bps]) => ({ ticker, symbol, weight_bps })), cost_bps_1k: 34, signatures: 5, evm: 3, nonevm: 2, cap_usd: 25000, cap_leg: 'TSLA' },
      { name: 'Index core', code: 'dev2', legs: [['SPY', 'SPYon', 5000], ['QQQ', 'QQQx', 5000]].map(([ticker, symbol, weight_bps]) => ({ ticker, symbol, weight_bps })), cost_bps_1k: 22, signatures: 2, evm: 1, nonevm: 1, cap_usd: 50000, cap_leg: 'QQQ' },
      { name: 'Gold and chips', code: 'dev3', legs: [['GLD', 'GLDx', 5000], ['NVDA', 'NVDAc', 5000]].map(([ticker, symbol, weight_bps]) => ({ ticker, symbol, weight_bps })), cost_bps_1k: 27, signatures: 2, evm: 1, nonevm: 1, cap_usd: 10000, cap_leg: 'GLD' },
    ],
  }),
  '/api/vaults': () => ({
    ...F,
    vaults: [
      { name: 'Dev vault A', platform: 'Kamino', chain: 'Solana', group: 'nonevm', manager: 'Squads 2 of 3', audits: '2 audits', assets: 'USDC', controls: 'upgrade authority: multisig', tvl_usd: 1250000, tvl_slot: 300000000, fees: '10% performance', lockup: 'none' },
      { name: 'Dev vault B', platform: 'Kamino', chain: 'Solana', group: 'nonevm', manager: 'single key', audits: '1 audit', assets: 'USDG', controls: 'timelock: none', tvl_usd: 480000, tvl_slot: 300000000, fees: '0%', lockup: 'none' },
      { name: 'Dev vault C', platform: 'Voltr', chain: 'Solana', group: 'nonevm', manager: 'manager-reported', audits: 'not found', assets: 'USDC', controls: 'upgrade authority: single key', tvl_usd: 90000, tvl_slot: 300000000, fees: '1% mgmt', lockup: '7 days' },
    ],
  }),
  '/api/site/portfolio': () => {
    const now = Date.parse(T);
    const pts = (n, step) => Array.from({ length: n }, (_, i) => [now - (n - i) * step, 24000 + Math.sin(i / 4) * 300 + i * 12]);
    return {
      ...F, total_usd: 24318.4, change_usd: 972.11, change_pct: 4.12,
      series: { '1D': pts(48, 1800e3), '1W': pts(56, 3 * 3600e3), '1M': pts(60, 12 * 3600e3), YTD: pts(60, 4.5 * 86400e3), '1Y': pts(60, 6 * 86400e3), Max: pts(60, 6 * 86400e3) },
      positions: [
        { key: 'solana/NVDAx', symbol: 'NVDAx', name: 'NVIDIA', issuer: 'xStocks', chain: 'Solana', qty: 23.2, buy_in_usd: 3562.1, price_usd: 181.42, value_usd: 4210.6, pl_usd: 648.5, pl_pct: 18.2 },
        { key: '1/SPYon', symbol: 'SPYon', name: 'SPDR S&P 500 ETF', issuer: 'Ondo', chain: 'Ethereum', qty: 10.28, buy_in_usd: 6292.6, price_usd: 671.1, value_usd: 6902.35, pl_usd: 609.75, pl_pct: 9.7 },
        { key: '4663/TSLA', symbol: 'TSLA', name: 'Tesla', issuer: 'Robinhood', chain: 'Robinhood Chain', qty: 5.27, buy_in_usd: null, buy_in_reason: 'bridged in: no purchase in this wallet\'s history', price_usd: 401.95, value_usd: 2118.4, pl_usd: null, pl_pct: null },
        { key: '8453/AAPLc', symbol: 'AAPLc', name: 'Apple', issuer: 'Coinbase', chain: 'Base', qty: 13, buy_in_usd: 3071.2, price_usd: 231.8, value_usd: 3013.4, pl_usd: -57.8, pl_pct: -1.9 },
      ],
      allocation: {
        type: [{ label: 'Stocks', usd: 11186 }, { label: 'ETFs', usd: 5836 }, { label: 'Vaults', usd: 4377 }, { label: 'Stablecoins', usd: 2918 }],
        chain: [{ label: 'EVM', usd: 14034 }, { label: 'Non-EVM', usd: 10284 }],
        issuer: [{ label: 'xStocks', usd: 9000 }, { label: 'Ondo', usd: 6902 }, { label: 'Coinbase', usd: 3013 }, { label: 'Robinhood', usd: 2118 }],
      },
      performance: { by_year: [{ year: 2024, pct: 6.1 }, { year: 2025, pct: -2.4 }, { year: 2026, pct: 9.8 }], price_gain_usd: 1200.45, dividends_usd: 212.64, tx_costs_usd: -38.2, total_return_usd: 1374.89 },
      dividends: { received_usd: 212.64, yield_ttm_pct: 0.87, by_year: [{ year: 2025, usd: 88.1 }, { year: 2026, usd: 124.54 }], payments: [{ date: '2026-08-14', symbol: 'SPYon', step: '1.0041 to 1.0082', usd: 28.3 }, { date: '2026-06-20', symbol: 'NVDAx', step: '1.0003 to 1.0005', usd: 1.9 }] },
    };
  },
};

/** The fixture answer for a path such as "/api/te/list?type=etf". */
export function answer(path) {
  const [p, qs] = path.split('?');
  const q = new URLSearchParams(qs || '');
  const fn = answers[p];
  return fn ? fn(q) : null;
}
