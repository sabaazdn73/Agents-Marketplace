// dataLive.js
//
// THE ONE SWITCH for everything that reads the tokenized-equity endpoints
// (SPEC.md §B.7): the Stocks & ETFs, Vaults and My ETFs pages, the home
// page's lists and cards, and the site's descriptions (siteCopy.js).
//
// ON since 2026-09-27: the endpoints serve real data in production
// (/api/te/list, /underlying, /curve, /summary, /api/vaults and
// /api/baskets/*, checked on the live API the day it was turned on). The
// sitemap lists the three pages (public/sitemap.xml and
// backend/scripts/build_sitemap.py). The Buy panel has its own switch
// (home/sections.js `buy`, read through trade/buyLive.js) and stays off.
//
// Plain module, no imports: vite.config.js reads it through siteCopy.js at
// build time.

// A dev server may read a real backend instead of production's:
// `TE_API=<its origin> npx vite` (e.g. http://127.0.0.1:8766) turns the
// fixtures off and sends every te read there (te/api.js). vite.config.js
// defines __TE_DEV_API__ for the dev server only, and as "" in a build, so
// the origin never reaches a production bundle. It does not change this
// switch, which is on.

export const DATA_LIVE = true;
