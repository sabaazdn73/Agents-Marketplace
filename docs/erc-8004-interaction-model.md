# Proposal: a declared interaction model for ERC-8004

This is the case for an extension, not the extension itself. Nothing here is
a standard, nobody has agreed to it, and it has one implementation, which is
this project. It is written down because the problem it addresses was
measured rather than assumed.

## The problem

ERC-8004 gives an agent a permanent on-chain identity and a pointer to a
registration file. What it does not give is any statement of how a person or
a program is supposed to engage with that agent.

So a consumer looking at a registry entry cannot tell whether the agent is
hired and paid through escrow, needs a subscription, expects an account on
someone else's website, speaks a protocol they support, or does not work at
all. There is no field that says. Every consumer has to discover it by
probing each agent, and every consumer has to build that probing themselves.

That is the cost this proposal is about. It is not a theoretical one.

## What we measured

Every figure below comes from this project's own stored data and is
reproducible against it. Two separate exercises are cited, and they have
different scopes and dates, so both are given rather than blended.

### The current corpus

Measured 2026-09-10 across 294,902 stored registry entries, of which 247,598
have been through the live health check on five chains.

The share with no service endpoint at all, meaning an on-chain identity and
nothing to reach:

| Chain | Checked | No endpoint |
|---|---|---|
| BNB Chain | 154,695 | 31,412 (20.3%) |
| Base | 60,539 | 34,480 (57.0%) |
| Ethereum | 30,771 | 0 (0.0%) |
| Arbitrum | 1,403 | 43 (3.1%) |
| Robinhood Chain | 190 | 159 (83.7%) |
| All five | 247,598 | 66,094 (26.7%) |

Ethereum's zero is not a good result. 30,578 of its 30,771 entries came back
`unknown`, meaning the metadata could not be resolved at all, so the question
was never answered rather than answered negatively.

The registry schema already carries a `rank` field. It is populated on 0 of
294,902 entries. So are `network_rank` and `owner_publisher_tier`, and
`is_verified` was false on every one of a 20,000-entry sample. The schema
already has reputation-shaped fields, and they are empty everywhere.

Feedback, meaning any on-chain feedback entry at all:

| Chain | Entries | With any feedback |
|---|---|---|
| Base | 60,539 | 15,085 (24.9%) |
| Arbitrum | 1,403 | 90 (6.4%) |
| Ethereum | 30,771 | 1,157 (3.8%) |
| Robinhood Chain | 190 | 1 (0.5%) |
| BNB Chain | 154,695 | 460 (0.3%) |

On BNB Chain, 460 agents carry all 11,651 feedback entries between them. That
is 0.3% of agents holding 100% of the feedback, and the ten largest hold 1,020
of those entries (8.8%). Feedback is not a signal that covers the corpus.

What agents do declare is a protocol tag, and 161,502 of 294,902 (54.8%)
declare at least one. The most common by a wide margin is `Web` (130,022),
which says the agent has a website and nothing about how to engage it. `A2A`
appears 37,055 times, `MCP` 21,251, `OASF` 10,606. Separately, 20,080 entries
(6.8%) carry an x402 flag. A protocol tag is not an interaction model: it
says what an agent speaks, not what a consumer is supposed to do.

Classification from name and description, which is what a consumer is left
doing when nothing is declared, fails on most of the corpus: 66.6% of BNB
Chain entries, 76.5% of Base, and 90.1% of Ethereum could not be categorised
at all.

### The interaction census

A separate, earlier exercise (2026-08-28, full methodology in
[Agent Interaction Patterns](agent-interaction-patterns.md)) took the BNB
Chain corpus as it stood at 64,821 entries and worked out how many genuinely
distinct interaction patterns exist in practice.

41,900 of those 64,821 (64.6%) had no endpoint. Of the 22,921 that were
reachable, 21,458 (93.6%) were one platform and 1,412 (6.2%) were a second,
so two platforms accounted for 99.8% of everything reachable.

Everything outside those two, 51 agents across 21 domains, was read in full
and live-probed. That is a census of that population, not a sample. Six
patterns were found:

| Pattern | Count of 51 |
|---|---|
| Works through escrow normally | about 30 |
| A hosted service, hard protocol rejection | about 6 |
| Dev or throwaway registration, live but not a product | about 9 |
| Pay-per-call, described as such by the agent | 3 reachable |
| Needs operator-issued credentials, a real 401 or 403 | 2 |
| A live JSON API that does not speak the hiring protocol | 1, plus one large cluster |

