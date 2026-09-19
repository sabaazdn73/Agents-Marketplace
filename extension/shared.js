// shared.js
//
// The one place that knows the API, the vocabulary and the colours. Both the
// content script and the popup render from here so they cannot drift into two
// different accounts of the same number.
//
// This file computes nothing about behaviour. Every rate, every band and every
// reason for withholding a rate is decided by the backend
// (core/hyperliquid/service.py, address_detail) and rendered verbatim. If the
// rule for when a number is trustworthy lived here too, there would be two
// rules, and the one on screen would be the one nobody reviewed.

const API_BASE = "https://agents-marketplace-q3k4.onrender.com";

// Tnega's palette, taken from the Hyperliquid tab in the main app so the panel
// reads as the same product. The mint is Hyperliquid's own, sampled from their
// favicon at #97FCE4 across 80% of its opaque pixels.
const T = {
  mint: "#97FCE4",
  ink: "#0B101B",
  panel: "#111827",
  line: "rgba(255,255,255,0.10)",
  text: "#E5E7EB",
  muted: "#9CA3AF",
  quiet: "#6B7280",
  warn: "#FBBF24",
};

// Why a number is not being shown. Each of these is a different situation and
// a reader can act on the difference, which is the whole reason the backend
// returns a reason rather than a null.
const WITHHELD = {
  not_tracked: {
    title: "Not in our measured set",
    // The body promised something the panel does not always have. See
    // withheldCopy: this string is only correct when a venue block follows it.
    body: "This project has not polled this address, so it has no rejection rate "
      + "of ours. What follows is the venue's own published record of it.",
  },
  // Same reason, different situation: not in our set AND not in the venue's
  // leaderboard file either, so nothing follows and nothing should be promised.
  //
  // THIS NO LONGER INFERS ANYTHING FROM THE ABSENCE, corrected 2026-09-19.
  // It used to end "so an address absent from both has most likely not traded
  // there", which was a conclusion drawn from a gap in someone else's file.
  // Tested: of 40 addresses absent from the file, 2 had a venue record, and
  // both of those had fills, 3 and 20 of them. The file is narrower than the
  // set of addresses that have traded, so absence from it is not evidence of
  // anything about the address.
  //
  // The reliable statement is already on this panel, one block up: userRole
  // answers "missing" for an address the venue has never seen, and the
  // account block says so in its own words. That is a reading. This is not.
  not_tracked_no_record: {
    title: "Not in our measured set",
    body: "This project has not polled this address, so it has no rejection rate "
      + "of ours, and it is not in the venue's leaderboard file either. That "
      + "file lists the accounts the venue ranks and is narrower than everyone "
      + "who has traded, so its silence is not evidence about this address. "
      + "Whether the venue has any record of it is said above.",
  },
  no_polls_yet: {
    title: "Tracked, not yet polled",
    body: "It was added to the set but no poll has stored anything for it yet.",
  },
  too_few_polls: {
    title: "Too few observations",
    body: "There are not enough polls behind this address to state a rate that would mean anything.",
  },
  left_rotation: {
    title: "No longer being polled",
    body:
      "This address was measured until it left the collector's set, so what is stored for it " +
      "describes that earlier period and will not refresh. The set is chosen on recent trading " +
      "activity and is smaller than the number of addresses ever measured, so an address can " +
      "leave it without anything being wrong with the address.",
  },
  stale_data: {
    title: "Data is not current",
    body:
      "The most recent order seen for this address is older than an hour. Hyperliquid's order " +
      "endpoint can return a full buffer of months-old records for an account that is trading " +
      "today, so a rate computed from it would describe the past and look like the present.",
  },
  no_post_only_orders: {
    title: "No post-only orders",
    body:
      "This address has been observed but posts no post-only orders, so there is no post-only " +
      "rejection rate to compute. It is trading, not quoting.",
  },
};

// What the rate means. Descriptive only. There is deliberately no advice here
// about when to quote or what to do next: the persistence test has not
// answered, and its first pass found a negative lag-1 autocorrelation, which
// is the opposite of what any timing suggestion would need.
const BANDS = {
  quoting: {
    label: "Quoting",
    colour: T.mint,
    body: "Almost every post-only order rests on the book. This is what market making looks like.",
  },
  mixed: {
    label: "Mixed",
    colour: T.warn,
    body: "A meaningful share of its post-only orders are refused before resting.",
  },
  spraying: {
    label: "Spraying",
    colour: "#F87171",
    body:
      "Most of its post-only orders never rest. Orders that are refused provide no liquidity " +
      "and leave no trace in fills, so this is invisible in volume figures.",
  },
};

/** Escape a string that came from the network before it is put into HTML.
 *
 *  Both surfaces build their markup with template literals and innerHTML, and
 *  most of what they interpolate is either a number we formatted or a constant
 *  from this file. Two things are not: a band name the backend has not seen
 *  before, which falls through the BANDS lookup and is printed as-is, and the
 *  text of a fetch error. Neither is attacker-controlled today. Both would be
 *  if the backend were ever swapped or spoofed, and escaping them costs one
 *  function. */
