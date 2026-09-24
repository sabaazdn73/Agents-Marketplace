"""Depth of the USD reference pools, and the chain reads section 4.2.1 cites.

Run: ./venv/bin/python scripts/te_reference_depth.py

Prints every figure mcp/TOKENIZED-EQUITIES.md section 4.2.1 and the measurements
record cite for the USD references:

  at block 71,615,602  the V4 and Uniswap V3 pools pairing USDe with USDG, how
                       many hold liquidity, and the USDe-quoted stock pools
  at block 71,627,504  for the V3 WETH/USDG fee-100 pool and every live V4
                       USDe/USDG pool: execution impact at 10,000 USDG, the USDG
                       that moves the mid 10 bps, and the USDG for a 10 bps
                       execution impact, in both directions
                       and a cross-check of the tick walk against a real swap
                       run by the quoter below, injected by state override
  at block 71,629,036  USDC's name, symbol, decimals and totalSupply

THE WALK. From slot0 and liquidity, 40 ticks either side of the current tick
are read (ticks() on V3; extsload of the V4 tick mapping at pool base + 4) and
the swap is walked across initialised ticks with constant liquidity between
them. Impact is the execution price against the pre-trade mid, fees excluded.
"Moves the mid 10 bps" is the size at which the post-trade mid is 10 bps away.

THE QUOTER. The Solidity below was compiled with solc 0.8.26, optimizer on at
200 runs, against v4-core (commit not recorded). QUOTER_RUNTIME is the
deployedBytecode of that build, byte for byte. It performs the real swap inside
PoolManager.unlock and reverts with the balance delta, so the arithmetic is the
PoolManager's own. It is placed at an unused address with eth_call state
override and never deployed.

ENDPOINTS. TE_ARCHIVE_RPC (default https://robinhood.drpc.org) for state at a
past block, which the chain's public RPC does not serve; TE_LOG_RPC (default
https://rpc.mainnet.chain.robinhood.com) for logs. No key is used. Only the
scheme and host of an endpoint are ever printed.
"""
from __future__ import annotations

import os
import sys
import time
from urllib.parse import urlsplit

import httpx
from eth_abi import decode, encode
from eth_utils import keccak

ARCHIVE_RPC = os.environ.get("TE_ARCHIVE_RPC", "https://robinhood.drpc.org")
LOG_RPC = os.environ.get("TE_LOG_RPC", "https://rpc.mainnet.chain.robinhood.com")

COUNT_BLOCK = 71615602
DEPTH_BLOCK = 71627504
USDC_BLOCK = 71629036

PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
MC = "0xcA11bde05977b3631167028862bE2a173976CA11"
V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa"
BEACON = "0xe10b6f6b275de231345c20d14ab812db62151b00"
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
USDE = "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34"
USDC = "0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8"
WETH_USDG_V3 = "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca"
QUOTER_AT = "0x0000000000000000000000000000000000000001"
RANGE = 40

