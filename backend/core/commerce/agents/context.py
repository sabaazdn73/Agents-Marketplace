# agents/context.py
#
# Collects what constrains the choice: occasion, season, destination, dates,
# and any product links the request carries.
#
# Built in this pass. Model-backed, and shaped like profile.py because the
# failure it has to avoid is the same one: filling a field with something
# plausible rather than something the request supports.
#
# TWO CONSUMERS, SO TWO FIELDS THAT MATTER
#   qa.py     reads context["season"] and matches it, lowercased, against a
#             list of garments that read wrong for summer or winter.
#   search.py reads context["product_urls"] and resolves them. It falls back
#             to scanning the request itself, so setting this is a
#             convenience rather than a requirement, but it keeps the
#             extraction in one place.
#
# STATED VERSUS DERIVED SEASON
# "A coat for Oslo in December" states a destination and a month, not a
# season. Working out that this means winter is reasoning over what was
# said, not inventing it, so the stage is allowed to do it. What it is not
# allowed to do is hide that it did.
#
# So season carries season_source, either "stated" or "derived". That
# distinction earns its place because the hemisphere decides the answer:
# December in Oslo is winter and December in Sydney is summer, and qa.py's
# conflict list is written for the northern hemisphere. A derived season
# that came from a southern destination will correctly flag a parka as
# wrong, and anyone reading the result can see the reasoning rather than
# having to trust it.
#
# Season is left null when the request gives neither a season nor enough to
# work one out. QA then skips its seasonal rule entirely, which is the right
# outcome: no check is better than a check against a guessed season.

from __future__ import annotations

import time

from .. import model
from ..state import StageResult, TaskState
from .search import extract_urls

# The values qa.py matches on. Anything else is dropped rather than passed
# through, because a season it does not recognise would silently disable the
# seasonal rule while looking like it was set.
KNOWN_SEASONS = ("spring", "summer", "autumn", "winter")

SCHEMA_HINT = """{
  "occasion": string|null,       // e.g. "wedding", "hiking", "work"
  "destination": string|null,    // place, only if stated
  "travel_dates": string|null,   // as written, e.g. "December", "next week"
  "season": "spring"|"summer"|"autumn"|"winter"|null,
  "season_source": "stated"|"derived"|null,
  "season_reasoning": string|null,  // required when season_source is "derived"
  "constraints": [string]        // anything else that limits the choice
}"""


def _prompt(request: str) -> str:
    return (
        "You are the context stage of a shopping pipeline. Read the buyer's "
        "request and extract what constrains the choice.\n\n"
        f"REQUEST:\n{request}\n\n"
        "Rules:\n"
        "- Only report an occasion, destination or dates if the request says so.\n"
        "- season may be stated outright, in which case season_source is 'stated'.\n"
        "- season may also be worked out from a stated destination and time of "
        "year, in which case season_source is 'derived' and season_reasoning "
        "says how, including the hemisphere. December in Oslo is winter. "
        "December in Sydney is summer.\n"
        "- If the request gives neither a season nor a destination and time to "
        "work one out from, season must be null. Do not assume a hemisphere "
        "and do not assume the current month.\n"
        "- constraints is for anything else that limits what to buy, such as a "
        "fabric to avoid, a colour, or a dress code."
    )


async def run(state: TaskState) -> StageResult:
    started = time.time()

    # URLs are read from the text directly. This does not need a model and
    # should not fail just because one is unavailable, so it happens first
    # and survives every path below.
    urls = extract_urls(state.request)
    if urls:
        state.context["product_urls"] = urls

    try:
        out = await model.reason(
            _prompt(state.request),
            SCHEMA_HINT,
            intent=(
                "extract the occasion, season, destination and other constraints "
                "the buyer's request states, and say whether the season was "
                "stated or worked out"
            ),
        )
    except model.ModelUnavailable as e:
        return StageResult(
            stage="context", status="error",
            data={"product_urls": urls},
            note=f"{e} No context was inferred.",
            started_at=started, ended_at=time.time(),
        )

    if out.get("degraded"):
        return StageResult(
            stage="context", status="degraded",
            data={
                "would_have": out.get("would_have"),
                "reason": out.get("reason"),
                "product_urls": urls,
            },
            note=(
                "No model configured, so occasion, season and destination were "
                "not collected."
                + (f" {len(urls)} product link(s) were still read from the request."
                   if urls else "")
            ),
            started_at=started, ended_at=time.time(),
        )

    context: dict = {}
    notes: list[str] = []

    for field in ("occasion", "destination", "travel_dates"):
        value = out.get(field)
        if isinstance(value, str) and value.strip():
            context[field] = value.strip()

    season = out.get("season")
    source = out.get("season_source")
    if isinstance(season, str) and season.strip().lower() in KNOWN_SEASONS:
        season = season.strip().lower()
        if source not in ("stated", "derived"):
            # A season with no account of where it came from is not usable:
            # the whole point of the field is that a reader can tell.
            notes.append(f"dropped season {season!r} because season_source was {source!r}")
        else:
            context["season"] = season
            context["season_source"] = source
            if source == "derived":
                reasoning = out.get("season_reasoning")
                if isinstance(reasoning, str) and reasoning.strip():
                    context["season_reasoning"] = reasoning.strip()
                else:
                    notes.append("season was derived but no reasoning was given")
    elif season not in (None, ""):
        notes.append(f"dropped season {season!r}, not one of {list(KNOWN_SEASONS)}")

    constraints = [c.strip() for c in (out.get("constraints") or [])
                   if isinstance(c, str) and c.strip()]
    if constraints:
        context["constraints"] = constraints
    if urls:
        context["product_urls"] = urls

    state.context.update(context)

    described = [k for k in ("occasion", "season", "destination", "travel_dates") if k in context]
    return StageResult(
        stage="context",
        status="ok",
        data={**context, "dropped": notes},
        note=(
            (f"Collected {', '.join(described)}." if described
             else "The request states no occasion, season or destination.")
            + (f" Season was {context['season_source']}." if "season" in context else "")
            + (f" {len(urls)} product link(s) found." if urls else "")
            + (f" {len(notes)} field(s) dropped." if notes else "")
        ),
        started_at=started, ended_at=time.time(),
    )
