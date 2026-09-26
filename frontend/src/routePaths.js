// routePaths.js
//
// Which URL opens which tab of the app shell, and which old URLs now land
// somewhere else. A plain module with no JSX or React import, so a headless
// check can read it without bundling the app (wagmi, RainbowKit).
//
// THE PRODUCT, 2026-09-25
// Five pages: Dashboard (/), Stocks & ETFs, Vaults, My ETFs, Use with AI.
// Explore (/market) and My Agents (/my-agents, the hire flow) stay as routes,
// reached from the footer rather than the main navigation. The tab ids are
// the ones NAV_ITEMS uses in both apps (shell/productNav.js).
//
// Order matters: NAV_TO_PATH is built with Object.fromEntries over these
// pairs, so if two paths ever share one id the LAST one wins.
export const MAIN_TAB_PATHS = {
  '/': 'dashboard',
  '/stocks': 'stocks',
  '/vaults': 'vaults',
  '/my-etfs': 'my-etfs',
  '/ai': 'ai',
  // Explore keeps /market, and the id 'market': shared links, the Chrome Web
  // Store listing and every `nav === 'market'` check read them.
  '/market': 'market',
  '/my-agents': 'my-agents',
};

export const NAV_TO_PATH = Object.fromEntries(Object.entries(MAIN_TAB_PATHS).map(([p, id]) => [id, p]));

// OLD PATHS, AND WHERE THEY LAND NOW.
//
// Every one of these was a tab, and each is in someone's bookmarks, in shared
// links or in the sitemap search engines already hold. A redirect, not a
// 404, and a replace, so Back does not return to a URL that only bounces.
// /connect and /how-it-works are also in the Chrome Web Store listing; they
// go to /ai, which carries the MCP section they used to lead to.
//
// Not here, deliberately: /chain/hyperliquid (the extension links to it; it
// still resolves to Explore while the owner decides), /agent/<id> and
// /chain-agent/<chain>/<id> (Explore's own agent pages).
export const REDIRECTS = {
  '/connect': '/ai',
  '/how-it-works': '/ai',
  '/home': '/',
  '/wallet': '/',
  '/native-agents': '/',
  '/studio': '/',
  '/pay-b402': '/',
  '/build': '/',
  '/sell': '/',
  '/skills': '/',
  '/report': '/',
  '/learn': '/',
};

// STANDALONE ROUTES: pages App.jsx renders outside the app shell. Listed
// here so that "is this a page we serve" has one answer. /docs/<slug> is
// matched by prefix below; DocsPage.jsx handles a slug it does not know.
export const STANDALONE_PATHS = [
  '/signin', '/status', '/data-sources', '/privacy', '/partners', '/docs',
  '/canary', '/ecosystem',
];

// Explore's own addresses, which open the Explore tab: one agent's page
// (/agent/<id>), one agent on another chain (/chain-agent/<chainId>/<id>) and
// a chain view by name (/chain/<view>; the extension links to
// /chain/hyperliquid). The view names are ChainViewTabs.jsx's FALLBACK_TABS.
const CHAIN_VIEW_IDS = ['hyperliquid', 'bnb', 'ethereum', 'solana', 'arbitrum', 'robinhood', 'monad'];
// The chains whose agents have a /chain-agent/ page: ChainViewTabs.jsx's
// CHAIN_TO_VIEW (Arbitrum and Robinhood Chain). Any other chain id there
// opened Explore's chooser under an address that named nothing.
const CHAIN_AGENT_CHAIN_IDS = [42161, 4663];
const EXPLORE_PATTERNS = [
  /^\/agent\/[^/]+$/,
  new RegExp(`^/chain-agent/(${CHAIN_AGENT_CHAIN_IDS.join('|')})/[^/]+$`),
  new RegExp(`^/chain/(${CHAIN_VIEW_IDS.join('|')})$`),
];

/** Is this an Explore deep link (an agent page or a chain view)? */
export function isExplorePath(pathname) {
  return EXPLORE_PATTERNS.some((re) => re.test(pathname));
}

/** "/stocks/" and "/stocks" are one page. The root keeps its slash. */
export function stripTrailingSlash(pathname) {
  const p = pathname.replace(/\/+$/, '');
  return p || '/';
}

function isServed(p) {
  return Object.prototype.hasOwnProperty.call(MAIN_TAB_PATHS, p)
    || STANDALONE_PATHS.includes(p)
    || p.startsWith('/docs/')
    || isExplorePath(p);
}

/** The path a pathname should be served at: itself, or its redirect target.
 *  A trailing slash is ignored ("/wallet/" redirects like "/wallet"). */
export function redirectTarget(pathname) {
  const p = stripTrailingSlash(pathname);
  return Object.prototype.hasOwnProperty.call(REDIRECTS, p) ? REDIRECTS[p] : null;
}

/** Where a pathname is served, and whether the address bar has to change.
 *
 *  In order: the trailing slash goes ("/ai/" is "/ai"); an old path takes
 *  its redirect; a page name typed in capitals ("/Stocks") takes its
 *  lowercase form, for page names only, since an agent id in a path may be
 *  case-sensitive; and a path that is none of the site's pages goes to "/",
 *  the Dashboard.
 *
 *  UNKNOWN PATHS GO TO THE DASHBOARD, NOT A NOT-FOUND PAGE. Until 2026-09-25
 *  any unknown path rendered Explore under its own address, and published
 *  that junk address as its canonical URL. Now the address itself is
 *  replaced, so the canonical is always one of the site's real pages and
 *  Back does not return to a URL that only bounces. */
export function resolvePath(pathname) {
  const p = stripTrailingSlash(pathname || '/');
  const redirected = redirectTarget(p);
  if (redirected) return { path: redirected, changed: true };
  if (isServed(p)) return { path: p, changed: p !== pathname };
  const lower = p.toLowerCase();
  if (lower !== p && isServed(lower) && !isExplorePath(lower)) return { path: lower, changed: true };
  return { path: '/', changed: true, unknown: true };
}

/** The tab a pathname opens. Expects a path already through resolvePath.
 *  Explore's agent pages and chain views open Explore. So does "/" with the
 *  original share format, "?agent=<id>", which was written while "/" was
 *  Explore and is still out in shared links. Anything else opens the
 *  Dashboard. */
export function tabForPath(pathname, search = '') {
  if (pathname === '/' && /[?&]agent=/.test(search)) return 'market';
  if (Object.prototype.hasOwnProperty.call(MAIN_TAB_PATHS, pathname)) return MAIN_TAB_PATHS[pathname];
  if (isExplorePath(pathname)) return 'market';
  return 'dashboard';
}
