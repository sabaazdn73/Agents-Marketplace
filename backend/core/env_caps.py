"""A positive integer limit read from the environment.

One copy, shared by every request-body cap in the process: the app-wide cap in
server.py, the MCP cap and the Telegram cap. They used to read their variables
through one function in mcp_server/router.py; it lives here now so server.py
does not have to import the MCP adapter to size a limit, and so there is no
second copy to drift.

Unset, empty, non-numeric, zero or negative all mean the default. A cap of
zero is never what an operator meant, and reading it literally would refuse
every request.
"""

from __future__ import annotations

import os


def cap_from_env(name: str, default: int) -> int:
    try:
        n = int(os.environ.get(name, "") or default)
    except ValueError:
        n = default
    return n if n > 0 else default
