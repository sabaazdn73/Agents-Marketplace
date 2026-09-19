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
house, and it briefly had a top-level sidebar tab which implied the
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
**about $91M of capital cycled** across 23 venues and 7,766 pairs. It paid
1,691.95 SOL in fees, of which 489.93, or 29%, went on transactions that
reverted.

### The volume figure was wrong, and by roughly half

This said **$179.7M** until 2026-09-18. That number is the sum of `amount_usd`
over every row in `dex_solana.trades`, and a row there is one LEG of a swap,
not one movement of capital. An arbitrage cycle moves the same dollars through
two or more legs, so summing legs counts the same dollars two or more times.

Re-measured on Dune against both wallets, over the 30 days to 2026-09-18:

| | MRiYA4oN | MriyaNN8 |
|---|---|---|
| swap legs | 555,029 | 213,479 |
| transactions containing a swap | 259,360 | 97,274 |
| legs per transaction | 2.14 | 2.19 |
| gross volume summed over legs | $149.4M | $48.1M |
| largest leg per transaction, summed | $75.9M | $24.5M |
| ratio | **1.97x** | **1.97x** |

Both wallets inflate by the same 1.97x, which is what a two-leg cycle should
do and is the strongest evidence that this is the mechanism rather than a
coincidence of one window. Applying it to the published figure gives about
$91M of capital actually cycled, against $179.7M of leg turnover.

The ratio is measured; the $91M is that ratio applied to a figure from an
earlier window, because the bot's activity has since declined and the original
window cannot be re-run exactly. Treat $91M as one significant figure.

None of the study's conclusions rest on this number. The revert rate, the
timing, the block position and the fee bidding are all counted per transaction
and are unaffected. What changes is the impression of scale, and the honest
version of it is half of what was published.

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

## Third pass: a claim about validator inclusion lanes

A claim circulated that two validator operators, Helius and Kiln, run private
inclusion lanes for MRiYA4oN: 84% inclusion on Helius leaders and 80% on Kiln,
at zero priority fee, against 25% elsewhere. If true it would reinterpret the
first pass, because the 18% of wins at bare base fee would not be uncontested
opportunities but slots where a cooperating validator held the leader seat.

The figures came from a news summary citing unnamed reports. They were treated
as a hypothesis, not a result.

### The claim cannot be tested as stated, and that is the first finding

Inclusion rate needs a denominator of attempts. Solana has no public mempool
and no public record of transactions submitted and never included. The ledger
holds what landed. Dune holds the ledger.

So an inclusion rate is not computable from public data by anyone. Whoever
produced the figures either held submission-side logs, their own or an RPC
provider's, or computed something else and called it inclusion.

What is computable is success given inclusion, `landed / (landed + reverted)`,
because failed Solana transactions still land and still pay. That is a real
test: a protected lane should show up as fewer lost races.

### Leader identity is recoverable, which was not obvious

`solana.rewards` carries one row per slot with `reward_type = 'Fee'` whose
`recipient` is the block producer. Checked over an hour: 11,351 slots, 11,351
fee rows, maximum one per slot. Attribution is exact rather than inferred.

Operator names came from stakewiz rather than from reading vanity prefixes:
Helius `HEL1US...`, Kiln1 `5pPRHnief...`, Kiln2 `ACvL73V4...`.

### What the leader split shows

Two days on MRiYA4oN. The wallet is dormant by 09-13, matching the migration
to MriyaNN8, so 09-08 and 09-10 are the pair.