function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtPct(x) {
  return x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`;
}

function fmtInt(n) {
  return (n === null || n === undefined) ? "n/a" : n.toLocaleString("en-US");
}

function fmtAge(seconds) {
  if (seconds === null || seconds === undefined) return "never";
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)} h ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

/** The Hyperliquid address this page is about, or null. Read from the URL
 *  rather than the DOM: the explorer route carries it, and the page title does
 *  not.
 *
 *  ANCHORED, AND NARROWED TO THE ROUTE THAT EXISTS
 *  Their live bundle was read rather than guessed at. The route table carries
 *  /explorer/address/:address and no bare /address/:address, so the optional
 *  prefix the earlier version allowed matched a route that does not exist. It
 *  also carries /explorer/token/:address and /vaults/:vaultAddress, which are
 *  a token contract and a vault, not a trader. Neither contains an `address/`
 *  segment so neither ever matched, but the regex is now anchored to the start
 *  of the path so that a future route cannot back into it. */
function addressFromUrl(href) {
  try {
    const u = new URL(href);
    if (u.hostname !== "app.hyperliquid.xyz") return null;
    const m = u.pathname.match(/^\/explorer\/address\/(0x[a-fA-F0-9]{40})\/?$/);
    return m ? m[1].toLowerCase() : null;
  } catch (e) {
    return null;
  }
}

// The Etherscan-family explorers, and the chain each one is about.
//
// EXACT HOSTNAMES, NEVER A WILDCARD
// sepolia.etherscan.io, testnet.monadscan.com, sepolia.arbiscan.io,
// sepolia.basescan.org and testnet.bscscan.com all resolve. A wildcard pattern
// would match them and show a mainnet measurement on a testnet page, which is
// wrong rather than merely unhelpful.
//
// The chain id is carried here because the panel says which chain an agent is
// on, and an owner can hold agents on several: 2,245 of them do. Without this
// the panel would present a Base agent on a BscScan page as though the page
// were about it.
// `place` is how the panel gets onto the page, not a detail of styling.
//   "inflow"   insert before the overview card, which these six share because
//              they are one Etherscan codebase with ASP.NET control ids.
//   "floating" a fixed card, for a page with nothing stable to anchor to.
//
// Robinhood Chain was excluded at first because its explorer is a Blockscout
// single-page app with no server-rendered anchor. That reason does not survive
// its own argument: a floating card needs no anchor, which is exactly why
// 8004scan is covered. What is left is a real chain where this project's own
// AgentBudgetEscrow is deployed and has been used, which is a different thing
// from a chain we only index, and the permission warning already names six
// hosts so a seventh costs nothing that has not already been spent.
const EXPLORERS = {
  "etherscan.io": { chainId: 1, place: "inflow" },
  "bscscan.com": { chainId: 56, place: "inflow" },
  "basescan.org": { chainId: 8453, place: "inflow" },
  "arbiscan.io": { chainId: 42161, place: "inflow" },
  "monadscan.com": { chainId: 143, place: "inflow" },
  "hyperevmscan.io": { chainId: 999, place: "inflow" },
  // Inline, not floating. The first version floated here because that
  // explorer's HTML could not be fetched to find an anchor, and "I could not
  // verify a DOM" was allowed to become "there is no DOM to anchor to". Those
  // are different claims. Loaded in a real browser the page renders a
  // <main> element 1092px wide, which is a semantic tag rather than a
  // generated class and is the same fallback the Etherscan family already
  // uses when its overview card is missing.
  //
  // The visible symptom of getting this wrong was that the panel was 340px
  // and stacked vertically while every other host rendered it across the
  // content column.
  "robinhoodchain.blockscout.com": { chainId: 4663, place: "inflow" },
};

/** What this page is about, on any site the extension runs on.
 *
 *  Returns null, or { kind, key, address?, slug?, tokenId?, chainId? } where
 *  `key` is the membership key to test. One function so that the set of
 *  identifiers the extension can read is in one place and the privacy policy
 *  can cite it by name.
 *
 *  Reads the URL only. On the seven non-Hyperliquid sites this is the whole of
 *  what the extension reads from the page. */
function subjectFromUrl(href) {
  let u;
  try {
    u = new URL(href);
  } catch (e) {
    return null;
  }
  const host = u.hostname;
  const path = u.pathname;

  if (host === "app.hyperliquid.xyz") {
    const address = addressFromUrl(href);
    return address
      ? { kind: "hyperliquid", key: `h:${address}`, address }
      : null;
  }

  if (Object.prototype.hasOwnProperty.call(EXPLORERS, host)) {
    // Anchored to /address/. Their /token/0x…, /tx/0x… and /nft/0x…/n pages
    // also carry a 0x string, and a "contains an address" test would put an
    // owner panel on a token contract.
    const m = path.match(/^\/address\/(0x[a-fA-F0-9]{40})\/?$/);
    if (!m) return null;
    const address = m[1].toLowerCase();
    return {
      kind: "explorer",
      key: `o:${address}`,
      // An address can be covered without owning a registered agent: as an
      // ERC-8183 provider, or as the agent a budget was funded to. All three
      // key spaces are tested and any hit draws the panel.
      altKeys: [`j:${address}`, `b:${address}`],
      address,
      chainId: EXPLORERS[host].chainId,
      place: EXPLORERS[host].place,
    };
  }

  if (host === "8004scan.io") {
    const agent = path.match(/^\/agents\/([a-z0-9-]+)\/(\d+)\/?$/);
    if (agent) {
      const slug = agent[1].toLowerCase();
      return {
        kind: "agent",
        key: `a:${slug}:${agent[2]}`,
        slug,
        tokenId: agent[2],
      };
    }
    const owner = path.match(/^\/users\/(0x[a-fA-F0-9]{40})\/?$/);
    if (owner) {
      const address = owner[1].toLowerCase();
      return {
        kind: "explorer",
        key: `o:${address}`,
        altKeys: [`j:${address}`, `b:${address}`],
        address,
        place: "floating",
      };
    }
    return null;
  }

  return null;
}

/** Ask the service worker whether these keys are covered.
 *
 *  Three answers, not two. `{ ok: false, reason: "no_filter" }` means the list
 *  has not arrived yet, which is not the same as "not covered" and must not be
 *  drawn as though it were.
 */
function askMembership(keys) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    // A worker that is starting up can take a moment, and a message that never
    // gets a reply would leave the page with a promise that never settles.
    const timer = setTimeout(() => done({ ok: false, reason: "no_reply" }), 5000);
    try {
      chrome.runtime.sendMessage({ type: "tnega-member", keys }, (reply) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !reply) {
          done({ ok: false, reason: "no_reply" });
          return;
        }
        done(reply);
      });
    } catch (e) {
      clearTimeout(timer);
      done({ ok: false, reason: "no_reply" });
    }
  });
}

/** What this project measured about one identifier. */
async function fetchSubject(identifier) {
  const r = await fetch(
    `${API_BASE}/api/extension/subject/${encodeURIComponent(identifier)}`,
    { method: "GET", credentials: "omit" });
  if (!r.ok) throw new Error(`backend returned ${r.status}`);
  return r.json();
}

// Why an agent panel is not showing a figure. Same discipline as WITHHELD
// above and decided in the same place: backend/core/extension/subject.py. A
// reason added there is added here in the same commit.
const AGENT_WITHHELD = {
  not_covered: {
    title: "Nothing measured for this address",
    body: "This address does not hold a registered ERC-8004 agent in our " +
      "snapshot and has no on-chain job naming it as a provider.",
  },
  not_in_snapshot: {
    title: "Not in our snapshot",
    body: "This agent is registered on chain but was not in the registry read " +
      "this list was built from. A registration made since then arrives at the " +
      "next build.",
  },
  chain_not_covered: {
    title: "Chain not covered",
    body: "This project does not read the registry on this chain, so there is " +
      "nothing stored about agents registered there.",
  },
  chain_not_analysed: {
    title: "Not checked on this chain",
    body: "The health pass has not been widened to this chain. A stored status " +
      "from before the pass was chain-aware would describe the wrong thing, so " +
      "none is shown.",
  },
  health_not_checked: {
    title: "Service not checked yet",
    body: "This agent is in the registry but its published endpoint has not " +
      "been called yet, so whether it answers is not established.",
  },
  no_jobs_indexed: {
    title: "No jobs indexed",
    body: "No ERC-8183 job names this address as its provider. The index covers " +
      "one escrow contract on BNB Chain, so an agent hired somewhere this " +
      "project does not read would look the same.",
  },
  no_delivery_history: {
    title: "No delivery history",
    body: "No ERC-8183 job names this address as provider, delivered or " +
      "funded, so there is nothing to say about who has paid it.",
  },
  no_budgets_opened: {
    title: "No budget opened for this address",
    body: "No budget has been funded to it through this project's escrow. " +
      "That contract is on BNB Chain, Arbitrum and Robinhood Chain, so a " +
      "budget opened anywhere else would look the same.",
  },
  no_address_on_page: {
    title: "No address on this page",
    body: "An agent page names an agent, not a wallet, so there is no address " +
      "to read against the Hyperliquid collector's set.",
  },
  store_unavailable: {
    title: "Measurements unreachable",
    body: "The store holding this reading did not answer. That is a fault at " +
      "our end, not a statement about this address.",
  },
  unreadable_identifier: {
    title: "Not something this can read",
    body: "The page carries no address or agent number this extension knows how " +
      "to look up.",
  },
};

/** A date, from a unix timestamp, for a coverage line. */
function fmtDate(seconds) {
  if (seconds === null || seconds === undefined) return "an unknown date";
  try {
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  } catch (e) {
    return "an unknown date";
  }
}

async function fetchAddress(address) {
  const r = await fetch(`${API_BASE}/api/hyperliquid/address/${address}`, {
    method: "GET",
    credentials: "omit",
  });
  if (!r.ok) {
    throw new Error(`backend returned ${r.status}`);
  }
  return r.json();
}


/** The delivery provenance sentences, in order.
 *
 *  WHY THIS IS HERE AND NOT IN A PANEL
 *  Three surfaces say this now: the site's DeliveryProvenance.jsx, the panel on
 *  an explorer, and the popup. The first is a different codebase and has to be
 *  kept in step by review. The second and third are both in this package and
 *  would otherwise be two copies of one analysis, which is how the same agent
 *  ends up described two ways. They render the same array.
 *
 *  Returns an array of plain strings. No markup, no colour, no verdict: facts
 *  in the same voice as the withheld reasons, saying what was counted, over
 *  what, and what it does not mean.
 *
 *  @param {object} pv the `provenance` block from /api/extension/subject
 *  @returns {string[]} zero or more sentences
 */
function provenanceLines(pv) {
  if (!pv || pv.withheld_reason) return [];
  const lines = [];
  const delivered = pv.jobs_delivered || 0;
  const clients = pv.clients_delivered || 0;
  const self = pv.jobs_self_funded || 0;
  const external = pv.jobs_delivered_external || 0;

  if (delivered > 0) {
    lines.push(clients === 1
      ? `${fmtInt(delivered)} ${delivered === 1 ? "delivery" : "deliveries"}, all to one client.`
      : `${fmtInt(delivered)} deliveries to ${fmtInt(clients)} clients. `
        + `The largest of them paid for ${fmtInt(pv.top_client_delivered)} of the ${fmtInt(delivered)}.`);
  }

  // Counted, not inferred from whichever client sorted first. The tiebreak
  // this used to rest on flipped between runs for a provider with two clients
  // holding one delivery each.
  if (self > 0 && external === 0) {
    lines.push("Every one of those went to the owner's own address. Money "
      + "returning to the address it left is activity, not demand, and does "
      + "not count towards the verified tier.");
  } else if (self > 0) {
    lines.push(`${fmtInt(self)} of them went to the owner's own address and `
      + `${fmtInt(external)} to somebody else.`);
  } else if (pv.top_client_is_agent_owner) {
    lines.push(pv.top_client_agent_name
      ? `The largest client is the owner of another agent in this index, `
        + `${pv.top_client_agent_name}. It is a buyer, and it is not an unrelated one.`
      : "The largest client is the owner of another agent in this index. It is "
        + "a buyer, and it is not an unrelated one.");
  } else if (clients === 1 && delivered > 0) {
    lines.push("A single buyer is a narrow base to judge from, not a fault on "
      + "its own.");
  }

  if (pv.unanswered_from_new_clients_known === false) {
    lines.push("Whether any funded job is from a client this owner has not "
      + "delivered to was not computed: it has too many distinct clients to "
      + "check cheaply. That is a gap in this line, not a finding.");
  } else if ((pv.unanswered_from_new_clients || 0) > 0) {
    const n = pv.unanswered_from_new_clients;
    lines.push(delivered > 0
      ? `${fmtInt(n)} funded ${n === 1 ? "job is" : "jobs are"} from a client this `
        + "owner has never delivered to, and nothing has come back yet. A funded "
        + "job is money already committed."
      : `${fmtInt(n)} ${n === 1 ? "job has" : "jobs have"} been funded and this owner `
        + "has delivered nothing at all, to anyone. A funded job is money already "
        + "committed.");
  }

  return lines;
}


