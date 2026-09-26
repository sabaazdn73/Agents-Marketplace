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
// `live` IS THE ONE SWITCH FOR A PAGE. A page goes live only when it works
// end to end (owner, 2026-09-26); no placeholder page is shown. With
// `live: false` a page is left out of the header, the bottom bar and the
// sitemap, its path redirects to "/" (routePaths.js), and the top search,
// which opens Stocks & ETFs, is hidden while that page is not live. The
// page's component stays in the code, ready for the day its flag turns on.
// backend/scripts/build_sitemap.py keeps its own copy of the hidden paths;
// change it in the same pass.

import { LayoutDashboard, LineChart, Landmark, PieChart, Terminal } from 'lucide-react';

export const ALL_PRODUCT_NAV = [
  { id: 'dashboard', path: '/', label: 'Dashboard', barLabel: 'Dashboard', icon: LayoutDashboard, live: true },
  { id: 'stocks', path: '/stocks', label: 'Stocks & ETFs', barLabel: 'Stocks', icon: LineChart, live: false },
  { id: 'vaults', path: '/vaults', label: 'Vaults', barLabel: 'Vaults', icon: Landmark, live: false },
  { id: 'my-etfs', path: '/my-etfs', label: 'My ETFs', barLabel: 'My ETFs', icon: PieChart, live: false },
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

// The tabs the product pages own. Explore and My Agents are routes too, but
// they are reached from the footer and keep their own layout.
export const PRODUCT_PAGE_IDS = PRODUCT_NAV.map((i) => i.id);
