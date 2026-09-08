# agents/context.py -- occasion, season, destination. NOT BUILT.
from __future__ import annotations

from ._stub import not_implemented
from ..state import StageResult, TaskState


async def run(state: TaskState) -> StageResult:
    # QA already reads state.context["season"] when present, so this stage
    # has a consumer waiting; it just isn't written yet.
    return not_implemented(
        "context",
        "extract occasion, season and destination from the request (model-backed, "
        "same shape as profile.py), and write them to state.context",
    )
