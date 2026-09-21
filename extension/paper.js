// paper.js
//
// Practice mode's panel: the markup, where it goes, and how it updates.
// paperSim.js decides what a trade would have done and owns no DOM; this file
// owns all of it and owns no simulation.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS A REBUILD AND NOT A PATCH
//
// Three things were wrong with the shipped panel, and two of them were fatal.
//
// 1. It did `panel.innerHTML = ...` inside a 4-second tick. That destroys and
//    recreates the <input> the person is typing into: focus is lost, the caret
//    is gone, and a number typed between ticks is wiped before submit can read
//    it. Submitting then said "Enter a size first". Nobody could place an
//    order. The fix is structural, so the whole render path is replaced: the
//    DOM is built once, and every update writes text and values into nodes
//    that already exist, never into a field that holds focus.
//
// 2. It rendered below Hyperliquid's orders section, at y=1074 in an 813px
//    viewport. It was never on screen. See the placement note below.
//
// 3. It did not look like the page. It derived its colours by shifting the
//    luminance of document.body, which cannot reach their control fill because
//    that colour is blue-shifted as well as darker. The palette is now the one
//    measured off their own order form; see paper.css for the values and the
//    cost of hardcoding them.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHERE IT GOES. A TAB BY DEFAULT, A PANEL WHEN ASKED FOR.
//
// Practice mode covers nothing until somebody opens it. Closed, the only thing
// on the page is a small tab carrying the cat and the header sentence. Opened,
// the panel appears over their ORDER BOOK, not over their order entry. Closing
// returns to the tab.
//
// All of the following was measured over CDP on 2026-09-21 at four window
// sizes, not recalled. The right column, in viewport coordinates:
//
//   window      their order form        their order book       book below fold
//   1280x813    59..736  left 915 362w  739..1409 left 915     739 > 813 - 74
//   1280x1024   59..736  left 915 362w  739..1409 left 915     739 > 1024 - 285
//   1440x900    59..729  left 1171 266w  59..729  left 901     none
//   1920x1080   59..729  left 1561 356w  59..729  left 1201    none
//
// Two facts in that table drive everything here.
//
// FIRST: at 1440 and above the book is NOT below the form, it is a second
// column beside it, and both start at y=59. A panel of about 610 fits entirely
// inside the book's own rectangle there, covering the book and nothing else.
// That is the normal case and it is exact.
//
// SECOND: at 1280 the book is below the form and starts at y=739, so at a
// height of 813 only 74px of it is above the fold. "Over the book" and "wholly
// on screen" cannot both hold; it would take a window about 1350 tall. So the
// panel grows upward from the bottom of the viewport, over the lower part of
// their form, and it takes as little of that as it can: the body scrolls
// internally, so the height is clamped to a usable minimum rather than to the
// content. At 1280x813 that puts the panel's top at 363, which is 304px down
// their form, four pixels above the dead band described next. Their leverage
// row, their tabs, their Buy/Sell pill, both account rows, their Size box and
// their slider all stay visible. This is the fallback, and it is the only size
// measured where it is reached.
//
// WHERE THE TAB GOES, WHICH IS THE PART THAT HAD TO BE MEASURED RATHER THAN
// CHOSEN. Projecting every control and every painted leaf in their form onto
// its vertical axis leaves one large unoccupied band, and it is in the same
// place at all four window sizes:
//
//   1280x813 / 1280x1024   form-relative y 322..495, 173px tall, full width
//   1440x900 / 1920x1080   form-relative y 322..488, 166px tall, full width
//
// It is the space between their Take Profit / Stop Loss checkbox and their
// Connect button. It holds no control, no text and no painted surface. The tab
// sits in it. Their form's top is 59 at every size measured, so the band is at
// viewport y 381..547 and the tab is reachable without scrolling everywhere,
// which is the requirement. Covering a corner of their form was the
// alternative; there is no need for it when there is a band this size that is
// theirs and empty.
//
// position:fixed is what makes this survive their grid. react-grid-layout
// positions its items by transform and knows nothing about a foreign child, so
// a child appended into the grid lands at 0,0 over the chart. Living on
// document.body instead and re-measuring their items on resize, on mutation of
// the style attribute a drag writes, and on scroll means a dragged or resized
// column is followed rather than fought.
//
// Their form and their book are found by their own words, not by class names:
// every class on the page is a styled-components hash (sc-bjfHbI, jFothj) that
// changes on their next build. `.react-grid-item` is the exception and is used,
// because that one is react-grid-layout's own published class name rather than
// a generated one.
//
// NARROW. Their grid does not exist below about 1005px: swept from 500 to 1200,
// `.react-grid-layout` is null at 1000 and present at 1010, with seven items.
// With no grid there is nothing to anchor to, so the tab docks to the bottom
// edge of the screen and opens into a bottom sheet. The code switches on
// whether a grid item was actually found rather than on a width, so the exact
// crossover never has to be right.

const PAPER_PANEL_ID = "tnega-paper-panel";
const PAPER_TAB_ID = "tnega-paper-tab";
const PAPER_OPEN_KEY = "tnega_paper_open";

// Present in every state. The tab carries it in full as well, because the cat
// alone does not say that the money is not there.
const PAPER_HEADER_TEXT = "Simulation environment provided by Tnega, paper trading";

// The vocabulary of their order form. `findTheirOrderForm` needs three of these
// on one grid item, which is the threshold stated once here and read there.
const PAPER_FORM_WORDS = [
  "Buy / Long", "Sell / Short", "Available to Trade",
  "Reduce Only", "Order Value", "Margin Required",
];
const PAPER_FORM_HITS = 3;

// Their order book column. "Spread" is the word that is theirs alone; the other
// two appear on tabs elsewhere, so they only confirm.
const PAPER_BOOK_WORDS = ["Spread", "Order Book", "Trades"];
const PAPER_BOOK_HITS = 2;

// The empty band inside their form, form-relative. The first measurement of it
// was taken in one state of their form only, which was wrong: the band moves
// when their Take Profit / Stop Loss box is ticked and when Limit is selected,
// because both add rows above the Connect button. Measured in all four states
// their form can be in while disconnected, in viewport coordinates:
//
//   Market, nothing ticked           381..554   173px
//   Market + Take Profit / Stop Loss 465..554    89px
//   Limit                            422..579   157px
//   Limit + Take Profit / Stop Loss  506..579    73px
//
// The tab goes in the INTERSECTION of all four, 506..554, which is 48px tall
// and the full 342px of their inner width. Taking the 173px version instead
// would put the tab under their own controls for anyone who ticks a box, and a
// tab that covers a control is the thing this shape exists to avoid.
//
// MEASURED FROM THE BOTTOM OF THEIR FORM, NOT THE TOP, and this matters. Their
// form is 677 tall at 1280 and 670 at 1440 and 1920, so everything below the
// slider sits 7px higher at the wider sizes. Offsetting 449 from the top was
// right at 1280 and put the tab's lower edge 5px inside their Connect button at
// 1920, confirmed with elementFromPoint. From the bottom edge the offset is the
// same number at every size measured: the band ends 182px above the form's
// bottom (736-554 and 729-547), so the safe rectangle is bottom-230 to
// bottom-182.
//
// Caveat, recorded because it could not be tested: all of this was measured
// with no wallet connected. Connected, their Connect button becomes Buy/Sell
// and the band may move. The tab is clamped into the viewport regardless, and
// if that band ever closes this needs re-measuring rather than nudging.
const PAPER_TAB_ABOVE_BOTTOM = 230;
const PAPER_TAB_BAND_HEIGHT = 44;

// How short the panel is allowed to be squeezed before it stops giving ground
// and starts covering their form. Below this the ticket is not usable: the
// chips, tabs, side pill, two account rows, Size, slider, checkboxes and the
// submit button come to about 400px with the header, so anything under this
// hides the button that is the point of the panel.
const PAPER_MIN_PANEL_H = 440;

// Margin between the panel and the edges of the viewport. This is THEIR gutter,
// measured: their grid items sit at left 3, and their right column runs
// 915..1277 in a 1280 viewport, so 3px on both sides. A 10px margin looked
// tidier in isolation and was wrong in place: it pulled the panel 7px left of
// the column it is aligned to, which reads as a widget that missed.
const PAPER_EDGE = 3;

// ── Finding their two right-hand columns ────────────────────────────────────

/** The grid item carrying `phrase`, confirmed by `hits` of `words`, or null.
 *
 *  Walks TEXT NODES rather than elements. The obvious version, scanning every
 *  div for the words, reads .textContent off thousands of nodes and each read
 *  concatenates a whole subtree, so on their page it is tens of milliseconds
 *  per call. This runs every 500ms while their app is still drawing, so it has
 *  to be cheap. A text walk touches each character once, stops at the first
 *  phrase that belongs to nothing else on the page, and only then reads
 *  textContent, once, to confirm the candidate.
 */
function findTheirItem(phrase, words, hitsNeeded) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue;
    if (!t || t.length > 120) continue;
    if (t.indexOf(phrase) < 0) continue;
    const el = n.parentElement;
    if (!el) continue;
    // This panel is a copy of their form and carries every one of these words,
    // so without this it finds itself and anchors to its own label row.
    if (el.closest("#" + PAPER_PANEL_ID) || el.closest("#" + PAPER_TAB_ID)) continue;
    const box = el.closest(".react-grid-item") || el.parentElement;
    if (!box) continue;
    const text = box.textContent || "";
    let hits = 0;
    for (const w of words) if (text.includes(w)) hits++;
    if (hits >= hitsNeeded) return box;
  }
  return null;
}

// Re-found only when a cached node leaves the document. Their app re-renders
// on a market change, and querying every animation frame during a drag would
// walk the page sixty times a second.
let paperFormEl = null;
let paperBookEl = null;

function theirOrderForm() {
  if (paperFormEl && paperFormEl.isConnected) return paperFormEl;
  paperFormEl = findTheirItem("Available to Trade", PAPER_FORM_WORDS, PAPER_FORM_HITS);
  return paperFormEl;
}

function theirOrderBook() {
  if (paperBookEl && paperBookEl.isConnected) return paperBookEl;
  paperBookEl = findTheirItem("Spread", PAPER_BOOK_WORDS, PAPER_BOOK_HITS);
  // The book is only useful as an anchor when it is a grid item of its own.
  // A match inside their form's own column would put the panel back on top of
  // the thing it is supposed to leave alone.
  if (paperBookEl && !paperBookEl.classList.contains("react-grid-item")) paperBookEl = null;
  return paperBookEl;
}

