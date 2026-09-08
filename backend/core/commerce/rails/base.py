# rails/base.py
#
# The one interface the Payment agent calls. Everything payment-shaped lives
# behind it, so the pipeline never learns which rail settled a cart.
#
# The reason this abstraction exists rather than a direct B402 call: of the
# three rails, one works today (B402), one is unsigned-up (Crossmint), and
# one depends on nothing at all (Handoff). Only the last is guaranteed. The
# interface is what lets everything upstream ship regardless of which of the
# other two is available on any given day.

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Protocol, runtime_checkable

from ..state import Money


@dataclass
class CartLine:
    title: str
    url: str
    price: Money
    quantity: int = 1
    size: str | None = None
    merchant: str | None = None
    # "service" turns off the rules written for clothing. A size check on an
    # API endpoint is not a safety net, it is noise that hides real findings.
    category: str | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["price"] = self.price.to_dict()
        return d


@dataclass
class Cart:
    lines: list[CartLine] = field(default_factory=list)
    currency_symbol: str = "USDT"
    currency_decimals: int = 18

    def total(self) -> Money:
        """Integer summation only. Starts from an explicit zero in the cart's
        own currency so an empty cart has a well-defined total rather than
        None, and so a line in a different currency raises instead of being
        silently coerced."""
        acc = Money(0, self.currency_decimals, self.currency_symbol)
        for ln in self.lines:
            for _ in range(ln.quantity):
                acc = acc + ln.price
        return acc

    def to_dict(self) -> dict:
        return {
            "lines": [ln.to_dict() for ln in self.lines],
            "total": self.total().to_dict(),
            "currency_symbol": self.currency_symbol,
            "currency_decimals": self.currency_decimals,
        }


@dataclass
class RailQuote:
    rail: str
    available: bool
    total: Money | None = None
    detail: str = ""

    def to_dict(self) -> dict:
        return {
            "rail": self.rail,
            "available": self.available,
            "total": self.total.to_dict() if self.total else None,
            "detail": self.detail,
        }


@dataclass
class RailResult:
    rail: str
    status: str            # settled | handoff_required | unavailable | failed | indeterminate
    detail: str = ""
    reference: str | None = None
    checkout_url: str | None = None
    raw: dict = field(default_factory=dict)

    @property
    def needs_user_action(self) -> bool:
        return self.status == "handoff_required"

    def to_dict(self) -> dict:
        return asdict(self)


@runtime_checkable
class PaymentRail(Protocol):
    name: str

    def is_configured(self) -> bool: ...

    async def quote(self, cart: Cart) -> RailQuote: ...

    async def execute(self, cart: Cart) -> RailResult: ...
