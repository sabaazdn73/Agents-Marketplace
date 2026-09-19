# Hyperliquid Brain section: what it may claim

Status: specification, binding on the implementation of the Brain section in
`frontend/src/chainViews/HyperliquidView.jsx`.
Written 2026-09-17. Read-only on code; nothing here was implemented.

This document says what the persistence result licenses, what it forbids, and
which fields must travel beside every number the section renders. Every figure
below was recomputed from `hl_ws_buckets`, `hl_ws_coverage` and `hl_poll` on
2026-09-17 before being written down. Where a figure handed to me did not
reproduce, section 1 says so.

---

## 1. Verification of the figures behind the decision

### 1.1 The window

Primary window W1: 2026-09-16 14:00:00Z through 19:59:50Z, ten-second buckets,
2,160 bucket starts on the grid.

W1 is not one window selected from several. It is the only six-hour contiguous
stretch in the store where every watched address has a coverage row in every
bucket. From `hl_ws_coverage`, bucket starts present per hour:

| hour (UTC) | bucket starts | addresses with rows | addresses delivering |
|---|---|---|---|
| 2026-09-16 13 | 175 | 10 | 10 |
| 2026-09-16 14 to 19 | 360 each | 10 | 10 |
| 2026-09-16 20 | 299 | 10 | 10 |
| 2026-09-16 21, 22 | 0 | 0 | 0 |
| 2026-09-16 23 | 60 | 10 | 4 |
| 2026-09-17 00 to 02 | 0 | 0 | 0 |
| 2026-09-17 03 | 60 | 10 | 0 |
| 2026-09-17 04 | 57 | 10 | 0 |
| 2026-09-17 05 | 63 | 10 | 7 |

The collector ran before this, back to 2026-09-15 10:58:30Z in `hl_ws_buckets`,
but `hl_ws_coverage` begins 2026-09-16 13:27:20Z. Bucket rows from before that
timestamp carry no coverage row, so silence in them cannot be separated from a
dead subscription. Anything computed on the earlier data is supporting evidence
only, never a headline.

### 1.2 Usable buckets, nine addresses

A bucket is usable at 50 or more order updates. Over W1:

| address | usable buckets | mean bucket ratio |
|---|---|---|
| 0x1c1c270b573d55b68b3d14722b5d5d401511bed0 | 2,160 | 0.0305 |
| 0xfc667adba8d4837586078f4fdcdc29804337ca06 | 2,160 | 0.0029 |
| 0x399965e15d4e61ec3529cc98b7f7ebb93b733336 | 2,156 | 0.0057 |
| 0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00 | 2,156 | 0.0034 |
| 0xfc27136e42af1732ddc9ce2605ea9bff1b959d9d | 2,154 | 0.0011 |
| 0xbeccae9ffcb69e9d42a1d4e744abf8056149562d | 2,144 | 0.0030 |
| 0x7fdafde5cfb5465924316eced2d3715494c517d1 | 2,134 | 0.0166 |
| 0xf58b673c1633ccef0ac58263cdc95ed80f817fc7 | 2,089 | 0.9108 |
| 0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2 | 1,823 | 0.0027 |
| 0x3bcae23e8c380dab4732e9a159c0456f12d866f3 | 130 | (see 7.3) |

Nine addresses at 1,823 to 2,160 usable buckets. Reproduces exactly.

### 1.3 What reproduced

| claim as given | recomputed | verdict |
|---|---|---|
| lag-1 median +0.352 | +0.356 | reproduces |
| positive on all nine | 9 of 9 positive | reproduces |
| 9.5 to 26.9 standard errors | 9.5 to 27.0 | reproduces |
| denominator control +0.836 | +0.845 | reproduces |
| control higher than the ratio's | higher at 8 of 9; see 1.5 | reproduces with a caveat |
| runs test median z = -12.7 | -12.7, range -4.9 to -21.9, all nine negative | reproduces exactly |
| decay, nine lags | every lag within 0.007 of the given value | reproduces |
| REST polls overlapping | 1,479 of 4,160 at the analysis cutoff | reproduces in substance; see 1.6 |

Per-address lag-1, W1, within address, demeaned, contiguous pairs only:

