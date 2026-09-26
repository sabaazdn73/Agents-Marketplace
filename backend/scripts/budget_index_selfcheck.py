"""Checks core/budget_index.py keeps its promises.

Run:  ./venv/bin/python scripts/budget_index_selfcheck.py
      ./venv/bin/python scripts/budget_index_selfcheck.py --live

Offline (the default) runs against an in-memory collection and a scripted
RPC, so it makes no network call and touches no database:

  replay      a page read twice leaves every count as a page read once.
  resume      a failure part way through a backlog keeps the pages before it,
              and the next pass finishes the job with the same totals as a
              clean run.
  cap         a pass stops at its page cap, says it is not caught up, and the
              next pass carries on from where it stopped.
  control     a failed known-log control is logged with its class and its
              JSON-RPC code and message, and never with the key or keyed URL.
  empty       an empty page from an endpoint that failed the control is
              refused, and the cursor does not move past it.
  migration   documents written as bare counts keep their counts, a draw
              below the legacy block is not counted again, a new one is.
  describe    safe_errors.describe keeps a JSON-RPC code and message, redacted.

--live reads BSC for real, read-only, into the same in-memory collection,
and compares budgets 1 to 3 with what the production collection holds (a
read, never a write). About fifty RPC calls; see live() for what they are.
"""
from __future__ import annotations

import asyncio
import contextlib
import copy
import io
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:  # noqa: BLE001
    pass

import httpx  # noqa: E402

from core import budget_index as bi  # noqa: E402
from core.safe_errors import JsonRpcError, describe  # noqa: E402

FAILURES: list[str] = []
NOT_RUN: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'ok' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))
    if not ok:
        FAILURES.append(name)


# ── an in-memory stand-in for the two motor collections ─────────────────────

class _Result:
    def __init__(self, matched: int, modified: int):
        self.matched_count = matched
        self.modified_count = modified


def _get(doc: dict, path: str):
    cur = doc
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return _MISSING
        cur = cur[part]
    return cur


_MISSING = object()


def _set_path(doc: dict, path: str, value) -> None:
    parts = path.split(".")
    cur = doc
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = value


def _matches(doc: dict, flt: dict) -> bool:
    for k, v in flt.items():
        if "." in k:
            got = _get(doc, k)
            if isinstance(v, dict) and "$exists" in v:
                if (got is not _MISSING) != bool(v["$exists"]):
                    return False
                continue
            if got is _MISSING or got != v:
                return False
            continue
        if isinstance(v, dict) and any(op.startswith("$") for op in v):
            for op, arg in v.items():
                if op == "$exists":
                    if (k in doc) != bool(arg):
                        return False
                elif op == "$ne":
                    cur = doc.get(k)
                    if (arg in cur) if isinstance(cur, list) else (cur == arg):
                        return False
                elif op == "$in":
                    if doc.get(k) not in arg:
                        return False
                else:
                    raise NotImplementedError(op)
        elif doc.get(k) != v:
            return False
    return True


class _Cursor:
    def __init__(self, docs: list[dict]):
        self._docs = docs

    def __aiter__(self):
        self._it = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class FakeCollection:
    def __init__(self):
        self.docs: list[dict] = []
        self._next_id = 1
        self.indexes: dict[str, dict] = {}

    async def create_index(self, keys, unique=False, name=None):
        fields = [k for k, _ in keys]
        if unique:
            seen = set()
            for d in self.docs:
                k = tuple(d.get(f) for f in fields)
                if k in seen:
                    raise RuntimeError("E11000 duplicate key error")
                seen.add(k)
        self.indexes[name] = {"keys": fields, "unique": unique}
        return name

    async def find_one(self, flt: dict, projection: dict | None = None):
        for d in self.docs:
            if _matches(d, flt):
                return copy.deepcopy(d)
        return None

    def find(self, flt: dict, projection: dict | None = None):
        out = []
        for d in self.docs:
            if _matches(d, flt):
                c = copy.deepcopy(d)
                if projection:
                    keep = {k for k, v in projection.items() if v}
                    if keep:
                        c = {k: c[k] for k in c if k in keep or (k == "_id" and projection.get("_id", 1))}
                    elif projection.get("_id") == 0:
                        c.pop("_id", None)
                out.append(c)
        return _Cursor(out)

    async def update_one(self, flt: dict, update: dict, upsert: bool = False):
        for d in self.docs:
            if _matches(d, flt):
                before = copy.deepcopy(d)
                self._apply(d, update, inserting=False)
                return _Result(1, int(before != d))
        if not upsert:
            return _Result(0, 0)
        d = {"_id": self._next_id}
        self._next_id += 1
        for k, v in flt.items():
            if not (isinstance(v, dict) and any(op.startswith("$") for op in v)):
                d[k] = v
        self._apply(d, update, inserting=True)
        self.docs.append(d)
        return _Result(0, 0)

    @staticmethod
    def _apply(d: dict, update: dict, inserting: bool) -> None:
        for op, fields in update.items():
            for k, v in fields.items():
                if op == "$set":
                    _set_path(d, k, copy.deepcopy(v))
                elif op == "$setOnInsert":
                    if inserting:
                        _set_path(d, k, copy.deepcopy(v))
                elif op == "$inc":
                    got = _get(d, k)
                    _set_path(d, k, (0 if got is _MISSING else got) + v)
                elif op == "$push":
                    d.setdefault(k, []).append(v)
                else:
                    raise NotImplementedError(op)


class FakeDB(dict):
    def __missing__(self, name):
        self[name] = FakeCollection()
        return self[name]


# ── a scripted chain ────────────────────────────────────────────────────────

CHAIN = 42161          # a real deployment entry; its page is 40,000 blocks
FLOOR = bi.FIRST_BUDGET_BLOCK[CHAIN]
STEP = bi.LOG_PAGE_BLOCKS[CHAIN] + 1
PRIMARY = "https://primary.example/rpc"
FAKE_KEY = "f00dfeedcafe4b1d9a0c7e2b3d4a5f60"
KEYED = f"https://arbitrum-mainnet.infura.io/v3/{FAKE_KEY}"
AGENT = "0x" + "ab" * 20


def _topic_int(n: int) -> str:
    return "0x" + format(n, "064x")


def _topic_addr(a: str) -> str:
    return "0x" + "0" * 24 + a[2:]


def opened_log(bid: int, block: int, tx: str) -> dict:
    return {"topics": [bi.OPENED_TOPIC, _topic_int(bid), _topic_addr("0x" + "11" * 20),
                       _topic_addr(AGENT)],
            "blockNumber": hex(block), "transactionHash": tx, "logIndex": "0x0"}


def drawn_log(bid: int, block: int, tx: str, li: int = 1) -> dict:
    return {"topics": [bi.DRAWN_TOPIC, _topic_int(bid), _topic_addr(AGENT)],
            "blockNumber": hex(block), "transactionHash": tx, "logIndex": hex(li)}


class FakeChain:
    """eth_blockNumber and eth_getLogs over a fixed set of logs, with hooks
    to fail a given page or the control."""

    def __init__(self, head: int, logs: list[dict]):
        self.head = head
        self.logs = logs
        self.fail_from_block: int | None = None     # a page starting here errors
        self.control_error: dict | None = None      # the control answers this
        self.empty_everywhere = False               # every page answers []
        self.calls = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        body = json.loads(request.content)
        if body["method"] == "eth_blockNumber":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": hex(self.head)})
        p = body["params"][0]
        lo, hi = int(p["fromBlock"], 16), int(p["toBlock"], 16)
        is_control = "topics" not in p
        if is_control and self.control_error is not None:
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "error": self.control_error})
        if not is_control and self.fail_from_block == lo:
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1,
                                             "error": {"code": -32005, "message": "limit exceeded"}})
        if not is_control and self.empty_everywhere:
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": []})
        topic = (p.get("topics") or [None])[0]
        res = [lg for lg in self.logs if lo <= int(lg["blockNumber"], 16) <= hi
               and (topic is None or lg["topics"][0] == topic)]
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": res})


