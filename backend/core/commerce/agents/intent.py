# agents/intent.py
#
# Opens the API and services flow. Turns "I want to do X" into a shape the
# matching stage can work against.
#
# It does not look for services. Its whole job is to read the request and
# produce a structured need: the capability wanted, what it is for, how
# often it will be called, and what would make one option better than
# another. API Fit takes it from there.
#
# Like the other model-backed stages it reports what the request supports
# and asks for the rest. A budget invented here would be a budget QA later
# checks a price against, which would make the check meaningless.

from __future__ import annotations

import time

from .. import model
from ..questions import NUMBER, question
from ..state import Money, MoneyError, StageResult, TaskState

SCHEMA_HINT = """{
  "capability": string|null,        // what the service must do, in a few words
  "purpose": string|null,           // what the user is using it for
  "inputs": [string],               // what they will send it
  "outputs": [string],              // what they need back
  "volume": string|null,            // how often, if stated
  "budget_amount": string|null,     // decimal string, only if stated
  "budget_currency": string|null,
  "priorities": [string],           // what makes one option better, if stated
  "questions": [string]             // what must be asked before choosing
}"""

DEFAULT_CURRENCY = "U"
DEFAULT_DECIMALS = 18


def _prompt(request: str) -> str:
    return (
        "You are the intent stage of a pipeline that finds an API or service "
        "for someone. Read what they wrote and turn it into a structured "
        "need.\n\n"
        f"REQUEST:\n{request}\n\n"
        "Rules:\n"
        "- capability is what the service has to do, not a product name.\n"
        "- Only fill volume, budget or priorities if the request states them.\n"
        "- questions must list what someone would have to answer before "
        "money could responsibly be spent on their behalf.\n"
        "- This is a software service, not a physical product. Never ask "
        "about size, colour, fit, delivery or anything that only makes "
        "sense for something shipped in a box."
    )


async def run(state: TaskState) -> StageResult:
    started = time.time()

    try:
        out = await model.reason(
            _prompt(state.request), SCHEMA_HINT,
            intent="turn the request into a structured description of the service the user needs",
        )
    except model.ModelUnavailable as e:
        return StageResult(
            stage="intent", status="error", data={},
            note=f"Model call failed: {e}. No intent was inferred.",
            started_at=started, ended_at=time.time(),
        )

    if out.get("degraded"):
        return StageResult(
            stage="intent", status="degraded",
            data={"would_have": out.get("would_have"), "reason": out.get("reason")},
            note="No model configured, so the request was not turned into an intent.",
            started_at=started, ended_at=time.time(),
        )

    intent: dict = {}
    model_notes = [q for q in (out.get("questions") or []) if isinstance(q, str) and q.strip()]
    asks: list[dict] = []

    for field in ("capability", "purpose", "volume"):
        v = out.get(field)
        if isinstance(v, str) and v.strip():
            intent[field] = v.strip()
    for field in ("inputs", "outputs", "priorities"):
        vals = [x.strip() for x in (out.get(field) or []) if isinstance(x, str) and x.strip()]
        if vals:
            intent[field] = vals

    if not intent.get("capability"):
        carried = state.context.get("capability")
        if isinstance(carried, str) and carried.strip():
            intent["capability"] = carried.strip()
        else:
            asks.append(question("capability", "What should the service actually do?",
                                 "context.capability", placeholder="turn text into speech"))

    amount = out.get("budget_amount") or state.profile.get("budget_text")
    if isinstance(amount, str) and amount.strip():
        symbol = out.get("budget_currency")
        symbol = symbol.strip().upper() if isinstance(symbol, str) and symbol.strip() else DEFAULT_CURRENCY
        try:
            intent["budget"] = Money.from_decimal_string(amount.strip(), DEFAULT_DECIMALS, symbol)
        except (MoneyError, ArithmeticError, ValueError):
            asks.append(question(
                "budget", f"I could not read {amount!r} as an amount. What is the most you want to pay per call?",
                "profile.budget_text", kind=NUMBER, placeholder="1"))
    else:
        asks.append(question("budget", "What is the most you want to pay per call, in $U?",
                             "profile.budget_text", kind=NUMBER, placeholder="1"))

    state.profile.update({k: v for k, v in intent.items() if k == "budget"})
    state.context["intent"] = {k: v for k, v in intent.items() if k != "budget"}

    return StageResult(
        stage="intent", status="ok",
        data={
            **{k: (v.to_dict() if isinstance(v, Money) else v) for k, v in intent.items()},
            "complete": not asks,
            "questions": asks,
            "model_notes": model_notes,
        },
        note=(
            f"Need understood: {intent.get('capability')}." if intent.get("capability")
            else "The request does not yet say what the service should do."
        ) + (f" Waiting on {len(asks)} answer(s)." if asks else ""),
        started_at=started, ended_at=time.time(),
    )
