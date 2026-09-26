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

A JSON-RPC error is the one case where the class name says nothing
(2026-09-25). Every node answers "RuntimeError" for a rate limit, a range cap
and a pruned block alike, and those need different fixes. So a JsonRpcError
(or a RuntimeError raised with the error object itself) keeps its numeric
code and its message, and the message goes through redact() first.

Deliberately never included: the exception's own free-form message, the
request URL, and the response body. Any of the three can carry a credential
from the URL it was built from, and none of them is needed to say that a call
failed and roughly why.
"""

from __future__ import annotations

import os
import re
import urllib.error
from urllib.parse import urlsplit

# A node's error message is short when it is useful. Anything longer is
# usually an echoed request, which is exactly the text that can carry a URL.
_MAX_RPC_MESSAGE = 160

_URL_RE = re.compile(r"(?i)\b(?:https?|wss?)://[^\s\"'<>)\]]+")
# A run of 24 or more token characters that is not 0x-prefixed: an API key,
# a bearer token, a path secret. See _mask_token for which runs are masked.
# 0x-prefixed values (addresses, hashes) are never matched.
_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9_\-])(?!0x)[A-Za-z0-9_\-]{24,}")
_HEX64_RE = re.compile(r"[0-9a-fA-F]{64}")
_HEX40_RE = re.compile(r"[0-9a-fA-F]{40}")
# Whole values of these are secrets.
_SECRET_ENV_RE = re.compile(r"(KEY|SECRET|TOKEN|SALT|PASSWORD)$")
# Values of these are URLs: their host is public (bloXroute, the frontend's
# own address) and is left alone; their userinfo, path and query are not.
_URL_ENV_RE = re.compile(r"(URI|URLS?)$")
# URL settings whose path or query may hold a short key. Every non-trivial
# segment of these is redacted, however short, because a provider that
# echoes its key back does not echo it as a URL.
_KEYED_URL_ENVS = ("BSC_FALLBACK_RPC_URLS", "BSC_MAINNET_RPC_URL")
_QUICKNODE_HOST_RE = re.compile(r"(?i)^[a-z0-9-]+\.((?:[a-z0-9_-]+\.)?quiknode\.pro)$")
# A QuickNode host written without a scheme: its first label is the endpoint
# name. Only that label is replaced, and only in a *.quiknode.pro host.
_QUICKNODE_HOST_IN_TEXT = re.compile(
    r"(?i)(?<![A-Za-z0-9.<>-])[a-z0-9-]+\.((?:[a-z0-9_-]+\.)?quiknode\.pro)\b")


class JsonRpcError(RuntimeError):
    """A JSON-RPC `error` object, kept whole so describe() can report its
    code and a redacted message rather than a bare class name."""

    def __init__(self, error: object):
        super().__init__(error)
        self.error = error
        self.code = error.get("code") if isinstance(error, dict) else None
        msg = error.get("message") if isinstance(error, dict) else error
        self.rpc_message = "" if msg is None else str(msg)


def _url_secrets(value: str, keyed: bool) -> set[str]:
    out: set[str] = set()
    for one in value.split(","):
        one = one.strip()
        if "://" not in one:
            continue
        try:
            parts = urlsplit(one)
        except ValueError:
            continue
        for cred in (parts.username, parts.password):
            if cred and len(cred) >= 4:
                out.add(cred)
        for seg in re.split(r"[/?&=;:@,]", f"{parts.path}?{parts.query}"):
            if not seg:
                continue
            if len(seg) >= 12:
                out.add(seg)
            elif keyed and len(seg) >= 4 and not re.fullmatch(r"[a-z]+(?:[-_][a-z]+)*|v\d+", seg):
                # Short, but not a plain path word such as `rpc`, `public`,
                # `bsc-mainnet` or `v1`: treat it as a key. The limit, stated
                # exactly: a segment under 4 characters, or one made only of
                # lowercase letters (optionally joined by - or _), or `v`
                # followed by digits, is not treated as a key under 12
                # characters. From 12 characters every segment is.
                out.add(seg)
    return out


def _secret_values() -> list[str]:
    """Strings to remove from any text: the whole value of each
    credential-shaped setting, and the userinfo, path and query parts of each
    URL-shaped one. Longest first, so a longer secret goes before a shorter
    one inside it."""
    out: set[str] = set()
    for name, value in os.environ.items():
        if not value:
            continue
        up = name.upper()
        if _SECRET_ENV_RE.search(up) and len(value) >= 8:
            out.add(value)
        elif _URL_ENV_RE.search(up) or up in _KEYED_URL_ENVS:
            out |= _url_secrets(value, keyed=up in _KEYED_URL_ENVS)
    return sorted(out, key=len, reverse=True)


def _mask_token(m: re.Match) -> str:
    """Kept: digits only (an amount); a bare 64-hex hash (a transaction or
    block hash); words without digits that are not all capitals, such as
    `execution_reverted_by_the_contract_call`.
    Masked: a bare 40-hex run (the shape of a QuickNode token; an address
    arrives 0x-prefixed and is never matched); an all-capitals run; anything
    mixing letters and digits."""
    run = m.group(0)
    if run.isdigit():
        return run
    if _HEX64_RE.fullmatch(run):
        return run
    if _HEX40_RE.fullmatch(run):
        return "[redacted]"
    has_upper = re.search(r"[A-Z]", run) is not None
    has_lower = re.search(r"[a-z]", run) is not None
    if has_upper and not has_lower:
        return "[redacted]"
    if (has_upper or has_lower) and re.search(r"\d", run):
        return "[redacted]"
    return run


def redact(text: object, max_len: int = _MAX_RPC_MESSAGE) -> str:
    """Text that may have come from a remote endpoint, safe for a log line
    or a published reason:

      - every URL cut to scheme and host, and a QuickNode host, in a URL or
        written bare, shown as `<endpoint>.<network>.quiknode.pro`;
      - every configured secret, and every path, query or userinfo part of a
        configured URL, removed;
      - long runs mixing letters and digits masked, other than bare hex
        addresses and hashes."""
    s = "" if text is None else str(text)

    def _host_only(m: re.Match) -> str:
        try:
            p = urlsplit(m.group(0))
            host = p.hostname or "?"
        except ValueError:
            return "[url]"
        qn = _QUICKNODE_HOST_RE.match(host)
        if qn:
            host = f"<endpoint>.{qn.group(1)}"
        return f"{p.scheme}://{host}/..."

    # URLs first, whole, so a key in a path or query goes with its URL.
    s = _URL_RE.sub(_host_only, s)
    for secret in _secret_values():
        if secret in s:
            s = s.replace(secret, "[redacted]")
    s = _QUICKNODE_HOST_IN_TEXT.sub(lambda m: f"<endpoint>.{m.group(1)}", s)
    s = _TOKEN_RE.sub(_mask_token, s)
    s = " ".join(s.split())
    if len(s) > max_len:
        s = s[:max_len] + "..."
    return s


def _rpc_error_of(exc: BaseException) -> tuple[object, str] | None:
    if isinstance(exc, JsonRpcError):
        return exc.code, exc.rpc_message
    if isinstance(exc, RuntimeError) and len(exc.args) == 1 and isinstance(exc.args[0], dict):
        err = exc.args[0]
        if "code" in err or "message" in err:
            return err.get("code"), str(err.get("message") or "")
    return None


def _rpc_error_in_response(response: object) -> tuple[object, str] | None:
    """A JSON-RPC error object in a non-2xx response body, if there is one.
    publicnode, for one, answers 403 with {"error": {"code": -32602, ...}},
    and the code and message are the useful part."""
    try:
        content = getattr(response, "content", b"") or b""
        if not content or len(content) > 4096:
            return None
        body = response.json()
    except Exception:  # noqa: BLE001 -- no JSON body, no detail
        return None
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict) and ("code" in err or "message" in err):
        return err.get("code"), str(err.get("message") or "")
    return None


def _format_rpc(code: object, message: str) -> str:
    if isinstance(code, int) and not isinstance(code, bool):
        code_s = str(code)
    elif isinstance(code, str) and code.strip():
        code_s = redact(code, 40) or "?"
    else:
        # None, a bool, a float, an object: not a code anyone documents.
        code_s = "?"
    message = redact(message)
    return f"JSON-RPC {code_s}: {message}" if message else f"JSON-RPC {code_s}"


def describe(exc: BaseException) -> str:
    """A short description of a failed request, safe to publish.

    An exception carrying a response (httpx's HTTPStatusError, requests'
    HTTPError) or a urllib HTTPError becomes "HTTP 429", followed by the
    JSON-RPC code and message when the body carries one ("HTTP 403, JSON-RPC
    -32602: ..."). A JSON-RPC error becomes "JSON-RPC -32005: <message>",
    the message redacted, and a string code is printed as it is. Anything else
    becomes its class name, "ReadTimeout", "ConnectError", "RuntimeError".
    """
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    if isinstance(status, int):
        rpc = _rpc_error_in_response(response)
        return f"HTTP {status}, {_format_rpc(*rpc)}" if rpc else f"HTTP {status}"
    # urllib's HTTPError carries the status as `.code` and no `.response`.
    # Matched by type rather than by attribute, because other exceptions have
    # a `.code` that is not an HTTP status.
    if isinstance(exc, urllib.error.HTTPError) and isinstance(exc.code, int):
        return f"HTTP {exc.code}"
    rpc = _rpc_error_of(exc)
    if rpc is not None:
        return _format_rpc(*rpc)
    return type(exc).__name__
