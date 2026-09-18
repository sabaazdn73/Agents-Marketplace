// popup.js
//
// The popup is not a second copy of the panel. It exists for the two things a
// content script cannot do.
//
// It answers "is this working", which is otherwise indistinguishable from "this
// address has nothing to show". The footer states whether the backend answered,
// so a silent failure has somewhere to become visible.
//
// And it looks up an address you are not currently on, which is the case the
// content script by definition cannot cover.
//
// It reads the current tab's URL through activeTab, which Chrome grants only
// because you clicked the icon, rather than through the "tabs" permission,
// which would grant it for every tab all the time.
//
// ANY ADDRESS, AND BOTH READINGS
// It used to take a Hyperliquid address and return a rejection rate, which
// meant the one surface a person reaches for when they are NOT on a covered
// page could answer only one of the two questions this project can answer.
// It now takes any address and returns whatever is known: the agent reading,
// the Hyperliquid reading, or both, each with its own reason when there is
// nothing behind it.
//
// FROM THE SAME HANDLER, NOT A PARALLEL PATH
// /api/extension/subject is what the panels call, and it returns both halves.
// The Hyperliquid half inside it is service.address_detail, which is the same
// function /api/hyperliquid/address serves to the Hyperliquid panel. So there
// is one place that decides whether a figure is worth showing and one set of
// words for why it is not, and this file renders what it is sent.
//
// It does NOT consult the membership filter. The filter exists so that pages
// you merely visit are not reported to us; typing an address into this box is
// asking us about it, which is not the same act, and putting the filter in the
// way would mean the popup could not answer for an address registered since
// the last list was built.
//
// Bots are not here, for the reason they are not in the panels: the whole bot
// dataset is two addresses in a React component with no collector behind it,
// so there is nothing to serve.

const out = document.getElementById("out");
const ctx = document.getElementById("context");
const statusEl = document.getElementById("status");
const tabsEl = document.getElementById("tabs");

// The two subjects, as tabs. One open at a time.
//
// WHY TABS AND NOT TWO STACKED SECTIONS
// Both halves are always answered, because "we checked and found nothing" and
// "we do not measure this" are different statements and a reader is entitled to
// both. Drawn one under the other that is a popup you scroll, and the half you
// came for is as likely to be the one below the fold. So both are computed and
// one is shown.
//
// The tab you are NOT on still carries a one-line state under its label, so
// choosing between them does not require opening both. That line is the whole
// reason this is not just a pair of buttons.
// Each tab is written for its own subject.
//
// THE TWO ARE NOT THE SAME KIND OF THING AND MUST NOT SOUND ALIKE
// One is a trader's orders on a venue: the reader is watching a market maker
// and the question is whether its quotes reach the book. The other is an agent
// somebody is deciding whether to pay: the reader is a buyer and the question
// is whether it answers and who has actually paid it before. They share an
// address and nothing else.
//
// An earlier version gave both the same standfirst, the same closing note and
// the same sentence about "either subject". Rendering both tabs and diffing the
// text found nine lines identical across them, which is nine lines written for
// neither. The `lead` and `close` below are what each tab says in its own
// vocabulary; the shared chrome above and below them is chrome, not copy.
const TABS = {
  hl: {
    label: "Tnega for Hyperliquid",
    lead: "Post-only orders, and whether the book took them.",
    close: "A refused post-only order never rests, so it adds no liquidity and "
      + "leaves no trace in fills or volume. That is the gap this fills.",
    // When there is nothing: say what the collector is, in venue terms.
    emptyClose: "The collector polls a set of addresses chosen by recent "
      + "trading activity. Being outside that set is a fact about what has been "
      + "measured, not about how the address trades.",
  },
  agent: {
    label: "Tnega for On-chain Agents",
    lead: "Whether it answers, and who has actually paid it.",
    close: "Registering an agent is a transaction. It costs a few cents and "
      + "proves nothing about whether the agent answers, delivers, or has ever "
      + "been paid by anyone other than its own owner.",
    emptyClose: "This looks for registered agent identities and for the "
      + "on-chain jobs that paid them. An address with neither may still be a "
      + "wallet that does other things entirely.",
  },
};
let currentTab = "hl";
let lastAnswer = null;

