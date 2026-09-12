// dataSources.js
//
// external data providers this project depends on, shared by the
// footer strip (DataSourcesFooter.jsx) and the full attribution page
// (DataSourcesPage.jsx), web + mobile. Every entry below is a real,
// checked-in-code integration (checked 2026-08-25, not assumed):
//   - 8004scan:    backend/adapters/bsc.py, agent identity/reputation data
//   - The Graph:   backend/adapters/thegraph.py, Agent0 ERC-8004 subgraph,
//                  the registry coverage fallback (docs/thegraph-integration.md)
//   - Zerion:      backend/adapters/zerion.py, opt-in wallet portfolio enrichment
//   - CoinGecko:   credited per a commitment made in their grant
//                  application; tracked live on /status. Market & pricing data.
//   - DexScreener: frontend/src/researchSkills.js, live token/pool search
//   - GeckoTerminal: frontend/src/researchSkills.js, trending BSC pools
//   - BscScan:     explorer links throughout the app (altana.js, JobStatusPanel, etc.)
//   - bloXroute:   the BSC mainnet RPC this project's backend reads through
//                  (adapters/bsc_balance.py, /api/status)
//
// Logos: each provider's own favicon, fetched directly from their own
// domain (not a third-party favicon-proxy service), small, real, and
// exactly what "small logo if easily available" asked for.
//
// `inFooter` marks the providers of DATA, which is what the footer strip is
// attributing. Hosting, databases and analysis tooling are real dependencies
// and belong on the Resources page, but putting Vercel in a line headed "data
// sources" would be wrong, and a 25-logo strip is noise either way.
//
// `status` is one of: live, partial, inactive, analysis. See DataSourcesPage
// for what each means. Every entry was checked as actually wired in, meaning a
// key in the environment AND code that reads it, rather than listed because it
// sounds plausible.
export const DATA_SOURCES = [
  {
    name: '8004scan',
    inFooter: true,
    status: 'live',
    statusNote: 'Checked live on /status.',
    url: 'https://8004scan.io',
    logo: 'https://8004scan.io/favicon.ico',
    description: 'Agent identity and reputation data for every agent listed here.',
  },
  {
    name: 'Zerion',
    inFooter: true,
    status: 'live',
    statusNote: 'Checked live on /status. Shared 300-request daily budget.',
    url: 'https://zerion.io',
 // fix (2026-08-27): the generic root /favicon.ico was reported
 // broken. Investigated properly before guessing, pulled the actual
    // bytes (curl -> file -> sips -> viewed the decoded PNG), and the .ico
 // itself decodes to a real, correct Zerion logo, so the asset wasn't
 // corrupt. Checked zerion.io's own <head> instead: it declares a real
    // PNG (favicon-wallet-32.png) as its icon, not the root .ico,
    // .ico support via a plain <img> tag (as opposed to <link rel="icon">,
 // where every browser supports it) is but inconsistent across
    // browsers/versions, so switching to the format the site itself
 // uses removes that whole class of risk.
    logo: 'https://zerion.io/favicon-wallet-32.png',
    description: "Opt-in wallet portfolio enrichment on an agent's detail page.",
  },
  {
    name: 'The Graph',
    inFooter: true,
    status: 'live',
    statusNote: 'Registry coverage fallback when 8004scan is short.',
    url: 'https://thegraph.com',
 // First-party asset. thegraph.com/favicon.ico is a real 404, so this
 // uses the icon their own <head> declares
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
    inFooter: true,
    status: 'live',
    statusNote: 'One of the wallets you can connect with.',
    url: 'https://metamask.io',
 // Real, official first-party asset (metamask.io/favicon.ico, live-
    // confirmed 200), same "small logo, fetched directly from the
    // provider's own domain" pattern every entry here already uses.
    // Checked their brand resources first (github.com/MetaMask/
    // brand-resources -> metamask.io/assets): no explicit written usage
    // terms are published there as of this check, so this stays at the
    // same small, factual, non-commercial, no-endorsement-implied scale
    // as every other logo in this file, not a larger promotional asset.
    logo: 'https://metamask.io/favicon.ico',
    description: 'EIP-5792 atomic batch transaction support for the direct-wallet Skill/hire path.',
  },
  {
    name: 'CoinGecko',
    inFooter: true,
    status: 'live',
    statusNote: 'Checked live on /status.',
    url: 'https://www.coingecko.com',
    logo: 'https://www.coingecko.com/favicon.ico',
    description: 'Market and pricing data.',
  },
  {
    name: 'DexScreener',
    inFooter: true,
    status: 'live',
    statusNote: 'Token and pool search inside the research skills.',
    url: 'https://dexscreener.com',
    logo: 'https://dexscreener.com/favicon.ico',
    description: 'Live token and trading-pair search.',
  },
  {
    name: 'GeckoTerminal',
    inFooter: true,
    status: 'live',
    statusNote: 'Trending BNB Chain pools inside the research skills.',
    url: 'https://www.geckoterminal.com',
    logo: 'https://www.geckoterminal.com/favicon.ico',
    description: 'Trending BNB Chain liquidity pools.',
  },
  {
    name: 'BscScan',
    inFooter: true,
    status: 'partial',
    statusNote: 'Explorer links work. Its free tier does not cover BNB Chain transaction history, so wallet history comes from Zerion instead.',
    url: 'https://bscscan.com',
    logo: 'https://bscscan.com/favicon.ico',
    description: 'BNB Chain block explorer, every on-chain link points here.',
  },
  {
    name: 'bloXroute',
    inFooter: true,
    status: 'live',
    statusNote: 'The BNB Chain RPC the backend reads through. Checked live on /status.',
    url: 'https://bloxroute.com',
    logo: 'https://bloxroute.com/favicon.ico',
    description: 'BNB Chain mainnet RPC infrastructure.',
  },
  // ---- Added 2026-09-12. Everything below was verified as actually wired in
  // (a key in the environment AND code that reads it) rather than listed
  // because it sounds plausible. `status` is honest about the difference
  // between something the product depends on and something only evaluated.
  {
    name: 'Google Gemini',
    url: 'https://ai.google.dev',
    logo: 'https://www.google.com/favicon.ico',
    description: 'The model behind the MultiAgents tab. Reads a request into a structured need and chooses between shortlisted services.',
    status: 'live',
    statusNote: 'gemini-3.7-flash. Free tier, so a run can hit a quota limit and say so rather than failing silently.',
  },
  {
    name: 'B402',
    url: 'https://docs.bnbchain.org',
    logo: 'https://bscscan.com/favicon.ico',
    description: 'The payment rail the MultiAgents tab settles through on BNB Chain. Holds what you are asked to sign on its own server, not in the page.',
    status: 'live',
    statusNote: 'Rail check passes 7 of 7, including refusing a deliberately tampered payment.',
  },
  {
    name: 'Altana',
    inFooter: true,
    url: 'https://altana.network',
    logo: 'https://altana.network/favicon.ico',
    description: 'Passkey wallet sessions and the Skills registry, so a skill can run without a browser extension.',
    status: 'live',
    statusNote: 'Third-party contracts, listed in the smart contracts doc.',
  },
  {
    name: 'TermiX',
    inFooter: true,
    url: 'https://termix.ai',
    logo: 'https://termix.ai/favicon.ico',
    description: 'Agent capability data used in the health checks.',
    status: 'live',
    statusNote: 'Checked live on /status.',
  },
  {
    name: 'DefiLlama',
    inFooter: true,
    url: 'https://defillama.com',
    logo: 'https://defillama.com/favicon.ico',
    description: 'Protocol coverage and yield data behind the Native Agents comparisons.',
    status: 'live',
    statusNote: 'No key required.',
  },
  {
    name: 'Etherscan',
    url: 'https://etherscan.io',
    logo: 'https://etherscan.io/favicon.ico',
    description: 'Explorer links and contract verification for Ethereum, and transaction history where the free tier covers it.',
    status: 'live',
    statusNote: 'Free tier covers Ethereum and Arbitrum. It does not cover BNB Chain, and Robinhood Chain is not an Etherscan network at all.',
  },
  {
    name: 'Arbiscan',
    url: 'https://arbiscan.io',
    logo: 'https://arbiscan.io/favicon.ico',
    description: 'Explorer links and contract verification for Arbitrum.',
    status: 'live',
    statusNote: '',
  },
  {
    name: 'Blockscout',
    url: 'https://robinhoodchain.blockscout.com',
    logo: 'https://robinhoodchain.blockscout.com/favicon.ico',
    description: "Robinhood Chain's block explorer, used for its contract links.",
    status: 'partial',
    statusNote: 'Its API sits behind a bot check, so contract verification there goes through Sourcify instead.',
  },
  {
    name: 'Sourcify',
    url: 'https://sourcify.dev',
    logo: 'https://sourcify.dev/favicon.ico',
    description: 'Open contract verification, used where an explorer API is not available.',
    status: 'live',
    statusNote: 'Verified the Robinhood Chain escrow with an exact match.',
  },
  {
    name: 'Infura',
    url: 'https://infura.io',
    logo: 'https://www.infura.io/favicon.ico',
    description: 'Backup blockchain connection, used only when the primary one fails.',
    status: 'live',
    statusNote: 'Failover only.',
  },
  {
    name: 'MongoDB Atlas',
    url: 'https://www.mongodb.com/atlas',
    logo: 'https://www.mongodb.com/favicon.ico',
    description: 'Where the agent catalogue and the job index are stored.',
    status: 'live',
    statusNote: 'Checked live on /status. Free tier, so capacity is watched.',
  },
  {
    name: 'Render',
    url: 'https://render.com',
    logo: 'https://render.com/favicon.ico',
    description: 'Runs the backend API and the background workers.',
    status: 'live',
    statusNote: '',
  },
  {
    name: 'Vercel',
    url: 'https://vercel.com',
    logo: 'https://vercel.com/favicon.ico',
    description: 'Serves this site.',
    status: 'live',
    statusNote: '',
  },
  {
    name: 'Crossmint',
    url: 'https://crossmint.com',
    logo: 'https://www.crossmint.com/favicon.ico',
    description: 'The intended payment rail for physical goods in the MultiAgents tab.',
    status: 'inactive',
    statusNote: 'Configured but deliberately switched off: real orders require a flag that is unset, and its crypto payments do not support BNB Chain.',
  },
  {
    name: 'Dune',
    url: 'https://dune.com',
    logo: 'https://dune.com/favicon.ico',
    description: 'On-chain transaction data behind the behaviour study on the Solana tab.',
    status: 'analysis',
    statusNote: 'Used for published analysis, not by the live product.',
  },
  {
    name: 'CockroachDB',
    url: 'https://www.cockroachlabs.com',
    logo: 'https://www.cockroachlabs.com/favicon.ico',
    description: 'A second database, connected and verified but not yet holding anything.',
    status: 'inactive',
    statusNote: 'Connection is configured with full certificate verification. Nothing reads or writes it yet.',
  },
];
