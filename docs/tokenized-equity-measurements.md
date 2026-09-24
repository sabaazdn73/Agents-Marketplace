# The tokenized equity measurements, and which of them can be taken again

Written 2026-09-24, because a specification now rests on a body of figures that
existed nowhere in this repository. A search of the tree for the distinctive
terms in it returned one file, the specification itself. Every number it leans
on was therefore unrefreshable by anyone except the session that took it, which
is the one thing this project's standing rule forbids.

Two claims had already gone wrong that way, and both were passed upward as
settled when they were not. A multiplier claim of the form "wrong by up to a
factor of two" rested on a token this repository has never read. A "denylist on
all three venues" claim rested on terms text and on reads taken in sessions
whose working files are gone.

A second pass on 2026-09-24 converted what was cheap to convert. The denylist is
now established on one venue with the control that settles it, the pool and
ticker counts are re-derived and they reproduce, and two figures that had been
stated as read off a contract turn out to come from logs. That pass also found
that the third venue family is misidentified, which is recorded here because a
collector written to the specification would build the wrong tick walker.

So this file is not a summary of the findings. It is a provenance record. Every
figure below says what was measured, how, at what block or in what window, and
whether a reader can take it again today. A figure marked not re-derivable is
worth more here than one that quietly implies it can be refreshed, and the list
in the last section is the part of this document with the most value.

## The four classes every figure is sorted into

