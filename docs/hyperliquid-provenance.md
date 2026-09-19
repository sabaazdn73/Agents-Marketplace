# Where every number on the Hyperliquid tab comes from

Written 2026-09-18, because the tab mixes four sources and a reader cannot
tell them apart from the page. Each figure below names the one that produced
it. Where a figure is the venue's rather than ours, or ours rather than the
venue's, that is said in the last section rather than left to be inferred.

## The four sources

**A. Our own collection.** CockroachDB tables this project writes: `hl_poll`
and `hl_order_counts` from the REST poller every 15 minutes, `hl_ws_buckets`
and `hl_ws_coverage` from the WebSocket worker continuously, `hl_targets` from
the daily selection job. Nothing here is fetched at request time.

**B. The venue's leaderboard file.**
`https://stats-data.hyperliquid.xyz/Mainnet/leaderboard`, about 37MB and
46,171 rows, parsed once a day on a GitHub runner. Only one field is read:
month volume. It carries accountValue and four windows of pnl, roi and vlm as
well, and `collector.fetch_leaderboard` records what those were checked
against. It is a periodic snapshot rather than a live read, around half an
hour behind when it was measured.

**C. The venue's live API.** `https://api.hyperliquid.xyz/info`, called at
request time and cached six hours.

**D. On chain.** HyperEVM chain 999, read through this project's own deployed
`HyperCoreReader` contract.

## Figure by figure

### Coverage banner

| Figure | Source | Note |
|---|---|---|
| polls | A | `hl_poll` row count |
| orders observed | A | `sum(n)` over `hl_order_counts` |
| polls with a gap | A | positive `gap_seconds` only; the negative ones are not surfaced |
| hours covered | A | span between first and last poll, not time actually collected |
| addresses (66) | A | distinct addresses ever in `hl_poll` |
| addresses tracked (31) | A + **B** | the COUNT is ours; WHICH addresses is the venue's ranking |
| targets refreshed at | A | when the job that reads B last ran |

### Maker table

| Figure | Source | Note |
|---|---|---|
| address | A + **B** | we measured it; the venue's volume ranking chose it |
| post-only seen, refused | A | counted from our polls |
| rejection rate | A | `alo_rejected / alo_total`, pooled over all polls for that address |
| cancel to fill | A | |
| effective fill rate | A | |
| polls | A | |
| Vault label | **C** | live `userRole`, and `vaultDetails` for the name |
| 30d volume | **B** | the venue's own figure, and what orders this table |
| Last 48h line | A | hourly rate from `hl_order_counts`, same filter as the rate |
| row ORDER | **B** | month volume, tracked-first then volume |

### Market table

Every column is A. Coin, post-only totals, median rejection, pooled
rejection, min and max, makers over half, makers under one percent. All
counted from `hl_order_counts` restricted to `hl_targets`.

### Status breakdown

The status NAMES are the venue's vocabulary: `filled`, `canceled`,
`reduceOnlyCanceled`, `iocCancelRejected` and the rest are Hyperliquid's own
strings, and the tab says so. The COUNTS are A.

### Band tiles

The counts are A. The bands themselves are ours: the names quoting, mixed and
spraying, and the thresholds that separate them, are this project's and
appear nowhere on the venue.

### Brain section

Every figure is A, from `hl_ws_buckets` and `hl_ws_coverage`, with the
tracked-address denominator from `hl_order_counts`.

### WebSocket coverage

Every figure is A. It is the one place on the tab that reports both
`hours_covered` and `hours_span`, so a reader can tell collection from
elapsed time.

### On chain now

Positions, entry price, mark price and the HyperCore block are D. The list of
markets checked is ours: a five-market constant in `corestate.PERPS_CHECKED`.

### The extension's per-address panel

The rate, its counts and the 48-hour line under it are A. The account kind,
whether it is a vault and how many builders it has approved, is C. The
holdings block is C. The HyperCore block is D.

