// content.js
//
// Puts one panel on Hyperliquid's address pages.
//
// WHY A CONTENT SCRIPT AND NOT ONLY A POPUP
// -----------------------------------------
// The thing being asked for is information about an address while you are
// looking at that address, and the app tells us which address that is: the
// route is /explorer/address/0x..., so the address is in the URL and needs no
// scraping. A popup would make you open a second surface to read something
// about the page already in front of you.
//
// The popup still exists, for the case the content script cannot cover: when
// you are not on an address page, and when you need to know whether the thing
// is working at all. See popup.js.
//
// WHAT THE APP IS, AND WHAT THAT FORCES
// -------------------------------------
// app.hyperliquid.xyz is a single-page app: one <div id="root">, client-side
// routing, and no document reload when you move between addresses. Two
// consequences, both handled below.
//
// Navigating from one address to another fires no load event, so the URL is
// watched rather than read once. And the content under the heading is rendered
// after the script runs, so the insertion point is waited for rather than
// assumed to exist.

const PANEL_ID = "tnega-hl-panel";
let currentAddress = null;
let inflight = null;

function panelHtml(state, data, address) {
  const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const icon = chrome.runtime.getURL("icons/hypurr-128.png");

  const head = `
    <div class="tnega-head">
      <img class="tnega-cat" src="${icon}" alt="" />
      <div class="tnega-head-text">
        <div class="tnega-title">Post-only rejection</div>
        <div class="tnega-sub">${shortAddr} &middot; measured by Tnega</div>
      </div>
      <a class="tnega-link" href="https://www.tnega.app/market" target="_blank" rel="noreferrer">Tnega</a>
    </div>`;

  if (state === "loading") {
    return `${head}<div class="tnega-body"><div class="tnega-muted">Reading measurements…</div></div>`;
  }

  if (state === "error") {
    return `${head}<div class="tnega-body">
      <div class="tnega-withheld-title">Cannot reach the measurements</div>
      <div class="tnega-muted">${data}</div>
      <div class="tnega-note">This is a connection problem, not a statement about the address.</div>
    </div>`;
  }

  const f = data.freshness;
  const p = data.post_only;

  // Withheld. Say which of the reasons it is, because they are different
  // situations and a single greyed-out number would flatten them into one.
  if (data.withheld_reason) {
    const w = WITHHELD[data.withheld_reason] || {
      title: "No rate available",
      body: "No rate is being shown for this address.",
    };
    return `${head}<div class="tnega-body">
      <div class="tnega-withheld-title">${w.title}</div>
      <div class="tnega-withheld-body">${w.body}</div>
      <div class="tnega-facts">
        <div><span>Polls stored</span><b>${fmtInt(f.polls)}</b></div>
        <div><span>Newest order seen</span><b>${fmtAge(f.newest_record_age_seconds)}</b></div>
        <div><span>Post-only orders seen</span><b>${fmtInt(p.alo_total)}</b></div>
      </div>
      <div class="tnega-note">No rate is shown rather than a rate you cannot rely on.</div>
    </div>`;
  }

  const band = BANDS[p.band] || { label: p.band || "", colour: T.mint, body: "" };
  return `${head}<div class="tnega-body">
    <div class="tnega-rate-row">
      <div class="tnega-rate" style="color:${band.colour}">${fmtPct(p.rejection_rate)}</div>
      <div class="tnega-band" style="border-color:${band.colour};color:${band.colour}">${band.label}</div>
    </div>
    <div class="tnega-band-body">${band.body}</div>
    <div class="tnega-facts">
      <div><span>Post-only rejected</span><b>${fmtInt(p.alo_rejected)} of ${fmtInt(p.alo_total)}</b></div>
      <div><span>Polls stored</span><b>${fmtInt(f.polls)}</b></div>
      <div><span>Newest order seen</span><b>${fmtAge(f.newest_record_age_seconds)}</b></div>
    </div>
    <div class="tnega-note">
      A rejected post-only order never rests on the book, so it provides no liquidity and
      leaves no trace in fills or volume.
    </div>
  </div>`;
}

