"""
pools.py

Pool candidates for each version: the pools in the cost inputs (found by
the universe pass, by factory construction and creation logs), plus pools
found here from Initialize logs of the Uniswap V4 PoolManager and the
PancakeSwap Infinity CLPoolManager. Construction cannot find a hooked V4
pool (the hook address is part of the key), and hooked pools are where some
of these tokens trade: T0's best NVDA pool on Robinhood Chain has a
dynamic-fee hook.

Two walks per chain, both public RPCs only:
- forward: from the last block seen to the head, every run, reading every
  Initialize event of the chain's managers (no token filter) and keeping the
  ones that involve a listed token, in either currency slot (so the native
  currency 0x0 and stables that sort below the token are caught);
- back: from the first block seen towards the managers' deployment, a
  bounded number of windows per run, filtered by the listed tokens in
  currency0 and then currency1. Only where a public endpoint serves old logs
  at a usable rate: Ethereum (mevblocker, 10,000-block ranges), Base
  (mainnet.base.org, 2,000), Arbitrum (arb1), Robinhood Chain (its own RPC,
  complete). BSC has none: publicnode keeps about 10,000 blocks of logs,
  bloXroute times out on 5,000-block ranges, and fastnode refuses queries of
  more than about 20 topics (HTTP 413) and times out unfiltered (HTTP 504),
  all measured 2026-09-27. BSC history is therefore "not searched", and says
  so; its forward walk runs from the first run on.

Progress is written into the state dict after every window, so a run that
hits its deadline keeps what it read. Errors are kept as a short category
(public_reason), never an upstream body.
"""

from __future__ import annotations

import logging
import time

from eth_abi import decode
from eth_utils import keccak

from .chains import CHAINS, NATIVE, _ep
from .rpcclient import ChainRpc, RpcError, public_reason

log = logging.getLogger("te.pools")

INIT_V4 = "0x" + keccak(text="Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)").hex()
INIT_INFINITY = "0x" + keccak(text="Initialize(bytes32,address,address,address,uint24,bytes32,uint160,int24)").hex()

# Per chain: the log endpoint, the window it accepts, and how history is
# walked. `floor` is where the back walk stops: "token" = the earliest listed
# token's deployment (bisected once; a pool cannot predate its token),
# "manager" = the manager's deployment (bisected), else a fixed block before
# V4's launch on that chain (31 January 2025) when bisection is unavailable.
DISCOVERY = {
    1: {"endpoint": "https://rpc.mevblocker.io", "window": 10_000, "back": True, "floor": "manager",
        "floor_fallback": 21_600_000, "min_interval": 0.25},
    8453: {"endpoint": "https://mainnet.base.org", "window": 2_000, "back": True, "floor": "token",
           "floor_fallback": 24_000_000, "min_interval": 0.3},
    42161: {"endpoint": "https://arb1.arbitrum.io/rpc", "window": 5_000_000, "back": True, "floor": "fixed",
            "floor_fallback": 280_000_000, "min_interval": 0.12},
    56: {"endpoint": "https://bsc-rpc.publicnode.com", "window": 5_000, "back": False, "min_interval": 0.25,
         # Walking forward from each token's deployment was also considered: the
         # bStocks tokens all predate the universe pass of 2026-09-26, and
         # publicnode answers no log query older than about 9,765 blocks (1.2
         # hours), measured 2026-09-27, so no deployment block is in reach.
         "no_back_reason": ("no public RPC serves BSC log history at a usable rate (publicnode answers only the "
                            "last ~9,765 blocks, about 1.2 hours, so even the tokens' deployment blocks are out of "
                            "reach; bloXroute times out on 5,000-block ranges; fastnode refuses more than about 20 "
                            "topics and times out unfiltered; measured 2026-09-27)")},
    4663: {"endpoint": "https://rpc.mainnet.chain.robinhood.com", "window": 2_000_000, "back": True, "floor": "fixed",
           "floor_fallback": 0, "min_interval": 0.5},
}


def managers(chain_id: int) -> list[dict]:
    c = CHAINS[chain_id]
    out = []
    if chain_id not in DISCOVERY:
        return out
    if c.get("v4_manager"):
        out.append({"kind": "v4", "manager": c["v4_manager"], "topic": INIT_V4})
    if c.get("infinity_cl_manager"):
        out.append({"kind": "infinity_cl", "manager": c["infinity_cl_manager"], "topic": INIT_INFINITY})
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
         "src": "initialize_log", "block": int(lg["blockNumber"], 16), "mgr": lg["address"].lower()}
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


