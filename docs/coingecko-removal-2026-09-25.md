# CoinGecko removed, and BNB/USD read on chain, 2026-09-25

The backend no longer calls CoinGecko. The one figure it supplied, the US
dollar price of BNB shown beside an agent owner's BNB balance, is now read
from a PancakeSwap v3 pool on BNB Chain. This note keeps the history, the
measurements behind the replacement, and what is still open.

## Why

The owner's decision, 2026-09-25: the backend was calling CoinGecko's free
keyless API in production. On the owner's reading its terms do not cover
commercial use, and serving the figure onward would need a redistribution
agreement. (The CoinGecko API Terms, clause 4.1.1, make the scope of use
depend on the plan described at coingecko.com/en/api/pricing; that page
answered HTTP 403 to a non-browser client on 2026-09-25 and was not read
for this note.) The price is instead
derived on chain, and the CoinGecko adapter and its attribution go once
nothing uses them.

## What there was

- 2026-08-25, commit 5ba3a4b. `core/status_checks.py` began pinging
  `api.coingecko.com/api/v3/ping` for the `/status` page. Nothing consumed
  CoinGecko data then; the check existed because of a credit commitment in
  a grant application.
- 2026-08-25, commit 3e8dcc7. `backend/adapters/coingecko.py` began fetching
  `/api/v3/simple/price?ids=binancecoin&vs_currencies=usd` for
  `/api/market/bnb-price`, cached for five minutes. A 60-second back-off
  after any attempt was added later the same day. The Render deployment was rate limited (`HTTP 429`) on
  that anonymous tier at times. On a failure the adapter served the last
  price it had, however old.
- The frontend credited it with a "Powered by CoinGecko API" link beside the
  dollar value (`frontend/src/shell/DataAttribution.jsx`) and listed it on
  `/data-sources`.

Removed on 2026-09-25: `backend/adapters/coingecko.py`, its import in
`backend/server.py`, and the CoinGecko row on `/status`
(`_check_coingecko` in `core/status_checks.py`). Nothing else in the backend
referred to CoinGecko.

## What replaced it

`GET /api/market/bnb-price` now returns a 30-minute time-weighted average
price of the PancakeSwap v3 WBNB/USDT pool, read through the pool's own
`observe()`. The code is `backend/core/bnb_usd.py` (the read) and
`backend/core/v3_oracle.py` (the arithmetic, no I/O), checked by
`backend/scripts/bnb_usd_selfcheck.py`.

The figure is labelled "USD via USDT (BSC-USD)". USDT on BNB Chain
(`0x55d398326f99059fF775485246999027B3197955`, whose on-chain name is
BSC-USD) is taken at one dollar, and the figure moves with it if it does not
hold. Each response carries the pool, the fee tier, the block number and
timestamp, the window, the two tick cumulatives it rests on, the pool's
observation ring, and, for comparison, the same block's spot price from
`slot0`.

The response stays backward compatible: `usd` is still a number or null. The
frontend reads the whole answer (`useBnbQuote()` in `frontend/src/useBnbPrice.js`)
and shows the label, venue, window and block beside the dollar value.

### The pool

Read on 2026-09-25 at BSC block 123,932,872. The PancakeSwap v3 factory
`0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` returns four WBNB/USDT pools:

| Fee tier | Pool | In-range liquidity | USDT held | WBNB held | Observation cardinality |
|---|---|---|---|---|---|
| 0.01% (100) | `0x172fcd41e0913e95784454622d1c3724f546f849` | 3.19e24 | 9,644,001 | 3,739 | 4,500 |
| 0.05% (500) | `0x36696169c63e42cd08ce11f5deebbcebae652050` | 2.30e24 | 6,982,319 | 5,239 | 900 |
| 0.25% (2500) | `0x1401ff943d08a7e098328c1d3a9d388923b115d2` | 3.71e22 | 64,668 | 90 | 150 |
| 1% (10000) | `0x6805e0e5333c5c3accf2930be4734e2b98f4ce06` | 6.54e20 | 3,731 | 9 | 150 |

The 0.01% pool is used because it is the deepest across price bands. In-range
liquidity, the column above, is a figure for the current tick only; what
matters for an average price is the value that must trade to push the price a
given distance. Measured by the supervising review at block ~123,964,4xx:
about $437k moves the 0.01% pool's price by 0.5% against about $313k for the
0.05% pool, and about $1.39M moves it 2% against $1.26M. Its observation ring
is also the largest. USDT's address is lower than WBNB's, so USDT is
token0 and WBNB is token1: the pool's ratio is WBNB per USDT, and BNB's price
is its reciprocal. Both tokens have 18 decimals.

