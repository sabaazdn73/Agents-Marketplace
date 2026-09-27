"""
v3_walk.py

An independent re-quote for V3-math pools (Uniswap V3 and forks that keep
its swap arithmetic): the pool's state is read at a block (slot0, liquidity,
fee, tickSpacing, and tickBitmap words and ticks as the walk needs them) and
the exact-input swap is computed here, in integers, from ports of TickMath,
SqrtPriceMath, SwapMath and TickBitmap. It runs no pool code, so it checks
the probe's answer rather than repeating it. Used by te_cost_selfcheck.

Not covered: Algebra (plugin fees), V4 and Infinity (hooks). A pool whose
slot0() does not answer is refused, not guessed.
"""

from __future__ import annotations

from eth_abi import decode, encode

from .rpcclient import ChainRpc

Q96 = 1 << 96
U256 = 1 << 256
MIN_TICK, MAX_TICK = -887272, 887272
_MUL = [0xfff97272373d413259a46990580e213a, 0xfff2e50f5f656932ef12357cf3c7fdcc, 0xffe5caca7e10e4e61c3624eaa0941cd0,
        0xffcb9843d60f6159c9db58835c926644, 0xff973b41fa98c081472e6896dfb254c0, 0xff2ea16466c96a3843ec78b326b52861,
        0xfe5dee046a99a2a811c461f1969c3053, 0xfcbe86c7900a88aedcffc83b479aa3a4, 0xf987a7253ac413176f2b074cf7815e54,
        0xf3392b0822b70005940c7a398e4b70f3, 0xe7159475a2c29b7443b29c7fa6e889d9, 0xd097f3bdfd2022b8845ad8f792aa5825,
        0xa9f746462d870fdf8a65dc1f90e061e5, 0x70d869a156d2a1b890bb3df62baf32f7, 0x31be135f97d08fd981231505542fcfa6,
        0x9aa508b5b7a84e1c677de54f3e99bc9, 0x5d6af8dedb81196699c329225ee604, 0x2216e584f5fa1ea926041bedfe98,
        0x48a170391f7dc42444e8fa2]


def sqrt_at_tick(tick: int) -> int:
    a = abs(tick)
    r = 0xfffcb933bd6fad37aa2d162d1a594001 if a & 1 else 1 << 128
    for i, m in enumerate(_MUL):
        if a & (2 << i):
            r = (r * m) >> 128
    if tick > 0:
        r = (U256 - 1) // r
    return (r >> 32) + (1 if r % (1 << 32) else 0)


def _mul_div(a, b, d): return a * b // d
def _mul_div_up(a, b, d): q, r = divmod(a * b, d); return q + (1 if r else 0)
def _div_up(a, b): return a // b + (1 if a % b else 0)


def _amount0(sa, sb, L, up):
    if sa > sb:
        sa, sb = sb, sa
    n1, n2 = L << 96, sb - sa
    return _div_up(_mul_div_up(n1, n2, sb), sa) if up else _mul_div(n1, n2, sb) // sa


def _amount1(sa, sb, L, up):
    if sa > sb:
        sa, sb = sb, sa
    return _mul_div_up(L, sb - sa, Q96) if up else _mul_div(L, sb - sa, Q96)


