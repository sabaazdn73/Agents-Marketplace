"""
te_cost_lease_test.py

Offline test (no network) that two processes cannot both hold the cost-cycle
lease: the owner is hostname:pid:role, so a second worker, even one with the
same role, is refused, and run_cycle refuses while another process holds it.

    ./venv/bin/python scripts/te_cost_lease_test.py
"""

import asyncio
import multiprocessing as mp
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.te.cost_store import FileStore  # noqa: E402
from core.te.cost_worker import lease_owner, run_cycle  # noqa: E402


def child(root: str, q) -> None:
    async def go():
        st = FileStore(root)
        got = await st.acquire_lease("te_cost_cycle", lease_owner(), 60)
        cycle = await run_cycle(st, chains=())
        q.put((lease_owner(), got, cycle))
    asyncio.run(go())


async def main() -> int:
    root = tempfile.mkdtemp(prefix="te_lease_")
    st = FileStore(root)
    fails = []
    me = lease_owner()
    ok = await st.acquire_lease("te_cost_cycle", me, 60)
    print(f"  {'ok  ' if ok else 'FAIL'}  this process ({me}) takes the lease")
    fails += [] if ok else ["first acquire"]
    q = mp.Queue()
    p = mp.Process(target=child, args=(root, q))
    p.start(); p.join(30)
    other, got, cycle = q.get(timeout=5)
    good = other != me and got is False and "skipped" in cycle
    print(f"  {'ok  ' if good else 'FAIL'}  a second worker ({other}) is refused the lease and its cycle is skipped: {cycle}")
    fails += [] if good else ["second refused"]
    await st.release_lease("te_cost_cycle", me)
    p = mp.Process(target=child, args=(root, q))
    p.start(); p.join(30)
    other, got, _cycle = q.get(timeout=5)
    print(f"  {'ok  ' if got else 'FAIL'}  after release, another process takes it")
    fails += [] if got else ["after release"]
    print(f"\n{'all passed' if not fails else f'{len(fails)} failed'}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
