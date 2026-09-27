"""Multicall3 aggregate3 (allowFailure) at a pinned block. Multicall3 is at
0xcA11...CA11 on all six chains the cost engine reads (3,808 bytes, T0)."""

from __future__ import annotations

from eth_abi import decode, encode
from eth_utils import function_signature_to_4byte_selector as _sel

from .rpcclient import ChainRpc

MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11"
_AGG3 = _sel("aggregate3((address,bool,bytes)[])")


def aggregate3(rpc: ChainRpc, calls: list[tuple[str, bytes]], block: int, *, chunk: int = 400) -> list[bytes | None]:
    """Returns each call's return data, or None where it failed."""
    out: list[bytes | None] = []
    for i in range(0, len(calls), chunk):
        part = calls[i:i + chunk]
        data = "0x" + (_AGG3 + encode(["(address,bool,bytes)[]"], [[(t, True, d) for t, d in part]])).hex()
        raw = rpc.eth_call(MULTICALL3, data, block)
        (res,) = decode(["(bool,bytes)[]"], bytes.fromhex(raw[2:]))
        out.extend(bytes(r) if ok and r else None for ok, r in res)
    return out