/** One line saying what is behind a tab, for the tab itself. */
function tabNote(half, kind) {
  if (!half) return "nothing yet";
  if (half.withheld_reason) {
    const w = (kind === "hl" ? WITHHELD[half.withheld_reason] : null)
      || AGENT_WITHHELD[half.withheld_reason];
    return w ? w.title.toLowerCase() : "no reading";
  }
  if (kind === "hl") {
    const p = half.post_only || {};
    return `${fmtPct(p.rejection_rate)} refused`;
  }
  const n = half.agent_count || 0;
  if (n === 0) return "hired, no identity";
  return n === 1 ? "1 registered agent" : `${n} registered agents`;
}

function selectTab(name) {
  currentTab = name;
  for (const key of Object.keys(TABS)) {
    const btn = document.getElementById(`tab-${key}`);
    if (btn) btn.setAttribute("aria-selected", String(key === name));
  }
  if (lastAnswer) drawTab();
}

tabsEl.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-tab]");
  if (btn) selectTab(btn.dataset.tab);
});
// Left and right arrows move between tabs, which is what a tablist is expected
// to do and costs four lines.
tabsEl.addEventListener("keydown", (ev) => {
  if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
  const keys = Object.keys(TABS);
  const next = keys[(keys.indexOf(currentTab) + (ev.key === "ArrowRight" ? 1 : -1)
    + keys.length) % keys.length];
  selectTab(next);
  document.getElementById(`tab-${next}`).focus();
});

function factsHtml(f, p) {
  return `<div class="facts">
    <div><span>Polls stored</span><b>${fmtInt(f.polls)}</b></div>
    <div><span>Newest order seen</span><b>${fmtAge(f.newest_record_age_seconds)}</b></div>
    <div><span>Post-only seen</span><b>${fmtInt(p.alo_total)}</b></div>
  </div>`;
}

/** The Hyperliquid half. Identical in content to the panel on their site,
 *  because it is rendered from the same reply that panel renders. */
function hyperliquidHtml(h) {
  if (!h || h.withheld_reason) {
    const reason = (h && h.withheld_reason) || "not_tracked";
    // The venue's own vocabulary first, then the agent vocabulary, which is
    // where no_address_on_page and store_unavailable live. Neither table is
    // allowed to invent a reason: both are transcriptions of what the server
    // decided.
    const w = WITHHELD[reason] || AGENT_WITHHELD[reason] || {
      title: "No rate available",
      body: "No rate is being shown, and this surface has no wording for the " +
        "reason given.",
    };
    const hold = holdingsLines(h && h.holdings);
    const holdHtml = hold.length
      ? `<div class="prov"><div class="prov-title">What this account holds</div>
           ${hold.map((l) => `<p class="prov-line">${esc(l)}</p>`).join("")}
           <p class="note">${esc((h.holdings && h.holdings.note) || "")}</p></div>`
      : "";
    const acctW = accountBlock(h && h.account);
    return `<h2>${esc(w.title)}</h2>
      <p class="body">${esc(w.body)}</p>
      ${acctW ? `<div class="acct acct-${esc(acctW.kind)}"><b>${esc(acctW.title)}</b>
        <p class="note">${esc(acctW.body)}</p></div>` : ""}
      <p class="note">No rate is shown rather than a rate you cannot rely on.</p>
      ${holdHtml}`;
    // "No rate you cannot rely on" is the venue's own discipline and stays on
    // the venue's renderer. The agent half has no rate and never says this.
  }
  const acct = accountBlock(h.account);
  const acctHtml = acct
    ? `<div class="acct acct-${esc(acct.kind)}">
         <b>${esc(acct.title)}</b>
         <p class="note">${esc(acct.body)}</p>
       </div>`
    : "";
  const f = h.freshness || {};
  const p = h.post_only || {};
  const band = BANDS[p.band] || { label: esc(p.band || ""), colour: T.mint, body: "" };
  return `
    ${acctHtml}
    <div class="rate-row">
      <div class="rate" style="color:${band.colour}">${fmtPct(p.rejection_rate)}</div>
      <div class="band" style="border-color:${band.colour};color:${band.colour}">${band.label}</div>
    </div>
    <p class="body">${band.body}</p>
    ${factsHtml(f, p)}
    <p class="note">${fmtInt(p.alo_rejected)} of ${fmtInt(p.alo_total)} post-only orders were
    refused before resting.</p>`;
  // The sentence about what a refused order costs lives on the tab, not here,
  // so it is stated once per subject rather than once per render path.
}

