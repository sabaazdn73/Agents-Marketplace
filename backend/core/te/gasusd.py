"""
gasusd.py

The network-fee side of a cost row, in dollars, from our own reads:

  gas_usd = (probe venue gas + 21,000 + 60,000 router allowance) x gas price x native_usd
            + L1 data fee on rollups:
              Base: GasPriceOracle 0x42..0F getL1FeeUpperBound(600)
              Arbitrum and Robinhood Chain: NodeInterface 0x..C8
                gasEstimateL1Component(router, false, 600 bytes) x L2 base fee

The 21,000 is the transaction base cost and 60,000 an allowance for the
router's own work around the pool call (the spec's figure, not measured).
600 bytes is the spec's size for a router swap's calldata; the bytes passed
to NodeInterface are pseudo-random so they do not compress better than a
real transaction would.

native_usd is a 30-minute time-weighted average from a Uniswap-v3-style
pool's observe(), computed with core/v3_oracle.py:
  ETH:  Uniswap V3 USDC/WETH 0.05% on Ethereum (0x88e6...5640)
  BNB:  the PancakeSwap v3 WBNB/USDT pool core/bnb_usd.py reads
  HYPE: WHYPE/USDC 0.05% on HyperEVM (0x6c9a...9285, ProjectX factory, T0)
The stablecoin side is taken at $1, a labelled assumption.
"""

from __future__ import annotations

import hashlib

from eth_abi import decode, encode
from eth_utils import function_signature_to_4byte_selector as _sel

from .. import v3_oracle
from ..bnb_usd import POOL as BNB_POOL
from .chains import CHAINS, router_for
from .rpcclient import ChainRpc, RpcError

TX_BASE_GAS = 21_000
ROUTER_ALLOWANCE_GAS = 60_000
CALLDATA_BYTES = 600
TWAP_SECONDS = 1800

NATIVE_REF = {
    "ETH": {"chain_id": 1, "pool": "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640", "label": "Uniswap V3 USDC/WETH 0.05%, Ethereum"},
    "BNB": {"chain_id": 56, "pool": BNB_POOL, "label": "PancakeSwap v3 WBNB/USDT, BNB Chain (core/bnb_usd.py)"},
    "HYPE": {"chain_id": 999, "pool": "0x6c9a33e3b592c0d65b3ba59355d5be0d38259285", "label": "WHYPE/USDC 0.05%, HyperEVM"},
}

_OBSERVE = _sel("observe(uint32[])")
_DECIMALS = bytes.fromhex("313ce567")
_L1_UPPER = _sel("getL1FeeUpperBound(uint256)")
_ARB_L1 = _sel("gasEstimateL1Component(address,bool,bytes)")
GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000f"
NODE_INTERFACE = "0x00000000000000000000000000000000000000c8"


def _addr(word: str) -> str:
    return "0x" + word[-40:]


def native_usd(rpc: ChainRpc, native: str, block: int | str = "latest") -> dict:
    """30-minute TWAP of the native asset in dollars, with its source."""
    ref = NATIVE_REF[native]
    pool = ref["pool"]
    t0 = _addr(rpc.eth_call(pool, "0x0dfe1681", block))
    t1 = _addr(rpc.eth_call(pool, "0xd21220a7", block))
    d0 = int(rpc.eth_call(t0, "0x" + _DECIMALS.hex(), block), 16)
    d1 = int(rpc.eth_call(t1, "0x" + _DECIMALS.hex(), block), 16)
    raw = rpc.eth_call(pool, "0x" + (_OBSERVE + encode(["uint32[]"], [[TWAP_SECONDS, 0]])).hex(), block)
    tcs, _ = decode(["int56[]", "uint160[]"], bytes.fromhex(raw[2:]))
    tick = v3_oracle.mean_tick(tcs[0], tcs[1], TWAP_SECONDS)
    wrapped = CHAINS[ref["chain_id"]]["wrapped_native"]
    price = v3_oracle.asset_price_from_tick(tick, wrapped, t0, d0, d1)
    return {"usd": price, "source": ref["label"], "pool": pool, "chain_id": ref["chain_id"],
            "window_seconds": TWAP_SECONDS, "block": block, "assumption": "stablecoin side at $1"}


def _calldata_sample() -> bytes:
    out, seed = b"", b"tnega-l1-fee-sample"
    while len(out) < CALLDATA_BYTES:
        seed = hashlib.sha256(seed).digest()
        out += seed
    return out[:CALLDATA_BYTES]


def l1_fee_wei(rpc: ChainRpc, chain_id: int, block: int) -> dict:
    kind = CHAINS[chain_id].get("l1_fee")
    if kind is None:
        return {"wei": 0, "method": "no L1 data fee on this chain"}
    if kind == "op_gas_price_oracle":
        raw = rpc.eth_call(GAS_PRICE_ORACLE, "0x" + (_L1_UPPER + encode(["uint256"], [CALLDATA_BYTES])).hex(), block)
        return {"wei": int(raw, 16), "method": f"GasPriceOracle.getL1FeeUpperBound({CALLDATA_BYTES})"}
    if kind == "arb_node_interface":
        router = router_for(chain_id, "default") or "0x000000000000000000000000000000000054e9a0"
        data = "0x" + (_ARB_L1 + encode(["address", "bool", "bytes"], [router, False, _calldata_sample()])).hex()
        raw = rpc.eth_call(NODE_INTERFACE, data, block)
        gas_l1, base_fee, l1_base = decode(["uint64", "uint256", "uint256"], bytes.fromhex(raw[2:]))
        return {"wei": gas_l1 * base_fee, "gas_for_l1": gas_l1, "l2_base_fee": base_fee, "l1_base_fee_estimate": l1_base,
                "method": f"NodeInterface.gasEstimateL1Component(router, false, {CALLDATA_BYTES} bytes) x L2 base fee"}
    raise ValueError(kind)


def gas_context(rpc: ChainRpc, chain_id: int, block: int, native_px: dict) -> dict:
    """Everything a row needs to turn venue gas into dollars, read once per refresh."""
    gp = int(rpc.call("eth_gasPrice", []), 16)
    try:
        l1 = l1_fee_wei(rpc, chain_id, block)
    except RpcError as e:
        l1 = {"wei": None, "error": f"{e.kind}: {e.message[:160]}"}
    usd = native_px["usd"]
    return {
        "gas_price_wei": gp, "native": CHAINS[chain_id]["native"], "native_usd": usd,
        "native_usd_source": native_px["source"], "l1": l1,
        "l1_fee_usd": (l1["wei"] / 1e18 * usd) if l1.get("wei") is not None else None,
        "overhead_gas": TX_BASE_GAS + ROUTER_ALLOWANCE_GAS,
    }


def gas_usd(ctx: dict, venue_gas: int) -> tuple[float | None, float | None]:
    """(execution gas in dollars, L1 data fee in dollars). None if the L1
    part could not be read: the caller must then not report a total."""
    ex = (venue_gas + ctx["overhead_gas"]) * ctx["gas_price_wei"] / 1e18 * ctx["native_usd"]
    return ex, ctx["l1_fee_usd"]
