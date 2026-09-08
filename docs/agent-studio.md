# The Agent Studio (MultiAgents)

The studio is the MultiAgents tab, at `/studio`. It takes one written
request and runs it through a chain of small agents, each with one job,
showing which one is working and what it handed to the next. It is the only
place in the product where several agents cooperate on a single task rather
than one agent answering alone.

The code is `backend/core/commerce/`. The name of the package is `commerce`
because the pipeline ends at a purchase; the tab is called MultiAgents
because what a visitor watches is the handoff between agents.

The older Pay.B402 tab was folded into this one. `/pay-b402` still resolves,
to the studio, so existing links keep landing somewhere.

## Two flows, because the two problems are not the same

| Flow | Key | What it does | Ends at |
|---|---|---|---|
| Physical goods | `physical` | Builds a cart from product links you supply | A cart handed back to you |
| API and services | `api` | Finds a paid service in the B402 Bazaar and settles for it | A payment on BSC, or a handoff |

The split exists because of one constraint that could not be engineered
around: there is no search across retailers. No public API lets a program
query stock and prices across shops the way a person can browse them. So the
physical flow does not discover products. It reads the product URLs the
person supplies, prices them, checks them and assembles a set. The API flow
does have a directory, the B402 Bazaar, so it can search.

Stating that plainly is the point. The physical flow's Search agent is
labelled in `/api/commerce/readiness` as "built, resolves supplied product
URLs; no discovery source".

## The agents

Each agent is one module under `core/commerce/agents/`, exposing a single
`run(state)` that returns a `StageResult`. None of them calls another. The
coordinator is what passes work along.

### Physical flow

| Agent | What it works out |
|---|---|
| Profile | Size, budget, country, city, age range, taste |
| Context | Occasion, season, destination, travel dates |
| Merchant Fit | Which shops can serve the stated country |
| Search | Reads the product links supplied, and prices them |
| Styling | Assembles a set inside the budget |
| QA | Looks for reasons to reject the cart |
| Payment | Never runs here. Drawn dozing, with the reason |

Payment is deliberately shown asleep in this flow rather than hidden.
Physical checkout needs a card partner that is not connected, so the
finished cart is handed to the person with a link per item.

### API flow

| Agent | What it works out |
|---|---|
| Intent | What the person is trying to do |
| API Fit | Searches the B402 Bazaar for services that match |
| Match | Compares price, terms and fit, then picks one |
| QA | Checks price and terms before anything is paid |
| Payment | Reports which rail would settle, and settles when it can |

## How a run works

A run is started, given an id, and polled. It is not a synchronous call.
Context alone has measured at 74 seconds and a full physical run at 111, and
a synchronous endpoint would leave the caller with a spinner and no idea
which agent was busy.

```
POST /api/studio/runs            {"flow": "api", "request": "..."}  -> run_id
GET  /api/studio/runs/{run_id}                                      -> poll
POST /api/studio/runs/{run_id}/answers   {"answers": {...}}         -> resume
GET  /api/studio/flows                                              -> the roster
```

Every poll returns the same shape: the agents in this flow, the state of
each, how long the working one has been at it, what handed off to what, and
every stage result so far. The visualisation draws that and invents nothing.
An agent is shown as done only when its stage returned, and blocked only
when a stage said so.

The six states an agent can be in are `idle`, `waiting`, `working`, `done`,
`blocked` and `asleep`. Nothing else is ever reported.

Run state lives in memory, evicted after 30 minutes
(`RUN_TTL_SECONDS`). That is a limit rather than an oversight: a run is
watched while it happens and has little value afterwards, the backend
restarts often, and a dropped run costs a retry rather than money.

### Asking the person something

An agent can stop and ask. Before this existed, a stage could return a list
of questions and that was the end of the run, so the opening agent was a
dead end rather than a conversation.

A question is an object with a stable id and a dotted `field` saying where
the answer goes, for example `profile.size` or `context.destination`. The
coordinator pauses on the asking agent, takes answers through
`POST /api/studio/runs/{run_id}/answers`, merges them into the shared state
and resumes that agent. Stages before it are not run again: their results
are already in the state, and repeating them would cost the time twice and
could return something different the second time.

Two guards sit on this path. An answer whose id matches no pending question
is ignored rather than written by name, so a client cannot reach into parts
of the state no question asked about. And each flow has a fixed vocabulary
of fields it may ask for, so one flow cannot ask another's questions. A size
belongs to a physical purchase and has no meaning for an API call, so a
model that returns "what size" during an API run has that question dropped.

Field sets, from `questions.py`:

| Flow | Fields an agent may ask for |
|---|---|
| Physical | `profile.size`, `profile.budget_text`, `profile.country`, `profile.city`, `profile.age_range`, `profile.taste`, `context.occasion`, `context.season`, `context.destination`, `context.travel_dates` |
| API | `profile.budget_text`, `context.capability`, `context.purpose`, `context.volume`, `context.priorities` |

## QA is a rejection checklist, not an approval one

QA is the gate before money moves, and it is written as a list of reasons to
reject rather than a list of things to confirm. There is no `approve()` and
no score. An empty findings list is the only thing that lets Payment run:
absence of findings, not presence of a blessing.

