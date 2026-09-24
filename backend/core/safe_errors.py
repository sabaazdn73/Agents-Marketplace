"""
safe_errors.py

One-line, URL-free descriptions of a failed HTTP call, for text that leaves
the process: a response body, a cached value, a stored field, a log line.

Why this exists (2026-09-24). httpx builds an HTTPStatusError's message from
the full request URL, and several of this project's request URLs carry a
credential:

  - Etherscan's V2 API takes the key as an `apikey` query parameter
    (adapters/contract_verification.py).
  - Infura holds the key in the path, `https://<net>.infura.io/v3/<key>`
    (core/rpc.py, reached by every RPC caller through the automatic
    failover as well as by the status page's own backup probe).
  - The Graph's gateway holds the key in the path (adapters/thegraph.py).

Interpolating such an exception into a returned `reason` handed the
credential to the caller, and in two places cached it for re-serving.

What a caller still gets: the HTTP status code when the failure carried one,
because a 429 and a 500 are different facts and neither of them needs the URL
to be understood; otherwise the exception's class name, so a timeout still
reads as "ReadTimeout" rather than blank (httpx's timeout exceptions
stringify to the empty string).

Deliberately never included: the exception's own message, the request URL, and
the response body. Any of the three can carry a credential from the URL it was
built from, and none of them is needed to say that a call failed and roughly
why.
"""

from __future__ import annotations

import urllib.error


def describe(exc: BaseException) -> str:
    """A short description of a failed request, safe to publish.

    An exception carrying a response (httpx's HTTPStatusError, requests'
    HTTPError) or a urllib HTTPError becomes "HTTP 429". Anything else becomes its class name,
    "ReadTimeout", "ConnectError", "RuntimeError".
    """
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if isinstance(status, int):
        return f"HTTP {status}"
    # urllib's HTTPError carries the status as `.code` and no `.response`.
    # Matched by type rather than by attribute, because other exceptions have
    # a `.code` that is not an HTTP status.
    if isinstance(exc, urllib.error.HTTPError) and isinstance(exc.code, int):
        return f"HTTP {exc.code}"
    return type(exc).__name__
