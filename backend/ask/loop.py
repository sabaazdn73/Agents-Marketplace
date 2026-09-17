"""The bounded tool-calling loop.

One question in, one answer out, with the tools it called and the arguments it
called them with carried back beside the answer so that a claim can be checked
rather than trusted.

HOW THE TOOLS ARE CALLED
In process, straight to the handlers in mcp_server/tools.py, through the same
byte ceiling the wire uses (envelope.enforce_ceiling). Not over HTTP to this
service's own /mcp endpoint: that would be a second request into a container
with a 512MiB cap, through a gate that allows one call at a time, from inside a
request that is already holding a connection. The result a visitor sees is the
same bytes an MCP client would get, which is the property that matters, and
every evidence entry carries the JSON-RPC body that reproduces it.

WHY THIS DOES NOT TAKE THE MCP GATE
protocol.GATE allows one call at a time process wide, and this loop makes up to
five calls in sequence. Holding that gate for a whole turn would put every MCP
client behind a visitor typing in a box, and taking and releasing it five times
would leave the turn half answered whenever somebody else was mid-call. This
path has its own limit instead, in bounds.py: two turns at a time, which is at
most two tool handlers running at once against one for the MCP path.

WHAT IS BOUNDED, AND WHY EACH ONE
  four tool calls        a loop that wants more is lost rather than thorough
  32KB of tool output    what accumulates in the prompt, on top of each single
                         response already being capped at 8 to 32KB
  five model calls       the last one cannot call a tool, so a turn always ends
  20 seconds per call    the provider's own note says a flash model answers in
                         about two, so this is the slow tail and not the norm
  75 seconds per turn    a hard wall clock around everything above

The catalogue is read before the first model call rather than left for the
model to ask for. It is the one call the design says to make first, it is what
makes a dataset id something the model reads instead of something it invents,
and reading it up front saves a model round trip on every question. It is
cached for 60 seconds, because its coverage half touches every store behind the
surface and a burst of questions should not re-read all of them.
"""

from __future__ import annotations

import asyncio
import json
import time

from mcp_server import envelope, tools

from ask import bounds, grounding

CATALOGUE_TTL_SECONDS = 60.0
_catalogue: dict = {"body": None, "payload": None, "at": 0.0}


def _read_decision(decision: dict) -> tuple[str, dict, str | None, bool]:
    """What the model meant, from the several shapes it writes it in.

    The schema asks for `tool` and `arguments`. Measured on 2026-09-17 against
    four Gemini Flash versions on this project's own key, three of them
    answered with `name` instead, copying the key out of the tool manifest
    sitting further up the prompt, and two used `input` for the arguments.
    Failing on that would spend a model call to learn nothing, so the shapes
    are read rather than corrected.
    """
    tool = decision.get("tool") or decision.get("name") or decision.get("tool_name")
    args = (decision.get("arguments") if isinstance(decision.get("arguments"), dict)
            else decision.get("input") if isinstance(decision.get("input"), dict)
            else decision.get("args") if isinstance(decision.get("args"), dict)
            else {})
    answer = decision.get("answer")
    answered = bool(decision.get("answered"))
    return str(tool or "").strip(), args, answer, answered


