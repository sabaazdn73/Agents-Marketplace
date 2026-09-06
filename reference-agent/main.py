# reference-agent/main.py
#
# HTTP surface for the reference agent. Small on purpose: the point of this
# service is the draw pattern in agent.py, not the API around it.
#
# REFERENCE IMPLEMENTATION. Built by Tnega to demonstrate AgentBudgetEscrow
# end to end. It is not a third-party agent and is labelled as such
# everywhere it appears in the product.

from __future__ import annotations

import os

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from agent import ReferenceAgent

_agent: ReferenceAgent | None = None


def _get_agent() -> ReferenceAgent:
    global _agent
    if _agent is None:
        _agent = ReferenceAgent()
    return _agent


async def ping(request):
    """Health, and the agent's own address -- which is what a client must
    name as `agent` when opening a budget."""
    try:
        a = _get_agent()
        return JSONResponse({
            "status": "Healthy",
            "kind": "reference_implementation",
            "note": "Reference implementation built by Tnega, not a third-party agent.",
            "agent_address": a.address,
            "escrow": os.environ.get("BUDGET_ESCROW_ADDRESS", ""),
        })
    except Exception as e:
        return JSONResponse({"status": "Unconfigured", "detail": str(e)}, status_code=503)


async def fulfil(request):
    """Do the paid work for one funded budget, drawing per completed step.

    The client opens the budget on-chain first, naming this agent's address,
    then calls this with the budget id and the wallet to report on.
    """
    body = await request.json()
    budget_id = body.get("budget_id")
    subject = (body.get("subject") or "").strip()
    if budget_id is None or not subject.lower().startswith("0x"):
        return JSONResponse({"error": "budget_id and a 0x subject address are required"}, status_code=400)

    try:
        run = await _get_agent().fulfil(int(budget_id), subject)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    return JSONResponse({
        "budget_id": run.budget_id,
        "subject": run.subject,
        "drawn_wei": str(run.drawn_wei),
        "draw_transactions": run.tx_hashes,
        # Per step, so a reader can match each charge to the work behind it
        # and see plainly that failed steps were not charged for.
        "steps": [
            {"memo": s.memo, "charged": s.charged, "error": s.error,
             "has_result": s.result is not None}
            for s in run.steps
        ],
    })


app = Starlette(routes=[
    Route("/ping", ping),
    Route("/fulfil", fulfil, methods=["POST"]),
])