@contextlib.contextmanager
def wired(chain: FakeChain, urls: list[str]):
    real_client, real_urls = bi.httpx.AsyncClient, bi._chain_urls
    transport = httpx.MockTransport(chain.handler)
    bi.httpx.AsyncClient = lambda *a, **k: real_client(transport=transport)
    bi._chain_urls = lambda cid: list(urls)
    try:
        yield
    finally:
        bi.httpx.AsyncClient = real_client
        bi._chain_urls = real_urls


def budgets(db) -> dict[int, dict]:
    return {d["budget_id"]: d for d in db[bi.COLLECTION].docs if d["chain_id"] == CHAIN}


def cursor(db) -> int | None:
    for d in db[bi.PROGRESS_COLLECTION].docs:
        if d["chain_id"] == CHAIN:
            return d.get("next_block")
    return None


def standard_logs() -> list[dict]:
    # Budget 1 opened on page 0 and drawn on page 2 and page 5; budget 2
    # opened on page 3 and never drawn. Floor itself carries budget 1's open,
    # which is what the control reads.
    return [
        opened_log(1, FLOOR, "0x" + "a1" * 32),
        drawn_log(1, FLOOR + 2 * STEP + 7, "0x" + "d1" * 32),
        opened_log(2, FLOOR + 3 * STEP + 1, "0x" + "a2" * 32),
        drawn_log(1, FLOOR + 5 * STEP + 3, "0x" + "d2" * 32),
    ]


def summary(db) -> dict:
    return {b: (d.get("draws"), d.get("legacy_draws"), sorted(d.get("draw_ids", [])))
            for b, d in budgets(db).items()}


_REAL_KEY = os.environ.get("INFURA_API_KEY")


def _restore_key() -> None:
    """Put back whatever .env set, so --live after the offline checks still
    has the real failover and not the fake key or none."""
    if _REAL_KEY is None:
        os.environ.pop("INFURA_API_KEY", None)
    else:
        os.environ["INFURA_API_KEY"] = _REAL_KEY


