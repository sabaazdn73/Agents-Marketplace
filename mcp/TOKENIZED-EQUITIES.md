# tokenized_equities: one dataset, no new tools

Spec only. Nothing here is built, and nothing here changes the site, the
collectors or the existing API. It defines one Dataset descriptor to be
registered in `backend/mcp_server/registry.py`, the records it serves, the
collector behind it, and the key forms that reach them.

The six tools do not change: `tnega_catalogue`, `tnega_resolve`, `tnega_get`,
`tnega_list`, `tnega_summary`, `tnega_series`. No tool is added, no input
schema changes, and no handler signature changes. Section 6.1 explains why that
last clause had to be said out loud.

Fourth revision. Section 13 lists what changed. Three reviews are folded in.
The second measured the spec against `envelope.CEILINGS` and found the flagship
call was refused one hundred percent of the time; sections 3.2, 3.3 and 8.1 are
the result. The third is `docs/tokenized-equity-measurements.md`, a provenance
record written in parallel, which found that most of the figures this spec was
serving as measurements cannot be re-derived from anything in this repository.
Section 2.3 is the rule that follows, and it removed more from this spec than
either earlier review did.

---

## 0. The scope boundary, first, because everything else sits inside it

Information, plus unsigned transactions. Nothing in this surface executes
anything, holds anything, or recommends anything.

- No order is ever placed, signed, broadcast, relayed or queued.
- No key material exists in this process, and none is accepted as an argument.
- No custody. No pooled balance. No omnibus wallet. No approval held on a
  user's behalf.
- Nothing is phrased as a recommendation. No best, no safest, no score, no
  traffic light, no suggested size, no target.
- Buying on a user's behalf is out of scope entirely and has no partial form
  here. There is no argument, no field and no code path that is one step short
  of it.
- A route is never served against terms we have not read. This is a rule, not
  a preference, and it is why section 9.2 refuses rather than degrades.

The one thing that touches a transaction is an unsigned calldata object,
produced from stored pool state, returned to the caller, and forgotten. What
makes that safe is not the shape of the object. It is that the pen is in the
caller's hand: we never hold a key, we never see a signature, and we never
learn whether anything was sent. Section 9.6 says this instead of leaning on
the object looking incomplete, because the object does not look incomplete to
software, only to a person reading it.

`readOnlyHint: true` stays true on every tool. That claim is checked the way
`tools.py` already checks it: no handler, no dataset reader, and nothing they
dispatch to performs a write, a signature or a transaction.

---

## 1. What this measures, and why cost leads

A prior census reported two things that point in opposite directions: that the
wrappers agree on price within about twenty basis points across issuers, and
that the cost of reaching them flips by name and by size by up to five times.
Premium would then be a small number that is roughly the same wherever you
look, while cost to fill is the part a holder actually pays and the part
nothing surveyed publishes.

THOSE TWO FIGURES ARE CLASS C AND ARE NOT SERVED. Neither is re-derivable from
this repository: no stored sample, no window, no count of observations, no
reference source named. `docs/tokenized-equity-measurements.md` records both in
its list of figures that cannot be re-derived. They are the reasoning that
chose the product, and section 2.3 is why reasoning is allowed to be the reason
for a design while being disallowed as a value in a response.

The design decision stands on its own without them. Premium is one number per
instrument with a licensing question attached and a window it is only
meaningful inside. Cost to fill is a figure this collector can compute from
pool state it reads itself, at a stated block, reproducibly, and it is the
figure a holder pays. Even if the spread between issuers turned out to be
narrower than the prior census reported, cost to fill would still be the
measurable one and premium would still be the encumbered one.

So the record leads with cost to fill at 1,000 USD and 10,000 USD, including
slippage against pool state, the pool fee, the protocol fee and gas. Premium is
secondary and carries its own window and sample count. This inverts an outside
suggestion that treated premium as the product, and it does so on the shape of
the two measurements rather than on the magnitude of a lost one.

---

## 2. Three issuers, kept apart, and how the field is populated

| Issuer field | Programme | Issuing entity | Jurisdiction |
|---|---|---|---|
| `xstocks` | xStocks | Backed Assets (JE) Limited | Jersey |
| `robinhood` | Robinhood Stock Tokens | Robinhood Assets (Jersey) Limited | Jersey |
| `bstocks` | bStocks | Btech Holdings Ltd | ADGM |

NVDAB and TSLAB are bStocks, Binance's programme, issued by Btech Holdings Ltd
in ADGM. They are not Backed's. Backed is the xStocks issuer. Any description
that calls a B-suffixed token a Backed bStock has merged two issuers with
different jurisdictions, different wrappers and different transfer controls.

Robinhood sells two products under one name and only one is on chain. The EU
Classic product is a non-transferable OTC derivative issued by Robinhood Europe
UAB. The instrument on Robinhood Chain is a Jersey debt security issued by
Robinhood Assets (Jersey) Limited. Section 7 is about establishing which, per
instrument, from a source rather than from the brand.

### 2.1 The population rule, which a closed enum does not supply on its own

Closing the enum stops `issuer` being derived from a symbol. It does not say
where the value comes from, and a closed enum with no population rule gets
filled from a hand-maintained list at best and from the symbol at worst.

`issuer` is populated from beacon identity, per chain. These tokens are beacon
proxies, and the beacon a proxy points at is structural: not settable by the
token, not spoofable by a symbol, readable without trusting any registry.

Measured on chain and recorded in `contracts/test/StockTokenMultiplier.t.sol`,
checked 2026-09-24:

| Chain | Beacon | Implementation | Issuer |
|---|---|---|---|
| 4663 | `0xe10b6f6b275de231345c20d14ab812db62151b00` | `0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2` | `robinhood` |
| 56 | `0x156d6dce9a4f6139a3406f1f021f1a4880de93a3` | `0xcfed6c4679297ea4889f8183bc057b4a86c64e46` | `bstocks` |

On chain 4663 the beacon was read against AAPL
(`0xaf3d76f1834a1d425780943c99ea8a608f8a93f9`), MSFT
(`0xe93237c50d904957cf27e7b1133b510c669c2e74`), SPY
(`0x117cc2133c37b721f49de2a7a74833232b3b4c0c`), META
(`0xc0d6457c16cc70d6790dd43521c899c87ce02f35`), TSM
(`0x58ffe4a942d3885baa22d7520691f611ef09e7aa`) and GME
(`0x1b0e319c6a659f002271b69db8a7df2f911c153e`), all six identical. On chain 56
it was read against NVDAB (`0x02fca66c1d1afb4e2a7884261eb00f63598a7436`) and
TSLAB (`0x5b1910eaad6450e50f816082aa078c41f10c292f`), which is the pair the
outside advice attributed to Backed.

Solana has no beacon. The xStocks population rule there is mint authority, and
until it is established the same way, `issuer` for a Solana instrument carries
`issuer_source.method: "unestablished"` and the instrument is not served.
Escalation E10.

A token whose beacon is not in the table is not assigned an issuer and is not
served. Guessing from the symbol is the failure this rule prevents, so it has
no fallback.

### 2.2 The venue contracts, named

The first two revisions used placeholders throughout, including for the control
contract whose count the spec said a reader could recheck without asking us,
which made that claim unverifiable. Reconciled and read on chain 4663,
2026-09-24:

All class A, read at blocks 71,414,089 to 71,485,925 and recorded with method
in `docs/tokenized-equity-measurements.md`.

| What | Address on chain 4663 | How it was established |
|---|---|---|
| Uniswap V4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | bytecode carries `extsload`, `unlock`, `swap`, `modifyLiquidity`, `setProtocolFee`; `extsload(bytes32(0))` answers; and over blocks 71,478,645 to 71,481,645 all 7,652 V4 `Swap` events on the chain came from this address and no other, which reads the singleton property rather than assuming it |
| V4 protocol fee controller | `0x6d0009504d129cf5002dba61d9ae8575aa79314c` | `protocolFeeController()` on the PoolManager |
| Uniswap V3 factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | `factory()` on the busiest V3 pool in the window, `0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca` |
| V3 fork factory, dominant | `0xece6ecd61177336ea6fb9b17937ac439d85ee20b` | emits `PoolCreated`; its pools emit the `Swap` shape carrying protocol-fee fields |
| V3 fork factory, second | `0x0ec554f0bff0be6c99d1e95c8015bb0950f6a2c7` | same |
| V3 fork factory, third | `0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865` | same |
| Algebra Integral | at least twelve factories, 199 pools | emits `Pool(address,address,address)`; carries stock pools including WETH against SPY and USDG against NVDA |
| USDG, a quote asset | `0x5fc5360d0400a0fd4f2af552add042d716f1d168` | `name()` and `symbol()` |
| WETH, a quote asset | `0x0bd7d308f8e1639fab988df18a8011f41eacad73` | `name()` and `symbol()` |

THE THIRD FAMILY IS NOT ALGEBRA, AND DISPATCH IS ON THE POOL AND NOT ON THE
FACTORY. Measured at block 71,528,495: Algebra Integral's swap signature
returns zero logs over two million blocks, while the three factories above emit
Uniswap V3's `PoolCreated` and their pools emit the `Swap` shape carrying
protocol-fee fields, which is the PancakeSwap V3 form. They are a V3 fork.

There is separately an Algebra-shaped family on this chain, emitting
`Pool(address,address,address)`, with 199 pools across at least twelve
factories, and it does carry stock pools.

A collector built to the previous revision of this spec would have written an
Algebra tick walker, pointed it at V3-fork pools, and never reached the pools
that actually need Algebra math. The two errors would have partly masked each
other: the walker would fail on pools it should have handled with V3
arithmetic, which reads as those pools being broken, while the Algebra pools
would simply be absent and raise nothing.

So the dispatch rule changes. FAMILY IS DETERMINED BY WHAT THE POOL ANSWERS,
not by which factory created it and not by a factory allow-list in
configuration. A fork of V3 answers the V3 surface and gets the V3 walker,
whatever it is called and whoever deployed it. The earlier guidance in this
spec to dispatch on factory was wrong, and a factory list is now a discovery
aid recorded in `venues[].factory` rather than the thing that decides the
math.

The consequence for the family enum is in section 4.2. There are at least four
walkers to write, not three, and one of them is the V3 walker pointed at a
second surface.

The V4 `protocolFeeController` being set is a chain fact and is what the
protocol-fee handling rests on. Its owner is `0x2bad8182c09f50c8318d769245bea52c32be46cd`,
which returns `0x` from `eth_getCode` at nonce 3, so it is an externally owned
account, and it is also what `owner()` on the PoolManager returns: one key owns
both. There is no timelock between that key and the controller. Whether the
controller imposes a delay internally was not established and is not claimed.

The canonical mainnet addresses do not transfer. `0x000000000004444c5dc75cB358380D2e3dE08A90`
returns `0x` from `eth_getCode` on this chain, and `0x1F98431c8aD98523631AE4a59f267346ea31F984`
holds a contract whose `owner()` and `feeAmountTickSpacing(3000)` both return
empty. The collector resolves from the table above, never from a constant
shared with other chains, and section 10.5 is the check that makes a wrong
address detectable rather than silent.

