// hireDeadline.js
//
// Shared bounds/presets for the third-party hire flow's job deadline —
// useHireAgent.js's hire()/hireBatched() already accept an expiryMinutes
// param (the real window an agent has to submit before the buyer can
// reclaim funds), but nothing in the UI ever surfaced it: both
// AgentMarketplaceApp.web.jsx and .mobile.jsx called hireFn() without it,
// silently defaulting to a hardcoded 65 minutes every time. Fixed
// 2026-09-09 — this file is the one shared source both apps now use so
// the bounds/presets/copy can't drift between them.
//
// Deliberately scoped to third-party agent hiring only. Native Agents and
// Skills (Staking, Trading, Venus, etc.) are atomic, single-transaction
// actions with no delivery/waiting period — there's no real deadline
// concept to add there, and this module is never imported by
// NativeAgentMarketplace.jsx or AltanaSkillsPanel.jsx for that reason.

// Real, honest floor: this project's own one real measured delivery-time
// data point (jobTiming.js's explainer-agent entry, ~60s) is nowhere near
// this — 15 minutes leaves real margin for negotiation, network latency,
// and an agent's own processing time that a bare ~60s number doesn't
// account for, without being so low it invites a doomed-from-creation
// job (see useHireAgent.js's own 2026-08-19 postmortem on exactly that
// failure mode, job #56611).
export const DEADLINE_MIN_MINUTES = 15;

// Real ceiling, anchored to the same real on-chain scale this flow
// already uses elsewhere: OptimisticPolicy's own disputeWindow (7 days,
// read live in useHireAgent.js) is the real order-of-magnitude a buyer
// is already committing to waiting through regardless; 7 days for the
// agent's own submission window matches that scale rather than picking
// an unrelated number.
export const DEADLINE_MAX_MINUTES = 7 * 24 * 60;

// Unchanged from useHireAgent.js's own prior hardcoded default — picking
// this as the starting value means a user who never touches the field
// gets the exact same real behavior this flow already had.
export const DEADLINE_DEFAULT_MINUTES = 65;

export const DEADLINE_PRESETS = [
  { label: '1 hour', minutes: 60 },
  { label: '6 hours', minutes: 360 },
  { label: '24 hours', minutes: 1440 },
  { label: '3 days', minutes: 4320 },
  { label: '7 days', minutes: 10080 },
];

/** Real, plain-language rendering of a minute count — "65 minutes",
 * "6 hours", "3 days" — used for both the preset labels above and any
 * free-typed custom value, so the two never look inconsistent. */
export function formatDeadline(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 60) return `${n} minute${n === 1 ? '' : 's'}`;
  if (n < 1440) {
    const hours = n / 60;
    const rounded = Math.round(hours * 10) / 10;
    return `${rounded} hour${rounded === 1 ? '' : 's'}`;
  }
  const days = n / 1440;
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
}

/** Real validation against the real bounds above — returns a plain,
 * honest error string, or null when the value is fine. Never silently
 * clamps a value the user typed; the UI should show this message and
 * block continuing, not quietly substitute a different number. */
export function validateDeadlineMinutes(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || minutes === '' || minutes == null) {
    return 'Enter how long the agent has to deliver.';
  }
  if (n < DEADLINE_MIN_MINUTES) {
    return `Real minimum: ${DEADLINE_MIN_MINUTES} minutes — anything shorter gives no agent a fair chance to deliver.`;
  }
  if (n > DEADLINE_MAX_MINUTES) {
    return `Real maximum: ${formatDeadline(DEADLINE_MAX_MINUTES)}.`;
  }
  return null;
}
