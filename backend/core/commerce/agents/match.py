# agents/match.py
#
# Picks one service from what API Fit found.
#
# Deterministic where it can be, model backed where it has to reason.
#
# The split is not arbitrary. Price is arithmetic and belongs in code:
# integer base units, compared against a budget, with anything unpriceable
# or over budget removed before a model sees it. Which of the affordable
# options best fits the described need is a judgement about text, and that
# is what the model is asked, on a shortlist that is already safe to buy.
#
# So a model can pick a worse service. It cannot pick one that costs more
# than the buyer allowed, because that option is gone before it is asked.
#
# With no model available it falls back to the cheapest affordable option
# and says that is what it did, rather than presenting a price sort as a
# considered choice.

from __future__ import annotations

import time

from .. import model
from ..currency import SETTLEMENT_SYMBOL, display
from ..state import Money, MoneyError, StageResult, TaskState

U_DECIMALS = 18
U_SYMBOL = SETTLEMENT_SYMBOL

SCHEMA_HINT = """{
  "choice_index": number,     // index into the shortlist you were given
  "reason": string,           // one line on why this one
  "runner_up_index": number|null
}"""


def _price(candidate: dict) -> Money | None:
    raw = candidate.get("amount_base_units")
    try:
        return Money(int(str(raw)), U_DECIMALS, U_SYMBOL)
    except (MoneyError, TypeError, ValueError):
        return None


def _shortlist(candidates: list, budget: Money | None) -> tuple[list, list]:
    """Affordable and priced, plus what was removed and why."""
    keep, dropped = [], []
    for c in candidates or []:
        price = _price(c)
        if price is None:
            dropped.append({"resource": c.get("resource"), "reason": "no readable price"})
            continue
        if budget is not None and price.units > budget.units:
            dropped.append({
                "resource": c.get("resource"),
                "reason": f"costs {price}, budget is {budget}",
            })
            continue
        keep.append({**c, "price": price})
    return keep, dropped


def _prompt(intent: dict, shortlist: list) -> str:
    lines = []
    for i, c in enumerate(shortlist):
        lines.append(
            f"{i}. {c['resource']}\n   price {c['price']}\n   {c.get('description') or 'no description'}"
        )
    return (
        "You are the match stage of a pipeline choosing one paid API for "
        "someone. Every option below is already inside their budget, so do "
        "not consider affordability.\n\n"
        f"WHAT THEY NEED: {intent.get('capability')}\n"
        f"FOR: {intent.get('purpose') or 'not stated'}\n"
        f"THEY CARE ABOUT: {', '.join(intent.get('priorities') or []) or 'not stated'}\n\n"
        "OPTIONS:\n" + "\n".join(lines) + "\n\n"
        "Pick the one that best does what they need. Answer with its index."
    )


async def run(state: TaskState) -> StageResult:
    started = time.time()

    candidates = state.candidates or []
    if not candidates:
        return StageResult(
            stage="match", status="error", data={},
            note="No candidates to choose from.",
            started_at=started, ended_at=time.time(),
        )

    budget = state.profile.get("budget")
    budget = budget if isinstance(budget, Money) else None
    if budget is not None and (budget.decimals != U_DECIMALS or budget.symbol != U_SYMBOL):
        # No conversion on a spend path. The same rule Styling follows.
        #
        # This should now be unreachable for the common cases. The intent
        # stage resolves a generic word like "stablecoin" to the settlement
        # asset and ASKS about a genuinely different token while there is
        # still someone to ask, so a second currency reaching this far means
        # a symbol nothing upstream recognised. The refusal stays as the
        # backstop it was, but it says what to do about it -- the old message
        # ended the run with a fact and no next step.
        return StageResult(
            stage="match", status="error",
            data={"budget": budget.to_dict()},
            note=(
                f"The budget is in {display(budget.symbol)} and these services price in "
                f"{display(U_SYMBOL)}. No exchange rate is applied on a spend path, so no "
                f"comparison is made. Restate the budget in {display(U_SYMBOL)} to continue."
            ),
            started_at=started, ended_at=time.time(),
        )

    shortlist, dropped = _shortlist(candidates, budget)
    if not shortlist:
        return StageResult(
            stage="match", status="error",
            data={"dropped": dropped, "considered": len(candidates)},
            note=(
                f"None of the {len(candidates)} service(s) are usable"
                + (f" within {budget}." if budget else " with a readable price.")
            ),
            started_at=started, ended_at=time.time(),
        )

    cheapest = min(shortlist, key=lambda c: c["price"].units)

    if len(shortlist) == 1:
        chosen, reason, how = shortlist[0], "only option inside the budget", "deterministic"
    else:
        try:
            out = await model.reason(
                _prompt(state.context.get("intent") or {}, shortlist), SCHEMA_HINT,
                intent="choose the service that best fits the described need from an affordable shortlist",
            )
        except model.ModelUnavailable as e:
            chosen, reason, how = cheapest, f"model unavailable ({e}), fell back to cheapest", "fallback"
        else:
            if out.get("degraded"):
                chosen, reason, how = cheapest, "no model configured, fell back to cheapest", "fallback"
            else:
                idx = out.get("choice_index")
                if isinstance(idx, int) and 0 <= idx < len(shortlist):
                    chosen = shortlist[idx]
                    reason = str(out.get("reason") or "")[:200]
                    how = "model"
                else:
                    chosen, reason, how = cheapest, (
                        f"model returned an unusable index {idx!r}, fell back to cheapest"
                    ), "fallback"

    state.selection = [{
        "title": chosen.get("description") or chosen["resource"],
        "url": chosen["resource"],
        "price": chosen["price"],
        "quantity": 1,
        "merchant": chosen.get("pay_to"),
        "category": "service",
    }]
    state.context["match"] = {
        "resource": chosen["resource"],
        "price": chosen["price"].to_dict(),
        "decided_by": how,
        "reason": reason,
        "shortlist": len(shortlist),
        "dropped": dropped,
    }

    return StageResult(
        stage="match", status="ok",
        data=state.context["match"],
        note=(
            f"Chose {chosen['resource']} at {chosen['price']}, from {len(shortlist)} "
            f"affordable option(s), decided by {how}."
            + (f" {len(dropped)} removed on price." if dropped else "")
        ),
        started_at=started, ended_at=time.time(),
    )
