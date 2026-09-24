"""Re-derive the tokenized-equities concentration baseline, and compare or write it.

Run: ./venv/bin/python scripts/te_concentration_baseline.py            (compare)
     ./venv/bin/python scripts/te_concentration_baseline.py --write    (rewrite)

What it reads, per ticker in docs/data/tokenized-equities-concentration-baseline.json:

  V4, at the block named in the file:
    ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32) on the
    PoolManager, topic1 = pool id, from block 0 to that block. Each distinct
    (sender, tickLower, tickUpper, salt) is a position. Its liquidity is read
    with extsload at keccak256(positionKey ++ (poolBase + 6)); slot0 and the
    pool's liquidity at poolBase and poolBase + 3, where
    poolBase = keccak256(poolId ++ uint256(6)). Positions opened through the V4
    PositionManager resolve to ownerOf(salt); any other sender is counted as
    itself. Shares are of in-range liquidity (tickLower <= tick < tickUpper).
    The self-check: in-range liquidity sums to the pool's liquidity exactly.

  V3, at each pool's own block:
    Mint(address,address,int24,int24,uint128,uint256,uint256) on the pool,
    from block 0 to that block. The position owner is topics[1], the indexed
    `owner` argument, which is the mint recipient and not the calling sender.
    positions(keccak256(owner ++ tickLower ++ tickUpper)) through Multicall3.

It also checks the live V4 position set at the block against the committed
keys and values in docs/data/tokenized-equities-v4-position-keys.json, which is
what the original run stored, so "reproduces the original run" stays checkable
without the session's scratch files.

ENDPOINTS. Two, both public, no key, overridable by environment:

  TE_ARCHIVE_RPC  historical state (eth_call at a past block). Default
                  https://robinhood.drpc.org. The chain's own public RPC,
                  https://rpc.mainnet.chain.robinhood.com, answers "historical
                  state ... is not available" for these blocks, and
                  https://robinhood-rpc.publicnode.com wants a personal token
                  for archive requests. Any archive endpoint for chain 4663
                  works; this one needs no key.
  TE_LOG_RPC      eth_getLogs. Default https://rpc.mainnet.chain.robinhood.com.

No key is read or sent. Do not put one in this file.

Dependencies: httpx (requirements.txt), eth_utils and eth_abi. The last two
are present in the backend venv through web3 and eth-account, and
core/hyperliquid/corestate.py already imports eth_utils; neither is listed in
requirements.txt.

Exit status is 0 when every compared value matches, 1 otherwise.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from eth_abi import decode, encode
from eth_utils import keccak

ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / "docs/data/tokenized-equities-concentration-baseline.json"
KEYS = ROOT / "docs/data/tokenized-equities-v4-position-keys.json"

ARCHIVE_RPC = os.environ.get("TE_ARCHIVE_RPC", "https://robinhood.drpc.org")
LOG_RPC = os.environ.get("TE_LOG_RPC", "https://rpc.mainnet.chain.robinhood.com")
CHAIN_ID = 4663

POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
V4_POSM = "0x58daec3116aae6d93017baaea7749052e8a04fa7"
V3_NFT = "0x73991a25c818bf1f1128deaab1492d45638de0d3"
MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
NFT_SUPPLY_BLOCK = 71435476


def _sel(sig: str) -> bytes:
    return keccak(text=sig)[:4]


def _topic(sig: str) -> str:
    return "0x" + keccak(text=sig).hex()


EXTSLOAD = _sel("extsload(bytes32[])")
AGGREGATE = _sel("aggregate((address,bytes)[])")
TRY_AGGREGATE = _sel("tryAggregate(bool,(address,bytes)[])")
OWNER_OF = _sel("ownerOf(uint256)")
POSITIONS = _sel("positions(bytes32)")
SLOT0 = _sel("slot0()")
LIQUIDITY = _sel("liquidity()")
TOTAL_SUPPLY = _sel("totalSupply()")
MODIFY_LIQUIDITY = _topic("ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)")
MINT = _topic("Mint(address,address,int24,int24,uint128,uint256,uint256)")

def host(url: str) -> str:
    """Scheme and host only. An endpoint URL can carry a key in its path or
    query, so nothing else of it is ever printed or put in an error."""
    u = urlsplit(url)
    return f"{u.scheme}://{u.hostname}"


_client = httpx.Client(timeout=300, headers={"content-type": "application/json"})


def rpc(url: str, method: str, params: list):
    """One call, with backoff on refusals and timeouts. A JSON-RPC error is
    returned to the caller rather than retried, because a log query that timed
    out server-side is answered by narrowing the window, not by waiting."""
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    for attempt in range(8):
        try:
            r = _client.post(url, json=payload)
            if r.status_code in (429, 500, 502, 503, 504):
                raise httpx.HTTPStatusError(str(r.status_code), request=r.request, response=r)
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, ValueError) as e:
            wait = min(60, 2 * 2 ** attempt)
            print(f"  retry {attempt + 1} after {wait}s at {host(url)}: {type(e).__name__}", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"{method} failed after retries at {host(url)}")


def call(to: str, data: bytes, block: int, url: str = ARCHIVE_RPC) -> bytes:
    out = rpc(url, "eth_call", [{"to": to, "data": "0x" + data.hex()}, hex(block)])
    if "result" not in out:
        raise RuntimeError(f"eth_call {to} at {block}: "
                           f"error code {(out.get('error') or {}).get('code')}")
    return bytes.fromhex(out["result"][2:])


def get_logs(address: str, topics: list, hi: int) -> list[dict]:
    out, lo, win = [], 0, 20_000_000
    while lo <= hi:
        end = min(hi, lo + win - 1)
        r = rpc(LOG_RPC, "eth_getLogs", [{"address": address, "topics": topics,
                                          "fromBlock": hex(lo), "toBlock": hex(end)}])
        if "result" not in r:
            if win <= 1_000:
                raise RuntimeError(f"getLogs {address} {lo}-{end}: "
                                   f"error code {(r.get('error') or {}).get('code')}")
            win //= 4
            continue
        out += r["result"]
        lo = end + 1
    return out


def extsload(slots: list[int], block: int) -> list[int]:
    vals = []
    for i in range(0, len(slots), 500):
        part = slots[i:i + 500]
        raw = call(POOL_MANAGER, EXTSLOAD + encode(["bytes32[]"], [[s.to_bytes(32, "big") for s in part]]), block)
        (words,) = decode(["bytes32[]"], raw)
        assert len(words) == len(part)
        vals += [int.from_bytes(w, "big") for w in words]
    return vals


def multicall(calls: list[tuple[str, bytes]], block: int, allow_failure: bool = False) -> list[bytes | None]:
    out = []
    for i in range(0, len(calls), 150):
        part = calls[i:i + 150]
        if allow_failure:
            raw = call(MULTICALL3, TRY_AGGREGATE + encode(["bool", "(address,bytes)[]"], [False, part]), block)
            (res,) = decode(["(bool,bytes)[]"], raw)
            out += [data if ok else None for ok, data in res]
        else:
            raw = call(MULTICALL3, AGGREGATE + encode(["(address,bytes)[]"], [part]), block)
            # On an Arbitrum Orbit chain the returned block number is the
            # parent chain's, so it is not compared with `block`. The block
            # tag on eth_call is what fixes the state read.
            _, rets = decode(["uint256", "bytes[]"], raw)
            out += list(rets)
    return out


def s24(v: int) -> int:
    v &= (1 << 24) - 1
    return v - (1 << 24) if v >= (1 << 23) else v


def s256(v: int) -> int:
    return v - (1 << 256) if v >= (1 << 255) else v


def i3(v: int) -> bytes:
    return (v & ((1 << 24) - 1)).to_bytes(3, "big")


def pct(x: float) -> float:
    return float("%.10g" % x)


def pool_base(pid: str) -> int:
    return int.from_bytes(keccak(bytes.fromhex(pid[2:]) + (6).to_bytes(32, "big")), "big")


def v4_ticker(pid: str, block: int, stored_keys: dict) -> dict:
    logs = get_logs(POOL_MANAGER, [MODIFY_LIQUIDITY, pid], block)
    keys = list(dict.fromkeys(
        ("0x" + l["topics"][2][26:],
         s256(int(l["data"][2:66], 16)),
         s256(int(l["data"][66:130], 16)),
         l["data"][2 + 192:2 + 256])
        for l in logs))
    base = pool_base(pid)
    slots = [base, base + 3] + [
        int.from_bytes(keccak(keccak(bytes.fromhex(s[2:]) + i3(tl) + i3(tu) + bytes.fromhex(salt))
                              + (base + 6).to_bytes(32, "big")), "big")
        for s, tl, tu, salt in keys]
    vals = extsload(slots, block)
    tick = s24(vals[0] >> 160)
    pool_liq = vals[1]
    live = {k: v & ((1 << 128) - 1) for k, v in zip(keys, vals[2:]) if v & ((1 << 128) - 1)}

    # Against what the original run stored: same live set, same values.
    stored = {(s, tl, tu, salt): liq for s, tl, tu, salt, liq in stored_keys}
    live_str = {(s, tl, tu, int(salt, 16)): v for (s, tl, tu, salt), v in live.items()}
    differing = sum(1 for k, v in stored.items() if live_str.get(k) != v)
    extra = sum(1 for k in live_str if k not in stored)

    inr = {k: v for k, v in live.items() if k[1] <= tick < k[2]}
    posm = [k for k in inr if k[0] == V4_POSM]
    owners = multicall([(V4_POSM, OWNER_OF + encode(["uint256"], [int(k[3], 16)])) for k in posm],
                       block, allow_failure=True)
    held = defaultdict(int)
    unresolved = 0
    kinds = {}
    for k, o in zip(posm, owners):
        if o and len(o) >= 32:
            a = "0x" + o[12:32].hex()
            held[a] += inr[k]
            kinds[a] = "position_manager_nft_owner"
        else:
            held["unresolved"] += inr[k]
            unresolved += 1
    for k, v in inr.items():
        if k[0] != V4_POSM:
            held["contract:" + k[0]] += v
            kinds["contract:" + k[0]] = "direct_contract"
    rank = sorted(held.items(), key=lambda x: -x[1])
    tot = sum(held.values())
    shares = [v / tot * 100 for _, v in rank]
    return {
        "block": block, "tick": tick, "pool_liquidity": str(pool_liq),
        "positions_with_liquidity": len(live), "in_range_positions": len(inr),
        "in_range_via_position_manager": len(posm),
        "in_range_opened_directly_by_a_contract": len(inr) - len(posm),
        "ownerof_unresolved": unresolved, "providers": len(held),
        "providers_that_are_direct_contracts": sum(1 for a, _ in rank if kinds.get(a) == "direct_contract"),
        "largest_share_pct": pct(shares[0]), "top2_cumulative_pct": pct(sum(shares[:2])),
        "top5_cumulative_pct": pct(sum(shares[:5])),
        "top10": [{"rank": i + 1, "kind": kinds.get(a, "unresolved"), "liquidity": str(v),
                   "share_pct": pct(v / tot * 100)} for i, (a, v) in enumerate(rank[:10])],
        "self_check": {"in_range_position_sum": str(tot), "pool_liquidity": str(pool_liq),
                       "reconciles": tot == pool_liq},
        "_against_stored_keys": {"stored": len(stored), "differing_or_missing": differing,
                                 "live_not_in_stored": extra},
        "_senders": sorted({k[0] for k in live}),
    }


def v3_ticker(pool: str, block: int) -> dict:
    logs = get_logs(pool, [MINT], block)
    keys = list(dict.fromkeys(
        ("0x" + l["topics"][1][26:], s256(int(l["topics"][2], 16)), s256(int(l["topics"][3], 16)))
        for l in logs))
    calls = [(pool, SLOT0), (pool, LIQUIDITY)] + [
        (pool, POSITIONS + keccak(bytes.fromhex(o[2:]) + i3(a) + i3(b))) for o, a, b in keys]
    rets = multicall(calls, block)
    tick = s24(int.from_bytes(rets[0][32:64], "big"))
    pool_liq = int.from_bytes(rets[1], "big")
    live, held, inr = 0, defaultdict(int), 0
    for k, r in zip(keys, rets[2:]):
        liq = int.from_bytes(r[:32], "big")
        if liq:
            live += 1
            if k[1] <= tick < k[2]:
                held[k[0]] += liq
                inr += 1
    rank = sorted(held.items(), key=lambda x: -x[1])
    tot = sum(held.values())
    return {
        "block": block, "mint_events": len(logs), "position_keys": len(keys),
        "positions_with_liquidity": live, "in_range_positions": inr,
        "pool_level_owners": len(held),
        "share_held_by_v3_positions_nft_pct": pct(held.get(V3_NFT, 0) / tot * 100),
        "shares_pct_by_rank": [pct(v / tot * 100) for _, v in rank],
        "self_check": {"in_range_position_sum": str(tot), "pool_liquidity": str(pool_liq),
                       "reconciles": tot == pool_liq},
    }


def compare(label: str, got: dict, want: dict) -> int:
    bad = 0
    for k, v in got.items():
        if k.startswith("_") or k not in want:
            continue
        if want[k] != v:
            bad += 1
            print(f"  MISMATCH {label}.{k}: file {want[k]!r} != chain {v!r}")
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--write", action="store_true", help="write re-derived values into the baseline file")
    ap.add_argument("--only", nargs="*", help="tickers to run, default all")
    args = ap.parse_args()

    baseline = json.loads(BASELINE.read_text())
    stored_keys = json.loads(KEYS.read_text())
    senders = stored_keys["owner_contracts"]
    print(f"archive RPC {host(ARCHIVE_RPC)}\nlog RPC     {host(LOG_RPC)}")
    chain = rpc(LOG_RPC, "eth_chainId", [])["result"]
    if int(chain, 16) != CHAIN_ID:
        print(f"wrong chain: {chain}")
        return 1

    bad = 0
    for t, rec in baseline["tickers"].items():
        if args.only and t not in args.only:
            continue
        v4w, v3w = rec["v4"], rec["v3"]
        rows = [(senders[i], tl, tu, salt if isinstance(salt, int) else int(salt, 16), int(liq))
                for i, tl, tu, salt, liq in stored_keys["pools"][v4w["pool_id"]]]
        t0 = time.time()
        v4 = v4_ticker(v4w["pool_id"], v4w["block"], rows)
        a = v4["_against_stored_keys"]
        print(f"{t:5} V4 block {v4['block']}: providers {v4['providers']}, largest "
              f"{v4['largest_share_pct']}%, self-check {v4['self_check']['reconciles']}, "
              f"stored keys {a['stored']} with {a['differing_or_missing']} differing, "
              f"{a['live_not_in_stored']} live keys not in the stored set ({time.time() - t0:.0f}s)")
        bad += compare(f"{t}.v4", v4, v4w)
        bad += a["differing_or_missing"] + a["live_not_in_stored"]
        bad += 0 if v4["self_check"]["reconciles"] else 1
        # A sender must answer unlockCallback, so it must have code. Code that
        # is exactly 0xef0100 followed by an address is an EIP-7702 delegation:
        # an externally owned account running a contract's code. It passes a
        # has-code test and is still a person's address, so it is flagged
        # separately rather than counted as a contract.
        codes = {s: rpc(LOG_RPC, "eth_getCode", [s, "latest"]).get("result") or "0x" for s in v4["_senders"]}
        codeless = [s for s, c in codes.items() if c == "0x"]
        delegated = [s for s, c in codes.items() if c.lower().startswith("0xef0100") and len(c) == 2 + 46]
        if codeless or delegated:
            print(f"  senders with no code: {len(codeless)}; EIP-7702 delegated accounts: {len(delegated)}")
            bad += 1
        t0 = time.time()
        v3 = v3_ticker(v3w["pool"], v3w["block"])
        print(f"{t:5} V3 block {v3['block']}: owners {v3['pool_level_owners']}, positions NFT "
              f"{v3['share_held_by_v3_positions_nft_pct']}%, self-check "
              f"{v3['self_check']['reconciles']} ({time.time() - t0:.0f}s)")
        bad += compare(f"{t}.v3", v3, v3w)
        bad += 0 if v3["self_check"]["reconciles"] else 1
        if args.write:
            v4w.update({k: v for k, v in v4.items() if not k.startswith("_")})
            v3w.update(v3)

    supply = int.from_bytes(call(V3_NFT, TOTAL_SUPPLY, NFT_SUPPLY_BLOCK), "big")
    want = baseline["v3_positions_nft_total_supply"]["value_at_block_71435476"]
    print(f"V3 positions NFT totalSupply at {NFT_SUPPLY_BLOCK}: {supply} (file {want})")
    bad += supply != want

    if args.write:
        BASELINE.write_text(json.dumps(baseline, indent=1) + "\n")
        print(f"wrote {BASELINE.relative_to(ROOT)}")
    print("REPRODUCES" if bad == 0 else f"{bad} MISMATCHES")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