| address | pairs | r1 | SE | z |
|---|---|---|---|---|
| 0xbeccae9f | 2,141 | +0.575 | 0.0216 | 26.6 |
| 0xf58b673c | 2,075 | +0.594 | 0.0220 | 27.0 |
| 0xfc667adb | 2,159 | +0.455 | 0.0215 | 21.2 |
| 0xfc27136e | 2,149 | +0.446 | 0.0216 | 20.7 |
| 0x7b7f72a2 | 1,804 | +0.356 | 0.0235 | 15.1 |
| 0xecb63caa | 2,154 | +0.347 | 0.0215 | 16.1 |
| 0x1c1c270b | 2,159 | +0.334 | 0.0215 | 15.5 |
| 0x7fdafde5 | 2,119 | +0.314 | 0.0217 | 14.4 |
| 0x399965e1 | 2,152 | +0.204 | 0.0216 | 9.5 |

Decay, median across the nine, with the smallest pair count at each lag:

| lag | 10s | 20s | 30s | 60s | 120s | 300s | 600s | 900s | 1800s |
|---|---|---|---|---|---|---|---|---|---|
| given | 0.352 | 0.310 | 0.273 | 0.214 | 0.209 | 0.166 | 0.109 | 0.075 | 0.068 |
| measured | 0.356 | 0.315 | 0.275 | 0.215 | 0.211 | 0.168 | 0.113 | 0.079 | 0.075 |
| min pairs | 1,804 | 1,795 | 1,792 | 1,789 | 1,773 | 1,738 | 1,690 | 1,634 | 1,463 |

The median stays positive at every lag out to 30 minutes. The REST reading of
-0.547 is not reproduced anywhere in this table, at any lag, on any of the nine
addresses.

### 1.4 The over-dispersion figure, and the convention it depends on

An earlier draft of this section said the figure "median 4.0x, range 1.6 to
265" did not reproduce. That was wrong, and the arithmetic is recorded here
because the wrong version was almost published.

It reproduces exactly under the convention it was computed with: the variance
of the per-bucket ratio over the mean across buckets of p(1-p)/n_i, where p is
the address's mean ratio over the window. Recomputed on the same nine
addresses:

| binomial floor convention | variance | median | range |
|---|---|---|---|
| mean over buckets of p(1-p)/n_i | population | 4.01 | 1.65 to 264.8 |
| mean over buckets of p(1-p)/n_i | sample | 4.01 | 1.65 to 264.9 |
| p(1-p) / mean(n_i) | population | 4.77 | 2.11 to 411.6 |

The first row is the figure as given, to the precision it was given at. The
difference between the rows is the point that survives: the multiple moves with
the convention, from 4.0 to 4.8 at the median and from 265 to 412 at the top,
and a reader cannot see which was used.

So the rule stands even though the objection did not. Every one of the nine
exceeds the binomial floor under every convention tried, the smallest by 1.65
times, so the section may say that the variation between buckets is larger than
counting noise alone would produce. If it shows a multiple at all, the sentence
must name the convention and give the range as well as the median. A bare
multiple is a number whose meaning the reader cannot recover.

### 1.5 The denominator control, stated precisely

Lag-1 of the per-bucket update count, same window, same usable-bucket rule:

0.886, 0.848, 0.756, 0.902, 0.923, 0.815, 0.695, 0.591, 0.845. Median 0.845.

At eight of the nine addresses the denominator is more persistent than the
ratio, so the ratio's persistence is not simply inherited from order volume.
At the ninth, 0xf58b673c, the two are effectively equal (0.591 against 0.594).
That address is the one whose rejection ratio averages 0.91, and it is the same
address that produces the largest over-dispersion, 264.8 times under the
convention in 1.4. An earlier draft of this paragraph said 308 times, which is
not a figure any convention in 1.4 produces and did not reproduce; corrected
2026-09-17. The control argument holds
at the median and at eight of nine addresses; it does not hold at that one, and
the section must not cite the control as though it were unanimous.

### 1.6 The REST overlap, and why the REST reading is set aside

At the analysis cutoff, meaning polls recorded before 2026-09-16 20:00:00Z:
1,479 of 4,160 polls have a window starting before the previous poll's window
for the same address ended. The figure given was 1,482 of 4,182, so the
difference is three polls and is consistent with the table having been read a
few minutes apart.

As of 2026-09-17 06:00Z the table holds 5,879 polls across 66 addresses, of
which 1,750 overlap the previous poll's window. That count matches the count of
polls with `gap_seconds < 0` exactly, 1,750 against 1,750, so the overlap is
already recorded in the schema rather than inferred here.

