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

// The quiet way out of the panel. One address is the question a reader
// arrived with; the tracked set and the coverage behind it are the context
// that says how much this number is worth, and both live on the Hyperliquid
// tab at tnega.app. Written as a line of text rather than a button: it should
// read as available to someone who wants it, not as the next thing to do.
//
// /chain/hyperliquid is a real address for that tab, added alongside this in
// ChainViewTabs.jsx. An unrecognised path on the site resolves to the
// marketplace, so this degrades to the site's front door rather than to a
// dead link.
const FOOT = `
    <div class="tnega-foot">
      <a href="https://www.tnega.app/chain/hyperliquid" target="_blank" rel="noreferrer">
        The rest of the tracked set, and the coverage behind it, on Tnega
      </a>
    </div>`;

// WHOSE MARK GOES WHERE
//
// Hypurr is Hyperliquid's mascot, not ours, and the split follows from that.
// It appears here, inside a panel that describes Hyperliquid order data on
// Hyperliquid's own site, which is nominative use: it says what the panel is
// about. It is not the extension's identity. The toolbar icon, the popup
// header, the store listing and the packaged icons are all Tnega's mark,
// because those are the places the software identifies itself rather than
// its subject. Publishing another company's mascot as the face of this
// product would be a trademark question rather than a design one.

// The other half of the sentence: where this address stands on HyperCore right
// now, read on chain 999 through the HyperCoreReader contract.
//
// Two clocks, never merged. The rejection rate above is measured over hours of
// polling; this is one block, a second or so old. They are shown one under the
// other, with their own timestamps, and no figure is ever computed across the
// two.
//
// Drawn only when the backend actually served it. When the reader is not
// configured the block is absent rather than present-and-empty: this panel is
// about the rejection rate, and an addition that could not be read is not a
// finding about the address.
function coreHtml(core) {
  if (!core || !core.served) return "";

  const markets = (core.markets_checked || []).join(", ");
  const positions = core.positions || [];

  if (!core.account_found) {
    return `<div class="tnega-core">
      <div class="tnega-core-title">On HyperCore, read on chain</div>
      <div class="tnega-muted">Nothing found for this address on ${esc(markets)}.
        That is not the same as flat: an account that closed out and withdrew
        everything reads exactly like one that never existed.</div>
    </div>`;
  }

  const rows = positions.map((p) => {
    const side = p.side === "short" ? "Short" : "Long";
    const size = Math.abs(p.size).toLocaleString(undefined, { maximumFractionDigits: 4 });
    const pnl = p.unrealised_usd;
    const sign = pnl >= 0 ? "+" : "−";
    const money = Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 0 });
    return `<div class="tnega-core-row">
      <span>${esc(side)} ${esc(size)} ${esc(p.coin)}</span>
      <b>${esc(sign + "$" + money)}</b>
    </div>
    <div class="tnega-core-sub">entry ${esc(fmtUsd(p.entry_price))} &middot; mark ${esc(fmtUsd(p.mark_price))}</div>`;
  }).join("");

  const flat = positions.length === 0
    ? `<div class="tnega-muted">An account exists, with no position on ${esc(markets)}.</div>`
    : "";

  return `<div class="tnega-core">
    <div class="tnega-core-title">On HyperCore, read on chain</div>
    ${rows}${flat}
    <div class="tnega-core-foot">HyperCore block ${esc(String(core.core_block || ""))},
      read through a contract on HyperEVM. Checked on ${esc(markets)} only.
      This is now; the rate above is measured over hours.</div>
  </div>`;
}

function fmtUsd(v) {
  if (v === null || v === undefined) return "n/a";
  return "$" + Number(v).toLocaleString(undefined, {
    maximumFractionDigits: v < 10 ? 4 : 2,
  });
}

/** What kind of account this is. Drawn above the rate on every reading,
 *  including a withheld one, because it is what says whether the number
 *  describes a person, a pooled strategy, or an account nobody can attribute.
 *  See accountBlock in shared.js for why it appears even when the answer is
 *  "not established". */
function accountHtml(account) {
  const a = accountBlock(account);
  if (!a) return "";
  return `<div class="tnega-acct tnega-acct-${esc(a.kind)}">
    <div class="tnega-acct-title">${esc(a.title)}</div>
    <div class="tnega-acct-body">${esc(a.body)}</div>
  </div>`;
}