/** Budgets funded to this address, as sentences.
 *
 *  COUNTED FROM DRAWN EVENTS, NEVER FROM `spent`
 *  The escrow sets spent = total when a client reclaims, so a budget taken
 *  back in full reads as one drawn in full. The server reads the event index
 *  instead; this only renders what it sends. The distinction is the whole
 *  point of the block: a budget opened and never drawn is money a buyer
 *  committed and the agent did not collect, which is a different fact from no
 *  budget at all.
 */
function budgetLines(b) {
  if (!b || b.withheld_reason) return [];
  const n = b.budgets || 0;
  const drawn = b.budgets_drawn_from || 0;
  const never = b.budgets_never_drawn || 0;
  const lines = [];
  lines.push(n === 1
    ? "One budget has been funded to this address."
    : `${fmtInt(n)} budgets have been funded to this address.`);
  if (drawn === 0) {
    lines.push(n === 1
      ? "It was never drawn against. The money was committed and not collected."
      : "None of them were drawn against. The money was committed and not collected.");
  } else if (never > 0) {
    lines.push(`${fmtInt(drawn)} ${drawn === 1 ? "was" : "were"} drawn against and `
      + `${fmtInt(never)} ${never === 1 ? "was" : "were"} not.`);
  } else {
    lines.push(n === 1 ? "It was drawn against."
      : "All of them were drawn against.");
  }
  return lines;
}


