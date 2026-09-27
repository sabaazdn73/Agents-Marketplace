"""
Where the collector's results live: the Mongo collection `vaults`, one small
document per listed vault, one per platform row, and one `meta` document
(the authority-to-multisig map and the last run's cost). About 45 documents
and well under 1 MB in total; no index beyond _id (Atlas quota is measured
by dataSize + indexSize).

Development: with VAULTS_STORE_FILE set, the same interface reads and writes
that JSON file instead, so a local run never touches the shared database.
The worker in production does not set it.
"""

from __future__ import annotations

import asyncio
import json
import os

COLLECTION = "vaults"
ROW_FIELDS = ("name", "platform", "platform_key", "chain", "group", "address", "token", "tvl",
              "fees", "lockup", "manager", "assets", "controls", "audits", "sort_key", "read_at",
              "notes", "nested_in", "contains_nested", "curator")


ROW_SUBDOCS = ("fees", "lockup", "manager", "assets", "controls", "audits", "tvl", "token")
ROW_SUBKEYS = ("text", "class", "slot", "url", "read_on", "usd", "amount", "symbol", "source", "basis",
               "reconciliation", "partial", "computed_at", "recorded_at", "aum_flag", "kind", "mint", "decimals",
               "note", "lends_against_text")
# What Mongo sends for a list row: only the sub-keys _strip_row keeps. A
# Kamino vault's `assets` alone is about 20 KB of per-allocation detail that
# no list row shows; projecting it away cuts a full read of the rows from
# about 600 KB to a small fraction of that.
ROW_PROJECTION = {**{k: 1 for k in ROW_FIELDS if k not in ROW_SUBDOCS},
                  **{f"{k}.{kk}": 1 for k in ROW_SUBDOCS for kk in ROW_SUBKEYS}}
# Platform-row fields that service.platform_row never reads.
PLATFORM_UNREAD = ("rule", "links", "audits", "platform_reads")


def _strip_row(d: dict) -> dict:
    """A list row carries the texts and provenance, not the per-allocation
    detail, so a page of rows stays small."""
    out = {k: d.get(k) for k in ROW_FIELDS}
    for k in ROW_SUBDOCS:
        v = out.get(k) or {}
        out[k] = {kk: vv for kk, vv in v.items() if kk in ROW_SUBKEYS}
    return out


class FileStore:
    def __init__(self, path: str):
        self.path = path
        self.cache_id = f"file:{os.path.abspath(path)}"

    def _load(self) -> list[dict]:
        if not os.path.exists(self.path):
            return []
        with open(self.path) as f:
            return json.load(f)

    def _save(self, docs: list[dict]):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(docs, f, default=str)
        os.replace(tmp, self.path)

    async def all_docs(self) -> list[dict]:
        return await asyncio.to_thread(self._load)

    async def write_run(self, result: dict):
        def go():
            old = {d["_id"]: d for d in self._load()}
            new = _merge(old, result)
            self._save(list(new.values()))
        await asyncio.to_thread(go)

    async def rows(self, platform: str | None) -> list[dict]:
        docs = await self.all_docs()
        return [_strip_row(d) for d in docs if d.get("kind") == "vault" and (not platform or d["platform_key"] == platform)]

    async def platforms(self) -> list[dict]:
        return [d for d in await self.all_docs() if d.get("kind") == "platform"]

    async def meta(self) -> dict | None:
        return next((d for d in await self.all_docs() if d.get("_id") == "meta"), None)

    async def meta_head(self) -> dict | None:
        m = await self.meta()
        return None if m is None else {k: m[k] for k in ("_id", "run", "failed") if k in m}

    async def get(self, platform: str, address: str) -> dict | None:
        return next((d for d in await self.all_docs() if d.get("_id") == f"{platform}:{address}"), None)


def _merge(old: dict, result: dict) -> dict:
    """Replace each successfully read platform's vaults; keep a failed
    platform's previous vaults and its previous row, marked with the failure."""
    failed = set(result.get("failed") or {})
    ok = {r["platform_key"] for r in result["platforms"] if r.get("status") != "read_failed"}
    new = {k: v for k, v in old.items()
           if not (v.get("kind") == "vault" and v.get("platform_key") in ok)}
    for d in result["vaults"]:
        new[d["_id"]] = d
    for r in result["platforms"]:
        if r.get("status") == "read_failed" and r["platform_key"] in failed and r["_id"] in old:
            prev = dict(old[r["_id"]])
            prev["last_failure"] = {"at": r.get("failed_at"), "error": r.get("error")}
            new[r["_id"]] = prev
        else:
            new[r["_id"]] = r
    new["meta"] = {"_id": "meta", "kind": "meta", **(result.get("state") or {}),
                   "run": result["run"], "failed": result.get("failed") or {}}
    return new


class MongoStore:
    def __init__(self, db):
        self.c = db[COLLECTION]
        self.cache_id = f"mongo:{db.name}.{COLLECTION}"

    async def all_docs(self) -> list[dict]:
        return [d async for d in self.c.find({})]

    async def write_run(self, result: dict):
        from pymongo import DeleteOne, ReplaceOne  # the driver, not a web framework

        old = {d["_id"]: d async for d in self.c.find({}, {"kind": 1, "platform_key": 1})}
        # _merge needs the full previous platform rows only for failed platforms.
        for r in result["platforms"]:
            if r.get("status") == "read_failed" and r["_id"] in old:
                old[r["_id"]] = await self.c.find_one({"_id": r["_id"]}) or old[r["_id"]]
        new = _merge(old, result)
        ops = [ReplaceOne({"_id": k}, v, upsert=True) for k, v in new.items()
               if not (k in old and old[k] is v)]
        ops += [DeleteOne({"_id": k}) for k in old if k not in new]
        if ops:
            await self.c.bulk_write(ops, ordered=False)

    async def rows(self, platform: str | None) -> list[dict]:
        q = {"kind": "vault"}
        if platform:
            q["platform_key"] = platform
        return [_strip_row(d) async for d in self.c.find(q, ROW_PROJECTION)]

    async def platforms(self) -> list[dict]:
        return [d async for d in self.c.find({"kind": "platform"}, {k: 0 for k in PLATFORM_UNREAD})]

    async def meta(self) -> dict | None:
        """The whole meta document, the collector's state included (its
        market cache alone is tens of KB): for the worker, not a request."""
        return await self.c.find_one({"_id": "meta"})

    async def meta_head(self) -> dict | None:
        """What a list request needs of meta: the run stamp and the failures."""
        return await self.c.find_one({"_id": "meta"}, {"run": 1, "failed": 1})

    async def get(self, platform: str, address: str) -> dict | None:
        return await self.c.find_one({"_id": f"{platform}:{address}"})


def get_store():
    path = os.environ.get("VAULTS_STORE_FILE", "").strip()
    if path:
        return FileStore(path)
    from ..db import get_db
    return MongoStore(get_db())