| | on-chain | success | wins at base fee | p50 fee (landed) |
|---|---|---|---|---|
| All leaders, 09-08 | 29,610 | 38.6% | 19.5% | |
| All leaders, 09-10 | 14,814 | 41.7% | 16.6% | |
| Helius 09-08 | 1,847 | 61.0% (p=4e-92) | 8.1% | 39,111 |
| Helius 09-10 | 811 | 63.4% (p=6e-38) | 7.8% | 45,660 |
| Kiln1 09-08 | 441 | 39.9% (p=0.6) | 79.5% | 5,000 |
| Kiln1 09-10 | 193 | 40.4% (p=0.7) | 84.6% | 5,000 |
| Kiln2 09-08 | 84 | 42.9% (p=0.4) | 22.2% | 30,463 |
| Kiln2 09-10 | 37 | 78.4% (p=6e-6) | 6.9% | 29,989 |

The 16.6% and 19.5% reproduce the first pass's 18.0%, so this is the same
quantity on the same wallet.

The claim's two halves attach to different validators and neither holds
together. Helius shows a large, stable success lift, 61% and 63% against a
39% to 42% baseline. Kiln1 shows the zero-fee pattern, median landed fee of
exactly 5,000 on both days and 80% to 85% of wins costing nothing, and gets
nothing for it: 39.9% and 40.4% against baselines of 38.6% and 41.7%, p=0.6
and p=0.7. Kiln2 swings from 42.9% to 78.4% on 84 and 37 transactions and
carries no weight.

84.6% appears in this data as Kiln1's base-fee share of wins, not as anyone's
inclusion rate. If the reported 84% traces to a number shaped like that, it
was read off the wrong column.

### Base-fee wins do cluster, on nine leaders rather than two

Nine leaders have 20 or more wins with over half at base fee. Kiln1 is one of
nine, alongside Chorus One and several unnamed operators. The top ten hold
38.8% of all 1,027 base-fee wins.

Clustering alone does not separate "this validator gives the bot free
inclusion" from "this validator does not order by fee, so the bot stopped
bidding". That needs the population in the same blocks, which is the expensive
block-wide read, so it was bounded to one hour.

| Leader | Bot wins at base fee | Everyone's txs at base fee | Ratio | Bot success |
|---|---|---|---|---|
| Kiln1 | 84.6% | 32.1% | 2.64 | 40.4% |
| Chorus One | 83.9% | 32.4% | 2.59 | 47.7% |
| `7cVfgArChe...` | 100.0% | 29.3% | 3.42 | 40.5% |
| `Ha1iade1AH...` | 96.6% | 26.3% | 3.67 | 59.2% |
| `9eGrDohdNT...` | 65.5% | 29.6% | 2.21 | 23.6% |
| Helius | 7.8% | 21.7% | 0.36 | 63.4% |

Network baseline: 23.5% of non-vote transactions pay base fee.

On the cluster leaders the population is barely elevated while the bot sits at
two to nearly four times the crowd in the same blocks, so this is the bot's
behaviour rather than a property of those blocks. If those validators ignored
priority fees, everyone would have stopped paying and the population share
would be far higher. And it buys nothing: success there runs 23% to 59%,
straddling the average. This reads as the bot declining to bid where bidding
does not pay.

### Fourth measurement: do other searchers show the Helius lift

This is the one test that separates "infrastructure anyone can buy" from
"specific to this bot", so the criteria were written down before it ran.

Pre-registered: infrastructure supported if a majority of contested peers show
a lift of at least +10pp in the same direction, roughly half of Mriya's +22pp;
in trouble if none reaches +5pp or the median peer lift is at or below zero.

**Selection, first attempt, and why it was wrong.** Ranking all signers by
volume and taking the top twelve gave a set whose median winning fee was about
5,000 lamports. High revert rate alone does not mean competing in the same
auctions: those bots spam the minimum. Mriya's median is 72,436. Comparing
against them would have measured nothing.

**Selection, corrected.** Peers must both bid and lose races: at least 2,000
transactions in the window, revert rate at or above 30%, and median landed fee
at or above 20,000 lamports. That yields 23 addresses including Mriya, of which
21 have enough Helius-slot traffic to estimate a rate.

Let L be Helius success minus success on all other leaders, in percentage
points, over 2026-09-10 06:00 to 12:00.

