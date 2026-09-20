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

const _cache = new Map();

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

function roundSize(sz, szDecimals) {
  const f = Math.pow(10, szDecimals);
  return Math.floor(Math.abs(sz) * f) / f;
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
  return p > 0 ? p : null;
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

async function loadState() {
  try {
    const got = await chrome.storage.local.get(PAPER_KEY);
    const s = got && got[PAPER_KEY];
    if (!s || typeof s !== "object" || typeof s.balance !== "number") return emptyState();
    return { ...emptyState(), ...s };
  } catch (e) {
    return emptyState();
  }
}

async function saveState(state) {
  try {
    await chrome.storage.local.set({ [PAPER_KEY]: state });
  } catch (e) { /* a full or blocked store loses the practice history, nothing else */ }
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
];

const REFUSALS_SIMULATED = [
  "Post-only that would cross the spread, which is the one this extension exists for.",
  "Below the venue's minimum order value.",
  "Reduce-only with nothing on that side to reduce.",
  "A size that rounds to zero at the asset's lot size.",
  "A market order larger than the whole visible book.",
];

const REFUSALS_NOT_SIMULATED =
  "Anything that depends on account state nobody outside the venue can see: "
  + "margin tier changes, open order caps, and address-level restrictions. Those "
  + "are not guessed at here.";

// ── Submitting an order ─────────────────────────────────────────────────────

function refuse(code, message, detail) {
  return { ok: false, code, message, detail: detail || null, at: Date.now() };
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

  const size = roundSize(order.size, szDecimals);
  if (!(size > 0)) {
    return refuse("lot_size",
      `A size of ${order.size} rounds to zero at ${info.coin}'s lot size.`,
      `${info.coin} trades in steps of ${Math.pow(10, -szDecimals).toFixed(szDecimals)}.`);
  }

  const pos = state.positions[info.coin] || null;
  if (order.reduceOnly) {
    const opposes = pos && ((pos.side === "long" && !isBuy) || (pos.side === "short" && isBuy));
    if (!opposes) {
      return refuse("reduce_only",
        "Reduce-only, but there is nothing on that side to reduce.",
        pos ? `The open position is ${pos.side}, and this order is a ${order.side}.`
            : `There is no open ${info.coin} position.`);
    }
  }

  // Post-only, and the whole reason this panel sits in this extension.
  if (order.postOnly && order.type === "limit") {
    const px = roundPrice(order.px, szDecimals);
    const crosses = isBuy ? (bestAsk != null && px >= bestAsk)
                          : (bestBid != null && px <= bestBid);
    if (crosses) {
      const touch = isBuy ? bestAsk : bestBid;
      return refuse("post_only",
        "Post-only order refused. It would have crossed the spread and taken "
        + "liquidity instead of resting on the book.",
        `A ${order.side} at ${px} against a best ${isBuy ? "ask" : "bid"} of ${touch}. `
        + "The order never reached the book, so it provided no liquidity and left no "
        + "trace in fills or volume. This is what the rejection rate on an address "
        + "page is counting.");
    }
  }

  // Priced, so notional can be checked the way the venue checks it.
  const refPx = order.type === "market"
    ? (isBuy ? bestAsk : bestBid)
    : roundPrice(order.px, szDecimals);
  if (!(refPx > 0)) {
    return refuse("no_book", "The order book is empty on that side right now.", null);
  }
  const notional = size * refPx;
  if (notional < MIN_NOTIONAL_USD) {
    return refuse("min_notional",
      `Below the venue's minimum order value of $${MIN_NOTIONAL_USD}.`,
      `${size} ${info.coin} at ${refPx} is $${notional.toFixed(2)}.`);
  }

  // A market order, or a limit order priced through the touch, takes.
  const takes = order.type === "market"
    || (isBuy ? (bestAsk != null && roundPrice(order.px, szDecimals) >= bestAsk)
              : (bestBid != null && roundPrice(order.px, szDecimals) <= bestBid));

  if (!takes) {
    return {
      ok: true, kind: "rest",
      order: {
        id: `o${Date.now()}${Math.floor(Math.random() * 1e4)}`,
        coin: info.coin, side: order.side, px: roundPrice(order.px, szDecimals),
        size, reduceOnly: !!order.reduceOnly, postOnly: !!order.postOnly,
        leverage: order.leverage, placedAt: Date.now(),
      },
    };
  }

  const walk = walkBook(isBuy ? asks : bids, size);
  if (walk.insufficient) {
    return refuse("book_depth",
      "Larger than the whole visible book.",
      `The venue publishes twenty levels a side. They hold ${walk.filled} ${info.coin}, `
      + `and this order is for ${size}. What lies deeper is not public, so this is not `
      + "simulated rather than filled at a made-up price.");
  }
  // A limit order that crosses cannot fill worse than its own limit.
  let avgPx = walk.avgPx;
  if (order.type === "limit") {
    const lim = roundPrice(order.px, szDecimals);
    if ((isBuy && walk.worstPx > lim) || (!isBuy && walk.worstPx < lim)) {
      return refuse("book_depth",
        "The visible book cannot fill this without going past the limit price.",
        "Where the rest would have filled is not public, so it is not simulated.");
    }
  }
  return {
    ok: true, kind: "fill",
    fill: {
      coin: info.coin, side: order.side, size, avgPx,
      worstPx: walk.worstPx, levels: walk.levels,
      feeRate: fees.taker, fee: size * avgPx * fees.taker,
      leverage: order.leverage, reduceOnly: !!order.reduceOnly,
      slippageVsTouch: isBuy ? avgPx - bestAsk : bestBid - avgPx,
      at: Date.now(),
    },
  };
}

/** Apply a fill to the stored state: open, add to, reduce or close. */
function applyFill(state, info, fill) {
  const coin = fill.coin;
  const pos = state.positions[coin] || null;
  const isBuy = fill.side === "buy";
  state.balance -= fill.fee;

  if (pos && ((pos.side === "long" && !isBuy) || (pos.side === "short" && isBuy))) {
    // Reducing or closing.
    const closing = Math.min(pos.size, fill.size);
    const dir = pos.side === "long" ? 1 : -1;
    const pnl = dir * (fill.avgPx - pos.entryPx) * closing;
    const marginBack = pos.margin * (closing / pos.size);
    state.balance += marginBack + pnl;
    state.closed.unshift({
      coin, side: pos.side, size: closing, entryPx: pos.entryPx, exitPx: fill.avgPx,
      pnl, funding: (pos.fundingPaid || 0) * (closing / pos.size),
      fees: (pos.feesPaid || 0) * (closing / pos.size) + fill.fee,
      openedAt: pos.openedAt, closedAt: fill.at,
    });
    state.closed = state.closed.slice(0, 100);
    const left = pos.size - closing;
    if (left <= 1e-12) {
      delete state.positions[coin];
    } else {
      pos.size = left;
      pos.margin -= marginBack;
      pos.fundingPaid = (pos.fundingPaid || 0) * (left / (left + closing));
      pos.feesPaid = (pos.feesPaid || 0) * (left / (left + closing));
    }
    const over = fill.size - closing;
    if (over > 1e-12 && !fill.reduceOnly) {
      openPosition(state, info, { ...fill, size: over });
    }
    return;
  }
  openPosition(state, info, fill);
}

function openPosition(state, info, fill) {
  const coin = fill.coin;
  const lev = Math.min(fill.leverage || 1, info.maxLeverage);
  const margin = (fill.size * fill.avgPx) / lev;
  const existing = state.positions[coin];
  if (existing) {
    const total = existing.size + fill.size;
    existing.entryPx = (existing.entryPx * existing.size + fill.avgPx * fill.size) / total;
    existing.size = total;
    existing.margin += margin;
    existing.feesPaid = (existing.feesPaid || 0) + fill.fee;
    state.balance -= margin;
    return;
  }
  state.balance -= margin;
  state.positions[coin] = {
    coin, side: fill.side === "buy" ? "long" : "short",
    size: fill.size, entryPx: fill.avgPx, margin, leverage: lev,
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
 */
async function settleFunding(state, coin) {
  const pos = state.positions[coin];
  if (!pos) return 0;
  const since = pos.fundingSettledAt || pos.openedAt;
  const now = Date.now();
  if (now - since < 60 * 60 * 1000) return 0;
  let rows;
  try {
    rows = await fundingBetween(coin, since, now);
  } catch (e) {
    return 0;                        // no rates, no charge, and no invention
  }
  let paid = 0;
  for (const r of rows || []) {
    if (Number(r.time) <= since) continue;
    const rate = Number(r.fundingRate);
    if (!isFinite(rate)) continue;
    const notional = pos.size * pos.entryPx;
    paid += (pos.side === "long" ? 1 : -1) * rate * notional;
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
 */
function restingWouldFill(order, markPx, szDecimals) {
  const tick = Math.pow(10, -(Math.max(0, 6 - szDecimals)));
  if (order.side === "buy") return markPx <= order.px - tick;
  return markPx >= order.px + tick;
}
