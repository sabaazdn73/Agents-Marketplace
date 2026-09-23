"""
The tier ordinals, enforced rather than remembered.

  python3 test/verificationTier/tier-ordinals-and-min-tier.py

WHY THIS EXISTS
`agents_index.py` compares `self.tier[i] < min_tier` in `select()`. That is the
only ordinal comparison on a verification tier anywhere in the system, and it is
what a "verified" filter is implemented with. Every other surface carries the
tier as a STRING, so renumbering the constants is invisible everywhere except
that one line, where it silently changes which agents a verified filter returns.
Nothing throws. The page just quietly lists the wrong agents.

A fifth tier was added on 2026-09-23 and the ordinals were renumbered to put it
at the bottom. That was safe, and it was safe for a reason nobody had written
down: VERIFIED stayed the maximum, so `min_tier=TIER_VERIFIED` still means the
top tier and nothing else. The next person to add a tier has no way to know that
from reading the code, so this asserts it.

Two halves, because a rule that only lives in one assertion is a rule a future
change routes around:

  1. The invariants hold, including an end-to-end check that a verified filter
     over a built index returns exactly the verified agents.
  2. Nothing else compares a tier ordinal. A source scan over the backend fails
     on any inequality against a TIER_ constant outside the one line that is
     supposed to have it, so a second ordinal comparison cannot be introduced
     without this test going red.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from core import agents_index as ai  # noqa: E402

FAILURES = []


def check(ok: bool, what: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {what}" + (f"   ({detail})" if detail else ""))
    if not ok:
        FAILURES.append(what)


# ── 1. the invariants ────────────────────────────────────────────────────────

print("\ntier ordinals")

# DERIVED from the module, never hand-listed. A hand-listed set is how this
# test first passed while a sixth tier sat above VERIFIED: the new constant was
# simply absent from the list, so max() never saw it and the one assertion that
# mattered stayed green. Anything named TIER_* and integral is in scope, which
# means a new tier is inside every assertion below the moment it is declared.
ORDINALS = {name: value for name, value in vars(ai).items()
            if name.startswith("TIER_") and isinstance(value, int)
            and not isinstance(value, bool)}
EXPECTED_ORDER = ["TIER_VERIFIED", "TIER_CANARY_VERIFIED", "TIER_RESPONDING",
                  "TIER_UNPROVEN", "TIER_UNCHECKED"]

check(set(ORDINALS) == set(EXPECTED_ORDER),
      "the declared tier constants are the five this test knows about",
      f"undeclared here: {set(ORDINALS) - set(EXPECTED_ORDER) or 'none'}. "
      f"A new tier must be added to EXPECTED_ORDER deliberately, with a "
      f"decision about where it ranks, rather than inheriting a position.")

# THE ONE THAT MATTERS. `min_tier=TIER_VERIFIED` is how /api/agents?verified=true
# and the MCP verified boolean are implemented, and it means "this rank or
# better". If VERIFIED stops being the maximum, that filter starts admitting a
# weaker tier and says nothing about it.
check(ai.TIER_VERIFIED == max(ORDINALS.values()),
      "TIER_VERIFIED is the maximum ordinal",
      f"verified={ai.TIER_VERIFIED}, max={max(ORDINALS.values())} "
      f"({max(ORDINALS, key=ORDINALS.get)})")

# The relative order is what the strength claim rests on, and `min_tier`
# filtering depends on all of it, not just the top.
ranked_desc = [n for n, _ in sorted(ORDINALS.items(), key=lambda kv: -kv[1])]
check(ranked_desc == EXPECTED_ORDER,
      "ordinals rank strongest evidence to weakest",
      " > ".join(n.replace("TIER_", "").lower() for n in ranked_desc))

# A new tier belongs below RESPONDING, because an agent we never reached must
# never outrank one that answered.
check(ai.TIER_UNCHECKED < ai.TIER_RESPONDING,
      "TIER_UNCHECKED ranks below TIER_RESPONDING")
check(ai.TIER_UNPROVEN < ai.TIER_RESPONDING,
      "TIER_UNPROVEN ranks below TIER_RESPONDING")

check(len(set(ORDINALS.values())) == len(ORDINALS),
      "ordinals are unique")
check(sorted(ORDINALS.values()) == list(range(len(ORDINALS))),
      "ordinals are contiguous from zero",
      f"{sorted(ORDINALS.values())}")
check(set(ai.TIER_NAMES) == set(ORDINALS.values()),
      "TIER_NAMES covers every ordinal and no others")
check(len(set(ai.TIER_NAMES.values())) == len(ai.TIER_NAMES),
      "TIER_NAMES spells every id exactly once",
      f"{sorted(ai.TIER_NAMES.values())}")
check({n.replace("TIER_", "").lower() for n in ORDINALS}
      == set(ai.TIER_NAMES.values()),
      "every constant's name matches the id it is published under",
      f"mismatch: {({n.replace('TIER_', '').lower() for n in ORDINALS}) ^ set(ai.TIER_NAMES.values()) or 'none'}")

print("\nhealth-status partition")

# The split is only as good as this partition. A status in neither list would
# fall through _tier's final return and be counted as never-established, which
# for a real finding would understate what we know.
KNOWN_STATUSES = {"responding", "not_responding", "no_endpoint", "unknown", ""}
check(not (set(ai.PROBED_STATUSES) & set(ai.UNESTABLISHED_STATUSES)),
      "PROBED_STATUSES and UNESTABLISHED_STATUSES do not overlap")
check(set(ai.PROBED_STATUSES) | set(ai.UNESTABLISHED_STATUSES) == KNOWN_STATUSES,
      "every status agent_health.py can write is classified",
      f"unclassified: {KNOWN_STATUSES - set(ai.PROBED_STATUSES) - set(ai.UNESTABLISHED_STATUSES) or 'none'}")
check("unknown" in ai.UNESTABLISHED_STATUSES,
      "`unknown` is never counted as a finding about the agent")
check("no_endpoint" in ai.PROBED_STATUSES,
      "`no_endpoint` IS a finding about the agent")

print("\n_tier mapping")

for status, want in (("responding", ai.TIER_RESPONDING),
                     ("not_responding", ai.TIER_UNPROVEN),
                     ("no_endpoint", ai.TIER_UNPROVEN),
                     ("unknown", ai.TIER_UNCHECKED),
                     (None, ai.TIER_UNCHECKED)):
    got = ai._tier({"service_status": status}, None, None)
    check(got == want, f"service_status={status!r} -> {ai.TIER_NAMES[want]}",
          f"got {ai.TIER_NAMES[got]}")

# Delivery outranks health, which is exactly why a tier count is not a probe
# count and why the two must never be divided by one another.
got = ai._tier({"service_status": "responding", "owner_address": "0xA"},
               {"0xa": {"delivered_external": 1}}, None)
check(got == ai.TIER_VERIFIED,
      "a responding agent that also delivered is verified, not responding",
      "so tiers.responding excludes agents that answered")

print("\nmin_tier filtering, end to end")

# The assertion that actually exercises agents_index.py's ordinal comparison.
# Built through the same encoded path the refresh uses.
RECORDS = [
    {"id": "a", "name": "alpha", "owner_address": "0xA", "service_status": "responding"},
    {"id": "b", "name": "bravo", "owner_address": "0xB", "service_status": "not_responding"},
    {"id": "c", "name": "charlie", "owner_address": "0xC", "service_status": None},
    {"id": "d", "name": "delta", "owner_address": "0xD", "service_status": "unknown"},
    {"id": "e", "name": "echo", "owner_address": "0xE", "service_status": "responding"},
]
PERF = {"0xe": {"delivered_external": 3}}
body = b"[" + b",".join(ai._encode_one(r) for r in RECORDS) + b"]"
ix = ai.AgentsIndex.from_encoded(body, perf=PERF)

verified_only = ix.select(min_tier=ai.TIER_VERIFIED)
names = sorted(ix.project(verified_only, 0, 50), key=lambda r: r["name"])
check([r["name"] for r in names] == ["echo"],
      "min_tier=TIER_VERIFIED returns exactly the verified agents",
      f"got {[r['name'] for r in names]}")
check(all(r["tier"] == "verified" for r in names),
      "and every row it returns carries the verified tier")

counts = ix.tier_counts(ix.select())
check(counts == {"verified": 1, "canary_verified": 0, "responding": 1,
                 "unproven": 1, "unchecked": 2},
      "tier_counts splits the five tiers as the statuses dictate",
      f"got {counts}")

cov = ix.liveness_coverage(ix.select())
check(cov["reached"] == 3 and cov["unresolved"] == 1
      and cov["never_attempted"] == 1 and cov["responding"] == 2,
      "liveness_coverage counts reached, unresolved and never-attempted apart",
      f"reached={cov['reached']} unresolved={cov['unresolved']} "
      f"never_attempted={cov['never_attempted']} responding={cov['responding']}")
check(cov["responding"] != counts["responding"],
      "the coverage responding count is not the tier count",
      "which is why they must never be divided by one another")

print("\nfrontend parity")

# agentVerification.js is the definition of record. If it and TIER_NAMES ever
# spell different sets of ids, one of the two is publishing a tier the other
# cannot render or count.
js_path = os.path.join(ROOT, "frontend", "src", "agentVerification.js")
with open(js_path, encoding="utf-8") as fh:
    js = fh.read()
block = re.search(r"export const VERIFICATION_TIER = \{(.*?)\};", js, re.S)
js_ids = set(re.findall(r"'([a-z_]+)'", block.group(1))) if block else set()
check(js_ids == set(ai.TIER_NAMES.values()),
      "agentVerification.js defines the same tier ids as TIER_NAMES",
      f"js only: {js_ids - set(ai.TIER_NAMES.values()) or 'none'}; "
      f"py only: {set(ai.TIER_NAMES.values()) - js_ids or 'none'}")

# Every id needs a rank in the frontend too. A missing key returns undefined,
# and `undefined - number` is NaN, which makes the marketplace comparator
# return NaN and produce an implementation-defined order with no error at all.
rank = re.search(r"const TIER_RANK = \{(.*?)\};", js, re.S)
ranked = set(re.findall(r"VERIFICATION_TIER\.([A-Z_]+)\]", rank.group(1))) if rank else set()
declared = set(re.findall(r"^\s*([A-Z_]+):\s*'", block.group(1), re.M)) if block else set()
check(ranked == declared,
      "every VERIFICATION_TIER has a TIER_RANK entry",
      f"missing a rank: {declared - ranked or 'none'}")


# ── 2. nothing else compares a tier ordinal ──────────────────────────────────

print("\nsource scan: the ordinal comparison stays unique")

# `select()` is allowed one. Anywhere else, an inequality against a TIER_
# constant is a second place a renumbering can change behaviour silently, and
# the whole point of the string ids is that no such place should exist.
ALLOWED = {os.path.join("core", "agents_index.py")}
ORDINAL_CMP = re.compile(r"(TIER_[A-Z_]+\s*[<>]=?|[<>]=?\s*(?:ai\.)?TIER_[A-Z_]+)")
offenders = []
for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, "backend")):
    dirnames[:] = [d for d in dirnames
                   if d not in {"venv", "__pycache__", "node_modules", ".git"}]
    for fn in filenames:
        if not fn.endswith(".py"):
            continue
        full = os.path.join(dirpath, fn)
        rel = os.path.relpath(full, os.path.join(ROOT, "backend"))
        with open(full, encoding="utf-8", errors="replace") as fh:
            for n, line in enumerate(fh, 1):
                code = line.split("#", 1)[0]
                if ORDINAL_CMP.search(code) and rel not in ALLOWED:
                    offenders.append(f"{rel}:{n}: {line.strip()[:70]}")

check(not offenders,
      "no tier ordinal is compared outside agents_index.select()",
      "; ".join(offenders) if offenders else "one comparison, where it belongs")

print()
if FAILURES:
    print(f"FAILED: {len(FAILURES)}")
    for f in FAILURES:
        print(f"  - {f}")
    sys.exit(1)
print("all tier ordinal invariants hold")