| | L |
|---|---|
| **MRiYA4oN** | **+22.7pp** (p=2e-11) |
| `gtagyESa99t4...` | +7.3 |
| `7xhYhQm48yfu...` | +7.2 |
| next 8 peers | +2.6 down to +0.0 |
| bottom 11 peers | -0.0 down to -2.5 |

Peer median -0.0pp, mean +0.7pp, range -2.5 to +7.3. None reaches +10pp.
Mriya ranks 1 of 22 at 3.1 times the largest peer lift.

Against the pre-registered margins: the majority-at-+10pp condition fails
0 of 21, and the median-at-or-below-zero condition is met. The infrastructure
reading is not supported on this evidence.

The volume-selected set, kept because it was run first, adds one complication
worth recording rather than dropping. `FVnv5qH7...`, which reverts 31% but pays
about 5,008, showed +20.8pp. So the lift is not unique to Mriya even if it is
absent across the bidding peer group. That set also contained three bots with
lifts of -16.9, -12.5 and -12.1pp, for whom Helius slots are markedly worse,
which is direct evidence against any story where Helius blocks are simply
easier to land in.

**The fee side reverses the earlier reading.** The second pass said the bot
pays more into Helius, based on its base-fee share of wins. That share is
conditioned on winning, and a higher win rate changes its composition, so the
unconfounded comparison is fees on attempts.

| | p50 Helius / p50 other | p90 ratio |
|---|---|---|
| MRiYA4oN | 0.82 | 0.54 |
| 21 peers | median 1.00 (range 0.49 to 1.17) | |

Peers bid the same into every leader. Mriya bids about 18% less into Helius
slots at the median and about half at the tail, and wins 22.7pp more often.
Paying less and landing better is the opposite of what buying a priority
service looks like.

### What this still cannot answer

It is still not an inclusion rate. Dropped attempts remain invisible.

Specific to Mriya is not the same as a private arrangement. Mriya may be the
only bot in this peer set buying a particular public product, or the only one
positioned a certain way. Routing is not visible on-chain.

Fee is not opportunity. What the bot attempts on Helius slots may differ in
kind from what it attempts elsewhere, and a different mix of targets could
produce both lower bids and higher success without anyone's help.

`FVnv5qH7...` shows a Mriya-sized lift while paying the minimum, and this pass
has no explanation for it.

Coverage is one wallet, one six-hour window for the peer comparison and two
days for the leader split. MriyaNN8 was not tested.

What would settle it is submission-side logs, the bot's own or a provider's,
giving attempts against inclusions. Nothing public substitutes. The other
question worth putting to whoever is circulating the figures is which
denominator they used.

### The SQL

Leader attribution, the join every query in this pass builds on:

```sql
WITH win AS (
  SELECT TIMESTAMP '2026-09-10 00:00:00' AS t0, TIMESTAMP '2026-09-11 00:00:00' AS t1
),
lead AS (                                   -- one row per slot; recipient is the producer
  SELECT block_slot, recipient AS leader
  FROM solana.rewards, win
  WHERE block_time >= t0 AND block_time < t1 AND reward_type = 'Fee'
),
slots_per_leader AS (
  SELECT leader, count(*) AS leader_slots FROM lead GROUP BY leader
),
tx AS (
  SELECT block_slot, fee, success
  FROM solana.transactions, win
  WHERE block_time >= t0 AND block_time < t1
    AND signer = 'MRiYA4oN3158fCV8evhuCofrDzbHyYvYnGZUDJvoCsa'
),
j AS (
  SELECT l.leader, t.fee, t.success
  FROM tx t JOIN lead l ON l.block_slot = t.block_slot
)
SELECT s.leader, s.leader_slots,
       count(j.leader)                           AS bot_txs,
       count_if(j.success)                       AS landed,
       count_if(NOT j.success)                   AS reverted,
       count_if(j.success AND j.fee <= 5000)     AS landed_base_fee,
       count_if(NOT j.success AND j.fee <= 5000) AS reverted_base_fee,
       approx_percentile(IF(j.success, j.fee), 0.5) AS p50_fee_landed,
       approx_percentile(IF(j.success, j.fee), 0.9) AS p90_fee_landed
FROM slots_per_leader s
LEFT JOIN j ON j.leader = s.leader
GROUP BY s.leader, s.leader_slots
ORDER BY bot_txs DESC
```

