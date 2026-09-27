"""
pools.py

Pool candidates for each version: the pools in the cost inputs (found by
the universe pass, by factory construction and creation logs), plus pools
found here from Initialize logs of the Uniswap V4 PoolManager and the
PancakeSwap Infinity CLPoolManager. Construction cannot find a hooked V4
pool (the hook address is part of the key), and hooked pools are where some
of these tokens trade: T0's best NVDA pool on Robinhood Chain has a
dynamic-fee hook.

The log search takes the token in BOTH currency positions (topic2 is
currency0, topic3 is currency1), so the other side may sort below the token,
including the native currency, address 0x0. A pool against something other
than a dollar stablecoin is kept and marked with why it is not measured.

Scanning is incremental and bounded per run. Each (chain, manager) keeps a
cursor: `hi` moves forward to the head every run; `lo` walks backwards
towards the manager's deployment block a few windows per run, newest first,
so the pools created recently are found first. The coverage (lo..hi) is
reported with every result, so "not found" always says how far was looked.
"""

from __future__ import annotations

import logging

from eth_abi import decode
from eth_utils import keccak

from .chains import CHAINS, NATIVE, Endpoint, _ep, _infura
from .rpcclient import ChainRpc, RpcError

log = logging.getLogger("te.pools")

INIT_V4 = "0x" + keccak(text="Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)").hex()
INIT_INFINITY = "0x" + keccak(text="Initialize(bytes32,address,address,address,uint24,bytes32,uint160,int24)").hex()

# (kind, manager, log endpoint builder, window in blocks)
# Windows follow the T0 range limits: Infura 10,000; arb1 and the Robinhood
# Chain RPC answered multi-million-block ranges (4663 caps results at 10,000,
# which a token-filtered Initialize query stays far below).
def managers(chain_id: int) -> list[dict]:
    c = CHAINS[chain_id]
    out = []
    # Base: mainnet.base.org (keyless, full history, 2,000-block ranges) rather
    # than Infura, so the Coinbase tokens' short history is read without the
    # shared key; see TOKEN_FLOOR_CHAINS.
    ep = {1: lambda: _infura("mainnet"), 8453: lambda: _ep("https://mainnet.base.org"), 56: lambda: _infura("bsc-mainnet"),
          42161: lambda: _ep("https://arb1.arbitrum.io/rpc"), 4663: lambda: _ep("https://rpc.mainnet.chain.robinhood.com")}
    win = {1: 10_000, 8453: 2_000, 56: 10_000, 42161: 5_000_000, 4663: 2_000_000}
    if chain_id not in ep:
        return out
    if c.get("v4_manager"):
        out.append({"kind": "v4", "manager": c["v4_manager"], "endpoint": ep[chain_id], "window": win[chain_id]})
    if c.get("infinity_cl_manager"):
        out.append({"kind": "infinity_cl", "manager": c["infinity_cl_manager"], "endpoint": ep[chain_id], "window": win[chain_id]})
    return out


def _topic(addr: str) -> str:
    return "0x" + "0" * 24 + addr.lower()[2:]


def _decode(kind: str, lg: dict, tokens: set[str], chain_id: int) -> dict | None:
    c0 = "0x" + lg["topics"][2][-40:]
    c1 = "0x" + lg["topics"][3][-40:]
    data = bytes.fromhex(lg["data"][2:])
    if c0 in tokens:
        token, other = c0, c1
    elif c1 in tokens:
        token, other = c1, c0
    else:
        return None
    stables = {a.lower(): s for s, (a, _d) in CHAINS[chain_id]["stables"].items()}
    p = {"token": token, "id": lg["topics"][1], "c0": c0, "c1": c1, "qa": other, "q": stables.get(other),
         "src": "initialize_log", "block": int(lg["blockNumber"], 16)}
    if kind == "v4":
        fee, ts, hooks, _sp, _tick = decode(["uint24", "int24", "address", "uint160", "int24"], data)
        p.update(f="v4", fee=fee, ts=ts, hooks=hooks.lower(), venue="uniswap_v4 (Initialize log)")
    else:
        hooks, fee, params, _sp, _tick = decode(["address", "uint24", "bytes32", "uint160", "int24"], data)
        p.update(f="infinity_cl", fee=fee, params="0x" + params.hex(), hooks=hooks.lower(),
                 venue="pancakeswap_infinity_cl (Initialize log)")
    if other not in stables:
        p["why"] = ("other side is the native currency" if other == NATIVE else f"other side {other} is not a dollar stablecoin") + \
                   "; two-hop not measured"
    return p