async def offline() -> None:
    head = FLOOR + 8 * STEP - 1      # exactly eight pages

    print("replay")
    clean = FakeDB()
    ch = FakeChain(head, standard_logs())
    with wired(ch, [PRIMARY]):
        r = await bi.refresh_chain(clean, CHAIN, max_pages=100)
    check("a clean pass reaches the head", r["caught_up"] and r["pages"] == 8, str(r))
    check("budget 1 counts two draws, budget 2 none",
          budgets(clean)[1]["draws"] == 2 and budgets(clean)[2]["draws"] == 0, str(summary(clean)))
    want = summary(clean)
    # Put the cursor back to the floor and read everything again.
    await clean[bi.PROGRESS_COLLECTION].update_one({"chain_id": CHAIN}, {"$set": {"next_block": FLOOR}})
    with wired(ch, [PRIMARY]):
        r2 = await bi.refresh_chain(clean, CHAIN, max_pages=100)
    check("re-reading every page adds nothing", summary(clean) == want and r2["new_draws"] == 0,
          f"{summary(clean)} new_draws={r2['new_draws']}")
    # And one page written twice directly.
    page = [lg for lg in standard_logs() if lg["topics"][0] == bi.DRAWN_TOPIC][:1]
    await bi._record_page(clean[bi.COLLECTION], CHAIN, [], page, FLOOR)
    await bi._record_page(clean[bi.COLLECTION], CHAIN, [], page, FLOOR)
    check("the same Drawn page recorded twice more still counts once", summary(clean) == want)

    print("resume")
    db = FakeDB()
    ch = FakeChain(head, standard_logs())
    ch.fail_from_block = FLOOR + 4 * STEP          # page 4 of 0..7 fails
    buf = io.StringIO()
    with wired(ch, [PRIMARY]), contextlib.redirect_stdout(buf):
        try:
            await bi.refresh_chain(db, CHAIN, max_pages=100)
            raised = False
        except RuntimeError:
            raised = True
    check("a failed page raises", raised)
    check("the four pages before it are kept", cursor(db) == FLOOR + 4 * STEP,
          f"cursor {cursor(db)}, want {FLOOR + 4 * STEP}")
    check("the draw on page 2 is already counted", budgets(db)[1]["draws"] == 1, str(summary(db)))
    prog = await db[bi.PROGRESS_COLLECTION].find_one({"chain_id": CHAIN})
    check("the reason is on the progress document", "limit exceeded" in (prog.get("last_error") or ""),
          prog.get("last_error"))
    check("the failure is logged with pages kept", "after 4 pages this pass (kept)" in buf.getvalue(),
          buf.getvalue().strip().splitlines()[-1][:160])
    ch.fail_from_block = None
    with wired(ch, [PRIMARY]):
        r = await bi.refresh_chain(db, CHAIN, max_pages=100)
    check("the next pass finishes from the failed page", r["caught_up"] and r["pages"] == 4, str(r))
    check("and ends with the clean run's totals", summary(db) == want, str(summary(db)))
    prog = await db[bi.PROGRESS_COLLECTION].find_one({"chain_id": CHAIN})
    check("the stale error is cleared once caught up", prog.get("last_error") is None
          and prog.get("updated_at"))

    print("cap")
    db = FakeDB()
    ch = FakeChain(head, standard_logs())
    buf = io.StringIO()
    with wired(ch, [PRIMARY]), contextlib.redirect_stdout(buf):
        r = await bi.refresh_chain(db, CHAIN, max_pages=3)
    check("a capped pass stops at its cap and says so",
          r["pages"] == 3 and not r["caught_up"] and r["behind_blocks"] == 5 * STEP, str(r))
    prog = await db[bi.PROGRESS_COLLECTION].find_one({"chain_id": CHAIN})
    check("a capped pass does not claim freshness", "updated_at" not in prog, str(prog))
    check("and logs its progress", "continues next pass" in buf.getvalue())
    os.environ["BUDGET_INDEX_MAX_PAGES_PER_PASS"] = "3"
    with wired(ch, [PRIMARY]):
        r = await bi.refresh_chain(db, CHAIN)
        check("the cap is read from the environment", r["pages"] == 3, str(r))
        r = await bi.refresh_chain(db, CHAIN)
    os.environ.pop("BUDGET_INDEX_MAX_PAGES_PER_PASS")
    check("three passes of three cover eight pages", r["caught_up"] and summary(db) == want, str(r))

    print("control")
    db = FakeDB()
    ch = FakeChain(head, standard_logs())
    # The node echoes the keyed URL back in its message, which is the case
    # that would leak the key if the message were printed as it came.
    ch.control_error = {"code": -32005, "message": f"range too old for {KEYED}, key {FAKE_KEY}"}
    os.environ["INFURA_API_KEY"] = FAKE_KEY
    buf = io.StringIO()
    with wired(ch, [KEYED]), contextlib.redirect_stdout(buf):
        try:
            await bi.refresh_chain(db, CHAIN, max_pages=100)
        except RuntimeError:
            pass
    out = buf.getvalue()
    line = next((ln for ln in out.splitlines() if "known-log control could not be read" in ln), "")
    check("the control failure is logged", bool(line), line)
    check("with the exception class", "JsonRpcError" in line)
    check("with the JSON-RPC code and message", "JSON-RPC -32005: range too old for" in line)
    check("the key appears nowhere in the output", FAKE_KEY not in out)
    check("no keyed URL appears in the output", "/v3/" not in out)
    prog = await db[bi.PROGRESS_COLLECTION].find_one({"chain_id": CHAIN})
    # Page 0's Drawn topic is empty and nothing can vouch for it.
    check("the cursor does not pass an empty page nothing vouched for",
          cursor(db) in (None, FLOOR), f"cursor {cursor(db)}")
    check("the key is not on the progress document", FAKE_KEY not in json.dumps(prog))

    # HTTP failure of the control: the status, not the URL.
    ch2 = FakeChain(head, standard_logs())
    real = ch2.handler

    def http_fail(req):
        body = json.loads(req.content)
        if body["method"] == "eth_getLogs" and "topics" not in body["params"][0]:
            return httpx.Response(403, text=f"forbidden {KEYED}")
        return real(req)
    ch2.handler = http_fail
    buf = io.StringIO()
    with wired(ch2, [KEYED]), contextlib.redirect_stdout(buf):
        try:
            await bi.refresh_chain(FakeDB(), CHAIN, max_pages=100)
        except RuntimeError:
            pass
    out = buf.getvalue()
    check("an HTTP control failure logs class and status",
          "HTTPStatusError, HTTP 403" in out, next((ln for ln in out.splitlines() if "control" in ln), ""))
    check("and not the key", FAKE_KEY not in out)
    _restore_key()

    print("empty")
    db = FakeDB()
    ch = FakeChain(head, standard_logs())
    ch.empty_everywhere = True
    ch.control_error = None
    # The control reads the floor unfiltered, which still answers, so make
    # the control itself come back empty too.
    base = ch.handler

    def empty_control(req):
        body = json.loads(req.content)
        if body["method"] == "eth_getLogs" and "topics" not in body["params"][0]:
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": []})
        return base(req)
    ch.handler = empty_control
    buf = io.StringIO()
    with wired(ch, [PRIMARY]), contextlib.redirect_stdout(buf):
        try:
            await bi.refresh_chain(db, CHAIN, max_pages=100)
            raised = False
        except RuntimeError:
            raised = True
    check("an untrusted empty page is refused", raised)
    check("and the cursor stays on it", cursor(db) in (None, FLOOR), f"cursor {cursor(db)}")
    check("the log says the control came back empty", "HTTP 200 with result []" in buf.getvalue())

    print("migration")
    db = FakeDB()
    legacy_cursor = FLOOR + 3 * STEP
    # As the old code left it: counts, no ids, cursor at page 3.
    db[bi.COLLECTION].docs.append({"_id": 900, "chain_id": CHAIN, "budget_id": 1,
                                   "agent": AGENT, "opened_block": FLOOR, "draws": 1})
    db[bi.PROGRESS_COLLECTION].docs.append({"_id": 901, "chain_id": CHAIN,
                                            "next_block": legacy_cursor, "updated_at": 1})
    ch = FakeChain(head, standard_logs())
    with wired(ch, [PRIMARY]):
        r = await bi.refresh_chain(db, CHAIN, max_pages=100)
    b1 = budgets(db)[1]
    check("the legacy count is kept as the baseline", b1["legacy_draws"] == 1, str(b1))
    check("the later draw is added by id", b1["draw_ids"] == ["0x" + "d2" * 32 + ":1"], str(b1))
    check("draws = legacy + ids, the clean run's 2", b1["draws"] == 2)
    # Now move the cursor back past the legacy block, as a mistaken manual
    # reset would, and read again.
    await db[bi.PROGRESS_COLLECTION].update_one({"chain_id": CHAIN}, {"$set": {"next_block": FLOOR}})
    with wired(ch, [PRIMARY]):
        r = await bi.refresh_chain(db, CHAIN, max_pages=100)
    check("a draw below the legacy block is not counted again",
          budgets(db)[1]["draws"] == 2 and r["new_draws"] == 0, str(summary(db)))
    prog = await db[bi.PROGRESS_COLLECTION].find_one({"chain_id": CHAIN})
    check("the legacy block is where the old cursor stood", prog["legacy_before_block"] == legacy_cursor)
    stats = await _stats(db)
    check("the readers see budget 1 drawn from and budget 2 not",
          stats.get(AGENT, {}).get("budgets_drawn_from") == 1
          and stats.get(AGENT, {}).get("budgets_never_drawn") == 1, str(stats.get(AGENT)))

    print("describe")
    os.environ["INFURA_API_KEY"] = FAKE_KEY
    d = describe(JsonRpcError({"code": -32602, "message": f"bad range at {KEYED}?apikey=zz"}))
    check("a JSON-RPC error keeps code and message", d.startswith("JSON-RPC -32602: bad range at"), d)
    check("its URL is cut to the host", "https://arbitrum-mainnet.infura.io/..." in d
          and FAKE_KEY not in d and "apikey" not in d, d)
    d2 = describe(RuntimeError({"code": 429, "message": "Too Many Requests"}))
    check("a RuntimeError holding the error object reads the same way",
          d2 == "JSON-RPC 429: Too Many Requests", d2)
    check("a plain exception is still its class name", describe(TimeoutError()) == "TimeoutError")
    _restore_key()


# ── QuickNode as BSC's failover, over a real local socket ───────────────────

QN_TOKEN = "qnTok7c1e5a9b2d4f6081a3c5e7d9b1f2a4c6"
PUBLIC_HOST_SUFFIX = ".public-bsc.example"
PUBLIC_URL = "https://node1.public-bsc.example/"
QN_NAME = "fake-endpoint-name-7731"


class _MockRPC:
    """A local HTTP server that answers JSON-RPC for BSC and records the
    headers and path of every request it gets."""

    def __init__(self, logs: list[dict], head: int, qn_mode: str = "serve"):
        import http.server
        import threading
        self.logs, self.head, self.qn_mode = logs, head, qn_mode
        self.seen: list[dict] = []
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):  # quiet
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                orig = self.headers.get("x-orig-host", "")
                outer.seen.append({"host": orig, "path": self.path,
                                   "x-token": self.headers.get("x-token")})
                status, out = outer.answer(orig, body)
                raw = json.dumps(out).encode() if not isinstance(out, bytes) else out
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def answer(self, host: str, body: dict):
        is_qn = host.endswith(".quiknode.pro")
        is_public = host.endswith(PUBLIC_HOST_SUFFIX)
        if body["method"] == "eth_blockNumber":
            return 200, {"jsonrpc": "2.0", "id": 1, "result": hex(self.head)}
        p = body["params"][0]
        if is_public:
            return 200, {"jsonrpc": "2.0", "id": 1, "result": self._logs_for(p)}
        if not is_qn:
            # The primary behaves as bloXroute did from Render: every page and
            # the control come back empty, so nothing it says can be trusted.
            return 200, {"jsonrpc": "2.0", "id": 1, "result": []}
        if self.qn_mode == "refuse":
            # The worst case for a leak: the provider echoes the token.
            return 401, f"unauthorized: token {QN_TOKEN} not valid".encode()
        if self.qn_mode == "rpc_error":
            return 200, {"jsonrpc": "2.0", "id": 1, "error": {
                "code": -32001, "message": f"bad token {QN_TOKEN} for https://{host}/{QN_TOKEN}"}}
        return 200, {"jsonrpc": "2.0", "id": 1, "result": self._logs_for(p)}

    def _logs_for(self, p: dict) -> list:
        lo, hi = int(p["fromBlock"], 16), int(p["toBlock"], 16)
        topic = (p.get("topics") or [None])[0]
        return [lg for lg in self.logs if lo <= int(lg["blockNumber"], 16) <= hi
                and (topic is None or lg["topics"][0] == topic)]

    def close(self):
        self.server.shutdown()


