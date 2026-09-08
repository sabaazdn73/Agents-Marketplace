# Native Agents

Native Agents are the ones this project wrote itself, at `/native-agents`.
Everything else in the marketplace is somebody else's agent, discovered from
the ERC-8004 registry and evaluated. These are Tnega's own logic: they read
live protocol data, state the reasoning behind a recommendation, and execute
from the user's own wallet.

They are also distinct from Skills. A Skill is a third-party protocol
integration pulled from Altana's registry with no Tnega-designed logic on
top. See [Skills vs Marketplace](skills-vs-marketplace.md).

A disclosed entry fee of 0.75% (`NATIVE_AGENT_ENTRY_FEE_BPS = 75` in
`frontend/src/defiSkills.js`) applies to Native Agents and is shown before
anything is signed. The free third-party Skills carry no such fee.

## The four DeFi categories

These four are grouped together in the UI under "DeFi categories" so the set
is visible at a glance and each says whether it is live.

| Category | Card | State today |
|---|---|---|
| Yield Optimisation | Staking agent, relabelled | Live, executes |
| Health Factor Monitoring | HealthFactorCard | Live, read only |
| Rebalancing | RebalancingCard | Live plan, signing not wired |
| Grid Trading | Coming soon card | Not built |

Yield Optimisation is the Staking agent under the category name rather than
a duplicate card.

## Yield Optimisation (Staking)

`backend/adapters/native_staking.py`, served by
`GET /api/native-agents/staking/recommendation`.

It compares BSC liquid-staking pools using DefiLlama's free, no-key yields
API (`yields.llama.fi/pools`) and protocols API (`api.llama.fi/protocols`),
and returns a recommendation with its reasoning and the full ranked
candidate list, never just a winner.

The decision is not a sort by APY. In order:

1. DefiLlama's own per-pool `outlier` flag excludes a pool outright rather
   than down-ranking it. That flag is an independent signal this project did
   not have to compute.
2. TVL is the primary key, as a proxy for liquidity and risk. Deeper pools
   are less exposed to thin-liquidity withdrawal problems and undiscovered
   risk.
3. APY breaks ties, but only among candidates whose TVL is within a factor
   of 3 of each other. A dominant TVL is never overridden by a higher yield
   below it.
4. Disclosed audit count breaks a further tie, then pool maturity in days
   tracked.

The candidate set is deliberately narrow: Lista DAO (slisBNB) and Ankr
(ankrBNB), the two BSC liquid-staking protocols this codebase can execute a
stake through, with contract addresses and ABIs confirmed against BscScan's
own `getsourcecode` and `getabi`. The roughly thirty other BSC liquid-staking
platforms DefiLlama tracks are excluded on purpose. Recommending a protocol
this codebase cannot act on would be a dead end for the person reading it.

WBETH was investigated and left out. Minting it on BSC requires already
holding BETH obtained off-chain through Binance's own ETH staking service,
rather than a single-call deposit like Lista and Ankr, so execution
feasibility is unresolved rather than confirmed.

The route returns `available: false` with a reason on any live-data failure.
It never returns a fabricated recommendation.

## Health Factor Monitoring

`frontend/src/healthFactor.js` and `HealthFactorCard.jsx`. Read only.
Nothing here signs, approves or spends.

It reads the connected wallet's lending positions on BSC from two protocols:

