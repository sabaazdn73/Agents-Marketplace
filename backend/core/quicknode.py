"""
quicknode.py

The QuickNode multichain endpoint, per chain, with its token kept out of
every URL.

Configuration (both must be set, or QuickNode is not used at all):

  QUICKNODE_ENDPOINT  the endpoint's host, with no token. Either the bare
                      endpoint name or any of its hosts is accepted, e.g.
                      `my-name.quiknode.pro` or `my-name.bsc.quiknode.pro`.
                      A path, if one is given, is dropped: on QuickNode the
                      path is where a token goes, and the token belongs in
                      QUICKNODE_TOKEN.
  QUICKNODE_TOKEN     sent only as the `x-token` request header.

URL shape, from QuickNode's multichain guide (read 2026-09-25,
guides/quicknode-products/how-to-use-multichain-endpoint): one endpoint name,
one subdomain per chain, `https://{name}.{network}.quiknode.pro/{token}`,
with Ethereum mainnet the exception at `https://{name}.quiknode.pro/`. The
guide's table gives `bsc` for BNB Chain mainnet and `base-mainnet` for Base,
and tells the reader to confirm each network's form on the dashboard.

The per-chain endpoint-security pages use a different host in their
examples: `your-endpoint-name.bnb_smart_chain.quiknode.pro` and
`your-endpoint-name.ethereum.quiknode.pro`. `bsc` is kept for BSC because it
is the guide's explicit mapping, and because on 2026-09-26 a name under
`.bsc.quiknode.pro` resolved to its own address (64.130.41.79), as did
`.base-mainnet.` and `.arbitrum-mainnet.`, while `.bnb_smart_chain.`,
`.ethereum.` and the bare `.quiknode.pro` all resolved to one shared address
(141.147.108.150), which reads as a catch-all rather than a BSC ingress.
Neither is proof; the dashboard's URL for the endpoint is. Ethereum mainnet
is left unmapped: the guide says it has no subdomain, the security page
shows `ethereum`, and nothing here reads Ethereum through QuickNode yet.

On the header. QuickNode documents `x-token` for HTTP JSON-RPC on both the
BNB Smart Chain and Ethereum endpoint-security pages
(docs/bnb-smart-chain/endpoint-security and docs/ethereum/endpoint-security,
read 2026-09-26): "Alternatively, you can pass x-token in the Header of the
request", with a curl POST example of a JSON-RPC call. The token therefore
never has to be in a URL, so it never reaches a log line or an exception
message. The header is attached only to the exact host built from
QUICKNODE_ENDPOINT for a mapped chain, never to any other *.quiknode.pro URL.

Nothing here logs or returns the token, and the endpoint name is shown as
`<endpoint>` whenever a host is printed.
"""

from __future__ import annotations

import os
from urllib.parse import urlsplit

PROVIDER = "quicknode"

# From the multichain guide's own table. Ethereum mainnet (1) is left out on
# purpose; see the module note.
_NETWORK_SUBDOMAIN = {
    56: "bsc",
    8453: "base-mainnet",
}

_HOST_SUFFIX = ".quiknode.pro"


def _endpoint_name() -> str | None:
    raw = (os.environ.get("QUICKNODE_ENDPOINT") or "").strip()
    if not raw:
        return None
    host = urlsplit(raw if "://" in raw else f"https://{raw}").hostname or ""
    if not host:
        return None
    if host.endswith(_HOST_SUFFIX):
        return host.split(".", 1)[0] or None
    if "." not in host:
        return host
    # Some other host: not a QuickNode endpoint this module knows how to
    # address per chain.
    return None


def configured() -> bool:
    return bool(_endpoint_name() and os.environ.get("QUICKNODE_TOKEN"))


def _host_for(chain_id: int) -> str | None:
    if not configured() or chain_id not in _NETWORK_SUBDOMAIN:
        return None
    return f"{_endpoint_name()}.{_NETWORK_SUBDOMAIN[chain_id]}{_HOST_SUFFIX}"


def url_for(chain_id: int) -> str | None:
    """The chain's URL on the multichain endpoint, with no token in it, or
    None when QuickNode is not configured or the chain is not mapped."""
    host = _host_for(chain_id)
    return f"https://{host}/" if host else None


def _url_host(url: str | None) -> str:
    try:
        return (urlsplit(url or "").hostname or "").lower()
    except ValueError:
        return ""


def is_configured_host(url: str | None) -> bool:
    """True only for the exact host built from QUICKNODE_ENDPOINT for a mapped
    chain. Another QuickNode endpoint, someone else's included, is not ours:
    it gets no token and cannot trip our disable switch."""
    host = _url_host(url)
    return bool(host) and any(host == (_host_for(c) or "").lower() for c in _NETWORK_SUBDOMAIN)


def is_quicknode(url: str | None) -> bool:
    """Any *.quiknode.pro host. For display only; see is_configured_host."""
    return _url_host(url).endswith(_HOST_SUFFIX)


def headers_for(url: str | None) -> dict[str, str]:
    """The auth header for our configured QuickNode host, nothing for any
    other URL. Callers pass this per request rather than setting it on a
    shared client, so the token can never be sent to a different host."""
    if not is_configured_host(url):
        return {}
    token = os.environ.get("QUICKNODE_TOKEN")
    return {"x-token": token} if token else {}


def display_host(url: str | None) -> str:
    """A host safe to print: the endpoint name replaced with `<endpoint>`."""
    try:
        host = urlsplit(url or "").hostname or "?"
    except ValueError:
        return "?"
    if host.endswith(_HOST_SUFFIX):
        rest = host.split(".", 1)[1] if "." in host else host
        return f"<endpoint>.{rest}"
    return host