Consecutive per-poll rates therefore share records. Sharing records between
adjacent observations is mechanically mean reverting, which is the shape the
-0.547 had. The REST lag-1 figure is set aside as an artefact of overlapping
sampling windows and may not be cited in the section, in either direction.

### 1.7 A finding beyond the brief: direction replicates, magnitude does not

Two further windows, both weaker than W1 and both carrying the caveats in 1.1:

| window | addresses | usable buckets each | median r1 | positive |
|---|---|---|---|---|
| W1, 09-16 14:00 to 20:00 | 9 | 1,823 to 2,160 | +0.356 | 9 of 9 |
| W0, 09-15 12:00 to 18:00, no coverage rows | 7 | 163 to 1,210 | +0.261 | 6 of 7 |
| W2, 09-16 20:00 onward, partial coverage | 9 | 291 to 312 | +0.161 | 9 of 9 |

The sign replicates in all three. The magnitude does not: +0.356, +0.261,
+0.161. This is the single most important constraint in this document, and
section 2 is built on it. The direction is a finding. The coefficient is a
measurement of one afternoon, and there is no evidence it is a constant.

---

## 2. What the result licenses

### 2.1 The claim, stated at its full strength and no further

The Brain section may claim exactly this:

> Across the nine addresses measured, a ten-second window with an unusually high
> share of refused orders was more likely than chance to be followed by another
> one. The relationship weakens as the gap grows but is still visible thirty
> minutes out.

That is the whole of it. Three clauses are load-bearing:

- "across the nine addresses measured" bounds the population.
- "a ten-second window" is the unit. The finding is about buckets, not orders.
- "more likely than chance" is a statement about a distribution, not about an
  outcome.

### 2.2 The line that must be drawn

Autocorrelation of a rate is a statement about the conditional distribution of
the next bucket's rate. It is not a statement about any order. Even at the
largest coefficient measured, +0.594, an r1 of that size explains about 35
percent of the variance of the next bucket's rate and leaves the rest
unexplained, and that is variance of a rate over roughly a thousand orders, not
of a single order's fate. The step from "the rate persists" to "your order will
be refused" is not supported by anything in section 1 and is not licensed here.

The line, written so that a builder can apply it without rereading the
statistics: the section may describe the behaviour of a measured series. It may
not describe the future of anything the reader owns.

### 2.3 Approved wording

These sentences are cleared for use. They may be shortened; they may not be
strengthened.

- "Refusals arrive in stretches rather than at random."
- "When one ten-second window is refusing more than that address usually does,
  the next one tends to as well."
- "Measured over six hours on 2026-09-16. Nine addresses, 1,823 to 2,160
  ten-second windows each."
- "The effect fades with distance: strongest at ten seconds, about a third as
  strong at five minutes, still visible at thirty."
- "This was tested on order volume as well, and volume clusters more than the
  refusal share does, so the clustering is not only an effect of how busy the
  address is."
- "This describes the nine addresses on the live feed over one afternoon. It
  does not describe the venue, and it does not describe any single order."
- "Direction only. The size of the effect differed between the windows measured,
  from +0.16 to +0.36, so no number here should be read as a constant."

### 2.4 The verbal scale for the coefficient

Because the magnitude is not stable across windows (1.7), the section must not
print a bare coefficient as its headline. If a coefficient appears, it appears
with its window, its pair count and its standard error attached (section 5).
Where the section needs a word rather than a number, this is the mapping, and
it is a presentation convention rather than a finding:

| measured r1 in the shown window | permitted word |
|---|---|
| below 3 standard errors from zero | no word; the section withholds (section 6) |
| 3 SE or more, r1 below 0.20 | "slight" |
| 0.20 to 0.45 | "moderate" |
| above 0.45 | "strong" |

"Strong" describes the correlation, never the recommendation.

---

## 3. What it must not say

Each forbidden sentence is given with the reason it fails, so the reason travels
with the rule rather than being reconstructed later.

### 3.1 Forbidden: anything predicting a particular order

- "Your order is likely to be rejected right now."
- "There is a 35 percent chance your next post-only order is refused."
- "This address is currently rejecting, so expect a refusal."

