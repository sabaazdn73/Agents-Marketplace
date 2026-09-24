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

THE WALLET IS NOT STORED EITHER
-------------------------------
Neither collection here holds the wallet address. Both hold
`address_fingerprint`, the salted stand-in from core/wallet_hash.py, which is
all "one key per address" and "find this address's challenge" need: each is
an exact match on a value the caller supplies again. With WALLET_HASH_SALT
unset, issuing refuses (AddressHashUnavailable) rather than store the address
raw. There is deliberately no fallback to the raw address, for the reason
wallet_hash.py gives for having no default salt.

What that fingerprint is worth is stated in wallet_hash.py and not repeated
generously here: anybody holding the salt can match it against the public,
small set of candidate addresses. It is a pseudonym as private as the
environment variable, not an irreversible transform.

The challenge document does not keep the signed message either, because the
message quotes the address. It is rebuilt from the address the caller sends
at issue and the stored nonce, by the same function that built it, so the
signature is checked against exactly the text that was signed.

Revoking a key deletes its document. There is no revoked_at tombstone: a
revoked key is then simply not found, which verify_key already treats as an
invalid key, so the rejection is identical and nothing about the wallet
outlives the key.

Documents written before this change carry a raw `address` and, if revoked,
a `revoked_at`. scripts/public_api_keys_migrate.py converts them. Until it
has run, the lookups below also match the legacy `address` field so that one
key per address still holds across the two shapes, and verify_key still
refuses a legacy document carrying `revoked_at`.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from datetime import datetime, timezone

from core import wallet_hash
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


class AddressHashUnavailable(RuntimeError):
    """The wallet could not be fingerprinted, so nothing was stored.

    Carries wallet_hash's withheld_reason, whose `code` is
    `salt_not_configured` or `not_an_address`, for a transport to map to a
    response. Its message never contains the address."""

    def __init__(self, withheld_reason: dict):
        self.withheld_reason = withheld_reason
        super().__init__(withheld_reason.get("code", "address_hash_unavailable"))


def _normalise(address: str | None) -> str:
    return (address or "").strip().lower()


def _address_fingerprint(addr: str) -> str:
    """The stored stand-in for a wallet, or AddressHashUnavailable.

    Raises rather than returning something storable, so there is no path on
    which an unset salt ends with the raw address in a document."""
    fp = wallet_hash.fingerprint(addr)
    if not fp.get("fingerprint"):
        raise AddressHashUnavailable(fp.get("withheld_reason") or {})
    return fp["fingerprint"]


def _challenge_message(addr: str, nonce: str) -> str:
    """The text a caller signs. Built here at challenge time and rebuilt here
    at issue time, so the stored challenge need not keep it."""
    return (
        "Tnega API key request\n"
        f"address: {addr}\n"
        f"nonce: {nonce}\n"
        "Signing this proves you control this wallet. It authorises nothing else, "
        "moves no funds, and grants no access to your wallet."
    )


def _owner_filter(addr: str, fp: str) -> dict:
    """Every key document belonging to one wallet, in either shape.

    The `address` branch matches documents written before the fingerprint
    change and is only needed until scripts/public_api_keys_migrate.py has
    run. It reads the legacy field, it never writes it."""
    return {"$or": [{"address_fingerprint": fp}, {"address": addr}]}


# ─────────────────────────── issuing ───────────────────────────

