// paper.js
//
// Practice mode's panel. paperSim.js decides what a trade would have done;
// this draws it, and puts it below Hyperliquid's own orders section.
//
// WHERE IT GOES, AND WHY IT IS NOT A querySelector ON A CLASS NAME
// Rendered before writing any of this, twice, at 1280 and at 390. What the
// page actually is:
//
//   At 1280 the trading view is a react-grid-layout. Seven absolutely
//   positioned, draggable, resizable items. The orders section is one of
//   them, 909 wide at left 3, and the left column ENDS at its bottom edge:
//   the space below it is empty, which is where this belongs. Appending a
//   plain child to that grid would put it at 0,0 on top of the chart, because
//   react-grid-layout positions its own children by transform and knows
//   nothing about a foreign one.
//
//   At 390 there is no grid at all. `document.querySelector('.react-grid-
//   layout')` returns null and the sections are ordinary stacked blocks.
//
//   Every class name on the page is a styled-components hash: sc-bjfHbI,
//   jFothj. Those change on their next build. The only stable thing about the
//   orders section is its own vocabulary, the tab labels Balances, Positions,
//   Open Orders, TWAP, Trade History, Funding History, Order History. That is
//   what this anchors on, the same way the address panel had to learn to.
//
// So: find the strip by its words, walk up to the section, and then take one
// of two routes depending on whether a grid is there. If neither works, fall
// back to the page's scroll container rather than drawing nothing.

const PAPER_PANEL_ID = "tnega-paper-panel";
const PAPER_MIN_KEY = "tnega_paper_minimised";

const ORDERS_TAB_WORDS = [
  "Balances", "Positions", "Open Orders", "TWAP",
  "Trade History", "Funding History", "Order History",
];

/** The smallest element carrying most of the orders section's own vocabulary. */
function findOrdersStrip() {
  let strip = null, smallest = Infinity;
  const nodes = document.querySelectorAll("div,ul,nav");
  for (const el of nodes) {
    const text = (el.textContent || "").trim();
    if (text.length > 400) continue;           // a container, not the strip
    let hits = 0;
    for (const w of ORDERS_TAB_WORDS) if (text.includes(w)) hits++;
    if (hits < 5) continue;
    const h = el.getBoundingClientRect().height;
    if (h > 0 && h < smallest) { smallest = h; strip = el; }
  }
  return strip;
}

/** From the strip, the section box: the grid item at 1280, or the nearest
 *  block that owns the whole section at 390. Bounded ascent, because an
 *  unbounded one ends at <body> and takes the whole page with it. */
function findOrdersSection(strip) {
  let el = strip, guard = 0;
  while (el && el !== document.body && guard++ < 8) {
    if (el.classList && el.classList.contains("react-grid-item")) return el;
    el = el.parentElement;
  }
  // No grid item above it: the narrow layout. Take the tallest ancestor that
  // is still about this section rather than about the page.
  el = strip; guard = 0;
  let best = strip;
  while (el && el !== document.body && guard++ < 6) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > best.getBoundingClientRect().height) best = el;
    el = el.parentElement;
  }
  return best;
}

/** Put the panel below the orders section and keep it there.
 *
 *  Returns the mode used, or null if nothing could be found, so the caller can
 *  say which route it took rather than leaving it a mystery.
 */
