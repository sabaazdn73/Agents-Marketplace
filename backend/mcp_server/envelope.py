"""The response envelope, and the byte ceiling that every tool passes through.

WHY THE ENVELOPE IS FIXED
-------------------------
A person reading the site sees a caveat printed beside a number. A model sees
only what the response carries. So every tool returns the same shape, and the
fields are in this order on purpose:

    measured         what this is, in words
    coverage         the denominator, the window, and whether it is partial
    as_of            when the data was measured, or null when the dataset
                     has no measurement time (see below)
    served_at        when this call was answered
    value            the answer, or null
    withheld_reason  why there is no answer, machine readable
    caveats          what a reader has to know to use the number
    next_cursor      more, if there is more

Coverage precedes value in field order as well as in principle. A reader that
truncates a long response sees the denominator rather than only the number.

AS_OF IS THE MEASUREMENT, SERVED_AT IS THE CALL
------------------------------------------------
as_of used to be stamped with the time of the call whenever a tool did not
pass one, which was every tool. A reader told to cite when a figure was
measured cited the moment it asked, so a WebSocket series that stopped days
earlier read as current. Now as_of is only ever a time the data carries: a
collector's last poll, an indexer's last run, a series' last bucket. Where a
dataset has none, as_of is null and the dataset says why, rather than the
call time standing in for it. The call time is served_at, under its own name.

WHY THE CEILING LIVES HERE
--------------------------
docs/memory-ceiling.md: the whole agents payload is 15,748,096 bytes, a page of
24 is 27,776, and the container is OOM killed roughly every two hours as it
stands. Ten concurrent callers of the large shape exceeded the headroom that
exists 90% of the time, and a model in a loop is a more likely ten concurrent
callers than ten people ever were.

Enforcing that per tool would mean every new dataset could opt out of it by
forgetting. It is enforced here instead, on the way out, so a dataset added in
six months is bounded by construction rather than by care.
"""

from __future__ import annotations

import datetime as dt
import json
from typing import Any, Callable

from core.json_encoding import json_default

# Per tool, in bytes of encoded JSON. The basis for each is in mcp/DESIGN.md
# section 3; the short version is that they are derived from measured record
# sizes rather than chosen.
CEILINGS = {
    # 16KB, not 8KB. The catalogue went over 8KB once the per-dataset caveats
    # rode along in every row, and was cut to 4 of 6 rows in production: the
    # one call meant to say what exists said less than what exists. The
    # caveats now travel with get, list and summary only, and the ceiling has
    # room for a coverage block that grows with the datasets behind it.
    "tnega_catalogue": 16_384,
    "tnega_resolve": 2_048,
    "tnega_get": 8_192,
    "tnega_list": 32_768,
    "tnega_summary": 8_192,
    "tnega_series": 16_384,
}
DEFAULT_CEILING = 8_192


# One encoder rule for both transports, in core/json_encoding.py. This module
# had its own shorter version, without a Decimal branch, and that is how a
# Hyperliquid rejection rate went out over MCP as a string while the REST path
# served the same field as a number.
_default = json_default


def encode(payload: dict) -> str:
    """Compact JSON. Separators matter here: a model pays for whitespace."""
    return json.dumps(payload, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":"), default=_default)


def encode_any(payload: Any) -> str:
    """The same writer, for the JSON-RPC frame around a tool result.

    The transport should not be the one place that cannot write a value the
    services produce. See protocol._tool_result for the 500 that established
    this.
    """
    return json.dumps(payload, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":"), default=_default)


class Envelope(dict):
    """An envelope that knows how to name the next page.

    A plain dict on the wire. The one extra it carries is `resume`, set by a
    tool that pages: given the rows actually kept, it returns the cursor for
    the row after the last of them. enforce_ceiling needs that when it trims,
    because the cursor a tool computed described the page it built, not the
    shorter page that fits, and a cursor that skips the trimmed rows loses
    them with nothing to say they were lost.
    """
    resume: Callable[[list], str | None] | None = None


def _now() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


def build(*, measured: str, coverage: dict, value: Any = None,
          as_of: str | None = None, withheld_reason: str | None = None,
          caveats: list[str] | None = None,
          next_cursor: str | None = None,
          resume: Callable[[list], str | None] | None = None) -> dict:
    """One envelope. `coverage` is required and has no default.

    A dataset that cannot say what its number was computed over does not get to
    return a number, which is the site's rule moved to the point of entry
    rather than the point of display.

    `as_of` has no default either, on purpose. It is when the data was
    measured, and only the dataset knows that. A null here is honest; the call
    time standing in for it was not.
    """
    if not isinstance(coverage, dict):
        raise ValueError("coverage is required and must be a dict")
    out = Envelope({
        "measured": measured,
        "coverage": coverage,
        "as_of": as_of,
        "served_at": _now(),
        "value": value,
        "withheld_reason": withheld_reason,
        "caveats": list(caveats or []),
        "next_cursor": next_cursor,
    })
    out.resume = resume
    return out


def withheld(*, measured: str, coverage: dict, reason: str,
             explanation: str, as_of: str | None = None) -> dict:
    """No number, and the reason instead.

    Never a zero. A zero and an absence are different facts and a model cannot
    tell them apart once they are the same character.
    """
    return build(measured=measured, coverage=coverage, value=None, as_of=as_of,
                 withheld_reason=reason, caveats=[explanation])


# The field a dropped row is named by, in the order they are tried. Used only
# when a trimmed list has no cursor, so the reader is told which rows it did
# not get rather than only how many.
_ROW_NAMES = ("id", "dataset", "address", "job_id", "key", "t")
_MAX_NAMED = 20


