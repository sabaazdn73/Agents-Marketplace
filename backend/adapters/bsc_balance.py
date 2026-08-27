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
"""

import httpx

_CHUNK = 50  # eth_getBalance calls per batched JSON-RPC request


def _rpc_url() -> str:
    # Real fix (2026-08-27 audit): was its own local copy of this fallback,
    # silently defaulting to the public bsc-dataseed node — see
    # core/rpc.py's own docstring for the full real finding.
    from core.rpc import get_bsc_rpc_url
    return get_bsc_rpc_url()


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
    async with httpx.AsyncClient(timeout=20) as client:
        for i in range(0, len(uniq), _CHUNK):
            chunk = uniq[i:i + _CHUNK]
            batch = [
                {"jsonrpc": "2.0", "id": j, "method": "eth_getBalance", "params": [addr, "latest"]}
                for j, addr in enumerate(chunk)
            ]
            try:
                resp = await client.post(url, json=batch)
                resp.raise_for_status()
                results = resp.json()
            except Exception as e:
                print(f"[bsc_balance] batch starting at {i} failed, leaving those "
                      f"owner balances unavailable (honest None): {e}")
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
