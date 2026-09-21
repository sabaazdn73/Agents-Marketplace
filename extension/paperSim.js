// paperSim.js
//
// Practice mode: the market data and the simulation, with no DOM in it.
// paper.js draws the panel; everything that decides what a trade would have
// done lives here.
//
// WHAT IS FAKE, AND IT IS ONLY ONE THING
// The money. The mark price, the book, the fee schedule, the funding rates,
// the tick and lot sizes and the margin tiers are all Hyperliquid's own,
// fetched from their public info endpoint. No order is ever submitted, nothing
// is signed, no key is touched, and nothing about the person using it leaves
// the browser.
//
// WHY THIS NEEDS NO NEW PERMISSION
// api.hyperliquid.xyz answers `access-control-allow-origin: *` on both the
// preflight and the POST, checked 2026-09-20. A content script running on
// app.hyperliquid.xyz therefore reaches it with the page's own origin and no
// host permission. Positions live in chrome.storage.local, which the extension
// already has for the membership list. Nobody is asked to consent again.
//
// THE RULE THIS FILE IS WRITTEN AGAINST
// Where the public data settles a question, simulate it exactly. Where it does
// not, refuse to simulate and say so on the surface. An approximation that
// looks like a measurement is the failure mode this whole project exists to
// avoid, and it would be worse here than anywhere else, because the output
// looks like a profit.

const HL_INFO = "https://api.hyperliquid.xyz/info";

// The fee schedule is per-account: the rate you pay depends on your own 14-day
// volume. A practice account has no volume, so it is charged the base tier.
// Asking for the zero address returns the base rates and the whole ladder
// without touching anybody's account, which is also why the request carries no
// identity: it is the same bytes for every user of the extension.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Hyperliquid's minimum order value. A smaller order is refused by the venue,
// so it is refused here.
const MIN_NOTIONAL_USD = 10;

// What a practice account starts with, and the one number in the whole file
// that is not taken from the venue.
const STARTING_BALANCE = 10000;

const PAPER_KEY = "tnega_paper_v1";

// ── Public market data ──────────────────────────────────────────────────────

// Keyed by the request body. Most keys repeat, but two do not: fundingHistory
// and candleSnapshot carry startTime and endTime, which move every time funding
// is settled, so each settle used to add an entry that nothing ever read again
// and nothing ever removed. On a tab left open that is a slow leak for as long
// as the page lives. Entries are dropped once they are past any TTL this file
// asks for, and the map is capped.
const _cache = new Map();
const CACHE_MAX = 64;
const CACHE_MAX_TTL = 24 * 60 * 60 * 1000;   // the longest TTL any caller passes

function cacheSweep() {
  const now = Date.now();
  for (const [k, v] of _cache) {
    if (now - v.at > CACHE_MAX_TTL) _cache.delete(k);
  }
  // Map iterates in insertion order, so the front is the oldest written.
  while (_cache.size > CACHE_MAX) {
    const oldest = _cache.keys().next();
    if (oldest.done) break;
    _cache.delete(oldest.value);
  }
}

