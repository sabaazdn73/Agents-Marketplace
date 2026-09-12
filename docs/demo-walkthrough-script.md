# Demo walkthrough: driving order and spoken script

Written 2026-09-12 from a live walk of https://www.tnega.app. Every number and
every quoted line below was read off the running site, not from source or from
memory. Where the site says something weaker than the story, the script says the
weaker thing.

Total running time about 9 minutes.

---

## Before you record

| Thing | State needed |
|---|---|
| Wallet | Connected. The site showed `0x48cE...92E9`, which is also the contract `owner()` on all four escrow deployments, so the owner address is on screen in the sidebar throughout. Nothing secret, but know it is visible. |
| My Agents | Needs that same wallet. It currently shows three real jobs past deadline with refunds available. That state is the whole point of step 5, so check it still reads that way before a take. |
| Home video | Autoplays muted with a speaker toggle top right. Leave it muted, you are narrating over it. |
| Chain tab | Start on BNB Chain, which is the default. |
| Explorer tabs | Step 12 opens four explorers. Pre-open them in background tabs if you would rather not wait on page loads mid-take. |

Two routing quirks found while walking it:

- `/multiagents` does not resolve. It falls back to the Marketplace. Reach the
  Agent Studio by clicking the sidebar item, or go to `/studio` directly.
- `/native-agents`, `/build`, `/sell`, `/my-agents` and `/docs` all work by URL.

---

## What I added to your order, and why

Judged on whether a viewer understands the project worse without it.

**Step 5, My Agents.** This is the strongest thing on the site and it was not in
your list. Steps 3 and 4 make a claim about escrow. My Agents is that claim with
real money in it: three jobs this wallet funded, all past deadline, all
undelivered, each with a working "Get my money back" button. One of them is AIDA,
the same agent from step 3. A viewer who sees the claim and then sees it hold when
the agent failed understands the project. A viewer who only hears the claim does
not. It also costs nothing in credibility, because the agents failing is the
point rather than an embarrassment.

**Step 9, Native Agents.** Every other tab lists somebody else's agent. This is
the only place the project ships its own, and it is the only screen showing live
third-party data being compared before you sign. Without it the project reads as
a directory.

**Step 10, Agent Studio.** You asked for the tabs briefly, but this one carries
the architecture argument you have made elsewhere: seven agents each doing one
job so a wrong result can be traced to the stage that produced it. It also
carries an unusually honest on-screen limit about what the agents cannot do.

**Step 11, Build and Sell, kept short.** Build Your Agent is a guide built on BNB
Agent Studio with links out, not an in-app builder. Say that plainly or a viewer
will expect a builder and not find one.

**Two things I did not add.** The ecosystem globe and the on-chain behaviour
analysis are both real, but neither changes whether a viewer understands what
Tnega is, and the video is already nine minutes.

---

## One thing to avoid showing

On the Q402 Agent card, the interaction line reads "Its address answers, but not
in a way this marketplace can hire through" and a **Hire this agent** button sits
directly below it. On camera that reads as a contradiction and a sharp viewer will
catch it.

The script below uses Q402 but keeps the shot on the interaction line and moves on
before the button is the subject. If you would rather not risk it, drop Q402 and
run step 3 with AIDA and HODL.DANCE only. The point still lands with two shapes.

Worth fixing separately, either by hiding the button for that interaction code or
by having it open an explanation rather than a hire flow.

---

# The script

Timings are cumulative. If you are more than fifteen seconds off at a checkpoint,
you are drifting.

---

### 1. Origin and scope
**Marketplace tab, chain tabs in shot. 0:00 to 0:35**

> Tnega is a marketplace for AI agents that live on chain.
>
> It started on BNB Chain, for the Build the Era hackathon. That is still where
> the most complete version of it runs.
>
> Ethereum, Arbitrum and Robinhood Chain came later, during ETHGlobal Online and
> the Arbitrum Open House buildathon.
>
> Solana and Monad are listed and indexed. You can browse and verify agents
> there. You cannot hire on either one yet, and the tabs say so.

*Driving: hover across the six chain tabs as you name them. Do not click. The
counts read BNB Chain 154.7k, Ethereum 30.8k, Solana 1.5k marked SOON, Arbitrum
1.4k, Robinhood Chain 197, Monad 10.2k.*

---

### 2. What it is for
**Same view, stat cards in shot. 0:35 to 1:15**

> The idea is a home for agents, where you can check what is known about one
> before you decide to use it.
>
> The checks come from several independent sources. An on-chain registry, a
> subgraph, a live health probe we run ourselves, and the payment record on
> chain.
>
> I want to be exact about what that buys you, because it is easy to oversell.
>
> We can tell you whether an agent can be reached. We can tell you whether it has
> ever delivered work it was paid for.
>
> We cannot tell you whether the work was any good. Nothing here measures
> quality. That is the honest boundary, and everything after this sits inside it.

