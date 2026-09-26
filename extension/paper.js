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
// Whether the list of positions on OTHER markets is showing. Stored the same
// way the panel's own open state is, in chrome.storage.local under its own key,
// so the choice survives a reload and every market change.
//
// It defaults to SHOWING, which is the opposite of the panel's own default and
// deliberately so. The panel is closed by default because practice mode should
// cover none of their page until it is asked for. This section exists because
// positions on other markets were invisible, and a fix for invisibility that
// starts collapsed has not fixed it.
const PAPER_OTHERS_KEY = "tnega_paper_others_open";

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
    // navigation their page keeps on the bottom edge, and no taller than it
    // needs to be: the height is the content's and this is only the cap.
    //
    // 84%, RAISED FROM 72%, AND MEASURED RATHER THAN PICKED. 72% is 572px at
    // 390x844, which left 529px of body, and the control that closes a position
    // sat at 590. So somebody who opened a position could not close it without
    // finding a scroll they had no reason to expect, which is the exact failure
    // the placement rules here exist to prevent, and use_it.py reports it by
    // name. What changed under the cap is that their order form's tail is five
    // always-present rows rather than four rows drawn only while an order was
    // being typed, which is 100px that now stands between the button and the
    // position in every state.
    //
    // 84% is 668px, which puts the top edge at 127 at 390x844. Their market
    // header, the pair and the mark, ends at 125 and stays visible; what is
    // covered that was not is their Chart / Order Book / Trades strip and the
    // top of the chart. That is the trade this panel is already making at 1280,
    // where it covers their order book outright, and it is the smaller half of
    // it: a position you cannot close is worse than a chart you have to close
    // the panel to read.
    const lift = bottomObstruction();
    s.left = "0px"; s.right = "0px"; s.bottom = lift + "px";
    s.top = "auto"; s.width = "auto"; s.height = "auto";
    s.maxHeight = Math.round((vh - lift) * 0.84) + "px";
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
  // Two different absences, and they were the same two letters. Without `info`
  // this market has not been read and the precision to print at is not known;
  // with a value that is not a number there is nothing to print at any
  // precision. Neither is "N/A", which is the string this panel is retiring.
  if (!info) return "not read";
  if (!isFinite(Number(n))) return "not a price";
  const r = roundPrice(Number(n), info.szDecimals);
  return isFinite(r) ? pnum(r, Math.max(0, 6 - info.szDecimals)) : "not a price";
}

/** Why a position can have no liquidation price at all. */
const PAPER_NO_LIQ =
  "A position whose margin is its whole value cannot be liquidated by price: "
  + "there is no price at which the margin runs out, short of zero.";

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
  return tpEl(row, "span", "tp-kv-v", "");
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

/** One of their two linked rows: a price box, and beside it the gain or the
 *  loss with a unit picker, either of which can be typed.
 *
 *  THEIR LAYOUT, ELEMENT FOR ELEMENT. Read off their shipped bundle on
 *  2026-09-23, component Hp: a CSS grid of `1fr 120px` with a 10px gap on
 *  desktop and `1fr 1fr` on a phone, the price on the left with its label
 *  inside the box, and on the right a number whose right component is a
 *  two-option select reading `$` or `%`. Their labels, from the catalogue their
 *  app imports at runtime: `tp.price` is "TP Price", `sl.price` is "SL Price",
 *  `gain` is "Gain", `loss` is "Loss".
 */
function tpTicketLevel(parent, label, fname, sideLabel, gname) {
  const wrap = tpEl(parent, "div", "tp-tl");
  const row = tpEl(wrap, "div", "tp-tl-row");
  const box = tpEl(row, "div", "tp-field tp-tl-f");
  tpEl(box, "span", "tp-field-k", label);
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "not set";
  input.dataset.f = fname;
  input.setAttribute("aria-label", label + ", a price");
  box.appendChild(input);

  const gbox = tpEl(row, "div", "tp-field tp-tl-g");
  tpEl(gbox, "span", "tp-field-k", sideLabel);
  const gain = document.createElement("input");
  gain.type = "text";
  gain.inputMode = "decimal";
  gain.autocomplete = "off";
  gain.spellcheck = false;
  gain.placeholder = "0";
  gain.dataset.f = gname;
  gain.setAttribute("aria-label", sideLabel);
  gbox.appendChild(gain);
  // THE UNIT PICKER IS ON THIS SIDE AND IS SHARED BY BOTH ROWS, which is
  // theirs: setIsNtl writes one global setting that the gain row and the loss
  // row both read, so switching either switches both. A per-row unit would let
  // the two halves of one decision be quoted in different currencies.
  const unit = tpEl(gbox, "button", "tp-field-u tp-unit", "%");
  unit.type = "button";
  unit.dataset.act = "tpslunit";

  const msg = tpEl(wrap, "div", "tp-lvl-msg tp-hide");
  return { wrap, box, input, gbox, gain, unit, msg };
}

/** A two-column table row whose value cell is returned for later updates. */
function tpRow(tbody, label) {
  const tr = tpEl(tbody, "tr");
  tpEl(tr, "th", null, label);
  return tpEl(tr, "td", null, "");
}

/** The cat, as an <img>, or nothing if there is no extension runtime to ask.
 *
 *  Fendi, Tnega's own mascot, the same cat content.js puts in the address
 *  panel. He appears on the practice tab and in the practice panel header,
 *  beside the sentence saying the money is not there. The toolbar icon, the
 *  popup and the store listing keep the Tnega logo.
 *
 *  `px` is the CSS box the class gives him (22 in the header, 26 on the tab).
 *  The files are square and he fills their height, so the box is square and
 *  object-fit: contain never stretches him; srcset picks 32, 48 or 128 for
 *  that box at the screen's density. */
function tpCat(parent, cls, px) {
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
    img.width = px;
    img.height = px;
    img.sizes = `${px}px`;
    img.srcset = [32, 48, 128]
      .map((n) => `${chrome.runtime.getURL(`icons/fendi-${n}.png`)} ${n}w`).join(", ");
    img.src = chrome.runtime.getURL("icons/fendi-128.png");
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
  tpCat(tab, "tp-tab-cat", 26);
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
  ui.head = head;
  tpCat(head, "tp-cat", 22);
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

  // NOTHING IS BEING KEPT, AND IT SAYS SO ABOVE EVERYTHING IT IS ABOUT.
  // Only rendered when it is true. It used to sit near the bottom, among the
  // standing sentences, which is the wrong place for a notice that every figure
  // below it is about to be lost: at 390 it was off the screen entirely.
  ui.storage = tpEl(body, "div", "tp-storage tp-hide");

  // ── Their Isolated | 20x | Practice strip, as three buttons that all open
  //    something.
  //
  // WHAT THIS REPLACES, AND WHY THE EARLIER FIX IS NOT BEING UNDONE.
  //
  // The first version of this row copied their three filled buttons exactly
  // and two of the three did nothing: dead divs with cursor:auto and no
  // handler, pixel-identical to their working controls. Worse, the only
  // editable thing in the row, a leverage text box, was hidden inside the
  // middle one and looked exactly like the two that did nothing. A reviewer
  // said they would not have found it without dumping the DOM.
  //
  // The answer then was to draw the two statements as statements. That was
  // right about "do not draw a dead button" and wrong about the interaction:
  // on their form the middle control is a BUTTON reading "20x" that opens a
  // modal with a slider in it, and ours was a field you type a number into.
  // Typing is not what a person does there.
  //
  // So all three are buttons again, and the rule that produced the earlier
  // comment still holds without exception: every one of these opens a panel.
  // Not one of them is a label wearing a button's clothes.
  //
  //   1  MARGIN MODE. Theirs switches the asset between cross and isolated.
  //      Ours opens the same choice and says which of the two this simulation
  //      runs. It is isolated: liquidationPrice in paperSim.js solves from the
  //      margin that one position put up, never from the account balance, and
  //      that is the isolated rule. The row used to read "Cross", which was
  //      the wrong word for the arithmetic underneath it.
  //   2  LEVERAGE, as "20x", opening the slider. The headline change.
  //   3  Theirs picks which account the order goes to, Unified or One-Way.
  //      There is one account here, it is local, and it cannot be switched, so
  //      copying their word would name a feature that does not exist. The slot
  //      opens what the practice account is instead, and holds the control
  //      that resets it.
  //
  // WIDTH. Their desktop row is three buttons in repeat(3, 1fr) with a 10px
  // gap. Their phone row is two, because their order-type dropdown takes the
  // third slot beside it. Our order type keeps a row of its own at every
  // width, so this row keeps all three at 390 as well.
  const strip = tpEl(body, "div", "tp-strip");
  ui.marginBtn = tpEl(strip, "button", "tp-strip-b", "Isolated");
  ui.marginBtn.type = "button";
  ui.marginBtn.dataset.act = "openmargin";
  ui.marginBtn.setAttribute("aria-label", "Margin mode");
  ui.levBtn = tpEl(strip, "button", "tp-strip-b", "20x");
  ui.levBtn.type = "button";
  ui.levBtn.dataset.act = "openlev";
  ui.levBtn.setAttribute("aria-label", "Adjust leverage");
  ui.acctBtn = tpEl(strip, "button", "tp-strip-b", "Practice");
  ui.acctBtn.type = "button";
  ui.acctBtn.dataset.act = "openacct";
  ui.acctBtn.setAttribute("aria-label", "The practice account");

  // WHAT IS LEFT FOR THIS LINE NOW THAT THE BOX IS A SLIDER.
  //
  // It used to carry four sentences, one for each way a typed number was not
  // the number that would be used: not a number at all, above the market's
  // maximum, under 1, and fractional. A slider that runs 1 to the market's own
  // maximum in whole steps cannot produce any of those, so all four are gone
  // from paperLeverageNote along with the typing that caused them.
  //
  // Two cases are left and they are not about typing. A leverage chosen while
  // the market's rules were still unread is held against a fallback maximum of
  // 50, and the venue also lowers an asset's maximum from time to time: either
  // way a number already chosen can end up above what the market now allows,
  // and the substitution still has to be said out loud. The other sentence
  // this line carries is ticketLeverageSeedNote, which says the number came
  // from the position already open.
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
  // WHERE THE REST OF THE BALANCE WENT. Somebody holding positions on SOL and
  // ETH looked at BTC and read "Available to Trade 179.34 USDC" with nothing
  // saying that the other nine thousand was margin on two markets this panel
  // was not showing. A balance that reads nearly empty with no reason given is
  // an absence without an explanation, which is the thing this panel exists to
  // not do.
  ui.availableNote = tpEl(body, "div", "tp-kv-note tp-hide");

  // THEIR "Current Position" ROW, IN THEIR PLACE FOR IT, TWO ROWS UNDER
  // Available to Trade AND DIRECTLY ABOVE THE SIZE BOX.
  //
  // THE HISTORY OF THIS ROW, BECAUSE IT WAS TAKEN OUT AND PUT BACK AND THE TWO
  // DECISIONS ARE ABOUT DIFFERENT THINGS.
  //
  // It was removed as deduplication. The measurement behind that was true and
  // is worth keeping: with one position open, this panel stated it four times
  // in a 342px column, as this row, as a one-line brief, as the ladder, and as
  // a seven-row table that repeated five of the ladder's own fields to add two.
  // Three of those four were ours. They were merged, the brief and the table
  // are gone, and the position below the button now has one home.
  //
  // This row was the fourth, and it was the wrong one to cut, because it is the
  // only one of the four that is on Hyperliquid's own form. Their form carries
  // it here AND carries a positions table at the foot of the page, and nobody
  // reading their form experiences that as being told the same thing twice: it
  // is the number you glance at while sizing an order, and it belongs beside
  // the size box rather than only below the button.
  //
  // So the rule this file now follows, stated once here because two different
  // comments in this pass depend on it: where Hyperliquid has a thing, match
  // them, and say that is why. Where we invented a repeat, say it once. The
  // repeats removed elsewhere in this pass are all of the second kind.
  //
  // A ZERO HERE IS A READING, NOT AN ABSENCE. "0.00000 BTC" is the true size of
  // no position, which is a different thing from a figure that could not be
  // worked out, and the row says which of the two it is showing.
  ui.currentPos = tpKv(body, "Current Position");

  // Price sits above Size on their form when Limit is selected.
  ui.price = tpField(body, "Price", "px", "USD");
  ui.size = tpField(body, "Size", "size", "");
  // THEIR UNIT IS A CONTROL, NOT A CAPTION. The chip at the right of their Size
  // box carries a radius and swaps the box between the coin and USD; ours was a
  // plain span reading "BTC", so a person who wanted to buy fifty dollars of
  // something had to work out the coin amount themselves. Swapped here to a
  // button in the same place, with the same two states. The coin amount stays
  // the one the engine is given either way: see setSizeField.
  ui.sizeUnit = tpEl(null, "button", "tp-field-u tp-unit", "");
  ui.sizeUnit.type = "button";
  ui.sizeUnit.dataset.act = "sizeunit";
  ui.size.box.replaceChild(ui.sizeUnit, ui.size.unit);
  ui.size.unit = ui.sizeUnit;

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

  // ── THEIR TAKE PROFIT / STOP LOSS CHECKBOX, THEIR TWO PRICE BOXES, AND NOT
  //    THEIR MEANING.
  //
  // This was declined in the last pass, with the reason that a level here is a
  // mark on our own ladder rather than an order, and that two price boxes on an
  // order ticket imply the venue is holding something. The reason has not
  // changed and is not being abandoned: what changes is that the feature is
  // built and the implication is what gets designed out.
  //
  // So the boxes take a price and write it onto the position the moment the
  // order fills, exactly as typing the same number into the two fields further
  // down would. Nothing is sent, nothing rests, and nothing triggers. The line
  // under them says that in the same words the position's own fields use, and
  // the labels avoid every word that belongs to an order: there is no
  // "trigger", no "TP order", and no "attached order" anywhere in this block.
  //
  // REFUSED BEFORE THE ORDER GOES, NOT AFTER. A stop on the winning side of
  // entry is a refusal the engine already writes, and getting it after the fill
  // would leave somebody holding a position they opened for the sake of a stop
  // they cannot have. paperTicketLevels runs setPositionLevel against the
  // position this order WOULD leave behind, so it is the same function giving
  // the same answer, one step earlier.
  ui.tpsl = tpCheck(body, "Take Profit / Stop Loss", "tpsl");
  ui.tpslBox = tpEl(body, "div", "tp-tpsl tp-hide");
  ui.tpTicket = tpTicketLevel(ui.tpslBox, "TP Price", "tpPx", "Gain", "tpGain");
  ui.slTicket = tpTicketLevel(ui.tpslBox, "SL Price", "slPx", "Loss", "slLoss");
  // Their form puts a Gain % beside the take profit and a Loss % beside the
  // stop. The cell is in the same place and carries what closing the whole
  // position there would realise, from the engine's own closeValueAt, because
  // that is the figure the rest of this panel quotes and a second percentage
  // measured a third way is how two numbers for one quantity get on screen.
  tpEl(ui.tpslBox, "p", "tp-note tp-lvl-deny",
    "Marks of yours, not orders. They go onto the position when this order "
    + "fills. Nothing rests at the venue and nothing here triggers: the close "
    + "button is the only thing that closes a position.");

  ui.postOnly = tpCheck(body, "Post Only", "postOnly");

  // What the venue would refuse, said before the click instead of after it,
  // and directly above the button it is about to stop.
  ui.refusal = tpEl(body, "div", "tp-refusal tp-hide");

  // What was ASSUMED to let this order through, which is the other direction
  // and the one that used to be silent. decideOrder carries the sentence on
  // the decision when an inferred rule is what makes the difference, so the
  // moment it speaks is the moment it changes the outcome.
  ui.assumption = tpEl(body, "div", "tp-assume tp-hide");

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

  // ── WHAT THE ORDER BEING TYPED WOULD COST, ON THE SIDE OF THE BUTTON THEIR
  // OWN FORM PUTS IT.
  //
  // Theirs are under their Connect button and so are these. Above it was tried
  // and measured: it pushed the button 104px down the ticket, past the bottom
  // of the panel in the one case the placement cannot make taller, which is the
  // 440px minimum at 1280x813. The button is the point of the panel and it does
  // not go behind a scroll to make room for a description of what it would do.
  //
  // They do not push the position far: the four rows are only drawn while a
  // size is in the field, and placing the order clears it, so a person reading
  // a position they hold has one muted line here and not four figures.
  const stats = tpEl(body, "div", "tp-stats");

  // THEIR FIVE ROWS, IN THEIR ORDER, ALWAYS PRESENT, AND NOT ONE N/A AMONG
  // THEM. Their form's tail is Liquidation Price, Order Value, Margin Required,
  // Slippage, Fees, drawn whether anything has been entered or not, and three
  // of theirs print N/A while nothing has been.
  //
  // Four of these were hidden behind one stand-in line, which was the previous
  // answer to the same tension and went too far the other way: the tail of
  // their form disappeared, so the panel had a shape theirs does not and a
  // person looking for Margin Required found nothing at all where it should
  // be. The rows are back. What is not back is N/A, which was removed because
  // a failed read and an empty field printed the same two letters and a person
  // could not tell a broken panel from an untouched one.
  //
  // So: their shape, our words. Every row stands, and when it has no figure it
  // carries the short name of the absence it is in, which differs by cause.
  // The sentence behind that name, when there is more to say, is the refusal or
  // the complaint already rendered above the button.
  ui.liq = tpKv(stats, "Liquidation Price");
  ui.orderValue = tpKv(stats, "Order Value");
  ui.marginReq = tpKv(stats, "Margin Required");
  ui.slippage = tpKv(stats, "Slippage");
  // THEIRS TOO, AND IT USED TO BE A FOOTNOTE. The fee schedule was in the small
  // muted line under these rows, beside how old the market read is, which made
  // the one figure of the five that is always knowable look like a note about
  // the other four. It is their fifth row and it is now the fifth row.
  ui.fees = tpKv(stats, "Fees");
  // The longer form of whatever the size field is doing wrong, when there is a
  // longer form. Not "enter a size", which the rows above now say themselves.
  ui.previewNone = tpEl(stats, "div", "tp-preview-none tp-hide");

  // HOW OLD THE READ BEHIND THOSE FIGURES IS. Not one of their rows: it is
  // about this panel rather than about the order, and a figure without its age
  // is the thing this project does not ship. One line of small muted type,
  // because it is a footnote to the rows above rather than one more of them.
  const meta = tpEl(body, "div", "tp-meta");
  ui.dataLine = tpMeta(meta, "Market data");

  // ── The practice account. Ours, not a copy of anything of theirs.
  //
  // WHAT IS BELOW THE BUTTON AND WHY IT IS IN THIS ORDER. Everything down here
  // reports what has already happened, nearest in time first. The banner above
  // is the last press; then what is open on this market, what is open
  // elsewhere, what is resting, what happened before that, and what has been
  // closed. The standing sentences are last because they are read once.
  const acct = tpEl(body, "div", "tp-acct");

  // THE OPEN POSITION AND THE WAY OUT OF IT, NEXT TO THE BUTTON.
  // Measured with a position open: the position table and "Close at the mark"
  // were both below the fold, so somebody who opened a position could not
  // close it without discovering a scroll they had no reason to expect.
  //
  // ONE HOME FOR THE POSITION, AND THIS IS IT. It was stated four times: a
  // Current Position row on the ticket, a one-line brief, the ladder, and a
  // seven-row table repeating five of the ladder's own fields to add two. The
  // ladder carries every price the position has, each with what closing there
  // would realise, so it is the home; the two facts it does not carry, the
  // size and the funding charged so far, are the two rows above it.
  ui.posSec = tpEl(acct, "div", "tp-sec tp-region tp-pos");
  const posHead = tpEl(ui.posSec, "div", "tp-pos-h");
  ui.posTitle = tpEl(posHead, "div", "tp-sub", "Practice position");
  // The only control that closes a position, and it is beside the heading of
  // the thing it closes rather than at the end of a list of numbers.
  ui.posClose = tpEl(posHead, "button", "tp-x tp-pos-x", "Close position");
  ui.posClose.type = "button";
  ui.posClose.dataset.act = "close";

  ui.posEmpty = tpEl(ui.posSec, "div", "tp-empty", "No open position.");
  const ptab = tpEl(ui.posSec, "table", "tp-table tp-pos-t");
  const ptb = tpEl(ptab, "tbody");
  ui.posTable = ptab;
  // THEIR NINE COLUMNS, IN THEIR ORDER AND IN THEIR WORDS, AS ROWS.
  //
  // Their positions table runs Market, Size, Position Value, Entry Price, Mark
  // Price, PNL (ROE %), Liq. Price, Margin, Funding across the foot of the
  // page. This column is 342px of inner width and a nine-column table does not
  // go in it, so the ones that are figures about the position are label/value
  // rows here and the ones that are PRICES stay on the ladder below, where each
  // already carries what closing there would realise. Market is the heading.
  // Entry Price, Mark Price and Liq. Price are the ladder's entry, mark and
  // liquidation rungs.
  //
  // That left three of theirs with nowhere to be, and they are the three added
  // here: Position Value, PNL (ROE %) and Margin. The relative order is theirs,
  // so the two tables read the same way down.
  //
  // Side, size and leverage share the Size row, because they are one fact:
  // what is open.
  ui.posSize = tpRow(ptb, "Size");
  ui.posValue = tpRow(ptb, "Position Value");
  // THE PERCENT THE LADDER SAYS IT IS NOT. Every rung's percentage is how far
  // that price is from entry; the disclosure says so and says it is not a
  // return on the margin. ROE is the return on the margin, so this row is the
  // figure that note has been pointing at, not a contradiction of it. The two
  // are kept apart by living in different places and being named differently.
  ui.posPnl = tpRow(ptb, "PNL (ROE %)");
  ui.posMargin = tpRow(ptb, "Margin");
  // Their word is Funding, and the sign carries the direction: negative is paid
  // out, positive is received, which is how their column reads it too.
  ui.posFunding = tpRow(ptb, "Funding");
  // A position held on a market whose rules have not been read yet still has a
  // side, a size and a funding charge, so the rows above stand. What is missing
  // is every price, and this says which absence that is rather than leaving the
  // ladder simply gone.
  ui.posUnpriced = tpEl(ui.posSec, "div", "tp-pos-why tp-hide");

  // THE LADDER AND THE TWO LEVEL FIELDS, inside the position they belong to
  // rather than in a section of their own with its own heading.
  buildLevels(ui.posSec, ui);

  // EVERY OTHER MARKET'S POSITION, directly under this market's and below it.
  // Below, because the position on the market the page is on is the prominent
  // one and stays where it is, and because this list grows with the account:
  // anything it could push down the page has to be something nobody needs, and
  // everything above it here is either the ticket, the outcome banner or the
  // control that closes the position, none of which may move.
  buildOthers(acct, ui);

  ui.restSec = tpEl(acct, "div", "tp-sec tp-region tp-hide");
  tpEl(ui.restSec, "div", "tp-sub", "Resting orders");
  ui.restList = tpEl(ui.restSec, "ul", "tp-rest");
  // One line. The rest of it, that the mark has to go clear through the level
  // and that queue position is not public, is in the disclosure with the other
  // standing explanations.
  tpEl(ui.restSec, "p", "tp-note",
    "Filled only once the mark has gone clear through the level, which is this "
    + "panel's assumption rather than something public data settles.");

  ui.closedSec = tpEl(acct, "div", "tp-sec tp-region tp-hide");
  tpEl(ui.closedSec, "div", "tp-sub", "Closed, and what each would have earned");
  ui.closedList = tpEl(ui.closedSec, "ul", "tp-rest");

  // HISTORY, AND IT SITS AFTER THE CLOSED LIST RATHER THAN BEFORE IT.
  //
  // It was above, headed Earlier, which put a running log of fills and
  // refusals between the position and the closed trades those fills produced.
  // A person reading down went position, log, then the outcomes the log was
  // describing, so the two halves of one story were separated by the story
  // itself. Closed trades are the result and belong next to the position;
  // history is the record of how it got there and belongs under both.
  //
  // The newest event is the banner under the button, word for word, so it is
  // not printed twice: refreshEvents drops it from this list for as long as
  // the banner is carrying it.
  ui.evSec = tpEl(acct, "div", "tp-sec tp-region tp-hide");
  tpEl(ui.evSec, "div", "tp-sub", "History");
  ui.evList = tpEl(ui.evSec, "ul", "tp-events");

  // ── The standing prose, collected, and the two sentences that stay out of
  // the collapse.
  //
  // Everything this simulation will not model used to live inside a collapsed
  // <details> and nowhere else, which is the same as not saying it: an audit
  // asked whether what is not modelled is visible without opening something
  // nobody opens, and the answer was no. The long lists can stay collapsed,
  // because they are reference. These two are load-bearing and are on the
  // surface.
  //
  // THEY SIT HERE RATHER THAN UNDER THE BUTTON. The sentence about a closed
  // position is directly under the list of closed positions it is about, and
  // the explanation that used to be scattered across four places on the way
  // down the panel is now in one block with the disclosure it belongs to.
  const standing = tpEl(acct, "div", "tp-sec tp-region tp-standing");
  tpEl(standing, "div", "tp-always-l",
    "The money is not there. The prices, fees and funding are Hyperliquid's own; "
    + "the balance is not.");
  tpEl(standing, "div", "tp-always-l",
    "A closed position shows what it would have earned. Nobody earned it, and it "
    + "is not a track record.");

  buildDisclosure(standing);

  buildModals(root, ui);

  return { root, ui };
}

