# rails/b402_rail.py
#
# B402: the x402 standard settled natively on BSC. Entitlement verified live
# 2026-09-08 -- /supported returned 10 kinds on eip155:56 ($U, USD1, USDT via
# eip3009 / permit2-exact / permit2-upto), resolving the 40104 "No permission"
# that previously blocked this.
#
# This is a thin wrapper over core/b402.py, which already holds the request
# signing, the error taxonomy and the settle-result classification. Nothing
# about the protocol is re-implemented here; this only adapts that module to
# the PaymentRail interface.
#
# WHAT IT DELIBERATELY WILL NOT DO
# --------------------------------
# It does not settle without a caller-supplied, already-signed payment
# payload. Settlement needs an EIP-3009 or Permit2 authorization signed by
# the payer's wallet, and this backend never holds a private key -- by
# design, stated in docs/future-tnega-paybox.md. So execute() without a
# payload reports that a signature is required rather than attempting
# anything, and the pipeline falls through to Handoff.
#
# It also never retries settle. A settle whose response is lost is
# AMBIGUOUS: the transaction may have broadcast. Retrying could double-spend
# a user's money. classify_settle_result already distinguishes
# broadcast_unconfirmed from terminal_failure, and the first is surfaced as
# 'indeterminate' for a human to resolve, never auto-retried.

from __future__ import annotations

import os

import httpx

from ... import b402
from .base import Cart, RailQuote, RailResult

BSC_CHAIN_ID = 56
BSC_NETWORK = "eip155:56"

# Every outbound call is bounded; b402.post_b402 has its own handling, but
# the /supported probe here is ours to bound.
PROBE_TIMEOUT_SECONDS = 20.0


class B402Rail:
    name = "b402"

    def is_configured(self) -> bool:
        """Credentials present. Not the same as entitled -- entitlement is a
        live fact and is only known by asking, which quote() does."""
        return bool(os.environ.get("OC_API_KEY") and os.environ.get("OC_SECRET_KEY"))

    async def quote(self, cart: Cart) -> RailQuote:
        if not self.is_configured():
            return RailQuote(
                rail=self.name, available=False,
                detail="OC_API_KEY / OC_SECRET_KEY are not set.",
            )
        try:
            async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
                supported = await b402.get_supported(client)
        except b402.B402Error as e:
            return RailQuote(rail=self.name, available=False, detail=f"B402 unavailable: {e}")
        except (httpx.HTTPError, OSError) as e:
            return RailQuote(
                rail=self.name, available=False,
                detail=f"B402 unreachable: {type(e).__name__}",
            )

        kinds = b402.kinds_for_network(supported, BSC_NETWORK)
        match = [
            k for k in b402.describe_supported(supported)
            if k.get("network") == BSC_NETWORK
            and str(k.get("asset_symbol", "")).upper() == cart.currency_symbol.upper()
        ]
        if not kinds:
            return RailQuote(
                rail=self.name, available=False,
                detail=f"no payment kinds offered on {BSC_NETWORK}",
            )
        if not match:
            return RailQuote(
                rail=self.name, available=False,
                detail=f"{cart.currency_symbol} is not settleable on {BSC_NETWORK} via B402",
            )

        # The facilitator states the token's decimals. If they disagree with
        # the cart's, the cart's total is denominated wrongly and settling it
        # would move the wrong amount. Refuse rather than reconcile silently.
        facilitator_decimals = match[0].get("decimals")
        if facilitator_decimals is not None and int(facilitator_decimals) != cart.currency_decimals:
            return RailQuote(
                rail=self.name, available=False,
                detail=(
                    f"decimals mismatch for {cart.currency_symbol}: cart says "
                    f"{cart.currency_decimals}, facilitator says {facilitator_decimals}"
                ),
            )

        return RailQuote(
            rail=self.name, available=True, total=cart.total(),
            detail=f"{len(match)} kind(s) for {cart.currency_symbol} on {BSC_NETWORK}",
        )

    async def execute(self, cart: Cart, payment_payload: dict | None = None) -> RailResult:
        q = await self.quote(cart)
        if not q.available:
            return RailResult(rail=self.name, status="unavailable", detail=q.detail)

        if not payment_payload:
            return RailResult(
                rail=self.name,
                status="unavailable",
                detail=(
                    "B402 is entitled and reachable, but settlement needs an EIP-3009 or "
                    "Permit2 authorization signed by the payer's wallet. This backend holds "
                    "no private key by design, so the signature must come from the browser. "
                    "Falling through to handoff."
                ),
            )

        try:
            async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
                verified = await b402.verify_payment(client, payment_payload)
                if not verified.get("isValid", False):
                    return RailResult(
                        rail=self.name, status="failed",
                        detail=f"verify rejected: {verified.get('invalidReason') or 'unknown'}",
                        raw=verified,
                    )
                settled = await b402.settle_payment(client, payment_payload)
        except b402.B402Error as e:
            # A B402Error from settle may or may not have broadcast. Reported
            # as indeterminate, never retried.
            return RailResult(
                rail=self.name, status="indeterminate",
                detail=f"settle outcome unknown, NOT retried: {e}",
            )
        except (httpx.HTTPError, OSError) as e:
            return RailResult(
                rail=self.name, status="indeterminate",
                detail=f"settle outcome unknown, NOT retried: {type(e).__name__}",
            )

        classified = b402.classify_settle_result(settled)
        outcome = classified.get("outcome")
        if outcome == b402.SETTLE_SUCCESS:
            return RailResult(
                rail=self.name, status="settled",
                detail="settled on BSC via B402",
                reference=classified.get("transaction") or classified.get("txHash"),
                raw=classified,
            )
        if outcome == b402.SETTLE_BROADCAST_UNCONFIRMED:
            return RailResult(
                rail=self.name, status="indeterminate",
                detail="broadcast but unconfirmed; NOT retried, resolve on-chain",
                reference=classified.get("transaction") or classified.get("txHash"),
                raw=classified,
            )
        return RailResult(
            rail=self.name, status="failed",
            detail=str(classified.get("detail") or "terminal failure"),
            raw=classified,
        )
