// jobTiming.js
//
// Real timing data for the live "waiting" view in JobStatusPanel.jsx — see
// that file's own header comment for the full honest investigation. Two
// separate, real concerns live here:
//
// 1. When was a job ACTUALLY funded? The on-chain job struct has no
//    fundedAt/createdAt field (only expiredAt and submittedAt — confirmed
//    against the real ABI in erc8183.js), so there is no general on-chain
//    source for this. We record the REAL moment ourselves, the instant a
//    hire we personally drove succeeds (all 3 hire-completion call sites:
//    AgentMarketplaceApp.web.jsx, AgentMarketplaceApp.mobile.jsx,
//    AltanaSessionPanel.jsx), persisted to localStorage so it survives
//    reloads. For a job this browser never funded (opened from elsewhere,
//    or hired before this shipped), we honestly fall back to "the first
//    time this device saw it as FUNDED" — also persisted (not reset per
//    mount), and the UI must disclose which kind it's showing.
//
// 2. How long does a given agent typically take to deliver? A REAL general
//    average isn't computable from the current on-chain data (same gap:
//    no fundedAt to diff against submittedAt, and no indexed event either
//    — see agent_performance.py's own docstring on why this project
//    deliberately avoids getLogs scans). So this is a small, explicit map
//    of individually, honestly MEASURED delivery times — add an entry only
//    when you have a real number, never a guess.

const FUNDED_AT_KEY = 'aam_job_funded_at_v1';
const FIRST_SEEN_FUNDED_KEY = 'aam_job_first_seen_funded_v1';

function readMap(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function writeMap(key, map) {
  try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* quota/SSR — non-fatal, just no persistence this run */ }
}

/** Call at the exact real moment a hire's fund() call confirms. */
export function recordFunded(jobId, atMs = Date.now()) {
  const m = readMap(FUNDED_AT_KEY);
  m[String(jobId)] = atMs;
  writeMap(FUNDED_AT_KEY, m);
}

function getFundedAt(jobId) {
  return readMap(FUNDED_AT_KEY)[String(jobId)] ?? null;
}

function getOrRecordFirstSeenFunded(jobId, atMs = Date.now()) {
  const m = readMap(FIRST_SEEN_FUNDED_KEY);
  const key = String(jobId);
  if (m[key] == null) {
    m[key] = atMs;
    writeMap(FIRST_SEEN_FUNDED_KEY, m);
    return atMs;
  }
  return m[key];
}

/** The best REAL start-time estimate available for a FUNDED job's elapsed-
 * time display. `precise: true` only when this browser recorded the exact
 * real funding moment; otherwise `precise: false` and `atMs` is a genuine
 * lower bound (first time we happened to look), never fabricated. */
export function getStartEstimate(jobId) {
  const precise = getFundedAt(jobId);
  if (precise != null) return { atMs: precise, precise: true };
  return { atMs: getOrRecordFirstSeenFunded(jobId), precise: false };
}

// Real, individually-measured typical delivery times, keyed by the
// provider's (agent owner's) address, lowercased. NOT a general average —
// see this file's header. Only add a real, actually-observed number here.
const KNOWN_TYPICAL_DELIVERY_SECONDS = {
  // Explainer agent — the real ~60s notify→SUBMITTED delivery time reported
  // in AdvantageReport.jsx's Task 3 (job #56620), the same real measurement,
  // not a separate invented figure.
  '0x08cef8b3ec5d33529dfe6700ccbffc97158cb5dd': {
    seconds: 60,
    sampleSize: 1,
    sourceLabel: '1 past delivery (job #56620)',
  },
};

/** Returns the real, measured typical-delivery entry for this provider
 * address, or null if we genuinely don't have one — callers must not show
 * a progress estimate in the null case, never a guessed default. */
export function getKnownTypicalDelivery(providerAddress) {
  if (!providerAddress) return null;
  return KNOWN_TYPICAL_DELIVERY_SECONDS[providerAddress.toLowerCase()] || null;
}