/** What to call an address that is covered but holds no registered agent.
 *
 *  Three different facts can put an address here and they are not the same
 *  event: a job hired it, a budget was funded to it, or both. Naming the wrong
 *  one is the kind of small inaccuracy this panel exists to avoid.
 *
 *  In shared.js because the panel and the popup both need it, and a second copy
 *  is how the two end up disagreeing.
 */
function noIdentityTitle(half) {
  const hasJobs = half.jobs && !half.jobs.withheld_reason;
  const hasBudget = half.budgets && !half.budgets.withheld_reason;
  if (hasJobs && hasBudget) return "Hired and funded, no registered agent";
  if (hasJobs) return "Hired on chain, no registered agent";
  if (hasBudget) return "Funded a budget, no registered agent";
  return "No registered agent";
}



/** What kind of Hyperliquid account this is, as a title and a body.
 *
 *  WHY THIS IS ON EVERY HYPERLIQUID READING AND NOT ONLY THE INTERESTING ONES
 *  A 92% rejection rate means one thing for a trader and another for a vault
 *  holding other people's deposits, or for a platform holding many customers
 *  in one account. The venue can tell us the first two: userRole reports
 *  "vault", and approvedBuilders reports that an address submits through a
 *  front-end, which is what a person using an app looks like.
 *
 *  It cannot tell us the third. A custodial omnibus account returns role
 *  "user" with no approved builders, exactly as a solo trader does, and 50 of
 *  the 66 addresses ever polled sit in that state. So the block appears on
 *  every reading, and on that majority it says the thing is not established.
 *  A caveat that appeared only when we happened to know something would cover
 *  the wrong case.
 *
 *  The words are decided in backend/core/hyperliquid/venuerole.py and rendered
 *  verbatim here, the same rule the withheld reasons follow.
 */