Fails because: the measurement has a ten-second bucket of roughly a thousand
updates as its unit. Nothing in section 1 measures a single order conditional on
the previous bucket. The per-order claim is a different quantity that has not
been computed.

### 3.2 Forbidden: anything telling a reader to act or to wait

- "Wait for the rejection rate to fall before quoting."
- "Now is a good time to rest an order."
- "Avoid this market for the next thirty seconds."
- "Consider reducing size while refusals are elevated."

Fails because: an action claim needs a measured outcome of taking the action
against not taking it. No such comparison exists. It also needs the reader's
order to be the subject, and 3.1 already forbids that. "Consider" and "you may
wish to" do not soften this; the test is whether the sentence would change what
a reader does, not whether it is phrased as advice.

### 3.3 Forbidden: anything projecting a rate forward

- "Expected rejection rate over the next minute: 4.1 percent."
- "The rate should stay near this level for the next few minutes."
- "Elevated for the next 5 to 10 minutes."

Fails because: a forecast requires a fitted model with an out-of-sample error,
and none exists. An autocorrelation coefficient is not a forecast, and the
decay table is a description of past pairs rather than a horizon over which a
value holds.

### 3.4 Forbidden: anything generalising past the nine

- "Rejections cluster on Hyperliquid."
- "Market makers show persistent rejection behaviour."
- "This pattern holds across the venue."

Fails because: nine addresses, selected for volume, on one afternoon. Section 7
governs which addresses may be named at all.

### 3.5 Forbidden: anything that presents the coefficient as fixed

- "Rejection persistence: 0.35."
- "Persistence score: 35/100."
- Any gauge, dial, meter or single-number badge that shows the coefficient
  without its window, pair count and standard error beside it.

Fails because: section 1.7. Three windows gave +0.36, +0.26 and +0.16. A single
number stripped of its window asserts a stability that has not been measured.

### 3.6 Forbidden: the framing words

- "Predictive", "predicts", "forecast", "signal to trade on", "edge",
  "opportunity", "alpha", "the brain has learned", "the model expects".

Fails because: each imports a claim from 3.1 through 3.3 by connotation, and a
reader will act on the connotation. "Predictable" is forbidden even where the
sentence around it is defensible.

### 3.7 Forbidden: "coming soon" and its relatives

Carried over unchanged from the comment at `HyperliquidView.jsx:47`. The section
says what is known and what is not. It never says work is pending.

---

## 4. The denominator

### 4.1 The two quantities

| | REST rate | WebSocket ratio |
|---|---|---|
| numerator | post-only orders in a rejection status | `badAloPxRejected` updates |
| denominator | post-only orders | all order updates of any kind |
| source | `hl_order_counts`, filtered on `tif` | `hl_ws_buckets`, no tif available |
| served by | `service.address_detail`, `service.makers` | `service.address_series` |
| unit | orders over the poll's window | ten-second bucket |

The feed carries no `tif`, so the post-only denominator cannot be reconstructed
from it. `service.address_series` already states this in its return under
`coverage.denominator`, and `service.ws_coverage` already refuses to sum the two
coverages. This specification extends the same rule to the Brain section.

Over W1, across all ten watched addresses, the WebSocket denominator breaks down
as: `open` 41.77 percent, `canceled` 41.56 percent, `badAloPxRejected` 13.67
percent, `iocCancelRejected` 1.52 percent, `tooManyOpenOrdersRejected` 1.04
percent, `insufficientSpotBalanceRejected` 0.24 percent, `filled` 0.19 percent,
remainder below 0.03 percent each, on 43,701,395 updates. More than eight in ten
updates in that denominator are order placements and cancellations, so the
WebSocket ratio moves when an address changes how often it reposts, and the REST
rate does not.

### 4.2 May they appear on the same screen

Yes, and they already do: the tab's Workspace section lists both sources. The
rule is not separation by screen. The rule is that they are never presented as
two readings of one quantity.

Binding constraints:

1. Never adjacent in a way that invites comparison. No shared axis, no shared
   colour scale, no two-value row where they sit side by side, no delta between
   them, no arrow, no "up from", no ratio of one to the other.
2. Never summed, averaged or reconciled. Already the rule in
   `service.ws_coverage`; restated here because the Brain section is a new
   caller.
3. Each carries its denominator in the label, not in a tooltip, not in a
   footnote:
   - REST: "refused, as a share of post-only orders"
   - WebSocket: "refused, as a share of all order updates"
