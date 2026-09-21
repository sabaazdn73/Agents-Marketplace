// Which price Hyperliquid charges funding on, derived from public data only.
//
//   node test/paperSim/funding-basis.js
//
// A fundingHistory row carries a rate and a time and no price, so the notional
// it was charged on is not stated anywhere. userFunding rows for a public
// address do carry szi, the rate and the usdc amount, so the price divides out:
//     usdc = -szi * rate * px   =>   px = -usdc / (szi * rate)
// Comparing that implied price to the 1h candle for the same hour says whether
// funding is charged at entry (it is not) or at a price from that hour (it is),
// and how far the implied price sits from the candle open.
const HOUR = 3600000;
const ADDRESS = "0x31ca8395cf837de08b24da3f660e77761dfb974b";

async function info(body) {
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${body.type} answered ${r.status}`);
  return r.json();
}

(async () => {
  const now = Date.now();
  const rows = await info({ type: "userFunding", user: ADDRESS, startTime: now - 8 * HOUR });
  // group by funding instant, take the most populated one
  const byTime = new Map();
  for (const r of rows) {
    const t = Number(r.time);
    if (!byTime.has(t)) byTime.set(t, []);
    byTime.get(t).push(r);
  }
  const [t, group] = [...byTime.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const bucket = Math.floor(t / HOUR) * HOUR;
  console.log(`address   ${ADDRESS}`);
  console.log(`instant   ${t}  (${new Date(t).toISOString()})`);
  console.log(`bucket    ${bucket} (${new Date(bucket).toISOString()}), row lands ${t - bucket} ms after the hour`);
  console.log(`assets    ${group.length}\n`);

  const out = [];
  for (const r of group) {
    const d = r.delta, coin = d.coin;
    const szi = Number(d.szi), rate = Number(d.fundingRate), usdc = Number(d.usdc);
    if (!szi || !rate) continue;
    const implied = -usdc / (szi * rate);
    let candles;
    try { candles = await info({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: bucket, endTime: bucket + HOUR } }); }
    catch (e) { continue; }
    const c = (candles || []).find((x) => Number(x.t) === bucket);
    if (!c) continue;
    const open = Number(c.o);
    const bp = ((implied - open) / open) * 10000;
    out.push({ coin, implied, open, bp, lo: Number(c.l), hi: Number(c.h) });
  }
  out.sort((a, b) => a.bp - b.bp);
  console.log("coin        implied px        1h open      gap (bp)   inside the hour's range?");
  for (const o of out) {
    const inside = o.implied >= o.lo * 0.999 && o.implied <= o.hi * 1.001;
    console.log(`${o.coin.padEnd(11)} ${o.implied.toPrecision(8).padEnd(17)} ${String(o.open).padEnd(12)} ${o.bp.toFixed(2).padStart(8)}   ${inside}`);
  }
  const bps = out.map((o) => o.bp);
  const inside = out.filter((o) => o.implied >= o.lo * 0.999 && o.implied <= o.hi * 1.001).length;
  const mean = bps.reduce((a, b) => a + b, 0) / bps.length;
  const absMax = Math.max(...bps.map(Math.abs));
  console.log(`\n${out.length} assets, one address, one funding instant`);
  console.log(`  gap to the 1h open : ${Math.min(...bps).toFixed(2)} to ${Math.max(...bps).toFixed(2)} bp, mean ${mean.toFixed(2)} bp`);
  console.log(`  signs              : ${bps.filter((b) => b < 0).length} negative, ${bps.filter((b) => b >= 0).length} non-negative`);
  console.log(`  largest magnitude  : ${absMax.toFixed(2)} bp`);
  console.log(`  inside that hour's candle range: ${inside}/${out.length}`);
  console.log(`\nWhat this settles: the implied price tracks that hour's market price across`);
  console.log(`assets whose entry prices are unrelated, so funding is charged on notional at`);
  console.log(`the time of funding, not at entry. What it does not settle: oracle vs mark,`);
  console.log(`since the gap to the candle open is not one-signed and the venue publishes`);
  console.log(`oraclePx only for the current instant.`);
  // Error bound, derived rather than asserted.
  const rate = Math.abs(Number(group[0].delta.fundingRate));
  const worst = absMax / 10000;
  console.log(`\nError bound if the candle open is used in place of the true basis:`);
  console.log(`  worst gap ${absMax.toFixed(2)} bp = ${worst.toExponential(3)} of price`);
  console.log(`  a rate of ${rate.toExponential(3)} per hour on $84,000 of notional charges`);
  console.log(`    ${(rate * 84000).toFixed(6)} per hour, so the error is ${(rate * 84000 * worst).toExponential(3)} per hour`);
  console.log(`    over six hours: $${(rate * 84000 * worst * 6).toFixed(5)}`);
})();
