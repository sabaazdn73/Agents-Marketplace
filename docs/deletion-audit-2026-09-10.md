# Did the multicall chunk bug ever delete real agents?

Audit run 2026-09-10, after fixing the `no_endpoint` false positive in
`core/agent_health.py` (commit `57c66ad`). The fix note said the bug was
"never observed firing in production". That is not the same as confirming it
never did, so this checked.

**Answer: it did not. Zero wrongly-deleted agents found, with a 95% upper
bound of 1.5% of deletions.** The blocks that initially looked exactly like
the bug's fingerprint turned out to be agents our data source never indexed,
which we therefore never ingested and could not have deleted.

## The bug, and the window it could have fired in

When a `tokenURI` multicall chunk failed, its tokens dropped out of
`uri_by_token`, and every agent in that chunk still went through `_check_one`
with `uri=None`, which returns `no_endpoint` — the status the deletion policy
acts on. Up to `_TOKENURI_CHUNK` (200) agents per failure.

| Date | Event |
|---|---|
| 2026-08-21 | Chunking and the faulty `except` introduced (`d6d0d2d`) |
| 2026-09-03 | `no_endpoint` deletion enabled, plus a one-time sweep (`eaee887`) |
| 2026-09-05 | `DELETE_CHAIN_IDS` added, scoping deletion to BSC (`be960c6`) |
| 2026-09-10 | Fixed (`57c66ad`) |

The window is wider than "09-03 onward". The one-time sweep on 09-03 deleted
everything already carrying `no_endpoint`, so a chunk mis-marked any time back
to 08-21 would have been deleted then.

## There is no deletion record

Deletion is `col.delete_one({"_id": ...})` with no audit write. No collection
holds per-batch history, `known_agents` was cut and regenerated so it retains
no residue, and the 506 recorded skipped offsets cannot be mapped back to
token ids because those offsets are permanently HTTP 422 (past 8004scan's
10,000 offset cap). So the question had to be answered forensically.

## Method

BSC holds 154,695 agents spanning token ids 0–334,250, leaving 179,558 absent.
Absent is not the same as deleted: it is deleted plus never-ingested. The
separator is that the deletion policy only ever removes agents with **no**
endpoint, so a wrongly-deleted agent should still resolve a working endpoint
on chain today.

Gap-run structure first. Endpoint rate rises monotonically with run length:

| Gap run length | Absent ids | Share | Endpoint rate |
|---|---|---|---|
| 1–5 | 39,808 | 22.2% | 0.0% |
| 6–149 | 86,651 | 48.3% | 0.9% |
| 150–260 | 18,880 | 10.5% | 3.2% |
| 261–499 | 16,467 | 9.2% | 4.9% |
| ≥500 | 17,752 | 9.9% | 38.9% |

Control: 69.1% of surviving BSC agents have a usable endpoint. A wrongly
deleted 200-chunk should therefore look like ~69%, in runs near 200. The
150–260 bucket sits at 3.2%, so there is no chunk-shaped damage in aggregate.

Scanning every gap run of length ≥20 individually did surface 29 blocks with
high endpoint rates, including three that looked damning — 269417–269568 at
94.1%, 297145–297363 at 82.2%, 269758–269927 at 72.9% — contiguous,
chunk-sized, and flanked on both sides by agents checked in a single batch.

## What those blocks actually were

The neighbour-timestamp test could not separate the two explanations: batch
timestamps are coarse, and a never-ingested gap looks identical.

Querying the ingestion source settled it. `GET /api/v1/agents/56/{tokenId}`
returns a definitive 200 or 404 per agent (unlike the `?tokenId=` filter,
which is ignored and returns unrelated rows):

| Population | Known to 8004scan |
|---|---|
| Present in our store (control) | 30/30, 100% |
| Absent, random | 25/30, 83% |
| Absent, endpoint-rich blocks | 1/36, **3%** |

The endpoint-rich blocks are agents 8004scan never indexed. They exist on
chain with working endpoints, but they never entered our pipeline, so nothing
could have deleted them. They are a **source coverage gap**, not damage.

## The direct measurement

Sampling absent ids that 8004scan *does* know — agents we definitely ingested
and then deleted:

| Outcome | Count | Share |
|---|---|---|
| Genuinely no endpoint | 199 | 99.5% |
| Metadata unresolvable | 1 | 0.5% |
| **Had a live endpoint** | **0** | **0.0%** |

Zero in 200. By the rule of three, the 95% upper bound is 1.5% of deletions.
Against roughly 149,000 BSC deletions that bounds worst-case damage at ~2,200
agents, with a point estimate of zero.

Why it never fired is worth recording: `_multicall_tokenuris` goes through
`chain_rpc_post`, which tries the primary then a failover. A chunk fails only
if both endpoints fail within one call. That is rare, and it evidently never
coincided with a BSC analysis batch in the twenty days the bug was live.

## The real finding: a coverage gap worth closing

Separately from the bug, roughly **9,100 absent BSC agents have a live
service endpoint today**, concentrated in the blocks 8004scan never indexed.
These were never ours to lose, but they are real, working agents missing from
the marketplace.

They do not need 8004scan. The ERC-8004 registry is the authority, and
`tokenURI` resolves for every one of them, so they can be ingested straight
from chain. At roughly 0.76 KB per document that is about 7 MB against 55.1 MB
of headroom.
