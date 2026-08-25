// routePaths.js
//
// Real per-tab URL routing map for the main app's 6 tabs — each gets its
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
export const MAIN_TAB_PATHS = {
  '/market': 'market',
  '/my-agents': 'my-agents',
  '/report': 'report',
  '/learn': 'learn',
  '/build': 'build',
  '/sell': 'sell',
};

export const NAV_TO_PATH = Object.fromEntries(Object.entries(MAIN_TAB_PATHS).map(([p, id]) => [id, p]));
