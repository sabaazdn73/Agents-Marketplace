// sw.js
//
// The background service worker. It holds the membership list, refreshes it,
// and answers one question for content scripts: is this identifier covered.
//
// WHY THERE IS A WORKER NOW WHEN THERE WAS NONE
// 0.1.0 had no background page and the privacy policy said so. The list is
// what changed that. It is about a megabyte, it is the same for every tab, and
// re-fetching or re-parsing it per page load would be wasteful in a way the
// reader would feel. One copy lives here.
//
// MV3 WORKERS ARE NOT LONG LIVED
// Chrome shuts this down when it is idle, so nothing may be kept only in a
// variable: `memo` below is an optimisation for the life of one wake, and
// chrome.storage.local is the truth. For the same reason the refresh is a
// chrome.alarms alarm rather than setInterval, which would not survive the
// shutdown.
//
// THE DAILY CHECK IS A VERSION STRING, NOT THE LIST
// The alarm fetches /api/extension/filter/meta, a few hundred bytes, and
// downloads the list itself only when the version differs from the stored
// one. On most days nothing but the check happens. It is still a request to
// our server from the reader's IP on a schedule, which is telemetry, and the
// privacy policy names it as telemetry rather than arguing that it is not.
//
// FAIL CLOSED, ALWAYS
// Before the first list arrives, and whenever the store is unreachable, every
// membership question is answered "no". That means no panel. The alternative,
// asking the server about every address while the list is missing, is exactly
// the behaviour the list exists to prevent, and a fallback that silently
// inverts a privacy property is worse than a feature that is briefly absent.

importScripts("filter.js");

const API_BASE = "https://agents-marketplace-q3k4.onrender.com";
const KEY = "tnega_filter_v1";
const ALARM = "tnega-filter-refresh";
const REFRESH_MINUTES = 24 * 60;

// Held for the life of one wake only. See the note above.
let memo = null;

async function load() {
  if (memo) return memo;
  let stored;
  try {
    stored = (await chrome.storage.local.get(KEY))[KEY];
  } catch (e) {
    return null;                       // storage unavailable, answer no
  }
  if (!stored || !stored.bits) return null;
  memo = {
    bits: TnegaFilter.decode(stored.bits),
    m: stored.m,
    k: stored.k,
    version: stored.version,
    built_at: stored.built_at,
  };
  return memo;
}

async function fetchJson(path) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    credentials: "omit",             // no cookies, same rule as every call here
    cache: "no-cache",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Check, then download only on a change. */
async function refresh(force) {
  let stored = null;
  try {
    stored = (await chrome.storage.local.get(KEY))[KEY] || null;
  } catch (e) { /* treat as absent */ }

  if (!force && stored) {
    try {
      const meta = await fetchJson("/api/extension/filter/meta");
      if (meta && meta.version === stored.version) return "unchanged";
    } catch (e) {
      // The check failed. Keep what we have rather than discarding it: a list
      // from yesterday is a working extension, and an empty one is a silent
      // one.
      return `check failed: ${e.message}`;
    }
  }

  let blob;
  try {
    blob = await fetchJson("/api/extension/filter");
  } catch (e) {
    return `download failed: ${e.message}`;
  }
  if (!blob || !blob.bits || !blob.m || !blob.k) return "malformed";

  try {
    await chrome.storage.local.set({
      [KEY]: {
        bits: blob.bits,
        m: blob.m,
        k: blob.k,
        n: blob.n,
        p: blob.p,
        version: blob.version,
        built_at: blob.built_at,
        stored_at: Date.now() / 1000,
      },
    });
  } catch (e) {
    return `store failed: ${e.message}`;
  }
  memo = null;                          // force a re-read at the next question
  return "updated";
}

// One alarm, and one alarm only.
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: REFRESH_MINUTES });
  refresh(true);
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: REFRESH_MINUTES });
  refresh(false);
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) refresh(false);
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || msg.type !== "tnega-member") return false;

  (async () => {
    const f = await load();
    if (!f) {
      // No list yet. Say so rather than saying "not covered": the caller draws
      // a different thing for "we have not loaded the list" than for "this is
      // not something we measure", and collapsing the two would put a false
      // negative on screen as though it were a finding.
      //
      // One refresh attempt is kicked off so that a first page view after
      // install eventually works without the reader doing anything, but the
      // answer to THIS question is still "unknown".
      refresh(false);
      respond({ ok: false, reason: "no_filter" });
      return;
    }
    const hits = {};
    for (const key of msg.keys || []) {
      hits[key] = await TnegaFilter.member(f.bits, f.m, f.k, key);
    }
    respond({
      ok: true,
      hits,
      version: f.version,
      built_at: f.built_at,
    });
  })();

  return true;                          // an async respond needs this
});