async function hlInfo(body, ttlMs) {
  const key = JSON.stringify(body);
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const r = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: key,
    credentials: "omit",            // never send cookies to the venue
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Hyperliquid answered ${r.status}`);
  const value = await r.json();
  _cache.set(key, { at: Date.now(), value });
  cacheSweep();
  return value;
}

/** Per-asset rules: size decimals, max leverage, which margin table. */
async function perpMeta() {
  return hlInfo({ type: "meta" }, 60 * 60 * 1000);
}

/** Live context per asset: mark, oracle, mid, the current hourly funding. */
async function assetContexts() {
  return hlInfo({ type: "metaAndAssetCtxs" }, 2500);
}

/** Twenty levels a side, with size and the number of orders at each. */
async function orderBook(coin) {
  return hlInfo({ type: "l2Book", coin }, 1500);
}

/** The maintenance-margin tiers for one asset. */
async function marginTable(id) {
  return hlInfo({ type: "marginTable", id }, 60 * 60 * 1000);
}

/** The public fee schedule, read at the base tier. */
async function feeSchedule() {
  const r = await hlInfo({ type: "userFees", user: ZERO_ADDRESS }, 24 * 60 * 60 * 1000);
  const s = (r && r.feeSchedule) || {};
  return {
    taker: Number(s.cross ?? 0.00045),
    maker: Number(s.add ?? 0.00015),
    tiers: (s.tiers && s.tiers.vip) || [],
  };
}

/** Every hourly funding rate the venue applied between two instants. */
async function fundingBetween(coin, startMs, endMs) {
  if (!(endMs > startMs)) return [];
  return hlInfo(
    { type: "fundingHistory", coin, startTime: Math.floor(startMs), endTime: Math.floor(endMs) },
    30 * 1000,
  );
}

/** Hourly candles, keyed by bucket start, used only to price funding.
 *
 *  A fundingHistory row carries a rate and a timestamp and no price, so the
 *  notional it was charged on has to come from somewhere else.
 *
 *  Candle buckets are exact hours. Funding rows are NOT: they land a few tens
 *  of milliseconds after the hour, because that is when the venue applied them.
 *  Measured 2026-09-21: rows at 04:00:00.070, 05:00:00.008, 06:00:00.040,
 *  07:00:00.047, 08:00:00.069, 09:00:00.073, and one at 02:00:00.032. So a row
 *  time never equals a bucket start and the caller floors the row time to the
 *  hour before looking it up here. Keying on the raw timestamp matches nothing,
 *  which is a failure that charges zero rather than erroring.
 */
async function hourlyOpens(coin, startMs, endMs) {
  const out = new Map();
  try {
    const rows = await hlInfo(
      { type: "candleSnapshot", req: { coin, interval: "1h", startTime: Math.floor(startMs), endTime: Math.floor(endMs) } },
      30 * 1000,
    );
    for (const c of rows || []) {
      const px = Number(c.o);
      if (isFinite(px) && px > 0) out.set(Number(c.t), px);
    }
  } catch (e) { /* no candles, and settleFunding falls back rather than inventing */ }
  return out;
}

/** Everything about one asset that the simulation needs, in one call site. */
async function assetInfo(coin) {
  const [meta, ctxPair] = await Promise.all([perpMeta(), assetContexts()]);
  const universe = (ctxPair && ctxPair[0] && ctxPair[0].universe) || meta.universe;
  const i = universe.findIndex((a) => a.name === coin);
  if (i < 0) throw new Error(`${coin} is not a perp on this venue`);
  const spec = universe[i];
  const ctx = (ctxPair && ctxPair[1] && ctxPair[1][i]) || {};
  let tiers = null;
  if (spec.marginTableId != null) {
    try {
      tiers = (await marginTable(spec.marginTableId)).marginTiers || null;
    } catch (e) { tiers = null; }
  }
  return {
    coin,
    szDecimals: spec.szDecimals,
    maxLeverage: spec.maxLeverage,
    marginTiers: tiers,
    markPx: Number(ctx.markPx),
    oraclePx: Number(ctx.oraclePx),
    midPx: Number(ctx.midPx),
    hourlyFunding: Number(ctx.funding),
  };
}

// ── The venue's own price and size rules ────────────────────────────────────

/** Perp prices carry at most 5 significant figures and at most (6 - szDecimals)
 *  decimal places. Integers are always allowed. Both limits apply. */
function roundPrice(px, szDecimals) {
  if (!isFinite(px) || px <= 0) return NaN;
  if (Number.isInteger(px)) return px;
  const maxDecimals = Math.max(0, 6 - szDecimals);
  const fiveSig = Number(px.toPrecision(5));
  return Number(fiveSig.toFixed(maxDecimals));
}

/** Sizes step by 10^-szDecimals and the venue truncates rather than rounds, so
 *  a size between two lots buys the smaller one.
 *
 *  The naive `Math.floor(sz * 10^d)` is wrong for sizes the venue would have
 *  accepted unchanged, because the scaling is not exact in IEEE 754. At
 *  szDecimals 2, 0.29 * 100 is 28.999999999999996 and 0.57 * 100 is
 *  56.99999999999999, so 0.29 became 0.28 and 0.57 became 0.56.
 *
 *  The same arithmetic ran on every reduce, which is where it stranded margin.
 *  Three steps, all reproducible in a node prompt:
 *      0.3 - 0.1 - 0.1              is 0.09999999999999998, not 0.1
 *      floor(that * 100) / 100      is 0.09
 *      0.09999999999999998 - 0.09   is 0.009999999999999981, left behind
 *  So a 0.3 position reduced twice by 0.1 then closed kept about a tenth of a
 *  lot, holding the margin that went with it, in a position too small to close.
 *
 *  Snapping first when the scaled size is within a part in 1e9 of an integer
 *  fixes both. That tolerance is nine orders of magnitude below the coarsest
 *  lot on the venue, so it cannot promote a size to a lot it does not reach.
 */
function roundSize(sz, szDecimals) {
  const f = Math.pow(10, szDecimals);
  const scaled = Math.abs(sz) * f;
  if (!isFinite(scaled)) return 0;
  const near = Math.round(scaled);
  if (Math.abs(scaled - near) <= 1e-9 * Math.max(1, near)) return near / f;
  return Math.floor(scaled) / f;
}

function lotSize(szDecimals) {
  return Math.pow(10, -szDecimals);
}

/** Every number that reaches a person goes through one of these four.
 *
 *  TWO ROUNDS OF THE SAME BUG, WHICH IS WHY THEY ARE ALL IN ONE PLACE NOW.
 *  First the refusals interpolated raw floats, so the user read "at
 *  85115.53936453752" and "They hold 11.105340000000012 BTC": sixteen digits of
 *  IEEE 754 noise on a venue that quotes five significant figures. Rounding
 *  fixed the prices and the sizes and missed the money, so the next thing the
 *  user read was "needs more than the $10000.00 free, and would leave it
 *  $74690.91 short" sitting directly beneath a fill line that paper.js had
 *  rendered as "$9,660.66". One event list, two conventions, and the
 *  unformatted one was the refusal, which is the message read most carefully.
 *
 *  So the grouping matches paper.js exactly, en-US with the same digit counts,
 *  and nothing in a refusal is interpolated bare. The suite asserts it rather
 *  than trusting it: cases.js fails on any refusal text carrying a run of four
 *  or more unseparated digits, or a decimal tail longer than the venue quotes.
 */
function fmtUsd(n) {
  const v = Number(n);
  if (!isFinite(v)) return "$0.00";
  return (v < 0 ? "-$" : "$") + Math.abs(v)
    .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A price rounded to what the venue can quote, then grouped. */
function fmtPx(px, szDecimals) {
  const v = Number(px);
  if (!isFinite(v)) return String(px);
  const r = roundPrice(v, szDecimals);
  if (!isFinite(r)) return String(px);
  const tick = priceTick(r, szDecimals);
  const dp = Math.max(0, Math.min(8, Math.ceil(-Math.log10(tick))));
  return r.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** A size at the asset's lot, then grouped: DOGE trades in whole coins and
 *  those reach five figures. */
function fmtSz(sz, szDecimals) {
  const v = Number(sz);
  if (!isFinite(v)) return String(sz);
  return roundSize(v, szDecimals)
    .toLocaleString("en-US", { minimumFractionDigits: szDecimals, maximumFractionDigits: szDecimals });
}

/** What the person typed, echoed back without turning into exponent notation.
 *
 *  Used only where the message quotes their own input back at them, which is
 *  worth showing as given rather than snapped to a grid the input failed to
 *  reach. String(0.0000001) is "1e-7", which reads as a bug rather than as a
 *  size, so the digits are spelled out instead.
 */
function fmtNum(n) {
  const v = Number(n);
  if (!isFinite(v)) return String(n);
  if (Number.isInteger(v) && Math.abs(v) < 1e21) {
    return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 20 });
}

/** The smallest price move the venue can express at this price.
 *
 *  Two limits bind at once and the COARSER one wins: at most five significant
 *  figures, and at most 6 - szDecimals decimal places. Which of the two is
 *  coarser changes with the price, so neither can be used on its own. Worked
 *  through on BTC, szDecimals 5, where the decimal limit is fixed at 0.1:
 *
 *      px 84,122   five sig figs allow 84,122 but not 84,122.1, step 1.0
 *                  decimals allow 0.1
 *                  coarser is 1.0, so the tick is 1.0 and 84,121.9 is not a
 *                  price BTC can trade at
 *
 *      px 9.8      five sig figs allow 9.8000, step 0.0001
 *                  decimals still allow only 0.1
 *                  coarser is 0.1, so the tick is 0.1 and 9.8001 is not a price
 *
 *  The same asset, and the binding limit swaps. Reading only the significant
 *  figures gives 0.0001 at 9.8, ten times too fine; reading only the decimals
 *  gives 0.1 at 84,122, ten times too fine the other way.
 *
 *  THE TICK IS A FUNCTION OF THE PRICE, so it changes at every power of ten
 *  and one order book can hold two grids at once. Caught on SUI, szDecimals 1,
 *  quoting either side of 1.0000: above it five significant figures give 1.0002
 *  and the step is 0.0001, below it they give 0.99998 and the step is 0.00001.
 *  A book straddling the boundary has levels on both grids, both correct, so
 *  anything reading one tick off the top of book and applying it to the whole
 *  book will be wrong ten levels down.
 *
 *  Checked against the live books on 2026-09-21, eleven assets from BTC to
 *  kPEPE: for every one, this tick equalled the smallest gap between adjacent
 *  quoted prices in the twenty levels, and every quoted price was a whole
 *  number of ticks. BTC 84,074 tick 1; ETH 2,701.7 tick 0.1; SOL 115.11 tick
 *  0.01; LINK 12.89 tick 0.001; WLD 0.45372 tick 0.00001; DOGE 0.092224 tick
 *  0.000001.
 */
function priceTick(px, szDecimals) {
  const decStep = Math.pow(10, -Math.max(0, 6 - szDecimals));
  if (!isFinite(px) || px <= 0) return decStep;
  const sigStep = Math.pow(10, Math.floor(Math.log10(Math.abs(px))) - 4);
  return Math.max(sigStep, decStep);
}

/** Maintenance margin is half the initial margin at maximum leverage, so the
 *  fraction of position value that must be held is 1 / (2 * maxLeverage). The
 *  tier that applies is chosen by position notional. */
function maintenanceFraction(info, notional) {
  let lev = info.maxLeverage;
  if (Array.isArray(info.marginTiers)) {
    for (const t of info.marginTiers) {
      if (notional >= Number(t.lowerBound)) lev = t.maxLeverage;
    }
  }
  return 1 / (2 * lev);
}

/** Where the position is liquidated, derived rather than guessed.
 *
 *  Liquidation is when equity falls to the maintenance requirement:
 *      margin + side*(P - entry)*size  =  size*P*mf
 *  which solves to
 *      long   P = (entry - margin/size) / (1 - mf)
 *      short  P = (entry + margin/size) / (1 + mf)
 *
 *  This is the price. It is NOT a liquidation engine: see canSimulate below
 *  for why the event itself is left alone.
 */
function liquidationPrice(pos, info) {
  const size = Math.abs(pos.size);
  if (!size) return null;
  const mf = maintenanceFraction(info, size * pos.entryPx);
  const perUnit = pos.margin / size;
  const p = pos.side === "long"
    ? (pos.entryPx - perUnit) / (1 - mf)
    : (pos.entryPx + perUnit) / (1 + mf);
  // A 1x long is not liquidatable by price: the margin equals the whole entry
  // notional, so the numerator is zero and only floating point keeps it above
  // it. Measured on SOL at 115.48, which produced 1.4e-14 instead of nothing.
  // Anything below one tick is a price the venue cannot quote, so it is null.
  if (!(p > 0) || p < priceTick(pos.entryPx, info.szDecimals)) return null;
  return p;
}

// ── Walking the book ────────────────────────────────────────────────────────

/** What a market order of this size would actually pay, level by level.
 *
 *  Twenty levels is what the venue publishes, and it is a snapshot. If the
 *  order is bigger than everything visible, this returns `insufficient`
 *  rather than extrapolating a price from depth nobody can see. Inventing the
 *  twenty-first level would be inventing the answer.
 */
function walkBook(levels, size) {
  let remaining = size, cost = 0, worst = null;
  const taken = [];
  for (const lvl of levels) {
    if (remaining <= 0) break;
    const px = Number(lvl.px), avail = Number(lvl.sz);
    const fill = Math.min(remaining, avail);
    cost += fill * px;
    remaining -= fill;
    worst = px;
    taken.push({ px, sz: fill });
  }
  if (remaining > 1e-12) {
    return { insufficient: true, filled: size - remaining, levels: taken };
  }
  return { insufficient: false, avgPx: cost / size, worstPx: worst, levels: taken };
}

// ── Stored state ────────────────────────────────────────────────────────────

function emptyState() {
  return {
    balance: STARTING_BALANCE,
    positions: {},        // coin -> position
    resting: [],          // orders that did not fill
    closed: [],           // closed positions, newest first
    events: [],           // refusals and fills, newest first
    fundingSettledAt: Date.now(),
    createdAt: Date.now(),
  };
}

/** Whether the store is working, for the panel to say so.
 *
 *  Both of these used to swallow their failure: a blocked or full store made
 *  loadState hand back a fresh $10,000 account and saveState return quietly, so
 *  somebody with site data blocked would trade a whole session, see a balance
 *  moving, and lose all of it on reload with nothing having said a word. A
 *  practice account that silently does not persist is worth knowing about
 *  before the session rather than after it, so the failure is recorded here and
 *  the panel can read it.
 *
 *  `ok` starts true and only a caught failure clears it. `reason` is the
 *  message the browser gave, which is usually the useful part.
 */
const _storage = { ok: true, reason: null, lastFailAt: null };

function storageStatus() {
  return { ...(_storage) };
}

function noteStorageFailure(e) {
  _storage.ok = false;
  _storage.reason = (e && e.message) || String(e);
  _storage.lastFailAt = Date.now();
}

async function loadState() {
  try {
    const got = await chrome.storage.local.get(PAPER_KEY);
    const s = got && got[PAPER_KEY];
    _storage.ok = true; _storage.reason = null;
    if (!s || typeof s !== "object" || typeof s.balance !== "number") return emptyState();
    return { ...emptyState(), ...s };
  } catch (e) {
    noteStorageFailure(e);
    return emptyState();
  }
}

async function saveState(state) {
  try {
    await chrome.storage.local.set({ [PAPER_KEY]: state });
    _storage.ok = true; _storage.reason = null;
    return true;
  } catch (e) {
    // A full or blocked store loses the practice history and nothing else, but
    // it has to be visible: the caller gets false and storageStatus() carries why.
    noteStorageFailure(e);
    return false;
  }
}

async function resetState() {
  const s = emptyState();
  await saveState(s);
  return s;
}

// ── What this simulation will not model, stated in one place ────────────────
//
// Read onto the panel verbatim. Keeping the list here rather than in the UI
// means the code that refuses to model something and the sentence admitting it
// cannot drift apart.
const NOT_MODELLED = [
  "Queue position. A resting order's place in the line is not public, so this "
    + "cannot know when, or whether, yours would reach the front.",
  "Partial fills. Every fill here is all or nothing.",
  "The book moving between submitting and filling. A market order is priced "
    + "against the depth showing at that instant.",
  "Competition. An order on the venue competes with everyone else's, including orders "
    + "placed in response to yours.",
  "Liquidation as an event. The price is shown because it can be derived. What "
    + "happens at it involves backstop liquidity and a fee, and is not run here.",
  "Funding on a size that changed mid-hour. Each hourly rate is charged on the "
    + "size held when funding is settled, not on the size held at that hour.",
];

const REFUSALS_SIMULATED = [
  "Post-only that would cross the spread, which is the one this extension exists for.",
  "Below the venue's minimum order value. An order that closes a position exactly "
    + "is allowed under it, which is the one rule here that is inferred rather than "
    + "read off the venue: see the note below.",
  "Reduce-only with nothing on that side to reduce.",
  "A size that rounds to zero at the asset's lot size.",
  "A market order larger than the whole visible book.",
  "A limit order with no price on it.",
  "More margin than the practice account holds.",
];

const REFUSALS_NOT_SIMULATED =
  "Anything that depends on account state nobody outside the venue can see: "
  + "margin tier changes, open order caps, and address-level restrictions. Those "
  + "are not guessed at here. One rule here is inferred rather than read: an order "
  + "under the $10 minimum is allowed through when it closes a position exactly. "
  + "Hyperliquid documents the $10 minimum and documents no exemption to it. The "
  + "exemption is taken from the fact that a position can always be closed on the "
  + "venue, plus a third-party description of the rule, and settling it would mean "
  + "placing a sub-$10 closing order, which this never does.";

// ── Submitting an order ─────────────────────────────────────────────────────

function refuse(code, message, detail) {
  return { ok: false, code, message, detail: detail || null, at: Date.now() };
}

/** Said when an inferred rule is what let an order through, not only when one
 *  is what stopped it.
 *
 *  The disclosure in REFUSALS_NOT_SIMULATED is a standing note, which is the
 *  right place for it but the wrong moment. The moment that matters is the one
 *  where the inference changes the outcome: an order under the venue's
 *  documented $10 minimum that this accepts anyway. Stating it only in the
 *  refusal direction meant the assumption was loudest when it cost nothing and
 *  silent when it was doing the work.
 *
 *  Returns null when nothing was assumed, so the panel can render it only when
 *  there is something to render.
 */
function assumptionFor(notional, closesExactly) {
  if (!(closesExactly && notional < MIN_NOTIONAL_USD)) return null;
  return `This is ${fmtUsd(notional)}, under the venue's documented ${fmtUsd(MIN_NOTIONAL_USD)} `
    + "minimum. It is allowed through because it closes the position exactly. Hyperliquid "
    + "documents the minimum and documents no exemption to it; the exemption is inferred "
    + "from positions being closeable on the venue, and is not something this could check "
    + "without placing the order.";
}

