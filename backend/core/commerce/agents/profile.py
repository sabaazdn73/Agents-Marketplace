# agents/profile.py
#
# Collects what the purchase needs from the user. in this pass.
#
# ASKS RATHER THAN GUESSES
# ------------------------
# The single most damaging thing this stage could do is invent a size. A
# guessed size produces a cart that passes every downstream check and
# arrives at someone's door in the wrong size -- a cost, caused by a
# confident guess about something only the user knows.
#
# So the model's job here is DELIBERATELY NARROW: read the request, report
# what it can actually find in the text, and list what is still missing as
# questions to ask. It is not asked to infer. Anything it returns that isn't
# grounded in the request is filtered out below, and `questions` is what
# drives the conversation forward.
#
# QA then treats a missing size or budget as its own blocking finding, so an
# incomplete profile stops the pipeline rather than being papered over.

from __future__ import annotations

import time

from .. import model
from ..state import Money, MoneyError, StageResult, TaskState

SCHEMA_HINT = """{
  "size": string|null,          // ONLY if the request states it
  "budget_amount": string|null, // decimal string, e.g. "150.00", ONLY if stated
  "budget_currency": string|null,
  "recipient": string|null,     // who it is for, if stated
  "notes": [string],            // other constraints the request states
  "questions": [string]         // what must be asked before buying
}"""

# The cart currency. Kept explicit rather than inferred from the model's
# answer: the settlement token's decimals are a chain fact, not a language
# question, and letting a model choose them would be a money bug.
DEFAULT_CURRENCY = "USDT"
DEFAULT_DECIMALS = 18


def _prompt(request: str) -> str:
    return (
        "You are the profile stage of a shopping pipeline. Read the buyer's request "
        "and extract ONLY what it actually states.\n\n"
        f"REQUEST:\n{request}\n\n"
        "Rules:\n"
        "- Never guess a size. If the request does not state one, size must be null "
        "and you must add a question asking for it.\n"
        "- Never guess a budget. Same rule.\n"
        "- 'questions' must list everything a buyer would have to answer before "
        "money could responsibly be spent on their behalf."
    )


async def run(state: TaskState) -> StageResult:
    started = time.time()

    try:
        out = await model.reason(
            _prompt(state.request),
            SCHEMA_HINT,
            intent=(
                "extract the stated size, budget and constraints from the buyer's "
                "request, and list what still has to be asked"
            ),
        )
    except model.ModelUnavailable as e:
        # A model outage is visible, not silent, and produces no profile at
        # all rather than an empty-but-confident one.
        return StageResult(
            stage="profile", status="error", data={},
            note=f"Model call failed: {e}. No profile was inferred.",
            started_at=started, ended_at=time.time(),
        )

    if out.get("degraded"):
        return StageResult(
            stage="profile", status="degraded",
            data={"would_have": out.get("would_have"), "reason": out.get("reason")},
            note="No model configured; profile not collected.",
            started_at=started, ended_at=time.time(),
        )

    profile: dict = {}
    questions: list[str] = [q for q in (out.get("questions") or []) if isinstance(q, str)]

    size = out.get("size")
    if isinstance(size, str) and size.strip():
        profile["size"] = size.strip()
    elif not any("size" in q.lower() for q in questions):
        questions.append("What size do you need?")

    amount = out.get("budget_amount")
    if isinstance(amount, str) and amount.strip():
        symbol = (out.get("budget_currency") or DEFAULT_CURRENCY)
        symbol = symbol.strip().upper() if isinstance(symbol, str) else DEFAULT_CURRENCY
        try:
            # Parsed exactly. A budget that cannot be represented at the
            # token's precision is refused rather than rounded -- rounding a
            # budget silently changes what someone agreed to spend.
            profile["budget"] = Money.from_decimal_string(
                amount.strip(), DEFAULT_DECIMALS, DEFAULT_CURRENCY
                if symbol == DEFAULT_CURRENCY else symbol,
            )
        except (MoneyError, ArithmeticError, ValueError) as e:
            questions.append(
                f"I couldn't read {amount!r} as a budget ({type(e).__name__}). "
                "What is the maximum you want to spend?"
            )
    elif not any("budget" in q.lower() or "spend" in q.lower() for q in questions):
        questions.append("What is your maximum budget?")

    if isinstance(out.get("recipient"), str) and out["recipient"].strip():
        profile["recipient"] = out["recipient"].strip()
    notes = [n for n in (out.get("notes") or []) if isinstance(n, str)]
    if notes:
        profile["notes"] = notes

    profile["questions"] = questions
    state.profile = profile

    return StageResult(
        stage="profile",
        status="ok",
        data={
            **{k: (v.to_dict() if isinstance(v, Money) else v) for k, v in profile.items()},
            "complete": not questions,
        },
        note=(
            "Profile complete." if not questions
            else f"{len(questions)} question(s) must be answered before buying."
        ),
        started_at=started, ended_at=time.time(),
    )
