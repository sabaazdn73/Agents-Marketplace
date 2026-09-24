#!/usr/bin/env python3
"""public_api_keys_migrate_selfcheck.py -- the wallet leaves the key table
and does not come back.

Checks two things, against in-memory collections, with no database and no
network:

  KEYS      publicapi/keys.py end to end: challenge, signed issue, verify,
            set_tier, revoke. No stored document holds the address in any
            field, the signature is checked against a rebuilt message, one
            key per address holds across the legacy and new shapes, a revoked
            key is deleted and then rejected exactly as an unknown key is, and
            with WALLET_HASH_SALT unset nothing is written at all.
  MIGRATE   scripts/public_api_keys_migrate.py: the per-document plan, a dry
            run that writes nothing, an apply that deletes the revoked,
            fingerprints the rest and clears raw challenges, and a second
            apply that changes nothing.

Run from backend/:  ./venv/bin/python scripts/public_api_keys_migrate_selfcheck.py

The fake collection implements only the filter shapes these two files use:
equality, None matching a missing field, $exists, and a top-level $or. A
filter it does not understand raises rather than matching nothing, so a new
query shape fails this check instead of passing it vacuously.
"""

from __future__ import annotations

import asyncio
import copy
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import wallet_hash  # noqa: E402
from publicapi import keys  # noqa: E402
from scripts import public_api_keys_migrate as mig  # noqa: E402

FAILURES: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("  ok    " if cond else "  FAIL  ") + what)
    if not cond:
        FAILURES.append(what)


_MISSING = object()


def _match_one(doc: dict, field: str, cond) -> bool:
    val = doc.get(field, _MISSING)
    if isinstance(cond, dict):
        if set(cond) == {"$exists"}:
            return (val is not _MISSING) == bool(cond["$exists"])
        raise NotImplementedError(f"operator {sorted(cond)} on {field}")
    if cond is None:
        return val is _MISSING or val is None
    return val is not _MISSING and val == cond


def _matches(doc: dict, flt: dict) -> bool:
    for field, cond in flt.items():
        if field == "$or":
            if not any(_matches(doc, sub) for sub in cond):
                return False
        elif field.startswith("$"):
            raise NotImplementedError(field)
        elif not _match_one(doc, field, cond):
            return False
    return True


class FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        self._it = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class FakeCollection:
    def __init__(self):
        self.docs: dict = {}
        self.writes = 0

    async def find_one(self, flt):
        for d in self.docs.values():
            if _matches(d, flt):
                return copy.deepcopy(d)
        return None

    def find(self, flt):
        return FakeCursor([copy.deepcopy(d) for d in self.docs.values() if _matches(d, flt)])

    async def count_documents(self, flt):
        return sum(1 for d in self.docs.values() if _matches(d, flt))

    async def insert_one(self, doc):
        self.writes += 1
        assert doc["_id"] not in self.docs
        self.docs[doc["_id"]] = copy.deepcopy(doc)

    async def delete_one(self, flt):
        self.writes += 1
        for k, d in list(self.docs.items()):
            if _matches(d, flt):
                del self.docs[k]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, flt):
        self.writes += 1
        gone = [k for k, d in self.docs.items() if _matches(d, flt)]
        for k in gone:
            del self.docs[k]
        return SimpleNamespace(deleted_count=len(gone))

    async def update_one(self, flt, update):
        self.writes += 1
        for d in self.docs.values():
            if _matches(d, flt):
                before = copy.deepcopy(d)
                for op, fields in update.items():
                    if op == "$set":
                        d.update(fields)
                    elif op == "$unset":
                        for f in fields:
                            d.pop(f, None)
                    else:
                        raise NotImplementedError(op)
                return SimpleNamespace(modified_count=int(d != before))
        return SimpleNamespace(modified_count=0)


class FakeDB(dict):
    def __missing__(self, name):
        self[name] = FakeCollection()
        return self[name]


def _contains(obj, needle: str) -> bool:
    """Whether `needle` appears anywhere in a document, in any case."""
    if isinstance(obj, dict):
        return any(_contains(k, needle) or _contains(v, needle) for k, v in obj.items())
    if isinstance(obj, (list, tuple)):
        return any(_contains(v, needle) for v in obj)
    return isinstance(obj, str) and needle.lower() in obj.lower()