/** One modal sheet: a title, a body to fill, and a close control.
 *
 *  OVER THE PANEL, NOT OVER THE PAGE. Their modal covers their whole window.
 *  Ours covers the panel and nothing else, for the reason the panel itself is
 *  placed the way it is: this is a guest on somebody's trading page and it does
 *  not get to black out their chart to ask a question about a practice
 *  account. It is a child of the panel root rather than of the scrolling body,
 *  so it cannot be scrolled half out of view, and it is inside the panel so the
 *  one delegated click listener on the panel already reaches it.
 */
function tpSheet(host, name, title) {
  const sheet = tpEl(host, "div", "tp-sheet tp-hide");
  sheet.dataset.sheet = name;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", title);
  const head = tpEl(sheet, "div", "tp-sheet-h");
  tpEl(head, "div", "tp-sheet-t", title);
  const x = tpEl(head, "button", "tp-sheet-x", "Close");
  x.type = "button";
  x.dataset.act = "closesheet";
  return { sheet, body: tpEl(sheet, "div", "tp-sheet-b") };
}

/** The three panels the strip opens.
 *
 *  THE LEVERAGE ONE IS THEIRS, ELEMENT FOR ELEMENT AND IN THEIR ORDER: the
 *  title, the explanation line, a second explanation line only when the asset
 *  has more than one margin tier, a row holding the slider and a number box
 *  with a literal x after it, one alert line, and a confirm button. Read off
 *  their shipped bundle on 2026-09-23. Their own English for every line of it
 *  came from the message catalogue their app imports at runtime; the two
 *  sentences that are ours are marked where they are added, and they are added
 *  because this leverage is not sent anywhere.
 */
function buildModals(root, ui) {
  const host = tpEl(root, "div", "tp-modal tp-hide");
  ui.modal = host;

  // ── Adjust Leverage
  const lev = tpSheet(host, "leverage", "Adjust Leverage");
  ui.levSheet = lev.sheet;
  ui.levExpl = tpEl(lev.body, "p", "tp-sheet-p", "");
  // Only when the asset has more than one margin tier, which is 39 of the 234
  // perps listed and only above three million dollars of notional. The rule is
  // theirs: marginTiers.length > 1.
  ui.levTiers = tpEl(lev.body, "p", "tp-sheet-p tp-hide", "");
  const levRow = tpEl(lev.body, "div", "tp-lev-row");
  const levTrack = tpEl(levRow, "div", "tp-lev-track");
  // NO TICK MARKS. Their slider is rendered with dots switched off and its
  // value is the fraction across the track rounded to a whole number, so every
  // integer from 1 to the asset's maximum is reachable by dragging. The number
  // that looks like a tick interval in their code is a haptic milestone: it
  // decides when a phone buzzes, not where the handle can stop.
  ui.levRange = document.createElement("input");
  ui.levRange.type = "range";
  ui.levRange.className = "tp-lev-range";
  ui.levRange.min = "1";
  ui.levRange.max = "50";
  ui.levRange.step = "1";
  ui.levRange.value = "1";
  ui.levRange.dataset.f = "levrange";
  ui.levRange.setAttribute("aria-label", "Leverage");
  levTrack.appendChild(ui.levRange);
  // Two children and two columns. A third child here put the number box on a
  // row of its own under the slider, which is not their layout.
  const levBox = tpEl(levRow, "div", "tp-lev-box");
  ui.levNum = document.createElement("input");
  ui.levNum.type = "text";
  ui.levNum.inputMode = "numeric";
  ui.levNum.autocomplete = "off";
  ui.levNum.spellcheck = false;
  ui.levNum.dataset.f = "levnum";
  ui.levNum.setAttribute("aria-label", "Leverage");
  levBox.appendChild(ui.levNum);
  tpEl(levBox, "span", "tp-lev-x", "x");
  // Exactly one line, which is theirs: the risk sentence normally, and the
  // reduce-leverage sentence when the modal was opened by an order that could
  // not be placed at this leverage. They are two different message ids chosen
  // by that one flag, not one sentence under two names.
  ui.levAlert = tpEl(lev.body, "p", "tp-sheet-alert", "");
  ui.levOk = tpEl(lev.body, "button", "tp-sheet-ok", "Confirm");
  ui.levOk.type = "button";
  ui.levOk.dataset.act = "levok";
  // OURS, AND IT IS UNDER THE BUTTON RATHER THAN IN THEIR ALERT SLOT. Theirs
  // sends updateLeverage to the venue on confirm. This sends nothing at all,
  // and a control that looks exactly like one that changes an account has to
  // say which of the two it is.
  tpEl(lev.body, "p", "tp-sheet-foot",
    "Confirming changes the leverage this panel works in. Nothing is sent to "
    + "Hyperliquid and no account of yours is touched.");

  // ── Margin mode
  const mm = tpSheet(host, "margin", "Margin Mode");
  ui.mmSheet = mm.sheet;
  ui.mmBody = mm.body;
  tpEl(mm.body, "p", "tp-sheet-p",
    "Isolated is the mode this simulation runs, and it is not switchable here.");
  // WHY THE OTHER ONE IS NOT OFFERED, rather than a second card that does
  // nothing when it is pressed. paperSim solves a liquidation price from the
  // margin one position put up and from nothing else, which is the isolated
  // rule. Cross would have to solve it against the whole practice balance and
  // against every other position at once, and that is a change to the engine
  // rather than a label on this button.
  const mmList = tpEl(mm.body, "dl", "tp-sheet-dl");
  tpEl(mmList, "dt", null, "Isolated");
  tpEl(mmList, "dd", null,
    "Each position is backed by the margin it put up on its own. If that margin "
    + "runs out the position is liquidated, and the rest of the practice balance "
    + "is not pulled in to save it. Every liquidation price this panel shows is "
    + "worked that way.");
  tpEl(mmList, "dt", null, "Cross");
  tpEl(mmList, "dd", null,
    "All cross positions share one pool of collateral, so a loss on one is "
    + "carried by the balance backing the others. Working a liquidation price "
    + "under that rule means pricing every open position at once, which this "
    + "simulation does not do, so it is not offered rather than approximated.");
  tpEl(mm.body, "p", "tp-sheet-foot",
    "Their form starts an asset in cross. This row said Cross for the same "
    + "reason and the arithmetic under it was always isolated, so the word "
    + "changed rather than the sums.");

  // ── The practice account, which is where their third button's slot goes.
  const acct = tpSheet(host, "account", "Practice account");
  ui.acctSheet = acct.sheet;
  ui.acctBal = tpKv(acct.body, "Balance");
  ui.acctStart = tpKv(acct.body, "Started with");
  ui.acctHeld = tpKv(acct.body, "Margin on open positions");
  tpEl(acct.body, "p", "tp-sheet-p",
    "One account, kept in this extension's storage in this browser. It does not "
    + "sync to any device or account and nothing is sent anywhere. Clearing a "
    + "site's data does not erase it; the reset below or removing the extension does.");
  const reset = tpEl(acct.body, "button", "tp-sheet-ok tp-sheet-danger",
    "Reset practice account");
  reset.type = "button";
  reset.dataset.act = "reset";
  tpEl(acct.body, "p", "tp-sheet-foot",
    "Resetting closes every open position without recording it and puts the "
    + "balance back to where it started.");
}

/** One half of the footnote row under the order figures: a muted label and its
 *  value, side by side, several to a line. Not a tp-kv, which is a full-width
 *  row of their form and would put these two on two lines of their own. */
function tpMeta(parent, label) {
  const cell = tpEl(parent, "span", "tp-meta-c");
  tpEl(cell, "span", "tp-meta-k", label);
  return tpEl(cell, "span", "tp-meta-v", "");
}

/** The positions on every market except the one this page is on.
 *
 *  WHY IT EXISTS. The panel priced and showed exactly one position, the one
 *  belonging to the market in the URL. Somebody holding three saw one, and the
 *  other two were present only as a balance that read smaller than it should
 *  with nothing saying where the rest had gone.
 *
 *  WHY IT COLLAPSES. Their own interface collapses the parts of an account
 *  panel that are not about the trade in front of you, and this is that. The
 *  header is a <button> element, so it is reachable from the keyboard and carries
 *  aria-expanded, and the choice is stored under PAPER_OTHERS_KEY.
 *
 *  WHAT IS NOT HERE. No liquidation price and no ladder. Those are about
 *  managing a position, which is done on that position's own market, and this
 *  list is for deciding whether to go there. The row carries what that decision
 *  needs and stops.
 */
function buildOthers(parent, ui) {
  const sec = tpEl(parent, "div", "tp-sec tp-region tp-others tp-hide");
  ui.othersSec = sec;

  const head = tpEl(sec, "button", "tp-others-h");
  head.type = "button";
  head.dataset.act = "others";
  ui.othersHead = head;
  // The triangle is text so it inherits the type size and needs no asset. It
  // is aria-hidden because aria-expanded on the button already says which way
  // it points, and a screen reader announcing a glyph as well says it twice.
  ui.othersCaret = tpEl(head, "span", "tp-others-caret", "");
  ui.othersCaret.setAttribute("aria-hidden", "true");
  tpEl(head, "span", "tp-sub tp-others-t", "Other open positions");
  ui.othersCount = tpEl(head, "span", "tp-others-n", "");

  const body = tpEl(sec, "div", "tp-others-b");
  ui.othersBody = body;
  // THE SENTENCE THAT USED TO BE HERE IS IN THE DISCLOSURE.
  //
  // It read "Each figure is what closing that position now would realise.
  // Choosing a market takes this page to it." Both halves are standing
  // explanation rather than news: the first is the same claim the ladder and
  // the closed list already make about their own figures and it is made once,
  // in the disclosure, for all three; the second describes an affordance the
  // rows carry themselves, as underlined links with their own titles. With
  // nothing open on the market on screen this section was five lines of frame
  // around one line of fact, and this was two of the five.
  ui.othersList = tpEl(body, "ul", "tp-rest tp-others-l");
  // Only ever drawn when the engine hands over a total. See refreshOthers.
  //
  // TWO SPANS, BECAUSE ONLY THE FIGURE IS COLOURED. Painting the whole sentence
  // in the loss colour made a line of ordinary prose read as an alarm and put
  // it in competition with the figures on the rows above, which are the things
  // that are supposed to carry colour here. The words stay muted; the number is
  // the only part that is red or teal.
  ui.othersSum = tpEl(body, "div", "tp-others-sum tp-hide");
  ui.othersSumT = tpEl(ui.othersSum, "span", "tp-others-sum-t", "");
  ui.othersSumF = tpEl(ui.othersSum, "span", "tp-others-sum-f tp-hide", "");
  return sec;
}

// ── The levels, and the ladder they sit on ──────────────────────────────────
//
// THE FIVE THINGS A LADDER ROW CAN BE. The roles are positionLadder's own, so
// its rows land on these nodes by name. The order they are declared in is the
// order they are BUILT in and nothing else: every pass takes the engine's
// price-sorted list and sets `order` from it, which is the only thing that
// makes a short read correctly. Role never decides position.
const TP_RUNGS = [
  { role: "liquidation", label: "liquidation" },
  { role: "stop", label: "stop" },
  { role: "entry", label: "entry" },
  { role: "mark", label: "mark" },
  { role: "target", label: "take profit" },
];

/** A level field: their Size box, plus a Clear that is only there when there is
 *  something to clear. The message hangs under it rather than in a shared
 *  banner, so a refusal about the stop cannot be read as being about the
 *  target. */
function tpLevelField(parent, label, fname, place) {
  const wrap = tpEl(parent, "div", "tp-lvl-wrap");
  const box = tpEl(wrap, "div", "tp-field tp-lvl-field");
  tpEl(box, "span", "tp-field-k", label);
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = place;
  input.dataset.f = fname;
  input.setAttribute("aria-label", label + ", a price");
  box.appendChild(input);
  tpEl(box, "span", "tp-field-u", "USD");
  const clear = tpEl(box, "button", "tp-x tp-lvl-clear tp-hide", "Clear");
  clear.type = "button";
  clear.dataset.act = "lvlclear";
  clear.dataset.k = fname;
  const msg = tpEl(wrap, "div", "tp-lvl-msg tp-hide");
  // Whether what is in the box is what the engine holds, and if it is not, what
  // the ladder is actually showing. Muted, because it is a statement of state
  // rather than a refusal; the refusal above it has the sell colour.
  const state = tpEl(wrap, "div", "tp-lvl-state tp-hide");
  return { wrap, box, input, clear, msg, state };
}

/** The whole levels block: two fields, the ladder, and the sentences that say
 *  none of it is an order. Built once; every pass afterwards only writes text,
 *  toggles `tp-hide`, and sets `order` on nodes that already exist. */
function buildLevels(parent, ui) {
  const sec = tpEl(parent, "div", "tp-levels tp-hide");
  ui.levels = sec;
  // Which position the two fields below are about, and the way to change it.
  // Both are silent when there is one position and it is on the market on
  // screen, which is the ordinary case. See paperLevelTarget.
  ui.levelsWho = tpEl(sec, "div", "tp-lvl-who tp-hide");
  ui.levelsPick = tpEl(sec, "div", "tp-lvl-picks tp-hide");
  // NO HEADING OF ITS OWN. "Levels on this position" sat under "Practice
  // position in BTC" with the position stated between them, and the two
  // headings were about one thing. The position's heading covers both; what is
  // under it is the position's prices and the two fields that add to them.

  const ladder = tpEl(sec, "div", "tp-ladder");
  ui.ladder = ladder;

  const rungs = tpEl(ladder, "div", "tp-rungs");
  ui.rungs = {};
  for (const r of TP_RUNGS) {
    const row = tpEl(rungs, "div", `tp-rung tp-rung-${r.role} tp-hide`);
    const a = tpEl(row, "div", "tp-rung-a");
    tpEl(a, "span", "tp-rung-dot");
    tpEl(a, "span", "tp-rung-k", r.label);
    const px = tpEl(a, "span", "tp-rung-px", "");
    const b = tpEl(row, "div", "tp-rung-b");
    const d = tpEl(b, "span", "tp-rung-d", "");
    const pc = tpEl(b, "span", "tp-rung-pc", "");
    // The words that keep the money beside them hypothetical, on the row.
    const q = tpEl(b, "span", "tp-rung-q tp-hide");
    const rl = tpEl(b, "span", "tp-rung-r", "");
    // The engine's sentence about this row, when it has one that is about a
    // change to the row rather than a standing fact. Rendered verbatim.
    const note = tpEl(row, "div", "tp-rung-note tp-hide");
    ui.rungs[r.role] = { row, px, d, pc, q, rl, b, note };
  }

  // Why a row could not be priced, said once under the ladder rather than
  // squeezed into a cell 46px wide. Every row that carries no figure ends up
  // with a sentence here: the liquidation row's own note, which is about
  // exactly that, and for every other row the reason the schedule behind the
  // figure is missing. Identical sentences are said once.
  ui.ladderWhy = tpEl(sec, "div", "tp-lvl-why tp-hide");

  // NOT AN ORDER, SAID ABOVE THE TWO FIELDS THAT LOOK MOST LIKE ONE.
  //
  // It is one line rather than three. What the percentage on each rung is, and
  // what the money beside it includes, were another five lines here; they are
  // standing explanation rather than news, they were the same paragraph on
  // every render, and they are in the disclosure now with the rest of it. The
  // words that keep each figure hypothetical are on the rungs themselves.
  //
  // It stays ABOVE the fields. Under them, two open refusals pushed it off the
  // bottom of a 390 screen at exactly the moment somebody was deepest in
  // setting a level.
  tpEl(sec, "p", "tp-note tp-lvl-deny",
    "Marks of yours, not orders. Nothing rests at the venue and nothing here "
    + "triggers: the button above is the only thing that closes a position.");

  // "Take profit", not "Target". The engine calls it a take profit in every
  // refusal it writes, and a refusal reading "a take profit on a long goes
  // above the entry" pointing at a box labelled Target is the panel and its own
  // messages using two names for one thing. The engine's word wins, here and on
  // the rung above, because its refusals are the text a person reads hardest.
  ui.stopLvl = tpLevelField(sec, "Stop loss", "stop", "not set");
  ui.targetLvl = tpLevelField(sec, "Take profit", "target", "not set");
  return sec;
}

