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

from core.json_encoding import json_default

# Page size. The caller may ask for less, never for more.
MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 24

# Verification tiers, ranked. Mirrors frontend/src/agentVerification.js, which
# is the definition of record. The order matters: a filter for "verified" means
# this rank or better, so these must stay in this relative order.
#
# WHY THERE ARE FIVE OF THESE SINCE 2026-09-23, AND WHAT THE FIFTH FIXES
# There were four, and the bottom one carried two unrelated facts. Everything
# that was not responding fell into `unproven`, which the definition of record
# described as "no delivery, and either no endpoint or one that didn't answer".
# That sentence was untrue of 98.8% of the agents it covered. Measured that day
# on the served store: 14,165 of the 14,340 agents in the bucket had never been
# health-checked at all, against 4 whose endpoint did not answer and 2 with
# nothing registered. Store-wide the ratio was starker, 39,245 never checked of
# 39,999 held.
#
# So the published figure said "we looked and found nothing" about a population
# we had overwhelmingly never looked at. A direct probe of 520 of them, drawn at
# random and resolved outside this pipeline, found 517 answering on the first
# request and not one agent down: the bucket was not describing the agents, it
# was describing our own coverage.
#
# agent_health.py already models this correctly and says so in its own module
# docstring: `unknown` is our failure to resolve and conflating it with
# `not_responding` "would be a false negative against agents that are probably
# fine". That distinction was computed, stored, and then discarded here, at the
# one place the marketplace publishes a count of.
#
# The split follows the evidence rather than the wording:
#   TIER_UNPROVEN    we probed and found nothing to point to. not_responding
#                    (the endpoint did not answer) or no_endpoint (nothing is
#                    registered to answer). A finding about the agent.
#   TIER_UNCHECKED   we never established anything. No health state stored at
#                    all, or `unknown`, which is this pipeline's own resolution
#                    failure. An admission about us, and never evidence about
#                    the agent.
#
# Ranks are internal and are not persisted or served: only TIER_NAMES below
# crosses a boundary, and `record()` attaches the NAME. So renumbering here is
# safe, and the new tier is added at the bottom so that `min_tier` filtering,
# which only ever asks for TIER_VERIFIED or better, is unaffected.
TIER_UNCHECKED = 0
TIER_UNPROVEN = 1
TIER_RESPONDING = 2
TIER_CANARY_VERIFIED = 3
TIER_VERIFIED = 4

# The health states that count as having been probed, i.e. as producing a
# finding about the agent rather than about us. Kept beside the tiers because
# the split above is only as meaningful as this list is accurate, and because
# a new health state added to agent_health.py has to be classified here
# deliberately rather than falling into whichever bucket the default happens
# to be.
PROBED_STATUSES = ("responding", "not_responding", "no_endpoint")
UNESTABLISHED_STATUSES = ("", "unknown")

