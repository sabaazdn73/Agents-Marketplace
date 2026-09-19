// agentPanel.js
//
// The panel for the agent subject, and the placement rules for the two kinds
// of site it appears on.
//
// WHY THIS IS NOT THE HYPERLIQUID PANEL WITH DIFFERENT NUMBERS
// An agent and a Hyperliquid maker are different subjects and the panels say
// different things. A maker has a rate: one figure, a band, and the count
// behind it. An agent has no rate at all. It has an identity someone minted, a
// service endpoint that either answers or does not, and a job history that for
// almost every agent is empty. Forcing both into one layout would mean either
// inventing a headline figure for agents, which would be a fabrication, or
// demoting the maker's rate to a row, which would bury the one number that
// page exists for.
//
// WHAT THE HEADLINE IS INSTEAD
// Whether the service answers, because that is the only measurement with wide
// coverage: 123,917 responding, 78,213 with no endpoint published, 5,856 not
// responding and 53,383 unchecked, of 262,859 agents. It is also the question
// the registry cannot answer by itself, which is the whole reason this project
// exists: registering is a transaction, and it proves nothing.
//
// WHAT IS NEVER DRAWN
// The registry's `is_verified`. It is false for every agent that carries it,
// because the upstream source never sets it. The server does not send it and
// this file could not draw it. The note in its place says so, rather than
// leaving a reader to wonder why a verification badge is missing.

const TNEGA_AGENT_PANEL_ID = "tnega-agent-panel";

const SERVICE_TONE = {
  responding: "ok",
  not_responding: "bad",
  no_endpoint: "quiet",
};

function agentFoot(coverage) {
  return `
    <div class="tnega-foot">
      ${coverage ? `<div class="tnega-coverage">${esc(coverage)}</div>` : ""}
      <a href="https://www.tnega.app/how-it-works" target="_blank" rel="noreferrer">
        What this project measures, and the coverage behind it
      </a>
    </div>`;
}

function agentHead(title, sub) {
  return `
    <div class="tnega-head">
      <div class="tnega-head-text">
        <div class="tnega-title">${esc(title)}</div>
        <div class="tnega-sub">${esc(sub)}</div>
      </div>
      <a class="tnega-link" href="https://www.tnega.app/market" target="_blank" rel="noreferrer">Tnega</a>
    </div>`;
}

/** One agent: identity, then whether its endpoint answers. */
/** Who produced what is in this panel, for the subtitle.
 *
 *  WHY THIS IS NOT "measured by Tnega", corrected 2026-09-19
 *  Every branch of the summary used to end "measured by Tnega", including the
 *  branch where nothing had been measured at all. Almost nothing in an agent
 *  row is ours: the name, the category, the chain, the token id and the owner
 *  all come from 8004scan's registry listing, ingested by
 *  full_registry_ingest. What this project produces is the service reading,
 *  which is whether the published endpoint answered when it was last called.
 *
 *  This is the same provenance error docs/hyperliquid-provenance.md was
 *  written to catch on the tab, on the surface people actually use: someone
 *  else's data presented under our name. The Hyperliquid panel's own
 *  "measured by Tnega" is left alone, because the post-only rejection rate on
 *  it really is counted from this project's polls.
 *
 *  Returns null when there is nothing to attribute, so the caller can leave
 *  the claim off entirely rather than make a weaker version of it.
 */
function provenanceSub(agents) {
  if (!agents || !agents.length) return null;
  const checked = agents.some((a) => a.service && !a.service.withheld_reason);
  return checked
    ? "listed by 8004scan, endpoint checked by Tnega"
    : "listed by 8004scan, endpoint not checked yet";
}

