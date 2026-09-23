// The rule that `spent` is not delivery, enforced rather than remembered.
//
//   node test/budgetSpent/spent-is-not-delivery.js
//
// AgentBudgetEscrow's reclaim() runs `b.spent = b.total;` before paying the
// client back, so a budget that was never drawn from reads as fully spent.
// Any progress bar, percentage, "delivered" figure or completion signal
// computed from `spent` is therefore wrong, and wrong in the direction that
// flatters the agent.
//
// Two halves, because a rule that only lives in a helper is a rule a future
// change routes around:
//
//   1. The helper does what it says. frontend/src/budgetDelivery.js refuses
//      to produce a percentage from a reclaimed budget, and counts draws
//      from Drawn events rather than from the field.
//   2. Nothing else derives one. A source scan over the frontend, the
//      backend and the extension fails on any line that turns `spent` into a
//      percentage, a bar width or a delivery word outside that one file.
//
// The second half is the part that catches a change nobody remembered to
// think about, which is the point of having it.
//
// WHAT THE SCAN DOES NOT CATCH. READ THIS BEFORE TRUSTING A PASS.
// ---------------------------------------------------------------
// The scan is single-line. It looks at one line at a time, and it only
// examines lines that contain the word `spent`. So it catches the direct
// form, which is the one the codebase actually contained:
//
//     const pct = total > 0n ? Number((spent * 100n) / total) : 0;
//
// and it does not catch the same derivation split across two lines, because
// the second line no longer mentions `spent` at all:
//
//     const drawnAmt = b.spent;
//     const completionPct = Number((drawnAmt * 100n) / b.total);
//
// That was tried against this file and passed, every case green and exit 0,
// with the word "completion" sitting in the derived expression. Aliasing the field
// into another name on one line and deriving from the alias on the next
// defeats the scan completely, and so does carrying the value into another
// function, a component prop, or an API response and deriving there.
//
// A green run therefore means "no direct single-line derivation", which is
// narrower than "no delivery figure is derived from spent". Do not read the
// pass count as coverage of the rule. It is coverage of one shape of the rule
// being broken, the shape that had actually occurred.
//
// This is stated rather than fixed on purpose. Catching aliasing needs
// dataflow analysis; the cheap approximations (flagging every line that
// divides by a total, or every identifier assigned from `spent`) fire on the
// legitimate money-movement code this file is meant to leave alone, and a
// scan that cries wolf gets switched off, which is worse than a scan with a
// written-down limit. The durable guard is budgetDelivery.js being the only
// place that reasons about the field, and code review knowing why.
//
// Also covers budgetLimits.js: the two hard refusals (maxPerDraw = 0 and
// cooldown = 0), the dismissible one (a per-draw limit above half the total),
// and that the dismissal cannot waive either hard refusal. Both files exist
// for the same reason: a setting that makes a budget look better than it is.
//
// Exit status is the number of failures, so it can gate anything.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");

const rows = [];
let failures = 0;
function check(name, outcome, pass, note) {
  rows.push({ name, outcome, pass, note: note || "" });
  if (pass === false) failures++;
}

// ── loading the modules under test ──────────────────────────────────────────
//
// Both files are browser ES modules with no imports of their own, so they are
// read as text, the export keyword is dropped, and the declarations are
// collected out of a vm sandbox. Same approach as test/paperSim/load.js, and
// for the same reason: nothing in the file itself is modified, and the test
// reads the shipped source rather than a copy of it.
function loadModule(relPath) {
  const src = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const names = [];
  for (const m of src.matchAll(/^export\s+(?:const|function)\s+([A-Za-z0-9_$]+)/gm)) {
    names.push(m[1]);
  }
  if (names.length === 0) throw new Error(`no exports found in ${relPath}`);
  const body = src.replace(/^export\s+/gm, "");
  const tail = `\n;__out = { ${names.join(", ")} };\n`;
  const sandbox = { __out: null };
  vm.createContext(sandbox);
  new vm.Script(body + tail, { filename: relPath }).runInContext(sandbox);
  return sandbox.__out;
}

let delivery;
let limits;
try {
  delivery = loadModule("frontend/src/budgetDelivery.js");
  limits = loadModule("frontend/src/budgetLimits.js");
} catch (e) {
  console.error("Could not load the modules under test:", e.message);
  process.exit(70);
}

// Budget statuses, matching the contract's own enum.
const OPEN = 1;
const CLOSED = 2;
const RECLAIMED = 3;

// ── 1. the helper ───────────────────────────────────────────────────────────

