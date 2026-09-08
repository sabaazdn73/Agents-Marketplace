# The 512Mi memory ceiling, and why it is being lived with

Both Render services (the web service and the background worker) are OOM-killed by the platform on a 512Mi container cap. As of 2026-09-05 this is a known, accepted condition, not an open bug. Render restarts automatically, the gap is seconds, and the marketplace stays up. This page records why the obvious fixes were rejected, so nobody re-derives it or retries something already measured and ruled out.

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

## The answer

More memory. The instance is undersized for a 30,000-document clustering read, and every alternative trades away catalogue coverage or accepts rewrite risk to avoid paying for it. Deferred only because this project has a standing rule against paid infrastructure changes without an explicit decision.

Revisit when there is funding, or if the failure mode stops being tolerable, meaning the site stays down rather than auto-recovering, or the OOM rate rises materially above the rate observed on 2026-09-05.
