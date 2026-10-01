# MCP tools

Tnega's MCP server gives an assistant the measurements on this site. It is
hosted, needs no key or account, and speaks JSON-RPC over POST at:

```text
https://mcp.tnega.app/mcp
```

How to connect it is on [Use with AI](use-with-ai.md) and in step 1 of
[Buy a tokenized stock through your assistant](buy-with-your-assistant.md).

## The nine tools

The descriptions below are shortened from the server's own manifest
(`backend/mcp_server/tools.py`), which a client reads with `tools/list`. Every
tool declares `readOnlyHint: true`: none of them writes, signs or sends
anything.

| Tool | What it does | Arguments |
|---|---|---|
| `tnega_catalogue` | Lists every dataset: its id, what it measures, the keys it accepts, which calls it supports, its live coverage and `as_of`. Call it first | none |
| `tnega_resolve` | Turns one string (an address, an ERC-8004 token id, an agent id, a chain view name, a ticker or company name, a basket code) into the datasets that accept it. Up to 12 candidates, from stored data only | `query` |
| `tnega_get` | One record in full from one dataset, with its coverage, caveats and `as_of` | `dataset`, `id` |
| `tnega_list` | A filtered page of compact rows from one dataset, up to 50, with a cursor for the next page | `dataset`, optional filters, `limit`, `cursor` |
| `tnega_summary` | One aggregate over one dataset (counts, breakdowns, totals) with the coverage behind it. Never a list of records | `dataset`, optional filters |
| `tnega_series` | One measurement over time, newest first. Today: Hyperliquid post-only rejection in 10-second buckets for one address | `dataset`, `key`, `limit`, `before` |
| `tnega_prepare_buy` | Prepares a buy of a tokenized stock for you to sign: picks the version with the lowest measured all-in cost, quotes LI.FI (at most 2 quotes), and returns the route, fees, an exact approval and a `tnega.app/sign` link | `query` (a ticker or `<chainId>/<token address>`), `usd_amount` (1 to 10,000), `wallet`, optional `pay_with` (USDC, USDT, USDG or `<chainId>/<address>`), `max_slippage_bps` (10 to 300, default 50) |
| `tnega_prepare_sell` | Prepares a sale of a tokenized stock the wallet holds: quotes LI.FI once, checks the price against Tnega's measured pool mid price, and returns the route, an exact approval and a `tnega.app/sign` link | `query`, `token_amount`, `wallet`, optional `receive`, `max_slippage_bps` |
| `tnega_wallet_holdings` | Which listed tokenized stocks one wallet holds on Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and HyperEVM: `balanceOf` on every version at one block per chain, nonzero balances only, with the chains read and the ones that failed | `wallet` |

A new measurement becomes a dataset in `tnega_catalogue`, not a new tool.

## The datasets

From `tnega_catalogue` on 30 September 2026 at 21:28 UTC:

| Dataset | What it measures |
|---|---|
| `tokenized_equities` | What it costs to buy a tokenized stock or ETF, per issuer's version on each chain, simulated on the pools at a stated block |
| `baskets.curated` | Tnega's fixed example baskets of tokenized stocks and ETFs, priced |
| `vaults.stablecoin` | Vaults taking a stablecoin deposit, read on chain: TVL, who controls them, what they lend against |
| `hyperliquid.post_only` | The share of an address's post-only orders the matching engine refused instead of resting on the book |
| `agents.index` | ERC-8004 agents on BNB Chain, with live service status |
| `chains.agents` | ERC-8004 agents on Ethereum, Arbitrum, Robinhood Chain, Solana and Monad |
| `jobs.erc8183` | On-chain ERC-8183 jobs for one provider |
| `budgets.escrow` | Budgets funded to agents, what was drawn and what was reclaimed |
| `chains.views` | Which chains are covered, and which can be hired on |

## How answers are shaped

Every answer carries `coverage` (what it was measured over), `as_of` (when it
was measured, or null where there is no such time) and `served_at` (when you
asked). A measurement with nothing behind it returns a `withheld_reason` rather
than a zero. Cite `as_of`, not `served_at`.

One call at a time per caller: a second concurrent call is refused, not queued.
Requests are capped per minute across all callers; on HTTP 429, wait the seconds
given in the `Retry-After` header (also in `error.data.retry_after_seconds`),
then retry.

## Calling it without a client

Anything that can POST JSON can call it. This lists the tools:

```bash
curl -s https://mcp.tnega.app/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

This is the call behind the buying guide's example:

```bash
curl -s https://mcp.tnega.app/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tnega_prepare_buy","arguments":{"query":"NVDA","usd_amount":5,"wallet":"0x000000000000000000000000000000000000dEaD","pay_with":"USDC"}}}'
```