/** Decide what an order would do, against the venue's own rules and book.
 *
 *  Returns either a refusal carrying the venue's reason, or the resulting
 *  fill or resting order. Nothing here writes state; the caller applies it.
 */
function decideOrder(state, info, book, fees, order) {
  const { szDecimals } = info;
  const bids = (book.levels && book.levels[0]) || [];
  const asks = (book.levels && book.levels[1]) || [];
  const bestBid = bids.length ? Number(bids[0].px) : null;
  const bestAsk = asks.length ? Number(asks[0].px) : null;
  const isBuy = order.side === "buy";

  let size = roundSize(order.size, szDecimals);
  if (!(size > 0)) {
    return refuse("lot_size",
      `A size of ${fmtNum(order.size)} rounds to zero at ${info.coin}'s lot size.`,
      `${info.coin} trades in steps of ${fmtSz(lotSize(szDecimals), szDecimals)}.`);
  }

  // A limit order with no usable price used to fall through to the no_book
  // refusal, which named the wrong problem. Say what is actually missing.
  const limitPx = order.type === "limit" ? roundPrice(order.px, szDecimals) : null;
  if (order.type === "limit" && !(limitPx > 0)) {
    return refuse("limit_px", "A limit order needs a price.",
      `${order.px === undefined || order.px === null || Number.isNaN(Number(order.px))
        ? "No price was given." : `${fmtNum(order.px)} is not a price this venue can quote.`}`);
  }

  const pos = state.positions[info.coin] || null;
  const opposes = !!pos && ((pos.side === "long" && !isBuy) || (pos.side === "short" && isBuy));
  if (order.reduceOnly) {
    if (!opposes) {
      return refuse("reduce_only",
        "Reduce-only, but there is nothing on that side to reduce.",
        pos ? `The open position is ${pos.side}, and this order is a ${order.side}.`
            : `There is no open ${info.coin} position.`);
    }
    // The venue clamps a reduce-only order to the position rather than refusing
    // it. Clamping here as well keeps the fee on what would have traded: before
    // this, a reduce-only sell of 0.03 against a 0.01 long was charged taker fee
    // on 0.03 while only 0.01 changed hands, and the overflow was discarded in
    // applyFill after the money had already gone.
    size = Math.min(size, roundSize(pos.size, szDecimals));
    if (!(size > 0)) {
      return refuse("lot_size",
        `The open ${info.coin} position is smaller than one lot.`,
        `${info.coin} trades in steps of ${fmtSz(lotSize(szDecimals), szDecimals)}.`);
    }
  }

  // Post-only, and the whole reason this panel sits in this extension.
  if (order.postOnly && order.type === "limit") {
    const px = limitPx;
    const crosses = isBuy ? (bestAsk != null && px >= bestAsk)
                          : (bestBid != null && px <= bestBid);
    if (crosses) {
      const touch = isBuy ? bestAsk : bestBid;
      return refuse("post_only",
        "Post-only order refused. It would have crossed the spread and taken "
        + "liquidity instead of resting on the book.",
        `A ${order.side} at ${fmtPx(px, szDecimals)} against a best ${isBuy ? "ask" : "bid"} `
        + `of ${fmtPx(touch, szDecimals)}. `
        + "The order never reached the book, so it provided no liquidity and left no "
        + "trace in fills or volume. This is what the rejection rate on an address "
        + "page is counting.");
    }
  }

  // Priced, so notional can be checked the way the venue checks it.
  //
  // The reference is the order's own price for a limit order and the touch only
  // for a market order, which is the venue's rule and matters most for a limit
  // order resting far from the book: checked against the live BTC book with a
  // buy at 42,039 for 0.00026, worth $10.93 at its own price and $21.86 at the
  // touch. Pricing that off the touch would pass an order the venue rejects.
  const refPx = order.type === "market" ? (isBuy ? bestAsk : bestBid) : limitPx;
  if (!(refPx > 0)) {
    return refuse("no_book", "The order book is empty on that side right now.", null);
  }
  // A limit order needs the OPPOSITE side to decide whether it crosses, and a
  // market order needs it to have anything to fill against. With that side
  // empty the market path already refuses, but the limit path used to fall
  // through to "it did not cross, so it is on the book", which is an assertion
  // about a book nobody can see rather than a reading of one. Whether it would
  // have crossed is exactly the question this panel exists to answer, so not
  // being able to answer it is a refusal.
  const opposite = isBuy ? bestAsk : bestBid;
  if (order.type === "limit" && !(opposite > 0)) {
    return refuse("no_book",
      `There are no ${isBuy ? "asks" : "bids"} showing, so whether this would cross `
      + "cannot be checked.",
      "A limit order is accepted or refused here by comparing it to the touch on the "
      + "other side. With nothing quoted there, saying it rests would be a guess, and "
      + "post-only rejection is the one thing this must not guess at.");
  }
  // A reduce-only order that closes the position exactly is let through under
  // the minimum. THE MINIMUM IS DOCUMENTED. THE EXEMPTION IS NOT, AND THE
  // DIFFERENCE MATTERS, so it is spelled out here rather than left to look
  // like both came from the same place.
  //
  // What the venue documents, both read 2026-09-21:
  //   for-developers/api/error-responses gives the rule as "Order must have
  //     minimum value of $10." and states no exemption to it. Its only mention
  //     of reduce-only is a different error, "Reduce only order would increase
  //     position", which is about direction and not about size.
  //   trading/order-types gives a minimum only for TWAP orders, a $100 minimum
  //     total order size, and no general minimum and no exemption for
  //     reduce-only or position-closing orders.
  // No page of theirs was found documenting an exemption.
  //
  // What the exemption rests on instead, which is weaker: a position can always
  // be closed on the live venue, so an exemption of some shape has to exist, or
  // anyone whose position drifted under $10 would be stuck in it forever. And a
  // third-party doc, Chainstack's Hyperliquid order-precision page, asserts the
  // shape as "the only exception is exactly closing a position with a reduce-only
  // order". That is somebody else's reading of the venue, not the venue, and it
  // is the narrowest shape consistent with positions being closeable, which is
  // why it is the one implemented: full-position reduce-only only, never a
  // partial reduce.
  //
  // What would settle it: place a sub-$10 closing order on the live venue and
  // see whether it is accepted. This project will not do that, because it does
  // not trade. So the assumption is carried into REFUSALS_NOT_SIMULATED, where
  // the panel puts it in front of the person using it.
  //
  // Why not just apply the documented rule and refuse: it would teach the
  // opposite of what the venue does. Measured by test/paperSim/lifecycles.js,
  // which runs 400 randomized position lifecycles from a fixed seed against a
  // committed venue snapshot so the count is the same on every re-run:
  //
  //      with this exemption        0 of 400 runs end unable to go flat
  //      with a flat $10 floor      8 of 400, holding $0.85 to $9.36
  //
  // Run it with `node test/paperSim/lifecycles.js`; it reports both ways in one
  // pass. An inferred exemption is the smaller error than a simulator that
  // locks somebody into a position the venue would have let them out of.
  const closesExactly = !!order.reduceOnly && !!pos
    && size === roundSize(pos.size, szDecimals);
  const notional = size * refPx;
  if (notional < MIN_NOTIONAL_USD && !closesExactly) {
    return refuse("min_notional",
      `Below the venue's minimum order value of ${fmtUsd(MIN_NOTIONAL_USD)}.`,
      `${fmtSz(size, szDecimals)} ${info.coin} at ${fmtPx(refPx, szDecimals)} is ${fmtUsd(notional)}.`
      + (order.reduceOnly
        ? " An order under the minimum is let through here only when it closes the"
          + " position exactly, and this one leaves part of it open. That exemption is"
          + " inferred rather than read off the venue: Hyperliquid documents the"
          + " minimum and documents no exemption to it."
        : ""));
  }

  // A market order, or a limit order priced through the touch, takes.
  const takes = order.type === "market"
    || (isBuy ? (bestAsk != null && limitPx >= bestAsk)
              : (bestBid != null && limitPx <= bestBid));

  if (!takes) {
    const resting = {
      id: `o${Date.now()}${Math.floor(Math.random() * 1e4)}`,
      coin: info.coin, side: order.side, px: limitPx,
      size, reduceOnly: !!order.reduceOnly, postOnly: !!order.postOnly,
      leverage: order.leverage, placedAt: Date.now(),
    };
    // Nothing is reserved while an order rests here, so without this an account
    // could rest more than it could ever pay for and only find out on the fill.
    // Priced at its own limit, because that is what it would cost if it filled.
    const short = marginShortfall(state, info, {
      coin: info.coin, side: order.side, size, avgPx: limitPx,
      fee: size * limitPx * fees.maker, leverage: order.leverage,
      reduceOnly: !!order.reduceOnly, at: Date.now(),
    });
    if (short) return short;
    return { ok: true, kind: "rest", order: resting,
             assumption: assumptionFor(notional, closesExactly) };
  }

  const walk = walkBook(isBuy ? asks : bids, size);
  if (walk.insufficient) {
    return refuse("book_depth",
      "Larger than the whole visible book.",
      `The venue publishes twenty levels a side. They hold ${fmtSz(walk.filled, szDecimals)} `
      + `${info.coin}, and this order is for ${fmtSz(size, szDecimals)}. What lies deeper is `
      + `not public, so this is not `
      + "simulated rather than filled at a made-up price.");
  }
  // A limit order that crosses cannot fill worse than its own limit.
  const avgPx = walk.avgPx;
  if (order.type === "limit") {
    if ((isBuy && walk.worstPx > limitPx) || (!isBuy && walk.worstPx < limitPx)) {
      return refuse("book_depth",
        "The visible book cannot fill this without going past the limit price.",
        "Where the rest would have filled is not public, so it is not simulated.");
    }
  }
  const fill = {
    coin: info.coin, side: order.side, size, avgPx,
    worstPx: walk.worstPx, levels: walk.levels,
    feeRate: fees.taker, fee: size * avgPx * fees.taker,
    leverage: order.leverage, reduceOnly: !!order.reduceOnly,
    slippageVsTouch: isBuy ? avgPx - bestAsk : bestBid - avgPx,
    at: Date.now(),
  };
  const short = marginShortfall(state, info, fill);
  if (short) return short;
  return { ok: true, kind: "fill", fill, assumption: assumptionFor(notional, closesExactly) };
}

