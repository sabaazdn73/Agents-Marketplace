// routePaths.js
//
// per-tab URL routing map for the main app's tabs, each gets its
// own real, bookmarkable path (extending this file's existing standalone
// routes like /ecosystem: a plain pathname check, same hand-rolled
// useRoute() in App.jsx, no second/inconsistent routing approach). Only
// the top-level tab gets a URL; in-tab state (which agent's detail
// view is open, whether the hire flow is showing) stays local component
// state, same as it always has, that matches the ask ("each major
// section has its own URL"), not every possible sub-view.
//
// Pulled into its own plain module (no JSX/React import) specifically so
// it can be verified directly in a headless test against the tab ids
// NAV_ITEMS uses in AgentMarketplaceApp.web.jsx/.mobile.jsx, without
// having to bundle the whole app (wagmi/RainbowKit) just to check a
// lookup table.
//
// '/skills' added 2026-08-29 alongside NAV_ITEMS' own new 'skills' tab,
// without a path here, onNavChange('skills') (used by the "Try it
// yourself" deep-link from an agent's detail page) would silently fall
// back to '/market' in App.jsx's own `NAV_TO_PATH[id] || '/market'`,
// leaving the URL bar wrong and breaking a direct link/refresh into Skills.
// '/native-agents' added 2026-09-01 alongside NAV_ITEMS' own new
// 'native' tab, same reasoning as '/skills' above.
// '/connect' added 2026-09-17 alongside NAV_ITEMS' own new 'connect' tab,
// same reasoning again.
export const MAIN_TAB_PATHS = {
  // A destination, not the entry point: '/' still resolves to the
  // main agent listing, and this is reachable from the nav or its own URL.
  '/home': 'landing',
  // The tab is now called Explore. The path is not: /market is
  // in shared links, in the sitemap, and in the Chrome Web Store listing, and
  // renaming a path breaks every one of them for nothing. The id stays
  // 'market' for the same reason, since every `nav === 'market'` check in
  // both apps reads it.
  // Renamed to How It Works on 2026-09-18 and moved directly after Home,
  // because a visitor arriving with no idea what this is had nowhere to start.
  // /connect still resolves: it is in shared links and in the Chrome Web Store
  // listing, and a rename that breaks a URL breaks those for nothing.
  // Order matters here and it is not cosmetic: NAV_TO_PATH below is built with
  // Object.fromEntries over these pairs, so for two paths sharing one tab id
  // the LAST one wins. /how-it-works must therefore come second, or the app
  // keeps navigating to /connect and the new URL is one nothing ever links to.
  '/connect': 'connect',
  '/how-it-works': 'connect',
  '/market': 'market',
  '/skills': 'skills',
  '/native-agents': 'native',
  '/my-agents': 'my-agents',
  '/report': 'report',
  '/learn': 'learn',
  '/build': 'build',
  '/sell': 'sell',
  // Pay.B402 folded into the studio. The old path still resolves so any
  // link that exists keeps landing somewhere.
  '/pay-b402': 'studio',
  '/studio': 'studio',
};

export const NAV_TO_PATH = Object.fromEntries(Object.entries(MAIN_TAB_PATHS).map(([p, id]) => [id, p]));
