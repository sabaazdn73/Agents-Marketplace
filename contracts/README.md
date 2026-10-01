# Contracts

Solidity 0.8.24, built and tested with Foundry. One contract here serves the
current product, the swap probe behind the cost figures, and it is never
deployed. The other three belong to the earlier agents work and the Hyperliquid
readings; they are deployed and still read by those parts of the site.

Addresses, chains and verification status, first recorded on 2026-09-10 (AgentBudgetEscrow on
Ethereum deployed 2026-09-11, the HyperEVM reader 2026-09-17; code confirmed
at each address on public RPCs on 2026-10-01), are in
[docs/deployments.md](../docs/deployments.md). Resolve an address by chain id:
the same address holds different contracts on different chains.

| Contract | Deployed | Used by |
|---|---|---|
| [`TnegaSwapProbe`](src/TnegaSwapProbe.sol) | Never. Its runtime is injected by an `eth_call` state override | The cost engine (`backend/core/te/probe.py`): runs each venue's own swap code at a pinned block and reverts before any token moves, so no balance, approval or key is needed. Covers concentrated-liquidity pools (Uniswap V3 and its forks, Aerodrome Slipstream, Algebra), Uniswap V4 and PancakeSwap Infinity CL |
| [`HyperCoreReader`](src/HyperCoreReader.sol) | HyperEVM (999) | The Hyperliquid readings and the extension panel: one view call that reads an address's HyperCore state through the precompiles. Every function is `view` |
| [`AgentBudgetEscrow`](src/AgentBudgetEscrow.sol) | BNB Chain, Ethereum, Arbitrum, Robinhood Chain | Explore agents: drawable spending budgets funded to an agent (a spending mechanism, not an escrow; drawing requires no deliverable) |
| [`AgentAccessMarket`](src/AgentAccessMarket.sol) | BNB Chain | Explore agents: buying access to an ERC-8004 agent from its owner, one-time or by subscription, in an owner-controlled whitelist of tokens with no swap |

## The probe's bytecode

The backend carries the probe's runtime and its hashes in
`backend/core/te/probe_bytecode.py`; `backend/scripts/te_cost_selfcheck.py`
checks them against the source. The `probe` profile in `foundry.toml` builds it
reproducibly (EVM paris, no metadata):

```
FOUNDRY_PROFILE=probe forge build src/TnegaSwapProbe.sol
```

## Tests

Dependencies are git-ignored; install them first:

```
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0
forge install foundry-rs/forge-std
```

`test/` holds `AgentAccessMarket.t.sol`, which runs against a fork of BNB Chain
(real USDT and the real ERC-8004 registry); `AgentBudgetEscrow.t.sol`, an
adversarial suite on mock tokens (fee-on-transfer and reentrant ones included);
and `StockTokenMultiplier.t.sol`, which checks AgentBudgetEscrow's accounting
when a Robinhood Chain stock token's multiplier moves. The fork tests need an
RPC:

```
forge test --fork-url https://bsc-dataseed.binance.org -vv
```

`script/` holds the deploy scripts (`Deploy.s.sol` for AgentAccessMarket,
`DeployBudgetEscrow.s.sol`, `DeployHyperCoreReader.s.sol`) and
`fork_demo.sh`, a scripted deploy and purchase on a local Anvil fork. How the
deployments were done is in [Arbitrum and Robinhood deployment](../docs/multichain-deploy.md)
and [AgentBudgetEscrow mainnet go-live](../docs/budget-escrow-golive.md);
how the contracts work, in [Smart contracts](../docs/smart-contracts.md)
(archived pages, written at the time).

## AgentAccessMarket in brief

Access is a non-transferable entitlement, `accessExpiry[agentId][buyer]`; the
ERC-8004 identity token never moves. Only the agent's registered owner can list
it. Payments use native BNB or whitelisted ERC-20s with no swap; creators and
the platform withdraw their balances (pull over push); the fee is capped at
`MAX_FEE_BPS` (10%) in the code and applies to future purchases only.
OpenZeppelin `Ownable2Step`, `ReentrancyGuard` and `SafeERC20`. A third pricing
model, pay per call over x402, settles off-contract.