QUOTER_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @notice Minimal v4 quoter: performs the real swap inside unlock and reverts with the delta,
/// so all arithmetic is the PoolManager's own. Intended to be injected via eth_call state override.
contract Q is IUnlockCallback {
    IPoolManager public constant pm = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);

    struct Args {
        PoolKey key;
        bool zeroForOne;
        int256 amountSpecified; // negative = exactIn
    }

    /// @dev returns (amount0, amount1) as int128s of the BalanceDelta; reverts are surfaced as-is
    function quote(PoolKey calldata key, bool zeroForOne, int256 amountSpecified)
        external
        returns (int128 amount0, int128 amount1)
    {
        try pm.unlock(abi.encode(Args(key, zeroForOne, amountSpecified))) {
            revert("norevert");
        } catch (bytes memory reason) {
            if (reason.length != 32) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
            int256 packed = abi.decode(reason, (int256));
            amount0 = int128(packed >> 128);
            amount1 = int128(int256(uint256(packed) & type(uint128).max));
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "pm");
        Args memory a = abi.decode(data, (Args));
        BalanceDelta d = pm.swap(
            a.key,
            IPoolManager.SwapParams({
                zeroForOne: a.zeroForOne,
                amountSpecified: a.amountSpecified,
                sqrtPriceLimitX96: a.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int256 packed = (int256(d.amount0()) << 128) | int256(uint256(uint128(d.amount1())));
        assembly {
            let p := mload(0x40)
            mstore(p, packed)
            revert(p, 32)
        }
    }
}
"""

QUOTER_RUNTIME = (
    "0x608060405234801561000f575f80fd5b506004361061003f575f3560e01c80638970cdff1461004357806391dd7346"
    "1461007b5780639c88305d1461009b575b5f80fd5b61005e738366a39cc670b4001a1121b8f6a443a643e4095181565b"
    "6040516001600160a01b0390911681526020015b60405180910390f35b61008e6100893660046103bc565b6100c8565b"
    "604051610072919061042a565b6100ae6100a9366004610473565b610243565b60408051600f93840b81529190920b60"
    "2082015201610072565b606033738366a39cc670b4001a1121b8f6a443a643e40951146101175760405162461bcd60e5"
    "1b8152602060048201526002602482015261706d60f01b60448201526064015b60405180910390fd5b5f610124838501"
    "856105c8565b90505f738366a39cc670b4001a1121b8f6a443a643e409516001600160a01b031663f3cd914c835f0151"
    "604051806060016040528086602001511515815260200186604001518152602001866020015161019c57610197600173"
    "fffd8963efd1fc6a506488495d951d5263988d26610643565b6101ac565b6101ac6401000276a36001610668565b6001"
    "600160a01b03168152506040518363ffffffff1660e01b81526004016101d59291906106ca565b602060405180830381"
    "5f875af11580156101f1573d5f803e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610215"
    "9190610714565b90505f61022282600f0b90565b6001600160801b0316608083811d600f0b901b179050604051818152"
    "602081fd5b5f80738366a39cc670b4001a1121b8f6a443a643e409516001600160a01b03166348c89491604051806060"
    "016040528088803603810190610284919061072b565b81526020018715158152602001868152506040516020016102a5"
    "919061074c565b6040516020818303038152906040526040518263ffffffff1660e01b81526004016102d0919061042a"
    "565b5f604051808303815f875af192505050801561030d57506040513d5f823e601f3d908101601f1916820160405261"
    "030a9190810190610779565b60015b610380573d80801561033a576040519150601f19603f3d011682016040523d8252"
    "3d5f602084013e61033f565b606091505b50805160201461035157805160208201fd5b5f818060200190518101906103"
    "669190610714565b608081901d94506001600160801b031692506103b4915050565b5060405162461bcd60e51b815260"
    "20600482015260086024820152671b9bdc995d995c9d60c21b604482015260640161010e565b935093915050565b5f80"
    "602083850312156103cd575f80fd5b823567ffffffffffffffff8111156103e3575f80fd5b8301601f810185136103f3"
    "575f80fd5b803567ffffffffffffffff811115610409575f80fd5b85602082840101111561041a575f80fd5b60209190"
    "91019590945092505050565b602081525f82518060208401528060208501604085015e5f604082850101526040601f19"
    "601f83011684010191505092915050565b8035801515811461046e575f80fd5b919050565b5f805f83850360e0811215"
    "610486575f80fd5b60a0811215610493575f80fd5b508392506104a360a0850161045f565b9295929450505060c09190"
    "91013590565b634e487b7160e01b5f52604160045260245ffd5b60405160a0810167ffffffffffffffff811182821017"
    "156104eb576104eb6104b4565b60405290565b604051601f8201601f1916810167ffffffffffffffff81118282101715"
    "61051a5761051a6104b4565b604052919050565b6001600160a01b0381168114610536575f80fd5b50565b803561046e"
    "81610522565b5f60a08284031215610554575f80fd5b61055c6104c8565b9050813561056981610522565b8152602082"
    "013561057981610522565b6020820152604082013562ffffff81168114610593575f80fd5b6040820152606082013560"
    "0281900b81146105ac575f80fd5b60608201526105bd60808301610539565b608082015292915050565b5f60e0828403"
    "1280156105d9575f80fd5b506040516060810167ffffffffffffffff811182821017156105fd576105fd6104b4565b60"
    "405261060a8484610544565b815261061860a0840161045f565b602082015260c0929092013560408301525091905056"
    "5b634e487b7160e01b5f52601160045260245ffd5b6001600160a01b0382811682821603908111156106625761066261"
    "062f565b92915050565b6001600160a01b0381811683821601908111156106625761066261062f565b80516001600160"
    "a01b03908116835260208083015182169084015260408083015162ffffff169084015260608083015160020b90840152"
    "60809182015116910152565b6106d48184610687565b8151151560a0820152602082015160c082015260409091015160"
    "01600160a01b031660e082015261012061010082018190525f9082015261014001919050565b5f602082840312156107"
    "24575f80fd5b5051919050565b5f60a0828403121561073b575f80fd5b6107458383610544565b9392505050565b5f60"
    "e08201905061075e828451610687565b6020830151151560a083015260409092015160c09091015290565b5f60208284"
    "031215610789575f80fd5b815167ffffffffffffffff81111561079f575f80fd5b8201601f810184136107af575f80fd"
    "5b805167ffffffffffffffff8111156107c9576107c96104b4565b6107dc601f8201601f19166020016104f1565b8181"
    "528560208385010111156107f0575f80fd5b8160208401602083015e5f9181016020019190915294935050505056fea2"
    "6469706673582212200a001c86dd511ff10533a034dc5ddecf994c4682543da3f6b196f0fdff49a65d64736f6c634300"
    "081a0033"
)

_client = httpx.Client(timeout=300)


def host(url: str) -> str:
    u = urlsplit(url)
    return f"{u.scheme}://{u.hostname}"


def rpc(url, method, params):
    for attempt in range(8):
        try:
            r = _client.post(url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
            if r.status_code in (429, 500, 502, 503, 504):
                raise httpx.HTTPError(f"status {r.status_code}")
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, ValueError) as e:
            print(f"  retry {attempt + 1} at {host(url)}: {type(e).__name__}", file=sys.stderr)
            time.sleep(min(60, 2 * 2 ** attempt))
    raise RuntimeError(f"{method} failed after retries at {host(url)}")


def sel(sig):
    return keccak(text=sig)[:4]


def call(to, data, block, override=None):
    params = [{"to": to, "data": "0x" + data.hex()}, hex(block)]
    if override:
        params.append(override)
    r = rpc(ARCHIVE_RPC, "eth_call", params)
    if "result" not in r:
        raise RuntimeError(f"eth_call at {block} via {host(ARCHIVE_RPC)}: "
                           f"error code {(r.get('error') or {}).get('code')}")
    return bytes.fromhex(r["result"][2:])


def logs(address, topics, hi):
    out, lo, win = [], 0, hi + 1
    while lo <= hi:
        end = min(hi, lo + win - 1)
        r = rpc(LOG_RPC, "eth_getLogs", [{"address": address, "topics": topics,
                                          "fromBlock": hex(lo), "toBlock": hex(end)}])
        if "result" not in r:
            if win <= 1000:
                raise RuntimeError(f"getLogs {address} {lo}-{end} via {host(LOG_RPC)}: "
                                   f"error code {(r.get('error') or {}).get('code')}")
            win = max(1000, win // 4)
            continue
        out += r["result"]
        lo = end + 1
    return out


def pad(a):
    return "0x" + "0" * 24 + a[2:]


def s24(v):
    v &= (1 << 24) - 1
    return v - (1 << 24) if v >= (1 << 23) else v


def s128(v):
    return v - (1 << 128) if v >= (1 << 127) else v


def aggregate(calls, block):
    raw = call(MC, sel("aggregate((address,bytes)[])") + encode(["(address,bytes)[]"], [calls]), block)
    return decode(["uint256", "bytes[]"], raw)[1]


def extsload(slots, block):
    raw = call(PM, sel("extsload(bytes32[])") + encode(["bytes32[]"], [[s.to_bytes(32, "big") for s in slots]]), block)
    return [int.from_bytes(w, "big") for w in decode(["bytes32[]"], raw)[0]]


def v4_base(pid):
    return int.from_bytes(keccak(bytes.fromhex(pid[2:]) + (6).to_bytes(32, "big")), "big")


def v3_state(pool, block):
    r = aggregate([(pool, sel("slot0()")), (pool, sel("liquidity()")), (pool, sel("token0()"))], block)
    sp = int.from_bytes(r[0][:32], "big")
    tick = s24(int.from_bytes(r[0][32:64], "big"))
    ticks = list(range(tick - RANGE, tick + RANGE + 1))
    rr = aggregate([(pool, sel("ticks(int24)") + encode(["int24"], [t])) for t in ticks], block)
    net = {t: decode(["uint128", "int128"], x[:64])[1] for t, x in zip(ticks, rr)}
    return sp, tick, int.from_bytes(r[1], "big"), "0x" + r[2][12:].hex(), net


def v4_state(pid, block):
    base = v4_base(pid)
    s0, liq = extsload([base, base + 3], block)
    tick = s24(s0 >> 160)
    ticks = list(range(tick - RANGE, tick + RANGE + 1))
    words = extsload([int.from_bytes(keccak(encode(["int24"], [t]) + (base + 4).to_bytes(32, "big")), "big")
                      for t in ticks], block)
    return s0 & ((1 << 160) - 1), tick, liq, {t: s128(w >> 128) for t, w in zip(ticks, words)}, s0


def walk(sp, tick, liq, net, target):
    """(amount0, amount1) that move sqrt price from sp to target, crossing initialised ticks."""
    s, L, d0, d1 = sp / 2 ** 96, liq, 0.0, 0.0
    if target > s:
        t = tick + 1
        while s < target:
            if t > tick + RANGE:
                return None
            b = min(target, 1.0001 ** (t / 2))
            d1 += L * (b - s)
            d0 += L * (1 / s - 1 / b)
            s = b
            if s < target:
                L += net.get(t, 0)
            t += 1
    else:
        t = tick
        while s > target:
            if t < tick - RANGE:
                return None
            b = max(target, 1.0001 ** (t / 2))
            d1 += L * (s - b)
            d0 += L * (1 / b - 1 / s)
            s = b
            if s > target:
                L -= net.get(t, 0)
            t -= 1
    return d0, d1


def usdg_leg(w, usdg_is_0):
    return w[0] / 1e6 if usdg_is_0 else w[1] / 1e6


def measure(state, usdg_is_0):
    sp, tick, liq, net = state[:4]
    s0 = sp / 2 ** 96
    p0 = s0 * s0
    out = {}
    for d in ("up", "down"):
        f = 1.001 ** 0.5
        w = walk(sp, tick, liq, net, s0 * f if d == "up" else s0 / f)
        mid = usdg_leg(w, usdg_is_0) if w else None
        lo, hi, ex = 1.0, 1.006 ** 0.5, None
        for _ in range(60):
            m = (lo + hi) / 2
            w = walk(sp, tick, liq, net, s0 * m if d == "up" else s0 / m)
            if w is None or abs((w[1] / w[0]) / p0 - 1) * 1e4 >= 10:
                hi = m
            else:
                lo, ex = m, usdg_leg(w, usdg_is_0)
        lo, hi = 1.0, 1.01
        for _ in range(80):
            m = (lo + hi) / 2
            w = walk(sp, tick, liq, net, s0 * m if d == "up" else s0 / m)
            if w is None or usdg_leg(w, usdg_is_0) > 10000:
                hi = m
            else:
                lo = m
        w = walk(sp, tick, liq, net, s0 * lo if d == "up" else s0 / lo)
        out[d] = (mid, ex, abs((w[1] / w[0]) / p0 - 1) * 1e4)
    return out


def show(label, m):
    up, dn = m["up"], m["down"]
    print(f"  {label}")
    print(f"    impact at 10,000 USDG: {up[2]:.4f} bps price up, {dn[2]:.4f} bps price down")
    print(f"    USDG that moves the mid 10 bps: {up[0]:,.0f} up, {dn[0]:,.0f} down")
    print(f"    USDG for 10 bps execution impact: {up[1]:,.0f} up, {dn[1]:,.0f} down")


def usde_usdg_v4_pools(block):
    init = "0x" + keccak(text="Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)").hex()
    ls = logs(PM, [init, None, pad(USDE), pad(USDG)], block)
    return [(l["topics"][1], decode(["uint24", "int24", "address"], bytes.fromhex(l["data"][2:])[:96])) for l in ls]


def main():
    print(f"archive {host(ARCHIVE_RPC)}, logs {host(LOG_RPC)}")

    # --- counts at COUNT_BLOCK
    pools = usde_usdg_v4_pools(COUNT_BLOCK)
    liqs = extsload([v4_base(p) + 3 for p, _ in pools], COUNT_BLOCK)
    pc = "0x" + keccak(text="PoolCreated(address,address,uint24,int24,address)").hex()
    v3 = ["0x" + l["data"][-40:] for l in logs(V3_FACTORY, [pc, pad(USDE), pad(USDG)], COUNT_BLOCK)]
    v3l = [int.from_bytes(call(a, sel("liquidity()"), COUNT_BLOCK), "big") for a in v3]
    bu = logs(None, ["0x1cf3b03a6cf19fa2baba4df148e9dcabedea7f8a5c07840e207e5c089be95d3e", pad(BEACON)], COUNT_BLOCK)
    stocks = {l["address"].lower() for l in bu}
    init = "0x" + keccak(text="Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)").hex()
    ls = logs(PM, [init, None, pad(USDE)], COUNT_BLOCK) + logs(PM, [init, None, None, pad(USDE)], COUNT_BLOCK)
    sp = [l["topics"][1] for l in ls
          if ("0x" + l["topics"][2][26:] if l["topics"][3] == pad(USDE) else "0x" + l["topics"][3][26:]) in stocks]
    spl = extsload([v4_base(p) + 3 for p in sp], COUNT_BLOCK)
    print(f"at block {COUNT_BLOCK}: {len(stocks)} stock tokens; USDe/USDG pools: V4 {len(pools)}, "
          f"{sum(1 for x in liqs if x)} with liquidity; Uniswap V3 {len(v3)}, {sum(1 for x in v3l if x)} with "
          f"liquidity; USDe-quoted V4 stock pools {len(sp)}, {sum(1 for x in spl if x)} live")

    # --- depth at DEPTH_BLOCK
    print(f"at block {DEPTH_BLOCK}:")
    st = v3_state(WETH_USDG_V3, DEPTH_BLOCK)
    show(f"V3 WETH/USDG fee 100 {WETH_USDG_V3} (price up = buying ETH)", measure(st[:3] + (st[4],), st[3] == USDG))
    live = [(p, k) for p, k in usde_usdg_v4_pools(DEPTH_BLOCK)]
    rows = []
    for p, (fee, ts, hooks) in live:
        state = v4_state(p, DEPTH_BLOCK)
        if state[2]:
            rows.append((p, fee, ts, hooks, measure(state, False)))
    rows.sort(key=lambda r: -min(r[4]["up"][0], r[4]["down"][0]))
    print(f"  V4 USDe/USDG pools with liquidity: {len(rows)} (price up = buying USDe)")
    show(f"deepest {rows[0][0]} fee {rows[0][1]} hooks {rows[0][3]}", rows[0][4])
    for p, fee, ts, hooks, m in rows[1:]:
        print(f"    other {p[:12]}… fee {fee}: mid 10 bps at {min(m['up'][0], m['down'][0]):,.3f} USDG on its worse side")

    # --- quoter cross-check on the deepest
    p, fee, ts, hooks, _ = rows[0]
    key = (USDE, USDG, fee, ts, hooks)
    state = v4_state(p, DEPTH_BLOCK)
    s0w = state[4]
    pf, lp = (s0w >> 184) & 0xFFFFFF, (s0w >> 208) & 0xFFFFFF
    fee_1to0 = (pf >> 12) + lp - (pf >> 12) * lp / 1e6
    s = state[0] / 2 ** 96
    print(f"  cross-check on {p[:12]}…: protocol fee 1->0 {pf >> 12} pips, lp fee {lp} pips")
    for usdg in (50000, 100000, 150000, 213323):
        data = sel("quote((address,address,uint24,int24,address),bool,int256)") + encode(
            ["(address,address,uint24,int24,address)", "bool", "int256"], [key, False, -usdg * 10 ** 6])
        a0, _ = decode(["int128", "int128"], call(QUOTER_AT, data, DEPTH_BLOCK, {QUOTER_AT: {"code": QUOTER_RUNTIME}}))
        net_in = usdg * 1e6 * (1 - fee_1to0 / 1e6)
        lo, hi = s, s * 1.01
        for _ in range(80):
            m = (lo + hi) / 2
            w = walk(*state[:4], m)
            if w is None or w[1] > net_in:
                hi = m
            else:
                lo = m
        w = walk(*state[:4], lo)
        print(f"    {usdg:>7,} USDG in: quoter {a0 / 1e18:,.6f} USDe out, walk {w[0] / 1e18:,.6f}, "
              f"relative difference {w[0] / a0 - 1:.2e}")

    # --- USDC
    def s_(sig):
        return call(USDC, sel(sig), USDC_BLOCK)
    print(f"at block {USDC_BLOCK}: {USDC} name {decode(['string'], s_('name()'))[0]!r}, symbol "
          f"{decode(['string'], s_('symbol()'))[0]!r}, decimals {int.from_bytes(s_('decimals()'), 'big')}, "
          f"totalSupply {int.from_bytes(s_('totalSupply()'), 'big'):,} raw")
    return 0


if __name__ == "__main__":
    sys.exit(main())
