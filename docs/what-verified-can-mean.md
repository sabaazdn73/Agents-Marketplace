# What the verified tier can mean, and what it cannot

This is not a defect report. Nothing here is a bug, nothing here is scheduled
to be fixed, and the code computes exactly what it says it computes. It is a
record of what the strongest signal this project publishes is actually built
on, measured on 2026-09-16, kept because the number will move and the shape of
the problem will not.

## The measurement

Every verified agent on BNB Chain, checked against the complete ERC-8183 job
index rather than against a sample:

| | |
|---|---|
| Verified agents | 27 |
| Distinct owner addresses behind them | 24 |
| Distinct client wallets that paid for every delivery behind the tier | 17 |
| Total ever paid to the entire verified set | about 8 units |
| Verified agents whose largest external payment is 0.0001 or less | 14 of 27 |
| Owners whose deliveries all come from a single client | 18 of 24 |
| Deliveries funded by the three largest clients | 52 |

One wallet, `0x42711d67…`, confers the tier on six identically named agents
held by six different owners, one job each. Another, `0x9d16bb4b…`, is a test
hire bot whose own on-chain job description reads "ChainHelix Verified test
hire: return a small deliverable that demonstrates your service", and it
verifies four agents.

## Why this is not a bug

The tier's definition of record has always been: at least one on-chain job from
a paying buyer, other than the agent's own owner, reached SUBMITTED or
COMPLETED. On 2026-09-16 the code was corrected to enforce the buyer clause it
had always stated, and the count moved from 29 to 27. Every one of those 27
satisfies the definition. The arithmetic is right, the exclusions are right,
and the evidence is on chain.

What the measurement shows is that the definition, correctly applied, is
carrying less weight than the words "Verified working" suggest to a reader. A
payment of 0.0001 units from a wallet that also paid nine other agents is an
on-chain job from an external buyer, and it is not evidence that anyone wanted
the work.

## The three things that would each be a different fix

Naming them because each is a different claim, and picking one is a decision
about what the badge is for rather than a correction to it.

A minimum value. A job below some threshold is a test, not a purchase. This is
the same discipline already used elsewhere: a rate from fewer than five polls
is withheld rather than shown, and a rate from fewer than five budgets is
withheld rather than divided. The threshold would have to be named and defended
in a currency whose price moves.

A minimum number of distinct buyers. One buyer is a relationship; several is a
market. Eighteen of twenty-four owners would fall below a threshold of two.

A relatedness test. `0x42711d67…` paying six agents one job each, and an owner
of one listed agent paying another, are both external by the letter of the
definition and neither is arm's length. This is the hardest of the three to
define and the closest to what a reader thinks the badge rules out.

## Why nothing is being changed today

Because the version of this that holds is not a stricter filter, it is a
smaller claim. Every threshold above would move the count and none would make
the remaining agents better evidenced; they would make the set smaller and the
wording no more accurate. The useful change, when it comes, is likely to be
about what the badge says rather than about who qualifies for it.

The second reason: there is no demand-side instrument to check any of this
against. The canary system exists precisely to produce delivery evidence that
does not depend on organic demand, it is built, live-tested, wired into the
tier and the badge on both apps, and it has run zero tests against an untouched
weekly cap. Until it runs, every proposal above is a guess about a market that
has not been measured.

## The count moved three times in one day without the rule changing

Recorded 2026-09-17, because it demonstrates the point above better than the
original measurement did.

The verified count on BNB Chain read 27 in the morning, 20 in the afternoon and
31 in the evening. The rule did not change once. What changed was which agents
the house was serving.

A storage cap was added to known_agents, because the collection had grown to
102,997 documents against a 512 MiB cluster quota with 46 MB of headroom. The
cap drops the least recently selected agents. Least recently selected is a
reasonable proxy for least looked at and it is not a proxy for least evidenced,
so the first capped run evicted 36 of the 61 owner addresses that have
delivered work to somebody other than themselves, and the count fell to 20.

The cap now protects any owner with a delivered job, read from the job index
rather than from the tier, because the tier is computed downstream of the
collection and that check would be circular. Fourteen evicted agent records
were restored from the full registry, which still held them. The other
twenty-two owners have no agent record anywhere: they are providers in the job
index that were never listed agents, which is the same gap this page already
describes from the other direction.

