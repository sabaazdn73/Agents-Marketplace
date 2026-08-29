// routePaths.js
//
// Real per-tab URL routing map for the main app's tabs — each gets its
// own real, bookmarkable path (extending this file's existing standalone
// routes like /ecosystem: a plain pathname check, same hand-rolled
// useRoute() in App.jsx, no second/inconsistent routing approach). Only
// the top-level tab gets a real URL; in-tab state (which agent's detail
// view is open, whether the hire flow is showing) stays local component
// state, same as it always has — that matches the real ask ("each major
// section has its own URL"), not every possible sub-view.
//
// Pulled into its own plain module (no JSX/React import) specifically so
// it can be verified directly in a headless test against the real tab ids
// NAV_ITEMS uses in AgentMarketplaceApp.web.jsx/.mobile.jsx, without
// having to bundle the whole app (wagmi/Privy/RainbowKit) just to check a
// lookup table.
//
// '/skills' added 2026-08-29 alongside NAV_ITEMS' own new 'skills' tab —
// without a real path here, onNavChange('skills') (used by the "Try it
// yourself" deep-link from an agent's detail page) would silently fall
// back to '/market' in App.jsx's own `NAV_TO_PATH[id] || '/market'`,
// leaving the URL bar wrong and breaking a direct link/refresh into Skills.
export const MAIN_TAB_PATHS = {
  '/market': 'market',
  '/skills': 'skills',
  '/my-agents': 'my-agents',
  '/report': 'report',
  '/learn': 'learn',
  '/build': 'build',
  '/sell': 'sell',
};

export const NAV_TO_PATH = Object.fromEntries(Object.entries(MAIN_TAB_PATHS).map(([p, id]) => [id, p]));