### 2.3 Provenance classes, and the rule that class C is not served

`docs/tokenized-equity-measurements.md` sorts every figure this work rests on
into four classes:

| Class | Meaning |
|---|---|
| A | Re-read on 2026-09-24 against chain 4663 with the method recorded. Anyone can take it again |
| B | Read in an earlier session and committed to a tracked file, so value and method both survive |
| C | Carried from a session whose working files are gone. No method, no script, no stored output |
| D | The issuer's own published text. Evidence about what the issuer says, and nothing else |

THE RULE: THIS DATASET SERVES CLASS A AND B FIGURES, AND FIGURES ITS OWN
COLLECTOR PRODUCES. IT DOES NOT SERVE CLASS C FIGURES AS VALUES.

This is not new severity. It is this project's existing rule, that a
measurement travels with its window and its sample size, applied to our own
numbers rather than only to the venues'. A figure with no window, no sample
count and no way to take it again fails that rule on its face, and serving it
inside an envelope whose whole purpose is to carry denominators would be the
surface contradicting itself in its own format.

What that removed when the rule was written: nineteen figures, listed in the
provenance record, including most of what the earlier revisions led with. A
later measurement pass converted eight of them to class A and settled the
denylist, so what stays unserved today is narrower: the concentration figures,
the Algebra dollar figures, the V3 token-id count, the 309 mints and 17 MSTRx,
the 0.511 instrument, and the two headline figures in section 1. Section 2.4
has the conversions.

What it does not remove is the reasoning those figures produced. A design may
be chosen because of a figure that can no longer be checked, as long as the
design does not then republish the figure as data. Section 1 is written that
way, and so is the concentration handling in 4.5, whose structural argument,
that a V4 position key carries a salt and a V3 one does not, is a property of
the two protocols and holds whatever the lost counts were.

Class D figures are served as what they are: the issuer's text, marked
`not_published` where the issuer is silent, never as a measurement.

A class C figure that someone re-measures moves to class A and becomes
servable. Several since have.

### 2.4 What the measurement pass converted, and what it deliberately did not

Re-derived between blocks 71,521,404 and 71,542,170, against the published
figures:

| Figure | Published | Re-derived | Class now |
|---|---|---|---|
| V4 pools, live | 11,340, 2,423 | 11,353, 2,428 | A |
| V3 pools, live | 437, 208 | 432, 202 | A |
| V4 pools at the protocol maximum | 2,094 of 2,423 | 2,097 of 2,428, read from the fee field in slot0 | A |
| Tickers priceable | 192 | 192, exact | A |
| V4-only tickers | 94 | 94, exact | A |
| Tickers with depth on both | 98 | 98, exact | A |
| Instruments behind the beacon | 204 | 204, from the proxies' own upgrade logs | A |

Nothing moved far enough to change a sentence anywhere in this document.

THE IDENTITY IS NOW MEASURED RATHER THAN INFERRED. The count of tickers with V3
depth and no V4 depth is zero. So all 94 single-venue tickers are V4 tickers,
and the 98 with depth on both is exactly the V3 live set. Earlier revisions
recovered that by reconciling two published numbers and hedged it as
arithmetic; it is now a read.

THE ALGEBRA COUNTS STAY CLASS C, DELIBERATELY, AND THIS IS THE USEFUL PART. The
42 and 36 were not re-derived, because the three factories they were taken
against are a V3 fork rather than Algebra. Re-counting those three under the
Algebra label would have produced a figure that looked measured, reproduced the
published number closely, and described the wrong family. A carried-forward
figure that says it cannot be checked is better than a fresh figure that is
confidently about something else.

---

## 3. The dataset descriptor

```python
datasets.append(Dataset(
    id="tokenized_equities",
    title="Tokenized equities: cost to fill",
    measures="what it costs to acquire a tokenized equity at a stated size, "
             "including slippage against pool state, pool fee, protocol fee "
             "and gas, across every venue family that quotes it",
    keys=["chain id/token address, as 4663/0x...",
          "solana/<mint>",
          "underlying/<ticker>, which lists every token version",
          "issuer/<id>, for the side-by-side issuer structure",
          "chain id/token address/for/wallet address, which adds the "
          "eligibility check and an unsigned route for that wallet"],
    example_filters={"chain_id": 4663},
    coverage=te_coverage,
    get=te_get,
    list=te_list,
    summary=te_summary,
    series=te_series,
    caveats=[ ... section 3.2, six of them ... ],
))
```

Four key forms, one `get` handler, one positional argument. Section 6.1.

The id diverges from the dotted convention every other dataset uses. It is the
owner's name and is kept. Escalation E1.

### 3.1 Coverage

```json
{
  "instruments": 0,
  "instruments_with_a_live_quote": 0,
  "underlyings": 0,
  "chains": [],
  "issuers": ["robinhood"],
  "sizes_quoted_usd": [1000, 10000],
  "quote_staleness_bound_seconds": 900,
  "first_poll": null,
  "last_poll": null,
  "buckets": 0,
  "scheduled_reads": 0,
  "answered_reads": 0,
  "unanswered_our_side": 0,
  "unanswered_venue_side": 0,
  "stale_block_reads": 0,
  "non_canonical_mints_excluded": 0,
  "partial": false
}
```

`scheduled_reads` against `answered_reads` is the denominator that matters.
`unanswered_our_side` is counted and named separately, because a shared public
RPC or gateway refusing us is a fact about our coverage and never evidence
about the venue. `stale_block_reads` is section 10.4.

The dated census figures are not here. They are a dataset-level aggregate and
they live in `tnega_summary`, section 3.4.

### 3.2 Caveats: seven, short, each naming the field that carries the detail

THE FIRST TWO REVISIONS PUT THE EXPLANATIONS HERE AND THE FLAGSHIP CALL WAS
REFUSED ON EVERY REQUEST. Measured against `envelope.CEILINGS`: fifteen caveats
encoded to 5,351 bytes, the coverage block to 531, the instrument record to
4,494 and the route object to 2,852. That is 10,530 bytes without a route and
13,381 with one, against a `tnega_get` ceiling of 8,192.
`envelope.enforce_ceiling` trims only when `value` is a list, and an instrument
record is a dict, so it does not trim: it refuses with `response_too_large`.
`tnega_get` on this dataset would have failed one hundred percent of the time,
before a single byte of calldata.

For comparison, `agents.index` carries 3,066 bytes of caveats over a record of
about 1.2 KB. This dataset had the largest caveat block in the registry
attached to the largest record in the registry.

The fix is not shorter sentences. It is that an explanation belongs in a named
field on the record, where a reader can find it beside the number it qualifies,
and a caveat belongs in the caveat list only when it changes how a number is
read and has no field of its own. `method`, `basis`,
`shares_per_token_convention` and `unestablished_source` already exist for
exactly that.

So, seven:

1. "Cost to fill leads and premium is secondary. Every figure here is computed
   by this collector from pool state at a stated block; figures from earlier
   sessions that cannot be re-derived are not served at all. See
   cost_to_fill.method and coverage.sizes_quoted_usd."

2. "issuer is read from beacon identity, never from the symbol, because symbol
   does not identify these assets: non-canonical Solana mints reuse xStocks
   tickers verbatim, including ones calling themselves MSTRx. See
   issuer_source, canonical, and coverage.non_canonical_mints_excluded for the
   count this collector found itself."

3. "Transfer control is stated per venue and never across venues. On Robinhood
   Chain it is a denylist, measured with controls, gated by isBlocked on the
   beacon rather than on the token. It describes the instrument: this surface
   never evaluates your address against it. See transfer_control."

4. "One token is not one share, and two different multipliers apply:
   shares_per_token is the unit ratio fixed at issue, ui_multiplier is ERC-8056
   display scaling that moves with dividends. Thirteen tokens read across two
   chains sit between 1.0 and 1.0018, so ignoring ui_multiplier costs up to
   about 17 basis points on those. These are total-return wrappers, so no yield
   is served. See per_share_price_usd, which is already corrected."

5. "Figures are precomputed on a fifteen-minute cycle and the record begins
   when collection began, because no backfill exists. See quote_age_seconds,
   coverage.scheduled_reads and coverage.first_poll."

6. "Side by side, never ranked: no safest, no score, no ordering. Nothing here
   is advice and nothing here is an execution path."

7. "Venue family comes from what a pool answers, never from its factory: one of
   the families here is a V3 fork that takes V3 math. Measured, not inferred:
   no ticker has V3 depth without V4 depth, so every single-venue ticker is a
   V4 ticker. See venues[].family and venues[].walker."

Measured as written, these encode to 1,915 bytes.

### 3.3 The ceiling arithmetic, and the self-check that keeps it true

Per response, encoded, measured rather than estimated:

| | `tnega_get` instrument | `tnega_get` route form | `tnega_series` | `tnega_list`, 25 rows |
|---|---|---|---|---|
| caveats | 1,915 | 1,915 | 1,915 | 1,915 |
| coverage | 531 | 531 | ~700 with legend | 531 |
| envelope | 154 | 154 | 154 | 154 |
| value | ~4,400 | ~3,900 | 118 points at 115 | 25 rows at 204 |
| total | ~7,000 | ~6,500 | ~16,339 | ~7,700 |
| ceiling | 8,192 | 8,192 | 16,384 | 32,768 |

Three changes got the instrument record from 4,494 to about 4,400 while also
absorbing the text that left the caveats:

- `issuer_structure` moves out of the instrument record to its own key,
  `issuer/<id>`. It is a per-issuer fact that was being repeated on every
  instrument, and it is about 900 bytes.
- The dated census figures move to `tnega_summary`, where a dataset-level
  aggregate belongs.
- The wallet key form returns a route record rather than the instrument record
  plus a route. Section 9.1.

THE SELF-CHECK IS THE PART THAT LASTS. `scripts/mcp_selfcheck.py` gains an
assertion that, for every registered dataset, the encoded caveat block plus a
representative record plus coverage plus the envelope fits that tool's ceiling,
with a stated margin. A dataset that cannot meet it does not register. This is
the section 4 rule of DESIGN applied to the response as a whole: the ceiling
already refuses oversize responses at run time, and this refuses them at
registration, where the person who wrote the caveat is still in the room.

The margin matters because the numbers above are close. The instrument record
sits at about 85 percent of its ceiling, and a future field that adds 1,800
bytes takes it over. The assertion is what turns that from a production
incident into a failed check.

### 3.4 The census, served as an aggregate rather than as caveat text

`tnega_summary` returns counts and never a ranking, and it is where the dated
point-in-time figures live, because an aggregate is a thing with a measurement
date and a caveat that travels forever is not.

