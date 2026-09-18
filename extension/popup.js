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
    return `<h2>${esc(w.title)}</h2>
      <p class="body">${esc(w.body)}</p>
      <p class="note">No rate is shown rather than a rate you cannot rely on.</p>`;
  }
  const f = h.freshness || {};
  const p = h.post_only || {};
  const band = BANDS[p.band] || { label: esc(p.band || ""), colour: T.mint, body: "" };
  return `
    <div class="rate-row">
      <div class="rate" style="color:${band.colour}">${fmtPct(p.rejection_rate)}</div>
      <div class="band" style="border-color:${band.colour};color:${band.colour}">${band.label}</div>
    </div>
    <p class="body">${band.body}</p>
    ${factsHtml(f, p)}
    <p class="note">${fmtInt(p.alo_rejected)} of ${fmtInt(p.alo_total)} post-only orders were
    refused before resting.</p>`;
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

  const head = agents.length === 0
    ? `<h2>Hired on chain, no registered agent</h2>
       <p class="body">${esc(a.note || "")}</p>`
    : `<h2>${agents.length === 1 ? "One registered agent"
         : `${agents.length} registered agents`}</h2>`;
  return `${head}${rows}${more}${jobs}`;
}

async function show(address, source) {
  ctx.textContent = source;
  out.innerHTML = `<p class="muted">Reading measurements for ${esc(address.slice(0, 10))}…</p>`;
  try {
    const data = await fetchSubject(address);
    const agent = data.agent || {};
    const hl = data.hyperliquid || {};
    const known = (data.subjects || []).length > 0;

    // Both halves, always, each with its reason. An address that is neither an
    // agent owner nor a tracked maker gets two reasons rather than an empty
    // panel: "nothing found" and "we do not measure this" are different
    // statements and the reader is entitled to know which one this is.
    out.innerHTML = `
      <section class="half">
        <div class="half-label">As an agent</div>
        ${agentHtml(agent)}
      </section>
      <section class="half">
        <div class="half-label">On Hyperliquid</div>
        ${hyperliquidHtml(hl)}
      </section>
      ${known ? "" : `<p class="note">Nothing is stored for this address under
        either subject. That is what was checked, not a verdict on the
        address.</p>`}`;
    statusEl.textContent = "Backend answered. Measurements are live.";
    statusEl.className = "ok";
  } catch (e) {
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
    show(subject.address, "From the tab you are on");
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
      <p class="body">This is a page Tnega reads. If a panel is not there, nothing is stored
      for what the page is about, or the local list has not finished downloading yet. You
      can still look up any address below.</p>`;
  } else {
    ctx.textContent = "Not on a page Tnega reads";
    out.innerHTML = `<h2>Look up any address</h2>
      <p class="body">Paste an address below and this returns whatever is known about it:
      the agents it holds and whether they answer, the Hyperliquid rejection rate, or the
      reason there is nothing to show. Panels appear on Hyperliquid address pages, on the
      block explorers this project covers, and on 8004scan.</p>`;
  }
  statusEl.textContent = "Backend not checked yet. Look up an address to test it.";
})();
