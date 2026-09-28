"""
db.py

The one shared MongoDB client, and lazy-initialized on first use.

Pulled out of practice_layer.py (2026-08-26, when Practice Mode was fully
removed from this project) since agent_store.py, status_checks.py, and
future_chains.py (itself later removed 2026-09-10, along with its own
now-superseded future_multichain_agents collection, see
core/full_registry_ingest.py's docstring) all depended on this one
function and had nothing else to do with the Practice Layer, this is
genuinely shared infrastructure, not Practice-Mode-specific.
"""

import os
from motor.motor_asyncio import AsyncIOMotorClient

_client: AsyncIOMotorClient | None = None


def get_db():
    global _client
    if _client is None:
        mongo_uri = os.environ.get("MONGODB_URI")
        if not mongo_uri:
            raise RuntimeError("MONGODB_URI not set.")
        _client = AsyncIOMotorClient(mongo_uri)
    return _client[os.environ.get("MONGODB_DB_NAME", "agents_marketplace")]


# A SECOND CLIENT FOR READS THAT MUST FAIL FAST. The shared client above waits
# the driver's default 30 seconds to find a server, so a request made while
# the database is unreachable hung for 30 s and then answered 500. A read on
# a request path that has a useful fast answer (a 503 with a reason) uses this
# client, which gives up after `timeout_ms`. One client per timeout, created
# on first use; the worker keeps the shared client and its patience.
_fast_clients: dict[int, AsyncIOMotorClient] = {}


def get_db_fast(timeout_ms: int = 3000):
    if timeout_ms not in _fast_clients:
        mongo_uri = os.environ.get("MONGODB_URI")
        if not mongo_uri:
            raise RuntimeError("MONGODB_URI not set.")
        _fast_clients[timeout_ms] = AsyncIOMotorClient(
            mongo_uri, serverSelectionTimeoutMS=timeout_ms, connectTimeoutMS=timeout_ms)
    return _fast_clients[timeout_ms][os.environ.get("MONGODB_DB_NAME", "agents_marketplace")]