/** Would this fill leave the practice account owing money? Refuse it if so.
 *
 *  The check runs applyFill against a copy rather than re-deriving the number,
 *  because the two arithmetics drifting apart is exactly how an account ends up
 *  holding margin it never paid for. Measured before this existed: a 5.94685 BTC
 *  market buy at 1x against a $10,000 balance was accepted and left the balance
 *  at -490,251.66.
 *
 *  It is run after the book walk so the price is the one the order would have
 *  paid, not the touch, and it accounts for the margin a closing leg releases
 *  and the loss it realises.
 */
function marginShortfall(state, info, fill) {
  // A fill that only reduces is never refused for margin, because it frees
  // margin rather than asking for it, and refusing it would lock somebody into
  // a position they asked to get out of. Only the part that opens is checked.
  const pos = state.positions[fill.coin];
  const opposes = !!pos && ((pos.side === "long" && fill.side === "sell")
                         || (pos.side === "short" && fill.side === "buy"));
  if (opposes && pos.size >= fill.size) return null;

  // Only the parts applyFill touches are copied. The closed list starts empty
  // because the trial's own entry is thrown away with it.
  const trial = applyFill({
    ...state,
    balance: state.balance,
    positions: JSON.parse(JSON.stringify(state.positions || {})),
    closed: [],
  }, info, fill);
  if (!trial || trial.balance >= 0) return null;
  const lev = Math.min(fill.leverage || 1, info.maxLeverage);
  return refuse("margin",
    "More margin than the practice account holds.",
    `${fmtSz(fill.size, info.szDecimals)} ${fill.coin} at ${fmtPx(fill.avgPx, info.szDecimals)} `
    + `on ${lev}x needs more than the `
    + `${fmtUsd(state.balance)} free, and would leave it ${fmtUsd(-trial.balance)} short. `
    + "The venue would refuse it for the same reason, so it is refused here.");
}