/** The withheld wording, chosen against what the panel actually has.
 *
 *  WHY THIS IS A FUNCTION AND NOT A LOOKUP, added 2026-09-19
 *  `not_tracked` rendered a fixed sentence ending "What follows is the venue's
 *  own published record of it", and the venue block that was supposed to
 *  follow it is attached only when the address is in the leaderboard file.
 *  Every other address reaching that panel, an agent owner or a job provider
 *  that has never traded on the venue, got a promise with nothing after it.
 *
 *  The reason code is unchanged and still means one thing. What changes is
 *  that the sentence is picked from what is present rather than asserted in
 *  advance, which is the same rule the rest of this file follows for a rate.
 */
function withheldCopy(reason, data) {
  if (reason === "not_tracked" && !(data && data.venue_leaderboard)) {
    return WITHHELD.not_tracked_no_record;
  }
  return WITHHELD[reason] || {
    title: "No rate available",
    body: "No rate is being shown for this address.",
  };
}

function accountBlock(a) {
  if (!a || !a.account_kind) return null;
  return {
    kind: a.account_kind.kind,
    title: a.account_kind.title,
    body: a.account_kind.body,
  };
}


/** API agent approvals, as a reading.
 *
 *  WHAT THIS SAYS AND WHAT IT REFUSES TO SAY
 *  It reports a count and an expiry. It does not say the account is automated,
 *  and that restraint is measured rather than cautious. Across the venue's
 *  leaderboard by volume rank band, 24 addresses each, the share holding an
 *  approval runs 46%, 54%, 50% and 38% from the top band down to rank 20,000:
 *  a coin flip across the active population with no gradient. Front-ends
 *  create these too, "Mobile QR" being the venue's own app pairing.
 *
 *  It is also current state. Every approval carries an expiry, observed
 *  between 8 and 178 days out, so an account whose approval lapsed reads here
 *  exactly like one that never had one. That is said on the panel rather than
 *  left for a reader to discover, because the zero case is the one a reader
 *  would otherwise treat as a finding.
 */
function agentApprovalLines(a) {
  if (!a || a.agent_approvals === null || a.agent_approvals === undefined) return [];
  const n = a.agent_approvals;
  const out = [];
  if (n > 0) {
    const exp = a.agent_approval_expires_at;
    const days = exp ? Math.round((exp * 1000 - Date.now()) / 86400000) : null;
    out.push(`Has ${fmtInt(n)} currently valid API agent approval${n === 1 ? "" : "s"}`
      + (days !== null && days > 0 ? `, the soonest expiring in ${fmtInt(days)} days.` : "."));
  } else {
    out.push("No currently valid API agent approval.");
  }
  out.push("Read as current state. Approvals expire, so one that has lapsed looks "
    + "the same here as one that never existed, and front-ends create them too.");
  return out;
}

/** What an address holds, for the case where there is no rate to show.
 *
 *  WHAT THIS IS AND IS NOT
 *  Every line below is a direct read from the venue: HYPE delegated, perp
 *  account value, open positions, spot balances. Those are measurements.
 *
 *  The sentence a reader will want next, "so it is a staker rather than a
 *  trader", is an inference and this deliberately does not make it. It was
 *  tested before being rejected: across 28 tracked addresses, 15 hold both a
 *  delegation and a live perp account, and the largest delegator of all,
 *  101,815 HYPE, is an active maker carrying a rejection rate on this same
 *  panel. Delegating is something most participants here do.
 *
 *  TAKES THE ACCOUNT KIND, added 2026-09-19
 *  clearinghouseState answers 0 for an address the venue has never seen, so
 *  for such an address this used to print "No perp account value and no open
 *  position on this venue right now", under a heading reading "What this
 *  account holds". Both sentences describe an account that does not exist.
 *  The zero was the absence of a record being rendered as a measurement of
 *  emptiness, which is the same defect the account block carried one line
 *  above it. When the venue says it has no record, there is nothing to hold
 *  and this returns nothing.
 *
 *  Returns an array of plain sentences, or an empty array when there is
 *  nothing to say. The caller renders the note beside them.
 */
function holdingsLines(h, kind) {
  if (kind === "no_account") return [];
  if (!h || h.withheld_reason) return [];
  const out = [];
  const d = h.hype_delegated;
  const v = h.perp_account_value_usd;
  const p = h.open_positions;
  const sp = h.spot_balances;

  if (v !== null && v !== undefined && p !== null && p !== undefined) {
    out.push(v > 0 || p > 0
      ? `A perp account holding ${fmtUsdShort(v)}${p ? ` across ${fmtInt(p)} position${p === 1 ? "" : "s"}` : " with no open position"}.`
      : "No perp account value and no open position on this venue right now.");
  }
  if (d !== null && d !== undefined && d > 0) {
    out.push(`${d.toLocaleString(undefined, { maximumFractionDigits: 2 })} HYPE delegated to validators.`);
  }
  if (sp !== null && sp !== undefined && sp > 0) {
    out.push(`${fmtInt(sp)} spot balance${sp === 1 ? "" : "s"}.`);
  }
  // A list that is short because a call failed must say so, or it reads as a
  // list that is short because the account holds little.
  if (h.not_read && h.not_read.length && out.length) {
    out.push(`Not read: ${h.not_read.join(", ")}. Those are gaps here, not zeroes.`);
  }
  return out;
}

