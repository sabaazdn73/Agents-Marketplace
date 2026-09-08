// partners.js
//
// Everything the project is built for or runs on, in one list, for the
// scrolling strip at the bottom of the site.
//
// This merges the two lists that already existed (hackathonPartners.js for
// the events, dataSources.js for the services) and adds the tools that were
// credited nowhere. Those two files keep their own pages; this is a single
// flat list for the strip.
//
// HOW EACH LOGO WAS SOURCED
// Every URL below was fetched and the bytes inspected, not just checked for
// a 200. The check confirmed the content type, parsed the header to get
// pixel dimensions, and rejected anything that came back as HTML or as an
// error page with a 200 status.
//
// Four ETHGlobal, CoinGecko, DexScreener and Crossmint icons all came back
// at exactly 15406 bytes, which looked like a shared placeholder. Hashing
// them showed four different files. 15406 is just the common size of a
// multi-resolution .ico bundle, so they are distinct marks.
//
// No URL here contains a build hash. A path like
// /images/logo.d4735304ff62.svg changes on the vendor's next deploy and the
// image disappears with no error, so those were rejected even when they
// resolved.
//
// WHAT IS DELIBERATELY MISSING, AND WHY
// Three services the project uses have no mark here.
//
//   Gemini      Google's trademark rules say to "use only Google-approved
//               artwork when using Google's logos". The Gemini mark is
//               served from a build-hash URL, and the alternatives that
//               resolve are Google's corporate icon or DeepMind's, neither
//               of which is the Gemini product mark. Nothing here would be
//               approved artwork, so it is left out.
//
//   Claude Code Anthropic requires written permission to use its names or
//               logos. Plain text saying a product uses Claude Code is
//               allowed, a logo is not, and we have no permission.
//
//   Infura      No asset on infura.io resolves. The only icons that load
//               are Consensys's and MetaMask's, which are different
//               companies' marks and would misrepresent all three.
//
// All three are still used by the project and are credited in text in the
// docs. Same call as Ledger.

export const PARTNER_KIND = {
  EVENT: 'event',
  SERVICE: 'service',
  TOOL: 'tool',
};

export const PARTNERS = [
  // Events the project was built for.
  { name: 'ETHGlobal', kind: PARTNER_KIND.EVENT, url: 'https://ethglobal.com', logo: 'https://ethglobal.com/favicon.ico' },
  { name: 'BNB Chain', kind: PARTNER_KIND.EVENT, url: 'https://www.bnbchain.org', logo: 'https://www.bnbchain.org/favicon.ico' },
  { name: 'TermiX', kind: PARTNER_KIND.EVENT, url: 'https://termix.ai', logo: 'https://termix.ai/favicon.svg' },
  { name: 'PancakeSwap', kind: PARTNER_KIND.EVENT, url: 'https://pancakeswap.finance', logo: 'https://pancakeswap.finance/favicon.ico' },
  { name: 'Altana', kind: PARTNER_KIND.EVENT, url: 'https://altana.network', logo: 'https://docs.altana.network/favicon.svg' },
  { name: 'AltLayer', kind: PARTNER_KIND.EVENT, url: 'https://www.altlayer.io', logo: 'https://www.altlayer.io/favicon.ico' },

  // Services the running system reads from or settles through.
  { name: '8004scan', kind: PARTNER_KIND.SERVICE, url: 'https://8004scan.io', logo: 'https://8004scan.io/favicon.ico' },
  { name: 'The Graph', kind: PARTNER_KIND.SERVICE, url: 'https://thegraph.com', logo: 'https://storage.thegraph.com/favicons/64x64.png' },
  { name: 'Zerion', kind: PARTNER_KIND.SERVICE, url: 'https://zerion.io', logo: 'https://zerion.io/favicon-wallet-32.png' },
  { name: 'BscScan', kind: PARTNER_KIND.SERVICE, url: 'https://bscscan.com', logo: 'https://bscscan.com/favicon.ico' },
  { name: 'bloXroute', kind: PARTNER_KIND.SERVICE, url: 'https://bloxroute.com', logo: 'https://bloxroute.com/favicon.ico' },
  { name: 'DefiLlama', kind: PARTNER_KIND.SERVICE, url: 'https://defillama.com', logo: 'https://defillama.com/favicon.ico' },
  { name: 'CoinGecko', kind: PARTNER_KIND.SERVICE, url: 'https://www.coingecko.com', logo: 'https://www.coingecko.com/favicon.ico' },
  { name: 'DexScreener', kind: PARTNER_KIND.SERVICE, url: 'https://dexscreener.com', logo: 'https://dexscreener.com/favicon.ico' },
  { name: 'GeckoTerminal', kind: PARTNER_KIND.SERVICE, url: 'https://www.geckoterminal.com', logo: 'https://www.geckoterminal.com/favicon.ico' },

  // Tools in the build and payment path.
  { name: 'MetaMask', kind: PARTNER_KIND.TOOL, url: 'https://metamask.io', logo: 'https://metamask.io/favicon.ico' },
  { name: 'Crossmint', kind: PARTNER_KIND.TOOL, url: 'https://www.crossmint.com', logo: 'https://www.crossmint.com/favicon.ico' },
];

/** Credited in text because their terms do not allow us to show the mark. */
export const CREDITED_WITHOUT_LOGO = [
  { name: 'Gemini', url: 'https://deepmind.google/technologies/gemini/', reason: 'no Google-approved artwork available at a stable URL' },
  { name: 'Claude Code', url: 'https://claude.com/claude-code', reason: 'Anthropic requires written permission for logo use' },
  { name: 'Infura', url: 'https://www.infura.io', reason: 'no logo asset resolves on infura.io' },
];
