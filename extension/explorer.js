// explorer.js
//
// The entry point on the six Etherscan-family explorers.
//
// SILENCE IS THE RIGHT OUTPUT HERE, AND IT IS A DECISION
// Almost every address page on a block explorer is about an address this
// project has never measured. The local list says so without asking us, and
// when it says so nothing is drawn. A card announcing what we do not know
// about every address would be noise, and it would also be the extension
// talking about pages it has no business having an opinion on.
//
// That is a departure from the rule the rest of this product holds, which is
// that an absence gets a reason rather than a blank. The rule still holds
// wherever the subject is covered: an address in the list that has no figure
// gets the reason, not a zero. What is different here is the prior question,
// whether this page is about our subject at all, and "no" is a complete answer
// to it.
//
// On 8004scan the same miss is drawn rather than swallowed, because there
// every page is an agent by construction and silence would read as a failure.
// See scan8004.js.
//
// WHAT THIS FILE READS FROM THE PAGE
// Nothing. The address is in the URL and the insertion point is an element id.
// There is no querySelectorAll over text anywhere in this path, which is what
// lets the store listing and the privacy policy say that page text is read on
// one site only.

let explorerCurrent = null;
let explorerInflight = null;

async function explorerSync() {
  const subject = subjectFromUrl(location.href);
  const id = subject ? subject.key : null;

  if (id === explorerCurrent) return;
  explorerCurrent = id;

  const existing = document.getElementById(TNEGA_AGENT_PANEL_ID);
  if (existing) existing.remove();
  if (!subject) return;

  const membership = await askMembership([subject.key, ...(subject.altKeys || [])]);

  // The list has not arrived, or the worker did not answer. Draw nothing. The
  // alternative is to ask the server anyway, which is exactly the behaviour
  // the list exists to prevent, and a fallback that quietly inverts a privacy
  // property is worse than a panel that is briefly absent.
  if (!membership.ok) return;

  const hit = Object.values(membership.hits || {}).some(Boolean);
  if (!hit) return;

  const el = document.createElement("section");
  el.id = TNEGA_AGENT_PANEL_ID;
  el.className = "tnega-panel";
  const coverage = `List built ${fmtDate(membership.built_at)}.`;
  el.innerHTML = agentPanelHtml("loading", null, subject, coverage);

  // The fallback is withheld for the whole wait, not offered on the first
  // attempt. A fallback that always succeeds ends the retry loop immediately
  // and becomes the usual outcome rather than the last resort, which is how
  // the panel came to sit above Blockscout's own header.
  const mode = subject.place || "explorer";
  if (!placeAgentPanel(el, mode, false)) {
    const started = Date.now();
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        const waitedLongEnough = Date.now() - started > 8000;
        if (placeAgentPanel(el, mode, waitedLongEnough) || waitedLongEnough) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
    if (!el.isConnected) return;
  }

  const attempt = {};
  explorerInflight = attempt;
  try {
    const data = await fetchSubject(subject.address);
    if (explorerInflight !== attempt) return;
    el.innerHTML = agentPanelHtml("ready", data, subject, coverage);
  } catch (e) {
    if (explorerInflight !== attempt) return;
    el.innerHTML = agentPanelHtml("error", String(e.message || e), subject, coverage);
  }
}

explorerSync();
// These are server-rendered pages, so a navigation is a real load. The
// interval is kept anyway because their tab controls change the URL without
// one, and it costs one string comparison.
setInterval(explorerSync, 700);