A. Re-read in this pass. Taken on 2026-09-24 against the Robinhood Chain
public RPC `https://rpc.mainnet.chain.robinhood.com`, chain id confirmed as
4663 by `eth_chainId` returning `0x1237`, over blocks 71,414,089 to 71,542,170,
plus reads on BNB Smart Chain at block 123,784,389.
Method is stated per figure. Anyone with curl can take these again.
A third pass the same day re-read the concentration figures at named past
blocks, which the public RPC does not serve ("historical state ... is not
available"), so those reads went through the archive endpoint
`https://robinhood.drpc.org`. It also read the USDe pools at block 71,615,602,
the reference pools' depth at 71,627,504, and USDC at 71,629,036.
Both are named where they are used. A figure pinned to a past block
reproduces as a number and not only as a method, which the caution below does
not have to cover.

B. Already committed to this repository. Read in an earlier session and
written into a tracked file at the time, so the value and its method both
survive. Two figures qualify, both in `docs/limitations.md` and
`docs/integrations.md`.

C. Carried forward from a session whose working files are gone. The value
is recorded here with the session attributed, and it is not reproducible from
anything in this repository. No method, no script and no stored output survives
for any figure in this class. These are the figures the specification is most
exposed on.

D. Terms text, not a measurement. An issuer's own published statement. It
is evidence about what the issuer says, and about nothing else.

State-dependent figures deserve one caution even inside class A. Pool
liquidity, tick position and any cost computed from them move every block, so a
re-read reproduces the method and not the number. Where that applies it is said
in the row.

---

## Execution cost

This is the finding the whole product rests on, and it is the finding with the
weakest provenance in the record.

| Figure | Class | Provenance and refreshability |
|---|---|---|
| Wrappers agree on price within about twenty basis points across issuers | C | No stored sample, no window, no count of observations, no reference source named. Not re-derivable. The figure cannot even be bounded from here, because nothing records how many pairs were compared or when. |
| Cost to fill differs by up to five times by name and by size | C | Same. No stored quote set. Not re-derivable. |
| Cost to fill at 1,000 USD and 10,000 USD per instrument | C | The per-instrument figures are gone with the session. The method (walking initialised ticks against pool state, three families, quoted at a block) is recoverable from the specification text, the outputs are not. |
| The USD sizing behind those quotes | C, and now known to rest on assumptions | The earlier session's quote scripts survived in its scratch directory until 2026-09-24. `v4rank.py`, `v3price.py` and `algprice.py` each set `ETHUSD=2660.664224` as a constant at line 4, and each values USDG, USDe and syrupUSDG at exactly 1.0. The ETH rate's source and time are not recorded. Every quote those scripts took on an ETH or WETH pool, in all three families, was therefore sized at that constant. The specification now takes these references from pools against a named numeraire (section 4.2.1, E3). |
| The cheaper venue flips by name and by size | C for the figures, A for the mechanism | The claim that both families quote the same tickers is re-derivable: see the pool counts below, taken again in this pass. The specific flips (SPY, MSTR and META to V4 at one million; NVDA, QQQ and GME to V3) are not. |

Nothing in this repository can currently produce a cost-to-fill figure. There
is no collector, no store and no quote engine for it. Until one exists, every
cost number in the specification is a class C figure, and the specification
should read as though it says so.

---

## The AMM families on Robinhood Chain

An independent check in this pass confirmed the concern that prompted it: the
canonical mainnet Uniswap addresses are not the deployments on this chain, so a
record that omits the addresses points a reader at the wrong contracts.

### What the canonical addresses actually hold (class A)

| Canonical address | Read at block 71,414,089 | Conclusion |
|---|---|---|
| `0x000000000004444c5dc75cB358380D2e3dE08A90` (V4 PoolManager on mainnet) | `eth_getCode` returns `0x` | Nothing deployed at all |
| `0x1F98431c8aD98523631AE4a59f267346ea31F984` (V3 factory on mainnet) | Code present, but `owner()` and `feeAmountTickSpacing(3000)` both return empty | A contract, and not the V3 factory |

### The chain-specific deployments (class A)

| Family | Address on chain 4663 | How it was established in this pass |
|---|---|---|
| Uniswap V4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | Deployed bytecode contains the selectors for `extsload`, `exttload`, `unlock`, `take`, `settle`, `swap`, `modifyLiquidity`, `setProtocolFee`, `protocolFeesAccrued` and `collectProtocolFees`; `extsload(bytes32(0))` answers rather than reverting; and over blocks 71,478,645 to 71,481,645 every one of the 7,652 V4 `Swap` events on the chain was emitted by this address and no other, which is the singleton property read directly rather than assumed |
| V4 protocol fee controller | `0x6d0009504d129cf5002dba61d9ae8575aa79314c` | `protocolFeeController()` on the PoolManager |
| Uniswap V3 factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | `factory()` on the busiest V3 pool in the window, `0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca`, a WETH/USDG pool at fee 100 |
| Third-family factory, dominant | `0xece6ecd61177336ea6fb9b17937ac439d85ee20b` | `factory()` on each of the four busiest pools of that family by swap count |
| Third-family factory, second | `0x0ec554f0bff0be6c99d1e95c8015bb0950f6a2c7` | `factory()` on pool `0x18ab375abb1891f998fb6e342613b339e8752486` |
| Third-family factory, third | `0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865` | `factory()` on pool `0x88a8e96e7785d378825e8b5d7fc0e6f62487061e` |

### The third family is not Algebra Integral, and there are more than three

This is the largest correction in this pass, and it changes what a collector has
to build rather than only what a figure says.

The specification's venue model is three families: Uniswap V3, Uniswap V4 behind
the singleton, and Algebra Integral. Read by event signature at block
71,528,495, that is not what is on the chain.

| Signature | Hash | Found on chain 4663 |
|---|---|---|
| `Swap(address,address,int256,int256,uint160,uint128,int24)`, Uniswap V3 | `0xc42079f9…` | Yes, in volume |
| `Swap(address,address,int256,int256,uint160,uint128,int24,uint128,uint128)`, the PancakeSwap V3 shape with protocol-fee fields | `0x19b47279…` | Yes, in volume. This is what the pools under the three factories above emit. |
| `Swap(address,address,int256,int256,uint160,uint128,int24,uint24)`, Algebra Integral | `0x087f22af…` | Zero logs over the last 2,000,000 blocks |
| `PoolCreated(address,address,uint24,int24,address)`, the Uniswap V3 factory event | `0x783cca1c…` | Emitted by the three factories above: 281, 84 and 381 pools respectively |
| `Pool(address,address,address)`, the Algebra factory event | `0x91ccaa7a…` | 199 pools over all history, from at least twelve distinct factory addresses, none of them the three above |

So the family the record has been calling Algebra Integral is a PancakeSwap-V3
style fork: a V3 factory event, V3 tick math, and a Swap event carrying the
protocol fee. Algebra Integral's own swap signature appears nowhere. There is
separately an Algebra-shaped family, spread thinly across roughly a dozen
factories, and it does carry stock pools (WETH/SPY, USDG/NVDA, WETH/TSLA,
WETH/AAPL and others, several with live liquidity).

Two consequences, both for the collector rather than for the prose:

- The spec calls for three tick-walking implementations, one of them an Algebra
  Integral walker. The family it would be written against walks V3 ticks, so
  that implementation is not the one needed, and the family that would need an
  Algebra walker is a different and much smaller set the spec does not mention.
- Every count that treated the third family as one deployment was counting one
  fork's three factories and missing the Algebra-shaped pools entirely.

The taxonomy has to be settled before the third family's counts mean anything,
which is why they are not given a re-derived number below.

### The quote assets, which define what "stock against quote" means (class A)

| Asset | Address | Read |
|---|---|---|
| USDG, Global Dollar | `0x5fc5360d0400a0fd4f2af552add042d716f1d168` | `name()` and `symbol()` |
| WETH | `0x0bd7d308f8e1639fab988df18a8011f41eacad73` | `name()` and `symbol()` |
| USDe | `0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34` | `name()` and `symbol()` both "USDe", 18 decimals, at block 71,615,602. At that block it is the quote asset of 7 V4 stock pools, 5 of them live, and of no V3 stock pool. Found from `Initialize` on the singleton filtered on USDe in either currency slot, with the stock set taken as the 204 `BeaconUpgraded` emitters. |
| USDC, USD Coin | `0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8` | `name()` "USD Coin", `symbol()` "USDC", 6 decimals, `totalSupply()` 340,536,993 raw units, 340.54 USDC, at block 71,629,036 and unchanged at 71,635,510, through the archive endpoint. Too little in existence to be a USD reference: the specification's depth test trades 10,000. Whether any stock pool is quoted in it was not checked. |

USDe is not in the pool-count definition below, and the published counts
included it. The earlier session's stored pool state (no block recorded, class
C by the definition above, read from its scratch directory, which is due to be
deleted) splits the published 11,340 as 8,370 USDG, 2,301 native ETH, 662 WETH and 7 USDe. It
splits the published 2,423 live pools as 1,639, 768, 11 and 5. So the
re-derived 11,353 and 2,428 are counts under a narrower definition. Part of
the difference between the published and re-derived counts is definition and
not the passage of blocks. The re-derived figures stand as what their method
says they are.

### The USD reference pools' depth (class A)

Measured for the specification's thin-pool test (section 4.2.1, E3) at block
71,627,504, by `backend/scripts/te_reference_depth.py`, which prints every
figure in this section and in 4.2.1 and embeds the quoter's source and
runtime. The method walks initialised ticks from pool state, 40 ticks each
side of the current tick: `ticks()` on V3, `extsload` on the V4 tick mapping
at pool base + 4. On the USDe pool the walk was checked against a swap
simulated through a V4 quoter deployed by state override. At 50,000, 100,000,
150,000 and 213,323 USDG in, the two agree to within 3 parts per billion.
Impact excludes the pool fee and the protocol fee.