def _deploy_block(rpc: ChainRpc, addr: str, head: int) -> int | None:
    """First block at which `addr` has code, by bisection over eth_getCode.
    None if the endpoint cannot answer old blocks."""
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
    except RpcError as e:
        if e.kind == "deadline":
            raise
        return None


def _logs(rpc: ChainRpc, address, lo: int, hi: int, topics: list, depth: int = 0) -> list:
    """eth_getLogs over [lo, hi], halving the range when the node refuses it
    for matching too many logs (4663 caps results at 10,000)."""
    try:
        return rpc.call("eth_getLogs", [{"address": address, "fromBlock": hex(lo), "toBlock": hex(hi), "topics": topics}])
    except RpcError as e:
        if "exceeds limit" in e.message and hi > lo and depth < 12:
            mid = (lo + hi) // 2
            return _logs(rpc, address, lo, mid, topics, depth + 1) + _logs(rpc, address, mid + 1, hi, topics, depth + 1)
        raise


def _floor(cfg: dict, rpc: ChainRpc, mgrs: list[dict], toks: list[str], head: int) -> tuple[int, str]:
    how = cfg.get("floor")
    if how == "token" and len(toks) <= 20:
        tb = [b for b in (_deploy_block(rpc, t, head) for t in toks) if b is not None]
        if tb:
            return min(tb), "earliest listed token's deployment (bisected)"
    if how in ("manager", "token"):
        mb = [b for b in (_deploy_block(rpc, m["manager"], head) for m in mgrs) if b is not None]
        if mb:
            return min(mb), "pool manager's deployment (bisected)"
    return cfg["floor_fallback"], "a block before V4's launch on this chain (bisection unavailable)"


def scan(chain_id: int, tokens: list[str], state: dict | None, *, deadline: float | None = None,
         max_calls: int = 40) -> tuple[list[dict], dict]:
    """One bounded discovery pass for a chain. Returns (pools found, new
    state). State is updated after every window, so an exception (the
    deadline, an RPC failure) leaves the progress made so far in `state`,
    which the caller persists."""
    cfg = DISCOVERY.get(chain_id)
    mgrs = managers(chain_id)
    state = state if state is not None else {}
    found: list[dict] = []
    if not cfg or not mgrs:
        return found, state
    toks = sorted({t.lower() for t in tokens})
    tokset = set(toks)
    st = state.setdefault("walk", {})
    st.update(endpoint=_ep(cfg["endpoint"]).label, managers=[m["kind"] + ":" + m["manager"] for m in mgrs])
    rpc = ChainRpc(chain_id, [_ep(cfg["endpoint"])], min_interval=cfg["min_interval"], retries_per_endpoint=3,
                   deadline=deadline)
    addrs = [m["manager"] for m in mgrs]
    kinds = {m["manager"]: m["kind"] for m in mgrs}
    try:
        head = rpc.block_number()
        if "hi" not in st:
            st["hi"] = st["lo"] = head + 1          # empty range: both walks start at the head
            st["started_at_block"] = head + 1
        # forward: every Initialize event, then a local token filter
        b = st["hi"]
        while b <= head and rpc.stats.calls < max_calls:
            hi = min(head, b + cfg["window"] - 1)
            for lg in _logs(rpc, addrs, b, hi, [[m["topic"] for m in mgrs]]):
                p = _decode(kinds[lg["address"].lower()], lg, tokset, chain_id)
                if p:
                    found.append(p)
            st["hi"] = b = hi + 1
        # back: token-filtered, both currency slots, towards the floor
        if cfg.get("back"):
            if st.get("floor") is None:
                st["floor"], st["floor_basis"] = _floor(cfg, rpc, mgrs, toks, head)
            chunks = [toks[i:i + 200] for i in range(0, len(toks), 200)] or [[]]
            per_window = 2 * len(chunks)
            while st["lo"] > st["floor"] and rpc.stats.calls + per_window <= max_calls:
                lo = max(st["floor"], st["lo"] - cfg["window"])
                hi = st["lo"] - 1
                for part in chunks:
                    tt = [_topic(t) for t in part]
                    for topics in ([[m["topic"] for m in mgrs], None, tt], [[m["topic"] for m in mgrs], None, None, tt]):
                        for lg in _logs(rpc, addrs, lo, hi, topics):
                            p = _decode(kinds[lg["address"].lower()], lg, tokset, chain_id)
                            if p:
                                found.append(p)
                st["lo"] = lo
        st.pop("error", None)
    except RpcError as e:
        st["error"] = public_reason(e)
        log.warning("[te-pools] chain %s: %s (%s)", chain_id, st["error"], e.message[:200])
    st["last_calls"] = rpc.stats.calls
    rpc.close()
    seen, out = set(), []
    for p in found:
        if p["id"] not in seen:
            seen.add(p["id"])
            out.append(p)
    return out, state