function placePaperPanel(panel) {
  const strip = findOrdersStrip();
  if (!strip) return null;
  const section = findOrdersSection(strip);
  if (!section) return null;

  const grid = section.closest && section.closest(".react-grid-layout");

  if (grid && section.classList.contains("react-grid-item")) {
    // Wide layout. Live inside the grid's coordinate space, aligned to the
    // orders item, and re-align whenever that item moves or resizes: it is
    // draggable, so it will.
    panel.dataset.tnegaPlacement = "grid";
    panel.style.position = "absolute";
    if (panel.parentElement !== grid) grid.appendChild(panel);

    const align = () => {
      if (!panel.isConnected) return;
      const g = grid.getBoundingClientRect();
      const s = section.getBoundingClientRect();
      const top = s.bottom - g.top + 8;
      panel.style.left = `${Math.round(s.left - g.left)}px`;
      panel.style.top = `${Math.round(top)}px`;
      panel.style.width = `${Math.round(s.width)}px`;
      // react-grid-layout sets an explicit height. Without this the panel is
      // below the container's own box and the scroller will not reach it.
      const needed = Math.ceil(top + panel.offsetHeight + 16);
      const current = parseFloat(grid.style.height) || 0;
      if (needed > current) grid.style.minHeight = `${needed}px`;
    };
    align();
    try {
      const ro = new ResizeObserver(align);
      ro.observe(section);
      ro.observe(panel);
      new MutationObserver(align).observe(section, {
        attributes: true, attributeFilter: ["style", "class"],
      });
    } catch (e) { /* observers unavailable: the one-off align still ran */ }
    window.addEventListener("resize", align, { passive: true });
    return "grid";
  }

  // Narrow layout, or a grid that is not there any more. An ordinary sibling
  // directly after the section is exactly "below the orders section" here.
  panel.dataset.tnegaPlacement = "flow";
  panel.style.position = "static";
  panel.style.width = "auto";
  if (section.parentElement) {
    section.parentElement.insertBefore(panel, section.nextSibling);
    return "flow";
  }
  return null;
}

/** Last resort: the page's own scroll container, so the panel exists even if
 *  the orders section was renamed out from under this entirely. */
function placeFallback(panel) {
  const host = document.querySelector(".main-page-scroller") || document.body;
  panel.dataset.tnegaPlacement = "fallback";
  panel.style.position = "static";
  panel.style.width = "auto";
  host.appendChild(panel);
}

// ── Matching their theme by reading it, not by hardcoding it ────────────────
//
// Hyperliquid renders dark today: body is rgb(48,48,48) on white text, with no
// data-theme attribute and no class to read a light mode from. Rather than
// hardcode that and break the day they ship one, the panel takes its palette
// from what the page computes for itself and derives the rest.

function readVenueTheme() {
  const cs = getComputedStyle(document.body);
  const bg = cs.backgroundColor || "rgb(24,24,24)";
  const fg = cs.color || "rgb(255,255,255)";
  const rgb = (s) => {
    const m = String(s).match(/\d+(\.\d+)?/g);
    return m ? m.slice(0, 3).map(Number) : [24, 24, 24];
  };
  const [r, g, b] = rgb(bg);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const dark = luminance < 0.5;
  const shift = (amt) => `rgb(${[r, g, b].map((c) =>
    Math.max(0, Math.min(255, Math.round(c + (dark ? amt : -amt))))).join(",")})`;
  return {
    dark,
    bg: shift(8),
    bgRaised: shift(16),
    border: dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.12)",
    fg,
    muted: dark ? "rgba(255,255,255,.55)" : "rgba(0,0,0,.55)",
    font: cs.fontFamily,
    long: "#1fa67d",
    short: "#e5484d",
    accent: "#50d2c1",
  };
}

function applyTheme(panel, t) {
  const s = panel.style;
  s.setProperty("--tp-bg", t.bg);
  s.setProperty("--tp-raised", t.bgRaised);
  s.setProperty("--tp-border", t.border);
  s.setProperty("--tp-fg", t.fg);
  s.setProperty("--tp-muted", t.muted);
  s.setProperty("--tp-font", t.font);
  s.setProperty("--tp-long", t.long);
  s.setProperty("--tp-short", t.short);
  s.setProperty("--tp-accent", t.accent);
}

// ── Rendering ───────────────────────────────────────────────────────────────

// NOT `esc`. shared.js already declares one at top level, and every file in a
// content_scripts entry shares one global lexical environment, so a second
// `const esc` is a redeclaration that throws and takes this whole file with it.
// Caught by loading the extension and finding no panel at all.
const pesc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const money = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US",
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const num = (n, d = 4) => Number(n).toLocaleString("en-US",
  { minimumFractionDigits: 0, maximumFractionDigits: d });

/** A price, shown at the precision the venue itself allows for that asset.
 *  A derived number printed to more decimals than the tick supports reads as
 *  more precise than the venue can even express: the liquidation price came
 *  out as 65,455.797468 on a market whose tick is 0.1. */
