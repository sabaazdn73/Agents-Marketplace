// guide/index.js
//
// The sections of "Read before you start" (/guide, pages/Guide.jsx), in the
// order the page shows them. The product pages stay short: a title, the
// figures and one muted line. What each part means, how a figure is measured
// and what is checked before a trade lives here, one section per topic, and
// each page links to its own section with a "How this works" link
// (guide/GuideLink.jsx) that opens /guide#<id>.
//
// ONE FILE PER TOPIC, in this folder. Each file's default export is
//
//   { id: 'stocks', title: 'Stocks & ETFs', summary: 'One line.', Body }
//
// where `id` is the anchor (/guide#stocks), `summary` one line under the
// title, and `Body` a component with no props that renders the section's
// text (guide/parts.jsx has the shared pieces: Q for one question and its
// answer, Terms for a list of terms). A file listed below that does not
// exist yet, or exports nothing usable, is skipped: the page shows the
// sections there are.

// Only the topic files: the shared pieces (parts.jsx, GuideLink.jsx) are
// globbed too but never read here.
const files = import.meta.glob('./*.jsx', { eager: true });

// The order: the product pages in the header's order, then the parts that
// cut across them.
export const GUIDE_ORDER = [
  ['stocks', 'stocks.jsx'],
  ['stock-page', 'stockPage.jsx'],
  ['costs', 'costs.jsx'],
  ['trading', 'trading.jsx'],
  ['issuer-controls', 'issuerControls.jsx'],
  ['vaults', 'vaults.jsx'],
  ['my-etfs', 'myEtfs.jsx'],
  ['dashboard', 'dashboard.jsx'],
  ['use-with-ai', 'useWithAi.jsx'],
  ['signing', 'signing.jsx'],
];

const usable = (s) => s && typeof s.id === 'string' && typeof s.title === 'string' && typeof s.Body === 'function';

/** The sections that exist, in order. */
export const GUIDE_SECTIONS = GUIDE_ORDER
  .map(([, file]) => files[`./${file}`]?.default)
  .filter(usable);