4. Different visual treatment. If the REST rate is a percentage badge, the
   WebSocket ratio is not a percentage badge. A reader scanning the page must be
   able to tell at a glance that they are different kinds of thing.
5. The Brain section computes on the WebSocket series only. The persistence
   result is a WebSocket result. It may not be described using the REST rate's
   words, and the REST rate's band names (`quoting`, `mixed`, `spraying`) may
   not be applied to a WebSocket ratio, because the band boundaries in
   `service.BANDS` were fitted on the post-only denominator.
6. If the section ever needs to say that one address rejects more than another,
   it uses the REST rate for that and says so, or it says nothing.

---

## 5. Coverage that must travel with any number

Any number the Brain section renders carries the following fields. They are
rendered, not merely available to the client; a field that exists only in the
response does not satisfy this.

Required with every displayed figure:

| field | type | W1 value | why it is required |
|---|---|---|---|
| `window_start` | ISO 8601 UTC | `2026-09-16T14:00:00Z` | the result is one window |
| `window_end` | ISO 8601 UTC | `2026-09-16T20:00:00Z` | as above |
| `window_hours` | number | 6 | states the span without arithmetic |
| `bucket_seconds` | int | 10 | the unit of the finding |
| `min_updates_per_bucket` | int | 50 | the usability rule |
| `addresses_measured` | int | 9 | the population |
| `addresses_watched` | int | 10 | so the excluded one is visible |
| `usable_buckets_min` | int | 1,823 | the thinnest address, not an average |
| `usable_buckets_max` | int | 2,160 | |
| `pairs_min` | int | 1,804 | pair count, not bucket count, sets the SE |
| `standard_error` | number | 0.0215 to 0.0235 per address | 1/sqrt(pairs) |
| `lag_seconds` | int | the lag being shown | the decay table is not one number |
| `denominator` | string | `all order updates, not post-only orders` | section 4 |
| `statistic` | string | `lag-k autocorrelation, within address, demeaned` | names the test |
| `excluded` | list of strings | see below | an absence is never a zero |
| `withheld_reason` | string or null | section 6 | same vocabulary as the REST side |

`standard_error` is per address and is 1/sqrt(pairs). Where a median across
addresses is shown, the section shows the range of the nine per-address standard
errors, not a single pooled figure, because no pooling was performed.

`excluded` for W1 holds exactly these, each phrased as a fact rather than a
count:

- `buckets under 50 updates, dropped before the pair was formed`
- `non-contiguous pairs, where the bucket 10s later has no usable row`
- `one watched address, 0x3bcae23e, with 130 usable buckets of 2,160`
- `all addresses outside the WebSocket watch set`
- `all bucket rows before 2026-09-16T13:27:20Z, which have no coverage row`

If any required field is unavailable for a figure, the figure is not shown. This
is the existing rule on the REST side and there is no reason for the Brain
section to hold a weaker one.

---

## 6. The staleness rule

### 6.1 Why the REST ceiling does not transfer

`MAX_RECORD_AGE_SECONDS` is 3,600 because the REST rate is a claim about what an
address is doing now, and an hour-old record cannot support that. The
persistence result is a claim about the shape of a series, not about the present
moment, so a one-hour ceiling would be the wrong instrument.

It is still one afternoon. Section 1.7 measured the coefficient in three windows
and got +0.36, +0.26 and +0.16, so the quantity is known to move between windows
even within two days.

### 6.2 The thresholds

Age is measured from `window_end`, not from the last poll and not from the last
bucket written. A collector that is running now says nothing about whether the
window the section is quoting is current, which is the lesson already recorded
above `MAX_RECORD_AGE_SECONDS` in `service.py`.

| age of `window_end` | state | what the section does |
|---|---|---|
| under 48 hours | current | shows the result, present tense, with section 5 fields |
| 48 hours to 14 days | dated | shows the result, past tense, with the window date in the first sentence; `withheld_reason` stays null but the section must carry the sentence in 6.3 |
| over 14 days | withheld | no coefficient, no decay curve, no verbal scale; `withheld_reason = "stale_window"` and the section shows only the sentence in 6.4 |

The 48-hour and 14-day boundaries are policy, not measurement. Nothing in the
data measures how long the coefficient survives; the only evidence on that
question is 1.7, which shows it moving inside two days. The implementation must
carry that admission in a comment beside the constants, in the manner of the
existing comments in `service.py`, so that a later reader does not mistake a
chosen boundary for a measured one.

