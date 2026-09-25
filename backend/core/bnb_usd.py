"""
bnb_usd.py

BNB/USD, read from BNB Chain itself: the time-weighted average price of the
PancakeSwap v3 WBNB/USDT pool, over a fixed window, through the pool's own
observe(). Backs /api/market/bnb-price. The maths is in core/v3_oracle.py; this
module does the read, the checks and the response.

Why on chain (2026-09-25). The price used to come from CoinGecko's free keyless
API. Its terms do not cover a commercial site, and serving the figure onward
would need a redistribution agreement. A pool's oracle is public chain state:
reading it needs no licence, and the figure can be stated with the block it
was read at.

What the figure is, and is not. It is the geometric mean of the pool's WBNB
price in USDT (BSC-USD, 0x55d3...7955) over WINDOW_SECONDS ending at the block
read. USDT is taken at one US dollar; if it trades away from that, this figure
moves with it. That is why the label says "USD via USDT (BSC-USD)" rather than
"USD". It is one pool on one venue, not a cross-venue index.

THE POOL, measured 2026-09-25 at block 123,932,872 (read-only calls through
core/rpc.py). PancakeSwap v3 factory 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865
returns four WBNB/USDT pools:

  fee   pool                                         in-range liquidity   cardinality
  100   0x172fcd41e0913e95784454622d1c3724f546f849   3.19e24              4,500
  500   0x36696169c63e42cd08ce11f5deebbcebae652050   2.30e24                900
  2500  0x1401ff943d08a7e098328c1d3a9d388923b115d2   3.71e22                150
  10000 0x6805e0e5333c5c3accf2930be4734e2b98f4ce06   6.54e20                150

The 0.01% pool (fee 100) is used because it is the deepest across price bands,
not only at the current tick. In-range liquidity is a single-tick figure; what
sets the cost of moving the price, and so of moving an average of it, is the
value that has to trade to push the price a given distance. Measured by the
supervising review at block ~123,964,4xx: about $437k to move the price 0.5%
in the 0.01% pool against about $313k in the 0.05% pool, and about $1.39M
against $1.26M for 2%. The 0.01% pool also has the largest observation ring,
4,500 against 900, and on 2026-09-25 held the most USDT (9.64M against
6.98M; the 0.05% pool held more WBNB, 5,239 against 3,739).

THE WINDOW, and why 1,800 seconds. observe() reverts with "OLD" for any window
reaching past the oldest observation in the ring. A pool writes at most one
observation per block timestamp, and BSC's block timestamp is in whole seconds,
so a ring of 4,500 cannot span less than 4,500 seconds however busy the pool
is. Measured, not taken from the source: all 4,500 observations read at block
123,933,289 were initialised, strictly increasing, with a smallest gap of 1 s
and a span of 28,957 s. observe([28882, 0]) succeeded and observe([28883, 0])
reverted "OLD" at block 123,932,913, the ring's oldest observation to the
second. The span moves with trading activity: busier trading fills the ring
faster, so it covers less time. It was 28,957 s at block 123,933,289, about
13,000 s on a later read by the supervising review, and 12,445 s at block
123,965,911. The margin over the window is therefore a snapshot (about 16x on
the first read, about 7x on the last), and the guarantee is the floor: 1,800 s
is inside 4,500 s however busy the pool gets. Thirty minutes is long
enough that moving the average means holding the pool off-price for a
sustained period, and short enough that the figure is still today's price.

If the read fails, no price is given. The response carries a withheld_reason
and `usd: null`, and the frontend already shows plain BNB when `usd` is null. A
shorter window is not substituted and an earlier price is not served; a cached
figure is at most CACHE_TTL_SECONDS old and carries its own block.
"""

from __future__ import annotations

import asyncio
import time

import httpx
from eth_abi import decode as abi_decode
from eth_abi import encode as abi_encode
from eth_utils import function_signature_to_4byte_selector as _sel

from core import v3_oracle
from core.rpc import rpc_post
from core.safe_errors import describe

LABEL = "USD via USDT (BSC-USD)"

CHAIN_ID = 56
FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865"
POOL = "0x172fcd41e0913e95784454622d1c3724f546f849"
FEE_TIER = 100  # hundredths of a basis point: 100 is 0.01%
WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
USDT = "0x55d398326f99059fF775485246999027B3197955"
WBNB_DECIMALS = 18
USDT_DECIMALS = 18

