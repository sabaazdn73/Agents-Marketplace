// Named behaviour cases for paperSim.js, driven against the live venue.
//
//   node test/paperSim/cases.js
//
// Live on purpose: refusals have to fire against the book as it is, not against
// a book chosen to make them fire. The reproducible counting lives in
// lifecycles.js, which uses a frozen snapshot instead.
//
// Exit status is the number of failures, so it can gate anything.
const { load } = require("./load.js");

const rows = [];
let failures = 0;
function check(name, outcome, pass, note) {
  rows.push({ name, outcome, pass, note: note || "" });
  if (pass === false) failures++;
}
const n6 = (x) => (x == null || !isFinite(x) ? String(x) : Number(x).toFixed(6));

// Shared by every block that reads refusal text, so the two rules cannot drift
// into two versions of themselves. What each one catches is written out where
// they are first used, under "every number a person reads, in every refusal".
//           a run of 4+ digits that is not the fractional part of a number
const UNGROUPED = /(?<![\d.])\d{4,}/;
const LONG_TAIL = /\d\.\d{8,}/;

(async () => {
  const { api } = load();
  const [btc, sol, doge, fees] = await Promise.all([
    api.assetInfo("BTC"), api.assetInfo("SOL"), api.assetInfo("DOGE"), api.feeSchedule(),
  ]);
  const [bookB, bookS, bookD] = await Promise.all([
    api.orderBook("BTC"), api.orderBook("SOL"), api.orderBook("DOGE"),
  ]);
  const touch = (b) => ({ bid: Number(b.levels[0][0].px), ask: Number(b.levels[1][0].px) });
  const B = touch(bookB), S = touch(bookS), D = touch(bookD);
  const fresh = () => api.emptyState();
  const decide = (st, info, book, o) => api.decideOrder(st, info, book, fees, o);
  const rich = () => { const s = fresh(); s.balance = 5e9; return s; };

  console.log(`live venue ${new Date().toISOString()}`);
  console.log(`  BTC  bid ${B.bid} ask ${B.ask} mark ${btc.markPx} szDecimals ${btc.szDecimals} maxLev ${btc.maxLeverage}`);
  console.log(`  SOL  bid ${S.bid} ask ${S.ask} mark ${sol.markPx} szDecimals ${sol.szDecimals} maxLev ${sol.maxLeverage}`);
  console.log(`  DOGE bid ${D.bid} ask ${D.ask} mark ${doge.markPx} szDecimals ${doge.szDecimals} maxLev ${doge.maxLeverage}`);
  console.log(`  fees taker ${fees.taker} maker ${fees.maker}`);

  // ── the book ──────────────────────────────────────────────────────────────
  {
    // The whole of the first level plus part of the second, so it walks exactly
    // two levels whatever the shape of the book. Taking a fraction of the top
    // three levels' total does not: if the first level holds most of the depth,
    // 95% of the total still fits inside it and the order fills on one level.
    const l1 = Number(bookB.levels[1][0].sz), l2 = Number(bookB.levels[1][1].sz);
    const sz = api.roundSize(l1 + l2 / 2, 5);
    const r = decide(rich(), btc, bookB, { coin: "BTC", side: "buy", type: "market", size: sz, leverage: 40 });
    check("market buy walks multiple levels",
      r.ok ? `avg ${n6(r.fill.avgPx)} vs touch ${B.ask}, worst ${r.fill.worstPx}, ${r.fill.levels.length} levels, slip ${n6(r.fill.slippageVsTouch)}` : `REFUSED ${r.code}`,
      r.ok && r.fill.levels.length >= 2 && r.fill.avgPx >= B.ask && r.fill.avgPx <= r.fill.worstPx);

    const all = bookB.levels[1].reduce((a, l) => a + Number(l.sz), 0);
    const r2 = decide(rich(), btc, bookB, { coin: "BTC", side: "buy", type: "market", size: all * 2, leverage: 40 });
    check("market order larger than the whole visible book", r2.ok ? "FILLED" : `refused ${r2.code}`, !r2.ok && r2.code === "book_depth");

    const r3 = decide(fresh(), btc, { levels: [[], []] }, { coin: "BTC", side: "buy", type: "market", size: 0.01, leverage: 5 });
    check("market order against an empty book", r3.ok ? "FILLED" : `refused ${r3.code}`, !r3.ok && r3.code === "no_book");

    const r4 = decide(fresh(), btc, { levels: [[], []] }, { coin: "BTC", side: "buy", type: "limit", px: B.bid, size: 0.01, postOnly: true, leverage: 5 });
    check("limit order when the other side is empty", r4.ok ? `${r4.kind} (asserts a book it cannot see)` : `refused ${r4.code}`,
      !r4.ok && r4.code === "no_book", "cannot be checked for crossing, so it must not rest");
  }

  // ── post-only, the feature this exists for ────────────────────────────────
  for (const [nm, info, book, T, sz, bump] of [["BTC", btc, bookB, B, 0.01, 10], ["SOL", sol, bookS, S, 1, 1]]) {
    for (const side of ["buy", "sell"]) {
      const px = side === "buy" ? T.ask + bump : T.bid - bump;
      const r = decide(fresh(), info, book, { coin: nm, side, type: "limit", px, size: sz, postOnly: true, leverage: 5 });
      // The crossed level has to be named, and named the way the rest of the
      // event list writes a price: "84,262", not "84262".
      const level = side === "buy" ? T.ask : T.bid;
      const shown = api.fmtPx(level, info.szDecimals);
      check(`${nm} post-only ${side} through the touch`,
        r.ok ? "ACCEPTED" : `refused ${r.code}, names ${shown}`,
        !r.ok && r.code === "post_only" && r.detail.includes(shown));
    }
    const at = decide(fresh(), info, book, { coin: nm, side: "buy", type: "limit", px: T.ask, size: sz, postOnly: true, leverage: 5 });
    check(`${nm} post-only buy exactly at the best ask`, at.ok ? "ACCEPTED" : `refused ${at.code}`, !at.ok && at.code === "post_only");

    const rest = decide(fresh(), info, book, { coin: nm, side: "buy", type: "limit", px: T.bid - bump * 10, size: sz, postOnly: true, leverage: 5 });
    check(`${nm} post-only buy that does not cross`, rest.ok ? `${rest.kind} at ${rest.order.px}` : `REFUSED ${rest.code}`, rest.ok && rest.kind === "rest");
  }

  // ── sizes and prices ──────────────────────────────────────────────────────
  for (const [nm, info, book, sz] of [["BTC", btc, bookB, 0.000001], ["SOL", sol, bookS, 0.004], ["DOGE", doge, bookD, 0.4]]) {
    const r = decide(fresh(), info, book, { coin: nm, side: "buy", type: "market", size: sz, leverage: 5 });
    check(`${nm} size ${sz} rounds to zero at the lot size`, r.ok ? "FILLED" : `refused ${r.code}`, !r.ok && r.code === "lot_size");
  }
  for (const [nm, info, book, sz] of [["SOL", sol, bookS, 0.29], ["SOL", sol, bookS, 0.57], ["DOGE", doge, bookD, 371]]) {
    const r = decide(rich(), info, book, { coin: nm, side: "buy", type: "market", size: sz, leverage: 5 });
    check(`${nm} size ${sz} is already on the lot grid`, r.ok ? `filled ${r.fill.size}` : `REFUSED ${r.code}`, r.ok && r.fill.size === sz,
      "IEEE 754 scaling used to shrink this by one lot");
  }
  {
    const r = decide(fresh(), btc, bookB, { coin: "BTC", side: "buy", type: "limit", px: NaN, size: 0.01, leverage: 5 });
    check("limit order with no price", r.ok ? "ACCEPTED" : `refused ${r.code}`, !r.ok && r.code === "limit_px");
    const sz = api.roundSize(5 / B.ask, 5);
    const r2 = decide(fresh(), btc, bookB, { coin: "BTC", side: "buy", type: "market", size: sz, leverage: 5 });
    check("market buy worth about $5", r2.ok ? "FILLED" : `refused ${r2.code}`, !r2.ok && r2.code === "min_notional");
    // notional off its own price, not the touch
    const px = api.roundPrice(B.bid * 0.5, 5);
    const size = api.roundSize(11 / px, 5);
    const r3 = decide(fresh(), btc, bookB, { coin: "BTC", side: "buy", type: "limit", px, size, postOnly: true, leverage: 5 });
    check(`limit buy far below, $${n6(size * px)} at its own price`, r3.ok ? r3.kind : `refused ${r3.code}`, r3.ok && r3.kind === "rest",
      "would be $" + n6(size * B.ask) + " if priced off the touch");
  }
  // ── every number a person reads, in every refusal ─────────────────────────
  //
  // Two separate defects, so two separate checks. A long decimal tail is raw
  // IEEE 754 leaking through ("85115.53936453752"). A long unseparated run of
  // integer digits is a formatting convention that does not match the rest of
  // the event list ("$10000.00" next to paper.js's "$9,660.66"). The second
  // check is the one that was missing, and it is the one that catches the
  // money values: the first check passes them happily.
  {
    const bigBook = bookB.levels[1].reduce((a, l) => a + Number(l.sz), 0) * 2;
    const probes = [
      ["book depth", rich(), btc, bookB, { coin: "BTC", side: "buy", type: "market", size: bigBook, leverage: 40 }],
      ["margin", fresh(), btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 1, leverage: 1 }],
      ["min notional", fresh(), btc, bookB, { coin: "BTC", side: "buy", type: "market", size: api.roundSize(5 / B.ask, 5), leverage: 5 }],
      ["lot size", fresh(), btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.0000001, leverage: 5 }],
      ["limit price", fresh(), btc, bookB, { coin: "BTC", side: "buy", type: "limit", px: 99999999.5, size: 0.01, leverage: 5 }],
      ["post only", fresh(), btc, bookB, { coin: "BTC", side: "buy", type: "limit", px: B.ask + 10, size: 0.01, postOnly: true, leverage: 5 }],
      ["reduce only", fresh(), btc, bookB, { coin: "BTC", side: "sell", type: "market", size: 0.01, reduceOnly: true, leverage: 5 }],
      ["no book", fresh(), btc, { levels: [[], []] }, { coin: "BTC", side: "buy", type: "limit", px: B.bid, size: 0.01, leverage: 5 }],
      ["big size", rich(), doge, bookD, { coin: "DOGE", side: "buy", type: "market", size: 9e12, leverage: 5 }],
    ];
    const tails = [], groups = [];
    for (const [label, st, info, book, order] of probes) {
      const d = decide(st, info, book, order);
      const text = [d.message, d.detail, d.assumption].filter(Boolean).join(" ");
      if (!text) continue;
      if (LONG_TAIL.test(text)) tails.push(`${label}: ${LONG_TAIL.exec(text)[0]}`);
      if (UNGROUPED.test(text)) groups.push(`${label}: ${UNGROUPED.exec(text)[0]}`);
    }
    check("no refusal carries a raw float tail", tails.length ? tails.join(" | ") : `${probes.length} refusal paths clean`, tails.length === 0);
    check("no refusal carries an ungrouped run of digits", groups.length ? groups.join(" | ") : `${probes.length} refusal paths clean`,
      groups.length === 0, "$10000.00 beside paper.js's $9,660.66 is the defect this catches");

    // the check has to be able to fail, or it is decoration
    check("  and that check would catch an unformatted value",
      `UNGROUPED.test("needs more than the $10000.00 free") = ${UNGROUPED.test("needs more than the $10000.00 free")}`,
      UNGROUPED.test("needs more than the $10000.00 free") === true
        && UNGROUPED.test("needs more than the $10,000.00 free") === false
        && UNGROUPED.test("0.092365 BTC") === false);

    // and the sub-$10 allowance carries its assumption through the same rules
    const s = fresh();
    const o = decide(s, btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.0002, leverage: 10 });
    api.applyFill(s, btc, o.fill);
    const cut = decide(s, btc, bookB, { coin: "BTC", side: "sell", type: "market", size: 0.00015, reduceOnly: true, leverage: 10 });
    api.applyFill(s, btc, cut.fill);
    const whole = decide(s, btc, bookB, { coin: "BTC", side: "sell", type: "market", size: s.positions.BTC.size, reduceOnly: true, leverage: 10 });
    const at = whole.assumption || "";
    check("  the allowance assumption is formatted too", at ? at.slice(0, 48) + "..." : "none",
      !!at && !LONG_TAIL.test(at) && !UNGROUPED.test(at));
  }

  // the formatters themselves
  {
    check("fmtUsd groups and fixes two decimals", `${api.fmtUsd(10000)} / ${api.fmtUsd(9660.664)} / ${api.fmtUsd(-74690.9)}`,
      api.fmtUsd(10000) === "$10,000.00" && api.fmtUsd(9660.664) === "$9,660.66" && api.fmtUsd(-74690.9) === "-$74,690.90");
    check("fmtPx groups at the venue's tick", `BTC ${api.fmtPx(84652.4, 5)} / SOL ${api.fmtPx(115.826, 2)} / DOGE ${api.fmtPx(0.0923651, 0)}`,
      api.fmtPx(84652.4, 5) === "84,652" && api.fmtPx(115.826, 2) === "115.83" && api.fmtPx(0.0923651, 0) === "0.092365");
    check("fmtSz groups at the lot size", `BTC ${api.fmtSz(1, 5)} / DOGE ${api.fmtSz(12345, 0)}`,
      api.fmtSz(1, 5) === "1.00000" && api.fmtSz(12345, 0) === "12,345");
    check("fmtNum echoes input without exponent notation", `${api.fmtNum(0.0000001)} / ${api.fmtNum(99999999.5)}`,
      api.fmtNum(0.0000001) === "0.0000001" && api.fmtNum(99999999.5) === "99,999,999.5");
  }

  // ── reduce-only ───────────────────────────────────────────────────────────
  {
    const r = decide(fresh(), btc, bookB, { coin: "BTC", side: "sell", type: "market", size: 0.01, reduceOnly: true, leverage: 5 });
    check("reduce-only with no position", r.ok ? "FILLED" : `refused ${r.code}`, !r.ok && r.code === "reduce_only");

    const s = fresh();
    const open = decide(s, btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.01, leverage: 10 });
    api.applyFill(s, btc, open.fill);
    const wrong = decide(s, btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.01, reduceOnly: true, leverage: 10 });
    check("reduce-only on the wrong side of a long", wrong.ok ? "FILLED" : `refused ${wrong.code}`, !wrong.ok && wrong.code === "reduce_only");

    const over = decide(s, btc, bookB, { coin: "BTC", side: "sell", type: "market", size: 0.05, reduceOnly: true, leverage: 10 });
    check("reduce-only larger than the position is clamped",
      over.ok ? `size ${over.fill.size}, fee $${n6(over.fill.fee)} not $${n6(0.05 * over.fill.avgPx * fees.taker)}` : `REFUSED ${over.code}`,
      over.ok && Math.abs(over.fill.size - 0.01) < 1e-12, "fee must follow what trades");

    check("fillWouldApply on a flat account", String(api.fillWouldApply(fresh(), { coin: "BTC", side: "sell", reduceOnly: true })),
      api.fillWouldApply(fresh(), { coin: "BTC", side: "sell", reduceOnly: true }) === false);
    const s2 = fresh();
    const o2 = decide(s2, btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.01, leverage: 10 });
    api.applyFill(s2, btc, o2.fill);
    const before = s2.positions.BTC.size;
    api.applyFill(s2, btc, { coin: "BTC", side: "buy", size: 0.01, avgPx: B.ask, worstPx: B.ask, levels: [], feeRate: fees.maker, fee: 0, leverage: 10, reduceOnly: true, at: Date.now() });
    check("reduce-only fill never increases a position", `${before} -> ${s2.positions.BTC.size}`, s2.positions.BTC.size === before);
  }

  // ── the lifecycle and the books that describe it ──────────────────────────
  for (const [nm, info, book, unit] of [["BTC", btc, bookB, 0.01], ["SOL", sol, bookS, 1]]) {
    const s = fresh();
    const start = s.balance;
    let feesPaid = 0, realised = 0;
    const step = (side, size, ro) => {
      const d = decide(s, info, book, { coin: nm, side, type: "market", size, reduceOnly: !!ro, leverage: 10 });
      if (!d.ok) return d;
      const p = s.positions[nm];
      if (p && ro) realised += (p.side === "long" ? 1 : -1) * (d.fill.avgPx - p.entryPx) * Math.min(p.size, d.fill.size);
      feesPaid += d.fill.fee;
      api.applyFill(s, info, d.fill);
      return d;
    };
    const f1 = step("buy", unit), f2 = step("buy", unit);
    const added = s.positions[nm];
    const wantEntry = (f1.fill.avgPx * f1.fill.size + f2.fill.avgPx * f2.fill.size) / (f1.fill.size + f2.fill.size);
    check(`${nm} open then add: size and blended entry`, `${added.size} at ${n6(added.entryPx)}, wanted ${n6(wantEntry)}`,
      Math.abs(added.size - 2 * unit) < 1e-12 && Math.abs(added.entryPx - wantEntry) < 1e-9);
    step("sell", unit, true);
    check(`${nm} partial reduce leaves the rest open`, s.positions[nm] ? `${s.positions[nm].size} left` : "closed", !!s.positions[nm] && Math.abs(s.positions[nm].size - unit) < 1e-9);
    step("sell", s.positions[nm].size, true);
    check(`${nm} full close leaves nothing`, s.positions[nm] ? `DUST ${s.positions[nm].size}` : "flat", !s.positions[nm]);
    const drift = s.balance - (start + realised - feesPaid);
    check(`${nm} balance returns to start plus PnL minus fees`, `${s.balance.toFixed(8)} vs ${(start + realised - feesPaid).toFixed(8)}, drift ${drift.toExponential(2)}`,
      Math.abs(drift) < 1e-6);
    const booked = s.closed.reduce((a, c) => a + c.fees, 0);
    check(`${nm} closed table books the fees once`, `${n6(booked)} booked, ${n6(feesPaid)} charged`, Math.abs(booked - feesPaid) < 1e-9);
  }
  {
    // flip: the case that used to double-count the fee
    const s = fresh();
    let charged = 0;
    const a = decide(s, btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.01, leverage: 10 });
    charged += a.fill.fee; api.applyFill(s, btc, a.fill);
    const b = decide(s, btc, bookB, { coin: "BTC", side: "sell", type: "market", size: 0.03, leverage: 10 });
    charged += b.fill.fee; api.applyFill(s, btc, b.fill);
    const p = s.positions.BTC;
    check("sell 0.03 into a 0.01 long flips to a 0.02 short", p ? `${p.side} ${p.size} at ${n6(p.entryPx)}` : "no position",
      !!p && p.side === "short" && Math.abs(p.size - 0.02) < 1e-12);
    const booked = (s.closed[0] ? s.closed[0].fees : 0) + (p ? p.feesPaid : 0);
    check("flip books the fee once", `${n6(booked)} booked, ${n6(charged)} charged`, Math.abs(booked - charged) < 1e-9);
  }

  // ── margin ────────────────────────────────────────────────────────────────
  {
    // Sized off the live book so that book depth can never be the reason it is
    // refused: comfortably inside the visible asks, and comfortably more than
    // $10,000 buys at 1x. A fixed 0.5 BTC satisfies the second on any plausible
    // price but only satisfies the first on a book that happens to be deep.
    const depth = bookB.levels[1].reduce((a, l) => a + Number(l.sz), 0);
    const affordable = 10000 / B.ask;                 // what 1x margin covers
    const size = api.roundSize(Math.min(depth * 0.5, affordable * 4), 5);
    const canBind = size > affordable && size < depth;
    const r = decide(fresh(), btc, bookB, { coin: "BTC", side: "buy", type: "market", size, leverage: 1 });
    check(`buy ${size} BTC at 1x on a $10,000 account (1x covers ${n6(affordable)})`,
      r.ok ? "ACCEPTED" : `refused ${r.code}`,
      canBind ? (!r.ok && r.code === "margin") : null,
      canBind ? "" : `book too thin to separate margin from depth (visible ${n6(depth)})`);
    const r2 = decide(fresh(), btc, bookB, { coin: "BTC", side: "buy", type: "market", size, leverage: 40 });
    check("the same size at 40x fits", r2.ok ? `filled, margin about $${n6(size * r2.fill.avgPx / 40)}` : `REFUSED ${r2.code}`, r2.ok);
    if (r2.ok) { const s = fresh(); api.applyFill(s, btc, r2.fill); check("  and the balance stays positive", s.balance.toFixed(2), s.balance >= 0); }
    const r3 = decide(fresh(), btc, bookB, { coin: "BTC", side: "buy", type: "limit", px: api.roundPrice(B.bid * 0.9, 5), size: 10, postOnly: true, leverage: 1 });
    check("a resting order nobody could pay for", r3.ok ? `${r3.kind}` : `refused ${r3.code}`, !r3.ok && r3.code === "margin");
    const s = fresh();
    const o = decide(s, btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.1, leverage: 40 });
    api.applyFill(s, btc, o.fill);
    s.balance = 0.5;
    const close = decide(s, btc, bookB, { coin: "BTC", side: "sell", type: "market", size: 0.1, reduceOnly: true, leverage: 40 });
    check("closing is never refused for margin", close.ok ? "allowed" : `REFUSED ${close.code}`, close.ok);
  }

  // ── the inferred minimum-notional exemption, both directions ──────────────
  {
    const s = fresh();
    const o = decide(s, btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.0002, leverage: 10 });
    api.applyFill(s, btc, o.fill);
    const cut = decide(s, btc, bookB, { coin: "BTC", side: "sell", type: "market", size: 0.00015, reduceOnly: true, leverage: 10 });
    api.applyFill(s, btc, cut.fill);
    const p = s.positions.BTC;
    check("a partial reduce can leave a sub-$10 position", p ? `${p.size} BTC, $${n6(p.size * btc.markPx)}` : "flat", !!p && p.size * btc.markPx < 10);
    const part = decide(s, btc, bookB, { coin: "BTC", side: "sell", type: "market", size: 0.00002, reduceOnly: true, leverage: 10 });
    check("  a partial reduce of it is still refused", part.ok ? "ACCEPTED" : `refused ${part.code}`, !part.ok && part.code === "min_notional");
    check("  and the refusal hedges the inferred rule", (part.detail || "").includes("inferred") ? "says it is inferred" : "STATES IT AS VENUE FACT",
      (part.detail || "").includes("inferred"));
    const whole = decide(s, btc, bookB, { coin: "BTC", side: "sell", type: "market", size: p.size, reduceOnly: true, leverage: 10 });
    check("  closing it exactly is allowed", whole.ok ? `allowed, $${n6(whole.fill.size * whole.fill.avgPx)}` : `REFUSED ${whole.code}`, whole.ok);
    check("  and says so when the inference is what allowed it", whole.assumption ? "carries an assumption" : "SILENT",
      !!whole.assumption && whole.assumption.includes("inferred"), "the direction that used to say nothing");
    const plain = decide(fresh(), btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.00005, leverage: 10 });
    check("  a plain order under $10 is still refused", plain.ok ? "ACCEPTED" : `refused ${plain.code}`, !plain.ok && plain.code === "min_notional");
    check("  and a normal order carries no assumption", String(plain.assumption), plain.assumption === undefined || plain.assumption === null);
  }

  // ── liquidation ───────────────────────────────────────────────────────────
  for (const [nm, info, T] of [["BTC", btc, B], ["SOL", sol, S]]) {
    for (const side of ["long", "short"]) {
      for (const lev of [1, 10, info.maxLeverage]) {
        const size = nm === "BTC" ? 0.1 : 10;
        const entry = side === "long" ? T.ask : T.bid;
        const pos = { coin: nm, side, size, entryPx: entry, margin: (size * entry) / lev, leverage: lev };
        const liq = api.liquidationPrice(pos, info);
        const mf = api.maintenanceFraction(info, size * entry);
        if (liq == null) {
          check(`${nm} ${side} ${lev}x liquidation price`, "null", side === "long" && lev === 1, "a 1x long is not liquidatable by price");
          continue;
        }
        const equity = pos.margin + (side === "long" ? 1 : -1) * (liq - entry) * size;
        check(`${nm} ${side} ${lev}x liquidation price`, `${liq.toFixed(4)} (mf ${mf})`,
          Math.abs(equity - mf * liq * size) < 1e-6, `equity ${n6(equity)} equals maintenance ${n6(mf * liq * size)}`);
      }
    }
  }
  {
    check("maintenance tier switches at the published bound",
      `BTC $1.4e8 -> ${api.maintenanceFraction(btc, 1.4e8)}, $1.5e8 -> ${api.maintenanceFraction(btc, 1.5e8)}`,
      api.maintenanceFraction(btc, 1.4e8) === 1 / 80 && api.maintenanceFraction(btc, 1.5e8) === 1 / 40);
  }

  // ── the price ladder: stop, take profit, and what each price realises ─────
  //
  // Every position here is built from the live book or from prices scaled off
  // it, so nothing is asserted against a price chosen to make the assertion
  // pass. The short cases are run against an actual short position rather than
  // a long read backwards, because the inversion is the part that goes wrong.
  {
    // A position opened through the live book, so entry, fees and margin are
    // the ones the venue's own depth produces.
    const openPos = (info, book, side, size, lev) => {
      const s = fresh();
      const d = decide(s, info, book, { coin: info.coin, side, type: "market", size, leverage: lev });
      if (!d.ok) throw new Error(`could not open ${info.coin} ${side}: ${d.code} ${d.message}`);
      api.applyFill(s, info, d.fill);
      return s;
    };
    const dp = (info) => info.szDecimals;
    const grid = (info, px) => api.roundPrice(px, dp(info));

    // ── a level starts unset, and is set, cleared and persisted on its own ──
    {
      const s = openPos(btc, bookB, "buy", 0.1, 10);
      const pos = s.positions.BTC;
      check("a new position carries no stop and no target",
        `stopPx ${pos.stopPx}, targetPx ${pos.targetPx}`,
        pos.stopPx === null && pos.targetPx === null);

      const stop = grid(btc, pos.entryPx * 0.96);
      const target = grid(btc, pos.entryPx * 1.06);
      const rs = api.setPositionLevel(s, btc, "BTC", "stop", stop);
      check("a stop below entry on a long is accepted",
        rs.ok ? `set at ${api.fmtPx(rs.px, 5)}` : `REFUSED ${rs.code}: ${rs.message}`,
        rs.ok === true && pos.stopPx === stop);
      const rt = api.setPositionLevel(s, btc, "BTC", "target", target);
      check("  a take profit above entry on a long is accepted",
        rt.ok ? `set at ${api.fmtPx(rt.px, 5)}` : `REFUSED ${rt.code}: ${rt.message}`,
        rt.ok === true && pos.targetPx === target);

      const c = api.clearPositionLevel(s, "BTC", "stop");
      check("  clearing the stop leaves the take profit alone",
        `stopPx ${pos.stopPx}, targetPx ${pos.targetPx}, cleared ${c.cleared}`,
        c.ok === true && c.cleared === true && pos.stopPx === null && pos.targetPx === target);
      const c2 = api.clearPositionLevel(s, "BTC", "stop");
      check("  clearing one that was never set is not a refusal",
        `ok ${c2.ok}, cleared ${c2.cleared}`, c2.ok === true && c2.cleared === false);

      // moved through the store the panel actually uses
      await api.saveState(s);
      const back = await api.loadState();
      check("  levels persist with the rest of the state",
        back.positions.BTC ? `stopPx ${back.positions.BTC.stopPx}, targetPx ${back.positions.BTC.targetPx}` : "no position",
        !!back.positions.BTC && back.positions.BTC.targetPx === target && back.positions.BTC.stopPx === null);

      const none = api.setPositionLevel(fresh(), btc, "BTC", "stop", stop);
      check("  a level with no position open", none.ok ? "ACCEPTED" : `refused ${none.code}`,
        !none.ok && none.code === "no_position");
      const bad = api.setPositionLevel(s, btc, "BTC", "target", null);
      check("  a level with no price", bad.ok ? "ACCEPTED" : `refused ${bad.code}`,
        !bad.ok && bad.code === "level_px");
    }

    // ── the side check, on a long and on an actual short ────────────────────
    for (const [nm, info, book, T, size] of [["BTC", btc, bookB, B, 0.1], ["SOL", sol, bookS, S, 10]]) {
      for (const side of ["buy", "sell"]) {
        const s = openPos(info, book, side, size, 10);
        const pos = s.positions[nm];
        const long = pos.side === "long";
        const above = grid(info, pos.entryPx * 1.05);
        const below = grid(info, pos.entryPx * 0.95);
        // On a long the stop is below and the target above. On a short both flip.
        const wrongStop = long ? above : below;
        const wrongTarget = long ? below : above;

        const a = api.setPositionLevel(s, info, nm, "stop", wrongStop);
        check(`${nm} ${pos.side}: stop on the winning side of entry`,
          a.ok ? "ACCEPTED" : `refused ${a.code}`, !a.ok && a.code === "level_side");
        check(`  and it names the take profit as what they probably meant`,
          a.message || "", !a.ok && /probably the take profit/.test(a.message || ""));

        const b = api.setPositionLevel(s, info, nm, "target", wrongTarget);
        check(`${nm} ${pos.side}: take profit on the losing side of entry`,
          b.ok ? "ACCEPTED" : `refused ${b.code}`, !b.ok && b.code === "level_side");
        check(`  and it names the stop as what they probably meant`,
          b.message || "", !b.ok && /probably the stop/.test(b.message || ""));

        // Against a copy whose entry is ON the grid, so "at the entry price" is
        // exactly that. A fill that walks two levels has an average entry the
        // venue cannot quote, and rounding it lands a tick to one side, which is
        // a valid level rather than the boundary case being tested here.
        const clone = { ...pos, entryPx: grid(info, pos.entryPx), stopPx: null, targetPx: null };
        const at = api.setPositionLevel({ positions: { [nm]: clone } }, info, nm, "stop", clone.entryPx);
        check(`${nm} ${pos.side}: a stop at the entry price`,
          at.ok ? "ACCEPTED" : `refused ${at.code}`, !at.ok && at.code === "level_side",
          "entry is neither the losing side nor the winning one");

        // and the right way round is accepted, or the check above is decoration
        const rightStop = long ? below : above;
        const rightTarget = long ? above : below;
        const g1 = api.setPositionLevel(s, info, nm, "stop", rightStop);
        const g2 = api.setPositionLevel(s, info, nm, "target", rightTarget);
        check(`${nm} ${pos.side}: the same two prices the right way round`,
          `stop ${g1.ok ? "ok" : g1.code} / target ${g2.ok ? "ok" : g2.code}`,
          g1.ok === true && g2.ok === true);
      }
    }

    // ── the venue's price grid ──────────────────────────────────────────────
    {
      const s = openPos(btc, bookB, "buy", 0.1, 10);
      const pos = s.positions.BTC;
      const on = grid(btc, pos.entryPx * 0.96);
      const tick = api.priceTick(on, 5);
      const off = on + tick / 2;
      const r = api.setPositionLevel(s, btc, "BTC", "stop", off);
      check("a stop half a tick off the venue's grid",
        r.ok ? "ACCEPTED" : `refused ${r.code}`,
        api.roundPrice(off, 5) === off ? null : (!r.ok && r.code === "level_tick"),
        api.roundPrice(off, 5) === off ? "that price is on the grid here, nothing to catch" : `BTC ticks by ${tick} at ${api.fmtPx(on, 5)}`);
      check("  and the refusal names a price the venue can quote",
        r.detail || "", !r.ok && (r.detail || "").includes(api.fmtPx(api.roundPrice(off, 5), 5)));
      const ok = api.setPositionLevel(s, btc, "BTC", "stop", api.roundPrice(on - tick, 5));
      check("  and a price one tick away on the grid is accepted",
        ok.ok ? `set at ${api.fmtPx(ok.px, 5)}` : `REFUSED ${ok.code}`, ok.ok === true);
    }

    // ── a stop past the liquidation price protects nothing ──────────────────
    for (const [nm, info, book, size] of [["BTC", btc, bookB, 0.1], ["SOL", sol, bookS, 10]]) {
      for (const side of ["buy", "sell"]) {
        const s = openPos(info, book, side, size, 10);
        const pos = s.positions[nm];
        const liq = api.liquidationPrice(pos, info);
        if (liq == null) { check(`${nm} ${pos.side} 10x has no liquidation price`, "null", null); continue; }
        const long = pos.side === "long";
        const d = dp(info);
        // The nearest quotable price that is at or past liquidation, so "at or
        // through" is what gets tested and not merely "well past".
        let atLiq = api.roundPrice(liq, d);
        if (long ? atLiq > liq : atLiq < liq) atLiq = api.roundPrice(atLiq + (long ? -1 : 1) * api.priceTick(atLiq, d), d);
        const r = api.setPositionLevel(s, info, nm, "stop", atLiq);
        check(`${nm} ${pos.side}: a stop at the liquidation price`,
          r.ok ? "ACCEPTED" : `refused ${r.code}`, !r.ok && r.code === "level_liq",
          `liquidation ${api.fmtPx(liq, d)}, stop ${api.fmtPx(atLiq, d)}`);
        check(`  and it says the position is gone before the stop is reached`,
          (r.detail || "").slice(0, 60), !r.ok && /never reached/.test(r.detail || ""));

        const inside = api.roundPrice((pos.entryPx + liq) / 2, d);
        const r2 = api.setPositionLevel(s, info, nm, "stop", inside);
        check(`${nm} ${pos.side}: a stop between entry and liquidation`,
          r2.ok ? `set at ${api.fmtPx(r2.px, d)}` : `REFUSED ${r2.code}`, r2.ok === true);
      }
    }
    {
      // a 1x long has no liquidation price, so nothing can be refused against one
      const s = openPos(btc, bookB, "buy", 0.05, 1);
      const pos = s.positions.BTC;
      const r = api.setPositionLevel(s, btc, "BTC", "stop", grid(btc, pos.entryPx * 0.2));
      check("a 1x long takes a stop far below entry",
        r.ok ? `set at ${api.fmtPx(r.px, 5)}` : `REFUSED ${r.code}`,
        api.liquidationPrice(pos, btc) === null ? r.ok === true : null,
        "there is no liquidation price to be past");
      const rows = api.positionLadder(pos, btc, fees, btc.markPx);
      check("  and its ladder has no liquidation row",
        rows.map((x) => x.role).join(" < "), !rows.some((x) => x.role === "liquidation"));
    }

    // ── what a price would realise, tied to the closed row by construction ──
    for (const [nm, info, book, size] of [["BTC", btc, bookB, 0.1], ["SOL", sol, bookS, 10]]) {
      for (const side of ["buy", "sell"]) {
        const s = openPos(info, book, side, size, 10);
        const pos = s.positions[nm];
        // Funding that has already been charged, so the figure has to carry it.
        // Signed the way settleFunding signs it: positive means paid out.
        pos.fundingPaid = 0.37;
        const closeSide = pos.side === "long" ? "sell" : "buy";
        const d = decide(s, info, book, { coin: nm, side: closeSide, type: "market", size: pos.size, reduceOnly: true, leverage: 10 });
        const want = api.closeValueAt(pos, info, fees, d.fill.avgPx);
        api.applyFill(s, info, d.fill);
        const row = s.closed[0];
        // Through the helper, not written out here. A suite that does the
        // subtraction by hand is the second call site all over again, and it
        // would pass while the panel renders something else.
        const got = api.realisedValue(row);
        check(`${nm} ${pos.side}: the ladder figure equals the closed row`,
          `ladder ${n6(want.realises)} vs closed ${n6(got)}`,
          Math.abs(want.realises - got) < 1e-9,
          "pnl minus both fees minus funding, and the two arithmetics cannot drift");
        check(`  and it is not the price difference`,
          `pnl ${n6(want.pnl)}, realises ${n6(want.realises)}`,
          Math.abs(want.pnl - want.realises) > 1e-9 && want.realises < want.pnl);
        check(`  the exit fee is the taker rate on the exit notional`,
          `${n6(want.exitFee)} vs ${n6(want.size * want.px * fees.taker)}`,
          Math.abs(want.exitFee - want.size * want.px * fees.taker) < 1e-12);
        check(`  and the funding already paid is in it`, n6(want.funding), Math.abs(want.funding - 0.37) < 1e-12);
      }
    }
    // ── closing AT a stop or a target, which is what the ladder promises ────
    //
    // The loop above closes at market against the live book, so it lands on the
    // average that book produces and never on a stop or a target. That checks
    // the arithmetic agrees at SOME price; it does not check it at the prices
    // the ladder actually puts a figure against, which are the prices the person
    // named. Those need the fill forced onto an exact price, and the live book
    // cannot be asked to quote one.
    //
    // So the close runs against a book holding one level at the level's own
    // price and nothing else. That is a fabricated book, and it is only ever
    // used to choose a fill price: nothing here reads depth off it, asserts
    // anything about it, or lets it reach a person. The measured book is still
    // what every other case in this file runs on.
    for (const [nm, info, book, size] of [["BTC", btc, bookB, 0.1], ["SOL", sol, bookS, 10]]) {
      for (const side of ["buy", "sell"]) {
        const base = openPos(info, book, side, size, 10);
        const pos0 = base.positions[nm];
        pos0.fundingPaid = 0.41;          // already charged, so the figure has to carry it
        const long = pos0.side === "long";
        const d = dp(info);
        const liq = api.liquidationPrice(pos0, info);
        api.setPositionLevel(base, info, nm, "stop", api.roundPrice((pos0.entryPx + liq) / 2, d));
        api.setPositionLevel(base, info, nm, "target", grid(info, pos0.entryPx * (long ? 1.06 : 0.94)));

        for (const role of ["stop", "target"]) {
          const s = JSON.parse(JSON.stringify(base));
          const pos = s.positions[nm];
          const row = api.positionLadder(pos, info, fees, info.markPx).find((r) => r.role === role);
          const want = api.closeValueAt(pos, info, fees, row.px);
          const lvl = [{ px: String(row.px), sz: String(size * 10) }];
          const synth = { levels: [lvl, lvl] };
          const dec = decide(s, info, synth,
            { coin: nm, side: long ? "sell" : "buy", type: "market", size: pos.size, reduceOnly: true, leverage: 10 });
          if (!dec.ok) {
            check(`${nm} ${pos0.side}: closing AT the ${role} price realises what the ${role} row said`,
              `REFUSED ${dec.code}: ${dec.message}`, false);
            continue;
          }
          api.applyFill(s, info, dec.fill);
          const closedRow = s.closed[0];
          const got = api.realisedValue(closedRow);
          // walkBook divides cost by size, and (size * px) / size is not always
          // px in IEEE 754: at BTC size 0.1 it comes back one ulp out. So the
          // fill is checked against the price the venue could quote rather than
          // against the bit pattern, and the residual is printed.
          check(`${nm} ${pos0.side}: closing AT the ${role} price realises what the ${role} row said`,
            `filled at ${api.fmtPx(dec.fill.avgPx, d)}, row said ${api.fmtUsd(want.realises)}, closed ${api.fmtUsd(got)}, residual ${Math.abs(want.realises - got).toExponential(2)}`,
            api.roundPrice(dec.fill.avgPx, d) === row.px
              && Math.abs(want.realises - got) < 1e-9
              && !s.positions[nm],
            `the ${role} sits ${long ? (role === "stop" ? "below" : "above") : (role === "stop" ? "above" : "below")} entry on a ${pos0.side}`);
          check(`  and the figure is still not the price difference`,
            `pnl ${n6(want.pnl)}, realises ${n6(want.realises)}`,
            Math.abs(want.pnl - want.realises) > 1e-9 && want.realises < want.pnl);
        }
      }
    }

    // ── one quantity, one function, and the gross figure that is not it ────
    {
      // Pinned against the expression itself. Every other case calls
      // realisedValue on one side of its comparison, so without this one the
      // helper could be redefined into something else and they would all keep
      // passing. This is the only place the subtraction is written out.
      const made = { pnl: 512.7, fees: 7.930855, funding: 0.41 };
      check("realisedValue is pnl minus fees minus funding, and nothing else",
        `${n6(api.realisedValue(made))} vs ${n6(made.pnl - made.fees - made.funding)}`,
        api.realisedValue(made) === made.pnl - made.fees - made.funding);
      check("  a row missing its funding has no figure rather than a partial one",
        String(api.realisedValue({ pnl: 1, fees: 2 })),
        api.realisedValue({ pnl: 1, fees: 2 }) === null,
        "a net figure quietly missing a term is the shape of the defect it exists to stop");
      check("  and no row at all is null, not zero",
        `${api.realisedValue(null)} / ${api.realisedValue(undefined)}`,
        api.realisedValue(null) === null && api.realisedValue(undefined) === null);

      // The defect as measured, end to end: set a target, close at exactly it,
      // then read the row the closed list reads.
      const s = openPos(btc, bookB, "buy", 0.1, 10);
      const pos = s.positions.BTC;
      pos.fundingPaid = 0.41;
      const target = grid(btc, pos.entryPx * 1.06);
      api.setPositionLevel(s, btc, "BTC", "target", target);
      const promised = api.positionLadder(pos, btc, fees, btc.markPx)
        .find((r) => r.role === "target").value.realises;
      const lvl = [{ px: String(target), sz: "1" }];
      const dec = decide(s, btc, { levels: [lvl, lvl] },
        { coin: "BTC", side: "sell", type: "market", size: pos.size, reduceOnly: true, leverage: 10 });
      api.applyFill(s, btc, dec.fill);
      const closedRow = s.closed[0];
      const net = api.realisedValue(closedRow);
      const gap = closedRow.pnl - net;
      check("the closed row's gross pnl is not what the trade came to",
        `ladder promised ${api.fmtUsd(promised)}, row.pnl ${api.fmtUsd(closedRow.pnl)}, realisedValue ${api.fmtUsd(net)}, gap ${api.fmtUsd(gap)}`,
        gap > 0 && Math.abs(gap - (closedRow.fees + closedRow.funding)) < 1e-9
          && Math.abs(net - promised) < 1e-9,
        "rendering pnl under a heading about what a trade earned is the defect; the gap is exactly fees plus funding");

      // The asymmetry, asserted rather than left in a comment. A closed row
      // carries the two fees summed and closeValueAt carries them split, so the
      // familiar names are not on the row and reaching for them gives NaN.
      const plausible = closedRow.pnl - closedRow.entryFee - closedRow.exitFee - closedRow.funding;
      check("  a closed row splits its fees differently from closeValueAt",
        `row has fees ${n6(closedRow.fees)}, entryFee ${closedRow.entryFee}, exitFee ${closedRow.exitFee}; the familiar pairing gives ${plausible}`,
        closedRow.entryFee === undefined && closedRow.exitFee === undefined && Number.isNaN(plausible),
        "the pairing that looks right fails loudly instead of printing a plausible wrong figure");
      const atPx = api.closeValueAt({ ...pos, size: closedRow.size }, btc, fees, closedRow.exitPx);
      check("  and the split still sums to what the row carries",
        `${n6(atPx.entryFee + atPx.exitFee)} vs ${n6(closedRow.fees)}`,
        Math.abs(atPx.entryFee + atPx.exitFee - closedRow.fees) < 1e-9);
    }

    {
      const s = openPos(btc, bookB, "buy", 0.1, 10);
      const pos = s.positions.BTC;
      check("with no fee schedule there is no figure rather than a fee-free one",
        String(api.closeValueAt(pos, btc, null, btc.markPx)),
        api.closeValueAt(pos, btc, null, btc.markPx) === null);
      check("  and a price of zero has no figure either",
        String(api.closeValueAt(pos, btc, fees, 0)), api.closeValueAt(pos, btc, fees, 0) === null);
      const rows = api.positionLadder(pos, btc, fees, btc.markPx);
      const mark = rows.find((x) => x.role === "mark");
      check("the mark row comes from the same function as every other row",
        `${n6(mark.value.realises)}`,
        Math.abs(mark.value.realises - api.closeValueAt(pos, btc, fees, btc.markPx).realises) < 1e-12);
    }

    // ── the ladder is ordered by price, and a short inverts it ──────────────
    for (const [nm, info, book, size] of [["BTC", btc, bookB, 0.1], ["SOL", sol, bookS, 10]]) {
      for (const side of ["buy", "sell"]) {
        const s = openPos(info, book, side, size, 10);
        const pos = s.positions[nm];
        const long = pos.side === "long";
        const liq = api.liquidationPrice(pos, info);
        const d = dp(info);
        api.setPositionLevel(s, info, nm, "stop", api.roundPrice((pos.entryPx + liq) / 2, d));
        api.setPositionLevel(s, info, nm, "target", grid(info, pos.entryPx * (long ? 1.06 : 0.94)));
        const rows = api.positionLadder(pos, info, fees, info.markPx);
        const order = rows.map((x) => x.role);
        const ascending = rows.every((r, i) => i === 0 || rows[i - 1].px <= r.px);
        check(`${nm} ${pos.side} ladder is ordered by price`, order.join(" < "), ascending);
        const at = (role) => order.indexOf(role);
        check(`  ${pos.side}: liquidation and stop sit ${long ? "below" : "above"} entry, target ${long ? "above" : "below"}`,
          `${order.join(" < ")}`,
          long
            ? at("liquidation") < at("stop") && at("stop") < at("entry") && at("entry") < at("target")
            : at("target") < at("entry") && at("entry") < at("stop") && at("stop") < at("liquidation"),
          "ordering by role rather than by price is what reads as nonsense on a short");
        const liqRow = rows[at("liquidation")];
        check(`  ${pos.side}: the liquidation row carries a price and no figure`,
          `px ${api.fmtPx(liqRow.px, d)}, value ${liqRow.value}`,
          liqRow.value === null && (liqRow.note || "").includes("backstop"));
        check(`  ${pos.side}: every other row carries one`,
          rows.filter((r) => r.role !== "liquidation" && r.value == null).map((r) => r.role).join(",") || "all priced",
          rows.filter((r) => r.role !== "liquidation").every((r) => r.value && isFinite(r.value.realises)));
      }
    }
    {
      const s = openPos(btc, bookB, "buy", 0.1, 10);
      const rows = api.positionLadder(s.positions.BTC, btc, fees, btc.markPx);
      check("a position with neither level set has neither row",
        rows.map((x) => x.role).join(" < "),
        !rows.some((x) => x.role === "stop" || x.role === "target"));
      check("  and no position at all is an empty ladder",
        JSON.stringify(api.positionLadder(null, btc, fees, btc.markPx)),
        api.positionLadder(null, btc, fees, btc.markPx).length === 0);
    }

    // ── the mark passing a level does nothing, and says nothing else ────────
    {
      const s = openPos(btc, bookB, "buy", 0.1, 10);
      const pos = s.positions.BTC;
      const liq = api.liquidationPrice(pos, btc);
      const stop = api.roundPrice((pos.entryPx + liq) / 2, 5);
      api.setPositionLevel(s, btc, "BTC", "stop", stop);
      const sizeBefore = pos.size, balBefore = s.balance, closedBefore = s.closed.length;

      // A mark far below the stop. Passed through every entry point that takes
      // one, because a trigger could only be simulated by one of them.
      const through = stop * 0.5;
      const passed = api.markHasPassedLevel(pos, "stop", through);
      const rows = api.positionLadder(pos, btc, fees, through);
      const stopRow = rows.find((x) => x.role === "stop");
      check("the mark far through the stop: the mark has passed it",
        `markHasPassedLevel ${passed}, row.markPassed ${stopRow.markPassed}`,
        passed === true && stopRow.markPassed === true);
      check("  and the position is untouched",
        `size ${sizeBefore} -> ${s.positions.BTC ? s.positions.BTC.size : "GONE"}, balance ${balBefore.toFixed(6)} -> ${s.balance.toFixed(6)}, closed ${closedBefore} -> ${s.closed.length}`,
        !!s.positions.BTC && s.positions.BTC.size === sizeBefore && s.balance === balBefore && s.closed.length === closedBefore);
      check("  and the row says the mark passed it, not that it closed",
        (stopRow.note || "").slice(0, 52) + "...",
        stopRow.note === api.LEVEL_PASSED_NOTE
          && /nothing was triggered/.test(stopRow.note)
          && /still open/.test(stopRow.note));

      // The words are the failure mode, so the keys are checked for them too. A
      // panel reads keys; a key called `triggered` becomes a label called
      // Triggered without anybody deciding to write one.
      const FORBIDDEN = /trigger|fill|execut|stopped ?out|closed/i;
      const keys = new Set();
      for (const r of rows) { for (const k of Object.keys(r)) keys.add(k); if (r.value) for (const k of Object.keys(r.value)) keys.add(k); }
      const setRes = api.setPositionLevel(s, btc, "BTC", "target", api.roundPrice(pos.entryPx * 1.05, 5));
      for (const k of Object.keys(setRes)) keys.add(k);
      const offenders = [...keys].filter((k) => FORBIDDEN.test(k));
      check("nothing a level exposes is named after an execution",
        offenders.length ? offenders.join(",") : [...keys].sort().join(","), offenders.length === 0);
      check("  and that check would catch one", `FORBIDDEN.test("triggered") = ${FORBIDDEN.test("triggered")}`,
        FORBIDDEN.test("triggered") && FORBIDDEN.test("wouldFill") && !FORBIDDEN.test("markPassed"));

      const nm = api.NOT_MODELLED.filter((t) => /not an order/.test(t) && /queue position/.test(t));
      check("NOT_MODELLED says a level is not an order at the venue",
        nm.length ? nm[0].slice(0, 60) + "..." : "MISSING", nm.length === 1);
      const sl = api.NOT_MODELLED.filter((t) => /[Ss]lippage/.test(t) && /marked price/.test(t));
      check("  and that the figure carries no slippage",
        sl.length ? sl[0].slice(0, 60) + "..." : "MISSING", sl.length === 1);
    }

    // ── set while the mark is already past the level ────────────────────────
    {
      // Entry above the live mark, built through openPosition so the mark is on
      // a known side of it. 2x, so the liquidation price is nowhere near.
      const s = fresh();
      const entry = api.roundPrice(btc.markPx * 1.1, 5);
      api.openPosition(s, btc, { coin: "BTC", side: "buy", size: 0.1, avgPx: entry, fee: 0, leverage: 2, at: Date.now() });
      const pos = s.positions.BTC;
      const stop = api.roundPrice(btc.markPx * 1.02, 5);   // below entry, above the mark
      const r = api.setPositionLevel(s, btc, "BTC", "stop", stop);
      check("a stop the mark is already past is accepted, and says so",
        r.ok ? `markPassed ${r.markPassed}` : `REFUSED ${r.code}: ${r.message}`,
        r.ok === true && r.markPassed === true && r.note === api.LEVEL_PASSED_NOTE,
        "a level is a mark, not an order, so there is nothing for it to have done");
      check("  and it is on the position afterwards", String(pos.stopPx), pos.stopPx === stop);
      const t = api.setPositionLevel(s, btc, "BTC", "target", api.roundPrice(entry * 1.1, 5));
      check("  a level the mark has not reached says so too",
        `markPassed ${t.markPassed}, note ${t.note}`, t.ok === true && t.markPassed === false && t.note === null);
    }

    // ── a level the entry price moved under ─────────────────────────────────
    {
      // Averaging down a long drags entry below a stop that was set correctly.
      // Built with two openPosition calls at chosen prices because the live mark
      // cannot be asked to move.
      const s = fresh();
      const p1 = api.roundPrice(B.ask, 5);
      const s1 = api.roundPrice(p1 * 0.95, 5);
      api.openPosition(s, btc, { coin: "BTC", side: "buy", size: 0.1, avgPx: p1, fee: 0, leverage: 10, at: Date.now() });
      const set = api.setPositionLevel(s, btc, "BTC", "stop", s1);
      const pos = s.positions.BTC;
      api.openPosition(s, btc, { coin: "BTC", side: "buy", size: 0.1, avgPx: api.roundPrice(p1 * 0.8, 5), fee: 0, leverage: 10, at: Date.now() });
      check("a stop valid when set, left above entry by averaging down",
        `set below ${api.fmtPx(p1, 5)}, entry now ${api.fmtPx(pos.entryPx, 5)}`,
        set.ok === true && api.levelIsStale(pos, "stop") === true && s1 > pos.entryPx);
      const row = api.positionLadder(pos, btc, fees, btc.markPx).find((x) => x.role === "stop");
      check("  the ladder marks it rather than dropping it",
        `stale ${row.stale}, note ${(row.note || "").slice(0, 40)}...`,
        row.stale === true && row.note === api.LEVEL_STALE_NOTE && row.px === s1);
      const again = api.setPositionLevel(s, btc, "BTC", "stop", s1);
      check("  and setting that same price now is refused",
        again.ok ? "ACCEPTED" : `refused ${again.code}`, !again.ok && again.code === "level_side",
        "the stale flag and the validator have to agree about which side is which");
    }

    // ── a flip does not keep the levels of the position it replaced ─────────
    {
      const s = openPos(btc, bookB, "buy", 0.01, 10);
      const pos = s.positions.BTC;
      const liq = api.liquidationPrice(pos, btc);
      api.setPositionLevel(s, btc, "BTC", "stop", api.roundPrice((pos.entryPx + liq) / 2, 5));
      api.setPositionLevel(s, btc, "BTC", "target", api.roundPrice(pos.entryPx * 1.06, 5));
      const flip = decide(s, btc, bookB, { coin: "BTC", side: "sell", type: "market", size: 0.03, leverage: 10 });
      api.applyFill(s, btc, flip.fill);
      const p2 = s.positions.BTC;
      check("flipping long to short does not carry the old levels across",
        p2 ? `${p2.side}, stopPx ${p2.stopPx}, targetPx ${p2.targetPx}` : "no position",
        !!p2 && p2.side === "short" && p2.stopPx === null && p2.targetPx === null,
        "a stop below entry on the long is above entry on the short");
    }

    // ── level refusals read like every other refusal ────────────────────────
    {
      const s = openPos(btc, bookB, "buy", 0.1, 10);
      const pos = s.positions.BTC;
      const liq = api.liquidationPrice(pos, btc);
      const probes = [
        ["level side", () => api.setPositionLevel(s, btc, "BTC", "stop", api.roundPrice(pos.entryPx * 1.05, 5))],
        ["level tick", () => api.setPositionLevel(s, btc, "BTC", "stop", api.roundPrice(pos.entryPx * 0.96, 5) + 0.5)],
        ["level liq", () => api.setPositionLevel(s, btc, "BTC", "stop", api.roundPrice(liq * 0.9, 5))],
        ["level px", () => api.setPositionLevel(s, btc, "BTC", "stop", "not a price")],
        ["no position", () => api.setPositionLevel(fresh(), btc, "BTC", "stop", 80000)],
        ["level kind", () => api.setPositionLevel(s, btc, "BTC", "trail", 80000)],
      ];
      const tails = [], groups = [], shapes = [];
      for (const [label, run] of probes) {
        const r = run();
        if (r.ok) { shapes.push(`${label}: ACCEPTED`); continue; }
        if (typeof r.code !== "string" || typeof r.message !== "string" || !("detail" in r)) shapes.push(`${label}: shape`);
        const text = [r.message, r.detail].filter(Boolean).join(" ");
        if (LONG_TAIL.test(text)) tails.push(`${label}: ${LONG_TAIL.exec(text)[0]}`);
        if (UNGROUPED.test(text)) groups.push(`${label}: ${UNGROUPED.exec(text)[0]}`);
      }
      check("every level refusal has a code, a message and a detail",
        shapes.length ? shapes.join(" | ") : `${probes.length} refusal paths`, shapes.length === 0);
      check("  and carries no raw float tail", tails.length ? tails.join(" | ") : "clean", tails.length === 0);
      check("  and no ungrouped run of digits", groups.length ? groups.join(" | ") : "clean", groups.length === 0);
    }
  }

  // ── funding ───────────────────────────────────────────────────────────────
  {
    const HOUR = 3600000;
    const s = fresh();
    const o = decide(s, btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.1, leverage: 40 });
    api.applyFill(s, btc, o.fill);
    const p = s.positions.BTC;
    p.openedAt = p.fundingSettledAt = Date.now() - 6 * HOUR;
    const before = s.balance;
    const paid = await api.settleFunding(s, "BTC");
    const hist = await api.fundingBetween("BTC", Date.now() - 6 * HOUR, Date.now());
    const rateSum = hist.reduce((a, r) => a + Number(r.fundingRate), 0);
    check(`funding over 6h, ${hist.length} published rows`,
      `charged ${n6(paid)}; at entry would be ${n6(rateSum * p.size * o.fill.avgPx)}`,
      paid !== 0 && Math.abs(s.balance - (before - paid)) < 1e-9);
    check("  settling again charges nothing", String(await api.settleFunding(s, "BTC")), (await api.settleFunding(s, "BTC")) === 0);

    // the boundary bug: less than an hour held, but an hour boundary crossed
    const s2 = fresh();
    const o2 = decide(s2, btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.1, leverage: 40 });
    api.applyFill(s2, btc, o2.fill);
    const p2 = s2.positions.BTC;
    const now = Date.now();
    const lastBoundary = Math.floor(now / HOUR) * HOUR;
    // Opened one second before the most recent boundary, so the position has
    // been held for (now - lastBoundary) + 1s, which is always under an hour,
    // while still having crossed a boundary the venue published a rate for.
    const opened = lastBoundary - 1000;
    p2.openedAt = p2.fundingSettledAt = opened;
    const elapsedMin = (now - opened) / 60000;
    check(`held ${elapsedMin.toFixed(1)} min (under an hour) but across a boundary: fundingDue`,
      String(api.fundingDue(p2, now)), elapsedMin < 60 && api.fundingDue(p2, now) === true,
      "elapsed time is the wrong question; the old guard returned early here");
    const paid2 = await api.settleFunding(s2, "BTC");
    const published = (await api.fundingBetween("BTC", opened, now)).filter((r) => Number(r.time) > opened);
    check("  and it is actually charged", `${n6(paid2)} against ${published.length} published row(s)`,
      published.length === 0 ? null : paid2 !== 0, "used to render as $0.00");

    const s3 = fresh();
    const o3 = decide(s3, btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.1, leverage: 40 });
    api.applyFill(s3, btc, o3.fill);
    s3.positions.BTC.openedAt = s3.positions.BTC.fundingSettledAt = lastBoundary + 1000;
    check("held inside one hour, no boundary crossed: fundingDue", String(api.fundingDue(s3.positions.BTC, now)),
      api.fundingDue(s3.positions.BTC, now) === false);

    // closing settles first
    const s4 = fresh();
    const o4 = decide(s4, btc, bookB, { coin: "BTC", side: "buy", type: "market", size: 0.1, leverage: 40 });
    api.applyFill(s4, btc, o4.fill);
    s4.positions.BTC.openedAt = s4.positions.BTC.fundingSettledAt = Date.now() - 6 * HOUR;
    const close = decide(s4, btc, bookB, { coin: "BTC", side: "sell", type: "market", size: 0.1, reduceOnly: true, leverage: 40 });
    await api.settleAndApplyFill(s4, btc, close.fill);
    check("settleAndApplyFill charges funding before the close",
      s4.closed[0] ? `closed row funding ${n6(s4.closed[0].funding)}` : "no closed row",
      !!s4.closed[0] && s4.closed[0].funding !== 0, "applyFill alone would delete the position first");
  }

  // ── resting orders are never filled on a touch ────────────────────────────
  {
    const o = { coin: "BTC", side: "buy", px: B.bid, size: 0.01 };
    check("resting buy with the mark exactly at it", String(api.restingWouldFill(o, B.bid, 5)), api.restingWouldFill(o, B.bid, 5) === false);
    check("resting buy with the mark a full tick through", String(api.restingWouldFill(o, B.bid - api.priceTick(B.bid, 5), 5)),
      api.restingWouldFill(o, B.bid - api.priceTick(B.bid, 5), 5) === true);
    check("resting buy with a sub-tick move", String(api.restingWouldFill(o, B.bid - 0.1, 5)),
      api.restingWouldFill(o, B.bid - 0.1, 5) === false, `BTC cannot trade at ${B.bid - 0.1}`);
  }

  // ── priceTick against the live books ──────────────────────────────────────
  {
    // WHAT priceTick GUARANTEES, and what it does not.
    //
    // It guarantees every quoted price is a whole number of its own tick. It
    // does NOT guarantee two adjacent levels sit one tick apart: that depends
    // on whether anyone is quoting in between, and on a thin book nobody is.
    //
    // An earlier version asserted the smallest observed gap EQUALLED the tick,
    // which tested book density rather than the function. It is not reliably
    // wrong, which is worse: it is unreliably right. Swept across all 178 perps
    // at one moment, every single book had at least one adjacent pair exactly
    // one tick apart, so that assertion passed everywhere on that sweep. It
    // holds whenever somebody happens to be quoting at the next tick, and the
    // venue promises nothing of the sort. It was caught failing on SUI with a
    // smallest gap of 6 ticks. An assertion that is true most of the time and
    // false on a thin book teaches people to re-run until it goes green.
    //
    // Arithmetic is done in integer tick units, not on the prices, because
    // subtracting two prices reintroduces the float error this is checking:
    // 0.99893 - 0.99887 is 0.000060000000000060005, and dividing by 1e-5 gives
    // 5.999999999994897 rather than 6. Rounding each price to its tick first
    // makes the gap an exact integer subtraction.
    const tickAudit = (levels2, szDecimals) => {
      const [bids, asks] = levels2;
      const all = [...bids, ...asks];
      const bad = [];
      let worst = 0, gapsChecked = 0, grids = new Set();
      const units = all.map((l) => {
        const px = Number(l.px);
        const tick = api.priceTick(px, szDecimals);
        const q = px / tick, r = Math.round(q);
        grids.add(tick);
        if (Math.abs(q - r) > 1e-9 * Math.max(1, r)) bad.push(`${px} is ${q} ticks of ${tick}`);
        return { px, tick, u: r };
      });
      for (const side of [units.slice(0, bids.length), units.slice(bids.length)]) {
        for (let i = 1; i < side.length; i++) {
          const a = side[i - 1], b = side[i];
          // A book spanning a power of ten holds two grids, and a gap across
          // that seam has no single tick to be a multiple of.
          if (a.tick !== b.tick) continue;
          const steps = Math.abs(a.u - b.u);        // exact: both are integers
          gapsChecked++; worst = Math.max(worst, steps);
          if (steps < 1) bad.push(`${a.px} and ${b.px} are ${steps} ticks apart`);
        }
      }
      return { bad, worst, gapsChecked, grids: grids.size };
    };

    const meta = await api.perpMeta();
    const names = ["BTC", "ETH", "SOL", "AVAX", "LINK", "DOGE", "SUI", "WLD", "HYPE", "kPEPE"];
    let ok = 0, tried = 0, sparse = 0, widest = 0;
    const detail = [];
    for (const nm of names) {
      const spec = meta.universe.find((a) => a.name === nm);
      if (!spec) continue;
      let bk; try { bk = await api.orderBook(nm); } catch (e) { continue; }
      if (!bk.levels || bk.levels[0].length < 3) continue;
      const a = tickAudit(bk.levels, spec.szDecimals);
      tried++;
      if (a.worst > 1) sparse++;
      widest = Math.max(widest, a.worst);
      if (!a.bad.length && a.gapsChecked > 0) ok++;
      else detail.push(`${nm}: ${a.bad.slice(0, 2).join("; ") || "no comparable gaps"}`);
    }
    check("every quoted price is a whole number of its own tick",
      `${ok}/${tried} live books${detail.length ? " :: " + detail.join(", ") : ""}`,
      ok === tried && tried >= 8,
      `gaps run up to ${widest} ticks wide here; ${sparse} of ${tried} books are not uniformly one tick`);

    // The conditions that broke the old assertion, constructed rather than
    // waited for, so they are checked on every run instead of whenever the
    // venue happens to produce them.
    const sparseBook = [[{ px: "0.99893" }, { px: "0.99887" }, { px: "0.99860" }], [{ px: "0.99910" }, { px: "0.99999" }]];
    const sp = tickAudit(sparseBook, 1);
    check("  a sparse book, gaps of 6 and 27 ticks", sp.bad.length ? sp.bad.join("; ") : `clean, widest ${sp.worst} ticks`,
      sp.bad.length === 0 && sp.worst === 89, "this is the SUI case that used to fail");

    // straddling a power of ten: 1.0002 steps by 0.0001, 0.99998 by 0.00001
    const straddle = [[{ px: "1.0002" }, { px: "1.0001" }, { px: "0.99998" }, { px: "0.99997" }], [{ px: "1.0003" }]];
    const st2 = tickAudit(straddle, 1);
    check("  a book straddling 1.0000, holding two tick grids",
      st2.bad.length ? st2.bad.join("; ") : `clean across ${st2.grids} grids`,
      st2.bad.length === 0 && st2.grids === 2, "the seam has no single tick, so it is skipped");

    // and it must still be able to fail
    const offGrid = [[{ px: "84250.5" }, { px: "84250" }], [{ px: "84251" }]];
    const og = tickAudit(offGrid, 5);
    check("  an off-grid price is caught", og.bad.length ? og.bad[0] : "PASSED, so the check is decoration",
      og.bad.length > 0, "BTC ticks by 1.0 at 84,250; 84250.5 is not a price");

    check("priceTick at BTC 84,122 (significant figures bind)", String(api.priceTick(84122, 5)), api.priceTick(84122, 5) === 1);
    check("priceTick at 9.8, szDecimals 5 (decimal places bind)", String(api.priceTick(9.8, 5)), api.priceTick(9.8, 5) === 0.1);
  }

  // ── storage failure has to be visible ─────────────────────────────────────
  {
    const broken = load({ failStorage: true });
    const st = await broken.api.loadState();
    const status = broken.api.storageStatus();
    check("a blocked store still hands back a usable account", `balance ${st.balance}`, st.balance === broken.api.STARTING_BALANCE);
    check("  but storageStatus says it is not persisting", `ok=${status.ok} reason=${status.reason}`, status.ok === false && !!status.reason);
    const saved = await broken.api.saveState(st);
    check("  and saveState reports the failure instead of swallowing it", String(saved), saved === false);
    const fine = load();
    const st2 = await fine.api.loadState();
    await fine.api.saveState(st2);
    check("a working store reports ok", String(fine.api.storageStatus().ok), fine.api.storageStatus().ok === true);
  }

  const width = Math.max(...rows.map((r) => r.name.length));
  console.log("\n" + "=".repeat(140));
  for (const r of rows) {
    const mark = r.pass === true ? " ok " : r.pass === false ? "FAIL" : " -- ";
    console.log(`[${mark}] ${r.name.padEnd(width)} | ${r.outcome}${r.note ? "   << " + r.note : ""}`);
  }
  console.log("=".repeat(140));
  console.log(`${rows.length} cases, ${failures} failing`);
  process.exit(failures);
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(70); });
