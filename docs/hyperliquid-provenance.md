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
month volume. See `collector.fetch_leaderboard` for why the PnL and
accountValue fields are not.

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
| row ORDER | **B** | month volume, never displayed, tracked-first then volume |

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

The rate and its counts are A. The account kind, whether it is a vault and
how many builders it has approved, is C. The holdings block is C. The
HyperCore block is D.

## What is presented as ours and is the venue's

**The selection, and it is not disclosed.** Which 31 addresses get measured at
all is decided by the venue's month volume ranking in the leaderboard file.
The maker table introduces itself as "The 50 highest-volume addresses", which
reads as a description this project made. It is the venue's number, and since
the ordering fix it is not even an accurate description of the table: the
rows are ordered tracked-first and then by volume, so they differ from the
true top 50 by 12 addresses and reach down to volume rank 65.

The measurements on those addresses are entirely ours. What is the venue's is
the choice of whom to measure, which is upstream of everything and is the one
piece of provenance the tab never mentions.

**Nothing else.** The status vocabulary is the venue's and is labelled as the
venue's. The bands are ours and read as ours. The HyperCore block says it is
read through a contract on HyperEVM.

## What is presented as the venue's and is ours

Nothing found. The reverse error does not appear on this tab.

## What a reader would expect and does not get

**A time series for one maker.** `service.address_series` exists, is exposed
through the MCP surface, and is rendered on no page. A reader looking at a
0.27% rate cannot tell whether it has been 0.27% all week or was 40%
yesterday, which is the first thing anyone would ask. This is the largest gap
on the list and the only one where the data is already computed.

**Volume.** The leaderboard's month volume orders the table and is never
shown. Of the leaderboard's fields it is the one that passes its own
consistency check, so there is no data reason not to show it. The reason is
that nobody added the column.

**Profitability.** Not shown, and it should not be. The leaderboard's PnL
contradicts itself on 51.3% of rows and its accountValue is 45% to 100% away
from the live venue. Recorded in `collector.fetch_leaderboard`.

**Spread, or how wide they quote.** The central market-making measure, and
absent. It needs order book snapshots, which this project does not collect:
the `l2Book` endpoint is a point-in-time read and the historical archive that
would answer it is Reservoir, which is requester-pays and not connected.

**Which markets one maker makes.** The per-coin table exists and the per-maker
table exists, and they do not cross. `hl_order_counts` is keyed by address and
coin, so the join is available and simply has no surface.

**How continuously they quote.** Uptime, in other words. `hl_poll` records
when we looked, not when they were present, so this is not answerable from
what is stored. The WebSocket feed could answer it for the ten addresses it
watches.

**Fees and rebates.** Not available from any endpoint this project reads.

**Who the maker is.** Not available, and the panel now says what little can be
established: whether the address is a vault, and whether it submits through a
front-end.