WINDOW_SECONDS = 1800
CACHE_TTL_SECONDS = 30          # the owner's ceiling is 60
FAILURE_TTL_SECONDS = 10        # a withheld answer is held briefly too, so a
                                # dead RPC is not asked again on every request
READ_DEADLINE_SECONDS = 12.0

MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"

_TOKEN0, _TOKEN1 = v3_oracle.token_order(WBNB, USDT)
_DEC0 = WBNB_DECIMALS if _TOKEN0 == WBNB else USDT_DECIMALS
_DEC1 = USDT_DECIMALS if _TOKEN0 == WBNB else WBNB_DECIMALS

_SLOT0_TYPES = ["uint160", "int24", "uint16", "uint16", "uint16", "uint32", "bool"]
_OBS_TYPES = ["uint32", "int56", "uint160", "bool"]
_ERROR_STRING_SELECTOR = bytes.fromhex("08c379a0")

REASONS = {
    "rpc_unreachable": (
        "The BSC RPC did not answer, so the pool was not read and no price is "
        "stated. That is about the call, not about BNB."),
    "read_deadline": (
        "The read ran out of time before the pool answered. That is about the "
        "call, not about BNB."),
    "window_not_covered": (
        "The pool's observation ring did not reach back the full window at the "
        "block read (observe reverted \"OLD\"), so a time-weighted average over "
        "that window cannot be formed. A shorter window is not substituted."),
    "read_failed": (
        "The pool answered, but not with something this server could decode, so "
        "no price is stated."),
    "pool_mismatch": (
        "The contract at the configured pool address did not report the expected "
        "tokens and fee tier, so its price was not used."),
}

_cache: dict = {"body": None, "at": 0.0, "ttl": 0.0}
_lock = asyncio.Lock()


def _call(target: str, signature: str, types=(), args=(), allow_failure: bool = False):
    data = _sel(signature) + (abi_encode(list(types), list(args)) if types else b"")
    return (target, allow_failure, data)


def _aggregate3_payload(calls: list, block: str) -> dict:
    data = _sel("aggregate3((address,bool,bytes)[])") + abi_encode(
        ["(address,bool,bytes)[]"], [calls])
    return {"jsonrpc": "2.0", "id": 1, "method": "eth_call",
            "params": [{"to": MULTICALL3, "data": "0x" + data.hex()}, block]}


def _revert_string(data: bytes) -> str | None:
    """The message of a Solidity Error(string) revert, or None."""
    if len(data) >= 4 and data[:4] == _ERROR_STRING_SELECTOR:
        try:
            (msg,) = abi_decode(["string"], data[4:])
            return msg
        except Exception:  # noqa: BLE001
            return None
    return None


class _Withheld(Exception):
    def __init__(self, code: str, detail_extra: str = "", **facts):
        super().__init__(code)
        self.code = code
        self.detail_extra = detail_extra
        self.facts = facts


async def _aggregate(client: httpx.AsyncClient, calls: list, block: str) -> list:
    try:
        resp = await rpc_post(client, _aggregate3_payload(calls, block))
        resp.raise_for_status()
        body = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        raise _Withheld("rpc_unreachable", describe(e)) from None
    if body.get("error") or not isinstance(body.get("result"), str):
        # A JSON-RPC error object can quote the node's own text; the code is
        # the only part passed on.
        code = (body.get("error") or {}).get("code") if isinstance(body.get("error"), dict) else None
        raise _Withheld("read_failed", f"JSON-RPC error {code}" if code is not None else "no result")
    try:
        (results,) = abi_decode(["(bool,bytes)[]"], bytes.fromhex(body["result"][2:]))
    except Exception:  # noqa: BLE001
        raise _Withheld("read_failed", "undecodable multicall result") from None
    return list(results)


