# Data sources

Where each figure on the site and in the MCP answers comes from. The live list
of every external service, with its status, is the site's
[Data sources page](https://www.tnega.app/data-sources). The provenance of the
tokenized-equity figures, measurement by measurement, is in
[Tokenized equity measurements and their provenance](tokenized-equity-measurements.md).

Tnega is in its proof-of-concept phase and not yet commercial. Every figure is
labelled with its source; chain reads come first.

## Tokenized stocks and ETFs

| Figure | Source |
|---|---|
| Which tokens exist, and who issued them | Each token's contract, read on chain (identity from its own `name()`, the issuer's contract verified by its structure), per issuer and chain |
| Cost to buy, per version and size, EVM chains | Tnega's own simulation: each purchase is run on the version's pools by the TnegaSwapProbe contract inside an `eth_call` at a pinned block on public RPC endpoints. Nothing is deployed or sent. The network fee and the L1 fee are added, and LI.FI's 0.25% fee |
| Cost to buy, Solana | Jupiter's public quote API (`lite-api.jup.ag`): the route and its price impact for a $1,000 and a $10,000 buy in USDC, at a stated slot. A quote, not a pool read; no network fee or LI.FI fee |
| Shares per token | Read from the token's contract at the quote block: the multiplier each issuer's contract exposes (xStocks, Robinhood, bStocks, Coinbase), and on Solana the Token-2022 scaled-UI ratio (xStocks). Ondo's ratio is not read, so Ondo versions are shown but not ranked on price |
| Issuer controls | The token's contract and its role holders, read on chain, each with its block or slot |
| Who may hold | The issuer's own terms, quoted, linked and dated. Issuer figures such as supply are not served; the site links the issuer's page |
| Aave V4 collateral on Base | The Aave V4 Equities Hub on Base, read on chain every 10 minutes at a stated block |
| The quote at buying time | LI.FI (li.quest) on the EVM chains and Jupiter on Solana, asked by the MCP server when an order is prepared and again by your browser on the signing page. On Solana the page also reads the mints, your balances and Jupiter's address lookup tables from a public Solana RPC endpoint |
| Receipts | The Tnega Receipt program on Solana devnet, and the purchase on its own chain, read by your browser from public RPC endpoints. See [Tnega Receipt on Solana](receipt.md) |
| Logos | Company and fund issuer logos from Wikimedia Commons (through Wikidata), under free licences, and xStocks' own token images; initials where there is no logo |

## Vaults

Solana vaults (Kamino, Voltr, GLAM) are read on chain through Helius. Kamino
and GLAM totals are Tnega's chain reads; Voltr positions are as the vault
records them. Venues read with nothing listed (Hyperliquid, HyperEVM) carry the
sources that were read for them, with dates.

## Agents

ERC-8004 identity and reputation from the registries on each chain, through
8004scan and The Graph where the registry's own pagination falls short; job and
delivery records from the ERC-8183 contract on chain; service status from each
agent's own endpoint.

## Hyperliquid

Hyperliquid's public API: `historicalOrders` over REST for the rejection rates,
and the `orderUpdates` WebSocket for the 10-second series (suspended since
2026-09-19). Positions on HyperCore are read through a contract on HyperEVM.
