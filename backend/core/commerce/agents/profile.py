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
from ..currency import GENERIC, SETTLEMENT, normalize_budget_currency, reading_note
from ..questions import NUMBER, question
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
            note=f"{e} No profile was inferred.",
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
    # The model's own free-text questions are kept as notes only. Anything
    # the run actually needs is asked as a typed question below, so an
    # answer has somewhere to go.
    model_notes = [q for q in (out.get("questions") or []) if isinstance(q, str) and q.strip()]
    asks: list[dict] = []

    # An answer from a previous pause is already in the state, so a
    # question is only asked when the field is still empty.
    size = out.get("size") or state.profile.get("size")
    if isinstance(size, str) and size.strip():
        profile["size"] = size.strip()
    else:
        asks.append(question("size", "What size do you need?", "profile.size",
                             placeholder="M, 42, UK 9"))

    # Same precedence as the intent stage: an answered budget beats the
    # model's re-reading of the original request, which never changes and so
    # would otherwise re-raise the same question on every resume.
    answered = state.profile.get("budget_text")
    answered = answered.strip() if isinstance(answered, str) and answered.strip() else None

    if answered:
        amount, symbol, kind, raw_symbol = answered, DEFAULT_CURRENCY, SETTLEMENT, None
    else:
        raw_amount = out.get("budget_amount")
        amount = raw_amount.strip() if isinstance(raw_amount, str) and raw_amount.strip() else None
        raw_symbol = out.get("budget_currency")
        # "200 stablecoin" is a person declining to name a token, not a
        # token called STABLECOIN. See currency.py for the three cases this
        # separates and why only one of them is a real second currency.
        symbol, kind = normalize_budget_currency(raw_symbol, DEFAULT_CURRENCY)

    currency_note = ""
    if amount:
        try:
            # Parsed exactly. A budget that cannot be represented at the
            # token's precision is refused rather than rounded -- rounding a
            # budget silently changes what someone agreed to spend.
            profile["budget"] = Money.from_decimal_string(amount, DEFAULT_DECIMALS, symbol)
            if kind == GENERIC:
                currency_note = reading_note(raw_symbol, symbol, kind)
        except (MoneyError, ArithmeticError, ValueError):
            asks.append(question(
                "budget", f"I could not read {amount!r} as an amount. What is the most you want to spend?",
                "profile.budget_text", kind=NUMBER, placeholder="200"))
    else:
        asks.append(question("budget", "What is the most you want to spend?",
                             "profile.budget_text", kind=NUMBER, placeholder="200"))

    # Merchant Fit needs a country, and asking here saves a second pause.
    if not state.profile.get("country"):
        asks.append(question("country", "Which country are you in?", "profile.country",
                             placeholder="United Kingdom"))
    else:
        profile["country"] = state.profile["country"]
    if state.profile.get("city"):
        profile["city"] = state.profile["city"]

    if isinstance(out.get("recipient"), str) and out["recipient"].strip():
        profile["recipient"] = out["recipient"].strip()
    notes = [n for n in (out.get("notes") or []) if isinstance(n, str)]
    if notes:
        profile["notes"] = notes

    state.profile.update(profile)

    return StageResult(
        stage="profile",
        status="ok",
        data={
            **{k: (v.to_dict() if isinstance(v, Money) else v) for k, v in profile.items()},
            "complete": not asks,
            "questions": asks,
            "model_notes": model_notes,
        },
        note=(
            "Profile complete." if not asks
            else f"Waiting on {len(asks)} answer(s)."
        ) + currency_note,
        started_at=started, ended_at=time.time(),
    )