/** The agent half, in the popup's narrower shape. */
function agentHtml(a) {
  if (!a || a.withheld_reason) {
    const reason = (a && a.withheld_reason) || "not_covered";
    const w = AGENT_WITHHELD[reason] || AGENT_WITHHELD.not_covered;
    return `<h2>${esc(w.title)}</h2><p class="body">${esc(w.body)}</p>`;
  }
  const agents = a.agents || [];
  const rows = agents.slice(0, 4).map((g) => {
    const s = g.service || {};
    let line;
    if (s.withheld_reason) {
      const w = AGENT_WITHHELD[s.withheld_reason] || { title: "Not established" };
      line = esc(w.title);
    } else {
      const when = s.checked_age_seconds === null || s.checked_age_seconds === undefined
        ? "at an unrecorded time" : `checked ${fmtAge(s.checked_age_seconds)}`;
      line = `${esc(s.label || "")} &middot; ${esc(when)}`;
    }
    return `<div class="agent-row">
      <b>${esc(g.name || "Unnamed agent")}</b>
      <div class="muted">${esc(g.chain_name || "")} &middot; #${esc(g.token_id || "")}</div>
      <div class="muted">${line}</div>
    </div>`;
  }).join("");

  const more = agents.length > 4
    ? `<p class="note">and ${fmtInt(agents.length - 4)} more on Tnega</p>` : "";
  const j = a.jobs || {};
  let jobs;
  if (j.withheld_reason) {
    const w = AGENT_WITHHELD[j.withheld_reason] || { title: "No job history", body: "" };
    jobs = `<p class="note"><b>${esc(w.title)}.</b> ${esc(w.body)}</p>`;
  } else {
    const by = j.by_status || {};
    const parts = Object.keys(by).sort()
      .map((k) => `${esc(k.toLowerCase())} ${fmtInt(by[k])}`).join(" &middot; ");
    jobs = `<p class="note"><b>On-chain jobs: ${fmtInt(j.total)}.</b> ${parts}</p>`;
  }

  // Who paid for the deliveries. The same sentences the panel renders, from
  // the same function, because this is the block a person reads before funding
  // and two versions of it is how one agent ends up described two ways.
  const pv = a.provenance || {};
  let prov;
  if (pv.withheld_reason) {
    const w = AGENT_WITHHELD[pv.withheld_reason] || { title: "No delivery history", body: "" };
    prov = `<p class="note"><b>${esc(w.title)}.</b> ${esc(w.body)}</p>`;
  } else {
    const lines = provenanceLines(pv);
    prov = lines.length
      ? `<div class="prov">
           <div class="prov-title">Who paid for the delivery</div>
           <p class="note">${esc(pv.note || "")}</p>
           ${lines.map((l) => `<p class="prov-line">${esc(l)}</p>`).join("")}
         </div>`
      : "";
  }

  const bg = a.budgets || {};
  let budgets;
  if (bg.withheld_reason) {
    const w = AGENT_WITHHELD[bg.withheld_reason] || { title: "No budgets", body: "" };
    budgets = `<p class="note"><b>${esc(w.title)}.</b> ${esc(w.body)}</p>`;
  } else {
    const lines = budgetLines(bg);
    budgets = lines.length
      ? `<div class="prov">
           <div class="prov-title">Budgets funded to it</div>
           ${lines.map((l) => `<p class="prov-line">${esc(l)}</p>`).join("")}
           <p class="note">${esc(bg.note || "")}</p>
         </div>`
      : "";
  }

  const head = agents.length === 0
    ? `<h2>${esc(noIdentityTitle(a))}</h2>
       <p class="body">${esc(a.note || "")}</p>`
    : `<h2>${agents.length === 1 ? "One registered agent"
         : `${agents.length} registered agents`}</h2>`;
  return `${head}${rows}${more}${jobs}${prov}${budgets}`;
}

/** What answered, named rather than called "the backend".
 *
 *  This footer exists so that a connection failure is distinguishable from an
 *  address with nothing to report. Saying "measurements are live" for a reply
 *  in which both halves were withheld undercuts that: it reads as though
 *  something was measured. */