/** Whether a fill would change anything at all.
 *
 *  A reduce-only fill with nothing on the other side does not. decideOrder
 *  refuses that at submission, but a reduce-only order that rested while the
 *  position it was meant to close went away reaches applyFill anyway on the
 *  resting path, and before this it opened a position in the opposite
 *  direction, which is the one thing reduce-only means it will not do.
 *
 *  It is a separate function so the panel can ask the same question before it
 *  writes "filled" into the event list for something that did nothing.
 */
function fillWouldApply(state, fill) {
  if (!fill.reduceOnly) return true;
  const pos = state.positions[fill.coin];
  return !!pos && ((pos.side === "long" && fill.side === "sell")
                || (pos.side === "short" && fill.side === "buy"));
}

/** Apply a fill to the stored state: open, add to, reduce or close.
 *
 *  Returns the state it mutated, so marginShortfall can run the same arithmetic
 *  on a copy instead of a second implementation of it. paper.js ignores the
 *  return value and is unaffected.
 */
/** Settle any funding the position owes, then apply the fill. USE THIS ONE.
 *
 *  applyFill is synchronous and deletes a closed position outright. Funding is
 *  only known after an await, so a position closed before its funding had been
 *  settled took the charge to the grave with it: the position is gone, its
 *  accrued funding is gone with it, and the closed row reports funding that was
 *  never charged. The window is up to an hour wide and it is the common case,
 *  because most practice positions are opened and closed in one sitting.
 *
 *  Settling first closes the window. It is a separate function rather than a
 *  change to applyFill because applyFill has to stay synchronous: marginShortfall
 *  runs it against a copy of the state to check an order before accepting it,
 *  and that check cannot be allowed to make a network call.
 */