/** Static, so it is written once with innerHTML and then left alone. Nothing
 *  in here updates and nothing in here takes focus. */
function buildDisclosure(parent) {
  const d = tpEl(parent, "details", "tp-disc");
  // WHERE THE STANDING EXPLANATION WENT. Three paragraphs used to be printed on
  // every render, in three different places on the way down the panel: what the
  // percentage on a ladder rung is and what the money beside it includes, what
  // a figure on another market's row is, and what a resting order does here.
  // None of them is news, none of them changes, and all three are reference,
  // which is what this disclosure is for. The two sentences that are not
  // reference are above it and are never collapsed.
  d.innerHTML = `
    <summary>What this does not model, and what it refuses to guess</summary>
    <p class="tp-note">Everything priced here is Hyperliquid's own: the mark, the book,
    the fee schedule, the funding rates, the tick and lot sizes, the margin tiers. The
    money is the only thing that is not.</p>
    <p class="tp-sub2">What a money figure on this panel is</p>
    <p class="tp-note">Every one of them is what closing that whole position now,
    or at the price on the row, would realise: the ladder's rungs, the row for each
    position on another market, and the two boxes on the ticket. Each comes from the
    same function in the simulation, so no two of them can disagree. A market named
    on a row is a link and takes this page to it.</p>
    <p class="tp-sub2">The one percentage here that is not a price move</p>
    <p class="tp-note">Gain and Loss on the ticket are a return on your margin, the
    way Hyperliquid's own form works them: the price move multiplied by the leverage.
    At 20x a take profit 1% above where the order would fill reads 20%. Every other
    percentage on this panel, including every rung of the ladder, is the price move on
    its own. The two are kept apart by living in differently named places, and they are
    both correct.</p>
    <p class="tp-note">Gain and Loss are measured from the price this order would be
    filled at: the top of the book on the side you are buying or selling into, or your
    limit price on a limit order. Hyperliquid measures them from the mid instead, which
    on a market order is half a spread away from either. The touch is used here because
    it is what Order Value, Margin Required and the percentage slider on this ticket are
    already worked from, and two figures on one ticket disagreeing about what an order
    costs would be worse than the gap itself. Once the order fills, the ladder stops
    using either: every rung there is measured from what the position actually paid.</p>
    <p class="tp-sub2">Reading the ladder</p>
    <p class="tp-note">On each rung, the percentage is how far that price is from your
    entry, not a return on your margin: at 5x, a price 5% away from entry is 25% of the
    margin. The return on your margin is the ROE in brackets on the PNL row above, which
    is worked at the mark. The money is what closing the whole position at that price would realise,
    after the fee on the way in, the fee on the way out, and the funding charged so far.
    The PNL row is the move on its own, before those three, so it is the larger of the
    two and the mark rung here is the one to act on.
    The same figure on another market's row is that market's own mark worked the same
    way. Nothing on the ladder is an order, and a price reaching one of these levels
    closes nothing.</p>
    <p class="tp-sub2">Resting orders</p>
    <p class="tp-note">A resting order is not filled when the mark touches it. It fills
    only once the mark has gone clear through the level, and that is an assumption this
    panel is making, not something the public data settles. Queue position is not
    public.</p>
    <p class="tp-sub2">Refusals it does simulate</p>
    <ul class="tp-list">${REFUSALS_SIMULATED.map((s) => `<li>${pesc(s)}</li>`).join("")}</ul>
    <p class="tp-sub2">Not modelled</p>
    <ul class="tp-list">${NOT_MODELLED.map((s) => `<li>${pesc(s)}</li>`).join("")}</ul>
    <p class="tp-note">${pesc(REFUSALS_NOT_SIMULATED)}</p>
    <p class="tp-note">The difference between what a closed position above would have
    earned and what trading earns is the list you have just read.</p>
    <p class="tp-note">Positions and history are kept in this browser's local storage.
    They do not sync to any device or account, nothing is sent anywhere, and clearing
    site data erases them. The control that resets the account is in the Practice
    button at the top of the ticket, beside the leverage.</p>`;
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
  // Every open position priced, read once a tick and rendered from here, in
  // the shape written down above paperReadOtherPositions. null until the first
  // read answers, which is a different thing from an account holding nothing
  // and the section says which it is.
  others: null,
  othersOpen: true,
  // Every listed perp's own rules, keyed by coin, as assetSpecs returns them.
  // The closed list needs one asset's szDecimals per ROW and the rows span
  // whatever markets have been traded, so `paper.info`, which is the market on
  // screen, cannot price them: a row from another market printed at six places
  // and read as more precise than the venue can quote. null until the first
  // read answers, and a row whose coin is not in it says so rather than
  // pretending to a precision.
  specs: null,
  // Which position the leverage box was last seeded from, as coin plus the
  // instant it was opened plus the leverage it holds. The leverage is part of
  // the identity because adding to a position changes it under an unchanged
  // openedAt, and the ticket should follow the position it is about.
  levSeed: null,
  // What the person chose in the leverage modal, per market. Their app stores a
  // leverage per asset and so does this: a choice made on BTC must not follow
  // you to a market whose maximum is 3. In memory only, because a practice
  // leverage is not worth a second storage key and the venue default it falls
  // back to is the same number their form would show you anyway.
  levChoice: {},
  // Which sheet is over the panel, or null. One at a time.
  sheet: null,
  // The leverage being chosen inside the modal, before Confirm. `touched` is
  // their guard: opening the modal and confirming without moving anything
  // changes nothing at all, rather than writing the value back over itself.
  lev: { value: 1, touched: false, error: false },
  draft: {
    side: "buy", type: "market", size: "", px: "", leverage: "20",
    // Their Take Profit / Stop Loss checkbox and its two prices. Text, like the
    // position's own two fields, because what the person typed and what the
    // engine will accept are different things and the engine decides.
    tpslOn: false, tpPx: "", slPx: "",
    // The other half of each linked pair, and the unit both of them are in.
    // `tpslNtl` false is their `%`, true is their `$`. One setting for both
    // rows, which is theirs. In memory rather than stored: a practice unit
    // preference is not worth a storage key and the default is the useful one.
    tpGain: "", slLoss: "", tpslNtl: false,
    // Which unit the Size box is showing. The engine is always given the coin
    // amount; this only decides what the box displays and what it accepts.
    sizeUnit: "coin",
    postOnly: false, reduceOnly: false,
    // The two level fields. Text, not numbers, because they are what the person
    // typed and the engine is what turns that into a price or a refusal.
    stop: "", target: "",
  },
  // Which position the two level fields were last seeded from, as coin plus the
  // instant it was opened. A position that is closed and a new one opened is a
  // different position and gets its own empty fields; a level committed onto the
  // one already there does not re-seed, so a commit cannot fight the typing.
  levelSeed: null,
  // Which open position the stop and take profit fields are pointing at, when
  // more than one is open and the person has chosen. null means "work it out",
  // which is the market on screen if it holds one and the first open position
  // otherwise. See paperLevelTarget.
  levelCoin: null,
  // Which position, and which of its marks, the ticket's two level boxes were
  // last filled from. The prices are part of the identity because clearing a
  // mark from the position's own field has to reload the ticket. See
  // seedTicketLevels.
  tpslSeed: null,
};

/** Does this content script still have a live extension behind it?
 *
 *  Asked only after a save has already failed, which matters: the injection
 *  harness shims chrome.runtime with a getURL and no id, so this would report
 *  an orphan on every headless run if it were asked unconditionally.
 */
function paperRuntimeAlive() {
  try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
  catch (e) { return false; }
}

/** Whether the practice account is being saved, and if it is not, WHICH of the
 *  two different failures it is, because they have different remedies.
 *
 *  A user's panel read: "This browser is not storing the practice account, so
 *  everything below is lost on reload. Extension context invalidated."
 *
 *  That diagnosis is wrong. "Extension context invalidated" is not a browser
 *  refusing to store anything. It is what every chrome.* call throws inside a
 *  content script whose extension was reloaded, updated or disabled while the
 *  page stayed open: this page is running an orphaned copy of this file and its
 *  handles are dead. Nothing is wrong with the browser and nothing about it
 *  needs changing, and the fix, reloading the page, is not the one the sentence
 *  implies. Naming the wrong thing and pointing at the wrong remedy is the same
 *  defect as an absence with no reason, one step further on.
 *
 *  The account saved before the orphaning is untouched on disk, which is the
 *  part worth saying: what is at risk is only what has happened since.
 */
function paperSaveState() {
  let store = { ok: true, reason: null };
  try { store = storageStatus(); } catch (e) { /* older engine: assume it saves */ }
  if (store.ok) return { ok: true, orphaned: false, message: "" };
  const reason = String(store.reason || "");
  const orphaned = /context invalidated/i.test(reason) || !paperRuntimeAlive();
  return {
    ok: false,
    orphaned,
    message: orphaned
      ? "The extension was reloaded or updated while this page was open, so this "
        + "page is running an old copy of it that can no longer save anything. "
        + "Nothing done here from now on is being kept, and no order will be "
        + "accepted while that is true. Reload the page: the practice account as "
        + "it stood before this is still saved and comes back with it."
      : "This browser is not storing the practice account, so everything below is "
        + "lost on reload. " + (reason || "No reason was given."),
  };
}

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

// The maximum the leverage control runs to before this market's rules have
// been read. Theirs uses the same number in the same place: the modal falls
// back to 50 when the asset is not in the universe it holds. It is a fallback
// and not a claim, which is why paperLeverageNote still exists: a number chosen
// against 50 and then measured against a market whose maximum is 3 is a
// substitution, and substitutions here are said out loud.
const PAPER_LEV_FALLBACK_MAX = 50;

// What a market starts at when nothing has been chosen and nothing is open.
//
// VERIFIED AGAINST THE LIVE API, NOT TAKEN FROM THE BUNDLE. The shipped bundle
// reads `leverage ?? { type: cross, value: universe[i].maxLeverage ?? 20 }`,
// which says a new market starts at the asset's maximum. That branch only
// fires when activeAssetData has not answered. It always answers, and what it
// returns is min(20, maxLeverage). Swept over the info endpoint on 2026-09-23
// with an address holding nothing, for every distinct maximum in the universe:
//
//     PURR  max 3   default 3      HYPE   max 10  default 10
//     ATOM  max 5   default 5      SOL    max 20  default 20
//     kPEPE max 10  default 10     ETH    max 25  default 20
//                                  BTC    max 40  default 20
//
// BTC and ETH are the only two assets above 20, so that is exhaustive over the
// cases where the two rules disagree. Building the bundle's rule would open BTC
// at 40x by default, twice what a new user is actually given.
//
// Ours seeded 1x, which is not on their form anywhere except spot, where
// everything is 1x. That is almost certainly where it came from.
function paperVenueDefaultLeverage(max) {
  return Math.max(1, Math.min(20, max));
}

/** The maximum this market allows, or the fallback while it is unread. */
function paperLeverageMax() {
  const known = paper.info && paper.info.coin === paper.coin;
  const m = known ? Number(paper.info.maxLeverage) : NaN;
  return isFinite(m) && m >= 1 ? Math.floor(m) : PAPER_LEV_FALLBACK_MAX;
}

/** The leverage the order will actually be placed at.
 *
 *  A WHOLE NUMBER, because the venue's leverage control takes whole numbers
 *  from 1 to the asset's maximum and this panel's control is a copy of that
 *  one. It is also what the engine's ticketLeverage produces when it seeds this
 *  from a position that was added to: the position runs at 17.105...x and the
 *  control is set to 17, which is the nearest thing it expresses without
 *  proposing more risk than is already on.
 */
function paperLeverage() {
  const max = paper.info ? paper.info.maxLeverage : PAPER_LEV_FALLBACK_MAX;
  const n = parseInt(paper.draft.leverage, 10);
  return Math.max(1, Math.min(isFinite(n) ? n : 1, max));
}

/** The sentence to show when the leverage that will be used is not the one the
 *  control is set to, or null when they agree.
 *
 *  WHAT THE SLIDER TOOK AWAY. This used to carry four sentences, one for each
 *  way a typed number could fail: not a number at all, above the market's
 *  maximum, under 1, and fractional. A slider that runs 1 to the market's own
 *  maximum in whole steps cannot produce any of the four, and the modal's
 *  number box ignores anything outside the range instead of storing it, so all
 *  four are gone with the typing that caused them.
 *
 *  ONE CASE IS LEFT AND IT IS NOT ABOUT TYPING. The control is opened against a
 *  fallback maximum of 50 while this market's rules are still unread, and the
 *  venue lowers an asset's maximum from time to time. Either way a leverage
 *  already chosen, or already carried by an open position, can end up above
 *  what the market allows now, and the substitution still has to be said. */
function paperLeverageNote() {
  const raw = String(paper.draft.leverage || "").trim();
  const used = paperLeverage();
  const n = parseFloat(raw);
  if (raw === "" || !isFinite(n)) {
    return `No leverage is set, so this will be placed at ${used}x.`;
  }
  const max = (paper.info && paper.info.coin === paper.coin)
    ? paper.info.maxLeverage : null;
  if (max != null && n > max) {
    return `${paper.coin || "This market"} allows at most ${max}x, so ${n}x will be `
      + `placed as ${max}x. Every figure below is ${max}x arithmetic.`;
  }
  return null;
}

// ── The sheets the strip opens ──────────────────────────────────────────────

/** Open one of the three, or the leverage one in its error state.
 *
 *  `error` is their showLeverageError. It swaps the single alert line for the
 *  one about reducing leverage and is set by the order path, not by the button.
 */
function openSheet(name, error) {
  paper.sheet = name;
  if (name === "leverage") {
    // The modal opens holding what the ticket holds, which is theirs:
    // useState(leverage). `touched` starts false so a confirm that moved
    // nothing writes nothing.
    // `error` is the sentence, not a flag: it is what goes in their single
    // alert slot in place of the standing one. Coercing it to a boolean here
    // printed the word "true" over the modal.
    paper.lev = { value: paperLeverage(), touched: false, error: error || null };
  }
  refresh();
  // Focus goes to the control the sheet is about, so a keyboard reaches the
  // slider without tabbing through the ticket behind it.
  const first = (paper.ui && paper.sheet === "leverage") ? paper.ui.levRange : null;
  if (first && typeof first.focus === "function") first.focus();
}

/** Put every sheet away and empty the leverage one, without rendering.
 *
 *  BLANKED ON THE WAY OUT, NOT LEFT LOADED. refreshSheets only writes into a
 *  sheet that is open, so a closed leverage sheet kept the last market's
 *  maximum, its tier line and its slider bound sitting in the DOM. A market
 *  change closes the sheet, so what was parked there was the wrong asset's
 *  rules, ready to be shown for the frame before the next render replaced them.
 */
function clearSheet() {
  paper.sheet = null;
  paper.lev = { value: 0, touched: false, error: null };
  const ui = paper.ui;
  if (!ui || !ui.levExpl) return;
  setText(ui.levExpl, "");
  setText(ui.levTiers, "");
  setShown(ui.levTiers, false);
  setText(ui.levAlert, "");
  ui.levAlert.classList.remove("tp-alert-err");
  setVal(ui.levNum, "");
}

function closeSheet() {
  clearSheet();
  refresh();
}

/** Their `v`, which is the whole rule for what the control accepts.
 *
 *      v = e => { e === undefined ? d(0) : (e >= 0 && e <= m && d(Math.round(e))) }
 *
 *  Three things fall out of it and all three are copied:
 *
 *   - Whole numbers only, by Math.round and not by truncation. 2.6 becomes 3.
 *   - OUT OF RANGE IS IGNORED, NOT CLAMPED. 999 on a market whose maximum is 40
 *     leaves the value where it was; it does not become 40. The box then shows
 *     the value again on the next write, so typing 999 on BTC bounces back to
 *     whatever was there rather than settling on 40.
 *   - Clearing the box is 0, which is reachable and is the only way to reach it:
 *     the slider's own minimum is 1. Confirm is disabled there.
 */
function setLeverageChoice(raw) {
  const max = paperLeverageMax();
  paper.lev.touched = true;
  const t = String(raw == null ? "" : raw).trim();
  if (t === "") { paper.lev.value = 0; return; }
  const n = Number(t);
  if (!isFinite(n)) return;
  if (n >= 0 && n <= max) paper.lev.value = Math.round(n);
}

/** Confirm, which on their form dispatches updateLeverage and here writes one
 *  local number.
 *
 *  THE NO-OP GUARD IS THEIRS. Opening the modal and pressing Confirm without
 *  moving anything closes it and changes nothing, so a person who opened it to
 *  read the maximum does not come out of it having pinned a choice. That
 *  matters more here than there: pinning a choice stops this market's control
 *  following the position that is open on it.
 */
function confirmLeverage() {
  const v = Number(paper.lev.value);
  if (!(v > 0)) return;                       // their disabled condition
  const unchanged = !paper.lev.touched || String(v) === String(paper.draft.leverage);
  if (!unchanged) {
    paper.draft.leverage = String(v);
    paper.levChoice[paper.coin] = v;
  }
  closeSheet();
}

// ── The Size box's unit ─────────────────────────────────────────────────────

/** What the unit button reads: the coin, or USD. */
function sizeUnitLabel() {
  return paper.draft.sizeUnit === "usd" ? "USD" : (paper.coin || "");
}

/** The coin amount behind whatever is in the box.
 *
 *  paper.draft.size is ALWAYS the coin amount, because every reader of it is:
 *  decideOrder, the preview, the percentage slider and sizeComplaint. The unit
 *  only decides what the box shows and what it accepts, and this is the single
 *  place the two meet.
 *
 *  Text that is not a number is passed through unchanged rather than turned
 *  into an empty string, so sizeComplaint still gets to say that "abc" is not a
 *  number instead of "enter a size first".
 */
function coinSizeFrom(text) {
  if (paper.draft.sizeUnit !== "usd") return text;
  const t = String(text == null ? "" : text).trim();
  if (t === "") return "";
  const n = Number(t);
  if (!isFinite(n)) return t;
  const px = paperRefPx();
  if (!px || !paper.info) return "";
  const sz = roundSize(n / px, paper.info.szDecimals);
  return sz > 0 ? sz.toFixed(paper.info.szDecimals) : "";
}

/** The other direction, for writing the box from a coin amount. */
function usdSizeFrom(coinText) {
  const t = String(coinText == null ? "" : coinText).trim();
  if (t === "") return "";
  const n = Number(t);
  const px = paperRefPx();
  if (!isFinite(n) || !px) return t;
  return String(Math.round(n * px * 100) / 100);
}

/** Write the Size box and the coin amount behind it together.
 *
 *  `force` is for the two deliberate writes that follow a click of the person's
 *  own: clearing the ticket after a fill, and the reset. Everything else goes
 *  through setVal and leaves a focused field alone, which is the rule the whole
 *  render path is built on.
 */
function setSizeField(coinText, force) {
  paper.draft.size = coinText;
  const shown = paper.draft.sizeUnit === "usd" ? usdSizeFrom(coinText) : coinText;
  if (!paper.ui) return;
  if (force) paper.ui.size.input.value = shown;
  else setVal(paper.ui.size.input, shown);
}

/** The notional above which the chosen leverage cannot be held, or null.
 *
 *  Theirs, unchanged: the first margin tier whose own maximum is below the
 *  leverage being chosen gives the notional its lower bound sits at. Only 39 of
 *  the 234 perps listed have more than one tier and the lowest bound among them
 *  is three million dollars, so on a ten thousand dollar practice account this
 *  is a line of explanation rather than a limit anybody meets.
 */
function paperTierBound(chosen) {
  const known = paper.info && paper.info.coin === paper.coin;
  const tiers = known && Array.isArray(paper.info.marginTiers)
    ? paper.info.marginTiers : null;
  if (!tiers || !chosen) return null;
  for (const t of tiers) {
    if (Number(t.maxLeverage) < chosen) return Number(t.lowerBound);
  }
  return null;
}

function refreshSheets() {
  const ui = paper.ui;
  if (!ui || !ui.modal) return;
  const open = paper.sheet;
  // THE HEADER IS NEVER COVERED, and its height is measured rather than
  // guessed: the sentence saying the money is not there is present in every
  // state, and a modal drawn from the top of the panel would be the one state
  // where it is not. Measured on the way in, because the sentence wraps to two
  // lines when the column is dragged narrow.
  if (open) {
    const h = ui.head ? Math.round(ui.head.getBoundingClientRect().height) : 0;
    if (h > 0) ui.modal.style.top = h + "px";
  }
  setShown(ui.modal, !!open);
  setShown(ui.levSheet, open === "leverage");
  setShown(ui.mmSheet, open === "margin");
  setShown(ui.acctSheet, open === "account");
  if (open === "leverage") refreshLeverageSheet();
  if (open === "account") refreshAccountSheet();
}

