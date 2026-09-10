// interactionCopy.js
//
// The one place the "how you actually use this agent" sentence is written.
//
// The backend decides WHICH sentence applies, from signals it already
// computes, and sends a short code. The wording lives here, in one file, so
// the card in the list and the agent's own page cannot drift apart. It also
// keeps a ~90 character sentence out of a list payload that repeats it across
// thousands of agents, on a path with a documented memory ceiling.
//
// Written for someone who has never used any of this. The test for every line
// below: could a person who does not know what escrow, a protocol or a chain
// is read this and know what to do next.
//
// Two things these sentences deliberately never do.
//
// They never assert quality. Every line describes the MECHANISM of using an
// agent, not whether it is any good. That is what lets "You can hire it here"
// sit next to a tier of unproven without contradicting it: one says how you
// would pay, the other says whether it has ever delivered.
//
// They never guess. When the signals do not settle it, the line says so.
// "We have not been able to check this agent yet" is more use to a reader
// than a plausible story, and it is the honest answer.

const COPY = {
  no_endpoint: {
    line: 'Nothing is published about how to reach this agent, so there is no way to use it from here.',
  },
  not_responding: {
    line: 'Its address does not answer at the moment, so there is no way to reach it right now.',
  },
  unchecked: {
    line: 'We have not been able to check this agent yet, so we cannot say how it is meant to be used.',
  },
  saas_elsewhere: {
    line: 'This one runs as its own service. You would sign up on their own site rather than hire it here.',
  },
  needs_operator_login: {
    line: 'It needs a login issued by whoever runs it, which this marketplace does not have, so it cannot be hired here.',
  },
  different_protocol: {
    line: 'Its address answers, but not in a way this marketplace can hire through.',
    // Only when the agent genuinely offers the alternative. Shown as a second
    // line because it changes what the reader can do next, which is the bar
    // for adding one at all.
    x402: 'It does take direct pay-per-use payments, which you would arrange with its owner.',
  },
  hire_escrow: {
    line: 'You can hire it here, and your payment is held until it delivers.',
    detail: 'If it never delivers, you take the money back yourself.',
  },
  fund_budget: {
    line: 'You can fund a budget here and it draws from that as it works.',
    detail: 'Nothing leaves your wallet until it draws, and you can take back whatever is left.',
  },
  running_no_hire_path: {
    line: 'It is running, but it is on a chain this marketplace cannot hire on, so you would use it directly with its owner.',
  },
};

/**
 * The sentence for an agent's interaction result.
 *
 * `interaction` is what the API attached: { code, offers_x402? }.
 * Returns { line, detail } or null when there is nothing to say, so a caller
 * renders nothing rather than a placeholder.
 *
 * An unrecognised code returns null rather than a guess. A code this file has
 * not been taught is a deployment mismatch, and inventing a sentence for it
 * would be exactly the guessing these lines are supposed to avoid.
 */
export function interactionCopy(interaction, { deliveredCount = 0 } = {}) {
  let code = interaction?.code;
  if (!code) return null;

  // DELIVERY BEATS THE PROBE.
  //
  // The backend decides from an endpoint probe, which is inference. A
  // completed on-chain job is proof. When an agent has actually delivered
  // through escrow, it demonstrably can be hired here, whatever its endpoint
  // said when it was probed.
  //
  // Caught in the browser before this shipped: three agents showed the
  // "Verified working" tier and "1 hire, 100% success" while the line under
  // them read "you would sign up on their own site rather than hire it here".
  // Both cannot be true, and the one backed by a settled payment is the one
  // that stands. Without this rule the line would contradict the card it sits
  // on, which is the thing these sentences must never do.
  if (deliveredCount > 0 && code !== 'hire_escrow') {
    code = 'hire_escrow';
  }
  const entry = COPY[code];
  if (!entry) return null;

  const detail = code === 'different_protocol' && interaction.offers_x402
    ? entry.x402
    : entry.detail || null;

  return { line: entry.line, detail };
}

export const INTERACTION_CODES = Object.keys(COPY);
