"""
chains.py

Per-chain facts the cost engine needs, each with where it came from. The
RPC choices follow the T0 matrix (2026-09-26):

- 1: Infura, then ethereum-rpc.publicnode.com (latest state, keyless, state
  override and Multicall3 checked in T0). eth.llamarpc.com answered HTTP 525
  to every call and is not used.
- 8453: mainnet.base.org, then Infura. 42161: arb1, then Infura.
- 56: bloXroute, then Infura. dRPC refuses state override on BSC.
- 4663: the chain's public RPC alone, paced at 2 calls a second with long
  retries on 429 (publicnode keeps only 64 blocks there). Its state window
  is about 10 minutes, so everything a refresh reads is stored with the
  block it was read at.
- 999: hyperliquid.drpc.org only. The official RPC, publicnode and
  hypurrscan answer every historical block tag with latest state, silently;
  dRPC was the only honest history found.

Block-pinned reads for the self-check (`archive`): Infura on 1, 8453,
42161 and 56 (full history, honest), dRPC on 999, and on 4663 the public
RPC inside its window only.
"""

from __future__ import annotations

import os

from .rpcclient import ChainRpc, Endpoint

NATIVE = "0x0000000000000000000000000000000000000000"


def _infura(path: str) -> Endpoint | None:
    key = os.environ.get("INFURA_API_KEY")
    return Endpoint(f"{path}.infura.io", f"https://{path}.infura.io/v3/{key}") if key else None


def _ep(url: str) -> Endpoint:
    return Endpoint(url.split("//", 1)[1].split("/", 1)[0], url)