## Who the page is written for

Added 2026-09-18, because it decides how several of these figures are ordered
rather than merely how they are worded. The readers are protocols routing
their users' perp orders through Hyperliquid. For them a refused post-only is
a user whose order neither rested nor filled. For a market maker the identical
event is the mechanism working, saving them a taker fee. The tab now states
both readings at the top rather than leaving a reader to supply one.

This is also why the market table leads with the median maker and keeps the
pooled figure in a labelled column rather than the reverse. Venue-wide the
pooled rate is 11.8% and the median maker in the median market sees 0.15%; on
BTC the two are 55.7% and 0.47%, because 2 of 23 makers place most of the
orders and are refused most of the time. A protocol's flow behaves like the
median, so leading with the pooled figure would be wrong for them by two
orders of magnitude. The pooled column stays because a book where two
addresses dominate is worth seeing.

## What is presented as ours and is the venue's

**The selection. Found and corrected 2026-09-18.** Which 31 addresses get
measured at all is decided by the venue's month volume ranking in the
leaderboard file. The maker table used to introduce itself as "The 50
highest-volume addresses", which reads as a description this project made. It
was the venue's number, and after the ordering fix it was not even an accurate
description of the table: rows are ordered tracked-first and then by volume,
so they differ from the true top 50 by 12 addresses and reach down to volume
rank 65.

The measurements on those addresses are entirely ours. What is the venue's is
the choice of whom to measure, which is upstream of everything and was the one
piece of provenance the tab never mentioned. The copy now says the set is
chosen by the venue's own 30-day ranking rather than by us, and the volume
that does the choosing is a column, so a reader can see the criterion rather
than being told about it.

**Nothing else.** The status vocabulary is the venue's and is labelled as the
venue's. The bands are ours and read as ours. The HyperCore block says it is
read through a contract on HyperEVM.

## What is presented as the venue's and is ours

Nothing found. The reverse error does not appear on this tab.

## What a reader would expect and does not get

**A time series for one maker. BUILT 2026-09-18.** It was the largest gap on
this list and is now a column in the maker table and a line under the rate in
the extension panel and the popup: 48 hours of hourly post-only rejection
rate, beside the figure it explains.

It is NOT `service.address_series`, which is what this section originally
pointed at. That function reads `hl_ws_buckets`, and the WebSocket feed
carries no `tif`, so its denominator is every order update of any kind rather
than post-only orders. Its own docstring says the two must not be shown as
though they were the same quantity, and it covers only the ten addresses the
feed watches. `service.maker_rate_series` was written instead, reading
`hl_order_counts` filtered the same way `makers()` filters it, so the line and
the number are one measurement at two resolutions.

Three rules it carries: an hour with no post-only orders is a null and a break
in the line, never a drop to zero; each line is scaled to its own address, so
height compares a maker with itself and not with the row above; and where the
rate is withheld the line is withheld too, because hourly rates beside a
withheld figure are that figure republished at finer resolution.

**Volume. SHOWN 2026-09-18.** The leaderboard's 30-day volume now has a column,
labelled as the venue's figure rather than ours, with a note that it is what
chose these addresses and what orders the table. It is the leveraged figure,
which is what a venue means by volume, not capital at risk.

**Profitability. Still not shown, but not for the reason first given.**
This section said on 2026-09-18 that the leaderboard's PnL contradicted itself
on 51.3% of rows and its accountValue was 45% to 100% away from the live
venue. Both claims were wrong and are withdrawn the same day.

The first came from testing whether month PnL exceeded allTime PnL. PnL is
signed, so that comparison carries no information: 87.9% of the flagged rows
have a negative allTime figure, where a profitable month legitimately exceeds
a losing lifetime. The second came from six addresses picked by volume rank,
the largest and most active accounts on the venue, generalised to the file.