/** What the account holds, drawn only when there is no rate.
 *
 *  It answers the question a withheld rate leaves open, which is why this
 *  address is silent, without answering the question the data cannot: what
 *  the address is for. See holdingsLines in shared.js for the measurement
 *  that ruled the second one out.
 */
/** The venue's own figures, drawn where this project has no rate.
 *
 *  Kept visually distinct from everything else on the panel and headed with
 *  whose numbers they are. The panel's other blocks are this project's
 *  measurements; this one is a cached copy of a file Hyperliquid publishes,
 *  and a reader who cannot tell them apart is being misled about provenance
 *  even when every figure is correct.
 *
 *  The last line is not decoration. An address is selected into the measured
 *  set by 30-day volume and by whether it still posts resting orders, never
 *  by how it performs, and a PnL figure sitting under the words "not in our
 *  measured set" invites exactly the opposite reading.
 */
function venueHtml(vl) {
  const lines = venueLeaderboardLines(vl);
  if (!lines.length) return "";
  return `<div class="tnega-venue">
    <div class="tnega-venue-title">Hyperliquid's own figures for this address</div>
    ${lines.map((l) => `<div class="tnega-venue-line">${esc(l)}</div>`).join("")}
    <div class="tnega-note">${esc(
      "From the venue's public leaderboard, cached daily. Tnega measures none of "
      + "it. Addresses enter our measured set by 30-day volume and by still "
      + "posting resting orders, never by how they perform.")}</div>
  </div>`;
}

