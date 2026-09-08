// commerceNotifications.js
//
// Maps a commerce pipeline result onto the existing notification centre.
//
// Reuses addNotification from notifications.js rather than adding a second
// mechanism, so these land in the same bell as hire and draw notifications
// and are marked read by the same control.
//
// SCOPE, STATED HONESTLY: there is no commerce UI yet -- this pass is
// endpoint-only. This module is the integration point for that UI, and
// nothing in the app calls it today. It is here rather than in the next
// pass because the mapping is the part that needs to be right (which
// outcomes deserve a notification, and which must NOT be reported as
// success), and that is worth settling while the pipeline semantics are
// fresh.
//
// WHAT DELIBERATELY DOES NOT NOTIFY AS SUCCESS
// --------------------------------------------
// 'handoff_required' means the cart is ready and the buyer still has to pay.
// 'indeterminate' means a settle was attempted and its outcome is unknown.
// Neither is a purchase, and both are worded so nobody reads them as one.
// Only 'settled' says money moved.
//
// One caveat inherited from notifications.js: it is localStorage-backed, so
// these are per-browser and do not follow a user to another device. Fine for
// progress pings; it is not a record of payment, and the on-chain
// transaction remains the only authority for that.

import { addNotification } from './notifications';

/** Notify on the outcome of one pipeline run.
 *
 * @param {object} result  the /api/commerce/run response body
 * @returns {number} how many notifications were raised
 */
export function notifyPipelineResult(result) {
  if (!result || typeof result !== 'object') return 0;
  const stages = Array.isArray(result.stages) ? result.stages : [];
  const findings = Array.isArray(result.findings) ? result.findings : [];
  let raised = 0;

  const halted = stages.find((s) => s.stage === 'pipeline' && s.status === 'halted');
  const payment = stages.find((s) => s.stage === 'payment');

  // QA blocked it. The findings are the message -- a generic "review failed"
  // would send someone back to the terminal to find out why.
  if (findings.length > 0) {
    const lines = findings.slice(0, 3).map((f) => `• ${f.detail}`).join('\n');
    const more = findings.length > 3 ? `\n…and ${findings.length - 3} more.` : '';
    addNotification(
      `Purchase blocked: ${findings.length} problem${findings.length === 1 ? '' : 's'} found`,
      `Nothing was charged.\n${lines}${more}`,
    );
    return 1;
  }

  if (payment) {
    const p = payment.data || {};
    if (p.status === 'settled') {
      addNotification(
        'Payment settled',
        `Paid via ${p.rail}.${p.reference ? ` Reference ${p.reference}.` : ''}`,
      );
      raised += 1;
    } else if (p.status === 'handoff_required') {
      // Explicitly not a purchase.
      addNotification(
        'Your cart is ready to check out',
        `Nothing has been paid yet — you complete the purchase yourself.${
          p.checkout_url ? ` Open: ${p.checkout_url}` : ''
        }`,
      );
      raised += 1;
    } else if (p.status === 'indeterminate') {
      addNotification(
        'Payment outcome unknown — check before retrying',
        `${p.detail || 'The settlement result could not be confirmed.'} It was NOT retried automatically, `
        + 'because retrying an ambiguous payment can charge you twice.',
      );
      raised += 1;
    } else if (payment.status === 'error') {
      addNotification('Payment did not go through', `${payment.note || 'Unknown error.'} Nothing was charged.`);
      raised += 1;
    }
    return raised;
  }

  // Halted before payment. Names the stage, which is the whole point of the
  // pipeline being split into stages.
  if (halted) {
    const at = halted.data?.halted_at || 'an earlier stage';
    const stage = stages.find((s) => s.stage === at);
    addNotification(
      `Stopped at ${at}`,
      `${stage?.note || halted.note || ''} Nothing was charged.`,
    );
    raised += 1;
  }
  return raised;
}