def coverage(chain_id: int, state: dict | None) -> dict:
    """What the hooked-pool search on this chain has covered, in public terms."""
    cfg = DISCOVERY.get(chain_id)
    if not cfg or not managers(chain_id):
        return {"status": "not_applicable", "reason": "no V4 or Infinity pool manager on this chain"}
    st = (state or {}).get("walk") or {}
    if "hi" not in st:
        return {"status": "not_searched", "reason": st.get("error") or "the search has not run yet"}
    out = {"managers": st.get("managers"), "endpoint": st.get("endpoint"), "to_block": st["hi"] - 1,
           "forward_from_block": st.get("started_at_block")}
    if cfg.get("back"):
        done = st.get("floor") is not None and st["lo"] <= st["floor"]
        out.update(from_block=st["lo"], floor_block=st.get("floor"), floor_basis=st.get("floor_basis"),
                   status="complete" if done else "in_progress")
        if not done:
            out["reason"] = f"blocks {st.get('floor')} to {st['lo'] - 1} not yet read"
    else:
        out.update(from_block=st.get("started_at_block"), status="forward_only",
                   reason=f"not searched before block {st.get('started_at_block')}: {cfg['no_back_reason']}")
    if st.get("error"):
        out["last_error"] = st["error"]
    return out


# ── Screening: active liquidity and price, read in one Multicall3 pass ──────

from eth_abi import encode as _enc  # noqa: E402
from eth_utils import function_signature_to_4byte_selector as _sel  # noqa: E402

from .multicall import aggregate3  # noqa: E402

_SLOT0 = bytes.fromhex("3850c7bd")
_GLOBAL_STATE = bytes.fromhex("e76c01e4")
_LIQUIDITY = bytes.fromhex("1a686502")
_FEE = bytes.fromhex("ddca3f43")          # fee() on V3 and its forks
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
            for c in (_SLOT0, _GLOBAL_STATE, _LIQUIDITY, _FEE):
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
        fee = None       # current LP fee, millionths (1,000,000 = 100%)
        proto = None     # V4 / Infinity protocol fee, both directions packed
        if p["f"] == "v3" and len(r) == 4:
            sp = _word(r[0]) if r[0] else _word(r[1])
            L = _word(r[2])
            fee = _word(r[3])
            if fee is None and r[1] and len(r[1]) >= 96:
                fee = _word(r[1][64:96])        # Algebra Integral globalState: (price, tick, lastFee, ...)
        elif len(r) == 2:
            sp, L = _word(r[0]), _word(r[1])
            if p["f"] == "v4" and sp is not None:
                fee = (sp >> 208) & 0xFFFFFF    # V4 slot0: sqrtPrice 160 | tick 24 | protocolFee 24 | lpFee 24
                proto = (sp >> 184) & 0xFFFFFF  # two 12-bit values: bits 0-11 zeroForOne, 12-23 oneForZero
            elif p["f"] == "infinity_cl" and r[0] and len(r[0]) >= 128:
                fee = _word(r[0][96:128])       # getSlot0: (sqrtPriceX96, tick, protocolFee, lpFee)
                proto = _word(r[0][64:96])
        else:
            sp = L = None
        if sp is not None:
            sp &= (1 << 160) - 1
        if L is not None:
            L &= (1 << 128) - 1
        s = {"screen": "ok", "sqrtp": sp, "L": L, "fee_ppm": fee}
        if proto is not None:
            buy_zf = p["qa"] == sort_pair(rec["address"], p["qa"])[0]     # buying: paying the stable
            s["protocol_fee_ppm"] = (proto & 0xFFF) if buy_zf else ((proto >> 12) & 0xFFF)
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
