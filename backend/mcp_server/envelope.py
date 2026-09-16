"""The response envelope, and the byte ceiling that every tool passes through.

WHY THE ENVELOPE IS FIXED
-------------------------
A person reading the site sees a caveat printed beside a number. A model sees
only what the response carries. So every tool returns the same shape, and the
fields are in this order on purpose:

    measured         what this is, in words
    coverage         the denominator, the window, and whether it is partial
    as_of            when it was measured
    value            the answer, or null
    withheld_reason  why there is no answer, machine readable
    caveats          what a reader has to know to use the number
    next_cursor      more, if there is more

Coverage precedes value in field order as well as in principle. A reader that
truncates a long response sees the denominator rather than only the number.

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
from typing import Any

# Per tool, in bytes of encoded JSON. The basis for each is in mcp/DESIGN.md
# section 3; the short version is that they are derived from measured record
# sizes rather than chosen.
CEILINGS = {
    "tnega_catalogue": 8_192,
    "tnega_resolve": 2_048,
    "tnega_get": 8_192,
    "tnega_list": 32_768,
    "tnega_summary": 8_192,
    "tnega_series": 16_384,
}
DEFAULT_CEILING = 8_192


def _default(o: Any) -> Any:
    if isinstance(o, (dt.datetime, dt.date, dt.time)):
        return o.isoformat()
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    return str(o)


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


def build(*, measured: str, coverage: dict, value: Any = None,
          as_of: str | None = None, withheld_reason: str | None = None,
          caveats: list[str] | None = None,
          next_cursor: str | None = None) -> dict:
    """One envelope. `coverage` is required and has no default.

    A dataset that cannot say what its number was computed over does not get to
    return a number, which is the site's rule moved to the point of entry
    rather than the point of display.
    """
    if not isinstance(coverage, dict):
        raise ValueError("coverage is required and must be a dict")
    return {
        "measured": measured,
        "coverage": coverage,
        "as_of": as_of or dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "value": value,
        "withheld_reason": withheld_reason,
        "caveats": list(caveats or []),
        "next_cursor": next_cursor,
    }


def withheld(*, measured: str, coverage: dict, reason: str,
             explanation: str) -> dict:
    """No number, and the reason instead.

    Never a zero. A zero and an absence are different facts and a model cannot
    tell them apart once they are the same character.
    """
    return build(measured=measured, coverage=coverage, value=None,
                 withheld_reason=reason, caveats=[explanation])


def enforce_ceiling(tool: str, payload: dict) -> tuple[str, dict]:
    """Encode, and hold the response under the tool's ceiling.

    A list is trimmed from the tail and says so, because half a page with a
    cursor is useful and a refused page is not. Anything else that will not fit
    is refused rather than silently cut, since a truncated single record is a
    record with fields missing and no way for the reader to know which.
    """
    limit = CEILINGS.get(tool, DEFAULT_CEILING)
    body = encode(payload)
    if len(body.encode("utf-8")) <= limit:
        return body, payload

    value = payload.get("value")
    if isinstance(value, list) and value:
        kept = list(value)
        while kept and len(encode({**payload, "value": kept}).encode("utf-8")) > limit:
            kept.pop()
        if kept:
            trimmed = {
                **payload,
                "value": kept,
                "caveats": payload.get("caveats", []) + [
                    f"Trimmed to {len(kept)} of {len(value)} rows to stay under "
                    f"the {limit} byte response ceiling. Use next_cursor for the rest."
                ],
            }
            return encode(trimmed), trimmed

    refused = build(
        measured=payload.get("measured", ""),
        coverage=payload.get("coverage", {}),
        value=None,
        withheld_reason="response_too_large",
        caveats=[f"This answer does not fit under the {limit} byte ceiling for "
                 f"{tool}. Narrow the request, or read one record at a time "
                 f"with tnega_get."],
    )
    return encode(refused), refused