async def _read() -> dict:
    """One read of the pool, everything at a single block. Raises _Withheld."""
    async with httpx.AsyncClient(timeout=10) as client:
        # 1. At "latest": the block, its timestamp, slot0, the pool's identity
        #    and observe(). All seven run inside one eth_call, so they describe
        #    the same block's state.
        calls = [
            _call(MULTICALL3, "getBlockNumber()"),
            _call(MULTICALL3, "getCurrentBlockTimestamp()"),
            _call(POOL, "slot0()"),
            _call(POOL, "token0()"),
            _call(POOL, "token1()"),
            _call(POOL, "fee()"),
            _call(POOL, "observe(uint32[])", ["uint32[]"], [[WINDOW_SECONDS, 0]], allow_failure=True),
        ]
        res = await _aggregate(client, calls, "latest")
        if len(res) != len(calls) or not all(ok for ok, _ in res[:6]):
            raise _Withheld("read_failed", "a required call in the batch failed")
        try:
            (block_number,) = abi_decode(["uint256"], res[0][1])
            (block_ts,) = abi_decode(["uint256"], res[1][1])
            slot0 = abi_decode(_SLOT0_TYPES, res[2][1])
            (token0,) = abi_decode(["address"], res[3][1])
            (token1,) = abi_decode(["address"], res[4][1])
            (fee,) = abi_decode(["uint24"], res[5][1])
        except Exception:  # noqa: BLE001
            raise _Withheld("read_failed", "undecodable pool state") from None

        if (token0.lower(), token1.lower(), int(fee)) != (_TOKEN0.lower(), _TOKEN1.lower(), FEE_TIER):
            raise _Withheld("pool_mismatch", block=int(block_number))

        sqrt_price_x96, spot_tick, obs_index, cardinality, cardinality_next = slot0[:5]
        if int(cardinality) == 0 or int(sqrt_price_x96) == 0:
            raise _Withheld("read_failed", "pool reports no initialised oracle", block=int(block_number))
        ring = {
            "observation_index": int(obs_index),
            "observation_cardinality": int(cardinality),
            "observation_cardinality_next": int(cardinality_next),
        }

        # 2. Pinned to the same block: the ring's oldest observation, so the
        #    response can show how far back the pool could have been asked.
        #    It is (index + 1) mod cardinality once the ring has wrapped, and 0
        #    before; both are read and the initialised one is used.
        block_hex = hex(int(block_number))
        oldest = None
        try:
            ores = await _aggregate(client, [
                _call(POOL, "observations(uint256)", ["uint256"], [(int(obs_index) + 1) % int(cardinality)], allow_failure=True),
                _call(POOL, "observations(uint256)", ["uint256"], [0], allow_failure=True),
            ], block_hex)
            for ok, data in ores:
                if ok:
                    o = abi_decode(_OBS_TYPES, data)
                    if o[3]:
                        oldest = int(o[0])
                        break
        except _Withheld:
            oldest = None  # the price does not rest on this; its absence is stated below
        ring["oldest_observation_timestamp"] = oldest
        ring["oldest_observation_age_seconds"] = (int(block_ts) - oldest) if oldest is not None else None
        if oldest is None:
            ring["oldest_observation_note"] = "not read; the price does not depend on it"

        ok, data = res[6]
        if not ok:
            msg = _revert_string(data)
            if msg == "OLD":
                raise _Withheld("window_not_covered", block=int(block_number),
                                block_timestamp=int(block_ts), ring=ring)
            raise _Withheld("read_failed", "observe reverted" + (f" \"{msg}\"" if msg else ""),
                            block=int(block_number))
        try:
            tick_cumulatives, _ = abi_decode(["int56[]", "uint160[]"], data)
        except Exception:  # noqa: BLE001
            raise _Withheld("read_failed", "undecodable observe result") from None
        if len(tick_cumulatives) != 2:
            raise _Withheld("read_failed", "observe returned the wrong number of points")

    tc_start, tc_end = int(tick_cumulatives[0]), int(tick_cumulatives[1])
    avg_tick = v3_oracle.mean_tick(tc_start, tc_end, WINDOW_SECONDS)
    usd = v3_oracle.asset_price_from_tick(avg_tick, WBNB, _TOKEN0, _DEC0, _DEC1)
    spot = v3_oracle.price_of(WBNB, _TOKEN0,
                              v3_oracle.sqrt_price_x96_to_price(int(sqrt_price_x96), _DEC0, _DEC1))

    return {
        "usd": round(usd, 4),
        "label": LABEL,
        "method": (f"Time-weighted average of the pool price over {WINDOW_SECONDS} s, "
                   "from the pool's observe(); the geometric mean, 1.0001 to the mean tick."),
        "assumption": "USDT (BSC-USD) is taken at one US dollar; this figure moves with it if it does not hold.",
        "source": {
            "venue": "PancakeSwap v3",
            "chain_id": CHAIN_ID,
            "factory": FACTORY,
            "pool": POOL,
            "fee_tier": FEE_TIER,
            "fee_tier_percent": "0.01%",
            "token0": {"address": _TOKEN0, "symbol": "USDT" if _TOKEN0 == USDT else "WBNB", "decimals": _DEC0},
            "token1": {"address": _TOKEN1, "symbol": "WBNB" if _TOKEN1 == WBNB else "USDT", "decimals": _DEC1},
            "quote": {"address": USDT, "symbol": "USDT", "name": "BSC-USD"},
        },
        "block": {"number": int(block_number), "timestamp": int(block_ts)},
        "window_seconds": WINDOW_SECONDS,
        "observation": {
            "seconds_ago": [WINDOW_SECONDS, 0],
            "from_timestamp": int(block_ts) - WINDOW_SECONDS,
            "to_timestamp": int(block_ts),
            # int56 values; strings so a JavaScript reader cannot round them.
            "tick_cumulatives": [str(tc_start), str(tc_end)],
            "mean_tick": round(avg_tick, 6),
            "mean_tick_floor": v3_oracle.mean_tick_floor(tc_start, tc_end, WINDOW_SECONDS),
            **ring,
        },
        "cross_check": {
            "spot_usd": round(spot, 4),
            "spot_tick": int(spot_tick),
            "twap_minus_spot_percent": round((usd - spot) / spot * 100, 4),
            "note": "The pool's instantaneous price at the same block, from slot0. Shown for comparison; the figure above does not use it.",
        },
        "withheld_reason": None,
    }