async function settleAndApplyFill(state, info, fill) {
  try {
    await settleFunding(state, fill.coin);
  } catch (e) { /* unreachable rates charge nothing; the fill still applies */ }
  return applyFill(state, info, fill);
}

function applyFill(state, info, fill) {
  const coin = fill.coin;
  const pos = state.positions[coin] || null;
  const isBuy = fill.side === "buy";
  const opposes = !!pos && ((pos.side === "long" && !isBuy) || (pos.side === "short" && isBuy));

  if (!fillWouldApply(state, fill)) return state;

  state.balance -= fill.fee;

  if (opposes) {
    const lot = lotSize(info.szDecimals);
    let closing = Math.min(pos.size, fill.size);
    // Snap the remainder to the lot grid. Subtracting one fill size from another
    // leaves values like 0.3 - 0.1 - 0.1, which is 0.09999999999999998 and not a
    // size the venue can hold. Carried forward it stranded margin in a position
    // too small to close: see the worked sequence on roundSize.
    let left = roundSize(pos.size - closing, info.szDecimals);
    if (left < lot) { closing = pos.size; left = 0; }

    const dir = pos.side === "long" ? 1 : -1;
    const pnl = dir * (fill.avgPx - pos.entryPx) * closing;
    const marginBack = left > 0 ? pos.margin * (closing / pos.size) : pos.margin;
    state.balance += marginBack + pnl;

    // The fee was charged on the whole fill, so the part of it that belongs to
    // the closing leg is the part that gets booked against it. Before this, the
    // whole fee went onto the closed row AND the whole fee went onto the
    // position the overflow opened, so an order that flipped a position had its
    // fee reported twice over while the balance was debited once. The balance
    // was never wrong; the closed table was. Regression: the "flip books the fee
    // once" case in test/paperSim/cases.js asserts booked equals charged.
    const closeShare = fill.size > 0 ? closing / fill.size : 1;
    state.closed.unshift({
      coin, side: pos.side, size: closing, entryPx: pos.entryPx, exitPx: fill.avgPx,
      pnl, funding: (pos.fundingPaid || 0) * (closing / pos.size),
      fees: (pos.feesPaid || 0) * (closing / pos.size) + fill.fee * closeShare,
      openedAt: pos.openedAt, closedAt: fill.at,
    });
    state.closed = state.closed.slice(0, 100);

    if (left <= 0) {
      delete state.positions[coin];
    } else {
      const share = left / pos.size;
      pos.margin -= marginBack;
      pos.fundingPaid = (pos.fundingPaid || 0) * share;
      pos.feesPaid = (pos.feesPaid || 0) * share;
      pos.size = left;
    }

    const over = roundSize(fill.size - closing, info.szDecimals);
    if (over >= lot && !fill.reduceOnly) {
      openPosition(state, info, { ...fill, size: over, fee: fill.fee * (1 - closeShare) });
    }
    return state;
  }
  openPosition(state, info, fill);
  return state;
}