def _row_name(row: Any) -> str:
    if isinstance(row, dict):
        for k in _ROW_NAMES:
            if row.get(k) not in (None, ""):
                return str(row[k])
    return json.dumps(row, default=_default)[:40]


def _size(payload: dict) -> int:
    return len(encode(payload).encode("utf-8"))


# Coverage fields that count the rows in this response. A trim changes the
# response, so these change with it: a page that says returned 50 over 15
# rows is a count the reader cannot reconcile with what it holds.
_COUNT_FIELDS = ("returned", "points", "buckets_returned")


# What a reader can do about a row skipped as too large, per tool. A series
# point has no record of its own to fetch, so pointing a reader at tnega_get
# for one sent it to a tool that could not answer.
_SKIP_ADVICE = {
    "tnega_list": "Read it in full with tnega_get using its id.",
    "tnega_series": "A single point cannot be read any other way; the series "
                    "around it is unaffected.",
}


def _trimmed(payload: dict, value: list, kept: list, limit: int,
             skipped: list | None = None, tool: str = "") -> dict:
    """The page that fits, with everything the trim changed said out loud.

    partial goes true, because a trimmed page is an incomplete answer by the
    surface's own definition, and a reader that trusts partial false would
    take the shorter page as the whole selection. The cursor is recomputed
    from the rows kept. Where there is no cursor to give, the dropped rows are
    named, since "trimmed to 4 of 6" with no way to reach the other two is a
    count of what is missing and not a way to find it.
    """
    resume = getattr(payload, "resume", None)
    if skipped:
        # A row too large to send on its own. The cursor goes past it, so a
        # walk continues rather than asking for the same row forever.
        # resume returns None when the skipped row was the last one in the
        # selection, and then there is nothing after it to point at.
        cursor = resume(kept + skipped) if resume else None
        names = ", ".join(_row_name(r) for r in skipped)
        advice = _SKIP_ADVICE.get(tool, "")
        after = ("next_cursor continues after it." if cursor else
                 "It was the last row of the selection, so there is no "
                 "next_cursor.")
        note = " ".join(part for part in (
            f"Skipped {names}: that row alone does not fit under the "
            f"{limit} byte response ceiling.", advice, after) if part)
        coverage = {**(payload.get("coverage") or {}), "partial": True,
                    "trimmed_to": 0, "trimmed_from": len(value),
                    "skipped_as_too_large": [_row_name(r) for r in skipped]}
        for k in _COUNT_FIELDS:
            if k in coverage:
                coverage[k] = 0
        return {**payload, "coverage": coverage, "value": [],
                "caveats": list(payload.get("caveats") or []) + [note],
                "next_cursor": cursor}
    cursor = resume(kept) if resume else None
    dropped = value[len(kept):]
    if cursor:
        note = (f"Trimmed to {len(kept)} of {len(value)} rows to stay under "
                f"the {limit} byte response ceiling. next_cursor continues "
                f"from the first row not shown.")
    else:
        shown = [_row_name(r) for r in dropped[:_MAX_NAMED]]
        more = len(dropped) - len(shown)
        names = ", ".join(shown) + (f", and {more} more" if more else "")
        note = (f"Trimmed to {len(kept)} of {len(value)} rows to stay under "
                f"the {limit} byte response ceiling, with no cursor to reach "
                f"the rest. Not shown: {names}.")
    coverage = {**(payload.get("coverage") or {}), "partial": True,
                "trimmed_to": len(kept), "trimmed_from": len(value)}
    for k in _COUNT_FIELDS:
        if k in coverage:
            coverage[k] = len(kept)
    return {
        **payload,
        "coverage": coverage,
        "value": kept,
        "caveats": list(payload.get("caveats") or []) + [note],
        "next_cursor": cursor,
    }


def enforce_ceiling(tool: str, payload: dict) -> tuple[str, dict]:
    """Encode, and hold the response under the tool's ceiling.

    A list is trimmed from the tail and says so, because half a page with a
    cursor is useful and a refused page is not. Anything else that will not fit
    is refused rather than silently cut, since a truncated single record is a
    record with fields missing and no way for the reader to know which.

    The trimmed page is measured with its caveat, its coverage and its cursor
    already in it. The first version measured the rows alone and added the
    caveat afterwards, so a page trimmed to exactly the limit went out over it.
    """
    limit = CEILINGS.get(tool, DEFAULT_CEILING)
    body = encode(payload)
    if len(body.encode("utf-8")) <= limit:
        return body, payload

    value = payload.get("value")
    if isinstance(value, list) and value:
        # The largest prefix that fits, by bisection: a 200 point series is
        # eight encodes rather than up to two hundred.
        lo, hi, best = 1, len(value) - 1, None
        while lo <= hi:
            mid = (lo + hi) // 2
            candidate = _trimmed(payload, value, value[:mid], limit)
            if _size(candidate) <= limit:
                best, lo = candidate, mid + 1
            else:
                hi = mid - 1
        if best is not None:
            return encode(best), best
        # Not even the first row fits. With a cursor, skip it by name and
        # continue past it; without one there is no page to continue, so it
        # falls through to a refusal.
        if getattr(payload, "resume", None):
            skip = _trimmed(payload, value, [], limit, skipped=value[:1], tool=tool)
            if _size(skip) <= limit:
                return encode(skip), skip

    refused = build(
        measured=payload.get("measured", ""),
        coverage=payload.get("coverage", {}),
        value=None,
        as_of=payload.get("as_of"),
        withheld_reason="response_too_large",
        caveats=[f"This answer does not fit under the {limit} byte ceiling for "
                 f"{tool}. Narrow the request, or read one record at a time "
                 f"with tnega_get."],
    )
    return encode(refused), refused
