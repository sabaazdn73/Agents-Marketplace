"""
cost_job.py

One chain's cost refresh, synchronous, for asyncio.to_thread in the worker:

  1. extend pool discovery (Initialize logs, bounded per run);
  2. re-rank the pools each version is quoted on, daily or when discovery
     found new ones (liquidity screen, then the probe at $1,000 and $25,000);
  3. quote every selected pool at every size at one pinned block.

The job runs to a deadline (time.monotonic()) that every RPC call checks, so
a timeout stops it rather than leaving it running in its thread. Discovery
gets the first share of the time; if it is cut short, what it read is kept.

`meta` (the chain's stored state: discovery cursors, the selection, the
discovered candidates, the last run) is updated IN PLACE as the job goes, so
the caller can persist it whether the job finishes, fails or times out.
Returns the version documents, or None when the job did not reach the quotes.
"""

from __future__ import annotations

import logging
import os
import time

from . import pools as pools_mod
from .chains import rpc_for
from .cost import pack, rank, refresh_chain, unpack
from .rpcclient import RpcError, public_reason

log = logging.getLogger("te.cost")

RANK_EVERY_SECONDS = 24 * 3600
# Bumped when the selection rule changes, so stored selections are re-ranked
# at the next cycle rather than up to a day later. 2: the reference mid never
# comes from a pool the universe flags as a price outlier. 3: venue sanity
# (fee ceiling, measured +-2% depth floor). 4: adapters over one liquidity merged.
# 5: venue checks on every candidate before any cap; every discovered pool kept.
# 6: the 1% ceiling applies to LP fee plus hook take, not the protocol fee.
# 7: venue reasons stored as codes.
RANK_RULE = 7
DISCOVERY_SHARE = 0.35
LOG_CALLS_PER_RUN = {1: 40, 8453: 60, 42161: 16, 56: 8, 4663: 80}
if os.environ.get("TE_DISCOVERY_MAX_CALLS"):        # a one-off backfill run by hand
    LOG_CALLS_PER_RUN = {k: int(os.environ["TE_DISCOVERY_MAX_CALLS"]) for k in LOG_CALLS_PER_RUN}


# ── Discovered pools: every one kept, with its latest verdict ────────────────
#
# meta["discovered"]: version key -> [[packed pool..., verdict], ...]. A pool
# found by the Initialize-log walk is never dropped: the walk may have passed
# its block for good (4663's reached block 0), so a pool forgotten once could
# not be found again. Its verdict (ok, not_a_venue, too_thin, price_outlier,
# adapter, no_price, no_liquidity, or "new") is replaced at each ranking, where
# every stored pool is checked again.

_ZERO = "0x" + "00" * 20


def norm(x: list) -> list:
    """A pool in its one canonical form, before it is compared or encoded:
    addresses lower-case, and a V4 or Infinity pool's hooks None or "" as the
    zero address (the key the pool manager hashes), so decode equals input."""
    y = list(x)
    for i in (1, 4, 5):
        if isinstance(y[i], str):
            y[i] = y[i].lower()
    if y[0] != "v3" and y[4] in (None, ""):
        y[4] = _ZERO
    return y


def _sig(x: list) -> tuple:
    return tuple(norm(x)[:6])


# ── Stored form: te_cost_pools, one small document per version ───────────────
#
# Format 2: {_id: version key, c: chain id, v: 2, a: [address, ...],
#            p: "entry;entry;...", n: count, w: time written}.
# `a` is the document's own address table: an entry names the manager or
# pool, the hooks and the other currency as "@i" into it, so what decodes
# never depends on chains.py (a reordered stable list or a new manager cannot
# change a stored pool). An entry is ten fields joined by "|": family code,
# pool or manager, fee, tick spacing, hooks ("" only for a V3-family pool,
# which has none), other currency, Infinity parameters, source code, verdict
# code, unix time the verdict was last applied ("" if never). A field holding
# "|", ";" or "@" is refused. Format 1 (no `v`: "" for the chain's manager, a
# stable list index) is still read, for migration.

_FAM = {"v3": "0", "v4": "1", "infinity_cl": "2"}
_FAM_R = {v: k for k, v in _FAM.items()}
_SRC = {"initialize_log": "L", "universe": "U", "t0": "T"}
_SRC_R = {v: k for k, v in _SRC.items()}
VERDICTS = ["new", "ok", "not_a_venue", "too_thin", "price_outlier", "adapter", "no_price", "no_liquidity"]
FORMAT = 2
_BAD = ("|", ";", "@")