/** Open a position, or add to one on the same side.
 *
 *  The fee is booked here but not charged here: applyFill takes it off the
 *  balance once, for the whole fill, before it decides how to split it.
 */
function openPosition(state, info, fill) {
  const coin = fill.coin;
  const lev = Math.min(fill.leverage || 1, info.maxLeverage);
  const margin = (fill.size * fill.avgPx) / lev;
  const existing = state.positions[coin];
  if (existing) {
    const total = roundSize(existing.size + fill.size, info.szDecimals);
    existing.entryPx = (existing.entryPx * existing.size + fill.avgPx * fill.size) / total;
    existing.size = total;
    existing.margin += margin;
    existing.feesPaid = (existing.feesPaid || 0) + fill.fee;
    // Two adds at different leverage leave one number that is not either of
    // them. The margin is what was actually put up, so the leverage on the
    // position is read back from it rather than overwritten with the last one.
    existing.leverage = existing.margin > 0
      ? (existing.size * existing.entryPx) / existing.margin : lev;
    state.balance -= margin;
    return;
  }
  state.balance -= margin;
  state.positions[coin] = {
    coin, side: fill.side === "buy" ? "long" : "short",
    size: roundSize(fill.size, info.szDecimals), entryPx: fill.avgPx, margin, leverage: lev,
    feesPaid: fill.fee, fundingPaid: 0,
    openedAt: fill.at, fundingSettledAt: fill.at,
  };
}

/** Charge the funding the venue actually applied while the position was held.
 *
 *  Not the current rate extrapolated: fundingHistory returns each hour's own
 *  rate with its timestamp, so a position held across a closed browser is
 *  settled at the rates that applied during those hours.
 *
 *  A long pays a positive rate and receives a negative one, which is the
 *  venue's convention.
 *
 *  WHICH PRICE THE NOTIONAL IS TAKEN AT, AND HOW IT WAS SETTLED
 *  This charged rate * size * ENTRY price, which is wrong and not by a little:
 *  on a 1 BTC long entered at 40,000 against a mark of 84,082, six hours of
 *  published rates came to $3.64 instead of $7.65, a factor of 2.1.
 *
 *  The venue's own userFunding rows settle it. Each row carries szi, the rate
 *  and the usdc amount, so the price it was charged at divides straight out:
 *      usdc = -szi * rate * px    =>    px = -usdc / (szi * rate)
 *  Read on 2026-09-21 from the public address
 *  0x31ca8395cf837de08b24da3f660e77761dfb974b at the 04:00 funding, against the
 *  1h candles for the same hour. Re-derive with
 *  `node test/paperSim/funding-basis.js`, which names the same address:
 *
 *      BTC  implied 81430.89   hour open 81463    prev close 81464
 *      ETH  implied  2665.996  hour open  2667.3  prev close  2667.4
 *      SOL  implied   111.570  hour open   111.61 prev close   111.58
 *      AVAX implied    11.282  hour open    11.298
 *
 *  One address, four positions opened at four unrelated prices, and every
 *  implied price lands on that hour's market price. It is charged on the
 *  position's notional at the time of funding, not at entry.
 *
 *  That conclusion holds on a much wider sample. The same derivation across all
 *  177 assets the address held at the 02:00 funding put 171 of 177 implied
 *  prices inside that hour's own candle range. Four assets cannot distinguish a
 *  market price from a coincidence; 177 can.
 *
 *  ORACLE OR MARK IS THE PART THE PUBLIC DATA DOES NOT SETTLE, and an earlier
 *  version of this comment overstated how close the proxy runs. Measured on
 *  those 177, the gap between the implied price and the 1h candle open is NOT
 *  a consistent few basis points and is not one-signed: it runs -58.5 to +88.1
 *  bp, mean -3.5 bp, 123 negative against 54 not. It is tight on the liquid
 *  names and loose on the thin ones, which is what a candle open being a poor
 *  stand-in for a price at an instant looks like: BTC -4.2 bp, ETH -0.9, SOL
 *  -0.9, AVAX -4.9, against SAGA +88.1 and HMSTR -58.5.
 *
 *  So the candle open is a proxy, not the basis, and the venue publishes
 *  oraclePx only for right now and never as an hourly series, so a past hour's
 *  oracle cannot be read back at all. The size of being wrong, worked from the
 *  measured worst case rather than asserted: at the floor rate of 1.25e-5 an
 *  hour, $84,000 of notional is charged $1.05 an hour, and an 88 bp price error
 *  moves that by $0.0093 an hour, so about $0.056 over six hours. On the liquid
 *  names where the gap is a few bp it is a few hundredths of a cent. Both are
 *  small against the charge; neither is the "under a hundredth of a cent" this
 *  comment used to claim, which did not follow from its own premise.
 *
 *  Re-derive all of it with `node test/paperSim/funding-basis.js`.
 *
 *  If the candles do not come back, the current oracle price is used for every
 *  hour and, failing that, nothing is charged at all. Entry price is not a
 *  fallback, because it is the answer that was measured to be wrong.
 */