```json
{
  "matched": 0,
  "by_issuer": {"robinhood": 0},
  "by_chain": {"4663": 0},
  "best_venue_at_10k": {"uniswap_v4": 0, "uniswap_v3": 0, "algebra_integral": 0},
  "instruments_with_a_live_quote": 0,
  "cost_bands_at_10k": {"under_25bps": 0, "25_to_100bps": 0, "100_to_500bps": 0,
                        "over_500bps": 0, "not_fillable": 0},
  "premium_served_for": 0,
  "pools_tracked": {"uniswap_v4": 0, "uniswap_v3": 0, "algebra_integral": 0},
  "pools_with_live_liquidity": {"uniswap_v4": 0, "uniswap_v3": 0,
                                "algebra_integral": 0},
  "counted_at": "the most recent completed collector cycle",
  "prior_census": "Earlier pool counts, ticker splits and concentration "
                  "figures are not served here. They are class C in "
                  "docs/tokenized-equity-measurements.md: not re-derivable "
                  "from this repository. This aggregate counts only what this "
                  "collector has enumerated itself."
}
```

THE CENSUS BLOCK IS GONE. Earlier revisions served the pool counts, the ticker
splits, the protocol-fee count and the concentration figures here as a dated
aggregate. Dating them was the error: they were not measured on the date the
field claimed, and they cannot be measured again from anything in this
repository. Every count in this aggregate is now produced by this collector's
own enumeration, so it is empty until the collector has run and it grows from
there, which is the same discipline section 8 applies to the series.

One structural note that survived the cull because it is arithmetic rather than
measurement: in the prior census the best-venue count contained the
only-venue count, so every single-venue ticker was a V4 ticker. If a future
enumeration reproduces those shapes, the aggregate should say best of the
venues available and name the contained count, rather than printing two numbers
that a reader has to reconcile.

Cost bands rather than a sorted list of the cheapest instruments. A sorted list
is a recommendation wearing a table. The bands sum to `matched` the way
`_reconciled_categories` already forces category counts to, including
`not_fillable` so the sum does not lose the instruments that drained.

---

## 4. The instrument record

Key `<chain id>/<address>` or `solana/<mint>`. About 4,400 bytes encoded.

### 4.1 Identity

| Field | Type | Units | Absent means |
|---|---|---|---|
| `key` | string | the key as given | never absent |
| `chain_id` | integer or `"solana"` | chain id | never absent |
| `token_address` | string | checksummed address, or base58 mint | never absent |
| `symbol` | string | as the contract reports it | never absent, never identifying |
| `underlying_key` | string | `underlying/<ticker>` | `withheld_reason: not_covered` |
| `issuer` | enum | `xstocks`, `robinhood`, `bstocks` | the beacon is not in the section 2.1 table; the instrument is not served |
| `issuer_source` | object | beacon, implementation, block, date | never absent when `issuer` is present |
| `issuer_structure_key` | string | `issuer/<id>` | never absent |
| `canonical` | boolean | beacon on EVM, mint authority on Solana | never absent |
| `decimals` | integer | token decimals | never absent |

### 4.2 Cost to fill, the lead

```json
"cost_to_fill": [
  {
    "notional_usd": 1000,
    "side": "buy",
    "venue_family": "uniswap_v4",
    "pool": "0x...",
    "method": "tick_walk_against_pool_state",
    "enough_data": true,
    "filled_fraction": 1.0,
    "slippage_bps": 0.0,
    "pool_fee_bps": 0.0,
    "protocol_fee_bps": 0.0,
    "gas_usd": 0.0,
    "gas_bps": 0.0,
    "total_cost_bps": 0.0,
    "total_cost_usd": 0.0,
    "quoted_at_block": 0,
    "quote_age_seconds": 0,
    "staleness_bound_seconds": 900,
    "usd_reference": { "...": "section 4.2.1" },
    "alternatives": [{"venue_family": "uniswap_v3", "total_cost_bps": 0.0}]
  }
]
```

- `total_cost_bps` is basis points of the notional asked for and is the sum of
  `slippage_bps`, `pool_fee_bps`, `protocol_fee_bps` and `gas_bps`. All four
  are always present alongside it.
- `quote_age_seconds` and `staleness_bound_seconds` are on the quote, not only
  on the route. Everything here is precomputed, so age is a property of every
  figure. Past the bound the entry is withheld rather than served stale.
- `protocol_fee_bps` is read from the pool, not assumed, and the V4
  `protocolFeeController` in section 2.2 is what makes it a chain fact rather
  than a claim.
- `enough_data: false` IS THE THIN-POOL ANSWER, NOT A WITHHELD REASON. The
  first two revisions gave a thin pool both `fillable: false` and
  `withheld_reason: no_matches`, while the prose said a drained walk is a
  measurement and not an absence. It cannot be both. A tick walk that ran
  correctly and did not reach the notional is a measurement, so it carries
  `enough_data: false` with `filled_fraction`, and `total_cost_bps` is null.
  `enough_data` is the established pattern in
  `core/hyperliquid/service.py` and appeared nowhere in the earlier drafts.
  `withheld_reason` on a quote entry is reserved for a read that did not
  happen.
- `pool_fee_bps` MUST CHECK THE DYNAMIC FEE FLAG BEFORE READING A FEE. Of 439
  V4 pools initialized over blocks 71,444,904 to 71,484,904 on chain 4663, 131
  carry the dynamic fee flag `0x800000` in the `Initialize` event's fee word. A
  cost engine that reads that word as a static fee reads 8,388,608 hundredths
  of a basis point, which is 838 percent, and either produces a nonsense cost
  or silently drops the pool. A flagged pool has its fee resolved from pool
  state at the quoted block, and where it cannot be, the quote carries
  `enough_data: false` rather than a fee that is a flag.
- `family` IS DETERMINED BY THE POOL'S OWN FUNCTION AND EVENT SURFACE, never by
  its factory. `walker` names the arithmetic, and the two are not one to one: a
  V3 fork is its own family and takes the V3 walker. Four families, three
  walkers. A pool whose surface matches nothing known is recorded with
  `family: "unknown"` and quoted by nobody, rather than being handed to the
  nearest walker.
- `method` carries the explanation that used to be a caveat. This is not
  `walkBook`. `walkBook` in `extension/paperSim.js` walks the discrete levels
  of a Hyperliquid order book. These venues are AMMs. The V3 walker walks
  initialised ticks against liquidity and serves both Uniswap V3 and the V3
  fork; the Algebra walker is its own arithmetic; and V4 reads pool state from
  the singleton at `0x8366a39cc670b4001a1121b8f6a443a643e40951` through
  `extsload` before walking. Four families, three walkers, dispatched on what
  the pool answers.

### 4.2.1 Every USD figure names its reference, because there are three

An AMM gives a token price against a quote token, not a USD price. `gas_usd`,
`token_price_usd`, `per_share_price_usd`, `total_cost_usd` and the very idea of
a 1,000 USD notional rest on references the pool does not contain, and there
are three:

1. The quote token's USD value.
2. The gas token's USD value. Gas on Robinhood Chain is denominated in ETH, so
   this is a separate source from the quote token's wherever the quote token is
   not ETH.
3. The underlying share's reference price, which is the premium input only.

The first two attach to the lead field. The third attaches to the secondary
one. The first revision escalated only the third, which put the sourcing
question on the field we had decided was not the product and left it off the
field that is.

```json
"usd_reference": {
  "quote_token": {"symbol": "USDC", "source": "named", "price_usd": 1.0,
                  "read_at": "2026-09-24T00:00:00Z"},
  "gas_token": {"symbol": "ETH", "source": "named", "price_usd": 0.0,
                "read_at": "2026-09-24T00:00:00Z"},
  "withheld_reason": null
}
```

If either source is unavailable the USD fields are withheld and the basis-point
fields are still served, because `slippage_bps`, `pool_fee_bps` and
`protocol_fee_bps` are ratios inside the pool and need no USD reference.
`gas_bps` and `total_cost_bps` do, and are withheld with it. Escalation E3.

### 4.2.2 Precomputed, with no request-time chain read at all

Stated as a decision rather than left implicit.

Every figure in this surface is precomputed by the collector and read from the
store. No tool call walks a tick, reads a pool, or spends an RPC request on a
caller's behalf. The count of request-time chain reads is zero, and after the
caller-facing check was removed from section 9.2 it is zero because there is no
per-caller question left to ask rather than because one was carefully avoided.

The reason is DESIGN section 6, which already holds back
`core/universal_search.py`'s live-lookup path for exactly this: it calls out
per miss on a shared per-IP quota, and behind an unauthenticated MCP endpoint
that is a free proxy to someone else's rate budget. A caller-supplied wallet
triggering a chain read is that same shape with the caller choosing the target,
which is worse. The first two revisions kept one such path and called it
narrow; the third mirrored it into the store; it is now gone entirely.

The cost of precomputing: every figure is up to one cycle old, and
`quote_age_seconds` says how old. Section 10.6 shows the cycle fits.

### 4.2.3 The sizes are fixed at two, by design

`notional_usd` is not a caller-supplied argument. The sizes are 1,000 and
10,000 USD, both sides, named in `coverage.sizes_quoted_usd` so a caller asking
for another size learns it is a design limit and not a gap.

A caller-supplied size is a computation parameter, not a filter. Accepting
arbitrary sizes would either make every call a request-time tick walk, which
4.2.2 refuses, or require precomputing a curve.

The cost, because it is capability and not only storage: a caller asking about
250,000 USD gets nothing. That is where the venue flip bites and where the
Algebra pools drain. Our own census measured the flip at one million, which the
served sizes do not reach, so the dataset publishes a finding it will not let a
caller reproduce. Escalation E5.

### 4.3 Premium

```json
"premium": {
  "value_bps": 0.0,
  "window": "2026-09-24T13:30Z to 2026-09-24T20:00Z",
  "samples": 0,
  "underlying_market_state": "open",
  "reference_source": "string naming the price used",
  "withheld_reason": null
}
```

Never travels without `window`, `samples` and `underlying_market_state`.
Whether it is served at all is part of escalation E3.

### 4.4 Two multipliers, which are different quantities

| Field | Type | Units | Absent means |
|---|---|---|---|
| `shares_per_token` | number | shares per whole token | `read_failed`, never defaulted to 1 |
| `shares_per_token_source` | enum | `issuer_publication`, `on_chain` | as above |
| `shares_per_token_convention` | string | how this issuer applies it on this chain | `not_published` |
| `ui_multiplier` | number | ERC-8056 scaled UI multiplier, 18 decimals | `read_failed` |
| `new_ui_multiplier` | number | the scheduled next value | no change is scheduled |
| `effective_at` | timestamp | when the next value takes effect | no change is scheduled |
| `ui_multiplier_read_at_block` | integer | block of the read | never absent when the value is |
| `per_share_price_usd` | number | USD per underlying share, corrected | withheld with `shares_per_token` or the USD reference |
| `token_price_usd` | number | USD per whole token | withheld with the USD reference |
| `total_return` | boolean | always true here | never absent |
| `distributions.paid_to_holder` | boolean | false | never absent |
| `distributions.mechanism` | string | reinvested into the multiplier, net of withholding | `not_published` |
| `distributions.withholding_rate_bps` | number | basis points withheld at source | `not_published` |

`shares_per_token` is the unit ratio fixed at issue. It is the one that makes a
correction matter, and it is served pre-corrected in `per_share_price_usd` for
that reason rather than because of any one instrument's value.