/** Is this the wide layout, asked of the page rather than of a width?
 *
 *  Their grid vanishes somewhere between 1000 and 1010, but a hardcoded number
 *  there is a guess that goes stale on their next release. Whether an anchor
 *  was actually found is the question the code cares about, and it answers
 *  itself. */
function paperHasGrid() {
  return !!theirOrderForm();
}

// Their bottom navigation is 49px tall at both 390x844 and 320x700, measured.
// Nothing this project puts on screen needs to be taller than that to be
// mistaken for it, so a candidate taller than this is page content and not a
// navigation bar.
const PAPER_MAX_NAV_H = 96;

/** How much of the bottom edge of the viewport their own page already owns.
 *
 *  At 390 and 320 their page keeps a Markets / Trade / Account bar there, and
 *  anything docked to bottom:0 lands on it and swallows the tap on "Markets".
 *
 *  It is measured rather than hardcoded, and NOT by looking for a fixed
 *  element: the first version of this tested for position fixed or sticky and
 *  always returned 0, because their bar is position STATIC. It is the last row
 *  of a column layout that fills the viewport, so it sits on the bottom edge
 *  without being pinned there. What identifies it is its geometry: ask what is
 *  painted at the bottom centre of the screen, walk up, and take the outermost
 *  ancestor that still ends at the viewport's bottom edge and is short enough
 *  to be a bar rather than a page.
 */
function bottomObstruction() {
  const vh = window.innerHeight;
  let el;
  try { el = document.elementFromPoint(Math.round(window.innerWidth / 2), vh - 3); }
  catch (e) { return 0; }
  let found = 0;
  for (let guard = 0; el && el !== document.body && guard < 14; el = el.parentElement, guard++) {
    if (el.id === PAPER_TAB_ID || el.id === PAPER_PANEL_ID) return 0;  // ours
    const r = el.getBoundingClientRect();
    if (r.bottom >= vh - 2 && r.height > 0 && r.height <= PAPER_MAX_NAV_H) {
      found = Math.round(r.height);           // outermost wins, so keep walking
    }
  }
  return found;
}

/** Where the tab sits: the empty band inside their form, or above whatever
 *  their page keeps on the bottom edge when there is no form to sit in. */
function anchorPaperTab() {
  const tab = paper.tab;
  if (!tab || !tab.isConnected) return;
  const s = tab.style;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const form = theirOrderForm();
  const r = form ? form.getBoundingClientRect() : null;
  tab.classList.toggle("tp-tab-dock", !r);

  if (!r) {
    s.left = "0px"; s.right = "0px"; s.top = "auto"; s.width = "auto";
    s.maxHeight = "none";
    s.bottom = bottomObstruction() + "px";
    return;
  }
  // Inside their form, in the band that holds nothing, with their own 10px
  // side padding. Their width, whatever it is, never a constant: their column
  // is 266 wide at 1440 and 289 at 1024, so a 362 fallback runs off the right
  // edge of the screen by up to 93px. Clamped into the viewport as well, for
  // the case somebody has dragged the column half off it: the tab is the only
  // way back into practice mode, so it never goes where it cannot be clicked.
  const w = Math.max(160, Math.min(Math.round(r.width) - 20, vw - 2 * PAPER_EDGE));
  const h = tab.offsetHeight || PAPER_TAB_BAND_HEIGHT;
  s.right = "auto"; s.bottom = "auto";
  s.left = Math.max(PAPER_EDGE,
    Math.min(Math.round(r.left) + 10, vw - w - PAPER_EDGE)) + "px";
  s.top = Math.max(PAPER_EDGE,
    Math.min(Math.round(r.bottom) - PAPER_TAB_ABOVE_BOTTOM,
             vh - h - PAPER_EDGE)) + "px";
  s.width = w + "px";
  s.maxHeight = PAPER_TAB_BAND_HEIGHT + "px";
}

// ── Getting their order book on screen before covering it ───────────────────
//
// At 1280x813 their book starts at 739 with 74px above the fold, so a panel
// placed over it either hangs off the bottom of the window or grows upward
// over their order form. The upward version shipped for one round and it was
// the worst thing in the build: TWO ORDER FORMS STACKED, both reading Cross,
// Market, Limit, Buy / Long, Sell / Short, Available to Trade, Size, Reduce
// Only, with their Size box 97px above ours. Somebody types into the wrong one
// and it looks like it worked. 1280x813 is the most common laptop viewport
// there is, so this is not an edge to document.
//
// Scrolling on a deliberate click is what a panel is allowed to do. The TAB is
// what has to be reachable without scrolling, and it is. So opening scrolls
// their book into view first, then measures, then covers it, which gets the
// placement the brief asked for at every size rather than at three of four.
// Closing puts the scroll back where it was, unless the person moved it
// themselves in the meantime, in which case it is theirs and stays.

/** The ancestor that actually scrolls `el`, found rather than assumed.
 *
 *  `.main-page-scroller` is their class today and it is the fallback here, but
 *  it is one rename away from being nothing, and the question "what scrolls
 *  this element" is answerable from the element itself. */
function scrollerFor(el) {
  for (let n = el.parentElement, guard = 0; n && guard < 24; n = n.parentElement, guard++) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return document.querySelector(".main-page-scroller")
    || document.scrollingElement || document.documentElement;
}

// Where the scroll was before opening moved it, so closing can put it back.
let paperScrollFrom = null;

function bringBookIntoView() {
  const book = theirOrderBook();
  if (!book) return;
  const r = book.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= window.innerHeight) return;   // already there
  const sc = scrollerFor(book);
  if (!sc) return;
  const before = sc.scrollTop;
  const vh = window.innerHeight;
  // THE LEAST SCROLL THAT DOES THE JOB, not the most.
  // Putting the book's top at the top of the window was the first version and
  // it scrolled 736 of 959 at 1280x813, which ran the page to its end: their
  // chart was gone and 470px of the left half was empty background. Bringing
  // the book's BOTTOM to the bottom edge instead is 599 and leaves the page
  // where it stops being useful rather than past it. At 1280x1024 the
  // difference is larger, 388 against 736, and 348px of their chart survives.
  // Their chart and the whole of their book cannot both be on screen at 813:
  // they span 1241px together. This keeps whatever is left.
  let delta;
  if (r.height > vh - 2 * PAPER_EDGE) {
    // Taller than the window. Align its top and let the panel clamp its own
    // height against the bottom edge; there is no scroll that fits it.
    delta = r.top - PAPER_EDGE;
  } else {
    delta = Math.max(0, r.bottom - (vh - PAPER_EDGE));
    if (r.top - delta < PAPER_EDGE) delta = r.top - PAPER_EDGE;
  }
  sc.scrollTop = before + delta;
  // Instant, not smooth. A panel that animates into place is a panel you have
  // to wait for before you know where it went.
  if (sc.scrollTop !== before) {
    paperScrollFrom = { el: sc, from: before, landed: sc.scrollTop };
  }
}

function restorePaperScroll() {
  const s = paperScrollFrom;
  paperScrollFrom = null;
  if (!s || !s.el || !s.el.isConnected) return;
  // Only if it is still where opening left it. If the person has scrolled since,
  // the position is theirs and yanking it back would be the panel overruling them.
  if (Math.abs(s.el.scrollTop - s.landed) > 4) return;
  s.el.scrollTop = s.from;
}

/** Where the panel sits: over their order book, as much as the window allows.
 *
 *  The arithmetic, in one place, because every number in it was measured and
 *  the reasoning is in the note at the top of this file.
 */
function anchorPaperPanel() {
  const p = paper.panel;
  if (!p || !p.isConnected) return;
  const s = p.style;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const grid = paperHasGrid();
  p.classList.toggle("tp-sheet", !grid);

  if (!grid) {
    // No grid to anchor to. A bottom sheet, lifted clear of whatever fixed
    // navigation their page keeps on the bottom edge, at 72% of the screen so
    // their market header and part of the chart stay visible behind it.
    const lift = bottomObstruction();
    s.left = "0px"; s.right = "0px"; s.bottom = lift + "px";
    s.top = "auto"; s.width = "auto"; s.height = "auto";
    s.maxHeight = Math.round((vh - lift) * 0.72) + "px";
    return;
  }

  const book = theirOrderBook();
  const form = theirOrderForm();
  const target = book || form;
  const r = target ? target.getBoundingClientRect() : null;
  // THEIR width, whatever it is, with no constant to fall back to while a
  // measurement exists. The previous version kept 362 whenever their column
  // measured under 300, and their column is 266 wide at 1440, 289 at 1024 and
  // 296 at 1600, so the panel hung 63 to 93px off the right of the screen with
  // the close button, the balance, the Size value and half the Sell pill
  // outside it. Every dimension below is also clamped to the viewport, so a
  // column dragged half off screen cannot take the panel with it.
  const w = r && r.width > 0
    ? Math.max(160, Math.min(Math.round(r.width), vw - 2 * PAPER_EDGE))
    : Math.min(362, vw - 2 * PAPER_EDGE);
  const left = r
    ? Math.max(PAPER_EDGE, Math.min(Math.round(r.left), vw - w - PAPER_EDGE))
    : Math.max(PAPER_EDGE, vw - w - PAPER_EDGE);

  // How tall the panel wants to be, which is its content, and how tall it may
  // be, which is the window less both margins.
  const maxH = vh - 2 * PAPER_EDGE;
  const want = Math.min(paperContentHeight(), maxH);

  // The book's top, clamped: once the page is scrolled their column leaves the
  // viewport, and a panel that follows it off the top is the bug this rebuild
  // exists to fix.
  const bookTop = r ? Math.max(PAPER_EDGE, Math.round(r.top)) : PAPER_EDGE;
  const roomBelow = vh - bookTop - PAPER_EDGE;

  s.right = "auto"; s.bottom = "auto"; s.left = left + "px"; s.width = w + "px";
  if (want <= roomBelow) {
    // The normal case, and the only one at 1440 and above: the whole panel
    // fits inside the book's own rectangle and covers nothing else.
    //
    // Capped at the book's OWN height, not at the room to the bottom of the
    // window. Without the cap the panel ran to 868 at 1440x900 against a book
    // that ends at 729, so it covered 139px of page below the grid that holds
    // nothing at all. Ending exactly where their item ends is the whole claim
    // this placement makes.
    const bookH = r ? Math.round(r.height) : roomBelow;
    const cap = Math.max(PAPER_MIN_PANEL_H, Math.min(roomBelow, bookH));
    s.top = bookTop + "px";
    s.height = "auto";
    s.maxHeight = cap + "px";
    return;
  }
  // The fallback, reached at 1280 where the book starts at 739 in an 813 tall
  // window. Grow upward from the bottom edge, taking the least height that is
  // still usable, so the part of their form that gets covered is as small as
  // the panel can make it.
  const h = Math.min(Math.max(roomBelow, PAPER_MIN_PANEL_H), want, maxH);
  s.height = h + "px";
  s.maxHeight = h + "px";
  s.top = (vh - PAPER_EDGE - h) + "px";
}