function ensurePanel() {
  let el = document.getElementById(PANEL_ID);
  if (el) return el;
  el = document.createElement("section");
  el.id = PANEL_ID;
  el.className = "tnega-panel";
  return el;
}

/** Where the panel goes: between the "Address 0x…" title and the transactions
 *  card, which is where a reader is already looking.
 *
 *  ANCHORED ON TEXT AND STRUCTURE, NOT ON CLASS NAMES
 *  The page was read before this was written. There is exactly one heading
 *  element on it and its text is "Event", so the large "Address 0x…" title is
 *  not a heading at all and a h1/h2/h3 search finds nothing. Every class here
 *  is a styled-components hash of the form `sc-idXgbr cbNIEr`, which changes
 *  on their next deploy, so keying on one would work until it silently did
 *  not.
 *
 *  What is stable is that the card carries the full address as the entire text
 *  of one leaf element. From there, walking up while each parent has a single
 *  child reaches the outermost node of that card, and its parent is the page
 *  container that also holds the title. Inserting before that node puts the
 *  panel exactly between the two.
 */
function insertionPoint(address) {
  const leaf = Array.from(document.querySelectorAll("div, span, p")).find(
    (n) => n.children.length === 0 &&
      (n.textContent || "").trim().toLowerCase() === address
  );
  if (leaf) {
    // Climb out of the card. Stopping at the first parent with more than one
    // child is not enough: that parent is the card's own contents, whose three
    // children are the address line, the table and the pager, and inserting
    // there would put the panel inside their card above the address. The card
    // has been left behind only once the parent's first child no longer
    // contains the address, which is the point where the earlier sibling is
    // the breadcrumb and title instead. Depth-capped so a layout this does not
    // recognise cannot walk to <body>.
    let node = leaf;
    for (let i = 0; i < 12 && node.parentElement; i++) {
      const parent = node.parentElement;
      const firstText = (
        (parent.firstElementChild && parent.firstElementChild.textContent) || ""
      ).toLowerCase();
      if (parent.children.length === 1 || firstText.includes(address)) {
        node = parent;
        continue;
      }
      return { parent: parent, before: node };
    }
  }

  // Their layout changed. Degrade to a panel in a worse place rather than to
  // no panel, and never guess at a position that might land inside a table.
  const root = document.getElementById("root");
  if (root && root.firstElementChild) {
    return { parent: root.firstElementChild, before: null };
  }
  return null;
}

function place(el, address) {
  if (el.isConnected) return true;
  const point = insertionPoint(address);
  if (!point) return false;
  if (point.before) {
    point.parent.insertBefore(el, point.before);
  } else {
    point.parent.appendChild(el);
  }
  return true;
}

async function render(address) {
  const el = ensurePanel();
  el.innerHTML = panelHtml("loading", null, address);

  // The heading is rendered after this script runs, so wait for it rather than
  // giving up. Ten seconds is generous; a slow route change is common here.
  let placed = place(el, address);
  if (!placed) {
    const started = Date.now();
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (place(el, address) || Date.now() - started > 10000) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
  }

  const token = {};
  inflight = token;
  try {
    const data = await fetchAddress(address);
    if (inflight !== token) return; // a newer address won the race
    el.innerHTML = panelHtml("ready", data, address);
  } catch (e) {
    if (inflight !== token) return;
    el.innerHTML = panelHtml("error", String(e.message || e), address);
  }
}

function sync() {
  const address = addressFromUrl(location.href);
  if (address === currentAddress) return;
  currentAddress = address;
  const existing = document.getElementById(PANEL_ID);
  if (!address) {
    if (existing) existing.remove();
    return;
  }
  if (existing) existing.remove();
  render(address);
}

// Client-side routing fires no load event, so the URL is polled. An interval
// rather than a MutationObserver on purpose: the app re-renders constantly and
// an observer here would run thousands of times a minute to answer a question
// that is one string comparison.
sync();
setInterval(sync, 700);