class _ToLocal(httpx.AsyncBaseTransport):
    """Sends every request to the mock server over a real socket, unchanged
    apart from the destination, and says where it was meant to go."""

    def __init__(self, port: int):
        self.port = port
        self.inner = httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        orig = request.url.host
        request.url = request.url.copy_with(scheme="http", host="127.0.0.1", port=self.port)
        request.headers["x-orig-host"] = orig
        request.headers["host"] = f"127.0.0.1:{self.port}"
        return await self.inner.handle_async_request(request)


@contextlib.contextmanager
def via_local(mock: _MockRPC):
    real_client = bi.httpx.AsyncClient
    bi.httpx.AsyncClient = lambda *a, **k: real_client(transport=_ToLocal(mock.port))
    try:
        yield
    finally:
        bi.httpx.AsyncClient = real_client


@contextlib.contextmanager
def env(**kv):
    old = {k: os.environ.get(k) for k in kv}
    for k, v in kv.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    try:
        yield
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


async def quicknode_checks() -> None:
    from core import quicknode, rpc_credits
    from core.rpc import get_chain_rpc_url

    print("quicknode")
    want = f"https://{QN_NAME}.bsc.quiknode.pro/"
    for given in (f"{QN_NAME}.quiknode.pro", f"https://{QN_NAME}.bsc.quiknode.pro/",
                  QN_NAME, f"https://{QN_NAME}.quiknode.pro/{QN_TOKEN}/"):
        with env(QUICKNODE_ENDPOINT=given, QUICKNODE_TOKEN=QN_TOKEN):
            got = quicknode.url_for(56)
        check(f"BSC URL from {given.replace(QN_TOKEN, '<token>')!r}", got == want and QN_TOKEN not in got, got)
    with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=None):
        check("no token, no QuickNode", quicknode.url_for(56) is None and not quicknode.configured())
        check("and BSC's providers are as before",
              bi._chain_urls(56)[0] == get_chain_rpc_url(56)
              and not any(quicknode.is_quicknode(u) for u in bi._chain_urls(56)))
    with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN, BSC_MAINNET_RPC_URL=None):
        urls = bi._chain_urls(56)
        check("both set: bloXroute then QuickNode BSC, no Infura",
              urls == ["https://bsc.rpc.blxrbdn.com", want], str([bi._host(u) for u in urls]))
        check("other chains keep their providers",
              not any(quicknode.is_quicknode(u) for u in bi._chain_urls(42161)))
    with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN,
             BSC_MAINNET_RPC_URL="https://override.example/rpc"):
        check("BSC_MAINNET_RPC_URL still sets the primary",
              bi._chain_urls(56) == ["https://override.example/rpc", want])
    with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN):
        check("x-token for a QuickNode URL", quicknode.headers_for(want) == {"x-token": QN_TOKEN})
        check("nothing for any other URL", quicknode.headers_for("https://bsc.rpc.blxrbdn.com") == {})

    floor56 = bi.FIRST_BUDGET_BLOCK[56]
    step56 = bi.LOG_PAGE_BLOCKS[56] + 1
    logs = [
        {**opened_log(1, floor56, "0x" + "b1" * 32)},
        {**drawn_log(1, floor56 + step56 + 5, "0x" + "e1" * 32)},
    ]
    head56 = floor56 + 3 * step56 - 1          # three pages

    # A run where the primary can vouch for nothing and QuickNode serves.
    bi._QUICKNODE_DISABLED.clear()
    mock = _MockRPC(logs, head56, "serve")
    db = FakeDB()
    buf = io.StringIO()
    with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN, BSC_MAINNET_RPC_URL=None,
             QUICKNODE_CREDITS_PER_DAY=None), via_local(mock), contextlib.redirect_stdout(buf):
        r = await bi.refresh_chain(db, 56, max_pages=10)
    mock.close()
    qn = [x for x in mock.seen if x["host"].endswith(".quiknode.pro")]
    other = [x for x in mock.seen if not x["host"].endswith(".quiknode.pro")]
    check("an untrusted primary's empties are read again from QuickNode",
          r["caught_up"] and r["pages"] == 3 and r["new_draws"] == 1, str(r))
    check("every QuickNode request carried x-token", bool(qn) and all(x["x-token"] == QN_TOKEN for x in qn),
          f"{len(qn)} requests")
    check("no request to any other host carried it", all(x["x-token"] is None for x in other),
          f"{len(other)} requests")
    check("no request path held the token", all(QN_TOKEN not in x["path"] for x in mock.seen))
    day = await rpc_credits.today(db, "quicknode")
    check("each QuickNode call counted at 20 credits",
          day["calls"] == len(qn) and day["credits"] == 20 * len(qn)
          and day["by_chain"]["56"]["credits"] == 20 * len(qn), f"{day.get('calls')} calls, {day.get('credits')} credits")
    out = buf.getvalue()
    check("the control failure names the primary, not the endpoint name",
          "control failed on bsc.rpc.blxrbdn.com" in out and QN_NAME not in out)

    # Refusals that echo the token back: nothing of it may escape.
    for mode, marker in (("refuse", "HTTP 401"), ("rpc_error", "JSON-RPC -32001")):
        bi._QUICKNODE_DISABLED.clear()
        mock = _MockRPC(logs, head56, mode)
        db = FakeDB()
        buf = io.StringIO()
        err_text = ""
        with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN, BSC_MAINNET_RPC_URL=None), \
                via_local(mock), contextlib.redirect_stdout(buf):
            try:
                await bi.refresh_chain(db, 56, max_pages=10)
            except Exception as e:  # noqa: BLE001
                err_text = f"{type(e).__name__}: {e} {e.__cause__!r} {e.__context__!r}"
                with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN):
                    err_text += " " + describe(e)
        mock.close()
        out = buf.getvalue()
        prog = await db[bi.PROGRESS_COLLECTION].find_one({"chain_id": 56}) or {}
        everything = out + err_text + json.dumps(prog, default=str)
        check(f"{mode}: the reason is logged", marker in out,
              next((ln for ln in out.splitlines() if "quiknode" in ln), "")[:200])
        check(f"{mode}: the token appears in no log, exception or stored field",
              QN_TOKEN not in everything)
        check(f"{mode}: nor does the endpoint name", QN_NAME not in everything)

    print("public fallback")
    with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN, BSC_MAINNET_RPC_URL=None,
             BSC_FALLBACK_RPC_URLS=None):
        bi._QUICKNODE_DISABLED.clear()
        check("the default public list is empty, since no candidate passed",
              bi._chain_urls(56) == ["https://bsc.rpc.blxrbdn.com", want])
    with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN, BSC_MAINNET_RPC_URL=None,
             BSC_FALLBACK_RPC_URLS=f" {PUBLIC_URL} , https://node2.public-bsc.example/ ,"):
        check("order: bloXroute, QuickNode, then the public fallbacks",
              bi._chain_urls(56) == ["https://bsc.rpc.blxrbdn.com", want, PUBLIC_URL,
                                     "https://node2.public-bsc.example/"],
              str([bi._host(u) for u in bi._chain_urls(56)]))
    with env(QUICKNODE_ENDPOINT=None, QUICKNODE_TOKEN=None, BSC_MAINNET_RPC_URL=None,
             INFURA_API_KEY=None, BSC_FALLBACK_RPC_URLS=PUBLIC_URL):
        check("no QuickNode: bloXroute then the public fallbacks",
              bi._chain_urls(56) == ["https://bsc.rpc.blxrbdn.com", PUBLIC_URL])
    with env(BSC_FALLBACK_RPC_URLS=PUBLIC_URL):
        check("other chains take no BSC fallback", PUBLIC_URL not in bi._chain_urls(42161))

    # QuickNode refuses (the trial has ended); the public fallback serves.
    bi._QUICKNODE_DISABLED.clear()
    mock = _MockRPC(logs, head56, "refuse")
    db = FakeDB()
    buf = io.StringIO()
    with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN, BSC_MAINNET_RPC_URL=None,
             BSC_FALLBACK_RPC_URLS=PUBLIC_URL), via_local(mock), contextlib.redirect_stdout(buf):
        r = await bi.refresh_chain(db, 56, max_pages=10)
        urls_after = bi._chain_urls(56)
    mock.close()
    out = buf.getvalue()
    qn = [x for x in mock.seen if x["host"].endswith(".quiknode.pro")]
    pub = [x for x in mock.seen if x["host"].endswith(PUBLIC_HOST_SUFFIX)]
    check("a 401 disables QuickNode after one request", len(qn) == 1, f"{len(qn)} QuickNode requests")
    check("with one log line", out.count("QuickNode answered HTTP 401; disabled") == 1)
    check("and it leaves the provider list", urls_after == ["https://bsc.rpc.blxrbdn.com", PUBLIC_URL],
          str([bi._host(u) for u in urls_after]))
    check("the public fallback carries the pass to the head",
          r["caught_up"] and r["pages"] == 3 and r["new_draws"] == 1, str(r))
    check("no public request carried the token", all(x["x-token"] is None for x in pub))
    pday = await rpc_credits.today(db, "public:node1.public-bsc.example")
    check("public calls are counted at 0 credits under their own name",
          pday["calls"] == len(pub) and pday["credits"] == 0, f"{pday.get('calls')} calls")
    qday = await rpc_credits.today(db, "quicknode")
    check("the refused QuickNode call is still counted", qday["calls"] == 1)
    check("the token appears nowhere in this run's output", QN_TOKEN not in out and QN_NAME not in out)
    bi._QUICKNODE_DISABLED.clear()

    # A keyed fallback URL never shows its key.
    secret_fb = "https://keyed.public-bsc.example/v1/" + "k3y" * 10
    with env(BSC_FALLBACK_RPC_URLS=secret_fb):
        d = describe(JsonRpcError({"code": -1, "message": f"no route {secret_fb}"}))
        check("a keyed fallback URL is redacted in describe()", "k3y" not in d, d)

    print("credits")
    db = FakeDB()
    buf = io.StringIO()
    with env(QUICKNODE_CREDITS_PER_DAY="100"), contextlib.redirect_stdout(buf):
        totals = [await rpc_credits.record(db, "quicknode", 56) for _ in range(6)]
    out = buf.getvalue()
    check("credits accumulate atomically per call", totals == [20, 40, 60, 80, 100, 120], str(totals))
    check("the 80% warning is logged once", out.count("80% of the 100 daily budget") == 1, out.strip())
    check("and the 100% warning once", out.count("100% of the 100 daily budget") == 1)

    class Broken:
        def __getitem__(self, name):
            raise ConnectionError("store down")
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        got = await rpc_credits.record(Broken(), "quicknode", 56)
    check("a failed count is logged and does not raise",
          got is None and "could not count" in buf.getvalue(), buf.getvalue().strip())

    # Cost of one full pass at the default cap, if every call failed over.
    per_pass = (bi.DEFAULT_MAX_PAGES_PER_PASS * 2 + 2) * rpc_credits.credits_per_call("quicknode", 56)
    check("a full pass at worst stays well under the daily budget",
          per_pass * 24 < rpc_credits.DEFAULT_DAILY_BUDGET * 0.5,
          f"{per_pass} a pass, {per_pass * 24} a day at worst, budget {rpc_credits.DEFAULT_DAILY_BUDGET}")


