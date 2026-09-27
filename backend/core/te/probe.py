"""
probe.py

Drives TnegaSwapProbe (contracts/src/TnegaSwapProbe.sol) through eth_call
with its runtime injected by state override. Nothing is deployed, no key or
balance is needed, and nothing persists.

One quoteMany call returns, per quote: the pool-side deltas, the gas the
venue call spent (success or not) and the grant it had, the pool's price
before the swap read in the same call, and the price limit the swap ran
with. This module turns that into a result a cost row can use, and names
every failure:

  ok             the swap ran; `paid` and `received` are exact at the block
  partial        ran, but paid less than asked (the pool ran out, or the
                 price limit was reached first): filled_fraction < 1
  out_of_gas     an empty revert that used at least 97% of its grant. An
                 empty revert with gas left is `empty_revert`: a different
                 failure, and not a zero
  gated_by_hook  a V4 hook refused the swap (WrappedError); the probe runs at
                 the chain's router address, so this is what the router sees
  sign_check     the deltas had the wrong signs (the probe refuses them)
  reverted       any other revert, with its selector or message
  batch_gas      earlier quotes in the same call used the gas up; re-sent
  no_price       the pool's price could not be read, so no mid exists
  zero_output    the swap ran and paid out nothing (dust against a thin pool)

A failed quote is never a zero.
"""

from __future__ import annotations

from dataclasses import dataclass

from eth_abi import decode, encode
from eth_utils import function_signature_to_4byte_selector as _sel

from .probe_bytecode import RUNTIME_HEX, RUNTIME_SHA256
from .rpcclient import ChainRpc, RpcError

# Where the runtime is injected when a chain has no router address configured.
DEFAULT_PROBE_ADDRESS = "0x000000000000000000000000000000000054e9a0"

REQ = "(uint8,address,bool,int256,bytes)"
QUOTE = "(bool,int256,int256,uint256,uint256,uint160,uint160,bytes)"
_QM = _sel(f"quoteMany({REQ}[],uint256,uint32)")

DEFAULT_MAX_GRANT = 8_000_000
DEFAULT_LIMIT_SQRT_BPS = 20_000        # sqrt price x2: the swap stops at a 4x price move
CALL_GAS = 150_000_000                 # eth_call gas; results were identical at 50M and 150M in T0

FAMILY_ID = {"v3": 0, "algebra": 0, "slipstream": 0, "v4": 1, "infinity_cl": 2}

_WRAPPED_ERROR = bytes.fromhex("90bfb865")   # V4 Hooks.WrappedError(address,bytes4,bytes,bytes)
_ERROR_STRING = bytes.fromhex("08c379a0")


def v4_key(currency0: str, currency1: str, fee: int, tick_spacing: int, hooks: str) -> bytes:
    return encode(["(address,address,uint24,int24,address)"], [(currency0, currency1, fee, tick_spacing, hooks)])


def infinity_key(currency0: str, currency1: str, hooks: str, pool_manager: str, fee: int, parameters: bytes) -> bytes:
    return encode(["(address,address,address,address,uint24,bytes32)"],
                  [(currency0, currency1, hooks, pool_manager, fee, parameters)])


@dataclass
class Req:
    family: int
    target: str
    zero_for_one: bool
    amount_in: int          # exact input, raw units of the token paid in
    key: bytes = b""


def _classify(err: bytes, gas_used: int, grant: int) -> tuple[str, str]:
    if not err:
        if grant and gas_used >= grant * 97 // 100:
            return "out_of_gas", f"empty revert after {gas_used:,} of a {grant:,} gas grant"
        return "empty_revert", f"empty revert after {gas_used:,} of a {grant:,} gas grant"
    if err == b"probe: sign check failed":
        return "sign_check", "the pool returned deltas with the wrong signs"
    if err == b"probe: gas exhausted before this quote":
        return "batch_gas", "the batch ran out of gas before this quote; it is re-sent in a new call"
    if err.startswith(b"probe:"):
        return "reverted", err.decode(errors="replace")
    if err[:4] == _WRAPPED_ERROR:
        try:
            hook, fsel, _reason, _details = decode(["address", "bytes4", "bytes", "bytes"], err[4:])
            return "gated_by_hook", f"hook {hook} refused in {fsel.hex()}"
        except Exception:
            return "gated_by_hook", "hook revert (WrappedError)"
    if err[:4] == _ERROR_STRING:
        try:
            (msg,) = decode(["string"], err[4:])
            return "reverted", f"Error({msg[:120]})"
        except Exception:
            pass
    return "reverted", "0x" + err[:36].hex()


def quote_many(rpc: ChainRpc, reqs: list[Req], block: int, *, at: str | None = None,
               max_grant: int = DEFAULT_MAX_GRANT, limit_sqrt_bps: int = DEFAULT_LIMIT_SQRT_BPS) -> list[dict]:
    """One eth_call for all `reqs` at `block`. Raises RpcError when the call
    itself fails (a fact about the RPC, not about any pool)."""
    if not reqs:
        return []
    at = (at or DEFAULT_PROBE_ADDRESS).lower()
    data = "0x" + (_QM + encode([f"{REQ}[]", "uint256", "uint32"], [
        [(r.family, r.target, r.zero_for_one, int(r.amount_in), r.key) for r in reqs],
        max_grant, limit_sqrt_bps,
    ])).hex()
    raw = rpc.eth_call(at, data, block, overrides={at: {"code": RUNTIME_HEX}}, gas=CALL_GAS, timeout=60)
    if not raw or raw == "0x":
        raise RpcError("decode", "quoteMany returned no data")
    (qs,) = decode([f"{QUOTE}[]"], bytes.fromhex(raw[2:]))
    out = []
    for r, q in zip(reqs, qs):
        ok, a0, a1, gas_used, grant, sqrtp, limit, err = q
        rec = {"sqrt_price_x96": sqrtp, "limit_x96": limit, "gas_used": gas_used, "grant": grant}
        if ok:
            paid = a0 if r.zero_for_one else a1
            got = -(a1 if r.zero_for_one else a0)
            rec.update(ok=True, paid=paid, received=got,
                       filled_fraction=paid / r.amount_in if r.amount_in else None,
                       status="ok" if paid >= r.amount_in else "partial")
        else:
            status, detail = _classify(bytes(err), gas_used, grant)
            rec.update(ok=False, status=status, detail=detail)
        if sqrtp == 0 and rec.get("ok"):
            rec.update(ok=False, status="no_price", detail="the pool price could not be read in the same call")
        elif rec.get("ok") and rec["received"] <= 0:
            rec.update(ok=False, status="zero_output", detail="the swap ran and paid out nothing")
        out.append(rec)
    return out


def runtime_identity() -> dict:
    return {"runtime_sha256": RUNTIME_SHA256, "source": "contracts/src/TnegaSwapProbe.sol"}
