// budgetLimits.js
//
// The floor under the two settings that decide how much of a budget an agent
// can take before its client can react.
//
// Kept out of the panel so web and mobile cannot drift, and so the rules can
// be checked by test/budgetSpent/spent-is-not-delivery.js without mounting a
// component.
//
// WHY THESE ARE REFUSALS AND NOT WARNINGS
// ---------------------------------------
// AgentBudgetEscrow permits maxPerDraw = 0 (no per-draw ceiling) and
// cooldown = 0 (no wait between draws). The contract is right to permit both:
// it does not know what a client meant. This form does, and the combination
// is a budget an agent empties in one transaction.
//
// It is also not hypothetical. Read back from the BSC contract at
// 0x4728f03693DDABbe50E79c7BfFCb930e522D585B:
//
//   budget 1: total 2e14, maxPerDraw 1e14, cooldown 0
//   budget 2: total 1e14, maxPerDraw 1e14, cooldown 0
//
// Both were opened through this form with no wait between draws, and budget
// 2's per-draw ceiling equals its total, so one draw could take all of it.
// That is the configuration these floors exist to refuse, and it is in the
// live record rather than in a threat model.
//
// Budget 3, opened later with cooldown 3600 and maxPerDraw at a tenth of the
// total, is what the defaults produce and passes unchanged.
//
// THE REASONING BEHIND THE NUMBERS
// --------------------------------
// reclaim() is the client's only counter to the agent's spend authority, and
// it recovers only what has not been drawn. So reclaim is worth something
// exactly to the degree that the client gets a turn between draws. The
// cooldown is what gives them that turn: it IS the review window, and
// maxPerDraw is the client's maximum exposure per window.
//
// MIN_COOLDOWN_SECONDS = 60. Below a minute a client has no turn at all. The
// escrow is deployed on chains whose blocks land in well under a second
// (BNB 56, Arbitrum 42161, Robinhood 4663) and on Ethereum at roughly twelve,
// so anything shorter than a minute is consumed by noticing, signing and
// waiting for one's own reclaim to be mined. A minute is the smallest value
// at which the window is a window rather than a formality. It is not a long
// wait for an agent: a draw funds a step of work, not a heartbeat.
//
// MAX_PER_DRAW_SHARE_OF_TOTAL = 0.5. A per-draw ceiling equal to the total is
// a ceiling only on paper: a single draw still takes everything.
//
// An earlier version of this comment said the cooldown "never gets to apply"
// in that case, which is wrong. `openBudget` seeds `lastDrawAt` with
// `block.timestamp`, so the cooldown DOES apply once, before the first draw.
// What it cannot do is make that draw smaller. With maxPerDraw equal to the
// total and a cooldown of an hour, the agent waits an hour and then takes
// everything in one transaction. The client's window is the hour before
// anything has happened, and there is no window after they have seen
// anything happen. Live BSC budget 2 is in exactly that state: total 1e14,
// maxPerDraw 1e14.
//
// Capping a draw at half the total forces at least two draws, so the client
// gets a second window that opens AFTER a draw they can look at. Half is the
// loosest setting that still gives them that.
//
// This one is a refusal the client may dismiss, unlike the two above.
// "Buy me this one item, here is exactly what it costs" is a legitimate
// budget, and both ways around the cap are worse than allowing it: inflating
// the total to make the fraction fit doubles the client's maximum loss, and
// splitting an atomic purchase across two draws a minute apart may not be
// possible at all. So it stays expressible, but it has to be chosen rather
// than arrived at.

/** Shortest wait between draws this form will open a budget with. */
export const MIN_COOLDOWN_SECONDS = 60;

/** Largest share of the total a single draw may be allowed to take. */
export const MAX_PER_DRAW_SHARE_OF_TOTAL = 0.5;

/** The wait-between-draws choices offered. No zero option: a control that can
 *  reach a refused value is a control that invites the refusal. */
export const COOLDOWN_CHOICES = [
  { label: '1 min', value: 60 },
  { label: '10 min', value: 600 },
  { label: '1 hour', value: 3600 },
  { label: '6 hours', value: 21600 },
];

/**
 * Check the settings a client is about to fund with.
 *
 * Returns null when the budget may be opened, or a refusal otherwise:
 *
 *   { field, message, acknowledgeable, acknowledgement? }
 *
 * `acknowledgeable` false is a hard stop with no way past it. True means the
 * client may proceed by passing `acknowledgedSingleDraw`, and
 * `acknowledgement` is the sentence they are agreeing to. That sentence
 * states what the setting permits rather than warning that it is risky: a
 * client buying one fixed-price thing is not doing anything wrong, and a
 * warning they have to click past to do a reasonable thing teaches them to
 * click past warnings.
 *
 * The hard refusals are checked first, so a dismissible one can never stand
 * in front of one that is not.
 *
 * Amounts are bigint wei so this never rounds anyone's budget on the way to
 * judging it.
 */
export function checkBudgetLimits({
  totalWei,
  maxPerDrawWei,
  cooldownSeconds,
  acknowledgedSingleDraw = false,
}) {
  if (typeof totalWei !== 'bigint' || totalWei <= 0n) {
    return { field: 'total', message: 'Enter a total budget.', acknowledgeable: false };
  }

  if (typeof maxPerDrawWei !== 'bigint' || maxPerDrawWei <= 0n) {
    return {
      field: 'maxPerDraw',
      acknowledgeable: false,
      message: 'Set a per-draw limit above zero. Left at zero the contract applies no '
        + 'ceiling to a single draw, so the agent can take the whole budget in one '
        + 'transaction. A wait between draws does not change that: it delays the first '
        + 'draw without limiting its size.',
    };
  }

  if (maxPerDrawWei > totalWei) {
    return {
      field: 'maxPerDraw',
      message: 'The per-draw limit cannot exceed the total.',
      acknowledgeable: false,
    };
  }

  if (!Number.isFinite(cooldownSeconds) || cooldownSeconds < MIN_COOLDOWN_SECONDS) {
    return {
      field: 'cooldown',
      acknowledgeable: false,
      message: `Set a wait of at least ${MIN_COOLDOWN_SECONDS} seconds between draws. `
        + 'With no wait the agent can draw again in the same block, so taking back what '
        + 'is left is a race you are unlikely to win.',
    };
  }

  // Strictly greater than half, so exactly half passes and two draws are
  // always required. Last, and dismissible, for the reasons in the header.
  if (maxPerDrawWei * 2n > totalWei && !acknowledgedSingleDraw) {
    return {
      field: 'maxPerDraw',
      acknowledgeable: true,
      message: 'This per-draw limit lets the agent take the whole budget in one draw. '
        + 'Keep it at or below half the total if you want a second look before the '
        + 'money can all be gone.',
      acknowledgement: 'I understand the agent can take this entire budget in a single '
        + 'transaction. The wait between draws applies once, before the first draw, so it '
        + 'delays that transaction without making it smaller: after waiting, the agent can '
        + 'draw everything. My only chance to take the money back is before that first draw.',
    };
  }

  return null;
}