def _replay(tool: str, arguments: dict) -> dict:
    """The JSON-RPC body that reproduces this evidence against POST /mcp.

    An answer that carries its evidence is only checkable if the reader can run
    the same call. This is that call, ready to post.
    """
    return {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": tool, "arguments": arguments}}


def _digest(step: int, tool: str, arguments: dict, payload: dict,
            body: str, **extra) -> dict:
    """One evidence entry: what was called, and what came back, in summary.

    The whole tool result is not repeated here. It was up to 32KB, the visitor
    is reading an answer rather than a transcript, and the replay body makes the
    full result one request away.
    """
    value = payload.get("value")
    return {
        "step": step,
        "kind": "tool_call",
        "tool": tool,
        "arguments": arguments,
        "measured": payload.get("measured"),
        "coverage": payload.get("coverage"),
        "withheld_reason": payload.get("withheld_reason"),
        "caveats": payload.get("caveats") or [],
        "rows": len(value) if isinstance(value, list) else None,
        "bytes": len(body.encode("utf-8")),
        "replay": _replay(tool, arguments),
        **extra,
    }


async def _catalogue_step(datasets: dict) -> tuple[dict, str]:
    """tnega_catalogue, through the same ceiling as every other call."""
    now = time.time()
    if _catalogue["body"] and now - _catalogue["at"] < CATALOGUE_TTL_SECONDS:
        return _catalogue["payload"], _catalogue["body"]
    payload = await tools.catalogue(datasets, {})
    body, payload = envelope.enforce_ceiling("tnega_catalogue", payload)
    _catalogue.update({"body": body, "payload": payload, "at": now})
    return payload, body


def _unknown_tool(name) -> dict:
    return envelope.withheld(
        measured=f"a call to '{name}'",
        coverage={"tools": len(tools.BY_NAME), "partial": False},
        reason="unknown_tool",
        explanation=f"There is no tool called {name!r}. "
                    f"The six are: {', '.join(sorted(tools.BY_NAME))}.")


async def run(question: str, datasets: dict, steps: list[dict]) -> dict:
    """The turn. `steps` is the caller's list so a timeout can still report it.

    Returns the answer and how it was reached. Never raises for a missing key
    or a provider failure: both are states this endpoint is expected to be in
    sometimes, and both come back as a refusal that says which one it was.
    """
    from core.commerce import model

    evidence: list[dict] = []
    if not model.is_configured():
        return {
            "answer": f"This site can answer from its own measurements, but the "
                      f"model that reads them is not configured on this "
                      f"deployment: {model.status()['env_var']} is not set, so "
                      f"no question can be answered here right now. The "
                      f"measurements are still served directly at /api and over "
                      f"MCP at /mcp.",
            "answered": False,
            "degraded": True,
            "evidence": evidence,
            "guards": ["model_not_configured"],
        }

    # Step 1 is always the catalogue, so the model reads what exists rather than
    # recalling what a site like this usually has.
    try:
        payload, body = await _catalogue_step(datasets)
        age = time.time() - _catalogue["at"]
        steps.append({"step": 1, "tool": "tnega_catalogue", "arguments": {},
                      "body": body})
        evidence.append(_digest(1, "tnega_catalogue", {}, payload, body,
                                cached_seconds=round(age, 1)))
        used_bytes = len(body.encode("utf-8"))
    except Exception as e:  # noqa: BLE001
        used_bytes = 0
        evidence.append({"step": 1, "kind": "tool_call", "tool": "tnega_catalogue",
                         "arguments": {}, "failed": f"{type(e).__name__}",
                         "replay": _replay("tnega_catalogue", {})})

    tool_calls = 1
    model_calls = 0
    model_seconds = 0.0
    answer = None
    answered = False
    notes: list[str] = []

    while model_calls < bounds.MAX_MODEL_CALLS:
        calls_left = bounds.MAX_TOOL_CALLS - (tool_calls - 1)
        if used_bytes >= bounds.MAX_EVIDENCE_BYTES:
            calls_left = 0
            if "evidence_budget_spent" not in notes:
                notes.append("evidence_budget_spent")

        prompt = grounding.build_prompt(question, steps, calls_left=calls_left)
        model_calls += 1
        started_model = time.time()
        try:
            decision = await model.reason(
                prompt, grounding.SCHEMA_HINT,
                intent="answer a visitor's question from Tnega's own measurements",
                timeout=bounds.MODEL_STEP_TIMEOUT_SECONDS)
        except model.RateLimited as e:
            return _provider_refusal(str(e), evidence, "model_rate_limited")
        except model.ModelUnavailable as e:
            return _provider_refusal(str(e), evidence, "model_unavailable")

        model_seconds += time.time() - started_model

        if decision.get("degraded"):
            return _provider_refusal(
                decision.get("reason") or "the model was not called",
                evidence, "model_degraded")

        name, args, text, said_answered = _read_decision(decision)
        if isinstance(text, str) and text.strip():
            answer = text.strip()
            answered = said_answered
            break

        if not name or calls_left <= 0:
            # Neither an answer nor a step that may be taken. Loop again while
            # model calls remain; the bound is what stops this, not hope.
            notes.append("tool_call_after_budget" if name else "model_returned_no_step")
            continue

        spec = tools.BY_NAME.get(name)
        tool_calls += 1
        started_tool = time.time()
        try:
            payload = (await spec["handler"](datasets, args)) if spec else _unknown_tool(name)
            body, payload = envelope.enforce_ceiling(name, payload)
        except Exception as e:  # noqa: BLE001
            payload = envelope.withheld(
                measured=f"{name} did not complete",
                coverage={"partial": True},
                reason="tool_failed",
                explanation=f"{type(e).__name__}: {str(e)[:160]}")
            body = envelope.encode(payload)

        used_bytes += len(body.encode("utf-8"))
        steps.append({"step": tool_calls, "tool": name, "arguments": args,
                      "body": body})
        evidence.append(_digest(tool_calls, name, args, payload, body,
                                seconds=round(time.time() - started_tool, 2)))

    if answer is None:
        answer = ("No answer was produced within the bounds this endpoint runs "
                  "under. What was read is listed in the evidence below, and "
                  "asking a narrower question usually gets further.")
        notes.append("no_answer_within_bounds")

    checked, fired = grounding.guard(question, answer, evidence=evidence)
    if "no_evidence" in fired or "bare_answer" in fired:
        answered = False

    return {
        "answer": checked,
        "answered": answered,
        "degraded": False,
        "evidence": evidence,
        "guards": fired + notes,
        "tool_calls": tool_calls,
        "model_calls": model_calls,
        "model_seconds": round(model_seconds, 2),
        "evidence_bytes": used_bytes,
    }


def _provider_refusal(detail: str, evidence: list[dict], guard: str) -> dict:
    """The provider could not be reached or would not answer.

    Said as what it is, a fact about this call and not about the data, with the
    provider's own words for which of the two it was.
    """
    return {
        "answer": f"The model that reads this site's measurements could not be "
                  f"reached for this question. {detail} Nothing was guessed in "
                  f"its place. The measurements are served directly at /api and "
                  f"over MCP at /mcp.",
        "answered": False,
        "degraded": True,
        "evidence": evidence,
        "guards": [guard],
    }


async def run_bounded(question: str, datasets: dict) -> dict:
    """The turn under a hard wall clock, reporting what it had when time ran out."""
    steps: list[dict] = []
    started = time.time()
    try:
        out = await asyncio.wait_for(run(question, datasets, steps),
                                     timeout=bounds.TURN_DEADLINE_SECONDS)
    except asyncio.TimeoutError:
        out = {
            "answer": f"This question ran past the {int(bounds.TURN_DEADLINE_SECONDS)} "
                      f"second limit a turn is given here, so it was stopped. "
                      f"What had been read by then is listed in the evidence. "
                      f"A narrower question usually finishes.",
            "answered": False,
            "degraded": False,
            "evidence": [{"step": s["step"], "kind": "tool_call", "tool": s["tool"],
                          "arguments": s["arguments"],
                          "bytes": len(s["body"].encode("utf-8")),
                          "replay": _replay(s["tool"], s["arguments"])}
                         for s in steps],
            "guards": ["turn_deadline"],
        }
    out["elapsed_seconds"] = round(time.time() - started, 2)
    return out