### The observation ring, and why the window is 1,800 seconds

`slot0` at block 123,932,913: `observationIndex` 3,742,
`observationCardinality` 4,500, `observationCardinalityNext` 4,500. At block
123,933,289 all 4,500 observations were read: every one was initialised, their
timestamps strictly increased, the smallest gap between two was 1 second, the
largest 82, and the ring spanned 28,957 seconds, about 8 hours.

`observe([28882, 0])` succeeded and `observe([28883, 0])` reverted with
`OLD` at block 123,932,913, whose ring's oldest observation was exactly 28,882
seconds old. The 0.05% pool behaved the same way at its own limit, 43,401
seconds.

A pool writes at most one observation per block timestamp, and BNB Chain's
block timestamp is in whole seconds, which is what the 1-second smallest gap
shows. So a ring of 4,500 cannot cover less than 4,500 seconds however busy
the pool gets. A 1,800-second window is inside that floor. How far past it the ring
reaches depends on trading activity, since busier trading fills the ring
faster: 28,957 seconds at block 123,933,289, about 13,000 seconds on the
supervising review's later read, and 12,445 seconds at block 123,965,911. The
"factor of about 16" over the window on the first read was a snapshot; on the
last it was about 7. The floor is the guarantee. Thirty minutes is long enough that
moving the average would mean holding the pool off-price for a sustained
period, and short enough to still be the current price.

If `observe()` reverts, or the RPC does not answer, the route returns
`usd: null` with a `withheld_reason` (`window_not_covered`,
`rpc_unreachable`, `read_deadline`, `read_failed` or `pool_mismatch`). It does
not fall back to a shorter window, to the other pool, or to an earlier price.
The in-memory cache holds a price for 30 seconds and a withheld answer for 10.

### The live read

On 2026-09-25 at block 123,933,922: `usd` 775.7543 over the 1,800 seconds to
timestamp 1790332551, mean tick -66,541.685. The same block's `slot0` spot
price was 776.5872, a difference of -0.107%. The ring's oldest observation
was 29,089 seconds old.

## GeckoTerminal, removed the same day

The research Skill's trending-pools lookup (Token Radar) called
`api.geckoterminal.com/api/v2/networks/bsc/trending_pools` from the visitor's
browser, keyless, and its output carried a GeckoTerminal credit. The owner
removed it on 2026-09-25: the browser call, its credit and rendering in the
skills panel, the skill's card (the registry entry `dexscreener-token-radar`
is filtered out, so no button is left that cannot run), and GeckoTerminal's
entries on the data sources and partners lists. What would replace it, and
when, is in `docs/deferred.md`.

The reason is its terms. GeckoTerminal's own Terms and Conditions
(https://www.geckoterminal.com/terms-conditions, "Latest Version: 11 August
2025"), clause 3.3, make its API "available for use without any charges,
subject to compliance with our API Terms of Service", and that link goes to
the CoinGecko API Terms (https://www.coingecko.com/en/api_terms, "Latest
Version: 5 Sept 2025", read 2026-09-25). Two of their clauses decided it:

- Clause 4.1.1 makes the scope of use depend on the plan described at
  coingecko.com/en/api/pricing. That page returned HTTP 403 to a non-browser
  client on 2026-09-25 and could only be read in summary, and the summary says
  commercial use needs a paid plan. So the keyless tier was not shown to cover
  a commercial site.
- Clause 4.3 requires attribution in fixed words: "You undertake that in your
  usage of the CoinGecko API, you shall duly attribute ownership of the
  CoinGecko API to CoinGecko by displaying prominently the message 'Powered by
  CoinGecko' in a legible font (an example of a legible font type being
  'Arial') no smaller than font size 10." The site's credit read "On-chain
  data provided by GeckoTerminal" at 10px, which is not the clause's phrase.

Clause 4.1.6, which forbids redistributing access to the API, and clause 7.1,
which requires the privacy policy to name the API as CoinGecko's and disclaim
its liability, no longer apply: the site makes no call to either API.

## The frontend, done the same day

The frontend no longer credits CoinGecko: `CoinGeckoAttribution` is gone, and
the dollar value beside a BNB balance now carries the label, venue, window and
block from the response. CoinGecko is left only in code comments that record
the change. Panels showing Zerion data carry a `ZerionSourceLine`, on seven
panels. `README.md` and `THIRD-PARTY-NOTICES.md` were corrected to match.
