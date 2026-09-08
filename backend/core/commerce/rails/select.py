# rails/select.py
#
# Which rail settles a given cart.
#
# Order is preference, and Handoff is ALWAYS last and always succeeds at
# being selectable. That ordering is the guarantee the whole pipeline rests
# on: no cart can reach the end and find nothing to do with itself.
#
# Selection asks each rail whether it is available for THIS cart, not merely
# whether it is switched on -- B402 can be configured and still unable to
# settle a given token, and a rail that says "not for this cart" must not be
# chosen just because its key exists.

from __future__ import annotations

from .base import Cart, RailQuote
from .b402_rail import B402Rail
from .crossmint import CrossmintRail
from .handoff import HandoffRail


def all_rails() -> list:
    # Handoff last: it is the fallback, not a competitor.
    return [B402Rail(), CrossmintRail(), HandoffRail()]


async def select_rail(cart: Cart) -> tuple[object, list[RailQuote]]:
    """Returns (chosen_rail, every_quote_considered).

    The quotes come back too, so a surprising choice is explainable after the
    fact rather than needing a re-run to understand.
    """
    quotes: list[RailQuote] = []
    chosen = None
    for rail in all_rails():
        try:
            q = await rail.quote(cart)
        except Exception as e:  # a broken rail must not break selection
            q = RailQuote(
                rail=getattr(rail, "name", "unknown"), available=False,
                detail=f"quote raised {type(e).__name__}: {str(e)[:120]}",
            )
        quotes.append(q)
        if chosen is None and q.available:
            chosen = rail
    if chosen is None:
        # Unreachable while HandoffRail.is_configured() is True by
        # construction, but asserted rather than assumed: if it ever becomes
        # reachable, the failure should name itself.
        raise RuntimeError("no payment rail available, including handoff -- this is a bug")
    return chosen, quotes
