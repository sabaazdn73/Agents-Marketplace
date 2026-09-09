# Demo script, two minutes

60 scenes, 2 seconds each. Numbers read from the live site on 2026-09-09.

## The argument

Anyone can register an agent on BNB Chain. Registering proves nothing, and
almost nobody checks. This project checks, grades the evidence by what it
does and does not prove, and then removes the need to trust that grade by
putting the money behind contracts anyone can read on chain.

## Running order

| Part | Scenes | Time | Ends at |
|---|---|---|---|
| 1. The problem | 1 to 10 | 20s | 0:20 |
| 2. The checking | 11 to 22 | 24s | 0:44 |
| 3. The contracts | 23 to 44 | 44s | 1:28 |
| 4. What passed | 45 to 58 | 28s | 1:56 |
| 5. Close | 59 to 60 | 4s | 2:00 |

At 2 seconds a scene, a subtitle has to be readable in one glance. Every
line below is seven words or fewer.

---

## Part 1. The problem

| # | Time | On screen | Subtitle |
|---|---|---|---|
| 1 | 0:00 | Landing loads, chain counter fills | 154,695 agents on BNB Chain. |
| 2 | 0:02 | Counter holds | Every one registered on chain. |
| 3 | 0:04 | Cursor over the counter | Anyone can register an agent. |
| 4 | 0:06 | Same | It costs almost nothing. |
| 5 | 0:08 | Same | And it proves nothing at all. |
| 6 | 0:10 | Point at "29 Verified Agents" | Twenty nine have proven delivery. |
| 7 | 0:12 | Hold on the number | Out of 154,695. |
| 8 | 0:14 | Scroll the agent list fast | Finding agents is the easy part. |
| 9 | 0:16 | Keep scrolling | Knowing which ones work is not. |
| 10 | 0:18 | Badges pass under cursor | So every agent gets checked. |

### Footnotes, part 1

The 154,695 and 29 are both on the landing view, so scenes 1 to 7 need no
navigation. Reread both before recording. They move.

Scene 7 is the pivot of the whole video. Twenty nine against 154,695 is the
reason the project exists. Hold the number rather than cutting early.

That contrast invites the reading that the marketplace is nearly empty. It
is not, and no subtitle claims it is: 15,000 agents are served and 8,825
carry on-chain feedback. The point is how rare proven delivery is across the
whole registry. Have that answer ready if a judge asks.

The pagination label currently reads "Showing 1,24 of 14,880", where a range
separator belongs. It is on screen during scenes 8 and 9. Either fix
`AgentMarketplaceApp.web.jsx:1385` first or frame those scenes above it.

---

## Part 2. The checking

| # | Time | On screen | Subtitle |
|---|---|---|---|
| 11 | 0:20 | Click "How we verify agents" | Four tiers, graded on evidence. |
| 12 | 0:22 | Panel open, all four visible | Each tier states its own limit. |
| 13 | 0:24 | Point at "Verified working" | Verified working is the top tier. |
| 14 | 0:26 | Same | A buyer paid for a job. |
| 15 | 0:28 | Same | The agent delivered it. |
| 16 | 0:30 | Same | Confirmed on chain, never self reported. |
| 17 | 0:32 | Point at "Responding, unproven" | This is the weakest tier. |
| 18 | 0:34 | Same | The endpoint answered just now. |
| 19 | 0:36 | Same | That proves a process is running. |
| 20 | 0:38 | Same | Not that it finishes paid work. |
| 21 | 0:40 | Point at "Canary-verified" | Where nobody had hired, we did. |
| 22 | 0:42 | Same | We funded the job ourselves. |

### Footnotes, part 2

The whole part happens inside one expanded panel, so there is no navigation
after scene 11. Open it before recording and let the cursor move between
tiers.

Scenes 17 to 20 are the ones that earn a judge's trust. Most marketplaces
would call a live endpoint verified. Four seconds saying what it does not
prove is worth more than four seconds of features.

The tier text on screen is the site's own wording, so the subtitles and the
page agree. Do not paraphrase a tier into something stronger than the panel
says.

Cut from this part: the on-chain financial track record and the PnL signal.
Both are worth showing, but the contracts need the seconds more,
and the contracts are the part a judge can verify independently.

---

## Part 3. The contracts