`ui_multiplier` is ERC-8056 display scaling and moves with dividends. Class A,
read on chain 4663 at block 71,485,925 across ten stock tokens, plus class B
for two bStocks on chain 56 already committed to `docs/limitations.md` and
`docs/integrations.md`. Thirteen tokens in all, spread from exactly 1.0 to
1.0017: SPY at 1.001717991187472, NVDA at 1.0007751591646306, NVDAB at
1.000778223752807865, and GME, MSTR, RBLX, TTWO and TSLAB at exactly 1.0. For
the two bStocks, `totalSupply * uiMultiplier / 1e18` equals `totalSupplyUI` to
the wei.

Implementation `0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2` carries five of the
seven scaled-UI selectors, including `uiMultiplier()`, `newUIMultiplier()` and
`effectiveAt()`. It does not carry `toUIAmount` or `fromUIAmount`, both of
which revert with empty data, the signature of no dispatch entry rather than a
rejected call. The setter exists and is role-gated.

THE FACTOR-OF-TWO CLAIM IS WITHDRAWN. Earlier revisions said one instrument
sits at `shares_per_token: 0.511` and that a ratio built without the correction
is wrong by up to a factor of two. That instrument is not named in any
revision, is not in this repository, and no read of it survives: class C, not
re-derivable. What is supported, at a much smaller magnitude, is that thirteen
tokens read between 1.0 and 1.0017, so ignoring `ui_multiplier` costs up to
about 17 basis points on those rather than a factor of two.

The design conclusion is unchanged and does not depend on the withdrawn number.
Thirteen instruments carrying a multiplier that is not 1.0, on a field that
exists at all, is sufficient reason to serve `per_share_price_usd` corrected
centrally rather than leave every caller to apply it. A correct conclusion
resting on a wrong number is still a conclusion that has to be re-derived, and
this is the re-derivation.

`effective_at` earns its place in a precomputed record specifically: a non-zero
value is a scheduled change at a known future timestamp, so the collector can
invalidate at that timestamp instead of waiting to notice drift. It is the only
expiry in this record known in advance rather than bounded by the cycle.

No yield field exists anywhere in this record.

### 4.5 Transfer control, venues, concentration

```json
"transfer_control": {
  "model": "denylist",
  "established": "measured",
  "gate": {"contract": "0xe10b6f6b275de231345c20d14ab812db62151b00",
           "where": "the beacon, not the token and not a contract the token "
                    "points at",
           "function": "isBlocked"},
  "population": {"blocked_events": 246, "distinct_addresses_blocked": 177,
                 "unblocked_events": 4, "distinct_addresses_unblocked": 2,
                 "currently_denied": 175},
  "controls": {"denied_address_transfer": "reverts with the typed Blocked "
                                          "error naming that address",
               "never_used_address_transfer": "succeeds in the same pass",
               "further_controls": "three, each reverting with its expected "
                                   "typed error"},
  "ordinary_wallet_gated": false,
  "checked_at_block": 71528495
}
```

`model` is an enum: `denylist`, `allowlist`, `none`, `not_published`,
`unestablished`. IT IS SET PER VENUE AND NEVER ACROSS VENUES.

| Venue | `model` | Established how |
|---|---|---|
| Robinhood Chain | `denylist` | measured, with controls, as above |
| BSC bStocks | `denylist` | NOT an allowlist is measured with controls. Denylist itself is carried forward: the compliance surface exists and both bStock tokens expose a compliance call returning one shared contract carrying a compliance role, but no denied address was found in it |
| xStocks on Solana | `unestablished` | untested. No mint exists in this repository, and the result is not generalised from the other two |

The one-sentence claim that all three venues run a denylist is retired. It was a
generalisation over three programmes in three jurisdictions, and the measurement
pass shows the three are in three different states, one of which is untested.
The field is per venue so that the strongest claim any row makes is the one that
row can support.

THE GATE IS ON THE BEACON, which neither this spec nor the review predicted. It
is not on the token and not on a contract the token points at. The beacon's
fifteen-function dispatch table carries `implementation`, `upgradeTo`, `pause`,
`unpause`, `paused`, five access-control functions and `isBlocked`. Upgrade
beacon, access registry, global pause and denylist in one contract, which is
what section 4.6 said from the start and can now say as a read rather than as a
characterisation.

THIS IS A DESCRIBED PROPERTY OF THE INSTRUMENT AND THE CALLER APPLIES IT. This
surface does not evaluate anyone's address against it, and section 9.2 has no
step that could. We serve what the instrument does; deciding what that means
for a particular address is the caller's, whether or not they ever ask us for a
route. The 175 denied addresses are a count in this record and are not a list
this surface publishes or matches against.

A result where the controls passed is discarded and the field stays
`unestablished`, because a control that does not fail did not test anything.

```json
"venues": [
  {"family": "uniswap_v4", "walker": "v4", "pool": "0x...", "fee_bps": 0,
   "protocol_fee_bps": 10, "liquidity": "0", "live": true, "read_via": "extsload"},
  {"family": "uniswap_v3", "walker": "v3", "pool": "0x...", "fee_bps": 0,
   "live": true, "factory": "0x..."},
  {"family": "v3_fork", "walker": "v3", "pool": "0x...", "fee_bps": 0,
   "live": true, "factory": "0xece6ecd61177336ea6fb9b17937ac439d85ee20b",
   "surface": "PoolCreated, Swap with protocol-fee fields"},
  {"family": "algebra_integral", "walker": "algebra", "pool": "0x...",
   "fee_bps": 0, "live": false, "surface": "Pool(address,address,address)"}
],
"best_venue_by_size": {"1000": "uniswap_v4", "10000": "uniswap_v3"}
```

`best_venue_by_size` exists as its own field because the flip is the finding. A
single `best_venue` would contradict the measurement.

```json
"liquidity_concentration": {
  "basis": "v4_position_salt",
  "basis_note": "The V4 position key includes a salt, so standing liquidity "
                "resolves per beneficial owner. Self-checked by summing the "
                "resolved positions to the pool's own liquidity value, exact "
                "to the wei; a pool that does not reconcile returns no figure.",
  "providers": 0,
  "largest_share_pct": 0.0,
  "measured_at": "2026-09-24T00:00:00Z",
  "withheld_reason": null
}
```

`basis` is required whenever a figure is present, and is one of:

- `v4_position_salt`, as above.
- `v3_positions_nft`: not served. Almost all V3 standing liquidity sits under
  the positions NFT and the V3 position key carries no salt, so resolving
  owners needs an index over every positions-NFT token id, which is a nightly
  job rather than a request-time read. The field is `null` with `withheld_reason:
  not_in_snapshot`. A V3 share of pool is not the same quantity as a V4 share
  of book and is never returned in the same field as though it were.

### 4.6 The issuer structure record, at its own key

`tnega_get` on `issuer/<id>`. Moved out of the instrument record in this
revision because it is a per-issuer fact that was being repeated on every
instrument and cost about 900 bytes each time.

```json
{
  "issuer": "robinhood",
  "legal_entity": "Robinhood Assets (Jersey) Limited",
  "jurisdiction": "Jersey",
  "wrapper": "debt security",
  "product_line": null,
  "terms_url": null,
  "redemption_path": "not_published",
  "bankruptcy_remoteness": "not_published",
  "upgrade_control": "beacon",
  "beacon": "0xe10b6f6b275de231345c20d14ab812db62151b00",
  "pause_control": "global",
  "denylist_scope": "venue wide",
  "control_contract": {
    "address": "0xe10b6f6b275de231345c20d14ab812db62151b00",
    "roles": ["upgrade beacon", "access control registry", "global pause",
              "venue wide denylist"],
    "roles_established_from": "a fifteen-function dispatch table carrying "
                              "implementation, upgradeTo, pause, unpause, "
                              "paused, five access-control functions and "
                              "isBlocked, with isBlocked called live",
    "tokens_under_it": 204,
    "tokens_established_from": "the proxies' own upgrade logs",
    "controlling_address": null,
    "controlling_address_withheld_reason": "unestablished_source",
    "controlling_address_note": "The beacon has no ownership getter and its "
                                "owner call reverts, so the controlling "
                                "address is not recoverable from the contract "
                                "surface at all. The address in circulation "
                                "comes from role-grant events: self-granted at "
                                "deployment to one address, then granted to a "
                                "second, both externally owned. A log records "
                                "that a grant happened. Only a full replay of "
                                "grants and revocations establishes who holds "
                                "a role now, and that replay has not been run."
  },
  "unestablished_source": { "...": "section 7" }
}
```

Side by side, never ranked. `not_published` means the issuer has not stated the
thing; it is distinct from `null` and from a withheld reason.

### 4.7 Withheld reasons: bare strings, from the vocabulary already in use

| Reason | Where it already lives | When here |
|---|---|---|
| `not_tracked` | `hyperliquid/service.py` | exists but is not in the rotation |
| `no_polls_yet` | `hyperliquid/service.py` | in the rotation, nothing collected yet |
| `too_few_polls` | `hyperliquid/service.py` | below the minimum sample, or the last cycle produced no quote |
| `read_failed` | `hyperliquid/corestate.py` | a read whose source is known returned nothing usable |
| `venue_rate_limited` | `hyperliquid/venuerole.py` | refused under the venue's own published rate policy |
| `gateway_rate_limited` | `core/agent_health.py` | a shared gateway or public RPC refused us over our own quota or client. Ours |
| `venue_unreachable` | `hyperliquid/venuerole.py` | unreachable without a refusal |
| `not_in_snapshot` | `core/extension/subject.py` | a nightly index has not produced it: the V3 concentration case |
| `not_covered` | `core/extension/subject.py` | outside what this dataset holds. A statement about us |
| `no_matches` | `mcp_server/tools.py` | a selection that matched nothing. NOT a drained tick walk, which is `enough_data: false` |
| `store_unavailable` | `core/extension/subject.py` | the collector store could not be read |
| `not_found` | `mcp_server/tools.py` | no record under this key |
| `no_observations` | `mcp_server/tools.py` | a series key with nothing in the window |
| `unestablished_source` | proposed, E12 | we have not established where this field's value comes from, or the source we have cannot be reproduced |

EVERY REASON IS A BARE STRING. Never an object, never a dict, never a tuple.
`tools.list_` does `str(page["withheld_reason"])`, so an object reaching that
line goes out over the wire as a Python dict repr, which is neither JSON nor
readable and which no client can match against a known value. The dataset's
readers return strings and the self-check asserts it.

### 4.7.1 The rate-limit split must survive to the surface

Section 10.3 stores `failure_side` and `failure_class`. The first revision then
mapped every refusal onto `venue_unreachable` at the surface, throwing the
distinction away in the one place a reader sees it and attributing our own
refusal to the venue. `core/agent_health.py` already separates
`gateway_rate_limited`, our quota, from causes belonging to the subject, and
its comment says a gateway outage reading as thousands of agents going quiet is
what the separation prevents.

- Refused over our own quota, concurrency or client identity:
  `gateway_rate_limited`, counted in `unanswered_our_side`.
- Refused under the venue's published rate policy: `venue_rate_limited`,
  counted in `unanswered_venue_side`. `venuerole.py` measured this precedent on
  2026-09-19: 25 calls with no pause returned 14 HTTP 429s.
