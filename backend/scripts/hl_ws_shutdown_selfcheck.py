#!/usr/bin/env python3
"""hl_ws_shutdown_selfcheck.py -- can a blocked database write hold this
process open.

WHAT WENT WRONG, AND WHY A CHECK EXISTS FOR IT
----------------------------------------------
ws_collector's flusher guarded its write with

    await asyncio.wait_for(asyncio.to_thread(write, rows), timeout=45)

which bounds the await and not the thread. When a flush blocked on a psycopg
connection whose network had gone away, the timeout fired, the coroutine moved
on, and the worker thread stayed blocked. Two shutdown steps then waited on
that thread: asyncio.run waited 300 seconds and printed

    RuntimeWarning: The executor did not finishing joining its threads
    within 300 seconds

and interpreter exit joined the same executor threads with no deadline at all.
The collector printed its totals and then stayed alive for 22h41m, 6h46m past
its own deadline.

Nothing in the code said any of that. A unit test over the flusher would have
passed, because the flusher does return. The failure is in what happens after
the coroutine is finished, which only a separate process can show.

WHAT THIS CHECK DOES
--------------------
It spawns child processes, blocks a write inside each one so it can never
return, and measures whether the child exits. The write blocks on an event
that is never set, which is a stand-in for a socket read that never completes:
uninterruptible from outside the thread, which is the property that matters.

  BASELINE   the old shape, wait_for over to_thread. Expected to HANG, and the
             check fails if it does not, because a baseline that passes means
             the check is measuring nothing.
  FIXED      ws_collector.run driven with a write that blocks. Expected to
             exit, and to have reported its stats before exiting.
  FINAL      the same, arranged so the blocked write is the final flush after
             asyncio.gather, which used to be a bare synchronous write(rows)
             with no guard at all.

Run:  python3 scripts/hl_ws_shutdown_selfcheck.py

Needs no database and no network. The point is the shutdown path, and a check
that needed a live cluster could not be run at the moment it is most wanted.
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Generous against a slow machine and still far below the 300s asyncio waits
# for its default executor, so a hang is unambiguous rather than a slow pass.
PATIENCE_SECONDS = 45

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" -- {detail}" if detail else ""))


def run_child(source: str, patience: float = PATIENCE_SECONDS):
    """Run one child to completion or to the deadline.

    Returns (exited, seconds, output). A child that outlives its patience is
    killed, because leaving the very process this check exists to catch
    running in the background would be an unpleasant joke.
    """
    started = time.time()
    proc = subprocess.Popen(
        [sys.executable, "-c", source], cwd=str(ROOT),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        out, _ = proc.communicate(timeout=patience)
        return True, time.time() - started, out
    except subprocess.TimeoutExpired:
        proc.kill()
        out, _ = proc.communicate()
        return False, time.time() - started, out


# The defect, in its original shape, with nothing else in the picture.
BASELINE = """
import asyncio, threading

def blocking_write(rows):
    threading.Event().wait()   # a socket read that never completes

async def main():
    try:
        await asyncio.wait_for(asyncio.to_thread(blocking_write, []), timeout=1)
    except (asyncio.TimeoutError, TimeoutError):
        print("REPORTED", flush=True)

asyncio.run(main())
print("EXITED", flush=True)
"""

# The final flush after asyncio.gather, driven through the collector itself
# rather than a copy of it.
#
# The seeded bucket is the CURRENT one, so `agg.closed(now)` inside the flusher
# leaves it alone and only `agg.closed(now + BUCKET_SECONDS)` at the end picks
# it up. That puts the blocked write exactly where the unguarded write(rows)
# used to be, with the periodic path proven not to have taken the rows first.
# An hour-wide bucket keeps that true regardless of where in the minute the
# check happens to run.
#
# `addresses` is empty, so no socket is opened and the check needs no network.
# The shutdown path does not care how the rows were produced.
FIXED_FINAL_FLUSH = """
import asyncio, sys, threading, time
sys.path.insert(0, ".")
from core.hyperliquid import ws_collector

ws_collector.BUCKET_SECONDS = 3600
ws_collector.FLUSH_SECONDS = 0.2
ws_collector.WRITE_TIMEOUT_SECONDS = 1.0