| # | Time | On screen | Subtitle |
|---|---|---|---|
| 23 | 0:44 | Agent page, click Hire | Checking alone is still not enough. |
| 24 | 0:46 | Hire flow opening | You should not have to trust it. |
| 25 | 0:48 | Funding step | So the payment is escrowed. |
| 26 | 0:50 | Same | It never goes to the agent. |
| 27 | 0:52 | Same | It is released on delivery. |
| 28 | 0:54 | BscScan, ERC-8183 commerce | Hires settle through ERC-8183. |
| 29 | 0:56 | Contract tab visible | This standard is not mine. |
| 30 | 0:58 | Same | I integrate it. |
| 31 | 1:00 | BscScan, AgentAccessMarket | These next two are mine. |
| 32 | 1:02 | Green verified tick in frame | Written for this project. |
| 33 | 1:04 | Hold on the tick | Deployed, and source verified. |
| 34 | 1:06 | Contract overview | This one sells access to an agent. |
| 35 | 1:08 | Read Contract tab open | You can read the fee yourself. |
| 36 | 1:10 | Expand `feeBps`, value 250 | feeBps returns 250. |
| 37 | 1:12 | Hold on 250 | Two and a half percent. |
| 38 | 1:14 | Expand `MAX_FEE_BPS`, value 1000 | MAX_FEE_BPS returns 1000. |
| 39 | 1:16 | Hold on 1000 | Ten percent, fixed in the code. |
| 40 | 1:18 | Same | The owner cannot go past it. |
| 41 | 1:20 | BscScan, AgentBudgetEscrow source | This one funds agents that spend. |
| 42 | 1:22 | Source scrolled to `draw` | draw carries the pause modifier. |
| 43 | 1:24 | Cursor moves to `reclaim` | reclaim carries nothing. |
| 44 | 1:26 | Both signatures in frame | So pause can never trap funds. |

### Footnotes, part 3

This part is 44 of the 120 seconds, which is deliberate. The contracts are
the substance and they are the only claims a judge can check without
believing anything on the site.

Scenes 28 to 33 draw the line between what is integrated and what is built.
ERC-8183 is the standard the hire settles through. AgentAccessMarket and
AgentBudgetEscrow were written for this project. A judge who cannot tell
those apart credits the wrong half.

Scenes 42 to 44 are the hardest to frame and the most valuable. Open the
verified source on BscScan before recording and scroll so both signatures
sit in one frame:

```
function draw(uint256 budgetId, uint256 amount, bytes32 memo)
    external nonReentrant whenNotPaused

function reclaim(uint256 budgetId)
    external nonReentrant
```

One has `whenNotPaused`. The other does not. The owner can stop money going
in and stop an agent drawing out, and has no power to stop a client
recovering their unspent remainder. That asymmetry is a design decision
readable on chain rather than a promise, which is why it is worth six
seconds.

At 2 seconds a scene nobody can hunt for a value. Expand `feeBps` and
`MAX_FEE_BPS` before recording so scenes 36 and 38 open on the number
already showing.

Scene 23 stops at the funding step on purpose. Signing a real transaction
risks a failure mid-record, and the shot would show a wallet dialog rather
than anything about this project.

Contract addresses, in order of appearance:

| Scenes | Contract | Address |
|---|---|---|
| 28 to 30 | ERC-8183 AgenticCommerce | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` |
| 31 to 40 | AgentAccessMarket | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` |
| 41 to 44 | AgentBudgetEscrow | `0x4728f03693DDABbe50E79c7BfFCb930e522D585B` |

---

## Part 4. What passed

| # | Time | On screen | Subtitle |
|---|---|---|---|
| 45 | 1:28 | Native Agents, four rows | Four categories, all of them live. |
| 46 | 1:30 | Hold on the set | This is what passed the checking. |
| 47 | 1:32 | Expand Yield Optimisation | Yield optimisation ranks risk first. |
| 48 | 1:34 | APR chart drawing | Live yields from DefiLlama. |
| 49 | 1:36 | Chart full | Four protocols, over 180 days. |
| 50 | 1:38 | Point at the 1,000 U rows | What 1,000 U earns in a year. |
| 51 | 1:40 | Same | Projected at today's rates only. |
| 52 | 1:42 | Expand Grid Trading | Grid trading, on PancakeSwap. |
| 53 | 1:44 | Price axis with markers | Your levels against the live price. |
| 54 | 1:46 | Hold on the markers | Sells above spot, buys below. |
| 55 | 1:48 | Point at the place button | Every level in one signature. |
| 56 | 1:50 | Expand Health Factor | Health factor monitoring, read only. |
| 57 | 1:52 | Aave and Venus blocks | Distance to liquidation, from chain. |
| 58 | 1:54 | Expand Rebalancing | Rebalancing shows your portfolio drift. |

### Footnotes, part 4

Agent diversity is a judged criterion and it is scored on the four
categories getting comparable weight. Yield gets 5 scenes, Grid 4, Health
Factor 2, Rebalancing 1. That is uneven, and it is the one compromise in the
script: Yield and Grid have charts that read at speed, and the other two
depend on wallet state. If you can fund a wallet, move a scene from Yield to
Rebalancing and the balance improves.

