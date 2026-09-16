# Tnega MCP server: the shape, before the tools

Design only. Nothing is built yet, and nothing here changes the site, the
collectors or the existing API.

The question this answers is not which tools to ship first. It is what the
surface looks like after the tenth dataset arrives, because that is the version
that has to still be usable, and the first version is what decides it.

---

## 1. What is behind it today

Six bodies of measurement, all already served by `core/`:

| | Service module | What it holds |
|---|---|---|
| Agent index | `core/agents_index.py` | ~15,000 agents, five chains, tiered by what they have delivered |
| Agent evaluation | `core/agent_evaluation.py`, `core/agent_performance.py`, `core/agent_health.py` | per-agent scoring, liveness, provider stats |
| ERC-8183 jobs | `core/job_index.py` | the job index, provider revenue, per-provider stats |
| Hyperliquid | `core/hyperliquid/service.py` | post-only rejection, coverage, WebSocket buckets |
| Budget and escrow | `core/budget_index.py`, `core/escrow_compat_audit.py`, `core/protocol_compat.py` | budget state per chain, escrow compatibility |
| Chain views | `core/chain_views.py`, `core/chain_capabilities.py` | the five chains, Robinhood stock tokens among them |

The REST surface over those is 64 routes. That number is the warning. It grew
one route per question, and a model choosing between 64 tools chooses badly,
where a developer reading 64 endpoints in a doc chooses fine. The difference
between the two readers is the whole design problem.

---

## 2. The shape

### Rejected: one tool per dataset

`get_agents`, `get_hyperliquid_address`, `get_job_index`, `get_budget_state`,
and so on. It fails in the direction this has to survive. Every dataset adds a
tool, every tool adds a description the model has to read and rank, and the
names begin to overlap long before the tenth: `get_agent_performance` against
`get_agent_evaluation` against `get_agent_health` are three modules that exist
today, and a model cannot pick between them from names alone. It also puts the
growth in the worst place: adding a dataset changes the tool list, which is the
part of the protocol a client caches and a user sees.

### Rejected: one tool with a large schema

A single `tnega_query` with a discriminated union of every parameter any
dataset takes. The tool count stays at one and the problem moves into the
schema, where it is worse. The description cannot describe what the tool does,
because what it does depends on arguments the model has to guess. Wrong guesses
return schema errors rather than answers, and the model has no way to find the
valid values except by trying them.

### Chosen: a small verb surface over a named catalogue

Six tools, split by the shape of the answer rather than by subject. Subject is
a parameter, and its valid values are discoverable at run time.

```
tnega_catalogue   what measurements exist, their coverage, their freshness
tnega_resolve     a string (address, token id, agent id, ticker) to entities
tnega_get         one entity in depth
tnega_list        many entities, filtered, paged, compact rows
tnega_summary     an aggregate, with its coverage
tnega_series      a measurement over time
```

Why this split holds as the set behind it grows:

The boundaries are about response shape, and response shapes do not multiply.
There are only so many ways to answer: what is there, which one do you mean,
tell me about this one, tell me about these, roll them up, and how has it
moved. A new dataset is a new row in `tnega_catalogue`, not a new tool. The
tool list is stable, which means a client that cached it a month ago is still
correct.

The model's first call is answerable without prior knowledge. `tnega_catalogue`
costs about 3 KB and tells it every dataset id, what each measures, what keys
each accepts and how current each is. Nothing else in the surface requires the
model to already know a vocabulary.

Each tool has a size guarantee that follows from its shape, not from the
dataset. `tnega_summary` is bounded by construction. `tnega_list` is bounded by
a cap. `tnega_get` is bounded by one entity. That is what makes section 3
enforceable at the surface rather than per dataset.

The failure mode is a good one. A wrong dataset id returns the catalogue's list
of valid ids, so the model recovers in one call rather than guessing.

Six is a deliberate number. Collapsing `list` and `summary` into one tool with a
flag would make the response shape conditional on an argument, which is exactly
the thing a description cannot convey and a model cannot predict. Splitting
further, for example a separate `tnega_coverage`, would add a tool for something
that belongs in every response anyway.

---

## 3. The size contract

Measured, from `docs/memory-ceiling.md`:

| | |
|---|---|
| Whole agents payload | 15,748,096 bytes |
| The agent array within it | 15,712,666 bytes |
| A page of 24 | 27,776 bytes, about 1,157 bytes per agent |
| Facets | 1,010 bytes |
| Backend cap | 512 MiB, OOM killed roughly every two hours as it is |

Ten concurrent callers of the 15.7 MB shape exceeded the headroom that exists
90% of the time. A model in a loop is a more likely ten concurrent callers than
ten humans ever were.

