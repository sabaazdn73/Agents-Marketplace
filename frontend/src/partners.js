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
  CHAIN: 'chain',
};

export const PARTNERS = [
  // Events the project was built for.
  { name: 'ETHGlobal', kind: PARTNER_KIND.EVENT, url: 'https://ethglobal.com', logo: 'https://ethglobal.com/favicon.ico' },
  { name: 'BNB Chain', kind: PARTNER_KIND.EVENT, url: 'https://www.bnbchain.org', logo: 'https://www.bnbchain.org/favicon.ico' },
  { name: 'TermiX', kind: PARTNER_KIND.EVENT, url: 'https://termix.ai', logo: 'https://termix.ai/favicon.svg' },
  { name: 'PancakeSwap', kind: PARTNER_KIND.EVENT, url: 'https://pancakeswap.finance', logo: 'https://pancakeswap.finance/favicon.ico' },
  { name: 'Altana', kind: PARTNER_KIND.EVENT, url: 'https://altana.network', logo: 'https://docs.altana.network/favicon.svg' },
  { name: 'AltLayer', kind: PARTNER_KIND.EVENT, url: 'https://www.altlayer.io', logo: 'https://www.altlayer.io/favicon.ico' },
  // Colosseum, added 2026-09-15. Hackathons, an accelerator and a fund, in
  // their own words on colosseum.com.
  //
  // The URL is .com, not .org. Both serve the same site, and .com is what
  // their own <link rel="canonical"> names, so a link to .org would be a
  // redirect hop for no reason.
  //
  // The mark is their favicon.svg rather than the .ico or the 96px PNG,
  // and the difference is visible at the strip's 20px. The raster files are
  // a hard-edged black square, opaque corner to corner; the SVG carries the
  // same temple on the same black ground but clips it to a rounded tile, so
  // it sits with the other marks instead of reading as a cut-out. All three
  // were fetched and inspected: the SVG parses as XML with <svg> at the
  // root, the .ico carries three real sizes, and the PNG decodes at 96x96.
  { name: 'Colosseum', kind: PARTNER_KIND.EVENT, url: 'https://colosseum.com', logo: 'https://colosseum.com/favicon.svg' },

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
  // Hyperliquid, added 2026-09-15 with the tab of the same name. A service
  // rather than a chain: the two collectors read its REST and WebSocket
  // APIs, and nothing here is hired or settled on it, which is what the
  // CHAIN group below means.
  //
  // Logo is the path the app's own <head> declares. Worth repeating the
  // trap chainMarks.jsx records, because it is the reason this is not the
  // obvious URL: app.hyperliquid.xyz/favicon.ico returns HTTP 200 and is
  // HTML, the SPA catch-all, and hyperliquid.xyz/favicon.ico returns 403.
  // favicon-32x32.png is a real 32x32 RGBA PNG of 898 bytes, mint glyph on
  // transparency, so it holds on the strip's light and dark grounds alike.
  { name: 'Hyperliquid', kind: PARTNER_KIND.SERVICE, url: 'https://hyperliquid.xyz', logo: 'https://app.hyperliquid.xyz/favicon-32x32.png' },

  // Chains whose agents can actually be hired. Added 2026-09-10, when
  // AgentBudgetEscrow went live on both. BNB Chain is above under events
  // rather than here, because that is how it entered this list.
  //
  // Both logos were fetched and the bytes inspected, the same check the note
  // at the top of this file describes.
  //
  //   Arbitrum   arbitrum.io/favicon.ico, a 3,410 byte .ico carrying one
  //              64x64 PNG. arbitrum.foundation serves the identical file.
  //
  //   Robinhood  robinhood.com/favicon.ico, a 15,086 byte .ico with three
  //              sizes. This is Robinhood's own corporate mark, NOT a
  //              chain-specific one, and that is worth stating: no
  //              chain-specific mark resolves anywhere. chain.robinhood.com
  //              serves no HTTP at all (only its rpc subdomain answers), and
  //              every icon path on the Blockscout explorer returns 404
  //              behind the same Cloudflare interstitial that blocks its API.
  //              Unlike the Gemini case above, the corporate mark here is the
  //              same brand the chain is named for, so it identifies rather
  //              than misrepresents.
  { name: 'Arbitrum', kind: PARTNER_KIND.CHAIN, url: 'https://arbitrum.io', logo: 'https://arbitrum.io/favicon.ico' },
  { name: 'Robinhood Chain', kind: PARTNER_KIND.CHAIN, url: 'https://robinhood.com', logo: 'https://robinhood.com/favicon.ico' },

  // EVERY CHAIN THE SITE HAS A TAB FOR, added 2026-09-19.
  //
  // The strip carried three of the seven, so a reader saw Arbitrum and
  // Robinhood Chain credited and not Ethereum, Solana, Monad or the venue the
  // deepest measurements on the site come from.
  //
  // The marks are the same URLs chainViews/chainMarks.jsx uses for the tab
  // strip, deliberately: two lists of chain logos that can disagree is how one
  // of them ends up stale, and every one of these was already checked live
  // when its tab was added. The reasoning behind each is in that file, and the
  // Hyperliquid one is worth repeating: their brand kit ships only ZIPs, so
  // the mark comes from the path the app's own <head> declares, because
  // app.hyperliquid.xyz/favicon.ico returns the SPA's HTML and the apex
  // returns 403.
  //
  // BNB Chain is NOT repeated here. It is already in this list as an event,
  // which is how it reaches the strip, and a second entry would put the same
  // name in twice, which is the fault that was just fixed.
  { name: 'Hyperliquid', kind: PARTNER_KIND.CHAIN, url: 'https://hyperliquid.xyz', logo: 'https://app.hyperliquid.xyz/favicon-32x32.png' },
  { name: 'Ethereum', kind: PARTNER_KIND.CHAIN, url: 'https://ethereum.org', logo: 'https://ethereum.org/favicon.ico' },
  { name: 'Solana', kind: PARTNER_KIND.CHAIN, url: 'https://solana.com', logo: 'https://solana.com/src/img/branding/solanaLogoMark.svg' },
  { name: 'Monad', kind: PARTNER_KIND.CHAIN, url: 'https://monad.xyz', logo: 'https://monad.xyz/favicon.ico' },

  // Tools in the build and payment path.
  { name: 'MetaMask', kind: PARTNER_KIND.TOOL, url: 'https://metamask.io', logo: 'https://metamask.io/favicon.ico' },
  { name: 'Crossmint', kind: PARTNER_KIND.TOOL, url: 'https://www.crossmint.com', logo: 'https://www.crossmint.com/favicon.ico' },
];

