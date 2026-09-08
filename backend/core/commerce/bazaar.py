# bazaar.py
#
# Client for the B402 Bazaar, the discovery layer for x402 endpoints that
# Binance indexes.
#
# WHY THIS EXISTS
# The API flow needs a source of services that can actually be paid for over
# B402. Without one, API Fit would have nothing to report but zero. The
# Bazaar is that source, and unlike the retail search problem it is a real
# directory with a query endpoint.
#
# WHAT WAS MEASURED, 2026-09-08
# The catalogue held 500 resources across five pages of 100. Every accept
# entry was on eip155:56, and the ones inspected priced in $U at
# 0xcE24439F2D9C6a2289F741120FE202248B666666, the same address the
# facilitator's own /supported returns. Search returned relevant results for
# plain queries such as "image" and "weather forecast".
#
# That is worth stating because the expectation going in was that BNB Chain
# would have few x402 services and that most would settle on Base or Solana.
# For this directory the opposite holds.
#
# The endpoints are public and take no key, which is why this module has no
# credential handling. It is a read-only view of somebody else's index, so
# every value it returns is treated as untrusted input by the stages above.

from __future__ import annotations

import httpx

BASE_URL = "https://www.binance.com/bapi/ramp/v1/public/ramp/b402"

RESOURCES_PATH = "/bazaar/resources"
SEARCH_PATH = "/bazaar/search"
MERCHANT_PATH = "/bazaar/merchant"

BSC_NETWORK = "eip155:56"

TIMEOUT_SECONDS = 20.0
# The documented ceiling for search. Asking for more is silently capped, and
# a caller that assumed otherwise would think it had seen everything.
SEARCH_MAX_LIMIT = 20

HEADERS = {"Accept": "application/json", "User-Agent": "Tnega/1.0"}


class BazaarError(RuntimeError):
    """The directory could not be read. Distinct from an empty result, which
    is a fact about the catalogue rather than a failure."""


def _unwrap(payload: dict, key: str) -> list:
    """Binance wraps everything in a BAPI envelope under `data`. The list
    key differs by endpoint, which is why it is passed in."""
    data = payload.get("data")
    if not isinstance(data, dict):
        return []
    items = data.get(key)
    return items if isinstance(items, list) else []


def _accepts_on(resource: dict, network: str) -> list[dict]:
    accepts = resource.get("accepts")
    if not isinstance(accepts, list):
        return []
    return [a for a in accepts if isinstance(a, dict) and a.get("network") == network]


def normalise(resource: dict, network: str = BSC_NETWORK) -> dict | None:
    """One catalogue entry reduced to what the stages need, or None when it
    cannot be paid for on the network we settle on.

    The price is kept as the base-unit string the directory gave. It is not
    parsed into a number here, because turning it into a float on the way
    past is exactly how a price stops matching what gets charged.
    """
    url = resource.get("resource")
    if not isinstance(url, str) or not url.startswith("http"):
        return None
    on_network = _accepts_on(resource, network)
    if not on_network:
        return None
    accept = on_network[0]
    amount = accept.get("maxAmountRequired") or accept.get("amount")
    if amount is None:
        return None
    return {
        "resource": url,
        "description": str(resource.get("description") or "")[:400],
        "network": accept.get("network"),
        "asset": accept.get("asset"),
        "scheme": accept.get("scheme"),
        "amount_base_units": str(amount),
        "pay_to": accept.get("payTo"),
        "x402_version": resource.get("x402Version"),
    }


async def search(query: str, *, network: str = BSC_NETWORK, limit: int = SEARCH_MAX_LIMIT,
                 max_usd_price: str | None = None) -> list[dict]:
    """Free-text search, filtered to one network.

    Returns an empty list when the catalogue has nothing, and raises when
    the directory could not be reached. The caller has to tell those apart:
    one is "there is nothing", the other is "we do not know".
    """
    params = {
        "query": (query or "")[:400],
        "network": network,
        "limit": str(min(int(limit), SEARCH_MAX_LIMIT)),
    }
    if max_usd_price:
        params["maxUsdPrice"] = str(max_usd_price)
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, headers=HEADERS) as client:
            r = await client.get(BASE_URL + SEARCH_PATH, params=params)
            r.raise_for_status()
            payload = r.json()
    except (httpx.HTTPError, OSError, ValueError) as e:
        raise BazaarError(f"{type(e).__name__}: {str(e)[:160]}") from None

    out = []
    for item in _unwrap(payload, "resources"):
        entry = normalise(item, network) if isinstance(item, dict) else None
        if entry:
            out.append(entry)
    return out


async def catalogue_size(network: str = BSC_NETWORK, *, max_pages: int = 5) -> int:
    """How many resources the directory holds on this network.

    Used so a stage can say "5 of 500" rather than "5", which is the
    difference between a number and a sense of scale. Bounded by max_pages
    because this is a courtesy count, not a crawl.
    """
    total = 0
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, headers=HEADERS) as client:
            for page in range(max_pages):
                r = await client.get(
                    BASE_URL + RESOURCES_PATH,
                    params={"limit": "100", "offset": str(page * 100)},
                )
                r.raise_for_status()
                items = _unwrap(r.json(), "items")
                on_net = [i for i in items if isinstance(i, dict) and _accepts_on(i, network)]
                total += len(on_net)
                if len(items) < 100:
                    break
    except (httpx.HTTPError, OSError, ValueError) as e:
        raise BazaarError(f"{type(e).__name__}: {str(e)[:160]}") from None
    return total
