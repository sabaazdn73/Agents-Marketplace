"""
corestate.py

One address's live HyperCore position, read on chain 999 through the
HyperCoreReader contract, for display beside the post-only rejection rate this
project measures over hours.

WHY THE TWO BELONG TOGETHER
The rejection rate says how often an address's post-only orders are refused
before they ever rest on the book. It is collected from the venue's feeds and
describes a stretch of time. This says where the same address stands at this
block. Neither is available beside the other anywhere else, and the pairing is
the whole point: a refusal rate is a fact about an attempt to quote, and a
position is the thing that attempt was for.

WHAT THIS MODULE WILL NOT DO
It computes no rate, no ratio, no signal, and it never says an address is flat.
Three of the readings it takes are ambiguous by construction, and each one is
handled by saying what was and was not found rather than by picking a number.

THE UNITS RULE, WRITTEN HERE BECAUSE IT WAS GOT WRONG FIRST
A price from HyperCore scales by 10 ** (szDecimals - 6), where szDecimals
belongs to the asset. BTC has szDecimals 5 and a raw mark of 765010, which is
76,501 USD. Inverting that exponent gives 7,650,100 and looks plausible enough
to ship. Checked across four assets with different szDecimals: BTC 5 ->
76,501, ETH 4 -> 2,445.70, SOL 2 -> 100.76, XRP 0 -> 1.2932.

Size scales by 10 ** szDecimals: BTC szi 715606 is 7.15606 BTC.

THE EXISTENCE RULE, ALSO GOT WRONG FIRST, TWICE
`leverage` does not say whether an account exists: it is 20 for every address
that has never touched Hyperliquid, because 20 is the default. `withdrawable`
alone does not either: 0x1c1c270b holds a real short and has nothing free to
withdraw. Spot balance is worse, because anyone can send a token to any
address and two burn addresses hold one. What the contract reports as
`accountFound` is withdrawable OR an open position, and even that is evidence
rather than proof: an account that closed out and withdrew everything reads
exactly like one that never existed. So the absence is reported as "nothing
found", never as "flat", and never as a zero.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request

# Chain 999. The public endpoint answers eth_call without a key; a private one
# can be put in the environment without touching anything else here.
HYPEREVM_RPC_URL = os.getenv("HYPEREVM_RPC_URL", "https://rpc.hyperliquid.xyz/evm")
HYPEREVM_CHAIN_ID = 999

# The deployed HyperCoreReader. Empty until it is deployed, and the response
# says so rather than quietly falling back and looking the same.
READER_ADDRESS = (os.getenv("HYPERCORE_READER_ADDRESS") or "").strip()

# The markets checked for a position, and the coin each index names. Read off
# the asset-info precompile rather than taken from a list: 0 BTC, 1 ETH, 5 SOL,
# 25 XRP, 159 HYPE.
#
# Bounded on purpose. There are hundreds of perps and reading all of them for
# every address would be a different product; the response says which were
# checked so that "no position" is never mistaken for "no position anywhere".
PERPS_CHECKED: tuple[tuple[int, str], ...] = (
    (0, "BTC"), (1, "ETH"), (5, "SOL"), (25, "XRP"), (159, "HYPE"),
)

_TIMEOUT_SECONDS = 8.0
_CACHE_TTL_SECONDS = 20
_cache: dict[str, tuple[float, dict]] = {}


def _selector(signature: str) -> str:
    """keccak-256 of the signature, first four bytes. Computed rather than
    pasted, so a change to the contract's ABI cannot leave a stale constant
    here pointing at a function that no longer exists."""
    from eth_utils import function_signature_to_4byte_selector
    return "0x" + function_signature_to_4byte_selector(signature).hex()


def _rpc(method: str, params: list) -> dict:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                       "params": params}).encode()
    req = urllib.request.Request(HYPEREVM_RPC_URL, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as r:
        out = json.load(r)
    if "error" in out:
        raise RuntimeError(str(out["error"])[:200])
    return out["result"]


def _encode_read_many(user: str, perps: tuple[int, ...]) -> str:
    """ABI for readMany(address,uint16[]). Hand-encoded to keep this module
    free of a web3 dependency: the backend already avoids one everywhere else
    it talks to a chain."""
    sel = _selector("readMany(address,uint16[])")[2:]
    head = f"{int(user, 16):064x}"          # address
    head += f"{64:064x}"                     # offset to the array
    tail = f"{len(perps):064x}"
    for p in perps:
        tail += f"{p:064x}"
    return "0x" + sel + head + tail


# One Reading is twelve 32-byte words, in the struct's declared order.
_FIELDS = ("positionRead", "priceRead", "accountFound", "withdrawable",
           "spotBalance", "szi", "entryNtl", "leverage", "isIsolated",
           "markPx", "oraclePx", "szDecimals", "coreBlock")


def _decode_readings(data: str, count: int) -> list[dict]:
    raw = data[2:] if data.startswith("0x") else data
    words = [raw[i:i + 64] for i in range(0, len(raw), 64)]
    if len(words) < 2:
        raise ValueError("short return")
    # words[0] is the offset to the array, words[1] its length.
    n = int(words[1], 16)
    if n != count:
        raise ValueError(f"expected {count} readings, got {n}")
    out = []
    # Each element of a dynamic array of static structs follows the length
    # word, laid out one struct after another.
    base = 2
    width = len(_FIELDS)
    for i in range(n):
        chunk = words[base + i * width: base + (i + 1) * width]
        if len(chunk) < width:
            raise ValueError("truncated reading")
        r = {}
        for name, w in zip(_FIELDS, chunk):
            v = int(w, 16)
            if name == "szi":
                # int64, two's complement in a 256-bit word.
                if v >= 1 << 255:
                    v -= 1 << 256
                elif v >= 1 << 63:
                    v -= 1 << 64
            if name in ("positionRead", "priceRead", "accountFound", "isIsolated"):
                v = bool(v)
            r[name] = v
        out.append(r)
    return out


def _scaled(reading: dict, coin: str) -> dict:
    """One market, in units a reader can check, with the raw values kept.

    Nothing here rounds a price into a rate or a rate into advice. The raw
    integers stay in the payload so that anybody who doubts the scaling can
    redo it from the same numbers the chain returned.
    """
    sz_dec = int(reading["szDecimals"])
    price_scale = 10 ** (sz_dec - 6)
    size_scale = 10 ** sz_dec
    szi = int(reading["szi"])
    entry_ntl = int(reading["entryNtl"])
    mark = int(reading["markPx"]) * price_scale if reading["priceRead"] else None
    oracle = int(reading["oraclePx"]) * price_scale if reading["priceRead"] else None
    # Entry price uses the absolute size: a short has a negative szi and a
    # positive entry price, and dividing by the signed size produces a negative
    # price that looks like a bug in the data rather than in the arithmetic.
    entry = (entry_ntl / abs(szi) * price_scale) if szi else None
    size = szi / size_scale if sz_dec else float(szi)
    unrealised = ((mark - entry) * size) if (mark is not None and entry is not None) else None
    return {
        "coin": coin,
        "side": "long" if szi > 0 else ("short" if szi < 0 else None),
        "size": size,
        "entry_price": entry,
        "mark_price": mark,
        "oracle_price": oracle,
        "unrealised_usd": unrealised,
        "leverage": int(reading["leverage"]),
        "is_isolated": bool(reading["isIsolated"]),
        "sz_decimals": sz_dec,
        "raw": {"szi": szi, "entry_ntl": entry_ntl,
                "mark_px": int(reading["markPx"]),
                "price_scale_exponent": sz_dec - 6},
    }


def read_address(address: str) -> dict:
    """HyperCore state for one address, or the reason there is none.

    Cached for twenty seconds. HyperCore produces a block about every second,
    so a shorter cache would spend requests on a number that has barely moved,
    and a longer one would show a position that has closed.
    """
    addr = (address or "").strip().lower()
    if not addr.startswith("0x") or len(addr) != 42:
        return {"served": False, "withheld_reason": "not_an_address"}

    now = time.time()
    hit = _cache.get(addr)
    if hit and now - hit[0] < _CACHE_TTL_SECONDS:
        return hit[1]

    if not READER_ADDRESS:
        # Said out loud rather than papered over with a direct precompile call
        # that would look identical in the response. The contract IS the
        # integration; a panel that quietly bypassed it would be reporting
        # something this project had not built.
        out = {"served": False, "withheld_reason": "reader_not_deployed",
               "chain_id": HYPEREVM_CHAIN_ID}
        _cache[addr] = (now, out)
        return out

    perps = tuple(p for p, _ in PERPS_CHECKED)
    try:
        data = _rpc("eth_call", [{"to": READER_ADDRESS,
                                  "data": _encode_read_many(addr, perps)}, "latest"])
        readings = _decode_readings(data, len(perps))
    except Exception as e:  # noqa: BLE001
        out = {"served": False, "withheld_reason": "read_failed",
               "detail": f"{type(e).__name__}", "chain_id": HYPEREVM_CHAIN_ID}
        _cache[addr] = (now, out)
        return out

    markets = [_scaled(r, coin) for r, (_, coin) in zip(readings, PERPS_CHECKED)]
    open_positions = [m for m in markets if m["side"]]
    found = any(r["accountFound"] for r in readings)
    core_block = max((int(r["coreBlock"]) for r in readings), default=0)
    withdrawable_raw = max((int(r["withdrawable"]) for r in readings), default=0)

    out = {
        "served": True,
        "chain_id": HYPEREVM_CHAIN_ID,
        "reader": READER_ADDRESS,
        "read_at": now,
        "core_block": core_block,
        "account_found": found,
        # HyperCore's perp balances are 1e6, like entryNtl.
        "withdrawable_usd": withdrawable_raw / 1e6,
        "markets_checked": [coin for _, coin in PERPS_CHECKED],
        "positions": open_positions,
        # The sentence the caller must use when nothing was found. Kept here so
        # that the web app, the extension and any MCP client say the same thing
        # rather than three versions of it.
        "withheld_reason": None if found else "no_core_state_found",
        "note": ("Checked on " + ", ".join(c for _, c in PERPS_CHECKED)
                 + ". Nothing was found for this address on those markets, "
                 "which is not the same as this address being flat: an account "
                 "that closed out and withdrew everything reads exactly like "
                 "one that never existed.") if not found else None,
    }
    _cache[addr] = (now, out)
    return out