/** The panel's natural height, measured rather than assumed.
 *
 *  offsetHeight is the clamped height once a height has been set, so the scroll
 *  height of the body plus the header is what the content actually wants. */
function paperContentHeight() {
  const ui = paper.ui;
  if (!ui || !ui.body) return PAPER_MIN_PANEL_H;
  const head = ui.body.previousElementSibling;
  return (head ? head.offsetHeight : 40) + ui.body.scrollHeight + 2;
}

let paperAnchorQueued = false;
function scheduleAnchor() {
  if (paperAnchorQueued) return;
  paperAnchorQueued = true;
  requestAnimationFrame(() => {
    paperAnchorQueued = false;
    anchorPaperTab();
    anchorPaperPanel();
  });
}

/** Watch everything that can move their columns: the window, each item's own
 *  box, and the style attribute react-grid-layout writes a drag into. */
function watchPlacement() {
  window.addEventListener("resize", scheduleAnchor, { passive: true });
  window.addEventListener("scroll", scheduleAnchor, { passive: true, capture: true });
  for (const item of [theirOrderForm(), theirOrderBook()]) {
    if (!item) continue;
    try {
      new ResizeObserver(scheduleAnchor).observe(item);
      new MutationObserver(scheduleAnchor).observe(item, {
        attributes: true, attributeFilter: ["style", "class"],
      });
    } catch (e) { /* no observers: the interval below is the backstop */ }
  }
  // Backstop for the case an anchor node is replaced wholesale by one of their
  // re-renders, which no observer on the old node can report.
  setInterval(scheduleAnchor, 2000);
}

// ── Formatting ──────────────────────────────────────────────────────────────

// NOT `esc`. shared.js declares one at top level and every file in a
// content_scripts entry shares one global lexical environment, so a second
// `const esc` throws and takes this whole file with it. Same reason every
// other top-level name here is prefixed.
const pesc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const pmoney = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(Number(n) || 0)
  .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pnum = (n, d = 4) => Number(n).toLocaleString("en-US",
  { minimumFractionDigits: 0, maximumFractionDigits: d });

/** A USDC amount, always two places and always grouped. pnum(n, 2) has a
 *  minimum of zero places, so Order Value came out as "4,232.4" beside a
 *  Margin Required of "4,234.3": one decimal against two, in adjacent rows
 *  that are meant to be compared. */
