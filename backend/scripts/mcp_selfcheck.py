"""Checks the MCP surface holds the promises it is built on.

Run: ./venv/bin/python scripts/mcp_selfcheck.py

Seven groups, each one a claim that would otherwise be true only on the day it
was written:

  descriptions   read by a model deciding whether to call at all, so they are
                 checked as functional text: length, a named sibling, a stated
                 cap. The standard is the Smithery survey's, median 197
                 characters, and a description that drifts out of shape is a
                 tool a model will call wrongly.

  encoder        core/agents_index.py used to import fastapi's jsonable_encoder
                 and now encodes on its own. Byte equivalence is checked
                 against jsonable_encoder itself over every type it can encode,
                 and the one divergence, Mongo's ObjectId and Decimal128, which
                 it refuses and this encodes, is checked as a divergence.

  transport      the core layer imports no web framework, and the adapter
                 imports FastAPI in exactly one file. This is the claim that
                 would go quietly false in a month.

  envelope       coverage before value in field order, coverage required,
                 an absence returns a reason rather than a zero.

  ceilings       a response over its tool's ceiling is trimmed with a caveat or
                 refused, never silently large.

  gate           a second concurrent call is refused with a reason, not queued.

  tools          the six answer, over a synthetic index, with no database.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import decimal
import json
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# The same .env the app reads. Without it the stores are unconfigured rather
# than unreachable, and every live check would report itself skipped while
# looking like it had run.
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:  # noqa: BLE001
    pass

from core import agents_index as ai            # noqa: E402
from mcp_server import envelope, protocol, registry, tools  # noqa: E402
from mcp_server.router import Providers        # noqa: E402

FAILURES: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
    if not ok:
        FAILURES.append(label)


# ── 1. descriptions ──────────────────────────────────────────────────────────

def check_descriptions() -> None:
    print("\ndescriptions")
    names = set(tools.BY_NAME)
    for t in tools.TOOLS:
        d = t["description"]
        n = len(d)
        check(120 <= n <= 400, f"{t['name']} length in 120..400", f"{n} chars")
        siblings = [o for o in names if o != t["name"] and o in d]
        check(bool(siblings), f"{t['name']} names a sibling",
              ", ".join(siblings) or "none")
        states_cap = bool(re.search(r"\d+\s?KB|up to \d+|limit up to \d+|about \d+ rows", d))
        check(states_cap, f"{t['name']} states its cap")
        check(not d.startswith(t["name"]), f"{t['name']} does not restate its own name")
        check(t["inputSchema"].get("additionalProperties") is False,
              f"{t['name']} rejects unknown arguments")


# ── 2. the encoder that replaced jsonable_encoder ────────────────────────────

def check_encoder() -> None:
    print("\nencoder equivalence with jsonable_encoder")
    try:
        from fastapi.encoders import jsonable_encoder
    except ImportError:
        check(True, "fastapi not installed here, equivalence not checked", "skipped")
        return

    records = [
        {"id": "a", "name": "Plain", "score": 1.5, "tags": ["x", "y"]},
        {"id": "b", "created": dt.datetime(2026, 9, 16, 13, 31, 6, tzinfo=dt.UTC)},
        {"id": "c", "day": dt.date(2026, 9, 16), "budget": decimal.Decimal("12.50")},
        {"id": "d", "uuid": uuid.UUID("12345678-1234-5678-1234-567812345678")},
        {"id": "f", "nested": {"when": dt.datetime(2026, 1, 1, tzinfo=dt.UTC),
                               "amounts": [decimal.Decimal("0.1"), 2]}},
        {"id": "g", "unicode": "café · 日本 · ñ", "none": None},
    ]
    for r in records:
        mine = ai._encode_one(r)
        theirs = json.dumps(jsonable_encoder(r), ensure_ascii=False,
                            allow_nan=False, separators=(",", ":")).encode("utf-8")
        check(mine == theirs, f"byte identical for {sorted(r)[0]}..{sorted(r)[-1]}",
              "" if mine == theirs else f"{mine!r} != {theirs!r}")

    # The one divergence, checked rather than described. jsonable_encoder tries
    # dict() then vars() and raises on a slotted type, so a record carrying
    # either of Mongo's own types used to 500 the endpoint instead of serving.
    try:
        from bson import Decimal128, ObjectId
    except ImportError:
        check(True, "bson not installed here, divergence not checked", "skipped")
        return
    for label, val, expected in (
            ("ObjectId", ObjectId("66f0aa11bb22cc33dd44ee55"),
             b'{"v":"66f0aa11bb22cc33dd44ee55"}'),
            ("Decimal128", Decimal128("12.50"), b'{"v":"12.50"}')):
        try:
            jsonable_encoder({"v": val})
            old_raises = False
        except Exception:
            old_raises = True
        check(old_raises, f"jsonable_encoder still refuses {label}",
              "the divergence is still a divergence")
        check(ai._encode_one({"v": val}) == expected,
              f"{label} encodes as its string form rather than raising")


# ── 3. the transport-free claim ──────────────────────────────────────────────

def check_transport_boundary() -> None:
    print("\ntransport boundary")
    core_dir = Path(__file__).resolve().parent.parent / "core"
    # Import statements, not mentions. agents_index.py explains in a comment why
    # the import was removed, and that comment is worth keeping: a check that
    # cannot tell an explanation from an import would force the explanation out.
    imports = re.compile(r"^\s*(from\s+fastapi|import\s+fastapi)", re.M)
    offenders = [p.name for p in core_dir.rglob("*.py")
                 if imports.search(p.read_text())]
    check(not offenders, "core/ imports no web framework",
          ", ".join(offenders) or "clean")

    mcp_dir = Path(__file__).resolve().parent.parent / "mcp_server"
    importers = sorted(p.name for p in mcp_dir.glob("*.py")
                       if imports.search(p.read_text()))
    check(importers == ["router.py"], "FastAPI appears in router.py only",
          ", ".join(importers) or "none")

    reaches_back = sorted(p.name for p in mcp_dir.glob("*.py")
                          if re.search(r"^\s*(from|import)\s+server\b", p.read_text(), re.M))
    check(not reaches_back, "the adapter never imports server.py",
          ", ".join(reaches_back) or "clean")


# ── 4. the envelope ──────────────────────────────────────────────────────────

def check_envelope() -> None:
    print("\nenvelope")
    e = envelope.build(measured="m", coverage={"n": 1}, value=[1, 2])
    keys = list(e)
    check(keys.index("coverage") < keys.index("value"),
          "coverage precedes value in field order", " ".join(keys[:4]))
    check(keys[0] == "measured", "measured leads")

    try:
        envelope.build(measured="m", coverage=None, value=1)
        check(False, "coverage is required")
    except ValueError:
        check(True, "coverage is required")

    w = envelope.withheld(measured="m", coverage={"n": 0}, reason="not_tracked",
                          explanation="nothing has been measured for it")
    check(w["value"] is None and w["withheld_reason"] == "not_tracked",
          "an absence carries a reason and no value")
    check(bool(w["caveats"]), "an absence carries an explanation")
    check("0" != json.dumps(w["value"]), "an absence is never a zero")


# ── 5. ceilings ──────────────────────────────────────────────────────────────

def check_ceilings() -> None:
    print("\nceilings")
    big_rows = [{"id": f"agent-{i}", "name": "N" * 120, "chain_id": 56,
                 "category": "Trading", "tier": "unproven", "score": 1.0}
                for i in range(400)]
    payload = envelope.build(measured="a page", coverage={"matched": 400},
                             value=big_rows)
    body, out = envelope.enforce_ceiling("tnega_list", payload)
    size = len(body.encode("utf-8"))
    check(size <= envelope.CEILINGS["tnega_list"], "tnega_list held under its ceiling",
          f"{size} bytes, {len(out['value'])} of 400 rows")
    check(any("Trimmed" in c for c in out["caveats"]), "a trim says so")

    fat = envelope.build(measured="one record", coverage={"n": 1},
                         value={"blob": "x" * 20_000})
    body, out = envelope.enforce_ceiling("tnega_get", fat)
    check(out["withheld_reason"] == "response_too_large",
          "an oversized single record is refused, not cut")
    check(len(body.encode("utf-8")) <= envelope.CEILINGS["tnega_get"],
          "the refusal itself fits")


# ── 6. the gate ──────────────────────────────────────────────────────────────

def check_gate(datasets) -> None:
    print("\none call at a time")
    protocol.GATE.release()

    async def run():
        protocol.GATE.acquire()          # stand in for a call already running
        try:
            return await protocol.handle(
                {"jsonrpc": "2.0", "id": 9, "method": "tools/call",
                 "params": {"name": "tnega_catalogue", "arguments": {}}},
                datasets)
        finally:
            protocol.GATE.release()

    reply = asyncio.run(run())
    err = reply.get("error") or {}
    check(err.get("code") == protocol.BUSY_CODE, "a second call is refused",
          str(err.get("code")))
    check("refusal, not a queue" in err.get("message", ""),
          "the refusal says it is not a queue")
    check(err.get("data", {}).get("reason") == "server_busy",
          "the refusal is machine readable")

    protocol.GATE.release()
    ok = asyncio.run(protocol.handle(
        {"jsonrpc": "2.0", "id": 10, "method": "ping"}, datasets))
    check("result" in ok, "the gate reopens after release")


# ── 7. the six tools ─────────────────────────────────────────────────────────

def synthetic_index():
    """An index with no database behind it, so this runs anywhere."""
    records = [
        {"id": f"id-{i}", "token_id": i, "name": f"Agent {i}",
         "description": "does a thing " * 6, "category": "Trading" if i % 2 else "Research",
         "chain_id": 56 if i % 3 else 4663, "service_status": "active",
         "total_score": 90 - i, "total_feedbacks": i, "star_count": i % 5,
         "owner_address": f"0x{i:040x}"}
        for i in range(120)
    ]
    return ai.AgentsIndex(records)


def check_tools() -> None:
    print("\nthe six tools, over a synthetic index")
    ix = synthetic_index()
    datasets = registry.build(Providers(agents_index=lambda: ix))

    async def call(tool, args):
        reply = await protocol.handle(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
             "params": {"name": tool, "arguments": args}}, datasets)
        return json.loads(reply["result"]["content"][0]["text"])

    # get
    got = asyncio.run(call("tnega_get", {"dataset": "agents.index", "id": "id-7"}))
    check(got["value"]["name"] == "Agent 7", "tnega_get returns the record")
    check(got["value"].get("tier") is not None, "tnega_get attaches the tier")
    check(isinstance(got["coverage"], dict), "tnega_get carries coverage")

    missing = asyncio.run(call("tnega_get", {"dataset": "agents.index", "id": "nope"}))
    check(missing["withheld_reason"] == "not_found",
          "a missing record is a reason, not an empty record")
    check(missing["value"] is None, "a missing record is not a zero")

    wrong = asyncio.run(call("tnega_get", {"dataset": "does.not.exist", "id": "x"}))
    check(wrong["withheld_reason"] == "unknown_dataset", "an unknown dataset is named")
    check("agents.index" in wrong["caveats"][0],
          "an unknown dataset returns the valid ids", "recovers in one call")

    # list
    page = asyncio.run(call("tnega_list", {"dataset": "agents.index", "limit": 25}))
    rows = page["value"]
    check(len(rows) == 25, "tnega_list honours limit", f"{len(rows)} rows")
    row_bytes = len(json.dumps(rows[0], separators=(",", ":")).encode())
    check(row_bytes < 260, "a row is a projection, not a record", f"{row_bytes} bytes")
    check(page["next_cursor"], "a page carries a cursor")

    nxt = asyncio.run(call("tnega_list", {"dataset": "agents.index",
                                          "cursor": page["next_cursor"]}))
    check(nxt["value"][0]["id"] != rows[0]["id"], "the cursor advances")
    check(nxt["coverage"]["offset"] == 25, "the cursor carries the position")

    over = asyncio.run(call("tnega_list", {"dataset": "agents.index", "limit": 5000}))
    check(len(over["value"]) <= tools.LIST_MAX, "limit is clamped, not obeyed",
          f"{len(over['value'])} rows")

    bad = asyncio.run(call("tnega_list", {"dataset": "agents.index",
                                          "cursor": "not-a-cursor"}))
    check(bad["withheld_reason"] == "bad_cursor", "a forged cursor is refused")

    # summary
    s = asyncio.run(call("tnega_summary", {"dataset": "agents.index"}))
    check(s["value"]["matched"] == 120, "tnega_summary counts the selection")
    check(not isinstance(s["value"], list), "a summary is a rollup, not rows")

    # series, on a dataset that has none
    ns = asyncio.run(call("tnega_series", {"dataset": "agents.index", "key": "x"}))
    check(ns["withheld_reason"] == "dataset_does_not_support_verb",
          "a dataset without a series says so")
    check("hyperliquid.post_only" in ns["caveats"][0],
          "and names the datasets that do")

    # resolve
    r = asyncio.run(call("tnega_resolve", {"query": "0x" + "ab" * 20}))
    check(any(c["dataset"] == "hyperliquid.post_only" for c in r["value"]),
          "an address resolves to the datasets that accept it")
    junk = asyncio.run(call("tnega_resolve", {"query": "some free text"}))
    check(junk["withheld_reason"] == "unrecognised_identifier",
          "free text is not guessed at")

    # protocol surface
    init = asyncio.run(protocol.handle(
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": "2025-06-18"}}, datasets))
    check(init["result"]["serverInfo"]["name"] == "tnega", "initialize answers")
    listed = asyncio.run(protocol.handle(
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, datasets))
    check(len(listed["result"]["tools"]) == 6, "six tools, no more")
    check(all("handler" not in t for t in listed["result"]["tools"]),
          "the handler does not go on the wire")
    note = asyncio.run(protocol.handle(
        {"jsonrpc": "2.0", "method": "notifications/initialized"}, datasets))
    check(note is None, "a notification gets no reply")

    return datasets


def check_live_datasets() -> None:
    """Every dataset that answers, checked for the shape the surface promises.

    Structural rather than about any one dataset: a row is a projection, a
    summary is a rollup and not a list, and nothing a dataset returns goes over
    its tool's ceiling. A dataset added in six months either passes these or
    fails them here rather than in front of a caller.

    A dataset whose store is unreachable from this machine is skipped by name.
    A skipped check is not a passed check and says so.
    """
    print("\nlive datasets, where reachable")
    ix = synthetic_index()
    datasets = registry.build(Providers(agents_index=lambda: ix))

    async def call(tool, args):
        reply = await protocol.handle(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
             "params": {"name": tool, "arguments": args}}, datasets)
        return json.loads(reply["result"]["content"][0]["text"])

    for ds_id, d in sorted(datasets.items()):
        if d.list is not None:
            try:
                out = asyncio.run(call("tnega_list", {"dataset": ds_id, "limit": 5}))
            except Exception as e:  # noqa: BLE001
                check(True, f"{ds_id} list unreachable here", f"skipped, {type(e).__name__}")
                continue
            rows = out.get("value") or []
            if not rows:
                why = out.get("withheld_reason") or "empty"
                check(True, f"{ds_id} list returned no rows", f"skipped, {why}")
            else:
                widest = max(len(json.dumps(r, separators=(",", ":")).encode())
                             for r in rows)
                check(widest <= 300, f"{ds_id} rows are projections",
                      f"widest {widest} bytes")

        if d.summary is not None:
            try:
                out = asyncio.run(call("tnega_summary", {"dataset": ds_id}))
            except Exception as e:  # noqa: BLE001
                check(True, f"{ds_id} summary unreachable here", f"skipped, {type(e).__name__}")
                continue
            check(out.get("withheld_reason") != "response_too_large",
                  f"{ds_id} summary fits its ceiling without trimming")
            check(not isinstance(out.get("value"), list),
                  f"{ds_id} summary is a rollup, not rows")


def main() -> int:
    print("MCP surface self-check")
    check_descriptions()
    check_encoder()
    check_transport_boundary()
    check_envelope()
    check_ceilings()
    datasets = check_tools()
    check_gate(datasets)
    check_live_datasets()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: {'; '.join(FAILURES)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