/** Credited in text because their terms do not allow us to show the mark. */
export const CREDITED_WITHOUT_LOGO = [
  // Arbitrum Open House Singapore, the buildathon Arbitrum and Robinhood
  // Chain support was built for. Checked 2026-09-10 and left out on purpose.
  //
  // The only asset that resolves on arbitrum-singapore.hackquest.io is
  // /favicon.ico, a real 15,086 byte .ico carrying 48x48 and 32x32 images.
  // It was fetched and rendered before being judged, and it is HackQuest's
  // own platform mark, a green wordmark on black, not the event's. The page
  // declares no og:image and serves no apple-touch-icon, and both
  // hackquest.io and www.hackquest.io return 404 for a favicon.
  //
  // Showing the hosting platform's logo under the name of the event would
  // misrepresent both, the same call made for Gemini above. Arbitrum's own
  // mark was not substituted either: it is already in the strip as a chain,
  // and it is not this event's mark.
  { name: 'Arbitrum Open House Singapore', url: 'https://arbitrum-singapore.hackquest.io',
    reason: 'no event-specific mark resolves; the only asset is HackQuest\'s own platform logo' },
  { name: 'Gemini', url: 'https://deepmind.google/technologies/gemini/', reason: 'no Google-approved artwork available at a stable URL' },
  { name: 'Claude Code', url: 'https://claude.com/claude-code', reason: 'Anthropic requires written permission for logo use' },
  { name: 'Infura', url: 'https://www.infura.io', reason: 'no logo asset resolves on infura.io' },
];