After the repair the count is 31, higher than it started, because the store is
now smaller and a larger share of the agents that have delivered fall inside
the served window. Of the 61 owners with external delivery, 29 are now served,
against 24 before any of this.

Every one of the 31 has external delivery behind it, checked one by one. None
was promoted by the repair. The number is correct at each of the three values,
which is the problem: a count that moves from 27 to 20 to 31 in nine hours,
under an unchanged rule, is a measurement of the serving window and not of how
many agents have proven they deliver. Read it that way or do not read it.

## The same shape, on a chain with one budget, and it is ours

Added 2026-09-18, from reading chain 4663 through Blockscout's gateway.

Robinhood Chain holds exactly one budget opened through this project's
AgentBudgetEscrow. Its client, the address that funded it, is
`0x48cE74cd…`. The same address is the `creator_address_hash` of the escrow
contract itself: whoever deployed the contract funded the only budget on it.

That is our own address and our own deployment, so it is not a finding about
somebody else and it is not evidence of anything being concealed. The budget is
0.000007 ETH, about two cents, opened and reclaimed the same day the chain was
added. It is a go-live test and it looks exactly like one.

It is recorded here because it is the same shape as the pattern this page is
about. On BNB Chain the observation is that 18 of 24 verified owners have every
delivery from a single client, and that money returning to the address it left
is activity rather than demand. On Robinhood Chain the single budget was funded
by the address that deployed the contract it sits in. Both are one party on
both sides of a transaction that, counted naively, reads as usage.

The difference is only that we know who this one is. A reader looking at chain
4663's numbers has no way to tell our test from a real hire, and the honest
response is to say which it is rather than to rely on the amount being small
enough that nobody asks. The extension's panel already says the budget was
never drawn against; this page says who opened it.

If a second budget is ever opened on that chain by an address that is not ours,
this section needs rewriting rather than deleting: the interesting figure then
becomes how many of the budgets there are self-funded, which is the same
question `DeliveryProvenance` asks about jobs.

## Which registry says verified

Also 2026-09-18, and worth keeping separate from the tier itself because it is
a different sense of the word.

"Verified" on an agent means the tier above. "Verified" on a contract means its
source is published in a registry. The second one is not a property of the
contract, it is a property of the contract in a particular registry, and the
registries disagree.

The escrow at `0x9dbA8EbB…1333` on chain 4663 is an exact match on Sourcify,
creation and runtime both, verified three minutes after it was deployed. The
same contract is `is_verified: false` on that chain's own Blockscout explorer.
Both are accurate. It was verified on one and not the other.

This mattered because the contract badge said "on BscScan" in fixed text, on
every chain. On Robinhood Chain that named a registry with no opinion on the
contract, and sent a reader to an explorer that would have shown them the
opposite of what the badge said. The badge now prints the registry that
answered, and on the Sourcify chains it carries the caveat that the chain's own
explorer indexes verification separately.

The general rule, which is the reason this is in this file: a claim that rests
on somebody else's registry has to name the registry, or the first reader who
checks somewhere else is entitled to conclude we made it up.

## The badge now says what it measures, and field eleven turned out to be empty of information

Added 2026-09-23. This page predicted that the useful change would be about
what the badge says rather than about who qualifies for it. That change is now
made, and a second one that was expected to be uncomfortable turned out to be
merely null, which is worth recording for the same reason as everything else
here.

The label. The tier is shown as "Buyer-funded, marked delivered" instead of
"Verified working". The rule did not change and nobody gained or lost the tier;
the ids did not change either, because callers filter on the string `verified`
and nothing keys on the label. Beside it, everywhere there is room for a
sentence, sits one shared constant: an address other than the owner funded an
on-chain job, and the agent then marked it delivered; the tier counts that from
the moment the agent submits, which is the agent's own claim; nothing checks
what was handed over, and for almost all of these jobs nobody disputed it and
nobody ever settled it.

That last clause replaced a draft that said the dispute window was still open,
which is what the tier's shape suggests and not what the chain says. Of 27,177
jobs at `SUBMITTED`, exactly one is still inside its window. The other 27,176
saw it elapse, median 97 days ago, and `settle()` was never called by anyone,
though after the window anyone may call it. So the tier's weakness is not that
judgment is pending. It is that judgment never comes: `SUBMITTED` is the end
state, not a stage.

