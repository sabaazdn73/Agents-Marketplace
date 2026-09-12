"""
keys.py

Issuing, verifying and revoking API keys, and the tier each one carries.

WHY A WALLET SIGNATURE RATHER THAN A SIGNUP FORM
------------------------------------------------
Manual approval was considered and rejected: it kills the MCP case, which is
the surface that matters most. An agent that discovers this server cannot wait
for a human to approve it, and a key path that only works for humans defeats
the point.

Anonymous self-serve was rejected too. A free key in thirty seconds is exactly
how a scraper gets one.

A signature costs a scraper a distinct wallet per key. That is cheap but not
free, it leaves a persistent identifier that can be correlated, including
against agent ownership, and it is native to this audience since everyone here
already has a wallet. It needs no new infrastructure: eth-account is already a
dependency and there is no email sender to build around. And it is instant, so
MCP works.

WHAT THE TIERS ARE FOR
----------------------
Limits come from the tier record, never from a constant, so raising someone is
a database write rather than a deploy. The numbers are derived rather than
picked: see TIERS below for the reasoning behind each one.

The key is hashed at rest. We never store anything that could be replayed, and
a key is shown to its owner exactly once, at issue.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

from core.db import get_db

COLLECTION = "public_api_keys"
CHALLENGE_COLLECTION = "public_api_challenges"

KEY_PREFIX = "tng_"
CHALLENGE_TTL_SECONDS = 300


# Tier limits, and why each number is what it is.
#
# A full listing of the catalogue is 3,975 requests at 50 a page. The thirteen
# evaluation signals are one request per agent, 198,743 of them. Those two
# numbers are what the free tier is set against.
#
# FREE at 1,000/day is:
#   4x the busiest realistic MCP agent (50 tasks at ~5 calls each)
#   10x a server-side embed refreshing four views hourly
#   just above a 10-agent watchlist polled every 15 minutes (960/day)
# and it is NOT enough for a 30-agent watchlist at 2,880/day, deliberately.
# That is a real integration and should be a conversation rather than something
# taken silently.
#
# 30/minute is 0.5 rps, so twenty keys at full tilt exactly reach the 10 rps
# global ceiling. The per-key and global numbers are consistent with each other
# rather than chosen separately.
TIERS: dict[str, dict] = {
    "free": {
        "per_day": 1_000,
        "per_minute": 30,
        "bulk": False,
        "note": "Enough for a real integration, not enough to copy the signal set.",
    },
    # Defined now, issued later. Nothing reads a price here yet.
    "paid": {
        "per_day": 25_000,
        "per_minute": 120,
        "bulk": False,
        "note": "Higher limits, same surface. Still not bulk: the full signal set is 8 days.",
    },
    # Never self-serve. Granted by hand, and the only tier that may ever see a
    # bulk or export route.
    "deep": {
        "per_day": None,          # None means no daily cap, not a large one
        "per_minute": 600,
        "bulk": True,
        "note": "Negotiated access. Issued by hand only.",
    },
}
DEFAULT_TIER = "free"


def tier_limits(tier: str) -> dict:
    """Limits for a tier, falling back to free rather than to unlimited.

    The direction of that fallback matters: an unrecognised tier on a record
    must not become a way to get more than everyone else."""
    return TIERS.get(tier) or TIERS[DEFAULT_TIER]


def _hash(key: str) -> str:
    """Keys are stored hashed. A leaked database must not yield usable keys."""
    return hashlib.sha256(key.encode()).hexdigest()


def _now() -> float:
    return time.time()


# ─────────────────────────── issuing ───────────────────────────

async def create_challenge(address: str) -> dict:
    """A nonce for the caller to sign. Expires, and is single use.

    Stored rather than derived so it can be burned on use. A stateless HMAC
    challenge would be replayable inside its window, which for key issuance is
    the one place that matters."""
    addr = (address or "").strip().lower()
    if not addr.startswith("0x") or len(addr) != 42:
        raise ValueError("address must be a 0x-prefixed 40 character hex address")
    # One outstanding challenge per address. Without this, find_one below picks
    # arbitrarily between several and a caller who requested two would have the
    # wrong message matched against their signature, which presents as an
    # inexplicable rejection rather than as the race it is.
    await get_db()[CHALLENGE_COLLECTION].delete_many({"address": addr})
    nonce = secrets.token_hex(16)
    message = (
        "Tnega API key request\n"
        f"address: {addr}\n"
        f"nonce: {nonce}\n"
        "Signing this proves you control this wallet. It authorises nothing else, "
        "moves no funds, and grants no access to your wallet."
    )
    await get_db()[CHALLENGE_COLLECTION].insert_one({
        "_id": nonce, "address": addr, "message": message,
        "created_at": _now(), "expires_at": _now() + CHALLENGE_TTL_SECONDS,
    })
    return {"address": addr, "nonce": nonce, "message": message,
            "expires_in": CHALLENGE_TTL_SECONDS}


async def issue_key(address: str, signature: str) -> dict:
    """Verify the signature and issue a key. Returns the key once, never again.

    One active key per address. Requesting a second revokes the first rather
    than accumulating them, so an address cannot multiply its own allowance by
    asking repeatedly."""
    from eth_account import Account
    from eth_account.messages import encode_defunct

    addr = (address or "").strip().lower()
    db = get_db()
    ch = await db[CHALLENGE_COLLECTION].find_one({"address": addr})
    if not ch:
        raise LookupError("no challenge for this address, request one first")
    if ch.get("expires_at", 0) < _now():
        await db[CHALLENGE_COLLECTION].delete_one({"_id": ch["_id"]})
        raise LookupError("challenge expired, request another")

    try:
        recovered = Account.recover_message(
            encode_defunct(text=ch["message"]), signature=signature
        )
    except Exception as e:
        raise PermissionError(f"signature could not be verified: {type(e).__name__}")
    if recovered.lower() != addr:
        raise PermissionError("signature does not match the address")

    # Burn the challenge whether or not what follows succeeds.
    await db[CHALLENGE_COLLECTION].delete_one({"_id": ch["_id"]})

    raw = KEY_PREFIX + secrets.token_urlsafe(32)
    await db[COLLECTION].delete_many({"address": addr})     # one key per address
    await db[COLLECTION].insert_one({
        "_id": _hash(raw),
        "address": addr,
        "tier": DEFAULT_TIER,
        "created_at": _now(),
        "revoked_at": None,
        "last_used_at": None,
        "label": None,
    })
    return {"api_key": raw, "address": addr, "tier": DEFAULT_TIER,
            "limits": tier_limits(DEFAULT_TIER),
            "warning": "This key is shown once. Store it now."}


async def verify_key(raw: str | None) -> dict | None:
    """The key record, or None. Constant-time compare on the hash.

    Returns the record rather than a boolean because every caller needs the
    tier, and a second lookup to get it would be a second round trip on the
    hot path."""
    if not raw or not raw.startswith(KEY_PREFIX):
        return None
    digest = _hash(raw)
    rec = await get_db()[COLLECTION].find_one({"_id": digest})
    if not rec or rec.get("revoked_at"):
        return None
    if not hmac.compare_digest(rec["_id"], digest):
        return None
    return rec


async def touch(raw_hash: str) -> None:
    """Record last use. Fire and forget; failing this must not fail a request."""
    try:
        await get_db()[COLLECTION].update_one(
            {"_id": raw_hash}, {"$set": {"last_used_at": _now()}}
        )
    except Exception:
        pass


async def revoke(raw: str) -> bool:
    rec = await verify_key(raw)
    if not rec:
        return False
    await get_db()[COLLECTION].update_one(
        {"_id": rec["_id"]}, {"$set": {"revoked_at": _now()}}
    )
    return True


async def set_tier(address: str, tier: str) -> bool:
    """Move a key between tiers. This is the whole upgrade path.

    Deliberately by address rather than by key, so it can be done from a record
    of who asked without ever handling their key."""
    if tier not in TIERS:
        raise ValueError(f"unknown tier {tier!r}, known: {sorted(TIERS)}")
    res = await get_db()[COLLECTION].update_one(
        {"address": (address or "").strip().lower(), "revoked_at": None},
        {"$set": {"tier": tier}},
    )
    return res.modified_count > 0


async def ensure_indexes() -> None:
    """Called at startup. The challenge TTL index is what stops that collection
    growing without bound from abandoned requests."""
    db = get_db()
    await db[COLLECTION].create_index("address")
    await db[CHALLENGE_COLLECTION].create_index("expires_at", expireAfterSeconds=0)
