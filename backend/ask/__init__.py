"""The on-site assistant: one question in, one answer out, with its evidence.

A consumer of the machine-facing surface rather than part of it. It runs a
bounded tool-calling loop over the six handlers in mcp_server/tools.py, in
process, and returns the answer together with the calls behind it.

    bounds.py     the caps, the gate, and what stops this being a free model
                  endpoint for anyone who finds it
    grounding.py  what the model is told, and the checks that do not depend on
                  it having obeyed
    loop.py       the loop itself, under a tool call budget and a wall clock
    router.py     POST /api/ask and GET /api/ask/readiness

It imports mcp_server/ and core/ and never server.py, so the dependency runs
one way: the transport composes this, and this never reaches back for it.
"""