CHAINS: dict[int, dict] = {
    1: {
        "name": "Ethereum", "slug": "ethereum", "native": "ETH", "wrapped_native": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        "l1_fee": None, "min_interval": 0.12,
        "v4_manager": "0x000000000004444c5dc75cb358380d2e3de08a90",
        "stables": {"USDC": ("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6), "USDT": ("0xdac17f958d2ee523a2206206994597c13d831ec7", 6)},
    },
    8453: {
        "name": "Base", "slug": "base", "native": "ETH", "wrapped_native": "0x4200000000000000000000000000000000000006",
        "l1_fee": "op_gas_price_oracle", "min_interval": 0.12,
        "v4_manager": "0x498581ff718922c3f8e6a244956af099b2652b2b",
        "stables": {"USDC": ("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 6)},
    },
    42161: {
        "name": "Arbitrum", "slug": "arbitrum", "native": "ETH", "wrapped_native": "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
        "l1_fee": "arb_node_interface", "min_interval": 0.12,
        "v4_manager": "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
        "stables": {"USDC": ("0xaf88d065e77c8cc2239327c5edb3a432268e5831", 6), "USDT": ("0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", 6)},
    },
    56: {
        "name": "BNB Chain", "slug": "bsc", "native": "BNB", "wrapped_native": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "l1_fee": None, "min_interval": 0.12,
        "v4_manager": "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
        "infinity_cl_manager": "0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b",
        "stables": {"USDT": ("0x55d398326f99059ff775485246999027b3197955", 18), "USDC": ("0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", 18),
                    "USD1": ("0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d", 18)},
    },
    4663: {
        "name": "Robinhood Chain", "slug": "robinhood", "native": "ETH", "wrapped_native": "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
        "l1_fee": "arb_node_interface", "min_interval": 0.5, "retries": 8, "state_window_blocks": 6000,
        "v4_manager": "0x8366a39cc670b4001a1121b8f6a443a643e40951",
        "stables": {"USDG": ("0x5fc5360d0400a0fd4f2af552add042d716f1d168", 6), "USDC": ("0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8", 6)},
    },
    999: {
        "name": "HyperEVM", "slug": "hyperevm", "native": "HYPE", "wrapped_native": "0x5555555555555555555555555555555555555555",
        "l1_fee": None, "min_interval": 0.5,
        "stables": {"USDC": ("0xb88339cb7199b77e23db6e890353e22632ba630f", 6), "USDT0": ("0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb", 6)},
    },
}

# The router address the probe runtime is injected at, per chain and venue
# family. A hook that gates on the swap's sender sees the router, as it does
# for a real user. Evidence, read 2026-09-26:
# - Uniswap Universal Router: on Base 0x6ff5…9b43 was the `to` of real V4
#   swaps in a sample of 25; the Ethereum (0x66a9…a8af) and Arbitrum
#   (0xa51a…81a3) addresses carry the same 19,499-byte runtime as it. On BSC
#   0x1906…eae07 was the `to` of real V4 swaps.
# - PancakeSwap Infinity router on BSC: the `to` of 24 of 25 real Infinity
#   CL swaps sampled (0xd9c5…9aeb).
# - Robinhood Chain: 0xe039…d6b7a6, the router of the swaps T0 validated the
#   sender-gated hook against (6 of 6 exact there; sells revert anywhere else).
# - HyperEVM: no V4 or Infinity pool is quoted there, so no hook can gate on
#   the sender; the probe runs at its own unused address.
ROUTERS: dict[int, dict[str, str]] = {
    1: {"default": "0x66a9893cc07d91d95644aedd05d03f95e1dba8af"},
    8453: {"default": "0x6ff5693b99212da76ad316178a184ab56d299b43"},
    42161: {"default": "0xa51afafe0263b40edaef0df8781ea9aa03e381a3"},
    56: {"default": "0x1906c1d672b88cd1b9ac7593301ca990f94eae07",
         "infinity_cl": "0xd9c500dff816a1da21a48a732d3498bf09dc9aeb"},
    4663: {"default": "0xe03952268a04afe16cc1b02c612478bd54d6b7a6"},
}


def router_for(chain_id: int, family: str) -> str | None:
    r = ROUTERS.get(chain_id) or {}
    return r.get(family) or r.get("default")


def latest_endpoints(chain_id: int) -> list[Endpoint]:
    if chain_id == 1:
        eps = [_infura("mainnet"), _ep("https://ethereum-rpc.publicnode.com")]
    elif chain_id == 8453:
        eps = [_ep("https://mainnet.base.org"), _infura("base-mainnet")]
    elif chain_id == 42161:
        eps = [_ep("https://arb1.arbitrum.io/rpc"), _infura("arbitrum-mainnet")]
    elif chain_id == 56:
        eps = [_ep(os.environ.get("BSC_MAINNET_RPC_URL") or "https://bsc.rpc.blxrbdn.com"), _infura("bsc-mainnet")]
    elif chain_id == 4663:
        # Primary only. publicnode's window on 4663 is 64 blocks (about 6 s at
        # 0.1 s blocks), so a read pinned to the refresh's block fails there
        # with "Archive requests require a personal token" within seconds.
        # A 429 from the primary is waited out instead (retries below).
        eps = [_ep("https://rpc.mainnet.chain.robinhood.com")]
    elif chain_id == 999:
        eps = [_ep("https://hyperliquid.drpc.org")]
    else:
        raise ValueError(f"chain {chain_id} is not in the cost engine")
    return [e for e in eps if e]


def archive_endpoints(chain_id: int) -> list[Endpoint]:
    """Endpoints that answer a pinned historical block honestly."""
    if chain_id in (1, 8453, 42161, 56):
        path = {1: "mainnet", 8453: "base-mainnet", 42161: "arbitrum-mainnet", 56: "bsc-mainnet"}[chain_id]
        e = _infura(path)
        return [e] if e else []
    if chain_id == 999:
        return [_ep("https://hyperliquid.drpc.org")]
    if chain_id == 4663:
        return [_ep("https://rpc.mainnet.chain.robinhood.com")]
    return []


def rpc_for(chain_id: int, *, archive: bool = False) -> ChainRpc:
    eps = archive_endpoints(chain_id) if archive else latest_endpoints(chain_id)
    return ChainRpc(chain_id, eps, min_interval=CHAINS[chain_id]["min_interval"],
                    retries_per_endpoint=CHAINS[chain_id].get("retries", 3))


def stable_by_address(chain_id: int) -> dict[str, tuple[str, int]]:
    """address -> (symbol, decimals) for the dollar stablecoins a buyer pays with."""
    return {a.lower(): (s, d) for s, (a, d) in CHAINS[chain_id]["stables"].items()}
