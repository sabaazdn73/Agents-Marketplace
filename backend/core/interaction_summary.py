"""
interaction_summary.py

One plain sentence per agent saying how a person actually interacts with it.

Why this exists: someone looking at an agent cannot tell whether it is
something they hire here, something they sign up for elsewhere, or something
that does not work at all. Working that out per agent by hand is exactly what
this marketplace is supposed to save them from. Everything needed is already
computed; this is a translation of what is known, not a new signal.

Written for someone who does not know what any of this means. No jargon, no
tier label, no status word standing in for a sentence.

Three rules, in order of importance:

  1. NEVER GUESS. When the signals do not add up to one answer, say that.
     "We could not work out how this agent is meant to be used" is a useful
     sentence and an honest one. Picking the most likely story is not.

  2. NEVER CONTRADICT THE REST OF THE CARD. These sentences describe the
     MECHANISM of interacting with an agent, never whether it is any good.
     "You can hire it here" and a tier of unproven are both true at once:
     one is about how you would pay, the other about whether it has ever
     delivered. No sentence here asserts quality, so none can disagree with
     a tier.

  3. ONE LINE. A second only when it genuinely adds something, such as a
     cost or an extra step.

The signals used, all of which already exist:

  service_status                     from the live health check
  escrow_compat_incompatible         hard protocol rejection, a SaaS product
  escrow_compat_auth_gated           a real 401/403, needs operator credentials
  escrow_compat_different_protocol   live API that does not speak A2A
  escrow_compat_offers_x402          offers pay-per-call as an alternative
  chain_id                           against the chains each hire path covers

Deliberately NOT used: total_score, star_count, feedback counts. Those are
reputation, and this sentence is not about reputation.
"""
from __future__ import annotations

# The codes this returns. The SENTENCES live in
# frontend/src/interactionCopy.js, in one place, and the payload carries only
# the code.
#
# Two reasons. The list endpoint for BNB Chain reads a deliberately narrow
# projection because this path has a documented memory ceiling (see
# _EXCLUDE_FIELDS in core/agent_store.py); a ~90 character sentence per agent
# would have added over a megabyte to it, for text that is identical across
# thousands of agents. And keeping the wording in exactly one file is what
# guarantees the card and the agent's own page say the same thing.
CODES = (
    "no_endpoint",
    "not_responding",
    "unchecked",
    "saas_elsewhere",
    "needs_operator_login",
    "different_protocol",
    "hire_escrow",
    "fund_budget",
    "running_no_hire_path",
)


def describe_interaction(
    agent: dict,
    *,
    budget_chain_ids: tuple[int, ...] = (),
    escrow_chain_ids: tuple[int, ...] = (),
) -> dict:
    """Which interaction code describes this agent, and why.

    Returns {"code": str, "basis": str, ...}. `basis` names the signal that
    decided it, so a wrong sentence can be traced back to the signal that
    produced it instead of guessed at. The sentence itself is looked up from
    the code in frontend/src/interactionCopy.js.
    """
    status = agent.get("service_status")
    chain_id = agent.get("chain_id")
    can_budget = chain_id in budget_chain_ids
    can_escrow = chain_id in escrow_chain_ids

    # Reachability first. None of the hire paths mean anything if there is
    # nothing at the other end, so this outranks every other signal.
    if status == "no_endpoint":
        return {"code": "no_endpoint", "basis": "service_status=no_endpoint"}

    if status == "not_responding":
        return {"code": "not_responding", "basis": "service_status=not_responding"}

    if status in (None, "unknown"):
        # Genuinely unchecked, or the check itself failed. Both mean we do
        # not know, and neither means the agent is broken.
        return {"code": "unchecked", "basis": f"service_status={status!r}"}

    # From here the endpoint answered. What it answered WITH decides the rest.
    #
    # ORDER MATTERS, and it is the specific flags first. escrow_compat_
    # incompatible is the umbrella "cannot be hired through escrow"; auth_gated
    # and different_protocol are refinements that say WHY, and an agent carries
    # the umbrella alongside its refinement. See core/protocol_compat.py, which
    # introduced both precisely because the plain boolean was collapsing
    # distinct states into itself.
    #
    # Caught while sampling real agents 2026-09-10: with the umbrella checked
    # first, Q402 by Quack AI, a live JSON API and the documented example of
    # different_protocol, was described as a service you sign up for elsewhere.
    # That was wrong about what the agent is, and it is the exact conflation
    # protocol_compat.py exists to prevent.
    if agent.get("escrow_compat_auth_gated") is True:
        return {"code": "needs_operator_login", "basis": "escrow_compat_auth_gated"}

    if agent.get("escrow_compat_different_protocol") is True:
        return {
            "code": "different_protocol",
            "offers_x402": agent.get("escrow_compat_offers_x402") is True,
            "basis": "escrow_compat_different_protocol",
        }

    if agent.get("escrow_compat_incompatible") is True:
        return {"code": "saas_elsewhere", "basis": "escrow_compat_incompatible"}

    # Answering, and nothing found against it. Which hire path is offered
    # depends on the chain, and the two are genuinely different bargains.
    if can_escrow:
        return {"code": "hire_escrow", "basis": "responding, escrow chain"}

    if can_budget:
        return {"code": "fund_budget", "basis": "responding, budget chain"}

    # Answering, but on a chain neither hire path covers. Real, and worth
    # saying plainly rather than leaving the reader to infer it.
    return {"code": "running_no_hire_path", "basis": "responding, no hire path on this chain"}
