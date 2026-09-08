# agents/payment.py
#
# Executes, and ONLY after QA passes.
#
# The gate is written as a hard precondition rather than a caller
# convention: this function refuses to run if state.findings is non-empty,
# no matter who calls it or how. A guard that depends on callers remembering
# to check is not a guard on a path that spends money.
#
# It chooses nothing itself -- rails/select.py picks the rail and returns
# every quote it considered, so an unexpected choice is explainable without
# a re-run.

from __future__ import annotations

import time

from ..rails.base import Cart
from ..rails.select import select_rail
from ..state import StageResult, TaskState


async def run(state: TaskState, cart: Cart) -> StageResult:
    started = time.time()

    # Hard gate. An empty finding list is the ONLY thing that permits this.
    if state.findings:
        return StageResult(
            stage="payment",
            status="error",
            data={"blocked_by": [f.to_dict() for f in state.findings]},
            note=(
                f"Payment refused: QA returned {len(state.findings)} blocking finding(s). "
                "Nothing was charged."
            ),
            started_at=started, ended_at=time.time(),
        )

    qa_stage = state.stage("qa")
    if qa_stage is None or not qa_stage.ok:
        # No QA at all is worse than a failed QA, and must not be read as
        # "nothing was wrong".
        return StageResult(
            stage="payment", status="error", data={},
            note="Payment refused: QA did not run to completion. Nothing was charged.",
            started_at=started, ended_at=time.time(),
        )

    try:
        rail, quotes = await select_rail(cart)
        result = await rail.execute(cart)
    except Exception as e:
        # An exception here is ambiguous about whether anything moved, so it
        # is reported as such and NOT retried.
        return StageResult(
            stage="payment", status="error", data={},
            note=(
                f"Payment attempt raised {type(e).__name__}: {str(e)[:200]}. "
                "Outcome unknown; NOT retried."
            ),
            started_at=started, ended_at=time.time(),
        )

    state.payment = {
        "rail": result.rail,
        "status": result.status,
        "detail": result.detail,
        "reference": result.reference,
        "checkout_url": result.checkout_url,
        "quotes": [q.to_dict() for q in quotes],
    }

    # 'settled' is the only status that means money moved. handoff_required
    # and indeterminate are explicitly NOT successes.
    status = "ok" if result.status in ("settled", "handoff_required") else "error"
    return StageResult(
        stage="payment", status=status, data=state.payment,
        note=result.detail, started_at=started, ended_at=time.time(),
    )
