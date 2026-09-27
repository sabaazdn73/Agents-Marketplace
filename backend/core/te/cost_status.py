"""
cost_status.py

GET /api/te/status: where the cost engine's figures live and how fresh they
are, for diagnosing a list that answers 503. Read-only, and nothing secret:
the store type and the database NAME (never the connection string), whether
the "list" document exists, when it was computed and by which commit, its
row count, and each chain's last run. It reads the store directly, not
through the list cache, and says what this web process holds in that cache,
so "the worker wrote it" and "this process sees it" can be told apart.
"""

from __future__ import annotations

import datetime as dt
import os
import time

from .chains import CHAINS
from .cost_store import FileStore, get_store
from .cost_views import last_unavailable
from .cost_worker import CHAIN_ORDER


STARTED = time.time()


def _iso(t) -> str | None:
    if not isinstance(t, (int, float)):
        return None
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def commit() -> str | None:
    """The commit this process runs, as Render names it (not secret)."""
    c = os.environ.get("RENDER_GIT_COMMIT", "").strip()
    return c[:12] or None


def _store_info(store) -> dict:
    if isinstance(store, FileStore):
        return {"type": "file", "database": None}
    db = getattr(store, "db", None)
    return {"type": "mongo", "database": getattr(db, "name", None)}


async def status_view(cache: dict) -> tuple[int, dict]:
    body: dict = {"checked_at": _iso(time.time()), "web_commit": commit(),
                  "te_cost_store_env": "file" if os.environ.get("TE_COST_STORE", "").startswith("file:") else "unset (Mongo)"}
    try:
        store = get_store()
        body["store"] = _store_info(store)
        ld = await store.get_meta("list")
    except Exception as e:  # noqa: BLE001  the error class only, no message (it can carry a host)
        body["store_error"] = type(e).__name__
        return 503, body
    body["list"] = {
        "exists": bool(ld),
        "computed_at": (ld or {}).get("computed_at"),
        "rows": len((ld or {}).get("rows") or []),
        "versions_measured": ((ld or {}).get("counts") or {}).get("versions_measured"),
        "versions_with_cost": ((ld or {}).get("counts") or {}).get("versions_with_cost"),
        "writer_commit": (ld or {}).get("writer_commit"),
        "written_at": _iso((ld or {}).get("written_at")),
    }
    held = cache.get("doc")
    body["web_started_at"] = _iso(STARTED)
    body["web_503_no_list"] = dict(last_unavailable)
    body["web_cache"] = {"holds_list": held is not None,
                         "age_seconds": round(time.monotonic() - cache.get("t", 0.0), 1) if held is not None else None}
    chains = []
    for ch in CHAIN_ORDER:
        m = await store.get_meta(f"chain:{ch}") or {}
        lr = m.get("last_run") or {}
        chains.append({"chain_id": ch, "chain": CHAINS[ch]["name"], "has_run": bool(lr),
                       "started": _iso(lr.get("started")), "computed_at": lr.get("computed_at"),
                       "block": lr.get("block"), "seconds": lr.get("total_seconds"), "quotes": lr.get("quotes"),
                       "error": lr.get("error")})
    body["chains"] = chains
    lease = await store.get_meta("lease:te_cost_cycle")
    body["cycle_lease"] = {"held": bool(lease and lease.get("until", 0) >= time.time()),
                           "until": _iso((lease or {}).get("until"))}
    return 200, body