function agentRow(a) {
  const s = a.service || {};
  let service;
  if (s.withheld_reason) {
    const w = AGENT_WITHHELD[s.withheld_reason] || {
      title: "Not established", body: "",
    };
    service = `<div class="tnega-agent-service quiet">
      <b>${esc(w.title)}</b>
      <div class="tnega-muted">${esc(w.body)}</div>
    </div>`;
  } else {
    const tone = SERVICE_TONE[s.status] || "quiet";
    const when = s.checked_age_seconds === null || s.checked_age_seconds === undefined
      ? "at an unrecorded time"
      : `checked ${fmtAge(s.checked_age_seconds)}`;
    const code = s.http_status ? ` &middot; HTTP ${esc(String(s.http_status))}` : "";
    service = `<div class="tnega-agent-service ${tone}">
      <b>${esc(s.label || s.status || "")}</b>
      <div class="tnega-muted">${esc(when)}${code}</div>
    </div>`;
  }

  return `<div class="tnega-agent">
    <div class="tnega-agent-name">${esc(a.name || "Unnamed agent")}</div>
    <div class="tnega-agent-meta">${esc(a.chain_name || "")} &middot; #${esc(a.token_id || "")}${
      a.category ? ` &middot; ${esc(a.category)}` : ""}</div>
    ${service}
  </div>`;
}

/** Who paid for the deliveries.
 *
 *  WHY THIS IS ON THE PANEL AND NOT JUST ON THE SITE
 *  "Nine deliveries" and "nine deliveries, all to one client, and that client
 *  is the owner's own address" are the same count and a different fact. This
 *  is the block a person needs before funding, and the panel appears at
 *  exactly the moment they are looking at the address rather than at our site.
 *
 *  The sentences come from provenanceLines in shared.js, which the popup also
 *  renders, and they match frontend/src/DeliveryProvenance.jsx field for field,
 *  so moving between an explorer, the popup and the site cannot change what an
 *  agent means.
 */
function provenanceBlock(pv) {
  if (!pv) return "";
  if (pv.withheld_reason) {
    const w = AGENT_WITHHELD[pv.withheld_reason] || {
      title: "No delivery history", body: "",
    };
    return `<div class="tnega-agent-jobs">
      <div class="tnega-agent-jobs-title">${esc(w.title)}</div>
      <div class="tnega-muted">${esc(w.body)}</div>
    </div>`;
  }

  const lines = provenanceLines(pv);
  if (!lines.length) return "";

  return `<div class="tnega-agent-jobs">
    <div class="tnega-agent-jobs-title">Who paid for the delivery</div>
    <div class="tnega-note">${esc(pv.note || "")}</div>
    ${lines.map((l) => `<div class="tnega-prov-line">${esc(l)}</div>`).join("")}
  </div>`;
}

function budgetsBlock(b) {
  if (!b) return "";
  if (b.withheld_reason) {
    const w = AGENT_WITHHELD[b.withheld_reason] || {
      title: "No budgets", body: "",
    };
    return `<div class="tnega-agent-jobs">
      <div class="tnega-agent-jobs-title">${esc(w.title)}</div>
      <div class="tnega-muted">${esc(w.body)}</div>
    </div>`;
  }
  const lines = budgetLines(b);
  if (!lines.length) return "";
  return `<div class="tnega-agent-jobs">
    <div class="tnega-agent-jobs-title">Budgets funded to it</div>
    ${lines.map((l) => `<div class="tnega-prov-line">${esc(l)}</div>`).join("")}
    <div class="tnega-note">${esc(b.note || "")}</div>
  </div>`;
}

function jobsBlock(jobs) {
  if (!jobs) return "";
  if (jobs.withheld_reason) {
    const w = AGENT_WITHHELD[jobs.withheld_reason] || {
      title: "No job history", body: "",
    };
    return `<div class="tnega-agent-jobs">
      <div class="tnega-agent-jobs-title">${esc(w.title)}</div>
      <div class="tnega-muted">${esc(w.body)}</div>
    </div>`;
  }
  const by = jobs.by_status || {};
  const parts = Object.keys(by).sort().map(
    (k) => `<span>${esc(k.toLowerCase())} ${fmtInt(by[k])}</span>`).join("");
  return `<div class="tnega-agent-jobs">
    <div class="tnega-agent-jobs-title">On-chain jobs: ${fmtInt(jobs.total)}</div>
    <div class="tnega-agent-jobs-row">${parts}</div>
    <div class="tnega-note">${esc(jobs.note || "")}</div>
  </div>`;
}

