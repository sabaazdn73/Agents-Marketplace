// seoMeta.js
//
// Hand-rolled per-route <title>/<meta description>/<link canonical>
// updater. This project has no react-helmet dependency, and a single,
// small function used from a handful of route-owning components is
// consistent with the rest of this app's own preference for small,
// direct solutions over a new library for one job (see App.jsx's own
// hand-rolled useRoute()).
//
// A bug this fixes (2026-09-02, SEO investigation): index.html's
// title/description/canonical/og:*/twitter:* tags are static, every
// route served the exact same values, and the canonical tag in
// particular unconditionally pointed every single page (including
// /docs/architecture, /skills, etc.) at the bare homepage URL. That
// tells Google those pages are duplicates of the homepage and shouldn't
// be indexed separately, actively harmful for discoverability of every
// non-homepage page, not just a missed opportunity.

const BASE_URL = 'https://www.tnega.app';

function setMeta(selector, attr, value) {
  if (!value) return;
  const el = document.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

/** Call on route change. `title` is appended to ", Tnega" (pass null/
 * undefined for the homepage's own bare "Tnega" title). `description`
 * should be a real, page-specific sentence, not the generic homepage
 * one. `path` is the route's own pathname, used to build the
 * canonical/og:url so each page declares itself, not the homepage. */
export function updatePageMeta({ title, ogTitle, description, path = '/' }) {
  const fullTitle = title ? `${title}, Tnega` : 'Tnega';
  // The tab title and the link-preview headline are different jobs. A tab is
  // read in a strip a few characters wide, so "Tnega" is right there; a
  // preview headline has a full line and should say what the thing is.
  // Falls back to the tab title, so every route that does not care is
  // unaffected.
  const socialTitle = ogTitle || fullTitle;
  document.title = fullTitle;
  const url = path === '/' ? BASE_URL : `${BASE_URL}${path}`;

  setMeta('meta[name="description"]', 'content', description);
  setMeta('link[rel="canonical"]', 'href', url);
  setMeta('meta[property="og:url"]', 'content', url);
  setMeta('meta[property="og:title"]', 'content', socialTitle);
  setMeta('meta[property="og:description"]', 'content', description);
  setMeta('meta[name="twitter:title"]', 'content', socialTitle);
  setMeta('meta[name="twitter:description"]', 'content', description);
}
