"""
db.py

The one shared MongoDB client, real and lazy-initialized on first use.

Pulled out of practice_layer.py (2026-08-26, when Practice Mode was fully
removed from this project) since agent_store.py, status_checks.py, and
future_chains.py all depended on this one function and had nothing else to
do with the Practice Layer — this is genuinely shared infrastructure, not
Practice-Mode-specific.
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