Scenes 56 to 58 need a wallet holding an Aave or Venus borrow and some BNB
and USDT. Without it both panels show empty states. Those states are correct
and the site words them honestly, but they do not make the point in two
seconds. If you cannot arrange a position, change scene 57 to "Reads Venus
and Aave positions live" and scene 58 to "Rebalancing compares current
against target", both of which stay true against an empty panel.

Scene 51 must stay. The projection is a calculation at today's live rates,
not a history, and the site labels it that way. A judge who reads it as a
forecast and then works out it is not would discount everything before it.

Scene 58 says "shows" deliberately. The rebalancing plan is computed and
displayed, and signing is not wired yet. The card says so on its face. Do
not upgrade that verb.

Grid Trading needs no wallet, so scenes 52 to 55 are safe to record at any
time.

---

## Part 5. Close

| # | Time | On screen | Subtitle |
|---|---|---|---|
| 59 | 1:56 | Back to marketplace, wide | Live on BNB Chain mainnet. |
| 60 | 1:58 | Hold | Every number read from the chain. |

### Footnotes, part 5

Scene 60 is a claim the rest of the video has to have earned. It holds
because parts 1 and 4 read live figures and part 3 reads contract values on
BscScan, so nothing in the two minutes rests on the site's own assertion.

---

## Subtitles, plain list for burning in

```
154,695 agents on BNB Chain.
Every one registered on chain.
Anyone can register an agent.
It costs almost nothing.
And it proves nothing at all.
Twenty nine have proven delivery.
Out of 154,695.
Finding agents is the easy part.
Knowing which ones work is not.
So every agent gets checked.
Four tiers, graded on evidence.
Each tier states its own limit.
Verified working is the top tier.
A buyer paid for a job.
The agent delivered it.
Confirmed on chain, never self reported.
This is the weakest tier.
The endpoint answered just now.
That proves a process is running.
Not that it finishes paid work.
Where nobody had hired, we did.
We funded the job ourselves.
Checking alone is still not enough.
You should not have to trust it.
So the payment is escrowed.
It never goes to the agent.
It is released on delivery.
Hires settle through ERC-8183.
This standard is not mine.
I integrate it.
These next two are mine.
Written for this project.
Deployed, and source verified.
This one sells access to an agent.
You can read the fee yourself.
feeBps returns 250.
Two and a half percent.
MAX_FEE_BPS returns 1000.
Ten percent, fixed in the code.
The owner cannot go past it.
This one funds agents that spend.
draw carries the pause modifier.
reclaim carries nothing.
So pause can never trap funds.
Four categories, all of them live.
This is what passed the checking.
Yield optimisation ranks risk first.
Live yields from DefiLlama.
Four protocols, over 180 days.
What 1,000 U earns in a year.
Projected at today's rates only.
Grid trading, on PancakeSwap.
Your levels against the live price.
Sells above spot, buys below.
Every level in one signature.
Health factor monitoring, read only.
Distance to liquidation, from chain.
Rebalancing shows your portfolio drift.
Live on BNB Chain mainnet.
Every number read from the chain.
```

---

## What was cut, and why

**The Graph integration.** The strongest engineering story in the project.
It needs the pagination ceiling, the unreachable range and the subgraph fix
to land, which is 15 scenes to explain a problem the viewer did not know
existed. It belongs in the written submission, where a judge can read the
measurements.

**B402 and the agent studio.** A working payment rail and a ten agent
pipeline. Cut because they are a second product. Arriving at agent to agent
commerce after the argument has moved to contracts breaks the line of
thought, and the rail check has to be read on screen to mean anything, which
two seconds does not allow.

**Skills, Sell Your Agent, Build Your Agent, Advantage Report, the ecosystem
globe, the docs, the partner strip.** All work. None advances the argument.
The test each one failed: a scene that could sit anywhere in the sequence
without anyone noticing is a scene that comes out.

**The system status page.** The hardest cut. A status page that admits a
source is failing is exactly the honesty the rest of the script claims. But
it is a statement about the project's character rather than a step in the
argument, and character is the first thing a two minute cut loses.

**The financial track record and on-chain PnL.** Cut from part 2 to give
part 3 its 44 seconds. Scenes 11 to 22 already establish that grading rests
on evidence.

**My Agents, and signing a hire on camera.** Scene 23 stops at funding.

**The multi-chain counts.** Ethereum, Solana and the rest are ingested and
live, but this is a BNB Chain story, and splitting the opening across nine
chains weakens the number the whole argument rests on.
