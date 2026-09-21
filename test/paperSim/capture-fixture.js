// Freezes a venue snapshot so the lifecycle counts stay reproducible.
//
//   node test/paperSim/capture-fixture.js
//
// The lifecycle measurement is quoted in paperSim.js as the reason an inferred
// exemption is implemented over a documented rule, so it has to give the same
// answer on re-run. Against a live book it cannot: the depth changes by the
// minute. It runs against this snapshot instead, and cases.js covers the live
// venue separately.
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
  const out = { capturedAt: Date.now(), capturedIso: new Date().toISOString(), assets: {}, fees: {} };
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
})();
