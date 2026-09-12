"""
agents_index.py

A sliceable, filterable view over the served agent list.

WHY THIS EXISTS
---------------
`/api/agents` used to hold one pre-encoded 15.7MB body and stream it whole on
every request. It took no chain or limit parameter, so there was no way to ask
for less, and three components fetched it on page load. Every visitor pulled
the entire catalogue.

That is not only wasteful, it is the measured driver of the OOM rate.
docs/memory-ceiling.md records a natural experiment: when the payload
accidentally doubled from 14.8MB to 28.9MB, OOMs went from 0.40/hour to
3.00/hour, a 7.5x rise from a 2x payload. Response size is a binding
constraint, not a rounding error.

The per-request cost is real even though the body was a single shared bytes
object. asyncio's transport copies whatever it cannot write immediately into a
per-connection buffer, so a slow client pins its own copy. Ten slow clients
pinned ten copies.

WHAT REPLACED IT
----------------
One pre-encoded blob per agent, plus compact parallel arrays for the fields
worth filtering and sorting on. A page is a join of 24 small blobs. Filtering
never decodes anything.

The single large body is deliberately NOT kept alongside this. Holding both
would roughly double resident memory, which on a 512Mi cap is exactly the
trade this module exists to avoid. The legacy whole-catalogue response is
served by streaming the blobs in chunks instead, which is strictly better than
what it replaced: no single 15.7MB write for the transport to buffer.

WHAT IT COSTS
-------------
Measured on the live 15,000-agent payload: the per-agent blobs carry the same
bytes as the old body plus roughly 1MB of per-object overhead, and the index
arrays add about 3.5MB, most of it the lowercase search haystack. Under 5MB
resident against a 15.7MB saving on every single request.
"""

from __future__ import annotations

import json
from typing import Any, Iterable

from fastapi.encoders import jsonable_encoder

# Page size. The caller may ask for less, never for more.
MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 24

# Verification tiers, ranked. Mirrors frontend/src/agentVerification.js, which
# is the definition of record. The order matters: a filter for "verified" means
# this rank or better, so these must stay in this relative order.
TIER_UNPROVEN = 0
TIER_RESPONDING = 1
TIER_CANARY_VERIFIED = 2
TIER_VERIFIED = 3

# Sort key -> the index array it reads. Named with the client's own sort keys
# (AgentMarketplaceApp's sortState.key) so there is no translation table in
# between to drift.
_SORTS = {
    "totalScore": "score",
    "hireCount": "hires",
    "winRate": "win_rate",
    "starCount": "stars",
    "totalFeedbacks": "feedbacks",
    "name": "name_lc",
}
DEFAULT_SORT = "totalScore"