*Driving: let the three stat cards sit in frame. They read 15,000 Agents Listed,
8,947 On-chain Feedback, 29 Verified Agents.*

---

### 3. The first challenge: how do you even engage an agent
**Marketplace search. 1:15 to 2:30**

> The first problem is more basic than quality. There is no standard way to know
> what engaging an agent even involves.
>
> Here is one. AIDA is an AI medical receptionist for clinics. It handles patient
> reception by voice and chat.
>
> Look at the line under the description. It says this one runs as its own
> service, and you would sign up on their own site rather than hire it here.
> That is correct. AIDA is a product you buy from its makers.
>
> Now a different shape. HODL.DANCE is a memecoin launchpad on BNB Chain. Its
> line says it needs a login issued by whoever runs it, which this marketplace
> does not have, so it cannot be hired here.
>
> And a third. This one answers when you call it, just not in a way we can hire
> through.
>
> Three agents, three completely different answers to "what do I do with this".
> None of that is declared anywhere. We work it out by probing every agent and
> then saying so on the card.

*Driving: type `AIDA` in the search box, pause on the card. Clear, type
`HODL.DANCE`, pause. Clear, type `Q402`, keep the shot on the interaction line,
then clear the search.*

*If you want the scale of it, add: out of 15,000 agents listed, 582 can be hired
here, 3,685 run as their own service elsewhere, and for 10,668 we could not
determine it at all.*

---

### 4. The second challenge: was the work any good
**Back to the unfiltered grid. 2:30 to 3:20**

> The second problem is the one I flagged at the start.
>
> Delivery is visible on chain. Every one of these cards shows it.
>
> This agent has delivered 10 of 13 paid jobs, and 3 were taken and never
> delivered. That is not a review. Nobody wrote it. It is the payment record.
>
> What it proves is that money went in and something came back out. What it does
> not prove is that what came back was worth paying for.
>
> A perfect delivery record and useless output look identical from here. I would
> rather say that than let the green badge imply something it cannot support.

*Driving: clear the search so the default grid returns. The top card,
recurringmonitoringserviceagent, shows "Delivered 10 of 13 paid jobs, 3 taken and
never delivered" in orange. Scroll one row so a second and third delivery line are
visible.*

---

### 5. What the escrow actually does when an agent fails
**My Agents. 3:20 to 4:05**

> This is where the claim gets tested, and it is the part I care most about.
>
> These are real jobs this wallet paid for. Not a demo.
>
> AIDA is the first one. I hired it, the money went into escrow, the deadline
> passed, and it never delivered anything.
>
> The site says exactly that. The deadline passed and the agent never delivered
> anything. Your money is still safe. You can get it back right now.
>
> And there is the button. The refund is not a support ticket. It is a
> permissionless call I make myself, against a contract, whether or not anyone at
> Tnega is awake.
>
> Three of these on this screen. Every one recoverable.

*Driving: click My Agents in the sidebar. Wait for "Checking your funded
budgets" to finish. Three jobs show: AIDA #56665, OnyxOracle #56664,
mandaterebalance-agent #56663, each past deadline with a "Get my money back"
button. Do not click the button during the take.*

---

### 6. Why the extension proposal exists
**Docs, Proposal page. 4:05 to 4:55**

> Both of those problems point the same way, so we wrote up a proposal.
>
> Be clear about what this is. It is the case for an extension to ERC-8004. It is
> not a standard. Nobody has agreed to it. It has exactly one implementation,
> which is this project.
>
> The argument is that an agent should be able to declare how it is meant to be
> engaged, in one field, in a file the registry already points at.
>
> Six values, taken from what we actually found rather than invented. Escrow,
> budget, per call, hosted, credentialed, and none.
>
> The measurement behind it: across 294,902 registry entries, the schema already
> has reputation fields, and they are empty on every single one. And of 6,369
> agents that respond, 15 can be reached by any machine protocol at all.
>
> Nobody approves a declaration. You declare, a consumer checks, and the
> interesting case is when the two disagree.

*Driving: sidebar Docs, then "Proposal: ERC-8004 Interaction Model", or go
straight to `/docs/erc-8004-interaction-model`. Scroll to the six-value table and
hold there.*

---

### 7. The Graph
**Docs, The Graph Integration. 4:55 to 5:45**

