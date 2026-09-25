// productNav.js
//
// The main navigation, once, for both apps. The web header and the mobile
// bottom bar both read this list, so the two cannot name or order the pages
// differently. Ids match routePaths.js.
//
// `barLabel` is the mobile bottom bar's short form: five tabs share 390px
// there, and "Stocks & ETFs" or "Use with AI" would wrap under a 20px icon.

import { LayoutDashboard, LineChart, Landmark, PieChart, Terminal } from 'lucide-react';

export const PRODUCT_NAV = [
  { id: 'dashboard', label: 'Dashboard', barLabel: 'Dashboard', icon: LayoutDashboard },
  { id: 'stocks', label: 'Stocks & ETFs', barLabel: 'Stocks', icon: LineChart },
  { id: 'vaults', label: 'Vaults', barLabel: 'Vaults', icon: Landmark },
  { id: 'my-etfs', label: 'My ETFs', barLabel: 'My ETFs', icon: PieChart },
  { id: 'ai', label: 'Use with AI', barLabel: 'AI', icon: Terminal },
];

// The tabs the product pages own. Explore and My Agents are routes too, but
// they are reached from the footer and keep their own layout.
export const PRODUCT_PAGE_IDS = PRODUCT_NAV.map((i) => i.id);