# ── the review fixes of 2026-09-26 ──────────────────────────────────────────

def _router(routes: dict):
    """A MockTransport handler that dispatches on host, then on whether the
    request is the head, the control (unfiltered) or a page, counting each."""
    counts: dict[str, int] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        body = json.loads(request.content)
        kind = "head" if body["method"] == "eth_blockNumber" else (
            "control" if "topics" not in body["params"][0] else "page")
        key = f"{host}:{kind}"
        counts[key] = counts.get(key, 0) + 1
        counts[f"{host}:x-token"] = counts.get(f"{host}:x-token", 0) + int("x-token" in request.headers)
        return routes[host](kind, body, counts[key])
    return handler, counts


def _ok(result):
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": result})


def _rpc_err(code, msg, status=200):
    return httpx.Response(status, json={"jsonrpc": "2.0", "id": 1, "error": {"code": code, "message": msg}})


def _requests_to(counts: dict, prefix: str) -> int:
    return sum(v for k, v in counts.items() if k.startswith(prefix) and not k.endswith(":x-token"))


async def review_checks() -> None:
    from core import quicknode
    from core.safe_errors import redact

    A, B = "https://a.example/rpc", "https://b.example/rpc"
    floor = FLOOR
    one_log = [opened_log(1, floor, "0x" + "a1" * 32)]

    print("control retries (item 2)")
    def a_route(kind, body, n):
        if kind == "control":
            return _rpc_err(-32603, "service temporarily unavailable") if n == 1 else _ok(one_log)
        return _ok([])
    h, counts = _router({"a.example": a_route})
    cache: dict = {}
    async with httpx.AsyncClient(transport=httpx.MockTransport(h)) as c:
        ok = await bi._provider_serves_logs(c, CHAIN, A, cache)
    check("a transient control failure is retried once and then trusted",
          ok and cache.get(A) is True and counts["a.example:control"] == 2, str(counts))

    def b_route(kind, body, n):
        return httpx.Response(429, text="slow down") if kind == "control" else _ok([])
    h, counts = _router({"a.example": b_route})
    cache = {}
    buf = io.StringIO()
    async with httpx.AsyncClient(transport=httpx.MockTransport(h)) as c:
        with contextlib.redirect_stdout(buf):
            ok1 = await bi._provider_serves_logs(c, CHAIN, A, cache)
            ok2 = await bi._provider_serves_logs(c, CHAIN, A, cache)
    check("a control that errors twice marks the endpoint untrusted for the pass",
          not ok1 and not ok2 and cache.get(A) is False and counts["a.example:control"] == 2, str(counts))
    check("and the log says so, with the status",
          "could not be read" in buf.getvalue() and "HTTP 429" in buf.getvalue())

    def c_route(kind, body, n):
        return _ok([])
    h, counts = _router({"a.example": c_route})
    cache = {}
    async with httpx.AsyncClient(transport=httpx.MockTransport(h)) as c:
        with contextlib.redirect_stdout(io.StringIO()):
            await bi._provider_serves_logs(c, CHAIN, A, cache)
            await bi._provider_serves_logs(c, CHAIN, A, cache)
    check("an honest [] from the control is cached",
          cache.get(A) is False and counts["a.example:control"] == 1, str(counts))

    page_log = [drawn_log(1, floor + 3, "0x" + "d9" * 32)]

    def d_a(kind, body, n):
        return _ok(one_log) if kind == "control" else httpx.Response(502, text="bad gateway")

    def d_b(kind, body, n):
        return _ok(one_log) if kind == "control" else _ok(page_log)
    h, counts = _router({"a.example": d_a, "b.example": d_b})
    real_urls = bi._chain_urls
    bi._chain_urls = lambda cid: [A, B]
    try:
        async with httpx.AsyncClient(transport=httpx.MockTransport(h)) as c:
            got = await bi._scan_page(c, CHAIN, bi.DRAWN_TOPIC, floor, floor + 10, {})
        check("a page error on one endpoint goes to the next rather than raising",
              got == page_log, str(counts))

        def e_route(kind, body, n):
            return _rpc_err(-32005, "limit exceeded")
        h, counts = _router({"a.example": e_route, "b.example": e_route})
        async with httpx.AsyncClient(transport=httpx.MockTransport(h)) as c:
            try:
                await bi._scan_page(c, CHAIN, bi.DRAWN_TOPIC, floor, floor + 10, {})
                msg = ""
            except RuntimeError as e:
                msg = str(e)
        check("the page raises only when all have failed, naming each",
              "a.example: JsonRpcError, JSON-RPC -32005" in msg and "b.example:" in msg, msg[:200])
    finally:
        bi._chain_urls = real_urls

    print("control cost")
    # An erroring primary over ten windows: at most 2 control calls a pass.
    head10 = FLOOR + 10 * STEP - 1

    def err_primary(kind, body, n):
        if kind == "head":
            return _ok(hex(head10))
        return httpx.Response(504, text="gateway timeout") if kind == "control" else _ok([])

    def good_second(kind, body, n):
        if kind == "head":
            return _ok(hex(head10))
        p = body["params"][0]
        lo, hi = int(p["fromBlock"], 16), int(p["toBlock"], 16)
        return _ok([lg for lg in one_log if lo <= int(lg["blockNumber"], 16) <= hi
                    and ("topics" not in p or lg["topics"][0] == p["topics"][0])])
    h, counts = _router({"a.example": err_primary, "b.example": good_second})
    real_urls, real_client = bi._chain_urls, bi.httpx.AsyncClient
    bi._chain_urls = lambda cid: [A, B]
    bi.httpx.AsyncClient = lambda *a, **k: real_client(transport=httpx.MockTransport(h))
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            r = await bi.refresh_chain(FakeDB(), CHAIN, max_pages=10)
            r2 = await bi.refresh_chain(FakeDB(), CHAIN, max_pages=10)
    finally:
        bi._chain_urls, bi.httpx.AsyncClient = real_urls, real_client
    check("an erroring primary costs at most 2 control calls a pass",
          counts.get("a.example:control", 0) == 4 and r["pages"] == 10 and r2["pages"] == 10,
          f"{counts.get('a.example:control')} control calls over two passes of {r['pages']} windows")

    # A public fallback whose control passed: re-checked on empty pages, at
    # most PUBLIC_RECHECKS_PER_PASS times a pass.
    head30 = FLOOR + 30 * STEP - 1

    def pub(kind, body, n):
        if kind == "head":
            return _ok(hex(head30))
        return _ok(one_log) if kind == "control" else _ok([])
    h, counts = _router({"a.example": err_primary, "node1.public-bsc.example": pub})
    real_urls, real_client = bi._chain_urls, bi.httpx.AsyncClient
    bi._chain_urls = lambda cid: [A, PUBLIC_URL]
    bi.httpx.AsyncClient = lambda *a, **k: real_client(transport=httpx.MockTransport(h))
    buf = io.StringIO()
    try:
        with env(BSC_FALLBACK_RPC_URLS=PUBLIC_URL), contextlib.redirect_stdout(buf):
            real_pf = bi._public_fallbacks
            bi._public_fallbacks = lambda cid: [PUBLIC_URL]
            try:
                await bi.refresh_chain(FakeDB(), CHAIN, max_pages=30)
                raised = ""
            except RuntimeError as e:
                raised = str(e)
            finally:
                bi._public_fallbacks = real_pf
    finally:
        bi._chain_urls, bi.httpx.AsyncClient = real_urls, real_client
    pc = counts.get("node1.public-bsc.example:control", 0)
    check("a passed public control is re-checked, capped per pass",
          pc == 1 + bi.PUBLIC_RECHECKS_PER_PASS, f"{pc} control calls")
    check("past the cap its empties are refused, and the log says so",
          "re-checks this pass" in buf.getvalue() and "not vouched" in raised, raised[:160])

    print("QuickNode switch (item 3)")
    ours = f"https://{QN_NAME}.bsc.quiknode.pro/"
    other = "https://someone-else.bsc.quiknode.pro/"
    with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN):
        check("x-token goes to our exact host", quicknode.headers_for(ours) == {"x-token": QN_TOKEN})
        check("and to no other *.quiknode.pro host",
              quicknode.headers_for(other) == {} and not quicknode.is_configured_host(other))
        check("chain 1 is left unmapped", quicknode.url_for(1) is None)

    floor56 = bi.FIRST_BUDGET_BLOCK[56]
    step56 = bi.LOG_PAGE_BLOCKS[56] + 1
    head56 = floor56 + 3 * step56 - 1
    logs56 = [opened_log(1, floor56, "0x" + "b1" * 32)]

    def serve(kind, body, n):
        if kind == "head":
            return _ok(hex(head56))
        p = body["params"][0]
        lo, hi = int(p["fromBlock"], 16), int(p["toBlock"], 16)
        topic = (p.get("topics") or [None])[0]
        return _ok([lg for lg in logs56 if lo <= int(lg["blockNumber"], 16) <= hi
                    and (topic is None or lg["topics"][0] == topic)])

    def untrusted(kind, body, n):
        return _ok(hex(head56)) if kind == "head" else _ok([])

    def refuse401(kind, body, n):
        return httpx.Response(401, text="no")

    def refuse403(kind, body, n):
        return httpx.Response(403, text="edge")

    real_client = bi.httpx.AsyncClient
    try:
        bi._QUICKNODE_DISABLED.clear()
        h, counts = _router({"bsc.rpc.blxrbdn.com": untrusted, f"{QN_NAME}.bsc.quiknode.pro": serve,
                             "someone-else.bsc.quiknode.pro": refuse401})
        bi.httpx.AsyncClient = lambda *a, **k: real_client(transport=httpx.MockTransport(h))
        with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN, BSC_MAINNET_RPC_URL=None,
                 BSC_FALLBACK_RPC_URLS=other):
            with contextlib.redirect_stdout(io.StringIO()):
                r = await bi.refresh_chain(FakeDB(), 56, max_pages=10)
        check("another QuickNode host's 401 does not disable ours",
              not bi._QUICKNODE_DISABLED and r["caught_up"], str(r))
        check("and that host never received our token",
              counts.get("someone-else.bsc.quiknode.pro:x-token", 0) == 0)

        bi._QUICKNODE_DISABLED.clear()
        h, counts = _router({"bsc.rpc.blxrbdn.com": untrusted, f"{QN_NAME}.bsc.quiknode.pro": refuse403,
                             "node1.public-bsc.example": serve})
        bi.httpx.AsyncClient = lambda *a, **k: real_client(transport=httpx.MockTransport(h))
        db = FakeDB()
        buf = io.StringIO()
        with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN, BSC_MAINNET_RPC_URL=None,
                 BSC_FALLBACK_RPC_URLS=PUBLIC_URL):
            with contextlib.redirect_stdout(buf):
                r1 = await bi.refresh_chain(db, 56, max_pages=10)
                after_1 = _requests_to(counts, QN_NAME)
                await db[bi.PROGRESS_COLLECTION].update_one({"chain_id": 56}, {"$set": {"next_block": floor56}})
                r2 = await bi.refresh_chain(db, 56, max_pages=10)
                after_2 = _requests_to(counts, QN_NAME)
        out = buf.getvalue()
        check("a 403 skips QuickNode for the rest of the pass after one request",
              after_1 == 1 and r1["caught_up"], f"{after_1} QuickNode requests in pass 1")
        check("the next pass tries it again", after_2 == 2 and r2["caught_up"],
              f"{after_2} QuickNode requests after pass 2")
        check("a 403 does not disable it for the process", not bi._QUICKNODE_DISABLED)
        check("one 403 log line per pass", out.count("QuickNode answered HTTP 403") == 2)
    finally:
        bi.httpx.AsyncClient = real_client
        bi._QUICKNODE_DISABLED.clear()

    print("redaction (item 5)")
    with env(BSC_MAINNET_RPC_URL="https://bsc.rpc.blxrbdn.com", FRONTEND_URL="https://tnega.example"):
        t = redact("primary https://bsc.rpc.blxrbdn.com and site tnega.example failed", 300)
        check("a host is not hidden for being a *_URL value",
              "bsc.rpc.blxrbdn.com" in t and "tnega.example" in t, t)
    t = redact("execution_reverted_by_the_contract_call at " + "ab" * 32 + " from " + "cd" * 20, 400)
    check("plain words with underscores survive", "execution_reverted_by_the_contract_call" in t, t)
    check("a bare 64-hex hash survives", "ab" * 32 in t, t)
    check("a bare 40-hex run is masked (a QuickNode token's shape)", "cd" * 20 not in t, t)
    t = redact("to 0x" + "cd" * 20 + " tx 0x" + "ef" * 32, 300)
    check("0x-prefixed addresses and hashes survive", "0x" + "cd" * 20 in t and "0x" + "ef" * 32 in t, t)
    t = redact("key ABCDEFGHJKLMNPQRSTUVWXYZAB here", 300)
    check("an all-capitals run of 24+ is masked", t == "key [redacted] here", t)
    t = redact("amount 1234567890123456789012345678 wei", 300)
    check("a digits-only run is kept", "1234567890123456789012345678" in t, t)
    for code in (1.5, None, True, {"x": 1}):
        d = describe(JsonRpcError({"code": code, "message": "m"}))
        check(f"a {type(code).__name__} code prints as ?", d == "JSON-RPC ?: m", d)
    d = describe(JsonRpcError({"code": "E_" + "Ab1" * 10, "message": "m"}))
    check("a string code goes through redact", d == "JSON-RPC [redacted]: m", d)
    t = redact("key f00dfeedcafe4b1d9a0c7e2b3d4a5f60x")
    check("a mixed key-like run is still masked", t == "key [redacted]", t)
    req = httpx.Request("POST", "https://bsc-rpc.publicnode.com/")
    d = ""
    try:
        httpx.Response(403, json={"jsonrpc": "2.0", "id": 1, "error": {
            "code": -32602, "message": "Archive requests require a personal token"}},
            request=req).raise_for_status()
    except httpx.HTTPStatusError as e:
        d = describe(e)
    check("a non-2xx JSON-RPC body keeps its code and message",
          d == "HTTP 403, JSON-RPC -32602: Archive requests require a personal token", d)
    try:
        httpx.Response(429, text="Too Many Requests", request=req).raise_for_status()
    except httpx.HTTPStatusError as e:
        d = describe(e)
    check("a non-JSON non-2xx is still just its status", d == "HTTP 429", d)
    d = describe(JsonRpcError({"code": "RATE_LIMIT", "message": "slow down"}))
    check("a string error code is printed as it is", d == "JSON-RPC RATE_LIMIT: slow down", d)
    with env(QUICKNODE_ENDPOINT=QN_NAME, QUICKNODE_TOKEN=QN_TOKEN):
        t = redact(f"refused by https://{QN_NAME}.bsc.quiknode.pro/x and by {QN_NAME}.bsc.quiknode.pro", 300)
        check("a QuickNode host, with or without a scheme, shows <endpoint>",
              QN_NAME not in t and "https://<endpoint>.bsc.quiknode.pro/..." in t
              and "by <endpoint>.bsc.quiknode.pro" in t, t)
        t = redact(f"label {QN_NAME} on example.com", 300)
        check("the label is replaced only inside a *.quiknode.pro host", QN_NAME in t, t)
    with env(BSC_FALLBACK_RPC_URLS="https://rpc.keyed.example/v1/k9x2,https://other.example/rpc/public"):
        t = redact("invalid key k9x2 for rpc public v1", 300)
        check("a short echoed fallback key is removed", "k9x2" not in t, t)
        check("while plain path words stay", "rpc public v1" in t, t)
    with env(BSC_MAINNET_RPC_URL="https://bsc.custom.example/Ab12"):
        t = redact("bad credential Ab12", 300)
        check("a short key in BSC_MAINNET_RPC_URL is removed", "Ab12" not in t, t)

    print("quiet pass and index (items 6, 7)")
    db = FakeDB()
    ch = FakeChain(FLOOR + STEP - 1, standard_logs())
    with wired(ch, [PRIMARY]), contextlib.redirect_stdout(io.StringIO()):
        await bi.refresh_chain(db, CHAIN, max_pages=10)
        await db[bi.PROGRESS_COLLECTION].update_one({"chain_id": CHAIN}, {"$set": {"updated_at": 1}})
        before = await db[bi.PROGRESS_COLLECTION].find_one({"chain_id": CHAIN})
        r = await bi.refresh_chain(db, CHAIN, max_pages=10)
    after = await db[bi.PROGRESS_COLLECTION].find_one({"chain_id": CHAIN})
    check("a caught-up pass with nothing new still sets updated_at",
          r["pages"] == 0 and after["updated_at"] > 1,
          f"{before.get('updated_at')} -> {after.get('updated_at')}")
    check("and leaves progress_at and behind_blocks as they were",
          after.get("progress_at") == before.get("progress_at")
          and after.get("behind_blocks") == before.get("behind_blocks"))
    await db[bi.PROGRESS_COLLECTION].update_one({"chain_id": CHAIN}, {"$set": {"last_error": "old"}})
    with wired(ch, [PRIMARY]), contextlib.redirect_stdout(io.StringIO()):
        await bi.refresh_chain(db, CHAIN, max_pages=10)
    after = await db[bi.PROGRESS_COLLECTION].find_one({"chain_id": CHAIN})
    check("a quiet caught-up pass clears last_error", after.get("last_error") is None, str(after.get("last_error")))
    idx = db[bi.COLLECTION].indexes.get(bi.UNIQUE_INDEX_NAME)
    check("the unique (chain_id, budget_id) index is ensured",
          idx == {"keys": ["chain_id", "budget_id"], "unique": True}, str(idx))
    dup = FakeDB()
    dup[bi.COLLECTION].docs += [{"_id": 1, "chain_id": CHAIN, "budget_id": 1, "draws": 0},
                                {"_id": 2, "chain_id": CHAIN, "budget_id": 1, "draws": 0}]
    buf = io.StringIO()
    with wired(ch, [PRIMARY]), contextlib.redirect_stdout(buf):
        r = await bi.refresh_chain(dup, CHAIN, max_pages=10)
    check("duplicates make the index fail loudly, and the refresh goes on",
          "could not ensure the unique" in buf.getvalue() and r["caught_up"],
          (buf.getvalue().splitlines() or [""])[0][:160])


