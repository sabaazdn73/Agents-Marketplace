# agents/styling.py -- assemble candidates into a coherent set in budget. NOT BUILT.
from __future__ import annotations

from ._stub import not_implemented
from ..state import StageResult, TaskState


async def run(state: TaskState) -> StageResult:
    return not_implemented(
        "styling",
        "select from state.candidates into state.selection, keeping the integer total "
        "at or under profile['budget'] (Money arithmetic only, never float)",
    )
