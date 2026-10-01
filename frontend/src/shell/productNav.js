// productNav.js
//
// The main navigation, once, for both apps. The web header and the mobile
// bottom bar both read this list, so the two cannot name or order the pages
// differently. Ids and paths match routePaths.js.
//
// `barLabel` is the mobile bottom bar's short form: up to five tabs share
// 390px there, and "Stocks & ETFs" or "Use with AI" would wrap under a 20px
// icon.
//
// `live` IS THE ONE SWITCH FOR A PAGE (SPEC.md §0.10). With `live: false`
// a page is left out of the header, the bottom bar and the sitemap, and its
// path redirects to "/" (routePaths.js). A page is live only when what it
// shows works: Stocks & ETFs, Vaults and My ETFs read endpoints the backend
// has not served yet (SPEC §B.7), so they stay off until it does, and the
// sitemap (public/sitemap.xml, backend/scripts/build_sitemap.py) leaves them
// out in step. The Dashboard reads the wallet's holdings, which work, and
// Use with AI works. A dev server with the fixtures on (VITE_TE_FIXTURES=1)
// turns every page on so the layout can be seen; a production build never
// does.
//
// The order is the owner's: Stocks & ETFs, Vaults, My ETFs, Dashboard, Use
// with AI. The home page is "/" and is reached from the logo.

import { LayoutDashboard, LineChart, Landmark, PieChart, Terminal, Lock, BookOpen, Info } from 'lucide-react';

import { DATA_LIVE } from '../dataLive.js';

export const ALL_PRODUCT_NAV = [
  { id: 'stocks', path: '/stocks', label: 'Stocks & ETFs', barLabel: 'Stocks', icon: LineChart, live: DATA_LIVE },
  { id: 'vaults', path: '/vaults', label: 'Vaults', barLabel: 'Vaults', icon: Landmark, live: DATA_LIVE },
  { id: 'my-etfs', path: '/my-etfs', label: 'My ETFs', barLabel: 'My ETFs', icon: PieChart, live: DATA_LIVE },
  { id: 'dashboard', path: '/dashboard', label: 'Dashboard', barLabel: 'Dashboard', icon: LayoutDashboard, live: true },
  { id: 'ai', path: '/ai', label: 'Use with AI', barLabel: 'AI', icon: Terminal, live: true },
];

/** The pages shown in the navigation: the live ones, in order. */
export const PRODUCT_NAV = ALL_PRODUCT_NAV.filter((i) => i.live);

// THE DOCS LINK. /docs is a standalone page (App.jsx renders DocsPage outside
// the shell), not a product page, so it is not in ALL_PRODUCT_NAV: it has no
// tab id in routePaths.js, no `live` switch, no sitemap entry from here, and
// isLive() and PRODUCT_PAGE_IDS do not count it. It is shown in the web
// header after Use with AI (and in its More menu when the row folds) and in
// the phone's menu sheet, but not in the bottom bar, where five tabs already
// share 390px. `href` marks it as a link to a path rather than a tab.
export const DOCS_NAV = { id: 'docs', path: '/docs', href: '/docs', label: 'Docs', icon: BookOpen };

// THE GUIDE LINK. /guide, "Read before you start" (pages/Guide.jsx), is
// where the product pages' explanations live: what each part means, how a
// figure is measured, what is checked before a trade. Unlike /docs it opens
// inside the shell, as a tab of its own (routePaths.js, id 'guide'), so the
// header stays and marks it. It is shown right after Docs, in the header, its
// More menu and the phone's menu sheet, and not in the bottom bar.
export const GUIDE_NAV = { id: 'guide', path: '/guide', href: '/guide', label: 'Guide', icon: Info };

/** The web header's row: the product pages, then Docs, then the guide. */
export const HEADER_NAV = [...PRODUCT_NAV, DOCS_NAV, GUIDE_NAV];

/** Is this path the docs (/docs, /docs/<page>, /docs#part)? */
export const isDocsPath = (path) => path === '/docs' || path.startsWith('/docs/') || path.startsWith('/docs#');

// PRODUCT PAGES OUTSIDE THE MAIN NAVIGATION. Same switch, same shell, but
// reached from the home page, the footer and the stock pages rather than the
// header or the bottom bar (five tabs already share 390px there).
// /issuer-controls reads /api/te/controls, so it is live with the other
// tokenized-equity pages (dataLive.js).
export const ALL_EXTRA_PAGES = [
  { id: 'issuer-controls', path: '/issuer-controls', label: 'Issuer controls', icon: Lock, live: DATA_LIVE },
];

/** The extra pages that are live, for the footer. */
export const EXTRA_PAGES = ALL_EXTRA_PAGES.filter((i) => i.live);

/** Is this product page live? An id that is not a product page is not. */
export function isLive(id) {
  return PRODUCT_NAV.some((i) => i.id === id) || EXTRA_PAGES.some((i) => i.id === id);
}

/** The paths of the pages that are not live. routePaths.js sends each to "/". */
export const HIDDEN_PRODUCT_PATHS = [...ALL_PRODUCT_NAV, ...ALL_EXTRA_PAGES].filter((i) => !i.live).map((i) => i.path);

/** The top search opens Stocks & ETFs, so it shows only while that page is live. */
export const SEARCH_LIVE = isLive('stocks');

// The tabs the product pages own, the home page and the guide. Explore and My Agents
// are routes too, but they are reached from the footer and keep their own
// layout.
export const PRODUCT_PAGE_IDS = ['home', ...PRODUCT_NAV.map((i) => i.id), ...EXTRA_PAGES.map((i) => i.id), GUIDE_NAV.id];