def _encode_one(record: dict) -> bytes:
    """One agent, encoded exactly as FastAPI would have encoded it.

    jsonable_encoder first for the same reason the old whole-list encoder used
    it: these records come from Mongo and can carry datetime/Decimal values
    that plain json.dumps rejects. Separators match JSONResponse so the bytes
    on the wire are identical to what this endpoint served before, rather than
    merely equivalent."""
    return json.dumps(
        jsonable_encoder(record), ensure_ascii=False, allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")


def _tier(record: dict, perf: dict | None, canary: dict | None) -> int:
    """Verification tier for one agent, joined server-side.

    The client used to compute this after merging two other fetches. It is done
    here because the filter has to be applied before the page is cut: filtering
    a page the client already received gives the wrong page, not a slower one.

    Both joins are by owner address, which is how both source endpoints key
    their data."""
    owner = (record.get("owner_address") or "").lower()
    p = (perf or {}).get(owner) or {}
    if (p.get("completed") or 0) + (p.get("submitted") or 0) > 0:
        return TIER_VERIFIED
    c = (canary or {}).get(owner) or {}
    if (c.get("delivered") or 0) > 0:
        return TIER_CANARY_VERIFIED
    if record.get("service_status") == "responding":
        return TIER_RESPONDING
    return TIER_UNPROVEN


def split_array(body: bytes) -> list[bytes]:
    """Split an encoded JSON array into its top-level object byte slices.

    Needed because the hourly refresh runs in a subprocess (see
    scripts/refresh_subprocess.py) and hands back an already-encoded body. The
    obvious move, json.loads on the whole thing, would rebuild the 54MB of
    dicts in the parent that the subprocess exists to keep out of it.

    So the array is cut on brace depth instead, tracking string state so that a
    brace or bracket inside a description cannot be mistaken for structure.
    Each slice is then parsed on its own, one small dict at a time, which is
    what keeps the peak flat.

    Returns the raw slices, which become the blobs verbatim: no re-encoding, so
    the bytes on the wire stay byte-identical to what the subprocess produced."""
    out: list[bytes] = []
    depth = 0
    start = -1
    in_str = False
    escape = False
    for i, ch in enumerate(body):
        if escape:
            escape = False
            continue
        if in_str:
            if ch == 0x5C:        # backslash
                escape = True
            elif ch == 0x22:      # closing quote
                in_str = False
            continue
        if ch == 0x22:            # opening quote
            in_str = True
        elif ch == 0x7B:          # {
            if depth == 0:
                start = i
            depth += 1
        elif ch == 0x7D:          # }
            depth -= 1
            if depth == 0 and start >= 0:
                out.append(body[start:i + 1])
                start = -1
    return out


class AgentsIndex:
    """Built once per cache fill, read by every request. Treat as immutable."""

    __slots__ = (
        "blobs", "cat", "status", "chain", "score", "name_lc", "hay",
        "tier", "hires", "win_rate", "feedbacks", "stars", "count", "ids",
    )

    @classmethod
    def from_encoded(cls, body: bytes, perf: dict | None = None,
                     canary: dict | None = None) -> "AgentsIndex":
        """Build from an already-encoded array, as the subprocess refresh
        returns. Parses one object at a time and keeps none of them."""
        blobs = split_array(body or b"[]")
        return cls([], perf, canary, _blobs=blobs)

    def __init__(self, records: list[dict], perf: dict | None = None,
                 canary: dict | None = None, *,
                 _blobs: list[bytes] | None = None) -> None:
        # Two build paths, one body of indexing logic. Either the records are
        # already in hand (cold boot, which reads Mongo directly) or only their
        # encoded bytes are (the hourly subprocess refresh).
        if _blobs is not None:
            records = None
            n = len(_blobs)
        else:
            n = len(records or [])
        self.blobs: list[bytes] = [b""] * n
        self.cat: list[str] = [""] * n
        self.status: list[str] = [""] * n
        self.chain: list[int] = [0] * n
        self.score: list[float] = [0.0] * n
        self.name_lc: list[str] = [""] * n
        self.hay: list[str] = [""] * n
        self.tier: list[int] = [0] * n
        self.hires: list[int] = [0] * n
        # -1.0 rather than 0.0 for "no history": a real 0% win rate and an
        # absent one must not sort together, which is the same distinction
        # agentRanking.js draws by keeping winRate null.
        self.win_rate: list[float] = [-1.0] * n
        self.feedbacks: list[int] = [0] * n
        self.stars: list[int] = [0] * n
        # id and token_id, lowercased, for the ?agent= deep link. A shared
        # link has to resolve to one agent whether or not that agent happens
        # to be on the page the grid is showing, which is exactly what stopped
        # being true once the client no longer held the whole catalogue.
        self.ids: dict[str, int] = {}
        self.count = n

        # Interning the repeated short strings matters more than it looks:
        # there are 15,000 agents over a few dozen categories and four service
        # statuses, so without this the same handful of values is stored
        # thousands of times over.
        pool: dict[str, str] = {}

        def intern(v: Any) -> str:
            s = "" if v is None else str(v)
            got = pool.get(s)
            if got is None:
                pool[s] = s
                got = s
            return got

        if _blobs is not None:
            # Parse each slice, read what the index needs, drop the dict. The
            # slice itself becomes the blob unchanged.
            def _pairs():
                for i, b in enumerate(_blobs):
                    self.blobs[i] = b
                    try:
                        yield i, json.loads(b)
                    except ValueError:
                        yield i, {}
        else:
            def _pairs():
                for i, r in enumerate(records or []):
                    self.blobs[i] = _encode_one(r)
                    yield i, r

        for i, r in _pairs():
            self.cat[i] = intern(r.get("category") or "Unclassified")
            self.status[i] = intern(r.get("service_status") or "")
            try:
                self.chain[i] = int(r.get("chain_id") or 0)
            except (TypeError, ValueError):
                self.chain[i] = 0
            try:
                self.score[i] = float(r.get("total_score") or 0)
            except (TypeError, ValueError):
                self.score[i] = 0.0
            name = (r.get("name") or "").strip()
            self.name_lc[i] = name.lower()
            # Name and description together, lowercased once at build time.
            # The client's search filtered on `name + strategy`, and strategy
            # is the description, so this preserves exactly what was
            # searchable rather than narrowing it to names.
            self.hay[i] = (name + " " + (r.get("description") or "")).lower()
            self.tier[i] = _tier(r, perf, canary)
            owner = (r.get("owner_address") or "").lower()
            p = (perf or {}).get(owner) or {}
            # `hire_count` is the field agentRanking.js reads for the
            # "Most hired" sort. Naming it anything else here would silently
            # sort by zeros.
            self.hires[i] = int(p.get("hire_count") or 0)
            wr = p.get("win_rate")
            if wr is not None:
                try:
                    self.win_rate[i] = float(wr)
                except (TypeError, ValueError):
                    pass
            try:
                self.feedbacks[i] = int(r.get("total_feedbacks") or 0)
            except (TypeError, ValueError):
                self.feedbacks[i] = 0
            try:
                self.stars[i] = int(r.get("star_count") or 0)
            except (TypeError, ValueError):
                self.stars[i] = 0
            # First writer wins, so a duplicate token_id cannot displace the
            # agent an existing link already resolved to.
            for key in (r.get("id"), r.get("token_id")):
                if key not in (None, ""):
                    self.ids.setdefault(str(key).lower(), i)

    # ───────────────────────── filtering ─────────────────────────

    def select(
        self,
        *,
        category: str | None = None,
        categories: Iterable[str] | None = None,
        chain_id: int | None = None,
        search: str | None = None,
        status: str | None = None,
        min_tier: int | None = None,
        include_unclassified: bool = True,
        require_real_name: bool = True,
    ) -> list[int]:
        """Indices matching the filters, in build order.

        Returns indices rather than records so nothing is decoded or copied
        until a page has actually been cut."""
        cats = None
        if categories is not None:
            cats = {c for c in categories if c}
        q = (search or "").strip().lower()
        idx: list[int] = []
        for i in range(self.count):
            # Mirrors the client's own hasRealContent, which dropped agents
            # whose name is absent or under three characters.
            if require_real_name and len(self.name_lc[i]) <= 2:
                continue
            c = self.cat[i]
            if not include_unclassified and c == "Unclassified":
                continue
            if category is not None and c != category:
                continue
            if cats is not None and c not in cats:
                continue
            if chain_id is not None and self.chain[i] != chain_id:
                continue
            if status is not None and self.status[i] != status:
                continue
            if min_tier is not None and self.tier[i] < min_tier:
                continue
            if q and q not in self.hay[i]:
                continue
            idx.append(i)
        return idx

    def sort(self, idx: list[int], key: str | None,
             direction: str | None = None) -> list[int]:
        """Sort selected indices, verification tier first.

        Tier leading every sort is not an embellishment, it is the grid's
        stated rule: a confirmed delivery outranks any other criterion, so a
        verified agent is never buried behind an unproven one that happens to
        score higher. Each sort key then orders within its tier. This mirrors
        withVerificationTierFirst in agentRanking.js, which is where the rule
        was enforced while the client still had every agent to sort.

        An unknown key falls back to the default rather than erroring, so a
        stale client cannot break the grid."""
        name = _SORTS.get(key or DEFAULT_SORT) or _SORTS[DEFAULT_SORT]
        arr = getattr(self, name)
        tier = self.tier
        if name == "name_lc":
            # The only text sort, and the only one whose natural direction is
            # ascending.
            asc = (direction or "asc") != "desc"
            return sorted(idx, key=lambda i: (-tier[i], arr[i]), reverse=not asc)
        desc = (direction or "desc") != "asc"
        if desc:
            return sorted(idx, key=lambda i: (tier[i], arr[i]), reverse=True)
        # Ascending within tier, but tier still leads and still descends.
        return sorted(idx, key=lambda i: (-tier[i], arr[i]))

    def page_bytes(self, idx: list[int], offset: int, limit: int) -> list[bytes]:
        """The blobs for one page. This is the only place blobs are touched."""
        return [self.blobs[i] for i in idx[offset:offset + limit]]

    def facets(self, idx: list[int]) -> list[dict]:
        """Category counts over a selection, biggest first.

        This is what replaced the globe's reason for downloading everything: it
        mapped 15,000 records down to `{category}` and counted them, which is
        this, computed here for about a kilobyte."""
        counts: dict[str, int] = {}
        for i in idx:
            c = self.cat[i]
            counts[c] = counts.get(c, 0) + 1
        return [{"category": k, "count": v}
                for k, v in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]

    def feedback_total(self, idx: list[int]) -> int:
        """Sum of on-chain feedback entries over a selection.

        One of the three marketplace stat cards, which the grid used to get by
        reducing over the whole array it had been sent."""
        return sum(self.feedbacks[i] for i in idx)

    def tier_counts(self, idx: list[int]) -> dict[str, int]:
        """The stat-card numbers, which the client used to derive by filtering
        the whole array it had been sent."""
        out = {"verified": 0, "canary_verified": 0, "responding": 0, "unproven": 0}
        names = {TIER_VERIFIED: "verified", TIER_CANARY_VERIFIED: "canary_verified",
                 TIER_RESPONDING: "responding", TIER_UNPROVEN: "unproven"}
        for i in idx:
            out[names[self.tier[i]]] += 1
        return out


def clamp_limit(limit: int | None) -> int:
    """Page size is ours. Asking for more than the cap returns the cap rather
    than an error, for the same reason the public API does it that way."""
    if not limit:
        return DEFAULT_PAGE_SIZE
    try:
        return max(1, min(int(limit), MAX_PAGE_SIZE))
    except (TypeError, ValueError):
        return DEFAULT_PAGE_SIZE


def join_page(blobs: list[bytes]) -> bytes:
    """A JSON array from pre-encoded objects, without re-encoding them."""
    return b"[" + b",".join(blobs) + b"]"


def stream_all(blobs: list[bytes], chunk: int = 500) -> Iterable[bytes]:
    """The whole array, yielded in chunks.

    Used only by the legacy unparameterised call. Chunking is the point: the
    old code handed the transport one 15.7MB write, and whatever could not be
    flushed immediately was copied into a per-connection buffer. Yielding
    roughly 500KB at a time keeps that buffer small even for a slow client."""
    yield b"["
    first = True
    for i in range(0, len(blobs), chunk):
        part = blobs[i:i + chunk]
        yield (b"," if not first else b"") + b",".join(part)
        first = False
    yield b"]"
