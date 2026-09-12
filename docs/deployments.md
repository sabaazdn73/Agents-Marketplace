# Deployed contracts

Every contract this project deploys or depends on, in one place. Addresses
below were read from chain on 2026-09-10 and their verification status was
confirmed against the explorer that holds it, not copied from another page.

## Contracts this project wrote

| Contract | Chain | Address | Explorer | Verified |
|---|---|---|---|---|
| AgentAccessMarket | BNB Chain (56) | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | [BscScan](https://bscscan.com/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333) | Yes, source verified |
| AgentBudgetEscrow | BNB Chain (56) | `0x4728f03693DDABbe50E79c7BfFCb930e522D585B` | [BscScan](https://bscscan.com/address/0x4728f03693DDABbe50E79c7BfFCb930e522D585B) | Yes, source verified |
| AgentBudgetEscrow | Ethereum (1) | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | [Etherscan](https://etherscan.io/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333) | Yes, source verified |
| AgentBudgetEscrow | Arbitrum One (42161) | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | [Arbiscan](https://arbiscan.io/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333) | Yes, source verified |
| AgentBudgetEscrow | Robinhood Chain (4663) | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | [Blockscout](https://robinhoodchain.blockscout.com/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333) | Yes, via Sourcify, `exact_match` |

All five compile with solc `0.8.24+commit.e11b9ed9`, optimizer on at 200
runs. Every AgentBudgetEscrow deployment has runtime bytecode of 7,396 bytes,
identical across the four chains.

Shared properties of all four escrow deployments:

| | |
|---|---|
| Owner | `0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9` |
| `feeBps` | 250, which is 2.5% |
| `MAX_FEE_BPS` | 1000, fixed in the code, so the owner cannot raise the fee past 10% |

## One address, two contracts

`0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` appears twice in the table above
and is not the same contract in both places:

- On BNB Chain it is AgentAccessMarket
- On Ethereum, Arbitrum and Robinhood Chain it is AgentBudgetEscrow

This is a coincidence of address derivation, not a design. The same deployer
wallet at the same nonce produces the same address on every EVM chain. Both
contracts implement `owner()`, `feeBps()` and `MAX_FEE_BPS()` and answer
identically, so a probe cannot tell them apart.

Three escrows now share that address with one market, so an address that looks
right is right three times out of four. That is the ratio that trains someone
to stop checking, which is why the rule below is absolute rather than a
preference. What does distinguish them on chain is the deployed bytecode: 7,396
bytes for the escrow against 6,478 for the market.

Resolve addresses by chain id, never by reusing one that looks familiar. Full
explanation in [Hiring beyond BNB Chain](multichain-hiring.md).

## Standards this project depends on

These are not ours. They are listed because reading them is part of verifying
how hiring settles.

| Contract | Chain | Address | Explorer |
|---|---|---|---|
| ERC-8004 Identity Registry | BNB Chain, Arbitrum, Robinhood Chain, and other EVM chains | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | [BscScan](https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) |
| ERC-8183 AgenticCommerce | BNB Chain (56) | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` | [BscScan](https://bscscan.com/address/0xEa4DAa3100A767e86FDed867729ae7446476EBA6) |
| ERC-8183 EvaluatorRouter | BNB Chain (56) | `0x51895229E12F9876011789B04f8698af06cCD6DA` | [BscScan](https://bscscan.com/address/0x51895229E12F9876011789B04f8698af06cCD6DA) |
| ERC-8183 OptimisticPolicy | BNB Chain (56) | `0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5` | [BscScan](https://bscscan.com/address/0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5) |
| `$U` settlement token | BNB Chain (56) | `0xcE24439F2D9C6a2289F741120FE202248B666666` | [BscScan](https://bscscan.com/address/0xcE24439F2D9C6a2289F741120FE202248B666666) |

The ERC-8004 registry carries the same address on every EVM chain here, and
its 130 bytes of code were confirmed present on BNB Chain, Ethereum, Arbitrum,
Robinhood Chain and Monad. AgenticCommerce and EvaluatorRouter are also 130-byte
proxies; AgenticCommerce verifies on BscScan as an `ERC1967Proxy`.

ERC-8183 exists on BNB Chain and its testnet only, which is why escrow hiring
does not extend to other chains. That is a property of the protocol rather
than unfinished work here.

## Accepted tokens per chain

Budgets can be funded in the chain's native gas token or in an accepted
ERC-20. Each address below was read on its own chain by calling `symbol()`
and `decimals()`.

| Chain | Token | Address | Decimals |
|---|---|---|---|
| BNB Chain (56) | BNB, native | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` sentinel | 18 |
| BNB Chain (56) | USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 |
| Arbitrum (42161) | ETH, native | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` sentinel | 18 |
| Arbitrum (42161) | USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |
| Arbitrum (42161) | USD₮0 | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 |
| Robinhood Chain (4663) | ETH, native | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` sentinel | 18 |
| Robinhood Chain (4663) | USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |

## Where to go next

- How the contracts work: [Smart Contracts](smart-contracts.md)
- How the multi-chain deployment was done, with commands and gas:
  [Arbitrum and Robinhood Deployment](multichain-deploy.md)
- The BNB Chain go-live checklist: [AgentBudgetEscrow Mainnet Go-Live](budget-escrow-golive.md)
- Why one address is two contracts, and what stops that being assumed:
  [Hiring beyond BNB Chain](multichain-hiring.md)
