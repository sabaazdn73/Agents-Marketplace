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
# IF THE SALT IS UNSET, NOTHING IS HASHED
# ---------------------------------------
# There is no fallback salt, and there used to be one. A fallback has to be a
# constant sitting in this file, and a hash taken against a constant that
# anybody reading the repository already has is reversible for any address:
# hash candidates against the known salt until one matches, and the candidate
# space for an IPv4 address is small enough to walk. That is the whole of the
# protection gone, so with FIRST_VISIT_SALT unset this module hashes nothing,
# writes nothing, reads nothing, and says so.
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

# Read once at import. The salt has to be stable across restarts or every
# visitor looks new on every deploy, which rules out generating one at boot
# as well as committing one. There is deliberately no default: see IF THE
# SALT IS UNSET at the top of this file.
_SALT = os.environ.get("FIRST_VISIT_SALT") or None

_ttl_ready = False
_salt_absence_logged = False


def _salt() -> str | None:
    """The configured salt, or None having said so once.

    Once per process rather than once per request. An unconfigured deployment
    still takes traffic at whatever rate the internet sends it, and a line per
    request would be a denial of service against its own log: one repeated
    sentence pushing out everything worth reading.
    """
    global _salt_absence_logged
    if _SALT:
        return _SALT
    if not _salt_absence_logged:
        _salt_absence_logged = True
        print(
            "[first_visit] FIRST_VISIT_SALT is not set. First-visit detection "
            "is off for the life of this process: no client address is "
            f"hashed, nothing is written to or read from the {COLLECTION} "
            "collection, and /api/first-visit answers with "
            "withheld_reason=salt_not_configured rather than a true or a "
            "false. Set FIRST_VISIT_SALT to turn it back on. Printed once per "
            "process, not once per request.",
            flush=True,
        )
    return None


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


def _fingerprint(salt: str, ip: str) -> str:
    """The stored stand-in for one address.

    The salt is passed in rather than read from the module, so that there is
    no way to reach this function without having established that a salt
    exists. A caller cannot accidentally hash against None.
    """
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()[:32]


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

    `first_visit` is True, False, or None, and None is never a quieter way of
    saying False. It means the question was not answered, and
    `withheld_reason` carries a code a caller can branch on plus a sentence a
    person can read. That is the shape this project already uses wherever a
    measurement cannot be made: see core/hyperliquid/corestate.py,
    core/extension/subject.py and core/agents_index.py, and `store_unavailable`
    here is the code subject.py already emits on the same predicate.

    Every failure used to report False so that the caller opened the
    marketplace. That was a manufactured answer to a question nothing had
    answered, the same defect as a zero standing in for a failed read. A
    caller that wants the old behaviour treats a null as "not a first visit",
    which it can now do knowingly rather than being told a false.
    """
    salt = _salt()
    if salt is None:
        return {
            "first_visit": None,
            "withheld_reason": {
                "code": "salt_not_configured",
                "detail": (
                    "FIRST_VISIT_SALT is not set on this deployment, so no "
                    "client address was hashed and no record was written or "
                    "read. The alternative would be a constant salt committed "
                    "to this repository, and a hash taken against a salt "
                    "anybody can read is reversible for any address by trying "
                    "candidates until one matches."
                ),
            },
        }

    if not ip:
        return {
            "first_visit": None,
            "withheld_reason": {
                "code": "no_client_address",
                "detail": (
                    "Neither X-Forwarded-For nor the socket peer carried an "
                    "address, so there is nothing to recognise this visitor "
                    "by."
                ),
            },
        }

    try:
        coll = get_db()[COLLECTION]
        await _ensure_ttl(coll)
        key = _fingerprint(salt, ip)
        # Atomic: insert only if absent, and report whether it was new.
        res = await coll.update_one(
            {"_id": key},
            {"$setOnInsert": {"seen_at": time.time()}},
            upsert=True,
        )
        return {
            "first_visit": bool(res.upserted_id is not None),
            "withheld_reason": None,
        }
    except Exception as e:
        # The exception TYPE and nothing else. A driver's message can quote
        # the connection string, and a DNS or socket failure can quote a host
        # address, so the text of `e` is not something to put in a response.
        return {
            "first_visit": None,
            "withheld_reason": {
                "code": "store_unavailable",
                "detail": (
                    f"The first-visit store did not answer "
                    f"({type(e).__name__}). Whether this visitor has been here "
                    f"before is unknown, which is not the same as false."
                ),
            },
        }