const pxs = (n, info) => {
  const r = roundPrice(Number(n), info.szDecimals);
  return isFinite(r) ? num(r, Math.max(0, 6 - info.szDecimals)) : "n/a";
};

/** The coin is in the path, /trade/BTC, so it is read from the URL and not
 *  from the page. Same rule the address panel follows. */
function coinFromUrl() {
  const m = location.pathname.match(/^\/trade\/([A-Za-z0-9:@_-]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// The header. It says the same thing in every state the panel can be in,
// including minimised, which is the point of it.
const PAPER_HEADER = "Simulation environment provided by Tnega &mdash; Paper trading";

function headerHtml(minimised, balance) {
  return `
    <div class="tp-head">
      <span class="tp-mark">${PAPER_HEADER}</span>
      <span class="tp-spacer"></span>
      ${balance != null ? `<span class="tp-bal">${pesc(money(balance))}</span>` : ""}
      <button class="tp-min" type="button" aria-expanded="${!minimised}"
        title="${minimised ? "Open practice mode" : "Minimise practice mode"}">
        ${minimised ? "Open" : "Minimise"}
      </button>
    </div>`;
}

function ticketHtml(info, book, fees, draft) {
  const bids = (book.levels && book.levels[0]) || [];
  const asks = (book.levels && book.levels[1]) || [];
  const bid = bids.length ? Number(bids[0].px) : null;
  const ask = asks.length ? Number(asks[0].px) : null;
  const isLimit = draft.type === "limit";
  return `
    <div class="tp-ticket">
      <div class="tp-row tp-sides">
        <button type="button" data-act="side" data-v="buy"
          class="tp-side tp-buy ${draft.side === "buy" ? "on" : ""}">Buy / Long</button>
        <button type="button" data-act="side" data-v="sell"
          class="tp-side tp-sell ${draft.side === "sell" ? "on" : ""}">Sell / Short</button>
      </div>
      <div class="tp-row tp-types">
        <button type="button" data-act="type" data-v="market"
          class="tp-tab ${!isLimit ? "on" : ""}">Market</button>
        <button type="button" data-act="type" data-v="limit"
          class="tp-tab ${isLimit ? "on" : ""}">Limit</button>
      </div>
      <label class="tp-field">
        <span>Size (${pesc(info.coin)})</span>
        <input type="text" inputmode="decimal" data-f="size" value="${pesc(draft.size)}" />
      </label>
      ${isLimit ? `
      <label class="tp-field">
        <span>Price</span>
        <input type="text" inputmode="decimal" data-f="px" value="${pesc(draft.px)}" />
      </label>` : ""}
      <label class="tp-field">
        <span>Leverage (max ${info.maxLeverage}x)</span>
        <input type="text" inputmode="numeric" data-f="leverage" value="${pesc(draft.leverage)}" />
      </label>
      <div class="tp-row tp-checks">
        ${isLimit ? `<label class="tp-check"><input type="checkbox" data-f="postOnly"
          ${draft.postOnly ? "checked" : ""} /> Post-only</label>` : ""}
        <label class="tp-check"><input type="checkbox" data-f="reduceOnly"
          ${draft.reduceOnly ? "checked" : ""} /> Reduce-only</label>
      </div>
      <button type="button" class="tp-submit ${draft.side === "buy" ? "tp-buy" : "tp-sell"}"
        data-act="submit">Place ${pesc(draft.type)} ${draft.side === "buy" ? "buy" : "sell"}</button>
      <div class="tp-touch">
        Best bid ${bid != null ? pesc(num(bid, 6)) : "n/a"} &middot;
        best ask ${ask != null ? pesc(num(ask, 6)) : "n/a"} &middot;
        taker ${(fees.taker * 100).toFixed(4)}% &middot; maker ${(fees.maker * 100).toFixed(4)}%
      </div>
    </div>`;
}

function positionHtml(state, info) {
  const pos = state.positions[info.coin];
  if (!pos) {
    return `<div class="tp-empty">No open ${pesc(info.coin)} position.</div>`;
  }
  const up = unrealised(pos, info.markPx);
  const liq = liquidationPrice(pos, info);
  const cls = up >= 0 ? "tp-up" : "tp-down";
  return `
    <table class="tp-table">
      <tr><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th>
          <th>Would be worth</th><th>Liquidation</th><th>Funding</th><th></th></tr>
      <tr>
        <td class="${pos.side === "long" ? "tp-up" : "tp-down"}">${pesc(pos.side)} ${pos.leverage}x</td>
        <td>${pesc(num(pos.size, 6))}</td>
        <td>${pesc(pxs(pos.entryPx, info))}</td>
        <td>${pesc(pxs(info.markPx, info))}</td>
        <td class="${cls}">${pesc(money(up))}</td>
        <td>${liq ? pesc(pxs(liq, info)) : "n/a"}</td>
        <td>${pesc(money(-(pos.fundingPaid || 0)))}</td>
        <td><button type="button" class="tp-close" data-act="close">Close</button></td>
      </tr>
    </table>`;
}

function restingHtml(state, info) {
  const rows = state.resting.filter((o) => o.coin === info.coin);
  if (!rows.length) return "";
  return `
    <div class="tp-sub">Resting orders</div>
    <table class="tp-table">
      <tr><th>Side</th><th>Size</th><th>Price</th><th>Distance to mark</th><th></th></tr>
      ${rows.map((o) => `
        <tr>
          <td class="${o.side === "buy" ? "tp-up" : "tp-down"}">${pesc(o.side)}${o.postOnly ? " (post-only)" : ""}</td>
          <td>${pesc(num(o.size, 6))}</td>
          <td>${pesc(pxs(o.px, info))}</td>
          <td>${pesc(pxs(Math.abs(info.markPx - o.px), info))}</td>
          <td><button type="button" class="tp-x" data-act="cancel" data-id="${pesc(o.id)}">Cancel</button></td>
        </tr>`).join("")}
    </table>
    <p class="tp-note">A resting order is not filled when the mark touches it. It fills
    only once the mark has gone clear through the level, and that is an assumption this
    panel is making, not something the public data settles. Queue position is not public.</p>`;
}

function eventsHtml(state) {
  if (!state.events.length) return "";
  return `
    <div class="tp-sub">What happened</div>
    <ul class="tp-events">
      ${state.events.slice(0, 6).map((e) => `
        <li class="${e.ok ? "tp-ev-ok" : "tp-ev-no"}">
          <span class="tp-ev-h">${pesc(e.message)}</span>
          ${e.detail ? `<span class="tp-ev-d">${pesc(e.detail)}</span>` : ""}
        </li>`).join("")}
    </ul>`;
}

function historyHtml(state) {
  if (!state.closed.length) return "";
  return `
    <div class="tp-sub">Closed, and what each would have earned</div>
    <table class="tp-table">
      <tr><th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Exit</th>
          <th>Would have earned</th><th>Fees</th><th>Funding</th></tr>
      ${state.closed.slice(0, 12).map((c) => `
        <tr>
          <td>${pesc(c.coin)}</td>
          <td class="${c.side === "long" ? "tp-up" : "tp-down"}">${pesc(c.side)}</td>
          <td>${pesc(num(c.size, 6))}</td>
          <td>${pesc(num(c.entryPx, 6))}</td>
          <td>${pesc(num(c.exitPx, 6))}</td>
          <td class="${c.pnl >= 0 ? "tp-up" : "tp-down"}">${pesc(money(c.pnl))}</td>
          <td>${pesc(money(-c.fees))}</td>
          <td>${pesc(money(-c.funding))}</td>
        </tr>`).join("")}
    </table>`;
}

function disclosureHtml() {
  return `
    <details class="tp-disc">
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
      site data erases them.
      <button type="button" class="tp-x" data-act="reset">Reset practice account</button></p>
    </details>`;
}

// ── The controller ──────────────────────────────────────────────────────────

const paper = {
  panel: null,
  state: null,
  info: null,
  book: { levels: [[], []] },
  fees: { taker: 0.00045, maker: 0.00015, tiers: [] },
  minimised: false,
  coin: null,
  timer: null,
  draft: { side: "buy", type: "market", size: "", px: "", leverage: "1",
           postOnly: false, reduceOnly: false },
};

function paperBodyHtml() {
  const { state, info, book, fees, draft } = paper;
  if (!info) {
    return `<div class="tp-body"><div class="tp-empty">Reading this market from
      Hyperliquid's public data.</div></div>`;
  }
  return `
    <div class="tp-body">
      <div class="tp-cols">
        <div class="tp-left">${ticketHtml(info, book, fees, draft)}</div>
        <div class="tp-right">
          ${positionHtml(state, info)}
          ${restingHtml(state, info)}
          ${eventsHtml(state)}
          ${historyHtml(state)}
        </div>
      </div>
      ${disclosureHtml()}
    </div>`;
}

function renderPaper() {
  if (!paper.panel) return;
  const bal = paper.state ? paper.state.balance : null;
  paper.panel.innerHTML = headerHtml(paper.minimised, bal)
    + (paper.minimised ? "" : paperBodyHtml());
  paper.panel.classList.toggle("tp-min-on", paper.minimised);
}

function readDraft() {
  const p = paper.panel;
  if (!p) return;
  const get = (f) => p.querySelector(`[data-f="${f}"]`);
  const v = (f) => { const e = get(f); return e ? e.value : ""; };
  const c = (f) => { const e = get(f); return e ? e.checked : false; };
  paper.draft.size = v("size");
  paper.draft.px = v("px");
  paper.draft.leverage = v("leverage") || "1";
  paper.draft.postOnly = c("postOnly");
  paper.draft.reduceOnly = c("reduceOnly");
}

function pushEvent(ev) {
  paper.state.events.unshift(ev);
  paper.state.events = paper.state.events.slice(0, 25);
}

async function submitPaperOrder() {
  readDraft();
  const d = paper.draft;
  const size = parseFloat(d.size);
  if (!isFinite(size) || size <= 0) {
    pushEvent({ ok: false, message: "Enter a size first.", detail: null, at: Date.now() });
    await saveState(paper.state); renderPaper(); return;
  }
  try {
    paper.book = await orderBook(paper.coin);
  } catch (e) { /* price against the book we have */ }

  const decision = decideOrder(paper.state, paper.info, paper.book, paper.fees, {
    coin: paper.coin, side: d.side, type: d.type,
    px: parseFloat(d.px), size,
    postOnly: d.postOnly, reduceOnly: d.reduceOnly,
    leverage: Math.max(1, Math.min(parseInt(d.leverage, 10) || 1, paper.info.maxLeverage)),
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
    const f = decision.fill;
    const needed = (f.size * f.avgPx) / (f.leverage || 1) + f.fee;
    const closing = paper.state.positions[paper.coin]
      && ((paper.state.positions[paper.coin].side === "long" && f.side === "sell")
       || (paper.state.positions[paper.coin].side === "short" && f.side === "buy"));
    if (!closing && needed > paper.state.balance) {
      pushEvent({ ok: false, at: Date.now(),
        message: "Not enough balance in the practice account for that margin.",
        detail: `${money(needed)} needed, ${money(paper.state.balance)} free.` });
    } else {
      applyFill(paper.state, paper.info, f);
      const slip = f.slippageVsTouch;
      pushEvent({ ok: true, at: f.at,
        message: `Filled ${f.size} ${paper.coin} at ${num(f.avgPx, 6)}, fee ${money(f.fee)}.`,
        detail: f.levels.length > 1
          ? `It took ${f.levels.length} levels of the book, ending at ${num(f.worstPx, 6)}. `
            + `That is ${num(Math.abs(slip), 6)} away from the touch, which is what depth costs.`
          : "It filled inside the first level of the book." });
    }
  }
  await saveState(paper.state);
  renderPaper();
}

async function closePaperPosition() {
  const pos = paper.state.positions[paper.coin];
  if (!pos) return;
  try { paper.book = await orderBook(paper.coin); } catch (e) { /* use what we have */ }
  const decision = decideOrder(paper.state, paper.info, paper.book, paper.fees, {
    coin: paper.coin, side: pos.side === "long" ? "sell" : "buy", type: "market",
    size: pos.size, reduceOnly: true, leverage: pos.leverage,
  });
  if (!decision.ok) {
    pushEvent({ ok: false, message: decision.message, detail: decision.detail, at: decision.at });
  } else {
    applyFill(paper.state, paper.info, decision.fill);
    pushEvent({ ok: true, at: Date.now(),
      message: `Closed at ${num(decision.fill.avgPx, 6)}.`,
      detail: "What it would have earned is in the table below. Nobody earned it." });
  }
  await saveState(paper.state);
  renderPaper();
}

async function tick() {
  if (!paper.coin) return;
  try {
    paper.info = await assetInfo(paper.coin);
  } catch (e) { return; }
  if (!paper.minimised) {
    try { paper.book = await orderBook(paper.coin); } catch (e) { /* keep the last */ }
  }
  // Funding, at the rates the venue actually applied.
  try { await settleFunding(paper.state, paper.coin); } catch (e) { /* skip this pass */ }

  // Resting orders, on the narrow rule only.
  const still = [];
  for (const o of paper.state.resting) {
    if (o.coin === paper.coin
        && restingWouldFill(o, paper.info.markPx, paper.info.szDecimals)) {
      applyFill(paper.state, paper.info, {
        coin: o.coin, side: o.side, size: o.size, avgPx: o.px, worstPx: o.px,
        levels: [{ px: o.px, sz: o.size }], feeRate: paper.fees.maker,
        fee: o.size * o.px * paper.fees.maker, leverage: o.leverage,
        reduceOnly: o.reduceOnly, slippageVsTouch: 0, at: Date.now(),
      });
      pushEvent({ ok: true, at: Date.now(),
        message: `Resting ${o.side} at ${o.px} treated as filled, at the maker fee.`,
        detail: "The mark went clear through the level. Whether an order on the venue "
                + "would have reached the front of the queue is not public, so this is an "
                + "assumption." });
    } else {
      still.push(o);
    }
  }
  paper.state.resting = still;
  await saveState(paper.state);
  renderPaper();
}

function wirePaper(panel) {
  panel.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "side" || act === "type") {
      readDraft();
      paper.draft[act] = btn.dataset.v;
      renderPaper();
    } else if (act === "submit") {
      await submitPaperOrder();
    } else if (act === "close") {
      await closePaperPosition();
    } else if (act === "cancel") {
      paper.state.resting = paper.state.resting.filter((o) => o.id !== btn.dataset.id);
      await saveState(paper.state); renderPaper();
    } else if (act === "reset") {
      paper.state = await resetState(); renderPaper();
    }
  });
  panel.addEventListener("click", async (e) => {
    if (!e.target.closest(".tp-min")) return;
    paper.minimised = !paper.minimised;
    try { await chrome.storage.local.set({ [PAPER_MIN_KEY]: paper.minimised }); } catch (err) {}
    renderPaper();
  });
}

async function startPaper() {
  const coin = coinFromUrl();
  if (!coin) return;                       // not on a market page
  paper.coin = coin;

  if (!paper.panel) {
    const el = document.createElement("section");
    el.id = PAPER_PANEL_ID;
    el.className = "tnega-paper";
    paper.panel = el;
    applyTheme(el, readVenueTheme());
    wirePaper(el);
    paper.state = await loadState();
    try {
      const got = await chrome.storage.local.get(PAPER_MIN_KEY);
      paper.minimised = !!(got && got[PAPER_MIN_KEY]);
    } catch (e) { paper.minimised = false; }
    try { paper.fees = await feeSchedule(); } catch (e) { /* base defaults stand */ }
    renderPaper();

    // The section is drawn by their app after the shell, so it may not be here
    // on the first pass. Try, then keep trying for a bounded while, then fall
    // back rather than never appearing.
    if (!placePaperPanel(el)) {
      const started = Date.now();
      const t = setInterval(() => {
        if (placePaperPanel(el)) { clearInterval(t); return; }
        if (Date.now() - started > 12000) { clearInterval(t); placeFallback(el); }
      }, 400);
    }
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
  const c = coinFromUrl();
  if (c && c !== paper.coin) {
    paper.coin = c;
    paper.draft.px = "";
    tick();
  } else if (!c && paper.panel) {
    paper.panel.remove();
    paper.panel = null;
    if (paper.timer) { clearInterval(paper.timer); paper.timer = null; }
  } else if (c && !paper.panel) {
    startPaper();
  }
}, 700);

startPaper();
