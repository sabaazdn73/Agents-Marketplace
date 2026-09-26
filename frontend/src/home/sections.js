// home/sections.js
//
// The home page's section switches (SPEC.md §0.10). Most sections need no
// switch: each renders only when its endpoint answers with real rows. These
// two describe something that is not a read, so a switch says whether it
// works end to end yet:
//   buy   "No account. One signature." Describes the buy flow. On only
//         once a real run reaches the wallet's signature prompt (SPEC T4a).
//   ai    "Your AI asks Tnega. You sign." Describes the stock tools on the
//         MCP server. On only once tnega_search, tnega_quote and
//         tnega_buy_link answer live (SPEC T8).
// A dev server with VITE_TE_FIXTURES=1 turns both on so the layout can be
// seen; a production build never does (import.meta.env.DEV is false there).

const DEV_LAYOUT = import.meta.env.DEV && import.meta.env.VITE_TE_FIXTURES === '1';

export const SECTION_LIVE = {
  buy: DEV_LAYOUT || false,
  ai: DEV_LAYOUT || false,
};

// The launch film behind "Watch the tour". Its host is the owner's choice
// (Vercel Blob or R2, or YouTube); until a URL is set here through
// VITE_TOUR_VIDEO_URL the button does not render.
export const TOUR_VIDEO_URL = import.meta.env.VITE_TOUR_VIDEO_URL || null;
export const TOUR_POSTER_URL = import.meta.env.VITE_TOUR_POSTER_URL || null;
