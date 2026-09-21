// Randomized position lifecycles against a frozen venue snapshot.
//
//   node test/paperSim/lifecycles.js
//
// Two things are measured here and both are quoted in paperSim.js:
//
//   1. Balance conservation. After a run of fills, the account has to be worth
//      what it started with plus realised PnL minus fees, counting margin still
//      locked in an open position as the account's own money.
//   2. How often a flat $10 minimum leaves a position too small to close. That
//      count is the argument for implementing an exemption the venue does not
//      document, so it is run both ways, on a fixed snapshot with a fixed seed,
//      and prints the same numbers every time.
const path = require("path");
const { load } = require("./load.js");
const SNAP = require("./fixtures/venue-snapshot.json");

// mulberry32: a seeded PRNG, so "N of 400" means the same thing on re-run.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RUNS = 400;
const FILLS = 12;
const SEED = 20260921;
const COINS = ["BTC", "SOL", "DOGE"];
const UNIT = { BTC: 0.001, SOL: 1, DOGE: 500 };

function run(api, label) {
  const fees = SNAP.fees;
  const rand = rng(SEED);
  let worstDrift = 0, stuck = 0, negative = 0, feeMismatch = 0;
  const stranded = [];
  const refusals = {};

  for (let r = 0; r < RUNS; r++) {
    const coin = COINS[r % COINS.length];
    const { info, book } = SNAP.assets[coin];
    const s = api.emptyState();
    const start = s.balance;
    let feesCharged = 0, realised = 0;

    const submit = (side, size, reduceOnly, leverage) => {
      const d = api.decideOrder(s, info, book, fees, { coin, side, type: "market", size, reduceOnly, leverage });
      if (!d.ok) { refusals[d.code] = (refusals[d.code] || 0) + 1; return d; }
      const pos = s.positions[coin];
      const opposes = pos && ((pos.side === "long" && side === "sell") || (pos.side === "short" && side === "buy"));
      if (opposes) {
        const closing = Math.min(pos.size, d.fill.size);
        realised += (pos.side === "long" ? 1 : -1) * (d.fill.avgPx - pos.entryPx) * closing;
      }
      feesCharged += d.fill.fee;
      api.applyFill(s, info, d.fill);
      if (s.balance < -1e-9) negative++;
      return d;
    };

    for (let i = 0; i < FILLS; i++) {
      submit(rand() < 0.5 ? "buy" : "sell",
        api.roundSize(UNIT[coin] * (0.3 + rand() * 4), info.szDecimals),
        rand() < 0.35,
        1 + Math.floor(rand() * info.maxLeverage));
    }
    // Try to go flat, the way the panel's close button does.
    const open = s.positions[coin];
    if (open) submit(open.side === "long" ? "sell" : "buy", open.size, true, open.leverage);

    const left = s.positions[coin];
    if (left) {
      stuck++;
      stranded.push(left.size * info.markPx);
    }
    // Margin locked in an unclosed position, and its mark-to-market, are still
    // the account's money, so both sides of the comparison carry them.
    const lockedMargin = left ? left.margin : 0;
    const openPnl = left ? (left.side === "long" ? 1 : -1) * (info.markPx - left.entryPx) * left.size : 0;
    const have = s.balance + lockedMargin + openPnl;
    const expect = start + realised + openPnl - feesCharged;
    worstDrift = Math.max(worstDrift, Math.abs(have - expect));

    const booked = s.closed.reduce((a, c) => a + c.fees, 0) + (left ? left.feesPaid : 0);
    if (Math.abs(booked - feesCharged) > 1e-8) feeMismatch++;
  }

  console.log(`\n${label}`);
  console.log(`  worst balance drift            : ${worstDrift.toExponential(3)}`);
  console.log(`  negative balances              : ${negative}`);
  console.log(`  fee booking mismatches         : ${feeMismatch}`);
  console.log(`  runs ending unable to go flat  : ${stuck} of ${RUNS}`);
  if (stranded.length) {
    stranded.sort((a, b) => a - b);
    console.log(`  value stuck in those positions : $${stranded[0].toFixed(2)} to $${stranded[stranded.length - 1].toFixed(2)}`
      + ` (median $${stranded[Math.floor(stranded.length / 2)].toFixed(2)})`);
  }
  console.log(`  refusals raised                : ${JSON.stringify(refusals)}`);
  return { worstDrift, stuck, negative, feeMismatch, stranded };
}

console.log(`venue snapshot ${SNAP.capturedIso}`);
for (const c of COINS) {
  const a = SNAP.assets[c];
  console.log(`  ${c.padEnd(5)} bid ${a.book.levels[0][0].px} ask ${a.book.levels[1][0].px} szDecimals ${a.info.szDecimals} maxLev ${a.info.maxLeverage}`);
}
console.log(`seed ${SEED}, ${RUNS} runs of ${FILLS} fills, then a close`);

const withExemption = run(load().api, "WITH the inferred exemption (what ships)");
const without = run(load({ disableExemption: true }).api, "WITHOUT it, a flat $10 floor on every order");

console.log("\nwhat this supports:");
console.log(`  a flat floor strands a position in ${without.stuck} of ${RUNS} runs; the exemption strands ${withExemption.stuck}.`);
console.log(`  balance conservation holds either way, worst drift ${Math.max(withExemption.worstDrift, without.worstDrift).toExponential(3)}.`);

const bad = withExemption.stuck > 0 || withExemption.negative > 0 || withExemption.feeMismatch > 0
  || withExemption.worstDrift > 1e-6;
process.exit(bad ? 1 : 0);