async def check_keys() -> None:
    from eth_account import Account
    from eth_account.messages import encode_defunct

    print("KEYS")
    db = FakeDB()
    keys.get_db = lambda: db
    acct = Account.create()
    addr = acct.address                    # checksummed, as a wallet sends it
    addr_hex = addr[2:].lower()

    # Salt unset: nothing is written, the refusal says why.
    wallet_hash._SALT = None
    try:
        await keys.create_challenge(addr)
        check(False, "salt unset: create_challenge refuses")
    except keys.AddressHashUnavailable as e:
        check(e.withheld_reason.get("code") == "salt_not_configured",
              "salt unset: create_challenge refuses with salt_not_configured")
        check(addr_hex not in str(e), "salt unset: the refusal does not quote the address")
    try:
        await keys.issue_key(addr, "0x00")
        check(False, "salt unset: issue_key refuses")
    except keys.AddressHashUnavailable:
        check(True, "salt unset: issue_key refuses")
    try:
        await keys.set_tier(addr, "paid")
        check(False, "salt unset: set_tier refuses")
    except keys.AddressHashUnavailable:
        check(True, "salt unset: set_tier refuses")
    check(all(c.writes == 0 for c in db.values()), "salt unset: no collection was written")

    wallet_hash._SALT = "selfcheck-salt"
    fp = wallet_hash.fingerprint(addr)["fingerprint"]

    # 0x plus 40 characters that are not hex is 42 long, and is not an address.
    for bad in ("0x" + "z" * 40, "0x" + "g" * 40, "0x" + "a" * 39, "1x" + "a" * 40):
        for fn in (keys.create_challenge, lambda a: keys.issue_key(a, "0x00")):
            try:
                await fn(bad)
                check(False, f"non-address refused: {bad[:6]}...")
            except ValueError:
                pass
    check(all(c.writes == 0 for c in db.values()),
          "0x plus 40 non-hex characters is refused by create_challenge and issue_key, nothing written")

    # A legacy document for the same wallet, as written before this change.
    db[keys.COLLECTION].docs["legacyhash"] = {
        "_id": "legacyhash", "address": addr.lower(), "tier": "free",
        "created_at": 1.0, "revoked_at": None, "last_used_at": None, "label": None,
    }

    ch = await keys.create_challenge(addr)
    stored_ch = db[keys.CHALLENGE_COLLECTION].docs[ch["nonce"]]
    check(not _contains(stored_ch, addr_hex), "challenge document holds no address, in any field")
    check(stored_ch.get("address_fingerprint") == fp, "challenge document holds the fingerprint")
    check(type(stored_ch.get("purge_at")).__name__ == "datetime",
          "challenge carries a BSON-date field for the TTL index")

    sig = Account.sign_message(encode_defunct(text=ch["message"]), acct.key).signature.hex()
    issued = await keys.issue_key(addr, sig)
    raw = issued["api_key"]
    key_docs = list(db[keys.COLLECTION].docs.values())
    check(len(key_docs) == 1, "one key per address: the legacy document for this wallet is gone")
    check(not _contains(key_docs[0], addr_hex), "key document holds no address, in any field")
    check(key_docs[0].get("address_fingerprint") == fp, "key document holds the fingerprint")
    check("revoked_at" not in key_docs[0], "key document carries no revoked_at")
    check(not db[keys.CHALLENGE_COLLECTION].docs, "challenge burned on use")

    rec = await keys.verify_key(raw)
    check(rec is not None and rec["_id"] == keys._hash(raw), "issued key verifies")

    check(await keys.set_tier(addr.lower(), "paid"), "set_tier finds the key by fingerprint")
    check((await keys.verify_key(raw))["tier"] == "paid", "set_tier took effect")

    unknown = await keys.verify_key(keys.KEY_PREFIX + "never-issued")
    check(await keys.revoke(raw), "revoke reports success")
    check(not db[keys.COLLECTION].docs, "revoke deleted the document")
    check(await keys.verify_key(raw) is None and unknown is None,
          "a revoked key is rejected with the same None as an unknown key")
    check(not await keys.revoke(raw), "revoking twice reports nothing to revoke")

    # A legacy revoked document is still refused before the migration runs.
    db[keys.COLLECTION].docs[keys._hash("tng_legacy")] = {
        "_id": keys._hash("tng_legacy"), "address": "0x" + "1" * 40, "revoked_at": 5.0,
    }
    check(await keys.verify_key("tng_legacy") is None, "a legacy revoked document is still refused")

    # A signature over some other text does not pass against the rebuilt message.
    ch2 = await keys.create_challenge(addr)
    bad = Account.sign_message(encode_defunct(text=ch2["message"] + "x"), acct.key).signature.hex()
    try:
        await keys.issue_key(addr, bad)
        check(False, "a signature over other text is refused")
    except PermissionError:
        check(True, "a signature over other text is refused")


