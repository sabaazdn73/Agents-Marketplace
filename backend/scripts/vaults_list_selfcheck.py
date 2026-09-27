"""
vaults_list_selfcheck.py: the cached GET /api/vaults body is the uncached one.

    VAULTS_STORE_FILE=<store.json> ./venv/bin/python scripts/vaults_list_selfcheck.py
    ... [--mongo mongodb://127.0.0.1:PORT]   (a LOCAL mongod only; it writes a throwaway db)

No chain read, no network beyond the optional local Mongo. The store file is
copied to a temporary file; the original is never written.

  1. Reference: the list body built the way it was before the cache (every
     document read and shaped per request), with the clock frozen, for a set of
     platform, limit and offset queries. The cached service must give the same
     bytes, cold and warm.
  2. Invalidation: after a new run is written, the first request is answered
     from the cached run (with that run's own computed_at, never a mix), the
     next one from the new run, and again equal to the reference.
  3. Past LIST_CACHE_TTL_S an unchanged stamp is re-read behind the request.
  4. Twenty concurrent cold requests read the rows once.
  5. With --mongo: the same checks through MongoStore, whose projections must
     give the same rows as the whole documents, and write_run writes the meta
     document last.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import types
from urllib.parse import urlparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.json_encoding import json_default  # noqa: E402
from core.vaults import catalog, service  # noqa: E402
from core.vaults.store import FileStore, _strip_row  # noqa: E402

FAILS: list[str] = []
FROZEN = dt.datetime(2026, 9, 27, 12, 0, 0, tzinfo=dt.timezone.utc)
QUERIES = [(None, 24, 0), (None, 4, 0), (None, 100, 0), (None, 24, 24), (None, 24, 9999), (None, 1000, 0),
           ("kamino", 24, 0), ("kamino", 100, 5), ("voltr", 24, 0), ("glam", 24, 0),
           ("hyperliquid", 24, 0), ("hyperevm", 24, 0)]


class _FrozenDT(dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return FROZEN if tz else FROZEN.replace(tzinfo=None)


service.dt = types.SimpleNamespace(datetime=_FrozenDT, timezone=dt.timezone)


def check(ok: bool, what: str):
    print(("PASS " if ok else "FAIL ") + what)
    if not ok:
        FAILS.append(what)


def enc(body) -> str:
    return json.dumps(body, default=json_default, separators=(",", ":"))


def reference(docs: list[dict], platform, limit, offset) -> dict | None:
    """The list body as built before the cache, from whole documents."""
    meta = next((d for d in docs if d.get("_id") == "meta"), None)
    if not meta:
        return None
    rows = sorted([_strip_row(d) for d in docs if d.get("kind") == "vault"
                   and (not platform or d["platform_key"] == platform)], key=lambda d: d.get("sort_key") or "")
    plats = sorted([d for d in docs if d.get("kind") == "platform"],
                   key=lambda p: service.PLATFORM_ORDER.get(p["platform_key"], 99))
    if platform:
        plats = [p for p in plats if p["platform_key"] == platform]
    page = rows[offset:offset + limit]
    run = meta.get("run") or {}
    failed = sorted((meta.get("failed") or {}).keys())
    out = {
        "computed_at": run.get("finished"), "as_of": (run.get("finished") or "")[:10],
        "read_only": True, "deposits": "venue", "deposits_note": service.DEPOSITS_NOTE, "notice": service.NOTICE,
        "statuses": service.STATUSES,
        "rule": catalog.QUALIFYING_RULE, "checks": catalog.CHECKS, "order": "platform, then name; no ranking",
        "platform": platform, "total": len(rows), "count": len(page), "offset": offset, "limit": limit,
        "vaults": [service.list_row(d) for d in page],
        "platforms": [service.platform_row(p) for p in plats],
    }
    if failed:
        out["partial"] = True
        out["missing"] = [f"{k}: the latest chain read failed; its earlier results, if any, are shown and marked stale"
                          for k in failed]
    return out


async def same_as_reference(store, docs, label):
    bad = [q for q in QUERIES if enc(await service.list_vaults(store, *q)) != enc(reference(docs, *q))]
    check(not bad, f"{label}: {len(QUERIES)} queries byte-identical to the uncached build" + (f" (differ: {bad})" if bad else ""))


def new_run(docs: list[dict], stamp: str) -> list[dict]:
    """A later run: new stamp, first vault renamed, second removed."""
    docs = [dict(d) for d in docs]
    vaults = sorted((d for d in docs if d.get("kind") == "vault"), key=lambda d: d["_id"])
    meta = next(d for d in docs if d.get("_id") == "meta")
    meta["run"] = {**(meta.get("run") or {}), "finished": stamp}
    vaults[0]["name"] = "Renamed by vaults_list_selfcheck"
    return [d for d in docs if d["_id"] != vaults[1]["_id"]]


async def run_checks(store, write_all, docs, label, count_reads):
    service._list_cache.clear()
    service.LIST_CACHE_TTL_S = 300
    await write_all(docs)

    count_reads["n"] = 0
    bodies = await asyncio.gather(*[service.list_vaults(store, None, 100, 0) for _ in range(20)])
    check(count_reads["n"] == 1, f"{label}: 20 concurrent cold requests read the rows once (read {count_reads['n']})")
    check(len({enc(b) for b in bodies}) == 1, f"{label}: and give one answer")
    await same_as_reference(store, docs, f"{label} cold/warm")

    before = await service.list_vaults(store, None, 100, 0)
    docs2 = new_run(docs, "2026-09-27T11:59:00Z")
    await write_all(docs2)
    first = await service.list_vaults(store, None, 100, 0)
    check(enc(first) == enc(before), f"{label}: first request after a new run: the cached run, whole (computed_at "
                                     f"{first['computed_at']})")
    await asyncio.sleep(0.3)
    await same_as_reference(store, docs2, f"{label} after the new run")

    service.LIST_CACHE_TTL_S = 0.2
    docs3 = [dict(d) for d in docs2]
    v = next(d for d in docs3 if d.get("kind") == "vault")
    v["name"] = "Changed without a new stamp"
    await write_all(docs3)
    await asyncio.sleep(0.3)
    stale = await service.list_vaults(store, None, 100, 0)
    check("Changed without a new stamp" not in enc(stale), f"{label}: past the TTL the request is served at once")
    await asyncio.sleep(0.3)
    service.LIST_CACHE_TTL_S = 300
    await same_as_reference(store, docs3, f"{label} after the TTL re-read")

    await write_all([d for d in docs3 if d.get("_id") != "meta"])
    check(await service.list_vaults(store, None, 24, 0) is None, f"{label}: no meta document gives None (503)")


async def main():
    src = os.environ.get("VAULTS_STORE_FILE", "").strip()
    if not src or not os.path.exists(src):
        print("set VAULTS_STORE_FILE to a vault store JSON file (it is copied, never written)")
        return 2
    docs = json.load(open(src))
    tmpdir = tempfile.mkdtemp(prefix="vaults_list_selfcheck_")
    path = os.path.join(tmpdir, "store.json")
    shutil.copy(src, path)
    try:
        fs = FileStore(path)
        reads = {"n": 0}
        rows0 = fs.rows

        async def counted_rows(platform):
            reads["n"] += 1
            return await rows0(platform)
        fs.rows = counted_rows

        async def write_file(ds):
            fs._save(ds)
        await run_checks(fs, write_file, docs, "file store", reads)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    if "--mongo" in sys.argv:
        uri = sys.argv[sys.argv.index("--mongo") + 1]
        if urlparse(uri).hostname not in ("127.0.0.1", "localhost"):
            print("refusing --mongo: not a local mongod (this check drops and rewrites a database)")
            return 2
        from motor.motor_asyncio import AsyncIOMotorClient
        from pymongo import monitoring
        from core.vaults.store import MongoStore

        mreads = {"n": 0}
        order: list[list] = []

        class L(monitoring.CommandListener):
            def started(self, e):
                if e.command_name == "find" and (e.command.get("filter") or {}).get("kind") == "vault":
                    mreads["n"] += 1
                if e.command_name in ("update", "delete"):
                    order.append([u["q"].get("_id") for u in e.command.get("updates", []) + e.command.get("deletes", [])])

            def succeeded(self, e):
                pass

            def failed(self, e):
                pass

        db = AsyncIOMotorClient(uri, event_listeners=[L()])["vaults_list_selfcheck"]
        ms = MongoStore(db)

        async def write_mongo(ds):
            await db.vaults.drop()
            if ds:
                await db.vaults.insert_many([dict(d) for d in ds])
        try:
            await run_checks(ms, write_mongo, docs, "mongo store", mreads)
            await write_mongo(docs)
            meta = next(d for d in docs if d["_id"] == "meta")
            result = {"vaults": [d for d in docs if d.get("kind") == "vault"][1:],
                      "platforms": [d for d in docs if d.get("kind") == "platform"], "failed": {},
                      "state": {k: v for k, v in meta.items() if k not in ("_id", "kind", "run", "failed")},
                      "run": {**meta["run"], "finished": "2026-09-27T13:00:00Z"}}
            order.clear()
            await ms.write_run(result)
            check(bool(order) and order[-1] == ["meta"] and all("meta" not in o for o in order[:-1]),
                  "mongo store: write_run writes the meta document last, alone")
        finally:
            await db.vaults.drop()

    print(f"{len(FAILS)} failure(s)")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
