"""What json.dumps cannot encode on its own, encoded once for every transport.

WHY THIS IS ITS OWN MODULE
--------------------------
It was not. agents_index.py had this for the REST path and mcp_server/envelope.py
had a shorter version of it for MCP, and the shorter one had no Decimal branch,
so a rate that Cockroach returns as a Decimal went out over MCP as the string
"0.9554368932038834951456310680" while the same field on the same measurement
went out over REST as the number 0.9554368932038834951456310680.

Caught on production rather than in review, which is the point: two encoders
that agree on the day they are written are two encoders that will disagree
later, and the disagreement is invisible until something downstream does
arithmetic on a string.

One rule, both transports. The types here are the ones that actually come out
of this project's stores: datetime and Decimal from Cockroach, ObjectId and
Decimal128 from Mongo, UUID from the agent records.

FIDELITY, AND THE ONE PLACE IT IS DELIBERATELY LOST
---------------------------------------------------
Decimal becomes float, which is what fastapi's jsonable_encoder did before this
and therefore what every existing REST consumer already receives. A float
cannot hold 28 significant digits, so the last of them are dropped. That is a
loss, and it is the right one here: the alternative is a JSON string, which
every consumer has to know to convert, and which reads as a number until
something tries to multiply it.

bson's Decimal128 keeps its string form instead, because it exists precisely
where the exact digits are the point, and because jsonable_encoder refused it
outright, so nothing downstream can be relying on a number there.
"""

from __future__ import annotations

import datetime as dt
import decimal
import uuid
from typing import Any


def json_default(o: Any) -> Any:
    if isinstance(o, (dt.datetime, dt.date, dt.time)):
        return o.isoformat()
    if isinstance(o, dt.timedelta):
        return o.total_seconds()
    if isinstance(o, decimal.Decimal):
        return float(o)
    if isinstance(o, uuid.UUID):
        return str(o)
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    if isinstance(o, bytes):
        return o.decode("utf-8", "replace")
    # Mongo's own types and anything else with a string form.
    #
    # One deliberate divergence from fastapi's jsonable_encoder, measured rather
    # than assumed: it RAISES ValueError on bson's ObjectId and Decimal128,
    # because it tries dict() then vars() and both fail on a slotted type. A
    # record carrying either used to take the endpoint down with a 500 instead
    # of serving. Here they encode as their string form.
    return str(o)