- Unreachable without a refusal: `venue_unreachable`.

There is a live instance of the first case on the target chain. Robinhood
Chain's public RPC returns HTTP 403 by user agent while answering other clients
normally. That is our client being refused, not the chain being down, and under
the earlier mapping it would have been served as `venue_unreachable` on every
affected read. It is `gateway_rate_limited` with
`failure_class: "user_agent_refused"`, and the collector sets a user agent
rather than reporting the chain as unavailable.

---

## 5. tnega_resolve

Symbol does not identify these assets: non-canonical Solana mints reuse xStocks
tickers verbatim, including ones calling themselves MSTRx. The counts reported
earlier, 309 and 17, are class C and are not served; the collector's own
enumeration fills `coverage.non_canonical_mints_excluded`, and the structural
rule holds whatever that count turns out to be. So resolve returns the
underlying, and the underlying lists its tokens.

Three recognisers, all over stored data with no live lookup:

1. A company name or underlying ticker. Returns one candidate,
   `underlying/<ticker>`. One rather than many keeps this inside the 2KB
   ceiling and the five-candidate cap however many issuers wrap the name.
2. An EVM token address on a covered chain. Returns the instrument key, `why`
   naming the issuer and the beacon it was read from.
3. A Solana mint. Returns the instrument key. A non-canonical mint is still
   returned, with `why` saying it is not the canonical mint for this symbol and
   naming the one that is. Suppressing it would leave a caller holding one of
   one of them with no answer at all.

```json
"coverage": {"searched": "stored data only, no live lookup", "candidates": 1,
             "non_canonical_mints_sharing_this_symbol": 17, "partial": false}
```

`tnega_get` on `underlying/<ticker>` returns the underlying with a compact row
per token version: instrument key, issuer, chain, `shares_per_token`, best
venue at 10,000 USD and `total_cost_bps` at 10,000 USD. Non-canonical mints are
counted there and never listed as versions.

---

## 6. tnega_list, and the vocabulary rule applied in both directions

```json
{"key": "4663/0x...", "symbol": "NVDAX", "issuer": "robinhood", "chain_id": 4663,
 "best_venue_10k": "uniswap_v4", "cost_bps_10k": 0.0, "premium_bps": null,
 "quote_age_seconds": 0, "withheld_reason": null}
```

204 bytes a row against the 300 byte guidance, 10,686 bytes for a 25-row page
against a 32,768 ceiling.

`registry.py` states the rule in these words: a dataset should not be able to
widen the vocabulary the tools speak. The first revision cited that rule to
refuse an `issuer` filter, then two sections later added a `wallet` property to
`tnega_get`'s input schema and escalated it, which is the same widening with a
longer explanation.

Applied in both directions, using the mechanism the codebase already has:

- No `issuer` filter. Issuer selection goes through `search`, or through the
  underlying record.
- No `wallet` property. The wallet travels in the compound key,
  `4663/<token>/for/<wallet>`, the way `chains.agents` keys on
  `chain id/token id`, documented in `keys`.

### 6.1 Why the key form matters more than it looks: the handler

A schema property would not have worked, and this is the defect worth naming
because a build following the earlier spec literally would have shipped it
broken and silent.

`tools.get` calls the dataset reader like this:

```python
record = await call(d.get, key)
```

Positional, one argument. Adding `wallet` to `tnega_get`'s `inputSchema` adds a
property the handler never receives, so `unsigned_route` would simply never
appear, with no error anywhere. And `additionalProperties: false` would not have
caught it either: the server validates nothing against these schemas, so the
schema line is documentation. The contract that exists at run time is the
handler signature.

The compound key needs no handler change at all: the wallet arrives inside
`key`, which `te_get` parses the way `chain_agents_get` already parses
`"<chain id>/<token id>"`. That is now the strongest argument for the key form,
and neither earlier revision made it.

The self-check gains an assertion regardless: for each key form in a dataset's
`keys`, call `tnega_get` with an example of that form and assert the reader
received every segment. A key form that silently loses a segment fails
registration.

The cost of the key form, stated: a wallet address inside an id is less legible
than a named argument and reads as part of the entity's identity when it is
not. A caller who does not read `keys` will not discover the form. Escalation
E2 keeps the alternative in front of the owner, with the handler change and the
amended DESIGN wording it would require.

---

## 7. What is established, what is not, and what rests on each

### 7.1 terms() is established, and the earlier revisions were wrong to doubt it

The third revision marked `terms()` unestablished and shipped the route
disabled behind it. That was over-caution, and the parallel provenance pass
settled it as class A.

`terms()`, selector `0xd5025625`, returns `https://robinhood.com/stocktoken/rhj`
on each of ten Robinhood stock tokens on chain 4663 at block 71,485,925. The
mechanism this spec relies on for eligibility answers, and it answers with the
same URL across the whole set.

Two consequences, and the second is a correction to this spec's own framing:

- `terms_url` is served, with the block it was read at. It is not withheld.
- IT IS A PER-ISSUER FACT ON THIS CHAIN, NOT A PER-INSTRUMENT ONE. Every one of
  the ten tokens returns the identical URL. Earlier revisions said eligibility
  must come from the issuer's current terms per instrument, which is right
  about not generalising from the brand and wrong about where the variation
  lives. The read is per instrument, because a token could in principle return
  a different URL; the value observed is per issuer. So `terms_url` sits on the
  issuer record with the instrument carrying `terms_url_matches_issuer`, and a
  token whose URL diverges from its issuer's is a finding rather than a field
  nobody looks at.

What the terms at that URL say about eligibility is class D and was not
fetched. That is the issuer's text, it is evidence about what the issuer
publishes rather than about what the contract enforces, and it is the input to
the product-line question in section 2, not to the route's precondition. The
route's precondition is the denylist, and that is section 7.2.

### 7.2 The denylist is established on Robinhood Chain, and the route unblocks

Section 4.5 holds the detail and the per-venue table. On chain 4663 the gate is
`isBlocked` on the beacon, 175 addresses are currently denied out of 177 ever
blocked, and the control settles the model: a transfer to a denied address
reverts with the typed Blocked error naming that address, a transfer to a
never-used address succeeds in the same pass, and three further controls revert
with their expected typed errors. Measured at block 71,528,495.

THE ROUTE IS NO LONGER BLOCKED ON ROBINHOOD CHAIN. Both preconditions section
9.2 asks about the instrument are established: `terms()` answers with a URL,
and the transfer control model is described rather than guessed. Section 9
ships enabled for chain 4663 and stays disabled for any venue whose row in the
4.5 table is not established, which today is Solana.

What did not change is section 9.2 itself. It never asked about the caller, so
a settled denylist does not add a check, and an unsettled one would not have
removed one. This result changes what `transfer_control` states per venue and
changes nothing about what the route does, which is what removing the caller
check bought.

### 7.3 Selector scans are not evidence, and this cuts both ways

A method rule, recorded because two findings relayed into this spec turned on
it and they failed in opposite directions.

A loose PUSH4 scan of bytecode reported `isBlocked` and `Blocked` present on
the Robinhood token. Both were false positives from unaligned bytes, and
calling `isBlocked` on the token reverts. Only DISPATCH-TABLE EXTRACTION,
meaning PUSH4 followed by EQ, together with a live call, is evidence that a
function exists.

The same rule retracts the opposite error. An earlier review found no denylist
selectors on the BSC implementation and treated that as an absence. The search
was sound and was pointed at the wrong contract: on BSC the gate is a separate
shared compliance contract, not the token implementation. So a raw selector
scan settles nothing in either direction, and this spec does not treat presence
or absence from one as established.

Two claims in this document rest on selector reads and both survive the rule,
because both carry live calls beside them: the scaled-UI surface in section
4.4, where `toUIAmount` and `fromUIAmount` revert with empty data as well as
being absent from the dispatch table, and the beacon's fifteen-function table
in section 4.5, which is dispatch-table extraction with `isBlocked` called.

### 7.4 Three states, three tokens

`unestablished_source` is that we do not know where the value comes from, or
that the source we have cannot be reproduced. `read_failed` is that we know the
source and the read did not work. `not_published` is that the issuer has not
stated the thing at all. They are not interchangeable, and the first is the one
this revision uses most, because the provenance pass found that a figure can be
confidently wrong about its own availability.

---

## 8. tnega_series

No backfill exists, so the record begins when collection begins.

```json
{"t": "2026-09-24T00:00:00Z", "c1": 0.0, "c10": 0.0, "px": 0.0,
 "pr": null, "v": "v4", "liq": 0.0, "blk": 0}
```

The legend lives in the series `coverage` rather than in a caveat, because it
is needed only by this tool and a caveat is charged to every tool:

```json
"coverage": {
  "legend": {"t": "bucket start", "c1": "cost bps at 1,000 USD",
             "c10": "cost bps at 10,000 USD", "px": "token price USD",
             "pr": "premium bps", "v": "winning venue family",
             "liq": "quotable liquidity USD", "blk": "block"},
  "scheduled": 0, "answered": 0, "unanswered_our_side": 0,
  "unanswered_venue_side": 0, "stale_block": 0,
  "first_bucket": null, "last_bucket": null, "bucket_seconds": 900
}
```

### 8.1 The point count, with the arithmetic done

The first revision said 200 points. Measured, one point encodes at 115 bytes,
so 200 points plus envelope plus the then-current caveats came to 28,877 bytes
against a 16,384 ceiling: wrong by more than double. `value` is a list here, so
`enforce_ceiling` trims rather than refuses, which means the tool degraded on
every call instead of failing loudly. The second revision said 91, the third 123 and the fourth 121, each from a
caveat block that then changed under it. The number below is correct for the
block as it now stands and will be wrong the next time a caveat is edited,
which is the argument for the self-check computing it rather than a reader
trusting this paragraph.

With the caveat block at 1,915:

```
16,384  ceiling
-1,915  caveats
-  700  coverage with the legend
-  154  envelope
=13,615  available
/   115  bytes a point
=   118  points
```

The default is 118 points. At a fifteen-minute cadence that is about 29 hours,
which is a usable default window, and `SERIES_MAX` stays where it is so a
caller asking for more gets a trim and a caveat rather than a refusal.

This number is computed by the self-check in section 3.3 rather than
hand-maintained here, because a hand-maintained constant beside a caveat block
that anyone can edit is exactly how the first revision was wrong by double.

### 8.2 Gap against zero in the series

A bucket with no successful read produces no point, and coverage says which. An
instrument with no points and a scheduled read was watched and could not be
read; an instrument with no points and no scheduled read was not being watched.

---

## 9. The unsigned route

Enabled on chain 4663, where both instrument preconditions are established.
Disabled on any venue whose transfer control row in section 4.5 is not, which
today is Solana.

### 9.1 A route record, not the instrument record plus a route

```
tnega_get(dataset="tokenized_equities", id="4663/0x<token>/for/0x<wallet>")
```

