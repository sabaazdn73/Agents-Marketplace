# limits.py
#
# ════════════════════════════════════════════════════════════════════════
#  THE HARD SPEND CAP LIVES HERE. Raise MAX_ORDER_VALUE_MINOR_UNITS below
# once a order has completed successfully.
# ════════════════════════════════════════════════════════════════════════
#
# One constant, one file, so there is exactly one place to look and exactly
# one place to change. It is deliberately not an environment variable: an
# env var can be raised by accident, by a deploy config, or by a process
# that inherits a stale value. A number in source has to be edited, reviewed
# and committed, which is the friction this cap exists to provide.
#
# The cap is enforced in TWO places on purpose (defence in depth):
#   1. agents/payment.py -- before any rail is chosen, so it applies to
#      every rail including B402, not just Crossmint.
# 2. rails/crossmint.py -- immediately before the HTTP write, so a
#      future caller that bypasses the payment agent still cannot exceed it.
# Neither is redundant: the first is the policy, the second is the fuse.

from __future__ import annotations

from .state import Money

# ── THE NUMBER TO RAISE ───────────────────────────────────────────────────
#
# 5.00 units of an 18-decimal token. Chosen so that a bug costs about a
# coffee rather than a wardrobe. This is a CEILING, not a budget: a buyer's
# own budget is separate and QA enforces it independently.
MAX_ORDER_VALUE_MINOR_UNITS = 5 * 10**18
MAX_ORDER_VALUE_DECIMALS = 18
MAX_ORDER_VALUE_SYMBOL_NOTE = "compared against any 18-decimal token, symbol-agnostic"


class OrderTooLarge(Exception):
    """Raised instead of proceeding. Never downgraded to a warning."""


def max_order_value(symbol: str = "USDT") -> Money:
    return Money(MAX_ORDER_VALUE_MINOR_UNITS, MAX_ORDER_VALUE_DECIMALS, symbol)


def check_order_value(total: Money) -> None:
    """Raise if `total` exceeds the cap. Integer comparison only.

    Decimals mismatches are treated as a FAILURE, not something to convert
    around: if a token's decimals are not what the cap assumes, the cap's
    meaning is unclear and the safe answer is to refuse rather than to guess
    a conversion on a spend path.
    """
    if total.decimals != MAX_ORDER_VALUE_DECIMALS:
        raise OrderTooLarge(
            f"cannot apply the spend cap: it is defined at "
            f"{MAX_ORDER_VALUE_DECIMALS}dp but the order is {total.decimals}dp "
            f"({total.symbol}). Refusing rather than converting on a spend path."
        )
    if total.units > MAX_ORDER_VALUE_MINOR_UNITS:
        cap = max_order_value(total.symbol)
        raise OrderTooLarge(
            f"order total {total} exceeds the hard cap of {cap}. "
            f"Raise MAX_ORDER_VALUE_MINOR_UNITS in core/commerce/limits.py "
            f"to allow more."
        )
