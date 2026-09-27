"""
The vault responses, shaped from what the collector stored. No chain read
happens here: the web service only serves the cached results.

List rows carry the strings the page renders (frontend/src/te/api.js:
name, platform, chain, group, manager, audits, assets, controls, tvl_usd,
tvl_slot, fees, lockup), and beside them the provenance of each: class A
(our chain read, with its slot) or class D (the platform's statement, with
its link and the date read). Every figure says where it came from.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import time

from . import catalog

log = logging.getLogger(__name__)

TVL_STALE_AFTER_S = 7 * 86400   # a vault-recorded figure last written longer ago is flagged
READ_STALE_AFTER_S = 6 * 3600   # our own read older than this (a missed collector run) is flagged


def _age_s(stamp: str | None) -> float | None:
    if not stamp:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%MZ"):
        try:
            t = dt.datetime.strptime(stamp, fmt).replace(tzinfo=dt.timezone.utc)
            return (dt.datetime.now(dt.timezone.utc) - t).total_seconds()
        except ValueError:
            continue
    return None

PLATFORM_KEYS = ("kamino", "voltr", "glam", "hyperliquid", "hyperevm")
PLATFORM_ORDER = {k: i for i, k in enumerate(("glam", "hyperevm", "hyperliquid", "kamino", "voltr"))}
NOTICE = ("Deposits are made on each vault's own venue, signed in your own wallet; Tnega never holds funds "
          "and takes no deposit. We describe each vault as its chain state and its operator's documents show it. "
          "Nothing here is advice.")
DEPOSITS_NOTE = "Deposits happen on the venue, signed in the user's own wallet; this site has no deposit path and never holds funds."
STATUSES = {
    "listed": "the platform was read this run and at least one vault qualifies",
    "none_qualifying": "the platform was read this run and no vault qualifies; `text` gives the reason",
    "read_failed": ("this run's read of the platform failed (a fault in the call, not a fact about the vaults); "
                    "earlier results, if any, are kept and marked stale"),
}


def _prov(v: dict | None) -> dict:
    v = v or {}
    return {k: v[k] for k in ("class", "note", "slot", "url", "read_on") if v.get(k) is not None}


def _nesting_note(d: dict) -> str | None:
    if d.get("nested_in"):
        names = ", ".join(n.get("name") or n["address"] for n in d["nested_in"])
        return f"Part of this vault's funds sit in {names}, also listed; do not add the two TVLs together."
    if d.get("contains_nested"):
        names = ", ".join(n.get("name") or n["address"] for n in d["contains_nested"])
        return f"This vault's TVL includes funds placed by {names}, also listed; do not add the two TVLs together."
    return None


def list_row(d: dict) -> dict:
    t = d.get("tvl") or {}
    tok = d.get("token") or {}
    # Staleness means one thing: the age of the figure itself. A Kamino TVL
    # is computed by us at read time (so its age is our read's age); a Voltr
    # TVL is the vault's own record (so its age is the time it was recorded).
    age = _age_s(t.get("recorded_at") or t.get("computed_at"))
    read_age = _age_s(d.get("read_at"))
    return {
        "name": d["name"], "platform": d["platform"], "chain": d["chain"], "group": d["group"],
        "address": d["address"], "key": f"{d['platform_key']}/{d['address']}", "platform_key": d["platform_key"],
        "manager": (d.get("manager") or {}).get("text"),
        "audits": (d.get("audits") or {}).get("text"),
        "assets": (d.get("assets") or {}).get("text"),
        "controls": (d.get("controls") or {}).get("text"),
        "fees": (d.get("fees") or {}).get("text"),
        "lockup": (d.get("lockup") or {}).get("text"),
        "tvl_usd": t.get("usd"), "tvl_slot": t.get("slot"),
        "tvl_amount": t.get("amount"), "tvl_symbol": t.get("symbol"),
        "tvl_source": t.get("source"), "tvl_basis": t.get("basis"),
        "tvl_reconciliation": t.get("reconciliation"), "tvl_partial": bool(t.get("partial")),
        "tvl_computed_at": t.get("computed_at"),
        "tvl_recorded_at": t.get("recorded_at"),
        "tvl_age_days": round(age / 86400, 1) if age is not None else None,
        "tvl_stale": bool(age is not None and age > TVL_STALE_AFTER_S),
        "tvl_stale_rule": (f"stale when the figure (tvl_recorded_at for a vault-recorded figure, tvl_computed_at for "
                           f"one we compute) is more than {TVL_STALE_AFTER_S // 86400} days old"),
        "tvl_aum_flag": bool(t.get("aum_flag")),
        "read_stale": bool(read_age is not None and read_age > READ_STALE_AFTER_S),
        "token_symbol": tok.get("symbol"), "token_kind": tok.get("kind"),
        "notes": d.get("notes") or [],
        "nested_in": d.get("nested_in") or [],
        "contains_nested": d.get("contains_nested") or [],
        "nesting_note": _nesting_note(d),
        "lends_against": (d.get("assets") or {}).get("lends_against_text"),
        "provenance": {
            "manager": _prov(d.get("manager")), "assets": _prov(d.get("assets")),
            "controls": _prov(d.get("controls")), "fees": _prov(d.get("fees")),
            "lockup": _prov(d.get("lockup")), "audits": _prov(d.get("audits")),
            "tvl": {"class": "A", "slot": t.get("slot"), "source": t.get("source")},
        },
        "read_at": d.get("read_at"),
        "stale": bool((age is not None and age > TVL_STALE_AFTER_S) or (read_age is not None and read_age > READ_STALE_AFTER_S)),
        **({"curator": d["curator"]} if d.get("curator") else {}),
    }


def platform_row(p: dict) -> dict:
    key = p["platform_key"]
    status = p.get("status")
    out = {"platform": p["platform"], "platform_key": key, "chain": p.get("chain"), "group": p.get("group"),
           "status": status, "listed": p.get("listed", 0), "as_of": p.get("as_of"), "read_at": p.get("read_at")}
    if status == "none_qualifying":
        out["text"] = f"No qualifying vault found as of {p.get('as_of')}: {p.get('reason')}"
        out["reason_class"] = p.get("reason_class")
    elif status == "listed":
        n_ex = sum(e["count"] for e in p.get("excluded") or [])
        out["text"] = f"{p.get('listed')} listed of {p.get('discovered')} vault accounts read on chain; {n_ex} not listed, by reason below."
    elif status == "read_failed":
        out["text"] = f"This platform's chain read failed ({p.get('failed_at')}); nothing is shown for it."
    for k in ("excluded", "named_exclusions", "evidence", "evidence_ok", "sources", "sources_read_on", "slot",
              "discovered", "error"):
        if p.get(k) is not None:
            out[k] = p[k]
    if p.get("last_failure"):
        out["stale"] = True
        out["last_failure"] = p["last_failure"]
        out["text"] = (out.get("text") or "") + (f" These results are from the run at {p.get('read_at')}; the latest "
                                                 f"read failed at {p['last_failure'].get('at')}, a fault in the call, not a fact about the vaults.")
    if p.get("upgrade"):
        out["upgrade"] = {"text": p["upgrade"]["text"], "class": "A", "slot": p["upgrade"].get("slot")}
    return out


# The list's stored documents, kept in process between collector runs. A full
# read of them cost about 6 s per request in production (the time grows with
# the bytes Mongo sends: about 620 KB for all rows, platforms and meta), so a
# request now reads only the meta document's run stamp and failures (a few
# hundred bytes) and the rest comes from here. The entry holds one run's
# stamp, rows and platform rows together, and a response is built from one
# entry, so what it says was computed when is always what it shows.
#
# The only request that waits on the full read is the first one in a process.
# When the stored run changes (the collector writes at most hourly) or the
# entry is older than LIST_CACHE_TTL_S, the request is answered from the entry
# it has, which says its own run time, and the new run is read behind it.
# Ages, stale flags and paging are still computed per request. The entry is
# about 45 small rows: under 100 KB as JSON, about 0.3 MB of Python heap
# (measured on the 2026-09-26 store), where each request used to decode the
# whole 620 KB afresh.
LIST_CACHE_TTL_S = 300
_list_cache: dict = {}
_refresh_task: asyncio.Task | None = None
_lock_state: dict = {"loop": None, "lock": None}


def _list_lock() -> asyncio.Lock:
    """The lock for the running event loop (a lock used on one loop fails on
    another, e.g. in a script that calls asyncio.run more than once)."""
    loop = asyncio.get_running_loop()
    if _lock_state["loop"] is not loop:
        _lock_state.update(loop=loop, lock=asyncio.Lock())
    return _lock_state["lock"]


def _run_key(store, meta: dict) -> tuple:
    run = meta.get("run") or {}
    return (getattr(store, "cache_id", id(store)), run.get("finished"), run.get("started"),
            tuple(sorted((meta.get("failed") or {}).keys())))


def _fresh(e: dict | None, key: tuple) -> bool:
    return bool(e) and e["key"] == key and time.monotonic() - e["at"] < LIST_CACHE_TTL_S


async def _refresh(store) -> dict:
    """Read one run: its stamp, then its rows and platform rows, then the
    stamp again. A stamp that moved during the read means a run was written
    meanwhile; the entry is then marked for another read on the next request."""
    meta = await store.meta_head() or {}
    rows = sorted(await store.rows(None), key=lambda d: d.get("sort_key") or "")
    plats = sorted(await store.platforms(), key=lambda p: PLATFORM_ORDER.get(p["platform_key"], 99))
    after = await store.meta_head() or {}
    key = _run_key(store, meta)
    moved = _run_key(store, after) != key
    entry = {"key": key, "at": 0.0 if moved else time.monotonic(), "meta": meta, "rows": rows, "plats": plats}
    _list_cache["entry"] = entry
    return entry


async def _background_refresh(store, key: tuple):
    try:
        async with _list_lock():
            if _fresh(_list_cache.get("entry"), key):
                return  # another refresh already read this run
            await _refresh(store)
    except Exception:
        log.exception("[vaults] background read of the list failed; the cached run is still served")


async def _cached_entry(store, meta: dict) -> dict:
    global _refresh_task
    key = _run_key(store, meta)
    e = _list_cache.get("entry")
    if not e or e["key"][0] != key[0]:
        # Nothing cached for this store: read it now, once, however many requests wait.
        async with _list_lock():
            e = _list_cache.get("entry")
            if not e or e["key"][0] != key[0]:
                e = await _refresh(store)
    elif not _fresh(e, key) and (_refresh_task is None or _refresh_task.done()
                                  or _refresh_task.get_loop() is not asyncio.get_running_loop()):
        _refresh_task = asyncio.create_task(_background_refresh(store, key))
    return e


async def warm_list(store, timeout_s: float = 60) -> str:
    """Read the stored run into the list cache once, so the first visitor
    after a restart does not wait on it. Returns what happened, for the log;
    never raises."""
    async def go():
        if not await store.meta_head():
            return None
        async with _list_lock():
            return await _refresh(store)
    try:
        e = await asyncio.wait_for(go(), timeout_s)
        if e is None:
            return "nothing stored yet"
        return f"{len(e['rows'])} vault rows, run {(e['meta'].get('run') or {}).get('finished')}"
    except Exception as e:  # noqa: BLE001
        return f"skipped ({type(e).__name__}: {str(e)[:120]}); the first request reads it instead"


async def list_vaults(store, platform: str | None = None, limit: int = 24, offset: int = 0) -> dict | None:
    """None when nothing has been collected yet (the route answers 503)."""
    current = await store.meta_head()
    if not current:
        return None
    e = await _cached_entry(store, current)
    meta = e["meta"]  # the cached run's own stamp, so the body describes the rows it carries
    rows = [d for d in e["rows"] if not platform or d["platform_key"] == platform]
    plats = [p for p in e["plats"] if not platform or p["platform_key"] == platform]
    page = rows[offset:offset + limit]
    run = meta.get("run") or {}
    failed = sorted((meta.get("failed") or {}).keys())
    out = {
        "computed_at": run.get("finished"), "as_of": (run.get("finished") or "")[:10],
        "read_only": True, "deposits": "venue", "deposits_note": DEPOSITS_NOTE, "notice": NOTICE,
        "statuses": STATUSES,
        "rule": catalog.QUALIFYING_RULE, "checks": catalog.CHECKS, "order": "platform, then name; no ranking",
        "platform": platform, "total": len(rows), "count": len(page), "offset": offset, "limit": limit,
        "vaults": [list_row(d) for d in page],
        "platforms": [platform_row(p) for p in plats],
    }
    if failed:
        out["partial"] = True
        out["missing"] = [f"{k}: the latest chain read failed; its earlier results, if any, are shown and marked stale"
                          for k in failed]
    return out


async def vault_detail(store, platform: str, address: str) -> dict | None:
    d = await store.get(platform, address)
    if not d:
        return None
    d = dict(d)
    d.pop("_id", None)
    d.pop("sort_key", None)
    d["row"] = list_row({**d, "platform_key": platform})
    d["notice"] = NOTICE
    return d
