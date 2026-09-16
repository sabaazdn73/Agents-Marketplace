"""The MCP adapter.

A second transport over the same service layer as the REST API, not a second
implementation of it. Design and reasoning: mcp/DESIGN.md at the repo root.

    envelope.py   the response shape every tool returns, and the byte ceiling
    registry.py   what is behind the tools, and how a dataset is added
    tools.py      the six tools and their descriptions
    protocol.py   JSON-RPC, and the one-call-at-a-time gate
    router.py     the mount point server.py includes
"""
