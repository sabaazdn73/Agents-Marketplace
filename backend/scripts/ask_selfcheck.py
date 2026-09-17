"""Checks the /api/ask loop holds its bounds without spending model tokens.

Run: ./venv/bin/python scripts/ask_selfcheck.py

Everything here runs against a stub model, so it costs nothing and can run on
every change. What it cannot check is whether the model obeys the prompt: that
is what the guards exist for, and the guards are checked here directly.

  bounds       the caps are what bounds.py says they are, and the per-address
               table cannot grow without limit
  guards       an answer with no evidence is replaced, a ranking question gets
               the measured limits, em dashes and asterisks do not survive
  loop         the tool call budget, the evidence budget and the wall clock
               each stop the turn, and the evidence carries a replay body
  degraded     with no key configured the endpoint refuses in words rather
               than raising
"""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:  # noqa: BLE001
    pass

from ask import bounds, grounding, loop  # noqa: E402
from core.commerce import model as commerce_model  # noqa: E402
from mcp_server import registry  # noqa: E402
from mcp_server.router import Providers  # noqa: E402

FAILURES: list[str] = []
LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(LOOP)


def run(coro):
    return LOOP.run_until_complete(coro)


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
    if not ok:
        FAILURES.append(label)


def synthetic_index():
    """The same shape the MCP self-check uses: an index with no database."""
    from core import agents_index as ai
    records = [{
        "id": f"id-{i}", "agent_id": f"id-{i}", "name": f"Agent {i:03d}",
        "description": "A synthetic record.", "chain_id": 56,
        "category": "Trading", "owner_address": f"0x{i:040x}",
        "total_score": 12.05, "is_verified": False, "status": "active",
    } for i in range(120)]
    return ai.AgentsIndex(records, {}, {})


DATASETS = registry.build(Providers(agents_index=synthetic_index))


class StubModel:
    """Stands in for core/commerce/model.py, with a scripted set of decisions."""

    def __init__(self, decisions, configured=True):
        self.decisions = list(decisions)
        self.configured = configured
        self.calls = 0
        self.prompts = []
        self.RateLimited = commerce_model.RateLimited
        self.ModelUnavailable = commerce_model.ModelUnavailable

    def is_configured(self):
        return self.configured

    def status(self):
        return {"provider": "stub", "model": "stub", "configured": self.configured,
                "env_var": "GEMINI_API_KEY"}

    async def reason(self, prompt, schema_hint, *, intent, timeout):
        self.calls += 1
        self.prompts.append(prompt)
        if not self.decisions:
            return {"answer": "Out of scripted decisions.", "answered": False}
        return self.decisions.pop(0)


def with_model(stub):
    """core.commerce.model is imported inside run(), so patching the module
    attribute is what the loop will pick up."""
    import core.commerce
    core.commerce.model = stub
    sys.modules["core.commerce.model"] = stub
    return stub


def restore_model():
    import core.commerce
    core.commerce.model = commerce_model
    sys.modules["core.commerce.model"] = commerce_model


# ── bounds ───────────────────────────────────────────────────────────────────

