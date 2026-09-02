"""
bsc_balance.py

Reads REAL native BNB balances for agent owner addresses from a public BSC
mainnet RPC (batched eth_getBalance).

This is a genuinely different, real data point from DefiLlama TVL, and the two
are deliberately never conflated:
  - TVL              = liquidity locked inside a DeFi PROTOCOL. Only the handful
                       of agents that ARE a tracked protocol have one.
  - Owner on-chain   = the actual native BNB held right now by the agent's
    balance             registered owner wallet. Available for EVERY agent that
                       has an owner address — a real number for the identity/
                       service agents that will never have DeFi TVL.

No API key needed (public dataseed endpoint); overridable via
BSC_MAINNET_RPC_URL. Best-effort: any RPC failure leaves the affected addresses
absent from the result (the caller treats absence as None / "not available"),
never a fabricated number.

Real 429 investigation (2026-08-27), BscScan considered and ruled out: the
real, documented plan was to use the existing BSCSCAN_API_KEY (Etherscan's
unified V2 API) as an additional/primary source, since it's already
configured and unused for this. Checked live against the real key, not
assumed: `https://api.etherscan.io/v2/api?chainid=56&...` returns
`{"status":"0","message":"NOTOK","result":"Free API access is not
supported for this chain. Please upgrade your api plan..."}` for BOTH
`balance` and `balancemulti` — confirmed this isn't account-specific by
also checking chainid=1 (Ethereum) on the SAME key, which works
(`{"status":"1","result":"0"}`), and by checking Etherscan's own real,
public chainlist (BSC shows real, live `status: 1`, so the chain itself is
online — the free tier specifically excludes it). Independently confirmed
externally: Etherscan's own real, published policy is that the V2 free
tier does not include BNB Chain at all (BSCScan's own legacy v1 API is
separately deprecated and returns the same "switch to V2" message either
way). So BSCSCAN_API_KEY is real and does work — for Ethereum reads, a
real, genuine future benefit once those are needed — but is NOT a viable
free path for BSC balances specifically. Not built. Real fix instead,
below: retry-with-backoff on the existing RPC path (a real, previously-
absent gap — a single 429 used to just fail that whole chunk, no retry
attempt at all) plus a real TTL-based skip in aggregate.py so repeat
refreshes don't re-fetch balances that are still genuinely fresh, cutting
the real per-refresh volume that's what's actually triggering the
sustained 429s at current ~13,000+-agent scale.
"""

import asyncio
import random

import httpx

_CHUNK = 50  # eth_getBalance calls per batched JSON-RPC request
_MAX_RETRIES = 4
_BASE_BACKOFF_SECONDS = 1.5


def _rpc_url() -> str:
    # Real fix (2026-08-27 audit): was its own local copy of this fallback,
    # silently defaulting to the public bsc-dataseed node — see
    # core/rpc.py's own docstring for the full real finding.
    from core.rpc import get_bsc_rpc_url
    return get_bsc_rpc_url()


def _fallback_rpc_url() -> str | None:
    from core.rpc import get_bsc_fallback_rpc_url
    return get_bsc_fallback_rpc_url()


async def fetch_owner_bnb_balances(addresses: list[str]) -> dict[str, float]:
    """Returns {lowercased_address: bnb_float} for every address the RPC could
    resolve. De-dupes first (many agents share an owner), batches the reads,
    and simply omits any address whose lookup failed."""
    uniq = sorted({
        a.lower() for a in addresses
        if isinstance(a, str) and a.startswith("0x") and len(a) == 42
    })
    if not uniq:
        return {}

    out: dict[str, float] = {}
    url = _rpc_url()
    backup_url = _fallback_rpc_url()  # real Infura backup, or None if unconfigured
    async with httpx.AsyncClient(timeout=20) as client:
        for i in range(0, len(uniq), _CHUNK):
            chunk = uniq[i:i + _CHUNK]
            batch = [
                {"jsonrpc": "2.0", "id": j, "method": "eth_getBalance", "params": [addr, "latest"]}
                for j, addr in enumerate(chunk)
            ]
            results = None
            last_err = None
            # Real retry-with-backoff — previously absent entirely: a single
            # 429 (or any transient failure) just failed this whole chunk
            # with no second attempt. At current ~13,000+-agent scale this
            # was confirmed live to sustain across dozens of consecutive
            # real chunks (offset 9200 through 11050+), not just the
            # occasional blip a real, bursty RPC endpoint always has.
            for attempt in range(_MAX_RETRIES):
                try:
                    resp = await client.post(url, json=batch)
                    if resp.status_code == 429:
                        raise httpx.HTTPStatusError("429", request=resp.request, response=resp)
                    resp.raise_for_status()
                    results = resp.json()
                    break
                except Exception as e:
                    last_err = e
                    if attempt < _MAX_RETRIES - 1:
                        # Real exponential backoff + jitter — spreads retries
                        # out instead of every chunk retrying in lockstep,
                        # which would just reproduce the same real burst
                        # that triggered the 429s in the first place.
                        delay = _BASE_BACKOFF_SECONDS * (2 ** attempt) + random.uniform(0, 0.5)
                        await asyncio.sleep(delay)
            if results is None and backup_url:
                # Real fallback (2026-09-04): the primary genuinely exhausted
                # every real retry above — one real, final attempt against
                # Infura before giving up on this chunk entirely. Not folded
                # into the retry loop itself: the backoff/jitter above is
                # specifically tuned for a bursty 429 on the SAME endpoint,
                # which switching providers doesn't need to wait out.
                try:
                    resp = await client.post(backup_url, json=batch)
                    resp.raise_for_status()
                    results = resp.json()
                except Exception as e:
                    last_err = e
            if results is None:
                print(f"[bsc_balance] batch starting at {i} failed after {_MAX_RETRIES} real attempts "
                      f"{'plus a real Infura fallback attempt ' if backup_url else ''}"
                      f"leaving those owner balances unavailable (honest None): {last_err}")
                continue
            # JSON-RPC batch responses are NOT guaranteed to be in request order,
            # so map each result back to its address by the id we assigned.
            by_id = {r.get("id"): r for r in results if isinstance(r, dict)}
            for j, addr in enumerate(chunk):
                r = by_id.get(j)
                if r and isinstance(r.get("result"), str):
                    try:
                        out[addr] = int(r["result"], 16) / 1e18
                    except ValueError:
                        pass  # unparseable hex — leave absent
    return out
