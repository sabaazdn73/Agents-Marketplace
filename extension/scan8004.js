// scan8004.js
//
// The entry point on 8004scan.io, for both its agent pages and its owner
// pages.
//
// WHY A MISS IS DRAWN HERE AND SWALLOWED ON AN EXPLORER
// Every page under /agents/ is an ERC-8004 agent by construction. So "this is
// not something we cover" is not a plausible reading of silence: a reader who
// knows what this extension is for would read a blank agent page as the
// extension being broken. The miss is therefore drawn, and it says which miss
// it is and when the list it was checked against was built, because the usual
// cause is an agent registered since the last build rather than an agent we
// decided not to read.
//
// Nothing is sent to produce that panel. The list on this machine already
// answered, so the negative costs no request, which is the same privacy
// property the explorers get from the same list.
//
// WHY THE PANEL FLOATS
// This page is a Next.js application that renders after the script runs. There
// is no <main>, no stable element id, and every class name is a CSS module
// hash of the form geistsans_5160a27-module__yx-k9a__variable, which changes
// on their next deploy. There is nothing here to anchor to. A fixed card
// asserts nothing about their layout and cannot be broken by it.
//
// It is appended to documentElement rather than into the page tree, because an
// ancestor carrying transform, filter, perspective or will-change converts
// position:fixed into position:absolute against that ancestor, which would
// drop the panel somewhere arbitrary.
//
// WHAT THIS FILE READS FROM THE PAGE
// Nothing. Both identifiers are in the URL: /agents/<chain>/<number> and
// /users/<0x address>.
//
// THEIR 200 MEANS NOTHING, WHICH IS WHY WE NEVER ASK THEM
// /agents/notachain/353706, /agents/bsc/notanumber and /agents/bsc/999999999
// all return HTTP 200 with an "Agent Not Found" body. The extension never
// consults their response; it reads the URL and asks our own store.

let scanCurrent = null;
let scanInflight = null;

async function scanSync() {
  const subject = subjectFromUrl(location.href);
  const id = subject ? subject.key : null;

  if (id === scanCurrent) return;
  scanCurrent = id;

  const existing = document.getElementById(TNEGA_AGENT_PANEL_ID);
  if (existing) existing.remove();
  if (!subject) return;

  const membership = await askMembership([subject.key, ...(subject.altKeys || [])]);

/** Place on 8004scan: in the flow if the page offers an anchor, floating if not.
 *
 *  It was unconditionally floating, and that was right when this file was
 *  written: the page had no <main>, no <h1>, and nothing but CSS module hashes
 *  to aim at. The site has both now, so the panel can sit under the agent's own
 *  title the way it does on the Etherscan family, instead of covering the
 *  right-hand column for the whole visit.
 *
 *  Floating is kept as the fallback rather than deleted. This is a client-side
 *  app: on a cold route change the heading may not exist yet, and a panel that
 *  floats is better than no panel. It also means the next redesign of that site
 *  degrades to the old behaviour instead of to nothing.
 */
function placeScanPanel(el) {
  if (placeAgentPanel(el, "inflow", false)) return;
  placeAgentPanel(el, "floating");
}


  const el = document.createElement("section");
  el.id = TNEGA_AGENT_PANEL_ID;
  el.className = "tnega-panel";

  // The list has not arrived yet. On this site that is worth saying, because a
  // blank page here reads as a fault. It is a different sentence from "not in
  // our snapshot" and must not be collapsed into it.
  if (!membership.ok) {
    el.innerHTML = agentPanelHtml(
      "error",
      membership.reason === "no_filter"
        ? "The list this checks against has not finished downloading yet. "
          + "Reload in a moment."
        : "The extension's background worker did not answer.",
      subject, null);
    placeScanPanel(el);
    return;
  }

  const coverage = `List built ${fmtDate(membership.built_at)}.`;
  const hit = Object.values(membership.hits || {}).some(Boolean);

  if (!hit) {
    el.innerHTML = agentPanelHtml(
      "absent",
      subject.kind === "agent" ? "not_in_snapshot" : "not_covered",
      subject, coverage);
    placeScanPanel(el);
    return;
  }

  el.innerHTML = agentPanelHtml("loading", null, subject, coverage);
  placeScanPanel(el);

  const identifier = subject.kind === "agent" ? subject.key : subject.address;
  const attempt = {};
  scanInflight = attempt;
  try {
    const data = await fetchSubject(identifier);
    if (scanInflight !== attempt) return;
    el.innerHTML = agentPanelHtml("ready", data, subject, coverage);
    wireCollapse(el);
    await applyCollapsedState(el);
  } catch (e) {
    if (scanInflight !== attempt) return;
    el.innerHTML = agentPanelHtml("error", String(e.message || e), subject, coverage);
    wireCollapse(el);
    await applyCollapsedState(el);
  }
}

scanSync();
// Client-side routing fires no load event, so the URL is polled. An interval
// rather than a MutationObserver for the same reason as the Hyperliquid panel:
// this app re-renders constantly and an observer would run thousands of times
// a minute to answer a question that is one string comparison.
setInterval(scanSync, 700);