// The live case this whole rule exists for. Robinhood Chain budget 1 reads
// total 7e12, spent 7e12, status RECLAIMED, and has zero Drawn events behind
// it: the client took their money back and the field says it all went out.
const reclaimedNeverDrawn = { total: 7000000000000n, spent: 7000000000000n, status: RECLAIMED };

{
  const pct = delivery.moneyDrawnPercent(reclaimedNeverDrawn);
  check(
    "reclaimed budget yields no percentage",
    String(pct),
    pct === null,
    "null means draw no bar; 100 would claim the agent drew everything",
  );
}

{
  const r = delivery.spentReading(reclaimedNeverDrawn);
  check(
    "reclaimed budget: spent is flagged as overwritten",
    r.meaning,
    r.meaning === delivery.SPENT_MEANING.OVERWRITTEN_BY_RECLAIM,
  );
  check("reclaimed budget: not safe to call drawn", String(r.describesDraws), r.describesDraws === false);
}

{
  const half = { total: 1000n, spent: 500n, status: OPEN };
  check("open budget half drawn reads 50", String(delivery.moneyDrawnPercent(half)), delivery.moneyDrawnPercent(half) === 50);
  const r = delivery.spentReading(half);
  check("open budget: spent is the running draw total", r.meaning, r.meaning === delivery.SPENT_MEANING.DRAWN);
  check("open budget: safe to call drawn", String(r.describesDraws), r.describesDraws === true);
}

{
  const closed = { total: 1000n, spent: 250n, status: CLOSED };
  check(
    "closed budget still reports money movement",
    String(delivery.moneyDrawnPercent(closed)),
    delivery.moneyDrawnPercent(closed) === 25,
    "close() does not touch spent, only reclaim() does",
  );
}

{
  const empty = { total: 0n, spent: 0n, status: OPEN };
  check("zero total yields no percentage", String(delivery.moneyDrawnPercent(empty)), delivery.moneyDrawnPercent(empty) === null);
}

{
  // No status at all, which is what a partially loaded read looks like.
  const pct = delivery.moneyDrawnPercent({ total: 100n, spent: 100n });
  check(
    "unknown status still reports movement, not delivery",
    String(pct),
    pct === 100,
    "100% of the money drawn is a fact about money; it is never rendered as completion",
  );
}

{
  const r = delivery.spentReading(reclaimedNeverDrawn);
  const r2 = delivery.spentReading({ total: 10n, spent: 1n, status: OPEN });
  check(
    "no spent reading ever describes delivery",
    `${r.describesDelivery} / ${r2.describesDelivery}`,
    r.describesDelivery === false && r2.describesDelivery === false,
  );
}

{
  // The crux. The field says fully spent; the event stream says nothing was
  // ever drawn. Delivery follows the events.
  check(
    "delivery counts Drawn events, not spent",
    `drawCount=${delivery.drawCount([])} everDrawn=${delivery.wasEverDrawnFrom([])}`,
    delivery.drawCount([]) === 0 && delivery.wasEverDrawnFrom([]) === false,
    "budget reads spent == total and still counts as never drawn from",
  );
  const two = [{ amount: 1n }, { amount: 2n }];
  check("drawCount counts the feed", String(delivery.drawCount(two)), delivery.drawCount(two) === 2);
  check("drawCount tolerates a missing feed", String(delivery.drawCount(undefined)), delivery.drawCount(undefined) === 0);
}

// ── 2. the limits ───────────────────────────────────────────────────────────

const ONE = 10n ** 18n;
function limitCase(name, args, expectField, expectAck) {
  const r = limits.checkBudgetLimits(args);
  const got = r ? r.field : "accepted";
  let pass = got === expectField;
  let outcome = got;
  if (pass && r && expectAck !== undefined) {
    pass = r.acknowledgeable === expectAck;
    outcome = `${got} (acknowledgeable=${r.acknowledgeable})`;
  }
  check(name, outcome, pass, r ? r.message.slice(0, 60) + "…" : "");
}

limitCase("maxPerDraw of 0 is refused", { totalWei: ONE, maxPerDrawWei: 0n, cooldownSeconds: 600 }, "maxPerDraw", false);
limitCase("cooldown of 0 is refused", { totalWei: ONE, maxPerDrawWei: ONE / 4n, cooldownSeconds: 0 }, "cooldown", false);