def _next_from_input(sp, L, amt, zf):
    if zf:                                  # getNextSqrtPriceFromAmount0RoundingUp, add
        if amt == 0:
            return sp
        n1 = L << 96
        product = amt * sp
        if product < U256 and n1 + product < U256:
            return _mul_div_up(n1, sp, n1 + product)
        return _div_up(n1, n1 // sp + amt)
    q = (amt << 96) // L if amt < (1 << 160) else _mul_div(amt, Q96, L)   # FromAmount1RoundingDown, add
    return sp + q


def _step(sp, target, L, remaining, fee):
    zf = sp >= target
    less_fee = _mul_div(remaining, 1_000_000 - fee, 1_000_000)
    ain = _amount0(target, sp, L, True) if zf else _amount1(sp, target, L, True)
    nxt = target if less_fee >= ain else _next_from_input(sp, L, less_fee, zf)
    full = nxt == target
    if zf:
        ain = ain if full else _amount0(nxt, sp, L, True)
        aout = _amount1(nxt, sp, L, False)
    else:
        ain = ain if full else _amount1(sp, nxt, L, True)
        aout = _amount0(sp, nxt, L, False)
    fee_amt = remaining - ain if nxt != target else _mul_div_up(ain, fee, 1_000_000 - fee)
    return nxt, ain, aout, fee_amt


def _lsb(x): return (x & -x).bit_length() - 1
def _msb(x): return x.bit_length() - 1


class _Pool:
    def __init__(self, rpc: ChainRpc, pool: str, block: int):
        self.rpc, self.pool, self.block = rpc, pool, block
        self.words: dict[int, int] = {}

    def call(self, data: str) -> str:
        return self.rpc.eth_call(self.pool, data, self.block)

    def word(self, pos: int) -> int:
        if pos not in self.words:
            self.words[pos] = int(self.call("0x5339c296" + encode(["int16"], [pos]).hex()), 16)
        return self.words[pos]

    def liquidity_net(self, tick: int) -> int:
        raw = bytes.fromhex(self.call("0xf30dba93" + encode(["int24"], [tick]).hex())[2:])
        return decode(["uint128", "int128"], raw[:64])[1]

    def next_tick(self, tick: int, spacing: int, lte: bool) -> tuple[int, bool]:
        c = tick // spacing
        if lte:
            pos, bit = c >> 8, c & 255
            masked = self.word(pos) & ((1 << bit) - 1 + (1 << bit))
            return ((c - (bit - _msb(masked))) * spacing, True) if masked else ((c - bit) * spacing, False)
        c += 1
        pos, bit = c >> 8, c & 255
        masked = self.word(pos) & ((U256 - 1) ^ ((1 << bit) - 1))
        return ((c + (_lsb(masked) - bit)) * spacing, True) if masked else ((c + (255 - bit)) * spacing, False)


def quote_exact_in(rpc: ChainRpc, pool: str, zero_for_one: bool, amount_in: int, block: int,
                   limit_sqrt_bps: int = 20_000) -> dict:
    """Output and input used of an exact-input swap, computed from the pool's
    state at `block` with the same price limit the probe uses."""
    p = _Pool(rpc, pool, block)
    s0 = p.call("0x3850c7bd")
    if not s0 or s0 == "0x" or len(s0) < 2 + 128:
        return {"ok": False, "reason": "slot0() did not answer: not V3 math"}
    sp, tick = decode(["uint160", "int24"], bytes.fromhex(s0[2:])[:64])
    L = int(p.call("0x1a686502"), 16)
    fee = int(p.call("0xddca3f43"), 16)
    spacing = decode(["int24"], bytes.fromhex(p.call("0xd0c93a7c")[2:])[:32])[0]
    limit = sp * 10_000 // limit_sqrt_bps if zero_for_one else sp * limit_sqrt_bps // 10_000
    limit = max(4295128740, min(1461446703485210103287273052203988822378723970341, limit))
    remaining, out, steps = amount_in, 0, 0
    while remaining and sp != limit and steps < 2000:
        steps += 1
        nt, init = p.next_tick(tick, spacing, zero_for_one)
        nt = max(MIN_TICK, min(MAX_TICK, nt))
        sp_next = sqrt_at_tick(nt)
        target = limit if (sp_next < limit if zero_for_one else sp_next > limit) else sp_next
        sp, ain, aout, fee_amt = _step(sp, target, L, remaining, fee)
        remaining -= ain + fee_amt
        out += aout
        if sp == sp_next:
            if init:
                net = p.liquidity_net(nt)
                L += -net if zero_for_one else net
            tick = nt - 1 if zero_for_one else nt
        else:
            break
    return {"ok": True, "out": out, "in_used": amount_in - remaining, "steps": steps, "fee_ppm": fee,
            "reads": 4 + len(p.words)}
