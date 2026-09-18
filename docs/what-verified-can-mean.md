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

## What to re-measure

The figures at the top, and the figure that matters most, which is the number
of distinct client wallets. Seventeen is small enough that a single operator
funding a fleet moves it materially. If it rises without the verified count
rising, the tier is getting stronger. If the verified count rises and the
wallet count does not, it is getting weaker, and this page should say so.

Recorded 2026-09-16, with the Robinhood Chain and registry sections added
2026-09-18. The buyer clause and the 29 to 27 correction it caused are in
[Verification Methodology](verification-methodology.md).
