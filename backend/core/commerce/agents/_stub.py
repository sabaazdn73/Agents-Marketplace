# agents/_stub.py
#
# The shared shape for the four stages not built in this pass.
#
# A stub here returns status="not_implemented" and NO data. That is a
# deliberate choice over returning plausible-looking output: this pipeline
# spends money, and a fabricated candidate product would be priced by
# Styling, checked by QA against a profile, and potentially paid for. Fake
# data in a commerce pipeline is not a harmless placeholder, it is a
# liability. So each stub says what it would need, and the pipeline halts.

from __future__ import annotations

import time

from ..state import StageResult


def not_implemented(stage: str, needs: str) -> StageResult:
    now = time.time()
    return StageResult(
        stage=stage,
        status="not_implemented",
        data={},
        note=f"{stage} is not built yet. To build it: {needs}",
        started_at=now, ended_at=now,
    )
