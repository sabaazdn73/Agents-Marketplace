# Demo footnotes

Companion to the recorded walkthrough, `tnega-demo-walkthrough.gif`. The
recording captured 10 frames on 2026-09-09, starting from the landing page
and moving in one line through the site. Every footnote below is the English
text for the part it names, ready to burn in or to read aloud.

The order is the order of the recording. Each part says what is on screen,
what the footnote is, and what to check before you record the final take.

---

## Part 1. The landing page

**On screen.** The chain counters, then the three headline figures, then the
top of the marketplace list.

**Footnote.**

> Tnega is an agent marketplace on BNB Smart Chain. 154,695 agents are
> registered on this chain, and every one of them lives on chain. Anyone can
> register an agent, it costs almost nothing, and it proves nothing at all.
> Twenty nine have ever proven they delivered. Finding agents was never the
> problem. Knowing which ones work is the problem.

**Before recording.** Reread 154,695 and 29. Both move. The pagination label
under the list currently reads "Showing 1,24 of 14,880" where a range
separator belongs, so frame above it or fix
`AgentMarketplaceApp.web.jsx:1385` first.

---

## Part 2. How we verify agents

**On screen.** The verification panel expanded, showing all four tiers and
the fifth on-chain PnL signal beneath them.

**Footnote.**

> Every agent is graded on evidence, in four tiers. Verified working means a
> buyer paid into an on-chain job and the agent delivered. Canary-verified
> means nobody had hired it, so we funded a job ourselves. Responding means
> only that the endpoint answered just now, which shows a process is running
> and not that it can finish paid work. Unproven means neither. Each tier
> states what it does not prove.

**Before recording.** The panel also carries the independent study finding
that only 3 to 15 percent of registered agents had a working service. That
line is worth pausing on if you have the time.

---

## Part 3. Data sources

**On screen.** The nine external providers and what each one does.

**Footnote.**

> Every number on this site has a named source. Agent identity comes from
> 8004scan. Wallet portfolios from Zerion. Chain reads through bloXroute and
> BscScan. Prices from CoinGecko, DexScreener and GeckoTerminal. The Graph
> is here for a reason the next screen explains.

---

## Part 4. System status

**On screen.** The live per-source checks, with response times and block
heights, and the degraded banner above them.

**Footnote.**

> These are live checks, not a claimed uptime history. Right now one source
> is failing and the page says so rather than hiding it. Browsing, health
> checks and on-chain reads are unaffected, and it names which parts still
> work.

**Before recording.** The failing source changes. During this recording it
was CoinGecko returning 429 rate limited, and earlier the same day it was
8004scan returning 500 for Solana. Check which one it is on the day so you
can say it accurately. Solana is fully ingested at 1,466 of 1,466, so
nothing is missing either way.

---

## Part 5. The Graph integration

**On screen.** The measured comparison section of the documentation, with
the subgraph identifier and the coverage figures.

**Footnote.**

> 8004scan pages the registry by offset, and past 700,000 those requests
> time out. 361 pages were stuck retrying and our view of the registry
> stopped at agent 332,377. The Agent0 subgraph has no such limit. It
> returned 2,399 agents above that mark in 1.5 seconds across three queries.
> They were written and health checked like everything else. It is a
> coverage fallback and a corroboration source, not a replacement, because
> 8004scan carries scores and categories a subgraph structurally cannot.

---

## Part 6. An agent's own record

**On screen.** An agent detail page, scrolled to the delivery record.

**Footnote.**

> Every agent carries its own record. Who owns it and what that wallet
> holds. How many times it was hired, with finished, rejected and missed
> deadline counted separately. Feedback read from the chain. Profit measured
> from the hiring wallet before and after the job, never a figure the
> creator submitted. Where a number cannot be computed, it says so instead
> of showing a zero.

---

## Part 7. The contracts

**On screen.** The Smart Contracts documentation page: the address table,
then the live values table read from mainnet.

**Footnote.**

> Grading is still somebody else's judgement, so the money does not rely on
> it. Payment is escrowed on chain and released on delivery, and if nothing
> arrives you reclaim it yourself. Identity lives in the ERC-8004 registry
> and hires settle through the ERC-8183 escrow. Those two standards are not
> mine. AgentAccessMarket and AgentBudgetEscrow are. Both are deployed on
> mainnet with source verified. The fee is 250 basis points, two and a half
> percent, and the ceiling is 1000, ten percent, fixed in the code so the
> owner cannot raise it past that.

**The point worth making slowly.** In AgentBudgetEscrow, `draw` carries the
`whenNotPaused` modifier and `reclaim` does not:

```
function draw(uint256 budgetId, uint256 amount, bytes32 memo)
    external nonReentrant whenNotPaused

function reclaim(uint256 budgetId)
    external nonReentrant
```

> Pausing stops new budgets and stops an agent drawing. It can never stop a
> client recovering their unspent remainder. That is a design decision a
> judge can read on chain rather than take on trust.

**Before recording.** See the note at the end about BscScan.

Addresses shown on this page:

| Contract | Address | Whose |
|---|---|---|
| AgentAccessMarket | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | Mine |
| AgentBudgetEscrow | `0x4728f03693DDABbe50E79c7BfFCb930e522D585B` | Mine |
| ERC-8004 Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | Standard |
| ERC-8183 AgenticCommerce | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` | Standard |
| ERC-8183 EvaluatorRouter | `0x51895229E12F9876011789B04f8698af06cCD6DA` | Standard |
| ERC-8183 OptimisticPolicy | `0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5` | Standard |
| `$U` settlement token | `0xcE24439F2D9C6a2289F741120FE202248B666666` | Standard |

---

## Part 8. Yield Optimisation

**On screen.** The category panel expanded, the APR chart drawn, and the
projection rows beneath it.

**Footnote.**

> Four DeFi categories, all of them live. Yield optimisation ranks by
> liquidity and risk first and yield second. The chart is live APR for
> Venus, Aave, Lista and Ankr over 180 days, read from DefiLlama in the
> browser. Below it, what 1,000 U becomes in a year at today's rates,
> labelled a projection rather than a forecast, because it assumes each rate
> holds for a year and none of them will.

**Values during this recording.** Ankr 1.16 percent, Lista 0.98, Venus 0.08,
Aave 0.01. Reread them.

---

## Part 9. Grid Trading

**On screen.** The grid panel with the live pool price, the configured
levels, and the markers drawn either side of spot.

**Footnote.**

> Grid trading on PancakeSwap V3. You set a range, a number of levels and a
> size, and every level is drawn against the live pool price, sells above
> spot and buys below. The whole grid is placed in one signature. These are
> range orders, so each fills gradually across its band rather than at one
> price, and they are one directional: a sell that fills becomes USDT and
> stays there.

**Values during this recording.** Spot 750.37 USDT, three sells and three
buys, axis 646 to 855. Grid Trading needs no wallet, so this part records
the same at any time.

---

## Part 10. Health Factor and Rebalancing

**On screen.** The two remaining category panels.

**Footnote.**

> Health factor monitoring reads your Venus and Aave positions and is read
> only, so it signs nothing. Aave publishes a health factor and Venus does
> not, so Venus shows borrowing headroom and shortfall instead of a number
> it never publishes. Rebalancing compares your current weights against a
> target so the drift is visible. It shows every swap before you sign, and
> signing is not wired yet, which the card says on its face.

**Before recording.** Both panels need a wallet holding an Aave or Venus
borrow and some BNB and USDT. Without one they show their empty states,
which are correct and clearly worded but make no point on camera. The
footnote above stays true either way because it describes what the cards do
rather than a value. Do not soften the line about signing.

---

## Part 11. The agent studio and B402

**On screen.** The API and services flow with its five agents, and the rail
check expanded showing 7 of 7 passed.

**Footnote.**

> Several agents work on one purchase, each doing one job, so when a result
> is wrong you can see which one produced it. Payment settles in $U on BNB
> Chain over B402, the x402 standard settled natively on this chain. Seven
> checks run against the live facilitator, including one that sends a
> tampered payment and confirms it is rejected.

**Before recording.** Run the rail check before the take so the results are
already on screen. If you show only one line from it, show the tampered
payload rejection.

---

## Part 12. The Advantage Report

**On screen.** The three tasks, each done with an agent and by hand.

**Footnote.**

> Three tasks, each done twice, once with an agent and once by hand, timed
> both ways. A security risk check took 0.216 seconds with an agent and two
> minutes by hand. Where a manual time is an estimate rather than an
> independently timed run, it says so, and the two are never blurred
> together.

**Before recording.** Task 1 is timed on both sides. Task 2's manual column
is labelled an estimate. Use task 1 if you want a clean comparison.

---

## Part 13. The ecosystem view

**On screen.** The 3D globe with the six category groups.

**Footnote.**

> 15,000 agents across six category groups, and each marker is sized by its
> current count rather than a fixed layout.

**Before recording.** The globe takes a moment to settle. Load it early.

---

## Part 14. Close

**On screen.** Back to the marketplace, the full view.

**Footnote.**

> Live on BNB Chain mainnet, today. Every number here was read from the
> chain or from a named source, and where something is unproven or
> unfinished the site says which.

---

## What the recording could not capture

**BscScan.** Navigation to bscscan.com was blocked for the recording tab, so
the contract frames came from the site's own Smart Contracts documentation
page, which shows every address and the live values read from mainnet. That
page is accurate and it is a reasonable substitute, but a judge is more
convinced by the explorer than by our page about the explorer.

For the final take, capture these five separately and cut them into part 7:

| Frame | URL | What to have on screen |
|---|---|---|
| 1 | `bscscan.com/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | The verified source tick |
| 2 | Same, `#readContract` | `feeBps` expanded, showing 250 |
| 3 | Same, `#readContract` | `MAX_FEE_BPS` expanded, showing 1000 |
| 4 | `bscscan.com/address/0x4728f03693DDABbe50E79c7BfFCb930e522D585B#code` | `draw` and `reclaim` in one frame |
| 5 | `bscscan.com/address/0xEa4DAa3100A767e86FDed867729ae7446476EBA6` | ERC-8183, to show what is integrated |

Expand the fee values and scroll to the two function signatures before
recording. There is no time to hunt for them on camera.

**A signed transaction.** Every write path works, but recording one risks a
failure mid-take and shows a wallet dialog rather than the project. The hire
flow is best shown up to the funding step.

**Sell Your Agent, Build Your Agent, My Agents, Learn and Skills.** All work
and none of them advance the argument, so they were left out of the
recording. Skills is the one worth adding back if you want a longer cut,
since it is a different way of using the product rather than another page.
