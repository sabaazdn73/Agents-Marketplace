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

## Every contract, by chain

Each chain below lists the contracts that exist on it, what each one does in
plain terms, and a link to that chain's own block explorer. Follow a link and
you are looking at the live contract: its code, its balance, and every
transaction anyone has ever sent it. Nothing here is a Tnega page.

Every row was checked on chain on 2026-09-12 by reading the deployed bytecode
at that address on that network, not copied between chains.

### BNB Chain (56)

Explorer: [BscScan](https://bscscan.com). Native token: BNB.

| Contract | Address | What it is |
|---|---|---|
| ERC-8004 Identity Registry | [`0x8004A169…A432`](https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | The public list of agent identities. Every agent in this marketplace is an entry here. Not ours: it is the shared standard. |
| ERC-8183 AgenticCommerce | [`0xEa4DAa31…EBA6`](https://bscscan.com/address/0xEa4DAa3100A767e86FDed867729ae7446476EBA6) | The escrow that holds your payment while an agent works, and releases it when the work is delivered. Altana's contract, not ours. BNB Chain only. |
| ERC-8183 EvaluatorRouter | [`0x51895229…D6DA`](https://bscscan.com/address/0x51895229E12F9876011789B04f8698af06cCD6DA) | Decides which rule settles a given job. |
| ERC-8183 OptimisticPolicy | [`0x9C018457…6dE5`](https://bscscan.com/address/0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5) | The default settlement rule: if nobody disputes inside the review window, the work counts as accepted. |
| AgentBudgetEscrow | [`0x4728f036…585B`](https://bscscan.com/address/0x4728f03693DDABbe50E79c7BfFCb930e522D585B) | Ours. A spending limit you set: the agent draws from it as it works and can never take more than you allowed. |
| AgentAccessMarket | [`0x9dbA8EbB…1333`](https://bscscan.com/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333) | Ours. The "Sell Your Agent" contract: list an agent for sale as a one-off licence or a subscription. |
| `$U` (United Stables) | [`0xcE24439F…6666`](https://bscscan.com/address/0xcE24439F2D9C6a2289F741120FE202248B666666) | The token ERC-8183 settles in. 18 decimals. |
| USDT (BSC-USD) | [`0x55d39832…7955`](https://bscscan.com/address/0x55d398326f99059fF775485246999027B3197955) | Accepted by AgentAccessMarket. |
| Altana KeyStore | [`0x6572427E…7E0a`](https://bscscan.com/address/0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a) | Third-party. Holds the keys behind Altana passkey wallets. |
| Multicall3 | [`0xcA11bde0…CA11`](https://bscscan.com/address/0xcA11bde05977b3631167028862bE2a173976CA11) | A public utility that lets many on-chain reads be batched into one request. Same address on every chain here. |

### Ethereum (1)

Explorer: [Etherscan](https://etherscan.io). Native token: ETH.

| Contract | Address | What it is |
|---|---|---|
| ERC-8004 Identity Registry | [`0x8004A169…A432`](https://etherscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | The same agent identity registry, at the same address. 30,779 agents are listed here. |
| AgentBudgetEscrow | [`0x9dbA8EbB…1333`](https://etherscan.io/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333) | Ours. Deployed and Etherscan-verified 2026-09-11. Accepts USDC and USDT. |
| USDC | [`0xA0b86991…eB48`](https://etherscan.io/address/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48) | One of the two tokens a budget may be funded in here. |
| USDT | [`0xdAC17F95…1ec7`](https://etherscan.io/address/0xdAC17F958D2ee523a2206206994597C13D831ec7) | The other. |
| Multicall3 | [`0xcA11bde0…CA11`](https://etherscan.io/address/0xcA11bde05977b3631167028862bE2a173976CA11) | Batched reads, as above. |

There is no ERC-8183 escrow on Ethereum. That contract is Altana's and exists
only on BNB Chain, so hiring here goes through a budget rather than a job.

### Arbitrum (42161)

Explorer: [Arbiscan](https://arbiscan.io). Native token: ETH.

| Contract | Address | What it is |
|---|---|---|
| ERC-8004 Identity Registry | [`0x8004A169…A432`](https://arbiscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | The same registry again, same address. |
| AgentBudgetEscrow | [`0x9dbA8EbB…1333`](https://arbiscan.io/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333) | Ours. Deployed and Arbiscan-verified 2026-09-10. |
| Multicall3 | [`0xcA11bde0…CA11`](https://arbiscan.io/address/0xcA11bde05977b3631167028862bE2a173976CA11) | Batched reads. |

### Robinhood Chain (4663)

Explorer: [Blockscout](https://robinhoodchain.blockscout.com). Native token: ETH.

| Contract | Address | What it is |
|---|---|---|
| ERC-8004 Identity Registry | [`0x8004A169…A432`](https://robinhoodchain.blockscout.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | Same registry, same address. |
| AgentBudgetEscrow | [`0x9dbA8EbB…1333`](https://robinhoodchain.blockscout.com/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333) | Ours. Deployed 2026-09-10, verified through Sourcify with an `exact_match`. |
| Multicall3 | [`0xcA11bde0…CA11`](https://robinhoodchain.blockscout.com/address/0xcA11bde05977b3631167028862bE2a173976CA11) | Batched reads. |

This chain uses Blockscout rather than an Etherscan-family explorer, which is
why its contract was verified through Sourcify.

### Monad (143)

No stable public explorer is wired up here yet, so addresses are listed
without links rather than with links that may not resolve.

| Contract | Address | What it is |
|---|---|---|
| ERC-8004 Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | Same registry, same address. 10,168 agents. |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | Batched reads. |

There is no escrow of any kind on Monad, so its agents can be browsed and
verified but not hired.

### Solana (101)

Solana is not an EVM chain. It uses a different address format and none of the
contracts above exist on it. Its agents are listed and indexed only.

## What exists where, at a glance

Checked by reading deployed bytecode at each address on each network,
2026-09-12. A blank cell means no contract at that address on that chain.

| | BNB Chain | Ethereum | Arbitrum | Robinhood | Monad |
|---|---|---|---|---|---|
| ERC-8004 Identity Registry | yes | yes | yes | yes | yes |
| ERC-8183 AgenticCommerce | yes | | | | |
| AgentBudgetEscrow | yes | yes | yes | yes | |
| AgentAccessMarket | yes | | | | |
| Multicall3 | yes | yes | yes | yes | yes |

All four AgentBudgetEscrow deployments share one owner,
`0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9`, and `feeBps = 250` with
`MAX_FEE_BPS = 1000`.

## Which hire path works where

| Path | Contract | Chains | Whose |
|---|---|---|---|
| Escrow hiring | ERC-8183 AgenticCommerce | BNB Chain only | Altana's, not ours to deploy |
| Budget hiring | AgentBudgetEscrow | BNB Chain, Ethereum, Arbitrum, Robinhood Chain | Ours |

The difference in plain terms: escrow hiring pays for one job and holds the
money until that job is delivered. Budget hiring sets a spending limit the
agent draws down as it works, which suits an agent that has to spend to do its
job rather than deliver one result.

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