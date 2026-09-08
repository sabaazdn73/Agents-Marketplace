import { buildGrid, buildGridCalls, tickToBnbPrice, bnbPriceToTick, alignTick,
         TICK_SPACING, formatUnits, parseUnits, GridError, POSITION_MANAGER, TOKEN0, TOKEN1 }
  from '../src/gridTrading.js';

let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log("  [PASS]",m);} else {fail++; console.log("  [FAIL]",m);} };

const CURRENT_TICK = -66227;                 // read live from the pool
const spot = tickToBnbPrice(CURRENT_TICK);
console.log("TICK MATHS (against the live pool: tick -66227, BNB 751.72 USDT)");
ok(Math.abs(spot-751.72)/751.72 < 0.001, `tickToBnbPrice(-66227) = ${spot.toFixed(2)}, live pool says 751.72`);
ok(Math.abs(bnbPriceToTick(spot)-CURRENT_TICK) < 1, `price -> tick round trips to ${bnbPriceToTick(spot).toFixed(1)}`);
ok(bnbPriceToTick(900) < bnbPriceToTick(600), "a HIGHER BNB price gives a LOWER tick (the inversion)");
ok(alignTick(-66227,10)%10===0, "alignTick lands on the pool's spacing");

console.log("\nGRID CONSTRUCTION, 600 to 900 USDT, 8 levels");
const g = buildGrid({ lowPrice:600, highPrice:900, levels:8, currentTick:CURRENT_TICK,
                      usdtPerBuy: parseUnits('50',18), wbnbPerSell: parseUnits('0.05',18) });
console.log(`  spot ${g.spot.toFixed(2)}   orders ${g.orders.length}   skipped ${g.skipped.length}`);
for (const o of g.orders) {
  console.log(`   ${o.side.toUpperCase().padEnd(4)} band ${o.priceLow.toFixed(2)}-${o.priceHigh.toFixed(2)} `+
    `ticks [${o.tickLower},${o.tickUpper}] amt0 ${formatUnits(o.amount0,18,2)} amt1 ${formatUnits(o.amount1,18,4)} L=${o.liquidity>0n}`);
}
for (const s of g.skipped) console.log(`   SKIP ${s.side} @${s.price.toFixed(2)}: ${s.reason}`);

ok(g.orders.every(o=>o.tickLower<o.tickUpper), "every band has tickLower < tickUpper");
ok(g.orders.every(o=>o.tickLower%TICK_SPACING===0 && o.tickUpper%TICK_SPACING===0), "every tick is on spacing");
ok(g.orders.filter(o=>o.side==='buy').every(o=>o.tickLower>CURRENT_TICK), "BUY bands sit entirely ABOVE the current tick");
ok(g.orders.filter(o=>o.side==='sell').every(o=>o.tickUpper<CURRENT_TICK), "SELL bands sit entirely BELOW the current tick");
ok(g.orders.filter(o=>o.side==='buy').every(o=>o.amount1===0n && o.amount0>0n), "BUY levels are single-sided USDT");
ok(g.orders.filter(o=>o.side==='sell').every(o=>o.amount0===0n && o.amount1>0n), "SELL levels are single-sided WBNB");
ok(g.orders.every(o=>o.liquidity>0n), "every order yields non-zero liquidity");
ok(g.orders.filter(o=>o.side==='buy').every(o=>o.price<g.spot), "buys are below spot");
ok(g.orders.filter(o=>o.side==='sell').every(o=>o.price>=g.spot), "sells are at or above spot");
const bands=new Set(g.orders.map(o=>`${o.tickLower}:${o.tickUpper}`));
ok(bands.size===g.orders.length, "no two orders share a tick band");

console.log("\nBATCH ASSEMBLY");
const calls = buildGridCalls({ orders:g.orders, totals:g.totals, recipient:'0x48ce74cdC366E8347f17F7187FBf2AB9240692e9', allowances:{usdt:0n,wbnb:0n} });
console.log(`  ${calls.length} calls for ${g.orders.length} orders`);
calls.slice(0,3).forEach(c=>console.log(`   ${c.functionName.padEnd(8)} -> ${c.to.slice(0,10)}  ${c._label}`));
const approves=calls.filter(c=>c.functionName==='approve');
const mints=calls.filter(c=>c.functionName==='mint');
ok(mints.length===g.orders.length, "one mint per order");
ok(approves.length===2, "both approvals present when allowance is zero");
ok(calls.indexOf(approves[approves.length-1])<calls.indexOf(mints[0]), "approvals come before any mint");
ok(approves.every(c=>c.args[0]===POSITION_MANAGER), "approvals target the position manager");
ok(mints.every(c=>c.args[0].token0===TOKEN0.address && c.args[0].token1===TOKEN1.address), "mint params use the pool's token order");
ok(mints.every(c=>c.args[0].amount0Min<=c.args[0].amount0Desired && c.args[0].amount1Min<=c.args[0].amount1Desired), "min never exceeds desired");
ok(mints.every(c=>(c.args[0].amount0Desired>0n)!==(c.args[0].amount1Desired>0n)), "each mint is single-sided");

const sumU=mints.reduce((s,c)=>s+c.args[0].amount0Desired,0n);
const sumW=mints.reduce((s,c)=>s+c.args[0].amount1Desired,0n);
ok(sumU===g.totals.usdt && sumW===g.totals.wbnb, `approval totals match the mints (${formatUnits(sumU,18,2)} USDT, ${formatUnits(sumW,18,4)} WBNB)`);

const partial = buildGridCalls({ orders:g.orders, totals:g.totals, recipient:'0x48ce74cdC366E8347f17F7187FBf2AB9240692e9', allowances:{usdt:g.totals.usdt, wbnb:g.totals.wbnb} });
ok(partial.filter(c=>c.functionName==='approve').length===0, "sufficient allowance skips both approvals");

console.log("\nREFUSALS");
const refuses=(fn,m)=>{ try{fn(); fail++; console.log("  [FAIL]",m);}catch(e){ if(e instanceof GridError){pass++; console.log("  [PASS]",m,"->",e.message);} else {fail++; console.log("  [FAIL] wrong error",m,e.message);} } };
refuses(()=>buildGrid({lowPrice:900,highPrice:600,levels:5,currentTick:CURRENT_TICK,usdtPerBuy:1n,wbnbPerSell:1n}), "high below low refused");
refuses(()=>buildGrid({lowPrice:600,highPrice:900,levels:1,currentTick:CURRENT_TICK,usdtPerBuy:1n,wbnbPerSell:1n}), "one level refused");
refuses(()=>buildGrid({lowPrice:600,highPrice:900,levels:99,currentTick:CURRENT_TICK,usdtPerBuy:1n,wbnbPerSell:1n}), "too many levels refused");
refuses(()=>buildGrid({lowPrice:751.6,highPrice:751.8,levels:4,currentTick:CURRENT_TICK,usdtPerBuy:1n,wbnbPerSell:1n}), "a range entirely inside the spot guard refused");
refuses(()=>parseUnits('abc'), "non-numeric size refused");
refuses(()=>buildGridCalls({orders:g.orders,totals:g.totals,allowances:{}}), "missing recipient refused");

console.log(`\n${pass}/${pass+fail} passed`);
process.exit(fail?1:0);