def _withheld_body(w: _Withheld) -> dict:
    detail = REASONS.get(w.code, "")
    if w.detail_extra:
        detail = f"{detail} ({w.detail_extra})"
    body = {
        "usd": None,
        "label": LABEL,
        "source": {"venue": "PancakeSwap v3", "chain_id": CHAIN_ID, "pool": POOL, "fee_tier": FEE_TIER},
        "window_seconds": WINDOW_SECONDS,
        "withheld_reason": {"code": w.code, "detail": detail},
    }
    if "block" in w.facts:
        body["block"] = {"number": w.facts["block"],
                         "timestamp": w.facts.get("block_timestamp")}
    if "ring" in w.facts:
        body["observation"] = w.facts["ring"]
    return body


async def get_bnb_usd() -> dict:
    """BNB/USD from the pool's TWAP, or a withheld answer saying why not.

    Cached in memory for CACHE_TTL_SECONDS (FAILURE_TTL_SECONDS for a withheld
    answer). One read at a time: a request arriving during a read waits for it
    and gets its result rather than starting a second one."""
    now = time.time()
    if _cache["body"] is not None and now - _cache["at"] < _cache["ttl"]:
        return _with_age(_cache["body"], now)
    async with _lock:
        now = time.time()
        if _cache["body"] is not None and now - _cache["at"] < _cache["ttl"]:
            return _with_age(_cache["body"], now)
        try:
            body = await asyncio.wait_for(_read(), timeout=READ_DEADLINE_SECONDS)
            ttl = CACHE_TTL_SECONDS
        except _Withheld as w:
            body, ttl = _withheld_body(w), FAILURE_TTL_SECONDS
        except asyncio.TimeoutError:
            body, ttl = _withheld_body(_Withheld("read_deadline")), FAILURE_TTL_SECONDS
        except Exception as e:  # noqa: BLE001
            body, ttl = _withheld_body(_Withheld("read_failed", describe(e))), FAILURE_TTL_SECONDS
        now = time.time()
        _cache.update(body=body, at=now, ttl=ttl)
        return _with_age(body, now)


def _with_age(body: dict, now: float) -> dict:
    out = dict(body)
    out["cache"] = {"age_seconds": round(now - _cache["at"], 1), "ttl_seconds": _cache["ttl"]}
    return out