async def create_challenge(address: str) -> dict:
    """A nonce for the caller to sign. Expires, and is single use.

    Stored rather than derived so it can be burned on use. A stateless HMAC
    challenge would be replayable inside its window, which for key issuance is
    the one place that matters.

    Refuses with AddressHashUnavailable when WALLET_HASH_SALT is unset, before
    anything is written, so nobody is asked to sign for a key that cannot be
    issued."""
    addr = _normalise(address)
    if not wallet_hash.is_address(addr):
        raise ValueError("address must be a 0x-prefixed 40 character hex address")
    fp = _address_fingerprint(addr)
    # One outstanding challenge per address. Without this, find_one below picks
    # arbitrarily between several and a caller who requested two would have the
    # wrong message matched against their signature, which presents as an
    # inexplicable rejection rather than as the race it is.
    await get_db()[CHALLENGE_COLLECTION].delete_many({"address_fingerprint": fp})
    nonce = secrets.token_hex(16)
    message = _challenge_message(addr, nonce)
    now = _now()
    await get_db()[CHALLENGE_COLLECTION].insert_one({
        "_id": nonce, "address_fingerprint": fp,
        "created_at": now, "expires_at": now + CHALLENGE_TTL_SECONDS,
        # The TTL index is on this field and not on expires_at. MongoDB only
        # expires a document whose indexed field is a BSON date, and
        # expires_at is epoch seconds, so an index on it never removed
        # anything: an abandoned challenge stayed until the same address
        # asked again. expires_at is kept as the number the check in
        # issue_key compares against.
        "purge_at": datetime.fromtimestamp(now + CHALLENGE_TTL_SECONDS, tz=timezone.utc),
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

    addr = _normalise(address)
    if not wallet_hash.is_address(addr):
        raise ValueError("address must be a 0x-prefixed 40 character hex address")
    fp = _address_fingerprint(addr)
    db = get_db()
    ch = await db[CHALLENGE_COLLECTION].find_one({"address_fingerprint": fp})
    if not ch:
        raise LookupError("no challenge for this address, request one first")
    if ch.get("expires_at", 0) < _now():
        await db[CHALLENGE_COLLECTION].delete_one({"_id": ch["_id"]})
        raise LookupError("challenge expired, request another")

    try:
        recovered = Account.recover_message(
            encode_defunct(text=_challenge_message(addr, ch["_id"])), signature=signature
        )
    except Exception as e:
        raise PermissionError(f"signature could not be verified: {type(e).__name__}")
    if recovered.lower() != addr:
        raise PermissionError("signature does not match the address")

    # Burn the challenge whether or not what follows succeeds.
    await db[CHALLENGE_COLLECTION].delete_one({"_id": ch["_id"]})

    raw = KEY_PREFIX + secrets.token_urlsafe(32)
    await db[COLLECTION].delete_many(_owner_filter(addr, fp))   # one key per address
    await db[COLLECTION].insert_one({
        "_id": _hash(raw),
        "address_fingerprint": fp,
        "tier": DEFAULT_TIER,
        "created_at": _now(),
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
    # A revoked key's document is deleted, so it arrives here as None. The
    # revoked_at test is for documents revoked before that change and not yet
    # removed by scripts/public_api_keys_migrate.py.
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
    """Delete the key's document. Afterwards verify_key finds nothing for this
    key and returns None, the same answer it gives any unknown key."""
    rec = await verify_key(raw)
    if not rec:
        return False
    await get_db()[COLLECTION].delete_one({"_id": rec["_id"]})
    return True


async def set_tier(address: str, tier: str) -> bool:
    """Move a key between tiers. This is the whole upgrade path.

    Deliberately by address rather than by key, so it can be done from a record
    of who asked without ever handling their key. The address is fingerprinted
    and matched on that, so AddressHashUnavailable when the salt is unset."""
    if tier not in TIERS:
        raise ValueError(f"unknown tier {tier!r}, known: {sorted(TIERS)}")
    addr = _normalise(address)
    fp = _address_fingerprint(addr)
    # revoked_at: None also matches a document with no such field, which is
    # every document written since revocation became a delete.
    res = await get_db()[COLLECTION].update_one(
        {**_owner_filter(addr, fp), "revoked_at": None},
        {"$set": {"tier": tier}},
    )
    return res.modified_count > 0


async def ensure_indexes() -> None:
    """Called at startup. The challenge TTL index is what stops that collection
    growing without bound from abandoned requests.

    Nothing calls this yet: no transport for this package is mounted in
    server.py. It is on `purge_at`, a BSON date, because a TTL index on a
    numeric field expires nothing."""
    db = get_db()
    await db[COLLECTION].create_index("address_fingerprint")
    await db[CHALLENGE_COLLECTION].create_index("address_fingerprint")
    await db[CHALLENGE_COLLECTION].create_index("purge_at", expireAfterSeconds=0)