// The override must not reach the two hard refusals. A caller that sets the
// acknowledgement flag for the single-draw case must still be stopped by
// these, or the override becomes a way past everything.
limitCase(
  "acknowledgement does not waive maxPerDraw of 0",
  { totalWei: ONE, maxPerDrawWei: 0n, cooldownSeconds: 600, acknowledgedSingleDraw: true },
  "maxPerDraw", false,
);
limitCase(
  "acknowledgement does not waive cooldown of 0",
  { totalWei: ONE, maxPerDrawWei: ONE / 4n, cooldownSeconds: 0, acknowledgedSingleDraw: true },
  "cooldown", false,
);
limitCase(
  "acknowledgement does not waive maxPerDraw above the total",
  { totalWei: ONE, maxPerDrawWei: ONE * 2n, cooldownSeconds: 600, acknowledgedSingleDraw: true },
  "maxPerDraw", false,
);
limitCase(
  "acknowledged, a single-draw budget is allowed",
  { totalWei: ONE, maxPerDrawWei: ONE, cooldownSeconds: 600, acknowledgedSingleDraw: true },
  "accepted",
);
limitCase("both at 0 is refused", { totalWei: ONE, maxPerDrawWei: 0n, cooldownSeconds: 0 }, "maxPerDraw");
limitCase("cooldown just under the floor is refused", { totalWei: ONE, maxPerDrawWei: ONE / 4n, cooldownSeconds: 59 }, "cooldown");
limitCase("cooldown at the floor is accepted", { totalWei: ONE, maxPerDrawWei: ONE / 4n, cooldownSeconds: 60 }, "accepted");
limitCase("maxPerDraw equal to the total is refused", { totalWei: ONE, maxPerDrawWei: ONE, cooldownSeconds: 600 }, "maxPerDraw", true);
limitCase("maxPerDraw above the total is refused", { totalWei: ONE, maxPerDrawWei: ONE * 2n, cooldownSeconds: 600 }, "maxPerDraw");
limitCase("maxPerDraw at half the total is accepted", { totalWei: ONE, maxPerDrawWei: ONE / 2n, cooldownSeconds: 600 }, "accepted");
limitCase("empty total is refused", { totalWei: 0n, maxPerDrawWei: 0n, cooldownSeconds: 600 }, "total");
limitCase(
  "the panel's own defaults are accepted",
  { totalWei: ONE / 100n, maxPerDrawWei: ONE / 500n, cooldownSeconds: 600 },
  "accepted",
);
// The live configurations, read back from the BSC contract.
limitCase(
  "BSC budget 1 as opened (cooldown 0) is refused",
  { totalWei: 200000000000000n, maxPerDrawWei: 100000000000000n, cooldownSeconds: 0 },
  "cooldown",
);
// Budget 2 trips the hard cooldown stop first, which is correct: the
// dismissible refusal must never stand in front of one that is not.
limitCase(
  "BSC budget 2 as opened is refused on the hard stop first",
  { totalWei: 100000000000000n, maxPerDrawWei: 100000000000000n, cooldownSeconds: 0 },
  "cooldown", false,
);
// With the cooldown fixed it becomes the one-draw case, which is dismissible.
limitCase(
  "BSC budget 2 with a legal cooldown is the dismissible case",
  { totalWei: 100000000000000n, maxPerDrawWei: 100000000000000n, cooldownSeconds: 3600 },
  "maxPerDraw", true,
);
limitCase(
  "BSC budget 3 as opened is accepted unchanged",
  { totalWei: 1000000000000000n, maxPerDrawWei: 100000000000000n, cooldownSeconds: 3600 },
  "accepted",
);

{
  const zero = limits.COOLDOWN_CHOICES.filter((c) => !(c.value >= limits.MIN_COOLDOWN_SECONDS));
  check(
    "no offered cooldown is below the floor",
    zero.length === 0 ? "none" : JSON.stringify(zero),
    zero.length === 0,
    "a control that can reach a refused value invites the refusal",
  );
}

// ── 3. nothing else derives a delivery figure from spent ────────────────────
//
// The scan is deliberately crude and deliberately loud. It looks for a line
// that mentions spent and also does one of the things that turns a number
// into a claim: multiplies to a percentage, divides by the total, sets a bar
// width, or puts a delivery word next to it. A line that needs to do one of
// those legitimately belongs in budgetDelivery.js, which is the whole point
// of that file existing.

const SCAN_DIRS = ["frontend/src", "backend", "extension"];
const SCAN_EXT = new Set([".js", ".jsx", ".py"]);
const SKIP_DIRS = new Set(["node_modules", "venv", "__pycache__", "dist", ".pytest_cache", ".ruff_cache", "assets"]);
// paper.js and paper.css are owned elsewhere and hold no budget code.
const SKIP_FILES = new Set([
  path.join(ROOT, "extension/paper.js"),
  path.join(ROOT, "extension/paper.css"),
  // The one file allowed to reason about spent, because reasoning about it is
  // what it is for.
  path.join(ROOT, "frontend/src/budgetDelivery.js"),
  // The test that enforces the rule has to be able to name it.
  __filename,
]);

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, out);
    } else if (SCAN_EXT.has(path.extname(e.name)) && !SKIP_FILES.has(full)) {
      out.push(full);
    }
  }
  return out;
}