function statusLine(d) {
  const subjects = d.subjects || [];
  if (subjects.length === 2) return "Answered: registry and venue store.";
  if (subjects.includes("agent")) return "Answered: the agent registry.";
  if (subjects.includes("hyperliquid")) return "Answered: the Hyperliquid store.";
  return "Answered. Neither store holds anything for this address.";
}

/** Draw whichever tab is selected, from the answer already in hand.
 *
 *  Both halves were fetched in one request, so switching tabs is free and
 *  sends nothing. */
function drawTab() {
  const d = lastAnswer;
  const agent = d.agent || {};
  const hl = d.hyperliquid || {};

  document.getElementById("tab-hl-note").textContent = tabNote(hl, "hl");
  document.getElementById("tab-agent-note").textContent = tabNote(agent, "agent");
  tabsEl.hidden = false;

  const t = TABS[currentTab];
  const body = currentTab === "hl" ? hyperliquidHtml(hl) : agentHtml(agent);
  // A tab that has a reading closes with what the reading means. A tab that has
  // none closes with what was looked for. The old generic line said neither and
  // appeared under both.
  const empty = currentTab === "hl"
    ? Boolean(hl.withheld_reason)
    : Boolean(agent.withheld_reason);

  out.innerHTML = `
    <section class="half" role="tabpanel" id="panel-${currentTab}"
             aria-labelledby="tab-${currentTab}">
      <div class="half-label">${esc(t.label)}</div>
      <p class="lead">${esc(t.lead)}</p>
      ${body}
      <p class="note close">${esc(empty ? t.emptyClose : t.close)}</p>
    </section>`;
}

async function show(address, source) {
  ctx.textContent = source;
  tabsEl.hidden = true;
  out.innerHTML = `<p class="muted">Reading measurements for ${esc(address.slice(0, 10))}…</p>`;
  try {
    const data = await fetchSubject(address);
    lastAnswer = data;

    // Open the tab that has something in it. Both halves are always answered,
    // so a fixed default would land a reader on "not tracked" while the answer
    // they came for sat behind the other tab. Hyperliquid wins a tie because
    // it is the reading with a figure in it.
    const subjects = data.subjects || [];
    if (subjects.includes("hyperliquid")) currentTab = "hl";
    else if (subjects.includes("agent")) currentTab = "agent";
    for (const key of Object.keys(TABS)) {
      const btn = document.getElementById(`tab-${key}`);
      if (btn) btn.setAttribute("aria-selected", String(key === currentTab));
    }

    drawTab();
    statusEl.textContent = statusLine(data);
    statusEl.className = "ok";
  } catch (e) {
    tabsEl.hidden = true;
    out.innerHTML = `<h2>Cannot reach the measurements</h2>
      <p class="body">${esc(e.message || e)}</p>
      <p class="note">This is a connection problem, not a statement about the address.</p>`;
    statusEl.textContent = "Backend did not answer.";
    statusEl.className = "bad";
  }
}

document.getElementById("lookup").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const v = document.getElementById("addr").value.trim().toLowerCase();
  if (/^0x[a-f0-9]{40}$/.test(v)) {
    show(v, "Looked up by hand");
  } else {
    out.innerHTML = `<h2>That is not an address</h2>
      <p class="body">Expected 0x followed by 40 hexadecimal characters.</p>`;
  }
});

/** Why there is no panel on the page you are looking at.
 *
 *  WHY THIS EXISTS
 *  Silence on a miss is the design: almost every address page on an explorer
 *  is about an address nobody has measured, and a card announcing that on each
 *  one would be noise. The cost is that a correct silence and a broken
 *  extension look exactly alike, and the only person who could tell them apart
 *  was whoever could read the source.
 *
 *  So the popup walks the same four steps the content script walks and reports
 *  where it stopped. In order, because each depends on the one before:
 *
 *    1 host      is this a page the extension is loaded on at all
 *    2 filter    has the local list downloaded yet
 *    3 lookup    is this page's identifier in that list
 *    4 backend   did the server answer for it
 *
 *  A miss at step 3 is the expected outcome and says so. Anything else is a
 *  fault and says which.
 */
