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

Six things, each answerable from transaction data. The last two were added
by the second pass below, in response to a question the first four could not
answer:

| Question | Measured by |
|---|---|
| Success rate | The share of signed transactions that revert |
| Activity pattern | Inter-arrival gaps, to separate polling from event-driven behaviour |
| Sizing | The distribution of trade sizes, to separate a fixed size from sizing to opportunity |
| Concentration | Which venues and pairs, and how spread out |
| Position | Where in the block a transaction lands, against the block's own size |
| Bidding | Fee paid above the base fee, split by whether the transaction landed |

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

## Second pass: was it fast, or is it cheap to be wrong?

Measured 2026-09-14. The first pass produced an apparent reaction speed that
prompted a reasonable objection from a reader: a bot could not react that
quickly reading chain state through ShredStream or gRPC, so it must be taking
signals from somewhere else.

That is checkable rather than arguable, because Dune carries the transaction's
position in the block. A third possibility was tested alongside it: that the
bot is not reacting at all, but submitting on a prediction and letting the
transaction revert when the prediction is wrong. Cheap failures substituting
for speed would produce the same trace.

Window is 2026-09-05 to 2026-09-14 unless stated, covering wallet B's last
active days and wallet A's takeover.

### One schema trap, first

Dune's `index` on `solana.transactions` is the position in the full block, but
that table excludes vote transactions. Some slots return 575 rows with a
maximum index of 1238. Reading `index` as a rank understates how early a
transaction sat, so position is normalised against the real non-vote count per
block below.

A second off-by-one: Dune's `outer_instruction_index` is 1-based while the
error's instruction index is 0-based. Taking the error's index 2 literally
against Dune points at `ComputeBudget`, which cannot throw a custom error.

### It does not land early

| Wallet / outcome | n | first | top 5 | p25 | p50 | p90 |
|---|---|---|---|---|---|---|
| A landed | 41,980 | 0.08% | 1.30% | 215 | 554 | 1,140 |
| A reverted | 68,436 | 0.05% | 0.25% | 258 | 584 | 1,210 |
| B landed | 61,860 | 0.06% | 1.02% | 224 | 560 | 1,131 |
| B reverted | 82,487 | 0.03% | 0.24% | 256 | 586 | 1,219 |

Normalised against real block size, wallet A over one hour: a landed
transaction sits at median rank 208 of a 452-transaction block, a reverted one
at 223 of 486. That is 44% to 49% of the way through. It is first in block on
roughly a quarter of one percent of transactions.

So the premise is not supported. Whatever speed was inferred, the bot is not
winning by being first.

Landed transactions do sit slightly earlier than reverted ones, and the
direction holds across both wallets and both measurement methods: about five
times more likely to be in the block's top five. Position appears to matter
when it gets it, and it rarely gets it.

### It pays heavily for position

This reframes the section above and is the finding worth carrying forward.
Fees in lamports; the Solana base fee is 5,000 per signature.

| Wallet / outcome | p50 | p99 | max | at base fee |
|---|---|---|---|---|
| A landed | 97,342 | 109,215,429 | 7,405,503,323 | 18.0% |
| A reverted | 61,211 | 7,586,355 | 568,138,750 | 7.0% |
| B landed | 70,270 | 80,113,352 | 23,359,996,928 | 19.4% |
| B reverted | 52,471 | 8,213,173 | 796,880,000 | 8.8% |

Three things worth separating. The tail is enormous: wallet B's largest single
fee is 23.36 SOL, wallet A's is 7.41 SOL, which are auction bids rather than
gas. Winners pay 10 to 14 times what losers pay at p99, against only about
1.6x at the median. And it is bimodal: 18 to 19% of landed transactions pay
the bare base fee against 7 to 9% of reverted ones, so a real share of its
wins are uncontested and cost nothing to take.

### Same-slot submissions, and why their correlation matters

33.4% of the slots wallet A appears in hold two or more of its own
transactions, and 57.3% of its transactions sit in such a slot. The hit rate
falls as the count rises: 44.0% alone, 39.0% at two, 22.8% at five or more.

Take the 16,637 slots holding exactly two. Landed rate across those is 0.390.

| Wins in the slot | if independent | observed |
|---|---|---|
| 0 | 37.2% | 43.7% |
| 1 | 47.6% | 34.7% |
| 2 | 15.2% | 21.7% |

