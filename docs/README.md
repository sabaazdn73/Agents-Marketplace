# Tnega

Live: [https://www.tnega.app](https://www.tnega.app)

Tnega lists every tokenized version of a stock or an ETF it can find across
chains, and measures what each one really costs to buy. The same share, NVIDIA
for example, is issued as separate tokens by different issuers on different
chains; each sits in its own pools, with its own depth and its own fees, so
$1,000 of one is not $1,000 of another. Tnega simulates the purchase on each
EVM version's pools at a range of order sizes, quotes each Solana version
through Jupiter, and shows the result side by side.

On 11 October 2026 at 06:32 UTC the cost engine read 2,765 of the 7,279
listed versions, 1,370 of them on Solana, and 158 had a measured cost to buy
$1,000 (64 on Robinhood Chain, 38 on BNB Chain, 38 on Solana, 10 on Base and 8
on Ethereum). The counts below and in the screenshot are from 30 September.

On 30 September 2026 at 21:01 UTC the site listed 1,378 stocks and ETFs, from
5 issuers (Robinhood, bStocks, xStocks, Ondo and Coinbase) on 7 chains
(Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain, HyperEVM and Solana),
and 120 tokenized versions had a measured cost (the counts in the home page's
header at that time). The screenshot's header row was updated on 1 October
2026 to show the Docs link; everything under the header is as taken.

![The Tnega home page: the counts, the search, and the tokenized stocks ranked by cost to buy $1,000](images/site-home.png)

## What is on the site

- **What it costs to buy.** For each EVM version, the all-in price per share at sizes from $100 to $250,000: the pool's price, price impact, the network fee, the L1 fee where there is one and LI.FI's 0.25% fee, over the tokens received, over the shares each token represents, simulated on the pools, not quoted. For each Solana version, Jupiter's route and price impact at $1,000 and $10,000, at a stated slot. See [Stocks & ETFs](stocks-and-etfs.md).
- **Issuer controls.** Who can pause the token, freeze a wallet, burn or seize tokens, upgrade the contract or mint, each read from the contract on chain with the block it was read at; and who may hold the token, in the issuer's own words, linked and dated. See [Issuer controls](issuer-controls.md).
- **Aave V4 collateral on Base.** For each Base version, whether the Aave V4 Equities Hub accepts it as collateral and at what maximum LTV, read on chain at a stated block. Shown on the stock pages.
- **Vaults.** Vaults that take a stablecoin deposit, with their admin, timelock and total value computed from chain reads. See [Vaults](vaults.md).
- **My ETFs.** Baskets of up to five stocks or ETFs, priced by the same cost engine, shared as a link. See [My ETFs](my-etfs.md).
- **Dashboard.** What a connected wallet holds: the total, the allocation by class and every position, read on six chains. See [Dashboard](dashboard.md).
- **Use with AI.** An MCP server that gives your assistant every measurement here, and can prepare an order for you to sign, on the EVM chains or on Solana. See [Buy a tokenized stock through your assistant](buy-with-your-assistant.md).
- **Receipts.** An optional record of a purchase, written on Solana devnet only with your signature, which anyone can re-check from a browser. See [Tnega Receipt on Solana](receipt.md).

Everything on the site is a measurement, not a recommendation. Tnega never
holds funds or keys and never signs: an order prepared through Tnega is signed
by you, in your own wallet, on a signing page or a stock page's Buy or Sell
tab, or nothing happens. Tnega takes
no fee. It is free while it is a proof of concept; once it works at scale, the
plan is a subscription of 20 USDC (or $20) a month.

## Buying

There are two routes. On the site, a stock's page has Buy and Sell tabs,
switched on for all six chains (a version with no measured pool is refused):
LI.FI quotes in your browser and you sign in your own wallet (see [Stocks & ETFs](stocks-and-etfs.md#details-buy-and-sell)).
On every chain an order can be prepared on, Solana included, an assistant
prepares the purchase through Tnega's MCP server and you sign it on a
`tnega.app/sign/…` page: LI.FI routes it on the EVM chains, Jupiter on Solana,
paid in USDC. That route, with screenshots of every step, is
[Buy a tokenized stock through your assistant (step by step)](buy-with-your-assistant.md).
After a purchase on Solana you can ask for a [receipt](receipt.md).

## Also here

- [On-chain agents](onchain-agents.md): Explore agents, the ERC-8004 agent registries Tnega reads on six chains. This is where the project started.
- [Hyperliquid](hyperliquid-order-book.md): the order-book readings tab (post-only rejection per market and per maker) and the Chrome extension, with its practice mode on Hyperliquid's trading pages.

## Reference

- [MCP tools](mcp-tools.md), [Data sources](data-sources.md), [Privacy](privacy.md), [Deployed contracts](deployments.md), [Tnega Receipt on Solana](receipt.md) and [Tokenized equity measurements and their provenance](tokenized-equity-measurements.md).

Pages that describe earlier parts of the project, such as the agent studio,
native agents, budgets and escrow, the investigations and the hackathon
entries, are kept under **Archive** at the end of the navigation. They
describe the project as it was when each was written, and are not updated.