def _field(v) -> str:
    s = "" if v is None else str(v)
    if any(b in s for b in _BAD):
        raise ValueError(f"field {s[:40]!r} holds a separator")
    return s


def encode_pools(entries: list[list]) -> tuple[list[str], str, int]:
    """(address table, encoded entries, entries skipped). A bad entry is
    logged and skipped; it never stops the rest from being written."""
    table: dict[str, int] = {}

    def ref(a: str | None) -> str:
        if a is None:
            return ""
        a = _field(a)
        if a not in table:
            table[a] = len(table)
        return f"@{table[a]}"

    out, skipped = [], 0
    for x in entries:
        try:
            y = norm(x)
            f, addr, fee, ts, hooks, qa, params, src = y[:8]
            verdict = y[8] if len(y) > 8 else "new"
            checked = y[9] if len(y) > 9 else None
            out.append("|".join([
                _FAM[f], ref(addr), _field(fee), _field(ts), "" if f == "v3" else ref(hooks), ref(qa),
                _field(params), _field(_SRC.get(src, src)),
                str(VERDICTS.index(verdict)) if verdict in VERDICTS else _field(verdict),
                "" if checked is None else str(int(checked)),
            ]))
        except (ValueError, KeyError, TypeError, IndexError) as e:
            skipped += 1
            log.warning("[te-cost] discovered pool not stored (bad entry): %s: %s", type(e).__name__, str(x)[:120])
    return list(table), ";".join(out), skipped


def decode_pools(chain_id: int, doc: dict) -> list[list]:
    """Entries of a te_cost_pools document, either format. A bad entry is
    logged and skipped."""
    table = doc.get("a") or []

    def deref(v: str) -> str | None:
        if not v:
            return None
        return table[int(v[1:])] if v.startswith("@") else v

    if doc.get("v") != FORMAT:
        return _decode_v1(chain_id, doc.get("p", ""))
    out = []
    for e in filter(None, (doc.get("p") or "").split(";")):
        try:
            f, addr, fee, ts, hooks, qa, params, src, verdict, checked = e.split("|")
            fam = _FAM_R[f]
            out.append([fam, deref(addr), int(fee) if fee else None, int(ts) if ts else None,
                        deref(hooks) if fam != "v3" else None, deref(qa), params or None, _SRC_R.get(src, src or None),
                        VERDICTS[int(verdict)] if verdict.isdigit() else verdict, int(checked) if checked else None])
        except (ValueError, KeyError, IndexError) as ex:
            log.warning("[te-cost] stored pool entry not read: %s: %s", type(ex).__name__, e[:120])
    return out


def _decode_v1(chain_id: int, s: str) -> list[list]:
    from .chains import CHAINS
    c = CHAINS[chain_id]
    stables = [a.lower() for _s, (a, _d) in c["stables"].items()]
    out = []
    for e in filter(None, (s or "").split(";")):
        try:
            f, addr, fee, ts, hooks, qa, params, src, verdict, checked = e.split("|")
            fam = _FAM_R[f]
            if not addr:
                addr = c["infinity_cl_manager"] if fam == "infinity_cl" else c["v4_manager"]
            out.append([fam, addr, int(fee) if fee else None, int(ts) if ts else None,
                        (hooks or _ZERO) if fam != "v3" else None,
                        stables[int(qa)] if qa.isdigit() else qa, params or None, _SRC_R.get(src, src),
                        VERDICTS[int(verdict)] if verdict.isdigit() else verdict, int(checked) if checked else None])
        except (ValueError, KeyError, IndexError) as ex:
            log.warning("[te-cost] stored pool entry (format 1) not read: %s: %s", type(ex).__name__, e[:120])
    return out


def pools_doc(chain_id: int, key: str, entries: list[list], now: int) -> dict:
    table, p, skipped = encode_pools(entries)
    return {"_id": key, "c": chain_id, "v": FORMAT, "a": table, "p": p, "n": len(entries) - skipped,
            "w": now, **({"skipped": skipped} if skipped else {})}


