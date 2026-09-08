# agents/api_fit.py
#
# Finds services that could do what Intent described and can be paid for
# over B402 on BNB Chain.
#
# It searches the B402 Bazaar, a directory with a public query endpoint, so this stage has a source rather than the empty hand
# that Search has for retail.
#
# It reports the count it found, including zero, and says how large the
# catalogue is so a small number reads as a small number rather than as an
# empty market. Measured on 2026-09-08 the directory held 500 resources on
# eip155:56, so zero results means the query matched nothing, not that
# nothing exists.
#
# A directory entry is somebody else's text. Nothing here trusts the
# description; it is passed to Match as a candidate, and QA checks the price
# before anything is paid.

from __future__ import annotations

import time

from .. import bazaar
from ..state import StageResult, TaskState


async def run(state: TaskState) -> StageResult:
    started = time.time()

    intent = state.context.get("intent") or {}
    capability = intent.get("capability")
    if not capability:
        return StageResult(
            stage="api_fit", status="error", data={},
            note="No capability from the intent stage, so there is nothing to search for.",
            started_at=started, ended_at=time.time(),
        )

    query = " ".join(
        [capability] + [str(x) for x in (intent.get("outputs") or [])[:2]]
    ).strip()

    try:
        found = await bazaar.search(query, network=bazaar.BSC_NETWORK)
    except bazaar.BazaarError as e:
        return StageResult(
            stage="api_fit", status="error", data={"query": query},
            note=(
                f"The B402 directory could not be read ({e}). That is not the same as "
                "finding nothing, so no conclusion is drawn about what exists."
            ),
            started_at=started, ended_at=time.time(),
        )

    # Best effort. A failed count must not lose the results.
    try:
        total = await bazaar.catalogue_size()
    except bazaar.BazaarError:
        total = None

    state.candidates = found
    scale = f" out of {total} on BNB Chain" if total else ""

    if not found:
        return StageResult(
            stage="api_fit", status="error",
            data={"query": query, "found": 0, "catalogue_size": total},
            note=(
                f"No service matched {query!r}{scale}. The directory was readable, so this "
                "means nothing matched, not that the directory is empty."
            ),
            started_at=started, ended_at=time.time(),
        )

    return StageResult(
        stage="api_fit", status="ok",
        data={"query": query, "found": len(found), "catalogue_size": total, "candidates": found},
        note=f"Found {len(found)} service(s) for {query!r}{scale}.",
        started_at=started, ended_at=time.time(),
    )
