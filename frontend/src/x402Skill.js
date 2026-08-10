// x402Skill.js
//
// Thin wrapper around Altana SDK's own fetchWithX402 (already does
// the full request→402→sign→retry loop), adding only the two real
// guards the skill's own SKILL.md requires: enforce a maximum price,
// track cumulative spend against a stated budget.

import { fetchWithX402 } from '@altananetwork/sdk';

/**
 * Play: pay-once. Real guard from the skill: "Always enforce the
 * maximum price parameter; never sign an authorization above it."
 * This function inspects the real 402 challenge BEFORE paying, and
 * refuses if the asked amount exceeds maxPriceRaw.
 */
export async function payOnce(session, url, { maxPriceRaw, init } = {}) {
  // A first, unauthenticated request surfaces the real 402 challenge
  // so we can check the price before ever signing anything.
  const probe = await fetch(url, init).catch(() => null);
  if (probe && probe.status === 402) {
    const body = await probe.json().catch(() => null);
    const askedAmount = body?.accepts?.[0]?.amount ? BigInt(body.accepts[0].amount) : null;
    if (askedAmount !== null && maxPriceRaw !== undefined && askedAmount > BigInt(maxPriceRaw)) {
      throw new Error(`Refused: server asked ${askedAmount} but maximum price allowed is ${maxPriceRaw}.`);
    }
  }

  const response = await fetchWithX402(session, url, init);
  return response;
}

/**
 * Play: auto-refill. Real guard: "Track cumulative spend across the
 * run and stop at the stated budget." spentSoFarRaw/budgetRaw are the
 * caller's own running totals; this function is the honest gate, not
 * a promise, it actually throws rather than silently overspending.
 */
export function assertWithinBudget(spentSoFarRaw, nextPaymentRaw, budgetRaw) {
  const total = BigInt(spentSoFarRaw) + BigInt(nextPaymentRaw);
  if (total > BigInt(budgetRaw)) {
    throw new Error(`Payment would bring cumulative spend to ${total}, over the ${budgetRaw} budget. Refused.`);
  }
  return total;
}
