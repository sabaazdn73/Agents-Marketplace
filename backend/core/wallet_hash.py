# wallet_hash.py
#
# A stored stand-in for a wallet address, for a surface that needs to
# recognise the same wallet twice without keeping the address.
#
# NOTHING CALLS THIS YET
# ----------------------
# Deliberately. No code path in this project currently receives a wallet
# address from a visitor, and the surface that would is still a spec. The
# function is here so that when that surface arrives the hashing decision has
# already been made and reviewed, rather than being made in the same hour as
# the feature. Wiring it in is a separate change, and the thing to check at
# that point is the paragraph on enumerability below, because it governs what
# this can and cannot be relied on for.
#
# WHY ITS OWN SALT AND NOT FIRST_VISIT_SALT
# -----------------------------------------
# Different lifetimes and different blast radii.
#
# An IP hash is about a visitor and expires after ninety days, so its salt can
# be rotated with a cost measured in one quarter of first-visit counts. An
# address hash is about an on-chain identity that never expires: the same
# address is the same party in five years, and a stand-in for it is only
# useful while it stays stable, so its salt is the one that has to sit still.
# Rotating the short-lived value should not be held up by the long-lived one,
# and rotating the long-lived one should not silently reset visit counting.
#
# And one compromised value should not expose both. A leaked FIRST_VISIT_SALT
# costs a window of IP hashes. A leaked WALLET_HASH_SALT costs the address
# hashes. Sharing one value would make either leak cost both.
#
# WHAT A SALTED ADDRESS HASH ACTUALLY BUYS, STATED PLAINLY
# --------------------------------------------------------
# It resists a reader of this repository. It does not resist an attacker who
# holds both the salt and a candidate list, and for addresses the candidate
# list is public and small: every address that has ever touched these tokens
# is enumerable from the chain, and the set is in the thousands rather than
# the billions. Anybody with the salt can hash that whole set in seconds and
# match every stored value.
#
# So the salt raises the cost of reversal from zero to "obtain the salt". It
# does not make the hash one-way in any sense that survives the salt leaking.
# Treat a stored address hash as a pseudonym that is only as private as the
# environment variable, not as an irreversible transform, and do not let it
# justify storing something that would be unacceptable to store as an address.
#
# IF THE SALT IS UNSET, NOTHING IS HASHED
# ---------------------------------------
# Same discipline as core/first_visit.py and for the same reason. A default
# salt would have to be a constant in this file, and a hash against a constant
# a reader already has is reversible by trying candidates until one matches,
# which against a public candidate list is not an attack so much as a lookup.
# So with WALLET_HASH_SALT unset this refuses, once per process in the log and
# every time in the return value.

from __future__ import annotations

import hashlib
import os

# Read once at import. Stable across restarts by necessity: a stand-in that
# changes when the process restarts does not identify anything.
_SALT = os.environ.get("WALLET_HASH_SALT") or None

_salt_absence_logged = False


def _salt() -> str | None:
    """The configured salt, or None having said so once.

    Once per process, not once per call. The same reasoning as first_visit:
    a line per call on an unconfigured deployment is a denial of service
    against the log it is trying to warn in.
    """
    global _salt_absence_logged
    if _SALT:
        return _SALT
    if not _salt_absence_logged:
        _salt_absence_logged = True
        print(
            "[wallet_hash] WALLET_HASH_SALT is not set. Wallet address "
            "hashing is off for the life of this process: no address is "
            "hashed and every call answers with "
            "withheld_reason=salt_not_configured rather than a fingerprint. "
            "Set WALLET_HASH_SALT to turn it on. Printed once per process, "
            "not once per call.",
            flush=True,
        )
    return None


def _digest(salt: str, address: str) -> str:
    """The stored stand-in for one address.

    The salt is a parameter rather than a module read, so there is no path to
    this function that has not already established that a salt exists.

    Lowercased first, because the same address arrives checksummed from one
    source and lowercase from another and those must not produce two
    fingerprints. Thirty-two hex characters, matching first_visit: 128 bits
    is far past collision risk over any population this will ever see, and a
    shorter stored value is a smaller thing to leak.
    """
    return hashlib.sha256(f"{salt}:{address.lower()}".encode()).hexdigest()[:32]


def fingerprint(address: str | None) -> dict:
    """A stable stand-in for one wallet address, or why there is none.

    Returns the project's absence shape rather than a string or None: a
    `fingerprint` that is null only alongside a `withheld_reason` carrying a
    code to branch on and a sentence to read. A caller must not be able to
    mistake "not configured" for "no address given", and must not receive
    anything hashable-looking when neither happened.
    """
    salt = _salt()
    if salt is None:
        return {
            "fingerprint": None,
            "withheld_reason": {
                "code": "salt_not_configured",
                "detail": (
                    "WALLET_HASH_SALT is not set on this deployment, so no "
                    "wallet address was hashed. The alternative would be a "
                    "constant salt committed to this repository, and against "
                    "a candidate list as public and as small as the set of "
                    "addresses that have touched these tokens, a hash under a "
                    "known salt is a lookup rather than a protection."
                ),
            },
        }

    addr = (address or "").strip()
    if not addr.startswith("0x") or len(addr) != 42:
        # The same code corestate.py uses on the same predicate. The address
        # is not echoed back: this returns to a caller that may log it.
        return {
            "fingerprint": None,
            "withheld_reason": {
                "code": "not_an_address",
                "detail": (
                    "Not a 42-character 0x-prefixed address, so there is "
                    "nothing to hash."
                ),
            },
        }

    return {"fingerprint": _digest(salt, addr), "withheld_reason": None}
