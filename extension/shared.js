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
    title: "Not tracked",
    body: "This address is not in the collector's set, so nothing has been measured for it.",
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
const EXPLORERS = {
  "etherscan.io": 1,
  "bscscan.com": 56,
  "basescan.org": 8453,
  "arbiscan.io": 42161,
  "monadscan.com": 143,
  "hyperevmscan.io": 999,
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
      // A provider with jobs but no registered agent is covered under a
      // different key space, so both are tested and either is a hit.
      altKey: `j:${address}`,
      address,
      chainId: EXPLORERS[host],
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
        altKey: `j:${address}`,
        address,
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