Peer selection, the corrected version that requires bidding as well as losing:

```sql
SELECT signer, count(*) AS txs,
       count_if(NOT success) * 1.0 / count(*) AS revert_rate,
       approx_percentile(IF(success, fee), 0.5) AS p50_fee_landed,
       approx_percentile(IF(success, fee), 0.9) AS p90_fee_landed
FROM solana.transactions
WHERE block_time >= TIMESTAMP '2026-09-10 06:00:00'
  AND block_time <  TIMESTAMP '2026-09-10 12:00:00'
GROUP BY signer
HAVING count(*) >= 2000
   AND count_if(NOT success) * 1.0 / count(*) >= 0.30
   AND approx_percentile(IF(success, fee), 0.5) >= 20000
ORDER BY txs DESC
```

The peer comparison groups the same join by `signer` and by a three-way leader
bucket, with the signer list from the query above:

```sql
SELECT t.signer,
       CASE l.leader
         WHEN 'HEL1USMZKAL2odpNBj2oCjffnFGaYwmbGmyewGv1e2TU' THEN 'helius'
         WHEN '5pPRHniefFjkiaArbGX3Y8NUysJmQ9tMZg3FrFGwHzSm' THEN 'kiln1'
         ELSE 'other' END                        AS leader_group,
       count(*)                                  AS txs,
       count_if(t.success)                       AS landed,
       count_if(t.success AND t.fee <= 5000)     AS landed_base_fee,
       approx_percentile(t.fee, 0.5)             AS p50_fee_attempted,
       approx_percentile(t.fee, 0.9)             AS p90_fee_attempted
FROM tx t JOIN lead l ON l.block_slot = t.block_slot
GROUP BY 1, 2
```

### One schema trap, again

`solana.transactions` has no `is_vote` column, and the population denominator
above nearly included vote transactions, which all pay exactly 5,000 and would
have wrecked every base-fee ratio. Direct check: 1 vote-program transaction in
58,381 over 30 seconds, so votes are excluded and the denominator holds. Dune
keeps them in `solana.vote_transactions`.

`information_schema.columns` is not usable for the whole `solana` catalog; it
fails with a Trino type error. `information_schema.tables` works.

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

The third pass came to 7.4 credits across 19 executions, 5.2 for the leader
split and 2.2 for the peer comparison.

| Third-pass shape | Window | Credits |
|---|---|---|
| `solana.rewards`, one fee row per slot, aggregated | 1 hour | 0.02 |
| `solana.rewards`, `select *` | 1 minute | 0.57 |
| Per-leader join, one signer | 24 hours | 0.26 to 0.50 |
| Per-leader join, 23 signers, three leader buckets | 6 hours | 0.19 to 0.67 |
| All transactions grouped by leader, block-wide | 1 hour | 0.60 |
| All signers ranked by volume, block-wide | 6 hours | 0.39 to 0.49 |
| `information_schema.tables` | n/a | ~0 |

Three things learned about the cost model that the table above does not say.
The 24-hour per-leader join cost less than the 1-hour version, 0.50 against
0.86, so window length is not the driver and query shape is. Re-reading a
finished execution's results through `/execution/{id}/results` is free, which
is how 664 rows came back without re-running anything. And the API returns
`execution_cost_credits` on the status response, so cost no longer has to be
read off the web UI.

A failed execution costs 0 credits, so probing a schema guess is free. Two
failed here: `information_schema.columns` across the whole `solana` catalog
raises a Trino type error, and `solana.transactions` has no `is_vote` column.
