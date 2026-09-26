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

# One event loop for the whole run.
#
# run() creates a loop and closes it. motor binds its client to the
# first loop it is used on, so the second asyncio.run in a process raises
# "Event loop is closed" for every Mongo-backed call. Before this, the live
# dataset checks reported chains.agents and budgets.escrow as unreachable and
# passed, which read as a local configuration gap and was this file never
# exercising them at all.
LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(LOOP)


def run(coro):
    return LOOP.run_until_complete(coro)


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
    if not ok:
        FAILURES.append(label)


# ── 0. annotations ───────────────────────────────────────────────────────────
#
# THE IDENTITY STATEMENT, WHERE A MACHINE CAN READ IT.
#
# "It reads. It cannot spend anything, sign anything, or hire anyone." That
# sentence sits in the Chrome Web Store listing and in the docs, which is to
# say it is prose: a person can read it and nothing can enforce it. MCP has a
# field for the same claim, and a client can refuse a tool on it.
#
# So this checks the claim is actually made, on every tool, rather than
# assumed. It cannot check the claim is TRUE, which is what a reviewer reading
# the handlers is for; it can check the surface does not quietly stop making
# it, which is how it would be lost.

def check_annotations() -> None:
    print("\nannotations")
    for t in tools.TOOLS:
        a = t.get("annotations") or {}
        check(bool(a), f"{t['name']} declares annotations")
        check(a.get("readOnlyHint") is True,
              f"{t['name']} says it writes nothing",
              "readOnlyHint")
        check(a.get("destructiveHint") is False,
              f"{t['name']} says it destroys nothing",
              "destructiveHint")
        check(isinstance(a.get("openWorldHint"), bool),
              f"{t['name']} states whether it reaches outside",
              f"openWorldHint={a.get('openWorldHint')}")
        check(isinstance(a.get("title"), str) and len(a.get("title", "")) > 4,
              f"{t['name']} carries a readable title")

    # And the guard itself works. A check that cannot fail is decoration.
    import copy
    saved = copy.deepcopy(tools.TOOLS)
    try:
        tools.TOOLS[0].pop("annotations", None)
        try:
            tools.manifest()
            check(False, "manifest refuses a tool with no annotations",
                  "it did not")
        except RuntimeError:
            check(True, "manifest refuses a tool with no annotations")
    finally:
        tools.TOOLS[:] = saved


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


# ── 2b. one encoder, both transports ─────────────────────────────────────────

def check_one_encoder() -> None:
    """The REST path and the MCP path encode the same value the same way.

    They did not. Cockroach returns a rejection rate as a Decimal; the REST
    encoder had a Decimal branch and the MCP envelope had its own shorter
    default that did not, so the same field shipped as 0.955... over one
    transport and "0.955..." over the other. A model doing arithmetic on the
    string gets a TypeError, which is a worse failure than a wrong number
    because it happens somewhere else.
    """
    print("\none encoder, both transports")
    from mcp_server import envelope as env
    cases = [
        ("Decimal", decimal.Decimal("0.9554368932038834951456310680")),
        ("datetime", dt.datetime(2026, 9, 16, 13, 31, 6, tzinfo=dt.UTC)),
        ("UUID", uuid.UUID("12345678-1234-5678-1234-567812345678")),
    ]
    for label, val in cases:
        rest = ai._encode_one({"v": val}).decode()
        mcp = env.encode({"v": val})
        check(rest == mcp, f"{label} encodes identically on both paths",
              rest if rest == mcp else f"{rest} != {mcp}")

    rate = json.loads(env.encode({"v": decimal.Decimal("0.42")}))["v"]
    check(isinstance(rate, float), "a rate is a number, not a string",
          f"{type(rate).__name__}")


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


# ── 3b. no licensed third-party data behind MCP or the public API ────────────
#
# The owner's decision, 2026-09-25: Zerion data is shown in Tnega's own
# frontend only; nothing Zerion-sourced goes through MCP or any public API
# unless Zerion agrees in writing. Jupiter, LI.FI and Coinbase data are held
# to the same rule. Checked two ways over the import closure:
#
#   modules   no module known to call one of them, and no module named for
#             one, so a dataset reaching Zerion through core/pnl.py is caught
#             as surely as one importing it directly.
#   literals  no string literal in any module of the closure names one of
#             their hosts or Zerion, which is what a new adapter's base URL,
#             or a sentence served to a caller, would look like. Docstrings
#             and comments are not literals a caller can receive and are not
#             scanned, so a file may still explain where its data comes from.

_LICENSED_CONSUMERS = {"adapters.zerion", "core.pnl", "core.onchain_pnl",
                       "core.onchain_history", "core.agent_evaluation"}
_LICENSED_MODULE_NAME = re.compile(r"zerion|jupiter|lifi|li_fi|coinbase", re.I)
_LICENSED_LITERAL = re.compile(r"jup\.ag|li\.quest|api\.coinbase\.com|zerion", re.I)


def _import_closure(starts: list[str]) -> dict:
    import ast
    root = Path(__file__).resolve().parent.parent

    def modfile(m):
        f = root / (m.replace(".", "/") + ".py")
        if f.exists():
            return f
        f = root / m.replace(".", "/") / "__init__.py"
        return f if f.exists() else None

    def imports_of(m):
        f = modfile(m)
        if not f:
            return set()
        pkg = m if f.name == "__init__.py" else m.rpartition(".")[0]
        out = set()
        for n in ast.walk(ast.parse(f.read_text())):
            if isinstance(n, ast.Import):
                out.update(a.name for a in n.names)
            elif isinstance(n, ast.ImportFrom):
                base = n.module or ""
                if n.level:
                    parts = pkg.split(".")
                    parts = parts[:len(parts) - n.level + 1] if n.level > 1 else parts
                    base = ".".join(parts + ([base] if base else []))
                out.add(base)
                out.update(f"{base}.{a.name}" for a in n.names)
        return {o for o in out if modfile(o)}

    parent: dict = {}
    stack = [(s, None) for s in starts]
    while stack:
        m, via = stack.pop()
        if m in parent:
            continue
        parent[m] = via
        stack.extend((i, m) for i in imports_of(m))
    return parent


def _licensed_literals(source: str) -> list[tuple[int, str]]:
    """String literals naming a licensed source, with their line numbers.

    Docstrings are skipped: an expression statement that is only a string is
    documentation, not a value anything returns.
    """
    import ast
    tree = ast.parse(source)
    docstrings = {id(n.value) for n in ast.walk(tree)
                  if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)
                  and isinstance(n.value.value, str)}
    hits = []
    for n in ast.walk(tree):
        if (isinstance(n, ast.Constant) and isinstance(n.value, str)
                and id(n) not in docstrings and _LICENSED_LITERAL.search(n.value)):
            hits.append((n.lineno, n.value[:60]))
    return hits


def _modfile(root: Path, m: str) -> Path | None:
    f = root / (m.replace(".", "/") + ".py")
    if f.exists():
        return f
    f = root / m.replace(".", "/") / "__init__.py"
    return f if f.exists() else None


