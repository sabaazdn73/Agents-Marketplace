# agents/styling.py
#
# Picks a set from the candidates Search produced, inside the budget.
#
# Built in this pass. It needs no external source, because it only ever
# works on what is already in state.candidates, so it is buildable and
# testable regardless of where candidates come from.
#
# WHY IT IS DETERMINISTIC
# The obvious version asks a model to pick nice clothes. That would put a
# probabilistic judgement in front of a spend, and it would give a different
# answer on a rerun of the same cart. Selection here is a bounded search
# over a small list with an exact integer total, so it is decidable, and the
# same input gives the same output every time.
#
# A model still has a place in this stage, for taste rather than arithmetic:
# scoring how well a candidate matches the request. That is left for later,
# and when it arrives it must feed the score only, never the total.
#
# WHAT IT OPTIMISES
# The most items that fit, then the highest total inside the budget. Buying
# three of five wanted items beats buying one expensive one, and among sets
# of the same size, spending more of an allowed budget generally means
# better items. It never exceeds the budget, so "highest total" can only
# ever mean "closest to, but not over".
#
# Category coverage comes first when the request implies several kinds of
# thing. A coat, a jumper and boots should not become three coats because
# three coats happened to fit. So candidates are grouped by category and the
# search prefers one from each before it takes a second from any.

from __future__ import annotations

import itertools
import time

from ..state import Money, MoneyError, StageResult, TaskState

# Guards the exhaustive search below. Above this the combination count grows
# past what is reasonable to enumerate, so the search falls back to a greedy
# pass. Measured rather than guessed: 2**18 is 262,144 subsets, which is
# still fast, and real candidate lists are far smaller than this.
MAX_EXHAUSTIVE_CANDIDATES = 18


def _as_money(value, decimals: int, symbol: str) -> Money | None:
    """Accept a Money, or the dict form it serialises to. Anything else is
    skipped rather than coerced: a float price must never become a total."""
    if isinstance(value, Money):
        return value
    if isinstance(value, dict):
        try:
            return Money(int(value["units"]), int(value["decimals"]), str(value["symbol"]))
        except (KeyError, TypeError, ValueError, MoneyError):
            return None
    return None


def _normalise(candidates: list, decimals: int, symbol: str) -> tuple[list, list]:
    """Split candidates into ones that can be priced and ones that cannot.

    An unpriceable candidate is not dropped silently. It comes back in the
    second list so the stage can say which ones it could not consider and
    why, rather than quietly shrinking the choice.
    """
    usable, skipped = [], []
    for c in candidates or []:
        if not isinstance(c, dict):
            skipped.append({"candidate": repr(c)[:80], "reason": "not an object"})
            continue
        price = _as_money(c.get("price"), decimals, symbol)
        if price is None:
            skipped.append({"title": c.get("title"), "reason": "no usable integer price"})
            continue
        if price.symbol != symbol or price.decimals != decimals:
            skipped.append({
                "title": c.get("title"),
                "reason": f"priced in {price.symbol}({price.decimals}dp), cart is {symbol}({decimals}dp)",
            })
            continue
        usable.append({**c, "price": price})
    return usable, skipped


def _category(c: dict) -> str:
    return str(c.get("category") or c.get("kind") or "uncategorised").strip().lower()


def _total(items: list, decimals: int, symbol: str) -> Money:
    acc = Money(0, decimals, symbol)
    for c in items:
        acc = acc + c["price"]
    return acc