/** The venue's own published figures for an address, for a panel with no rate.
 *
 *  WHAT THIS IS, AND WHOSE IT IS
 *  Every line below comes from Hyperliquid's public leaderboard file, cached
 *  daily by this project's selection job. None of it is measured here. The
 *  caller renders these under a heading that says so, the same distinction
 *  the 30-day volume column on the tab already makes.
 *
 *  WHY THE PANEL HAS THEM AT ALL
 *  An address outside the measured rotation used to get one sentence about
 *  our coverage and no fact about the address, which reads as broken rather
 *  than as a limit honestly stated. It was not even true that nothing was
 *  known: the venue publishes an account value and four windows of PnL, ROI
 *  and volume for all 46,000 of them.
 *
 *  PnL IS PRESENT ONLY WHEN THE BACKEND SENT IT
 *  This function never decides that. service.leaderboard_row does, on one
 *  rule: PnL is withheld wherever a post-only rejection rate appears on the
 *  same panel, because the correlation between the two is +0.013 and putting
 *  them side by side asserts a relationship the data rejects. An address we
 *  do not measure has no rate, so it has no such adjacency.
 */
function venueLeaderboardLines(vl) {
  if (!vl) return [];
  const out = [];
  const m = (vl.windows && vl.windows.month) || {};
  const all = (vl.windows && vl.windows.all_time) || {};
  if (vl.account_value_usd !== null && vl.account_value_usd !== undefined) {
    out.push(`Account value ${fmtUsdShort(vl.account_value_usd)}, counting perps, spot, staking and vault equity together.`);
  }
  if (vl.traded_in_window === false) {
    // No rank here on purpose: 58% of the file is tied at zero volume and
    // ranked only by the sort's tie-break, so a position among them would be
    // a number with nothing behind it.
    out.push("No trading in the last 30 days, though the account still appears in the venue's file.");
  } else if (m.volume !== null && m.volume !== undefined) {
    out.push(`${fmtUsdShort(m.volume)} traded in 30 days, which is the leveraged figure a venue means by volume rather than capital at risk.`);
    if (vl.volume_rank && vl.ranked_of) {
      out.push(`Ranked ${fmtInt(vl.volume_rank)} of the ${fmtInt(vl.ranked_of)} addresses that traded at all.`);
    }
  }
  if (m.pnl !== null && m.pnl !== undefined) {
    const roi = (m.roi !== null && m.roi !== undefined)
      ? `, which the venue reports as ${(m.roi * 100).toFixed(1)}%` : "";
    // PnL WITHOUT TRADING IS NOT A TRADING RESULT, added 2026-09-19.
    //
    // 15,691 addresses, 58% of those with no 30-day volume, carry a non-zero
    // 30-day PnL. 0x393d0b87 is the clearest: zero volume in every window,
    // +$268M for the month, and what it holds is 12,001,915 HYPE delegated and
    // $45 of spot. Printing that beside the word "return" invites a reader to
    // take it as trading performance by an account that has never placed a
    // trade.
    out.push(vl.traded_in_window === false
      ? `${signedUsd(m.pnl)} reported for those 30 days${roi}. The account placed no trades in the window, so this did not come from trading.`
      : `${signedUsd(m.pnl)} over those 30 days${roi}.`);
  }
  if (all.pnl !== null && all.pnl !== undefined) {
    out.push(`${signedUsd(all.pnl)} since the account opened.`);
  }
  if (m.pnl !== null && m.pnl !== undefined) {
    // WHAT THE PROFIT CAME FROM, on the one shape of account where that can be
    // computed rather than guessed.
    //
    // The "we do not reproduce how it is derived" sentence used to be
    // unconditional. It was written on the strength of a $120M gap that turned
    // out to be this project's own unit error, and where the backend can now
    // close the composition to 0.25% it is simply false. So it is kept only
    // where the attribution could not be completed, which is still most
    // accounts: see attribution.py for why a trading account cannot be done at
    // all.
    const at = vl.attribution;
    if (at && at.established) {
      const st = Math.round(at.stake_start_hype).toLocaleString();
      // The line above already says there were no trades, so this one starts
      // with what the account did hold rather than repeating the absence.
      out.push(`It held about ${st} HYPE staked while HYPE moved from `
        + `$${at.hype_start.toFixed(2)} to $${at.hype_end.toFixed(2)}, and was paid `
        + `${Math.round(at.staking_rewards_hype).toLocaleString()} HYPE in staking rewards. `
        + `Those two come to ${signedUsd(at.profit_usd)} on our own reading of the chain.`);
    } else {
      const why = at && at.detail
        ? at.detail.charAt(0).toLowerCase() + at.detail.slice(1)
        : null;
      out.push("The venue's own profit figure. It is not restricted to trading, and "
        + (why
          ? `where it came from is not established here: ${why}`
          : "this project does not reproduce how it is derived."));
    }
  }
  return out;
}