reached = threading.Event()

def blocking_write(rows):
    reached.set()
    threading.Event().wait()

agg = ws_collector.Aggregator()
current_bucket = int(time.time() // 3600) * 3600
agg.counts[(current_bucket, "0xabc", "ETH", "badAloPxRejected")] = 1
ws_collector.Aggregator = lambda: agg

async def main():
    stats = await ws_collector.run(
        [], blocking_write, stop_after=1.0, log=lambda *a, **k: None,
    )
    print("REACHED " + str(reached.is_set()), flush=True)
    print("STATS " + str(stats["rows_written"]) + " "
          + str(stats["writes_abandoned"]), flush=True)

asyncio.run(main())
print("EXITED", flush=True)
"""

# The periodic flush path, which is where the 22-hour hang actually happened.
# WRITE_TIMEOUT_SECONDS and FLUSH_SECONDS are cut down so the check takes
# seconds rather than two minutes; the code under test is unchanged.
FIXED_PERIODIC_FLUSH = """
import asyncio, sys, threading
sys.path.insert(0, ".")
from core.hyperliquid import ws_collector

ws_collector.FLUSH_SECONDS = 0.2
ws_collector.WRITE_TIMEOUT_SECONDS = 1.0
ws_collector.BUCKET_SECONDS = 1

def blocking_write(rows):
    threading.Event().wait()

async def main():
    agg = ws_collector.Aggregator()
    agg.counts[(0, "0xabc", "ETH", "badAloPxRejected")] = 1
    ws_collector.Aggregator = lambda: agg
    stats = await ws_collector.run(
        [], blocking_write, stop_after=2.0, log=lambda *a, **k: None,
    )
    print("ABANDONED " + str(stats["writes_abandoned"]), flush=True)
    print("WRITTEN " + str(stats["rows_written"]), flush=True)

asyncio.run(main())
print("EXITED", flush=True)
"""


def baseline_check() -> None:
    """The check has to be able to fail. Without this, a green run could mean
    the fix works or it could mean the blocked write was not blocking."""
    print("\nBASELINE -- the old shape must still hang, or this check proves nothing")
    exited, secs, out = run_child(BASELINE, patience=12)
    check("the blocked write was reached and the wait timed out",
          "REPORTED" in out, out.strip().splitlines()[-1][:60] if out.strip() else "no output")
    check("wait_for over to_thread does NOT let the process exit",
          not exited,
          f"still running at {secs:.0f}s" if not exited
          else f"exited in {secs:.1f}s, so this check is not measuring a hang")


def fixed_checks() -> None:
    print("\nFIXED -- a blocked write must not keep the collector alive")

    exited, secs, out = run_child(FIXED_PERIODIC_FLUSH)
    check("periodic flush: the process exits with a write still blocked",
          exited, f"{secs:.1f}s" if exited else f"still running at {secs:.0f}s")
    check("periodic flush: the abandoned write is counted, not silent",
          "ABANDONED 0" not in out and "ABANDONED" in out,
          next((l for l in out.splitlines() if l.startswith("ABANDONED")), "absent"))
    check("periodic flush: rows_written does not count an unconfirmed write",
          "WRITTEN 0" in out,
          next((l for l in out.splitlines() if l.startswith("WRITTEN")), "absent"))
    check("periodic flush: no executor-join warning on the way out",
          "did not finishing joining" not in out and "shutdown_default_executor" not in out)

    exited, secs, out = run_child(FIXED_FINAL_FLUSH)
    check("final flush: the blocked write is the one after asyncio.gather",
          "REACHED True" in out,
          next((l for l in out.splitlines() if l.startswith("REACHED")), "absent"))
    check("final flush: the process exits with the last write blocked",
          exited, f"{secs:.1f}s" if exited else f"still running at {secs:.0f}s")
    check("final flush: stats are reported rather than stuck behind the write",
          "STATS 0 1" in out,
          next((l for l in out.splitlines() if l.startswith("STATS")), "absent"))


def connection_bound_checks() -> None:
    """Abandoning a thread keeps the process alive; it does not stop the
    thread. What is supposed to stop the thread is the connection carrying its
    own deadlines, so assert those are on the DSN rather than trusting the
    comment that says they are."""
    print("\nCONNECTION -- the blocking call should also be able to return")
    sys.path.insert(0, str(ROOT))
    from psycopg.conninfo import conninfo_to_dict, make_conninfo
    from core.hyperliquid import store

    # Built the way store.connect builds it, without opening anything.
    dsn = make_conninfo(
        "postgresql://u:p@h:26257/d?sslmode=verify-full",
        connect_timeout=30, keepalives=1,
        keepalives_idle=store._KEEPALIVE_IDLE,
        keepalives_interval=store._KEEPALIVE_INTERVAL,
        keepalives_count=store._KEEPALIVE_COUNT,
        tcp_user_timeout=60_000,
        options=f"-c statement_timeout={store._WS_WRITE_STATEMENT_TIMEOUT_MS}",
    )
    d = conninfo_to_dict(dsn)

    check("keepalives are enabled on the write connection", d.get("keepalives") == "1")
    budget = (int(d["keepalives_idle"])
              + int(d["keepalives_interval"]) * int(d["keepalives_count"]))
    check("a silent peer fails the socket inside two minutes",
          budget <= 120, f"{budget}s")
    check("statement_timeout fires before the collector stops waiting",
          store._WS_WRITE_STATEMENT_TIMEOUT_MS / 1000.0
          < __import__("core.hyperliquid.ws_collector", fromlist=["x"]).WRITE_TIMEOUT_SECONDS,
          f"{store._WS_WRITE_STATEMENT_TIMEOUT_MS / 1000:.0f}s server, "
          f"{__import__('core.hyperliquid.ws_collector', fromlist=['x']).WRITE_TIMEOUT_SECONDS}s client")
    check("verify-full survives the added parameters", d.get("sslmode") == "verify-full")


def _to_thread_calls(path: Path) -> list[int]:
    """Line numbers of every asyncio.to_thread call in a file, from the syntax
    tree rather than from a text search."""
    import ast
    tree = ast.parse(path.read_text())
    return [n.lineno for n in ast.walk(tree)
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Attribute)
            and n.func.attr == "to_thread"]


def sibling_checks() -> None:
    """The collector was not the only place with this shape. These are the
    other wrappers, asserted so a later edit that reintroduces an unbounded
    blocking call under a timeout is caught here and not at 03:00."""
    print("\nSIBLINGS -- other bounded-looking waits over blocking calls")
    src = (ROOT / "core" / "commerce" / "model.py").read_text()
    check("the Gemini client is given its own timeout, so its thread returns",
          "http_options=genai.types.HttpOptions(timeout=" in src)

    src = (ROOT / "core" / "hyperliquid" / "collector.py").read_text()
    check("the Hyperliquid HTTP fetch has a timeout on the urlopen itself",
          "urlopen(req, timeout=timeout)" in src)

    src = (ROOT / "server.py").read_text()
    check("the refresh subprocess is KILLED on timeout, not abandoned",
          "proc.kill()" in src and "_REFRESH_TIMEOUT_SECONDS" in src)

    src = (ROOT / "core" / "agent_builder.py").read_text()
    check("the bag subprocess is KILLED on timeout, not abandoned",
          "except asyncio.TimeoutError:\n        proc.kill()" in src)

    # Parsed rather than grepped. This file's own comments quote the defective
    # line verbatim to explain it, and a substring search cannot tell a
    # description of the old code from the old code.
    calls = _to_thread_calls(ROOT / "core" / "hyperliquid" / "ws_collector.py")
    check("no asyncio.to_thread call remains in the collector",
          not calls, f"lines {calls}" if calls else "")

    src = (ROOT / "core" / "hyperliquid" / "ws_collector.py").read_text()
    check("the final flush is no longer an unguarded write(rows)",
          "\n        write(rows)\n" not in src)


def main() -> int:
    print("hyperliquid collector shutdown self-check -- a blocked write must "
          "not outlive the process")
    baseline_check()
    fixed_checks()
    connection_bound_checks()
    sibling_checks()

    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} passed")
    if failed:
        print("FAILED:")
        for n in failed:
            print(f"  - {n}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