/** Their modal's contents, in their order and in their words.
 *
 *  The English is theirs: every line of their interface is a message id
 *  resolved at runtime from a catalogue their app imports as a separate module,
 *  and these are the strings behind the ids the modal uses. The sentence under
 *  the button is ours, because theirs sends the choice to the venue and this
 *  one does not.
 */
function refreshLeverageSheet() {
  const ui = paper.ui;
  const max = paperLeverageMax();
  const coin = paper.coin || "this market";
  const v = Number(paper.lev.value) || 0;

  setText(ui.levExpl,
    `Control the leverage used for ${coin} positions. The maximum leverage is ${max}x.`);

  const known = paper.info && paper.info.coin === paper.coin;
  const tiers = known && Array.isArray(paper.info.marginTiers)
    ? paper.info.marginTiers : null;
  const tiered = !!(tiers && tiers.length > 1);
  const bound = tiered ? paperTierBound(v) : null;
  setText(ui.levTiers, tiered
    ? "Max position size decreases the higher your leverage."
      + (bound != null
        ? ` The max position size for ${v}x leverage on ${coin} is ${pmoney(bound)}.`
        : "")
    : "");
  setShown(ui.levTiers, tiered);

  ui.levRange.max = String(max);
  // The slider cannot reach 0; only clearing the number box can, and it parks
  // the handle at the minimum while the value it carries is 0.
  setVal(ui.levRange, String(Math.max(1, Math.min(v || 1, max))));
  setVal(ui.levNum, v ? String(v) : "");

  const alert = paper.lev.error
    ? String(paper.lev.error)
    : "Note that setting a higher leverage increases the risk of liquidation.";
  setText(ui.levAlert, alert);
  ui.levAlert.classList.toggle("tp-alert-err", !!paper.lev.error);
  ui.levOk.disabled = v === 0;
}