| Pool | Execution impact at 10,000 USDG, worse side | USDG that moves the mid 10 bps | USDG for 10 bps execution impact |
|---|---|---|---|
| V3 WETH/USDG fee 100, `0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca` | 0.3569 bps | 139,920 buying ETH, 140,748 selling | 279,906 buying, 278,469 selling |
| V4 USDe/USDG fee 100, no hook, `0xa5f23cae4e5c3388c5a8a6b08a83f53e56df8f1a63757e606b362994b68a2361` | 0.3991 bps | 107,295 buying USDe, 103,058 selling | 213,323 buying, 206,039 selling |

Of the other seven live V4 USDe/USDG pools, one moves its mid 10 bps at 5,304
USDG on its worse side and six at under one USDG. A reviewer's figures of about
140,500 and 125,500 match holding liquidity constant at the current tick.
That is close for the WETH pool and overstates the USDe pool, whose liquidity
thins within ten ticks.

### Pool counts and ticker counts, re-derived

These were class C. They are now class A, and they reproduce.

The method, so a reader can take them again. The instrument set is the 204
beacon proxies (see the issuer section). A pool counts as stock against quote
when one leg is one of those 204 and the other is USDG
(`0x5fc5360d0400a0fd4f2af552add042d716f1d168`), WETH
(`0x0bd7d308f8e1639fab988df18a8011f41eacad73`) or, on V4 only, the native
currency. V4 pools come from `Initialize` on the singleton filtered on
`currency0` and then `currency1` per instrument; V3 pools from `PoolCreated` on
factory `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` filtered on `token0` and
then `token1`. Live means nonzero liquidity: `liquidity()` on a V3 pool, and for
V4 `extsload` of `keccak256(poolId ‖ 6) + 3`, the fourth word of the pool state,
which was calibrated against a pool with swaps in the current block range before
being used. Reads at blocks 71,521,404 to 71,542,170 on 2026-09-24.

| Figure as published | Re-derived in this pass | Class |
|---|---|---|
| V4: 11,340 stock and quote pools | 11,353 | A |
| V4: 2,423 with live liquidity | 2,428 | A |
| V3: 437 pools | 432 | A |
| V3: 208 with live liquidity | 202 | A |
| 2,094 of 2,423 live V4 stock pools at the protocol maximum | 2,097 of 2,428, reading `protocolFee` out of the packed `slot0` word: 1,000 hundredths of a bip in each direction, which is the 0.1 percent maximum | A |
| 192 tickers priceable | 192 | A |
| V4 the only venue for 94 of 192 | 94 | A |
| 98 tickers with depth on both | 98 | A |
| V4 best for 146, V3 for 46, third family for none | not re-derived | C |
| Of the 98, the split is 52 to 46 | not re-derived | C |
| Algebra: 42 pools, 36 with live liquidity | not re-derived, and not attempted | see below |

The counts moved by a handful in each case, in the direction a later block
predicts: more pools created, a few drained. Nothing moved by an amount that
would change a sentence built on it. For V4, part of the movement is
definition rather than blocks, because the published counts included 7 USDe
pools and the re-derived ones do not: see the quote assets above.

Three things are worth stating separately.

The last two rows of the first group stay class C on purpose. "Best venue" is a
cost ranking, not a count, and the cost engine that would decide it does not
exist here. Re-deriving 192 and 94 does not re-derive 146 and 46, and they
should not be presented as though the same pass established them.

The identity the counts contain now holds by measurement rather than by
assumption. Tickers with live V3 depth: 98. Tickers with live V4 depth: 192.
Tickers with V3 depth and no V4 depth: zero. So every one of the 94
single-venue tickers is V4, the 98 both-venue figure is exactly the V3 live set,
and the union is 192. The three numbers are not independent, and a future edit
that changes one has to change the others.

The Algebra row was not attempted, and giving it a number would have been worse
than leaving it empty. The family it refers to is misidentified: see the venue
section above. Counting a fork's three factories under the label "Algebra" would
have produced a figure that looked re-derived and described the wrong thing.

---

## The protocol fee, and who sets it

| Figure | Class | Provenance and refreshability |
|---|---|---|
| 2,094 of 2,423 live V4 stock pools charge 0.1 percent each direction, the protocol maximum, taken from the input | C | Not re-derivable. It requires the pool enumeration that is gone. What survives is the claim, not the count. |
| The mechanism exists and is settable | A | The PoolManager's deployed bytecode carries `setProtocolFee` and `collectProtocolFees`, and `protocolFeeController()` answers with a live address. |
| A single externally owned account sits behind it, with no contract between the key and the setter | A, with one qualification | `protocolFeeController()` returns `0x6d0009504d129cf5002dba61d9ae8575aa79314c`, which is a contract. Its `owner()` returns `0x2bad8182c09f50c8318d769245bea52c32be46cd`. That address returns `0x` from `eth_getCode` and has nonce 3, so it is an externally owned account, and it is also what `owner()` on the PoolManager itself returns. One key owns both. |
| No timelock | A for the absence of one in front of the key, C for the absence of one inside the controller | There is no timelock contract between the key and the controller: the owner is a plain account. Whether the controller contract imposes a delay internally was not established, because that needs its source or a decompilation and neither was available in this pass. The earlier session's flat claim of "no timelock" is therefore narrowed here rather than repeated. |

The distinction in the last row matters. "An externally owned account owns the
fee controller" was read. "There is no delay anywhere in the path" was not.

---

## The hook