const pusd = (n) => Number(n).toLocaleString("en-US",
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A price at the precision the venue itself allows for that asset.
 *  A derived number printed to more decimals than the tick supports reads as
 *  more precise than the venue can express: the liquidation price came out as
 *  65,455.797468 on a market whose tick is 0.1. */
function ppx(n, info) {
  if (!info || !isFinite(Number(n))) return "N/A";
  const r = roundPrice(Number(n), info.szDecimals);
  return isFinite(r) ? pnum(r, Math.max(0, 6 - info.szDecimals)) : "N/A";
}

/** The coin is in the path, /trade/BTC, so it is read from the URL and not
 *  from the page. Same rule the address panel follows. */
function paperCoinFromUrl() {
  const m = location.pathname.match(/^\/trade\/([A-Za-z0-9:@_-]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ── Building the DOM, once ──────────────────────────────────────────────────

function tpEl(parent, tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

/** Their label / input / unit control: a 33px outlined box with the label on
 *  the left, the number right-aligned in the middle, and the unit on the
 *  right. Returns the parts, because every one of them gets updated. */
function tpField(parent, label, fname, unit) {
  const box = tpEl(parent, "div", "tp-field");
  const k = tpEl(box, "span", "tp-field-k", label);
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "0";
  input.dataset.f = fname;
  box.appendChild(input);
  const u = tpEl(box, "span", "tp-field-u", unit);
  return { box, k, input, unit: u };
}

/** A label-left value-right row, which their form uses for every derived
 *  figure it shows. */
function tpKv(parent, label) {
  const row = tpEl(parent, "div", "tp-kv");
  tpEl(row, "span", "tp-kv-k", label);
  return tpEl(row, "span", "tp-kv-v", "N/A");
}

/** Their checkbox: a 16px box with a 3px radius. The native input stays in the
 *  DOM under opacity 0 rather than being replaced by a div, so the label
 *  toggles it, the keyboard reaches it, and its checked state is readable. */
function tpCheck(parent, label, fname) {
  const l = tpEl(parent, "label", "tp-check");
  const i = document.createElement("input");
  i.type = "checkbox";
  i.dataset.f = fname;
  l.appendChild(i);
  tpEl(l, "span", "tp-box");
  tpEl(l, "span", "tp-check-t", label);
  return { label: l, input: i };
}

/** A two-column table row whose value cell is returned for later updates. */
function tpRow(tbody, label) {
  const tr = tpEl(tbody, "tr");
  tpEl(tr, "th", null, label);
  return tpEl(tr, "td", null, "N/A");
}

/** The cat, as an <img>, or nothing if there is no extension runtime to ask.
 *
 *  Hyperliquid's mascot, used the way content.js uses it on an address page:
 *  inside a panel about Hyperliquid, on Hyperliquid's own site, saying what the
 *  panel is about. It is not this extension's mark; the toolbar icon, the popup
 *  and the store listing are Tnega's. */
function tpCat(parent, cls) {
  const img = document.createElement("img");
  img.className = cls;
  img.alt = "";
  // A src that 404s leaves Chrome drawing its broken-image glyph, which looks
  // like a bug in the panel. HIDDEN, not removed: removing it made the cat
  // look absent from the code rather than absent from that one environment,
  // and an <img> with a src that failed is a different fact from no <img> at
  // all. Under the injection harness getURL resolves to a URL that 404s, which
  // is the only place this fires.
  img.addEventListener("error", () => img.classList.add("tp-hide"), { once: true });
  try {
    img.src = chrome.runtime.getURL("icons/hypurr-128.png");
    parent.appendChild(img);
    return img;
  } catch (e) { return null; }   // no runtime, no mascot, nothing else changes
}

/** The closed state, and the only thing practice mode puts on the page until
 *  somebody asks for it.
 *
 *  It carries the header sentence in full rather than the cat alone. The rule
 *  that the sentence is present in every state did not change when the default
 *  state did, and a cat in the corner of a trading page does not say that the
 *  money is not there. At their column width the sentence wraps to two lines at
 *  10px, which is 46px tall inside a band measured at 162.
 */
function buildPaperTab() {
  const tab = document.createElement("button");
  tab.type = "button";
  tab.id = PAPER_TAB_ID;
  tab.className = "tnega-paper-tab";
  tab.dataset.act = "open";
  tab.setAttribute("aria-expanded", "false");
  tab.title = PAPER_HEADER_TEXT + ". Click to open.";
  tpCat(tab, "tp-tab-cat");
  // One row, not two. Stacking the affordance under the sentence made the tab
  // 80px tall at 390, which is too much of a phone screen to spend on a thing
  // that is closed. Side by side it is 44 at every width measured, which is
  // inside the 48px safe band.
  const mark = tpEl(tab, "span", "tp-tab-mark");
  tpEl(mark, "span", "tp-tab-line", PAPER_HEADER_TEXT);
  // The tab is the only surface practice mode has while it is closed, so it
  // says whether there is a position sitting in it. Before this it read
  // identically whether you held one or not.
  const held = tpEl(mark, "span", "tp-tab-held tp-hide");
  const open = tpEl(tab, "span", "tp-tab-open", "Open");
  open.setAttribute("aria-hidden", "true");
  return { tab, held };
}

function buildPaperPanel() {
  const root = document.createElement("section");
  root.id = PAPER_PANEL_ID;
  root.className = "tnega-paper";

  const ui = {};

  // ── Header. Never removed, never emptied.
  const head = tpEl(root, "div", "tp-head");
  tpCat(head, "tp-cat");
  ui.mark = tpEl(head, "span", "tp-mark", PAPER_HEADER_TEXT);
  tpEl(head, "span", "tp-spacer");
  ui.balance = tpEl(head, "span", "tp-bal", "");
  // "Hide", not "Close". There were two controls called Close: this one, which
  // closes the PANEL, and the one that closes your POSITION. Somebody holding a
  // position who wants out reads the word Close in the header and presses it.
  // One of the two had to be renamed and it is this one, because closing a
  // position is the word that cannot move.
  ui.closeBtn = tpEl(head, "button", "tp-min", "Hide");
  ui.closeBtn.type = "button";
  ui.closeBtn.dataset.act = "shut";
  ui.closeBtn.title = "Hide practice mode and go back to the tab";

  const body = tpEl(root, "div", "tp-body");
  ui.body = body;

  // ── Their Cross | 20x | Unified strip.
  //
  // NOT three chips. The first version copied their three filled buttons
  // exactly, and two of the three did nothing: dead divs with cursor:auto and
  // no handler, pixel-identical to their working controls. Worse, the only
  // editable thing in the row, the leverage box, was hidden inside the middle
  // one and looked exactly like the two that did nothing. A reviewer said they
  // would not have found it without dumping the DOM.
  //
  // So the two that are statements are drawn as statements, in the muted
  // colour with no fill, and the one that is a field is drawn with the same
  // outline their Size box has. The row keeps its place and its height; it
  // stops claiming to be three buttons.
  const chips = tpEl(body, "div", "tp-chips");
  tpEl(chips, "div", "tp-chip-static", "Cross");
  const levChip = tpEl(chips, "div", "tp-chip-field");
  tpEl(levChip, "span", "tp-field-k", "Leverage");
  ui.leverage = document.createElement("input");
  ui.leverage.type = "text";
  ui.leverage.inputMode = "numeric";
  ui.leverage.autocomplete = "off";
  ui.leverage.dataset.f = "leverage";
  ui.leverage.value = "1";
  ui.leverage.setAttribute("aria-label", "Leverage");
  levChip.appendChild(ui.leverage);
  tpEl(levChip, "span", "tp-field-u", "x");
  tpEl(chips, "div", "tp-chip-static", "Practice");

  // Said out loud when the number typed is not the number that will be used.
  // Substituting silently was the previous behaviour: 500 on a market whose
  // maximum is 40 left the field reading 500, showed 40x arithmetic in the
  // stats, and opened a 40x position without a word.
  ui.leverageNote = tpEl(body, "div", "tp-lev-note tp-hide");

  // ── Their Market | Limit | Pro tabs, underline style.
  // Pro is not offered: it is a different order-entry surface, and an empty
  // tab that says "not here" is worse than not drawing it.
  const tabs = tpEl(body, "div", "tp-tabs");
  ui.tabMarket = tpEl(tabs, "div", "tp-tab", "Market");
  ui.tabMarket.dataset.act = "type"; ui.tabMarket.dataset.v = "market";
  ui.tabLimit = tpEl(tabs, "div", "tp-tab", "Limit");
  ui.tabLimit.dataset.act = "type"; ui.tabLimit.dataset.v = "limit";

  // ── Their filled Buy / Sell pill.
  const sides = tpEl(body, "div", "tp-sides");
  ui.sideBuy = tpEl(sides, "div", "tp-side tp-buy", "Buy / Long");
  ui.sideBuy.dataset.act = "side"; ui.sideBuy.dataset.v = "buy";
  ui.sideSell = tpEl(sides, "div", "tp-side tp-sell", "Sell / Short");
  ui.sideSell.dataset.act = "side"; ui.sideSell.dataset.v = "sell";

  ui.available = tpKv(body, "Available to Trade");
  ui.currentPos = tpKv(body, "Current Position");

  // Price sits above Size on their form when Limit is selected.
  ui.price = tpField(body, "Price", "px", "USD");
  ui.size = tpField(body, "Size", "size", "");

  // ── Their percentage slider.
  const pct = tpEl(body, "div", "tp-pct");
  const track = tpEl(pct, "div", "tp-track");
  const bar = tpEl(track, "div", "tp-bar");
  ui.dots = [0, 25, 50, 75, 100].map((p) => {
    const d = tpEl(bar, "span", "tp-dot");
    // Their own dots sit at 1px and 264px inside a 272px bar, so the 6px dot is
    // inset 1px at the left end and 2px at the right. That is 9px of the track
    // the dot centres cannot use, hence (100% - 9px). The previous form,
    // calc(p% - p*0.06px), gave 0 and 266 and so did not reproduce the
    // measurement it cited.
    d.style.left = `calc(1px + (100% - 9px) * ${p / 100})`;
    return { at: p, node: d };
  });
  ui.range = document.createElement("input");
  ui.range.type = "range";
  ui.range.className = "tp-range";
  ui.range.min = "0"; ui.range.max = "100"; ui.range.step = "1"; ui.range.value = "0";
  ui.range.dataset.f = "pct";
  ui.range.setAttribute("aria-label", "Percentage of the practice balance");
  track.appendChild(ui.range);
  const pbox = tpEl(pct, "div", "tp-pctbox");
  ui.pctNum = document.createElement("input");
  ui.pctNum.type = "text";
  ui.pctNum.inputMode = "numeric";
  ui.pctNum.autocomplete = "off";
  ui.pctNum.dataset.f = "pctnum";
  ui.pctNum.placeholder = "0";
  pbox.appendChild(ui.pctNum);
  tpEl(pbox, "span", "tp-pct-u", "%");

  // ── Their two checkboxes. Take Profit / Stop Loss is not modelled, so in its
  // place is the one this extension exists for: post-only, which is the order
  // type whose rejection rate the rest of the extension measures.
  ui.reduceOnly = tpCheck(body, "Reduce Only", "reduceOnly");
  ui.postOnly = tpCheck(body, "Post Only", "postOnly");

  // ── Where their Connect button is.
  ui.submit = tpEl(body, "button", "tp-submit", "Place practice buy");
  ui.submit.type = "button";
  ui.submit.dataset.act = "submit";

  // WHAT HAPPENED, AND IT GOES HERE BECAUSE HERE IS WHERE THE BUTTON IS.
  //
  // This is the same defect as the size field, in a new place. A market buy of
  // 0.0123 BTC changed four things on screen: two balances, Current Position,
  // and Order Value going to N/A. The sentence "Filled 0.0123 BTC at 84,632,
  // fee $0.47" was rendered at y=876 inside a panel whose box ended at 673, so
  // it was in the DOM and not on the screen, for fills, closes and all nine
  // refusals. A successful order was the thing that did nothing visible.
  //
  // The event list further down stays, as the history. This is the answer to
  // "I just pressed that", and it is immediately under the thing that was
  // pressed. data-ev marks it as the outcome for anything reading the panel.
  ui.outcome = tpEl(body, "div", "tp-outcome tp-hide");
  ui.outcome.dataset.ev = "1";
  ui.outcomeH = tpEl(ui.outcome, "span", "tp-ev-h");
  ui.outcomeD = tpEl(ui.outcome, "span", "tp-ev-d");

  // What the venue would refuse, said before the click instead of after it.
  ui.refusal = tpEl(body, "div", "tp-refusal tp-hide");

  // What was ASSUMED to let this order through, which is the other direction
  // and the one that used to be silent. decideOrder carries the sentence on
  // the decision when an inferred rule is what makes the difference, so the
  // moment it speaks is the moment it changes the outcome.
  ui.assumption = tpEl(body, "div", "tp-assume tp-hide");

  // THE OPEN POSITION AND THE WAY OUT OF IT, ALSO NEXT TO THE BUTTON.
  // Measured with a position open: the position table and "Close at the mark"
  // were both below the fold, so somebody who opened a position could not
  // close it without discovering a scroll they had no reason to expect. The
  // full table stays further down; the line that matters and the control that
  // acts on it are here.
  ui.posBrief = tpEl(body, "div", "tp-brief tp-hide");
  ui.briefText = tpEl(ui.posBrief, "span", "tp-brief-t");
  ui.briefClose = tpEl(ui.posBrief, "button", "tp-x tp-brief-x", "Close position");
  ui.briefClose.type = "button";
  ui.briefClose.dataset.act = "close";

  // ── The two sentences that do not get to hide behind a disclosure.
  //
  // Everything this simulation will not model used to live inside a collapsed
  // <details> and nowhere else, which is the same as not saying it: an audit
  // asked whether what is not modelled is visible without opening something
  // nobody opens, and the answer was no. The long lists can stay collapsed,
  // because they are reference. These two are load-bearing and are on the
  // surface, under the button, where the number that looks like a profit is.
  const always = tpEl(body, "div", "tp-always");
  tpEl(always, "div", "tp-always-l",
    "The money is not there. The prices, fees and funding are Hyperliquid's own; "
    + "the balance is not.");
  tpEl(always, "div", "tp-always-l",
    "A closed position shows what it would have earned. Nobody earned it, and it "
    + "is not a track record.");
  // Only when it is true. Somebody with site data blocked would otherwise trade
  // a whole session, watch a balance move, and lose all of it on reload with
  // nothing having said a word.
  ui.storage = tpEl(always, "div", "tp-always-l tp-stale tp-hide");

  // ── Their derived figures, in their order, plus one of ours.
  const stats = tpEl(body, "div", "tp-stats");
  ui.liq = tpKv(stats, "Liquidation Price");
  ui.orderValue = tpKv(stats, "Order Value");
  ui.marginReq = tpKv(stats, "Margin Required");
  ui.slippage = tpKv(stats, "Slippage");
  ui.feeLine = tpKv(stats, "Fees");
  // Not on their form, and here because everything above it is priced off a
  // read that can silently stop happening. A figure without its age is the
  // thing this project does not ship.
  ui.dataLine = tpKv(stats, "Market data");

  // ── The practice account. Ours, not a copy of anything of theirs.
  const acct = tpEl(body, "div", "tp-acct");

  ui.posSec = tpEl(acct, "div", "tp-sec");
  ui.posTitle = tpEl(ui.posSec, "div", "tp-sub", "Practice position");
  ui.posEmpty = tpEl(ui.posSec, "div", "tp-empty", "No open position.");
  const ptab = tpEl(ui.posSec, "table", "tp-table");
  const ptb = tpEl(ptab, "tbody");
  ui.posTable = ptab;
  ui.posSide = tpRow(ptb, "Side");
  ui.posSize = tpRow(ptb, "Size");
  ui.posEntry = tpRow(ptb, "Entry");
  ui.posMark = tpRow(ptb, "Mark");
  ui.posWorth = tpRow(ptb, "Profit if closed now");
  ui.posLiq = tpRow(ptb, "Liquidation");
  ui.posFunding = tpRow(ptb, "Funding paid");
  // No second Close button down here. There is exactly one, in the brief
  // above, next to the button that opened the position.

  ui.restSec = tpEl(acct, "div", "tp-sec tp-hide");
  tpEl(ui.restSec, "div", "tp-sub", "Resting orders");
  ui.restList = tpEl(ui.restSec, "ul", "tp-rest");
  tpEl(ui.restSec, "p", "tp-note",
    "A resting order is not filled when the mark touches it. It fills only once "
    + "the mark has gone clear through the level, and that is an assumption this "
    + "panel is making, not something the public data settles. Queue position is "
    + "not public.");

  ui.evSec = tpEl(acct, "div", "tp-sec tp-hide");
  tpEl(ui.evSec, "div", "tp-sub", "What happened");
  ui.evList = tpEl(ui.evSec, "ul", "tp-events");

  ui.closedSec = tpEl(acct, "div", "tp-sec tp-hide");
  tpEl(ui.closedSec, "div", "tp-sub", "Closed, and what each would have earned");
  ui.closedList = tpEl(ui.closedSec, "ul", "tp-rest");

  buildDisclosure(acct);

  return { root, ui };
}

/** Static, so it is written once with innerHTML and then left alone. Nothing
 *  in here updates and nothing in here takes focus. */
function buildDisclosure(parent) {
  const d = tpEl(parent, "details", "tp-disc");
  d.innerHTML = `
    <summary>What this does not model, and what it refuses to guess</summary>
    <p class="tp-note">Everything priced here is Hyperliquid's own: the mark, the book,
    the fee schedule, the funding rates, the tick and lot sizes, the margin tiers. The
    money is the only thing that is not.</p>
    <p class="tp-sub2">Refusals it does simulate</p>
    <ul class="tp-list">${REFUSALS_SIMULATED.map((s) => `<li>${pesc(s)}</li>`).join("")}</ul>
    <p class="tp-sub2">Not modelled</p>
    <ul class="tp-list">${NOT_MODELLED.map((s) => `<li>${pesc(s)}</li>`).join("")}</ul>
    <p class="tp-note">${pesc(REFUSALS_NOT_SIMULATED)}</p>
    <p class="tp-note">A closed position above shows what it would have earned. Nobody
    earned it. This is not a track record, and the difference between it and trading is
    the list you just read.</p>
    <p class="tp-note">Positions and history are kept in this browser's local storage.
    They do not sync to any device or account, nothing is sent anywhere, and clearing
    site data erases them.</p>
    <p class="tp-note"><button type="button" class="tp-x" data-act="reset">Reset practice
    account</button></p>`;
  return d;
}

// ── Writing into DOM that already exists ────────────────────────────────────
//
// The three primitives the whole update path is built from. Everything goes
// through them so the focus rule is stated once and cannot be forgotten at a
// call site: NOTHING writes into a field that has focus.

function setText(node, value) {
  const v = value == null ? "" : String(value);
  if (node && node.textContent !== v) node.textContent = v;
}

function setVal(input, value) {
  if (!input) return;
  if (document.activeElement === input) return;   // the person is typing here
  const v = value == null ? "" : String(value);
  if (input.value !== v) input.value = v;
}

function setShown(node, shown) {
  if (node) node.classList.toggle("tp-hide", !shown);
}

/** Rebuild a list only when its contents actually changed.
 *
 *  Lists hold no inputs, so replacing their markup is safe, but doing it every
 *  4 seconds still restarts CSS transitions, drops a half-made text selection
 *  and destroys a button under a pressed mouse. Comparing a signature first
 *  means a list that did not change is not touched at all.
 */
function syncList(container, signature, html) {
  if (!container) return;
  if (container.dataset.sig === signature) return;
  container.dataset.sig = signature;
  container.innerHTML = html;
}

// ── The controller ──────────────────────────────────────────────────────────

// How old a read may be before the panel stops calling it the market.
// A tick is 4s, so this is five missed ticks: long enough that a single slow
// response is not called stale, short enough that a dead connection is.
const PAPER_STALE_MS = 20000;
// And how old before it stops pricing against it at all. Past this the numbers
// are history, and a fill priced off history reported as a measurement is the
// failure this project exists to avoid.
const PAPER_REFUSE_MS = 60000;

const paper = {
  panel: null,
  tab: null,
  tabHeld: null,
  ui: null,
  state: null,
  info: null,
  book: { levels: [[], []] },
  // The base fee schedule, used only until feeSchedule() answers. `feesRead`
  // is what stops the panel from printing a constant in the shape of a
  // measurement: these two numbers are correct today and are still not a
  // reading, and the Fees row says which it is showing.
  fees: { taker: 0.00045, maker: 0.00015, tiers: [] },
  feesRead: false,
  // When the venue last answered, and what it said when it did not. Without
  // these, Mark, "Would be worth" and Liquidation render from the last good
  // read for as long as the tab stays open, with nothing on screen to say so.
  infoAt: 0,
  bookAt: 0,
  lastError: null,
  open: false,
  // The last thing that happened, rendered next to the button that caused it.
  // Cleared when a field is edited, because at that point the person is
  // describing a new order rather than reading about the last one.
  outcome: null,
  // True for the duration of a submit. Three clicks in 50ms produced two fills
  // and a nonsense refusal: a 0.01 order left the balance at -$1,694.30 and the
  // position at 0.04. The button reported disabled:false in every state.
  submitting: false,
  coin: null,
  timer: null,
  draft: {
    side: "buy", type: "market", size: "", px: "", leverage: "1",
    postOnly: false, reduceOnly: false,
  },
};

/** Age of the oldest read the panel is currently drawing from, in ms, or null
 *  if it has never had one. */
function paperDataAge() {
  if (!paper.infoAt) return null;
  return Date.now() - Math.min(paper.infoAt, paper.bookAt || paper.infoAt);
}

/** Whether there is market data recent enough to price against, and the
 *  sentence to show when there is not. Returned together so the guard and the
 *  message cannot come apart. */
function paperDataProblem() {
  // The book is only fetched while the panel is open, so for the first moment
  // after opening there is none at all. decideOrder answers that with "the
  // order book is empty on that side right now", which is a claim about the
  // venue and it is not true: the book was never asked for. Saying which it is
  // costs one branch.
  if (!paper.bookAt) {
    return "Reading the order book. Nothing is priced until it answers, and an "
      + "order book that has not been read is not an order book that is empty.";
  }
  if (!paper.info) {
    return paper.lastError
      ? `The venue did not answer, so this cannot be priced. ${paper.lastError}`
      : "Still reading this market from Hyperliquid's public data. Nothing can be "
        + "priced until it answers.";
  }
  const age = paperDataAge();
  if (age != null && age > PAPER_REFUSE_MS) {
    return `The last answer from the venue was ${Math.round(age / 1000)} seconds ago. `
      + "That is old enough that pricing against it would be reporting history as a "
      + "measurement, so it is not done."
      + (paper.lastError ? ` ${paper.lastError}` : "");
  }
  return null;
}

function paperLeverage() {
  const max = paper.info ? paper.info.maxLeverage : 50;
  const n = parseInt(paper.draft.leverage, 10);
  return Math.max(1, Math.min(isFinite(n) ? n : 1, max));
}

/** The sentence to show when the leverage that will be used is not the number
 *  in the field, or null when they agree.
 *
 *  The field itself is NOT rewritten while it has focus: that is the rule the
 *  whole render path is built on, and clamping mid-keystroke would make 50
 *  unreachable on a market whose maximum is 40 by rewriting after the 5. It is
 *  snapped on blur instead, and said out loud in the meantime. */
function paperLeverageNote() {
  const raw = String(paper.draft.leverage || "").trim();
  const used = paperLeverage();
  if (raw === "") return `No leverage given, so this will be placed at ${used}x.`;
  const n = parseInt(raw, 10);
  if (!isFinite(n)) {
    return `"${raw}" is not a number of times, so this will be placed at ${used}x.`;
  }
  const max = paper.info ? paper.info.maxLeverage : null;
  if (max != null && n > max) {
    return `${paper.coin || "This market"} allows at most ${max}x, so ${n}x will be `
      + `placed as ${max}x. Every figure below is ${max}x arithmetic.`;
  }
  if (n < 1) return `Leverage cannot be under 1x, so ${n} will be placed as 1x.`;
  return null;
}

/** The price the order would be measured against: the touch for a market
 *  order, the limit price for a limit order. */
function paperRefPx() {
  const bids = (paper.book.levels && paper.book.levels[0]) || [];
  const asks = (paper.book.levels && paper.book.levels[1]) || [];
  if (paper.draft.type === "limit") {
    const p = parseFloat(paper.draft.px);
    if (isFinite(p) && p > 0) return p;
  }
  const touch = paper.draft.side === "buy"
    ? (asks.length ? Number(asks[0].px) : null)
    : (bids.length ? Number(bids[0].px) : null);
  if (touch) return touch;
  return paper.info && isFinite(paper.info.markPx) ? paper.info.markPx : null;
}

/** What the order would do, asked of the simulation rather than guessed at
 *  here. decideOrder writes nothing, so calling it as a preview on every
 *  keystroke is free and cannot drift from what submit will do: it is the same
 *  function with the same arguments. */
function paperPreview() {
  if (!paper.info || !paper.state) return null;
  const size = parseFloat(paper.draft.size);
  if (!isFinite(size) || size <= 0) return null;
  try {
    return decideOrder(paper.state, paper.info, paper.book, paper.fees, {
      coin: paper.coin,
      side: paper.draft.side,
      type: paper.draft.type,
      px: parseFloat(paper.draft.px),
      size,
      postOnly: paper.draft.type === "limit" && paper.draft.postOnly,
      reduceOnly: paper.draft.reduceOnly,
      leverage: paperLeverage(),
    });
  } catch (e) { return null; }
}

/** Size implied by a percentage of the practice balance, at the current
 *  leverage and price, rounded to the asset's lot size. */
function sizeFromPct(pct) {
  const px = paperRefPx();
  if (!paper.state || !paper.info || !px) return null;
  const notional = (paper.state.balance * paperLeverage() * pct) / 100;
  const raw = notional / px;
  const sz = roundSize(raw, paper.info.szDecimals);
  return sz > 0 ? sz.toFixed(paper.info.szDecimals) : "";
}

function pctFromSize() {
  const px = paperRefPx();
  const size = parseFloat(paper.draft.size);
  if (!paper.state || !px || !isFinite(size) || size <= 0) return 0;
  const cap = paper.state.balance * paperLeverage();
  if (!(cap > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((size * px * 100) / cap)));
}

// ── The update pass ─────────────────────────────────────────────────────────

function refresh() {
  const ui = paper.ui;
  if (!ui) return;

  // Which of the two states the page is in. The panel and the tab are never
  // both on screen: the tab is what the panel collapses to.
  setShown(paper.panel, paper.open);
  setShown(paper.tab, !paper.open);
  if (paper.tab) paper.tab.setAttribute("aria-expanded", String(paper.open));

  setText(ui.mark, PAPER_HEADER_TEXT);
  setText(ui.balance, paper.state ? pmoney(paper.state.balance) : "");

  // The tab's own line about what is being held. Rendered whether the panel is
  // open or shut, because the tab is what is on screen when it is shut.
  if (paper.tabHeld) {
    const open = paper.state ? Object.keys(paper.state.positions || {}) : [];
    const held = open.length
      ? `${open.length === 1 ? "1 open position" : open.length + " open positions"}`
        + ` · ${pmoney(paper.state.balance)}`
      : "";
    setText(paper.tabHeld, held);
    setShown(paper.tabHeld, !!held);
  }
  if (!paper.open) return;                      // nothing below is on screen

  // Whether the practice account is actually persisting. Asked of the engine,
  // which is where the failure happens, rather than inferred here.
  let store = { ok: true, reason: null };
  try { store = storageStatus(); } catch (e) { /* older engine: assume it saves */ }
  setShown(ui.storage, !store.ok);
  if (!store.ok) {
    setText(ui.storage,
      "This browser is not storing the practice account, so everything below is "
      + "lost on reload. " + (store.reason || "No reason was given."));
  }

  const info = paper.info;
  const state = paper.state;
  const d = paper.draft;
  const isLimit = d.type === "limit";
  const coin = paper.coin || "";

  // Which tab, which side.
  ui.tabMarket.classList.toggle("on", !isLimit);
  ui.tabLimit.classList.toggle("on", isLimit);
  ui.sideBuy.classList.toggle("on", d.side === "buy");
  ui.sideSell.classList.toggle("on", d.side === "sell");
  setShown(ui.price.box, isLimit);
  setShown(ui.postOnly.label, isLimit);

  setText(ui.size.unit, coin);
  setVal(ui.leverage, d.leverage);
  const levNote = paperLeverageNote();
  setText(ui.leverageNote, levNote || "");
  setShown(ui.leverageNote, !!levNote);
  ui.reduceOnly.input.checked = d.reduceOnly;
  ui.postOnly.input.checked = d.postOnly;

  // Their two account rows.
  setText(ui.available, state ? `${pusd(state.balance)} USDC` : "N/A");
  const pos = (state && info) ? state.positions[info.coin] : null;
  setText(ui.currentPos, info
    ? `${pos ? (pos.side === "short" ? "-" : "") + pnum(pos.size, info.szDecimals) : (0).toFixed(Math.min(5, info.szDecimals))} ${coin}`
    : "N/A");

  // The slider follows the size field, never the other way round inside this
  // function: size is the person's own text and refresh() does not rewrite it.
  const pct = pctFromSize();
  setVal(ui.range, String(pct));
  setVal(ui.pctNum, pct ? String(pct) : "");
  for (const dot of ui.dots) dot.node.classList.toggle("on", pct >= dot.at);

  // Submit label, colour, and whether it is accepting a press at all.
  setText(ui.submit, paper.submitting
    ? "Placing it"
    : `Place practice ${d.type} ${d.side}`);
  ui.submit.disabled = paper.submitting;
  ui.submit.classList.toggle("tp-is-sell", d.side === "sell");

  // What happened, next to what caused it.
  const oc = paper.outcome;
  setShown(ui.outcome, !!oc);
  if (oc) {
    setText(ui.outcomeH, oc.message);
    setText(ui.outcomeD, oc.detail || "");
    setShown(ui.outcomeD, !!oc.detail);
    ui.outcome.classList.toggle("tp-ev-no", !oc.ok);
    ui.outcome.classList.toggle("tp-ev-ok", !!oc.ok);
  }

  // How old the numbers above are. Without this row, Mark, "Would be worth"
  // and Liquidation render from the last good read for as long as the tab
  // stays open and nothing on screen says the venue stopped answering.
  const age = paperDataAge();
  const stale = age != null && age > PAPER_STALE_MS;
  setText(ui.dataLine, age == null
    ? "not read yet"
    : (age < 6000 ? "live" : `${Math.round(age / 1000)}s old`));
  ui.dataLine.classList.toggle("tp-stale", stale || age == null);

  // The fee schedule, and whether it was read or is the base constant. These
  // two numbers are correct today and are still not a reading, and a constant
  // printed in the shape of a measurement is the thing this project does not
  // ship. If userFees never answered the row says so instead of the number.
  setText(ui.feeLine, paper.feesRead
    ? `${(paper.fees.taker * 100).toFixed(4)}% / ${(paper.fees.maker * 100).toFixed(4)}%`
    : "not read");
  ui.feeLine.classList.toggle("tp-stale", !paper.feesRead);
  ui.feeLine.title = paper.feesRead
    ? "Taker / maker, read from Hyperliquid's own fee schedule at the base tier."
    : "Hyperliquid's fee schedule did not answer, so no rate is shown. The "
      + "simulation is using the base tier constants until it does.";

  // The derived figures, taken from the simulation's own preview.
  // No market data means nothing below can be priced, and saying so where a
  // refusal goes is the whole answer. Silence was the previous behaviour and
  // it left an inert button with no explanation attached to it.
  const problem = paperDataProblem();
  const pv = problem ? null : paperPreview();
  let liq = "N/A", ov = "N/A", mr = "N/A", slip = "N/A";
  setShown(ui.refusal, false);
  // An inference that lets an order through says so here, before the click.
  setText(ui.assumption, (pv && pv.ok && pv.assumption) || "");
  setShown(ui.assumption, !!(pv && pv.ok && pv.assumption));
  if (problem) {
    setText(ui.refusal, problem);
    setShown(ui.refusal, true);
  } else if (pv && pv.ok && pv.kind === "fill") {
    const f = pv.fill;
    const value = f.size * f.avgPx;
    const margin = value / (f.leverage || 1);
    ov = `${pusd(value)} USDC`;
    // Margin, not margin plus the fee. Adding the fee here made Margin Required
    // larger than Order Value at 1x, where they should be equal, in two rows
    // printed one above the other for comparison. The fee has its own row.
    mr = `${pusd(margin)} USDC`;
    // slippageVsTouch is a price difference; against the fill price it reads
    // as the percentage their own form shows.
    slip = `Est: ${(Math.abs(f.slippageVsTouch) / f.avgPx * 100).toFixed(3)}%`;
    const hypothetical = {
      side: f.side === "buy" ? "long" : "short",
      size: f.size, entryPx: f.avgPx, margin,
    };
    const lp = liquidationPrice(hypothetical, info);
    liq = lp ? ppx(lp, info) : "N/A";
  } else if (pv && pv.ok && pv.kind === "rest") {
    const o = pv.order;
    ov = `${pusd(o.size * o.px)} USDC`;
    mr = `${pusd((o.size * o.px) / (o.leverage || 1))} USDC`;
    slip = "None, it rests";
  } else if (pv && !pv.ok) {
    setText(ui.refusal, pv.message + (pv.detail ? " " + pv.detail : ""));
    setShown(ui.refusal, true);
  }
  setText(ui.liq, liq);
  setText(ui.orderValue, ov);
  setText(ui.marginReq, mr);
  setText(ui.slippage, slip);

  refreshPosition(pos, info);
  refreshResting(state, info);
  refreshEvents(state);
  refreshClosed(state, info);
  scheduleAnchor();
}

function refreshPosition(pos, info) {
  const ui = paper.ui;
  setText(ui.posTitle, `Practice position${paper.coin ? " in " + paper.coin : ""}`);
  const has = !!(pos && info);

  // The brief, which is the copy of this that is on screen without scrolling.
  setShown(ui.posBrief, has);
  if (has) {
    const up = unrealised(pos, info.markPx);
    const sign = up > 0 ? "+" : "";
    setText(ui.briefText,
      `${pos.side} ${pnum(pos.size, info.szDecimals)} ${info.coin} at `
      + `${ppx(pos.entryPx, info)}, ${sign}${pmoney(up)} if closed now`);
    ui.briefText.className = "tp-brief-t " + (up >= 0 ? "tp-up" : "tp-down");
  }

  setShown(ui.posEmpty, !has);
  setShown(ui.posTable, has);
  if (!has) {
    setText(ui.posEmpty, `No open ${paper.coin || ""} position.`);
    // Blanked rather than left hidden with the last position's numbers in it.
    // A hidden table holding stale figures is one dropped stylesheet away from
    // telling somebody they still hold something they closed.
    for (const cell of [ui.posSide, ui.posSize, ui.posEntry, ui.posMark,
                        ui.posWorth, ui.posLiq, ui.posFunding]) setText(cell, "N/A");
    return;
  }
  const up = unrealised(pos, info.markPx);
  // A position that was added to carries the effective leverage read back from
  // the margin actually put up, so it can be 3.7419...x. Printed raw it looks
  // like a bug rather than like arithmetic.
  setText(ui.posSide, `${pos.side} ${pnum(pos.leverage, 2)}x`);
  ui.posSide.className = pos.side === "long" ? "tp-up" : "tp-down";
  setText(ui.posSize, `${pnum(pos.size, info.szDecimals)} ${info.coin}`);
  setText(ui.posEntry, ppx(pos.entryPx, info));
  setText(ui.posMark, ppx(info.markPx, info));
  // Signed. "Would be worth $0.00" read as the position being worthless the
  // instant it was opened, when what it means is that it has not moved yet.
  setText(ui.posWorth, (up > 0 ? "+" : "") + pmoney(up));
  ui.posWorth.className = up >= 0 ? "tp-up" : "tp-down";
  const lp = liquidationPrice(pos, info);
  setText(ui.posLiq, lp ? ppx(lp, info) : "N/A");
  setText(ui.posFunding, pmoney(-(pos.fundingPaid || 0)));
}

function refreshResting(state, info) {
  const ui = paper.ui;
  // EVERY resting order, not only this market's. Orders on other markets sit
  // in state and are neither shown nor evaluated until you navigate back to
  // that market, so an order placed on SOL is invisible from BTC and the only
  // way to find out it is still there is to go looking for it. The ones that
  // belong to another market are labelled with their coin and cannot be
  // priced here, which is said rather than implied.
  const rows = state ? state.resting.slice() : [];
  setShown(ui.restSec, rows.length > 0);
  if (!rows.length) return;
  const here = info ? info.coin : null;
  const sig = rows.map((o) => `${o.id}:${o.px}:${o.size}`).join("|");
  syncList(ui.restList, sig, rows.map((o) => {
    const own = o.coin === here;
    const px = own ? ppx(o.px, info) : String(o.px);
    return `
    <li>
      <span class="tp-rest-t ${o.side === "buy" ? "tp-up" : "tp-down"}">
        ${pesc(o.side)}${o.postOnly ? " post-only" : ""} ${pesc(pnum(o.size, 6))}
        ${own ? "" : pesc(o.coin) + " "}at ${pesc(px)}
        ${own ? "" : '<span class="tp-rest-away">watched only on its own market</span>'}
      </span>
      <button type="button" class="tp-x" data-act="cancel" data-id="${pesc(o.id)}">Cancel</button>
    </li>`;
  }).join(""));
}

function refreshEvents(state) {
  const ui = paper.ui;
  const rows = state ? state.events.slice(0, 6) : [];
  setShown(ui.evSec, rows.length > 0);
  if (!rows.length) return;
  const sig = rows.map((e) => `${e.at}:${e.message}`).join("|");
  syncList(ui.evList, sig, rows.map((e) => `
    <li class="${e.ok ? "tp-ev-ok" : "tp-ev-no"}" data-ev="1">
      <span class="tp-ev-h">${pesc(e.message)}</span>
      ${e.detail ? `<span class="tp-ev-d">${pesc(e.detail)}</span>` : ""}
    </li>`).join(""));
}

function refreshClosed(state, info) {
  const ui = paper.ui;
  const rows = state ? state.closed.slice(0, 8) : [];
  setShown(ui.closedSec, rows.length > 0);
  if (!rows.length) return;
  const sig = rows.map((c) => `${c.closedAt}:${c.coin}:${c.pnl}`).join("|");
  // Prices through ppx, which rounds to the tick the asset can express. These
  // two were pnum(.., 6), which is the thing ppx's own comment says not to do:
  // an exit printed as 84,539.123456 on a market whose tick is 1 reads as more
  // precise than the venue can quote. Only this market's szDecimals are known
  // here, so a closed row from another market keeps six places and says why.
  syncList(ui.closedList, sig, rows.map((c) => {
    const own = info && c.coin === info.coin;
    const px = (v) => (own ? ppx(v, info) : pnum(v, 6));
    return `
    <li>
      <span class="tp-rest-t">
        <span class="${c.side === "long" ? "tp-up" : "tp-down"}">${pesc(c.side)}</span>
        ${pesc(pnum(c.size, 6))} ${pesc(c.coin)}
        at ${pesc(px(c.entryPx))} out ${pesc(px(c.exitPx))}
      </span>
      <span class="${c.pnl >= 0 ? "tp-up" : "tp-down"}">${pesc(pmoney(c.pnl))}</span>
    </li>`;
  }).join(""));
}

// ── Reading the draft back out of the fields ────────────────────────────────

/** One field changed. Take that one value, leave the rest of the draft alone,
 *  and redraw everything derived from it. */
function onFieldInput(el) {
  const f = el.dataset.f;
  // Editing anything means the person is describing the next order, not still
  // reading about the last one. The history list keeps it either way.
  paper.outcome = null;
  if (f === "size") {
    paper.draft.size = el.value;
  } else if (f === "px") {
    paper.draft.px = el.value;
  } else if (f === "leverage") {
    paper.draft.leverage = el.value;
  } else if (f === "reduceOnly") {
    paper.draft.reduceOnly = el.checked;
  } else if (f === "postOnly") {
    paper.draft.postOnly = el.checked;
  } else if (f === "pct" || f === "pctnum") {
    // The slider and the percentage box are two views of one number, and both
    // of them write the size field. The size field is not focused while
    // someone is dragging a slider, so this is the one place that writes it.
    const raw = parseFloat(el.value);
    const pct = Math.max(0, Math.min(100, isFinite(raw) ? raw : 0));
    const sz = sizeFromPct(pct);
    if (sz != null) {
      paper.draft.size = sz;
      setVal(paper.ui.size.input, sz);
    }
    if (f === "pct") setVal(paper.ui.pctNum, pct ? String(Math.round(pct)) : "");
    if (f === "pctnum") setVal(paper.ui.range, String(Math.round(pct)));
  }
  refresh();
}

/** Record what happened: into the history list, and into the banner beside the
 *  button, which is the copy a person actually sees. */
function pushEvent(ev) {
  paper.outcome = ev;
  if (!paper.state) return;
  paper.state.events.unshift(ev);
  paper.state.events = paper.state.events.slice(0, 25);
}

/** Why a size cannot be used, in its own words, or null if it can.
 *
 *  Everything that was not a positive number got "Enter a size first", which is
 *  wrong for `abc` (they did enter something) and wrong for `-1` (which never
 *  mentioned that sizes are not negative). The lot-size refusal next door is
 *  exactly right, so these were underwritten rather than deliberately terse. */
function sizeComplaint(raw) {
  const t = String(raw == null ? "" : raw).trim();
  if (t === "") return { message: "Enter a size first.", detail: null };
  const n = Number(t);
  if (!isFinite(n)) {
    return { message: `"${t}" is not a number.`,
      detail: `Sizes here are in ${paper.coin || "the asset"}, like 0.01. `
              + "Use the percentage slider if it is easier." };
  }
  if (n < 0) {
    return { message: "A size cannot be negative.",
      detail: "To go the other way, choose Sell / Short above. The size stays "
              + "positive either way." };
  }
  if (n === 0) return { message: "A size of 0 places nothing.", detail: null };
  return null;
}

async function submitPaperOrder() {
  // ONE AT A TIME. Without this, three clicks inside 50ms ran three submits
  // concurrently: each awaited the order book, each then saw the same pre-order
  // state, and two of them filled. A 0.01 order came out as a 0.04 position and
  // a balance of -$1,694.30.
  if (paper.submitting) return;
  paper.submitting = true;
  refresh();
  try {
    await submitPaperOrderInner();
  } finally {
    paper.submitting = false;
    refresh();
  }
}

async function submitPaperOrderInner() {
  const d = paper.draft;
  // NO MARKET DATA, NO ORDER, AND IT SAYS SO.
  // decideOrder destructures info, so calling it with paper.info still null
  // threw TypeError inside an async click handler, which becomes an unhandled
  // rejection: no event, no refusal, a button that does nothing and explains
  // nothing. That is the same defect class as the size field. paperDataProblem
  // carries the sentence with the condition so the two cannot come apart.
  const problem = paperDataProblem();
  if (problem) {
    pushEvent({ ok: false, at: Date.now(), message: "Not priced.", detail: problem });
    if (paper.state) await saveState(paper.state);
    refresh(); return;
  }
  const complaint = sizeComplaint(d.size);
  if (complaint) {
    pushEvent({ ok: false, at: Date.now(), message: complaint.message, detail: complaint.detail });
    await saveState(paper.state); refresh(); return;
  }
  const size = parseFloat(d.size);
  try {
    paper.book = await orderBook(paper.coin);
    paper.bookAt = Date.now();
    paper.lastError = null;
  } catch (e) {
    // Priced against the book already held, which is allowed only because
    // paperDataProblem above has confirmed it is recent. Its age goes into the
    // fill's own detail line so a fill is never reported as more current than
    // the data behind it.
    paper.lastError = paperErrorText(e);
  }

  const decision = decideOrder(paper.state, paper.info, paper.book, paper.fees, {
    coin: paper.coin, side: d.side, type: d.type,
    px: parseFloat(d.px), size,
    postOnly: d.type === "limit" && d.postOnly,
    reduceOnly: d.reduceOnly,
    leverage: paperLeverage(),
  });

  if (!decision.ok) {
    pushEvent({ ok: false, message: decision.message, detail: decision.detail, at: decision.at });
  } else if (decision.kind === "rest") {
    paper.state.resting.push(decision.order);
    pushEvent({ ok: true, at: Date.now(),
      message: `Resting ${decision.order.side} ${decision.order.size} ${paper.coin} at ${decision.order.px}.`,
      detail: "It did not cross, so it is on the book. Whether it would fill is not "
              + "something public data can settle." });
  } else {
    // NO BALANCE CHECK HERE. There used to be one, and it was wrong twice: it
    // skipped whenever the order closed anything, so a flip that opened a
    // larger position on the other side went unchecked, and it ignored the
    // margin a closing leg releases. decideOrder now refuses with code
    // `margin`, and it does it by running the fill against a copy of the state
    // rather than by doing the arithmetic a second time. A second copy of that
    // rule in this file could only drift away from the first.
    const f = decision.fill;
    // settleAndApplyFill, NOT applyFill. applyFill is synchronous and deletes a
    // closed position outright, while funding is only known after an await, so
    // a position closed before its funding settled took the charge with it: a
    // position held 56.9 minutes across a funding boundary rendered
    // "Funding paid: $0.00" where the venue had charged $0.238385. applyFill
    // cannot fix this from its own side, because the margin check runs it
    // against a state copy and is not allowed to make a network call.
    await settleAndApplyFill(paper.state, paper.info, f);
    const slip = f.slippageVsTouch;
    const depth = f.levels.length > 1
      ? `It took ${f.levels.length} levels of the book, ending at ${pnum(f.worstPx, 6)}. `
        + `That is ${pnum(Math.abs(slip), 6)} away from the touch, which is what depth costs.`
      : "It filled inside the first level of the book.";
    // decideOrder clamps a reduce-only order to the position, the way the
    // venue does. The fill is then smaller than what was typed, and saying
    // "Filled 0.01" against a typed 0.05 without explaining the gap reads as
    // the panel losing the number.
    // Compared against the request AFTER lot rounding, so that losing a digit
    // to the asset's lot size is not reported as a reduce-only clamp.
    const asked = roundSize(size, paper.info.szDecimals);
    const clamped = f.reduceOnly && f.size < asked - lotSize(paper.info.szDecimals) / 2
      ? ` Reduce-only, so it closed the ${f.size} ${paper.coin} that was open rather `
        + `than the ${asked} asked for.`
      : "";
    // How old the book this was priced against is. A fill reported without it
    // is a measurement claim the data may not support.
    const bookAge = paper.bookAt ? Math.round((Date.now() - paper.bookAt) / 1000) : null;
    const aged = bookAge != null && bookAge >= 5
      ? ` Priced against a book that was ${bookAge} seconds old, because the venue `
        + "did not answer this time."
      : "";
    pushEvent({ ok: true, at: f.at,
      message: `Filled ${f.size} ${paper.coin} at ${ppx(f.avgPx, paper.info)}, `
               + `fee ${pmoney(f.fee)}.`,
      detail: depth + clamped + aged });
    // The order went through, so the ticket is cleared the way an order ticket
    // is. This is a deliberate write to the size field and the only one
    // outside the slider: it follows the person's own click, not a tick.
    paper.draft.size = "";
    if (paper.ui) paper.ui.size.input.value = "";
  }
  await saveState(paper.state);
  refresh();
}

async function closePaperPosition() {
  const pos = paper.state && paper.state.positions[paper.coin];
  if (!pos) return;
  // Same guard as submit, and for the same reason: this path also calls
  // decideOrder, which throws on a null info inside an async handler and
  // leaves a Close button that does nothing and says nothing.
  const problem = paperDataProblem();
  if (problem) {
    pushEvent({ ok: false, at: Date.now(),
      message: "Not closed, because it could not be priced.", detail: problem });
    await saveState(paper.state); refresh(); return;
  }
  try {
    paper.book = await orderBook(paper.coin);
    paper.bookAt = Date.now();
  } catch (e) { paper.lastError = paperErrorText(e); }
  const decision = decideOrder(paper.state, paper.info, paper.book, paper.fees, {
    coin: paper.coin, side: pos.side === "long" ? "sell" : "buy", type: "market",
    size: pos.size, reduceOnly: true, leverage: pos.leverage,
  });
  if (!decision.ok) {
    pushEvent({ ok: false, message: decision.message, detail: decision.detail, at: decision.at });
  } else {
    // Settle before applying: this is the close path, which is exactly where
    // an unsettled funding charge would be lost with the position.
    await settleAndApplyFill(paper.state, paper.info, decision.fill);
    pushEvent({ ok: true, at: Date.now(),
      message: `Closed at ${ppx(decision.fill.avgPx, paper.info)}.`,
      detail: "What it would have earned is in the list below. Nobody earned it." });
  }
  await saveState(paper.state);
  refresh();
}

/** A failure turned into something a person can read. Network errors arrive as
 *  a bare "Failed to fetch", which on its own reads like a bug in the panel. */
function paperErrorText(e) {
  const m = e && e.message ? String(e.message) : "";
  if (/failed to fetch|networkerror|load failed/i.test(m)) {
    return "api.hyperliquid.xyz could not be reached from this page.";
  }
  return m ? `The venue answered: ${m}` : "No reason was given.";
}

async function tick() {
  if (!paper.coin) return;
  try {
    paper.info = await assetInfo(paper.coin);
    paper.infoAt = Date.now();
    paper.lastError = null;
  } catch (e) {
    // The failure is recorded rather than swallowed. Returning here without it
    // left Mark, "Would be worth" and Liquidation rendering from the last good
    // read for as long as the tab stayed open with nothing saying so.
    paper.lastError = paperErrorText(e);
    refresh();
    return;
  }
  if (paper.open) {
    try {
      paper.book = await orderBook(paper.coin);
      paper.bookAt = Date.now();
    } catch (e) { paper.lastError = paperErrorText(e); }
  }
  // Funding, at the rates the venue actually applied.
  try { await settleFunding(paper.state, paper.coin); } catch (e) { /* skip this pass */ }

  // Resting orders, on the narrow rule only.
  const still = [];
  for (const o of paper.state.resting) {
    if (o.coin === paper.coin
        && restingWouldFill(o, paper.info.markPx, paper.info.szDecimals)) {
      const fill = {
        coin: o.coin, side: o.side, size: o.size, avgPx: o.px, worstPx: o.px,
        levels: [{ px: o.px, sz: o.size }], feeRate: paper.fees.maker,
        fee: o.size * o.px * paper.fees.maker, leverage: o.leverage,
        reduceOnly: o.reduceOnly, slippageVsTouch: 0, at: Date.now(),
      };
      // A reduce-only order that rested while the position it was meant to
      // close went away does nothing at all now. Asking before announcing is
      // the difference between an order list that is correct and a panel that
      // writes "filled" over a fill that never happened.
      if (!fillWouldApply(paper.state, fill)) {
        pushEvent({ ok: false, at: Date.now(),
          message: `Resting reduce-only ${o.side} at ${o.px} was dropped, not filled.`,
          detail: `The ${o.coin} position it was there to close is already gone, and `
                  + "reduce-only means it will not open one in the other direction." });
        continue;
      }
      // A resting order can be the leg that closes a position, so this one
      // settles first too.
      await settleAndApplyFill(paper.state, paper.info, fill);
      pushEvent({ ok: true, at: Date.now(),
        message: `Resting ${o.side} at ${ppx(o.px, paper.info)} treated as filled, `
                 + "at the maker fee.",
        detail: "The mark went clear through the level. Whether an order on the venue "
                + "would have reached the front of the queue is not public, so this is an "
                + "assumption." });
    } else {
      still.push(o);
    }
  }
  paper.state.resting = still;
  await saveState(paper.state);
  refresh();
}

// ── Wiring ──────────────────────────────────────────────────────────────────

/** Open or close practice mode, and remember which it was.
 *
 *  Persisted, so somebody who opened it once does not have to find the tab
 *  again on every market they look at. The default when nothing is stored is
 *  CLOSED: practice mode covers none of their page until it is asked for. */
async function setPaperOpen(open) {
  paper.open = !!open;
  try { await chrome.storage.local.set({ [PAPER_OPEN_KEY]: paper.open }); } catch (e) {}
  refresh();
  // Scroll BEFORE measuring. Anchoring first and scrolling after would place
  // the panel against rects that the scroll is about to invalidate.
  if (paper.open) bringBookIntoView(); else restorePaperScroll();
  // Directly, not through the rAF queue, so the panel is in its place in the
  // same frame it becomes visible rather than one frame later at 0,0.
  anchorPaperTab();
  anchorPaperPanel();
  // The panel's own height is only measurable once it is on screen, and the
  // placement depends on it, so measure again after a layout has happened.
  requestAnimationFrame(anchorPaperPanel);
  // The book is only fetched while the panel is open, so opening it without
  // this left up to a whole tick, four seconds, in which nothing could be
  // priced. Asking immediately rather than waiting for the clock.
  if (paper.open) tick();
}

function wirePaper(panel) {
  panel.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    const kind = act.dataset.act;
    if (kind === "shut") {
      await setPaperOpen(false);
    } else if (kind === "side" || kind === "type") {
      paper.draft[kind] = act.dataset.v;
      paper.outcome = null;
      // Limit with an empty price refused itself the moment it was selected.
      // Their own form seeds the price from the mark, and this is a deliberate
      // click rather than a tick, so writing the field is the right thing.
      if (kind === "type" && act.dataset.v === "limit"
          && !String(paper.draft.px).trim() && paper.info) {
        const seed = ppx(paper.info.markPx, paper.info).replace(/,/g, "");
        paper.draft.px = seed;
        if (paper.ui) paper.ui.price.input.value = seed;
      }
      refresh();
    } else if (kind === "submit") {
      await submitPaperOrder();
    } else if (kind === "close") {
      await closePaperPosition();
    } else if (kind === "cancel") {
      paper.state.resting = paper.state.resting.filter((o) => o.id !== act.dataset.id);
      await saveState(paper.state); refresh();
    } else if (kind === "reset") {
      paper.state = await resetState();
      paper.draft.size = ""; paper.draft.px = "";
      if (paper.ui) { paper.ui.size.input.value = ""; paper.ui.price.input.value = ""; }
      refresh();
    }
  });

  // `input` is what a keystroke fires. `change` is listened to as well because
  // a checkbox toggled by its label fires only change, and because a harness
  // driving this synthetically may send either.
  const onEdit = (e) => {
    const f = e.target.closest ? e.target.closest("[data-f]") : null;
    if (f) onFieldInput(f);
  };
  panel.addEventListener("input", onEdit);
  panel.addEventListener("change", onEdit);

  // Leaving the leverage field is when the substitution takes effect, so that
  // is when the field is made to agree with it. Doing this on every keystroke
  // instead would make 50 unreachable on a market capped at 40.
  panel.addEventListener("focusout", (e) => {
    const el = e.target;
    if (!el || !el.dataset || el.dataset.f !== "leverage") return;
    const used = String(paperLeverage());
    if (el.value !== used) { el.value = used; paper.draft.leverage = used; refresh(); }
  });

  // Enter submits from any text field, which is what an order ticket does.
  panel.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    if (!e.target.closest || !e.target.closest("[data-f]")) return;
    e.preventDefault();
    await submitPaperOrder();
  });
}

// ── Start ───────────────────────────────────────────────────────────────────

async function startPaper() {
  const coin = paperCoinFromUrl();
  if (!coin) return;                       // not on a market page
  paper.coin = coin;

  if (!paper.panel) {
    const built = buildPaperPanel();
    paper.panel = built.root;
    paper.ui = built.ui;
    const builtTab = buildPaperTab();
    paper.tab = builtTab.tab;
    paper.tabHeld = builtTab.held;
    wirePaper(paper.panel);
    // The tab is a sibling of the panel rather than part of it, because the
    // two are never on screen together and each has its own placement.
    paper.tab.addEventListener("click", () => { setPaperOpen(true); });

    paper.state = await loadState();
    try {
      const got = await chrome.storage.local.get(PAPER_OPEN_KEY);
      paper.open = !!(got && got[PAPER_OPEN_KEY]);
    } catch (e) { paper.open = false; }
    try {
      paper.fees = await feeSchedule();
      paper.feesRead = true;
    } catch (e) { /* the base constants stand, and the Fees row says so */ }

    // On document.body, not inside their grid. react-grid-layout places its
    // own children by transform and a foreign child lands at 0,0 over the
    // chart; fixed elements on body are outside that arithmetic entirely.
    document.body.appendChild(paper.tab);
    document.body.appendChild(paper.panel);
    refresh();
    anchorPaperTab();
    anchorPaperPanel();
    watchPlacement();

    // Their form is drawn after the shell, so the first anchor can land on a
    // page that has no form on it yet. Re-anchor for a bounded while; the
    // fallback positions mean both the tab and the panel are usable the whole
    // time rather than absent until their form appears.
    const started = Date.now();
    const settle = setInterval(() => {
      anchorPaperTab();
      anchorPaperPanel();
      if (theirOrderForm() || Date.now() - started > 15000) clearInterval(settle);
    }, 500);
  }
  await tick();
  if (paper.timer) clearInterval(paper.timer);
  paper.timer = setInterval(tick, 4000);
}

// The app rewrites the URL without a load when the market changes, so the coin
// has to be watched rather than read once.
let paperLastPath = null;
setInterval(() => {
  if (location.pathname === paperLastPath) return;
  paperLastPath = location.pathname;
  const c = paperCoinFromUrl();
  if (c && c !== paper.coin) {
    paper.coin = c;
    // The draft is about the old market. Prices and sizes do not carry across
    // assets with different ticks and lot sizes, so they are cleared, and this
    // is a market change rather than a tick so writing the fields is correct.
    paper.draft.px = "";
    paper.draft.size = "";
    if (paper.ui) { paper.ui.size.input.value = ""; paper.ui.price.input.value = ""; }
    // The new market's data has not been read yet, and the old market's must
    // not be shown as though it were this one's.
    paper.info = null; paper.infoAt = 0; paper.bookAt = 0;
    paper.book = { levels: [[], []] };
    paperFormEl = null; paperBookEl = null;
    tick();
  } else if (!c && paper.panel) {
    paper.panel.remove();
    if (paper.tab) paper.tab.remove();
    paper.panel = null;
    paper.tab = null;
    paper.ui = null;
    if (paper.timer) { clearInterval(paper.timer); paper.timer = null; }
  } else if (c && !paper.panel) {
    startPaper();
  }
}, 700);

startPaper();