# Where to start when the deployment block cannot be bisected (no archive
# endpoint answering): a block before 31 January 2025, when Uniswap V4
# launched, on each chain; PancakeSwap Infinity came later. Starting early
# only costs empty log windows, never a missed pool.
FLOOR_FALLBACK = {1: 21_400_000, 8453: 24_000_000, 42161: 280_000_000, 56: 44_000_000, 4663: 0}

# Chains with few tokens and an honest archive endpoint: the scan starts at
# the earliest token's deployment (a pool cannot predate its token), found by
# bisection once. Base: the 10 Coinbase tokens were deployed at blocks
# 49,145,181 to 49,145,336 (read 2026-09-26), 2.7M blocks back rather than
# the 27M since V4's launch.
TOKEN_FLOOR_CHAINS = {8453}


def _deploy_block(rpc: ChainRpc, addr: str, head: int) -> int | None:
    """First block at which `addr` has code, by bisection over eth_getCode on
    an archive endpoint. None if the endpoint cannot answer old blocks."""
    lo, hi = 0, head
    try:
        if len(rpc.call("eth_getCode", [addr, hex(head)])) <= 2:
            return None
        while lo < hi:
            mid = (lo + hi) // 2
            if len(rpc.call("eth_getCode", [addr, hex(mid)])) > 2:
                hi = mid
            else:
                lo = mid + 1
        return lo
    except RpcError:
        return None


def _logs(rpc: ChainRpc, address: str, lo: int, hi: int, topics: list, depth: int = 0) -> list:
    """eth_getLogs over [lo, hi], halving the range when the node refuses it
    for matching too many logs (4663 caps results at 10,000)."""
    try:
        return rpc.call("eth_getLogs", [{"address": address, "fromBlock": hex(lo), "toBlock": hex(hi), "topics": topics}])
    except RpcError as e:
        if "exceeds limit" in e.message and hi > lo and depth < 12:
            mid = (lo + hi) // 2
            return _logs(rpc, address, lo, mid, topics, depth + 1) + _logs(rpc, address, mid + 1, hi, topics, depth + 1)
        raise


