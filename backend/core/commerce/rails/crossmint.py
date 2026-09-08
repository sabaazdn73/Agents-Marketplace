# rails/crossmint.py
#
# Crossmint: the path for physical goods from real merchants.
#
# A PRODUCTION KEY IS NOW CONFIGURED, so execute() can place real orders and
# spend real money. Three guards stand in front of it, each independent, so
# no single mistake is sufficient to cause an unintended purchase.
#
#   GUARD 1  execute() is inert unless COMMERCE_ALLOW_REAL_ORDERS is truthy.
#            OFF by default. Reading prices, quoting and building carts all
#            work without it -- only the order write is gated. A flag that
#            has to be set deliberately is the difference between "I ran the
#            pipeline" and "I bought something".
#
#   GUARD 2  A hard spend ceiling from core/commerce/limits.py, checked
#            immediately before the HTTP write. Not an env var: see that
#            file for why. Raise it there once a real order has worked.
#
#   GUARD 3  A browser profile is NEVER created here, and a browserProfileId
#            is never sent unless the caller passes explicit per-session
#            consent. Per Crossmint's own docs, a profile persists the
#            browser state resulting from a user's merchant login -- so
#            creating one as a side effect of a checkout would silently
#            establish a durable logged-in session on someone's retail
#            account. That is a decision for the person whose account it is,
#            taken each time, not a by-product of buying a coat.
#
# ENDPOINTS, FETCHED FROM THE REAL DOCS (2026-09-08, re-verified):
#   create order    POST /2022-06-09/orders            header X-API-KEY
#                   body {"payment": {...}, "lineItems": {...}}
#                   https://docs.crossmint.com/api-reference/headless/create-order
#   get order       GET  /2022-06-09/orders/{orderId}
#                   https://docs.crossmint.com/api-reference/headless/get-order
#   browser profile POST /api/unstable/agent-checkouts/browser-profiles
#                   body {"label": "..."}; reused as browserProfileId
#                   https://docs.crossmint.com/agents/payment-flows/agent-checkouts-browser-profiles
#                   -- documented here so the guard is checkable against the
#                   real thing. This module never calls it.

from __future__ import annotations

import os

import httpx

from ..limits import OrderTooLarge, check_order_value
from .base import Cart, RailQuote, RailResult

PROD_BASE = "https://www.crossmint.com/api"
STAGING_BASE = "https://staging.crossmint.com/api"
CREATE_ORDER_PATH = "/2022-06-09/orders"
GET_ORDER_PATH = "/2022-06-09/orders/{order_id}"

# Never called. Named so GUARD 3 can be asserted against a real constant
# rather than against a comment.
BROWSER_PROFILE_PATH = "/unstable/agent-checkouts/browser-profiles"

TIMEOUT_SECONDS = 30.0

# The real enums, from the create-order reference and confirmed by a live
# 400 ("payment.method: Invalid input") when this adapter guessed wrong.
# Kept here rather than assumed, because sending an unsupported currency is
# how you find out at settlement time instead of at validation time.
# LIVE-VERIFIED 2026-09-08, and these override the docs page, which lists
# `bsc` and the *-sepolia methods. The real API rejects `bsc` outright:
#   "payment.method: 'bsc' is not available for crypto payments.
#    Expected 'ethereum' | 'polygon' | 'optimism' | 'arbitrum' | 'base'
#    | 'arbitrumnova' | 'chiliz' | 'world-chain'"
# That matters more than a naming detail: this project settles on BSC
# everywhere else, and Crossmint's crypto path CANNOT. See the note below
# DEFAULT_PAYMENT_METHOD.
EVM_METHODS = {
    "ethereum", "polygon", "optimism", "arbitrum",
    "base", "arbitrumnova", "chiliz", "world-chain",
}
SOLANA_METHODS = {"solana"}
FIAT_METHODS = {"card"}

EVM_CURRENCIES = {"eth", "usdc", "degen", "brett", "toshi", "usdxm", "credit"}
SOLANA_CURRENCIES = {"sol", "usdc", "bonk"}
FIAT_CURRENCIES = {"usd", "eur", "aud", "gbp", "jpy", "sgd", "hkd", "krw", "inr", "vnd"}