| Protocol | Contract | Call |
|---|---|---|
| Aave v3 Pool | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` | `getUserAccountData(address)` |
| Venus Comptroller (Unitroller) | `0xfD36E2c2a6789Db23113685031d7F16329158384` | `getAccountLiquidity(address)` |

The two protocols do not report the same thing, and the card does not
pretend otherwise.

Aave returns a health factor directly, scaled by 1e18, along with the
liquidation threshold in basis points. Below 1.0 a position can be
liquidated.

Venus has no health factor function. Its Comptroller returns an error code,
a liquidity figure and a shortfall figure, both 1e18 scaled USD. Liquidity
is headroom before liquidation, shortfall is how far past it a position
already is, and one of the two is always zero. So the card reports what
Venus actually returns. Turning liquidity into a health-factor-looking
number would mean inventing a denominator, and a liquidation screen is the
wrong place to be approximately right.

Two details that matter more than they look:

Aave returns `type(uint256).max` for the health factor when a wallet has no
borrowings. Rendering that as a number, or falling back to zero, would tell
someone with no debt that they are about to be liquidated. It is reported as
"no borrowings" instead.

A Venus error code is not the same as an empty account. A non-zero code
means the Comptroller could not price the account, and that is surfaced
rather than shown as zero.

The two reads run independently, so a failure on one does not hide the
other. A wallet may use only one of them.

Risk bands, applied to Aave's health factor only, with Aave's own
liquidation point at 1.0:

| Health factor | Band |
|---|---|
| below 1.0 | Liquidatable now |
| 1.0 to 1.1 | Critical |
| 1.1 to 1.5 | Tight |
| 1.5 to 2.0 | Comfortable |
| 2.0 and above | Safe |

## Rebalancing

`frontend/src/rebalance.js` and `RebalancingCard.jsx`. The card reads the
wallet's BNB and USDT balances, prices them, and works out the swaps that
bring them back to a target split. It shows every leg before anything is
signed.

Signing is not wired yet. The card says so on its face rather than implying
an execution path that is not there. The swap route it names is the one the
Trading agent already runs.

The plan is arithmetic and lives apart from the card, in `rebalance.js`,
which decides nothing about execution and signs nothing.

Everything is integer. Amounts are bigints of the token's own base units and
weights are basis points, so 60% is 6000 and a target set must total exactly
10000. Nothing converts to a float, because a rebalance is a set of real
swaps and a rounding drift becomes a dust position that costs gas to clear.

Weights that do not total 100% are refused rather than normalised silently.
Normalising would rebalance to a split the person did not ask for.

A leg smaller than `MIN_LEG_QUOTE_UNITS`, currently 1 USDT, is reported as
skipped rather than swapped, because gas and slippage would cost more than
the drift it corrects.

Sells are ordered before buys, because the buys are funded by the sells and
a wallet without spare quote token would otherwise fail on the first buy.

A token amount is shown only for a sell, where the wallet holds the asset. A
buy's token amount depends on the quote at execution time, and putting a
guess on screen that the swap then contradicts is worse than leaving it
blank.

Legs route through USDT rather than swapping A for B directly. A direct swap
is one hop and cheaper, but it needs a pool for every pair a target could
name. Selling into USDT and buying out of it uses pools that reliably exist,
and it makes the plan readable. The cost is a second hop on any pair that
had a direct pool.

## Grid Trading

Not built. The card is present from day one and states the reason, which is
that a grid that refills as orders fill needs something running between
visits, and this backend has no scheduler.

The intended shape, if it is built, is different from that and does not need
one: a single batched transaction placing every level of the grid at once
through the EIP-5792 path the app already uses, so the person sets range,
levels and size, sees every order, signs once, and the orders sit as limit
orders. That is a grid placed once rather than refilled.

The primitive that would carry it on BSC was checked live. PancakeSwap's
Orbs-based limit orders are deprecated per PancakeSwap's own documentation,
and the replacement is described as fee-earning limit orders on PancakeSwap
Infinity, with BNB Chain listed as a supported chain but no contract named.
What is verifiable on-chain today is PancakeSwap V3 range orders: the
NonfungiblePositionManager at
`0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` (name "Pancake V3 Positions
NFT-V1", factory `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`), and the
WBNB/USDT 0.05% pool at `0x36696169C63e42cd08ce11f5deeBbCeBae652050`. A
range order is an on-chain mint call, so unlike an off-chain signed order
protocol it can be batched.

Two caveats that would have to be on the card, not buried: a range order
fills partially across a band rather than at one price, and it is
one-directional.

Nothing above is built. It is recorded here so the next person does not
repeat the search.

## Other native agents

### Trading

`frontend/src/tradingAgent.js`. Spot buys, quoting the same trade across
three BSC DEXs and executing through whichever offers the best price.

A single-DEX trading agent would be redundant with what a connected wallet
or a visit to PancakeSwap already offers. This one compares. All three
routers are verified, non-proxy contracts sharing the same Uniswap V2 fork
interface, confirmed via BscScan's `getsourcecode` and `getabi` before any
of it was written.

| DEX | Router |
|---|---|
| PancakeSwap | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| Biswap | `0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8` |
| ApeSwap | `0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7` |

Liquidity was measured before the comparison was built rather than assumed.
Quoting 1,000 USDT on each:

| Route | PancakeSwap | Biswap | ApeSwap |
|---|---|---|---|
| USDT to WBNB, direct | 1.4515 | 1.4470 | 0.9594 |
| USDT to WBNB to CAKE | 547.4 | 529.8 | 343.2 |
| USDT to BSW | 1,596,436 | 2,480,886 | no liquidity |

The BSW row is the case that justifies the whole agent: a DEX-native token
priced about 55% better on its own home DEX, which a single-DEX agent could
never surface. ApeSwap was consistently the weakest of the three on every
pair tried and is not presented as competitive.

The card also shows a 24 hour price change as context. That is not technical
analysis and not a buy or sell recommendation, and it is labelled as
context.

### Investigated and not built

Three cards exist as coming-soon entries with the reason stated, rather than
being left off the page.

Perpetuals. Avantis on Base was checked on 2026-09-04. The earlier reasoning
about there being no bridge from BSC was stale, since Base is a chain a
connected wallet can switch to. The blocker found instead is structural:
Avantis trades are not self-encodable, because calldata is built by a live
call to their own transaction builder rather than from a fixed ABI, and they
do not settle atomically, since a signed order fills asynchronously and
expires unfilled after roughly 15 to 30 seconds. That is a different
integration shape from every other Native Agent here, not a smaller version
of the same one.

Tokenized assets. CoinGecko's RWA endpoints were checked live on 2026-09-02
on the public tier with no key: `/rwas/list`, `/rwas/markets`, `/rwas/{id}`,
`/rwas/issuers/list` and `/rwas/issuers/{id}` all returned 200 with data,
647 tracked assets across 34 issuers. Only `/tickers` and `/market_chart`
returned 401 as paid-plan endpoints. A comparison agent covering asset name,
price, market cap and issuer is feasible on the free tier. It is not built.

Web2 agents and PayBox. A vision card with no code behind it, unlike Staking
and Trading. The research is in
[Future: Tnega PayBox](future-tnega-paybox.md). Note that the card's own
copy still names MoonPay as the near-term rail, which is out of date:
MoonPay declined partner onboarding, nothing is built against it, and B402
is the rail that was implemented instead. See
[Payment Rails](payment-rails.md#b402).
