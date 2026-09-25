"""
v3_oracle.py

The arithmetic of a Uniswap-v3-style pool's price oracle, with no I/O. Used by
core/bnb_usd.py to turn a PancakeSwap v3 pool's observe() answer into a price,
and checked by scripts/bnb_usd_selfcheck.py against fixed cases and a fixture
read from BSC.

What a v3 pool stores. Each observation holds tickCumulative, the running sum
of the pool's tick multiplied by the seconds it was held. observe([w, 0])
returns that sum at `now - w` and at `now`, interpolated between stored
observations, and reverts with "OLD" when `now - w` is earlier than the oldest
observation still in the ring. The difference divided by `w` is the arithmetic
mean tick over the window, and 1.0001 raised to it is the geometric mean price
over the window, token1 per token0, in raw units.

Raw units to a price a person reads. 1.0001^tick is raw token1 per raw token0.
Multiplying by 10^(decimals0 - decimals1) gives whole token1 per whole token0.
On BSC both WBNB and USDT (BSC-USD) carry 18 decimals, so the factor is 1 there,
but it is applied rather than assumed so the same code is right for a pair
where it is not.

Token order. A v3 pool sorts its two tokens by address: token0 is the lower
one. Which of the two is the asset being priced decides whether the price is
the ratio or its reciprocal, and getting that wrong returns 1/775 instead of
775 without any error. token_order() computes it from the addresses; the reader
also checks it against the pool's own token0().
"""

from __future__ import annotations

from fractions import Fraction

TICK_BASE = 1.0001
Q96 = 1 << 96


def token_order(token_a: str, token_b: str) -> tuple[str, str]:
    """(token0, token1) as a v3 factory would sort them: lower address first,
    compared as integers, which is the same as comparing lowercase hex."""
    a, b = int(token_a, 16), int(token_b, 16)
    if a == b:
        raise ValueError("a pool needs two different tokens")
    return (token_a, token_b) if a < b else (token_b, token_a)


def mean_tick(tick_cumulative_start: int, tick_cumulative_end: int, window_seconds: int) -> float:
    """The exact arithmetic mean tick over the window, as a float.

    This is what the price is computed from. OracleLibrary.consult() rounds the
    same quantity to an integer toward negative infinity (mean_tick_floor
    below); that loses up to one tick, about 0.01% of the price, and nothing
    here needs an integer tick."""
    if window_seconds <= 0:
        raise ValueError("window_seconds must be positive")
    return (int(tick_cumulative_end) - int(tick_cumulative_start)) / window_seconds


def mean_tick_floor(tick_cumulative_start: int, tick_cumulative_end: int, window_seconds: int) -> int:
    """OracleLibrary.consult()'s integer mean tick: Solidity's truncating
    division, then one lower when the delta is negative and does not divide
    exactly. Reported beside the exact mean so a reader can reproduce the
    figure with the reference library."""
    if window_seconds <= 0:
        raise ValueError("window_seconds must be positive")
    delta = int(tick_cumulative_end) - int(tick_cumulative_start)
    q = abs(delta) // window_seconds
    q = q if delta >= 0 else -q
    if delta < 0 and delta % window_seconds != 0:
        q -= 1
    return q


def tick_to_price(tick: float, decimals0: int, decimals1: int) -> float:
    """Whole token1 per whole token0 at a (possibly fractional) tick."""
    return (TICK_BASE ** tick) * (10 ** (decimals0 - decimals1))


def sqrt_price_x96_to_price(sqrt_price_x96: int, decimals0: int, decimals1: int) -> float:
    """Whole token1 per whole token0 from slot0's sqrtPriceX96, computed
    exactly as a fraction and converted once at the end."""
    ratio = Fraction(int(sqrt_price_x96), Q96) ** 2
    ratio *= Fraction(10) ** (decimals0 - decimals1)
    return float(ratio)


def price_of(asset: str, token0: str, price_1_per_0: float) -> float:
    """The price of `asset` in the pool's other token, given token1 per token0.

    If the asset is token0 the pool's ratio already is its price; if it is
    token1 the price is the reciprocal."""
    if price_1_per_0 <= 0:
        raise ValueError("a pool price is positive")
    if int(asset, 16) == int(token0, 16):
        return price_1_per_0
    return 1.0 / price_1_per_0


def asset_price_from_tick(tick: float, asset: str, token0: str,
                          decimals0: int, decimals1: int) -> float:
    """Tick straight to the price of `asset` in the other token, whole units."""
    return price_of(asset, token0, tick_to_price(tick, decimals0, decimals1))