# Testnet methods must never be reachable from a production key. The live
# API does not accept these at all, but they are listed so the guard is
# explicit rather than relying on the remote side to keep rejecting them.
TESTNET_METHODS = {
    "arbitrum-sepolia", "base-sepolia", "ethereum-sepolia", "optimism-sepolia",
}

# NO DEFAULT, DELIBERATELY.
#
# There is no correct default here. BSC -- this project's chain for
# everything else, including B402 -- is NOT available for Crossmint crypto
# payments, confirmed live. So any default would either be a chain this
# project does not use, or `card`, which is a fiat rail and a different
# product decision entirely. Both are choices for a human, so the adapter
# refuses until CROSSMINT_PAYMENT_METHOD is set explicitly.
DEFAULT_PAYMENT_METHOD = None


def _product_locator(url: str) -> str:
    """Crossmint identifies a physical product by a locator, not a bare URL.

    `amazon:<url>` and `amazon:<ASIN>` were both accepted structurally in
    live probing. The URL form is used because it is what the pipeline
    actually carries and needs no ASIN extraction that could silently pick
    the wrong id. Non-Amazon merchants will need their own prefix; that is
    unknown territory and is reported rather than guessed.
    """
    return f"amazon:{url}"


ADDON_REQUIRED_MARKER = "worldstoreCheckout"


def currencies_for(method: str) -> set[str]:
    if method in SOLANA_METHODS:
        return SOLANA_CURRENCIES
    if method in FIAT_METHODS:
        return FIAT_CURRENCIES
    return EVM_CURRENCIES


REAL_ORDERS_FLAG = "COMMERCE_ALLOW_REAL_ORDERS"
_TRUTHY = {"1", "true", "yes", "on"}


def real_orders_enabled() -> bool:
    """GUARD 1. Default OFF: an unset variable must never mean 'spend'."""
    return (os.environ.get(REAL_ORDERS_FLAG) or "").strip().lower() in _TRUTHY


