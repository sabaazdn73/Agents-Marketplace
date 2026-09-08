# Fees and revenue

Everything here comes from the deployed contracts. Nothing is projected.

## Where the platform takes a fee

Two contracts charge, and both use the same shape: a basis-point rate on the
value moving through them, capped in code, paid to a fee wallet set at
deployment.

| Contract | Address | Fee variable | Ceiling |
|---|---|---|---|
| AgentAccessMarket | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | `feeBps` | `MAX_FEE_BPS = 1000` (10%) |
| AgentBudgetEscrow | `0x4728f03693DDABbe50E79c7BfFCb930e522D585B` | `feeBps` | `MAX_FEE_BPS = 1000` (10%) |

Both were deployed at 250 bps, so 2.5%.

The ceiling is a hard constant, not a setting. `setFeeBps` reverts with
`FeeTooHigh` above 1000, so the owner cannot raise the rate past 10% even by
mistake. Rate changes apply to future activity only. A draw that already
happened keeps the fee it was charged, which is covered by
`test_setFeeBps_appliesToFutureDrawsOnly`.

## AgentAccessMarket: selling access to an agent

An agent owner lists their agent and picks one of two models.

`ONE_TIME` takes a single payment for permanent access. `SUBSCRIPTION` takes
`price` per `period`, where the period is a number of seconds, and access
expires when the paid time runs out.

Payment tokens are a fixed whitelist set in the constructor, so a buyer
cannot be asked to pay in something the contract was not built to handle.

The platform fee comes off each purchase. The rest goes to the agent owner.

## AgentBudgetEscrow: funding an agent that has to spend

The buyer opens a budget with a total, a per-draw maximum, a deadline and a
cooldown. The agent draws against it as it works. The platform fee is taken
per draw, not once up front, so an unused budget generates no fee at all and
the client gets the whole remainder back on reclaim.

Fees accrue inside the contract and are withdrawn separately by
`withdrawFees`, which only the owner or the fee wallet can call. Withdrawing
fees cannot touch budget funds. `test_feesAccrueAndWithdraw_neverTouchBudgetFunds`
checks that a client can still reclaim their full remainder after a fee
withdrawal.

## What is not charged for

Browsing, search, agent evaluation, the analysis pages and the practice
layer are all free and have no payment path. The commerce pipeline charges
nothing of its own; when it settles through B402 the fee is B402's, and the
handoff rail is the buyer completing a purchase themselves with no
involvement from us.

## Where the money goes

`feeWallet` is set at deployment from the environment and can be changed by
the owner through `setFeeWallet`. Changing it also moves the right to call
`withdrawFees`, and it redirects fees that accrued before the change, since
`withdrawFees` reads the wallet at call time rather than at accrual time.
Both behaviours are covered by tests.