Both tails are fatter than independence predicts and the middle is thinner.
The two transactions tend to succeed together or fail together.

That argues against the simplest spray model, where several copies chase one
opportunity and at most one can win, because that would push outcomes apart
rather than together. It fits a batch fired on one shared judgement: when the
judgement holds several land, when it does not they all abort.

### Every failure is its own program refusing

All errors in both wallets sit at instruction index 2, which resolves to one
program: `AN225ykGPAmckE9uMCCM7jQv3L3AYwiPZbHqgMUYEgCR`. On wallet B, 87.0% of
82,487 reverts are `Custom(0)`, with `Custom(3005)` at 3.5% and `Custom(2014)`
at 2.9% behind it.

The instruction layout is identical whether the transaction lands or reverts:
System, ComputeBudget, the arb program, then two further ComputeBudget
instructions. It does not send a different shape of transaction when guessing.

The structural point stands without decoding anything: the bot routes through
a program it controls, and that program aborts atomically. A wrong attempt
costs the fee and touches no balances. It does not need to be fast, because it
is cheap to be wrong.

Reading `Custom(0)` as a profitability or slippage guard is inference. It
matches the Anchor convention for the first declared error, but the program's
IDL was not available and this was not verified.

### The venue test does not separate the two stories

If it failed on different venues than it succeeded on, that would point at
prediction. Inner program calls were compared across two ten-minute windows,
normalised against the most common venue in each group.

| Venue | W1 reverted | W1 landed | W2 reverted | W2 landed | Stable |
|---|---|---|---|---|---|
| Orca whirlpool | 0.28 | 0.66 | 0.14 | 0.33 | yes, wins |
| Pump AMM | 0.45 | 0.31 | 0.59 | 0.69 | flips |
| BiSo | 0.20 | 0.06 | 0.29 | 0.50 | flips |
| cpamd | 0.22 | 0.63 | 0.09 | 0.15 | weakens |

Only Orca holds direction, and two ten-minute windows is not enough to assert
it. Reporting the first window alone would have produced a clean finding that
the second contradicts, which is the reason the second was run.

### Verdict

Reaction and prediction cannot be separated on this evidence. Both produce
mid-block position, a 60%-plus revert rate, one dominant error and an
identical instruction layout. What can be said is narrower and still useful:
the bot is not winning by landing first, it bids hard and variably for
inclusion, and its architecture makes being wrong cost almost nothing.

## What the method cannot establish

These are properties of the method, not of the subject, so they apply to any
future use of it.

Position is not latency. This one was learned the hard way in the second pass
and is the easiest to get wrong, because block position looks like a timing
measurement. It is where the leader put the transaction, not when it arrived.
Solana's scheduler is multi-threaded and fee-influenced rather than strictly
arrival-ordered, so a bot paying six figures of priority fee and still landing
mid-block is not being ordered by how early it got there. Mid-block position
does not prove late submission, and a high fee does not prove early
submission. There is no arrival timestamp in this data at all.

Profitability is not measurable this way. Swap volume is turnover. Net PnL needs
balance differencing across each transaction cycle plus fees and any tips paid
outside the fee field. Fees paid are visible and proceeds are not, so a 23 SOL
fee says nothing on its own about whether that transaction made money.

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

## What the queries cost

Recorded because the cost model is the real constraint on repeating any of
this, and because getting it wrong once cost 209 credits on a single
unbounded scan.

The rule in one line: filtering by `signer` is cheap, and anything that must
read every transaction in a block rather than one signer's is one to two
orders of magnitude more expensive per unit of time.

| Shape | Window | Credits |
|---|---|---|
| One wallet's transactions, narrow columns | 1 day | 0.32 |
| Position, fee, error and slot distributions | 9 days | 3.6 to 4.7 each |
| Block-size normalisation, reads every transaction in each block | 1 hour | 1.29 |
| `solana.instruction_calls`, outer instructions only | 10 min | 0.35 |
| `solana.instruction_calls`, inner instructions | 10 min | 5.1 to 8.6 |

The second pass came to 41.1 credits across 14 queries. Two practical notes:
`select *` on `solana.transactions` costs about 0.93 credits for five minutes
because of the large array columns, so name the columns; and Dune caps how
many private queries an account may hold, so repeated probing has to update
one saved query rather than create a new one each time.