# The names these ranks carry outside this file. One table, because the page
# counts and the compact projection both name them and two tables would drift.
#
# These are ids, not labels, and they stay as they are: callers filter on the
# string "verified", the marketplace URL carries it, and the MCP datasets key
# on it. The label a person reads was changed on 2026-09-23 to "Buyer-funded,
# marked delivered", in frontend/src/agentVerification.js, which is the
# definition of record. What the id means in full: an address other than the
# owner funded an on-chain job, and the agent then marked it delivered, which
# is counted from SUBMITTED and so from before the dispute window closes.
#
# `unchecked` is new on 2026-09-23 and is additive: every id that existed
# before still exists and still means something a caller can filter on. What
# changed is that `unproven` no longer absorbs the agents nobody ever probed,
# so it is now much smaller and finally matches its own definition. A client
# reading `tiers.unproven` keeps working and starts getting the number that
# sentence always claimed to describe.
TIER_NAMES = {
    TIER_VERIFIED: "verified",
    TIER_CANARY_VERIFIED: "canary_verified",
    TIER_RESPONDING: "responding",
    TIER_UNPROVEN: "unproven",
    TIER_UNCHECKED: "unchecked",
}

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

    Separators match JSONResponse so the bytes on the wire are identical to
    what this endpoint served before, rather than merely equivalent. The
    default lives in core/json_encoding.py because the MCP transport needs the
    same one, and the two having their own was how a rate reached production as
    a string over one transport and a number over the other."""
    return json.dumps(
        record, ensure_ascii=False, allow_nan=False,
        separators=(",", ":"), default=json_default,
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
    # Delivery to somebody else, which is what the definition has always said
    # and what the count never checked.
    #
    # This read completed + submitted, so a provider that funded its own jobs
    # earned the same tier as one that was hired. The definition of record
    # (frontend/src/agentVerification.js) says "from a PAYING BUYER" and it
    # meant it: money returning to the address it left is not demand. Two
    # agents held the tier on self-funded work alone, one of them on 184 jobs,
    # and the marketplace's verified count went from 29 to 27 when this line
    # started checking. docs/verification-methodology.md records the change.
    #
    # `delivered_external` is computed in core/job_index.py. Its absence is
    # treated as no evidence rather than as evidence of none: an older or
    # partial payload cannot promote an agent by omission.
    if (p.get("delivered_external") or 0) > 0:
        return TIER_VERIFIED
    c = (canary or {}).get(owner) or {}
    if (c.get("delivered") or 0) > 0:
        return TIER_CANARY_VERIFIED
    # Health, which is the weakest evidence here and the only one that can be
    # absent rather than merely negative.
    #
    # The three-way split matters because the two failing cases are not the
    # same fact. `not_responding` and `no_endpoint` were learned about the
    # agent: we reached the question and the answer was nothing. An absent
    # status, or `unknown`, was learned about us: agent_health.py records
    # `unknown` when it could not resolve the agent's metadata at all, most
    # often because a shared public IPFS gateway refused us, and an absent
    # status means the health pass has simply never reached this agent.
    #
    # Collapsing those into one tier is what let a gateway rate-limiting us
    # read as agents having nothing to show. See the TIER_UNCHECKED comment.
    status = record.get("service_status") or ""
    if status == "responding":
        return TIER_RESPONDING
    if status in PROBED_STATUSES:
        return TIER_UNPROVEN
    return TIER_UNCHECKED


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

    def project(self, idx: list[int], offset: int, limit: int) -> list[dict]:
        """A page as compact rows rather than whole records.

        A record is about 1,157 bytes and most of it is description text. A row
        here is about 200. The difference is what makes a paged list safe to
        hand a model, which cannot see the size of a response until it has
        already paid for it: 25 rows is 5KB instead of 29KB, and reading one
        agent in full is a second, named call rather than a page that quietly
        got heavy.

        Added for the MCP adapter, which is the caller that needs it, and put
        here rather than there because the blobs and the tier ranks are here
        and a projection assembled anywhere else would be a second opinion
        about what an agent is."""
        out = []
        for i in idx[offset:offset + limit]:
            try:
                r = json.loads(self.blobs[i])
            except ValueError:
                r = {}
            out.append({
                "id": r.get("id") or r.get("token_id"),
                # Trimmed rather than dropped: a name is what the row is for,
                # and a long one is still recognisable at 80 characters.
                "name": (r.get("name") or "").strip()[:80],
                "chain_id": self.chain[i],
                "category": self.cat[i],
                "tier": TIER_NAMES[self.tier[i]],
                "score": round(self.score[i], 2),
            })
        return out

    def record(self, agent_id: str) -> dict | None:
        """One agent in full, by id or token id, with its tier attached.

        The tier is computed at build time from the performance and canary
        joins and is not a field of the stored record, so a caller reading the
        blob alone would see an agent with no verification state at all."""
        i = self.ids.get(str(agent_id).strip().lower())
        if i is None:
            return None
        try:
            r = json.loads(self.blobs[i])
        except ValueError:
            return None
        r["tier"] = TIER_NAMES[self.tier[i]]
        # The same category the index filtered and counted on, rather than the
        # raw stored value. A record said category null while the list said
        # Unclassified for the same agent, because the index interns an absent
        # category and the blob keeps it as null. Two answers to one question.
        r["category"] = self.cat[i]
        return r

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
        the whole array it had been sent.

        Carries an `unchecked` key since 2026-09-23. Every previous key is
        still present and still counts the same kind of thing; `unproven` is
        smaller because the agents nobody probed moved to their own name."""
        out = {name: 0 for name in TIER_NAMES.values()}
        for i in idx:
            out[TIER_NAMES[self.tier[i]]] += 1
        return out

    def liveness_coverage(self, idx: list[int]) -> dict:
        """Two rates, not one, because the finding is that two things were
        being conflated.

        WHY ONE RATIO CANNOT CARRY THIS
        A responding count over the size of the selection is a sentence about
        our coverage wearing the costume of a sentence about agents. But the
        obvious repair, reporting only the share of the agents we reached,
        publishes the flattering half on its own: it reads 98.9% and a reader
        concludes nothing is wrong, when what was wrong is that we reached so
        few. So both stages are reported and named for what they measure:

            response rate   responding / reached     did the agent answer
            reach rate      reached / attempted      did WE get to the agent

        A failure in the first is the agent's. A failure in the SECOND IS OURS:
        it means a health check ran and could not resolve the agent's metadata,
        almost always because a shared public IPFS gateway turned us away. On
        2026-09-23 the response rate was 550 of 556, which is 98.9% and looks
        like health, while the reach rate was 556 of 736, which is 75.5% and is
        where the whole incident lived. Publishing the first alone would have
        reported the opposite of what was found.

        THE THREE POPULATIONS, WHICH ARE NOT INTERCHANGEABLE
            selected        every agent in this selection
            attempted       a health check ran, whatever it concluded
            reached         it concluded something ABOUT THE AGENT, so one of
                            PROBED_STATUSES. `unknown` is excluded: it is this
                            pipeline failing to resolve, and putting it in a
                            denominator that purports to measure agents
                            reintroduces the conflation this split exists to
                            remove.

        BOTH TERMS OF BOTH RATES ARE service_status COUNTS
        None of these is tier_counts()["responding"] and they will not match
        it. The tier is assigned top-down, so an agent that was probed and
        answered but has also delivered a job is counted under `verified` and
        never reaches the responding tier: 554 answering against a responding
        tier of 533 in one pass on 2026-09-23. Dividing a tier count by a probe
        count would build a ratio from two populations and understate the
        response rate by systematically dropping the best agents. So every term
        here is read from self.status, in one pass over one selection, at one
        instant.

        THE WINDOW IS CUMULATIVE AND IS NAMED RATHER THAN IMPLIED
        `attempted` counts every agent with any health check on record, with no
        recency bound. That is a step function: it jumps when a health pass
        runs and drifts down as the store rotates, and on 2026-09-23 the same
        selection gave 430 within six hours, 729 within a day and 754 ever. A
        denominator that moves that much with an unstated window is not a
        denominator, so `window` names which one this is. A recent-window rate
        would have to bound on service_checked_at, which this index does not
        carry.

        EVERY FIGURE QUOTED ABOVE NAMES ITS SNAPSHOT, BECAUSE NONE OF THEM KEEPS
        The 550, 556 and 736 are one pass over the served window on 2026-09-23,
        and a later pass the same day gave 741 attempted over a selection of
        15,000. That is the store rotating rather than an error, but a
        documented figure the code will not reproduce tomorrow has to say which
        moment it came from, or it reads as a target being missed.
        """
        attempted = unresolved = reached = responding = 0
        for i in idx:
            st = self.status[i]
            if not st:
                continue
            attempted += 1
            if st == "unknown":
                unresolved += 1
            elif st in PROBED_STATUSES:
                reached += 1
                if st == "responding":
                    responding += 1
        total = len(idx)
        out = {
            "selected": total,
            "never_attempted": total - attempted,
            "attempted": attempted,
            "reached": reached,
            "unresolved": unresolved,
            "responding": responding,
            "measured": "service_status, every term, one pass over one selection",
            "window": "any_check_on_record",
            # None rather than 0 on an empty denominator: a rate over nothing
            # is not zero percent, it is not a rate.
            "response_rate_of_reached": (
                round(responding / reached, 4) if reached else None),
            "reach_rate_of_attempted": (
                round(reached / attempted, 4) if attempted else None),
            # Named here so a caller does not have to infer which way to read a
            # low value, which is the thing a bare pair of numbers gets wrong.
            "reach_failure_is_ours": True,
            "withheld_reason": None,
        }
        if total - attempted:
            # A code a caller can branch on, plus a sentence a person can read.
            # The code is the one core/extension/subject.py already emits on
            # exactly this predicate, so the same absence has one name across
            # the surfaces that report it rather than two spellings of one
            # judgment.
            out["withheld_reason"] = {
                "code": "health_not_checked",
                "detail": (
                    f"{total - attempted} of {total} agents in this selection "
                    f"have never been health-checked at all. No rate is "
                    f"published over them: an agent we never attempted is not "
                    f"an agent that failed to answer, and counting it as one "
                    f"would describe our coverage rather than the agents. Of "
                    f"the {attempted} we did attempt, we reached {reached} and "
                    f"{responding} of those answered; the {unresolved} we "
                    f"could not resolve are our own failure, not theirs."
                ),
            }
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