What the fields mean was then read from the venue rather than from their
names. The `portfolio` endpoint returns the same four windows; its allTime
history spans 13 days for a new account and 1,101 for an old one, so allTime
is since inception. Against that endpoint, on 60 randomly sampled addresses
over $50k, the file disagrees by a median 0.17% of account value on allTime
and 0.41% on month. On 40 randomly sampled addresses the live total sits
within 10% of accountValue for 60%, the misses run both ways, and the median
ratio is 1.00. One definitional difference matters: accountValue is perps,
spot, staking and vault equity together, not the perps figure
`clearinghouseState` returns.

So the file is sound and the reason for not showing PnL is now a narrower
one. A per-maker profit column would be the venue's number for a window that
is not the window we measure, sitting beside rates we computed, in a table a
reader already has to be told is chosen by the venue rather than by us. It
would also be the one figure on the tab that invites a reader to rank people
rather than read a measurement. That is a judgement about the page, not a
finding about the source, and it should be described as one.

What the data does support is the caveat, and it is now stated with its
number rather than hedged: across the 30 rated makers that appear on the
leaderboard, the correlation between post-only rejection rate and 30-day
return is +0.013 by Pearson and +0.118 by rank. The limit on that claim is
n=30, not the quality of the file.

**Where a profit figure came from. PARTLY BUILT 2026-09-19.** The leaderboard
publishes a PnL and nothing about its composition, and an account can show
+$268M having never placed an order. `core.hyperliquid.attribution` computes
the composition from this project's own reads, and reaches an answer for one
shape of account.

It closes for an account whose value sits in staking: on one address holding
12.0M HYPE with no orders ever, integrating the stake hourly against the price
path and valuing each payout when it landed gives $269,440,585 against the
venue's $268,758,782, a 0.25% difference. The composition is reproduced; the
cent is not, because the window boundary is only resolved to about an hour and
an hour is worth roughly $2M on that stake.

It does not close for an account that trades, and the reason is worth writing
down because it is not the obvious one. `closedPnl` on a fill is what that
position earned over its whole life, booked when it closed. A windowed figure
is a mark-to-market change between two dates. Across accounts with complete
fills history, `closedPnl` minus fees came to between -0.25 and 2.76 times the
venue's figure for the same month, and restricting to accounts that were flat
with USDC-only spot and no delegation did not fix it: a position open at the
window start carries a cost basis from before it, and funding is not in
`closedPnl` at all. Converting one into the other needs position and balance
state at the boundary, which is not published.

Two things that are NOT the obstacle, checked so nobody re-checks them. The
2,000-record cap on `userFills` is on count rather than time, so 76% of
sampled trading addresses have the full 30 days available. And
`api-ui.hyperliquid.xyz`, the host the app itself uses, returns identical
answers to the public API.

**Spread, or how wide they quote.** The central market-making measure, and
absent. It needs order book snapshots, which this project does not collect:
the `l2Book` endpoint is a point-in-time read and the historical archive that
would answer it is Reservoir, which is requester-pays and not connected.

**Which markets one maker makes. BUILT 2026-09-18.** The per-coin table and
the per-maker table did not cross, so neither answered the question someone
routing order flow asks: the rate where the order is going, which is one
address in one market. `service.maker_markets` pivots the grouping `markets()`
already performs and the maker table expands a row into it. Every figure in it
is A. Twelve markets per address, covering 99% of the median address's
post-only flow, with the rate withheld below 200 orders in a market.

It changed what the tab can show. One address reads 27.35% overall and 100.00%
in `xyz:SP500` across 153,727 post-only orders, a market where nothing rests at
all, which no figure published before it made visible.

**How continuously they quote.** Uptime, in other words. `hl_poll` records
when we looked, not when they were present, so this is not answerable from
what is stored. The WebSocket feed could answer it for the ten addresses it
watches.

**Fees and rebates.** Not available from any endpoint this project reads.

**Who the maker is.** Not available, and the panel now says what little can be
established: whether the address is a vault, and whether it submits through a
front-end.