This key form returns a ROUTE RECORD: identity, the one quote the route is for,
the eligibility result, and the route. It does not return the instrument record
as well. Two reasons, and the first is arithmetic: the instrument record at
about 4,400 bytes plus a route object at 2,852 plus caveats and coverage
exceeds the 8,192 ceiling, and since the value is a dict it would be refused
rather than trimmed. The second is that the wallet form asks a different
question, so it should answer that question. The full record is one call away
at the plain key.

About 3,900 bytes, and about 5,875 with caveats, coverage and envelope.

Without the `/for/<wallet>` suffix there is no `unsigned_route` field at all.
Not null: absent, because a null field invites a caller to look for the
argument that fills it.

THE WALLET IS AN INPUT TO CALLDATA, NOT A SUBJECT OF A CHECK. It is needed
because a swap has a recipient and an approval has a spender, so calldata
cannot be built without an address to build it for. It is not used to decide
whether this caller may do anything, and after section 9.2 there is no code
path in which it could be. Section 9.5 says what happens to it afterwards.

### 9.2 The precondition, which is about the instrument and never about who is asking

THE ROUTE NEVER CHECKS THE CALLER. Every precondition is a question about the
instrument or about our own state, and none is a question about the wallet.

In order, and the route is not built if any step does not pass:

1. The wallet segment parses as an address on chain 4663. A syntax check on a
   calldata input, not a check on a person.
2. The transfer control model for the instrument is established, per section
   7.2. It is, on chain 4663, measured with controls at block 71,528,495. On a
   venue whose row in the 4.5 table reads `unestablished`, every request stops
   here with `unestablished_source`, which today means Solana.
3. We hold current terms: the stored `terms_url` is the one this record was
   built against, reconciled within the interval in E8. If it moved, no route.
   Section 0 forbids the alternative, so this is a rule and not a decision.
4. The precomputed quote is within `staleness_bound_seconds`.
5. Coverage for this instrument is complete for the cycle the quote came from,
   per section 10.3. A quote drawn from a partial cycle is not served as a
   route.

The earlier revision had a fifth step that checked the caller's wallet against
a mirrored denylist. It is removed, not softened. `transfer_control` is served
as a described property of the instrument, in section 4.5, and the caller
applies it to their own address. We describe the instrument; we do not
adjudicate the person.

Two things follow, and the second is why this is a better design and not only a
narrower one.

Section 4.2.2 stays at zero request-time chain reads, and now trivially: there
is no per-caller question left to answer, so there is nothing to look up, and
the amplification vector where a caller chooses the target of a read we pay for
does not exist rather than being mitigated.

AND THE DESIGN NO LONGER DEPENDS ON THE DENYLIST QUESTION AT ALL. The mirror
presupposed that the model is a denylist, which is exactly the class C claim
section 7.2 says is unestablished: an enumerable denied set is the right object
for a denylist and the wrong object for an allowlist, so an allowlist result
would have forced a rewrite rather than an adjustment. With the step gone, the
result of that measurement changes what `transfer_control.model` says and
changes nothing structural. This paragraph stays in the document as the record
of why the design avoids resting on an open question, rather than as a live
dependency.

### 9.3 What it returns

```json
"unsigned_route": {
  "what_this_is": "An unsigned transaction. It has not been signed, has not "
                  "been broadcast, and we will never know whether it was sent. "
                  "Sign it in your own wallet if you choose to.",
  "chain_id": 4663,
  "steps": [
    {"purpose": "approval", "to": "0x...", "data": "0x...", "value": "0"},
    {"purpose": "swap", "to": "0x...", "data": "0x...", "value": "0"}
  ],
  "intended_signer": "0x... the wallet from the key, echoed",
  "gas_limit_estimate": 0,
  "min_amount_out": "0",
  "slippage_tolerance_bps": 0,
  "quoted_at_block": 0,
  "quote_age_seconds": 0,
  "quote_expires_at": "2026-09-24T00:00:00Z",
  "venue_family": "uniswap_v4",
  "pool": "0x...",
  "instrument_conditions": {
    "terms_url": "read at block 0",
    "terms_read_at_block": 0,
    "transfer_control_model": "unestablished",
    "applies_to_your_address": "We describe the instrument's transfer control "
                               "and do not evaluate your address against it. "
                               "Check it yourself before signing."},
  "not_guaranteed": [ ... 9.4 ... ]
}
```

The echoed wallet is `intended_signer`, not `from`. `from` is not a signable
field and naming it `from` made the object look closer to a transaction than it
is. An approval is a separate step with its own `purpose`, never bundled into
the swap calldata, because a caller signing one object should not be signing
two decisions.

### 9.4 What it does not guarantee

- Not a recommendation to acquire this instrument, at this size, at this time,
  or at all. Nothing in this surface recommends anything.
- Not advice, and not a suitability assessment.
- The price is not guaranteed. Quoted at `quoted_at_block`,
  `quote_age_seconds` ago, and pool state moves every block.
- The fill is not guaranteed. The transaction can revert, including on
  `min_amount_out`.
- We have made no statement about whether your address may hold or receive this
  instrument, and nothing here should be read as one. `transfer_control`
  describes the instrument; applying it to an address is yours to do.
- The instrument's terms and its transfer control are the issuer's to change,
  at any time, including between this response and a signature.
- Gas is an estimate, not a quote.
- We will not sign it, broadcast it, relay it or monitor it, and will never
  know whether it was submitted.
- We hold no funds and no keys at any point.

### 9.5 What happens to the wallet address

Settled by the owner rather than escalated.

The caller-supplied wallet is never stored raw and never logged raw. Where it
is recorded at all it is recorded as a salted hash, using `WALLET_HASH_SALT`,
which is set in the deployment and is not in this repository.

The hashing function refuses if the variable is unset rather than falling back
to a fixed string, and says so once per process. An unset salt is therefore an
absence with a reason, the same as any other in this surface, and it is not a
silent downgrade to a weaker hash. The previously committed fallback salt is
being removed and the records written under it purged, because a hash taken
with a salt that sits in the repository is reversible by anyone who reads it.

Nothing in this spec assumes hashing always succeeds. If the salt is unset the
request is still served and the log records the refusal instead of a hash:
logging is not a precondition for answering, and denying service because we
could not write an audit line would be the wrong trade in both directions.

ONE PROPERTY WORTH STATING PLAINLY, BECAUSE THE POLICY IT INHERITS WAS WRITTEN
FOR SOMETHING ELSE. `docs/data-handling.md` sets the salted-hash rule for IP
addresses. An address is not an IP: the candidate set is public, enumerable and
small, so a salted hash of a wallet raises the cost of reversal without
eliminating it. Anyone holding the salt and a list of addresses can match them.
That is a materially weaker guarantee than the same construction gives an IP,
and this spec does not imply the two are equally protective. The protection
that does not depend on the salt is the one in section 9.2: there is no
per-caller lookup, so the address is an input to calldata and to nothing else.

### 9.6 Why this is not an execution path

The first revision leaned on four null fields, `nonce`, gas price and
`signature`, as though their absence were a barrier. It is not. The `steps`
array is exactly the shape a wallet or an executor consumes, and a wallet
supplies all four automatically. That shape is correct and is kept, because a
route a wallet cannot read is useless. But it is a labelling property, not a
safety barrier, and calling it a barrier would be the kind of claim this
project exists not to make. What holds:

- The pen is in the caller's hand. We hold no key, produce no signature, and
  have no path that could.
- We never see the signature and never learn whether anything was sent. No
  callback, no receipt, no status field, nothing to poll.
- No tool accepts a signed transaction, a private key, a mnemonic or a
  broadcast instruction, and no handler calls `eth_sendRawTransaction` or any
  equivalent.
- Annotations stay `readOnlyHint: true`, `destructiveHint: false`, with a
  self-check assertion that no reachable dataset reader performs a send.
- No second route, no batch form, no prepare-and-submit pair.

---

## 10. The collector

Follows `hl_ws_coverage` and `store.py`, AND DELIBERATELY DOES NOT FOLLOW
`backend/scripts/hl_collect.py`. Earlier revisions said this collector follows
the Hyperliquid collector in structure and in reasoning. The provenance pass
read that collector and found the REST poller has the defect this dataset's
whole coverage design exists to avoid: `hl_collect.py` lines 38 to 49, and the
same loop in `server.py` lines 224 to 232, wrap the fetch and the write in one
`try`, and `store.write_poll` is the only writer. An empty result writes a row
with `n_records` 0; a failure writes nothing at all. So its poll count is a
count of successes presented as a count of attempts, and it cannot tell an
address that was polled and heard nothing from one that was refused.

The WebSocket side gets this right and is the model: one row per instrument per
bucket whether or not the read succeeded, with a failure side. Section 10.3 is
that rule, and naming which of the two predecessors to copy is now part of the
spec rather than left to whoever opens the directory first.

### 10.1 Store

Cockroach, not Mongo. Mongo is the marketplace's store and sits near its Atlas
free-tier quota, metered on dataSize plus indexSize, which has already caused a
write outage once. This is append-only time series that grows forever.

```sql
te_poll(poll_id, polled_at, chain_id, instrument, block, prev_block, ok,
        latency_ms, round_trips, failure_class, failure_side)
te_pool_state(poll_id, pool_id, family, fee_bps, protocol_fee_bps,
              liquidity, sqrt_price, tick, read_via)
te_quote(poll_id, instrument, notional_usd, side, venue_family, pool,
         enough_data, filled_fraction, slippage_bps, pool_fee_bps,
         protocol_fee_bps, gas_usd, total_cost_bps,
         quote_token_price_usd, gas_token_price_usd, usd_reference_source)
te_premium(poll_id, instrument, token_price_usd, reference_price_usd,
           premium_bps, reference_source, underlying_market_state)
te_coverage(instrument, bucket_start, scheduled, polled, answered,
            block_advanced, failure_side)
te_instrument_facts(instrument, checked_at, block, issuer, beacon,
                    implementation, shares_per_token,
                    shares_per_token_source, shares_per_token_convention,
                    ui_multiplier, new_ui_multiplier, effective_at,
                    terms_url, product_line, transfer_control_model,
                    controls_behaved, ...)
```

`te_pool_state` stores state and not orders, for the reason `store.py` gives:
what the metrics need is the state a quote can be recomputed from. It also
means a quote can be recomputed at a different size later without a new chain
read, which makes E5 reversible.

`te_quote` carries the USD references it used, so a figure can be recomputed
against a corrected reference and a wrong reference is discoverable after the
fact rather than baked in.

`te_instrument_facts` is versioned by `checked_at` rather than overwritten. A
`ui_multiplier` that changes is the dividend mechanism working, and losing the
previous value would erase the evidence of it.

### 10.2 What is stored per poll

One `te_poll` row always, whether or not the read succeeded, carrying the
block, the previous block, the outcome, the failure side and the round-trip
count. Then, only on success, one `te_pool_state` row per pool across the three
families and one `te_quote` row per notional per side.

A failed poll writes its `te_poll` row and nothing else. It never writes a
`te_quote` row with zeros, so nothing downstream can average a failure into a
cost.

### 10.3 Coverage, and a gap against a zero

