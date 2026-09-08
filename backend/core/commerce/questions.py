# questions.py
#
# How an agent asks the person something and gets an answer back.
#
# Before this existed a stage could return a list of question strings and
# that was the end of the run. The person read three questions with no way
# to reply, which made the opening agent a dead end rather than a
# conversation.
#
# A question is now an object with a stable id and the field its answer
# fills, so an answer can be routed into the shared state without matching
# on prose. The coordinator pauses on the asking agent, takes answers
# through its own endpoint, merges them, and resumes that agent. Stages
# before it do not run again, because their work is already in the state.
#
# Keeping questions typed rather than free text also stops one flow asking
# another flow's questions. A size belongs to a physical purchase and has no
# meaning for an API call, so the field it targets simply does not exist in
# that flow's question set.

from __future__ import annotations

TEXT = "text"
NUMBER = "number"
CHOICE = "choice"


def question(qid: str, label: str, field: str, *, kind: str = TEXT,
             placeholder: str = "", choices: list | None = None) -> dict:
    """One thing to ask.

    `field` is dotted and says where the answer goes, for example
    "profile.size" or "context.destination". The coordinator applies it, so
    an agent never has to know how the state is shaped.
    """
    q = {"id": qid, "label": label, "field": field, "kind": kind}
    if placeholder:
        q["placeholder"] = placeholder
    if choices:
        q["choices"] = choices
    return q


def apply_answers(state, questions: list[dict], answers: dict) -> list[str]:
    """Write answers into the state. Returns the ids that were applied.

    An answer with no matching question is ignored rather than written
    somewhere by name, since a client that can name arbitrary fields could
    reach into parts of the state no question asked about.
    """
    applied = []
    by_id = {q["id"]: q for q in questions if isinstance(q, dict) and q.get("id")}
    for qid, value in (answers or {}).items():
        q = by_id.get(qid)
        if not q:
            continue
        if not isinstance(value, str) or not value.strip():
            continue
        target = str(q.get("field") or "")
        section, _, key = target.partition(".")
        if section == "profile":
            state.profile[key] = value.strip()
        elif section == "context":
            state.context[key] = value.strip()
        else:
            continue
        applied.append(qid)
    return applied


# The questions each flow is allowed to ask, so one flow cannot leak the
# other's vocabulary. A model that returns "what size" for an API purchase
# has its question dropped, because there is no size field to fill.
PHYSICAL_FIELDS = {
    "profile.size", "profile.budget_text", "profile.country", "profile.city",
    "profile.age_range", "profile.taste",
    "context.occasion", "context.season", "context.destination", "context.travel_dates",
}
API_FIELDS = {
    "profile.budget_text", "context.capability", "context.purpose",
    "context.volume", "context.priorities",
}


def allowed_for(flow: str) -> set:
    return API_FIELDS if flow == "api" else PHYSICAL_FIELDS


def filter_for_flow(questions: list[dict], flow: str) -> list[dict]:
    allowed = allowed_for(flow)
    return [q for q in questions if isinstance(q, dict) and q.get("field") in allowed]