async def check_migrate() -> None:
    print("MIGRATE")
    wallet_hash._SALT = "selfcheck-salt"
    fpf = wallet_hash.fingerprint
    a1, a2 = "0x" + "a" * 40, "0x" + "B" * 40

    check(mig.plan_key_doc({"address": a1, "revoked_at": 3.0}, fpf)[0] == mig.DELETE,
          "plan: revoked is deleted")
    action, upd = mig.plan_key_doc({"address": a2, "revoked_at": None}, fpf)
    check(action == mig.REWRITE and upd["$set"]["address_fingerprint"] == fpf(a2)["fingerprint"],
          "plan: raw address becomes its fingerprint, case-insensitively")
    check(set(upd["$unset"]) == {"address", "revoked_at"}, "plan: raw address and revoked_at removed")
    check(mig.plan_key_doc({"address_fingerprint": "x"}, fpf)[0] == mig.KEEP,
          "plan: already converted is kept")
    check(mig.plan_key_doc({"address": "not-an-address"}, fpf)[0] == mig.UNUSABLE,
          "plan: an unusable address is left alone, not deleted")

    keys_col, ch_col = FakeCollection(), FakeCollection()
    keys_col.docs = {
        "k1": {"_id": "k1", "address": a1, "revoked_at": None, "tier": "free"},
        "k2": {"_id": "k2", "address": a2, "revoked_at": 99.0, "tier": "free"},
        "k3": {"_id": "k3", "address_fingerprint": "f" * 32, "tier": "paid"},
        "k4": {"_id": "k4", "address": "garbage", "revoked_at": None},
    }
    ch_col.docs = {
        "n1": {"_id": "n1", "address": a1, "message": f"address: {a1}", "expires_at": 1.0},
        "n2": {"_id": "n2", "address_fingerprint": "f" * 32, "expires_at": 1.0},
    }

    dry = await mig.migrate(keys_col, ch_col, fpf, apply=False)
    check(keys_col.writes == 0 and ch_col.writes == 0, "dry run writes nothing")
    check(dry["keys"] == {"revoked_to_delete": 1, "raw_address_to_fingerprint": 1,
                          "already_converted": 1, "unusable_address_left_alone": 1}
          and dry["challenges_with_raw_address"] == 1 and dry["written"] is None,
          "dry run counts each case")

    res = await mig.migrate(keys_col, ch_col, fpf, apply=True)
    check("k2" not in keys_col.docs, "apply: revoked document deleted")
    check(keys_col.docs["k1"] == {"_id": "k1", "tier": "free",
                                  "address_fingerprint": fpf(a1)["fingerprint"]},
          "apply: raw address replaced by fingerprint, nothing else touched")
    check(keys_col.docs["k3"]["address_fingerprint"] == "f" * 32, "apply: converted doc untouched")
    check("k4" in keys_col.docs, "apply: unusable address left for a person")
    check(set(ch_col.docs) == {"n2"}, "apply: challenges with a raw address deleted, others kept")
    check(res["written"] == {"keys_deleted": 1, "keys_rewritten": 1, "challenges_deleted": 1},
          "apply: write counts match")

    again = await mig.migrate(keys_col, ch_col, fpf, apply=True)
    check(again["written"] == {"keys_deleted": 0, "keys_rewritten": 0, "challenges_deleted": 0},
          "second apply changes nothing")

    import io
    import contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        mig._print(dry)
        mig._print(res)
    out = buf.getvalue().lower()
    check(a1[2:12] not in out and "b" * 10 not in out and fpf(a1)["fingerprint"] not in out,
          "printed output carries no address and no fingerprint")


async def main() -> int:
    await check_keys()
    await check_migrate()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED")
        return 1
    print("all passed")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