class CrossmintRail:
    name = "crossmint"

    def is_configured(self) -> bool:
        return bool(os.environ.get("CROSSMINT_API_KEY"))

    def _base_url(self) -> str:
        """Environment follows the KEY, not a separate setting.

        A production key against the staging host just 401s, and a staging
        key against production likewise -- but the failure mode that matters
        is the silent one, where a mismatched setting sends a real key
        somewhere unintended. Crossmint keys are self-describing
        (sk_production… / sk_staging…), so the key decides, and CROSSMINT_ENV
        can only be used to force STAGING, never to force production.
        """
        forced = (os.environ.get("CROSSMINT_ENV") or "").strip().lower()
        if forced in ("staging", "test", "sandbox"):
            return STAGING_BASE
        key = os.environ.get("CROSSMINT_API_KEY", "")
        return PROD_BASE if key.startswith("sk_production") else STAGING_BASE

    def is_production(self) -> bool:
        return self._base_url() == PROD_BASE

    async def quote(self, cart: Cart) -> RailQuote:
        """Read-only. Deliberately available even with GUARD 1 off, because
        knowing the price is not the same as paying it."""
        if not self.is_configured():
            return RailQuote(
                rail=self.name, available=False,
                detail="CROSSMINT_API_KEY is not set.",
            )
        if not real_orders_enabled():
            return RailQuote(
                rail=self.name, available=False,
                detail=(
                    f"Configured against {'production' if self.is_production() else 'staging'}, "
                    f"but {REAL_ORDERS_FLAG} is not set, so orders are disabled. "
                    "Falling through to handoff."
                ),
            )
        try:
            check_order_value(cart.total())
        except OrderTooLarge as e:
            return RailQuote(rail=self.name, available=False, detail=str(e))
        return RailQuote(
            rail=self.name, available=True, total=cart.total(),
            detail=f"live against {self._base_url()}",
        )

    async def execute(self, cart: Cart, *, browser_profile_id: str | None = None,
                      profile_consent_this_session: bool = False,
                      draft: bool = False) -> RailResult:
        """Place an order, or validate one without committing.

        `draft=True` sends Crossmint's documented `state: "draft"`, which
        "determines whether an order is officially created or whether it
        simply returns what an order would look like". A draft is not
        persisted, is not queryable, and charges nothing -- so it is the
        honest way to check that a cart is well-formed and priceable BEFORE
        anyone's money is involved, and it is how this adapter's request
        shape was verified against the real API without buying anything.

        GUARD 1 therefore does not apply to a draft: a call that cannot
        spend does not need the flag that exists to authorise spending.
        GUARDS 2 and 3 still do, because a draft that would exceed the cap
        is not worth validating, and a profile id is a session concern
        regardless of whether money moves.
        """
        if not self.is_configured():
            return RailResult(
                rail=self.name, status="unavailable",
                detail="CROSSMINT_API_KEY is not set. Falling through to handoff.",
            )

        # ── GUARD 1 ────────────────────────────────────────────────────────
        if not draft and not real_orders_enabled():
            return RailResult(
                rail=self.name, status="unavailable",
                detail=(
                    f"Real orders are disabled. Set {REAL_ORDERS_FLAG}=1 to allow "
                    "Crossmint to place an actual order. Nothing was sent."
                ),
            )

        # ── GUARD 2 ────────────────────────────────────────────────────────
        try:
            total = cart.total()
            check_order_value(total)
        except OrderTooLarge as e:
            return RailResult(
                rail=self.name, status="failed",
                detail=f"Blocked by the spend cap: {e} Nothing was sent.",
            )

        # ── GUARD 3 ────────────────────────────────────────────────────────
        # A profile id may only be used when the caller states that the user
        # authorised it IN THIS SESSION. Consent is not inferred from the id
        # merely existing: a stored id is evidence of a past decision, not a
        # present one.
        if browser_profile_id and not profile_consent_this_session:
            return RailResult(
                rail=self.name, status="failed",
                detail=(
                    "A browserProfileId was supplied without explicit per-session "
                    "consent. Reusing a merchant login is the user's decision each "
                    "time, so nothing was sent."
                ),
            )

        if not cart.lines:
            return RailResult(rail=self.name, status="failed", detail="Cart is empty.")

        # ── Method / currency validation ───────────────────────────────────
        # Crossmint's accepted currencies are NOT this pipeline's settlement
        # tokens. The cart is denominated in USDT (what B402 settles), and
        # USDT is not in Crossmint's EVM set at all. Refusing here, with the
        # real allowed values named, is far better than discovering it from
        # a 400 mid-checkout -- or worse, from a wrong charge.
        raw_method = os.environ.get("CROSSMINT_PAYMENT_METHOD") or DEFAULT_PAYMENT_METHOD
        if not raw_method:
            return RailResult(
                rail=self.name, status="failed",
                detail=(
                    "CROSSMINT_PAYMENT_METHOD is not set and there is no safe default: "
                    "BSC is not available for Crossmint crypto payments (verified live), "
                    f"so pick one of {sorted(EVM_METHODS | SOLANA_METHODS | FIAT_METHODS)} "
                    "deliberately. Nothing was sent."
                ),
            )
        method = raw_method.strip().lower()
        if method not in (EVM_METHODS | SOLANA_METHODS | FIAT_METHODS):
            return RailResult(
                rail=self.name, status="failed",
                detail=(
                    f"CROSSMINT_PAYMENT_METHOD={method!r} is not a documented method. "
                    f"Allowed: {sorted(EVM_METHODS | SOLANA_METHODS | FIAT_METHODS)}. Nothing was sent."
                ),
            )
        if method in TESTNET_METHODS and self.is_production():
            return RailResult(
                rail=self.name, status="failed",
                detail=(
                    f"Refusing a testnet method ({method}) against a production key. Nothing was sent."
                ),
            )
        allowed = currencies_for(method)
        currency = cart.currency_symbol.lower()
        if currency not in allowed:
            return RailResult(
                rail=self.name, status="failed",
                detail=(
                    f"Crossmint cannot settle {cart.currency_symbol} via {method!r}. "
                    f"Allowed for that method: {sorted(allowed)}. The cart is denominated in "
                    f"{cart.currency_symbol} because that is what B402 settles; a Crossmint "
                    "order needs a currency it actually accepts. Nothing was sent."
                ),
            )

        url = f"{self._base_url()}{CREATE_ORDER_PATH}"
        body: dict = {
            # Explicit rather than relying on the documented default: the
            # difference between these two values is the difference between
            # validating and buying, and it should never be implicit.
            "state": "draft" if draft else "create",
            "payment": {
                "method": method,
                "currency": currency,
            },
            # An ARRAY of productLocator objects. Corrected from live
            # behaviour: the previous {"items": [...]} wrapper produced
            # "externalOrder is required if lineItems are not provided",
            # i.e. the API did not recognise it as lineItems at all. With
            # this shape that error is gone.
            #
            # Note what is NOT sent: no price. Crossmint prices the item
            # from the merchant listing itself, so a price we computed would
            # either be ignored or, worse, disagree with what is charged.
            # The cart total is still checked against the spend cap before
            # we get here, and the real total must be read back from the
            # draft response rather than assumed.
            "lineItems": [
                {
                    "productLocator": _product_locator(ln.url),
                    "quantity": ln.quantity,
                }
                for ln in cart.lines
            ],
        }
        # Only ever sent when GUARD 3 was satisfied above. This module never
        # CREATES a profile -- it can at most reuse one the user made.
        if browser_profile_id and profile_consent_this_session:
            body["browserProfileId"] = browser_profile_id

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
            # The account-level gate is worth naming distinctly: it is not a
            # bad request, it is a missing entitlement, and no amount of
            # fixing the payload will move past it.
            if ADDON_REQUIRED_MARKER in resp.text:
                return RailResult(
                    rail=self.name, status="unavailable",
                    detail=(
                        "Crossmint physical-goods checkout needs the `worldstoreCheckout` "
                        "addon, which this project does not have. The request shape was "
                        "accepted -- this is an account entitlement, not a payload problem. "
                        "Contact Crossmint support with the project id in the response. "
                        "Falling through to handoff."
                    ),
                    raw={"body": resp.text[:400]},
                )
            return RailResult(
                rail=self.name, status="failed",
                detail=f"Crossmint returned HTTP {resp.status_code}: {resp.text[:300]}",
            )

        try:
            data = resp.json()
        except ValueError:
            return RailResult(
                rail=self.name, status="indeterminate",
                detail="Crossmint returned a non-JSON body; order state unknown, NOT retried.",
            )

        if draft:
            # Never "settled": nothing was created and nothing was charged.
            return RailResult(
                rail=self.name, status="validated",
                detail=f"draft accepted by {self._base_url()} -- nothing created, nothing charged",
                reference=None,
                raw=data,
            )
        return RailResult(
            rail=self.name, status="settled",
            detail=f"order created against {self._base_url()}",
            reference=str(data.get("orderId") or data.get("id") or ""),
            raw=data,
        )

    async def probe(self) -> dict:
        """Authentication check that creates nothing.

        Reads a deliberately non-existent order id. A 401/403 means the key
        is wrong; a 404 means the key authenticated and the resource simply
        is not there, which is exactly the signal wanted -- proof of auth
        without a write. Used by the self-check so 'is the key good' never
        requires placing an order to find out.
        """
        if not self.is_configured():
            return {"ok": False, "detail": "CROSSMINT_API_KEY is not set"}
        probe_id = "00000000-0000-0000-0000-000000000000"
        url = f"{self._base_url()}{GET_ORDER_PATH.format(order_id=probe_id)}"
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                r = await client.get(url, headers={"X-API-KEY": os.environ["CROSSMINT_API_KEY"]})
        except (httpx.HTTPError, OSError) as e:
            return {"ok": False, "detail": f"{type(e).__name__}: {str(e)[:160]}"}
        return {
            "ok": r.status_code not in (401, 403),
            "status": r.status_code,
            "base": self._base_url(),
            "body": r.text[:300],
        }