function holdingsHtml(h, kind) {
  const lines = holdingsLines(h, kind);
  if (!lines.length) return "";
  return `<div class="tnega-holdings">
    <div class="tnega-holdings-title">What this account holds</div>
    ${lines.map((l) => `<div class="tnega-holdings-line">${esc(l)}</div>`).join("")}
    <div class="tnega-note">${esc(h.note || "")}</div>
  </div>`;
}

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
    return `${head}<div class="tnega-body"><div class="tnega-muted">Reading measurements…</div></div>${FOOT}`;
  }

  if (state === "error") {
    return `${head}<div class="tnega-body">
      <div class="tnega-withheld-title">Cannot reach the measurements</div>
      <div class="tnega-muted">${esc(data)}</div>
      <div class="tnega-note">This is a connection problem, not a statement about the address.</div>
    </div>${FOOT}`;
  }

  // Defaulted, not assumed. An address that is on the venue's leaderboard but
  // outside our measured set answers with a reason and no freshness or
  // post_only at all, and reading .polls off undefined threw before the panel
  // rendered anything. The panel a reader saw was blank because of an
  // exception, which is the literal version of "reads as broken".
  const f = data.freshness || {};
  const p = data.post_only || {};

  // Withheld. Say which of the reasons it is, because they are different
  // situations and a single greyed-out number would flatten them into one.
  if (data.withheld_reason) {
    const w = WITHHELD[data.withheld_reason] || {
      title: "No rate available",
      body: "No rate is being shown for this address.",
    };
    return `${head}<div class="tnega-body">
      ${accountHtml(data.account)}
      <div class="tnega-withheld-title">${w.title}</div>
      <div class="tnega-withheld-body">${w.body}</div>
      ${f.polls === undefined && p.alo_total === undefined ? "" : `
      <div class="tnega-facts">
        <div><span>Polls stored</span><b>${fmtInt(f.polls)}</b></div>
        <div><span>Newest order seen</span><b>${fmtAge(f.newest_record_age_seconds)}</b></div>
        <div><span>Post-only orders seen</span><b>${fmtInt(p.alo_total)}</b></div>
      </div>`}
      ${f.polls === undefined ? "" : `<div class="tnega-note">No rate is shown rather than a rate you cannot rely on.</div>`}
      ${venueHtml(data.venue_leaderboard)}
      ${holdingsHtml(data.holdings, (accountBlock(data.account) || {}).kind)}
      ${coreHtml(data.core)}
    </div>${FOOT}`;
  }

  const band = BANDS[p.band] || { label: esc(p.band || ""), colour: T.mint, body: "" };
  return `${head}<div class="tnega-body">
    ${accountHtml(data.account)}
    <div class="tnega-rate-row">
      <div class="tnega-rate" style="color:${band.colour}">${fmtPct(p.rejection_rate)}</div>
      <div class="tnega-band" style="border-color:${band.colour};color:${band.colour}">${band.label}</div>
    </div>
    <div class="tnega-band-body">${band.body}</div>
    ${data.rate_series ? `<div class="tnega-spark">
      <div class="tnega-spark-label">Last ${data.rate_series.rates.length} hours</div>
      ${rateSparklineSvg(data.rate_series)}
    </div>` : ""}
    <div class="tnega-facts">
      <div><span>Post-only rejected</span><b>${fmtInt(p.alo_rejected)} of ${fmtInt(p.alo_total)}</b></div>
      <div><span>Polls stored</span><b>${fmtInt(f.polls)}</b></div>
      <div><span>Newest order seen</span><b>${fmtAge(f.newest_record_age_seconds)}</b></div>
    </div>
    <div class="tnega-note">
      A rejected post-only order never rests on the book, so it provides no liquidity and
      leaves no trace in fills or volume.
    </div>
    <div class="tnega-note">
      This does not say whether the address is any good or making money. A low rate means
      its quotes reach the book, which is what quoting looks like rather than a score. The
      tracked set holds addresses that quote cleanly and lose, and addresses refused
      constantly that gain.
    </div>
    ${coreHtml(data.core)}
  </div>${FOOT}`;
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
function insertionPoint(address, allowFallback) {
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

  // No anchor yet. Two different situations share this line: their card has
  // not rendered, which is a matter of milliseconds, and their layout has
  // changed, which is permanent. The caller tells them apart by waiting, and
  // only passes allowFallback once it has waited long enough that "not yet"
  // has stopped being a plausible explanation.
  //
  // Found by the store capture, 2026-09-15. On a cold load the fallback won
  // every time: it produces a visible panel on the first try, place() counts
  // visible as placed, and the retry loop it was meant to keep running stops.
  // The panel then sat above Hyperliquid's own header for the life of the
  // page, which is the worst position available and was being chosen by
  // default rather than in extremis.
  if (!allowFallback) return null;

  // Their layout changed. Degrade to a panel in a worse place rather than to
  // no panel.
  //
  // As the FIRST CHILD OF #root, not appended into whatever #root's first
  // child happens to be. That earlier version put the panel inside an <img>:
  // during their initial render the first child is an image, a void element
  // accepts the node into the DOM without complaint, and it then renders at
  // zero by zero forever. Nothing threw and the panel was "placed".
  const root = document.getElementById("root");
  if (root) {
    return { parent: root, before: root.firstElementChild };
  }
  return null;
}

function place(el, address, allowFallback) {
  // Connected is not the same as visible, which is the lesson from the <img>
  // case above. A panel with no height is in the document and on nobody's
  // screen, so it does not count as placed and the caller keeps retrying until
  // the real anchor appears.
  if (el.isConnected && el.getBoundingClientRect().height > 0) return true;
  if (el.isConnected) el.remove();

  const point = insertionPoint(address, allowFallback);
  if (!point) return false;
  if (point.before) {
    point.parent.insertBefore(el, point.before);
  } else {
    point.parent.appendChild(el);
  }
  return el.getBoundingClientRect().height > 0;
}

async function render(address) {
  const el = ensurePanel();
  el.innerHTML = panelHtml("loading", null, address);

  // The card is rendered after this script runs, so wait for it rather than
  // giving up. Ten seconds is generous; a slow route change is common here.
  //
  // The fallback is withheld for that whole window. Offering it on the first
  // attempt made it the usual outcome rather than the last resort, because it
  // always succeeds and success ends the wait.
  if (!place(el, address, false)) {
    const started = Date.now();
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        const waitedLongEnough = Date.now() - started > 10000;
        if (place(el, address, waitedLongEnough) || waitedLongEnough) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
  }

  const attempt = {};
  inflight = attempt;
  try {
    const data = await fetchAddress(address);
    if (inflight !== attempt) return; // a newer address won the race
    el.innerHTML = panelHtml("ready", data, address);
  } catch (e) {
    if (inflight !== attempt) return;
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