def scan(chain_id: int, tokens: list[str], state: dict | None, *, max_calls: int = 24,
         min_interval: float | None = None) -> tuple[list[dict], dict]:
    """One bounded discovery pass for a chain. Returns (pools found in this
    pass, new state). `state` is what the previous pass returned (or None)."""
    state = dict(state or {})
    toks = sorted({t.lower() for t in tokens})
    found: list[dict] = []
    for m in managers(chain_id):
        ep: Endpoint | None = m["endpoint"]()
        if not ep:
            continue
        rpc = ChainRpc(chain_id, [ep], min_interval=min_interval if min_interval is not None else CHAINS[chain_id]["min_interval"])
        key = f"{m['kind']}:{m['manager']}"
        st = dict(state.get(key) or {})
        topic0 = INIT_V4 if m["kind"] == "v4" else INIT_INFINITY
        try:
            head = rpc.block_number()
            if st.get("floor") is None:
                st["floor"] = 0 if chain_id == 4663 else _deploy_block(rpc, m["manager"], head)
                if st["floor"] is not None and chain_id in TOKEN_FLOOR_CHAINS and len(toks) <= 20:
                    tb = [b for b in (_deploy_block(rpc, t, head) for t in toks) if b is not None]
                    if tb and min(tb) > st["floor"]:
                        st["floor"] = min(tb)
                        st["floor_basis"] = "earliest token deployment on this chain (bisected)"
                if st["floor"] is None and chain_id in FLOOR_FALLBACK:
                    st["floor"] = FLOOR_FALLBACK[chain_id]
                    st["floor_basis"] = "fallback: a block before V4's launch (archive bisection unavailable)"
            if st.get("floor") is None:
                st["error"] = "deployment block not found on the archive endpoint"
                state[key] = st
                continue
            if "hi" not in st:
                st["hi"] = st["lo"] = head + 1   # empty range; both walks start at the head
            windows = []
            b = st["hi"]
            while b <= head:
                windows.append((b, min(head, b + m["window"] - 1), "fwd"))
                b += m["window"]
            b = st["lo"] - 1
            while b >= st["floor"] and len(windows) < 400:
                windows.append((max(st["floor"], b - m["window"] + 1), b, "back"))
                b -= m["window"]
            for lo, hi, direction in windows:
                if rpc.stats.calls + 2 * max(1, (len(toks) + 199) // 200) > max_calls:
                    break
                for i in range(0, len(toks), 200):
                    part = [_topic(t) for t in toks[i:i + 200]]
                    for topics in ([topic0, None, part], [topic0, None, None, part]):
                        logs = _logs(rpc, m["manager"], lo, hi, topics)
                        for lg in logs:
                            p = _decode(m["kind"], lg, set(toks), chain_id)
                            if p:
                                p["mgr"] = m["manager"]
                                found.append(p)
                if direction == "fwd":
                    st["hi"] = hi + 1
                else:
                    st["lo"] = lo
            st.pop("error", None)
        except RpcError as e:
            st["error"] = f"{e.kind}: {e.message[:200]}"
            log.warning("[te-pools] chain %s %s: %s", chain_id, key, st["error"])
        st["complete_back"] = st.get("lo") is not None and st.get("floor") is not None and st["lo"] <= st["floor"]
        st["last_calls"] = rpc.stats.calls
        st["endpoint"] = ep.label
        state[key] = st
    # de-duplicate by pool id
    seen, out = set(), []
    for p in found:
        if p["id"] not in seen:
            seen.add(p["id"])
            out.append(p)
    return out, state


def coverage(state: dict) -> list[dict]:
    return [{"manager": k, "scanned_from": v.get("lo"), "scanned_to": (v.get("hi") or 1) - 1,
             "deployed_at": v.get("floor"), "complete": bool(v.get("complete_back")), "error": v.get("error")}
            for k, v in (state or {}).items()]


# ── Screening: active liquidity and price, read in one Multicall3 pass ──────

from eth_abi import encode as _enc  # noqa: E402
from eth_utils import function_signature_to_4byte_selector as _sel  # noqa: E402

from .multicall import aggregate3  # noqa: E402

_SLOT0 = bytes.fromhex("3850c7bd")
_GLOBAL_STATE = bytes.fromhex("e76c01e4")
_LIQUIDITY = bytes.fromhex("1a686502")
_EXTSLOAD = _sel("extsload(bytes32)")
_GET_SLOT0 = _sel("getSlot0(bytes32)")
_GET_LIQ = _sel("getLiquidity(bytes32)")
Q96 = 2 ** 96
OUTLIER = 0.10       # a pool whose mid is more than 10% off the version's reference mid is not compared
KEEP_PER_VERSION = 3


def sort_pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if int(a, 16) < int(b, 16) else (b, a)


def v4_pool_id(p: dict, token: str) -> bytes:
    c0, c1 = sort_pair(token, p["qa"])
    return keccak(_enc(["(address,address,uint24,int24,address)"], [(c0, c1, p["fee"], p["ts"], p["hooks"])]))


def infinity_pool_id(p: dict, token: str) -> bytes:
    c0, c1 = sort_pair(token, p["qa"])
    return keccak(_enc(["(address,address,address,address,uint24,bytes32)"],
                       [(c0, c1, p["hooks"], p["mgr"], p["fee"], bytes.fromhex(p["params"][2:]))]))


def _word(b: bytes | None) -> int | None:
    return int.from_bytes(b[:32], "big") if b and len(b) >= 32 else None


def screen(rpc: ChainRpc, chain_id: int, cands: list[tuple[dict, dict]], block: int) -> list[dict]:
    """cands: [(record, pool)]. Reads each pool's sqrtPriceX96 and active
    liquidity at `block` and returns one dict per candidate with
    mid_usd (stable per token, whole units), depth1_usd (dollars that move
    the price 1% at the active liquidity: an upper bound, used for ranking
    only) and a `screen` status."""
    stables = {a.lower(): d for s, (a, d) in CHAINS[chain_id]["stables"].items()}
    calls, idx = [], []
    for i, (rec, p) in enumerate(cands):
        tok = rec["address"]
        if p["f"] == "v3":
            for c in (_SLOT0, _GLOBAL_STATE, _LIQUIDITY):
                calls.append((p["pool"], c)); idx.append(i)
        elif p["f"] == "v4":
            slot = keccak(_enc(["bytes32", "uint256"], [v4_pool_id(p, tok), 6]))
            liq = (int.from_bytes(slot, "big") + 3).to_bytes(32, "big")
            calls.append((p["mgr"], _EXTSLOAD + slot)); idx.append(i)
            calls.append((p["mgr"], _EXTSLOAD + liq)); idx.append(i)
        elif p["f"] == "infinity_cl":
            pid = infinity_pool_id(p, tok)
            calls.append((p["mgr"], _GET_SLOT0 + pid)); idx.append(i)
            calls.append((p["mgr"], _GET_LIQ + pid)); idx.append(i)
    res = aggregate3(rpc, calls, block) if calls else []
    per: dict[int, list] = {}
    for i, r in zip(idx, res):
        per.setdefault(i, []).append(r)
    out = []
    for i, (rec, p) in enumerate(cands):
        r = per.get(i) or []
        if p["f"] == "v3" and len(r) == 3:
            sp = _word(r[0]) if r[0] else _word(r[1])
            L = _word(r[2])
        elif len(r) == 2:
            sp, L = _word(r[0]), _word(r[1])
        else:
            sp = L = None
        if sp is not None:
            sp &= (1 << 160) - 1
        if L is not None:
            L &= (1 << 128) - 1
        s = {"screen": "ok", "sqrtp": sp, "L": L}
        dstab = stables.get(p["qa"])
        if not sp or not L or dstab is None or rec.get("decimals") is None:
            s["screen"] = "no_price" if not sp else ("no_liquidity" if not L else "not_dollar")
            out.append(s)
            continue
        tok = rec["address"]
        t0, _t1 = sort_pair(tok, p["qa"])
        d0, d1 = (rec["decimals"], dstab) if t0 == tok else (dstab, rec["decimals"])
        sqrt_real = sp / Q96
        p10 = (sqrt_real ** 2) * 10 ** (d0 - d1)
        s["mid_usd"] = p10 if t0 == tok else (1 / p10 if p10 else None)
        f = sqrt_real if t0 == tok else 1 / sqrt_real       # stable is token1 when the token is token0
        s["depth1_usd"] = L * f * (1.01 ** 0.5 - 1) / 10 ** dstab
        out.append(s)
    return out


def select(rec: dict, pools: list[dict]) -> tuple[list[dict], dict]:
    """From screened dollar pools of one version, the ones worth quoting:
    drop pools with no price or liquidity, take the deepest as the
    reference mid, drop pools priced more than 10% away from it (their own
    mid would make a cost look small that is not), and keep the three
    deepest. Returns (kept, summary of what was dropped and why)."""
    live = [p for p in pools if p.get("screen") == "ok" and p.get("mid_usd")]
    why = {"screened": len(pools), "no_price_or_liquidity": len(pools) - len(live)}
    if not live:
        return [], why
    # The reference mid comes from the deepest pool the universe pass did not
    # flag as a price outlier (get_pools includes flagged pools, marked
    # price_outlier; they are screened here like any other, but never set
    # the reference). Only when every live pool is flagged is the deepest used.
    unflagged = [p for p in live if not p.get("po")]
    ref = max(unflagged or live, key=lambda p: p["depth1_usd"])
    why["reference_flagged_outlier"] = not unflagged
    ok = [p for p in live if abs(p["mid_usd"] / ref["mid_usd"] - 1) <= OUTLIER]
    why["price_outliers"] = len(live) - len(ok)
    why["reference_pool"] = ref.get("pool") or ref.get("id")
    kept = sorted(ok, key=lambda p: -p["depth1_usd"])[:KEEP_PER_VERSION]
    why["kept"] = len(kept)
    return kept, why
