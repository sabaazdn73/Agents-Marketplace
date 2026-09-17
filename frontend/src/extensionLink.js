// extensionLink.js
//
// One constant, one place to correct it.
//
// The Chrome Web Store item URL is not known yet: the listing has been
// submitted but the store assigns the item id at publication, and that id is
// the only part of the URL nobody can guess. Until it is known this points at
// the store's own search for the listing's exact name, which resolves to the
// published item rather than to a 404 and does not have to be taken down when
// the id arrives.
//
// WHEN THE LISTING ID IS KNOWN, replace the value below with the exact item
// URL, which has the shape
//   https://chromewebstore.google.com/detail/tnega-for-hyperliquid/<item id>
// and change nothing else. Every place on the site that offers the extension
// reads this constant: the Connect tab, the Hyperliquid tab, and anywhere
// added later. A second copy of this URL is the defect this module exists to
// prevent.

/** Where a reader installs the extension from. See the note above. */
export const CHROME_EXTENSION_URL =
  'https://chromewebstore.google.com/search/Tnega%20for%20Hyperliquid';

/** The listing's name, used wherever the link is labelled, so the link text
 *  and the thing it searches for cannot drift apart. */
export const CHROME_EXTENSION_NAME = 'Tnega for Hyperliquid';
