# budget_agents.py
#
# Which agents can actually be hired with a drawable budget.
#
# This exists because deploying AgentBudgetEscrow created a dead end:
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
# An agent belongs here only on evidence that it implements the draw
# pattern. Today that is exactly one: our own reference implementation.
# It is labelled as such everywhere it surfaces -- it is a worked example
# of the pattern, NOT a third party who adopted it, and presenting one as
# the other would be the same dishonesty as a fabricated review.
#
# When a third-party agent implements draw(), it gets added here with
# a note on how that was confirmed -- ideally a draw observed on-chain
# from its own address, not a claim in its metadata.

from __future__ import annotations

import os

# Addresses allowed to be hired with a drawable budget.
#
# Accepts either a single address or a comma-separated list, so an
# environment already set to one address keeps working unchanged:
#
#   REFERENCE_AGENT_ADDRESS=0xabc...
#   REFERENCE_AGENT_ADDRESS=0xabc...,0xdef...
#
# BUDGET_AGENT_ADDRESSES is the clearer name for a list and is read first;
# REFERENCE_AGENT_ADDRESS stays supported because it is what is already
# deployed. Both are parsed the same way.
#
# An address belongs here only on evidence that it implements draw(). The
# strongest evidence is a draw observed on-chain from that address, not a
# claim in an agent's metadata. See docs/budget-integration.md for what an
# integrator has to build before being added.
_ADDRESS_ENV_VARS = ("BUDGET_AGENT_ADDRESSES", "REFERENCE_AGENT_ADDRESS")

# The one entry Tnega itself provides. Labelled as a reference
# implementation wherever it surfaces, since one worked example written by
# us is not third-party adoption and must never read as if it were.
REFERENCE_AGENT_LABEL = "Reference implementation, built by Tnega, not a third-party agent"
REFERENCE_AGENT_WHAT = (
    "Runs a wallet due-diligence report using paid API quota, and draws from the budget "
    "to cover what each call costs. It exists to show the draw pattern working end to end."
)


def _is_evm_address(value: str) -> bool:
    return len(value) == 42 and value.lower().startswith("0x")


def configured_addresses() -> list[str]:
    """Every configured address, de-duplicated, order preserved.

    Anything that is not a plausible EVM address is dropped rather than
    passed through: a typo should mean "this agent is not budget-capable",
    which is the safe direction, instead of a value that can never match
    but still makes the list look populated.
    """
    seen: set[str] = set()
    out: list[str] = []
    for var in _ADDRESS_ENV_VARS:
        raw = os.environ.get(var) or ""
        for part in raw.split(","):
            addr = part.strip()
            if not addr or not _is_evm_address(addr):
                continue
            if addr.lower() in seen:
                continue
            seen.add(addr.lower())
            out.append(addr)
    return out


# Kept for callers and tests that referred to the single-address form.
REFERENCE_AGENT_ADDRESS = (os.environ.get("REFERENCE_AGENT_ADDRESS") or "").strip()


def _entry(address: str, index: int) -> dict:
    """One draw-capable agent. The first configured address is Tnega's own
    reference implementation; anything after it is a third-party integrator
    and is described as such rather than borrowing the reference label."""
    if index == 0:
        return {
            "address": address,
            "name": "Tnega Reference Agent",
            "kind": "reference_implementation",
            "label": REFERENCE_AGENT_LABEL,
            "what_it_does": REFERENCE_AGENT_WHAT,
            "confirmed_by": "Built in this repo; see reference-agent/.",
        }
    return {
        "address": address,
        "name": f"Budget-capable agent {address[:6]}…{address[-4:]}",
        "kind": "third_party",
        "label": "Supports drawable budgets",
        "what_it_does": "Implements draw() against AgentBudgetEscrow.",
        "confirmed_by": "Added to the draw-capable list after its integration was checked.",
    }


def draw_capable_agents() -> list[dict]:
    """Every agent known to implement draw(). Possibly empty, and an empty
    list is an answer the UI must render as "no agent supports this yet"
    rather than hiding the distinction."""
    return [_entry(a, i) for i, a in enumerate(configured_addresses())]


def is_draw_capable(owner_address: str | None) -> bool:
    addr = (owner_address or "").strip().lower()
    if not addr:
        return False
    return any(a["address"].lower() == addr for a in draw_capable_agents())


def budget_mode_status(owner_address: str | None = None, *, for_agent: bool = True) -> dict:
    """Whether budget mode can be offered for an agent, and what to warn about.

    This used to block any agent not on the capable list. That was too
    strict. The contract puts no restriction on who can be named as the
    agent on a budget, so the allowlist was our decision made on the
    client's behalf, and it locked out exactly the agents the model exists
    for: ones that need funds mid-job but had not told us so.

    The dead end it guarded against is also not permanent. If the agent
    never calls draw, nothing is spent and the client can reclaim the whole
    amount at any time. The worst case is money sitting idle until they do,
    not money lost.

    So availability now follows what the contract allows: any agent with a
    resolvable owner address. `declared` carries the part we actually know,
    and the UI turns that into a warning rather than a closed door.
    """
    agents = draw_capable_agents()
    declared = is_draw_capable(owner_address) if for_agent else bool(agents)

    if for_agent and not _is_evm_address((owner_address or "").strip()):
        # Still a hard no, and the only one left. Without an address there
        # is nobody to name as the agent, and openBudget would reject it.
        return {
            "available": False,
            "declared": False,
            "reason": (
                "This agent has no owner address on record, so there's no address to fund "
                "a budget against."
            ),
            "draw_capable_count": len(agents),
            "agents": agents,
        }

    return {
        "available": True,
        # True: the agent's developer told us it implements draw().
        # False: we don't know either way. Not the same as "it can't".
        "declared": declared,
        "reason": "",
        "draw_capable_count": len(agents),
        "agents": agents,
    }