const FUNDING_HOUR_MS = 60 * 60 * 1000;

/** Has a funding hour boundary passed since this position was last settled?
 *
 *  The venue charges funding ON THE HOUR, not once per hour of holding, so
 *  "has an hour elapsed" is the wrong question and it was the question being
 *  asked. A position opened at 09:11 and looked at 10:00:05 has crossed a
 *  boundary the venue published a rate for, but only 49 minutes had elapsed, so
 *  the old guard returned before fetching anything and the panel's funding row
 *  rendered $0.00. That is an absence displayed as a measurement, in the one
 *  row whose whole job is to report the charge.
 *
 *  Comparing hour numbers asks it correctly: any boundary strictly after the
 *  last settle and at or before now means there is something to fetch.
 */
function fundingDue(pos, nowMs) {
  if (!pos) return false;
  const since = pos.fundingSettledAt || pos.openedAt;
  const now = nowMs || Date.now();
  return Math.floor(now / FUNDING_HOUR_MS) > Math.floor(since / FUNDING_HOUR_MS);
}

async function settleFunding(state, coin) {
  const pos = state.positions[coin];
  if (!pos) return 0;
  const since = pos.fundingSettledAt || pos.openedAt;
  const now = Date.now();
  if (!fundingDue(pos, now)) return 0;
  let rows;
  try {
    rows = await fundingBetween(coin, since, now);
  } catch (e) {
    return 0;                        // no rates, no charge, and no invention
  }
  if (!rows || !rows.length) { pos.fundingSettledAt = now; return 0; }

  // A funding row's `time` is the hour plus the milliseconds the venue took to
  // apply it: 1789963200070, not 1789963200000. Candle buckets are exact. Keying
  // on the raw timestamp matched nothing and charged nothing at all, which is why
  // the hour is floored before the lookup.
  const HOUR = FUNDING_HOUR_MS;
  const opens = await hourlyOpens(coin, since - HOUR, now);
  const bucket = (t) => Math.floor(t / HOUR) * HOUR;
  const due = rows.filter((r) => Number(r.time) > since && isFinite(Number(r.fundingRate)));

  let fallbackPx = null;
  if (due.some((r) => !(opens.get(bucket(Number(r.time))) > 0))) {
    try {
      const info = await assetInfo(coin);
      fallbackPx = isFinite(info.oraclePx) && info.oraclePx > 0 ? info.oraclePx : info.markPx;
    } catch (e) { fallbackPx = null; }
  }

  let paid = 0;
  for (const r of due) {
    const px = opens.get(bucket(Number(r.time))) || fallbackPx;
    if (!(px > 0)) continue;         // no price for that hour, so no charge for it
    paid += (pos.side === "long" ? 1 : -1) * Number(r.fundingRate) * pos.size * px;
  }
  if (paid) {
    state.balance -= paid;
    pos.fundingPaid = (pos.fundingPaid || 0) + paid;
  }
  pos.fundingSettledAt = now;
  return paid;
}

/** Unrealised profit at the venue's mark, which is what it would be worth. */
function unrealised(pos, markPx) {
  const dir = pos.side === "long" ? 1 : -1;
  return dir * (markPx - pos.entryPx) * pos.size;
}

/** A resting order fills only when the mark has gone decisively through it.
 *
 *  THE CONSERVATIVE ROUTE, AND WHY.
 *  Whether a resting order fills depends on queue position, which is not
 *  public. Twenty levels tell us the depth at a price, not our place in the
 *  line at it, nor what arrives or cancels next. A simulator that declares
 *  your order filled is inventing the single fact that matters.
 *
 *  So a resting order is never filled on a touch. It fills only once the mark
 *  has traded clear through the level, which is the case where an order
 *  ahead of you in the queue would also have been consumed. It is still an
 *  assumption, it is labelled as one on the panel, and it is the narrow one.
 *
 *  "Clear through" means a full tick, and the tick has to be the one the venue
 *  can actually quote. Using only the decimal-places limit made it 0.1 for BTC,
 *  so a mark of 84,076.9 counted as through a bid at 84,077, and 84,076.9 is
 *  not a price BTC trades at: five significant figures put its tick at 1.0.
 */
function restingWouldFill(order, markPx, szDecimals) {
  const tick = priceTick(order.px, szDecimals);
  if (order.side === "buy") return markPx <= order.px - tick;
  return markPx >= order.px + tick;
}
