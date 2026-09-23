// budgetDelivery.js
//
// The one place the app is allowed to turn an AgentBudgetEscrow budget into a
// number a buyer reads, and the reason no such number may come from `spent`.
//
// WHY THIS MODULE EXISTS
// ----------------------
// reclaim() pays the client back the undrawn remainder, and before it does it
// writes:
//
//     b.spent = b.total;
//
// That write is the effects-before-interaction step that makes a second
// reclaim impossible. It is correct in the contract and it is a trap for
// every reader: after a reclaim, `spent == total` whether the agent drew
// everything or drew nothing at all.
//
// Two live budgets are in that state, and they are on two different chains,
// read back 2026-09-23:
//
//   BSC budget 2:       total 1e14, spent 1e14, RECLAIMED, never drawn
//   Robinhood budget 1: total 7e12, spent 7e12, RECLAIMED, never drawn
//
// BSC budget 1 also reads spent == total, but that one WAS drawn from, so its
// figure is part genuine draws and part reclaim overwrite. That is the worse
// case for a reader rather than the better one: the field gives the same
// answer for a budget worked through to the end and a budget handed straight
// back, and nothing in it says which happened.
//
// Five budgets exist in all, across three chains: three on BSC, one on
// Arbitrum, one on Robinhood Chain. Ethereum's budgetCounter is 0, so the
// contract is deployed on four chains but has held budgets on only three.
//
// So a progress bar, a percentage, a "delivered" figure or any completion
// signal computed from `spent` is wrong, and it is wrong in the direction
// that flatters the agent: it shows a budget the client took back in full as
// a budget worked through to the end.
//
// The rule, which is why these functions are named the way they are:
//
//   `spent` describes money movement, and only while the budget has not been
//   reclaimed. Delivery is countable from Drawn events and from nothing else.
//
// Nothing in this module returns a delivery figure derived from `spent`, and
// there is no argument that would make one correct. If a caller needs to say
// how much work an agent did, it needs the Drawn stream, which is what
// drawCount() takes. test/budgetSpent/spent-is-not-delivery.js fails if a
// percentage, a bar width or a delivery word is derived from `spent`
// anywhere outside this file.

/** What the contract's `spent` field is actually reporting, per status. */
export const SPENT_MEANING = {
  /** The running total of draws. Truthful. */
  DRAWN: 'drawn',
  /** reclaim() set it to `total` on the way out. Says nothing about draws. */
  OVERWRITTEN_BY_RECLAIM: 'overwritten-by-reclaim',
};

const RECLAIMED = 3;

function statusOf(budget) {
  return Number(budget?.status ?? -1);
}

/**
 * Read `spent` with its meaning attached, so a caller cannot pick up the
 * number without the caveat.
 *
 * `amount` is always the raw field, because a balance still has to render
 * correctly. `meaning` is what a caller has to branch on before putting a
 * word next to it.
 */
export function spentReading(budget) {
  const amount = budget?.spent ?? 0n;
  const overwritten = statusOf(budget) === RECLAIMED;
  return {
    amount,
    meaning: overwritten ? SPENT_MEANING.OVERWRITTEN_BY_RECLAIM : SPENT_MEANING.DRAWN,
    /** Stated rather than implied, so a reader of this object cannot mistake it. */
    describesDelivery: false,
    /** Safe to put the word "drawn" next to this number. */
    describesDraws: !overwritten,
  };
}

/**
 * How far through the money a budget is, as a percentage, for a bar that is
 * about money and says so.
 *
 * Returns null when the number cannot describe money movement, which is every
 * reclaimed budget. A null here means draw no bar. It deliberately does not
 * fall back to 0 or to 100: both are a claim, and neither is supported.
 */
export function moneyDrawnPercent(budget) {
  const { amount, describesDraws } = spentReading(budget);
  if (!describesDraws) return null;
  const total = budget?.total ?? 0n;
  if (total <= 0n) return null;
  return Number((amount * 100n) / total);
}

/**
 * How many times the agent drew. The only delivery-shaped count this module
 * offers, and it takes Drawn events rather than a budget, because that is the
 * only source a reclaim cannot overwrite.
 *
 * It still is not delivery in the sense of work received. A draw records that
 * the agent took money, not that anything arrived. It is the closest fact the
 * chain holds, and the ceiling on what may be claimed from it.
 */
export function drawCount(draws) {
  return Array.isArray(draws) ? draws.length : 0;
}

/**
 * Did this agent ever draw against this budget? Counted from the Drawn feed,
 * never from `spent > 0`, which a reclaim makes true for free.
 */
export function wasEverDrawnFrom(draws) {
  return drawCount(draws) > 0;
}
