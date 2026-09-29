"""The chains an order can be prepared on, and what pays on each.

A MIRROR, NOT A SOURCE. frontend/src/trade/chains.js (BUY_CHAINS) is the
source of truth: the page that signs an order builds its transactions from
that file, so an order prepared here for a chain or a pay token the page does
not know would be a link that cannot be signed. scripts/sign_selfcheck.py
parses chains.js and fails on any difference in chain, symbol, address or
decimals.

Each address was read on its own chain on 2026-09-27 (symbol() and
decimals()), as recorded in chains.js. Robinhood Chain pays with USDG only;
the other USDC there is never offered (chains.js says why).

A stablecoin is taken at $1 wherever a dollar figure is derived from it. That
is an assumption, and every answer that uses it says so.
"""

from __future__ import annotations

BUY_CHAINS: dict[int, dict] = {
    1: {"name": "Ethereum", "explorer": "https://etherscan.io", "pay": [
        {"symbol": "USDC", "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "decimals": 6},
    ]},
    8453: {"name": "Base", "explorer": "https://basescan.org", "pay": [
        {"symbol": "USDC", "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "decimals": 6},
    ]},
    42161: {"name": "Arbitrum", "explorer": "https://arbiscan.io", "pay": [
        {"symbol": "USDC", "address": "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "decimals": 6},
    ]},
    56: {"name": "BNB Chain", "explorer": "https://bscscan.com", "pay": [
        {"symbol": "USDT", "address": "0x55d398326f99059ff775485246999027b3197955", "decimals": 18},
        {"symbol": "USDC", "address": "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", "decimals": 18},
    ]},
    4663: {"name": "Robinhood Chain", "explorer": "https://robinhoodchain.blockscout.com", "pay": [
        {"symbol": "USDG", "address": "0x5fc5360d0400a0fd4f2af552add042d716f1d168", "decimals": 6},
    ]},
    999: {"name": "HyperEVM", "explorer": "https://hyperevmscan.io", "pay": [
        {"symbol": "USDC", "address": "0xb88339cb7199b77e23db6e890353e22632ba630f", "decimals": 6},
    ]},
}


def is_buy_chain(chain_id) -> bool:
    try:
        return int(chain_id) in BUY_CHAINS
    except (TypeError, ValueError):
        return False


def pay_token(chain_id: int, address: str) -> dict | None:
    """The pay token at this address on this chain, or None."""
    a = str(address or "").lower()
    for t in (BUY_CHAINS.get(int(chain_id)) or {}).get("pay") or []:
        if t["address"] == a:
            return t
    return None


def pay_by_symbol(chain_id: int, symbol: str) -> dict | None:
    s = str(symbol or "").upper()
    for t in (BUY_CHAINS.get(int(chain_id)) or {}).get("pay") or []:
        if t["symbol"] == s:
            return t
    return None


def default_pay(chain_id: int) -> dict:
    return BUY_CHAINS[int(chain_id)]["pay"][0]


def pay_symbols() -> list[str]:
    return sorted({t["symbol"] for c in BUY_CHAINS.values() for t in c["pay"]})


def tx_url(chain_id: int, tx: str) -> str | None:
    c = BUY_CHAINS.get(int(chain_id))
    return f"{c['explorer']}/tx/{tx}" if c and tx else None


def address_url(chain_id: int, address: str) -> str | None:
    c = BUY_CHAINS.get(int(chain_id))
    return f"{c['explorer']}/address/{address}" if c and address else None