function signedUsd(v) {
  const n = Number(v);
  return `${n < 0 ? "\u2212" : "+"}${fmtUsdShort(Math.abs(n))}`;
}

function fmtUsdShort(v) {
  if (v === null || v === undefined) return "n/a";
  const n = Number(v);
  // Billions matter here now. Leaderboard volume runs to $42B, and without
  // this tier that rendered as $42750.0M.
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}


/** The history behind a rate, as an inline SVG path.
 *
 *  WHY THE PANEL NEEDS THIS AND NOT ONLY THE TAB
 *  The panel is the surface people actually use: it appears on the address
 *  page they were already looking at. A rate with no history there is the
 *  same misreading the tab was corrected for, on the surface where it
 *  happens more often.
 *
 *  THE THREE RULES IT INHERITS FROM THE TAB
 *  A null hour is a break in the line, never a drop to the baseline: an hour
 *  with no post-only orders is an hour with no rate, not a perfect one. The
 *  line is scaled to this address alone, so its height says how this address
 *  moved and nothing about any other. And the caller must not draw it at all
 *  when the rate itself is withheld, because a line of hourly rates beside a
 *  withheld figure is that figure republished at finer resolution.
 *
 *  Returns "" when there is nothing honest to draw.
 */
function rateSparklineSvg(series, opts) {
  if (!series || !Array.isArray(series.rates)) return "";
  const rates = series.rates;
  const known = rates.filter((r) => r !== null && r !== undefined);
  if (known.length < 2 || rates.length < 2) return "";

  const W = (opts && opts.width) || 150;
  const H = (opts && opts.height) || 26;
  const max = Math.max(...known);
  const min = Math.min(...known);
  const span = max - min || max || 1;
  const x = (i) => (i / (rates.length - 1)) * W;
  const y = (r) => H - 1 - ((r - min) / span) * (H - 2);

  const runs = [];
  let run = [];
  rates.forEach((r, i) => {
    if (r === null || r === undefined) { if (run.length > 1) runs.push(run); run = []; return; }
    run.push(`${x(i).toFixed(1)},${y(r).toFixed(1)}`);
  });
  if (run.length > 1) runs.push(run);
  if (!runs.length) return "";

  const gaps = rates.length - known.length;
  const title = `${rates.length} hours, ${fmtPct(min)} to ${fmtPct(max)}.`
    + (gaps ? ` ${gaps} hour${gaps === 1 ? "" : "s"} with no post-only orders, drawn as gaps rather than as zero.` : "")
    + " Scaled to this address only.";

  const paths = runs.map(
    (pts) => `<polyline points="${pts.join(" ")}" fill="none" stroke="currentColor" `
      + `stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round" opacity="0.8" />`
  ).join("");
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" `
    + `aria-label="${esc(title)}"><title>${esc(title)}</title>${paths}</svg>`;
}

/** Collapse and restore, and why a panel that injects itself needs it.
 *
 *  This extension puts a card into somebody else's page. On the Etherscan
 *  family and on Blockscout it lands in the flow and pushes content down,
 *  which is polite. Where there is no anchor it is a fixed card, and a fixed
 *  card sits ON TOP of the page: on 8004scan it covered the right-hand column
 *  for the life of the visit with no way to get it out of the way.
 *
 *  Dismissing it entirely is the wrong control, because the panel is the
 *  reason the extension is installed and a reader who hides it once should not
 *  have to reinstall to see it again. Collapsing leaves the header, which is
 *  one line, and remembers the choice per host so it stays collapsed on that
 *  site and nowhere else.
 *
 *  Stored under one key in chrome.storage.local as a map of host to true.
 *  Nothing about which page was visited goes into it beyond the hostname, and
 *  it never leaves the machine.
 */
const COLLAPSE_KEY = "tnega_collapsed";

async function collapsedHosts() {
  try {
    const got = await chrome.storage.local.get(COLLAPSE_KEY);
    return got[COLLAPSE_KEY] || {};
  } catch (e) {
    return {};
  }
}

async function isCollapsed(host) {
  return !!(await collapsedHosts())[host];
}

async function setCollapsed(host, value) {
  try {
    const map = await collapsedHosts();
    if (value) map[host] = true; else delete map[host];
    await chrome.storage.local.set({ [COLLAPSE_KEY]: map });
  } catch (e) { /* the toggle still applies to this page view */ }
}

/** The control itself. Two glyphs rather than an icon font, so it carries no
 *  asset and cannot fail to load. aria-expanded is what a screen reader reads;
 *  the glyph is decorative and marked so. */
function collapseButtonHtml(collapsed) {
  return `<button type="button" class="tnega-min" aria-expanded="${collapsed ? "false" : "true"}"
    title="${collapsed ? "Show this panel" : "Collapse this panel"}">
    <span aria-hidden="true">${collapsed ? "+" : "\u2013"}</span>
  </button>`;
}

/** Wire the button on a rendered panel. Idempotent: the panels re-render on
 *  navigation in a single-page app and this is called again each time. */
