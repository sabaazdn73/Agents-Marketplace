# rails/handoff.py
#
# The fallback that always works, and the reason the rest of the pipeline is
# shippable. It renders the cart and hands the user a URL to complete the
# purchase themselves.
#
# It depends on nothing: no API key, no network call, no merchant
# relationship, no chain. That is the entire point. Every other rail can be
# unavailable and this one still completes, so no cart is ever a dead end.
#
# This is also the shape for physical goods today. The pipeline can
# assemble a cart; it cannot place an order with a merchant it has no
# relationship with. Handing the human a checkout link says exactly that,
# rather than pretending to an automation that does not exist.
#
# It NEVER reports a purchase. status is 'handoff_required', which is not a
# success -- the money has not moved and the caller must not treat it as if
# it had.

from __future__ import annotations

import os
from urllib.parse import quote

from .base import Cart, RailQuote, RailResult


class HandoffRail:
    name = "handoff"

    def is_configured(self) -> bool:
        return True          # by construction

    async def quote(self, cart: Cart) -> RailQuote:
        return RailQuote(
            rail=self.name,
            available=True,
            total=cart.total(),
            detail="Always available. The buyer completes checkout themselves.",
        )

    async def execute(self, cart: Cart) -> RailResult:
        if not cart.lines:
            return RailResult(
                rail=self.name, status="failed",
                detail="Nothing to check out: the cart is empty.",
            )

        # Single-merchant carts can go straight to that item. Mixed carts
        # cannot -- there is no single URL that buys from several merchants,
        # and inventing one would be a broken link. Say so instead.
        urls = [ln.url for ln in cart.lines if ln.url]
        base = os.environ.get("COMMERCE_HANDOFF_BASE_URL", "").rstrip("/")
        if base:
            checkout_url = f"{base}/checkout?items={quote(','.join(urls))}"
            detail = "Open this to review and complete the purchase."
        elif len(urls) == 1:
            checkout_url = urls[0]
            detail = "Single item: this is the merchant's own product page."
        else:
            checkout_url = None
            detail = (
                f"{len(urls)} items across separate merchants. No single checkout URL "
                "exists for them, and COMMERCE_HANDOFF_BASE_URL is not set, so each "
                "item's own link is listed for the buyer to complete individually."
            )

        return RailResult(
            rail=self.name,
            status="handoff_required",
            detail=detail,
            checkout_url=checkout_url,
            raw={"cart": cart.to_dict(), "item_urls": urls},
        )