`te_coverage` has one row per instrument per bucket whether or not it was read,
which is the `hl_ws_coverage` design: a collector watching ten and hearing from
six used to look identical to one watching six.

- A zero is a measurement only when `answered` is true. `liquidity = 0` at a
  known block is a fact about the pool. `liquidity` missing because the read
  failed is not zero and is never stored as zero.
- A gap is `scheduled = true, answered = false`, with `failure_side` and
  `failure_class`. No point in the series, counted in coverage.
- `scheduled = false` means not in the rotation for that bucket, which is
  `not_tracked` and a different answer from a gap.
- `failure_side` survives to the surface per 4.7.1 rather than being flattened.
- `failure_class`: `user_agent_refused`, `rate_limited`, `timeout`,
  `rpc_error`, `reverted`, `not_deployed`, `unreachable`, `bad_shape`.

### 10.4 A poll whose block did not advance is not a new observation

The analogue of the predecessor-state defect the Hyperliquid collector already
documents, in the form this one takes: a lagging node behind a load balancer
answers with an unchanged block. Both polls succeed, both look answered, and
two identical observations become two data points, which reads as coverage.

The block is already stored per poll, so it is detectable, but detectable is
not checked. So it is checked: `te_poll.prev_block` is the previous successful
poll's block for that instrument, and where the block did not advance the poll
is recorded with `block_advanced = false`, produces no series point, and is
counted in `coverage.stale_block_reads`. It is not a failure and not a gap: the
read worked and the chain state is genuinely the same one we already have. It
is simply not a second observation, and counting it as one would inflate every
denominator in this dataset.

### 10.5 How `answered` is determined: a shape check, not a status code

A 200 with an error body is the unguarded case. The rule that a zero is a
measurement only when `answered` is true is only as good as what sets
`answered`, and a status code does not set it.

Every read is validated by shape before it counts: the response decodes, the
return data is the expected length for the call, and the decoded value is
within the range the call can produce. A read that fails any of those is
`answered = false` with `failure_class: "bad_shape"`, whatever its HTTP status.

The live case this is written against, on chain 4663: a contract with 2,109
bytes of code sits at the canonical mainnet V3 factory address, and both its
owner and its fee-tier calls return empty. It is not the factory, it is not
absent, and it answers. Under a status-code check it would have been read as a
factory with no fee tiers, which would have silently removed V3 from every
quote on the chain. Under the shape check it is `bad_shape`, and section 2.2's
named address is what the collector uses instead.

### 10.5.1 The RPC layer fails over on 5xx only, and must not

`backend/core/rpc.py` lines 370 to 379: the failover loop continues to the next
endpoint only when the status is 500 or above, so a 403 returns straight to the
caller with whatever body the gateway wrote. Chain 4663 has both endpoints
configured, primary `https://rpc.mainnet.chain.robinhood.com` and backup
`https://robinhood-rpc.publicnode.com`, so failover would work if it triggered.

The 403 is not hypothetical and the provenance pass reproduced it against the
same URL and payload within one second: `curl` at its default user agent got
200 with `{"result":"0x1237"}`, `python-urllib/3.13` got 403 with
`error code: 1010`, `httpx` at its default got 200, and `curl` sending the
urllib user agent got 403. The gateway refuses by user agent. The backend uses
`httpx`, which is currently on the answered side, so this is latent rather than
firing, and a policy change would hand a Cloudflare body to a caller parsing it
as JSON-RPC. The same policy blocks `robinhoodchain.blockscout.com` outright,
which is why every address in section 2.2 was recovered from the chain rather
than from an explorer.

This collector fails over on any non-2xx, and at minimum on 403, 429 and 451,
and records which side the refusal came from per section 4.7.1. It does not
depend on `chain_rpc_post` being fixed first, but the fix belongs in
`core/rpc.py` so both transports get it, per the adapter rule in DESIGN
section 9.

### 10.6 The rate budget, answered rather than deferred

Round trips dominate and subcalls are nearly free: roughly 300 packed reads
cost about one round trip. Multicall3 is at its canonical address on chain
4663, verified, and the chain id is `0x1237`. `core/agent_performance.py`
already batches this way through `aggregate3`.

The cost is the V3 tick walk, because it is iterative rather than packable: a
walk cannot be batched into one call when each step depends on the last. Call
it three to five round trips per walk, and 0.5 to 1.5 seconds per instrument
per side per size.

A full pass over roughly 200 tickers is two to five minutes, which fits inside
a fifteen-minute bucket with the slack the Hyperliquid collector leaves for a
late scheduled run, and leaves budget for the instrument-facts pass
alongside.

`round_trips` is still recorded per poll, not to decide the cadence but to
notice when the assumption behind it stops holding.

---

## 11. What this dataset does not do

- Rank issuers, instruments or venues, in any field, in any tool.
- Serve a yield, a price target, a fair value, a valuation or a signal.
- Infer an issuer from a symbol. It reads a beacon.
- Infer eligibility from a jurisdiction, a brand, or a previous reading of a
  different product under the same name.
- Serve a route against terms it has not read.
- Present a V3 concentration figure as a V4 one.
- Return a cost figure that omits the protocol fee.
- Attribute our own refusal to the venue.
- Count an unadvanced block as a second observation.
- Serve a figure it cannot re-derive. Class C figures informed the design and
  are not values in any response.
- Treat `algebra_integral` as one deployment. Three factories are live.
- Read a dynamic fee flag as a fee.
- Execute, sign, broadcast, relay, hold or custody anything.

---

## 12. Decisions: settled, and still open

Five are settled by the owner and are recorded here rather than removed, so a
reader can see what was decided and not only what remains. E4 and E14 collapsed
rather than being decided, which is section 9.2 doing its work. Nine remain open:
E1, E3, E5, E6, E7, E8, E9, E10 and E11.

E1. The dataset id, undotted where every other is dotted. Recommendation: keep
`tokenized_equities`, since a rename after publication breaks callers.
Trade-off: one inconsistent id in a catalogue whose consistency is part of how
it is navigated.

E2. Compound key against schema property, for the wallet. This revision chose
the compound key, and section 6.1 gives the argument neither earlier revision
made: a schema property would never have reached the handler, because
`tools.get` passes one positional argument and the server validates nothing
against `inputSchema`. Recommendation: keep the compound key. Trade-off: less
legible, and undiscoverable to a caller who does not read `keys`. If you prefer
the named argument, it requires a handler signature change, a self-check that
the argument arrives, and DESIGN section 10 amended to read that a dataset adds
no tool and changes a schema only additively and only where the handler is
changed to match.

E3. The USD references, which attach to the lead field. Three prices are needed
and none comes from the pool: the quote token's USD value, the gas token's USD
value on a chain where gas is denominated in ETH, and the underlying share's
reference price for premium. The first revision escalated only the third.
Recommendation: settle the first two before the first cut, since
`total_cost_usd`, `gas_usd` and the notion of a 1,000 USD notional are the lead
figure; serve basis points where a USD reference is unavailable. On the third,
ship without premium and collect it from day one. Trade-off: the first two may
carry the same licensing question as the third, in which case the lead field is
affected and not just the secondary one.

E4. WITHDRAWN. `transfer_denied` was proposed for a wallet the denylist denies.
With the caller-facing check removed in section 9.2 this surface never
adjudicates an address, so no response can carry that finding and the token has
nothing to name. The vocabulary does not grow. The reasoning that produced it
stands and is recorded: a finding about the subject must not be filed under
`not_covered`, which is a statement about us.

E5. Sizes and cadence, capability before storage. Fixed at 1,000 and 10,000
USD, fifteen minutes. Recommendation: keep both for the first cut. Trade-off: a
caller asking about 250,000 USD gets nothing, and that is where the venue flip
bites and the Algebra pools drain. Our census measured the flip at one million,
which the served sizes do not reach, so the dataset publishes a finding it will
not let a caller reproduce. Sizes are reversible because `te_pool_state` stores
state; the cadence is not, since an unsampled bucket cannot be recovered.

E6. Whether the route covers only Robinhood Chain. Recommendation: yes, while
eligibility is a single issuer's terms. Trade-off: an xStocks holder on Solana
gets information and no route.

E7. The V3 concentration nightly index, over every positions-NFT token id.
Recommendation: not for the first cut; withhold with `not_in_snapshot`.
Trade-off: V3 carries depth for a substantial share of tickers, so for those the
concentration field is empty where cost is populated. The earlier count of
859,787 token ids is class C and is not the basis for this; the basis is the
structural one, that a V3 position key carries no salt.

E8. How often the collector reconciles terms. Not whether to serve a route
against changed terms, which section 0 already forbids, but how long a false
alarm lasts when an issuer reformats a URL. Recommendation: once per cycle for
instruments with recent route requests, once daily otherwise. Trade-off:
per-cycle for all instruments costs round trips the section 10.6 budget does
not have.

E9. Whether non-canonical Solana mints appear beyond a count. Recommendation:
returned from `tnega_resolve` when the caller supplies the mint, never listed.
Trade-off: a slightly larger surface for something we are saying is not the
asset.

E10. Solana has no beacon, so the population rule does not extend to it.
Recommendation: establish mint authority as the equivalent before serving any
Solana instrument, and serve none until then. Trade-off: xStocks is the largest
programme by instrument count and this keeps it out of the first cut, which
makes E6 narrower than it looks.

E11. The caveat budget, surface-wide. Cutting to six caveats fixed this dataset
and the underlying property remains: the caveat block is charged against the
same ceiling as the answer, on every response, for every dataset.
Recommendation: adopt the section 3.3 self-check now, which is local and
sufficient, and treat a `caveats_ref` mechanism in the envelope as a separate
proposal. Trade-off: a `caveats_ref` would free several KB per response but
weakens the rule that the caveat travels with the number, and it changes the
envelope for every dataset on one dataset's evidence.

E12. SETTLED AND RETURNED. The transfer control result landed: on Robinhood
Chain the gate is `isBlocked` on the beacon, 175 addresses are currently denied,
and the controls behaved. Section 9 is enabled for chain 4663.

My framing of this was wrong and is corrected for the record. I called it the
one place this work touches a write, needing a funded address and a decision
about which. IT IS A READ, established by a simulated call from an existing
holder's address plus a control: no funds, nothing sent, nothing written.
Nothing in this brief touches a write at any point, and that sentence should
not have gone into a document whose first section is a scope boundary against
exactly that.

As section 9.2 predicted, the result changed what `transfer_control` states and
nothing structural. It also came back per venue rather than as one answer,
which is why section 4.5 is now a table: Robinhood Chain measured, BSC measured
as not an allowlist with the denylist carried forward, Solana untested.

E15. SETTLED. No re-measurement of the prior census before building. The
collector's first cycle regenerates the pool counts as class A by construction,
so paying for the enumeration twice is waste. The published aggregate ships
empty and fills over the first cycle, and the class C figures stay unserved
per section 2.3.

E13. SETTLED. The wallet is logged as a salted hash under `WALLET_HASH_SALT`,
never raw, with a refuse-if-unset discipline rather than a fallback, and the
previously committed fallback salt is being removed with its records purged.
Section 9.5 is the spec text, including the point my recommendation got right
and for the wrong reason: a salted hash of an address is weaker than the same
construction on an IP, because the candidate set is public and small, and the
spec says so rather than implying the two are equally protective.

