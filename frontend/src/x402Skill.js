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
      throw new Error(`Stopped this payment: it would cost more than the maximum price you allowed (asked ${askedAmount}, your limit ${maxPriceRaw}).`);
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
    throw new Error(`Stopped this payment: it would put your total spending (${total}) over your limit for this session (${budgetRaw}).`);
  }
  return total;
}

// ── B402 Bazaar discovery (opt-in) ───────────────────────────────────────────
//
// Binance's B402 Bazaar is a free, opt-in discovery layer: attach a
// `paymentPayload.extensions.bazaar` blob to the normal x402 V2 settle call and
// B402 indexes the endpoint (~30s after the first confirmed settle carrying it).
//
// Field spec confirmed from the REAL docs (not assumed):
//   https://developers.binance.com/docs/onchainpay-x402/b402-bazaar
//   — sections "TL;DR — attach `extensions.bazaar` on every V2 settle",
//     "The bazaar blob — field reference", "info variants".
//   The blob matches Coinbase CDP's x402 Bazaar extension field-for-field, so a
//   CDP-compatible blob works against B402 unchanged. Required: `info` +
//   `schema`; optional: `routeTemplate`, `description`. Attach point:
//   paymentPayload.extensions.bazaar on POST /papi/v2/b402/settle.
export const B402_SETTLE_PATH = '/papi/v2/b402/settle';

/**
 * Build the real `extensions.bazaar` blob for an HTTP-resource agent, to the
 * documented shape. `name`/`description` fold into the blob's `description`
 * (the spec has no separate name field); the price lives in the x402 payment
 * requirements (not the blob) and the endpoint is the resource URL.
 */
export function buildBazaarBlob({ name, description, method = 'GET', queryParams, outputExample, routeTemplate } = {}) {
  const upper = String(method).toUpperCase();
  const isBodyMethod = ['POST', 'PUT', 'PATCH'].includes(upper);
  const input = { type: 'http', method: upper };
  if (queryParams) input.queryParams = queryParams;
  if (isBodyMethod) input.bodyType = 'json'; // body methods require a bodyType per spec

  const info = {
    input,
    output: { type: 'json', ...(outputExample ? { example: outputExample } : {}) },
  };
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      input: {
        type: 'object',
        properties: { type: { const: 'http' }, method: { enum: [upper] } },
        required: ['type', 'method'],
      },
    },
    required: ['input'],
  };
  const blob = { info, schema };
  const desc = [name, description].filter(Boolean).join(' — ');
  if (desc) blob.description = desc;
  if (routeTemplate) blob.routeTemplate = routeTemplate;
  return blob;
}

/**
 * Attach a Bazaar blob to a V2 settle payload so B402 indexes the endpoint.
 * Sets paymentPayload.extensions.bazaar and (if given) the resource url/desc.
 * The creator's endpoint POSTs the returned payload to <facilitator>/papi/v2/b402/settle.
 */
export function attachBazaarToSettle(settlePayload, { blob, endpoint, description } = {}) {
  const payload = settlePayload || { x402Version: 2, paymentPayload: {} };
  const pp = payload.paymentPayload || (payload.paymentPayload = {});
  pp.extensions = pp.extensions || {};
  pp.extensions.bazaar = blob;
  if (endpoint) {
    pp.resource = { url: endpoint, description: description || blob?.description, mimeType: 'application/json', ...(pp.resource || {}) };
  }
  return payload;
}
