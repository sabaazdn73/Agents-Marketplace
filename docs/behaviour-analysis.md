# On-Chain Behaviour Analysis

A method for measuring what a wallet actually does on chain, from public
transaction data alone, with no cooperation from whoever runs it. It ships in
the product as a section inside the Solana tab.

The worked example is an arbitrage bot. It is a bot and not an agent: it runs a
fixed rule and submits transactions, takes no instructions, does not adapt and
decides nothing. That distinction is kept throughout, because anyone who knows
the difference would discount the rest of the page for getting it wrong.

## Where it lives

Inside the Solana chain tab, collapsed by default, below the agent preview. It
is Solana-specific work, so it belongs to that chain rather than to the
marketplace, and it briefly had a top-level sidebar tab which implied the
latter.

## What the method measures

Four things, each answerable from transaction data:

| Question | Measured by |
|---|---|
| Success rate | The share of signed transactions that revert |
| Activity pattern | Inter-arrival gaps, to separate polling from event-driven behaviour |
| Sizing | The distribution of trade sizes, to separate a fixed size from sizing to opportunity |
| Concentration | Which venues and pairs, and how spread out |

The point of the exercise is that the interesting findings are the ones the
operator would not publish. An explorer shows the transactions that landed. The
revert rate is the number nobody sees.

## Two measurement decisions worth carrying forward

Both were mistakes caught during the work rather than foresight.

Solana's `block_time` is second granularity, so inter-arrival percentiles
derived from it are interpolation rather than measurement. A first pass
produced a median gap of 621 ms that the underlying data cannot support. Slot
numbers are the honest clock at roughly 400 ms each, so timing is measured in
slot deltas.

A single address looked like an eight day old bot until a second address was
analysed. That one had been trading for at least six months and stopped the day
the first took over. Analysing one wallet and describing the operation is a
category error, and the handover only became visible when both were on the same
axis.

## What it found

Two wallets running the same software in sequence, with the handover on 10 to
11 September 2026.

| Measure | First wallet | Second wallet |
|---|---|---|
| Revert rate | 61.69% | 60.06% |
| Dominant error | `InstructionError[2, Custom(0)]` | the same |
| Its share of all transactions | 55.23% | 53.92% |
| Instruction index that fails | 2, every time | 2, every time |
| Average compute units | 130k to 139k | 127k to 135k |
| Submissions in the same slot | 40.16% | 35.72% |

The first wallet, over 30 days: 922,473 transactions, 727,794 swaps,
$179.7M of volume across 23 venues and 7,766 pairs. It paid 1,691.95 SOL in
fees, of which 489.93, or 29%, went on transactions that reverted.

Timing decays monotonically from zero with no spike at any interval, which is
an opportunity-triggered arrival process rather than a fixed cadence. Sizing
spans a factor of 160 from p25 to p99, which is not what a configured trade
size looks like.

## What the method cannot establish

These are properties of the method, not of the subject, so they apply to any
future use of it.

Profitability is not measurable this way. Swap volume is turnover. Net PnL needs
balance differencing across each transaction cycle plus fees and any tips paid
outside the fee field.

Program-defined error codes are opaque without the program's IDL. A code
accounting for 90% of failures was not decoded, and the obvious reading of it
is inference rather than evidence.

Lost races are invisible. Failures can be counted; the competitor that won and
the opportunity never attempted cannot. A high revert rate is therefore not
evidence of inefficiency without knowing what the winners' rate looks like on
the same pairs.

Submission timing is not decision timing. A bot polling every slot and
submitting only on an opportunity produces the same trace as one triggered by
events.

Only the decoded subset is visible. Venue and pair figures describe swaps a
curated trades table decodes, and transactions that landed without one are
absent from those sections.

## What transfers to the EVM chains, and what does not

The method needs a complete transaction table. That is what makes the success
rate and timing sections possible, and it is not uniformly available.

| Source | Covers | Gives revert rate, timing, sizing, counterparty |
|---|---|---|
| Our own `erc8183_job_index` | Every ERC-8183 job | No. Job lifecycle only, nothing about the transactions underneath |
| Etherscan free tier | Ethereum, Arbitrum | Yes, at no cost |
| Etherscan free tier | BNB Chain | No. The account module is not covered on the free tier |
| Etherscan free tier | Robinhood Chain | No. Not a supported chain |
| Dune | BNB Chain, Ethereum | Yes, at a cost that scales with the scan rather than the address count |
| Direct JSON-RPC | Any EVM chain | No. There is no method that lists an address's transactions |

That last row is the structural limit. `eth_getTransactionCount` gives an
activity count cheaply and batches well, but counting is not listing, and
`eth_getLogs` returns events rather than transactions.

## Which addresses are worth analysing

Most are not. A behaviour analysis of an address with three transactions is not
worth the query, and the median agent owner has sent between one and four in its
life.

Sampled 600 owners per chain and read their nonces, with a 95% confidence
interval and a finite-population correction:

| Chain | Owners | Median txs | Clearing 100 txs | 95% CI |
|---|---|---|---|---|
| BNB Chain | 125,224 | 4 | about 25,880 | 21,832 to 29,927 |
| Ethereum | 9,597 | 1 | about 720 | 524 to 916 |
| Arbitrum | 948 | 1 | about 25 | 17 to 32 |
| Robinhood Chain | 84 | 3 | 7 | exact |

Nonce is a sound proxy for this. On one address where both were available, the
transaction count from a full scan and the nonce agreed exactly at 83,224.

So the method is worth running on BNB Chain, where the population is large
enough to say something general, and on Ethereum, where it costs nothing. On
Arbitrum and Robinhood Chain the qualifying population is 25 and 7 addresses,
which is a case study rather than a population.

One early signal from a 200-address sample on BNB Chain: revert counts sat
between 0 and 15 per several hundred transactions, nothing resembling the 60%
seen on Solana. The headline finding does not transfer, and the interesting EVM
question is more likely concentration and timing than failure.