### 6.3 The wording at "dated"

> Measured over six hours on 2026-09-16 and not re-measured since. What follows
> describes that window. Whether it still describes the feed today has not been
> tested.

### 6.4 The wording at "withheld"

> The clustering result came from one afternoon, 2026-09-16, and has not been
> re-measured since. It is old enough that presenting it as current would be
> presenting an assumption as a measurement, so nothing is shown here until the
> test is run again.

This is the same move the section makes today in its `waiting` case: it says
what is absent and why, and it does not say that work is pending.

### 6.5 The withheld vocabulary

The Brain section uses the same shape of vocabulary as the five reasons in
`service.py` (`not_tracked`, `no_polls_yet`, `too_few_polls`, `stale_data`,
`no_post_only_orders`), evaluated in a fixed order, most actionable first:

| reason | condition | analogue on the REST side |
|---|---|---|
| `not_watched` | the address was never in the WebSocket watch set | `not_tracked` |
| `no_buckets_yet` | watched, but no rows in `hl_ws_buckets` | `no_polls_yet` |
| `too_few_buckets` | fewer than 785 contiguous usable pairs | `too_few_polls` |
| `no_complete_window` | pairs exist but no contiguous window with a coverage row in every bucket | new; the WebSocket analogue of `gap_seconds` |
| `stale_window` | `window_end` older than 14 days | `stale_data` |
| `not_significant` | pairs sufficient but the coefficient is under 3 standard errors from zero | new |

The threshold of 785 pairs is the figure already recorded in the measurement
brief as what is needed to resolve a correlation of 0.1 at one standard error,
and every address in W1 clears it by more than a factor of two.

`not_significant` is the case the existing `no-signal` copy was written for. If
it ever fires for the whole set, the section reverts to that copy unchanged.
A null result keeps its place in this design; it does not get rewritten into a
weak positive.

---

## 7. Which addresses the section may speak about

### 7.1 The three populations

- 66 addresses have REST order counts in `hl_order_counts`.
- 31 addresses are in `hl_targets`.
- 12 addresses have ever produced a row in `hl_ws_buckets`.
- 10 addresses have coverage rows in `hl_ws_coverage`.
- 9 addresses qualify for the persistence result over W1.

So the section can speak about nine of sixty-six. Addresses with no WebSocket
data are the ordinary case, not the exception, and the design must treat them
that way rather than treating the nine as the default.

### 7.2 The rule per address

| situation | what the section shows |
|---|---|
| one of the nine, window current or dated | the result, with section 5 fields, subject to section 6 |
| the tenth, 0x3bcae23e | `too_few_buckets`, with its 130 usable buckets stated |
| watched, delivering, but under 785 pairs in any complete window | `too_few_buckets`, with the pair count stated |
| in `hl_targets` but never in the watch set | `not_watched` |
| REST data only, no WebSocket row | `not_watched` |
| unknown address | `not_watched` |

`not_watched` is not a defect of the address and must not be rendered as one. It
is a statement about the collector: the exchange permits a bounded number of
subscriptions from one connection point, ten were used, and the other
fifty-six addresses were never listened to. The copy says that, in those terms.
Suggested wording, which may be shortened:

> This address was not on the live feed. The clustering result covers the nine
> addresses that were, and says nothing about this one in either direction.

The phrase "in either direction" is required. Without it a reader reads absence
as a clean bill.

### 7.3 The tenth address

0x3bcae23e8c380dab4732e9a159c0456f12d866f3 was watched for all 2,160 buckets of
W1 and had a confirmed subscription in 2,152 of them. It delivered 18,510
updates, and reconnected 18 times in the same six hours.

That figure read 27,706 here until 2026-09-18, and the correction is worth
keeping rather than quietly making. `hl_ws_coverage.reconnects` is a RUNNING
per-address total: ws_collector.py writes `st["reconnects"]` into every bucket
row and never resets it, so the column holds the count so far and not the count
in that bucket. Summing it over 2,160 rows counts the same reconnects two
thousand times over. The number in the window is the difference between the
first and last rows, 1 to 19, which is 18. The next worst address in W1
reconnected twice.