async function diagnose(url) {
  const subject = subjectFromUrl(url);
  const steps = [];

  if (!subject) {
    steps.push(["host", false,
      "Not a page this extension reads. It is loaded on Hyperliquid address "
      + "pages, on the explorers listed in the privacy policy, and on 8004scan."]);
    return { steps, verdict: "not-covered-page" };
  }
  steps.push(["host", true, `Loaded here, and the page names ${
    subject.kind === "agent" ? "an agent" : "an address"}.`]);

  const membership = await askMembership([subject.key, ...(subject.altKeys || [])]);
  if (!membership.ok) {
    steps.push(["filter", false, membership.reason === "no_filter"
      ? "The local list has not finished downloading. Give it a moment and "
        + "reopen this. Until it arrives no panel is drawn anywhere, by design."
      : "The extension's background worker did not answer."]);
    return { steps, verdict: "filter-missing" };
  }
  steps.push(["filter", true,
    `Local list loaded, built ${fmtDate(membership.built_at)}.`]);

  const hit = Object.values(membership.hits || {}).some(Boolean);
  if (!hit) {
    steps.push(["lookup", false,
      "This address is not in the list, so nothing was sent and no panel was "
      + "drawn. That is the expected result for almost every address: the list "
      + "holds only what this project has measured."]);
    return { steps, verdict: "expected-miss" };
  }
  steps.push(["lookup", true, "This address is in the list."]);

  try {
    const id = subject.kind === "agent" ? subject.key : subject.address;
    const d = await fetchSubject(id);
    steps.push(["backend", true,
      (d.subjects || []).length
        ? "The server answered with a reading. A panel should be on the page."
        : "The server answered and holds nothing under either subject."]);
    return { steps, verdict: "answered" };
  } catch (e) {
    steps.push(["backend", false, `The server did not answer: ${e.message || e}.`]);
    return { steps, verdict: "backend-down" };
  }
}

function renderDiagnosis(d) {
  const rows = d.steps.map(([name, ok, text]) =>
    `<li class="diag-step ${ok ? "ok" : "no"}">
       <b>${esc(name)}</b> <span>${esc(text)}</span>
     </li>`).join("");
  return `<details class="diag">
    <summary>No panel on this page? Why</summary>
    <ol class="diag-list">${rows}</ol>
  </details>`;
}

(async function init() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
    tabs = [];
  }
  const url = (tabs[0] && tabs[0].url) || "";
  // Any address the current page carries, on any site the extension runs on,
  // not only a Hyperliquid one.
  const subject = subjectFromUrl(url);
  if (subject && subject.address) {
    await show(subject.address, "From the tab you are on");
    // Appended after the reading, because on a covered page the reading is the
    // answer and this is the footnote. On an uncovered one it is the whole
    // answer, which is the case below.
    out.insertAdjacentHTML("beforeend", renderDiagnosis(await diagnose(url)));
    return;
  }

  // No address on this page. Say where you are, because "no panel" and "not a
  // page with an address on it" are different situations.
  if (url.startsWith("https://app.hyperliquid.xyz/")) {
    ctx.textContent = "On Hyperliquid, but not an address page";
    out.innerHTML = `<h2>No address on this page</h2>
      <p class="body">Open an address under Explorer, or paste one below. The panel appears
      on pages whose address is in the URL, like
      <code>/explorer/address/0x…</code>.</p>`;
  } else if (subjectFromUrl(url)) {
    ctx.textContent = "This page has its own panel";
    out.innerHTML = `<h2>The panel is on the page</h2>
      <p class="body">This is a page Tnega reads. If no panel is there, the steps below say
      which of the four things stopped it, and the usual answer is that the address is not
      one this project has measured.</p>`;
    out.insertAdjacentHTML("beforeend", renderDiagnosis(await diagnose(url)));
  } else {
    ctx.textContent = "Not on a page Tnega reads";
    out.innerHTML = `<h2>Look up any address</h2>
      <p class="body"><b>On Hyperliquid</b>, what share of its post-only orders the
      matching engine refused before they rested on the book.</p>
      <p class="body"><b>As an on-chain agent</b>, whether the service it published
      answers, and who has actually paid for what it delivered.</p>
      <p class="note">Either can come back with a reason instead of a figure, and the
      reason is the answer in that case. Panels appear on Hyperliquid address pages, on
      the block explorers this project covers, and on 8004scan.</p>`;
  }
  statusEl.textContent = "Backend not checked yet. Look up an address to test it.";
})();
