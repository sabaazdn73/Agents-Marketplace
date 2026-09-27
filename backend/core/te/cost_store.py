"""
cost_store.py

Where the cost worker writes and the web process reads.

Collections (Mongo, through core/db.py):
  te_cost       one document per version (key "<chain_id>/<address>"): the 11
                sizes as parallel arrays, its block and time. About 1.7 KB for
                a measured version, 0.4 KB for one with no pool.
  te_cost_meta  per chain "chain:<id>" (discovery cursors, pool selection,
                last run with its RPC counts) and one "list" document (the
                per-underlying rows /api/te/list serves, the issuers'
                eligibility, and the tickers with no measured pool).

TE_COST_STORE=file:<dir> swaps Mongo for JSON files in a directory, for a
local run with no database; production leaves it unset.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path

COSTS = "te_cost"
META = "te_cost_meta"


class MongoStore:
    def __init__(self, db):
        self.db = db
        self._indexed = False

    async def _index(self):
        if not self._indexed:
            await self.db[COSTS].create_index("underlying")
            self._indexed = True

    async def put_costs(self, docs: list[dict]) -> None:
        from pymongo import ReplaceOne
        if docs:
            await self._index()
            await self.db[COSTS].bulk_write([ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in docs], ordered=False)

    async def costs_for(self, underlying: str) -> list[dict]:
        return [d async for d in self.db[COSTS].find({"underlying": underlying})]

    async def all_costs(self, projection: dict | None = None) -> list[dict]:
        return [d async for d in self.db[COSTS].find({}, projection)]

    async def get_meta(self, _id: str) -> dict | None:
        return await self.db[META].find_one({"_id": _id})

    async def put_meta(self, _id: str, doc: dict) -> None:
        await self.db[META].replace_one({"_id": _id}, {**doc, "_id": _id}, upsert=True)

    async def acquire_lease(self, name: str, owner: str, seconds: float) -> bool:
        """True if `owner` now holds the lease. A held, unexpired lease makes
        the upsert collide on _id, which is the refusal."""
        from pymongo import ReturnDocument
        from pymongo.errors import DuplicateKeyError
        now = time.time()
        try:
            d = await self.db[META].find_one_and_update(
                {"_id": f"lease:{name}", "$or": [{"until": {"$lt": now}}, {"owner": owner}]},
                {"$set": {"owner": owner, "until": now + seconds}}, upsert=True,
                return_document=ReturnDocument.AFTER)
        except DuplicateKeyError:
            return False
        return bool(d) and d.get("owner") == owner

    async def release_lease(self, name: str, owner: str) -> None:
        await self.db[META].delete_one({"_id": f"lease:{name}", "owner": owner})


class FileStore:
    """JSON files, one per document. Local use only."""

    def __init__(self, root: str):
        self.root = Path(root)
        (self.root / COSTS).mkdir(parents=True, exist_ok=True)
        (self.root / META).mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _name(_id: str) -> str:
        return _id.replace("/", "_").replace(":", "_") + ".json"

    def _write(self, coll: str, doc: dict) -> None:
        p = self.root / coll / self._name(doc["_id"])
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(doc, separators=(",", ":")))
        tmp.replace(p)

    def _read(self, coll: str, _id: str) -> dict | None:
        p = self.root / coll / self._name(_id)
        return json.loads(p.read_text()) if p.exists() else None

    async def put_costs(self, docs: list[dict]) -> None:
        await asyncio.to_thread(lambda: [self._write(COSTS, d) for d in docs])

    async def all_costs(self, projection: dict | None = None) -> list[dict]:
        def load():
            out = []
            for p in (self.root / COSTS).glob("*.json"):
                d = json.loads(p.read_text())
                if projection:
                    d = {k: v for k, v in d.items() if k == "_id" or projection.get(k)}
                out.append(d)
            return out
        return await asyncio.to_thread(load)

    async def costs_for(self, underlying: str) -> list[dict]:
        return [d for d in await self.all_costs() if d.get("underlying") == underlying]

    async def get_meta(self, _id: str) -> dict | None:
        return await asyncio.to_thread(self._read, META, _id)

    async def put_meta(self, _id: str, doc: dict) -> None:
        await asyncio.to_thread(self._write, META, {**doc, "_id": _id})

    def _lease(self, name: str, owner: str, seconds: float | None) -> bool:
        import fcntl
        p = self.root / f"lease_{name}.json"
        with open(self.root / f"lease_{name}.lock", "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            cur = json.loads(p.read_text()) if p.exists() else None
            now = time.time()
            if seconds is None:                       # release
                if cur and cur.get("owner") == owner:
                    p.unlink()
                return True
            if cur and cur.get("until", 0) >= now and cur.get("owner") != owner:
                return False
            p.write_text(json.dumps({"owner": owner, "until": now + seconds}))
            return True

    async def acquire_lease(self, name: str, owner: str, seconds: float) -> bool:
        return await asyncio.to_thread(self._lease, name, owner, seconds)

    async def release_lease(self, name: str, owner: str) -> None:
        await asyncio.to_thread(self._lease, name, owner, None)


_store = None


def get_store():
    global _store
    if _store is None:
        spec = os.environ.get("TE_COST_STORE", "")
        if spec.startswith("file:"):
            _store = FileStore(spec[5:])
        else:
            from ..db import get_db
            _store = MongoStore(get_db())
    return _store
