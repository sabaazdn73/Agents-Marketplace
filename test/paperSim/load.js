// Loads extension/paperSim.js under node with a chrome.storage.local shim.
//
// paperSim.js is a content script: no exports, no module system, and it reaches
// for chrome.storage.local. It is read as text, given a sandbox that supplies
// the one browser API it uses, and an export tail is appended so the tests can
// reach the internals. Nothing in the file itself is modified.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.resolve(__dirname, "../../extension/paperSim.js");

const EXPORTS = [
  "hlInfo", "perpMeta", "assetContexts", "orderBook", "marginTable", "feeSchedule",
  "fundingBetween", "hourlyOpens", "assetInfo", "roundPrice", "roundSize", "lotSize",
  "priceTick", "maintenanceFraction", "liquidationPrice", "walkBook", "emptyState",
  "loadState", "saveState", "resetState", "storageStatus", "NOT_MODELLED",
  "REFUSALS_SIMULATED", "REFUSALS_NOT_SIMULATED", "refuse", "decideOrder", "applyFill",
  "openPosition", "settleFunding", "settleAndApplyFill", "fundingDue", "fillWouldApply",
  "marginShortfall", "fmtUsd", "fmtPx", "fmtSz", "fmtNum", "unrealised", "restingWouldFill", "MIN_NOTIONAL_USD",
  "STARTING_BALANCE", "PAPER_KEY",
  "setPositionLevel", "clearPositionLevel", "markHasPassedLevel", "levelIsStale",
  "levelBelowEntry", "closeValueAt", "realisedValue", "positionLadder",
  "LEVEL_PASSED_NOTE", "LIQUIDATION_UNPRICED_NOTE", "LEVEL_STALE_NOTE",
  "assetSpecs", "ticketLeverage", "positionRow", "openPositions", "closeAllValue",
  "assetUnreadNote", "markUnreadNote", "FEES_UNREAD_NOTE",
];

// The exact source line implementing the inferred min-notional exemption. The
// lifecycle harness needs to run with it switched off to measure what a flat
// $10 floor would do, and an exact-match requirement means a rewording of the
// code makes the harness fail loudly instead of silently measuring nothing.
const EXEMPTION_LINE = "if (notional < MIN_NOTIONAL_USD && !closesExactly) {";
const EXEMPTION_OFF = "if (notional < MIN_NOTIONAL_USD) {";

/** @param {{storage?: object, failStorage?: boolean, disableExemption?: boolean,
 *           countRequests?: boolean, venue?: object}} opts */
function load(opts = {}) {
  const store = opts.storage || {};
  const fail = !!opts.failStorage;
  const local = {
    get: async (k) => {
      if (fail) throw new Error("storage unavailable");
      return k in store ? { [k]: JSON.parse(JSON.stringify(store[k])) } : {};
    },
    set: async (o) => {
      if (fail) throw new Error("storage unavailable");
      Object.assign(store, JSON.parse(JSON.stringify(o)));
    },
  };
  // Every request the module makes, in order, as the `type` on its body. The
  // module's own cache sits behind hlInfo, so what lands here is what actually
  // went to the venue and nothing that was served from memory. Used by the
  // case that counts what pricing every open position costs.
  const requests = [];
  const countingFetch = async (url, init) => {
    let type = "?";
    try { type = JSON.parse(init && init.body).type; } catch (e) { /* leave it */ }
    requests.push(type);
    return fetch(url, init);
  };

  // A VENUE THAT DOES NOT MOVE, for the cases that would otherwise assert what
  // the market happened to be doing when somebody ran them.
  //
  // `opts.venue` is a snapshot from capture-fixture.js. paperSim's own request
  // path runs unchanged: hlInfo builds the same body, this answers it from the
  // recording, and the module cannot tell the difference. Nothing is stubbed
  // inside the module, so what the case exercises is the shipped code.
  //
  // AN UNRECORDED REQUEST THROWS. It does not fall through to the live API and
  // it does not answer with an empty object. Either of those would let a case
  // that believes it is pinned quietly go back to reading the market, or pass
  // on an absence, which is the failure this whole change exists to remove. The
  // message names the request so the fix is to capture it, not to guess.
  const snapFetch = async (url, init) => {
    let body = {};
    try { body = JSON.parse(init && init.body) || {}; } catch (e) { body = {}; }
    const raw = opts.venue.raw || {};
    const answer = (() => {
      switch (body.type) {
        case "meta": return raw.meta;
        case "metaAndAssetCtxs": return raw.metaAndAssetCtxs;
        case "allMids": return raw.allMids;
        case "userFees": return raw.userFees;
        case "l2Book": {
          const a = opts.venue.assets[body.coin];
          return a ? a.book : undefined;
        }
        case "marginTable": {
          // Every tier table the snapshot's own assets use, read back out of
          // the recorded meta rather than captured a second time.
          const pairs = (raw.meta && raw.meta.marginTables) || [];
          const hit = pairs.find((pair) => Number(pair[0]) === Number(body.id));
          return hit ? hit[1] : undefined;
        }
        // THE WINDOW IS NOT MATCHED, AND THAT IS DELIBERATE. settleFunding asks
        // for (fundingSettledAt, Date.now()) and for candles over a window one
        // hour wider, so the request moves every second the clock does and an
        // exact match would never answer. What makes the result reproducible
        // instead is that the rows carry their own recorded timestamps and the
        // module filters them itself: a case sets the position's clock to
        // `raw.fundingWindow.startTime`, every recorded row is then inside the
        // window, and the charge is the same arithmetic on every run. The coin
        // IS matched, because handing BTC's rates to a SOL position would be a
        // wrong answer rather than a missing one.
        case "fundingHistory":
          return body.coin === (raw.fundingWindow || {}).coin ? raw.fundingHistory : undefined;
        case "candleSnapshot": {
          const w = raw.fundingWindow || {};
          const req = body.req || {};
          return (req.coin === w.coin && req.interval === "1h")
            ? raw.candleSnapshot : undefined;
        }
        default: return undefined;
      }
    })();
    if (answer === undefined) {
      throw new Error(`the venue snapshot holds no ${body.type} for `
        + `${JSON.stringify(body).slice(0, 160)}. Capture it in `
        + "test/paperSim/capture-fixture.js, or run this case live on purpose.");
    }
    return {
      ok: true, status: 200,
      json: async () => JSON.parse(JSON.stringify(answer)),
    };
  };

  const sandbox = {
    console,
    fetch: opts.venue ? snapFetch : (opts.countRequests ? countingFetch : fetch),
    setTimeout, clearTimeout, Date, Math, JSON, Number, Promise, Map, Set,
    Array, Object, String, isFinite, parseFloat, parseInt, Error, NaN, Infinity,
    chrome: { storage: { local } },
    module: { exports: {} },
  };
  sandbox.globalThis = sandbox;
  const tail = "\n;module.exports = {"
    + EXPORTS.map((n) => `${n}: typeof ${n} !== "undefined" ? ${n} : undefined`).join(",")
    + "};\n";
  let src = fs.readFileSync(SRC, "utf8");
  if (opts.disableExemption) {
    if (!src.includes(EXEMPTION_LINE)) {
      throw new Error(`load({disableExemption}) could not find:\n  ${EXEMPTION_LINE}\nin ${SRC}. `
        + "The exemption was reworded; update EXEMPTION_LINE in this harness.");
    }
    src = src.replace(EXEMPTION_LINE, EXEMPTION_OFF);
  }
  vm.createContext(sandbox);
  vm.runInContext(src + tail, sandbox, { filename: SRC });
  return { api: sandbox.module.exports, store, requests };
}

module.exports = { load, SRC };