def merge_discovered(meta: dict, found: list[dict], by_addr: dict) -> int:
    """Adds newly found dollar pools to meta["discovered"]; returns how many
    were new. Pools already held keep their stored verdict."""
    disc = meta.setdefault("discovered", {})
    new = 0
    for p in found:
        if p.get("why") or p["token"] not in by_addr:
            continue
        lst = disc.setdefault(by_addr[p["token"]]["key"], [])
        x = norm(pack(p))
        if not any(_sig(y) == _sig(x) for y in lst):
            lst.append(x + ["new", None])          # no verdict applied yet, so no check time
            new += 1
    return new


def candidates(recs: list[dict], meta: dict) -> dict[str, list[dict]]:
    """Every dollar pool of every version: the universe's, then every stored
    discovered pool whatever its last verdict."""
    disc = meta.get("discovered") or {}
    out = {}
    for r in recs:
        ps = [p for p in r["pools"] if not p.get("why")]
        seen = {_sig(pack(p)) for p in ps}
        ps += [unpack(norm(x)[:8]) for x in disc.get(r["key"], []) if _sig(x) not in seen]
        out[r["key"]] = ps
    return out


def apply_verdicts(meta: dict, summary: dict) -> None:
    """Writes each discovered pool's latest verdict; never removes a pool."""
    disc = meta.setdefault("discovered", {})
    now = int(time.time())
    for k, why in summary.items():
        verdicts = {_sig(x): v for x, v in why.pop("verdicts", [])}
        for y in disc.get(k, []):
            if _sig(y) in verdicts:
                y[8:] = [verdicts[_sig(y)], now]
        why["verdict_counts"] = {v: sum(1 for x in verdicts.values() if x == v) for v in set(verdicts.values())}


def run_chain(chain_id: int, inputs: dict, meta: dict, native_px: dict, *, deadline: float | None = None,
              budget_seconds: float = 240.0) -> list[dict] | None:
    t0 = time.monotonic()
    deadline = deadline or (t0 + budget_seconds)
    recs = [r for r in inputs["records"] if r["chain_id"] == chain_id]
    by_key = {r["key"]: r for r in recs}
    by_addr = {r["address"]: r for r in recs}
    report: dict = {"started": time.time()}
    meta["last_run"] = report

    # 1. discovery, to its own share of the time
    found = []
    # Entries from the first discovery format (one per manager, which kept an
    # upstream error body) are dropped; only the walk state is kept.
    if isinstance(meta.get("disc"), dict):
        meta["disc"] = {k: v for k, v in meta["disc"].items() if k == "walk"}
    if pools_mod.managers(chain_id) and recs:
        disc = meta.setdefault("disc", {})
        found, _ = pools_mod.scan(chain_id, list(by_addr), disc, max_calls=LOG_CALLS_PER_RUN.get(chain_id, 16),
                                  deadline=min(deadline, t0 + DISCOVERY_SHARE * (deadline - t0)))
        report["discovery_log_calls"] = (disc.get("walk") or {}).get("last_calls", 0)
    report["discovery"] = pools_mod.coverage(chain_id, meta.get("disc"))
    new = merge_discovered(meta, found, by_addr)
    report["new_pools_found"] = new

    rpc = rpc_for(chain_id)
    rpc.deadline = deadline
    try:
        # 2. selection
        stale = time.time() - meta.get("ranked_at", 0) > RANK_EVERY_SECONDS
        if stale or new or not meta.get("selection") or meta.get("rank_rule") != RANK_RULE:
            cands = candidates(recs, meta)
            block = rpc.block_number()
            selection, summary = rank(rpc, chain_id, by_key, cands, block)
            apply_verdicts(meta, summary)
            meta.update(selection=selection, summary=summary, ranked_at=time.time(), ranked_block=block,
                        rank_rule=RANK_RULE)
        report["ranking_calls"] = rpc.stats.calls

        # 3. every size
        docs, qreport = refresh_chain(chain_id, recs, meta["selection"], meta.get("summary") or {}, native_px,
                                      rpc=rpc, search=report["discovery"], prev_ratios=meta.get("ratios"))
    except RpcError as e:
        report.update(error=public_reason(e), seconds=round(time.monotonic() - t0, 1), rpc=rpc.stats.as_dict())
        rpc.close()
        return None
    # what the next run needs to see a multiplier change it was not told about
    meta["ratios"] = {k: {f: v[f] for f in ("ui_raw", "change_seen_at") if v.get(f)}
                      for k, v in qreport.pop("ratios").items() if v.get("ui_raw")}
    report.update(qreport)
    report["total_seconds"] = round(time.monotonic() - t0, 1)
    rpc.close()
    return docs
