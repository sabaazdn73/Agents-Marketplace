# Stocks & ETFs, and a stock's page

The screenshots on this page were taken on https://www.tnega.app on
30 September 2026 between 21:05 and 21:17 UTC. The figures in them are the
ones the site served at that time, measured at 21:01 UTC with the US market
closed.

## The list

Stocks & ETFs (`/stocks`) lists every stock and ETF with at least one tokenized
version, with the version that costs least per share at $1,000, its chain, the
cost to buy $1,000 and how many versions exist. The All, EVM and Non-EVM
switches narrow it by chain type. ETFs have a list of their own below the
stocks.

![Stocks & ETFs: the tokenized stocks list with the per-share all-in price, the cost to buy $1,000 and the number of versions for each stock](images/site-stocks.png)

The counts above the list say what they cover. On 30 September: 63 stocks fill
$1,000 and are ranked; 2 more fill but are not ranked because their share ratio
is not read (DIS, PDD); 136 more have no version that fills $1,000. Those counts
cover the 201 stocks with at least one EVM version the cost engine reads.

## A stock's page

Each stock has a page, `/stocks/<ticker>`, with every tokenized version of it.
The size buttons ($100 to $250k) change the order size every figure on the page
is measured at.

![The NVIDIA page at $1,000: every version with its chain, per-share all-in price, tokens per $1,000, cost against the pool's mid price, depth within 2%, and its state](images/site-stock-page.png)

For each version:

| Column | What it is |
|---|---|
| Version | The token's symbol and its issuer. Under a Base version, whether Aave V4 takes it as collateral, and the block that was read at |
| Chain | The chain the token is on, EVM or non-EVM |
| Per share, all-in | The order size, gas, the L1 fee and LI.FI's 0.25% fee, over the tokens received, over the shares per token. The crown marks the lowest among versions that fill the size and whose share ratio is read |
| Tokens per $1,000 | What the size buys, in tokens |
| Cost (vs pool mid) | Fees and price impact against the pool's own price, in basis points. It does not rank one version against another, because each pool has its own price |
| Depth ±2% | The smaller side of the pool within 2% of its price |
| State | Fills the size; not ranked (and why); pool too thin; no pool found; or not searched on that chain |

"Details" picks that version for the lower part of the page (see "One version
in detail" below).

Costs are simulated, not quoted: each purchase is run against the pool's
contracts inside an `eth_call` at a pinned block on a public RPC endpoint, so
nothing is sent and the result is the pool's own answer at that block.

### Aave V4 collateral on Base

On 30 September, the NVDAc row read "Collateral on Aave V4: yes, max LTV 70% ·
block 52,006,366, 30 Sep, 21:01 UTC". This comes from one read of the Aave V4
Equities Hub on Base, refreshed every 10 minutes: for each Base version, whether
it is listed, its collateral factor (served as the maximum LTV), how much is
supplied against its cap, and the oracle price. When a read fails, the last good
reading is kept and marked stale; it is never shown as a zero.

### Cost per chain at any size

Below the table, an order-size slider shows, for each chain, the lowest-cost
ranked version at that size and its cost in basis points.

### One version in detail

Under the slider, the page shows one version (the crowned one, or the one
picked with "Details"): its token address, shares per token and block; who may
hold it, in the issuer's words, linked and dated; and the issuer's controls on
that token.

![A stock page's lower half: NVDA on Robinhood Chain, who may hold it in the issuer's words, and the issuer controls on it](images/site-stock-page-issuer.png)

The same page in the dark theme (the theme switch is in the header):

![The NVIDIA page in the dark theme](images/site-stock-page-dark.png)

## The home page

The home page (`/`) opens with the counts, a search and shortcuts to five
tickers, then the same ranked list, one stock's versions side by side, the
chains read, the cost per chain at a size you choose, a My ETFs example, vaults
and issuer controls, each linking to its page.

On a phone, the header navigation becomes a bar at the bottom of the screen:

![The home page at 390 pixels wide](images/site-home-phone.png)
