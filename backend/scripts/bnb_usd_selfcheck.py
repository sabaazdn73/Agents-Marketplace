"""Checks the BNB/USD oracle arithmetic, and optionally the live read.

Run: ./venv/bin/python scripts/bnb_usd_selfcheck.py          (offline)
     ./venv/bin/python scripts/bnb_usd_selfcheck.py --live   (also reads BSC)

Offline groups:
  ticks        tick 0 is price 1; one tick is 1.0001; the exponent sign.
  decimals     a 6/18-decimal pair, USDC/WETH shaped, lands in dollars and
               not in units of 10^12.
  order        token0 is the lower address; pricing the token1 side returns
               the reciprocal, and pricing either side of one pool gives
               reciprocal answers.
  floor        mean_tick_floor matches OracleLibrary.consult's rounding toward
               negative infinity, and mean_tick is the exact quotient.
  fixture      a read taken from the 0.01% WBNB/USDT pool at BSC block
               123,933,289 reproduces its price, and the spot tick from slot0
               brackets the sqrtPriceX96 price the way TickMath requires.

--live reads the pool through core/bnb_usd.get_bnb_usd() and checks the TWAP
against the same block's slot0 spot price, the ring against the window, and
that the response carries its label, block and window.
"""
from __future__ import annotations

import asyncio
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import v3_oracle as o  # noqa: E402

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))
    if not ok:
        FAILURES.append(name)


def close(a: float, b: float, rel: float = 1e-9) -> bool:
    return math.isclose(a, b, rel_tol=rel)


WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
USDT = "0x55d398326f99059fF775485246999027B3197955"
USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
WETH_ETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"

# ── ticks ────────────────────────────────────────────────────────────────
check("tick 0 is price 1", o.tick_to_price(0, 18, 18) == 1.0)
check("tick 1 is 1.0001", close(o.tick_to_price(1, 18, 18), 1.0001))
check("tick -1 is 1/1.0001", close(o.tick_to_price(-1, 18, 18), 1 / 1.0001))
check("sqrtPriceX96 of 2^96 is price 1", o.sqrt_price_x96_to_price(o.Q96, 18, 18) == 1.0)
check("sqrtPriceX96 of 2*2^96 is price 4", o.sqrt_price_x96_to_price(2 * o.Q96, 18, 18) == 4.0)

# ── decimals ─────────────────────────────────────────────────────────────
# Ethereum's USDC (6) / WETH (18) pool: USDC is token0. At tick 200,000 the raw
# ratio is 1.0001^200000, about 4.85e8 raw WETH per raw USDC; in whole units
# that is 4.85e8 * 10^(6-18) WETH per USDC, and ETH is the reciprocal,
# about $2,061. Without the decimals factor the answer would be 2.06e-9.
t0, t1 = o.token_order(USDC_ETH, WETH_ETH)
check("USDC sorts before WETH", t0 == USDC_ETH)
eth = o.asset_price_from_tick(200000, WETH_ETH, t0, 6, 18)
check("6/18 decimals give dollars per ETH", 2000 < eth < 2100, f"{eth:.2f}")
check("6/18 decimals, exact", close(eth, 1 / (1.0001 ** 200000 * 1e-12)))

# ── order ────────────────────────────────────────────────────────────────
t0, t1 = o.token_order(WBNB, USDT)
check("USDT (0x55d3) is token0, WBNB (0xbb4c) is token1", (t0, t1) == (USDT, WBNB))
check("token_order is symmetric", o.token_order(USDT, WBNB) == (USDT, WBNB))
p10 = o.tick_to_price(-66538.5, 18, 18)          # WBNB per USDT
bnb = o.price_of(WBNB, t0, p10)
usdt = o.price_of(USDT, t0, p10)
check("the token1 side is the reciprocal", close(bnb, 1 / p10))
check("the token0 side is the ratio itself", usdt == p10)
check("both sides multiply to 1", close(bnb * usdt, 1.0))
check("BNB is priced in hundreds of dollars, not fractions", 100 < bnb < 10000, f"{bnb:.2f}")
try:
    o.token_order(WBNB, WBNB.lower())
    check("a pool of one token is refused", False)
except ValueError:
    check("a pool of one token is refused", True)

# ── floor ────────────────────────────────────────────────────────────────
check("floor: -7/2 is -4", o.mean_tick_floor(0, -7, 2) == -4)
check("floor: 7/2 is 3", o.mean_tick_floor(0, 7, 2) == 3)
check("floor: -8/2 is -4 exactly", o.mean_tick_floor(0, -8, 2) == -4)
check("exact mean: -7/2 is -3.5", o.mean_tick(0, -7, 2) == -3.5)
for bad in (0, -5):
    try:
        o.mean_tick(0, 1, bad)
        check(f"window {bad} is refused", False)
    except ValueError:
        check(f"window {bad} is refused", True)