E14. MOOT. Whether the denylist is enumerable from logs mattered only because
section 9.2 mirrored it. With the caller-facing step removed there is nothing
to mirror, no per-caller lookup to make enumerable, and the
zero-request-time-read property no longer rests on the answer.

---

## 13. What changed in this revision

Five changes make it buildable. None touches the design.

1. The caveat block goes from fifteen caveats at 5,351 bytes to seven at
   1,915, with the explanations moved into named record fields where they sit
   beside the numbers they qualify. `issuer_structure` moves to its own key and
   the dated census moves to `tnega_summary`. `tnega_get` goes from 10,530
   bytes against an 8,192 ceiling, refused on every call, to about 7,000.
2. The route form returns a route record rather than the instrument record plus
   a route, which is what keeps it under the ceiling at about 6,500 bytes.
3. The series default is 118 points with the arithmetic shown, replacing 200,
   which was wrong by more than double, and the second revision's 91, which was
   computed from a mis-measured caveat block. The number is computed by the
   self-check rather than hand-maintained.
4. The handler defect is specified rather than assumed away: a schema property
   never reaches `tools.get`, which passes one positional argument, and
   `additionalProperties: false` is documentation because nothing validates
   against it. The compound key needs no handler change, which is now the
   argument for it, and a self-check asserts every key form's segments arrive.
5. The venue contracts are named with what was read from them, so the
   recheck-without-asking-us claim is true, and the canonical mainnet addresses
   are flagged as not transferring to this chain.

Also corrected in the ceiling pass, with one item since superseded: the
caller-facing eligibility step became a mirrored-denylist lookup, taking
request-time chain reads to zero, and section 13.2 then removed the step
altogether; a thin
pool carries `enough_data: false` rather than a contradictory
`withheld_reason`; withheld reasons are bare strings because `tools.list_`
stringifies them; a poll whose block did not advance is not a second
observation; `answered` is set by a shape check rather than a status code; and
E13 escalates whether the caller's wallet is logged at all.

### 13.1 What the provenance pass changed, which was more than either review

`docs/tokenized-equity-measurements.md` sorted every figure this spec rests on
into four classes and found nineteen of them class C: carried from sessions
whose working files are gone, with no method, script or stored output in this
repository. Section 2.3 is the rule that follows, and it is this project's own
standing rule about windows and denominators turned on our own numbers.

Removed as served values: the two headline figures in section 1, the
concentration figures, the Algebra dollar figures, the V3 token-id count, the
309 mints and 17 MSTRx, and the 0.511 instrument. A later measurement pass
converted several others to class A, and section 2.4 records which. The
`census` block in `tnega_summary` is deleted entirely and replaced by counts
this collector produces itself, which means the aggregate ships empty and fills
over the first cycle.

Corrected rather than removed:

- `terms()` IS established, class A, selector `0xd5025625` returning
  `https://robinhood.com/stocktoken/rhj` on ten tokens at block 71,485,925. The
  third revision shipped the route disabled behind a doubt that was wrong, and
  the same pass showed the URL is identical across the set, so it is a
  per-issuer value read per instrument rather than a per-instrument value.
- The route's blocker moves to the transfer control model, which is class C on
  every count and is the cheapest gap on the list: one simulation with a
  control, escalated as E12.
- The factor-of-two multiplier claim is withdrawn. Thirteen tokens read across
  two chains sit between 1.0 and 1.0017, so ignoring `ui_multiplier` costs up
  to about 17 basis points, not a factor of two. The design conclusion is
  re-derived from the thirteen readings rather than resting on the withdrawn
  number.
- Three Algebra factories are live where the spec assumed one, so
  `venues[].factory` is added and a one-factory enumeration is named as a
  defect rather than a simplification.

Added from class A reads: the named venue and quote-asset addresses with how
each was established, the V4 singleton property read from 7,652 `Swap` events
rather than assumed, the single externally owned account owning both the
PoolManager and the fee controller with no timelock in front of it, and the
dynamic fee flag on 131 of 439 initialized pools, which a cost engine that
reads it as a static fee turns into 838 percent.

Two collector defects the pass verified and this spec now inherits as
requirements: `core/rpc.py` fails over only on 5xx, so a 403 reaches the caller
unfailed-over on a chain that has a backup endpoint configured, with the
user-agent refusal reproduced four ways; and `hl_collect.py` writes nothing on
failure, so its poll count is successes presented as attempts, which is why
section 10 now names `hl_ws_coverage` as the model and that file as the
anti-model.

---

### 13.2 What the owner settled, and what it removed from the design

Four decisions, and the first is the one that changed the shape.

THE CALLER-FACING ELIGIBILITY CHECK IS GONE, not softened. The route's
preconditions are now about the instrument and our own state only: do we hold
current terms, is the quote fresh, is coverage complete. `transfer_control` is
served as a described property of the instrument and the caller applies it to
their own address. We describe the instrument; we do not adjudicate the person.

That collapsed two escalations rather than deciding them. E4 proposed a
`transfer_denied` reason for a denied wallet, and with no adjudication there is
no response that can carry it, so the vocabulary does not grow. E14 asked
whether the denylist is enumerable from logs, which mattered only because the
previous revision mirrored it; there is nothing to mirror. It also dissolved
the dependency I flagged: the mirror presupposed a denylist, so an allowlist
result would have forced a rewrite, and now the result changes what one field
says and nothing structural. Section 9.2 keeps that as a record of why the
design avoids resting on an open question.

No re-measurement of the prior census before building, per E15: the collector's
first cycle regenerates the pool counts as class A by construction.

The route stays blocked pending the transfer control result, which is dispatched
elsewhere. My E12 framing was wrong and is corrected: I called it the one place
this work touches a write, needing a funded address. It is a read, established
by a simulated call from an existing holder's address plus a control, needing no
funds and sending nothing. Nothing in this brief touches a write at any point,
and that sentence should not have been in a document whose first section is a
scope boundary against exactly that.

The wallet is logged as a salted hash under `WALLET_HASH_SALT`, never raw, with
a refuse-if-unset discipline instead of a fallback; the committed fallback salt
is being removed and its records purged. Section 9.5 carries it, including the
part that is easy to overstate: the candidate set of addresses is public and
small, so a salted hash raises the cost of reversal without eliminating it, and
that is a weaker guarantee than the same construction gives the IP addresses
the policy was written for. Nothing here assumes hashing succeeds; an unset
salt is an absence with a reason and the request is still served.

### 13.3 What the measurement pass returned

Two results, one of which unblocked the route and one of which would have
produced a collector that quietly computed the wrong thing.

THE THIRD FAMILY IS NOT ALGEBRA. Algebra Integral's swap signature returns zero
logs over two million blocks. The three factories this spec named emit V3's
`PoolCreated` and their pools emit the `Swap` shape with protocol-fee fields,
which is the PancakeSwap V3 form: they are a V3 fork. A separate Algebra-shaped
family does exist on the chain, 199 pools across at least twelve factories,
carrying stock pools including WETH against SPY and USDG against NVDA.

A collector built to the previous revision would have written an Algebra walker,
pointed it at V3-fork pools, and never reached the pools needing Algebra math.
The two errors would have partly masked each other, which is the part worth
recording: the walker failing on pools it should have handled reads as those
pools being broken, while the pools it never reached raise nothing at all.

So dispatch moves off the factory and onto the pool's own function and event
surface. `venues[].family` gains `v3_fork` and `venues[].walker` is added,
because family and arithmetic are not one to one: four families, three walkers,
and a pool matching no known surface is recorded as `unknown` and quoted by
nobody rather than handed to the nearest walker. The earlier guidance in this
document to dispatch on factory was wrong and is retracted.

The 42 and 36 Algebra counts stay class C with no re-derived number, and that
was the right call rather than an omission: re-counting the fork's three
factories under the Algebra label would have produced a figure that looked
measured, reproduced the published number closely, and described the wrong
family.

THE DENYLIST IS SETTLED ON ROBINHOOD CHAIN AND THE ROUTE IS ENABLED. The gate
is on the beacon, which nothing here predicted: not the token, not a contract
the token points at. Its fifteen-function dispatch table carries
`implementation`, `upgradeTo`, `pause`, `unpause`, `paused`, five
access-control functions and `isBlocked`, so the four-roles-in-one-contract
claim section 4.6 has made since the first revision is now a read rather than a
characterisation. 246 Blocked events over 177 addresses against 4 Unblocked
over 2 leaves 175 denied, and the controls settle the model.

`transfer_control` is now a per-venue table rather than one sentence: Robinhood
Chain measured, BSC measured as not an allowlist with the denylist itself
carried forward, Solana untested rather than generalised. The single claim that
all three venues run a denylist is retired, because the three turn out to be in
three different states.

Section 9.2 did not change, which was the point of removing the caller check.
A settled denylist adds no step and an unsettled one would have removed none.

Also applied: selector scans are not evidence in either direction, so section
7.3 records the rule and the two findings it retracts, one a false positive
from unaligned PUSH4 bytes and one a sound search pointed at the wrong
contract. The beacon's controlling address is withheld rather than stated,
because the beacon has no ownership getter, its owner call reverts, and the
address in circulation comes from role-grant events that record a past grant
rather than who holds a role now. Eight prior figures converted to class A and
are recorded with their re-derived values in section 2.4, including the
identity that no ticker has V3 depth without V4 depth, which earlier revisions
could only recover by reconciling two published numbers.

---

## 14. Appendix: what the outside advice got wrong

1. NVDAB and TSLAB described as Backed's bStock tokens. They are Binance's,
   issued by Btech Holdings Ltd in ADGM, and checked 2026-09-24 both are beacon
   proxies over `0x156d6dce9a4f6139a3406f1f021f1a4880de93a3` on chain 56.
2. Robinhood's tokens described as EU only. That is the Classic product from
   Robinhood Europe UAB; the on-chain product is a Jersey debt security from
   Robinhood Assets (Jersey) Limited. Section 7 says we have not yet
   established the on-chain source that tells them apart per instrument.
3. Asking whether a transfer to a non-KYC wallet can be blocked assumes an
   allowlist. All three venues run a denylist, verified by simulating transfers
   to never-used addresses with controls that fail correctly.
4. `walkBook` proposed as the cost engine. It walks a central limit order book.
   These are AMMs needing tick walks across four families and three distinct
   arithmetics, one of them read through a singleton with `extsload`.
5. Premium treated as the product. The wrappers agree within about twenty basis
   points while cost to fill flips by up to five times.
6. No mention of the protocol fee. The V4 PoolManager on chain 4663 has a live
   `protocolFeeController` and carries `setProtocolFee`, so a protocol fee on
   top of the pool fee is a chain fact. The prior count of pools sitting at the
   maximum is class C and is not restated as established.
7. A single best venue per ticker implied. The venue flips by size, and the
   families are not interchangeable. Re-derived since: 192 tickers, 94 of them
   on V4 only, 98 with depth on both, and no ticker with V3 depth and no V4
   depth.