function wireCollapse(panel) {
  const btn = panel.querySelector(".tnega-min");
  if (!btn || btn.dataset.tnegaWired) return;
  btn.dataset.tnegaWired = "1";
  const host = location.hostname;
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const nowCollapsed = !panel.classList.contains("tnega-collapsed");
    panel.classList.toggle("tnega-collapsed", nowCollapsed);
    btn.setAttribute("aria-expanded", nowCollapsed ? "false" : "true");
    btn.title = nowCollapsed ? "Show this panel" : "Collapse this panel";
    const glyph = btn.querySelector("span");
    if (glyph) glyph.textContent = nowCollapsed ? "+" : "–";
    await setCollapsed(host, nowCollapsed);
  });
}

/** Apply the remembered state before the panel is shown, so a collapsed panel
 *  never flashes open first. */
async function applyCollapsedState(panel) {
  if (await isCollapsed(location.hostname)) {
    panel.classList.add("tnega-collapsed");
    const btn = panel.querySelector(".tnega-min");
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      btn.title = "Show this panel";
      const glyph = btn.querySelector("span");
      if (glyph) glyph.textContent = "+";
    }
  }
}

/** Drag the floating panel, and why only that one.
 *
 *  Collapsing solved the panel covering the page, and left a smaller version of
 *  the same problem: the strip sits top-right by default and on 8004scan that
 *  is exactly where their own account controls are. A control that gets out of
 *  the way has to be movable, or it has only moved the collision.
 *
 *  ONLY THE FLOATING PANEL. In-flow panels sit in the document and push content
 *  down; dragging one would mean tearing it out of the layout it was placed in,
 *  which is the behaviour this extension is careful not to have.
 *
 *  Position is remembered per host, next to the collapsed flag, and is clamped
 *  into the viewport on every apply. Without the clamp a panel dragged to the
 *  edge of a wide window is off screen at a narrow one with no way to reach it,
 *  which would be worse than the corner it started in.
 */
const POSITION_KEY = "tnega_positions";

async function savedPositions() {
  try {
    const got = await chrome.storage.local.get(POSITION_KEY);
    return got[POSITION_KEY] || {};
  } catch (e) {
    return {};
  }
}

function clampToViewport(left, top, el) {
  const w = el.offsetWidth || 340;
  const h = el.offsetHeight || 80;
  // A margin rather than 0, so a panel can never be dragged flush into a corner
  // where its own control is under the browser's scrollbar.
  const m = 8;
  return {
    left: Math.max(m, Math.min(left, window.innerWidth - w - m)),
    top: Math.max(m, Math.min(top, window.innerHeight - h - m)),
  };
}

async function applySavedPosition(el) {
  if (!el.classList.contains("tnega-floating")) return;
  const pos = (await savedPositions())[location.hostname];
  if (!pos) return;
  const { left, top } = clampToViewport(pos.left, pos.top, el);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.right = "auto";
}

/** Drag by the header. Pointer events rather than mouse events, so a touch
 *  drag works and the pointer stays captured if it leaves the element. */
function wireDrag(el) {
  if (!el.classList.contains("tnega-floating")) return;
  const head = el.querySelector(".tnega-head");
  if (!head || head.dataset.tnegaDrag) return;
  head.dataset.tnegaDrag = "1";
  head.classList.add("tnega-draggable");

  // A flag rather than hasPointerCapture as the gate.
  //
  // The first version asked head.hasPointerCapture(e.pointerId) on every move
  // and did nothing when it was false. setPointerCapture can fail, and when it
  // does the panel simply refuses to move with no error anywhere: found in
  // testing, where a synthetic pointer sequence moved the card 12px and then
  // stopped. Capture is still requested, because it keeps the drag alive when
  // the pointer leaves the header, but it is an improvement to the drag rather
  // than the thing that decides whether there is one.
  let dragging = false;
  let pointerId = null;
  let startX = 0, startY = 0, baseLeft = 0, baseTop = 0, moved = false;

  head.addEventListener("pointerdown", (e) => {
    // The control and the link are inside the header and must keep working, so
    // a press that begins on either is not a drag.
    if (e.target.closest(".tnega-min, .tnega-link")) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const r = el.getBoundingClientRect();
    baseLeft = r.left; baseTop = r.top;
    startX = e.clientX; startY = e.clientY;
    moved = false;
    dragging = true;
    pointerId = e.pointerId;
    el.style.left = `${baseLeft}px`;
    el.style.top = `${baseTop}px`;
    el.style.right = "auto";
    try { head.setPointerCapture(e.pointerId); } catch (err) { /* see above */ }
    head.classList.add("tnega-dragging");
    e.preventDefault();
  });

  head.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    moved = true;
    const { left, top } = clampToViewport(baseLeft + dx, baseTop + dy, el);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });

  const end = async (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    try { head.releasePointerCapture(e.pointerId); } catch (err) { /* never captured */ }
    head.classList.remove("tnega-dragging");
    if (!moved) return;
    try {
      const all = await savedPositions();
      all[location.hostname] = {
        left: parseInt(el.style.left, 10),
        top: parseInt(el.style.top, 10),
      };
      await chrome.storage.local.set({ [POSITION_KEY]: all });
    } catch (err) { /* the move still applies to this page view */ }
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);

  // A window that shrinks below the saved position would leave the panel off
  // screen, so the clamp runs again on resize.
  if (!el.dataset.tnegaResize) {
    el.dataset.tnegaResize = "1";
    window.addEventListener("resize", () => {
      if (!el.style.left) return;
      const { left, top } = clampToViewport(parseInt(el.style.left, 10),
                                            parseInt(el.style.top, 10), el);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    });
  }
}
