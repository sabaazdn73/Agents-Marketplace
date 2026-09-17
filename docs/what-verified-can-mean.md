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
the marketplace was serving.

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

## What to re-measure

The figures at the top, and the figure that matters most, which is the number
of distinct client wallets. Seventeen is small enough that a single operator
funding a fleet moves it materially. If it rises without the verified count
rising, the tier is getting stronger. If the verified count rises and the
wallet count does not, it is getting weaker, and this page should say so.

Recorded 2026-09-16. The buyer clause and the 29 to 27 correction it caused are
in [Verification Methodology](verification-methodology.md).
