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
// path redirects to "/" (routePaths.js). Every page is live: each shows what
// its reads return and draws nothing where a read has nothing, so no page
// needs hiding while its data arrives (owner, 2026-09-26).
// backend/scripts/build_sitemap.py keeps its own list of the site's pages;
// change it in the same pass.
//
// The order is the owner's: Stocks & ETFs, Vaults, My ETFs, Dashboard, Use
// with AI. The home page is "/" and is reached from the logo.

import { LayoutDashboard, LineChart, Landmark, PieChart, Terminal } from 'lucide-react';

export const ALL_PRODUCT_NAV = [
  { id: 'stocks', path: '/stocks', label: 'Stocks & ETFs', barLabel: 'Stocks', icon: LineChart, live: true },
  { id: 'vaults', path: '/vaults', label: 'Vaults', barLabel: 'Vaults', icon: Landmark, live: true },
  { id: 'my-etfs', path: '/my-etfs', label: 'My ETFs', barLabel: 'My ETFs', icon: PieChart, live: true },
  { id: 'dashboard', path: '/dashboard', label: 'Dashboard', barLabel: 'Dashboard', icon: LayoutDashboard, live: true },
  { id: 'ai', path: '/ai', label: 'Use with AI', barLabel: 'AI', icon: Terminal, live: true },
];

/** The pages shown in the navigation: the live ones, in order. */
export const PRODUCT_NAV = ALL_PRODUCT_NAV.filter((i) => i.live);

/** Is this product page live? An id that is not a product page is not. */
export function isLive(id) {
  return PRODUCT_NAV.some((i) => i.id === id);
}

/** The paths of the pages that are not live. routePaths.js sends each to "/". */
export const HIDDEN_PRODUCT_PATHS = ALL_PRODUCT_NAV.filter((i) => !i.live).map((i) => i.path);

/** The top search opens Stocks & ETFs, so it shows only while that page is live. */
export const SEARCH_LIVE = isLive('stocks');

// The tabs the product pages own, and the home page. Explore and My Agents
// are routes too, but they are reached from the footer and keep their own
// layout.
export const PRODUCT_PAGE_IDS = ['home', ...PRODUCT_NAV.map((i) => i.id)];