// Turns a number into a claim.
const DERIVES = [
  /\*\s*100\b/,              // percentage
  /\bMath\.round\s*\(/,      // rounded for display
  /width\s*:/i,              // a bar
  /\/\s*(?:b?\.)?total\b/,   // share of the budget
  /\btotal\s*\)/,            // divided against the total in a helper call
];
// Says the number means work arrived.
const DELIVERY_WORDS = /\b(deliver|delivered|delivery|completion|complete[ds]?|progress|fulfil|fulfill)\w*/i;

/** Blank out comments and docstrings, keeping every newline so line numbers
 *  still point at the source.
 *
 *  Done by stripping rather than by a per-line startsWith test, which was the
 *  first attempt and reported a Python docstring that states this very rule as
 *  a violation of it. Prose about `spent` is not a figure derived from it. */
function stripProse(text, ext) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  if (ext === ".py") {
    return text
      .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, blank)
      .replace(/#[^\n]*/g, blank);
  }
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + blank(m.slice(p1.length)));
}

function isComment(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("#");
}

const offenders = [];
let scannedFiles = 0;
let scannedLines = 0;

for (const dir of SCAN_DIRS) {
  for (const file of walk(path.join(ROOT, dir), [])) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (!text.includes("spent")) continue;
    scannedFiles++;
    const lines = stripProse(text, path.extname(file)).split("\n");
    for (let i = 0; i < lines.length; i++) {
      scannedLines++;
      const line = lines[i];
      if (!/\bspent\b/.test(line)) continue;
      const derives = DERIVES.some((re) => re.test(line));
      const claims = DELIVERY_WORDS.test(line);
      if (derives || claims) {
        offenders.push({
          file: path.relative(ROOT, file),
          line: i + 1,
          text: line.trim().slice(0, 120),
          why: derives && claims ? "derives a figure and names delivery" : derives ? "derives a figure" : "names delivery",
        });
      }
    }
  }
}

check(
  "no delivery-shaped figure is derived from spent outside budgetDelivery.js",
  offenders.length === 0 ? `clean across ${scannedFiles} files` : `${offenders.length} line(s)`,
  offenders.length === 0,
  offenders.length === 0 ? "" : "see the list below",
);

// The scan is only worth anything if it is actually looking at the code, so
// prove it can see the file it is guarding.
check(
  "the scan reaches the budget surfaces",
  `${scannedFiles} files mention spent`,
  scannedFiles >= 5,
  "a scan that matched nothing would pass for the wrong reason",
);

// And prove the pattern fires, so a future edit to the regexes cannot quietly
// turn the scan into a no-op.
{
  const canary = "const pct = Number((spent * 100n) / total);";
  const fires = !isComment(canary) && /\bspent\b/.test(canary) && DERIVES.some((re) => re.test(canary));
  check("the scan pattern still catches the original bug", String(fires), fires === true,
    "this is the line BudgetSpendView.jsx used to contain");
}

// ── report ──────────────────────────────────────────────────────────────────

const w = Math.max(...rows.map((r) => r.name.length));
console.log("");
for (const r of rows) {
  const mark = r.pass === false ? "FAIL" : "ok  ";
  console.log(`${mark}  ${r.name.padEnd(w)}  ${r.outcome}${r.note ? `   (${r.note})` : ""}`);
}

if (offenders.length) {
  console.log("\nLines deriving a delivery-shaped figure from `spent`:");
  for (const o of offenders) {
    console.log(`  ${o.file}:${o.line}  [${o.why}]\n    ${o.text}`);
  }
  console.log(
    "\nIf one of these is legitimately about money movement, route it through\n"
    + "frontend/src/budgetDelivery.js. If it is about delivery, count Drawn events.",
  );
}

console.log(`\n${rows.length - failures}/${rows.length} passed, ${scannedLines} lines scanned`);
// Printed on a pass as well as a failure. The scan's limit is the thing most
// likely to be forgotten by someone reading a green run, so it is not left
// only in the header of a file they did not open.
console.log(
  "The scan is single-line and only reads lines containing `spent`. A derivation\n"
  + "split across two lines (alias on one, derive on the next) is NOT caught. A pass\n"
  + "means no direct single-line derivation, not that the rule holds everywhere.\n",
);
process.exit(failures);
