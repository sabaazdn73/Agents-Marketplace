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

# ── the stored form: round trips ────────────────────────────────────────────
from core.te import chains as chains_mod  # noqa: E402
from core.te.cost_job import _sig, decode_pools, norm, pools_doc  # noqa: E402

ZERO = "0x" + "00" * 20
OTHER_MGR = "0x2222222222222222222222222222222222222222"
v4_none = ["v4", MGR, 3000, 60, None, USDG, None, "initialize_log", "ok", 1790000000]
v4_empty = ["v4", MGR, 500, 10, "", USDG, None, "initialize_log", "new", None]
v4_foreign = ["v4", OTHER_MGR, 100, 1, ZERO, USDG, None, "initialize_log", "too_thin", 1790000001]
v3 = ["v3", "0x3333333333333333333333333333333333333333", None, None, None, USDG, None, "universe", "ok", 1790000002]
entries = [v4_none, v4_empty, v4_foreign, v3]
doc = pools_doc(4663, rec["key"], entries, 1790000100)
back = decode_pools(4663, doc)
check("hooks None on a V4 pool decodes as the zero address, equal to the normalised input",
      back[0] == norm(v4_none) and back[0][4] == ZERO)
check("hooks \"\" likewise", back[1][4] == ZERO and back[1] == norm(v4_empty))
same_zero = list(v4_none); same_zero[4] = ZERO
meta2: dict = {}
merge_discovered(meta2, [dict(good, hooks=None)], by_addr)
check("None and zero-address hooks are the same pool for merging",
      _sig(v4_none) == _sig(same_zero) and merge_discovered(meta2, [dict(good, hooks=ZERO)], by_addr) == 0)
check("a manager other than the chain's own round-trips (no \"\" shorthand)", back[2][1] == OTHER_MGR)
check("every entry round-trips exactly", back == [norm(x) for x in entries])
check("a never-checked pool keeps no check time", back[1][9] is None)

saved = dict(chains_mod.CHAINS[4663])
try:
    st = saved["stables"]
    chains_mod.CHAINS[4663]["stables"] = dict(reversed(list(st.items())))      # reorder
    chains_mod.CHAINS[4663]["v4_manager"] = OTHER_MGR                         # and move the manager
    check("decode does not change when chains.py reorders stables or changes the manager",
          decode_pools(4663, doc) == back)
finally:
    chains_mod.CHAINS[4663].clear()
    chains_mod.CHAINS[4663].update(saved)

bad = ["infinity_cl", MGR, 100, 1, ZERO, USDG, "0xab|cd", "initialize_log", "ok", None]
doc2 = pools_doc(4663, rec["key"], [bad, v3], 1)
check("an entry holding a separator is skipped and counted; the rest is stored",
      doc2.get("skipped") == 1 and decode_pools(4663, doc2) == [norm(v3)])

v1 = {"_id": rec["key"], "c": 4663, "p": "1||3000|60||0||L|1|1790000000", "n": 1}
old = decode_pools(4663, v1)
check("a format-1 document (no version) is still read", old and old[0][1] == MGR and old[0][4] == ZERO and old[0][5] == USDG)

print(f"\n{'all passed' if not fails else f'{len(fails)} failed'}")
sys.exit(1 if fails else 0)
