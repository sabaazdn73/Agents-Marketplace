"""
publicapi

Tnega's public surface: a REST API and an MCP server over the same data.

THE ONE RULE THAT MAKES EVERYTHING ELSE CHEAP
---------------------------------------------
Nothing in here serialises an internal document. `schema.py` defines the public
shape by hand and `service.py` maps onto it. That is what makes an
additive-only contract affordable: a field rename in Mongo, a collection split,
a change to how a signal is computed, none of it can reach a caller by
accident, because nothing is passed through.

The cost, stated so nobody is surprised by it later: every field shipped here
is carried forever, including the ones that turn out to be wrong. A field may
be marked deprecated and must not be removed or retyped. If something ever
genuinely has to break, `v2` appears beside `v1` rather than replacing it.

LAYERS
------
    schema.py    the public shape, hand-written, versioned
    service.py   plain async functions, query in, schema out. No HTTP, no MCP.
    keys.py      issue, verify, revoke, and the tier each key carries
    limits.py    per-key and global rate limiting, and the memory breaker
    rest.py      the REST adapter
    mcp.py       the MCP adapter

REST and MCP are both thin. Neither holds logic, and anything either needs that
the other does not is a sign the service layer is wrong.

WHY THE SIGNALS ARE NOT IN LIST RESPONSES
-----------------------------------------
A full listing of the catalogue is 3,975 requests at 50 a page. The thirteen
evaluation signals, one detail call per agent, are 198,743. Keeping signals out
of list responses is therefore worth more than any rate limit: it is the
difference between copying the valuable part in four days and in two hundred.

Listings are cheap to copy and that is accepted. Most of what they carry is
readable from the chain anyway, so defending them would cost us and gain
nothing.
"""

API_VERSION = "v1"
