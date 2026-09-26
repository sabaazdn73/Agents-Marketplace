// dataLive.js
//
// THE ONE SWITCH for everything that reads the tokenized-equity endpoints
// (SPEC.md §B.7): the Stocks & ETFs, Vaults and My ETFs pages, the home
// page's lists and cards, and the site's descriptions (siteCopy.js). False
// until those endpoints serve real data; flip it in the pass that proves
// they do, together with the sitemap (public/sitemap.xml and
// backend/scripts/build_sitemap.py).
//
// A dev server with the fixtures on (VITE_TE_FIXTURES=1) turns it on so the
// layout can be seen; a production build never does. Plain module, no
// imports: vite.config.js reads it through siteCopy.js at build time, where
// import.meta.env is undefined and this is false.

export const DATA_LIVE = !!(import.meta.env?.DEV && import.meta.env?.VITE_TE_FIXTURES === '1') || false;
