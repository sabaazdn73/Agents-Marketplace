"""Keeps the capability lists in step with the adapters that implement them.

core/chain_capabilities.py answers "can this signal be produced for this
chain". The adapters actually produce it. Those are two separate lists of
chain ids, and on 2026-09-10 they drifted twice in one sitting:

  Zerion     _ZERION_CHAINS was extended to 4663 but adapters/zerion.py was
             not, so the capabilities panel said Zerion covered Robinhood
             Chain while the per-agent evaluation on the same page said it
             did not index it.

  Sourcify   _SOURCIFY_VERIFY_CHAINS was added, but the verification adapter
             had no Sourcify branch at all, so the contract check was claimed
             for a chain where it could not run.

Both were caught by looking at the rendered page, which is not a reliable way
to catch the third one. A capability list that promises what an adapter cannot
deliver is a false claim about the data, which is the one kind of bug this
project treats as serious.

Run: ./venv/bin/python scripts/capability_adapter_selfcheck.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adapters.contract_verification import _SOURCIFY_CHAINS  # noqa: E402
from adapters.zerion import ZERION_CHAIN_SLUGS  # noqa: E402
from core import chain_capabilities as caps  # noqa: E402
from core.chain_views import BUDGET_HIRE_CHAIN_IDS, ESCROW_HIRE_CHAIN_IDS  # noqa: E402

failures: list[str] = []
passed = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed
    if ok:
        passed += 1
        print(f"  ok   {name}")
    else:
        failures.append(f"{name}{' — ' + detail if detail else ''}")
        print(f"  FAIL {name} {detail}")


print("\ncapability list vs the adapter that implements it")

check(
    "Zerion: capabilities and adapter cover the same chains",
    set(caps._ZERION_CHAINS) == set(ZERION_CHAIN_SLUGS),
    f"caps={sorted(caps._ZERION_CHAINS)} adapter={sorted(ZERION_CHAIN_SLUGS)}",
)

check(
    "Sourcify: capabilities and adapter cover the same chains",
    set(caps._SOURCIFY_VERIFY_CHAINS) == set(_SOURCIFY_CHAINS),
    f"caps={sorted(caps._SOURCIFY_VERIFY_CHAINS)} adapter={sorted(_SOURCIFY_CHAINS)}",
)

check(
    "no chain is claimed by BOTH the explorer and the Sourcify route",
    not (set(caps._EVM_EXPLORER_SUPPORTED) & set(caps._SOURCIFY_VERIFY_CHAINS)),
    "a chain must resolve through one route, or the reported method is ambiguous",
)

print("\nhire paths agree across the modules that report them")

check(
    "budget chains match between chain_views and chain_capabilities",
    set(BUDGET_HIRE_CHAIN_IDS) == set(caps.BUDGET_ESCROW_CHAIN_IDS),
    f"views={sorted(BUDGET_HIRE_CHAIN_IDS)} caps={sorted(caps.BUDGET_ESCROW_CHAIN_IDS)}",
)

check(
    "escrow hiring stays BNB-only and excludes testnet 97",
    set(ESCROW_HIRE_CHAIN_IDS) == {56},
    f"got {sorted(ESCROW_HIRE_CHAIN_IDS)}; no testnet value may be reachable from production",
)

print("\nevery chain that can be hired on is analysed and has an RPC")
for cid in BUDGET_HIRE_CHAIN_IDS:
    c = caps.get_chain_capabilities(cid)
    check(f"chain {cid} reports hireable", c["hireable"])
    check(f"chain {cid} has a native RPC", cid in caps.NATIVE_RPC_CHAINS)
    check(
        f"chain {cid} has live_health available",
        "live_health" in c["available"],
        "a hireable chain showing no health status would be a card with an action and no evidence",
    )

print("\nevery unavailable signal gives a reason")
for cid in (56, 42161, 4663, 8453, 1):
    c = caps.get_chain_capabilities(cid)
    missing_reason = [s["signal"] for s in c["signals"] if not s["available"] and not s["reason"]]
    check(f"chain {cid}: all absences explained", not missing_reason, f"missing reasons: {missing_reason}")

print(f"\n{passed} passed, {len(failures)} failed")
if failures:
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