/** The whole panel, for every state it can be in. */
function agentPanelHtml(state, data, subject, coverage) {
  if (state === "loading") {
    return `${agentHead("Checking", "Reading what was measured…")}
      <div class="tnega-body"><div class="tnega-muted">One moment.</div></div>
      ${agentFoot(coverage)}`;
  }

  if (state === "error") {
    return `${agentHead("No answer", "Could not reach the measurements")}
      <div class="tnega-body">
        <div class="tnega-withheld-title">Cannot reach the measurements</div>
        <div class="tnega-muted">${esc(data)}</div>
        <div class="tnega-note">This is a connection problem, not a statement
          about this agent.</div>
      </div>${agentFoot(coverage)}`;
  }

  // A local miss on 8004scan. No request was made: the list on this machine
  // already answered, so this draws without anything leaving the browser.
  if (state === "absent") {
    const w = AGENT_WITHHELD[data] || AGENT_WITHHELD.not_in_snapshot;
    return `${agentHead("Not measured", "Nothing stored for this one")}
      <div class="tnega-body">
        <div class="tnega-withheld-title">${esc(w.title)}</div>
        <div class="tnega-withheld-body">${esc(w.body)}</div>
        <div class="tnega-note">Nothing was sent to look this up. The list this
          was checked against is on your machine.</div>
      </div>${agentFoot(coverage)}`;
  }

  // The server answers with both halves, each carrying its own reason. This
  // panel draws the agent half; the Hyperliquid half is drawn by its own panel
  // on its own site and by the popup, which shows both.
  const half = (data && data.agent) || null;
  if (!half || half.withheld_reason) {
    const reason = (half && half.withheld_reason) || "not_covered";
    const w = AGENT_WITHHELD[reason] || AGENT_WITHHELD.not_covered;
    return `${agentHead("Not measured", "Nothing stored for this address")}
      <div class="tnega-body">
        <div class="tnega-withheld-title">${esc(w.title)}</div>
        <div class="tnega-withheld-body">${esc(w.body)}</div>
      </div>${agentFoot(coverage)}`;
  }

  const agents = half.agents || [];
  const shown = agents.slice(0, 4);
  const more = agents.length - shown.length;

  let title;
  let sub;
  // agentHead escapes both arguments, so these are built with plain text and a
  // literal separator. An earlier version used the &middot; entity here and
  // the panel printed the entity, because it was escaped on the way through.
  const SEP = " \u00b7 ";
  const prov = provenanceSub(agents);
  if (subject.kind === "agent") {
    title = "Registered agent";
    sub = [agents[0] ? agents[0].chain_name : "", prov].filter(Boolean).join(SEP);
  } else if (agents.length === 0) {
    title = noIdentityTitle(half);
    // No attribution here on purpose. This is the branch where nothing was
    // found, and "measured by Tnega" under a heading saying nothing was
    // measured claimed authorship of an absence.
    sub = shortAddr(subject.address);
  } else {
    title = agents.length === 1
      ? "This address holds a registered agent"
      : `This address holds ${agents.length} registered agents`;
    sub = [shortAddr(subject.address), prov].filter(Boolean).join(SEP);
  }

  // An owner can hold agents on several chains, and the panel is drawn on one
  // explorer. Saying so is the difference between a reading and a wrong
  // reading: without it a Base agent listed on a BscScan page reads as being
  // about the page you are on.
  let chainNote = "";
  if (half.multi_chain) {
    chainNote = `<div class="tnega-note">These are on more than one chain, and
      this page is about one of them. Each is labelled with its own.</div>`;
  } else if (subject.chainId && agents.length
             && agents[0].chain_id !== subject.chainId) {
    chainNote = `<div class="tnega-note">Registered on
      ${esc(agents[0].chain_name)}, not on the chain this page is about.</div>`;
  }

  return `${agentHead(title, sub)}
    <div class="tnega-body">
      ${half.note ? `<div class="tnega-muted">${esc(half.note)}</div>` : ""}
      ${shown.map(agentRow).join("")}
      ${more > 0 ? `<div class="tnega-muted">and ${fmtInt(more)} more on Tnega</div>` : ""}
      ${chainNote}
      ${jobsBlock(half.jobs)}
      ${provenanceBlock(half.provenance)}
      ${budgetsBlock(half.budgets)}
      <div class="tnega-note">${esc(
        (agents[0] && agents[0].verification_note) ||
        "Registering an agent is a transaction and proves nothing about whether it works.")}</div>
    </div>${agentFoot(coverage)}`;
}

