# The 512Mi memory ceiling, and why it is being lived with

Both Render services (the web service and the background worker) are OOM-killed by the platform on a 512Mi container cap. As of 2026-09-05 this is a known, accepted condition, not an open bug. Render restarts automatically, the gap is seconds, and the marketplace stays up. This page records why the obvious fixes were rejected, so nobody re-derives it or retries something already measured and ruled out.


## The Atlas quota is metered on dataSize, not storageSize (2026-09-08)

Worth its own note here because a headroom check got this wrong and blocked
writes on the whole cluster.

MongoDB's `dbStats` reports both `storageSize`, the compressed size of the
files on disk, and `dataSize`, the logical uncompressed size. Atlas free
tier meters `dataSize + indexSize`. WiredTiger compression roughly halves
the file size on this data, so the two readings are far apart:

| Reading | Value at the time |
|---|---|
| storageSize + indexSize | 256.3 MB |
| dataSize + indexSize | 511.5 MB |

Atlas reported "using 512 MB of 512 MB" and refused every write, from the
backfill and from production alike, while a check built on `storageSize`
was still reporting more than 200 MB free. A quota check on this cluster
has to read `dataSize + indexSize` or it is not measuring the thing that
blocks writes.

Recovering it needed deletes, which Atlas still permits over quota. Two
were made:

| Action | Freed |
|---|---|
| `known_agents` cut from 160,912 to the 15,000 actually served | 127.1 MB |
| `full_registry_skipped_offsets` cleared, 8,759 dead entries | 2.7 MB |

The first was not really a cost. `SERVE_LIMIT` has been 15,000 for weeks, so
everything past the survivor window was stored, indexed and metered without
ever being served. The cut used the same rule `get_stored_agents` uses to
select survivors, so the served list is unchanged.

## The arithmetic

This is the whole problem, and it is not subtle:

| | |
|---|---|
| `get_stored_agents()` reads | 30,000 documents, needing ~250 to 300 MB |
| Service already resident | ~100 to 200 MB |
| Container cap | 512 Mi |

The read is what serves `/api/agents`: 30,000 documents are loaded so `_diversify()` can cluster them down to the ~15,600 served. There is no arrangement of those three numbers that fits. The instance is undersized for the workload, and every option below is a way of making the workload smaller than it should have to be.

## Why the subprocess approach does not help

This is the non-obvious part, and the one someone would otherwise try again.

`backend/scripts/refresh_subprocess.py` runs the refresh in a short-lived child process. The reasoning was sound as far as it went: CPython does not reliably return freed arenas to the OS, so the transient ratchets resident memory, and process exit is what gives it back. Measured locally it worked exactly as intended, the parent stayed at 78 to 93 MB across four cycles instead of climbing to 276 MB, a ~94% reduction in growth from baseline.

It still OOMs, because a container memory limit applies to the container, not to a process. The child is spawned inside the same container and its RSS counts against the same 512Mi cap. So when a refresh fires: parent at ~206 MB, plus a child allocating ~250 to 300 MB, exceeds the cap and the kernel kills the container.

Observed directly on 2026-09-05: the web service sat flat at 205 to 206 MB for a full hour, a refresh fired at 13:19, and it was OOM-killed at 13:25. Not a ratchet, a spike.

The local measurement was not wrong, it was incomplete: a laptop has no shared container budget, so the child's contribution was invisible there. A leaner parent does not help if the child is fat and they share a limit. Making the subprocess smaller does not fix this either; it is the same total.

What the change did achieve, and why it was kept: the resting baseline fell from a 422 MB plateau to ~105 to 206 MB. The failure mode changed from slow creep to sudden spike, and the interval between OOMs lengthened. That is a improvement, just not a solution.

## Options measured and rejected

Each was tested against live data rather than reasoned about:

- Deepen the projection. Exhausted. Every served field has a consumer, verified by grepping each field's identifier across every file in both apps plus the three backend consumers of `get_stored_agents()`. Only `_id` was free, worth about 5%.
- Lower the read cap from 30,000 to 25,000. Costs 14% of the catalogue (15,675 → 13,447 served) for no reliable memory improvement. The cap is binding, roughly 45% of removed read-docs become removed served agents, so this is not a free knob.
- Replace `_diversify()` with a MongoDB aggregation. Would serve 2,542 agents instead of 15,675, an 84% loss. `_diversify()` is not a group-by: its Union-Find splits large template buckets into many distinct clusters (one bucket splits into 1,299), which is exactly what stops distinct agents sharing a description template from being collapsed. A `$group` reintroduces the over-collapse the module exists to prevent, and connected components over three relation types is not expressible in the aggregation framework anyway.
- Stream the diversification in Python. Not attempted. Possible in principle via a two-pass approach that never holds all 30,000 at once, but it is a rewrite of clustering logic that has its own tuning history.

