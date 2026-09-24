"""
public_api_keys_migrate.py

One-off conversion of the two public API collections to the shape
publicapi/keys.py now writes: no raw wallet address anywhere, and no revoked
key kept as a tombstone.

WHAT IT DOES, PER DOCUMENT
--------------------------
public_api_keys
  revoked (a truthy `revoked_at`)       deleted
  carries a raw `address`               `address_fingerprint` set from it,
                                        `address` and a null `revoked_at`
                                        removed
  already fingerprinted, no `address`   left alone
  `address` that is not an address      left alone and counted, never
                                        printed. Needs a person to look.

public_api_challenges
  carries a raw `address`               deleted. A challenge lives five
                                        minutes and the caller can ask for
                                        another, so converting one is not
                                        worth it. Also, the TTL index this
                                        collection had was on a numeric field
                                        and expired nothing, so this is the
                                        step that clears abandoned ones.

WHICH SALT
----------
The fingerprint is only useful if it matches the one the running service
computes for the same wallet, so this must run with the SAME
WALLET_HASH_SALT as the deployment. With a different salt every migrated key
would stop matching its owner's "one key per address" lookup and set_tier,
silently. With the salt unset the script refuses to write at all.

WHICH DATABASE, AND WHY `env -u` DOES NOT HELP
---------------------------------------------
_main calls load_dotenv() before reading anything, so backend/.env supplies
MONGODB_URI and WALLET_HASH_SALT whenever the shell does not. In this
repository that file names the PRODUCTION database. Unsetting a variable in
the shell with `env -u` therefore does not keep this off production: the
value comes back from the file. To point it anywhere else, SET the variable
in the shell, for example MONGODB_URI=mongodb://127.0.0.1:27017; load_dotenv
does not override a variable that is already set. Even the dry run reads the
database named there, though it writes nothing.

WHAT IT PRINTS
--------------
Counts only. No address, no fingerprint and no key hash is printed in either
mode, so the output can be pasted anywhere.

Usage (from backend/, same env as the app, needs MONGODB_URI):

    python -m scripts.public_api_keys_migrate            # dry run, counts only
    python -m scripts.public_api_keys_migrate --apply    # writes

The dry run is the default and makes no write of any kind. Re-running --apply
is safe: a converted document has no `address` and is left alone.

The pure decision for one document is `plan_key_doc`, and
scripts/public_api_keys_migrate_selfcheck.py exercises it and `migrate`
against in-memory collections, with no database.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from typing import Callable

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

KEYS = "public_api_keys"
CHALLENGES = "public_api_challenges"

DELETE = "delete"
REWRITE = "rewrite"
KEEP = "keep"
UNUSABLE = "unusable_address"


def plan_key_doc(doc: dict, fingerprint: Callable[[str], dict]) -> tuple[str, dict | None]:
    """What to do with one public_api_keys document.

    Returns (action, update). `update` is a Mongo update document for
    REWRITE and None otherwise. `fingerprint` is core.wallet_hash.fingerprint
    or a stand-in with the same return shape; the caller has already
    established that a salt is configured.
    """
    if doc.get("revoked_at"):
        return DELETE, None
    if "address" not in doc:
        return KEEP, None
    fp = fingerprint((doc.get("address") or "").strip().lower())
    if not fp.get("fingerprint"):
        return UNUSABLE, None
    return REWRITE, {
        "$set": {"address_fingerprint": fp["fingerprint"]},
        "$unset": {"address": "", "revoked_at": ""},
    }


async def migrate(keys_col, challenges_col, fingerprint: Callable[[str], dict],
                  apply: bool) -> dict:
    """Plan every document, and write only when `apply` is true.

    Takes the collections as arguments so the selfcheck can hand it
    in-memory ones. Uses only find, count_documents, delete_one, delete_many
    and update_one."""
    counts = {DELETE: 0, REWRITE: 0, KEEP: 0, UNUSABLE: 0}
    written = {"keys_deleted": 0, "keys_rewritten": 0, "challenges_deleted": 0}

    # Read in full before writing, so a document rewritten mid-scan cannot be
    # met twice by the same cursor. The collection is one document per key.
    docs = [doc async for doc in keys_col.find({})]
    for doc in docs:
        action, update = plan_key_doc(doc, fingerprint)
        counts[action] += 1
        if not apply:
            continue
        if action == DELETE:
            res = await keys_col.delete_one({"_id": doc["_id"]})
            written["keys_deleted"] += res.deleted_count
        elif action == REWRITE:
            res = await keys_col.update_one({"_id": doc["_id"]}, update)
            written["keys_rewritten"] += res.modified_count

    challenges_raw = await challenges_col.count_documents({"address": {"$exists": True}})
    if apply and challenges_raw:
        res = await challenges_col.delete_many({"address": {"$exists": True}})
        written["challenges_deleted"] = res.deleted_count

    return {
        "mode": "apply" if apply else "dry_run",
        "keys": {
            "revoked_to_delete": counts[DELETE],
            "raw_address_to_fingerprint": counts[REWRITE],
            "already_converted": counts[KEEP],
            "unusable_address_left_alone": counts[UNUSABLE],
        },
        "challenges_with_raw_address": challenges_raw,
        "written": written if apply else None,
    }


def _print(result: dict) -> None:
    k = result["keys"]
    print(f"mode: {result['mode']}")
    print(f"public_api_keys   revoked, delete:                {k['revoked_to_delete']}")
    print(f"public_api_keys   raw address, fingerprint:       {k['raw_address_to_fingerprint']}")
    print(f"public_api_keys   already converted:              {k['already_converted']}")
    print(f"public_api_keys   unusable address, left alone:   {k['unusable_address_left_alone']}")
    print(f"public_api_challenges with raw address, delete:   {result['challenges_with_raw_address']}")
    if result["written"] is None:
        print("dry run: nothing was written. Re-run with --apply to write.")
    else:
        w = result["written"]
        print(f"written: {w['keys_deleted']} keys deleted, {w['keys_rewritten']} keys "
              f"rewritten, {w['challenges_deleted']} challenges deleted")


async def _main(apply: bool) -> int:
    from dotenv import load_dotenv
    load_dotenv()
    # Imported after load_dotenv: wallet_hash reads its salt at import.
    from core import wallet_hash
    from core.db import get_db

    probe = wallet_hash.fingerprint("0x" + "0" * 40)
    if not probe.get("fingerprint"):
        print("WALLET_HASH_SALT is not set. Refusing to run: without it no document "
              "can be converted, and a dry run would report conversions that could "
              "not happen. Set it to the deployment's value, not a new one.")
        return 2

    from core.safe_errors import describe as describe_error

    try:
        db = get_db()
        result = await migrate(db[KEYS], db[CHALLENGES], wallet_hash.fingerprint, apply)
    except Exception as e:  # noqa: BLE001
        # The class name only, never a traceback or the message: a driver's
        # error names the cluster's hosts, and this output is meant to be
        # pasteable. On a failure part way through --apply, re-running is
        # safe; a converted document is left alone.
        print(f"failed: {describe_error(e)}. Nothing after the failure was written.")
        return 1
    _print(result)
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true",
                    help="write the changes. Without it this is a dry run that prints counts.")
    args = ap.parse_args()
    sys.exit(asyncio.run(_main(args.apply)))
