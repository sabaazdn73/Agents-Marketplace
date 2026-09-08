# first_visit.py
#
# Answers one question: has this visitor been here before?
#
# Used so the Home page shows on a first arrival and not on every reload.
# Someone can still open it from the nav whenever they like; this only
# decides what the bare domain does.
#
# WHY IP AND NOT A COOKIE
# -----------------------
# A cookie would be the cleaner mechanism: per-browser rather than per
# network, and it stores nothing about anyone. It does not work in this
# deployment. The frontend is served from Vercel and this API runs on
# Render, so a cookie set here is a THIRD-PARTY cookie from the browser's
# point of view. Safari blocks those outright and Chrome is removing them,
# and the API's CORS is allow_origins=["*"], which browsers refuse to pair
# with credentialed requests at all. It would fail silently for a large
# share of visitors, which is worse than not using it.
#
# WHAT IS AND IS NOT STORED
# -------------------------
# Never the address. Each request's IP is salted and hashed, and only the
# first 32 hex characters of that digest are kept, with a timestamp. The
# salt lives in the environment, so the stored value cannot be reversed
# without it and is useless on its own. Records expire after 90 days via a
# TTL index, so this stays a short-lived "seen recently" set rather than
# becoming a visitor log nobody asked for.
#
# WHAT THIS IS NOT
# ----------------
# Not identity. X-Forwarded-For is supplied by the client and can be set
# to anything, so it is a hint. Shared addresses mean an office or a mobile
# carrier can look like one visitor, and colleagues may see the Home page
# only once between them. That is an acceptable trade for deciding which
# page to open, and it would not be acceptable for anything that mattered.

from __future__ import annotations

import hashlib
import os
import time

from core.db import get_db

COLLECTION = "home_first_visit"
TTL_DAYS = 90

# Without a stable salt the hash would change on every restart and every
# visitor would look new. Falls back to a fixed string so the feature still
# works unconfigured; set FIRST_VISIT_SALT in any deployment.
_SALT = os.environ.get("FIRST_VISIT_SALT") or "tnega-first-visit-v1"

_ttl_ready = False


def client_ip(headers: dict, fallback: str | None) -> str | None:
    """The visitor's address as best it can be known.

    Behind Render the socket peer is the proxy, so X-Forwarded-For is the
    only place the address appears. The leftmost entry is the original
    client; everything after it is a hop. Any of it can be forged, which is
    why the result is only ever used to decide which page to show.
    """
    xff = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    return (fallback or "").strip() or None


def _fingerprint(ip: str) -> str:
    return hashlib.sha256(f"{_SALT}:{ip}".encode()).hexdigest()[:32]


async def _ensure_ttl(coll) -> None:
    """Create the expiry index once. Without it these rows would never be
    removed, which is the difference between a short-lived set and a log."""
    global _ttl_ready
    if _ttl_ready:
        return
    try:
        await coll.create_index("seen_at", expireAfterSeconds=TTL_DAYS * 24 * 3600)
        _ttl_ready = True
    except Exception:
        pass  # a missing index must not break the endpoint


async def check_and_record(ip: str | None) -> dict:
    """True only the first time an address is seen inside the TTL window.

    Any failure reports first_visit False. The caller shows the Home page
    only on a clear True, so an error means the marketplace opens, which is
    the safer way to be wrong.
    """
    if not ip:
        return {"first_visit": False, "reason": "no client address"}

    try:
        coll = get_db()[COLLECTION]
        await _ensure_ttl(coll)
        key = _fingerprint(ip)
        # Atomic: insert only if absent, and report whether it was new.
        res = await coll.update_one(
            {"_id": key},
            {"$setOnInsert": {"seen_at": time.time()}},
            upsert=True,
        )
        return {"first_visit": bool(res.upserted_id is not None)}
    except Exception as e:
        return {"first_visit": False, "reason": f"{type(e).__name__}"}