The corrected figure does not change the conclusion of this section, which is
that the address is excluded for thinness. It changes what the section implied
about the feed: 27,706 reconnects in six hours would have meant a socket
failing roughly every four seconds, and nothing else in section 7 is consistent
with that.
Only 130 of its buckets reached 50 updates, giving 29 contiguous pairs, so no
coefficient may be computed for it and none was.

It is excluded for thinness, not for being uninteresting, and the section must
not quietly drop it to make the set read as ten of ten. It appears with
`too_few_buckets` and its bucket count, in the same list as the nine.

### 7.4 No aggregate across addresses

The section may show the median of the nine per-address coefficients, labelled
as a median of nine, and the per-address values. It may not pool the nine into a
single series and compute one coefficient on it, because the addresses have mean
ratios spanning 0.0011 to 0.9108 and a pooled demeaning would mix between-address
variation into a within-address statistic. Every coefficient in this
specification is within address, and that phrase belongs in the `statistic`
field of section 5.

---

## 8. Acceptance checklist

The Brain section is ready to ship when all of these hold. Any one failing is a
blocker.

1. No sentence in the section names the reader's order, the reader's timing, or
   the reader's position. Check against 3.1 and 3.2 word by word.
2. No forbidden framing word from 3.6 appears anywhere in the section,
   including in alt text, tooltips and aria labels.
3. Every displayed figure renders all sixteen fields of section 5, visibly.
4. The window dates appear in the first sentence a reader sees, not in a
   tooltip.
5. The WebSocket denominator is labelled at every point of use, and no REST
   figure shares a row, axis or scale with a WebSocket figure.
6. `BRAIN_STATE` gains the `ready` case without removing `no-signal`. The
   negative-result copy stays in the file.
7. The staleness thresholds exist as named constants with a comment saying they
   are policy rather than measurement.
8. An address with no WebSocket data renders `not_watched` copy that includes
   "in either direction", and never renders a zero, a dash, or an empty state
   that could be read as a low rate.
9. The tenth address appears with its 130 usable buckets and is not hidden.
10. The tab's existing footer caveat is unchanged and still visible below the
    section: this tab measures whether orders reach the book, and a low
    rejection rate is not a recommendation.

---

## 9. Reproduction

The analysis behind section 1 reads `hl_ws_buckets`, `hl_ws_coverage` and
`hl_poll` through `core.hyperliquid.store.connect()`, with the DSN built by
`core.cockroach.build_dsn()` from `COCKROACH_DATABASE_URL` in `backend/.env`.

Definitions used, so that a re-run can match:

- bucket ratio: `sum(n) FILTER (status = 'badAloPxRejected') / sum(n)` per
  `(address, bucket_start)`.
- usable bucket: `sum(n) >= 50`.
- lag-k autocorrelation: within address, demeaned on the usable buckets of the
  window, numerator over pairs whose two buckets are exactly `10k` seconds apart
  and both usable, denominator the variance of all usable buckets in the window.
- standard error: `1/sqrt(pairs)`.
- runs test: on the above-or-below-median sign sequence of the usable buckets in
  time order, buckets exactly at the median dropped, normal approximation.

---

## 10. What the implementation decided that this document did not

Written 2026-09-17, when the section stopped being a specification and started
being served. The endpoint is `brain()` in `backend/core/hyperliquid/brain.py`,
reached through `service.brain()` behind a thirty-minute cache and returned as
the `brain` key of `/api/hyperliquid/overview`. Nothing is stored: the window,
the coefficient, the decay rows and the per-address rows are recomputed from
`hl_ws_buckets` and `hl_ws_coverage` on a cache miss.

Four questions came up that this document did not answer, and the answers are
here rather than only in the code.

### 10.1 The window is chosen, not named

Section 1.1 names W1. The endpoint cannot, so it takes the most recent
hour-aligned stretch of six hours in which every bucket on the grid carries a
coverage row for the same number of addresses, and then checks that the
distinct addresses over the whole window equal that number, which is what
catches a swap the per-bucket count cannot see. Hour alignment is a choice: it
gives the window a name a reader can hold and stops it creeping by seconds
between requests. Today this selects exactly W1 and reproduces every figure in
section 1.

### 10.2 A decay row is measured at its own standard error