| Figure | Class | Provenance and refreshability |
|---|---|---|
| The dominant hook on this chain is `0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544` | A | Of 439 V4 `Initialize` events over blocks 71,444,904 to 71,484,904, 287 carried the zero address as the hook and 124 carried this one. The remaining 28 were spread over eight further hook addresses at one to seven pools each. |
| None of the hook's pools are a stock token against a quote asset | A | Every one of the 124 hooked pools in that window was a distinct freshly created token as one leg. Two had WETH as the other leg and none had USDG. The counter-asset was typically another launched token. TTWO, which is a stock token, appeared as a counter-asset in four of them, but against launched tokens rather than against USDG or WETH. |
| It therefore gates no route a user acquiring a stock token would take | A | Follows from the row above, given that the routes in question are stock against USDG or WETH. |
| 131 of the 439 pools initialized in that window carry the dynamic fee flag `0x800000` | A | Decoded from the `Initialize` event's fee word. Recorded because a cost engine that reads a static fee for those pools reads the flag value, 8,388,608, as a fee in hundredths of a basis point. |

The scoping conclusion survives re-verification. The route a user would take is
stock against quote, and that is not what this hook is deployed over.

---

## The Algebra pools

| Figure | Class | Provenance and refreshability |
|---|---|---|
| SPY's Algebra pools were its most traded and not its deepest | C | Not re-derivable. The comparison that produced it is gone. |
| They hold about 110,000 dollars and drain at one million | C | Not re-derivable, and state-dependent in any case. |
| No Algebra pool is the best venue for any ticker at any size | C | Not re-derivable, and it inherits the cost figures' class. |
| Closing the gap removed a worry rather than raising a figure | C, and worth keeping as reasoning rather than as a number | The value of this finding is that it licences the cost figures not to be labelled lower bounds. That licence is only as good as the class C measurement under it. |
| SPY does trade on Algebra today | A | Pool `0xabe817af4fe3420152ab1464a45dc971e7eaaeae`, SPY against USDG, under factory `0xece6ecd61177336ea6fb9b17937ac439d85ee20b`, 11 swaps in a 1,500-block window. |

---

## Concentration

These were class C. The session's stored outputs turned up in its scratch
directory, which is due to be deleted, and the figures are now class A at named
blocks. The derived values are committed as a baseline in
`docs/data/tokenized-equities-concentration-baseline.json`. They are what the
collector's first concentration pass is compared against. They are not a served
figure: under section 2.3 of the specification, what gets served is the
collector's own reading.