So: no tool in this surface can return the whole-catalogue shape, at any
argument. Not capped by default, not reachable.

| Tool | Default | Hard ceiling | Basis |
|---|---|---|---|
| `tnega_catalogue` | all datasets | 8 KB | about 12 rows today |
| `tnega_resolve` | up to 5 candidates | 2 KB | ids and labels only |
| `tnega_get` | one entity | 8 KB | an agent blob is 1.2 KB, with evaluation about 3 KB |
| `tnega_list` | 25 compact rows | 32 KB | at about 200 bytes a row, 25 rows is 5 KB |
| `tnega_summary` | one rollup | 8 KB | bounded by construction |
| `tnega_series` | 200 points | 16 KB | 10 second Hyperliquid buckets, 200 is 33 minutes |

Two rules make those hold as datasets arrive.

`tnega_list` returns a projection, never the full record. About 200 bytes a row:
id, label, chain, tier, and the one metric the dataset is about. Going deeper is
`tnega_get` on a named id, which is an explicit second call rather than a page
that quietly got heavy. This is the same decision `agents_index.py` already
made for the grid, applied to a reader that cannot see the size until it has
paid for it.

Paging is by opaque cursor, not offset. A cursor encodes the filter set and the
position, so a caller cannot widen a page by editing a number, and the server
can change the page size without a caller constructing an invalid request.

---

## 4. The envelope, and how honesty survives the transport

A person reading the site sees a caveat printed next to a number. A model sees
only what the response carries. So the response carries it, in a fixed envelope
every tool returns:

```json
{
  "measured": "post-only rejection rate for one Hyperliquid address",
  "coverage": {
    "observations": 83,
    "window": "2026-09-15T21:10Z to 2026-09-16T13:09Z",
    "excluded": "orders older than one hour",
    "partial": false
  },
  "as_of": "2026-09-16T13:09:48Z",
  "value": { },
  "withheld_reason": null,
  "caveats": [],
  "next_cursor": null
}
```

Four rules, carried from the site's own:

Coverage comes before the value, in field order as well as in principle. A
reader that truncates sees the denominator and not just the number.

Absence is never zero. When there is no number worth stating, `value` is null,
`withheld_reason` carries the machine-readable reason and `caveats` carries the
sentence that explains it. The five Hyperliquid reasons already exist in
`service.py` and are returned verbatim rather than re-worded here.

A rate never ships without its denominator and its window. This is why
`coverage` is a required field rather than an optional block.

Partial says so. `coverage.partial` is true whenever a source was unreachable,
a chain did not answer, or an index is mid-rebuild, and `caveats` says which.
An empty result from a failed fetch and an empty result from an empty set are
different responses, not the same one.

The precedent for this being load-bearing rather than decorative: the
Hyperliquid endpoint already returns a reason instead of a rate for 32 of 50
tracked addresses, and the WebSocket coverage table exists because a collector
delivering nothing produced no evidence that it was delivering nothing.

---

## 5. Tool descriptions

A REST endpoint's documentation is read by a developer who has already decided
to call it. A tool description is read by a model deciding whether to call it at
all, from a list, once, without being able to ask a follow-up question. It is
functional text and gets tested as such.

The standard to match, from the Smithery survey: 99.7% of tools carry a
description, median length 197 characters.

Each description states, in this order: what it answers, what it needs, what it
returns including the cap, and which sibling to use instead. That last clause is
what a six-tool surface needs most, because the model's actual question is
usually "this one or that one".

Draft, 247 characters:

> Post-only rejection and coverage for Hyperliquid addresses, one address at a
> time. Give an address; returns the rate and its band, or the reason no rate is
> available, with the observation count behind it. For many addresses at once use
> tnega_list.

A description passes review when a model can decide, from that text alone,
whether this tool answers the question, what it must supply, what it will get
back, and which sibling to use instead. A mechanical check in the test suite
holds the shape: 120 to 400 characters, names at least one sibling, states the
cap, and contains no example value that is not a valid argument today.

---

## 6. Exposed, and held back

Exposed on day one, read only:

The agent index and its evaluation across five chains, the ERC-8183 job index
and provider stats, the Hyperliquid post-only measurements and their coverage,
budget and escrow state, escrow compatibility, the chain views including the
Robinhood stock token work, and the service status and data source records.

Held back, with the reason:

Everything that writes or triggers work: build, hire, negotiate, notify-funded,
paybox sessions, studio runs, canary record, and the admin batch routes. A write
surface needs a consent model, and this project's writes are wallet-signed in a
browser by the person who owns the funds. There is no version of that flow where
a model holds the pen.

The deliverable proxy and `first-visit`. One fetches third-party content on
demand and the other exists to see a visitor once. Neither is a measurement.

