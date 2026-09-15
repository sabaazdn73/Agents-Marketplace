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

/** The address this page is about, or null. Read from the URL rather than the
 *  DOM: the explorer route carries it, and the page title does not. */
function addressFromUrl(href) {
  try {
    const u = new URL(href);
    if (u.hostname !== "app.hyperliquid.xyz") return null;
    const m = u.pathname.match(/\/(?:explorer\/)?address\/(0x[a-fA-F0-9]{40})/);
    return m ? m[1].toLowerCase() : null;
  } catch (e) {
    return null;
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
