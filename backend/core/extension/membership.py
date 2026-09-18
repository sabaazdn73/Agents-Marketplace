"""
membership.py

The list the Chrome extension checks before it asks us anything.

WHY THIS EXISTS AT ALL
The extension has to decide whether the page a person is looking at is about
something this project has measured. The obvious way is to send every address
it sees to this server, and that would mean we learn which explorer pages that
person visits. The privacy policy says we do not, so the decision has to happen
on their machine, which means they need the set of identifiers we cover.

WHY A BLOOM FILTER AND NOT THE SET ITSELF
177,302 addresses as text is 7.6 MB. As a Bloom filter at a one in a thousand
false positive rate it is 312 KB, measured rather than estimated, over the real
set. The saving is what makes a daily refresh reasonable to download.

Alternatives were costed rather than waved at. A Golomb-coded set reaches about
216 KB at the same rate, a saving of 96 KB that costs a bespoke decoder in the
extension and turns an O(1) lookup into a sequential scan unless it is bucketed.
A cuckoo filter is LARGER here, about 220 KB at a one percent rate where the
Bloom filter is 208 KB, because cuckoo's advantage appears at rates below about
0.1 percent and with deletions, and this set is rebuilt rather than mutated.
Sorted truncated hashes are far worse unless delta coded, and delta coded they
are a Golomb-coded set.

WHAT IS IN IT, AND THE TWO KEY SPACES
Addresses, namespaced by why we know them, so that a hit tells the extension
which subject to draw before it asks:

    o:<lowercase 0x address>    owns at least one registered agent
    j:<lowercase 0x address>    named as provider on an ERC-8183 job
    h:<lowercase 0x address>    in the Hyperliquid collector's set, ever

and agent pages, which 8004scan keys by chain and number rather than by address:

    a:<chain slug>:<token id>

EVM ONLY, AND WHY THAT IS NOT AN OVERSIGHT
Keys are lowercased, because Etherscan-family URLs carry EIP-55 checksummed
addresses and the extension must find them whatever case they arrive in. Solana
addresses are base58 and base58 IS case sensitive, so the same normalisation
that is mandatory for EVM silently destroys a Solana key. The 286 Solana owner
addresses are therefore excluded rather than lowercased into nonsense, which
costs nothing today: no Solana explorer is in the extension's match list.

If a Solana surface is ever added, it needs its own key space with its own
normalisation, not a row in this one.

FALSE POSITIVES AND FALSE NEGATIVES ARE NOT SYMMETRIC HERE
A false positive costs one request that comes back with nothing known, and the
extension draws no panel. At p=0.001 that is one page in a thousand that is not
about anything we cover.

A false negative is not possible from the filter, but IS possible from the
system: an agent registered after the last build is not in the list, so the
extension stays silent about it until the next one. That is why `built_at` is
served alongside the filter and printed in the panel on 8004scan. Silence on a
general explorer is the right output for an address we have not measured;
silence on a page that is an agent by construction is not, so that surface
shows the snapshot date instead of nothing.
"""

from __future__ import annotations

import base64
import hashlib
import math
import time

from core.db import get_db
from core.full_registry_ingest import FULL_REGISTRY_COLLECTION

# One in a thousand. Measured over the real key set at a million trials:
# 0.00097, against a theoretical 0.001. An earlier pass measured this over
# twenty thousand trials and reported 0.0006, which is below the theoretical
# rate and therefore impossible for a correctly built filter; the number was
# sampling noise quoted to five decimal places. Any future change to P should
# be re-measured at a million trials or not stated.
P = 0.001

# The chain slugs 8004scan uses in its own agent URLs, read off its /networks
# page rather than guessed. Only the chains this project holds are mapped: a
# slug absent here produces no key, so an agent page for a chain we do not
# ingest is a miss rather than a wrong answer.
#
# Verified: bsc -> 56, from the agent payload of /agents/bsc/353701, which
# carries "chain_id":56 beside the token id in the URL. The other six are
# matched by name and have NOT been verified against that site's own payload.
# A wrong mapping here is a panel that says nothing rather than a panel that
# says something false, because the lookup that follows is keyed on our own
# chain id and simply finds nothing.
CHAIN_SLUGS = {
    "bsc": 56,
    "ethereum": 1,
    "base": 8453,
    "monad": 143,
    "arbitrum": 42161,
    "robinhood-chain": 4663,
}
SLUG_BY_CHAIN = {v: k for k, v in CHAIN_SLUGS.items()}


def _params(n: int, p: float = P) -> tuple[int, int]:
    """Bits and hash count for n keys at false positive rate p."""
    m = int(-n * math.log(p) / (math.log(2) ** 2))
    m += (8 - m % 8) % 8          # whole bytes, so the wire format is bytes
    k = max(1, round(m / n * math.log(2)))
    return m, k