> Here is a concrete problem we hit, and what fixed it.
>
> Our registry data came from one REST API. It works fine at the start of the
> list. Past roughly 700,000 entries deep, it stops answering. It times out.
>
> That left 361 positions in the list permanently stuck, retried on every run,
> failing every time. Our stored registry just stopped at agent 332,377.
> Everything above that was invisible to us.
>
> The Agent0 subgraph on The Graph indexes the same registries. It returned
> 2,399 agents above our highest stored id, in about a second and a half.
>
> What survived matters more than what we fetched. After health checking, 537
> agents with live, responding endpoints that the first source could not deliver
> at any speed.
>
> It is a fallback and a second opinion, not a replacement. The subgraph cannot
> give us scores or categories, because those are computed off chain.

*Driving: sidebar "The Graph Integration". The before and after diagram is near
the top, the verified result block is lower down.*

---

### 8. Docs
**Docs, Introduction. 5:45 to 6:05**

> All of this is written down. Architecture, core concepts, every data source,
> the deployment records, and the things that did not work.
>
> The contracts section is the one worth your time, so let me open that.

*Driving: click Introduction, scroll the sidebar so the section headings are
visible, then click Smart Contracts.*

---

### 9. Smart contracts
**Docs, Smart Contracts, plus explorer tabs. 6:05 to 7:05**

> Our budget escrow is live on four chains. BNB Chain, Ethereum, Arbitrum and
> Robinhood Chain.
>
> Do not take my word for any of it. Every address here links to that chain's own
> explorer, and what you land on is the contract, not a page we control.
>
> Verified source on BscScan, on Etherscan, on Arbiscan, and through Sourcify for
> Robinhood Chain, which runs Blockscout.
>
> The fee is 250 basis points, two and a half percent, and the maximum is
> hard-capped at 1000, ten percent. That cap is a constant, so the owner cannot
> raise the rate past it even by mistake.
>
> One trap worth naming out loud. The same address holds a different contract
> depending on the chain. That is a coincidence of how addresses are derived, not
> a guarantee, and we resolve every address per chain because of it.

*Driving: open the "Every contract, by chain" section. Open BscScan, Etherscan,
Arbiscan and Blockscout in separate tabs and show the verified source tab on at
least two. Then return and show the live values table with feeBps 250,
MAX_FEE_BPS 1000, and owner.*

---

### 10. Native Agents
**Native Agents. 7:05 to 7:40**

> Everything so far has been somebody else's agent. This is ours.
>
> The yield agent compares BNB liquid staking protocols, liquidity and risk
> first, yield second, and tells you why it picked what it picked before you
> sign anything. It stakes through your own wallet, non-custodially.
>
> The entry fee is 0.75% and it is disclosed on the screen before you act.
>
> Note the line under the projection. It says this is a projection at today's
> rates, not a forecast, and that it assumes each rate holds for a year, which
> none of them will. That is the tone I want across the whole site.

*Driving: sidebar Native Agents. The APR chart is in view on load. Scroll slightly
so the projection disclaimer is readable.*

---

### 11. Agent Studio and the two creator tabs
**MultiAgents, then Build and Sell. 7:40 to 8:35**

> The Agent Studio is a set of agents working on one purchase, passing what they
> find to each other.
>
> Seven of them, each doing one job. That split is deliberate. When a result
> comes out wrong you can see which stage produced it, which you cannot do with
> one agent doing everything.
>
> And it states its own limits on screen. The agents read links you paste. They
> cannot browse shops on their own, because retailers block that. If one cannot
> find something it says so rather than inventing a list.
>
> Two more tabs for the other side of the market. Build Your Agent is a guide to
> building one on BNB Agent Studio, with the sources linked. It is a guide, not a
> builder inside this site.
>
> And Sell Your Agent lists an agent you already own, as a one-off purchase, a
> subscription, or pay per use. We check ownership against the public registry
> before anything is listed.

*Driving: click MultiAgents in the sidebar, not the URL. Show the seven-stage
strip and the orange limits banner. Then Build Your Agent, then Sell Your Agent,
about ten seconds each.*

---

### 12. Close
**Home. 8:35 to 9:00**

> One verifiable network across chains, which is the thing we are actually
> trying to build.
>
> Agents you can find, check, and pay without trusting us to hold the money.
>
> What it does not do is tell you the work was good. That part is still open,
> and the proposal is where we think the answer starts.

*Driving: click Home. The video is already playing, muted. Let it run under the
last two lines and stop the recording on it.*

---

## Claims I deliberately did not let into the script

Recorded so you can see what was trimmed and why.

- "Verified agents" is not called proof of quality anywhere. It means a confirmed
  delivered job and nothing more.
- The Graph section says fallback and second opinion, never replacement, because
  the docs page says neither source is a superset of the other.
- Build Your Agent is called a guide, because that is what it is.
- Sell Your Agent's fee line on screen says "once paid listings go live", so the
  script does not claim listings are selling today.
- The docs Introduction still describes Tnega as a BNB Smart Chain marketplace,
  which predates the other three chains. The script uses the current four rather
  than that sentence. Worth correcting in the docs separately.
