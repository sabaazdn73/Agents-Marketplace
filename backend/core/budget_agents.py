# budget_agents.py
#
# Which agents can actually be hired with a drawable budget.
#
# This exists because deploying AgentBudgetEscrow created a real dead end:
# the contract went live, the UI offered budget mode for every agent, and
# NO registered agent knows how to call draw(). A buyer could fund a budget
# that nothing on earth could draw against, then pay gas to revoke it. The
# money was recoverable, but the whole interaction was a waste and the UI
# was implicitly promising a capability that did not exist.
#
# So availability is per-AGENT, not per-contract. "The escrow is deployed"
# and "this agent can use it" are different facts, and only the second one
# should put a fund button in front of someone.
#
# An agent belongs here only on real evidence that it implements the draw
# pattern. Today that is exactly one: our own reference implementation.
# It is labelled as such everywhere it surfaces -- it is a worked example
# of the pattern, NOT a third party who adopted it, and presenting one as
# the other would be the same dishonesty as a fabricated review.
#
# When a real third-party agent implements draw(), it gets added here with
# a note on how that was confirmed -- ideally a real draw observed on-chain
# from its own address, not a claim in its metadata.

from __future__ import annotations

import os

# The reference agent's on-chain address. Set once the reference service is
# deployed with its own wallet; until then budget mode has no eligible
# agent at all, which is the honest state rather than a hidden one.
REFERENCE_AGENT_ADDRESS = (os.environ.get("REFERENCE_AGENT_ADDRESS") or "").strip()


def _reference_entry() -> dict | None:
    if not REFERENCE_AGENT_ADDRESS.lower().startswith("0x") or len(REFERENCE_AGENT_ADDRESS) != 42:
        return None
    return {
        "address": REFERENCE_AGENT_ADDRESS,
        "name": "Tnega Reference Agent",
        # Surfaced in the UI verbatim. The point is that nobody can mistake
        # this for organic adoption.
        "kind": "reference_implementation",
        "label": "Reference implementation — built by Tnega, not a third-party agent",
        "what_it_does": (
            "Runs a real wallet due-diligence report using paid API quota, and draws "
            "from the budget to cover what each call actually costs. It exists to show "
            "the draw pattern working end to end."
        ),
        "confirmed_by": "Built in this repo; see reference-agent/.",
    }


def draw_capable_agents() -> list[dict]:
    """Every agent known to implement draw(). Possibly empty -- and an empty
    list is a real answer that the UI must render as "no agent supports this
    yet", never as a reason to hide the distinction."""
    entry = _reference_entry()
    return [entry] if entry else []


def is_draw_capable(owner_address: str | None) -> bool:
    addr = (owner_address or "").strip().lower()
    if not addr:
        return False
    return any(a["address"].lower() == addr for a in draw_capable_agents())


def budget_mode_status(owner_address: str | None = None) -> dict:
    """Whether budget mode can honestly be offered, and if not, why.

    Kept as one function so every surface gives the same answer: the reason
    a buyer cannot use budget mode should not depend on which page they are
    standing on."""
    agents = draw_capable_agents()
    if not agents:
        return {
            "available": False,
            "reason": (
                "No agent supports drawable budgets yet. The escrow contract is live, but "
                "funding a budget would create one no agent could draw from."
            ),
            "draw_capable_count": 0,
            "agents": [],
        }
    if owner_address is not None and not is_draw_capable(owner_address):
        return {
            "available": False,
            "reason": (
                "This agent doesn't support drawable budgets. It can be hired with locked "
                "escrow instead."
            ),
            "draw_capable_count": len(agents),
            "agents": agents,
        }
    return {
        "available": True,
        "reason": "",
        "draw_capable_count": len(agents),
        "agents": agents,
    }