Section 2.3's approved wording says "still visible at thirty minutes" and
section 2.4 withholds the verbal scale below three standard errors. At 1,800
seconds those two rules disagree: the median is +0.075 and the thinnest address
has 1,463 pairs, so the error there is 0.0261 and the median stands at 2.85
standard errors, under the bar. Five of the nine addresses are indistinguishable
from zero at that lag and one is negative.

The withholding rule wins. Each decay row now carries its own `standard_error`,
its own `pairs_min` and the count of addresses clearing three standard errors at
that lag; the heading names the longest gap whose median clears the bar, which
today is fifteen minutes; and the thirty-minute row is still shown, marked as
under three standard errors. A row that is dropped reads as a zero, and this
document's first rule is that an absence is never a zero.

### 10.3 The staleness boundary needs a longer search than the boundary itself

Section 6.4 requires a withheld result to name its window and say it is too old.
That is only possible if the search can still find the window, so the lookback
is sixty days and the withholding boundary stays at fourteen. Bounding both at
fourteen would have made the withheld state unreachable: the endpoint would
return nothing, and the reader would be told no window was measured, which reads
as an outage and loses the date.

### 10.4 "Never listened to" is counted over all time

The sentence about the addresses the section says nothing about is an all-time
claim, so both sides of it are counted over all time: tracked addresses in
`hl_order_counts`, minus every address that has ever appeared in
`hl_ws_coverage` or `hl_ws_buckets`. Subtracting this window's watch set instead
gave 56 where the answer is 53, and reported three addresses that were listened
to earlier as ones that never were.

### 10.5 Resolved 2026-09-19, and it did not resolve itself

This section said `magnitude_range` was absent because only one complete
window existed, and that it would resolve when the collector completed a
second six-hour stretch. The collector completed a second and a third. The
comparison still did not appear, for a reason that had nothing to do with the
data.

The budget was a single 9 second allowance measured from the start of the
whole computation, with the headline window computed first and never cut. The
headline work alone takes 9.4 to 10.4 seconds on this cluster, so the budget
was spent before the comparison was reached. Four warm calls returned three
windows and the first cold call returned none, which is the shape the web
service sees after every deploy and every idle recycle. The comparison now
has a budget of its own measured from when it starts, under a total ceiling,
and closed-window medians are cached because a closed window cannot change.

The number, measured 2026-09-19 over three complete windows:

| Window | median r1 | min pairs | approx SE | distance from zero |
|---|---|---|---|---|
| 09-16 14:00-20:00Z | +0.3559 | 129 | 0.0880 | 4.0 SE |
| 09-18 21:00-03:00Z | +0.1748 | 558 | 0.0423 | 4.1 SE |
| 09-19 03:00-09:00Z | +0.1179 | 590 | 0.0412 | 2.9 SE |

**The sign replicates and the magnitude does not,** which is what section 1.7
predicted and is now measured rather than asserted. All three are positive and
each is at least 2.9 standard errors from zero. The range spans a factor of
3.0, far outside what those standard errors absorb.

Read the first window carefully before quoting it. It has 129 minimum pairs
against 558 and 590, so its standard error is more than double the others, and
it produced the largest coefficient. A noisy first measurement giving the
biggest number and settling lower as the sample improves is regression to the
mean. The two well-sampled windows agree far better with each other than
either does with the first, so +0.3559 is best described as the least precise
of the three rather than as contradicted.

### 10.6 Why the oldest window is never evicted

The comparison used to read `windows[1:MAX_MAGNITUDE_WINDOWS]` over a
newest-first list, so a fourth complete window would have pushed out the
oldest. Verified against the three windows above: under that rule the
published range narrows from 3.0x to 1.5x the moment a fourth ordinary window
arrives, with nothing having happened on the venue, and the page reports a
steadier coefficient because it has forgotten the evidence of instability.

A window that is the only evidence the magnitude moves is the one worth
keeping, and dropping it for being old inverts what the comparison is for. The
range is now taken over every window inside `LOOKBACK_DAYS`, and the only
pruning is of windows that have fallen out of that lookback. What is capped is
how many new windows are computed per call, which is a rate limit on work
rather than on what the comparison covers.

### 10.7 The collector was stopped on 2026-09-19

Three complete windows answered the question section 1.7 asks, where two were
needed. The worker is stopped rather than left running, because the collection
that would follow makes the published answer narrower rather than better
supported: every further window is drawn from ordinary conditions and can only
pull the range in. It is restarted when there is a new question, not to
accumulate more of the same.