The original run recorded no block. Its three scripts read state at the tag
`latest`, and `conc.py` fetched `eth_blockNumber` but used it only as the upper
bound of its log query and wrote it nowhere. File times bound the run to blocks
71,434,076 to 71,438,970. That bounds when the reads ran, not the block they
ran at, so the block was established from the chain instead. The pool
liquidity and tick of all five V4 pools equal the stored values at every block
sampled from 71,432,452 to 71,446,957. The samples were every 50 blocks inside
that range and every block at both edges. No sample outside the range matches:
the first mismatch on each side is 71,432,451 (NVDA's tick) and 71,446,958
(SPY's liquidity). At block 71,435,476, all 897 stored position values were
re-read with `extsload` and none differs. Every PositionManager `ownerOf` was
resolved again and the holder counts reproduce, as do the top ten liquidity
amounts by rank. The V3 pools were read one after another during a busier
period, so no single block fits all five, and each was re-derived in full at
its own block. Block 71,435,476 is inferred, not recorded: it is a representative block inside
the stretch of about 14,500 blocks over which the V4 state is identical,
chosen because it is the block at the time the V4 output was last written.
The stored V3 values for NVDA and SPCX do not hold at that block, which is why
V3 carries a block per pool. Method, blocks and endpoints are in the baseline
file. `backend/scripts/te_concentration_baseline.py` re-derives every value in
it from the chain and compares. It also checks the live V4 position set
against `docs/data/tokenized-equities-v4-position-keys.json`, the 897
positions and liquidity values the original run stored. Run on 2026-09-24
against the archive endpoint, it reproduced every compared value, and a fresh
`ModifyLiquidity` enumeration to 71,435,476 found no live position outside the
stored set.

| Figure | Class | Provenance and refreshability |
|---|---|---|
| SPY: 350 providers, largest at 10.2 percent | A | Block 71,435,476, V4 pool `0xfe2a80bb…26cd`, SPY against USDG. Largest share 10.19 percent, 388 in-range positions. Reproduces the published figure. |
| NVDA: 157 providers, the two largest together at 33.5 percent | A | Block 71,435,476, V4 pool `0x3bb34a44…4bf1`, NVDA against USDG. The published wording, "two at 33.5 percent", reads as though each held that much. The data says the two largest hold 17.17 and 16.29 percent, 33.46 together. The count reproduces and the wording is corrected here. |
| GME: 2 providers, one at 100 percent | A | Block 71,435,476, V4 pool `0xca11843f…0804`, GME against native ETH. The largest holds 99.99999998 percent and the second holds 2.3 × 10⁻⁸ percent. "100 percent" is a rounding, and the second provider is present. |
| QQQ: 18 providers, largest at 68.87 percent; SPCX: 207 providers, largest at 9.28 percent | A | Same block and method. Taken by the same run and not published before. They are in the baseline. |
| The method self-checks by summing per-position liquidity to the pool's own liquidity value, exact to the wei | A | Re-run from the stored per-position values and again against the chain at block 71,435,476. For all five V4 pools the in-range sum equals the pool's liquidity word exactly: SPY 6,052,469,089,083,250,783; NVDA 506,281,920,529,444,552; GME 4,407,957,327,846,326,360,674; QQQ 517,384,290,504,486,175,652; SPCX 758,378,581,111,471,133. The script re-enumerates `ModifyLiquidity` to that block, and the live set equals the stored 897 exactly. |
| "Provider" means beneficial owner | A, narrowed | Not quite. A provider is the NFT holder for a position opened through the V4 PositionManager (`0x58daec31…4fa7`, `name()` "Uniswap v4 Positions NFT"). A position opened directly by another contract is counted as that contract. 13 of SPY's 388 in-range positions, 8 of NVDA's 164 and 6 of SPCX's 226 were opened directly. One such contract is NVDA's seventh largest provider, at 4.35 percent. An NFT holder can itself be a contract. |
| V3 collapses into the positions NFT | A | Re-derived in full from `Mint` logs up to each pool's own block: SPY at 71,436,500, NVDA at 71,437,500, GME at 71,438,000, QQQ and SPCX at 71,438,500. The owner of in-range V3 liquidity at the pool is `0x73991a25…e0d3` (`name()` "Uniswap V3 Positions NFT-V1", `factory()` the V3 factory) for 100, 99.27, 97.31, 100 and 99.98 percent of it respectively. The self-check reconciles on all five. This is the structural claim, measured. It is a share of pool-level position owners, not of providers, and it is recorded in its own field. |
| The same quantity is not obtainable on V3 without a nightly index over 859,787 token ids | C for the count, A for the reason | `totalSupply()` on the V3 positions NFT reads 859,767 at block 71,435,476 and 861,061 at block 71,606,550. Neither is 859,787. That count may be a different quantity (ids minted rather than ids outstanding) or a different block, and nothing records which. The reason is the one above, now read rather than argued. |

The original run chose each pool as the one its quote pass ranked deepest at
one million USD. That ranking is a cost figure and stays class C. Only the pool
ids it selected are used here, and a concentration figure does not depend on
why its pool was chosen.

The V3 and V4 quantities are not interchangeable, and the specification is
right to refuse to serve them in one field. The baseline keeps them apart for
the same reason.

Provider addresses are not in the baseline. Counts, shares and the liquidity
amount at each rank are enough for a re-derivation to match rank by rank. The
only addresses kept are the protocol contracts, because the V3 one is the
finding.

---

## The issuer structural comparison

Side by side, not ranked, and `not published` survives as a value rather than
being filled in from a similar issuer.

| Property | xStocks | Robinhood Stock Tokens | bStocks |
|---|---|---|---|
| Issuing entity | Backed Assets (JE) Limited | Robinhood Assets (Jersey) Limited | Btech Holdings Ltd |
| Jurisdiction | Jersey | Jersey | ADGM |
| Programme operator | Backed | Robinhood | Binance |
| Wrapper | not published here | debt security | not published here |
| Redemption path | not published | not published | not published |
| Bankruptcy remoteness | not published | not published | not published |
| Upgrade control | not published here | beacon, read on chain in this pass | beacon, read and committed earlier |

Class per row: the entities and jurisdictions are class D, taken from the
issuers' own published terms. Every `not published` is a statement that the
issuer has not said, not that a read failed.

### The Robinhood beacon

| Figure | Was | Now | Provenance |
|---|---|---|---|
| Stock tokens on chain 4663 are beacon proxies | A | A | TTWO at `0x5e81213613b6b86eab4c6c50d718d34359459786` has an EIP-1967 implementation slot of zero and an EIP-1967 beacon slot pointing at `0xe10b6f6b275de231345c20d14ab812db62151b00`. |
| The beacon's implementation | A | A | `implementation()` on the beacon returns `0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2`. |
| 204 tokens sit behind the beacon | C | Not re-derivable. It was established from beacon logs and corroborated by the deployer key's nonce, and neither the log range nor the key is recorded anywhere in this repository. Both sources are named in the specification, which means the number can be rechecked by someone who redoes the work, not that it can be refreshed from here. |
| The address holding those powers is published nowhere | A | A, with the basis stated precisely | `owner()` on the beacon reverts, and the beacon has no ownership getter of any kind in its 15-function dispatch table. The controlling address is therefore not recoverable from the contract surface. |
| The administrator address that has been in circulation | not stated before | A, but from logs and not from the contract | It comes from `RoleGranted` events on the beacon, not from a getter, and the issuer comparison has been stating it as though it were read off the contract. That is a weaker basis than it reads as: a log is a record of a past grant, and only a full replay of grants and revocations establishes who holds a role now. The beacon has emitted 16 `RoleGranted` and 3 `RoleRevoked` events over 13 distinct role hashes. `DEFAULT_ADMIN_ROLE` was self-granted at deployment to `0x074377a78a9710a1d47244f89797718b4f491279`, which then granted it to `0xd6f8378f8e440c65f8382f5f2728c78dfd55b66d`. Both return `0x` from `eth_getCode`, so both are externally owned accounts, with nonces 20 and 2. |
| 204 tokens behind the beacon | C | A, reproduced exactly | `eth_getLogs` over all blocks for topic0 `BeaconUpgraded(address)` (`0x1cf3b03a6cf19fa2baba4df148e9dcabedea7f8a5c07840e207e5c089be95d3e`) with the beacon in topic1 returns 204 logs from 204 distinct emitters. Each beacon proxy emits it once at construction, so the emitters are the token set. |
| The prospectus bounds the burn power; the contracts do not bound it | C and D | C and D | The prospectus side is class D, the issuer's own text. The contract side is class C: no stored read of the burn surface survives. The disagreement is recorded here as a disagreement and not as a finding about either document, because only one half of it can currently be checked. |

---

## The multiplier findings

This is the claim that went wrong, so it is stated at the level of what was
read and by whom.

### What this repository had read before this pass (class B)

Two tokens, both on BNB Smart Chain, both committed to `docs/limitations.md`
and `docs/integrations.md` on 2026-09-24:

| Token | Address | `uiMultiplier()` |
|---|---|---|
| NVDAB | `0x02fca66c1d1afb4e2a7884261eb00f63598a7436` | 1.000778223752807865 |
| TSLAB | `0x5b1910eaad6450e50f816082aa078c41f10c292f` | exactly 1.0 |

Both are beacon proxies over beacon `0x156d6dce9a4f6139a3406f1f021f1a4880de93a3`
and implementation `0xcfed6c4679297ea4889f8183bc057b4a86c64e46`, and for both
`totalSupply * uiMultiplier / 1e18` equals `totalSupplyUI` to the wei.

### What was read in this pass (class A)

Ten Robinhood stock tokens on chain 4663, `uiMultiplier()` at block 71,485,925:

| Ticker | Address | `uiMultiplier()` |
|---|---|---|
| SPY | `0x117cc2133c37b721f49de2a7a74833232b3b4c0c` | 1.001717991187472 |
| NVDA | `0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec` | 1.0007751591646306 |
| QQQ | `0xd5f3879160bc7c32ebb4dc785f8a4f505888de68` | 1.0007007912414054 |
| COST | `0x4ea005168d7f09a7a0ba9d1def21a479950e44c2` | 1.0006120402962597 |
| AAPL | `0xaf3d76f1834a1d425780943c99ea8a608f8a93f9` | 1.0005660800610925 |
| META | `0xc0d6457c16cc70d6790dd43521c899c87ce02f35` | 1.0005414598794518 |
| MSFT | `0xe93237c50d904957cf27e7b1133b510c669c2e74` | 1.000412952576206 |
| GME | `0x1b0e319c6a659f002271b69db8a7df2f911c153e` | exactly 1.0 |
| MSTR | `0xec262a75e413fafd0df80480274532c79d42da09` | exactly 1.0 |
| RBLX | `0xf0c4bf4c582cb3836e98394b1d4e7b7281101be8` | exactly 1.0 |
| TTWO | `0x5e81213613b6b86eab4c6c50d718d34359459786` | exactly 1.0 |

Eleven tokens in all, spread from 1.0 to 1.0017.

### The factor-of-two claim

| Claim | Class | Status |
|---|---|---|
| One instrument sits at `shares_per_token: 0.511` | C | Not re-derivable. The instrument is not named in the specification, is not in this repository, and no read of it survives. It is attributed to the session that reported it and is not restated here as established. |
| A ratio built without applying the multiplier is wrong by up to a factor of two | C | Follows from the 0.511 figure and inherits its class. It is not supported by any multiplier this repository has read. |
| Applying the multiplier matters | A and B | Supported, at a much smaller magnitude. Thirteen tokens across two chains sit between 1.0 and 1.0017, so ignoring the multiplier costs up to about 17 basis points on those, not a factor of two. |

The design conclusion the specification draws, that `per_share_price_usd` should
be served pre-corrected rather than left to the caller, does not depend on the
0.511 figure. Thirteen tokens reading between 1.0 and 1.0017 while the field
exists at all is sufficient reason to correct centrally. The conclusion stands;
the number under it does not.

### Total return and distributions

| Figure | Class | Provenance |
|---|---|---|
| These are total-return wrappers, dividends reinvested into the multiplier net of withholding rather than paid out | D | The issuers' own terms. It is consistent with thirteen multipliers sitting at or slightly above 1.0, which is what reinvestment would produce, but consistency is not a measurement of the mechanism. |
| The withholding rate | C | Not recorded anywhere. Not re-derivable. |
| Serving no yield field | Design decision, not a figure | It follows from the row above being class D, and it is the correct handling of a class D input. |

---

## The permission model

Attribution first, because this is the second claim that went wrong. It was
carried forward in one sentence covering three venues. It is now separated by
venue and by half-claim, because two of the three venues were measured in this
pass and they do not support the sentence in the shape it was written.

### The simulation, and why the controls are the point

Method: `transfer(to, amount)` simulated through `eth_call`, with `from` set to
an address that actually holds the token, taken from a recent `Transfer` log.
The test transfers to a never-used address, confirmed never used by `eth_getCode`
returning `0x`, `eth_getTransactionCount` returning 0 and a zero native balance.
Three controls follow, each of which must fail.

The controls carry the result. A success on its own cannot tell a denylist from
no gate at all, and a simulation that silently swallows reverts would return a
success either way. The controls establish that a refusal, when there is one,
surfaces as a typed error.

Robinhood Chain, TTWO `0x5e81213613b6b86eab4c6c50d718d34359459786`, at block
71,490,772, from holder `0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e`:

| Simulation | Result |
|---|---|
| TEST, 1 wei to never-used `0x00000000000000000000000000000000000ffff1` | Success, returns `true` |
| CTRL1, an amount far above balance | Revert, `ERC20InsufficientBalance` (`0xe450d38c`) |
| CTRL2, to the zero address | Revert, `ERC20InvalidReceiver` (`0xec442f05`) |
| CTRL3, from an account with no balance | Revert, `ERC20InsufficientBalance` |

BNB Smart Chain, NVDAB `0x02fca66c1d1afb4e2a7884261eb00f63598a7436`, at block
123,784,389, from holder `0xc6448de0b0ae196e5602e349b8a1a1a7a7c10af7`: the same
four outcomes, the same two typed errors.

### Where the gate lives, established per venue

The review's point that the token and the venue are separate gates, and that
three venues need not agree, is correct, and the two venues measured here are
built differently from each other.

BNB Smart Chain. The bStock token exposes `compliance()`, selector `0x6290865d`,
and both NVDAB and TSLAB return the same address:
`0x53dba7aabde774787a1f57236b235567da8e14f4`. That contract carries
`COMPLIANCE_ROLE()` (`0x062d3bd7`) alongside AccessControl. So the compliance
surface is on a shared contract the token points at and not on the token, which
is why a selector search of the token implementation found none of the names
looked for. The review's search was sound and was looking in the wrong contract.

Robinhood Chain. Not on the token either, and not in a contract the token points
at. Extracting the dispatch table from implementation
`0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2` gives 36 functions: `pause`,
`unpause`, `paused` (currently false), `mint`, `burn`, `permit`, `terms()` and
the seven ERC-8056 functions. There is no `isBlocked`, no `compliance()` and no
AccessControl on the token at all, and `hasRole` and `DEFAULT_ADMIN_ROLE` both
revert on the proxy.

The gate is on the beacon. `0xe10b6f6b275de231345c20d14ab812db62151b00`, which
is the same contract that serves `implementation()` to every stock proxy, has a
15-function dispatch table carrying `implementation()`, `upgradeTo(address)`,
`pause`, `unpause`, `paused()`, the five AccessControl functions, and
`isBlocked(address)` (`0xfbac3951`). Upgrade beacon, access control registry,
global pause and denylist, in one contract, as a read rather than as a
characterisation.

It is populated. Over the chain's whole history the beacon has emitted 246
`Blocked(address)` events covering 177 distinct addresses, and 4
`Unblocked(address)` events covering 2 (`0x…dead` and `0xdead…dead`), leaving 175
addresses denied. The first was at block 43,543 and the most recent at block
495,713. `paused()` is false.

### The control that settles it

Taking one of the 175 denied addresses, `0x002471b8a185f9980708d0eaec5b289714f56f8d`:

| Simulation | Result |
|---|---|
| `isBlocked` on the beacon for that address | `true` |
| Transfer 1 wei from the holder TO that address | Revert, `Blocked(address)` (`0x75e91ce7`), the error data naming that address |
| Transfer 1 wei to the never-used address, in the same pass | Success, returns `true` |

That is the pair the claim needed. A specific address is refused with a typed
error naming it, and an address the contract has never seen is not. Denylist,
not allowlist, on this venue, established by measurement rather than carried
forward.

One methodological note, because the mistake is easy and was made here before
being caught. A loose scan for any four-byte value in the token's bytecode
reported `isBlocked` and `Blocked` as present on the token. Both were false
positives from unaligned bytes, and calling `isBlocked` on the token proxy
reverts. The selectors do exist, but they live on the beacon. A selector is
evidence only when it sits in a dispatch table, and the check that settles it is
a live call.

### Status after this pass

| Claim | Was | Now | Basis |
|---|---|---|---|
| An ordinary never-used wallet is not gated, Robinhood Chain | C | A | The simulation above, with three controls that failed correctly |
| An ordinary never-used wallet is not gated, BNB Smart Chain | C | A | The same, on NVDAB |
| Transfer control is a denylist and not an allowlist, Robinhood Chain | C | A | A denied address is refused with `Blocked(address)`, a never-used one is not, in the same pass. 175 addresses currently denied. |
| Transfer control is not an allowlist, BNB Smart Chain | C | A | Follows from the test on NVDAB |
| Transfer control is a denylist, BNB Smart Chain | C | C, unchanged | The shared compliance contract and its `COMPLIANCE_ROLE` were read, but no denied address was found there and no refusal was observed. Not an allowlist is established; is a denylist is not. |
| Where the gate lives, per venue | not stated before | A | BSC: a shared `compliance()` contract, `0x53dba7aabde774787a1f57236b235567da8e14f4`. Robinhood Chain: the beacon, `0xe10b6f6b275de231345c20d14ab812db62151b00`. Different structures, which is why one sentence covering both was always going to be wrong about one of them. |
| The same for xStocks on Solana | C | C, untested | No xStocks mint address exists anywhere in this repository and no Solana simulation was run. Recorded as not tested rather than generalised from the two venues that were. |
| The Robinhood Chain instrument's terms are read from the contract | A | A | `terms()`, selector `0xd5025625`, returns `https://robinhood.com/stocktoken/rhj` on each of the ten stock tokens it was called on in this pass. |
| What the terms at that URL say about eligibility | D | D | Issuer text. Not fetched in this pass, and evidence about what the issuer publishes rather than about what the contract enforces. |
| Robinhood's EU Classic product is a different instrument from the on-chain one | D | D | Issuer text, and the correct correction to make. The on-chain half is class A: the token exists on chain 4663 and answers `terms()`. |

The sentence that should not be written again is "transfer control on all three
venues is a denylist", not because it is wrong but because it was one sentence
standing on one venue's evidence. One venue now carries it fully, a second
carries half of it, and the third has not been tested. The three venues are
built differently enough that the generalisation was never safe: on BSC the gate
is a contract the token points at, on Robinhood Chain it is the beacon the token
upgrades through, and the token itself carries no compliance surface on either.

---

## Two collector defects found while recording this

Both were verified from source in this pass. Neither was fixed, deliberately:
this file records them so the next collector does not copy them.

### `chain_rpc_post` treats a 4xx as final and never fails over

`backend/core/rpc.py`, lines 370 to 379. The failover loop continues to the next
endpoint only on a 5xx:

```python
resp = await client.post(url, json=payload, timeout=timeout)
if resp.status_code >= 500:
    last_resp = resp
    continue
return resp
```

A 403 returns straight to the caller, unfailed-over, with whatever body the
gateway wrote. Chain 4663 has both endpoints configured, primary
`https://rpc.mainnet.chain.robinhood.com` and backup
`https://robinhood-rpc.publicnode.com`, so failover would work if it ever
triggered.

The condition is not hypothetical, and it was reproduced in this pass against
the same URL and payload within the same second:

| Client | Status | Body |
|---|---|---|
| `curl` at its default user agent | 200 | `{"jsonrpc":"2.0","id":1,"result":"0x1237"}` |
| `python-urllib/3.13` | 403 | `error code: 1010` |
| `httpx` at its default user agent | 200 | `{"jsonrpc":"2.0","id":1,"result":"0x1237"}` |
| `curl` sending `Python-urllib/3.13` as its user agent | 403 | `error code: 1010` |

The gateway in front of that endpoint refuses some clients by user agent and
answers others normally. The backend uses `httpx`, which is currently on the
answered side, so the defect is latent rather than firing. A policy change that
moves `httpx` to the refused side would hand `error code: 1010`, or a Cloudflare
interstitial page, to a caller that then parses it as JSON-RPC. The same gateway
policy already blocks `robinhoodchain.blockscout.com` outright, which returned a
challenge page to every request in this pass and is why the addresses above were
recovered from the chain rather than from the explorer.

What it should do instead is failover on any non-2xx, or at minimum on 403, 429
and 451, and record which side the refusal came from. It is not fixed here.

### The Hyperliquid REST poller records nothing on failure

`backend/scripts/hl_collect.py` lines 38 to 49, and the same loop in
`backend/server.py` lines 224 to 232. Both wrap the fetch and the write in one
`try`, and the `except` writes only a line to stdout:

```python
orders = collector.fetch_orders(t["address"])
summary = collector.summarise(t["address"], orders)
store.write_poll(conn, summary, t.get("month_volume"))
ok += 1
```

`store.write_poll` is the only writer. An empty result reaches it with
`n_records` of 0 and writes an `hl_poll` row. A failure never reaches it and
writes nothing at all. So the store cannot tell an address that was polled and
had no orders from an address that was refused, timed out or errored, and a
poll count is a count of successes presented as a count of attempts.

This is the exact distinction the WebSocket side already gets right.
`hl_ws_coverage` exists so that a collector watching ten addresses and hearing
from six does not look identical to one watching six. The REST poller has no
equivalent table, and the `ok` and `failed` counters it keeps live only for the
duration of the process and are printed, never stored.

It matters here beyond Hyperliquid because the specification says its collector
follows this one in structure and in reasoning. It should follow
`hl_ws_coverage` rather than `hl_collect.py`: one row per instrument per bucket
whether or not the read succeeded, with a failure side of ours or theirs, so
that a shared public RPC refusing us is never recorded as a venue with nothing
in it. That is the same rule the 403 above makes concrete. Not fixed here.

---

## The figures that cannot be re-derived

Collected in one place because this is the list that decides what is safe to
publish. Everything here is class C: attributed to a session whose working files
are gone, with no method, script or stored output surviving in this repository.

1. Wrappers agreeing on price within about twenty basis points. No sample, no
   window, no count.
2. Cost to fill flipping by up to five times by name and by size.
3. Every per-instrument cost-to-fill figure, at every size.
4. The named flips: SPY, MSTR and META to V4 at one million; NVDA, QQQ and GME
   to V3.
5. (Removed. V4 pool counts are class A: 11,353 and 2,428.)
6. (Removed. V3 pool counts are class A: 432 and 202.)
7. The third family's pool counts, 42 and 36. Not merely unreproduced but
   pointed at a misidentified family: see the venue section. A number here would
   have to wait on the taxonomy.
8. Which family is best per ticker and per size: 146, 46 and none, and the 52 to
   46 split. These are cost rankings, not counts, and the cost engine does not
   exist. The counts they were quoted alongside (192, 94, 98) are now class A.
9. (Removed. 2,097 of 2,428 live V4 stock pools charge the protocol maximum,
   read out of `slot0`.)
10. Whether the fee controller contract imposes any internal delay.
11. SPY's Algebra pools holding about 110,000 dollars and draining at one
    million, and being most traded rather than deepest.
12. No Algebra pool being best for any ticker at any size.
13. (Removed. Concentration for SPY, NVDA and GME, with the self-check, is
    class A at block 71,435,476 and committed as a baseline: see the
    concentration section. NVDA's "two at 33.5 percent" is the two largest
    together.)
14. The 859,787 V3 token ids. `totalSupply()` on the positions NFT reads
    859,767 at block 71,435,476, which does not reproduce it.
15. (Removed. 204 tokens behind the Robinhood beacon is now class A: see the
    issuer section for the one-query method that reproduces it.)
16. The contracts not bounding the burn power, which is the half of the
    prospectus disagreement that is a contract read.
17. The 0.511 shares-per-token instrument, and with it the factor-of-two claim.
18. The dividend withholding rate.
19. On BNB Smart Chain, that the compliance contract's denylist is populated and
    enforced. Not an allowlist is established there; a refusal was never
    observed, because no denied address was found. On Solana, the whole
    question, which was never tested. Robinhood Chain has left this list: see
    the permission model section.
20. 309 non-canonical Solana mints, 17 of them named MSTRx.

What remains cheap to convert. The BSC half of item 19 needs a denied address on
that venue, found the way the Robinhood Chain one was, by reading the compliance
contract's own event history. Solana needs an xStocks mint address, which this
repository does not have.

The rest need the census taken again.