It consults no model. It is deterministic, so it works with no API key,
cannot be talked out of a finding by a persuasive product description, and
gives the same answer twice for the same cart. A payment gate is the wrong
place for a probabilistic judgement.

Every finding names the stage that caused it, which is what the split into
separate agents buys.

| Rule | Blamed on | What it catches |
|---|---|---|
| `empty_cart` | styling | Nothing to buy |
| `size_missing` | search | A line with no size |
| `size_outside_profile` | styling | A size the profile did not state |
| `size_unknown` | profile | No size was ever collected |
| `over_budget` | styling | Total above the stated budget |
| `total_uncomputable` | styling | Lines that cannot be summed together |
| `budget_unknown` | profile | No budget was ever collected |
| `wrong_for_season` | styling | A parka for a summer trip, flagged as a heuristic |
| `link_missing` | search | A line with no URL |
| `link_dead` | search | A URL that does not resolve |

The season rule is labelled a heuristic in the finding text. It maps
northern-hemisphere seasons to garment words and flags an item for a person
to look at. It does not claim certainty about a garment.

The `category` field on a cart line turns clothing rules off for services. A
size check on an API endpoint is not a safety net, it is noise that hides
findings that matter.

## Money is an integer type, never a float

`0.1 + 0.2` is not `0.3` in IEEE 754, and a cart total is exactly the sum of
a list of prices. In float, the total shown can disagree with the total
charged, in the last decimal place, invisibly in testing and permanently
on-chain. The assets here are 18-decimal tokens, and a float64 carries about
15 to 17 significant digits, so a full-precision 18-decimal amount cannot
round-trip through a float at all.

So `Money` holds an integer count of minor units plus the decimals that
define them. Every operation is integer. Passing a float to the constructor
raises rather than truncating. Adding two amounts with different symbols or
different decimals raises rather than coercing. `as_decimal()` exists for
display and returns a `Decimal`, never a float.

One consequence worth knowing if you call the API: `Money.units` for an
18-decimal token exceeds JavaScript's `Number.MAX_SAFE_INTEGER`, so the
encoder in `state.py` serialises it as a string. A raw integer there would
lose precision in the browser before anything rendered it.

## The model layer

`model.py` exposes one `reason(prompt, schema)` call. The provider is a
config value, so replacing Gemini is an environment change rather than a
rewrite.

With no key configured it does not raise. A missing key is a deployment
state, not a bug, and the pipeline is deliberately useful without one: QA is
deterministic and the handoff rail needs no model at all. So it returns
`{"degraded": True, "would_have": "..."}` and each model-backed agent
surfaces that as its result. The run completes and explains itself.

It never fabricates a plausible answer in degraded mode. Saying what it
would have asked the model is useful. A guessed size or an invented product
is worse than nothing, because everything downstream would price and
possibly buy against it.

Model choice was measured rather than assumed. `gemini-3.6-flash` ran out of
free quota and returned 429 on every call. Five Flash models were timed on
the same prompt, the Sydney in December case, which separates a month lookup
from reasoning about hemispheres:

| Model | Time | Correct |
|---|---|---|
| gemini-3.7-flash | 1.7s | yes |
| gemini-3.5-flash-lite | 0.8s | yes, but the smallest tier |
| gemini-3.5-flash | 12.8s | yes |
| gemini-3.8-flash | 77.6s | yes |
| gemini-3.6-flash | no result | 429, no quota left |

`gemini-3.7-flash` is the default: full Flash tier rather than lite, correct
on the case that matters, and much faster than what it replaced.
`COMMERCE_MODEL` overrides it.

The default is pinned to a specific version rather than a moving alias.
`gemini-flash-latest` returned 503 on the same run, and an alias can change
underneath a deployment without warning.

Two timing decisions come from measurement. The call timeout is 90 seconds,
because an earlier 45-second guess sat on top of the observed range: the
same prompt answered in 34.9s, then timed out at 45.0s, then answered in
44.7s, which turns a slow model into an intermittent failure. And a quota
error gets exactly one retry after a 6 second pause, then reports being rate
limited, which is a different thing from broken.

## What the studio will not do

It holds no private key, so it cannot sign a payment. Where a rail needs a
signed authorisation, the signature comes from the buyer's wallet in the
browser and the backend refuses to proceed without one. See
[Payment Rails](payment-rails.md) for what each rail does with that.

It never creates a browser profile at a merchant. See
[Data Handling](data-handling.md#spending-controls) for the three
independent guards in front of the order write, and
[Payment Rails](payment-rails.md#the-hard-spend-cap) for the spend ceiling.

## Checking it yourself

`GET /api/commerce/readiness` reports what the pipeline could do right now:
the model's status, a dry-run quote from every rail, and the state of each
stage. It never returns a key.

`backend/scripts/commerce_selfcheck.py` runs the pipeline's own checks: 50
of them, covering money arithmetic, the QA rules, rail selection, the three
Crossmint guards, and the failure behaviour of Search and Styling. It passed
50 of 50 on 2026-09-08.