The live-lookup path in `core/universal_search.py`. It calls 8004scan and an RPC
per miss, on a shared per-IP quota. Behind an unauthenticated MCP endpoint that
is a free proxy to someone else's rate budget. `tnega_resolve` ships over local
data only, and the live path stays off until there is something to attribute a
call to.

The legacy whole-catalogue path on `/api/agents`. Section 3.

---

## 7. Auth, and a correction

The brief says to use the same keys and tiers as the REST API. There are none.
I checked rather than assumed: every `/api/*` route is public and
unauthenticated by design, stated as such in `server.py`, with exactly one
exception. The admin batch routes require a shared secret in `X-Batch-Secret`
checked against `BATCH_TRIGGER_SECRET`, and they fail closed when it is unset.
There is no consumer key, no tier, no quota and no rate limiting middleware. The
word "tier" in this codebase means an agent's verification tier, which is a
property of the data rather than of the caller.

So the instruction resolves to: the MCP server is public and read only, exactly
as the REST API is, and no second key system gets built. That is what I will
build unless you say otherwise.

What that leaves unprotected is worth naming, since the exposure is not the same
as the REST API's. A browser makes a bounded number of calls because a person is
driving it. A model does not. The backend is OOM killed about every two hours at
its current resting memory, and nothing in the stack sheds load.

The protection is therefore the size contract in section 3, plus two things that
belong in the build: a per-connection concurrency limit of one in-flight call,
and a response byte ceiling enforced in the envelope writer rather than per
tool, so a new dataset cannot opt out of it by accident.

One seam is left for later, unbuilt: every tool call resolves a caller object,
which today is always anonymous. If keys ever arrive, they arrive in that one
function, and no tool signature changes.

---

## 8. Where it runs

The MCP server mounts into the existing FastAPI process rather than taking a
service of its own.

The reason is memory, which is the constraint that already governs this backend.
The expensive thing is not the protocol, it is the agents index: 21.53 MB
resident, held as one cache. A second process means a second copy of that cache
in a second 512 MiB container, and the first container is already being killed
every two hours. Mounting shares the cache and adds only the protocol.

The cost of that choice, stated plainly: an MCP caller can now contribute to an
OOM that takes the site down with it. That is what the concurrency limit and
the byte ceiling in section 7 are for, and it is the thing to watch after the
first week. If it turns out to need isolation, the move is a second service with
a read-only replica of the index, not a second implementation.

---

## 9. The adapter boundary

The MCP layer imports from `core/` and never from `server.py`. It contains no
business logic, no thresholds, no formatting of numbers into sentences, and no
second copy of a rule. Where a rule is needed and does not exist in `core/`, it
goes into `core/` and both transports get it. The Hyperliquid extension is the
precedent: it renders what the backend decides and computes nothing, so the rule
for withholding a rate lives in one place rather than in every client that shows
one.

One thing to fix while building: `core/agents_index.py` imports
`fastapi.encoders.jsonable_encoder`. It is a JSON helper rather than a response
type, so the layer is transport free in every way that matters, but it is the
one import that would make the claim false if it grew. It moves to a local
encoder when the MCP adapter lands.

---

## 10. Adding a dataset later

A dataset is a descriptor, registered in one module:

```python
Dataset(
    id="hyperliquid.post_only",
    title="Hyperliquid post-only rejection",
    measures="share of post-only orders refused before resting",
    keys=["address"],
    coverage=service.coverage,          # required
    get=service.address_detail,         # optional
    list=service.makers,                # optional
    summary=service.maker_bands,        # optional
    series=service.ws_buckets,          # optional
    caveats=["the WebSocket feed carries no tif, so its denominator "
             "differs from the REST rate"],
)
```

The six tools read the registry. Adding a dataset means adding a descriptor and
its tests. It adds no tool, changes no schema, and breaks no caller. A dataset
that cannot state its coverage cannot be registered, which is the rule from
section 4 enforced at the point of entry rather than at the point of display.

Removal is a `deprecated` field with a date and a replacement id. The catalogue
keeps showing it, every response from it carries the deprecation in `caveats`,
and it is removed a stated number of days later. A caller that stops working
should have been told first.

---

## 11. What I need agreed before building

1. The six-verb surface, and the names. `tnega_` prefix assumed, for a model
   holding tools from several servers at once.
2. The caps in section 3, in particular `tnega_list` returning a 200 byte
   projection rather than whole records.
3. Public and unauthenticated, per section 7, which is a correction to the
   brief rather than an agreement with it.
4. Mounting into the existing process, per section 8, and its stated risk.
5. `tnega_resolve` over local data only, with the live 8004scan and RPC path
   held back.

Say yes, or say which of the five is wrong, and I will build it.
