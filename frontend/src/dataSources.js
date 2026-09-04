// dataSources.js
//
// Real external data providers this project depends on — shared by the
// footer strip (DataSourcesFooter.jsx) and the full attribution page
// (DataSourcesPage.jsx), web + mobile. Every entry below is a real,
// checked-in-code integration (checked 2026-08-25, not assumed):
//   - 8004scan:    backend/adapters/bsc.py — agent identity/reputation data
//   - The Graph:   backend/adapters/thegraph.py — Agent0 ERC-8004 subgraph,
//                  the registry coverage fallback (docs/thegraph-integration.md)
//   - Zerion:      backend/adapters/zerion.py — opt-in wallet portfolio enrichment
//   - CoinGecko:   credited per a real commitment made in their grant
//                  application; tracked live on /status. Market & pricing data.
//   - DexScreener: frontend/src/researchSkills.js — live token/pool search
//   - GeckoTerminal: frontend/src/researchSkills.js — trending BSC pools
//   - BscScan:     explorer links throughout the app (altana.js, JobStatusPanel, etc.)
//   - bloXroute:   the BSC mainnet RPC this project's backend reads through
//                  (adapters/bsc_balance.py, /api/status)
//
// Logos: each provider's own real favicon, fetched directly from their own
// domain (not a third-party favicon-proxy service) — small, real, and
// exactly what "small real logo if easily available" asked for.
export const DATA_SOURCES = [
  {
    name: '8004scan',
    url: 'https://8004scan.io',
    logo: 'https://8004scan.io/favicon.ico',
    description: 'Agent identity and reputation data for every agent listed here.',
  },
  {
    name: 'Zerion',
    url: 'https://zerion.io',
    // Real fix (2026-08-27): the generic root /favicon.ico was reported
    // broken. Investigated properly before guessing — pulled the actual
    // bytes (curl -> file -> sips -> viewed the decoded PNG), and the .ico
    // itself decodes to a real, correct Zerion logo, so the asset wasn't
    // corrupt. Checked zerion.io's own <head> instead: it declares a real
    // PNG (favicon-wallet-32.png) as its actual icon, not the root .ico —
    // .ico support via a plain <img> tag (as opposed to <link rel="icon">,
    // where every browser supports it) is real but inconsistent across
    // browsers/versions, so switching to the format the site itself
    // actually uses removes that whole class of risk.
    logo: 'https://zerion.io/favicon-wallet-32.png',
    description: "Opt-in wallet portfolio enrichment on an agent's detail page.",
  },
  {
    name: 'The Graph',
    url: 'https://thegraph.com',
    // First-party asset. thegraph.com/favicon.ico is a real 404, so this
    // uses the icon their own <head> actually declares
    // (storage.thegraph.com/favicons/64x64.png, live-confirmed 200, a real
    // 64x64 RGBA PNG) -- the same "check what the site itself uses rather
    // than assuming the root .ico" step already taken for Zerion.
    //
    // Checked their brand guidelines (thegraph.com/brand) before using the
    // mark: assets are stated free to use in community designs, with usage
    // explicitly not implying collaboration, partnership or endorsement,
    // which is exactly the footing every logo in this file sits on. Their
    // written naming rules are followed throughout this project: "The
    // Graph" capitalised in full, never "Graph" alone, never "The Graph
    // Protocol", and the token name is not used as a brand reference.
    logo: 'https://storage.thegraph.com/favicons/64x64.png',
    description: 'Live ERC-8004 registry data via the Agent0 subgraph, used as a coverage fallback where 8004scan\'s pagination fails.',
  },
  {
    name: 'MetaMask',
    url: 'https://metamask.io',
    // Real, official first-party asset (metamask.io/favicon.ico, live-
    // confirmed 200), same "small logo, fetched directly from the
    // provider's own domain" pattern every entry here already uses.
    // Checked their real brand resources first (github.com/MetaMask/
    // brand-resources -> metamask.io/assets): no explicit written usage
    // terms are published there as of this check, so this stays at the
    // same small, factual, non-commercial, no-endorsement-implied scale
    // as every other logo in this file, not a larger promotional asset.
    logo: 'https://metamask.io/favicon.ico',
    description: 'EIP-5792 atomic batch transaction support for the direct-wallet Skill/hire path.',
  },
  {
    name: 'CoinGecko',
    url: 'https://www.coingecko.com',
    logo: 'https://www.coingecko.com/favicon.ico',
    description: 'Market and pricing data.',
  },
  {
    name: 'DexScreener',
    url: 'https://dexscreener.com',
    logo: 'https://dexscreener.com/favicon.ico',
    description: 'Live token and trading-pair search.',
  },
  {
    name: 'GeckoTerminal',
    url: 'https://www.geckoterminal.com',
    logo: 'https://www.geckoterminal.com/favicon.ico',
    description: 'Trending BNB Chain liquidity pools.',
  },
  {
    name: 'BscScan',
    url: 'https://bscscan.com',
    logo: 'https://bscscan.com/favicon.ico',
    description: 'BNB Chain block explorer — every on-chain link points here.',
  },
  {
    name: 'bloXroute',
    url: 'https://bloxroute.com',
    logo: 'https://bloxroute.com/favicon.ico',
    description: 'BNB Chain mainnet RPC infrastructure.',
  },
];