def check_bounds() -> None:
    print("\nbounds")
    d = bounds.describe()
    check(d["question_chars_max"] == 500, "a question is capped at 500 characters",
          str(d["question_chars_max"]))
    check(d["tool_calls_max"] <= 5, "a turn cannot call tools without limit",
          str(d["tool_calls_max"]))
    check(d["turn_deadline_seconds"] <= 90, "a turn has a wall clock",
          f"{d['turn_deadline_seconds']}s")

    b = bounds.Budget()
    ip = "203.0.113.7"
    first_ok, _ = b.check(ip)
    check(first_ok, "an address inside its allowance is served")
    for _ in range(bounds.PER_IP_QUESTIONS):
        b.record(ip)
    ok, why = b.check(ip)
    check(not ok and why["limit"] == "per_ip", "an address over its allowance is refused",
          f"after {bounds.PER_IP_QUESTIONS}")
    check(why["retry_after_seconds"] > 0, "the refusal says when it clears",
          f"{why['retry_after_seconds']}s")

    ok, _ = b.check("198.51.100.4")
    check(ok, "another address is unaffected")

    # The table cannot grow with the internet.
    big = bounds.Budget()
    for i in range(bounds.MAX_TRACKED_IPS + 200):
        big.record(f"10.0.{i // 256}.{i % 256}")
        big.check("10.0.0.1")
    check(big.snapshot()["addresses_tracked"] <= bounds.MAX_TRACKED_IPS,
          "the per-address table is capped",
          f"{big.snapshot()['addresses_tracked']} entries")

    # The process cap is not spoofable by changing address.
    proc = bounds.Budget()
    for i in range(bounds.PROCESS_QUESTIONS_PER_HOUR):
        proc.record(f"192.0.2.{i % 250}")
    ok, why = proc.check("192.0.2.251")
    check(not ok and why["limit"] == "process",
          "the hourly cap holds across every address", str(why.get("allowed")))

    g = bounds.Gate(limit=2)
    check(g.acquire() and g.acquire(), "two turns at a time are allowed")
    check(not g.acquire(), "a third is refused rather than queued")
    g.release()
    check(g.acquire(), "and the slot returns when a turn finishes")


# ── guards ───────────────────────────────────────────────────────────────────

def check_guards() -> None:
    print("\nguards")
    ev = [{"tool": "tnega_get", "measured": "one record", "withheld_reason": None}]
    out, fired = grounding.guard("what is here", "Anything at all.", evidence=[])
    check(fired == ["no_evidence"], "an answer with no evidence is replaced")
    check("nothing to answer it with" in out, "and says so in words")

    q = "which agent should I hire"
    check(grounding.is_ranking_question(q), "a hiring question is recognised")
    out, fired = grounding.guard(q, "Hire agent 7, it is verified.", evidence=ev)
    check("ranking_without_limits" in fired, "a bare recommendation is corrected")
    check("17 distinct client wallets" in out, "the correction carries the measurement")
    check("61 owner addresses" in out, "and the served slice against the store")

    already = ("Nothing here ranks agents. 17 client wallets fund the whole "
               "verified set.")
    _out, fired = grounding.guard(q, already, evidence=ev)
    check("ranking_without_limits" not in fired,
          "an answer that already carries the limits is left alone")

    out, fired = grounding.guard("what is here",
                                 "A dash — and **bold** text in a sentence.",
                                 evidence=ev)
    check("—" not in out and "*" not in out, "the register is enforced, not asked for",
          repr(out))
    check("register" in fired, "and the change is reported")

    withheld = [{"tool": "tnega_get", "measured": "one record from hyperliquid.post_only",
                 "withheld_reason": "not_tracked"}]
    out, fired = grounding.guard("is it a good maker", "not_tracked", evidence=withheld)
    check("bare_answer" in fired, "a field value is not an answer")
    check("not_tracked" in out and "tnega_get" in out,
          "the replacement names the reason and where it came from")
    out, fired = grounding.guard("is it a good maker", "Yes.", evidence=withheld)
    check("bare_answer" in fired, "and neither is one word")

    rules = grounding.system_rules()
    for needle in ("17 distinct client wallets", "61 owner addresses",
                   "roughly 15,000", "not a quality ranking",
                   "withheld_reason is an answer"):
        check(needle in rules, f"the prompt states: {needle}")


# ── the loop ─────────────────────────────────────────────────────────────────

