// extensionLink.js
//
// One constant, one place to correct it.
//
// The listing is published. Its item id is dimmedbfoejeemojaenbknpcmjgomipk,
// assigned by the Chrome Web Store at publication, which is why this file
// pointed at a store search until 2026-09-17: the id is the one part of the
// URL nobody can guess, and a direct link built before it existed would have
// been a guess.
//
// Confirmed rather than assumed before it was written here. The store's own
// search response carried detail/tnega-for-hyperliquid/dimmed…, and that URL
// returns 200 with the title "Tnega for Hyperliquid - Chrome Web Store" and
// this project's own description text.
//
// Every place on the site that offers the extension reads this constant: the
// Connect tab, the Hyperliquid tab, and anywhere added later. A second copy of
// this URL is the defect this module exists to prevent.

/** Where a reader installs the extension from. See the note above. */
export const CHROME_EXTENSION_URL =
  'https://chromewebstore.google.com/detail/tnega-for-hyperliquid/dimmedbfoejeemojaenbknpcmjgomipk';

/** The listing's name, used wherever the link is labelled, so the link text
 *  and the thing it searches for cannot drift apart. */
export const CHROME_EXTENSION_NAME = 'Tnega for Hyperliquid';