Field eleven. `getJob` returns a `deliverable`, a bytes32 content commitment
written when a provider calls submit, and this project had never stored it. It
is stored now and backfilled over all 56,798 jobs. The expected finding was a
population of submissions committing the zero word, that is, claiming delivery
while committing to nothing. There are none. Every one of the 55,436 jobs at
`SUBMITTED` or `COMPLETED` carries a distinct non-zero value, and no job short
of submit carries one.

That reads as good news and is not news at all. The commitment is written by the
same contract call that sets the status, so "has a content commitment" and "is
at SUBMITTED or later" are the same fact said twice. The field cannot separate
two delivered jobs, cannot move any agent between tiers, and adds nothing to the
tier's evidence. It is indexed for completeness. The single exception, and the
only place it says more than `status` does, is 8 of the 35 `EXPIRED` jobs, all
from one provider, which carry a commitment: submitted, then expired unsettled.

### The job index has no guarantee of catching up, and the gap is growing

One more thing the backfill exposed, which is about this project rather than the
contract. Reading every job from the chain gave 28,259 `COMPLETED`, 27,177
`SUBMITTED` and 35 `EXPIRED`. The stored index at the same moment held 28,220,
27,224 and 12: 39 completions short, 47 submissions long, 23 expiries short.

The first instinct is to call that a backlog and expect it to clear. It will
not. `run_index_batch`'s re-check pass selects with
`find({"status": {"$nin": terminal}}).limit(CHUNK * 5)`, 1,500 ids, and that
query carries no sort and no checkpoint. The forward pass has `next_job_id` and
the backfill written on 2026-09-23 has `deliverable_backfill_next_id`; the pass
sitting between them has neither, so nothing makes any particular id come up a
second time.

That would still drain if the candidate set drained. It does not. There are
28,498 non-terminal jobs, and roughly 27,000 of them are parked at `SUBMITTED`
forever, because `settle()` is permissionless after the dispute window and
nobody calls it. They never become terminal, so they never leave the query, and
they hold the 1,500 slots permanently. The ratio is 19 to 1 today and gets worse
with every new job that parks at `SUBMITTED`. So the candidate set is not a
queue that is merely long; it has no drain.

The observed pattern fits. Every expiry the index is missing sits at a high job
id: the eight from `0xdfc1761378…` at ids 56,685 to 56,713, plus singles at
56,634, 56,647, 56,656, 56,665, 56,666, 56,745, 56,748, 56,776, 56,778, 56,779
and 56,781. The expiries it does hold are ancient, at ids 29 and 118, or at or
below 56,681. The lowest 1,500 non-terminal ids span 1 to 29,684, so a pass that
kept returning that same prefix would never reach the band where every recent
transition lives.

Two claims of different strength, kept apart, because this section exists to
record a number that claimed more than it could support and must not do the same
thing itself. Certain, from the source: the pass has no sort and no checkpoint,
so it carries no guarantee that any particular id is ever revisited. Inferred,
from the ids above: that it is in fact returning the same prefix every run.
MongoDB leaves the order of an unsorted `find` unspecified, and the pass has not
been instrumented to confirm which ids come back, so the id evidence is
consistent with a stable order without establishing one. The absence of a
guarantee holds either way, and it is the half the fix below addresses.

Every count this project publishes off the job index inherits this, and it drifts
in one direction: toward showing delivery as still open after the chain has
closed it.

The fix, named here so it is not rediscovered as a new finding: sort the
re-check `find` by `_id` and carry a `recheck_next_id` cursor in the same
progress document, wrapping at the end exactly as the deliverable backfill does.
That pattern is already written twice in `core/job_index.py`, so it is about ten
lines. It was deliberately not done on 2026-09-23: it moves every count the
project publishes, and the pass it would have landed in had the discipline that
nobody gains or loses the tier.

## What to re-measure

The figures at the top, and the figure that matters most, which is the number
of distinct client wallets. Seventeen is small enough that a single operator
funding a fleet moves it materially. If it rises without the verified count
rising, the tier is getting stronger. If the verified count rises and the
wallet count does not, it is getting weaker, and this page should say so.

Recorded 2026-09-16, with the Robinhood Chain and registry sections added
2026-09-18. The buyer clause and the 29 to 27 correction it caused are in
[Verification Methodology](verification-methodology.md).