function refreshAccountSheet() {
  const ui = paper.ui;
  const st = paper.state;
  setText(ui.acctBal, st ? pmoney(st.balance) : "not loaded yet");
  setText(ui.acctStart, typeof STARTING_BALANCE === "number"
    ? pmoney(STARTING_BALANCE) : "not read");
  let held = 0;
  let n = 0;
  for (const k of Object.keys((st && st.positions) || {})) {
    const m = Number(st.positions[k].margin) || 0;
    if (m > 0) { held += m; n += 1; }
  }
  setText(ui.acctHeld, n
    ? `${pmoney(held)} on ${n === 1 ? "1 position" : n + " positions"}`
    : "none");
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

/** What the ticket's two level boxes would do, asked of the position this order
 *  would leave behind.
 *
 *  THE POSITION DOES NOT EXIST YET, WHICH IS THE WHOLE PROBLEM. A stop belongs
 *  to a position, so setPositionLevel refuses when there is none, and checking
 *  the boxes against the live state would therefore always refuse. The fill is
 *  applied to a COPY of the state first, by the same applyFill the order itself
 *  runs, and the levels are then run against that copy by the same
 *  setPositionLevel the position's own fields use. Nothing about the rules is
 *  restated here: the side the stop belongs on, the venue's price grid, and
 *  whether the stop sits past the liquidation price are all the engine's, one
 *  step earlier than usual.
 *
 *  The stop is checked first and its result is left on the copy, so the take
 *  profit is judged against a position that already carries the stop, which is
 *  the order the two are actually written in.
 */
function paperTicketLevels() {
  const out = {
    probe: null, pos: null, stop: null, target: null, refusal: null,
    // What the position ALREADY carries, and whether each box is asking to
    // change it. See the overwrite note below.
    held: { stop: null, target: null },
    want: { stop: null, target: null },
  };
  if (!paper.draft.tpslOn) return out;
  const live = (paper.state && paper.coin) ? paper.state.positions[paper.coin] : null;
  for (const which of ["stop", "target"]) {
    const v = live ? Number(live[which === "stop" ? "stopPx" : "targetPx"]) : NaN;
    out.held[which] = isFinite(v) && v > 0 ? v : null;
  }

  // WHAT COUNTS AS A REQUEST, WHICH IS THE WHOLE OF THE OVERWRITE FIX.
  //
  // THE DEFECT. The boxes started empty and whatever was in them was written
  // over the position on every fill. Somebody who had set a stop at 83,079 and
  // a take profit at 88,921, then typed new prices for a routine add with the
  // box still ticked, ended with 84,044 and 92,309 and was told only the new
  // pair. Two marks they had set were destroyed with nothing said before and
  // nothing said after. That is the same class of defect as a zero standing in
  // for a reading: the panel lost something and reported success.
  //
  // THE FIX IS BY CONSTRUCTION RATHER THAN BY WARNING. The boxes are now
  // seeded from the marks the position already holds, so the ordinary case,
  // placing an add without touching them, asks for nothing. Two rules fall out
  // and both are here rather than at the call sites:
  //
  //   - A price EQUAL to the mark already held is a no-op. It is not checked
  //     and it is not written, so an add whose new entry would have made the
  //     old mark unplaceable cannot be blocked by a level nobody re-typed.
  //   - AN EMPTY BOX NEVER REMOVES A MARK. Empty means "do not set one with
  //     this order". Clearing a level is a deliberate act with its own Clear
  //     button on the position's own field, and the ticket does not get a
  //     second, silent way to do it.
  //
  // So the ticket can add a mark or deliberately change one, and cannot lose
  // one. A change is still a change, and the outcome names what it replaced.
  for (const which of ["stop", "target"]) {
    const raw = which === "stop" ? paper.draft.slPx : paper.draft.tpPx;
    const v = levelInput(raw);
    if (v.clear) continue;
    if (out.held[which] != null && Number(v.n) === out.held[which]) continue;
    out.want[which] = v.n;
  }

  const d = paperPreview();
  if (!d || !d.ok || d.kind !== "fill" || !paper.info || !paper.coin) return out;
  const probe = paperStateProbe();
  if (!probe) return out;
  try { applyFill(probe, paper.info, d.fill); } catch (e) { return out; }
  if (!probe.positions[paper.coin]) return out;
  out.probe = probe;
  out.pos = probe.positions[paper.coin];
  // Only what is actually being asked for is put to the engine. The stop goes
  // first and its result stays on the copy, so the take profit is judged
  // against a position that already carries it.
  for (const which of ["stop", "target"]) {
    if (out.want[which] == null) continue;
    out[which] = levelDecision(which, String(out.want[which]), probe, paper.coin, paper.info);
  }
  out.refusal = (out.stop && out.stop.ok === false) ? out.stop
    : ((out.target && out.target.ok === false) ? out.target : null);
  return out;
}

/** The price the ticket's gain and loss are measured from.
 *
 *  THEIRS IS THE MID FOR A MARKET ORDER AND THE LIMIT PRICE FOR A LIMIT ORDER,
 *  read off their bundle: `baseline: isLimit(orderType) ? Number(limitPx) : mid`
 *  where `mid` is the coin's entry in their allMids map.
 *
 *  OURS IS THE TOUCH, NOT THE MID, AND THAT IS A DELIBERATE DIFFERENCE. This
 *  simulation walks the visible book: a market buy is priced from the best ask
 *  and pays worse as it takes depth. Quoting a gain from the mid would measure
 *  it against a price no order here is filled at, and the panel would print a
 *  figure off by half the spread on every market order before the size is even
 *  typed. paperRefPx is the price the rest of this file already prices an order
 *  against, so the gain, the Order Value row and the preview all agree.
 *
 *  Once the order fills the marks stop being measured from here at all: the
 *  ladder works every rung from the position's own entry, which is the average
 *  the fill actually paid.
 */
function tpslBaseline() {
  const px = paperRefPx();
  return isFinite(px) && px > 0 ? px : null;
}

/** Whether this row's price sits below the baseline rather than above it.
 *
 *  Theirs: the gain row is `inverse: !isBuy` and the loss row is `inverse:
 *  isBuy`. So on a buy the gain is above and the loss below, and a sell inverts
 *  both, which is the same rule the engine already applies to a stop and a take
 *  profit on a short.
 */
function tpslInverse(which) {
  const buy = paper.draft.side === "buy";
  return which === "target" ? !buy : buy;
}

/** Their Vp: the gain or the loss implied by a price.
 *
 *      isNtl ? sz * (price - baseline)
 *            : (price / baseline - 1) * leverage * 100
 *      then negated on the inverse row, then floored to two places.
 *
 *  THE PERCENT IS A RETURN ON MARGIN, NOT A PRICE MOVE, because the leverage is
 *  in it. That is theirs and it is worth stating twice: every OTHER percentage
 *  on this panel is a price move, the ladder says so on every rung and the
 *  disclosure explains it. This one is the other kind, which is why its box is
 *  labelled Gain and Loss rather than with a percent of anything.
 */
function tpslGainFromPrice(which, priceText) {
  const base = tpslBaseline();
  const px = Number(String(priceText).trim().replace(/,/g, ""));
  if (base == null || !isFinite(px) || px <= 0) return null;
  const ntl = !!paper.draft.tpslNtl;
  let v;
  if (ntl) {
    const sz = Number(paper.draft.size);
    if (!isFinite(sz) || sz <= 0) return null;   // their "Must specify order size"
    v = sz * (px - base);
  } else {
    v = (px / base - 1) * paperLeverage() * 100;
  }
  if (tpslInverse(which)) v *= -1;
  if (!isFinite(v)) return null;
  return Math.floor(v * 100) / 100;
}

/** The same relation the other way round, which is their P.
 *
 *      isNtl ? baseline +/- value / sz
 *            : baseline * (1 +/- value / leverage / 100)
 *
 *  ROUNDED ONTO THE VENUE'S GRID, as theirs is: they floor the computed price
 *  with the same rounder their order form checks a limit price against. A price
 *  the asset cannot quote would be refused by setPositionLevel a moment later,
 *  and offering it as the answer to a number somebody just typed would be the
 *  panel proposing something it is about to reject.
 */
function tpslPriceFromGain(which, gainText) {
  const base = tpslBaseline();
  const t = String(gainText).trim().replace(/,/g, "");
  if (base == null || t === "") return null;
  const v = Number(t);
  if (!isFinite(v)) return null;
  const inv = tpslInverse(which);
  let px;
  if (paper.draft.tpslNtl) {
    const sz = Number(paper.draft.size);
    if (!isFinite(sz) || sz <= 0) return null;
    px = inv ? base - v / sz : base + v / sz;
  } else {
    const n = v / paperLeverage() / 100;
    px = inv ? base * (1 - n) : base * (1 + n);
  }
  if (!isFinite(px) || px <= 0) return null;
  const szd = (paper.info && paper.info.coin === paper.coin) ? paper.info.szDecimals : null;
  if (szd == null) return null;
  const onGrid = roundPrice(px, szd);
  return isFinite(onGrid) && onGrid > 0 ? onGrid : null;
}

/** Which of their three "this row cannot be used yet" sentences applies, or
 *  null. Theirs are literals in their bundle rather than catalogue ids, so
 *  these are ours, in the register the rest of this panel's absences use: each
 *  one says WHICH thing is missing rather than printing a blank row. */
function tpslBlocked() {
  const base = tpslBaseline();
  const sz = Number(paper.draft.size);
  const needSize = !!paper.draft.tpslNtl && !(isFinite(sz) && sz > 0);
  if (base == null && needSize) {
    return "A size and a price to measure from are both still missing, so neither "
      + "of these can be worked out yet.";
  }
  if (base == null) {
    return paper.draft.type === "limit"
      ? "Enter a limit price above, and these are measured from it."
      : "There is no price to measure from until the book has been read.";
  }
  if (needSize) {
    return "In dollars these need a size, because the figure is what the whole "
      + "position would make. The percentage does not.";
  }
  return null;
}

/** Put the marks the position already carries into the ticket's two boxes.
 *
 *  Seeded on a change of position rather than on every pass, the same rule the
 *  position's own two fields follow, and never under the cursor. The token
 *  carries the two prices as well as the position's identity, so clearing a
 *  mark from the fields below reloads the ticket rather than leaving it holding
 *  a price that is no longer set.
 */
function seedTicketLevels() {
  const ui = paper.ui;
  if (!ui || !ui.tpTicket) return;
  const pos = (paper.state && paper.coin) ? paper.state.positions[paper.coin] : null;
  const token = pos
    ? `${paper.coin}:${pos.openedAt}:${pos.stopPx}:${pos.targetPx}`
    : `${paper.coin}:none`;
  if (paper.tpslSeed === token) return;
  const els = { stop: ui.slTicket.input, target: ui.tpTicket.input };
  if (document.activeElement === els.stop || document.activeElement === els.target) return;
  paper.tpslSeed = token;
  for (const which of ["stop", "target"]) {
    const v = pos ? Number(pos[which === "stop" ? "stopPx" : "targetPx"]) : NaN;
    const text = isFinite(v) && v > 0 ? String(v) : "";
    if (which === "stop") paper.draft.slPx = text; else paper.draft.tpPx = text;
    els[which].value = text;
    // The companion follows the price it belongs to. refreshTicketLevels writes
    // it too, but only while the block is showing, and the seeding happens
    // whether or not the box is ticked.
    const g = tpslGainFromPrice(which, text);
    const gt = text === "" || g == null ? "" : String(g);
    if (which === "stop") { paper.draft.slLoss = gt; ui.slTicket.gain.value = gt; }
    else { paper.draft.tpGain = gt; ui.tpTicket.gain.value = gt; }
  }
}

/** The two ticket boxes: the engine's refusal under each, and what closing the
 *  whole position at that price would realise beside it. */
function refreshTicketLevels() {
  const ui = paper.ui;
  const t = paperTicketLevels();
  const blocked = tpslBlocked();
  for (const which of ["target", "stop"]) {
    const f = which === "target" ? ui.tpTicket : ui.slTicket;
    const pk = which === "target" ? "tpPx" : "slPx";
    const gk = which === "target" ? "tpGain" : "slLoss";
    const d = t[which];
    const bad = !!(d && d.ok === false);
    // The row cannot be used at all before there is something to measure from,
    // which is theirs: they disable both inputs and put the reason in a
    // tooltip. Ours says it in the line that is already under the row, because
    // a tooltip on a panel this size is a sentence nobody finds.
    setText(f.msg, bad ? d.message + (d.detail ? " " + d.detail : "") : (blocked || ""));
    setShown(f.msg, bad || !!blocked);
    f.msg.classList.toggle("tp-lvl-wait", !bad && !!blocked);
    f.box.classList.toggle("tp-lvl-bad", bad);
    f.gain.disabled = !!blocked;
    f.unit.disabled = false;   // switching the unit is how one of the blocks is cleared

    // THE COMPANION IS PUT BACK IN AGREEMENT WHEN THE CARET LEAVES IT. Theirs
    // recomputes the gain from the price whenever the gain field is not the
    // focused one, so a price that was floored onto the grid ends up quoted by
    // a gain that matches the price actually held rather than the one asked
    // for. Nothing is written into a field that has focus.
    if (document.activeElement !== f.gain) {
      const g = tpslGainFromPrice(which, paper.draft[pk]);
      const text = String(paper.draft[pk]).trim() === "" || g == null ? "" : String(g);
      if (paper.draft[gk] !== text) paper.draft[gk] = text;
      setVal(f.gain, text);
    }
  }
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

// ── What this file uses from paperSim.js for levels ─────────────────────────
//
// THE SHAPE, WRITTEN DOWN BECAUSE IT IS A CONTRACT ACROSS TWO FILES and this
// side of it is only a renderer. Read off paperSim.js, not assumed:
//
//   state.positions[coin].stopPx / .targetPx
//       the two marks, or null. Written only by the two functions below.
//
//   setPositionLevel(state, info, coin, which, px)   which is "stop"|"target"
//       Writes the level and returns { ok: true, which, px, side, markPassed,
//       note, at }, or a refusal in the shape every other refusal in that file
//       uses: { ok: false, code, message, detail, at }. It owns every rule
//       about where a level may sit: the venue's price grid, which side of
//       entry it belongs on, and whether a stop is past the liquidation price.
//       NONE of those rules is repeated here. The panel shows a refusal by
//       running this against a COPY of the state before the commit and the
//       live state at the commit, so the message and the outcome are the same
//       function answering twice and cannot disagree.
//
//   clearPositionLevel(state, coin, which)
//       The other half, and independent of the one it is not clearing.
//
//   positionLadder(pos, info, fees, markPx)
//       Every price belonging to the position, SORTED BY PRICE ASCENDING, as
//       { role, px, pxChangePct, value, markPassed, stale, note }. role is one
//       of liquidation, stop, entry, mark, target. `value` is closeValueAt's
//       object, whose `realises` is the figure the ladder prints, or null when
//       the engine will not put a figure on that price. The sort is the
//       engine's and it is what makes a short come out right. Rows are drawn in
//       the order it returns them, lowest price at the top, and this file does
//       no ordering of its own: not by role, and not by reversing either.
//
//   closeValueAt(pos, info, fees, px)
//       The same figure for one price. positionLadder already carries it on
//       every rung, and the mark rung IS the "if closed now" figure, so this
//       file no longer calls it a second time for a line of its own: one
//       quantity, one call site, and no chance of two numbers under one label.
//
//   LEVEL_PASSED_NOTE / LEVEL_STALE_NOTE / LIQUIDATION_UNPRICED_NOTE
//       The sentences for the three things a row can be. Rendered verbatim;
//       positionLadder already attaches the right one to the right row.

/** A copy of the state deep enough that setPositionLevel can be run against it
 *  as a question rather than as an instruction. Same trick marginShortfall
 *  uses: ask the engine what it would do by letting it do it, to a copy. */
function paperStateProbe() {
  const s = paper.state;
  if (!s) return null;
  const positions = {};
  for (const k of Object.keys(s.positions || {})) positions[k] = { ...s.positions[k] };
  return { ...s, positions, resting: (s.resting || []).slice(),
           closed: (s.closed || []).slice(), events: (s.events || []).slice() };
}

/** The text of a level field as either a clear or a price. Grouping is stripped
 *  because the field echoes prices back and 81,200 is what a person retypes. */
function levelInput(raw) {
  const t = String(raw == null ? "" : raw).trim().replace(/,/g, "");
  return t === "" ? { clear: true } : { clear: false, n: Number(t), raw: t };
}

/** Ask the engine what this level would do, against `state`. Pass the probe to
 *  preview, the live state to commit. null when there is nothing to decide.
 *
 *  THE MARKET IS AN ARGUMENT NOW, NOT paper.info. This read the market on
 *  screen and the position on it, which is exactly the assumption that left a
 *  BTC position's stop unreachable from SOL. It takes the coin and that
 *  market's rules, so the same engine call answers for a position anywhere. */
function levelDecision(which, raw, state, coin, info) {
  if (!state || !info || !coin || !state.positions[coin]) return null;
  const v = levelInput(raw);
  if (v.clear) return null;
  try {
    return setPositionLevel(state, info, coin, which, v.n);
  } catch (e) {
    return { ok: false, message: "The simulation could not take that level.",
      detail: paperErrorText(e) };
  }
}

/** Which position the stop and the take profit fields are about.
 *
 *  THE DEFECT THIS EXISTS TO FIX. The levels block was drawn only when the
 *  market on screen had a position on it. Somebody holding BTC and looking at
 *  SOL was shown nothing at all: no stop, no take profit, no ladder, and no
 *  sign that any of it existed somewhere else. Holding a position and having no
 *  route to its stop is the defect, and the route cannot be "go and find the
 *  right market first", because the panel was not saying which market that was.
 *
 *  So the levels follow the position rather than the page:
 *
 *    - A position on the market on screen is the one, always. That is the
 *      prominent position and nothing displaces it.
 *    - With none here and one elsewhere, that one is it.
 *    - With several open, a row of coin buttons picks between them, and the
 *      market on screen is the default when it has one. Every open position is
 *      then reachable from every market, which is the requirement.
 *
 *  ANOTHER MARKET'S RULES COME FROM assetSpecs, which this panel already reads
 *  once a tick for the other-positions list. No extra request, and the levels
 *  are checked against the asset's own tick and its own margin tiers rather
 *  than against whatever market happens to be on screen.
 */
function paperLevelTarget() {
  const st = paper.state;
  if (!st) return null;
  const coins = Object.keys(st.positions || {});
  if (!coins.length) return null;
  const here = paper.coin && st.positions[paper.coin] ? paper.coin : null;
  let coin = here;
  if (!coin) {
    coin = (paper.levelCoin && st.positions[paper.levelCoin]) ? paper.levelCoin : coins[0];
  } else if (paper.levelCoin && st.positions[paper.levelCoin]) {
    coin = paper.levelCoin;
  }
  const info = coin === paper.coin ? paper.info : paperSpecFor(coin);
  return { coin, pos: st.positions[coin], info: info || null,
           here: coin === paper.coin, coins };
}

/** A percentage away from entry, signed. The number is the engine's
 *  pxChangePct; only the number of places is decided here.
 *
 *  ONE PRECISION DOWN THE WHOLE COLUMN, because comparing its entries against
 *  each other is the only thing that column does. Two places, fixed.
 *
 *  Both other ways of writing this were tried and both were worse. Rounding to
 *  two places and stopping printed a 0.004% move as +0.00%, which is an absence
 *  in the shape of a reading. Scaling the places with the size of the move
 *  fixed that and broke the column: it came out reading -5%, +0.00117%, +4.03%,
 *  +18.5%, four precisions down four lines with the longest string against the
 *  least significant number.
 *
 *  So two places everywhere, and a move too small to show at two places says it
 *  is too small rather than rounding itself away. Two rather than the one the
 *  specimen uses because the mark rung is the one that moves while somebody
 *  watches it, and on BTC one place quantises it to steps of about eighty-five
 *  dollars.
 */
function ppct(v) {
  if (!isFinite(v)) return "";
  const a = Math.abs(v);
  if (a === 0) return "0.00%";
  // Below what two places can show, and unsigned: "-<0.01%" parses as a minus
  // sign against a less-than and reads like a typo. The direction is already on
  // the row twice, in the price distance to its left and in the money to its
  // right, so nothing is lost by leaving it off the one cell that cannot
  // resolve it.
  if (a < 0.005) return "<0.01%";
  return (v > 0 ? "+" : "-") + a.toFixed(2) + "%";
}

/** A signed price distance, at the precision the PRICE it is measured against
 *  is quoted to.
 *
 *  Not at the precision of the distance itself. ppx rounds by the magnitude of
 *  the number it is given, so a 72.8 gap on BTC came out as "-72.8" sitting
 *  directly under prices printed as 85,282 and 89,973: one decimal against
 *  none, in a column whose whole job is to be compared down its length. The
 *  tick at the reference price is the grid both of them are on. */
function pdelta(v, info, ref) {
  if (!isFinite(v) || !info) return "";
  const tick = priceTick(Number(ref) > 0 ? Number(ref) : Math.abs(v), info.szDecimals);
  const dp = Math.max(0, Math.min(8, Math.ceil(-Math.log10(tick))));
  return (v > 0 ? "+" : v < 0 ? "-" : "") + pnum(Math.abs(v), dp);
}

/** The fee schedule, but only when it was actually read.
 *
 *  THE GUARD WAS DEAD AND THE SENTENCE EXPLAINING IT WAS FALSE.
 *  closeValueAt returns null rather than a fee-free number when it is handed no
 *  taker rate, and the panel said so: that the figure is left out rather than
 *  worked out without a rate. It was never left out. `paper.fees` is seeded
 *  with the base-tier constants and they stand when the read fails, so
 *  closeValueAt was always handed a rate, every row was priced from constants,
 *  and the sentence describing the opposite could not be reached.
 *
 *  Passing null when the schedule was never read makes the guard the thing the
 *  panel already claimed it was. The constants still back decideOrder, because
 *  refusing to let anyone place an order is a worse answer than pricing one at
 *  a rate the Fees row labels "not read"; the difference is that a fill is
 *  reported with its own fee attached, while a ladder figure is a bare number
 *  in a column of measured ones.
 */
function paperLadderFees() {
  return paper.feesRead ? paper.fees : null;
}

/** Why a row that is not the liquidation row carries no figure. */
function unpricedReason() {
  if (!paper.feesRead) {
    return "Hyperliquid's fee schedule has not been read, so the exit fee is not "
      + "known, and what closing at these prices would realise is left out rather "
      + "than worked out without it.";
  }
  return "The simulation did not put a figure on that price.";
}

// ── Every open position, priced ─────────────────────────────────────────────
//
// WHAT THIS FILE CONSUMES, WRITTEN DOWN BECAUSE IT IS A CONTRACT ACROSS TWO
// FILES and this side of it is only a renderer. From paperSim.js:
//
//   await openPositions(state, fees, specs?) -> rows, newest opened first
//     { coin, side, size, entryPx, openedAt,
//       leverage,        effective, fractional after an add, what is RUNNING
//       ticketLeverage,  a whole number in [1, maxLeverage], what the control
//                        can be SET to, rounded down and never to nearest
//       szDecimals, maxLeverage,   null when the asset was not read
//       markPx,          null when unpriced
//       liquidationPx,   null when there is none or the asset was not read
//       value,           the whole closeValueAt result, or null
//       unpriced }       null, or { code, message }
//
//   ticketLeverage(pos, info)   the same whole number for one position
//   closeAllValue(rows)         { realises, positions, unpriced, note }
//
// THREE RULES THAT COME WITH IT.
//
// `value.realises` IS THE FIGURE, NEVER `value.pnl`. pnl is gross, it sits
// right there on the row and it reads like the answer. That is the exact
// defect this panel has had fixed twice, and the only reason it cannot come
// back through this door is that nothing here adds, subtracts or nets
// anything: the row is rendered, not computed.
//
// `ticketLeverage` IS NOT `leverage`. The row shows what the position is
// running at, which after an add is 17.105...x. The ticket is set to what the
// venue's control accepts, which is 17. They are different numbers with
// different jobs and using either for the other's is wrong.
//
// openPositions IS CALLED WITHOUT A PER-COIN LOOKUP. It reads the whole
// universe out of metaAndAssetCtxs, which assetInfo has already put in the
// cache, and costs no extra request for any number of positions. Calling
// assetInfo per held coin is the obvious implementation and it adds a
// marginTable request per coin.

/** Every open position with its mark and what closing it would realise.
 *
 *  Called from the tick, never from refresh(): it awaits, and refresh() runs on
 *  every keystroke. What it returns is parked on paper.others and drawn from
 *  there, the same arrangement paper.info already has.
 */
async function paperReadOtherPositions() {
  if (!paper.state) return null;
  // THE MAP FIRST, AND BEFORE THE openPositions GUARD. It is read by two
  // surfaces, not one: the rows below and the closed list, and the closed list
  // has rows on markets that nothing is open on any more. Fetched here rather
  // than inside openPositions so there is one read a tick instead of two, and
  // passed in so openPositions does not build a second copy of it.
  if (typeof assetSpecs === "function") {
    try {
      const specs = await assetSpecs();
      if (specs && specs.size) paper.specs = specs;
    } catch (e) { /* the previous map stands, and a row with no spec says so */ }
  }
  if (typeof openPositions !== "function") return null;
  const rows = await openPositions(paper.state, paperLadderFees(), paper.specs);
  return Array.isArray(rows) ? rows : null;
}

/** The asset rules to print one coin's prices at.
 *
 *  The market on screen is already read in full, so it answers for itself.
 *  Everything else comes out of the universe map. null when neither has it,
 *  which is a different thing from a price that is not a number and is printed
 *  as its own sentence rather than as six decimal places nobody asked for.
 */
function paperSpecFor(coin) {
  if (!coin) return null;
  if (paper.info && paper.info.coin === coin) return paper.info;
  return (paper.specs && paper.specs.get(coin)) || null;
}

/** Commit a level, or clear it. Follows the person's own blur, Enter or Clear,
 *  which is why it is allowed to write the field: the focus rule is about what
 *  a TICK may touch, and a tick never reaches this. */
async function commitLevel(which, raw) {
  // The position the fields are pointing at, which is not always the one on the
  // market on screen. See paperLevelTarget.
  const target = paperLevelTarget();
  const info = target ? target.info : null;
  const pos = (paper.state && info) ? paper.state.positions[target.coin] : null;
  if (!pos) return;
  const v = levelInput(raw);
  if (v.clear) {
    try { clearPositionLevel(paper.state, target.coin, which); } catch (e) { /* nothing to clear */ }
  } else {
    const d = levelDecision(which, raw, paper.state, target.coin, info);
    if (d && d.ok === false) {
      // Refused, so nothing was written and the field keeps what was typed.
      // The engine's own message is rendered under it by the next pass.
      refresh();
      return;
    }
  }
  // Echo back what is actually held. The engine refuses an off-grid price
  // rather than snapping it, so this only ever differs by the grouping.
  const held = Number(pos[which === "stop" ? "stopPx" : "targetPx"]);
  paper.draft[which] = isFinite(held) && held > 0 ? String(held) : "";
  const el = which === "stop" ? paper.ui.stopLvl.input : paper.ui.targetLvl.input;
  if (el) el.value = paper.draft[which];
  await saveState(paper.state);
  refresh();
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

  // Whether the practice account is actually persisting, and if it is not,
  // WHICH of the two very different reasons it is not.
  const save = paperSaveState();
  setShown(ui.storage, !save.ok);
  ui.storage.classList.toggle("tp-orphan", save.orphaned);
  if (!save.ok) setText(ui.storage, save.message);

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

  setText(ui.size.unit, sizeUnitLabel());
  ui.size.unit.classList.toggle("on", d.sizeUnit === "usd");
  ui.size.unit.title = d.sizeUnit === "usd"
    ? `Showing the size in USD. Press to go back to ${coin || "the coin"}.`
    : "Showing the size in " + (coin || "the coin") + ". Press to enter it in USD.";
  // Before the strip is written, because this is what decides what the leverage
  // button reads: a choice made in the modal, the leverage already open on this
  // market, or the venue's own default for the asset.
  seedTicketLeverage();
  setText(ui.levBtn, `${paperLeverage()}x`);
  refreshSheets();
  // Two different sentences, one place, and they cannot both be true: the
  // warning is that the number typed is not the number that will be used, and
  // the quiet one is that the number in the box was put there by the position
  // already open. The warning wins, and the class says which is showing.
  const levNote = paperLeverageNote();
  const seedNote = levNote ? null : ticketLeverageSeedNote();
  setText(ui.leverageNote, levNote || seedNote || "");
  setShown(ui.leverageNote, !!(levNote || seedNote));
  ui.leverageNote.classList.toggle("tp-lev-seeded", !levNote && !!seedNote);
  ui.reduceOnly.input.checked = d.reduceOnly;
  ui.postOnly.input.checked = d.postOnly;
  ui.tpsl.input.checked = d.tpslOn;
  setShown(ui.tpslBox, d.tpslOn);
  // Before the boxes are written, because this is what decides what goes in
  // them when the market already has marks on its position.
  seedTicketLevels();
  setVal(ui.tpTicket.input, d.tpPx);
  setVal(ui.slTicket.input, d.slPx);
  setVal(ui.tpTicket.gain, d.tpGain);
  setVal(ui.slTicket.gain, d.slLoss);
  setText(ui.tpTicket.unit, d.tpslNtl ? "$" : "%");
  setText(ui.slTicket.unit, d.tpslNtl ? "$" : "%");
  if (d.tpslOn) refreshTicketLevels();

  // Their two account rows. Neither says "N/A" when it has nothing: one is
  // waiting on the stored account and the other on the venue, and those are
  // different absences with different reasons.
  setText(ui.available, state ? `${pusd(state.balance)} USDC` : "not loaded yet");
  // The position on this market, WITHOUT requiring the market to have been
  // read. It is held in the practice account, so it exists whether or not
  // Hyperliquid has answered; what needs `info` is its prices, and the position
  // block says so in its own words rather than disappearing.
  const pos = (state && paper.coin) ? state.positions[paper.coin] : null;

  // And where the rest of the balance is. Summed from the margin each position
  // actually put up, which is the number openPosition stored, so this is a
  // total of figures rather than a second derivation of them.
  let heldElsewhere = 0;
  const heldCoins = [];
  for (const k of Object.keys((state && state.positions) || {})) {
    const m = Number(state.positions[k].margin) || 0;
    if (!(m > 0)) continue;
    heldElsewhere += m;
    heldCoins.push(k);
  }
  // THE COIN LIST GOES WHEN THE SECTION BELOW CARRIES IT. This line was the
  // partial answer to "where did the rest of the balance go": it named the
  // markets, and that was all it could do. The other positions now have their
  // own section, with the side, the size, the entry, the mark and what closing
  // each would realise, so naming them twice spends four lines of a 342px
  // column saying less than the rows below already say. The money figure stays
  // here, because it belongs beside the balance it explains.
  const listedBelow = !!(Array.isArray(paper.others)
    && paper.others.some((r) => r && r.coin !== paper.coin));
  const shownCoins = heldCoins.length > 6
    ? heldCoins.slice(0, 6).join(", ") + ` and ${heldCoins.length - 6} more`
    : heldCoins.join(", ");
  // ONE LINE. The sentence that followed it, that the margin comes back as each
  // position is closed, is a standing fact about margin rather than news about
  // this balance, and it was costing a line of a 342px column on every render.
  setText(ui.availableNote, heldCoins.length
    ? `${pmoney(heldElsewhere)} more is margin on `
      + `${heldCoins.length === 1 ? "an open position" : heldCoins.length + " open positions"}`
      + (listedBelow ? ", listed below." : `: ${shownCoins}.`)
    : "");
  setShown(ui.availableNote, heldCoins.length > 0);

  // THEIR Current Position ROW. The size of what is open on the market on
  // screen, at that market's own lot precision, with a zero when nothing is
  // open because that is the true size of nothing. The two absences it can be
  // in are named rather than printed as a zero: no stored account yet, and this
  // market's rules not read yet, which is the one case the number of decimal
  // places is not known and so the figure cannot be written the way their form
  // writes it.
  const posSzd = (info && info.coin === coin) ? info.szDecimals : null;
  setText(ui.currentPos, !state
    ? "not loaded yet"
    : (posSzd == null
      ? (pos ? `${pnum(pos.size, 6)} ${coin}, at six places until this market is read`
             : "waiting on this market's rules")
      // fmtSz, not pnum. Their row reads "0.00000 BTC", padded to the asset's
      // lot precision, and pnum drops the trailing zeroes and prints "0 BTC".
      // The padding is the asset's step size showing, which is worth keeping
      // and is what their form does.
      : `${fmtSz(pos ? pos.size : 0, posSzd)} ${coin}`));

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

  // Their Fees row: taker then maker, the way theirs prints it, and whether it
  // was read or is the base constant. These two numbers are correct today and
  // are still not a reading, and a constant printed in the shape of a
  // measurement is the thing this project does not ship. If userFees never
  // answered the row says so instead of the number. This one is the same in
  // every state, which is why it is not among the four below: it does not
  // depend on there being an order.
  setText(ui.fees, paper.feesRead
    ? `${(paper.fees.taker * 100).toFixed(4)}% / ${(paper.fees.maker * 100).toFixed(4)}%`
    : "not read");
  ui.fees.classList.toggle("tp-stale", !paper.feesRead);
  ui.fees.title = paper.feesRead
    ? "Taker / maker, read from Hyperliquid's own fee schedule at the base tier."
    : "Hyperliquid's fee schedule did not answer, so no rate is shown. The "
      + "simulation is using the base tier constants until it does.";

  // The derived figures, taken from the simulation's own preview.
  // No market data means nothing below can be priced, and saying so where a
  // refusal goes is the whole answer. Silence was the previous behaviour and
  // it left an inert button with no explanation attached to it.
  const problem = paperDataProblem();
  const pv = problem ? null : paperPreview();
  let liq = "", ov = "", mr = "", slip = "";
  // Cleared before the branches. The only branch that sets it is the one that
  // prices a fill, so without this a hover explaining why a 1x order has no
  // liquidation price outlived the order it was about.
  ui.liq.title = "";
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
    //
    // THEIRS READS "Est: 0% / Max: 8.00%" AND OURS HAS NO MAX, so ours does not
    // print one. Their Max is a protection setting that rejects a market order
    // whose fill comes back worse than the cap; nothing here caps anything, the
    // order walks whatever the book holds, and a "Max" copied across for the
    // sake of the shape would be a control this panel does not have. The word
    // is on the row because a slippage estimate with no cap beside it reads as
    // though there were one.
    slip = `Est: ${(Math.abs(f.slippageVsTouch) / f.avgPx * 100).toFixed(3)}%, uncapped`;
    const hypothetical = {
      side: f.side === "buy" ? "long" : "short",
      size: f.size, entryPx: f.avgPx, margin,
    };
    const lp = liquidationPrice(hypothetical, info);
    // NOT "N/A". A position whose margin is its whole value cannot be
    // liquidated by price, which is a fact about the order rather than a figure
    // that failed to arrive. It read as broken directly above a position block
    // quoting a liquidation price perfectly well.
    liq = lp ? ppx(lp, info) : `none at ${pnum(f.leverage || 1, 2)}x`;
    ui.liq.title = lp ? "" : PAPER_NO_LIQ;
  } else if (pv && pv.ok && pv.kind === "rest") {
    const o = pv.order;
    ov = `${pusd(o.size * o.px)} USDC`;
    mr = `${pusd((o.size * o.px) / (o.leverage || 1))} USDC`;
    slip = "None, it rests";
  } else if (pv && !pv.ok) {
    setText(ui.refusal, pv.message + (pv.detail ? " " + pv.detail : ""));
    setShown(ui.refusal, true);
  }
  // THE FOUR ROWS THAT DESCRIBE AN ORDER, IN EVERY STATE, AND NEVER AS N/A.
  //
  // Their form draws these four whatever is entered and prints N/A in three of
  // them while nothing is. Both halves of that were wrong here: hiding the rows
  // lost the shape of their form, and N/A made a failed read and an untouched
  // field look identical. So the rows stand and the cell names the absence it
  // is in. Four causes, four different words, and each one is the short form of
  // whatever longer sentence is already on screen above the button:
  //
  //     no size typed      the field is empty and nothing has gone wrong
  //     size not usable    it holds something that is not an order yet, and
  //                        the complaint underneath says what
  //     market not read    paperDataProblem, whose sentence is in the refusal
  //     order refused      the engine's own refusal, likewise
  //
  // "not read" is the phrase the Fees row and ppx already use for a reading
  // that did not arrive, so a person meets one vocabulary and not four.
  const priced = !!(pv && pv.ok);
  const complaint = priced ? null : sizeComplaint(d.size);
  const emptySize = String(d.size).trim() === "";
  let blank = "";
  if (!priced) {
    if (problem) blank = "market not read";
    else if (pv && !pv.ok) blank = "order refused";
    else if (emptySize) blank = "no size typed";
    else blank = "size not usable";
  }
  setText(ui.liq, priced ? liq : blank);
  setText(ui.orderValue, priced ? ov : blank);
  setText(ui.marginReq, priced ? mr : blank);
  setText(ui.slippage, priced ? slip : blank);
  // Muted when the cell is naming an absence rather than carrying a figure, so
  // four repetitions of the same three words do not read as four numbers.
  for (const cell of [ui.liq, ui.orderValue, ui.marginReq, ui.slippage]) {
    cell.classList.toggle("tp-kv-off", !priced);
  }

  // The complaint about what is in the size field, which is longer than a cell
  // and is the only thing the row above cannot say for itself. An empty field
  // is not a complaint: "no size typed" is already on all four rows and a line
  // under them telling somebody to type a size says it a fifth time.
  const none = (!priced && !problem && !(pv && !pv.ok) && !emptySize && complaint)
    ? complaint.message : "";
  setText(ui.previewNone, none);
  setShown(ui.previewNone, !!none);

  refreshPosition(pos, info);
  refreshOthers();
  refreshLevels(paperLevelTarget());
  refreshResting(state, info);
  refreshEvents(state);
  refreshClosed(state);
  scheduleAnchor();
}

/** The position, in the facts their positions table carries that the ladder
 *  under it does not.
 *
 *  WHAT IS NOT HERE, AND WHY. Entry, mark and liquidation are prices, and
 *  prices belong on the ladder where they can be compared: it prints each one
 *  with what closing there would realise. So the rows here are the ones their
 *  table has and the ladder has no rung for.
 *
 *  THE TWO DIFFERENT P&L FIGURES ON THIS PANEL, BECAUSE CONFUSING THEM IS THE
 *  DEFECT THAT HAS BEEN FIXED TWICE. PNL here is closeValueAt's `pnl`, which is
 *  the move on the position and nothing else: their column is that figure and
 *  the ROE beside it is that figure over the margin. The ladder's mark rung is
 *  closeValueAt's `realises`, which is the same move after the fee in, the fee
 *  out and the funding, and it is labelled "if closed now". They are different
 *  numbers answering different questions and the smaller one is the one to act
 *  on, so the row says which of the two it is rather than leaving a reader to
 *  find out by subtracting them.
 *
 *  NEITHER IS WORKED OUT HERE. Both come out of one closeValueAt call, at the
 *  venue's mark, which is the same call with the same arguments the ladder's
 *  mark rung makes, so the two cannot disagree.
 */
function refreshPosition(pos, info) {
  const ui = paper.ui;
  setText(ui.posTitle, `Practice position${paper.coin ? " in " + paper.coin : ""}`);
  // TWO HEADINGS AROUND ONE SENTENCE. With nothing open on the market on
  // screen, this section was a heading reading "Practice position in SOL" over
  // a line reading "No open SOL position.", which is the same fact twice and
  // the second of the two says it better: it names the market and it answers
  // the question. The heading goes while there is nothing under it.
  setShown(ui.posTitle, !!pos);
  // HELD IS NOT THE SAME QUESTION AS PRICED. The position is in the practice
  // account whether or not this market has answered; only its prices need the
  // read. Treating the two as one question made a held position vanish from the
  // panel while the venue was slow.
  const held = !!pos;
  const priced = !!(pos && info);

  setShown(ui.posEmpty, !held);
  setShown(ui.posTable, held);
  setShown(ui.posClose, held);
  setShown(ui.posUnpriced, held && !priced);

  if (!held) {
    setText(ui.posEmpty, `No open ${paper.coin || ""} position.`);
    // Blanked rather than left hidden with the last position's numbers in it.
    // A hidden table holding stale figures is one dropped stylesheet away from
    // telling somebody they still hold something they closed. "no position",
    // not "N/A": if this ever does become visible it should say which nothing
    // it is.
    for (const cell of [ui.posSize, ui.posValue, ui.posPnl, ui.posMargin, ui.posFunding]) {
      setText(cell, "no position");
      cell.className = "";
    }
    return;
  }

  // Side, size and leverage are one fact: what is open. A position that was
  // added to carries the effective leverage read back from the margin actually
  // put up, so it can be 3.7419...x; printed raw it looks like a bug rather
  // than like arithmetic.
  //
  // The asset's own lot precision when it was read, and six places with the
  // reason said below when it was not. Same rule the closed list follows for a
  // row belonging to a market whose rules are not on hand.
  const size = priced ? pnum(pos.size, info.szDecimals) : pnum(pos.size, 6);
  const lev = isFinite(Number(pos.leverage)) ? ` at ${pnum(pos.leverage, 2)}x` : "";
  setText(ui.posSize, `${pos.side} ${size} ${pos.coin || paper.coin || ""}${lev}`);
  ui.posSize.className = pos.side === "long" ? "tp-up" : "tp-down";

  // Margin and Funding are held on the position itself, so they are true with
  // or without a mark. Both are what the engine stored when it put the margin
  // up and when it settled the funding, read off rather than re-derived.
  setText(ui.posMargin, pmoney(pos.margin));
  setText(ui.posFunding, pmoney(-(pos.fundingPaid || 0)));

  // ── Position Value and PNL (ROE %), which both need the mark.
  const mark = priced ? Number(info.markPx) : NaN;
  const haveMark = isFinite(mark) && mark > 0;

  // POSITION VALUE IS THE ONE FIGURE ON THIS PANEL THE ENGINE HAS NO FUNCTION
  // FOR, and this comment is here so the next person does not have to work out
  // whether that is an oversight. It is a notional, size at the mark, and it is
  // not a P&L: it has no entry price in it, no fee, no funding and no sign, so
  // it cannot be mistaken for what closing would give and cannot drift away
  // from what the ladder says the way a second P&L expression did. Both of its
  // operands are the engine's, the size off the position and the mark off the
  // read. If paperSim.js ever grows a notional function, this calls it.
  setText(ui.posValue, haveMark ? `${pusd(pos.size * mark)} USDC` : "no mark price");

  // THE ENGINE'S OWN FIGURE, AT THE ENGINE'S OWN MARK. Not `realises`, which is
  // the ladder's "if closed now" and is this less the exit fee; see above.
  const v = haveMark ? closeValueAt(pos, info, paperLadderFees(), mark) : null;
  if (!v || !isFinite(Number(v.pnl))) {
    // Which nothing it is: no mark to value against, or a fee schedule that has
    // not been read, which is the reason the ladder prints under itself.
    setText(ui.posPnl, haveMark ? "not priced" : "no mark price");
    ui.posPnl.className = "";
  } else {
    const pnl = Number(v.pnl);
    // ROE, the return on the margin held, which is the percentage the ladder's
    // own note says its rungs are not giving. A ratio of two engine figures and
    // not a third money figure. Left off when there is no margin to return on,
    // rather than dividing by zero and printing an infinity.
    const m = Number(pos.margin);
    const roe = isFinite(m) && m > 0 ? ppct((pnl / m) * 100) : "";
    setText(ui.posPnl, (pnl > 0 ? "+" : "") + pmoney(pnl) + (roe ? ` (${roe})` : ""));
    ui.posPnl.className = pnl >= 0 ? "tp-up" : "tp-down";
  }

  if (!priced) {
    setText(ui.posUnpriced,
      `${paper.coin || "This market"} has not been read from Hyperliquid's public `
      + "data yet, so there are no prices to put under this: no entry, no mark, no "
      + "liquidation price, and nothing on what closing it now would realise.");
  }
}

/** The positions on every market except this one.
 *
 *  EVERY FIGURE ON EVERY ROW IS THE ENGINE'S. `realises` is closeValueAt at
 *  that market's own mark, worked out where the rest of the money is worked
 *  out. Nothing here does arithmetic on it, including adding two of them up.
 */
function refreshOthers() {
  const ui = paper.ui;
  const all = Array.isArray(paper.others) ? paper.others : [];
  // WHICH OF THESE, IF ANY, HAS ITS LADDER ON SCREEN ABOVE.
  //
  // The level fields follow the position rather than the page now, so with
  // nothing open on the market being viewed the ladder above is showing one of
  // the positions in this list, in full, with its entry and its mark each on
  // their own rung. That row then printed "in at 84,397, mark 84,355" a second
  // time, four lines under the rungs carrying the same two prices, which is a
  // repeat this pass introduced and this removes.
  //
  // THE ROW IS NOT DROPPED, AND ITS MONEY FIGURE STAYS. Two separate reasons,
  // because they cover two different parts of the row.
  //
  // The row is the only carrier of the SIZE and the LEVERAGE for a market that
  // is not on screen: the position table belongs to the market being viewed and
  // does not render for anything else. That is why the row exists at all.
  //
  // The FIGURE is the part that is genuinely duplicated, and it stays for a
  // different reason. The ladder is only ever showing one position, so on every
  // other row the figure is the only one there is. Suppressing it on whichever
  // row happens to be expanded would mean a row that loses its money figure the
  // moment you point the picker at it and gets it back when you point
  // elsewhere, which is a row that changes shape as it opens. A number that
  // appears twice is easier to read than a row that is a different row
  // depending on what else is on screen.
  //
  // Neither of those is the close-everything total, which was a derived sum
  // whose only term was the row directly above it and which carried nothing of
  // its own at all.
  const levelled = (() => {
    const t = paperLevelTarget();
    return (t && t.coin && t.coin !== paper.coin) ? t.coin : null;
  })();
  // The market this page is on is above, in full, with its ladder. It is still
  // in the engine's rows, which are every open position, so it is filtered out
  // here by coin and nowhere else.
  const rows = all.filter((r) => r && r.coin && r.coin !== paper.coin);
  setShown(ui.othersSec, rows.length > 0);
  if (!rows.length) return;

  const open = !!paper.othersOpen;
  ui.othersHead.setAttribute("aria-expanded", String(open));
  // THE FULL-SIZE TRIANGLES, NOT THE SMALL ONES. U+25B8 and U+25BE render at
  // roughly 3px in this face at 10px, and on a rendered panel both states came
  // out as the same faint dot: the control gave no sign of which way it was
  // pointing. These are the pair the page's own <details> marker uses, at the
  // size that marker is drawn.
  setText(ui.othersCaret, open ? "▼" : "▶");
  // THE COUNT IS ON THE HEADER, so a section that is collapsed still says how
  // much is behind it. A collapse that hides the fact that anything is there
  // would put the panel back where it started.
  setText(ui.othersCount,
    rows.length === 1 ? "1 market" : `${rows.length} markets`);
  setShown(ui.othersBody, open);

  const sig = rows.map((r) => [
    r.coin, r.side, r.size, r.entryPx, r.markPx, r.leverage,
    r.value ? r.value.realises : "unpriced",
    // Which row is the one expanded above changes what that row prints, so it
    // is part of the signature or the list keeps the old wording.
    r.coin === levelled ? "above" : "",
  ].join(",")).join("|");

  syncList(ui.othersList, sig, rows.map((r) => {
    // The asset's own precision when its rules were read, and six places with
    // the reason said out loud when they were not. Same rule the closed list
    // follows for a row belonging to another market.
    const px = (v) => (r.szDecimals != null
      ? ppx(v, { coin: r.coin, szDecimals: r.szDecimals })
      : pnum(v, 6));
    const size = r.szDecimals != null ? pnum(r.size, r.szDecimals) : pnum(r.size, 6);
    // The EFFECTIVE leverage, which is what the position is running at and is
    // fractional after an add. Not ticketLeverage: that is the whole number the
    // control can be set to, and printing it here would say the position is
    // running at something it is not.
    const lev = isFinite(Number(r.leverage))
      ? `${pnum(r.leverage, 2)}x`
      : "at a leverage this account did not store";
    const dirClass = r.side === "long" ? "tp-up" : "tp-down";
    // realises, NEVER pnl. pnl is the gross move, it is on the same object and
    // it reads like the answer. The engine's own note on closeValueAt is that
    // two call sites for one quantity is the defect, so there is one: this row
    // prints the figure the engine put on it.
    const net = r.value && isFinite(Number(r.value.realises))
      ? Number(r.value.realises) : null;
    const figure = net == null
      ? '<span class="tp-rest-na">not priced here</span>'
      : `<span class="tp-others-f ${net >= 0 ? "tp-up" : "tp-down"}">`
        + `${pesc((net > 0 ? "+" : "") + pmoney(net))}</span>`;
    // WHICH absence, in the engine's own words. Never a zero, never a dash, and
    // the row is not dropped: the side, the size, the entry and the leverage on
    // it are all still true, and a position vanishing because its market could
    // not be read is the invisibility this section exists to end.
    const shownAbove = r.coin === levelled;
    const away = net == null
      ? `${pesc(size)} ${pesc(r.coin)}, in at ${pesc(px(r.entryPx))}. `
        + pesc((r.unpriced && r.unpriced.message) || unpricedReason())
      : (shownAbove
        ? `${pesc(size)} ${pesc(r.coin)}, on the ladder above`
        : `${pesc(size)} ${pesc(r.coin)}, in at ${pesc(px(r.entryPx))}, `
          + `mark ${pesc(px(r.markPx))}`);
    // AN <a> WITH AN href, and the click handler turns it into their own
    // client-side navigation. Left as a link so it reads as one, so the keyboard
    // reaches it, and so a modifier-click still opens the market in a new tab
    // the way a link is expected to.
    return `
    <li>
      <span class="tp-rest-t">
        <a class="tp-others-m" href="/trade/${pesc(encodeURIComponent(r.coin))}"
           data-act="goto" data-coin="${pesc(r.coin)}"
           title="Go to ${pesc(r.coin)}">${pesc(r.coin)}</a>
        <span class="${dirClass}">${pesc(r.side)} ${pesc(lev)}</span>
        <span class="tp-rest-away">${away}</span>
      </span>
      ${figure}
    </li>`;
  }).join(""));

  // THE ONLY SUM THIS PANEL WILL SHOW, and it is the engine's.
  //
  // It is what closing every open position right now would realise, said in
  // those words, over EVERY row and not only the ones listed here: a total of
  // the others alone would be a number with no question behind it. It is not a
  // score, not a total earned and not a track record. Nothing here has been
  // closed and nobody has any of it.
  //
  // WHEN IT CANNOT BE TOTALLED IT SAYS SO INSTEAD. closeAllValue returns null
  // the moment any row is unpriced, on purpose: a sum quietly missing a leg is
  // the show-a-zero defect one level up, and worse, because nothing on the
  // surface shows the gap. The engine's own sentence goes in its place.
  //
  // AND ONLY WHEN THERE ARE TWO OR MORE. With one position open the sum IS that
  // position's own figure, printed a second time four lines under the first in
  // a longer sentence. A total restating its only term is not a total. The
  // count is `all`, every open position including this market's, because that
  // is what the sentence claims to cover.
  let total = null;
  let totalNote = null;
  if (all.length > 1 && typeof closeAllValue === "function") {
    try {
      const sum = closeAllValue(all);
      if (sum && typeof sum.then !== "function") {
        total = isFinite(Number(sum.realises)) && sum.realises !== null
          ? Number(sum.realises) : null;
        totalNote = total == null ? (sum.note || null) : null;
      }
    } catch (e) { total = null; totalNote = null; }
  }
  if (total != null) {
    setText(ui.othersSumT,
      "Closing every open position now, this market's included, would realise ");
    setText(ui.othersSumF, (total > 0 ? "+" : "") + pmoney(total));
  } else if (totalNote) {
    setText(ui.othersSumT, totalNote);
    setText(ui.othersSumF, "");
  }
  ui.othersSumF.classList.toggle("tp-up", total != null && total >= 0);
  ui.othersSumF.classList.toggle("tp-down", total != null && total < 0);
  setShown(ui.othersSumF, total != null);
  setShown(ui.othersSum, total != null || !!totalNote);
}

/** Put the leverage already open on this market into the ticket.
 *
 *  THE DEFECT. The ticket opened at 1x whatever was held. Somebody who opened
 *  BTC at 20x, reloaded or came back to the market, and placed a second order
 *  got 1x, with the only sign of it a margin figure they had no reason to be
 *  reading. Nothing on the screen said the number had changed, because nothing
 *  on the screen had changed: the box said 1 the whole time.
 *
 *  THE NUMBER IS ticketLeverage AND NOT pos.leverage. A position that was added
 *  to is running at the leverage its combined margin implies, which is
 *  17.105...x, and the venue's control does not take that. The engine rounds it
 *  DOWN to a whole number inside the asset's maximum, because rounding up would
 *  put up less margin per unit than the position already carries and so would
 *  propose the riskier of the two nearest choices unasked. The row below shows
 *  the 17.11x that is running; the box shows the 17x it can be set to; the line
 *  under the box says both when they differ.
 *
 *  SEEDED ON A CHANGE, NOT ON EVERY PASS. refresh() runs on every keystroke, so
 *  assigning the position's leverage each time would make the field impossible
 *  to change. It is seeded when the position the ticket is about becomes a
 *  different position, and its leverage is part of that identity because adding
 *  to a position moves the effective leverage under an unchanged openedAt.
 *
 *  AND NEVER UNDER THE CURSOR. The token is not advanced while the box has
 *  focus either, so the seeding happens on the first pass after the person
 *  leaves it rather than being skipped.
 */
function seedTicketLeverage() {
  const ui = paper.ui;
  if (!ui || !paper.coin) return;
  const known = !!(paper.info && paper.info.coin === paper.coin);
  // A CHOICE MADE IN THE MODAL OUTRANKS BOTH OF THE OTHER TWO, AND IT IS KEPT
  // PER MARKET. Their app stores a leverage per asset; a 40x chosen on BTC must
  // not follow you to a market whose maximum is 3, and coming back to BTC must
  // not throw the choice away. Nothing below runs once this has answered.
  if (paper.levChoice[paper.coin] != null) {
    paper.draft.leverage = String(paper.levChoice[paper.coin]);
    return;
  }
  const pos = paper.state ? paper.state.positions[paper.coin] : null;
  // THE THIRD CASE, WHICH IS NEW: no position and no choice is not "leave it
  // alone", it is the venue's own default for this asset, which is
  // min(20, maxLeverage). See paperVenueDefaultLeverage for the sweep that
  // settled that number. Keyed on `default` so it is applied once per market
  // and the modal can then move it.
  const seed = pos
    ? `${paper.coin}:${pos.openedAt}:${pos.leverage}`
    : (known ? `${paper.coin}:default` : `${paper.coin}:unread`);
  if (paper.levSeed === seed) return;
  // THE MAXIMUM HAS TO BE THIS MARKET'S. ticketLeverage clamps into the
  // asset's maximum, so seeding a BTC position against AVAX's info caps 20x at
  // 10x and the box then holds a number nothing on the page explains. The info
  // on hand is another market's for as long as a tick that started before a
  // market change is still in flight, which tick() now also guards against.
  // Without it the token is left alone rather than advanced, so the seeding
  // happens on the first pass after this market has been read rather than
  // being done once against the wrong rules and never revisited.
  if (pos && !known) return;
  paper.levSeed = seed;
  if (pos) {
    const lev = paperTicketLeverage(pos);
    if (lev != null) paper.draft.leverage = String(lev);
    return;
  }
  // Nothing open and nothing chosen. Until this market's maximum has been read
  // there is no default to apply, so the control keeps what it has and this
  // runs again on the pass after the read lands.
  if (!known) return;
  paper.draft.leverage = String(paperVenueDefaultLeverage(paperLeverageMax()));
}

/** The whole number the leverage control can be set to for this position.
 *  The engine's own, because rounding one out here is how the box and the row
 *  come to disagree, and the direction of the rounding is a decision the engine
 *  has made and written down. */
function paperTicketLeverage(pos) {
  if (!pos || typeof ticketLeverage !== "function") return null;
  // Only this market's rules, never whatever info happens to be on hand. See
  // the note in seedTicketLeverage.
  const info = (paper.info && paper.info.coin === paper.coin) ? paper.info : null;
  try {
    const v = Number(ticketLeverage(pos, info));
    return isFinite(v) && v >= 1 ? v : null;
  } catch (e) { return null; }
}

/** Said under the box while the number in it is the one the open position put
 *  there, and not after it has been changed.
 *
 *  TWO SENTENCES WHEN THE TWO NUMBERS DIFFER. After an add the box says 17 and
 *  the position is running at 17.11, and a line claiming 17x is what is open
 *  would be the panel printing a rounded number under the words "already open".
 *  The gap is small, it is also the whole reason the box does not just carry
 *  the position's own figure, and it is said rather than smoothed over.
 */
function ticketLeverageSeedNote() {
  const pos = (paper.state && paper.coin) ? paper.state.positions[paper.coin] : null;
  if (!pos) return null;
  const lev = paperTicketLeverage(pos);
  if (lev == null) return null;
  if (String(paper.draft.leverage).trim() !== String(lev)) return null;
  const running = Number(pos.leverage);
  // THE PLAIN CASE IS SILENT NOW, AND THAT IS A REMOVAL OF OUR OWN REPEAT.
  //
  // It used to read "Set to 20x, the leverage already open on BTC." That was
  // worth a line when the control was a text box you typed into and nothing
  // said where the number in it came from. The control is a button that reads
  // "20x", the position row below reads "0.01 BTC at 20x", and the sentence was
  // the same number a third time. Hyperliquid's form has no such line, so this
  // is one of ours, and the rule for this pass is that ours are said once.
  //
  // It also cost more than a line. Measured at 1280x813 with a position open,
  // it pushed the control that closes the position 5px past the bottom of the
  // panel, which is the one thing that may never go behind a scroll.
  //
  // THE CASE THAT REMAINS IS THE ONE THE NUMBERS DO NOT COVER. After an add the
  // button says 17x and the position is running at 17.11x, and no surface
  // anywhere carries that gap. It is the reason the control does not simply
  // show the position's own figure, and it is still said out loud.
  if (!isFinite(running) || Math.abs(running - lev) < 0.005) return null;
  return `Set to ${lev}x. The ${paper.coin} position is running at `
    + `${pnum(running, 2)}x after being added to, which the control does not take.`;
}

/** The two level fields and the ladder.
 *
 *  NO POSITION, NO LADDER. Everything in here is about a position that is open,
 *  and a scale with nothing on it is a scale that is claiming something.
 */
function refreshLevels(target) {
  const ui = paper.ui;
  if (!ui || !ui.levels) return;
  const pos = target ? target.pos : null;
  const info = target ? target.info : null;
  const coin = target ? target.coin : null;
  const has = !!(pos && info);
  setShown(ui.levels, has);

  // WHICH POSITION THESE TWO FIELDS ARE ABOUT, SAID WHENEVER IT IS NOT THE
  // OBVIOUS ONE. With a position on the market on screen this is silent: the
  // section heading above already names it. With the fields pointing at a
  // position held somewhere else, a stop typed into an unlabelled box would go
  // onto a market the person is not looking at.
  const elsewhere = has && !target.here;
  setText(ui.levelsWho, elsewhere
    ? `Stop loss and take profit on your ${coin} position, which is open on a `
      + "market this page is not showing."
    : "");
  setShown(ui.levelsWho, elsewhere);

  // The picker, and only when there is something to pick between. One open
  // position needs no chooser; two or more need every one of them reachable
  // from wherever the page happens to be.
  const openCoins = target ? target.coins : [];
  const many = has && openCoins.length > 1;
  setShown(ui.levelsPick, many);
  if (many) {
    syncList(ui.levelsPick, openCoins.join("|") + ">" + coin,
      openCoins.map((c) => `<button type="button" class="tp-lvl-pick`
        + `${c === coin ? " on" : ""}" data-act="levelcoin" data-coin="${pesc(c)}"`
        + ` aria-pressed="${c === coin}">${pesc(c)}</button>`).join(""));
  }

  // Seed the fields from what the engine holds, once per position. Keyed on
  // the position's own identity so a commit does not re-seed and fight the
  // typing, and a new position does not inherit the last one's levels.
  const key = has ? `${pos.coin}:${pos.openedAt}` : "";
  if (paper.levelSeed !== key) {
    paper.levelSeed = key;
    for (const which of ["stop", "target"]) {
      const held = has ? Number(pos[which === "stop" ? "stopPx" : "targetPx"]) : NaN;
      paper.draft[which] = (has && isFinite(held) && held > 0) ? String(held) : "";
      const el = which === "stop" ? ui.stopLvl.input : ui.targetLvl.input;
      if (el && document.activeElement !== el) el.value = paper.draft[which];
    }
  }
  if (!has) return;

  // Each field, the engine's refusal under it if there is one, and WHETHER WHAT
  // IS IN THE BOX IS WHAT IS ON THE LADDER.
  //
  // A level is committed when the person leaves the field or presses Enter,
  // which is right: committing per keystroke would put 8, then 88, then 818 on
  // the ladder. What was wrong is that a draft was drawn exactly like a
  // committed value. A field reading 81,895 in the same weight and colour as a
  // set level, with a Clear button beside it, while the engine held no stop at
  // all and the ladder had no stop row. The Clear button was the worst of it: a
  // Clear next to a number is a claim that the number is set, so it asserted
  // the opposite of the truth. The only thing separating the two states was the
  // focus ring, which goes away at the same instant the value commits, so the
  // one moment a person could see the difference was while they were still
  // typing and looking at the ladder rather than at the box.
  //
  // So: the value goes muted whenever it is not what the engine holds, a line
  // under the field says which state it is in and what the ladder is still
  // showing, and Clear appears only when there is a committed level to clear.
  // The refusal is obtained by running setPositionLevel against a COPY of the
  // state, so what is shown before the commit is the same function that
  // performs it.
  const probe = paperStateProbe();
  for (const which of ["stop", "target"]) {
    const f = which === "stop" ? ui.stopLvl : ui.targetLvl;
    setVal(f.input, paper.draft[which]);

    const heldN = Number(pos[which === "stop" ? "stopPx" : "targetPx"]);
    const held = isFinite(heldN) && heldN > 0 ? heldN : null;
    const typed = String(paper.draft[which]).trim().replace(/,/g, "");
    const d = levelDecision(which, paper.draft[which], probe, coin, info);
    const bad = !!(d && d.ok === false);
    const settled = typed === "" ? held === null : Number(typed) === held;

    setText(f.msg, bad ? d.message + (d.detail ? " " + d.detail : "") : "");
    setShown(f.msg, bad);
    f.box.classList.toggle("tp-lvl-bad", bad);
    f.box.classList.toggle("tp-lvl-draft", !settled);

    // What the ladder is showing, said in the one place somebody would
    // otherwise assume the box is showing it.
    //
    // ON THE FIELD BEING EDITED, AND NOT ON BOTH. These two lines are the same
    // 19 words, and with a draft in each box the panel printed them twice, one
    // under the other, four lines apart. A draft only exists while somebody is
    // in the box making it, because leaving the box commits it, so the line
    // belongs to the box that has the caret in it. The exception is a refusal:
    // that one has to stand after the focus has gone, because the refusal is
    // the reason the level the person typed is not on the ladder.
    const editing = document.activeElement === f.input;
    let state = "";
    if (!settled && (editing || bad)) {
      const still = held !== null
        ? `The ladder still has it at ${ppx(held, info)}.`
        : "There is nothing on the ladder for it yet.";
      if (bad) state = `Not set. ${still}`;
      else if (typed === "") state = `${still} Leave the field to clear it.`;
      else state = `Not set yet. ${still} Press Enter, or click away, to set it.`;
    }
    setText(f.state, state);
    setShown(f.state, !!state);

    setShown(f.clear, held !== null);
  }

  // EVERY ROW, AND THE ORDER, FROM THE ENGINE, IN THE ORDER IT RETURNS THEM.
  //
  // positionLadder returns only the prices that exist, so a 1x long has no
  // liquidation row and a level nobody set has no row, and it returns them
  // sorted by price, lowest first. This file does not reorder them, not even by
  // reversing: sorting by role is what makes a short read as nonsense, the
  // engine has already sorted by price, and there is no branch below that asks
  // which side the position is. The scale beside the rows is mapped the same
  // way round, lowest at the top, so the two cannot disagree.
  let rows = [];
  try { rows = positionLadder(pos, info, paperLadderFees(), info.markPx) || []; }
  catch (e) { rows = []; }

  const present = {};
  for (const r of rows) present[r.role] = true;
  for (const def of TP_RUNGS) {
    const node = ui.rungs[def.role];
    setShown(node.row, !!present[def.role]);
    if (present[def.role]) continue;
    // Written rather than left holding the last position's numbers, the same
    // rule the position table follows, and written as the reason rather than as
    // "N/A": a stop with no level is not set, which is the phrase its own field
    // shows as a placeholder, and a liquidation row is absent because there is
    // no liquidation price to put in it.
    setText(node.px, def.role === "liquidation"
      ? `none at ${pnum(pos.leverage, 2)}x` : "not set");
    for (const cell of [node.d, node.pc, node.q, node.rl, node.note]) setText(cell, "");
  }

  const entry = pos.entryPx;
  const why = [];
  rows.forEach((r, i) => {
    const node = ui.rungs[r.role];
    if (!node) return;
    // `order` rather than moving nodes. The DOM is built once and stays built;
    // only the numbers change.
    node.row.style.order = String(i);
    setText(node.px, ppx(r.px, info));

    // WHAT IS UNUSUAL ABOUT THIS ROW, IN THE ENGINE'S OWN WORDS AND NOT IN ANY
    // OF MINE. markPassed means the venue's mark printed this price, which is a
    // reading; filled, triggered and stopped out are claims about an order, and
    // there is no order. Writing a short label of my own here is how one of
    // those words gets onto the screen without anybody deciding to put it
    // there, so the note is rendered verbatim, inside the row it belongs to, in
    // the two cases where something has actually changed about the row. The
    // liquidation row's note is permanent and general, so it goes under the
    // ladder instead of adding three lines to every position.
    const inRow = !!(r.note && (r.markPassed || r.stale));
    setText(node.note, inRow ? r.note : "");
    setShown(node.note, inRow);
    if (!inRow && r.note && why.indexOf(r.note) < 0) why.push(r.note);

    // Entry is the origin, so it has no distance from itself. It does have a
    // figure, because closing at the price you opened at still costs both fees
    // and whatever funding has been charged, and that is worth one line.
    const isEntry = r.role === "entry";
    setText(node.d, isEntry ? "" : pdelta(r.px - entry, info, entry));
    setText(node.pc, isEntry ? "" : ppct(r.pxChangePct));

    // The figure, and never this file's arithmetic. positionLadder carries
    // closeValueAt's own object; `realises` is the whole of it.
    //
    // QUALIFIED IN THE ROW, NOT ONLY IN THE PARAGRAPH UNDER IT. A bare
    // +$589.83 beside the word target is the one cell on this panel where a
    // hypothetical can be read as something earned, and a reader who has not
    // got to the paragraph yet has nothing telling them otherwise. The
    // specimen in the brief carries the words on the row for the same reason.
    let text;
    let qual = "";
    let cls = "tp-rung-r";
    if (r.value && isFinite(Number(r.value.realises))) {
      const v = Number(r.value.realises);
      text = (v > 0 ? "+" : "") + pmoney(v);
      cls += v >= 0 ? " tp-up" : " tp-down";
      qual = isEntry ? "in and out at this price"
        : (r.role === "mark" ? "if closed now" : "would realise");
    } else {
      text = "not priced";
      cls += " tp-rung-na";
      // The liquidation row's absence carries its own sentence, already on
      // screen under the ladder. Asked of the ROLE and not of whether the row
      // happens to have a note: a stop the mark has been past has a note about
      // that, which says nothing about why it has no figure, and under that
      // test the reason went unsaid on exactly the row that needed it.
      if (r.role !== "liquidation") {
        const reason = unpricedReason();
        if (why.indexOf(reason) < 0) why.push(reason);
      }
    }
    setText(node.q, qual);
    setShown(node.q, !!qual);
    setText(node.rl, text);
    if (node.rl.className !== cls) node.rl.className = cls;
  });

  // THERE IS NO PROPORTIONAL SCALE BESIDE THESE ROWS, AND THERE WAS ONE.
  //
  // It was a 24px track whose ticks were placed at each price's true fraction
  // of the span. The rows are not placed that way: they stack at their own
  // heights, evenly, because a row carrying the engine's mark-passed note is
  // 140px tall and one that is not is 34px. Two spacings side by side with
  // nothing joining a tick to its row, and measured the ticks landed beside the
  // wrong words: the stop's tick 52px off, one and a half rows, so in every
  // configuration tested it sat against the word entry. Someone reading it
  // concluded their stop was at their entry when it was 3,420 away.
  //
  // The reason this feature is in our own panel rather than on their chart is
  // that their price-to-pixel mapping could not be derived and a line in the
  // wrong place is worse than no line. A scale that mispairs its own ticks with
  // its own labels fails that test inside the panel built to pass it, so it is
  // gone rather than approximately right. Every distance it was drawing is on
  // the row in two forms, in price and in percent, which is the part that was
  // never approximate.
  //
  // Anything put back here has to be positioned by the row, not beside it: a
  // bar inside each line cannot mispair with the line it is inside.

  const uniq = [];
  for (const w of why) if (w && uniq.indexOf(w) < 0) uniq.push(w);
  syncList(ui.ladderWhy, uniq.join("|"),
    uniq.map((w) => `<p class="tp-lvl-why-l">${pesc(w)}</p>`).join(""));
  setShown(ui.ladderWhy, uniq.length > 0);
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

/** The history, which is everything except the thing that is already on screen.
 *
 *  THE SAME TWO SENTENCES WERE PRINTED TWICE. "Filled 0.05 BTC at 85,977, fee
 *  $1.93." and the line under it were the outcome banner beside the button and
 *  also the newest row here, word for word, four inches apart in a 342px
 *  column. The banner is the one that earns its place at the moment it appears:
 *  it is the answer to "I just pressed that" and it is against the thing that
 *  was pressed. So for as long as the banner is carrying an event, this list
 *  starts at the one after it, and its heading says History.
 *
 *  Nothing is lost by it. Editing any field on the ticket drops the banner,
 *  because at that point the person is describing a new order rather than
 *  reading about the last one, and the event comes back at the top of this
 *  list on the same pass.
 *
 *  AND THE SAME RULE AGAIN, AGAINST THE SECTIONS ABOVE THIS ONE.
 *
 *  Measured with one position open and two round trips behind it: the open
 *  BTC position's size and entry were on its row AND in a history line reading
 *  "Filled 1.20432 BTC at 85,891", and each closed round trip was told three
 *  times, once in the closed list and twice more here as a separate fill row
 *  and close row. One round trip, three rows, in two sections.
 *
 *  So an event that produced something still on screen is logged by what only
 *  this list carries, and not by restating it. The position on a row, the round
 *  trip in the closed list and the resting order in its own section each own
 *  the side, the size and the prices; this list owns THE FEE AND THE DEPTH,
 *  which are nowhere else and which are the measurement this panel exists for.
 *  A refusal has no other home at all, so it is logged in full.
 *
 *  Every log line names its market. Two adjacent closes used to read "Closed at
 *  85,844." and "Closed at 2,766." with nothing saying which was which, so you
 *  had to infer the coin from the size of the number.
 *
 *  The banner keeps the full sentence. It is the answer to "I just pressed
 *  that" and at that moment nothing else on screen has caught up yet.
 */
function refreshEvents(state) {
  const ui = paper.ui;
  let rows = state ? state.events.slice(0, 7) : [];
  if (paper.outcome && rows[0] === paper.outcome) rows = rows.slice(1);
  rows = rows.slice(0, 6);
  setShown(ui.evSec, rows.length > 0);
  if (!rows.length) return;
  const sig = rows.map((e) => `${e.at}:${e.message}`).join("|");
  syncList(ui.evList, sig, rows.map((e) => {
    // `log` is the short form for this list, written at the moment the event is
    // made because that is where the coin and the fee are known. Absent on a
    // refusal, which has nowhere else to be said and is printed whole.
    const head = (e.log && e.log.message) ? e.log.message : e.message;
    const det = e.log ? e.log.detail : e.detail;
    return `
    <li class="${e.ok ? "tp-ev-ok" : "tp-ev-no"}" data-ev="1">
      <span class="tp-ev-h">${pesc(head)}</span>
      ${det ? `<span class="tp-ev-d">${pesc(det)}</span>` : ""}
    </li>`;
  }).join(""));
}

function refreshClosed(state) {
  const ui = paper.ui;
  const rows = state ? state.closed.slice(0, 8) : [];
  setShown(ui.closedSec, rows.length > 0);
  if (!rows.length) return;
  // The signature carries whether each row's rules are on hand, so the list is
  // redrawn at the right precision the moment the map arrives rather than
  // keeping the six-place fallback until something else happens to change.
  const sig = rows.map((c) => `${c.closedAt}:${c.coin}:${c.pnl}:${paperSpecFor(c.coin) ? 1 : 0}`)
    .join("|");
  // EVERY ROW AT ITS OWN ASSET'S TICK, not at this market's and not at six
  // places. This read `info`, the market the page is on, so a row belonging to
  // anything else fell through to pnum(.., 6): somebody on BTC saw "short
  // 30.6264 ETH at 2,761.005777 out 2,766", a price with six decimals on a
  // market that quotes in steps of 0.1. assetSpecs carries every listed perp's
  // szDecimals out of a response this panel already makes, so the precision for
  // another market's row is on hand and costs nothing to use.
  syncList(ui.closedList, sig, rows.map((c) => {
    const spec = paperSpecFor(c.coin);
    const px = (v) => (spec ? ppx(v, spec) : pnum(v, 6));
    // THE ENGINE'S SUM, NOT ONE WRITTEN AGAIN HERE.
    //
    // This rendered `c.pnl`, the gross move, under a heading saying what each
    // would have earned, while the ladder quoted closeValueAt's net figure for
    // the same price. Measured on 0.1 BTC at 10x: the ladder's take profit row
    // said +589.83 and closing there printed +598.20. The gap is the fees plus
    // the funding and it always ran in the flattering direction, so somebody
    // acted on the smaller number and was then shown the larger one.
    //
    // realisedValue is the fix, and calling it rather than writing the
    // subtraction at this call site is the point: two places writing the same
    // expression is how the two figures came apart in the first place. It
    // returns null rather than a partial figure when a stored row is missing
    // one of its three parts, so a row from an older build says it cannot be
    // totalled instead of quietly reporting a sum with its funding left out.
    //
    // A closed row carries ONE combined `fees` and has no entryFee or exitFee
    // of its own, so the closeValueAt pairing does not apply to it.
    const net = realisedValue(c);
    const fees = Number(c.fees);
    const funding = Number(c.funding);
    // The components beside the figure, not instead of it, so the distance
    // between the gross move and what it came to is visible rather than only
    // correct. Funding only when there was some: most practice positions are
    // closed inside the hour and a row of zeroes is noise.
    // The one case the tick is still unknown in: a coin the venue no longer
    // lists, or a list that has not been read yet. Six places, and the row says
    // which of those it is rather than leaving the extra decimals unexplained.
    const untick = spec ? "" : ` ${pesc(c.coin)} is not in the venue's current list of `
      + "perps, so these two prices are printed to six places rather than to its tick.";
    const parts = (net == null
      ? "This row was stored without all of its parts, so it cannot be totalled."
      : `${pesc(pmoney(c.pnl))} on the move, ${pesc(pmoney(-fees))} in fees`
        + (funding ? `, ${pesc(pmoney(-funding))} funding` : "")) + untick;
    const figure = net == null
      ? '<span class="tp-rest-na">not totalled</span>'
      : `<span class="${net >= 0 ? "tp-up" : "tp-down"}">${pesc(pmoney(net))}</span>`;
    return `
    <li>
      <span class="tp-rest-t">
        <span class="${c.side === "long" ? "tp-up" : "tp-down"}">${pesc(c.side)}</span>
        ${pesc(pnum(c.size, 6))} ${pesc(c.coin)}
        at ${pesc(px(c.entryPx))} out ${pesc(px(c.exitPx))}
        <span class="tp-rest-away">${parts}</span>
      </span>
      ${figure}
    </li>`;
  }).join(""));
}

// ── Reading the draft back out of the fields ────────────────────────────────

/** One field changed. Take that one value, leave the rest of the draft alone,
 *  and redraw everything derived from it. */
function onFieldInput(el) {
  const f = el.dataset.f;
  // Editing anything ON THE ORDER TICKET means the person is describing the
  // next order, not still reading about the last one. The history list keeps it
  // either way. The two level fields are not part of the ticket: they are about
  // a position that is already open, so marking a level does not wipe the
  // confirmation of the fill that opened it.
  const onTicket = f !== "stop" && f !== "target";
  if (onTicket) paper.outcome = null;
  if (f === "stop" || f === "target") {
    // Held as text until the person commits it by leaving the field, pressing
    // Enter, or pressing Clear. Committing on every keystroke would store 8 on
    // the way to 81200 and send the ladder somewhere nobody asked it to go.
    paper.draft[f] = el.value;
  } else if (f === "size") {
    // The box may be showing USD. What is stored is always the coin amount,
    // and el.value is left exactly as typed.
    paper.draft.size = coinSizeFrom(el.value);
  } else if (f === "px") {
    paper.draft.px = el.value;
  } else if (f === "levrange") {
    setLeverageChoice(el.value);
  } else if (f === "levnum") {
    setLeverageChoice(el.value);
    // THE ONE PLACE A FOCUSED FIELD IS WRITTEN, and it is what makes their
    // out-of-range behaviour visible. The value is ignored when it is outside
    // the range, so the box has to go back to the value that was kept or the
    // person is left looking at a number the control did not take. This follows
    // the person's own keystroke rather than a tick, which is the distinction
    // the focus rule is actually about. An empty box is left empty: it is the
    // only way to reach 0, and rewriting it to "0" would make it unclearable.
    if (String(el.value).trim() !== "") el.value = String(paper.lev.value || "");
  } else if (f === "tpPx" || f === "slPx") {
    // TYPING A PRICE RECOMPUTES ITS GAIN ON EVERY KEYSTROKE, which is theirs:
    // their `ne` sets the price and immediately writes the computed side. The
    // companion box is not the one with the caret in it, so writing it is not
    // writing under anybody's hands.
    paper.draft[f] = el.value;
    const which = f === "tpPx" ? "target" : "stop";
    const g = tpslGainFromPrice(which, el.value);
    const gk = f === "tpPx" ? "tpGain" : "slLoss";
    paper.draft[gk] = String(el.value).trim() === "" || g == null ? "" : String(g);
  } else if (f === "tpGain" || f === "slLoss") {
    // AND THE OTHER DIRECTION, the same way. Their `P` sets the price from the
    // number typed here and leaves this box holding exactly what was typed for
    // as long as it has the caret; the price it wrote is floored onto the
    // asset's grid. refreshTicketLevels puts the rounded price back into this
    // box once the caret leaves, so the pair ends agreeing with the price that
    // is actually held rather than with the one that was asked for.
    paper.draft[f] = el.value;
    const which = f === "tpGain" ? "target" : "stop";
    const pk = f === "tpGain" ? "tpPx" : "slPx";
    const px = tpslPriceFromGain(which, el.value);
    paper.draft[pk] = String(el.value).trim() === "" || px == null ? "" : String(px);
    setVal(which === "target" ? paper.ui.tpTicket.input : paper.ui.slTicket.input,
      paper.draft[pk]);
  } else if (f === "tpsl") {
    paper.draft.tpslOn = el.checked;
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
    if (sz != null) setSizeField(sz);
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
  // AN ORPHANED PAGE CANNOT KEEP A FILL, SO IT IS NOT GIVEN ONE.
  // With the extension reloaded out from under this page, every chrome.* call
  // throws and saveState writes nothing. Accepting an order here would move a
  // balance on screen, report a fill, and lose all of it the moment the page
  // reloads, which is the failure this panel exists to not perform quietly.
  // Closing a position is still allowed: it reduces what is at risk, and the
  // banner above says the outcome is not being kept either way.
  const save = paperSaveState();
  if (save.orphaned) {
    pushEvent({ ok: false, at: Date.now(),
      message: "Not placed. This page can no longer save anything.",
      detail: save.message });
    refresh(); return;
  }
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

  // THE TICKET'S TWO LEVELS ARE ANSWERED BEFORE THE ORDER GOES, NOT AFTER IT.
  // Opening a position and only then being told the stop belongs on the other
  // side of the entry leaves somebody holding something they opened for the
  // sake of a mark they cannot have. paperTicketLevels asks setPositionLevel
  // about the position this fill would leave behind, so the refusal here is the
  // same function's, one step earlier. A decision that is already a refusal
  // makes this null and falls through to the branch below.
  const ticketLevels = paperTicketLevels();
  if (ticketLevels.refusal) {
    const r = ticketLevels.refusal;
    pushEvent({ ok: false, at: Date.now(),
      message: `Not placed. ${r.message}`,
      detail: (r.detail ? r.detail + " " : "")
        + "Nothing was opened, because the mark you asked for cannot go on it." });
    await saveState(paper.state); refresh(); return;
  }

  if (!decision.ok) {
    pushEvent({ ok: false, message: decision.message, detail: decision.detail, at: decision.at });
    // THEIR ERROR PATH, WHICH IS NOT A DISABLED BUTTON. An order their form
    // cannot place at the current leverage is not refused at the button: you
    // press it, you get the error, and the leverage modal opens over the form
    // in its error state, because the leverage is the thing that would let the
    // order through. That interaction is copied here for the one refusal this
    // simulation has that leverage answers.
    //
    // THE SENTENCE IS OURS AND NOT THEIRS, because the direction of the fix is
    // the opposite one. Theirs is a margin-tier cap, where a lower leverage
    // allows a larger position; the first of those bounds is three million
    // dollars of notional and a ten thousand dollar practice account never
    // reaches one. Ours is running out of margin, where a HIGHER leverage puts
    // up less of it. Printing their words over our arithmetic would tell
    // somebody to move the slider the wrong way.
    if (decision.code === "margin") {
      // Saved first. openSheet renders, and the refusal is already in the
      // history list by then, so skipping the write would lose it.
      await saveState(paper.state);
      openSheet("leverage",
        "The practice account does not hold the margin this order needs at "
        + `${paperLeverage()}x. More leverage puts up less margin for the same `
        + "size, and a smaller size needs less of it.");
      return;
    }
  } else if (decision.kind === "rest") {
    paper.state.resting.push(decision.order);
    pushEvent({ ok: true, at: Date.now(),
      message: `Resting ${decision.order.side} ${decision.order.size} ${paper.coin} at ${decision.order.px}.`,
      detail: "It did not cross, so it is on the book. Whether it would fill is not "
              + "something public data can settle.",
      // The order itself is listed under Resting orders with its side, size and
      // price, and can be cancelled from there. This line is the record that it
      // did not cross, which is the part that section does not carry.
      log: {
        message: `${paper.coin} ${decision.order.side} did not cross, so it rests.`,
        detail: "Whether it would fill is not something public data can settle.",
      } });
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
    // THE TICKET'S MARKS GO ONTO THE POSITION HERE, BY THE SAME CALL THE
    // POSITION'S OWN FIELDS MAKE. They were checked against a copy of this
    // exact state a few lines above, so a refusal at this point would mean the
    // fill came out different from its preview; it is still handled, by saying
    // nothing was marked rather than by claiming something was.
    // ONLY WHAT THE TICKET ACTUALLY ASKED FOR. `want` is empty for a box that
    // still holds the mark the position already had, so placing an add without
    // touching the boxes writes nothing at all. See paperTicketLevels.
    const marked = { added: [], replaced: [] };
    if (d.tpslOn) {
      for (const which of ["stop", "target"]) {
        const px = ticketLevels.want[which];
        if (px == null) continue;
        let r = null;
        try { r = setPositionLevel(paper.state, paper.info, paper.coin, which, px); }
        catch (e) { r = null; }
        if (!r || !r.ok) continue;
        const word = which === "stop" ? "stop loss" : "take profit";
        const was = ticketLevels.held[which];
        // A CHANGE NAMES WHAT IT REPLACED. The seeding above makes the
        // destructive case rare rather than impossible: somebody can still type
        // over a mark they had set, and the sentence has to carry the price
        // that went as well as the one that arrived, or the loss is reported as
        // a success.
        //
        // The two kinds go in two sentences rather than one list. Threading a
        // replacement through the "is now marked on the position" clause
        // produced "Your stop loss moved from 83,001 to 83,786 is now marked on
        // the position", which is not a sentence.
        if (was != null) {
          marked.replaced.push(`your ${word} moved from ${ppx(was, paper.info)} `
            + `to ${ppx(px, paper.info)}`);
        } else {
          marked.added.push(`${word} at ${ppx(px, paper.info)}`);
        }
      }
    }
    const markedParts = [];
    if (marked.added.length) {
      markedParts.push(`Your ${marked.added.join(" and ")} `
        + `${marked.added.length > 1 ? "are" : "is"} now marked on the position.`);
    }
    if (marked.replaced.length) {
      const said = marked.replaced.join(", and ");
      markedParts.push(said.charAt(0).toUpperCase() + said.slice(1) + ".");
    }
    const markedSaid = markedParts.length
      ? " " + markedParts.join(" ") + " Nothing was sent to the venue."
      : "";
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
      detail: depth + clamped + aged + markedSaid,
      // What the history list keeps of this, which is the fee and the depth.
      // The size and the price are on the position this opened, or in the
      // closed list if it also closed one, and they are not said twice.
      log: {
        message: `${paper.coin} ${d.side} filled, fee ${pmoney(f.fee)}.`,
        detail: depth + clamped + aged,
      } });
    // The order went through, so the ticket is cleared the way an order ticket
    // is. This is a deliberate write to the size field and the only one
    // outside the slider: it follows the person's own click, not a tick.
    setSizeField("", true);
    if (d.tpslOn) {
      // NOT BLANKED. The boxes are seeded from the position's marks, so after a
      // fill they reload with whatever the position now carries: the pair just
      // written, or the pair that was already there if nothing was asked for.
      // Blanking them would mean the next add started from empty boxes, which
      // is the state the overwrite came out of. Both seed tokens are dropped so
      // the ticket and the position's own fields reload together.
      paper.tpslSeed = null;
      paper.levelSeed = null;
    }
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
    // WHAT THE CLOSE LEG COST IN DEPTH, WHICH WAS NOT SAID ANYWHERE. A fill
    // that opens a position reports the levels it took and how far the average
    // ran from the touch; the close leg reported neither, so the more expensive
    // half of a round trip was the silent one. Same sentence, same function's
    // numbers, on the leg that was missing it.
    const cf = decision.fill;
    const cslip = cf.slippageVsTouch;
    const cdepth = cf.levels.length > 1
      ? `It took ${cf.levels.length} levels of the book, ending at ${pnum(cf.worstPx, 6)}. `
        + `That is ${pnum(Math.abs(cslip), 6)} away from the touch, which is what depth costs.`
      : "It filled inside the first level of the book.";
    pushEvent({ ok: true, at: Date.now(),
      message: `Closed at ${ppx(cf.avgPx, paper.info)}.`,
      // The banner sits directly under the button, and the closed list is
      // further down the panel, so "below" is correct from where this is read.
      detail: "What it would have earned is in the list below. Nobody earned it.",
      // The round trip is one row in the closed list, with its entry, its exit,
      // its fees and its funding. This line is the fee on this leg and what the
      // book cost to get out, neither of which that row separates out.
      log: {
        message: `${paper.coin} close, fee ${pmoney(cf.fee)}.`,
        detail: cdepth,
      } });
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
  // WHICH MARKET THIS PASS IS ABOUT, captured before the first await.
  //
  // A pass that is waiting on the venue outlives a market change: the person
  // follows a link, paperSwitchCoin clears paper.info and starts a new pass,
  // and then the old pass's assetInfo resolves and writes the market they just
  // left into paper.info under the new market's name. Caught on a rendered
  // panel, moving from AVAX to BTC on a link in the other-positions list: the
  // ticket seeded itself from BTC's 20x position against AVAX's maximum of 10
  // and settled on 10x, with the line that explains the number absent because
  // by then the info was BTC's again and 10 was not what it would have said.
  // Everything else this pass writes is the same hazard one step quieter: a
  // mark, a liquidation price and a book belonging to another market.
  const forCoin = paper.coin;
  try {
    const info = await assetInfo(forCoin);
    if (paper.coin !== forCoin) return;   // the market moved under this pass
    paper.info = info;
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
      const book = await orderBook(forCoin);
      if (paper.coin !== forCoin) return;   // same hazard, same guard
      paper.book = book;
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

  // Every open position priced, off the response assetInfo has just put in the
  // cache. Last, so it sees the state a fill on this pass has already changed.
  // A failure leaves the previous read standing rather than blanking the
  // section: the rows carry their own marks and the next pass replaces them.
  try {
    const others = await paperReadOtherPositions();
    if (others) paper.others = others;
  } catch (e) { /* the previous read stands */ }

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
  // Hiding the panel with a sheet over it would bring the sheet back on top of
  // the ticket when it is opened again, which is not where anybody left off.
  if (!paper.open) clearSheet();
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

/** Show or hide the other markets' positions, and remember which it was.
 *
 *  Stored exactly the way the panel's own open state is: one key in
 *  chrome.storage.local, written on the click, read once at startup. */
async function setPaperOthersOpen(open) {
  paper.othersOpen = !!open;
  try { await chrome.storage.local.set({ [PAPER_OTHERS_KEY]: paper.othersOpen }); }
  catch (e) { /* the section still opens, it just will not be remembered */ }
  refresh();
}

/** Go to another market, through their own routing rather than around it.
 *
 *  MEASURED, NOT ASSUMED, on app.hyperliquid.xyz on 2026-09-21. A plain
 *  anchor click to /trade/ETH reloads the document: a marker set on window
 *  before the click was gone after it. history.pushState followed by a
 *  popstate event does not: the marker survived, their market header went from
 *  BTC-USDC to SOL-USDC and document.title from "86,041 | BTC | Hyperliquid"
 *  to "117.72 | SOL | Hyperliquid". So their router listens to popstate, and
 *  this is their own client-side navigation and not a page load dressed up.
 *
 *  If pushState ever throws, the href on the link is still the right URL and a
 *  full navigation is the correct fallback: slower, and it goes to the right
 *  place.
 */
function paperGoToMarket(coin) {
  if (!coin || coin === paper.coin) return;
  const path = "/trade/" + encodeURIComponent(coin);
  try {
    history.pushState(history.state, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  } catch (e) {
    location.href = path;
    return;
  }
  // Immediately, rather than waiting up to 700ms for the path watcher to
  // notice. The watcher then sees a path it has already caught up with and
  // does nothing, because the coin it reads is the one already held.
  paperSwitchCoin(coin);
}

function wirePaper(panel) {
  panel.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    const kind = act.dataset.act;
    if (kind === "shut") {
      await setPaperOpen(false);
    } else if (kind === "openlev") {
      openSheet("leverage", null);
    } else if (kind === "openmargin") {
      openSheet("margin", null);
    } else if (kind === "openacct") {
      openSheet("account", null);
    } else if (kind === "closesheet") {
      closeSheet();
    } else if (kind === "levok") {
      confirmLeverage();
    } else if (kind === "tpslunit") {
      // THE NUMBER CONVERTS, IT IS NOT REINTERPRETED. Theirs recomputes both
      // gain and loss from their prices the moment the setting flips, so 5%
      // becomes the dollar figure that same price is worth rather than $5.
      paper.draft.tpslNtl = !paper.draft.tpslNtl;
      for (const [which, pk, gk] of [["target", "tpPx", "tpGain"],
                                     ["stop", "slPx", "slLoss"]]) {
        const g = tpslGainFromPrice(which, paper.draft[pk]);
        paper.draft[gk] = g == null ? "" : String(g);
      }
      refresh();
    } else if (kind === "sizeunit") {
      // The person's own click, so the box is written even if it has focus.
      // The coin amount behind it does not move: only what is displayed does.
      paper.draft.sizeUnit = paper.draft.sizeUnit === "usd" ? "coin" : "usd";
      setSizeField(paper.draft.size, true);
      refresh();
    } else if (kind === "others") {
      await setPaperOthersOpen(!paper.othersOpen);
    } else if (kind === "goto") {
      // A modifier click, or anything that is not the primary button, is the
      // browser's to handle: that is how a person opens a market in a new tab,
      // and taking it over would be worse than not being a link at all.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      paperGoToMarket(act.dataset.coin);
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
    } else if (kind === "levelcoin") {
      // A different position's stop and take profit. The seed token is dropped
      // with it so the fields reload from the position being switched to rather
      // than keeping the last one's numbers under the new one's name.
      paper.levelCoin = act.dataset.coin;
      paper.levelSeed = null;
      refresh();
    } else if (kind === "lvlclear") {
      const k = act.dataset.k;
      paper.draft[k] = "";
      const el = k === "stop" ? paper.ui.stopLvl.input : paper.ui.targetLvl.input;
      if (el) el.value = "";
      await commitLevel(k, "");
    } else if (kind === "cancel") {
      paper.state.resting = paper.state.resting.filter((o) => o.id !== act.dataset.id);
      await saveState(paper.state); refresh();
    } else if (kind === "reset") {
      paper.state = await resetState();
      paper.draft.px = "";
      setSizeField("", true);
      if (paper.ui) paper.ui.price.input.value = "";
      // The sheet the button lives on has done its job. Left open it would sit
      // over the panel showing the account it has just emptied.
      paper.sheet = null;
      // The priced rows are a read of a state that no longer exists. Held on
      // to, they would list positions the reset has just closed for as long as
      // it takes the next tick to come round, which is a panel showing an
      // account that is not there. Emptied rather than left to expire.
      paper.others = [];
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

  // THE LEVERAGE BOX SELECTS ITS CONTENTS WHEN IT IS FOCUSED, AND WITHOUT THIS
  // THE SAME GESTURE PRODUCES A DIFFERENT NUMBER ON THE TWO FORMS.
  //
  // Their input primitive does `onFocus: t => { t.target.select() }`, and they
  // commit per keystroke with no range test on the way in. So on BTC, starting
  // at 20, clicking the box and typing three nines goes: the click selects 20,
  // the first 9 REPLACES it and commits, 99 is out of range and is ignored so
  // the display reverts to 9, the third the same. You end on 9.
  //
  // Without the select the first 9 APPENDS, giving 209, which is out of range
  // and ignored, and so are 2099 and 20999. You end on 20, having touched
  // nothing. Same finger, different leverage, and the divergence is invisible
  // to any test whose typing helper clears the field first: clearing is an
  // accidental emulation of their select, which is how this passed.
  //
  // focusin rather than focus, because focus does not bubble and this is one
  // delegated listener on the panel.
  panel.addEventListener("focusin", (e) => {
    const el = e.target;
    if (!el || !el.dataset || el.dataset.f !== "levnum") return;
    if (typeof el.select === "function") el.select();
  });

  // Leaving a level field is when it is committed, which is the one call that
  // writes to the position rather than to a copy. Committing per keystroke
  // would store every prefix of the number on the way to it.
  //
  // THE LEVERAGE CLAUSE THAT USED TO BE HERE IS GONE with the text box it was
  // about. It snapped a typed number into range on blur; there is nothing to
  // snap now, because the slider cannot leave the range and the modal's number
  // box refuses a value outside it instead of storing one.
  panel.addEventListener("focusout", (e) => {
    const el = e.target;
    if (!el || !el.dataset) return;
    if (el.dataset.f === "stop" || el.dataset.f === "target") {
      commitLevel(el.dataset.f, el.value);
      return;
    }
    // AN EMPTY LEVERAGE BOX IS LEFT EMPTY. This used to put the kept value back
    // when the box was blurred blank, which meant the 0 state with Confirm
    // disabled could not be left standing by clicking away. On their form it
    // can: their reconciliation guard evaluates false when the committed value
    // is 0 and the display is blank, so nothing is written back and the box
    // sits empty with the button refusing. Ours now does the same.
  });

  // Escape closes whichever sheet is over the panel, which is what a modal
  // does. It changes nothing: closing is not confirming.
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && paper.sheet) { e.preventDefault(); closeSheet(); }
  });

  // Enter submits from any text field, which is what an order ticket does.
  //
  // EXCEPT THE TWO LEVEL FIELDS. They are not the ticket. Enter in the stop
  // field placing a market order is the worst version of this panel guessing
  // what was meant, so there Enter commits the level and nothing else.
  panel.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const f = e.target.closest ? e.target.closest("[data-f]") : null;
    if (!f) return;
    e.preventDefault();
    if (f.dataset.f === "stop" || f.dataset.f === "target") {
      await commitLevel(f.dataset.f, f.value);
      return;
    }
    // AND NOT THE LEVERAGE MODAL EITHER. Enter in the box beside the slider is
    // Confirm, not "place the order behind this sheet". Submitting from inside
    // a modal the person opened to change a setting is the worst version of
    // this panel guessing what was meant.
    if (f.dataset.f === "levnum" || f.dataset.f === "levrange") {
      confirmLeverage();
      return;
    }
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
      // Absent means never chosen, and the default for this one is SHOWING.
      // `!== false` rather than a truthiness test, so a stored `false` is
      // honoured and a missing key is not read as a choice to hide it.
      const got = await chrome.storage.local.get(PAPER_OTHERS_KEY);
      paper.othersOpen = !(got && got[PAPER_OTHERS_KEY] === false);
    } catch (e) { paper.othersOpen = true; }
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
/** Move the panel to a different market.
 *
 *  Lifted out of the path watcher because the market links in the other
 *  positions list take this route too, and the two doing it differently is how
 *  a panel ends up showing one market's numbers under another market's name.
 */
function paperSwitchCoin(c) {
  if (!c || c === paper.coin) return;
  paper.coin = c;
  // The draft is about the old market. Prices and sizes do not carry across
  // assets with different ticks and lot sizes, so they are cleared, and this
  // is a market change rather than a tick so writing the fields is correct.
  paper.draft.px = "";
  setSizeField("", true);
  if (paper.ui) paper.ui.price.input.value = "";
  // A sheet open over the ticket is about the market being left. The leverage
  // one in particular carries that market's maximum and its own unconfirmed
  // number, so it is closed rather than re-pointed mid-choice, and it is
  // emptied as well so nothing of the old market is left parked in it.
  clearSheet();
  // Arriving at a market shows that market's position's levels when it has one.
  // A pick made on the market being left would otherwise outrank the one being
  // arrived at, and the picker is on screen to go back.
  paper.levelCoin = null;
  paper.levelSeed = null;
  // The ticket's two level boxes hold the last market's marks until they are
  // reseeded, and a price from another asset's grid in them is the one thing
  // they must never carry into an order.
  paper.tpslSeed = null;
  paper.draft.tpPx = ""; paper.draft.slPx = "";
  paper.draft.tpGain = ""; paper.draft.slLoss = "";
  if (paper.ui) {
    paper.ui.tpTicket.input.value = "";
    paper.ui.slTicket.input.value = "";
    paper.ui.tpTicket.gain.value = "";
    paper.ui.slTicket.gain.value = "";
  }
  // The ticket is about a different market now, so the leverage in it is about
  // to be re-seeded from whatever is open on THIS one. Clearing the token is
  // what lets that happen; without it the ticket would keep the last market's
  // number under the new market's name.
  paper.levSeed = null;
  // The new market's data has not been read yet, and the old market's must
  // not be shown as though it were this one's.
  paper.info = null; paper.infoAt = 0; paper.bookAt = 0;
  paper.book = { levels: [[], []] };
  paperFormEl = null; paperBookEl = null;
  // The list of other markets is one market out of date the instant the coin
  // changes: the one just left belongs in it and the one just arrived at does
  // not. refreshOthers filters on paper.coin, so this is right immediately and
  // the next tick re-prices it.
  refresh();
  tick();
}

let paperLastPath = null;
setInterval(() => {
  if (location.pathname === paperLastPath) return;
  paperLastPath = location.pathname;
  const c = paperCoinFromUrl();
  if (c && c !== paper.coin) {
    paperSwitchCoin(c);
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
