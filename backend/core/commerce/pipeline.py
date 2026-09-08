# pipeline.py
#
# The orchestrator. Runs the six stages in order and stops at the first one
# that cannot honestly continue.
#
# HALTING IS THE FEATURE
# ----------------------
# Search is not built, so a request stops there. That is the correct
# outcome, not a limitation to be worked around: the alternative is
# continuing with invented candidates, which would produce a cart that looks
# complete and is fictional. The stage list, with each stage's status and
# duration, is returned either way -- so "where did this stop, and why" is
# answered by reading the result rather than by re-running with logging.

from __future__ import annotations

from .agents import context as context_agent
from .agents import payment as payment_agent
from .agents import profile as profile_agent
from .agents import qa as qa_agent
from .agents import search as search_agent
from .agents import styling as styling_agent
from .rails.base import Cart, CartLine
from .state import Money, StageResult, TaskState

# Stages that stop the pipeline when they do not return ok. Payment is
# excluded because it is terminal anyway.
HALT_ON = ("profile", "context", "search", "styling", "qa")


def _cart_from_state(state: TaskState) -> Cart:
    """Build the cart from Styling's selection.

    Prices come from the selection as integer minor units. A selection entry
    without an integer price is skipped rather than coerced -- a float price
    reaching Money would raise, and guessing a value would be worse.
    """
    # The cart takes its currency from what is actually being bought, not
    # from a default. Hardcoding USDT here meant a selection priced in the
    # merchant's own currency made cart.total() raise, which surfaced
    # downstream as QA reporting "total_uncomputable" rather than as the
    # currency mismatch it was.
    prices = [i.get("price") for i in (state.selection or []) if isinstance(i, dict)]
    first = next((p for p in prices if isinstance(p, Money)), None)
    if first is None:
        first = next(
            (Money(int(p["units"]), int(p["decimals"]), str(p["symbol"]))
             for p in prices
             if isinstance(p, dict) and {"units", "decimals", "symbol"} <= set(p)),
            None,
        )
    cart = Cart(
        currency_symbol=first.symbol if first else "USDT",
        currency_decimals=first.decimals if first else 18,
    )
    for item in state.selection or []:
        try:
            price = item["price"]
            money = price if isinstance(price, Money) else Money(
                int(price["units"]), int(price["decimals"]), str(price["symbol"]),
            )
            cart.lines.append(CartLine(
                title=str(item.get("title") or "untitled"),
                url=str(item.get("url") or ""),
                price=money,
                quantity=int(item.get("quantity", 1)),
                size=item.get("size"),
                merchant=item.get("merchant"),
                category=item.get("category"),
            ))
        except (KeyError, TypeError, ValueError):
            continue
    return cart


async def run_pipeline(request: str, *, check_links: bool = True) -> TaskState:
    """Run every stage that can run. Never raises for a stage failure --
    the failure is recorded as that stage's status and returned."""
    state = TaskState(request=request)

    ordered = [
        ("profile", lambda: profile_agent.run(state)),
        ("context", lambda: context_agent.run(state)),
        ("search", lambda: search_agent.run(state)),
        ("styling", lambda: styling_agent.run(state)),
    ]

    for name, call in ordered:
        try:
            result = await call()
        except Exception as e:
            result = StageResult(
                stage=name, status="error", data={},
                note=f"{type(e).__name__}: {str(e)[:200]}",
            )
        state.record(result)
        if name in HALT_ON and not result.ok:
            state.record(StageResult(
                stage="pipeline", status="halted", data={"halted_at": name},
                note=(
                    f"Stopped after {name} ({result.status}). Later stages were not run, "
                    "because continuing would mean inventing the data {name} did not produce."
                ),
            ))
            return state

    cart = _cart_from_state(state)

    qa_result = await qa_agent.run(state, cart, check_links=check_links)
    state.record(qa_result)
    if not qa_result.ok or state.findings:
        state.record(StageResult(
            stage="pipeline", status="halted", data={"halted_at": "qa"},
            note=f"QA blocked payment with {len(state.findings)} finding(s). Nothing was charged.",
        ))
        return state

    state.record(await payment_agent.run(state, cart))
    return state


async def dry_run_payment(cart: Cart) -> dict:
    """Which rail would settle this cart, and what every rail said.

    Read-only: quotes only, never execute. Used by the self-check and the
    readiness endpoint so rail availability is inspectable without spending
    anything.
    """
    from .rails.select import select_rail

    rail, quotes = await select_rail(cart)
    return {
        "chosen": getattr(rail, "name", "unknown"),
        "quotes": [q.to_dict() for q in quotes],
    }