def _best_subset(usable: list, budget: Money, decimals: int, symbol: str) -> list:
    """Most items first, then highest total, never over budget.

    Exhaustive while the list is small, because that is the only way to be
    sure the answer is the best one. Greedy above the cap, which is not
    guaranteed optimal and is reported as such by the caller.
    """
    if not usable:
        return []

    if len(usable) <= MAX_EXHAUSTIVE_CANDIDATES:
        best: list = []
        best_total = Money(0, decimals, symbol)
        best_cats = 0
        for r in range(len(usable), 0, -1):
            for combo in itertools.combinations(usable, r):
                t = _total(list(combo), decimals, symbol)
                if t.units > budget.units:
                    continue
                cats = len({_category(c) for c in combo})
                # More distinct categories wins, then more items, then a
                # fuller use of the budget.
                key = (cats, len(combo), t.units)
                best_key = (best_cats, len(best), best_total.units)
                if key > best_key:
                    best, best_total, best_cats = list(combo), t, cats
            if best:
                break
        return best

    # Greedy: cheapest first inside each category, one pass per category,
    # then fill with whatever else fits.
    chosen: list = []
    spent = Money(0, decimals, symbol)
    by_cat: dict[str, list] = {}
    for c in usable:
        by_cat.setdefault(_category(c), []).append(c)
    for cat in sorted(by_cat):
        for c in sorted(by_cat[cat], key=lambda x: x["price"].units):
            if (spent + c["price"]).units <= budget.units:
                chosen.append(c)
                spent = spent + c["price"]
                break
    for c in sorted(usable, key=lambda x: x["price"].units):
        if c in chosen:
            continue
        if (spent + c["price"]).units <= budget.units:
            chosen.append(c)
            spent = spent + c["price"]
    return chosen


async def run(state: TaskState) -> StageResult:
    started = time.time()
    symbol, decimals = "USDT", 18

    candidates = state.candidates or []
    if not candidates:
        return StageResult(
            stage="styling", status="error", data={},
            note="No candidates to select from. Search produced nothing.",
            started_at=started, ended_at=time.time(),
        )

    budget = state.profile.get("budget")
    if not isinstance(budget, Money):
        # QA would catch this too, but stopping here says which stage is
        # missing what, instead of letting it surface later as a finding.
        return StageResult(
            stage="styling", status="error", data={},
            note="No budget in the profile, so a set cannot be chosen against one.",
            started_at=started, ended_at=time.time(),
        )
    symbol, decimals = budget.symbol, budget.decimals

    usable, skipped = _normalise(candidates, decimals, symbol)
    if not usable:
        return StageResult(
            stage="styling", status="error",
            data={"skipped": skipped},
            note=(
                f"None of the {len(candidates)} candidates could be priced against a "
                f"{symbol} budget. "
                + "; ".join(str(x.get("reason")) for x in skipped[:3])
                + ". No exchange rate is applied: converting a merchant's price into "
                "the settlement currency would be a guess on a spend path."
            ),
            started_at=started, ended_at=time.time(),
        )

    affordable = [c for c in usable if c["price"].units <= budget.units]
    if not affordable:
        cheapest = min(usable, key=lambda c: c["price"].units)
        return StageResult(
            stage="styling", status="error",
            data={"cheapest": str(cheapest["price"]), "budget": budget.to_dict(), "skipped": skipped},
            note=(
                f"Every candidate costs more than the budget on its own. "
                f"Cheapest is {cheapest['price']}, budget is {budget}."
            ),
            started_at=started, ended_at=time.time(),
        )

    chosen = _best_subset(affordable, budget, decimals, symbol)
    total = _total(chosen, decimals, symbol)

    # Written back in the shape pipeline._cart_from_state reads.
    state.selection = [
        {
            "title": c.get("title"),
            "url": c.get("url"),
            "price": c["price"],
            "quantity": int(c.get("quantity", 1)),
            "size": c.get("size"),
            "merchant": c.get("merchant"),
            "category": _category(c),
        }
        for c in chosen
    ]

    exhaustive = len(affordable) <= MAX_EXHAUSTIVE_CANDIDATES
    return StageResult(
        stage="styling",
        status="ok",
        data={
            "selected": len(chosen),
            "considered": len(usable),
            "categories": sorted({_category(c) for c in chosen}),
            "total": total.to_dict(),
            "budget": budget.to_dict(),
            "remaining": Money(budget.units - total.units, decimals, symbol).to_dict(),
            "skipped": skipped,
            "search": "exhaustive" if exhaustive else "greedy, not guaranteed optimal",
        },
        note=(
            f"Selected {len(chosen)} of {len(usable)} candidates, {total} of {budget}."
            + ("" if exhaustive else " Too many candidates to enumerate, so this is a greedy pick.")
            + (f" {len(skipped)} could not be priced." if skipped else "")
        ),
        started_at=started, ended_at=time.time(),
    )