# ── fixture: BSC block 123,933,289, pool 0x172f...f849 (fee 100) ─────────
# observe([1800, 0]) and slot0 at that block, read 2026-09-25.
FIX = {
    "block": 123933289, "timestamp": 1790332266,
    "tick_cumulatives": (-6862780702183, -6862900471788),
    "sqrt_price_x96": 2842179317330695776960507505, "spot_tick": -66559,
}
tc0, tc1 = FIX["tick_cumulatives"]
mt = o.mean_tick(tc0, tc1, 1800)
check("fixture mean tick", close(mt, -119769605 / 1800), f"{mt:.6f}")
check("fixture floor tick", o.mean_tick_floor(tc0, tc1, 1800) == -66539)
twap = o.asset_price_from_tick(mt, WBNB, t0, 18, 18)
check("fixture TWAP BNB/USD", close(twap, 1 / 1.0001 ** mt), f"{twap:.4f}")
check("fixture TWAP is in the range read that day", 770 < twap < 780, f"{twap:.4f}")
spot_ratio = o.sqrt_price_x96_to_price(FIX["sqrt_price_x96"], 18, 18)
check("slot0 tick brackets sqrtPriceX96 (TickMath)",
      1.0001 ** FIX["spot_tick"] <= spot_ratio * (1 + 1e-12) and spot_ratio < 1.0001 ** (FIX["spot_tick"] + 1),
      f"ratio {spot_ratio:.10g}")
spot = o.price_of(WBNB, t0, spot_ratio)
check("fixture spot within 1% of fixture TWAP", abs(spot - twap) / twap < 0.01,
      f"spot {spot:.4f} twap {twap:.4f}")


# ── live ─────────────────────────────────────────────────────────────────
async def live() -> None:
    from core import bnb_usd
    r = await bnb_usd.get_bnb_usd()
    wr = r.get("withheld_reason")
    if wr:
        check("live read returned a price", False, f"withheld: {wr.get('code')}")
        return
    ob, cc = r["observation"], r["cross_check"]
    print(f"      block {r['block']['number']}  usd {r['usd']}  spot {cc['spot_usd']}  "
          f"diff {cc['twap_minus_spot_percent']}%  cardinality {ob['observation_cardinality']} "
          f"next {ob['observation_cardinality_next']} index {ob['observation_index']} "
          f"oldest age {ob['oldest_observation_age_seconds']} s")
    check("live label", r["label"] == "USD via USDT (BSC-USD)")
    check("live window", r["window_seconds"] == 1800 and ob["seconds_ago"] == [1800, 0])
    check("live TWAP within 2% of same-block spot", abs(cc["twap_minus_spot_percent"]) < 2)
    check("live ring reaches past the window",
          ob["oldest_observation_age_seconds"] is not None and ob["oldest_observation_age_seconds"] > 1800,
          f"{ob['oldest_observation_age_seconds']} s")
    check("live ring floor holds (cardinality >= window)", ob["observation_cardinality"] >= 1800)
    tc = [int(x) for x in ob["tick_cumulatives"]]
    again = o.asset_price_from_tick(o.mean_tick(tc[0], tc[1], 1800), WBNB, t0, 18, 18)
    check("live usd reproduces from its own tick cumulatives", abs(again - r["usd"]) < 0.001)
    r2 = await bnb_usd.get_bnb_usd()
    check("second call is served from the cache", r2["block"] == r["block"] and r2["cache"]["age_seconds"] >= 0)

    # A window past the ring must withhold, not shorten itself.
    import os
    saved_window = bnb_usd.WINDOW_SECONDS
    bnb_usd.WINDOW_SECONDS = 10 * 86400
    bnb_usd._cache.update(body=None, at=0.0, ttl=0.0)
    try:
        w = await bnb_usd.get_bnb_usd()
    finally:
        bnb_usd.WINDOW_SECONDS = saved_window
    check("a window past the ring is withheld as window_not_covered",
          w["usd"] is None and (w["withheld_reason"] or {}).get("code") == "window_not_covered",
          (w["withheld_reason"] or {}).get("code", "no reason"))

    # An unreachable RPC must withhold, and say it is about the call.
    saved_env = {k: os.environ.get(k) for k in ("BSC_MAINNET_RPC_URL", "INFURA_API_KEY")}
    os.environ["BSC_MAINNET_RPC_URL"] = "http://127.0.0.1:1"
    os.environ.pop("INFURA_API_KEY", None)
    bnb_usd._cache.update(body=None, at=0.0, ttl=0.0)
    try:
        d = await bnb_usd.get_bnb_usd()
    finally:
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        bnb_usd._cache.update(body=None, at=0.0, ttl=0.0)
    reason = d["withheld_reason"] or {}
    check("an unreachable RPC is withheld as rpc_unreachable, usd null",
          d["usd"] is None and reason.get("code") == "rpc_unreachable", reason.get("detail", ""))
    check("the withheld detail carries no URL", "127.0.0.1" not in str(d) and "http" not in reason.get("detail", ""))


if "--live" in sys.argv:
    asyncio.run(live())

print()
if FAILURES:
    print(f"{len(FAILURES)} FAILED: {FAILURES}")
    sys.exit(1)
print("all passed")
