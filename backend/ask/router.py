"""POST /api/ask and GET /api/ask/readiness.

The route is thin on purpose: it checks the bounds, runs the turn, and shapes
the reply. Everything it decides is in bounds.py, everything it says is in
grounding.py, and everything it reads is a tool handler in mcp_server/.

It composes the MCP registry rather than reaching for server.py, the same way
mcp_server/router.py does, so the two surfaces answer from one set of dataset
descriptors and cannot drift into two.

THE REPLY CARRIES ITS EVIDENCE
Every answer ships with the tool calls behind it, their arguments, the coverage
each one reported, and a JSON-RPC body that reproduces it against POST /mcp. An
answer that cannot be checked is an answer somebody has to take on faith, and
this site's whole argument is that nobody should have to.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from mcp_server import registry, tools

from ask import bounds, grounding, loop


def build_router(providers) -> APIRouter:
    router = APIRouter()
    datasets = registry.build(providers)

    @router.get("/api/ask/readiness")
    async def ask_readiness() -> JSONResponse:
        """What this endpoint could answer right now. Never returns a key."""
        from core.commerce import model

        recent = bounds.OUTCOMES.snapshot()
        return JSONResponse({
            "model": model.status(),
            # Configuration is not availability. `model.configured` says a key
            # is set; this says what the last turns through that key actually
            # did, which is the question a caller is really asking.
            "recent_turns": recent,
            # True only if the last turn through this process actually
            # answered. A threshold of "fewer than three failures in a row"
            # would have reported answering:true after a turn that failed,
            # which is the overclaim this field was added to remove. Null
            # means nothing has been asked yet, which is not the same as
            # working.
            "answering": None if not recent["turns_observed"] else (
                recent["consecutive_failures"] == 0),
            "datasets": sorted(datasets),
            "tools": sorted(tools.BY_NAME),
            "bounds": bounds.describe(),
            "traffic": bounds.BUDGET.snapshot(),
            "grounding": {
                "record": grounding.RECORD_SOURCE,
                "measured_on": grounding.RECORD_MEASURED_ON,
                "guards": ["no_evidence", "ranking_without_limits", "register"],
            },
            "answers_without_a_model": False,
        })

    @router.post("/api/ask")
    async def ask(request: Request) -> JSONResponse:
        ip = bounds.client_ip(request.headers, request.client.host if request.client else None)

        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            return _refused(400, "Body must be JSON with a 'question' field.",
                            "bad_request")

        question = (body or {}).get("question")
        if not isinstance(question, str) or not question.strip():
            return _refused(400, "'question' is required and must be a non-empty string.",
                            "bad_request")
        question = question.strip()
        if len(question) < bounds.MIN_QUESTION_CHARS:
            return _refused(400, "That question is too short to act on.", "too_short")
        if len(question) > bounds.MAX_QUESTION_CHARS:
            return _refused(
                400,
                f"A question is capped at {bounds.MAX_QUESTION_CHARS} characters "
                f"here and this one is {len(question)}. The cap is what keeps "
                f"the cost of answering bounded on a public endpoint.",
                "too_long")

        # Order matters: the allowance is checked before the gate, so a caller
        # over its budget is told that rather than told the site is busy.
        ok, why = bounds.BUDGET.check(ip)
        if not ok:
            return _refused(
                429,
                f"This endpoint costs model tokens per question, so it is "
                f"rationed: {why['allowed']} questions per "
                f"{why['window_seconds'] // 60} minutes "
                f"{'from one address' if why['limit'] == 'per_ip' else 'across the whole service'}. "
                f"Try again in about {max(1, why['retry_after_seconds'] // 60)} minute(s).",
                "rate_limited", extra={"limit": why})

        if not bounds.GATE.acquire():
            return _refused(
                429,
                f"Tnega answers {bounds.CONCURRENT_TURNS} questions at a time and "
                f"is busy. This is a refusal rather than a queue: try again in a "
                f"moment instead of waiting.",
                "server_busy", extra={"concurrent_turns": bounds.CONCURRENT_TURNS})

        try:
            bounds.BUDGET.record(ip)
            out = await loop.run_bounded(question, datasets)
            bounds.OUTCOMES.record(out.get("answered"), out.get("guards"))
        finally:
            bounds.GATE.release()

        from core.commerce import model
        return JSONResponse({
            "question": question,
            "answer": out["answer"],
            "answered": out["answered"],
            "degraded": out["degraded"],
            # Null here, a string on a refusal. Present in both shapes so a
            # reader can switch on one field rather than discovering which
            # fields exist by the status code.
            "refused": None,
            "evidence": out["evidence"],
            "guards": out.get("guards") or [],
            "bounds": {
                **bounds.describe(),
                "tool_calls_used": out.get("tool_calls"),
                "model_calls_used": out.get("model_calls"),
                "model_seconds": out.get("model_seconds"),
                "evidence_bytes_used": out.get("evidence_bytes"),
                "elapsed_seconds": out.get("elapsed_seconds"),
            },
            "model": model.status(),
            "grounding": {"record": grounding.RECORD_SOURCE,
                          "measured_on": grounding.RECORD_MEASURED_ON},
        })

    return router


def _refused(status: int, message: str, reason: str, extra: dict | None = None) -> JSONResponse:
    """A refusal in the same shape as an answer, so one reader handles both.

    The field a caller reads for text is `answer` whether the turn ran or not.
    A client that has to switch on the status code to find out where the
    sentence is will eventually render an empty box.
    """
    return JSONResponse(status_code=status, content={
        "answer": message,
        "answered": False,
        # A refusal is a degraded turn by any reading, and every field the
        # answered shape carries is carried here too. A consumer that keyed on
        # `degraded` used to raise on a 429, which is the shape of defect this
        # function exists to prevent.
        "degraded": True,
        "refused": reason,
        "evidence": [],
        "guards": [],
        "bounds": bounds.describe(),
        **(extra or {}),
    })