def _positions(key: str, m: int, k: int):
    """Kirsch-Mitzenmacher: two hashes from one SHA-256, k positions derived.

    h2 is forced odd so that it is coprime with m whenever m is even, which it
    always is here because m is rounded to whole bytes. Without that, an even
    h2 walks only half the filter and the realised false positive rate drifts
    above the target.
    """
    h = hashlib.sha256(key.encode()).digest()
    h1 = int.from_bytes(h[:8], "big")
    h2 = int.from_bytes(h[8:16], "big") | 1
    for i in range(k):
        yield (h1 + i * h2) % m


def build_filter(keys: set[str], p: float = P) -> dict:
    m, k = _params(len(keys), p)
    bits = bytearray(m // 8)
    for key in keys:
        for b in _positions(key, m, k):
            bits[b >> 3] |= 1 << (b & 7)
    return {
        "m": m,
        "k": k,
        "n": len(keys),
        "p": p,
        # base64, not a byte array. chrome.storage.local measures its quota by
        # "the JSON stringification of every value plus every key's length",
        # and a Uint8Array does not round-trip through it: it serialises as
        # {"0":12,"1":255,...}. Measured on this exact blob, that form costs
        # 4.53 MB against 425 KB as base64, and the two-key-space filter stored
        # that way would exceed the 10 MB quota outright and fail on Chrome 113
        # and earlier, where the quota was 5 MB. The wire format is the storage
        # format so that neither end can get this wrong.
        "bits": base64.b64encode(bytes(bits)).decode("ascii"),
    }


def member(blob: bytes, m: int, k: int, key: str) -> bool:
    """The reference implementation of the test the extension performs.

    Kept here so that extension/filter.js can be checked against it rather than
    trusted, and so a change to the hashing has one obvious other place to
    change. It is not called in the serving path.
    """
    return all((blob[b >> 3] >> (b & 7)) & 1 for b in _positions(key, m, k))


async def collect_keys() -> dict:
    """Every identifier the extension can match, by key space.

    Read straight from the stores rather than from a cache: this runs when a
    filter is built, which is once a day, and a stale filter is the one failure
    this design cannot report.
    """
    db = get_db()
    registry = db[FULL_REGISTRY_COLLECTION]

    owners: set[str] = set()
    agents: set[str] = set()
    async for d in registry.find({}, {"owner_address": 1, "chain_id": 1, "token_id": 1}):
        chain = d.get("chain_id")
        slug = SLUG_BY_CHAIN.get(chain)
        if slug is None:
            continue          # Solana, and anything ingested but not covered
        owner = d.get("owner_address")
        if isinstance(owner, str) and owner.startswith("0x"):
            owners.add(f"o:{owner.lower()}")
        token = d.get("token_id")
        if token is not None:
            # token_id is a STRING in full_agent_registry and an INTEGER in
            # known_agents. The 8004scan URL segment is a string. str() here
            # makes the key space agree with the URL, and the lookup that
            # follows converts back. A mismatch would be a silent empty result
            # rather than an error, which is the worst kind.
            agents.add(f"a:{slug}:{str(token)}")

    providers = {
        f"j:{p.lower()}"
        for p in await db.erc8183_job_index.distinct("provider")
        if isinstance(p, str) and p.startswith("0x")
    }

    hyperliquid: set[str] = set()
    try:
        from core.hyperliquid import service
        for row in service.all_known_addresses():
            hyperliquid.add(f"h:{row.lower()}")
    except Exception:  # noqa: BLE001
        # The Hyperliquid store being unreachable must not produce a filter
        # with its addresses silently missing, because that reads to the
        # extension as "we never measured this address" on a venue where we
        # have. Raise instead: a stale filter that is complete beats a fresh
        # one that quietly dropped a subject.
        raise

    return {
        "owners": owners,
        "agents": agents,
        "providers": providers,
        "hyperliquid": hyperliquid,
    }


_cache: dict | None = None
_cache_built_at: float = 0.0
# A day. The extension refreshes on the same period, so a shorter server cache
# would rebuild for nobody and a longer one would make `built_at` a lie.
_TTL_SECONDS = 24 * 3600


async def current(force: bool = False) -> dict:
    """The filter as served, cached for a day in this process."""
    global _cache, _cache_built_at
    if _cache is not None and not force and time.time() - _cache_built_at < _TTL_SECONDS:
        return _cache
    spaces = await collect_keys()
    keys = set().union(*spaces.values())
    blob = build_filter(keys)
    blob["built_at"] = time.time()
    blob["counts"] = {name: len(s) for name, s in spaces.items()}
    # A version a client can compare without downloading the body. The digest
    # is over the bits, so a rebuild that changes nothing produces the same
    # version and the extension keeps what it has.
    blob["version"] = hashlib.sha256(blob["bits"].encode()).hexdigest()[:16]
    _cache, _cache_built_at = blob, time.time()
    return blob
