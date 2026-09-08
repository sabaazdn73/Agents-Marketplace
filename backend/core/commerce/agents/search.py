# agents/search.py -- find candidate products. NOT BUILT.
#
# This is the stage where inventing output would do the most damage, so it
# is the one most deliberately left empty. A made-up catalogue would flow
# into Styling, be assembled into a cart, pass a size check, and reach
# Payment. QA's link check would catch it -- but relying on a downstream
# guard to catch upstream fabrication is not a design, it is luck.
#
# No product source is currently reachable from this backend: there is
# no merchant API configured and no retail search integration. That is the
# state, and it is reported rather than worked around.
from __future__ import annotations

from ._stub import not_implemented
from ..state import StageResult, TaskState


async def run(state: TaskState) -> StageResult:
    return not_implemented(
        "search",
        "connect a product source (a merchant API, or a retail search API with "
        "product URLs and prices). No source is reachable today, and this stage "
        "must never synthesise candidates",
    )