## Measured OOM rate, and what drives it

A poller sampled the Render API every 5 minutes from 2026-09-05 23:06 to
2026-09-06 16:27 UTC and recorded every OOM. Raw data:
[`docs/data/oom-events-2026-09.tsv`](https://github.com/sabaazdn73/Agents-Marketplace/blob/main/docs/data/oom-events-2026-09.tsv)
in the repository, since the docs viewer bundles markdown pages only and
cannot serve the raw file itself. 19 events
over 17.3 hours, 8 on the web service and 11 on the worker.

The window happens to contain a natural experiment. For about four hours
the `/api/agents` payload was accidentally doubled, from ~14.8MB to
28.9MB, by a change that raised the served agent count from 15,191 to
30,000 without anyone checking the resulting response size. The OOM rate
over that window separates cleanly:

| Period | Payload | Events | Rate |
|---|---|---|---|
| Normal operation | ~14.8 MB | 7 over 17.3 h | 0.40 / hour |
| 12:00-16:00 on 09-06 | 28.9 MB | 12 over 4 h | 3.00 / hour |

A 2x payload produced a 7.5x OOM rate, and the site moved from
auto-recovering restarts nobody noticed to failing to load with "Failed
to fetch". Serving reverted to 15,000 agents and the rate returned to
baseline.

Two things worth keeping from that:

- Response size, not just read size, is the binding constraint. The
  change was checked against peak RSS during the read, which looked fine
  at 294MB. The cached response body is what the web service holds and
  streams per request, and it was never measured. Both have to be.
- The tolerated rate is roughly 0.4/hour, not "occasional". That is
  the number to compare against if this is ever revisited, rather than an
  impression.

Monitoring was stopped after this was recorded. The condition is accepted
and stable, the rate is known, and a poller holding a live Render API
credential in memory to re-derive a number already written down here is
not a trade worth making.

## /api/agents was serving the whole catalogue to every visitor (2026-09-12)

The endpoint's only parameter was `force_refresh`. There was no chain
filter and no limit, so a caller could not ask for less than all 15,000
agents, and `AgentMarketplaceApp.web.jsx`, `AgentMarketplaceApp.mobile.jsx`
and `EcosystemGlobePage.jsx` all fetched it on load. Every visitor pulled
15.7MB. The globe's use of it was the starkest: it reduced all 15,000
records to `{category}` and counted them.

This is the same binding constraint the 2026-09-06 natural experiment
above identified, except that it was normal traffic rather than an
accident. Ten concurrent visitors was never an abuse scenario.

### Before

Render's own event log, the 40.5 hours to 2026-09-12 09:51 UTC:

| | |
|---|---|
| `server_failed` events | 22 |
| Of those `oomKilled` at 512Mi | 22, all of them |
| Rate | **0.54/hour**, one every 1.8 hours |

Higher than the 0.40/hour recorded on 2026-09-05, so the condition had
been getting worse rather than holding steady.

### What changed

`core/agents_index.py` replaced the single pre-encoded 15.7MB body with
one blob per agent plus compact index arrays. Filtering never decodes
anything and a page is a join of 24 small blobs. Filtering, sorting and
the tier-first ordering moved server-side, because a page cannot be cut
correctly until the filters have been applied.

Measured on the live payload:

| | Before | After |
|---|---|---|
| Marketplace first load | 15,748,096 bytes | 64,215 bytes |
| The agent list within that | 15,712,666 | 27,776 |
| Resident cache | 14.98 MB | 21.53 MB |

A 99.6% cut in transfer for 6.5MB more resident, which is 1.3% of the cap.
The resident rise is the per-agent object overhead plus the lowercase
search haystack, and it buys the ability to serve a page at all.

The legacy unparameterised call still returns everything for now, but
streams in chunks rather than handing the transport one 15.7MB write to
buffer per connection.

### After: the rate went up, not down

Measured 2026-09-14 07:51 UTC, 44.3 hours after the deploy.

| | Before | After |
|---|---|---|
| oomKilled events | 22 | 30 |
| Window (first to last) | 40.5 h | 42.3 h |
| Rate | 0.54/hour | **0.71/hour** |

Expected count at the old baseline over the same exposure was 23.9. The
observed count was 30. Every `server_failed` in the window was `oomKilled`;
none had any other cause, so nothing was substituted for the old failure
mode.

The count is a floor rather than a ceiling. Nine deploys landed in that
window and each one restarts the container at about 105MB, which suppresses
OOMs rather than causing them.

The payload reduction is real and still in place, verified live at the time
of measurement: a page is 28,107 bytes, facets is 1,010, against the old
15.7MB. That part did exactly what it was built to do. It did not help.

#### Why, from the memory trace

A 12-hour sample at 5-minute resolution shows a sawtooth, not a ratchet:

```
restart ~105MB  ->  cache fills, plateau ~240-250MB  ->  spike 380-485MB  ->  OOM
```

The cycle repeats roughly every two hours, which matches the event rate.

The plateau is the problem. This document previously recorded a resting
baseline of ~105 to 206MB. It is now ~240 to 250MB. The refresh spike did
not get bigger; it now starts from a floor 40 to 50MB higher and therefore
crosses 512Mi more often.

Four things in the pagination change raised that floor, and they were not
all foreseen:

- The index is 21.53MB resident against the old body's 14.98MB. This was
  measured before deploying and accepted as 1.3% of the cap. It is real but
  it is the smallest of the four.
- `_tier_join()` is new work on the refresh path: two MongoDB aggregations
  whose results are held live while the index is built.
- `AgentsIndex.from_encoded` holds the subprocess's 15.7MB body and the
  15.7MB of per-agent slices at the same time, roughly 31MB transient on
  exactly the path that was already spiking.
- The one that matters most, and the one that was missed. The old cache was
  a single 15.7MB `bytes`. CPython sends an allocation that large straight
  to `malloc`/`mmap` and returns it to the OS when it is freed. The new
  cache is 15,000 small `bytes` objects, which live in pymalloc arenas that
  CPython does not reliably hand back. Replacing the cache on each refresh
  therefore frees far less to the OS than it used to. This is the same
  arena behaviour already documented above as the reason the subprocess
  refresh exists, applied to a structure the subprocess does not cover.

So the change traded a per-request cost for a resident cost, on a service
whose binding constraint is resident memory. The per-request cost was
never what killed it.

#### What this implies

Response size was a genuine constraint, and the 2026-09-06 natural
experiment that established it was not wrong. It was not the binding one at
this payload size, and the other half of the problem recorded above, the
250 to 300MB spike when `get_stored_agents()` reads 30,000 documents for
`_diversify()`, is untouched and still sets the ceiling.

Options, in the order they are worth trying:

1. Store the page blobs as one `bytes` buffer plus an offset table, rather
   than 15,000 objects. Slicing stays O(1), the allocation goes back to one
   large block that the OS gets back, and the arena problem disappears.
2. Move `_tier_join()` off the refresh path, or cache its two maps with
   their own TTL so a refresh does not rebuild them.
3. Free the encoded body inside `from_encoded` as slices are taken, rather
   than holding both.
4. If the plateau still does not come down, revert the index and keep only
   the facets and by-id endpoints, which are the part that removed whole
   fetches rather than reshaping one.

Re-measuring needs no poller holding a live credential:

```
GET https://api.render.com/v1/services/srv-d9rl1tn10e5c738at05g/events?limit=100
GET https://api.render.com/v1/metrics/memory?resource=srv-d9rl1tn10e5c738at05g&resolutionSeconds=300
```

Count `server_failed` whose `details.reason.oomKilled` is set, split at the
deploy boundary, and read the plateau off the memory trace rather than the
peak.

## The answer

More memory. The instance is undersized for a 30,000-document clustering read, and every alternative trades away catalogue coverage or accepts rewrite risk to avoid paying for it. Deferred only because this project has a standing rule against paid infrastructure changes without an explicit decision.

Revisit when there is funding, or if the failure mode stops being tolerable, meaning the site stays down rather than auto-recovering, or the OOM rate rises materially above the rate observed on 2026-09-05.