def check_licensed_boundary() -> None:
    print("\nlicensed-source boundary (Zerion, Jupiter, LI.FI, Coinbase)")

    # The scanner catches what it is for, and ignores what it is not for. A
    # check that cannot fail is decoration.
    planted = ('"""Reads from Zerion."""\n'
               '# zerion is the source\n'
               'URL = "https://api.zerion.io/v1"\n'
               'Q = "https://li.quest/v1/quote"\n'
               'J = "https://lite-api.jup.ag/price"\n'
               'C = "https://api.coinbase.com/v2/prices"\n')
    found = _licensed_literals(planted)
    check(len(found) == 4, "the literal scan catches all four hosts and skips "
          "docstrings and comments", f"{len(found)} of 4")

    root = Path(__file__).resolve().parent.parent
    for pkg in ("mcp_server", "publicapi", "telegram_bot"):
        starts = [f"{pkg}.{p.stem}" if p.stem != "__init__" else pkg
                  for p in (root / pkg).glob("*.py")]
        closure = _import_closure(starts)

        def path_to(h):
            chain = [h]
            while closure.get(chain[-1]):
                chain.append(closure[chain[-1]])
            return " <- ".join(chain)

        hits = sorted((_LICENSED_CONSUMERS & set(closure))
                      | {m for m in closure if _LICENSED_MODULE_NAME.search(m)})
        check(not hits, f"{pkg}/ imports no licensed-source module",
              "; ".join(path_to(h) for h in hits)
              or f"{len(closure)} modules, clean")

        literal_hits = []
        for m in sorted(closure):
            f = _modfile(root, m)
            if f is None:
                continue
            for line, text in _licensed_literals(f.read_text()):
                literal_hits.append(f"{f.relative_to(root)}:{line} {text!r}")
        check(not literal_hits,
              f"{pkg}/ closure holds no string naming a licensed source",
              "; ".join(literal_hits) or "clean")


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

    check(out["coverage"]["partial"] is True, "a trim sets partial",
          repr(out["coverage"].get("partial")))

    # THE CURSOR AFTER A TRIM starts at the first row not sent. The list tool
    # computed its cursor from the page it built; a trim that kept that cursor
    # skipped every trimmed row with nothing to say they were lost.
    offset = 100
    walked = envelope.build(
        measured="a page", coverage={"matched": 1000, "offset": offset},
        value=big_rows, next_cursor=tools._cursor_encode("agents.index", offset + 400, {"chain_id": 56}),
        resume=lambda kept: tools._cursor_encode("agents.index", offset + len(kept), {"chain_id": 56}))
    body, out = envelope.enforce_ceiling("tnega_list", walked)
    kept = len(out["value"])
    cur = tools._cursor_decode(out["next_cursor"] or "") or {}
    check(len(body.encode()) <= envelope.CEILINGS["tnega_list"],
          "a trimmed page, caveat and cursor included, fits", f"{len(body.encode())} bytes")
    check(cur.get("o") == offset + kept and cur.get("f") == {"chain_id": 56},
          "a trimmed list's cursor is offset plus rows kept",
          f"o={cur.get('o')}, expected {offset + kept}")

    points = [{"t": f"2026-09-19T09:{59 - i // 6:02d}:{(5 - i % 6) * 10:02d}+00:00",
               "updates": 700 + i, "rejected": i % 7, "pad": "p" * 90}
              for i in range(200)]
    series = envelope.build(
        measured="a series", coverage={"points": 200}, value=points,
        next_cursor=points[-1]["t"],
        resume=lambda kept: kept[-1]["t"] if kept else None)
    body, out = envelope.enforce_ceiling("tnega_series", series)
    kept = len(out["value"])
    check(kept < 200 and out["next_cursor"] == points[kept - 1]["t"],
          "a trimmed series continues from the last point kept",
          f"{kept} kept, cursor {out['next_cursor']}")
    check(out["coverage"]["partial"] is True, "a trimmed series says partial")

    # No cursor to give: the dropped rows are named, not only counted.
    named = envelope.build(
        measured="rows", coverage={"n": 30},
        value=[{"id": f"row-{i}", "text": "t" * 600} for i in range(30)])
    body, out = envelope.enforce_ceiling("tnega_get", named)
    kept = len(out["value"])
    note = out["caveats"][-1]
    check(out["next_cursor"] is None and all(f"row-{i}" in note for i in range(kept, 30)),
          "a trim with no cursor names every row it dropped",
          f"{30 - kept} dropped")

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

    async def while_one_is_running():
        protocol.GATE.acquire()          # stand in for a call already running
        try:
            return await protocol.handle(
                {"jsonrpc": "2.0", "id": 9, "method": "tools/call",
                 "params": {"name": "tnega_catalogue", "arguments": {}}},
                datasets)
        finally:
            protocol.GATE.release()

    reply = run(while_one_is_running())
    err = reply.get("error") or {}
    check(err.get("code") == protocol.BUSY_CODE, "a second call is refused",
          str(err.get("code")))
    check("refusal, not a queue" in err.get("message", ""),
          "the refusal says it is not a queue")
    check(err.get("data", {}).get("reason") == "server_busy",
          "the refusal is machine readable")

    protocol.GATE.release()
    ok = run(protocol.handle(
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
    got = run(call("tnega_get", {"dataset": "agents.index", "id": "id-7"}))
    check(got["value"]["name"] == "Agent 7", "tnega_get returns the record")
    check(got["value"].get("tier") is not None, "tnega_get attaches the tier")
    check(isinstance(got["coverage"], dict), "tnega_get carries coverage")

    missing = run(call("tnega_get", {"dataset": "agents.index", "id": "nope"}))
    check(missing["withheld_reason"] == "not_found",
          "a missing record is a reason, not an empty record")
    check(missing["value"] is None, "a missing record is not a zero")

    wrong = run(call("tnega_get", {"dataset": "does.not.exist", "id": "x"}))
    check(wrong["withheld_reason"] == "unknown_dataset", "an unknown dataset is named")
    check("agents.index" in wrong["caveats"][0],
          "an unknown dataset returns the valid ids", "recovers in one call")

    # list
    page = run(call("tnega_list", {"dataset": "agents.index", "limit": 25}))
    rows = page["value"]
    check(len(rows) == 25, "tnega_list honours limit", f"{len(rows)} rows")
    row_bytes = len(json.dumps(rows[0], separators=(",", ":")).encode())
    check(row_bytes < 260, "a row is a projection, not a record", f"{row_bytes} bytes")
    check(page["next_cursor"], "a page carries a cursor")

    nxt = run(call("tnega_list", {"dataset": "agents.index",
                                          "cursor": page["next_cursor"]}))
    check(nxt["value"][0]["id"] != rows[0]["id"], "the cursor advances")
    check(nxt["coverage"]["offset"] == 25, "the cursor carries the position")

    over = run(call("tnega_list", {"dataset": "agents.index", "limit": 5000}))
    check(len(over["value"]) <= tools.LIST_MAX, "limit is clamped, not obeyed",
          f"{len(over['value'])} rows")

    bad = run(call("tnega_list", {"dataset": "agents.index",
                                          "cursor": "not-a-cursor"}))
    check(bad["withheld_reason"] == "bad_cursor", "a forged cursor is refused")

    # summary
    s = run(call("tnega_summary", {"dataset": "agents.index"}))
    check(s["value"]["matched"] == 120, "tnega_summary counts the selection")
    check(not isinstance(s["value"], list), "a summary is a rollup, not rows")

    # series, on a dataset that has none
    ns = run(call("tnega_series", {"dataset": "agents.index", "key": "x"}))
    check(ns["withheld_reason"] == "dataset_does_not_support_verb",
          "a dataset without a series says so")
    check("hyperliquid.post_only" in ns["caveats"][0],
          "and names the datasets that do")

    # resolve
    r = run(call("tnega_resolve", {"query": "0x" + "ab" * 20}))
    check(any(c["dataset"] == "hyperliquid.post_only" for c in r["value"]),
          "an address resolves to the datasets that accept it")
    junk = run(call("tnega_resolve", {"query": "some free text"}))
    check(junk["withheld_reason"] == "unrecognised_identifier",
          "free text is not guessed at")

    # protocol surface
    init = run(protocol.handle(
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": "2025-06-18"}}, datasets))
    check(init["result"]["serverInfo"]["name"] == "tnega", "initialize answers")
    listed = run(protocol.handle(
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, datasets))
    check(len(listed["result"]["tools"]) == 6, "six tools, no more")
    check(all("handler" not in t for t in listed["result"]["tools"]),
          "the handler does not go on the wire")
    note = run(protocol.handle(
        {"jsonrpc": "2.0", "method": "notifications/initialized"}, datasets))
    check(note is None, "a notification gets no reply")

    return datasets


def check_audit_findings(datasets) -> None:
    """The rules an external audit of the live surface found broken.

    Each of these is a promise the surface makes about itself, checked here so
    the next dataset cannot quietly break one again.
    """
    print("\nrules an audit found broken")
    ix = synthetic_index()
    ds = registry.build(Providers(agents_index=lambda: ix))

    async def call(tool, args):
        reply = await protocol.handle(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
             "params": {"name": tool, "arguments": args}}, ds)
        return json.loads(reply["result"]["content"][0]["text"])

    # Coverage says partial, always, from every tool rather than only the
    # catalogue.
    for tool, args in (("tnega_catalogue", {}),
                       ("tnega_get", {"dataset": "agents.index", "id": "id-3"}),
                       ("tnega_list", {"dataset": "agents.index", "limit": 2}),
                       ("tnega_summary", {"dataset": "agents.index"})):
        out = run(call(tool, args))
        check("partial" in out["coverage"], f"{tool} coverage states partial",
              repr(out["coverage"].get("partial")))

    # A filter that matches nothing is a reason, not a row of zeros.
    empty = run(call("tnega_summary", {"dataset": "agents.index", "chain_id": 999}))
    check(empty["withheld_reason"] == "no_matches",
          "an empty selection is withheld, not zeroed", repr(empty["withheld_reason"]))
    check(empty["value"] is None, "an empty selection carries no counts")
    emptyl = run(call("tnega_list", {"dataset": "agents.index", "chain_id": 999}))
    check(emptyl["withheld_reason"] == "no_matches", "the same for a page")

    # The identifier comes back whole.
    addr = "0x" + "ab" * 20
    r = run(call("tnega_resolve", {"query": addr}))
    check(addr in r["measured"], "resolve echoes the key it was given",
          f"{len(addr)} chars in, {'whole' if addr in r['measured'] else 'cut'}")

    # One category answer, not two.
    row = run(call("tnega_list", {"dataset": "agents.index", "limit": 1}))["value"][0]
    rec = run(call("tnega_get", {"dataset": "agents.index", "id": row["id"]}))["value"]
    check(rec.get("category") == row.get("category"),
          "the record and the row agree on category",
          f"{rec.get('category')!r} vs {row.get('category')!r}")

    # A tier that claims delivery can be checked against the record that proves
    # it, which means the proving field has to be in that record.
    from core import job_index
    src = Path(job_index.__file__).read_text()
    check('"submitted": counts["SUBMITTED"]' in src,
          "the job record reports submitted, not only active")
    check('"completion_rate_basis"' in src,
          "completion_rate ships with its denominator")


# ── the catalogue at production size ─────────────────────────────────────────
#
# Captured from production on 2026-09-25, when tnega_catalogue answered with
# 4 of its 6 rows under an 8KB ceiling and said so only in a caveat. These
# are the coverage blocks each dataset returned that day, so the check runs
# at the size that failed rather than at the synthetic index's.

PRODUCTION_COVERAGE = {
    "agents.index": {
        "agents": 15000, "selectable": 14880,
        "tiers": {"verified": 27, "canary_verified": 0, "responding": 1259,
                  "unproven": 11, "unchecked": 13583},
        "liveness_coverage": {
            "selected": 14880, "never_attempted": 13197, "attempted": 1683,
            "reached": 1291, "unresolved": 392, "responding": 1279,
            "measured": "service_status, every term, one pass over one selection",
            "window": "any_check_on_record", "response_rate_of_reached": 0.9907,
            "reach_rate_of_attempted": 0.7671, "reach_failure_is_ours": True,
            "withheld_reason": {"code": "health_not_checked", "detail": (
                "13197 of 14880 agents in this selection have never been "
                "health-checked at all. No rate is published over them: an agent "
                "we never attempted is not an agent that failed to answer, and "
                "counting it as one would describe our coverage rather than the "
                "agents. Of the 1683 we did attempt, we reached 1291 and 1279 of "
                "those answered; the 392 we could not resolve are our own "
                "failure, not theirs.")}},
        "chains": [56], "registry_last_seen_at": "2026-09-25T19:00:00.123456+00:00",
        "partial": False},
    "budgets.escrow": {
        "agents_with_budgets": 4, "agents_with_a_rate": 0,
        "chains_indexed_at": {"4663": "2026-09-25T20:21:43+00:00",
                              "42161": "2026-09-25T20:21:43+00:00",
                              "56": "2026-09-15T05:47:55+00:00"},
        "oldest_chain_indexed_at": "2026-09-15T05:47:55+00:00", "partial": False},
    "chains.agents": {
        "views": {"ethereum": 31442, "solana": 1490, "arbitrum": 1450,
                  "robinhood": 4700, "monad": 10172},
        "agents": 49254, "chain_ids": [1, 101, 143, 4663, 42161],
        "ingest_last_success_at": {"ethereum": "2026-09-25T20:36:10+00:00",
                                   "solana": "2026-09-25T11:23:09+00:00",
                                   "monad": "2026-09-22T11:09:04+00:00",
                                   "robinhood": "2026-09-23T03:46:46+00:00",
                                   "arbitrum": "2026-09-25T16:51:52+00:00"},
        "ingest_no_recorded_success": [],
        "oldest_ingest_success_at": "2026-09-22T11:09:04+00:00", "partial": False},
    "chains.views": {
        "views": 7, "ids": ["hyperliquid", "bnb", "ethereum", "solana",
                            "arbitrum", "robinhood", "monad"], "partial": False},
    "hyperliquid.post_only": {
        "polls": 36063, "addresses": 74, "addresses_tracked": 38,
        "addresses_polled_last_hour": 38,
        "targets_refreshed_at": "2026-09-25T09:33:26.716677+00:00",
        "orders_observed": 70035463,
        "first_poll": "2026-09-15T09:14:50.296618+00:00",
        "last_poll": "2026-09-25T20:25:40.541079+00:00",
        "hours_covered": 251.18, "polls_with_gap": 26182,
        "min_polls_for_rate": 5, "partial": False},
    "jobs.erc8183": {
        "_id": "agentic_commerce", "next_job_id": 56801,
        "job_counter_at_last_run": 56800, "total_indexed": 56800,
        "started_at": 1787932984.676318, "last_run_at": 1790354721.9729376,
        "completed_at": 1787933427.4191291, "deliverable_backfill_next_id": 1,
        "recheck_next_id": 38685, "last_pass_completed_at": 1790368200.5,
        "last_pass_reached_head": True, "partial": False},
}


def check_catalogue_at_production_size() -> None:
    print("\nthe catalogue at production size")
    import dataclasses
    ix = synthetic_index()
    real = registry.build(Providers(agents_index=lambda: ix))
    check(set(real) == set(PRODUCTION_COVERAGE),
          "the fixture covers every registered dataset",
          ", ".join(sorted(set(real) ^ set(PRODUCTION_COVERAGE))) or "all six")
    fixed = {k: dataclasses.replace(d, coverage=(lambda c=PRODUCTION_COVERAGE[k]: dict(c)))
             for k, d in real.items()}

    reply = run(protocol.handle(
        {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
         "params": {"name": "tnega_catalogue", "arguments": {}}}, fixed))
    text = reply["result"]["content"][0]["text"]
    out = json.loads(text)
    rows = out["value"] or []
    check(len(rows) == len(PRODUCTION_COVERAGE), "every dataset is in the catalogue",
          f"{len(rows)} rows, {len(text.encode())} bytes of "
          f"{envelope.CEILINGS['tnega_catalogue']}")
    check(out["coverage"]["partial"] is False, "and partial is false")
    check(not any("Trimmed" in c for c in out["caveats"]), "and nothing was trimmed")
    check(all("caveats" not in r for r in rows),
          "catalogue rows carry no per-dataset caveats")
    # Headroom, so that the next dataset does not quietly put the catalogue
    # back where it was.
    check(len(text.encode()) <= envelope.CEILINGS["tnega_catalogue"] * 0.75,
          "the catalogue leaves a quarter of its ceiling spare",
          f"{len(text.encode())} bytes")

    by_id = {r["id"]: r for r in rows}
    expect = {"agents.index": "2026-09-25T19:00:00+00:00",
              "hyperliquid.post_only": "2026-09-25T20:25:40+00:00",
              "jobs.erc8183": "2026-09-25T20:30:00+00:00",
              "budgets.escrow": "2026-09-15T05:47:55+00:00",
              "chains.agents": "2026-09-22T11:09:04+00:00",
              "chains.views": None}
    for k, want in expect.items():
        got = (by_id.get(k) or {}).get("as_of")
        check(got == want, f"{k} as_of is its measurement time", f"{got}")
    check(out["as_of"] == "2026-09-15T05:47:55+00:00" and out["as_of"] != out["served_at"],
          "the catalogue's as_of is its oldest dataset, not the call",
          f"as_of {out['as_of']}, served_at {out['served_at']}")


def check_as_of() -> None:
    print("\nas_of is the measurement, served_at is the call")
    e = envelope.build(measured="m", coverage={"n": 1}, value=1)
    check(e["as_of"] is None, "as_of has no default", repr(e["as_of"]))
    check(bool(e["served_at"]), "served_at is always present")
    keys = list(e)
    check(keys.index("coverage") < keys.index("as_of") < keys.index("value"),
          "coverage, then as_of, then value", " ".join(keys))
    for d in registry.build(Providers(agents_index=synthetic_index)).values():
        says = any("as_of" in c for c in d.caveats)
        check(says, f"{d.id} says what its as_of is")


# ── the HTTP transport ───────────────────────────────────────────────────────

def check_http() -> None:
    print("\nthe HTTP transport")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from mcp_server import router as mcp_router

    ix = synthetic_index()
    app = FastAPI()
    app.include_router(mcp_router.build_router(Providers(agents_index=lambda: ix)))
    client = TestClient(app)
    saved = protocol.RATE
    protocol.RATE = protocol.RateCap(10_000)
    try:
        def post(body, **headers):
            return client.post("/mcp", json=body, headers=headers)

        def not_jsonrpc(r):
            try:
                b = r.json()
            except ValueError:
                return True
            return not (isinstance(b, dict) and "jsonrpc" in b)

        r = post({"jsonrpc": "2.0", "id": "d1", "method": "server/discover",
                  "params": {"_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}}},
                 **{"MCP-Protocol-Version": "2026-07-28"})
        check(r.status_code == 400 and not_jsonrpc(r),
              "server/discover is a 400 with no JSON-RPC body", f"{r.status_code} {r.text[:80]}")
        r = post({"jsonrpc": "2.0", "id": 2, "method": "server/discover"})
        check(r.status_code == 400 and not_jsonrpc(r),
              "server/discover with no header is the same 400", str(r.status_code))
        r = post({"jsonrpc": "2.0", "id": 3, "method": "tools/list"},
                 **{"MCP-Protocol-Version": "2026-07-28"})
        check(r.status_code == 400 and not_jsonrpc(r),
              "a 2026-07-28 request without initialize is a 400", str(r.status_code))
        r = post({"jsonrpc": "2.0", "id": 4, "method": "tools/list",
                  "params": {"_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}}})
        check(r.status_code == 400, "the same version declared in _meta is a 400",
              str(r.status_code))
        r = post({"jsonrpc": "2.0", "id": 5, "method": "tools/list"},
                 **{"MCP-Protocol-Version": "1999-01-01"})
        check(r.status_code == 400 and "supported" in r.json(),
              "an unsupported version header is a 400 that lists the supported",
              r.text[:100])

        r = post({"jsonrpc": "2.0", "id": 6, "method": "initialize",
                  "params": {"protocolVersion": "2025-06-18"}},
                 **{"MCP-Protocol-Version": "2026-07-28"})
        check(r.status_code == 200 and r.json()["result"]["protocolVersion"] == "2025-06-18",
              "initialize still answers, even carrying the modern header",
              str(r.status_code))
        instr = r.json()["result"]["instructions"]
        check("five chains" not in instr and all(
              c in instr for c in ("BNB Chain", "Ethereum", "Arbitrum",
                                   "Robinhood Chain", "Solana", "Monad")),
              "the instructions name the six chains the data covers")
        check("Retry-After" in instr and "retry_after_seconds" in instr,
              "the instructions name Retry-After and retry_after_seconds")
        check("\u2014" not in instr and "\u2013" not in instr,
              "the instructions carry no dashes of the long kind")
        r = post({"jsonrpc": "2.0", "id": 7, "method": "tools/list"},
                 **{"MCP-Protocol-Version": "2025-06-18"})
        check(r.status_code == 200 and len(r.json()["result"]["tools"]) == 6,
              "tools/list answers with a negotiated version header", str(r.status_code))
        r = post({"jsonrpc": "2.0", "id": 8, "method": "tools/call",
                  "params": {"name": "tnega_summary", "arguments": {"dataset": "agents.index"}}})
        check(r.status_code == 200 and "result" in r.json(),
              "a sessionless tools/call with no header answers", str(r.status_code))
        r = post({"jsonrpc": "2.0", "id": 9, "method": "tools/list"},
                 Origin="https://evil.example")
        check(r.status_code == 200 and protocol.ORIGIN_OUTSIDE["count"] >= 1,
              "an outside Origin is counted, not refused",
              f"{r.status_code}, {protocol.ORIGIN_OUTSIDE['count']} counted")
        before = protocol.ORIGIN_OUTSIDE["count"]
        post({"jsonrpc": "2.0", "id": 10, "method": "ping"}, Origin="https://www.tnega.app")
        check(protocol.ORIGIN_OUTSIDE["count"] == before, "the site's own Origin is not counted")

        # Batches: answered under 2025-03-26 and earlier (or no header),
        # refused under 2025-06-18 and later, and never more than MAX_BATCH.
        two = [{"jsonrpc": "2.0", "id": 30, "method": "tools/call",
                "params": {"name": "tnega_summary", "arguments": {"dataset": "agents.index"}}},
               {"jsonrpc": "2.0", "method": "notifications/initialized"},
               {"jsonrpc": "2.0", "id": 31, "method": "ping"}]
        for hdr in ({"MCP-Protocol-Version": "2025-03-26"}, {}):
            r = post(two, **hdr)
            ids = [e.get("id") for e in r.json()] if r.status_code == 200 else []
            check(r.status_code == 200 and ids == [30, 31]
                  and "result" in r.json()[0] and "result" in r.json()[1],
                  f"a batch is answered under {hdr.get('MCP-Protocol-Version', 'no header')}, "
                  f"notification without an entry", f"{r.status_code} ids {ids}")
        r = post([{"jsonrpc": "2.0", "method": "notifications/initialized"}])
        check(r.status_code == 202 and not r.content,
              "an all-notification batch is a 202", str(r.status_code))
        for v in ("2025-06-18", "2025-11-25"):
            r = post(two, **{"MCP-Protocol-Version": v})
            err = (r.json() or {}).get("error") or {}
            check(r.status_code == 400 and err.get("code") == -32600,
                  f"a batch under {v} is refused with -32600", f"{r.status_code} {err.get('code')}")
        eleven = [{"jsonrpc": "2.0", "id": 100 + i, "method": "ping"} for i in range(11)]
        r = post(eleven)
        err = (r.json() or {}).get("error") or {}
        check(r.status_code == 400 and err.get("code") == -32600 and "at most 10" in err.get("message", ""),
              "an 11 message batch is refused", err.get("message", "")[:60])
        r = post(eleven[:10])
        check(r.status_code == 200 and len(r.json()) == 10, "a 10 message batch is answered",
              str(r.status_code))

        # One token per message.
        protocol.RATE = protocol.RateCap(1000)
        before = protocol.RATE.tokens
        post(eleven[:10])
        spent = before - protocol.RATE.tokens
        check(9.5 <= spent <= 10.5, "a batch of 10 costs 10 rate tokens", f"{spent:.2f}")
        protocol.RATE = protocol.RateCap(3)
        r = post([{"jsonrpc": "2.0", "id": 200 + i, "method": "ping"} for i in range(5)])
        entries = r.json()
        limited = [e for e in entries if (e.get("error") or {}).get("data", {}).get("reason") == "rate_limited"]
        check(len(entries) == 5 and len(limited) == 2
              and all(e["error"]["data"].get("retry_after_seconds") for e in limited)
              and r.headers.get("retry-after"),
              "past the cap, each message in a batch is refused on its own with retry_after_seconds",
              f"{len(entries) - len(limited)} answered, {len(limited)} rate limited")
        protocol.RATE = protocol.RateCap(10_000)

        # Versions: 2025-11-25 is accepted in the header but never negotiated;
        # an unknown version is refused, and each refusal is counted and logged.
        r = post({"jsonrpc": "2.0", "id": 39, "method": "tools/list"},
                 **{"MCP-Protocol-Version": "2025-11-25"})
        check(r.status_code == 200, "a 2025-11-25 header is accepted", str(r.status_code))
        before = protocol.VERSION_REFUSED["count"]
        r = post({"jsonrpc": "2.0", "id": 40, "method": "tools/list"},
                 **{"MCP-Protocol-Version": "1999-01-01", "User-Agent": "selfcheck/1"})
        check(r.status_code == 400, "an unknown version header is refused", str(r.status_code))
        r = post({"jsonrpc": "2.0", "id": 41, "method": "initialize",
                  "params": {"protocolVersion": "2025-11-25"}})
        check(r.json()["result"]["protocolVersion"] == "2025-06-18",
              "initialize asking for 2025-11-25 is answered 2025-06-18")
        check(protocol.VERSION_REFUSED["count"] > before,
              "version refusals are counted", f"{protocol.VERSION_REFUSED['count']} so far")
        for v in sorted(protocol.SUPPORTED_VERSIONS):
            r = post({"jsonrpc": "2.0", "id": 42, "method": "ping"}, **{"MCP-Protocol-Version": v})
            check(r.status_code == 200, f"a {v} header is accepted with no session")

        # The cap turned off.
        protocol.RATE = None
        codes = {post({"jsonrpc": "2.0", "id": 50 + i, "method": "ping"}).status_code
                 for i in range(20)}
        check(codes == {200}, "with the cap off nothing is refused for rate", str(codes))

        # The per-minute cap.
        protocol.RATE = protocol.RateCap(3)
        codes = [post({"jsonrpc": "2.0", "id": 20 + i, "method": "ping"}).status_code
                 for i in range(4)]
        last = post({"jsonrpc": "2.0", "id": 99, "method": "ping"})
        err = (last.json() or {}).get("error") or {}
        check(codes[:3] == [200, 200, 200] and last.status_code == 429,
              "the per-minute cap refuses past its limit", f"{codes} then {last.status_code}")
        check(err.get("code") == protocol.BUSY_CODE
              and (err.get("data") or {}).get("reason") == "rate_limited"
              and last.json().get("id") == 99,
              "the refusal is -32029 rate_limited, with the caller's id",
              json.dumps(err)[:120])
        check(int(last.headers.get("retry-after", "0")) >= 1, "and says when to retry",
              last.headers.get("retry-after", ""))
    finally:
        protocol.RATE = saved


# ── what a review of the first round found ───────────────────────────────────

def check_review_findings() -> None:
    print("\nwhat a review of the first round found")
    import dataclasses
    import os

    # Counts in coverage match what was kept after a trim.
    rows = [{"id": f"r{i}", "text": "t" * 400} for i in range(200)]
    page = envelope.build(measured="p", coverage={"matched": 500, "returned": 200, "offset": 0},
                          value=rows, resume=lambda kept: f"c{len(kept)}")
    _, out = envelope.enforce_ceiling("tnega_list", page)
    check(out["coverage"]["returned"] == len(out["value"]) < 200,
          "after a trim, coverage.returned is the rows kept",
          f"returned {out['coverage']['returned']}, kept {len(out['value'])}")
    pts = [{"t": f"2026-09-19T09:{i // 6:02d}:{(i % 6) * 10:02d}+00:00", "pad": "p" * 120}
           for i in range(200)]
    ser = envelope.build(measured="s", coverage={"points": 200, "buckets_returned": 200},
                         value=pts, resume=lambda kept: kept[-1]["t"])
    _, out = envelope.enforce_ceiling("tnega_series", ser)
    kept = len(out["value"])
    check(out["coverage"]["points"] == kept == out["coverage"]["buckets_returned"] < 200,
          "after a trim, points and buckets_returned are the points kept",
          f"points {out['coverage']['points']}, buckets_returned "
          f"{out['coverage']['buckets_returned']}, kept {kept}")

    # A single row too large to send is skipped by name, and the walk goes on.
    huge = [{"id": "fat-row", "blob": "x" * 40_000}, {"id": "next-row", "v": 1}]
    page = envelope.build(measured="p", coverage={"returned": 2}, value=huge,
                          resume=lambda kept: f"after-{len(kept)}")
    body, out = envelope.enforce_ceiling("tnega_list", page)
    check(out["value"] == [] and out["next_cursor"] == "after-1"
          and out["coverage"]["partial"] is True
          and "fat-row" in out["caveats"][-1]
          and out["coverage"]["skipped_as_too_large"] == ["fat-row"]
          and len(body.encode()) <= envelope.CEILINGS["tnega_list"],
          "an oversized row is skipped by name with a cursor past it",
          f"cursor {out['next_cursor']}, value {out['value']}")

    # A skipped last row issues no cursor, and the note fits the tool.
    total = 1
    last = envelope.build(measured="p", coverage={"returned": 1}, value=huge[:1],
                          resume=lambda kept: "more" if len(kept) < total else None)
    _, out = envelope.enforce_ceiling("tnega_list", last)
    check(out["next_cursor"] is None and "no next_cursor" in out["caveats"][-1],
          "a skipped last row issues no cursor", str(out["next_cursor"]))
    pt = envelope.build(measured="s", coverage={"points": 1},
                        value=[{"t": "2026-09-19T09:09:30+00:00", "pad": "p" * 40_000}],
                        resume=lambda kept: None)
    _, out = envelope.enforce_ceiling("tnega_series", pt)
    check("tnega_get" not in out["caveats"][-1] and "single point" in out["caveats"][-1],
          "a skipped series point is not sent to tnega_get", out["caveats"][-1][:90])
    check("tnega_get" in envelope._SKIP_ADVICE["tnega_list"],
          "a skipped list row is sent to tnega_get")

    # THE REAL BOUND. A batch runs its calls back to back and holds the gate
    # for all of them: another caller trying throughout is refused until the
    # batch is done, not let in between. What limits that is MAX_BATCH.
    from mcp_server import router as mcp_router, tools as mcp_tools
    log: list = []

    async def slow(datasets, args):
        tag = args.get("query")
        log.append(f"start {tag}")
        await asyncio.sleep(0.03)
        log.append(f"end {tag}")
        return envelope.build(measured="m", coverage={"partial": False}, value=tag)

    spec = mcp_tools.BY_NAME["tnega_resolve"]
    saved_handler, saved_rate = spec["handler"], protocol.RATE
    spec["handler"] = slow
    protocol.RATE = None
    protocol.GATE.release()
    try:
        def msg(i, tag):
            return {"jsonrpc": "2.0", "id": i, "method": "tools/call",
                    "params": {"name": "tnega_resolve", "arguments": {"query": tag}}}
        attempts: list = []
        done = asyncio.Event()

        async def batch():
            try:
                return await mcp_router.answer_batch(
                    [msg(1, "b1"), msg(2, "b2"), msg(3, "b3")], {}, {})
            finally:
                done.set()

        async def other():
            await asyncio.sleep(0.005)
            while not done.is_set():
                r = await protocol.handle(msg(99, "other"), {}, None)
                attempts.append((r.get("error") or {}).get("data", {}).get("reason") or "answered")
                await asyncio.sleep(0.005)

        async def both():
            return await asyncio.gather(batch(), other())
        batch_resp, _ = run(both())
        entries = json.loads(batch_resp.body)
        sequential = log == ["start b1", "end b1", "start b2", "end b2", "start b3", "end b3"]
        check(len(entries) == 3 and all("result" in e for e in entries) and sequential,
              "a batch runs its calls one after another", " > ".join(log))
        check(attempts and set(attempts) == {"server_busy"},
              "and holds the gate for all of them: others are refused meanwhile",
              f"{len(attempts)} attempts, {sorted(set(attempts))}")
        check(mcp_router.MAX_BATCH == 10, "which is why a batch is at most 10 calls")
    finally:
        spec["handler"], protocol.RATE = saved_handler, saved_rate
        protocol.GATE.release()

    # Times: zero, negatives and garbage are null, never 1970 or the input.
    for v in (0, 0.0, -5, "", "not a time", True, None, object()):
        check(registry.iso_utc(v) is None, f"iso_utc({v!r:.20}) is null")
    check(registry.iso_utc(1790368200.5) == "2026-09-25T20:30:00+00:00"
          and registry.iso_utc("2026-09-25T20:30:00.9Z") == "2026-09-25T20:30:00+00:00",
          "iso_utc normalises epochs and ISO strings to one form")

    # The caveats default.
    try:
        d = registry.Dataset(id="x", title="x", measures="x", keys=["k"],
                             coverage=lambda: {})
        check(d.caveats == [], "a Dataset with no caveats constructs")
    except TypeError as e:
        check(False, "a Dataset with no caveats constructs", str(e))

    # agents.index: built on demand, and as_of from the data, not the load.
    state = {"ix": None, "built": 0}

    async def ensure():
        state["built"] += 1
        state["ix"] = synthetic_index()

    ds = registry.build(Providers(agents_index=lambda: state["ix"],
                                  agents_index_as_of=lambda: "2026-09-25T19:00:00.5+00:00",
                                  ensure_agents_index=ensure))
    out = json.loads(run(protocol.handle(
        {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
         "params": {"name": "tnega_summary", "arguments": {"dataset": "agents.index"}}},
        ds))["result"]["content"][0]["text"])
    check(state["built"] == 1 and (out["value"] or {}).get("matched") == 120,
          "agents.index builds the index on a fresh process", f"built {state['built']}")
    check(out["as_of"] == "2026-09-25T19:00:00+00:00",
          "agents.index as_of is the data's last_seen time", str(out["as_of"]))
    run(protocol.handle(
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
         "params": {"name": "tnega_get", "arguments": {"dataset": "agents.index", "id": "id-1"}}},
        ds))
    check(state["built"] == 1, "and builds it once, not per call")

    # chains.agents: success times, and null while any view never succeeded.
    from core import chain_views, full_registry_ingest as fri
    saved = (chain_views.count_view, fri.get_progress, fri.get_solana_progress,
             fri.get_additional_chains_progress)

    async def count(view):
        return 10

    def prog(**kw):
        async def f():
            return kw
        return f

    async def extra():
        return {"monad": {"last_run_at": 1790354937.0, "last_success_at": 1790075344.0},
                "robinhood": {"last_run_at": 1790355020.0, "last_success_at": 1790135206.0},
                "arbitrum": {"last_run_at": 1790355112.0, "last_success_at": None}}
    try:
        chain_views.count_view = count
        fri.get_progress = prog(last_run_at=1790368570.0, last_success_at=1790368570.0)
        fri.get_solana_progress = prog(last_run_at=1790354873.0, last_error="HTTP 525",
                                       last_success_at=1790335389.0)
        fri.get_additional_chains_progress = extra
        d = registry.build(Providers(agents_index=synthetic_index))["chains.agents"]
        cov = run(registry.call(d.coverage))
        check(cov["ingest_no_recorded_success"] == ["arbitrum"]
              and cov["oldest_ingest_success_at"] is None,
              "chains.agents as_of is null while a view has no recorded success",
              f"never {cov['ingest_no_recorded_success']}")
        check(cov["ingest_last_success_at"]["solana"] == "2026-09-25T11:23:09+00:00",
              "chains.agents reads last_success_at, not a failed run's time",
              cov["ingest_last_success_at"]["solana"])

        async def extra_ok():
            e = await extra()
            e["arbitrum"]["last_success_at"] = 1790335414.0
            return e
        fri.get_additional_chains_progress = extra_ok
        cov = run(registry.call(d.coverage))
        check(cov["oldest_ingest_success_at"] == "2026-09-22T11:09:04+00:00",
              "and is the oldest success once every view has one",
              str(cov["oldest_ingest_success_at"]))
    finally:
        (chain_views.count_view, fri.get_progress, fri.get_solana_progress,
         fri.get_additional_chains_progress) = saved

    # jobs.erc8183 from the pass time, not the last new job.
    jobs = registry.build(Providers(agents_index=synthetic_index))["jobs.erc8183"]
    check(jobs.as_of({"last_run_at": 1790354721.9}) is None
          and registry.iso_utc(jobs.as_of({"last_pass_completed_at": 1790368200.5}))
          == "2026-09-25T20:30:00+00:00",
          "jobs.erc8183 as_of is the last complete pass, never last_run_at")
    src = Path(__file__).resolve().parent.parent.joinpath("core/job_index.py").read_text()
    check('progress["last_pass_completed_at"] = time.time()' in src,
          "the job indexer records every complete pass")
    src = Path(__file__).resolve().parent.parent.joinpath("core/full_registry_ingest.py").read_text()
    check(src.count('progress["last_success_at"] = progress["last_run_at"]') == 2,
          "both registry ingest paths record their last success")

    # Hyperliquid order is total.
    rows = [{"address": a, "tracked": True, "month_volume": None} for a in ("0xc", "0xa", "0xb")]
    rows += [{"address": "0xz", "tracked": True, "month_volume": 5.0},
             {"address": "0xy", "tracked": False, "month_volume": 9.0}]

    class FakeHL:
        def makers(self, n):
            return list(reversed(rows))
    got = [m["address"] for m in registry._hl_makers(FakeHL())[0]]
    check(got == ["0xz", "0xa", "0xb", "0xc", "0xy"],
          "hyperliquid makers are ordered with the address as tiebreaker", " ".join(got))

    # chains.views record carries the list's name, not hireable.
    views = registry.build(Providers(agents_index=synthetic_index))["chains.views"]
    rec = views.get("robinhood")
    check(rec is not None and "hireable" not in rec and "hire_paths_deployed" in rec,
          "tnega_get chains.views serves hire_paths_deployed, not hireable",
          str((rec or {}).get("hire_paths_deployed")))

    # The rate cap: 0 is off, unset is the backstop.
    old = os.environ.get("MCP_RATE_LIMIT_PER_MINUTE")
    try:
        os.environ["MCP_RATE_LIMIT_PER_MINUTE"] = "0"
        check(protocol._rate_from_env() is None, "MCP_RATE_LIMIT_PER_MINUTE=0 turns the cap off")
        os.environ["MCP_RATE_LIMIT_PER_MINUTE"] = "-5"
        cap = protocol._rate_from_env()
        check(cap is not None and cap.per_minute == 600,
              "a negative MCP_RATE_LIMIT_PER_MINUTE falls back to 600")
        os.environ.pop("MCP_RATE_LIMIT_PER_MINUTE")
        cap = protocol._rate_from_env()
        check(cap is not None and cap.per_minute == protocol.RATE_DEFAULT_PER_MINUTE == 600,
              "unset, the cap is the 600 a minute backstop")
    finally:
        if old is not None:
            os.environ["MCP_RATE_LIMIT_PER_MINUTE"] = old

    # Telegram reads sync and async readers alike.
    from telegram_bot.router import build_router as tg_build
    tg = tg_build(Providers(agents_index=synthetic_index))
    text = run(tg.answer("/coverage"))
    check("TypeError" not in text and "chains.views" in text,
          "Telegram /coverage reads sync and async coverage alike",
          "TypeError present" if "TypeError" in text else "clean")
    text = run(tg.answer("/counts"))
    check("120" in text and "not loaded" not in text,
          "Telegram /counts reads the async agents summary", text[:80].replace("\n", " "))


# ── the fourth pass: body size, batch membership, responses, retries ────────

def check_body_cap_and_more() -> None:
    print("\nbody size, batch membership, responses, retries")
    import tracemalloc
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from mcp_server import router as mcp_router

    ix = synthetic_index()
    app = FastAPI()
    app.include_router(mcp_router.build_router(Providers(agents_index=lambda: ix)))
    client = TestClient(app)
    cap = mcp_router.MAX_BODY_BYTES
    saved = protocol.RATE
    protocol.RATE = None
    try:
        check(cap == 65_536, "the body cap defaults to 64 KB", str(cap))

        # Exactly at the cap: a real message padded to the byte.
        head = b'{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"'
        tail = b'"}}'
        exact = head + b"x" * (cap - len(head) - len(tail)) + tail
        r = client.post("/mcp", content=exact, headers={"content-type": "application/json"})
        check(len(exact) == cap and r.status_code == 200 and "result" in r.json(),
              "a body of exactly the cap is answered", f"{len(exact)} bytes, {r.status_code}")

        over = exact[:-3] + b"xx" + tail[-3:]
        r = client.post("/mcp", content=over, headers={"content-type": "application/json"})
        check(r.status_code == 413 and (r.json().get("error") or {}).get("code") == -32600,
              "a Content-Length over the cap is a 413 with a JSON error",
              f"{len(over)} bytes, {r.status_code}")

        def chunks():
            for _ in range(10):
                yield b"[" + b"{}," * 4000
        r = client.post("/mcp", content=chunks(), headers={"content-type": "application/json"})
        check(r.status_code == 413, "a chunked body over the cap is a 413",
              f"{r.status_code}, sent without Content-Length")

        def small_chunks():
            yield b'{"jsonrpc":"2.0",'
            yield b'"id":7,"method":"ping"}'
        r = client.post("/mcp", content=small_chunks(), headers={"content-type": "application/json"})
        check(r.status_code == 200 and r.json().get("id") == 7,
              "a chunked body under the cap is answered", str(r.status_code))

        deep = b"[" * 30_000 + b"]" * 30_000
        r = client.post("/mcp", content=deep, headers={"content-type": "application/json"})
        check(r.status_code == 400, "deep nesting under the cap is a parse error, not a 500",
              str(r.status_code))

        # What a worst-case body under the cap costs to parse.
        worst = b"[" + b",".join([b"{}"] * ((cap - 2) // 3)) + b"]"
        tracemalloc.start()
        tracemalloc.reset_peak()
        json.loads(worst)
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        check(len(worst) <= cap and peak < 4_000_000,
              "the worst-case body at the cap parses in a few megabytes",
              f"{len(worst)} bytes of [{{}},...] peaks at {peak / 1e6:.2f} MB")

        # initialize never in a batch, and no exemption for its neighbours.
        r = client.post("/mcp", json=[
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-03-26"}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}])
        check(r.status_code == 400 and r.json()["error"]["code"] == -32600
              and "initialize" in r.json()["error"]["message"],
              "a batch holding initialize is refused", str(r.status_code))
        r = client.post("/mcp", json=[
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-03-26"}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list",
             "params": {"_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}}}])
        check(r.status_code == 400, "so no batch member rides the initialize exemption past the version check", str(r.status_code))

        # Responses from the client take a 202 and no body.
        r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 5, "result": {}})
        check(r.status_code == 202 and not r.content, "a single response is a 202 with no body",
              str(r.status_code))
        r = client.post("/mcp", json=[{"jsonrpc": "2.0", "id": 5, "result": {}},
                                      {"jsonrpc": "2.0", "id": 6,
                                       "error": {"code": -1, "message": "x"}}])
        check(r.status_code == 202 and not r.content, "a batch of responses is a 202 with no body",
              str(r.status_code))
        r = client.post("/mcp", json=[{"jsonrpc": "2.0", "id": 5, "result": {}},
                                      {"jsonrpc": "2.0", "id": 8, "method": "ping"}])
        check(r.status_code == 200 and [e["id"] for e in r.json()] == [8],
              "a response inside a batch takes no entry", r.text[:60])
    finally:
        protocol.RATE = saved

    # The Telegram webhook reads under its own cap.
    import telegram_bot.router as tgr
    saved_secret = tgr.WEBHOOK_SECRET
    tgr.WEBHOOK_SECRET = "selfcheck-secret"
    try:
        tapp = FastAPI()
        tapp.include_router(tgr.build_router(Providers(agents_index=lambda: ix)))
        tclient = TestClient(tapp)
        hdr = {"x-telegram-bot-api-secret-token": "selfcheck-secret",
               "content-type": "application/json"}
        big = b'{"update_id":1,"pad":"' + b"x" * tgr.MAX_UPDATE_BYTES + b'"}'
        r = tclient.post("/api/telegram/webhook", content=big, headers=hdr)
        check(r.status_code == 413, "the Telegram webhook refuses a body over its cap",
              f"{len(big)} bytes, {r.status_code}")

        def tchunks():
            for _ in range(20):
                yield b"x" * 20_000
        r = tclient.post("/api/telegram/webhook", content=tchunks(), headers=hdr)
        check(r.status_code == 413, "and a chunked one", str(r.status_code))
        r = tclient.post("/api/telegram/webhook", content=b"[1,2,3]", headers=hdr)
        check(r.status_code == 200, "and a JSON list is ignored rather than a 500",
              str(r.status_code))
        r = tclient.post("/api/telegram/webhook", content=big,
                         headers={"content-type": "application/json"})
        check(r.status_code == 401, "and the secret is still checked first", str(r.status_code))
    finally:
        tgr.WEBHOOK_SECRET = saved_secret

    # One retry on a Cockroach serialization failure, and only on that.
    class Conflict(Exception):
        sqlstate = "40001"

    class Other(Exception):
        sqlstate = "57014"
    calls = {"n": 0}

    def once():
        calls["n"] += 1
        if calls["n"] == 1:
            raise Conflict()
        return {"ok": True}
    check(registry._retry_serialization(once) == {"ok": True} and calls["n"] == 2,
          "hyperliquid coverage retries once on 40001")

    def always():
        raise Conflict()
    try:
        registry._retry_serialization(always)
        check(False, "a second 40001 is reported, not retried again")
    except Conflict:
        check(True, "a second 40001 is reported, not retried again")

    def other_err():
        raise Other()
    try:
        registry._retry_serialization(other_err)
        check(False, "any other error is not retried")
    except Other:
        check(True, "any other error is not retried")


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
        args = dict(d.example_filters or {})
        if d.list is not None:
            try:
                out = run(call("tnega_list", {"dataset": ds_id, "limit": 5, **args}))
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
                out = run(call("tnega_summary", {"dataset": ds_id, **args}))
            except Exception as e:  # noqa: BLE001
                check(True, f"{ds_id} summary unreachable here", f"skipped, {type(e).__name__}")
                continue
            check(out.get("withheld_reason") != "response_too_large",
                  f"{ds_id} summary fits its ceiling without trimming")
            check(not isinstance(out.get("value"), list),
                  f"{ds_id} summary is a rollup, not rows")

            # The defect an external agent found: a breakdown that did not add
            # up to the total printed beside it, because the top 15 categories
            # were sent and the remainder was not mentioned. Any dataset that
            # reports both has to reconcile.
            val = out.get("value") or {}
            if isinstance(val, dict) and "categories_sum" in val:
                check(val["categories_sum"] == val.get("matched"),
                      f"{ds_id} categories sum to the total",
                      f"{val['categories_sum']} vs {val.get('matched')}")


def main() -> int:
    print("MCP surface self-check")
    check_annotations()
    check_descriptions()
    check_encoder()
    check_one_encoder()
    check_transport_boundary()
    check_licensed_boundary()
    check_envelope()
    check_ceilings()
    datasets = check_tools()
    check_gate(datasets)
    check_audit_findings(datasets)
    check_catalogue_at_production_size()
    check_as_of()
    check_http()
    check_review_findings()
    check_body_cap_and_more()
    check_live_datasets()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: {'; '.join(FAILURES)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