async def _stats(db) -> dict:
    return await bi.get_agent_budget_stats(db, [CHAIN])


# getBudget(uint256) selector; Budget is a static struct, ten words, and
# status (NONE, OPEN, CLOSED, RECLAIMED) is the tenth.
_GET_BUDGET = "0x2e4ea4c4"
_STATUS = ["NONE", "OPEN", "CLOSED", "RECLAIMED"]
LIVE_FLOOR_PAGES = 20     # about 98,000 blocks from budget #1, 40 getLogs calls
LIVE_BACKLOG_PAGES = 3    # one capped pass over the real stored backlog


async def live() -> None:
    """Read-only on BSC and on the production collections; every write goes
    to the in-memory FakeDB.

    0. The stored chain-56 documents and cursor, read from production.
    1. From the budget #1 floor, LIVE_FLOOR_PAGES pages into a fresh store,
       compared with the stored budgets 1 to 3, then the same pages again.
    2. The stored documents and cursor copied into a fresh store, then one
       capped pass over the real backlog, so the migration and the
       page-by-page cursor run against the real endpoint.
    3. Budget 3's status read from getBudget.

    Each step is run on its own. A step that fails, or that needs a step
    that failed, is reported as "not run: <reason>" and the rest go on."""
    results: dict[str, str] = {}
    ctx: dict = {}

    async def step(name: str, fn, needs: tuple[str, ...] = ()):
        missing = [n for n in needs if not results.get(n, "").startswith("completed")]
        if missing:
            results[name] = f"not run: needs step {', '.join(missing)}"
        else:
            try:
                await fn()
                results[name] = "completed"
            except Exception as e:  # noqa: BLE001 -- reported, the next step goes on
                why = str(e) if type(e) is RuntimeError else f"{type(e).__name__}: {describe(e)}"
                from core.safe_errors import redact
                results[name] = f"not run: {redact(why, 300)}"
        print(f"  step {name}: {results[name]}")

    async def s0():
        from motor.motor_asyncio import AsyncIOMotorClient
        uri, name = os.environ.get("MONGODB_URI"), os.environ.get("MONGODB_DB_NAME")
        if not (uri and name):
            raise RuntimeError("MONGODB_URI or MONGODB_DB_NAME not set")
        prod = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=15000)[name]
        ctx["stored"] = {d["budget_id"]: d async for d in
                         prod[bi.COLLECTION].find({"chain_id": 56}, {"_id": 0})}
        ctx["sprog"] = await prod[bi.PROGRESS_COLLECTION].find_one({"chain_id": 56}, {"_id": 0})
        print(f"  stored progress: {ctx['sprog']}")
        for bid in sorted(ctx["stored"]):
            print(f"  stored budget {bid}: {ctx['stored'][bid]}")

    async def s1():
        stored = ctx["stored"]
        db = FakeDB()
        r = await bi.refresh_chain(db, 56, max_pages=LIVE_FLOOR_PAGES)
        print(f"  result: {r}")
        mine = {d["budget_id"]: d for d in db[bi.COLLECTION].docs if d["chain_id"] == 56}
        for bid in sorted(mine):
            d = mine[bid]
            print(f"  read budget {bid}: agent {d.get('agent')} opened {d.get('opened_block')} "
                  f"draws {d.get('draws')} ids {d.get('draw_ids')}")
        for bid in (1, 2, 3):
            a, b = mine.get(bid, {}), stored.get(bid, {})
            check(f"budget {bid}: agent, opened block and draws match the stored record",
                  bool(a) and a.get("agent") == b.get("agent")
                  and a.get("opened_block") == b.get("opened_block")
                  and int(a.get("draws") or 0) == int(b.get("draws") or 0),
                  f"read draws {a.get('draws')}, stored draws {b.get('draws')}")
        check("budget 1 drawn once, by one event id",
              mine.get(1, {}).get("draws") == 1 and len(mine.get(1, {}).get("draw_ids", [])) == 1)
        before = copy.deepcopy(mine)
        await db[bi.PROGRESS_COLLECTION].update_one(
            {"chain_id": 56}, {"$set": {"next_block": bi.FIRST_BUDGET_BLOCK[56]}})
        r2 = await bi.refresh_chain(db, 56, max_pages=LIVE_FLOOR_PAGES)
        after = {d["budget_id"]: d for d in db[bi.COLLECTION].docs if d["chain_id"] == 56}
        check("re-reading the same real pages changes nothing",
              after == before and r2["new_draws"] == 0, f"new_draws {r2['new_draws']}")

    async def s2():
        stored, sprog = ctx["stored"], ctx["sprog"] or {}
        db2 = FakeDB()
        for i, d in enumerate(stored.values()):
            db2[bi.COLLECTION].docs.append({"_id": 1000 + i, "chain_id": 56, **copy.deepcopy(d)})
        db2[bi.PROGRESS_COLLECTION].docs.append({"_id": 2000, "chain_id": 56, **copy.deepcopy(sprog)})
        r3 = await bi.refresh_chain(db2, 56, max_pages=LIVE_BACKLOG_PAGES)
        print(f"  result: {r3}")
        step = bi.LOG_PAGE_BLOCKS[56] + 1
        check("the cursor moved by exactly the capped pages",
              r3["next_block"] == int(sprog["next_block"]) + LIVE_BACKLOG_PAGES * step
              and not r3["caught_up"], f"{sprog.get('next_block')} -> {r3['next_block']}")
        got = {d["budget_id"]: d for d in db2[bi.COLLECTION].docs}
        check("the stored counts survive migration as legacy counts",
              all(got[b]["legacy_draws"] == int(stored[b].get("draws") or 0)
                  and got[b]["draws"] >= got[b]["legacy_draws"] for b in stored),
              str({b: (got[b]["draws"], got[b]["legacy_draws"]) for b in got}))

    async def s3():
        async with httpx.AsyncClient() as c:
            raw = await bi._rpc(c, 56, "eth_call", [{"to": bi.ESCROW_ADDRESS[56],
                                                    "data": _GET_BUDGET + format(3, "064x")}, "latest"])
        words = [raw[2 + 64 * i: 2 + 64 * (i + 1)] for i in range(10)]
        status = _STATUS[int(words[9], 16)]
        print(f"  budget 3: agent 0x{words[1][-40:]}, status {status}")
        check("budget 3 is open", status == "OPEN", status)

    print(f"live BSC (endpoints: {[bi._host(u) for u in bi._chain_urls(56)]})")
    await step("0 production read", s0)
    await step("1 from the floor", s1, ("0 production read",))
    await step("2 capped backlog pass", s2, ("0 production read",))
    await step("3 budget 3 status", s3)
    print("  live summary: " + "; ".join(f"{k}: {v}" for k, v in results.items()))
    NOT_RUN.extend(k for k, v in results.items() if v.startswith("not run"))


def main() -> int:
    bi.CONTROL_RETRY_SECONDS = 0.0
    asyncio.run(offline())
    asyncio.run(quicknode_checks())
    asyncio.run(review_checks())
    if "--live" in sys.argv:
        asyncio.run(live())
    print(f"\n{'FAILED: ' + ', '.join(FAILURES) if FAILURES else 'all checks passed'}"
          + (f"; live steps not run: {', '.join(NOT_RUN)}" if NOT_RUN else ""))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
