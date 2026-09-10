# Smart Contracts

Every contract below is deployed and live on mainnet, and this project is mainnet-only throughout: there is no testnet deployment of anything user-facing, and no testnet value is reachable from a production path.

Most of what follows is on BSC mainnet (chain 56), which is where this project started and where every hire path works. Since 2026-09-10 AgentBudgetEscrow is also live on Arbitrum (42161) and Robinhood Chain (4663) — see "Deployments per chain" below, and read "The same address is not the same contract" before using any address here.

## Deployed addresses

| Contract | Address | Role |
|---|---|---|
| AgentAccessMarket | [`0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333`](https://bscscan.com/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333) | Tnega's own "Sell Your Agent" contract. Deployed and BscScan source-verified. |
| AgentBudgetEscrow | [`0x4728f03693DDABbe50E79c7BfFCb930e522D585B`](https://bscscan.com/address/0x4728f03693DDABbe50E79c7BfFCb930e522D585B) | Tnega's own drawable-budget contract: a client funds a budget and an agent draws against it as it works. |


## The same address is not the same contract

`0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` is **two different contracts**,
depending on the chain:

| Chain | What is at that address |
|---|---|
| BNB Chain (56) | AgentAccessMarket |
| Arbitrum (42161) | AgentBudgetEscrow |
| Robinhood Chain (4663) | AgentBudgetEscrow |

This is a coincidence of CREATE address derivation — the same deployer wallet
at the same nonce produces the same address on every EVM chain — and not a
guarantee of anything. It is recorded here because it is a trap rather than a
convenience.

Both contracts implement `owner()`, `feeBps()` and `MAX_FEE_BPS()`. Checked on
chain on 2026-09-10: all three answer on all three chains, with the same owner
and the same 250 / 1000. So a defensive "is our contract here?" probe passes
while pointing at the wrong contract, and the mistake surfaces only when a
write reverts — or, in the worst case, does not. An ERC-20 `approve()` sent to
that address on Arbitrum would be a real allowance granted to the budget
escrow rather than the market, with nothing to notice at the time.

**The rule:** every address is resolved per chain, from
`frontend/src/chainContracts.js` on the client and `BUDGET_HIRE_CHAIN_IDS` /
`ESCROW_HIRE_CHAIN_IDS` in `backend/core/chain_views.py` on the server. No
module holds a bare address constant and uses it on whatever chain the wallet
is on. `frontend/scripts/chain_contracts_selfcheck.mjs` enforces this,
including a check that no source file outside `chainContracts.js` hardcodes
either address.

## Deployments per chain

| Contract | Chain | Address | Verified |
|---|---|---|---|
| AgentBudgetEscrow | BNB Chain (56) | `0x4728f03693DDABbe50E79c7BfFCb930e522D585B` | BscScan |
| AgentBudgetEscrow | Arbitrum (42161) | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | Arbiscan |
| AgentBudgetEscrow | Robinhood Chain (4663) | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | Sourcify, `exact_match` |
| AgentAccessMarket | BNB Chain (56) | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | BscScan |

All three AgentBudgetEscrow deployments share one owner,
`0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9`, and `feeBps = 250`.

## Which hire path works where

| Path | Contract | Chains | Whose |
|---|---|---|---|
| Escrow hiring | ERC-8183 AgenticCommerce | BNB Chain only | Altana's, not ours to deploy |
| Budget hiring | AgentBudgetEscrow | BNB Chain, Arbitrum, Robinhood Chain | Ours |

BNB testnet (97) is deliberately excluded even though ERC-8183 exists there:
no testnet value may be reachable from a production path.
| ERC-8004 Identity Registry | [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | Every agent's on-chain identity (ERC-721). |
| ERC-8183 AgenticCommerce | [`0xEa4DAa3100A767e86FDed867729ae7446476EBA6`](https://bscscan.com/address/0xEa4DAa3100A767e86FDed867729ae7446476EBA6) | The hire/escrow kernel: job state and funds. |
| ERC-8183 EvaluatorRouter | [`0x51895229E12F9876011789B04f8698af06cCD6DA`](https://bscscan.com/address/0x51895229E12F9876011789B04f8698af06cCD6DA) | Binds a job to its settlement policy. |
| ERC-8183 OptimisticPolicy | [`0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5`](https://bscscan.com/address/0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5) | Default settlement rule (silence = approval; dispute inside the review window instead). |
| `$U` (United Stables) | [`0xcE24439F2D9C6a2289F741120FE202248B666666`](https://bscscan.com/address/0xcE24439F2D9C6a2289F741120FE202248B666666) | ERC-8183's settlement token, confirmed on-chain: symbol `U`, name "United Stables", 18 decimals. |
| USDT (BSC-USD) | [`0x55d398326f99059fF775485246999027B3197955`](https://bscscan.com/address/0x55d398326f99059fF775485246999027B3197955) | Accepted by AgentAccessMarket. |
| Native BNB sentinel | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` | Represents native BNB in AgentAccessMarket's token whitelist (paid via `msg.value`). |
| Multicall3 | [`0xcA11bde05977b3631167028862bE2a173976CA11`](https://bscscan.com/address/0xcA11bde05977b3631167028862bE2a173976CA11) | Canonical cross-chain address; used to batch on-chain reads (job scans, health checks) into one call. |
| Altana KeyStore (BSC) | [`0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a`](https://bscscan.com/address/0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a) | Stores each Altana passkey wallet's admin/session public keys. Third-party (Altana), not Tnega's own contract. |

## AgentAccessMarket: what it does

Creators sell access to an agent they own; the underlying ERC-8004 identity token is never transferred, so the agent keeps its on-chain identity. Access is a non-transferable entitlement (`accessExpiry[agentId][buyer]`), sold under one of two pricing models:

- `buyOneTime(agentId, token)`: a permanent, one-time license.
- `subscribe(agentId, token)`: access until an expiry, renewable (renewing early extends the existing expiry; renewing late after it's lapsed restarts it).

A third model, pay-per-call via x402, settles off this contract entirely (a direct per-HTTP-call payment to the creator) and is configured in the UI rather than on-chain.

Multi-token, fixed whitelist, no swap: a creator can price the same agent in several tokens, native BNB, USDT, and `$U`, one listing per `(agentId, token)` pair; the buyer picks which one to pay with. There's no swap logic in the contract, so there's no slippage or MEV exposure from this contract itself.

Security model: OpenZeppelin `Ownable2Step` / `ReentrancyGuard` / `SafeERC20`; pull-over-push payouts, tracked separately per token; the platform fee is read live from `feeBps` (owner-tunable, hard-capped at 10%, and any change only ever applies to future sales); `feeWallet` is set at deploy from a dedicated wallet, changeable only by the owner; `list()` is gated by an `ownerOf` check against the ERC-8004 registry, so only an agent's owner can list it; no admin path exists that can move funds a sale has already settled.

Current on-chain values are in the table further down, read live rather than
from a config file or older notes.

One claim in that table is worth separating from the rest. `feeWallet` is a
hardware wallet, so platform fee revenue sits in cold storage rather than
behind a hot key. Nothing on-chain distinguishes a hardware-backed address
from any other, so this is an operational fact about how the key is held, not
something a reader can verify from the chain the way they can verify `feeBps`
or `owner`.

## AgentBudgetEscrow: paying an agent that has to spend as it works

A one-off hire escrows a fixed amount for one deliverable. Some work does not
fit that shape: an agent that has to make many small spends over days needs a
budget it can draw against rather than a single payment on completion.

The client opens a budget with a total, a per-draw maximum, a deadline and a
cooldown between draws. The agent draws as it works. The platform fee is
taken per draw rather than once up front, so an unused budget generates no
fee and the client reclaims the whole remainder.

Fees accrue inside the contract and are withdrawn separately through
`withdrawFees`, callable only by the owner or the fee wallet. Withdrawing
fees cannot touch budget funds, which is covered by
`test_feesAccrueAndWithdraw_neverTouchBudgetFunds`.

The agent address cannot be the client address. The contract rejects that on
purpose, so a client cannot draw their own budget back through the agent
path and bypass the fee.

Integration detail, including the budget struct and the draw sequence, is in
[Drawable Budgets](budget-integration.md). The deployment and verification
record is in [AgentBudgetEscrow Go-Live](budget-escrow-golive.md). The fee
mechanics both contracts share are in
[Fees and Revenue](fees-and-revenue.md).

## Live values on both fee-taking contracts

Read from BSC mainnet on 2026-09-08, not copied from a config file or an
older note. Both contracts are owned by the same address and pay into the
same fee wallet.

| Call | AgentAccessMarket | AgentBudgetEscrow |
|---|---|---|
| `feeBps()` | `250` (2.5%) | `250` (2.5%) |
| `MAX_FEE_BPS()` | `1000` (10%) | `1000` (10%) |
| `feeWallet()` | `0xBfE58070b39F0F2E1c46A4EF80690B6045934293` | `0xBfE58070b39F0F2E1c46A4EF80690B6045934293` |
| `owner()` | `0x48ce74cdc366e8347f17f7187fbf2ab9240692e9` | `0x48ce74cdc366e8347f17f7187fbf2ab9240692e9` |
| `paused()` | not applicable | `false` |
| `budgetCounter()` | not applicable | `3` |

`MAX_FEE_BPS` is a constant, not a setting. `setFeeBps` reverts with
`FeeTooHigh` above 1000, so the owner cannot raise the rate past 10% even by
mistake, and a rate change applies only to future activity.

## ERC-8183: the "Hire" flow

See [Core Concepts](core-concepts.md#erc-8183-agentic-commerce-job-escrow) for the full protocol explanation. In short: `createJob -> registerJob -> setBudget -> approve($U) -> fund`, all signed client-side; the provider later `submit()`s a deliverable; settlement is permissionless and happens automatically once the review window passes, or the buyer can `dispute()` inside that window, or reclaim funds via `claimRefund()` after the deadline if nothing was ever delivered.

## On-chain verification you can do yourself

Every address above is independently checkable on [BscScan](https://bscscan.com). A few reads worth trying directly:

```
# AgentAccessMarket's current platform fee (basis points)
eth_call feeBps() -> uint16

# AgentAccessMarket's current fee-recipient wallet
eth_call feeWallet() -> address

# Total ERC-8183 jobs ever created on this kernel
eth_call jobCounter() -> uint256
```