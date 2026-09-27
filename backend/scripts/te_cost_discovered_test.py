"""
te_cost_discovered_test.py

Offline test (no network): a discovered pool that fails the venue checks is
kept, with its verdict, and offered again at the next ranking; a pool found
twice is stored once; a version whose pools all fail is served as
not_a_venue or too_thin, never no_pool.

    ./venv/bin/python scripts/te_cost_discovered_test.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.te.cost import _version_doc, pack  # noqa: E402
from core.te.cost_job import apply_verdicts, candidates, merge_discovered  # noqa: E402

fails = []


def check(name, ok):
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}")
    if not ok:
        fails.append(name)


TOKEN = "0x1111111111111111111111111111111111111111"
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
MGR = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
rec = {"key": f"4663/{TOKEN}", "chain_id": 4663, "address": TOKEN, "symbol": "TEST", "decimals": 18,
       "underlying": "TEST", "issuer": "robinhood", "pools": []}
by_addr = {TOKEN: rec}
good = {"token": TOKEN, "f": "v4", "mgr": MGR, "fee": 2457, "ts": 50, "hooks": "0x" + "00" * 20, "qa": USDG,
        "src": "initialize_log", "id": "0xaa"}
bad = dict(good, fee=50000, id="0xbb")

meta: dict = {}
check("two new pools are added", merge_discovered(meta, [good, bad], by_addr) == 2)
check("the same pools found again are not added twice", merge_discovered(meta, [good, bad], by_addr) == 0)
held = meta["discovered"][rec["key"]]
check("both carry the verdict 'new'", [x[8] for x in held] == ["new", "new"])

# a ranking that fails the bad pool and passes the good one
summary = {rec["key"]: {"verdicts": [(pack(good), "ok"), (pack(bad), "not_a_venue")]}}
apply_verdicts(meta, summary)
held = meta["discovered"][rec["key"]]
check("the failing pool is still held after the ranking", len(held) == 2)
check("its verdict is recorded", {x[2]: x[8] for x in held} == {2457: "ok", 50000: "not_a_venue"})
check("both are offered again at the next ranking", len(candidates([rec], meta)[rec["key"]]) == 2)

# the next ranking fails both: still held, and the version says why
apply_verdicts(meta, {rec["key"]: {"verdicts": [(pack(good), "too_thin"), (pack(bad), "not_a_venue")]}})
check("still both held after every pool fails", len(meta["discovered"][rec["key"]]) == 2)
why = {"screened": 2, "dropped": 2, "not_a_venue": ["LP fee 5% exceeds 1%"],
       "too_thin": ["+-2% depth $900 is under the $2,000 floor"], "thin_depth_usd": 900}
doc = _version_doc(rec, [], why, {}, {}, 1, 0.0, False, "test", {"status": "complete"}, [], None, 0)
check(f"a version whose pools all fail is served as too_thin (got {doc['state']})", doc["state"] == "too_thin")
doc = _version_doc(rec, [], {"screened": 1, "dropped": 1, "not_a_venue": ["LP fee 5% exceeds 1%"]}, {}, {}, 1, 0.0,
                   False, "test", {"status": "complete"}, [], None, 0)
check(f"and as not_a_venue when none is merely thin (got {doc['state']})", doc["state"] == "not_a_venue")

print(f"\n{'all passed' if not fails else f'{len(fails)} failed'}")
sys.exit(1 if fails else 0)