Five further patterns were hypothesised and checked directly against the
corpus, and each was ruled out on evidence: governance delegation (0 agents),
vault deposit (0), NFT or token-gated access (0), subscription or webhook (1
match corpus-wide), and MCP as the only way in (0, every MCP-tagged agent
traced back to an endpoint already reachable another way).

Six patterns is a small enough number to enumerate in a field. That is the
finding this proposal rests on.

## What the extension proposes

One object in the registration file the registry already points at. No
contract change, no new registry.

```json
{
  "interaction": {
    "model": "escrow",
    "protocols": ["a2a"],
    "endpoint": "https://example.com/agent",
    "auth": "none",
    "settlement": { "chain_id": 56, "asset": "0x..." }
  }
}
```

`model` is the only required field, and it is an enumeration drawn from what
the census actually found:

| Value | Meaning |
|---|---|
| `escrow` | Hire it and pay on delivery, through an on-chain escrow |
| `budget` | Fund a spending allowance it draws from as it works |
| `per_call` | Pay for each call, x402 or equivalent |
| `hosted` | It runs as its own service, engage it on the operator's own terms |
| `credentialed` | Reachable only with credentials its operator issues |
| `none` | Identity registration only, nothing to engage |

Everything else is optional and only meaningful for some models. `protocols`
is what it speaks. `endpoint` is where. `auth` is what a caller needs before
being let in. `settlement` is the chain and asset it expects to be paid in,
which matters because an agent registered on one chain may settle on another.

The point of `none` is worth stating separately. Just over a quarter of the
current corpus has nothing to engage, and on one chain it is 83.7%. Being
able to say so is more useful than leaving a consumer to probe and infer it.

## How a claim would be verified

A declared field that nobody checks is close to worthless, and this proposal
deliberately does not introduce anyone to check it.

Verification is something a consumer does independently, and it is already
possible today. This project probes an agent's endpoint, distinguishes a hard
protocol rejection from a credential wall from a live API that speaks
something else, and records the result per agent. A declared `model` gives
that probe something to agree or disagree with, which is strictly more than
it has now.

That produces three states a consumer can act on. Declared and confirmed by
their own probe. Declared and contradicted by it, which is a stronger signal
than either alone and is the case worth surfacing loudly. Not declared, which
is where every agent sits today.

Nothing in this requires the declaration to be believed. It requires it to be
checkable, which is the difference between a claim and a credential.

## Who would use it

### Marketplaces

A marketplace currently probes every agent itself and builds a classifier to
guess the rest. On this corpus that classifier fails on between 66.6% and
90.1% of entries depending on the chain. A declared model replaces a guess
with a claim it can verify.

### Wallets

A wallet showing an agent to a user has to decide which action to offer.
Today there is nothing to decide from, so the choice is to offer everything
or nothing. `model` is enough to pick the right one, and `settlement` is
enough to warn before a user signs on the wrong chain.

### Agent frameworks

A framework that scaffolds a new agent already knows which model that agent
implements, because it generated the handler. Writing one field at
registration costs it nothing, and that moment is the only point in the
lifecycle where the answer is known for certain rather than inferred.

## What this deliberately does not do

There is no authority, no gatekeeper, and no registry that approves
anything. Nobody grants a model, nobody revokes one, and there is no list to
be added to.

An agent declares. A consumer verifies, or does not, on their own terms. Two
consumers are free to reach different conclusions about the same agent, and
neither is wrong in a way an arbiter has to settle.

That property is the reason this is worth proposing as an extension rather
than building as a product feature. A field in a file that anyone can read
and anyone can check does not create a position for someone to own. A
verification service does.

## Honest limits

A standard is adopted, not written. This is a proposal with one
implementation and no external commitment, and it should be read that way.

The census that produced the enumeration was one chain at one point in time,
64,821 entries in August 2026. Six patterns held across that corpus. A
different corpus could contain a seventh, and the enumeration would need to
grow, which is a real weakness in any closed list.

The proposal also does nothing for the agents that most need help. An entry
with no endpoint and no metadata cannot declare anything, and that is 26.7%
of the current corpus outright plus most of Ethereum's 30,578 unresolvable
entries. This makes good agents legible. It does not make absent ones
present.

## Where it might start

Monad treats ERC-8004 as a first-class registry rather than one contract
among many, which makes it a reasonable place to put a proposal like this in
front of people who would have to implement it. The current thinking is to
start there and extend to other chains afterwards.

That is current thinking and not a commitment. No approach has been made and
nobody has agreed to anything.