def check_loop() -> None:
    print("\nthe loop")

    stub = with_model(StubModel([
        {"tool": "tnega_summary", "arguments": {"dataset": "agents.index"}},
        {"answer": "There are 120 agents in the synthetic index.", "answered": True},
    ]))
    out = run(loop.run_bounded("how many agents are there", DATASETS))
    check(out["answered"], "a turn that reads and then answers is answered")
    check(len(out["evidence"]) == 2, "the catalogue and the call are both evidence",
          f"{len(out['evidence'])} entries")
    first = out["evidence"][0]
    check(first["tool"] == "tnega_catalogue", "the catalogue is read first")
    check(first["replay"]["method"] == "tools/call",
          "evidence carries a body that reproduces it")
    check(out["evidence"][1]["arguments"] == {"dataset": "agents.index"},
          "the arguments are carried, not just the tool name")
    check(out["evidence"][1]["coverage"] is not None, "and the coverage it reported")

    # The shapes the Flash models actually write a decision in, measured
    # 2026-09-17: name instead of tool, input instead of arguments.
    with_model(StubModel([
        {"name": "tnega_summary", "input": {"dataset": "agents.index"}},
        {"answer": "120 agents are in the index.", "answered": True},
    ]))
    out = run(loop.run_bounded("how many agents", DATASETS))
    check(out["evidence"][1]["tool"] == "tnega_summary",
          "a decision written as name and input is still read")
    check(out["evidence"][1]["arguments"] == {"dataset": "agents.index"},
          "and its arguments arrive at the handler")

    # A model that only ever calls tools stops at the budget.
    stub = with_model(StubModel(
        [{"tool": "tnega_list", "arguments": {"dataset": "agents.index"}}] * 10))
    out = run(loop.run_bounded("list everything", DATASETS))
    check(out["tool_calls"] <= bounds.MAX_TOOL_CALLS + 1,
          "the tool call budget stops the loop", f"{out['tool_calls']} calls")
    check(stub.calls <= bounds.MAX_MODEL_CALLS, "the model call budget holds",
          f"{stub.calls} calls")

    # An unknown tool name is a recoverable answer rather than an exception.
    with_model(StubModel([
        {"tool": "tnega_hire", "arguments": {}},
        {"answer": "There is no such tool.", "answered": False},
    ]))
    out = run(loop.run_bounded("hire me an agent", DATASETS))
    check(out["evidence"][1]["withheld_reason"] == "unknown_tool",
          "a tool that does not exist comes back as a reason")

    # Evidence bytes are counted and reported.
    with_model(StubModel([
        {"tool": "tnega_list", "arguments": {"dataset": "agents.index", "limit": 50}},
        {"answer": "Fifty rows were read.", "answered": True},
    ]))
    out = run(loop.run_bounded("show me some agents", DATASETS))
    check(out["evidence_bytes"] > 0, "tool output is measured",
          f"{out['evidence_bytes']} bytes")
    check(out["evidence_bytes"] <= bounds.MAX_EVIDENCE_BYTES + 32_768,
          "and stays within one page of the budget")

    # A provider failure is a refusal in words.
    class Failing(StubModel):
        async def reason(self, *a, **k):
            raise commerce_model.RateLimited("stub is rate limited.")
    with_model(Failing([]))
    out = run(loop.run_bounded("anything", DATASETS))
    check(out["degraded"] and not out["answered"], "a throttled provider degrades")
    check("could not be reached" in out["answer"], "and says what happened",
          out["answer"][:60])

    # No key configured.
    with_model(StubModel([], configured=False))
    out = run(loop.run_bounded("anything", DATASETS))
    check(out["degraded"] and "GEMINI_API_KEY" in out["answer"],
          "an absent key is a stated refusal, not an error")

    # The wall clock.
    class Slow(StubModel):
        async def reason(self, *a, **k):
            await asyncio.sleep(5)
            return {"answer": "too late", "answered": True}
    with_model(Slow([]))
    saved = bounds.TURN_DEADLINE_SECONDS
    loop_deadline = 1.0
    bounds.TURN_DEADLINE_SECONDS = loop_deadline
    started = time.time()
    out = run(loop.run_bounded("anything", DATASETS))
    took = time.time() - started
    bounds.TURN_DEADLINE_SECONDS = saved
    check("turn_deadline" in out["guards"], "the wall clock stops a slow turn")
    check(took < 3, "and stops it when it says it will", f"{took:.1f}s")
    check(out["evidence"], "what had been read is still reported",
          f"{len(out['evidence'])} entries")

    restore_model()


def main() -> int:
    print("ask endpoint self-check")
    try:
        check_bounds()
        check_guards()
        check_loop()
    finally:
        restore_model()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: {'; '.join(FAILURES)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
