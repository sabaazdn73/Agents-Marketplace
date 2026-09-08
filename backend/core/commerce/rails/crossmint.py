# rails/crossmint.py
#
# Crossmint: the intended path for physical goods from real merchants.
# NOT SIGNED UP. This adapter is written against the published API and left
# unconfigured; with no CROSSMINT_API_KEY it reports itself unavailable and
# selection falls through to Handoff.
#
# ENDPOINTS, FETCHED FROM THE REAL DOCS 2026-09-08 (not inferred):
#   create:   POST /2022-06-09/orders
#             https://docs.crossmint.com/api-reference/headless/create-order
#             prod    https://www.crossmint.com/api/2022-06-09/orders
#             staging https://staging.crossmint.com/api/2022-06-09/orders
#             auth header: X-API-KEY
#             body: {"payment": {"method": str, "currency": str}, "lineItems": {}}
#             optional: recipient, locale, state (defaults to "create")
#   retrieve: GET /2022-06-09/orders/{orderId}
#             https://docs.crossmint.com/api-reference/headless/get-order
#             auth: server-side key with `orders.read` scope, OR the
#             clientSecret returned at creation, passed as `Authorization`.
#
# WHAT IS STILL UNVERIFIED, AND WHY THAT MATTERS
# ----------------------------------------------
# The docs give the envelope, not the per-merchant `lineItems` shape for an
# arbitrary physical product, and no request has ever been sent with a real
# key. So the request BODY below is the documented envelope with our cart
# mapped into it in the most literal way available -- it is not a shape
# confirmed by a successful call. The first real use should expect to
# correct it, and execute() says so rather than implying it is proven.
#
# Deliberately not invented: no webhook handling, no fulfilment polling
# semantics, no status vocabulary. Those aren't in what was fetched, and
# writing plausible versions would fail at runtime in ways that look like
# bugs rather than like the gaps they are.

from __future__ import annotations

import os

import httpx

from .base import Cart, RailQuote, RailResult

PROD_BASE = "https://www.crossmint.com/api"
STAGING_BASE = "https://staging.crossmint.com/api"
CREATE_ORDER_PATH = "/2022-06-09/orders"
GET_ORDER_PATH = "/2022-06-09/orders/{order_id}"

TIMEOUT_SECONDS = 30.0


class CrossmintRail:
    name = "crossmint"

    def is_configured(self) -> bool:
        return bool(os.environ.get("CROSSMINT_API_KEY"))

    def _base_url(self) -> str:
        # Staging unless explicitly told otherwise. A default that points at
        # production would mean a stray key placing real orders.
        env = (os.environ.get("CROSSMINT_ENV") or "staging").strip().lower()
        return PROD_BASE if env == "production" else STAGING_BASE

    async def quote(self, cart: Cart) -> RailQuote:
        if not self.is_configured():
            return RailQuote(
                rail=self.name,
                available=False,
                detail=(
                    "CROSSMINT_API_KEY is not set. We have not signed up; the adapter is "
                    "written against the published API but has never been exercised."
                ),
            )
        return RailQuote(
            rail=self.name, available=True, total=cart.total(),
            detail=f"configured against {self._base_url()} (never exercised)",
        )

    async def execute(self, cart: Cart) -> RailResult:
        if not self.is_configured():
            return RailResult(
                rail=self.name,
                status="unavailable",
                detail=(
                    "Crossmint is not signed up and CROSSMINT_API_KEY is unset. "
                    "Falling through to handoff."
                ),
            )

        url = f"{self._base_url()}{CREATE_ORDER_PATH}"
        body = {
            "payment": {
                "method": os.environ.get("CROSSMINT_PAYMENT_METHOD", "checkout-com-flow"),
                "currency": cart.currency_symbol.lower(),
            },
            # The documented envelope. The per-merchant item shape is NOT
            # documented for arbitrary physical goods, so this is our literal
            # mapping and should be expected to need correction on first use.
            "lineItems": {
                "items": [
                    {
                        "title": ln.title,
                        "url": ln.url,
                        "quantity": ln.quantity,
                        # String, not float: the price is an exact integer of
                        # minor units and must not cross JSON as a double.
                        "price": str(ln.price.as_decimal()),
                        "currency": ln.price.symbol,
                        **({"size": ln.size} if ln.size else {}),
                    }
                    for ln in cart.lines
                ]
            },
        }

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    url, json=body,
                    headers={"X-API-KEY": os.environ["CROSSMINT_API_KEY"]},
                )
        except (httpx.HTTPError, OSError) as e:
            # Order creation is a write. An ambiguous failure is NOT retried:
            # a duplicate order is a real charge against a real person.
            return RailResult(
                rail=self.name, status="indeterminate",
                detail=(
                    f"order creation outcome unknown, NOT retried ({type(e).__name__}). "
                    "Check Crossmint before re-attempting."
                ),
            )

        if resp.status_code >= 400:
            return RailResult(
                rail=self.name, status="failed",
                detail=f"Crossmint returned HTTP {resp.status_code}: {resp.text[:200]}",
            )

        try:
            data = resp.json()
        except ValueError:
            return RailResult(
                rail=self.name, status="indeterminate",
                detail="Crossmint returned a non-JSON body; order state unknown, NOT retried.",
            )

        return RailResult(
            rail=self.name, status="settled",
            detail="order created (UNVERIFIED PATH: never exercised against a real key)",
            reference=str(data.get("orderId") or data.get("id") or ""),
            raw=data,
        )
