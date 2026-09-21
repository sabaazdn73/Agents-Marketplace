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
];

// The exact source line implementing the inferred min-notional exemption. The
// lifecycle harness needs to run with it switched off to measure what a flat
// $10 floor would do, and an exact-match requirement means a rewording of the
// code makes the harness fail loudly instead of silently measuring nothing.
const EXEMPTION_LINE = "if (notional < MIN_NOTIONAL_USD && !closesExactly) {";
const EXEMPTION_OFF = "if (notional < MIN_NOTIONAL_USD) {";

/** @param {{storage?: object, failStorage?: boolean, disableExemption?: boolean}} opts */
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
  const sandbox = {
    console, fetch, setTimeout, clearTimeout, Date, Math, JSON, Number, Promise, Map, Set,
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
  return { api: sandbox.module.exports, store };
}

module.exports = { load, SRC };
