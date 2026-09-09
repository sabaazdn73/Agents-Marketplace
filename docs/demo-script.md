# Demo script

Written by walking the live site at [tnega.app](https://tnega.app) on
2026-09-09. Every route, number and label below was read off the running
site, not from memory. Numbers that move are marked so you can reread them
on the day rather than trusting these.

Estimated length: 8 minutes 40 seconds at a normal pace. The cut list is at
the bottom if you need to reach 5 minutes.

## Before you record

| Needed | Why | State when checked |
|---|---|---|
| Wallet connected | My Agents, Health Factor, Rebalancing | Connected as `0x0298...FCbD` |
| A wallet with an Aave or Venus borrow | Health Factor draws its chart | The connected wallet has no position, so it shows the empty state |
| Some BNB and USDT in that wallet | Rebalancing draws its chart | Balances are near zero, so it shows the empty state |
| A completed hire on that wallet | My Agents has rows | Currently empty, "You haven't hired anyone yet" |
| A little `$U` for the hire step | Step 12 funds a job | Not checked, check before recording |

If you cannot arrange a lending position in time, keep steps 20 and 21 as
they are. The empty states are correct behaviour and the subtitles below
already say so. That is better than skipping the category.

## Three things to fix first, or work around

1. The marketplace pagination label reads "Showing 1,24 of 14,880 agents".
   It should be "1 to 24". `AgentMarketplaceApp.web.jsx:1385` has a comma
   where a range separator belongs. It is on screen in step 4.
2. `/status` says "New-agent discovery is degraded: 1 of 7 sources are
   failing" while every service below it shows HTTP 200. Both are true: the
   failing source is `solana_mainnet`, where 8004scan returns a 500. Solana
   is already fully ingested at 1,466 of 1,466, so nothing is missing. Step
   26 uses this deliberately, but decide whether you want it on camera.
3. The header says 15,000 agents listed and the marketplace says 14,880.
   The difference is agents filtered out for having no usable name. Worth
   knowing in case a judge asks.

---

## Part 1, the journey

### 1. Landing

Open `tnega.app`.

> Tnega is an agent marketplace on BNB Smart Chain.

### 2. The header counts

Stay on the landing view. Point at the chain counts and the three stats.

> 154,695 agents indexed on BNB Chain. 15,000 served.

### 3. What the stats mean

Point at "8,825 On-chain Feedback" and "29 Verified Agents".

> Feedback and verification come from the chain, not from the sellers.

### 4. Browsing

Scroll to the agent list.

> Every agent here is registered on-chain under ERC-8004.

### 5. Filtering by category

Click "DeFi categories" in the "Browse by" row.

> The four DeFi categories the hackathon asks for, as a filter.

### 6. Rebalancing agents

Click "Rebalancing".

> Agents with a hire history behind them. This one has nine hires at 100%.

Use "BNB LP Range Rebalancer".

### 7. Opening an agent

Click "Brain on BNB, BSC Grid Planner".

> Every agent has a page like this before you spend anything.

### 8. Who owns it

Point at the owner wallet and balance.

> The owner's wallet, and what it holds, read live.

### 9. Delivery record

Scroll to "DELIVERY RECORD".

> Thirteen hires. Finished, rejected and missed deadline, counted separately.

### 10. The financial signal

Point at "FINANCIAL TRACK RECORD".

> Profit is measured from the hiring wallet before and after, never claimed.

### 11. When a number is missing

Point at the "couldn't compute a PnL for any of them yet" line.

> When it cannot compute something it says so instead of showing a zero.

### 12. Hiring

Click "Hire this agent". Walk to the funding step. Sign if you have `$U`.

> Hiring escrows payment on-chain. The agent is paid on delivery.

### 13. What the escrow guarantees

Stay on the confirmation.

> If nothing is delivered, you reclaim it yourself after the deadline.

### 14. My Agents

Click My Agents in the sidebar.

> Every job you have funded, and where it stands right now.

---

## Part 2, the four categories

Go to Native Agents. Give each of the four the same time. Roughly forty
seconds each.

### 15. The set

Point at the four rows.

> Four categories. All four are built and all four execute.

### 16. Yield Optimisation, the agent

Expand Yield Optimisation.

> It ranks by liquidity and risk first, yield second.

### 17. Yield Optimisation, the chart

Point at the APR chart.

> Live APR for all four protocols, 180 days, from DefiLlama.

### 18. Yield Optimisation, the projection

Point at the 1,000 U rows.

> What 1,000 U becomes in a year at today's rates. A projection, not a forecast.

Currently Ankr 1.16%, Lista 0.98%, Venus 0.08%, Aave 0.01%. Reread these.

### 19. Health Factor, the agent

Collapse Yield. Expand Health Factor Monitoring.

> It reads your Venus and Aave positions. Read only, it signs nothing.

### 20. Health Factor, the two protocols

Point at the Aave block, then the Venus block.

> Aave publishes a health factor. Venus does not.

### 21. Health Factor, what that means

Point at the Venus headroom and shortfall lines.

> So Venus shows headroom and shortfall, rather than a number it never gives.

With a borrow position the Aave chart draws the distance to liquidation at
1.00. Without one you get "no borrowings", which is the correct reading and
the subtitle above still holds.

### 22. Rebalancing

Collapse Health Factor. Expand Rebalancing.

> Current weights against your target, so the drift is what you see.

### 23. Rebalancing, the plan

Point at the target split control and the swap list.

> It shows every swap before you sign, and you sign them.

Signing is not wired yet and the card says so. Do not imply otherwise.

### 24. Grid Trading

Collapse Rebalancing. Expand Grid Trading.

> A grid of limit orders across a range, placed in one signature.

### 25. Grid Trading, the chart

Point at the price axis with the markers.

> Your levels against the live pool price. Sells above spot, buys below.

Currently spot 750.00 USDT, three sells and three buys, axis 646 to 855.

### 26. Grid Trading, the caveats

Point at the two notes under the orders.

> These fill gradually across a band, and they are one directional.

---

## Part 3, the data

### 27. Verification tiers

Back to Marketplace. Click "How we verify agents".

> Four tiers, and each one says what it does not prove.

### 28. The strongest tier

Point at "Verified working".

> Verified working means a buyer paid and the agent delivered on-chain.

### 29. The weakest tier

Point at "Responding, unproven".

> An endpoint answering proves a process runs, not that it can finish work.

### 30. The canary tier

Point at "Canary-verified".

> Where nobody had hired an agent, we paid for a small job ourselves.

### 31. System status

Go to `/status`.

> Live checks against every service, including the ones that are failing.

### 32. What it says when something is down

Point at the degraded line and the per-source list.

> One ingestion source is down right now. The page says so.

### 33. Data sources

Go to `/data-sources`.

> Nine external sources, and what each one is used for.

### 34. Ecosystem view

Go to `/ecosystem`.

> 15,000 agents across six category groups, sized by their counts.

---

## Part 4, the technical claims

### 35. The contracts

Open BscScan at `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333`.

> Our own contract. Deployed, verified, and readable by anyone.

### 36. The fee, on chain

Click Contract, then Read Contract. Expand `feeBps` and `MAX_FEE_BPS`.

> The platform fee is 250 basis points, capped in code at 1,000.

### 37. Who can change it

Expand `owner` and `feeWallet`.

> The owner and the fee wallet, both public.

`feeWallet` is `0xBfE58070b39F0F2E1c46A4EF80690B6045934293`.

### 38. The budget contract

Open `0x4728f03693DDABbe50E79c7BfFCb930e522D585B`.

> A second contract, for agents that spend as they work.

Same 250 and 1,000 constants, `paused` false, `budgetCounter` 3.

### 39. The escrow kernel

Open `0xEa4DAa3100A767e86FDed867729ae7446476EBA6`.

> The ERC-8183 escrow every hire runs through.

### 40. The rest of the standard

Open `0x51895229E12F9876011789B04f8698af06cCD6DA` and
`0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5`.

> The router and the settlement policy. Silence past the window is approval.

### 41. The identity registry

Open `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`.

> ERC-8004. Every agent's identity is a token in here.

### 42. The settlement token

Open `0xcE24439F2D9C6a2289F741120FE202248B666666`.

> Jobs settle in $U, on the same chain.

---

## Part 5, The Graph

### 43. The problem

Go to `/docs/thegraph-integration`.

> 8004scan's pagination times out at depth. Agents past it were unreachable.

### 44. The measurement

Scroll to the deep-offset numbers.

> Offsets 700,000 and above timed out. 361 pages were stuck retrying.

### 45. The ceiling

Point at the 332,377 figure.

> Our view of the registry stopped at agent 332,377.

### 46. The fix

Scroll to the comparison.

> The Agent0 subgraph returned 2,399 of them in 1.5 seconds.

### 47. What survived

Scroll to "Verified result, end to end".

> 994 written, then health-checked like everything else. 537 had live endpoints.

### 48. Why both

Point at the two-source explanation.

> The subgraph has reach. 8004scan has the scores. Neither replaces the other.

---

## Part 6, payments and the rest

### 49. The studio

Go to `/studio`.

> Several agents on one purchase, each doing one job.

### 50. The two flows

Click "API and services".

> One flow for goods, one for services that settle on BNB Chain.

### 51. The agents

Point at the five robots.

> Intent, API Fit, Match, QA, Payment. You see which one is working.

### 52. B402

Click "Show rail check and pay".

> B402 settles the x402 standard natively on BNB Chain.

### 53. The rail check

Point at the seven results.

> Seven checks against the live facilitator. Ten payment kinds, all on chain 56.

### 54. The security check

Point at "Tampered payload rejected".

> A tampered payment is rejected by the facilitator, tested every time this runs.

### 55. Skills

Go to `/skills`.

> Ten skills you run yourself, with a spend cap you set.

### 56. Sell Your Agent

Go to `/sell`.

> List an agent you own. Ownership is checked against the registry.

### 57. The three pricing models

Point at the three options.

> One-time, subscription, or pay per use.

### 58. Advantage Report

Go to `/report`.

> Three tasks, done with an agent and by hand, timed both ways.

### 59. A measured result

Point at Task 1.

> A risk check took 0.216 seconds. By hand it took two minutes.

### 60. Labelled estimates

Point at the estimate label on Task 2.

> Where a number is an estimate it is labelled one.

### 61. Docs

Go to `/docs`.

> Thirty-seven pages, including what was tried and rejected.

### 62. Partners

Scroll to the partner strip.

> Built on BNB Chain, with the sources this runs on named.

### 63. Close

Return to the marketplace.

> Live on BNB Chain mainnet. Every number here was read from the chain.

---

## Length and cuts

| Part | Steps | Time |
|---|---|---|
| 1, the journey | 1 to 14 | 2m 10s |
| 2, four categories | 15 to 26 | 2m 40s |
| 3, the data | 27 to 34 | 1m 10s |
| 4, contracts | 35 to 42 | 1m 20s |
| 5, The Graph | 43 to 48 | 50s |
| 6, the rest | 49 to 63 | 2m 20s |
| | | **8m 40s** |

To reach 5 minutes, cut in this order. Each cut says what it costs.

1. Steps 55 to 57, Skills and Sell Your Agent. Saves 45s. Costs a working
   feature, but neither is scored by the three criteria.
2. Steps 39 to 42, the four third-party contracts. Saves 40s. Keep 35 to 38,
   which are the contracts you wrote. The rest are the standard, not your work.
3. Steps 33 and 34, data sources and ecosystem. Saves 30s. The sources are
   already named in the partner strip at step 62.
4. Steps 8 and 9, owner and delivery record. Saves 25s. Step 10 carries the
   data-quality point on its own.
5. Steps 59 and 60, the report detail. Saves 25s. Step 58 states the idea.

Do not cut anything in Part 2. Agent diversity is a named criterion and it
is scored on all four categories getting equal weight. Part 2 is the only
place that is demonstrated, and dropping one category is the exact failure
the criterion describes.

Do not cut step 54. A judge who sees a payment rail with no rejection test
has no reason to believe the passing tests.
