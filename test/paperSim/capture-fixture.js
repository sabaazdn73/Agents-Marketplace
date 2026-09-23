// Freezes a venue snapshot so measurements that depend on what the venue
// published stay reproducible.
//
//   node test/paperSim/capture-fixture.js
//
// TWO SETS OF READERS, AND THEY WANT DIFFERENT SHAPES.
//
// `assets` and `fees` are derived shapes, and they are what lifecycles.js uses.
// The lifecycle measurement is quoted in paperSim.js as the reason an inferred
// exemption is implemented over a documented rule, so it has to give the same
// answer on re-run. Against a live book it cannot: the depth changes by the
// minute.
//
// `raw` is the venue's own responses, verbatim, keyed by the request that asked
// for them. cases.js serves them to a sandboxed fetch, so paperSim's own code
// paths run unchanged against a fixed venue. Three cases were reading the live
// API and asserting what it happened to publish at run time, which made a green
// run partly a weather report: funding over six hours charged nothing when the
// window held no rate, and one thin asset's mark drifted past the tolerance
// against its own mid. Those three now run against `raw`.
//
// WHEN THIS GOES STALE. Nothing here expires on a clock, because a fixture that
// fails on a calendar teaches people to re-capture without reading. What
// notices instead is the venue-observations section at the end of cases.js: it
// reads the live API and reports whether the shape recorded here still matches
// what the venue returns, so a renamed field or a changed arity is printed the
// next time anybody runs the suite. Re-capture when it says so, or when a
// behaviour under test changes what has to be recorded, and read the diff: the
// prices in here are quoted in comments and in the lifecycle output.
const fs = require("fs");
const path = require("path");

async function info(body) {
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${body.type} answered ${r.status}`);
  return r.json();
}

(async () => {
  const coins = ["BTC", "SOL", "DOGE"];
  const [meta, ctxs, fees] = await Promise.all([
    info({ type: "meta" }),
    info({ type: "metaAndAssetCtxs" }),
    info({ type: "userFees", user: "0x0000000000000000000000000000000000000000" }),
  ]);
  const out = { capturedAt: Date.now(), capturedIso: new Date().toISOString(),
                assets: {}, fees: {}, raw: {} };
  // THE SAME INSTANT FOR BOTH SIDES OF THE PAIRING CHECK. metaAndAssetCtxs is
  // two parallel arrays paired by index; allMids is keyed by name and cannot be
  // misaligned the same way, which is what makes it the check on the pairing.
  // Captured back to back so the comparison is of one moment with itself rather
  // than of two moments a second apart.
  const [ctxsRaw, midsRaw] = await Promise.all([
    info({ type: "metaAndAssetCtxs" }),
    info({ type: "allMids" }),
  ]);
  out.raw.metaAndAssetCtxs = ctxsRaw;
  out.raw.allMids = midsRaw;
  out.raw.meta = meta;
  out.raw.userFees = fees;
  // Funding for the window the funding cases use: six hours back from capture,
  // with the hourly opens the charge is priced against. `fundingWindow` records
  // which window these belong to, so the cases ask for exactly it rather than
  // for "six hours before now", which would miss the recorded rows entirely.
  const HOUR = 3600000;
  const fundingEnd = out.capturedAt;
  const fundingStart = fundingEnd - 6 * HOUR;
  out.raw.fundingWindow = { coin: "BTC", startTime: fundingStart, endTime: fundingEnd };
  out.raw.fundingHistory = await info({
    type: "fundingHistory", coin: "BTC", startTime: fundingStart, endTime: fundingEnd });
  out.raw.candleSnapshot = await info({
    type: "candleSnapshot",
    req: { coin: "BTC", interval: "1h", startTime: fundingStart, endTime: fundingEnd } });
  const s = fees.feeSchedule || {};
  out.fees = { taker: Number(s.cross), maker: Number(s.add) };
  for (const coin of coins) {
    const i = ctxs[0].universe.findIndex((a) => a.name === coin);
    const spec = ctxs[0].universe[i], ctx = ctxs[1][i];
    const book = await info({ type: "l2Book", coin });
    let tiers = null;
    if (spec.marginTableId != null) tiers = (await info({ type: "marginTable", id: spec.marginTableId })).marginTiers;
    out.assets[coin] = {
      info: {
        coin, szDecimals: spec.szDecimals, maxLeverage: spec.maxLeverage, marginTiers: tiers,
        markPx: Number(ctx.markPx), oraclePx: Number(ctx.oraclePx), midPx: Number(ctx.midPx),
        hourlyFunding: Number(ctx.funding),
      },
      book: { coin, time: book.time, levels: book.levels },
    };
  }
  const p = path.resolve(__dirname, "fixtures/venue-snapshot.json");
  fs.writeFileSync(p, JSON.stringify(out, null, 1));
  console.log(`wrote ${p}`);
  for (const c of coins) {
    const a = out.assets[c];
    console.log(`  ${c.padEnd(5)} bid ${a.book.levels[0][0].px}  ask ${a.book.levels[1][0].px}  mark ${a.info.markPx}  szDecimals ${a.info.szDecimals}  maxLev ${a.info.maxLeverage}`);
  }
  console.log(`  fees taker ${out.fees.taker} maker ${out.fees.maker}`);
  const fr = out.raw.fundingHistory || [];
  const rateSum = fr.reduce((a, r) => a + Number(r.fundingRate), 0);
  console.log(`  raw: ${Object.keys(out.raw.allMids).length} mids, `
    + `${out.raw.metaAndAssetCtxs[0].universe.length} assets, `
    + `${fr.length} funding rows summing ${rateSum}, `
    + `${(out.raw.candleSnapshot || []).length} hourly candles`);
  // A funding window with no published rate would pin two cases to an assertion
  // they cannot make. Said here rather than discovered as a failure later.
  if (!fr.length || rateSum === 0) {
    console.log("  WARNING: the funding window recorded holds no rate. The two "
      + "funding cases assert that a charge happens, and they cannot pass "
      + "against this. Re-capture over a window the venue published rates for.");
  }
})();
