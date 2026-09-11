"""
cockroach.py

Connecting to CockroachDB Cloud from a deployed container, without weakening
TLS to do it.

THE PROBLEM, STATED PRECISELY
-----------------------------
`COCKROACH_DATABASE_URL` carries `sslmode=verify-full` and names no root
certificate. On a laptop that works, and the reason is easy to miss: libpq
looks for `~/.postgresql/root.crt` by default, finds it, and uses it silently.
Nothing in the connection string says so.

Render has no such file, and libpq does NOT fall back to the operating
system's trust store when one is absent. Verified, with HOME pointed at an
empty directory to reproduce the deployed environment exactly:

    sslmode=verify-full  ->  FAILED: root certificate file
                             ".../.postgresql/root.crt" does not exist
    sslmode=require      ->  connected

So the deployed backend would have failed on its first query, and the tempting
fix is the second line of that output.

WHY NOT sslmode=require
-----------------------
`require` encrypts the connection and verifies nothing. It does not check that
the certificate chains to a trusted CA, and it does not check that the
certificate matches the host asked for. Anything able to answer for that
hostname -- a poisoned DNS answer, a hijacked route, a compromised egress
proxy -- can present a self-signed certificate, and libpq will hand it this
cluster's password. For a database whose credentials are in the connection
string, that is the whole security boundary, so it is not a trade worth
making to save one line of configuration.

WHAT THE LOCAL FILE ACTUALLY CONTAINS
-------------------------------------
Worth checking before treating it as a secret to be shipped. It holds:

    ISRG Root X1
    ISRG Root X2

Those are Let's Encrypt's public root CAs. They are in every standard CA
bundle already. The file is not a cluster-specific private CA; it is a
convenience copy of public roots, which is why the fix below needs no file
transfer, no secret, and no Render Secret File.

THE FIX, AND WHY THIS ONE
-------------------------
Keep `verify-full` and point `sslrootcert` at a CA bundle that is guaranteed
to exist in the container. certifi ships as a pinned dependency of this app,
so its path is computable at runtime and cannot be missing.

Verified against the live cluster from an isolated HOME, which is the
deployed situation:

    verify-full + certifi bundle  ->  CONNECTED, CockroachDB CCL v26.2.6

`sslrootcert=system`, which asks libpq to use the OS trust store, is an
equally strong alternative and is what Cockroach's own documentation
suggests. It is not used here for one reason: it depends on the base image
carrying a populated CA store, which cannot be verified from a development
machine. certifi can. Swapping to `system` is a one-line change if the
container's trust store is ever preferred -- both give identical verification
strength, they differ only in where the roots come from and who updates them.

(`sslrootcert=system` fails on a Mac with Anaconda's OpenSSL, which resolves
"system" to an Anaconda `cert.pem` rather than the Keychain. That is a local
artefact and says nothing about Linux. It is recorded here so the next person
does not mistake it for a real incompatibility.)

BOTH SAFE OPTIONS FAIL CLOSED
-----------------------------
If the CA bundle is missing or the chain does not verify, the connection is
refused. It never silently downgrades to an unverified session. That property
is the reason `_require_verify_full` below raises instead of repairing a DSN
that asks for something weaker: a downgrade should be a deployment error a
person sees, not a default the code quietly applies.
"""

from __future__ import annotations

import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import certifi

ENV_VAR = "COCKROACH_DATABASE_URL"

# The only modes that verify the server's identity. `verify-ca` checks the
# chain but not the hostname, so it is not accepted either: with a public CA
# any valid certificate would satisfy it, which is most of the attack back.
_VERIFYING_MODES = ("verify-full",)


class InsecureDsn(ValueError):
    """Raised rather than silently repairing a DSN that asks for weak TLS."""


def _require_verify_full(mode: str | None) -> None:
    if mode is None:
        raise InsecureDsn(
            f"{ENV_VAR} has no sslmode. Set sslmode=verify-full; libpq's default "
            "does not verify the server and this connection carries a password."
        )
    if mode not in _VERIFYING_MODES:
        raise InsecureDsn(
            f"{ENV_VAR} has sslmode={mode!r}, which does not verify the server's "
            "identity. Set sslmode=verify-full. If this was set to work around a "
            "missing certificate file, see the module docstring: the fix is a CA "
            "bundle, not a weaker mode."
        )


def build_dsn(url: str | None = None, *, ca_bundle: str | None = None) -> str:
    """Return a DSN that verifies the server and needs no file from the host.

    Adds `sslrootcert` only when the caller has not already chosen one, so an
    operator who points at the OS trust store (`sslrootcert=system`) or at a
    mounted file keeps that choice.
    """
    raw = url or os.environ.get(ENV_VAR)
    if not raw:
        raise RuntimeError(f"{ENV_VAR} is not set.")

    parts = urlsplit(raw)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))

    _require_verify_full(query.get("sslmode"))

    query.setdefault("sslrootcert", ca_bundle or certifi.where())
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
    )


def connect(url: str | None = None, **kwargs):
    """Open one verified connection. psycopg is imported lazily so that
    importing this module costs nothing in processes that never touch the
    database."""
    import psycopg

    kwargs.setdefault("connect_timeout", 15)
    return psycopg.connect(build_dsn(url), **kwargs)


def describe() -> dict:
    """What the connection would do, for the status endpoint. Never returns
    the password, and never returns the DSN, which contains it."""
    parts = urlsplit(os.environ.get(ENV_VAR, ""))
    query = dict(parse_qsl(parts.query))
    return {
        "configured": bool(parts.hostname),
        "host": parts.hostname,
        "database": (parts.path or "").lstrip("/") or None,
        "sslmode": query.get("sslmode"),
        "sslrootcert": query.get("sslrootcert") or certifi.where(),
        "verifies_server": query.get("sslmode") in _VERIFYING_MODES,
    }