function shortAddr(a) {
  const s = String(a || "");
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

/** Insert the panel, per site family.
 *
 *  ETHERSCAN FAMILY: an in-flow insert before the overview card.
 *  #ContentPlaceHolder1_divSummary is an ASP.NET WebForms control id, which is
 *  generated from the server-side control tree rather than from a build, so it
 *  is stable across their deploys in a way a hashed class name is not. Read
 *  directly from etherscan.io, basescan.org, hyperevmscan.io and
 *  monadscan.com; bscscan.com and arbiscan.io refuse automated fetches and
 *  were confirmed by hand in a browser.
 *
 *  Three branches, degrading: the overview card, then the first child of
 *  main#content, then nothing at all. The third branch is deliberate. A panel
 *  that cannot find where it belongs should be absent, not floating over
 *  somebody else's header, which is the mistake the Hyperliquid fallback made
 *  and had to be corrected for.
 *
 *  8004SCAN: fixed position. That page renders client side, has no <main>, and
 *  every class name is a CSS module hash, so there is nothing to anchor to
 *  that would survive their next deploy. A fixed card asserts nothing about
 *  their layout. It is appended to documentElement rather than into the page
 *  tree, because an ancestor carrying transform, filter or will-change turns
 *  position:fixed into position:absolute against that ancestor.
 */
function placeAgentPanel(el, mode, allowFallback) {
  if (el.isConnected) return true;

  if (mode === "explorer" || mode === "inflow") {
    const summary = document.getElementById("ContentPlaceHolder1_divSummary");
    if (summary && summary.parentElement) {
      summary.parentElement.insertBefore(el, summary);
      return true;
    }
    const main = document.querySelector("main#content") || document.querySelector("main");
    if (!main) return false;

    // AFTER THE PAGE'S OWN HEADING, NOT ABOVE IT.
    //
    // Inserting as the first child of <main> puts the panel above the host's
    // own title, which is the worst position available and is the exact
    // mistake the Hyperliquid fallback had to be corrected for: it sat above
    // their header for the life of the page and was being chosen by default
    // rather than in extremis.
    //
    // So anchor on the page's own <h1> and insert after whichever top-level
    // child of <main> contains it. On Blockscout that is a two-child main:
    // [0] the address header, [1] the tabs and content, so the panel lands
    // between them, which is structurally where it sits on the Etherscan
    // family too. Both <main> and <h1> are semantic tags rather than
    // generated class names, so neither moves on that app's next deploy.
    const h1 = main.querySelector("h1");
    if (h1) {
      let node = h1;
      while (node.parentElement && node.parentElement !== main) node = node.parentElement;
      if (node.parentElement === main && node.nextElementSibling) {
        main.insertBefore(el, node.nextElementSibling);
        return true;
      }
      if (node.parentElement === main) {
        main.appendChild(el);
        return true;
      }
    }
    // No heading yet. On a single-page app that usually means the view has
    // not finished rendering, not that it has no heading, so REFUSE and let
    // the caller retry. Returning true here is how the panel ended up above
    // Blockscout's own address header: the first attempt landed at the top of
    // an unrendered main, place() counted that as placed, and the retry loop
    // that would have found the heading never ran again. The Hyperliquid
    // panel had to be corrected for the identical mistake and says so in its
    // own comment; this is the second time it has been made.
    if (!allowFallback) return false;

    // The wait is over and there is still no heading. First child is a worse
    // position than after a title and a better one than no panel, and it is
    // reached only in extremis rather than by default.
    main.insertBefore(el, main.firstElementChild);
    return true;
  }

  el.classList.add("tnega-floating");
  (document.documentElement || document.body).appendChild(el);
  return true;
}
